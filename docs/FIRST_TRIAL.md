# First-trial checklist

Use this checklist to try the public experimental preview under the
[limited evaluation licence](../LICENSE.md). This is not a general open-source,
commercial-use, or redistribution permission. Read the
[distribution status](../DISTRIBUTION.md) first.

## 1. Open the example — no installation or your own files needed

Open the [browser demo](https://mingyeomjung-alt.github.io/dsp-workbench/) in a recent desktop browser. No account, Node.js or installation is needed for this route. **Publication is authorized; deployment and hosted verification are pending.** If unavailable, follow the [local alternative](../README.md#run-locally-optional). Internet access is needed for the first Python runtime download; this is not an offline bundle. Record download time separately from analysis time.

1. Choose **Run 100 ms deletion example**. It loads the owned original/processed pair and runs the actual browser-side engine. Alternatively, **Load example → Run comparison** loads the example for the selected mode before running it.
2. Confirm **Review required** and the **100 ms deletion candidate at 2.0–2.1 seconds**. This is the expected example result, not a failed demonstration.
3. Choose **Play region** for both the original and processed files.
4. Save JSON and HTML, then check that the saved HTML opens independently. Reports contain diagnostic information and hashes; do not publish them without reviewing their contents.
5. Start another analysis, choose **Cancel analysis**, and run it again. If the short example has already finished, record the cancellation check as **not tested**. Do not mark unobserved behavior as passed.
6. Close the tab when finished. If you used the optional local server, stop it with Ctrl+C in the terminal.

A successful example checks setup and interface behavior, not real customer
usefulness or detection accuracy. Record only what you actually observed in
your browser, CSP environment, and computer. The English presentation revision
is `0.1.20-web.4`; the DSP engine remains `0.1.20`.

## 2. Check a real workflow — only when you have suitable files

You need before/after PCM16 mono WAVs from the same underlying original, each
2–30 seconds long, a description of the processing applied, and your existing
investigation method. Two independently recorded files or a synthetic-example
run do not substitute for this trial.

- Check that the files and settings are within the supported scope, then investigate the suspected regions with your existing method and Workbench.
- Record missed defects or false warnings only when ground truth is known. A candidate is not automatically a confirmed defect.
- Record investigation time separately from download and setup time. Note that a single user reviewing the same files can be affected by review order and prior familiarity. One observation does not establish a general time-saving claim.
- Choose **use again / use under specific conditions / defer**. Deferring is appropriate when evidence is insufficient.

## 3. Keep a minimal record — no audio or private material required

The following local note is sufficient. Real names, employer or customer names,
paths, filenames, file hashes, and original reports are not required.

```text
Trial scope: included example only / real processing workflow / not run yet
Route: browser demo / local preview
OS / browser (Node version only for local preview):
Could you run it independently? yes / no
Expected region displayed / playback / export: observed / failed / not tested (each)
Cancel and run again: observed / failed / not tested
Blocked step and short error code:
Real workflows only — existing method and time, false warnings, missed defects, inconclusive results:
Would you use it again, and why?
```

Feedback is optional; one or two sentences about the attempt, blocked step and whether you would use it again are enough. No identity, employer, audio, private filenames, hashes or measurement is needed. If you want to share feedback, copy only sanitized text into the
[workflow-feedback form](https://github.com/mingyeomjung-alt/dsp-workbench/issues/new?template=usage_feedback.yml).
For execution problems, use the
[bug-report form](https://github.com/mingyeomjung-alt/dsp-workbench/issues/new?template=bug_report.yml).
**Issues and attachments are public. Do not post audio, private reports, or
credentials.** There is no private audio intake or support contract; contacting
us or supplying audio is not required. For sensitive security findings, follow
[SECURITY.md](../SECURITY.md).
