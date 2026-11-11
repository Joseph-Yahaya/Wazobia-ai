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

Working prototype in progress: text + voice Q&A and camera pose shortcuts run
today. Hausa/Yoruba/Igbo translations, signer-recorded answer videos, and full
NSL recognition are next (see `web/README.md`).
