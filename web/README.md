# Wazobia web app — Track 3 prototype

Accessible voter-information assistant for the **AI4Elections Hackathon, Track 3:
Inclusive and Multilingual Civic Tech** (problem statements 3A + 3C).

## Run it

```sh
cd web
npm install   # once: installs the Spitch voice SDK
npm start
```

Then open **http://localhost:8787** in a browser. Node 22.12+ required
(check with `node --version`).

```sh
npm test   # retrieval + pose-classifier + AI-gating tests
```

## AI setup (optional, unlocks the AI engines)

Without keys the app still works fully offline (local retrieval, browser
voice, camera poses). With keys it upgrades to AI answering and
multilingual AI voices:

1. Copy `.env.example` to `.env` (never commit `.env`).
2. Get a free key from [Google AI Studio](https://aistudio.google.com/)
   → `GEMINI_API_KEY`. Enables the ears (transcribe + detect language,
   mixed input included), the brain (AI answering over the approved FAQs),
   and reply translation.
3. Get a key from your [Spitch dashboard](https://spitch.app/)
   → `SPITCH_API_KEY`. Enables AI speech in English, Pidgin, Hausa,
   Yoruba, and Igbo (voices: Lucy, Justice, Amina, Sade, Ngozi).
4. Restart `npm start`. The startup line reports `gemini:on/off spitch:on/off`.

There is no language selector: the agent detects the language of each
message and replies in kind.

Every answer carries a source badge — "Approved FAQ" or "AI answer from
approved FAQs" — so users always know who wrote what. AI answers are
constrained to cited corpus passages; anything uncited is refused.

## Deploy to Railway

1. Push `main` to GitHub (Railway redeploys on every push once connected).
2. In Railway: New Project → Deploy from GitHub repo → select this repo.
3. Service Settings → set **Root Directory** to `web` (the Node app lives there).
4. Variables tab → add `GEMINI_API_KEY`, `SPITCH_API_KEY`, and
   `GEMINI_MODEL=gemini-3.5-flash`. Never commit `.env`.
5. Deploy, then Settings → Networking → Generate Domain, and open the URL.
6. On the page: header dot should read "AI online". Ask a question to confirm.

The server binds `0.0.0.0` and reads `PORT` from the environment, so it runs
unchanged on Railway and locally.

## What works in this build

- **Agent first**: Wazobia is a realistic 3D avatar (three.js, local GLB) with
  visible states — breathing idle, lean-in listening, head-tilt thinking,
  nodding speech, performer sway while signing — plus a 2D figure as automatic
  fallback, a slim conversation thread, and one input bar for type/speak/sign. The 20 FAQs are purely the
  background verifier: answers are based on them, but they never appear as
  links in the UI.
- **Type a question** in English, Pidgin, Hausa, Yoruba, or Igbo, mixed or
  not. The language is detected per message. Answers come only from the approved
  FAQ corpus (`data/faq.json`, 20 questions) with a citation and source badge
  per answer. If no FAQ matches with enough evidence, the agent says it does
  not know instead of guessing. This is how we meet the track's
  zero-hallucination rule.
- **Speak mode**: hold-to-talk voice input (Gemini transcription with language
  detection when keyed, else browser speech recognition) and a "Read aloud"
  button on every answer, for blind and low-vision users.
- **Sign mode**: real camera hand tracking (MediaPipe GestureRecognizer,
  on-device, with hand-tracking fallback). Hold a pose steady for about a
  second — fist, pointing, victory, open palm, or 3–4 fingers — and the
  matching voter answer appears as a chat reply. A hand skeleton draws over
  your video so you can see what it sees. Unassigned gestures are shown, never
  guessed.
- **Teach my hands**: perform any of 33 letters/digits (A–Y except J/Z, 1–9)
  in front of the camera and the app records its shape into a local library
  (team-recorded, flagged for signer review). Every answer's "Show signs"
  button makes the avatar fingerspell its key term (e.g. "PVC") on the signing
  stage — only from taught shapes; untaught letters are named, never faked.
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
- Hausa, Yoruba, and Igbo answers are **AI translations of verified English
  answers**, labelled as such in the UI. Native-speaker translation + sign-off
  is part of the plan, per the track brief.
- Fingerspelling covers **key terms only**, from team-recorded shapes pending
  native-signer review — not sentence-level NSL. Full recognition (custom
  classifier on NSL data) and recorded signer videos are the sprint plan.
- The signing stage performs shapes from your browser's local library; use
  Export to back it up or share with a reviewer.
- Camera mode needs a camera, a supporting browser (Chrome/Edge), and internet
  for the first load. Every other mode works without it.
- Voice input needs a microphone; everything else works without it.
