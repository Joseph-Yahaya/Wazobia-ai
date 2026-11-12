import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRig, poseScore } from "../avatar3d.mjs";

// Real node names from our avatar.glb (plus armature + meshes).
const OURS = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "LeftHandThumb1", "LeftHandIndex3",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "RightHandThumb1", "RightHandIndex3",
  "LeftUpLeg", "RightFoot", "Armature", "avaturn_body",
];

describe("classifyRig", () => {
  it("finds our avatar's core bones", () => {
    const r = classifyRig(OURS);
    assert.equal(r.head, "Head");
    assert.equal(r.neck, "Neck");
    assert.equal(r.hips, "Hips");
    assert.ok(/^Spine\d*$/.test(r.spine));
  });

  it("finds the right arm chain and excludes fingers", () => {
    const r = classifyRig(OURS);
    assert.equal(r.shoulderR, "RightShoulder");
    assert.equal(r.armR, "RightArm");
    assert.equal(r.foreArmR, "RightForeArm");
    assert.equal(r.handR, "RightHand");
  });

  it("never mistakes the armature or fingers for arm/hand", () => {
    const r = classifyRig(["Armature", "RightHandIndex3", "LeftHand"]);
    assert.equal(r.armR, null);
    assert.equal(r.handR, null);
  });

  it("handles suffix-style rigs and unknown rigs", () => {
    const r = classifyRig(["Head", "Shoulder_R", "Arm_R", "Hand_R"]);
    assert.equal(r.head, "Head");
    assert.equal(r.shoulderR, "Shoulder_R");
    assert.equal(r.armR, "Arm_R");
    assert.equal(r.handR, "Hand_R");
    assert.deepEqual(classifyRig([]), {
      head: null, neck: null, hips: null, spine: null,
      shoulderR: null, armR: null, foreArmR: null, handR: null, handL: null,
      shoulderL: null,
    });
    assert.equal(classifyRig(null).head, null);
  });

  it("finds the left hand and shoulder for pose scoring", () => {
    assert.equal(classifyRig(OURS).handL, "LeftHand");
    assert.equal(classifyRig(OURS).shoulderL, "LeftShoulder");
  });

  it("scores natural standing above crouches and raised hands", () => {
    assert.ok(poseScore(0.5, 1.0, 1.0) < poseScore(0.5, 0.6, 1.0));
    assert.ok(poseScore(0.4, 1.0, 1.0) < poseScore(0.9, 1.0, 1.0));
  });
});
