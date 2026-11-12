// Backend AI helpers: Gemini constrained answering + Spitch voice relay.
// Pure logic (prompt building, answer validation, voice map) is unit-tested.
// Network calls need API keys and are exercised by the user, not by tests.

export const VOICES = {
  en: "Lucy",
  pcm: "Justice",
  ha: "Amina",
  yo: "Sade",
  ig: "Ngozi",
};

export const LANG_NAMES = {
  en: "English",
  pcm: "Nigerian Pidgin",
  ha: "Hausa",
  yo: "Yoruba",
  ig: "Igbo",
};

export const SUPPORTED_LANGS = ["en", "pcm", "ha", "yo", "ig"];

// Detection reports a MIX (dominant first), never a forced single label.
// Unknown codes are dropped; unknown input means "unsure", not English.
export function normalizeLanguages(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of list) {
    const code = String(item || "").trim().toLowerCase();
    if (SUPPORTED_LANGS.includes(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export function dominantLang(languages) {
  const [first] = normalizeLanguages(languages);
  return first || "en";
}

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

// Model override chain: file .env first, then process env, then default.
// Lets us switch models without a code change when Google retires one.
export function pickModel(extra = {}) {
  return extra.GEMINI_MODEL || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function loadEnvFile(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// The safety contract lives in this prompt: the model may only answer from
// the passages, must cite exactly one FAQ id, and must refuse otherwise.
export function buildRagPrompt(question, lang, passages) {
  const langName = LANG_NAMES[lang] || LANG_NAMES.en;
  const listed = passages
    .map((p) => `[${p.id}] Q: ${p.question}\n[${p.id}] A: ${p.answer}`)
    .join("\n\n");
  return (
    `You are Wazobia, a nonpartisan Nigerian voter-information assistant. ` +
    `Answer the user's question using ONLY the approved passages below. ` +
    `Rules:\n` +
    `1. If the passages answer the question, reply in ${langName} in at most 3 short sentences, then add the passage id (like FAQ-003) at the end.\n` +
    `2. If the passages do not answer it, reply with exactly: NO_VERIFIED_ANSWER\n` +
    `3. Never invent dates, procedures, figures, or sources. Never mention political parties or candidates.\n\n` +
    `Approved passages:\n${listed}\n\nUser question: ${question}`
  );
}

export function parseFaqId(text) {
  const m = /FAQ-\d{3}/.exec(text || "");
  return m ? m[0] : null;
}

// Trust nothing the model says: the cited id must exist in our corpus, and
// the served answer is always OUR stored text for that id — never model text.
export function validateAiAnswer(faqs, modelText) {
  if (!modelText || modelText.includes("NO_VERIFIED_ANSWER")) return null;
  const id = parseFaqId(modelText);
  if (!id) return null;
  return faqs.find((f) => f.id === id) || null;
}

// Pull a JSON object out of model output (fences and chatter tolerated).
export function extractJson(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

export function buildDetectPrompt(text) {
  return (
    `Identify every language in this user message. Reply with ONLY this JSON, no other text: ` +
    `{"languages": ["<dominant first>", "<others...>"]}. ` +
    `Allowed codes: en (English), pcm (Nigerian Pidgin), ha (Hausa), yo (Yoruba), ig (Igbo). ` +
    `Mixed messages list each language present, most-used first. ` +
    `If unsure, reply {"languages": []}.\n\nMessage: ${text}`
  );
}

export function parseDetectResult(raw) {
  const obj = extractJson(raw);
  return normalizeLanguages(obj && obj.languages);
}

export function buildTranslatePrompt(answer, lang) {
  const langName = LANG_NAMES[lang] || LANG_NAMES.en;
  return (
    `Translate this voter-information answer into ${langName}. ` +
    `Rules: translate ONLY — never add, remove, or change facts, dates, procedures, or advice. ` +
    `Reply with the translation only, no quotes, no explanation.\n\nAnswer: ${answer}`
  );
}

export function buildHearPrompt() {
  return (
    `Transcribe this audio faithfully, including mixed languages in one sentence. ` +
    `Reply with ONLY this JSON, no other text: {"text": "<transcript>", "languages": ["<dominant first>"]}. ` +
    `Allowed codes: en, pcm, ha, yo, ig. If there is no speech, reply {"text": "", "languages": []}.`
  );
}

export function parseHearResult(raw) {
  const obj = extractJson(raw);
  if (!obj || typeof obj.text !== "string") return null;
  return { text: obj.text, languages: normalizeLanguages(obj.languages) };
}

async function postJson(url, body, headers = {}, timeoutMs = 25000) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json();
}

export async function geminiGenerate({ key, parts, maxTokens = 300, model = pickModel() }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
    encodeURIComponent(key);
  const data = await postJson(url, {
    contents: [{ parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
  });
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  if (!text) throw new Error("empty model response");
  return text;
}

export async function geminiAsk({ key, prompt, maxTokens = 300, model = pickModel() }) {
  return geminiGenerate({ key, parts: [{ text: prompt }], maxTokens, model });
}

export async function geminiDetect({ key, text, model = pickModel() }) {
  const raw = await geminiGenerate({
    key,
    parts: [{ text: buildDetectPrompt(text) }],
    maxTokens: 80,
    model,
  });
  return parseDetectResult(raw);
}

export async function geminiTranslate({ key, text, lang, model = pickModel() }) {
  const raw = await geminiGenerate({
    key,
    parts: [{ text: buildTranslatePrompt(text, lang) }],
    maxTokens: 400,
    model,
  });
  return raw.trim();
}

export async function geminiHear({ key, audioBase64, mimeType, model = pickModel() }) {
  return geminiGenerate({
    key,
    parts: [{ inlineData: { mimeType, data: audioBase64 } }, { text: buildHearPrompt() }],
    maxTokens: 500,
    model,
  });
}

export async function spitchSpeak({ key, text, lang }) {
  const { default: Spitch } = await import("spitch");
  const client = new Spitch({ apiKey: key });
  const res = await client.speech.generate({
    text,
    language: lang,
    voice: VOICES[lang] || VOICES.en,
  });
  return Buffer.from(await res.arrayBuffer());
}

