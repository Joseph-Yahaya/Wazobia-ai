import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadEnvFile,
  buildRagPrompt,
  parseFaqId,
  validateAiAnswer,
  pickModel,
  VOICES,
} from "../ai.mjs";

const faqs = [
  { id: "FAQ-001", q: { en: "registration?" }, a_en: "register answer" },
  { id: "FAQ-003", q: { en: "pvc?" }, a_en: "pvc answer" },
];

describe("ai gating", () => {
  it("prompt carries passages, question, and refusal rule", () => {
    const p = buildRagPrompt("where register?", "yo", [
      { id: "FAQ-001", question: "registration?", answer: "register answer" },
    ]);
    assert.match(p, /register answer/);
    assert.match(p, /where register\?/);
    assert.match(p, /NO_VERIFIED_ANSWER/);
    assert.match(p, /Yoruba/);
    assert.match(p, /Never invent/);
  });

  it("finds cited faq ids and nothing else", () => {
    assert.equal(parseFaqId("blah FAQ-003 ok"), "FAQ-003");
    assert.equal(parseFaqId("no citation here"), null);
    assert.equal(parseFaqId("NO_VERIFIED_ANSWER"), null);
  });

  it("accepts only ids that exist in the corpus", () => {
    assert.equal(validateAiAnswer(faqs, "answer FAQ-001").id, "FAQ-001");
    assert.equal(validateAiAnswer(faqs, "answer FAQ-999"), null);
    assert.equal(validateAiAnswer(faqs, "NO_VERIFIED_ANSWER"), null);
    assert.equal(validateAiAnswer(faqs, "free text no id"), null);
  });

  it("has a voice for every supported language", () => {
    for (const lang of ["en", "pcm", "ha", "yo", "ig"]) {
      assert.ok(VOICES[lang], `missing voice for ${lang}`);
    }
  });

  it("picks the model from file env, then process env, then default", () => {
    const saved = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    assert.equal(pickModel({}), "gemini-3.5-flash");
    process.env.GEMINI_MODEL = "env-model";
    assert.equal(pickModel({}), "env-model");
    assert.equal(pickModel({ GEMINI_MODEL: "file-model" }), "file-model");
    if (saved === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = saved;
  });

  it("parses env files without executing them", () => {
    const env = loadEnvFile('# comment\nGEMINI_API_KEY=abc123\nEMPTY=\nSPITCH_API_KEY="xyz"\n');
    assert.equal(env.GEMINI_API_KEY, "abc123");
    assert.equal(env.SPITCH_API_KEY, "xyz");
    assert.equal(env.EMPTY, "");
  });
});
