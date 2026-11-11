# Wazobia web app — Track 3 prototype

Accessible voter-information assistant for the **AI4Elections Hackathon, Track 3:
Inclusive and Multilingual Civic Tech** (problem statements 3A + 3C).

## Run it

```sh
cd web
npm start
```

Then open **http://localhost:8787** in a browser. No build step, no API keys,
no database. Node 22.12+ required (check with `node --version`).

```sh
npm test   # retrieval tests + pose-classifier tests
```

## What works in this build

- **Type a question** in English or Pidgin. Answers come only from the approved
  FAQ corpus (`data/faq.json`, 20 questions) with a citation per answer. If no
  FAQ matches with enough evidence, the app says it does not know instead of
  guessing. This is how we meet the track's zero-hallucination rule.
- **Speak mode**: hold-to-talk voice input (browser speech recognition) and a
  "Read this answer aloud" button on every answer, for blind and low-vision
  users. Falls back gracefully where the browser has no speech support.
- **Sign mode**: real camera hand tracking (MediaPipe, on-device). Hold a pose
  steady for about a second — fist, or 1–5 fingers — and the matching voter
  answer appears with its citation. A hand skeleton draws over your video so
  you can see what it sees. Works with no Python, Docker, or downloads; needs
  internet once to fetch the tracking model, plus a camera. These are pose
  shortcuts, honestly labelled — not full sign language yet.
- **Display access**: language selector (EN + Pidgin now; Hausa/Yoruba/Igbo
  slots reserved pending native-speaker review), high-contrast mode, large-text
  mode, skip link, landmarks, screen-reader live answer region, keyboard
  operable, `prefers-reduced-motion` respected.
- **Low bandwidth**: one HTML page plus small JS/CSS/JSON, no frameworks, no
  tracking. Only the camera mode needs a network fetch (the hand model).

## Honest limits of this build

- Answers are **team drafts, not verified against official INEC publications**.
  They are deliberately dateless and procedural. Official review is required
  before anyone relies on them.
- Hausa, Yoruba, and Igbo questions/answers are **not shipped yet**; the UI
  falls back to English and says so. Native-speaker translation + sign-off is
  part of the plan, per the track brief.
- Camera mode needs a camera, a supporting browser (Chrome/Edge), and internet
  for the first load. Every other mode works without it.
- Voice input needs a browser with speech recognition (Chrome/Edge) and a
  microphone; everything else works without it.
