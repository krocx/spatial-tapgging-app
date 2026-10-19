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
| `text-match` | printed or engraved text | what the label must say (contains by default, "a \| b" for either; case and whitespace folded - §8.1) | the label says WARNING - HOT SURFACE; the part is engraved PT76545; the Japanese label, not the English one |
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

## 8. Author journey (reviewed 2026-10-16, AROMS-346)

One rule: the step page says **what** the step checks, Place Steps in AR is
**where** it is trained, and both show one status line.

- Step page: Require validation and the Cone / Quick shot plan; the Text,
  Reading and Code checks; on a Text check a switch "Also check it sits
  where it was trained" (position is a property of the label check, not a
  check of its own - the `location` kind stays on the wire, paired). One
  status line under the checks: "Trained in AR: cone · label" or "Needs
  training in AR: label position". Nothing on the page is a step to do
  after training.
- Place Steps in AR: one chip per step whose words are the state ("Train ·
  cone + label", "Trained · label needs training", "Trained · cone ·
  label"); tapping opens one sheet with each half and its own button;
  when a cone sweep or quick shot finishes and the label position is still
  untrained, the label reading opens on its own.
- Operator: an untrained position, or a position with no label text to
  anchor it, is **flagged, not blocking** ("Label position not trained -
  skipped"), as an untrained presence check falls back to manual. Text is
  always checked live; only position needs the training. Words for
  operators: "Label where it should be".
- Portal: the Guide Library's "Reads …" chip says "· position needs
  training"; the Designer's Text row carries the same switch and the same
  orange hint.

### 8.1 A Text check means "must say" (2026-10-19, AROMS-349)

Found on device with a Canon ink box: a Text check for PIXMA failed, because
the camera read the whole label ("GENUINE Made In Japan 731 … PIXMA 59280")
and the default compare was exact. A real label always carries more than the
words that matter, so:

- `match` defaults to `contains` on both ends (`a.match ?? 'contains'`), case
  and whitespace folded. Neither the step page nor the Designer offers a
  compare picker any more: the field says "what the label must say"; typing
  "a | b" means either (`any-of`). An older `exact` is folded into `contains`
  on the next save; `regex` is only ever set by an import and is kept.
- Verdict words: "Read "PIXMA" - found" / "Read "GENUINE …" - "PIXMA" not on
  it" / "Nothing readable in the frame - expected "PIXMA"".
- A blank check cannot strand the operator. The row says in orange "Type
  what the label must say - a blank check is not saved"; the iPad and SIB
  both drop it on save, and a position with no label text left to anchor it
  goes with it. A blank that reaches a device from an older save is
  **flagged** ("No expected text on this step - skipped"), never blocking.
### 8.1a Training captures the words (2026-10-19, AROMS-350)

The label reading in Place Steps in AR used to keep only the box of the
line that matched and throw the words away - at the one moment the
expectation should be captured. Now, after Read, the recognised lines are
chips under the photo, one row per Text or Code check. The chip that
carries the typed expectation is pre-selected; tapping another makes it the
expectation. Save as trained writes both the position and the words, as the
camera spells them ("AchromaLife100", not "ChromaLife100"), with `match:
contains`. A blank check must have a chip picked before Save is enabled.

The honest path for an author is therefore: add a Text check, go to AR,
read the real label, tap the line; typing is the shortcut. The Train chip
offers "Read the label to set the words" on text-only checks too (no
position switch), and a blank one is chained after presence training the
way an untrained position is. Text alone still needs no training to run.

### 8.2 Try it as the operator (2026-10-19, AROMS-351)

An author adding step 12 wants to know step 4, trained last week, still
passes - without save, publish, a mode switch and a walk to the QR. Every
step's Train chip in Place Steps in AR offers "Try it as the operator" once
anything is in place: presence is scored from where the author stands with
the operator's rule (`PresenceScorer`: on-device feature print or server
SSIM, whichever is higher, PASS at 0.60) and said in a toast ("Presence
would pass · score 0.82 · nothing recorded", or why not); then the label
checks open in the operator's own reading sheet marked "Trial - nothing is
recorded", with one button, Done. `/validate` is a pure compare and the
sheet on trial calls nothing, so no run, evidence or event is written. The
Operator mode remains the test of the whole guide.

Open (AROMS-352): on the floor presence and the label are two validations;
the merge is to read the label on the cone's own frame and only open the
sheet when it is not legible from there.
