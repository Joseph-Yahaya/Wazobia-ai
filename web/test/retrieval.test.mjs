import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, ask } from "../retrieval.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(readFileSync(join(root, "data", "faq.json"), "utf8"));
const index = buildIndex(corpus.faqs);

const cases = [
  // [query, expected faq id]
  ["I no get PVC, I fit vote?", "FAQ-005"],
  ["How I go find my polling unit?", "FAQ-007"],
  ["What time do polls open and close?", "FAQ-006"],
  ["How I fit check say I don register to vote?", "FAQ-001"],
  ["Wetin I go do if my PVC loss or spoil?", "FAQ-004"],
  ["I fit take photo of my ballot paper?", "FAQ-008"],
  ["Is my vote secret?", "FAQ-014"],
  ["How can I tell if a viral election message is fake?", "FAQ-015"],
  ["Person fit help me vote if I no fit see or read?", "FAQ-010"],
  ["Who fit declare the official result?", "FAQ-012"],
  ["Wetin go happen if I dey queue when polling close?", "FAQ-018"],
  ["Can I transfer my registration to a new location?", "FAQ-019"],
  ["Where can I find official election information?", "FAQ-016"],
  ["How do I report vote buying or intimidation?", "FAQ-013"],
  ["Who is allowed to observe an election?", "FAQ-017"],
  ["Can I vote if I am outside my state?", "FAQ-020"],
  ["What support exists for voters with disabilities?", "FAQ-009"],
  ["How are results announced?", "FAQ-011"],
  ["What documents do I need to register?", "FAQ-002"],
  ["How do I collect my PVC?", "FAQ-003"],
];

describe("faq retrieval", () => {
  for (const [query, expected] of cases) {
    it(`matches "${query}" to ${expected}`, () => {
      const { best } = ask(corpus.faqs, index, query);
      assert.ok(best, `expected ${expected}, got no answer`);
      assert.equal(best.id, expected);
    });
  }

  const noAnswer = [
    "Who won the election?",
    "What is the weather in Lagos?",
    "Tell me a joke",
    "Party A rally gist",
    "election",
    "",
    "???",
  ];
  for (const query of noAnswer) {
    it(`refuses to answer "${query}"`, () => {
      const { best } = ask(corpus.faqs, index, query);
      assert.equal(best, null);
    });
  }

  it("answers come only from the approved corpus", () => {
    const { results } = ask(corpus.faqs, index, "PVC vote register", 5);
    for (const r of results) {
      assert.ok(corpus.faqs.includes(r.faq));
      assert.match(r.faq.id, /^FAQ-\d{3}$/);
    }
  });
});
