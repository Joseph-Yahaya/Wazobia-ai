import { initAvatar3D } from "./avatar3d.mjs?v=8";
import { buildIndex, ask } from "./retrieval.mjs?v=8";
import { classifyPose, gestureToPose } from "./pose.mjs?v=8";
import {
  SUPPORTED_CHARS,
  termFor,
  spellable,
  buildTimeline,
  averageShapes,
  validateLibrary,
  missingLetters,
} from "./fingerspell.mjs?v=8";

const DON_T_KNOW =
  "I don't have a verified answer for that. Please check an official INEC channel or ask about registration, PVCs, voting day, results, or safety.";
const LANG_NAMES = {
  en: "English",
  pcm: "Pidgin",
  ha: "Hausa",
  yo: "Yoruba",
  ig: "Igbo",
};
const MP_VISION_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/vision_bundle.mjs";
const MP_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/wasm";
const MP_GESTURE_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const MP_HAND_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_HOLD_MS = 1200;
const GESTURE_MIN_SCORE = 0.5;
const TEACH_FRAMES = 10;
const LIB_KEY = "wazobia-shapes-v1";

let corpus = null;
let index = null;
let avatar3d = null;

const $ = (id) => document.getElementById(id);

function questionText(faq, msgLang = "en") {
  return faq.q[msgLang] || faq.q.en;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const backend = { gemini: false, spitch: false };

// Spoken answers live here (per-message text + language), keyed by token.
const bubbleAnswers = new Map();
let speakToken = 0;

// Avatar state machine: idle | listening | thinking | signing | speaking
function setAvatar(state, text) {
  $("avatar").dataset.state = state;
  if (typeof text === "string") $("agentStatus").textContent = text;
  if (avatar3d) avatar3d.setState(state);
}

// Conversation thread
function scrollThread() {
  const t = $("thread");
  t.scrollTop = t.scrollHeight;
}

// Answer pipeline indicator: Ears → Brain → Voice.
function pipeReset() {
  document.querySelectorAll("#pipeline li").forEach((li) => {
    li.classList.remove("done", "active");
  });
}

function pipeSet(stage, state) {
  const order = ["ears", "brain", "voice"];
  document.querySelectorAll("#pipeline li").forEach((li) => {
    const name = li.dataset.stage;
    li.classList.toggle("done", order.indexOf(name) < order.indexOf(stage) || (name === stage && state === "done"));
    li.classList.toggle("active", name === stage && state === "active");
  });
}

function addUserBubble(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = `<p><strong>You:</strong> ${escapeHtml(text)}</p>`;
  $("thread").appendChild(div);
  scrollThread();
}

function addNotice(text) {
  const div = document.createElement("div");
  div.className = "msg notice";
  div.innerHTML = `<p>${escapeHtml(text)}</p>`;
  $("thread").appendChild(div);
  scrollThread();
}

function agentBubble(faq, reply) {
  const { mode = "local", answerText = faq.a_en, answerLang = "en", translated = false, languages = ["en"] } = reply || {};
  const token = `s${++speakToken}`;
  bubbleAnswers.set(token, { text: answerText, lang: answerLang });
  const sourceBadge =
    mode === "ai"
      ? `<p class="badge">AI answer from approved FAQs — verify with official source</p>`
      : `<p class="badge">Approved FAQ — exact match</p>`;
  const voiceName = backend.spitch ? `${LANG_NAMES[answerLang]} voice` : "device voice";
  const prov =
    `<details class="prov"><summary>How this answer was made</summary>` +
    `<p>Heard: ${escapeHtml(langNames(languages))}. Matched ${escapeHtml(faq.id)} ` +
    `(${mode === "ai" ? "AI pick over verified FAQs" : "exact local match"}). ` +
    `${translated ? `Translated to ${LANG_NAMES[answerLang]} by AI. ` : ""}` +
    `Spoken with ${escapeHtml(voiceName)}.</p></details>`;
  return (
    sourceBadge +
    (translated ? `<p class="badge">AI translation into ${LANG_NAMES[answerLang]} — wording unverified</p>` : "") +
    `<p class="answer">${escapeHtml(answerText)}</p>` +
    `<p class="cite">Source: ${escapeHtml(faq.id)} — “${escapeHtml(questionText(faq, answerLang))}”. ${escapeHtml(corpus.source_note)}</p>` +
    prov +
    `<div class="actions"><button type="button" data-speak="${token}">Read aloud</button>` +
    `<button type="button" data-sign="${escapeHtml(faq.id)}">Show signs</button></div>`
  );
}

function addAgentBubble(faq, reply) {
  const div = document.createElement("div");
  div.className = "msg agent";
  div.innerHTML = agentBubble(faq, reply);
  streamAnswer(div);
  $("thread").appendChild(div);
  wireBubbleButtons(div);
  scrollThread();
}

// Word-by-word reveal, built BEFORE insert so screen readers announce once.
function streamAnswer(div) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const p = div.querySelector("p.answer");
  if (!p) return;
  const words = p.textContent.split(/(\s+)/);
  p.textContent = "";
  const spans = [];
  for (const w of words) {
    const s = document.createElement("span");
    s.textContent = w;
    if (!/^\s*$/.test(w)) {
      s.className = "w";
      spans.push(s);
    }
    p.appendChild(s);
  }
  let i = 0;
  const step = () => {
    const t0 = performance.now();
    while (i < spans.length && performance.now() - t0 < 8) spans[i++].classList.add("in");
    if (i < spans.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function addDontKnowBubble() {
  const div = document.createElement("div");
  div.className = "msg agent";
  div.innerHTML =
    `<p>${escapeHtml(DON_T_KNOW)}</p>` +
    `<p class="cite">No approved FAQ matched, so no answer was given. Try different words.</p>`;
  $("thread").appendChild(div);
  scrollThread();
}

function wireBubbleButtons(root) {
  root.querySelectorAll("[data-speak]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const a = bubbleAnswers.get(btn.dataset.speak);
      if (a) speak(a.text, a.lang);
    });
  });
  root.querySelectorAll("[data-sign]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const faq = corpus.faqs.find((f) => f.id === btn.dataset.sign);
      if (faq) showSigns(faq);
    });
  });
}

