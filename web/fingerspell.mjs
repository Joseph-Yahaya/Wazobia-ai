// Fingerspelling engine: letter timelines, teach-mode shape library, validation.
// Pure logic — no DOM, no camera. Runs in the browser and in Node tests.
//
// Provenance rule: shapes this app performs come ONLY from the shape library,
// and every library entry carries a provenance flag. Nothing here invents signs:
// untaught letters are reported as missing, never guessed.

// A-Y without J/Z (motion-based in fingerspelling) plus 1-9 (no 0).
// Matches the NSL alphanumeric dataset's 33 static classes.
export const SUPPORTED_CHARS = "ABCDEFGHIKLMNOPQRSTUVWXY123456789";

// One short, spellable key term per FAQ. The avatar fingerspells this term
// while the full answer shows as captions plus voice.
export const SIGN_TERMS = {
  "FAQ-001": "VOTE",
  "FAQ-002": "ID",
  "FAQ-003": "PVC",
  "FAQ-004": "PVC",
  "FAQ-005": "PVC",
  "FAQ-006": "TIME",
  "FAQ-007": "UNIT",
  "FAQ-008": "BALLOT",
  "FAQ-009": "HELP",
  "FAQ-010": "HELP",
  "FAQ-011": "RESULT",
  "FAQ-012": "RESULT",
  "FAQ-013": "REPORT",
  "FAQ-014": "SECRET",
  "FAQ-015": "FAKE",
  "FAQ-016": "INEC",
  "FAQ-017": "WATCH",
  "FAQ-018": "QUEUE",
  "FAQ-019": "MOVE",
  "FAQ-020": "STATE",
};

export function termFor(faqId) {
  return SIGN_TERMS[faqId] || null;
}

export function normalizeTerm(term) {
  return String(term || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function unsupportedChars(term) {
  const seen = [];
  for (const ch of normalizeTerm(term)) {
    if (!SUPPORTED_CHARS.includes(ch) && !seen.includes(ch)) seen.push(ch);
  }
  return seen;
}

export function spellable(term) {
  const t = normalizeTerm(term);
  return t.length > 0 && unsupportedChars(t).length === 0;
}

// Timeline of { letter, index, startMs, endMs } with a short gap between holds.
export function buildTimeline(term, holdMs = 800, gapMs = 150) {
  const t = normalizeTerm(term);
  if (!t) return [];
  const bad = unsupportedChars(t);
  if (bad.length > 0) {
    throw new Error(`Unspellable characters: ${bad.join(", ")}`);
  }
  return [...t].map((letter, index) => ({
    letter,
    index,
    startMs: index * (holdMs + gapMs),
    endMs: index * (holdMs + gapMs) + holdMs,
  }));
}

export function isLandmarks(lm) {
  return (
    Array.isArray(lm) &&
    lm.length === 21 &&
    lm.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  );
}

// Average several captured frames into one stable shape. Returns null unless
// every frame is a complete 21-point hand.
export function averageShapes(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  if (!frames.every(isLandmarks)) return null;
  return Array.from({ length: 21 }, (_, i) => {
    let x = 0;
    let y = 0;
    for (const f of frames) {
      x += f[i].x;
      y += f[i].y;
    }
    const round = (n) => Math.round((n / frames.length) * 10000) / 10000;
    return { x: round(x), y: round(y) };
  });
}

// A library entry is { letter, landmarks, provenance, recordedAt }.
export function validateEntry(entry) {
  if (!entry || typeof entry !== "object") return { ok: false, error: "not an object" };
  if (typeof entry.letter !== "string" || entry.letter.length !== 1) {
    return { ok: false, error: "letter must be one character" };
  }
  if (!SUPPORTED_CHARS.includes(entry.letter.toUpperCase())) {
    return { ok: false, error: `unsupported letter: ${entry.letter}` };
  }
  if (!isLandmarks(entry.landmarks)) return { ok: false, error: "bad landmarks" };
  if (typeof entry.provenance !== "string" || !entry.provenance) {
    return { ok: false, error: "missing provenance" };
  }
  return { ok: true, error: null };
}

// Split a stored library into valid entries and per-letter errors.
export function validateLibrary(lib) {
  const entries = {};
  const errors = [];
  if (!lib || typeof lib !== "object") return { entries, errors };
  for (const [key, entry] of Object.entries(lib)) {
    const v = validateEntry(entry);
    if (v.ok) entries[key.toUpperCase()] = entry;
    else errors.push({ letter: key, error: v.error });
  }
  return { entries, errors };
}

// Unique letters of a term that have no valid library entry, in order.
export function missingLetters(term, lib) {
  const { entries } = validateLibrary(lib);
  const missing = [];
  for (const ch of normalizeTerm(term)) {
    if (!entries[ch] && !missing.includes(ch)) missing.push(ch);
  }
  return missing;
}
