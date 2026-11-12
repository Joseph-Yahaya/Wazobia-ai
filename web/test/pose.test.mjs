import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPose, gestureToPose } from "../pose.mjs";

// Synthetic hand: wrist at bottom, joints positioned so extended fingers
// reach upward and curled fingers stay near the palm.
function hand({ thumb, index, middle, ring, pinky }) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9 }));
  const set = (base, tip, extended) => {
    lm[base] = { x: 0.5, y: 0.6 };
    lm[tip] = extended ? { x: 0.5, y: 0.2 } : { x: 0.5, y: 0.65 };
  };
  set(2, 4, thumb);
  set(6, 8, index);
  set(10, 12, middle);
  set(14, 16, ring);
  set(18, 20, pinky);
  return lm;
}

describe("pose classifier", () => {
  it("reads a fist as count 0 -> official info", () => {
    const p = classifyPose(
      hand({ thumb: false, index: false, middle: false, ring: false, pinky: false })
    );
    assert.equal(p.count, 0);
    assert.equal(p.faqId, "FAQ-016");
  });

  it("reads an open palm as count 5 -> fake-message help", () => {
    const p = classifyPose(
      hand({ thumb: true, index: true, middle: true, ring: true, pinky: true })
    );
    assert.equal(p.count, 5);
    assert.equal(p.faqId, "FAQ-015");
  });

  it("reads one finger as count 1 -> registration", () => {
    const p = classifyPose(
      hand({ thumb: false, index: true, middle: false, ring: false, pinky: false })
    );
    assert.equal(p.count, 1);
    assert.equal(p.faqId, "FAQ-001");
  });

  it("reads two fingers as count 2 -> PVC collection", () => {
    const p = classifyPose(
      hand({ thumb: false, index: true, middle: true, ring: false, pinky: false })
    );
    assert.equal(p.count, 2);
    assert.equal(p.faqId, "FAQ-003");
  });

  it("reads three fingers as count 3 -> polling unit", () => {
    const p = classifyPose(
      hand({ thumb: false, index: true, middle: true, ring: true, pinky: false })
    );
    assert.equal(p.count, 3);
    assert.equal(p.faqId, "FAQ-007");
  });

  it("reads four fingers as count 4 -> results", () => {
    const p = classifyPose(
      hand({ thumb: false, index: true, middle: true, ring: true, pinky: true })
    );
    assert.equal(p.count, 4);
    assert.equal(p.faqId, "FAQ-011");
  });

  it("rejects malformed landmark input", () => {
    assert.equal(classifyPose(null), null);
    assert.equal(classifyPose([]), null);
    assert.equal(classifyPose([{ x: 0, y: 0 }]), null);
  });
});

describe("gesture shortcuts", () => {
  it("maps matching canned gestures to intents", () => {
    assert.equal(gestureToPose("Closed_Fist").faqId, "FAQ-016");
    assert.equal(gestureToPose("Pointing_Up").faqId, "FAQ-001");
    assert.equal(gestureToPose("Victory").faqId, "FAQ-003");
    assert.equal(gestureToPose("Open_Palm").faqId, "FAQ-015");
  });

  it("leaves other gestures unassigned, never guessed", () => {
    assert.equal(gestureToPose("Thumb_Up"), null);
    assert.equal(gestureToPose("Thumb_Down"), null);
    assert.equal(gestureToPose("ILoveYou"), null);
    assert.equal(gestureToPose("None"), null);
    assert.equal(gestureToPose("Wave"), null);
    assert.equal(gestureToPose(null), null);
  });
});
