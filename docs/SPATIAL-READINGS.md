# Spatial readings - OCR as part of Spatial Inspection (AROMS-332)

Proprietary & Confidential · Applied Materials. Status: **scoped, agreed
with the Product Owner 2026-10-16**; build order in §6. Patent pending:
perception internals stay out of outward material.

## 1. The principle

Spatial Inspection exists to confirm, without being asked, that the work
about to be done is right and that the work done is right: the part is
present, the right part, in the right place, the right way round; the label
is the right label, in the right language, in the right place; the reading
on the instrument is what the work instruction expects. Reading text is one
sense among those, not a separate product. So OCR enters as a **kind of
assertion** on the same step or tag, evaluated on the same captured frame,
and reported in the same verdict and evidence.

## 2. Assertions

A step (AR OMS) or a tag (Spatial Inspection) carries a list of assertions.
Each has a kind, an expectation, where to look, and what a miss means.

| Kind | Reads | Expectation | Example |
|---|---|---|---|
| `presence` | the trained appearance (quick shot / cone, as today) | match | the bracket is installed |
| `text-match` | printed or engraved text | expected text (exact / contains / any of; case and whitespace folded) | the label says WARNING - HOT SURFACE; the part is engraved PT76545; the Japanese label, not the English one |
| `text-value` | a number on an instrument display | expected value, unit, tolerance (± or range) | multimeter 80 Ω ±5 %; torque 12.0 N·m ±0.5; leak check ≤ 1.0e-9 mbar·l/s |
| `code` | a barcode / QR / Data Matrix | expected payload (exact / prefix / regex) | the Luna label's serial |
| `location` | where the read text sits in the frame against the trained reference | within tolerance of the trained region | the label is on the left door, not the right |

Fields: `{ kind, expected, unit?, min?, max?, match?: 'exact'|'contains'|'any-of'|'regex', region?, onFail: 'block'|'flag', source: 'author'|'import' }`.

For `text-value` the comparison always runs on `min` / `max` (either side
optional); the ME enters the expectation in whichever form the work
instruction uses and the app derives the bounds: "80 Ω ± 5 %" → 76 to 84,
"12.0 N·m ± 0.5" → 11.5 to 12.5, "≤ 1.0e-9" → max only, "≥ 20 psi" → min
only. The typed form is kept in `expected` for display, so a verdict reads
"79.6 Ω - within 80 Ω ±5 %". A new entry form later touches the authoring
field only, never the stored bounds or the operator side.
A step's verdict is the conjunction; each assertion keeps its own result in
the evidence. "Flag" records a miss and lets the step proceed; "block"
behaves like a failed validation today. Both are authored per assertion;
the default is `block` for readings and labels, which the ME may relax
(POCs run with `flag` where the floor asks).

## 3. Sources of truth

- **Labels, part numbers, codes**: trained in Author mode as the
  `languageCheck` tag is today (G12): point, read, correct the misread,
  confirm. The expected text and the read region become the assertion;
  one reference frame stays as the appearance fallback.
- **Readings**: typed by the ME on the step - value, unit, tolerance, and
  the instrument (multimeter · torque tool · leak checker · other) - in the
  Designer's step inspector and on the iOS step page. Later the import
  reads it from the iOMS work instruction when it can (§6, AROMS-341).

## 4. Operator side

- The reading comes from the camera, never from a keyboard: the operator
  frames the display or label, the app reads it on-device (Apple Vision text
  and barcode recognition), shows what it read on the frame, and the frame
  with the read overlaid is the evidence.
- Manual entry stays as an explicit fallback and is recorded as **typed,
  not read**, visible in the run record and the usage log, so a manager can
  tell a measured value from a remembered one.
- The verdict is said in words on the step ("Read 79.6 Ω - within 80 Ω ±5 %",
  "Read HOT SURFACE - expected WARNING HOT SURFACE") and a miss follows the
  assertion's `onFail`.

## 5. Where it runs

On the device (Vision framework), no image leaves the iPad for the read;
the result, the region and the evidence frame go to SIB as validation
evidence does today. Headsets and the XR kit use the same contract through
the iPad companion first; a native glasses client reads where its camera
API allows (AR Developer, FY27).

## 6. Build order (backlog)

| Key | Slice |
|---|---|
| AROMS-337 | Data model and authoring: `assertions` on `GuideStep` and `Tag`; Designer step inspector and iOS step page author `text-value` and `text-match` (value, unit, tolerance, match, onFail); server stores and compiles them; import and re-sync carry them; Guide Library shows "Reads: …" on the step |
| AROMS-338 | iOS reading capture: Vision text recognition on a framed display or label, numeric parse with unit, on-frame highlight, verdict in words, block / flag, evidence frame with the read, typed fallback marked as such; usage log and run record carry per-assertion results |
| AROMS-339 | Labels as assertions: `languageCheck` tags move to the same shape without changing behaviour; `location` from the trained region; part-number engravings |
| AROMS-340 | Codes: barcode / QR / Data Matrix assertions (Luna labels) |
| AROMS-341 | Import intelligence: the iOMS / publication import recognises reading, label and part-number steps from the step text and pre-fills the assertion for the ME to confirm |
| AROMS-342 | Instrument cases: digital torque displays, leak-check readouts (scientific notation, multi-line displays), reading stability across frames |

## 7. Out of scope now

Reading handwriting; reading from a photo the operator picks from the
library (the camera frame is the point); any server-side OCR.
