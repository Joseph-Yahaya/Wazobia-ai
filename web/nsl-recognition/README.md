# NSL Recognition Prototype

This folder is reserved for a separate prototype that recognizes at least five
static Nigerian Sign Language (NSL) alphabet letters from the live camera.

The current Wazobia camera, FAQ gestures, MediaPipe setup, pose classifier, and
fingerspelling features are outside this module's scope. This README documents a
proposed workflow only; recognition is not implemented here yet.

## Milestone scope and acceptance target

The minimum acceptance target is **at least five NSL static alphabet letters
successfully tested through the live camera**. Training or offline evaluation
alone does not meet this target.

The prototype should show a letter only when its prediction is sufficiently
confident and stable. It should be able to report an unclear or out-of-scope
handshape rather than always choosing one of the five letters.

This milestone does not cover moving signs, sentence translation, or general
NSL recognition.

## Proposed workflow

1. **Choose the letters.** Review dataset sample counts and example images, then
   confirm the candidate signs with an NSL signer. Prefer signs with enough
   examples and visibly distinct handshapes.
2. **Extract landmarks.** Use MediaPipe Hand Landmarker in Python to process
   labeled dataset images. Match each detected hand to its YOLO annotation and
   record the class label, signer or source information when available, and
   21 hand landmarks. Keep an extraction report for missing or ambiguous hands.
3. **Prepare features.** Normalize landmark coordinates with a documented,
   repeatable transform. Apply exactly the same transform during training and
   browser inference. Keep examples grouped by signer or recording session.
4. **Train and evaluate.** Start with a small landmark classifier, such as a
   scikit-learn Random Forest. Evaluate on held-out signers or sessions and
   report per-letter precision, recall, F1, a confusion matrix, and uncertain
   predictions.
5. **Export for the browser.** Export a fitted classifier to ONNX and verify
   that its predictions match the Python model on a held-out sample.
6. **Integrate separately.** Add an explicit NSL-letter mode to the camera UI.
   In that mode, send MediaPipe landmarks to the classifier and display stable
   predictions. Keep the existing FAQ-pose branch unchanged; NSL predictions
   must not trigger FAQ answers.
7. **Test through the live camera.** Verify that at least five selected static
   letters meet the acceptance target in Wazobia's live camera flow, including
   signers or recording conditions not used during training where possible.

## Suggested future layout

```text
nsl-recognition/
├── README.md
├── scripts/
│   ├── extract_landmarks.py
│   ├── train_classifier.py
│   └── export_onnx.py
├── web/
│   └── nsl-classifier.mjs
└── artifacts/
    ├── nsl_letters_v1.onnx
    ├── labels.json
    └── model_info.json
```

This is a planning outline, not a list of files that already exist. Do not put
the raw dataset, extracted training records, or generated model artifacts in
this folder until their handling and deployment have been decided. The Wazobia
server serves static files from the project root.

## Data and evaluation notes

- The published dataset contains labeled images and YOLO bounding-box
  annotations, not precomputed MediaPipe landmarks.
- Keep the official train, validation, and test partitions where possible.
  Check whether signers or recording sessions overlap between partitions before
  using them as independent evaluation sets.
- Do not split near-duplicate frames from one recording across training and
  test data.
- Track extraction failures and avoid assigning uncertain detections to a
  letter.
- Include out-of-scope examples or a confidence-based reject option so the
  classifier is not forced to produce one of the five letters.
- Confirm the dataset's license and attribution requirements before
  redistributing images or derived records.

## Current status

Planning only. This module does not currently contain a landmark extractor,
training code, classifier, model, or camera integration.