// Queries
function langNames(codes) {
  return (codes || []).map((c) => LANG_NAMES[c] || c).join(" + ");
}

async function handleQuery(query, fromVoice = false) {
  query = query.trim();
  if (!query) return;
  addUserBubble(query);
  if (!fromVoice) pipeReset();
  pipeSet("brain", "active");
  setAvatar("thinking", "Thinking…");
  try {
    const r = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: query }),
    });
    if (!r.ok) throw new Error("ask failed");
    const { mode, faqId, languages, answer, answerLang } = await r.json();
    const faq = corpus.faqs.find((f) => f.id === faqId);
    if (!faq) {
      addDontKnowBubble();
    } else {
      addAgentBubble(faq, {
        mode,
        answerText: answer || faq.a_en,
        answerLang: answer ? answerLang : "en",
        translated: !!answer,
        languages: Array.isArray(languages) ? languages : ["en"],
      });
      pipeSet("brain", "done");
      if (Array.isArray(languages) && languages.length > 1) {
        addNotice(`Heard ${langNames(languages)} — replying in ${LANG_NAMES[languages[0]]}.`);
      } else if (Array.isArray(languages) && languages.length === 0) {
        addNotice("Couldn't tell the language — replied in English.");
      }
    }
  } catch {
    localHandleQuery(query);
  }
  setAvatar("idle", "Ready. Ask me about voting.");
}

function localHandleQuery(query) {
  const { best } = ask(corpus.faqs, index, query);
  if (!best) addDontKnowBubble();
  else {
    addAgentBubble(best.faq, { mode: "local", languages: ["en"] });
    pipeSet("brain", "done");
  }
}

function askFaq(id) {
  const faq = corpus.faqs.find((f) => f.id === id);
  if (!faq) return;
  addUserBubble(questionText(faq));
  pipeReset();
  addAgentBubble(faq, { mode: "local", languages: ["en"] });
  pipeSet("brain", "done");
}

