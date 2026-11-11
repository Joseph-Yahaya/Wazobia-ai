import { buildIndex, ask } from "./retrieval.mjs";
import { classifyPose } from "./pose.mjs";

const DON_T_KNOW =
  "I don't have a verified answer for that. Please check an official INEC channel or ask about registration, PVCs, voting day, results, or safety.";
const LANGS = ["en", "pcm", "ha", "yo", "ig"];
const LANG_NAMES = {
  en: "English",
  pcm: "Pidgin",
  ha: "Hausa",
  yo: "Yoruba",
  ig: "Igbo",
};
const MP_VISION_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/vision_bundle.mjs";
const MP_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/wasm";
const MP_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_HOLD_MS = 1200;

let corpus = null;
let index = null;
let lang = localStorage.getItem("wazobia-lang") || "en";
if (!LANGS.includes(lang)) lang = "en";

const $ = (id) => document.getElementById(id);

function questionText(faq) {
  return faq.q[lang] || faq.q.en;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function answerBlock(faq) {
  const translated = lang === "en";
  return (
    (translated ? "" : `<p class="badge">English draft — ${LANG_NAMES[lang]} translation pending review</p>`) +
    `<p>${escapeHtml(faq.a_en)}</p>` +
    `<p class="cite">Source: ${escapeHtml(faq.id)} — “${escapeHtml(questionText(faq))}”. ${escapeHtml(corpus.source_note)}</p>` +
    `<button type="button" data-speak="${escapeHtml(faq.id)}">Read this answer aloud</button>`
  );
}

function showAnswerForId(id) {
  const faq = corpus.faqs.find((f) => f.id === id);
  if (!faq) return;
  $("answer").innerHTML = answerBlock(faq);
  wireSpeakButtons();
}

function handleQuery(query) {
  query = query.trim();
  if (!query) {
    $("answer").innerHTML = `<p>${escapeHtml(DON_T_KNOW)}</p>`;
    return;
  }
  const { best } = ask(corpus.faqs, index, query);
  if (!best) {
    $("answer").innerHTML =
      `<p>${escapeHtml(DON_T_KNOW)}</p>` +
      `<p class="cite">No approved FAQ matched your question, so no answer was given. Try different words, or browse the approved questions below.</p>`;
    return;
  }
  showAnswerForId(best.faq.id);
}

function wireSpeakButtons() {
  document.querySelectorAll("[data-speak]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const faq = corpus.faqs.find((f) => f.id === btn.dataset.speak);
      speak(faq ? faq.a_en : "");
    });
  });
}

function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// Tabs
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      const active = t === tab;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", String(active));
      document.getElementById(t.getAttribute("aria-controls")).hidden = !active;
    });
  });
});

// Settings
function applySettings() {
  document.documentElement.dataset.contrast =
    localStorage.getItem("wazobia-contrast") === "high" ? "high" : "";
  document.documentElement.dataset.text =
    localStorage.getItem("wazobia-text") === "large" ? "large" : "";
  $("contrastToggle").setAttribute(
    "aria-pressed",
    String(document.documentElement.dataset.contrast === "high")
  );
  $("textToggle").setAttribute(
    "aria-pressed",
    String(document.documentElement.dataset.text === "large")
  );
  $("lang").value = lang;
}
$("contrastToggle").addEventListener("click", () => {
  localStorage.setItem(
    "wazobia-contrast",
    localStorage.getItem("wazobia-contrast") === "high" ? "" : "high"
  );
  applySettings();
});
$("textToggle").addEventListener("click", () => {
  localStorage.setItem(
    "wazobia-text",
    localStorage.getItem("wazobia-text") === "large" ? "" : "large"
  );
  applySettings();
});
$("lang").addEventListener("change", (e) => {
  lang = e.target.value;
  localStorage.setItem("wazobia-lang", lang);
  renderLists();
});

// Ask form
$("askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  handleQuery($("question").value);
});

// Voice input (progressive enhancement: needs a supporting browser + mic)
(function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("talkButton");
  if (!SR) {
    $("voiceStatus").textContent =
      "Voice input is not supported in this browser. Type your question instead, or use the Read aloud button on any answer.";
    btn.disabled = true;
    return;
  }
  const rec = new SR();
  rec.lang = "en-NG";
  rec.interimResults = false;
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    $("heard").textContent = text;
    $("question").value = text;
    handleQuery(text);
  };
  rec.onend = () => {
    btn.classList.remove("listening");
    $("voiceStatus").textContent = "Press and hold the button, speak your question, then release.";
  };
  rec.onerror = (e) => {
    $("voiceStatus").textContent = `Microphone issue (${e.error}). You can type your question instead.`;
  };
  const start = (e) => {
    e.preventDefault();
    try {
      rec.start();
      btn.classList.add("listening");
      $("voiceStatus").textContent = "Listening… speak now.";
    } catch {
      // already started; ignore
    }
  };
  const stop = (e) => {
    e.preventDefault();
    try {
      rec.stop();
    } catch {
      // already stopped; ignore
    }
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("pointerleave", stop);
})();

