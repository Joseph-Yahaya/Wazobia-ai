// Wazobia server: static app + AI API routes (keys stay server-side).
// Every AI route degrades gracefully when its key is missing.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, ask } from "./retrieval.mjs";
import {
  loadEnvFile,
  buildRagPrompt,
  validateAiAnswer,
  geminiAsk,
  geminiDetect,
  geminiTranslate,
  geminiHear,
  parseHearResult,
  dominantLang,
  pickModel,
  spitchSpeak,
  LANG_NAMES,
} from "./ai.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
};

const corpus = JSON.parse(await readFile(join(root, "data", "faq.json"), "utf8"));
const index = buildIndex(corpus.faqs);

let fileEnv = {};
try {
  fileEnv = loadEnvFile(await readFile(join(root, ".env"), "utf8"));
} catch {
  // no .env file: AI routes report unavailable, local modes keep working
}
const KEYS = {
  gemini: process.env.GEMINI_API_KEY || fileEnv.GEMINI_API_KEY || "",
  spitch: process.env.SPITCH_API_KEY || fileEnv.SPITCH_API_KEY || "",
};

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Minimal multipart parser for a single file field named "audio".
function parseAudioUpload(body, contentType) {
  const m = /boundary=(.+)$/.exec(contentType || "");
  if (!m) return null;
  const boundary = "--" + m[1].replace(/"/g, "");
  const start = body.indexOf(boundary);
  const headerEnd = body.indexOf("\r\n\r\n", start);
  const end = body.indexOf(boundary + "--", headerEnd);
  if (start < 0 || headerEnd < 0 || end < 0) return null;
  const header = body.slice(start, headerEnd).toString("latin1");
  const nameM = /filename="([^"]+)"/.exec(header);
  const data = body.slice(headerEnd + 4, end - 2);
  return { filename: nameM ? nameM[1] : "audio.webm", data };
}

async function handleAsk(payload) {
  const question = String(payload.question || "").trim();
  if (!question) return { status: 400, json: { error: "empty question" } };

  // Stage 1: local retrieval shortlist (meaning-independent, always runs).
  const { results } = ask(corpus.faqs, index, question, 3);

  // Stage 2: Gemini picks from the shortlist and detects languages in
  // parallel. No key or no shortlist means local behavior.
  if (KEYS.gemini && results.length > 0) {
    try {
      const passages = results.map((r) => ({
        id: r.faq.id,
        question: r.faq.q.en,
        answer: r.faq.a_en,
      }));
      const [modelText, languages] = await Promise.all([
        geminiAsk({
          key: KEYS.gemini,
          prompt: buildRagPrompt(question, "en", passages),
          model: pickModel(fileEnv),
        }),
        geminiDetect({ key: KEYS.gemini, text: question, model: pickModel(fileEnv) }).catch(() => []),
      ]);
      const faq = validateAiAnswer(corpus.faqs, modelText);
      if (!faq)
        return { status: 200, json: { mode: "ai", faqId: null, languages, answer: null, answerLang: "en" } };
      // Stage 3: translate the VERIFIED stored answer for non-English asks.
      // The fact stays ours; only the wording is AI-produced, and the UI
      // labels it as such.
      const target = dominantLang(languages);
      let answer = null;
      if (target !== "en") {
        try {
          answer = await geminiTranslate({
            key: KEYS.gemini,
            text: faq.a_en,
            lang: target,
            model: pickModel(fileEnv),
          });
        } catch {
          answer = null;
        }
      }
      return {
        status: 200,
        json: { mode: "ai", faqId: faq.id, languages, answer, answerLang: answer ? target : "en" },
      };
    } catch {
      // fall through to local result on any AI failure
    }
  }
  const best = results[0];
  return {
    status: 200,
    json: { mode: "local", faqId: best ? best.faq.id : null, languages: ["en"], answer: null, answerLang: "en" },
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");

    if (req.method === "GET" && url.pathname === "/api/status") {
      return send(res, 200, JSON.stringify({ gemini: !!KEYS.gemini, spitch: !!KEYS.spitch }));
    }

    if (req.method === "POST" && url.pathname === "/api/ask") {
      const body = await readBody(req, 64 * 1024);
      const out = await handleAsk(JSON.parse(body.toString("utf8")));
      return send(res, out.status, JSON.stringify(out.json));
    }

    if (req.method === "POST" && url.pathname === "/api/speak") {
      if (!KEYS.spitch) return send(res, 503, JSON.stringify({ error: "no-voice-key" }));
      const body = await readBody(req, 64 * 1024);
      const { text, lang } = JSON.parse(body.toString("utf8"));
      if (!text || String(text).length > 2000)
        return send(res, 400, JSON.stringify({ error: "bad text" }));
      const audio = await spitchSpeak({ key: KEYS.spitch, text: String(text), lang: LANG_NAMES[lang] ? lang : "en" });
      return send(res, 200, audio, "audio/wav");
    }

    if (req.method === "POST" && url.pathname === "/api/hear") {
      if (!KEYS.gemini) return send(res, 503, JSON.stringify({ error: "no-transcribe-key" }));
      const body = await readBody(req, 10 * 1024 * 1024);
      const up = parseAudioUpload(body, req.headers["content-type"]);
      if (!up) return send(res, 400, JSON.stringify({ error: "bad upload" }));
      const mimeType = /\.m4a$/i.test(up.filename) ? "audio/mp4" : "audio/webm";
      const raw = await geminiHear({
        key: KEYS.gemini,
        audioBase64: up.data.toString("base64"),
        mimeType,
        model: pickModel(fileEnv),
      });
      const parsed = parseHearResult(raw);
      if (!parsed) return send(res, 502, JSON.stringify({ error: "bad transcript" }));
      return send(res, 200, JSON.stringify(parsed));
    }

    if (req.method !== "GET") return send(res, 405, "method not allowed", "text/plain");
    if (url.pathname === "/.env") return send(res, 403, "forbidden", "text/plain");
    // NOTE: never path.normalize() a URL path on Windows — it turns "/" into
    // "\\" and breaks routing. Strip slashes and reject traversal instead.
    const raw = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (raw.includes("..") || raw.includes("\\"))
      return send(res, 403, "forbidden", "text/plain");
    const file = join(root, raw === "" ? "index.html" : raw);
    if (!file.startsWith(root)) return send(res, 403, "forbidden", "text/plain");
    const data = await readFile(file);
    const type = MIME[extname(file)] || "application/octet-stream";
    // Dev: never cache app files, so a plain refresh always shows the latest build.
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    return res.end(data);
  } catch (err) {
    if (!res.headersSent) send(res, err.message === "body too large" ? 413 : 500, JSON.stringify({ error: "server error" }));
  }
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(
    `Wazobia running at http://localhost:${PORT} ` +
      `(gemini:${KEYS.gemini ? "on" : "off"} spitch:${KEYS.spitch ? "on" : "off"})`
  )
);