// Speech output with avatar state
function speak(text, speakLang) {
  if (!text) return;
  const done = () => {
    pipeSet("voice", "done");
    setAvatar("idle", "Ready. Ask me about voting.");
  };
  pipeSet("voice", "active");
  setAvatar("speaking", "Speaking…");
  if (backend.spitch) {
    fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang: speakLang }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("speak failed");
        return r.blob();
      })
      .then((blob) => {
        const audio = new Audio(URL.createObjectURL(blob));
        audio.onended = done;
        audio.onerror = done;
        return audio.play();
      })
      .catch(() => {
        deviceSpeak(text, done);
      });
    return;
  }
  deviceSpeak(text, done);
}

function deviceSpeak(text, done) {
  if (!("speechSynthesis" in window)) {
    done();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.onend = done;
  u.onerror = done;
  window.speechSynthesis.speak(u);
}

// Shape library (teach-mode hand shapes, persisted locally)
function loadLibrary() {
  try {
    const raw = JSON.parse(localStorage.getItem(LIB_KEY) || "{}");
    return validateLibrary(raw).entries;
  } catch {
    return {};
  }
}

function saveLibrary(lib) {
  localStorage.setItem(LIB_KEY, JSON.stringify(lib));
}

function renderLibraryStatus() {
  const lib = loadLibrary();
  const taught = Object.keys(lib).sort().join(" ");
  $("libStatus").textContent =
    `${Object.keys(lib).length} of ${SUPPORTED_CHARS.length} hand shapes taught.` +
    (taught ? ` Taught: ${taught}` : "");
}

function drawHand(canvas, lm, line = "#0b5c2f", dot = "#b35400") {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 3;
  ctx.strokeStyle = line;
  ctx.fillStyle = dot;
  ctx.beginPath();
  for (const [a, b] of HAND_LINKS) {
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
  }
  ctx.stroke();
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Fingerspelling playback on the signing stage
let signToken = 0;

function renderSignProgress(timeline, doneIndex) {
  $("signProgress").textContent = timeline
    .map((t, i) => (i < doneIndex ? "●" : i === doneIndex ? "◉" : "○"))
    .join(" ");
}

function showSigns(faq) {
  const term = termFor(faq.id);
  if (!term || !spellable(term)) {
    addNotice("This answer has no spellable key term yet.");
    return;
  }
  const lib = loadLibrary();
  const missing = missingLetters(term, lib);
  if (missing.length > 0) {
    addNotice(
      `To sign "${term}" I still need to learn: ${missing.join(", ")}. ` +
        "Open the Sign tab, start the camera, and teach me each letter."
    );
    activateTab("sign");
    return;
  }
  const timeline = buildTimeline(term);
  const run = ++signToken;
  setAvatar("signing", `Signing: ${term}`);
  $("signStage").hidden = false;
  $("signCaption").textContent = `“${questionText(faq)}”`;
  const step = (i) => {
    if (run !== signToken) return;
    if (i >= timeline.length) {
      setAvatar("idle", "Ready. Ask me about voting.");
      $("signCaption").textContent = `Signed "${term}". ${questionText(faq)}`;
      return;
    }
    const { letter } = timeline[i];
    $("signLetter").textContent = letter;
    renderSignProgress(timeline, i);
    drawHand($("signCanvas"), lib[letter].landmarks, "#7fd79b", "#ffd900");
    const hold = timeline[i].endMs - timeline[i].startMs;
    const gap = i + 1 < timeline.length ? timeline[i + 1].startMs - timeline[i].endMs : 0;
    setTimeout(() => step(i + 1), hold + gap);
  };
  step(0);
}

// Tabs
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", String(active));
    document.getElementById(t.getAttribute("aria-controls")).hidden = !active;
  });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