// Camera hand-pose shortcuts (progressive enhancement: needs camera + CDN)
const HAND_LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const cam = {
  on: false,
  landmarker: null,
  stream: null,
  raf: 0,
  steadyCount: null,
  steadySince: 0,
  firedFor: null,
};

function drawHand(canvas, lm) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#0b5c2f";
  ctx.fillStyle = "#b35400";
  ctx.beginPath();
  for (const [a, b] of HAND_LINKS) {
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
  }
  ctx.stroke();
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function startCamera() {
  const status = $("poseStatus");
  const btn = $("cameraButton");
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "This browser cannot access the camera. Use the buttons below instead.";
    return;
  }
  btn.disabled = true;
  status.textContent = "Loading hand tracking… (needs internet the first time)";
  try {
    const vision = await import(MP_VISION_URL);
    if (!cam.landmarker) {
      const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM_URL);
      cam.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
      });
    }
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 } },
    });
    const video = $("camVideo");
    video.srcObject = cam.stream;
    await video.play();
    const canvas = $("camCanvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    $("cameraView").hidden = false;
    cam.on = true;
    cam.steadyCount = null;
    cam.firedFor = null;
    btn.disabled = false;
    btn.textContent = "Stop camera";
    btn.setAttribute("aria-expanded", "true");
    status.textContent = "Camera on. Hold up a pose and keep it steady.";
    cam.raf = requestAnimationFrame(predictFrame);
  } catch (err) {
    btn.disabled = false;
    status.textContent =
      "Could not start the camera (" +
      (err?.name === "NotAllowedError"
        ? "camera permission denied"
        : "network or camera issue") +
      "). Use the buttons below instead.";
  }
}

function stopCamera() {
  cam.on = false;
  cancelAnimationFrame(cam.raf);
  cam.stream?.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  $("camVideo").srcObject = null;
  $("cameraView").hidden = true;
  const btn = $("cameraButton");
  btn.textContent = "Start camera";
  btn.setAttribute("aria-expanded", "false");
  $("poseStatus").textContent = "Camera is off.";
}

async function predictFrame() {
  if (!cam.on) return;
  const video = $("camVideo");
  const status = $("poseStatus");
  try {
    const res = cam.landmarker.detectForVideo(video, performance.now());
    const lm = res.landmarks?.[0];
    if (!lm) {
      cam.steadyCount = null;
      cam.firedFor = null;
      status.textContent = "No hand seen. Hold your hand up to the camera.";
    } else {
      drawHand($("camCanvas"), lm);
      const pose = classifyPose(lm);
      if (!pose) {
        cam.steadyCount = null;
      } else if (pose.count !== cam.steadyCount) {
        cam.steadyCount = pose.count;
        cam.steadySince = performance.now();
        status.textContent = `See: ${pose.label}. Hold steady…`;
      } else if (
        performance.now() - cam.steadySince >= POSE_HOLD_MS &&
        cam.firedFor !== pose.count
      ) {
        cam.firedFor = pose.count;
        status.textContent = `Got it: ${pose.label}.`;
        showAnswerForId(pose.faqId);
      }
    }
  } catch {
    status.textContent = "Hand tracking stumbled. Try stopping and starting the camera.";
    stopCamera();
    return;
  }
  cam.raf = requestAnimationFrame(predictFrame);
}

$("cameraButton").addEventListener("click", () => {
  if (cam.on) stopCamera();
  else startCamera();
});

function renderLists() {
  const byTopic = new Map();
  for (const faq of corpus.faqs) {
    if (!byTopic.has(faq.topic)) byTopic.set(faq.topic, []);
    byTopic.get(faq.topic).push(faq);
  }
  $("signChips").innerHTML = [...byTopic]
    .map(
      ([topic, faqs]) =>
        `<div><p><strong>${escapeHtml(topic.replace(/_/g, " "))}</strong></p>` +
        faqs
          .map(
            (f) =>
              `<button type="button" data-faq="${f.id}">${escapeHtml(questionText(f))}</button> `
          )
          .join("") +
        `</div>`
    )
    .join("");
  $("faqList").innerHTML = corpus.faqs
    .map(
      (f) =>
        `<li><button type="button" data-faq="${f.id}">${escapeHtml(questionText(f))}</button></li>`
    )
    .join("");
  document.querySelectorAll("[data-faq]").forEach((btn) => {
    btn.addEventListener("click", () => showAnswerForId(btn.dataset.faq));
  });
}

fetch("data/faq.json")
  .then((r) => {
    if (!r.ok) throw new Error("corpus failed to load");
    return r.json();
  })
  .then((data) => {
    corpus = data;
    index = buildIndex(corpus.faqs);
    applySettings();
    renderLists();
  })
  .catch(() => {
    $("answer").innerHTML =
      "<p>Sorry, the question list failed to load. Check your connection and reload.</p>";
  });
