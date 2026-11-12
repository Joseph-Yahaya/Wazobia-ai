// Pure hand-pose classifier over 21 MediaPipe hand landmarks.
// No camera, no model, no DOM here — runs in the browser and in Node tests.
// A finger counts as extended when its tip is clearly farther from the wrist
// than its middle joint. Counts 0-5 map to featured FAQ shortcuts.

const FINGERS = [
  { name: "thumb", base: 2, tip: 4, ratio: 1.1 },
  { name: "index", base: 6, tip: 8, ratio: 1.2 },
  { name: "middle", base: 10, tip: 12, ratio: 1.2 },
  { name: "ring", base: 14, tip: 16, ratio: 1.2 },
  { name: "pinky", base: 18, tip: 20, ratio: 1.2 },
];

export const POSE_FAQ = {
  0: "FAQ-016", // fist: where to find official information (help)
  1: "FAQ-001", // check registration
  2: "FAQ-003", // collect PVC
  3: "FAQ-007", // find polling unit
  4: "FAQ-011", // results announcements
  5: "FAQ-015", // spot fake messages
};

export const POSE_LABELS = {
  0: "Fist — official information",
  1: "1 finger — voter registration",
  2: "2 fingers — PVC collection",
  3: "3 fingers — find polling unit",
  4: "4 fingers — election results",
  5: "5 fingers — spot fake messages",
};

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function valid(lm) {
  return (
    Array.isArray(lm) &&
    lm.length === 21 &&
    lm.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  );
}

export function classifyPose(lm) {
  if (!valid(lm)) return null;
  const wrist = lm[0];
  const extended = FINGERS.map(
    (f) => dist(wrist, lm[f.tip]) > dist(wrist, lm[f.base]) * f.ratio
  );
  const count = extended.filter(Boolean).length;
  return { count, extended, faqId: POSE_FAQ[count], label: POSE_LABELS[count] };
}

// MediaPipe GestureRecognizer canned gestures that genuinely match our
// finger-count shortcuts. Other gestures (Thumb_Up, Thumb_Down, ILoveYou,
// None) stay unassigned: shown, never guessed.
export const GESTURE_COUNT = {
  Closed_Fist: 0,
  Pointing_Up: 1,
  Victory: 2,
  Open_Palm: 5,
};

export function gestureToPose(name) {
  if (typeof name !== "string") return null;
  const count = GESTURE_COUNT[name];
  if (count === undefined) return null;
  return { count, faqId: POSE_FAQ[count], label: POSE_LABELS[count] };
}