// Settings
function applySettings() {
  document.documentElement.dataset.contrast =
    localStorage.getItem("wazobia-contrast") === "high" ? "high" : "";
  document.documentElement.dataset.text =
    localStorage.getItem("wazobia-text") === "large" ? "large" : "";
  $("contrastToggle").setAttribute(
    "aria-pressed",
    String(document.documentElement.dataset.contrast === "high")
  );
  $("textToggle").setAttribute(
    "aria-pressed",
    String(document.documentElement.dataset.text === "large")
  );
}
$("contrastToggle").addEventListener("click", () => {
  localStorage.setItem(
    "wazobia-contrast",
    localStorage.getItem("wazobia-contrast") === "high" ? "" : "high"
  );
  applySettings();
});
$("textToggle").addEventListener("click", () => {
  localStorage.setItem(
    "wazobia-text",
    localStorage.getItem("wazobia-text") === "large" ? "" : "large"
  );
  applySettings();
});
// Ask form
$("askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  handleQuery($("question").value);
  $("question").value = "";
});

// Voice input: Gemini transcription when the backend can hear,
// otherwise the browser's own speech recognition as fallback.
function initVoice() {
  const btn = $("talkButton");
  if (backend.gemini) return initAiVoice(btn);
  return initBrowserVoice(btn);
}

function heard(text, languages) {
  $("heard").textContent = text;
  pipeReset();
  pipeSet("ears", "done");
  if (Array.isArray(languages) && languages.length > 0) {
    $("voiceStatus").textContent = `Heard in ${langNames(languages)}.`;
  }
  handleQuery(text, true);
}

function initAiVoice(btn) {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    return initBrowserVoice(btn);
  }
  const mime =
    ["audio/mp4", "audio/webm"].find(
      (t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)
    ) || "";
  let recorder = null;
  let chunks = [];
  let stream = null;

  const start = async (e) => {
    e.preventDefault();
    try {
      chunks = [];
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = upload;
      recorder.start();
      btn.classList.add("listening");
      setAvatar("listening", "Listening… speak now, then release.");
      $("voiceStatus").textContent = "Listening… speak now, then release.";
    } catch {
      $("voiceStatus").textContent =
        "Microphone blocked. Allow the microphone or type your question instead.";
    }
  };
  const upload = async () => {
    btn.classList.remove("listening");
    $("voiceStatus").textContent = "Understanding your speech…";
    try {
      const blob = new Blob(chunks, { type: mime || "audio/webm" });
      const form = new FormData();
      form.append("audio", blob, mime.includes("mp4") ? "hear.m4a" : "hear.webm");
      const r = await fetch("/api/hear", { method: "POST", body: form });
      if (!r.ok) throw new Error("hear failed");
      const { text, languages } = await r.json();
      if (!text) throw new Error("empty transcript");
      $("voiceStatus").textContent = "Press and hold the button, speak your question, then release.";
      heard(text, languages);
    } catch {
      setAvatar("idle", "Ready. Ask me about voting.");
      $("voiceStatus").textContent =
        "Could not understand that. Try again, or type your question instead.";
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      recorder = null;
    }
  };
  const stop = (e) => {
    e.preventDefault();
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("pointerleave", stop);
}

function initBrowserVoice(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("voiceStatus").textContent =
      "Voice input is not supported in this browser. Type your question instead, or use the Read aloud button on any answer.";
    btn.disabled = true;
    return;
  }
  const rec = new SR();
  rec.lang = "en-NG";
  rec.interimResults = false;
  rec.onresult = (e) => heard(e.results[0][0].transcript);
  rec.onend = () => {
    btn.classList.remove("listening");
    $("voiceStatus").textContent = "Press and hold the button, speak your question, then release.";
  };
  rec.onerror = (e) => {
    setAvatar("idle", "Ready. Ask me about voting.");
    $("voiceStatus").textContent = `Microphone issue (${e.error}). You can type your question instead.`;
  };
  const start = (e) => {
    e.preventDefault();
    try {
      rec.start();
      btn.classList.add("listening");
      setAvatar("listening", "Listening… speak now.");
      $("voiceStatus").textContent = "Listening… speak now.";
    } catch {
      // already started; ignore
    }
  };
  const stop = (e) => {
    e.preventDefault();
    try {
      rec.stop();
    } catch {
      // already stopped; ignore
    }
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("pointerleave", stop);
}

