// Realistic 3D avatar stage (three.js + local GLB), with graceful fallback.
// Anything that fails (CDN, WebGL, model) resolves null and the caller keeps
// the built-in SVG figure. Rig matching below is pure and unit-tested; the
// Three.js glue is verified by review + the user's browser run.
//
// NOTE: the bundled GLB ships one 45s full-body clip ("Animation"). We do NOT
// autoplay it — its content is unverified and it would fight procedural
// posing. All motion here is procedural on named bones.

const THREE_URL = "three";
const GLTF_URL = "three/addons/loaders/GLTFLoader.js";
const ROOM_URL = "three/addons/environments/RoomEnvironment.js";

const STATES = ["idle", "listening", "thinking", "speaking", "signing"];

function sideOf(name) {
  const n = String(name || "");
  if (/(^|[\s_.-])r([\s_.-]|$)|right/i.test(n)) return "R";
  if (/(^|[\s_.-])l([\s_.-]|$)|left/i.test(n)) return "L";
  if (/^[LR](?=[A-Z])/.test(n)) return n[0].toUpperCase() === "L" ? "L" : "R";
  const tail = /([LR])$/.exec(n);
  if (tail) return tail[1] === "L" ? "L" : "R";
  return null;
}

// Map node names to the bones we pose. Returns real names or null each.
// Side markers (Left/Right, _L/_R, .L/.R …) are stripped before matching,
// so prefix rigs (RightHand) and suffix rigs (Hand_R) both work.
function stripSide(name) {
  return String(name || "")
    .replace(/^(left|right)[\s_.-]+/i, "")
    .replace(/[\s_.-]+(left|right)$/i, "")
    .replace(/^(left|right)(?=[A-Z])/i, "")
    .replace(/^([lr])[\s_.-]+/i, "")
    .replace(/[\s_.-]+([lr])$/i, "")
    .replace(/^([LR])(?=[A-Z])/, "")
    .replace(/([LR])$/, "");
}

export function classifyRig(nodeNames) {
  const names = Array.isArray(nodeNames) ? nodeNames.map((n) => String(n || "")) : [];
  const find = (pred) => {
    const hit = names.find((n) => pred(n));
    return hit === undefined ? null : hit;
  };
  const isR = (n) => sideOf(n) === "R";
  const base = (n) => stripSide(n).toLowerCase();
  return {
    head: find((n) => base(n) === "head"),
    neck: find((n) => base(n) === "neck"),
    hips: find((n) => base(n) === "hips"),
    spine: find((n) => /^spine\d*$/.test(base(n))),
    shoulderR: find((n) => base(n) === "shoulder" && isR(n)),
    shoulderL: find((n) => base(n) === "shoulder" && sideOf(n) === "L"),
    armR: find((n) => base(n) === "arm" && isR(n)),
    armL: find((n) => base(n) === "arm" && sideOf(n) === "L"),
    foreArmR: find((n) => /fore/.test(base(n)) && isR(n)),
    handR: find((n) => base(n) === "hand" && isR(n)),
    handL: find((n) => base(n) === "hand" && sideOf(n) === "L"),
  };
}

export function poseScore(avgHandY, hipsY, bindHipsY) {
  return avgHandY + 3 * Math.abs(hipsY - bindHipsY);
}

// Scrub the bundled clip for the frame with the lowest hands and level hips,
// and leave the model posed there. Pure data probing — never shown in motion.
// Fixes T-pose bind poses without guessing any bone rotation direction.
function tryAutoPose(THREE, model, clips, joints) {
  if (!clips || clips.length === 0 || !joints.handL || !joints.handR || !joints.hips) return;
  try {
    model.updateMatrixWorld(true);
    const bindHipsY = joints.hips.getWorldPosition(new THREE.Vector3()).y;
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clips[0]);
    action.play();
    action.paused = true;
    const dur = clips[0].duration || 1;
    const vL = new THREE.Vector3();
    const vR = new THREE.Vector3();
    const vH = new THREE.Vector3();
    let bestT = 0;
    let best = Infinity;
    for (let t = 0; t <= dur; t += 0.25) {
      mixer.setTime(t);
      model.updateMatrixWorld(true);
      joints.handL.getWorldPosition(vL);
      joints.handR.getWorldPosition(vR);
      joints.hips.getWorldPosition(vH);
      const s = poseScore((vL.y + vR.y) / 2, vH.y, bindHipsY);
      if (s < best) {
        best = s;
        bestT = t;
      }
    }
    mixer.setTime(bestT);
    model.updateMatrixWorld(true);
    mixer.uncacheClip(clips[0]);
  } catch {
    // keep bind pose
  }
}

