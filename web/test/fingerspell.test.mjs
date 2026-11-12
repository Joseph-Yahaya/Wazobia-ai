import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIGN_TERMS,
  termFor,
  normalizeTerm,
  unsupportedChars,
  spellable,
  buildTimeline,
  isLandmarks,
  averageShapes,
  validateEntry,
  validateLibrary,
  missingLetters,
} from "../fingerspell.mjs";

function landmarks(fill = 0.5) {
  return Array.from({ length: 21 }, () => ({ x: fill, y: fill }));
}

describe("sign terms", () => {
  it("covers every FAQ with a spellable term", () => {
    for (let n = 1; n <= 20; n++) {
      const id = `FAQ-${String(n).padStart(3, "0")}`;
      assert.ok(SIGN_TERMS[id], `missing term for ${id}`);
      assert.equal(spellable(SIGN_TERMS[id]), true, `${id} unspellable`);
    }
  });

  it("returns null for unknown FAQ ids", () => {
    assert.equal(termFor("FAQ-999"), null);
    assert.equal(termFor(null), null);
  });
});

describe("spellable", () => {
  it("accepts supported letters and digits, any case", () => {
    assert.equal(spellable("PVC"), true);
    assert.equal(spellable("inec"), true);
    assert.equal(spellable("2"), true);
  });

  it("rejects J, Z and 0 with names", () => {
    assert.equal(spellable("JAZZ"), false);
    assert.deepEqual(unsupportedChars("JAZZ"), ["J", "Z"]);
    assert.deepEqual(unsupportedChars("10"), ["0"]);
  });

  it("rejects empty input", () => {
    assert.equal(spellable(""), false);
    assert.equal(spellable(null), false);
  });

  it("normalizes away spaces and punctuation", () => {
    assert.equal(normalizeTerm(" p.v.c! "), "PVC");
  });
});

describe("buildTimeline", () => {
  it("lays out holds with gaps", () => {
    const t = buildTimeline("AB", 800, 150);
    assert.deepEqual(t, [
      { letter: "A", index: 0, startMs: 0, endMs: 800 },
      { letter: "B", index: 1, startMs: 950, endMs: 1750 },
    ]);
  });

  it("returns [] for empty terms and throws for unspellable ones", () => {
    assert.deepEqual(buildTimeline(""), []);
    assert.throws(() => buildTimeline("JAZZ"), /Unspellable/);
  });
});

describe("shape library", () => {
  const entry = (over = {}) => ({
    letter: "P",
    landmarks: landmarks(),
    provenance: "team-recorded",
    recordedAt: "2026-11-11",
    ...over,
  });

  it("validates landmark shapes", () => {
    assert.equal(isLandmarks(landmarks()), true);
    assert.equal(isLandmarks(landmarks().slice(0, 20)), false);
    assert.equal(isLandmarks(null), false);
  });

  it("averages frames into a stable shape", () => {
    const avg = averageShapes([landmarks(0.4), landmarks(0.6)]);
    assert.equal(avg.length, 21);
    assert.equal(avg[0].x, 0.5);
    assert.equal(averageShapes([]), null);
    assert.equal(averageShapes([landmarks(), null]), null);
  });

  it("accepts good entries and rejects bad ones with reasons", () => {
    assert.equal(validateEntry(entry()).ok, true);
    assert.equal(validateEntry(entry({ letter: "J" })).ok, false);
    assert.equal(validateEntry(entry({ landmarks: [] })).ok, false);
    assert.equal(validateEntry(entry({ provenance: "" })).ok, false);
    assert.equal(validateEntry(null).ok, false);
  });

  it("splits a library into entries and errors", () => {
    const { entries, errors } = validateLibrary({
      P: entry(),
      BAD: entry({ letter: "J" }),
    });
    assert.ok(entries.P);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].letter, "BAD");
  });

  it("reports missing letters in term order", () => {
    const lib = { P: entry({ letter: "P" }) };
    assert.deepEqual(missingLetters("PVC", lib), ["V", "C"]);
    assert.deepEqual(missingLetters("PVC", { P: entry({ letter: "P" }), V: entry({ letter: "V" }), C: entry({ letter: "C" }) }), []);
  });
});