// Camera: gesture recognition with hand-tracking fallback, plus teach capture
const HAND_LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const cam = {
  on: false,
  recognizer: null,
  landmarker: null,
  stream: null,
  raf: 0,
  steadyKey: null,
  steadySince: 0,
  firedFor: null,
};

const teach = { active: false, letter: null, frames: [] };

async function startCamera() {
  const status = $("poseStatus");
  const btn = $("cameraButton");
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "This browser cannot access the camera. Use the buttons below instead.";
    return;
  }
  btn.disabled = true;
  status.textContent = "Loading hand tracking… (needs internet the first time)";
  try {
    const vision = await import(MP_VISION_URL);
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM_URL);
    if (!cam.recognizer && !cam.landmarker) {
      try {
        cam.recognizer = await vision.GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MP_GESTURE_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
        });
      } catch {
        cam.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MP_HAND_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
        });
      }
    }
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 } },
    });
    const video = $("camVideo");
    video.srcObject = cam.stream;
    await video.play();
    const canvas = $("camCanvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    $("cameraView").hidden = false;
    cam.on = true;
    cam.steadyKey = null;
    cam.firedFor = null;
    btn.disabled = false;
    btn.textContent = "Stop camera";
    btn.setAttribute("aria-expanded", "true");
    status.textContent = "Camera on. Hold up a pose and keep it steady.";
    cam.raf = requestAnimationFrame(predictFrame);
  } catch (err) {
    btn.disabled = false;
    status.textContent =
      "Could not start the camera (" +
      (err?.name === "NotAllowedError"
        ? "camera permission denied"
        : "network or camera issue") +
      "). Use the buttons below instead.";
  }
}

function stopCamera() {
  cam.on = false;
  cancelAnimationFrame(cam.raf);
  cam.stream?.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  $("camVideo").srcObject = null;
  $("cameraView").hidden = true;
  if (teach.active) {
    teach.active = false;
    teach.frames = [];
    $("teachStatus").textContent = "Teaching stopped — camera is off.";
  }
  const btn = $("cameraButton");
  btn.textContent = "Start camera";
  btn.setAttribute("aria-expanded", "false");
  $("poseStatus").textContent = "Camera is off.";
}

function captureTeachFrame(lm) {
  teach.frames.push(lm.map((p) => ({ x: p.x, y: p.y })));
  $("teachStatus").textContent =
    `Learning "${teach.letter}"… hold steady (${teach.frames.length}/${TEACH_FRAMES}).`;
  if (teach.frames.length < TEACH_FRAMES) return;
  const avg = averageShapes(teach.frames);
  teach.active = false;
  teach.frames = [];
  if (!avg) {
    $("teachStatus").textContent = "That capture was unclear — try again, holding steady.";
    return;
  }
  const lib = loadLibrary();
  lib[teach.letter] = {
    letter: teach.letter,
    landmarks: avg,
    provenance: "team-recorded",
    recordedAt: new Date().toISOString(),
  };
  saveLibrary(lib);
  renderLibraryStatus();
  $("teachStatus").textContent = `Learned "${teach.letter}".`;
  addNotice(`Wazobia learned the hand shape "${teach.letter}" (team-recorded, pending signer review).`);
}

