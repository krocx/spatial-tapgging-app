# User Research Questions — Author & Operator

Purpose: a discovery script for talking to real Authors and Operators about the next phase of the Spatial Tagging App. Each question is grounded in something already observed in the app (a gap, an open question, or a design assumption baked into the current build) — the goal is to replace our guesses with their actual needs before we build anything new.

How to use this: don't read these verbatim as a survey. Use them to start a conversation, follow the thread wherever it goes, and come back to fill gaps. Note who you talked to, their environment (facility type, device, network conditions), and date.

---

## Author persona — the person who sets up anchors and trains tags

### Setup & frequency
1. How often do you set up a new anchor — daily, weekly, only when a new piece of equipment arrives? Does that change how much friction you'll tolerate in the setup flow?
2. How many tags does a typical anchor have? Is there a point (10? 50?) where scrolling a flat tag list stops working for you?
3. Do you usually train tags in one sitting, or come back to "Save & train later" tags across multiple sessions?

### Dual Pass/Fail training (new feature)
4. Now that you can train a "Fail" reference (what wrong looks like) in addition to "Pass," which of your tags actually have a clear, consistent wrong state — and which don't (e.g., "broken" can look like many different things)?
5. For tags where Fail doesn't have one consistent appearance, would a different validation approach (not nearest-match) make more sense to you?
6. Is re-training a state (Pass or Fail) something you expect to do often as conditions change, or mostly a one-time setup task?

### Region of Interest (new feature)
7. For which kinds of tags does cropping to a smaller region actually help — busy backgrounds, glare, equipment that's partially obstructed? Can you give 2-3 concrete examples from your own work?
8. Is the default centered box usually close to what you want, or do you find yourself fighting with the drag handles often?

### Naming & identity (gap #64)
9. Have you actually run into duplicate anchor names causing confusion? Walk me through what happened.
10. If we add a timestamp to anchor names automatically, do you want to see/control that, or should it be invisible metadata you never have to think about?
11. When you're looking for an anchor in the Portal later, what do you search by — name, date, location, equipment type?

### Errors & friction (gaps #62, #63, #68, #70, #75)
12. The very first tap to place a tag often throws a "no surface detected" error that goes away if you just close and retry — does this match your experience? How much does it slow you down across a normal session?
13. When you scan the wrong QR code by mistake, what do you expect to happen next — should the app just keep listening for the right one, or is a hard reset back to anchor selection actually fine?
14. When you tap "Train" and the app silently redirects you into a re-anchor flow, did you understand what was happening, or did it feel broken?
15. When a training upload fails, what do you currently do — retry blindly, check your connection, give up and report it? What would a useful error message tell you?

### Publishing & governance
16. Right now there's no formal "publish" step — an Operator could open an anchor with untrained tags (they'll just see a readiness warning). Does that match how your team actually works, or do you want a harder gate before Operators can use an anchor?
17. Should Author mode remember where you left off if the app restarts mid-session, or is starting fresh every time fine?

---

## Operator persona — the person who walks the floor and validates tags

### Workflow & context
1. Walk me through a typical inspection round: how many anchors, how many tags, how long does it take end to end?
2. Do you inspect the same anchors on a schedule, or is it triggered by something (shift change, incident, audit)?
3. What's your network situation like in the spaces you inspect — reliable Wi-Fi, spotty, none at all?

### Validation behavior (dual-state aware results)
4. Now that tags with a trained Fail reference use nearest-match comparison instead of a fixed threshold, have you noticed a difference in how confident the PASS/FAIL calls feel? Any cases where it called something wrong?
5. Is a single global PASS confidence threshold (currently 0.60) right for all your equipment, or do some tags need to be stricter/looser than others?
6. After "End Inspection," do you ever want to re-inspect only the FAILed tags, or do you always want a full re-run?

### Error visibility (gaps #66, #67, #71, #72)
7. If a tag's validation silently comes back as ~0% (e.g., because of a decryption failure), would you currently know that's different from a genuine FAIL? What would help you tell them apart?
8. Have you ever hit a tag stuck in "PENDING" with no explanation? What did you do?
9. During the "Analysing…" wait, do you want to know what stage it's at (uploading, comparing, scoring), or is a simple spinner enough?

### Trust, history & accountability (gaps #65-old, #69, #73)
10. Do you currently keep any record of your inspection results outside the app (notebook, spreadsheet, photo)? What would make you trust the app enough to stop doing that?
11. If you needed to prove to someone else that an inspection happened and what it found, could you do that today? What's missing?
12. Has the app ever been interrupted mid-inspection (phone call, app backgrounding, low battery)? What happened to your progress?
13. Have you ever had a request just hang with no way to cancel it? What did you do?

### Multi-user & scale
14. Do multiple Operators inspect the same anchors, or is each anchor "owned" by one person? If shared, do you ever want to see who validated something and when?
15. How many anchors/tags total are you realistically managing across your whole site? Does the current flat directory list hold up at that scale?

### Tags without a clear physical position (gap, mitigated by #15)
16. Have you ever seen a tag in the list that had no marker show up in AR? What did you do in that moment?

---

## Suggested next step

Run 3-5 conversations per persona (more if roles vary a lot by site or equipment type). Look for answers that contradict the assumptions baked into the current build — those are the highest-value findings, since they mean we're solving the wrong problem rather than just missing a feature.
