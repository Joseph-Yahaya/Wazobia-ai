import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lowerArms } from "../avatar3d.mjs";

// Minimal rig stand-ins: XYZ Euler rotation + hierarchy composition, matching
// three.js conventions (per-node Z, then Y, then X; ancestors root-first).
// Enough to prove the probe-then-descend algorithm converges.

class V3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

function rotAxis(p, ax, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (ax === "x") return new V3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  if (ax === "y") return new V3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  return new V3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
}

function applyEulerXYZ(v, e) {
  return rotAxis(rotAxis(rotAxis(v, "z", e.z), "y", e.y), "x", e.x);
}

class FakeNode {
  constructor(name, x, y, z) {
    this.name = name;
    this.rotation = { x: 0, y: 0, z: 0 };
    this.position = new V3(x, y, z);
    this.parent = null;
    this.children = [];
    this.world = new V3();
  }
  add(child) {
    child.parent = this;
    this.children.push(child);
    return this;
  }
  updateMatrixWorld() {
    let root = this;
    while (root.parent) root = root.parent;
    root._solve(new V3(0, 0, 0), []);
  }
  _solve(parentPos, parentRots) {
    let p = new V3(this.position.x, this.position.y, this.position.z);
    for (const e of parentRots) p = applyEulerXYZ(p, e);
    this.world = new V3(parentPos.x + p.x, parentPos.y + p.y, parentPos.z + p.z);
    const mine = [...parentRots, this.rotation];
    for (const c of this.children) c._solve(this.world, mine);
  }
  getWorldPosition(t) {
    t.x = this.world.x;
    t.y = this.world.y;
    t.z = this.world.z;
    return t;
  }
}

const fakeTHREE = { Vector3: V3 };

function rig(handOffset) {
  const root = new FakeNode("root", 0, 0, 0);
  const hips = new FakeNode("Hips", 0, 1.0, 0);
  const shL = new FakeNode("LeftShoulder", 0.25, 1.45, 0);
  const shR = new FakeNode("RightShoulder", -0.25, 1.45, 0);
  const handL = new FakeNode("LeftHand", ...handOffset);
  const handR = new FakeNode("RightHand", ...handOffset.map((n, i) => (i === 0 ? -n : n)));
  root.add(hips);
  root.add(shL);
  shL.add(handL);
  root.add(shR);
  shR.add(handR);
  root.updateMatrixWorld();
  return { root, hips, shL, shR, handL, handR };
}

function handY(hand) {
  return hand.getWorldPosition(new V3()).y;
}

describe("lowerArms", () => {
  it("lowers T-posed arms to the hips on both sides", () => {
    const r = rig([0.55, 0, 0]);
    assert.ok(handY(r.handL) > 1.4);
    lowerArms(fakeTHREE, r.root, {
      shoulderL: r.shL,
      shoulderR: r.shR,
      handL: r.handL,
      handR: r.handR,
      hips: r.hips,
    });
    r.root.updateMatrixWorld();
    assert.ok(handY(r.handL) <= 1.14, `left hand at ${handY(r.handL)}`);
    assert.ok(handY(r.handR) <= 1.14, `right hand at ${handY(r.handR)}`);
    assert.notEqual(r.shL.rotation.z, 0);
    assert.notEqual(r.shR.rotation.z, 0);
  });

  it("lowers past first target touch to fully hanging arms", () => {
    // Regression: stopping at the first touch of the target height leaves
    // arms held out wide. The descent must continue to the swing bottom.
    const r = rig([0.55, 0, 0]);
    lowerArms(fakeTHREE, r.root, {
      shoulderL: r.shL,
      shoulderR: r.shR,
      handL: r.handL,
      handR: r.handR,
      hips: r.hips,
    });
    r.root.updateMatrixWorld();
    // Swing bottom is shoulder height (1.45) minus arm length (0.55) = 0.90.
    assert.ok(handY(r.handL) <= 1.0, `left hand at ${handY(r.handL)}`);
    assert.ok(handY(r.handR) <= 1.0, `right hand at ${handY(r.handR)}`);
  });

  it("rotates the upper-arm bone when present, leaving shoulders alone", () => {
    const r = rig([0.55, 0, 0]);
    const armL = new FakeNode("LeftArm", 0, 0, 0);
    const armR = new FakeNode("RightArm", 0, 0, 0);
    r.shL.children.length = 0;
    r.shR.children.length = 0;
    r.shL.add(armL);
    armL.add(r.handL);
    r.shR.add(armR);
    armR.add(r.handR);
    const report = lowerArms(fakeTHREE, r.root, {
      shoulderL: r.shL,
      shoulderR: r.shR,
      armL,
      armR,
      handL: r.handL,
      handR: r.handR,
      hips: r.hips,
    });
    r.root.updateMatrixWorld();
    assert.deepEqual(report.pivots, ["arm", "arm"]);
    assert.equal(r.shL.rotation.z, 0);
    assert.equal(r.shR.rotation.z, 0);
    assert.notEqual(armL.rotation.z, 0);
    assert.notEqual(armR.rotation.z, 0);
    assert.ok(handY(r.handL) <= 1.0, `left hand at ${handY(r.handL)}`);
    assert.ok(handY(r.handR) <= 1.0, `right hand at ${handY(r.handR)}`);
  });

  it("leaves already-hanging arms alone", () => {
    const r = rig([0.05, -0.55, 0]);
    lowerArms(fakeTHREE, r.root, {
      shoulderL: r.shL,
      shoulderR: r.shR,
      handL: r.handL,
      handR: r.handR,
      hips: r.hips,
    });
    assert.equal(r.shL.rotation.z, 0);
    assert.equal(r.shR.rotation.z, 0);
  });

  it("tolerates missing joints without throwing", () => {
    const r = rig([0.55, 0, 0]);
    assert.doesNotThrow(() =>
      lowerArms(fakeTHREE, r.root, {
        shoulderL: null,
        shoulderR: r.shR,
        handL: r.handL,
        handR: r.handR,
        hips: r.hips,
      })
    );
  });
});