// Lower both arms until the hands hang at the body's sides. Self-calibrating:
// probes each local axis to find the one that moves the hand down, then
// descends to the bottom of the swing (not just the first touch of the
// target height, which leaves arms held out wide). Never guesses a rotation
// direction, so it works on any bind pose or clip sample. Rotates the
// upper-arm bone when the rig has one, else the shoulder/clavicle.
export function lowerArms(THREE, model, joints, sizeY = 1.7) {
  const report = { skipped: null, stepsL: 0, stepsR: 0, y0: [], y1: [], target: 0, pivots: [] };
  const pairs = [
    [joints.armL || joints.shoulderL, joints.handL, "L", joints.armL ? "arm" : "shoulder"],
    [joints.armR || joints.shoulderR, joints.handR, "R", joints.armR ? "arm" : "shoulder"],
  ];
  if (!joints.hips || pairs.some(([p, h]) => !p || !h)) {
    report.skipped = "joints";
    return report;
  }
  try {
    model.updateMatrixWorld(true);
    const target = joints.hips.getWorldPosition(new THREE.Vector3()).y + sizeY * 0.07;
    report.target = +target.toFixed(3);
    const eps = sizeY * 0.0008;
    const v = new THREE.Vector3();
    for (const [pivot, hand, side, label] of pairs) {
      report.pivots.push(label);
      const start = { x: pivot.rotation.x, y: pivot.rotation.y, z: pivot.rotation.z };
      model.updateMatrixWorld(true);
      const startY = hand.getWorldPosition(v).y;
      report.y0.push(+startY.toFixed(3));
      if (startY <= target) {
        report.y1.push(+startY.toFixed(3));
        continue; // already hanging: touch nothing
      }
      let axis = null;
      let dir = 1;
      let bestRate = sizeY * 0.0004;
      for (const ax of ["x", "y", "z"]) {
        const orig = pivot.rotation[ax];
        pivot.rotation[ax] = orig + 0.1;
        model.updateMatrixWorld(true);
        const yPlus = hand.getWorldPosition(v).y;
        pivot.rotation[ax] = orig - 0.1;
        model.updateMatrixWorld(true);
        const yMinus = hand.getWorldPosition(v).y;
        pivot.rotation[ax] = orig;
        if (yMinus - yPlus > bestRate) { bestRate = yMinus - yPlus; axis = ax; dir = 1; }
        if (yPlus - yMinus > bestRate) { bestRate = yPlus - yMinus; axis = ax; dir = -1; }
      }
      if (!axis) {
        report.y1.push(+startY.toFixed(3));
        continue;
      }
      let bestY = startY;
      let bestAngle = pivot.rotation[axis];
      let bad = 0;
      let steps = 0;
      for (let i = 0; i < 30; i++) {
        pivot.rotation[axis] += dir * 0.08;
        if (Math.abs(pivot.rotation[axis] - start[axis]) > 1.7) break;
        model.updateMatrixWorld(true);
        const y = hand.getWorldPosition(v).y;
        steps++;
        if (y < bestY - eps) { bestY = y; bestAngle = pivot.rotation[axis]; bad = 0; }
        else if (++bad >= 3) break;
      }
      pivot.rotation[axis] = bestAngle;
      report["steps" + side] = steps;
      report.y1.push(+bestY.toFixed(3));
    }
    model.updateMatrixWorld(true);
  } catch {
    report.skipped = "error";
  }
  return report;
}

function loadGltf(GLTFLoader, url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, undefined, reject);
  });
}

export async function initAvatar3D(canvas, opts = {}) {
  try {
    return await start(canvas, opts.modelUrl || "models/avatar.glb");
  } catch (err) {
    try {
      if (opts.onError) opts.onError(`3D failed: ${String((err && err.message) || err).slice(0, 160)}`);
    } catch {
      // never break the page over diagnostics
    }
    return null;
  }
}

