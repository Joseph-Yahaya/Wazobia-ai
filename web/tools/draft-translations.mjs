// One-shot helper: draft Hausa/Yoruba/Igbo/Pidgin FAQ translations with Gemini.
// Run from web/:  node tools/draft-translations.mjs
// Writes data/faq.drafts.json. Every draft is flagged needsReview:true — a
// native speaker must sign off each string before it ships in faq.json.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnvFile, geminiAsk, pickModel, LANG_NAMES } from "../ai.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "data", "faq.drafts.json");
const LANGS = ["ha", "yo", "ig", "pcm"];

function getKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  return readFile(join(root, ".env"), "utf8")
    .then((t) => loadEnvFile(t).GEMINI_API_KEY || "")
    .catch(() => "");
}

function promptFor(lang, faqs) {
  const list = faqs
    .map((f) => `${f.id} | Q: ${f.q.en} | A: ${f.a_en}`)
    .join("\n");
  return (
    `Translate each voter-education FAQ below into ${LANG_NAMES[lang]}. ` +
    `Keep the meaning exact and the tone plain and official. ` +
    `For Yoruba, include proper tone marks. Do not add facts, dates, or advice. ` +
    `Reply with ONLY a JSON object mapping each id to {"q": "...", "a": "..."}, no other text.\n\n${list}`
  );
}

function parseJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
}

const key = await getKey();
if (!key) {
  console.error("Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}
const corpus = JSON.parse(await readFile(join(root, "data", "faq.json"), "utf8"));
let drafts = { meta: {}, langs: {} };
try {
  drafts = JSON.parse(await readFile(OUT, "utf8"));
} catch {
  // first run: start empty
}

for (const lang of LANGS) {
  if (drafts.langs[lang] && Object.keys(drafts.langs[lang]).length === corpus.faqs.length) {
    console.log(`${lang}: already complete, skipping`);
    continue;
  }
  console.log(`${lang}: drafting ${corpus.faqs.length} FAQs…`);
  const fileEnv = await readFile(join(root, ".env"), "utf8")
    .then(loadEnvFile)
    .catch(() => ({}));
  const text = await geminiAsk({
    key,
    prompt: promptFor(lang, corpus.faqs),
    maxTokens: 8000,
    model: pickModel(fileEnv),
  });
  const parsed = parseJson(text);
  drafts.langs[lang] = parsed;
  drafts.meta[lang] = {
    generatedAt: new Date().toISOString(),
    model: "gemini-2.5-flash",
    needsReview: true,
    count: Object.keys(parsed).length,
  };
  await writeFile(OUT, JSON.stringify(drafts, null, 2));
  console.log(`${lang}: saved ${Object.keys(parsed).length} drafts`);
}
console.log(`Done. Review file: data/faq.drafts.json`);
