# Wazobia

Accessible voter-information assistant for Nigeria's elections — ask in
English or Pidgin by text, by voice, or with hand poses on camera.

Built for the **AI4Elections Hackathon, Track 3: Inclusive and Multilingual
Civic Technology**. *Wazobia* means "come" in Yoruba, Hausa, and Igbo: every
voter is invited in.

## Layout

- `web/` — the voter-facing web app. Text Q&A, voice mode, and camera
  hand-pose shortcuts over an approved FAQ corpus. See `web/README.md`.

## Data & credits

- Voter FAQ questions: AI4Elections Hackathon synthetic starter pack (English +
  Pidgin verified; answers are team drafts pending official review).
- Hand tracking: MediaPipe Tasks Vision (Apache 2.0), loaded from CDN at
  runtime with graceful fallback when offline.
- NSL sign-recognition note: we evaluated the MIT-licensed Sign-to-Speech NSL
  project, but its trained weights are currently undownloadable (the upstream
  repo exceeded its Git LFS budget), so this build uses on-device hand-pose
  shortcuts instead. Full NSL recognition remains on the roadmap once weights
  or equivalent data access is available.
- License: MIT (see `LICENSE`).

## Status

Working prototype in progress. Runs today: text Q&A (local retrieval, or
Gemini AI answering when a key is set), voice in/out (browser, or Spitch AI
voices in 5 languages when a key is set), and camera hand-pose shortcuts.
Next: NSL sign classifier trained on public data, Hausa/Yoruba/Igbo answer
translations with native-speaker sign-off, signer-recorded answer videos,
and submission docs (see `web/README.md`).
