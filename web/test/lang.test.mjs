import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_LANGS,
  normalizeLanguages,
  dominantLang,
  extractJson,
  buildDetectPrompt,
  parseDetectResult,
  buildTranslatePrompt,
  buildHearPrompt,
  parseHearResult,
} from "../ai.mjs";

describe("language normalize", () => {
  it("keeps known codes in order, deduped", () => {
    assert.deepEqual(normalizeLanguages(["pcm", "en", "pcm", "xx"]), ["pcm", "en"]);
  });

  it("lowercases and tolerates non-arrays", () => {
    assert.deepEqual(normalizeLanguages(["YO", "ha"]), ["yo", "ha"]);
    assert.deepEqual(normalizeLanguages("yo"), []);
    assert.deepEqual(normalizeLanguages(null), []);
  });

  it("defaults dominant to English", () => {
    assert.equal(dominantLang(["ha", "en"]), "ha");
    assert.equal(dominantLang([]), "en");
    assert.equal(dominantLang(null), "en");
  });
});

describe("detect prompt + parse", () => {
  it("asks for dominant-first JSON over the five codes", () => {
    const p = buildDetectPrompt("test");
    assert.match(p, /"languages"/);
    for (const c of SUPPORTED_LANGS) assert.ok(p.includes(c));
    assert.match(p, /dominant first/i);
  });

  it("parses mix lists and empty unknowns", () => {
    assert.deepEqual(parseDetectResult('{"languages": ["pcm", "en"]}'), ["pcm", "en"]);
    assert.deepEqual(parseDetectResult('```json\n{"languages": []}\n```'), []);
    assert.deepEqual(parseDetectResult("garbage"), []);
  });
});

describe("hear parse", () => {
  it("asks for transcript plus languages", () => {
    const p = buildHearPrompt();
    assert.match(p, /"text"/);
    assert.match(p, /"languages"/);
    assert.match(p, /mixed/i);
  });

  it("parses transcripts and rejects malformed ones", () => {
    assert.deepEqual(parseHearResult('{"text": "hello", "languages": ["en"]}'), {
      text: "hello",
      languages: ["en"],
    });
    assert.deepEqual(parseHearResult('{"text": "", "languages": []}'), {
      text: "",
      languages: [],
    });
    assert.equal(parseHearResult("nope"), null);
    assert.equal(parseHearResult('{"languages": ["en"]}'), null);
  });
});

describe("translate prompt", () => {
  it("targets the language without inventing facts", () => {
    const p = buildTranslatePrompt("answer", "yo");
    assert.match(p, /Yoruba/);
    assert.match(p, /never add/i);
    assert.match(p, /answer/);
  });
});

describe("extractJson", () => {
  it("finds objects in fences and rejects garbage", () => {
    assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('prefix {"a": 1} suffix'), { a: 1 });
    assert.equal(extractJson("none"), null);
    assert.equal(extractJson(null), null);
  });
});