async function predictFrame() {
  if (!cam.on) return;
  const video = $("camVideo");
  const status = $("poseStatus");
  try {
    let lm = null;
    let gestureName = null;
    if (cam.recognizer) {
      const res = cam.recognizer.recognizeForVideo(video, performance.now());
      lm = res.landmarks?.[0] || null;
      const top = res.gestures?.[0]?.[0];
      if (top && top.score >= GESTURE_MIN_SCORE) gestureName = top.categoryName;
    } else {
      const res = cam.landmarker.detectForVideo(video, performance.now());
      lm = res.landmarks?.[0] || null;
    }
    if (!lm) {
      if (teach.active) {
        teach.active = false;
        teach.frames = [];
        $("teachStatus").textContent = "Hand lost — try teaching again.";
      }
      cam.steadyKey = null;
      cam.firedFor = null;
      status.textContent = "No hand seen. Hold your hand up to the camera.";
    } else {
      drawHand($("camCanvas"), lm);
      if (teach.active) {
        captureTeachFrame(lm);
      } else {
        const pose = (gestureName && gestureToPose(gestureName)) || classifyPose(lm);
        if (!pose) {
          cam.steadyKey = null;
          status.textContent = gestureName
            ? `See: ${gestureName} — not assigned yet.`
            : "See: unclear hand — hold steady.";
        } else if (pose.faqId !== cam.steadyKey) {
          cam.steadyKey = pose.faqId;
          cam.steadySince = performance.now();
          status.textContent = `See: ${pose.label}. Hold steady…`;
        } else if (
          performance.now() - cam.steadySince >= POSE_HOLD_MS &&
          cam.firedFor !== pose.faqId
        ) {
          cam.firedFor = pose.faqId;
          status.textContent = `Got it: ${pose.label}.`;
          askFaq(pose.faqId);
        }
      }
    }
  } catch {
    status.textContent = "Hand tracking stumbled. Try stopping and starting the camera.";
    stopCamera();
    return;
  }
  cam.raf = requestAnimationFrame(predictFrame);
}

$("cameraButton").addEventListener("click", () => {
  if (cam.on) stopCamera();
  else startCamera();
});

// Teach-mode wiring
function initTeach() {
  const sel = $("teachLetter");
  sel.innerHTML = [...SUPPORTED_CHARS]
    .map((ch) => `<option value="${ch}">${ch}</option>`)
    .join("");
  $("teachButton").addEventListener("click", () => {
    if (!cam.on) {
      $("teachStatus").textContent = "Start the camera first, then teach.";
      return;
    }
    teach.active = true;
    teach.letter = sel.value;
    teach.frames = [];
    $("teachStatus").textContent = `Learning "${teach.letter}"… hold the sign steady.`;
  });
  $("exportShapes").addEventListener("click", () => {
    const lib = loadLibrary();
    const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wazobia-handshapes.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  renderLibraryStatus();
}

fetch("data/faq.json")
  .then((r) => {
    if (!r.ok) throw new Error("corpus failed to load");
    return r.json();
  })
  .then((data) => {
    corpus = data;
    index = buildIndex(corpus.faqs);
    applySettings();
    initTeach();
  })
  .catch(() => {
    addNotice("Sorry, the knowledge failed to load. Check your connection and reload.");
  });

// Ask the server which AI engines have keys, then choose the voice path.
// Runs independently: if the server is unreachable, browser fallbacks apply.
fetch("/api/status")
  .then((r) => (r.ok ? r.json() : null))
  .then((s) => {
    if (s) Object.assign(backend, s);
    reportAiStatus();
    initVoice();
  })
  .catch(() => {
    reportAiStatus();
    initVoice();
  });

function reportAiStatus() {
  const el = $("aiStatus");
  if (!el) return;
  const g = backend.gemini;
  const v = backend.spitch;
  const text = g && v ? "AI online" : g ? "Answers AI · basic voice" : v ? "Voice AI · basic answers" : "Offline mode";
  $("aiStatusText").textContent = text;
  el.classList.toggle("on", !!(g || v));
  el.classList.toggle("off", !(g || v));
}

// Realistic 3D avatar. The HTML defaults to canvas-visible/SVG-hidden, so the
// 2D figure can never flash on any paint — it returns only if 3D fails.
initAvatar3D($("avatarCanvas"), {
  modelUrl: "models/avatar.glb?v=8",
  onError: (msg) => addNotice(`${msg} — using the 2D figure instead.`),
}).then((ctrl) => {
  if (!ctrl) {
    $("avatarCanvas").hidden = true;
    $("avatarSvg").hidden = false;
    setAvatar("idle", "Ready. Ask me about voting.");
    return;
  }
  avatar3d = ctrl;
  $("avatarCanvas").classList.add("ready");
  setAvatar("idle", "Ready. Ask me about voting.");
  if (ctrl.report) console.debug("3D arms report:", ctrl.report);
});


