// Shared retrieval core: runs in the browser (app.mjs) and in Node (tests).
// Pure retrieval over the approved FAQ corpus. Never generates text, so it
// cannot invent electoral rules or dates. Below-threshold queries get no
// answer instead of a guessed one.

const STOP = new Set(
  "the a an to of and or is are be been do does did my your our for with on in at it its this that these those i me we you they he she as by from so if then than too very can will would should could what when where which who whom how why what".split(
    " "
  )
);

export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

// Minimum evidence rule: at least two distinct query terms must appear in
// the matched question, plus a minimum cosine score. A single shared word
// like "election" ("Who won the election?") must never produce an answer.
const MIN_COSINE = 0.1;

export function buildIndex(faqs) {
  const docs = [];
  for (const faq of faqs) {
    for (const [lang, text] of Object.entries(faq.q)) {
      if (!text) continue;
      docs.push({ id: faq.id, lang, tokens: tokenize(text) });
    }
  }
  const df = new Map();
  for (const d of docs) {
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = new Map([...df].map(([t, c]) => [t, Math.log(1 + n / c)]));
  for (const d of docs) {
    const tf = termFreq(d.tokens);
    let norm = 0;
    for (const [t, c] of tf) {
      const w = c * (idf.get(t) ?? 0);
      norm += w * w;
    }
    d.weights = tf;
    d.norm = Math.sqrt(norm);
  }
  return { docs, idf };
}

export function ask(faqs, index, query, k = 3) {
  const qtokens = tokenize(query);
  // A single content word ("election", "PVC?") is never enough evidence to
  // answer a high-stakes civic question. Ask the user to say more instead.
  if (qtokens.length < 2) return { results: [], best: null };
  const qtf = termFreq(qtokens);
  let qnorm = 0;
  for (const [t, c] of qtf) {
    const w = c * (index.idf.get(t) ?? 0);
    qnorm += w * w;
  }
  qnorm = Math.sqrt(qnorm);

  const perFaq = new Map();
  for (const d of index.docs) {
    let dot = 0;
    let matched = 0;
    for (const [t, c] of qtf) {
      const dw = (d.weights.get(t) ?? 0) * (index.idf.get(t) ?? 0);
      if (dw > 0) {
        matched += 1;
        dot += c * (index.idf.get(t) ?? 0) * dw;
      }
    }
    const cosine = qnorm > 0 && d.norm > 0 ? dot / (qnorm * d.norm) : 0;
    if (matched < 2 || cosine < MIN_COSINE) continue;
    const prev = perFaq.get(d.id);
    const cand = { id: d.id, lang: d.lang, score: cosine, matched };
    if (!prev || cand.score > prev.score) perFaq.set(d.id, cand);
  }
  const results = [...perFaq.values()].sort((a, b) => b.score - a.score);
  const best = results[0] ?? null;
  return {
    results: results.slice(0, k).map((r) => ({
      faq: faqs.find((f) => f.id === r.id),
      ...r,
      score: Math.round(r.score * 100) / 100,
    })),
    best: best
      ? {
          faq: faqs.find((f) => f.id === best.id),
          ...best,
          score: Math.round(best.score * 100) / 100,
        }
      : null,
  };
}