async function start(canvas, modelUrl) {
  const THREE = await import(THREE_URL);
  const { GLTFLoader } = await import(GLTF_URL);
  const { RoomEnvironment } = await import(ROOM_URL);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 3 / 4, 0.1, 50);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a3d2a, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe8ff, 0.35);
  fill.position.set(-3, 1.5, 2.5);
  scene.add(fill);

  const gltf = await loadGltf(GLTFLoader, modelUrl);
  const model = gltf.scene;
  const sizeY = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y || 1.7;

  // Rig: collect names, classify, resolve bones, snapshot bind pose.
  const seen = [];
  model.traverse((o) => {
    if (o.name) seen.push(o.name);
  });
  const rig = classifyRig(seen);
  const bone = (name) => (name ? model.getObjectByName(name) : null);
  const head = bone(rig.head);
  const neck = bone(rig.neck);
  const spine = bone(rig.spine);
  // Auto-pose from the model's own clip data (fixes T-pose bind), then
  // snapshot the resulting pose as the base for procedural states.
  tryAutoPose(THREE, model, gltf.animations, {
    handL: bone(rig.handL),
    handR: bone(rig.handR),
    hips: bone(rig.hips),
  });
  const poseReport = lowerArms(THREE, model, {
    shoulderL: bone(rig.shoulderL),
    shoulderR: bone(rig.shoulderR),
    armL: bone(rig.armL),
    armR: bone(rig.armR),
    handL: bone(rig.handL),
    handR: bone(rig.handR),
    hips: bone(rig.hips),
  }, sizeY);
  const base = new Map();
  for (const b of [head, neck, spine]) {
    if (b) base.set(b, b.rotation.clone());
  }

  // Frame: feet on y=0, camera fitted to height, blob shadow to ground it.
  const stage = new THREE.Group();
  stage.add(model);
  scene.add(stage);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.y -= box.min.y;
  const groundY = 0;
  const midY = center.y - box.min.y;
  const dist = (size.y / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.12;
  camera.position.set(center.x, midY, center.z + dist);
  camera.lookAt(center.x, midY, center.z);

  const shadowTex = makeBlobShadow(THREE);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(size.x, 0.6) * 1.15, Math.max(size.x, 0.6) * 1.15),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.4 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = groundY + 0.005;
  stage.add(shadow);

  const fit = () => {
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  fit();
  window.addEventListener("resize", fit);

  let state = "idle";
  let raf = 0;

  // If the user prefers reduced motion: one static frame, no loop.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    renderer.render(scene, camera);
    return finish();
  }

  // Damped pose params: [lean, tilt, pitch, nodAmp, swayAmp, bounceAmp].
  const pose = { lean: 0, tilt: 0, pitch: 0, nodAmp: 0, swayAmp: 0.035, bounceAmp: 0 };
  const target = { ...pose, swayAmp: 0.035 };
  const clock = new THREE.Clock();
  const damp = (c, t, dt) => c + (t - c) * (1 - Math.exp(-8 * dt));

  const targetsFor = (s) => {
    switch (s) {
      case "listening":
        return { lean: 0.09, tilt: 0, pitch: -0.1, nodAmp: 0, swayAmp: 0.02, bounceAmp: 0 };
      case "thinking":
        return { lean: 0, tilt: 0.14, pitch: 0.08, nodAmp: 0, swayAmp: 0.02, bounceAmp: 0 };
      case "speaking":
        return { lean: 0.03, tilt: 0, pitch: 0, nodAmp: 0.06, swayAmp: 0.02, bounceAmp: 0.008 };
      case "signing":
        return { lean: 0.05, tilt: 0, pitch: 0, nodAmp: 0, swayAmp: 0.12, bounceAmp: 0.035 };
      default:
        return { lean: 0, tilt: 0, pitch: 0, nodAmp: 0, swayAmp: 0.035, bounceAmp: 0 };
    }
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();
    Object.assign(target, targetsFor(state));
    for (const k of Object.keys(pose)) pose[k] = damp(pose[k], target[k], dt);
    stage.position.y = Math.sin(t * 1.3) * 0.012 + Math.sin(t * 6.4) * pose.bounceAmp;
    stage.position.z = pose.lean;
    stage.rotation.y = Math.sin(t * (state === "signing" ? 2.2 : 0.6)) * pose.swayAmp;
    if (head) {
      const b = base.get(head);
      head.rotation.x = b.x + pose.pitch + Math.abs(Math.sin(t * 7)) * pose.nodAmp;
      head.rotation.z = b.z + pose.tilt;
    }
    if (neck) {
      const b = base.get(neck);
      neck.rotation.x = b.x + pose.pitch * 0.4;
    }
    if (spine) {
      const b = base.get(spine);
      spine.rotation.x = b.x + Math.sin(t * 1.3) * 0.02;
    }
    renderer.render(scene, camera);
  };
  tick();

  function finish() {
    return {
      setState(s) {
        if (STATES.includes(s)) state = s;
      },
      dispose() {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", fit);
        renderer.dispose();
      },
      rig,
      report: poseReport,
    };
  }
  return finish();
}

function makeBlobShadow(THREE) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
