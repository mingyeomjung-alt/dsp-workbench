# Verification scope

This is a public experimental prototype under a [limited evaluation licence](../LICENSE.md), not a commercially validated product or a general open-source release. The browser adapter is `0.1.20-web.3`; the frozen DSP engine remains **0.1.20** with its existing default `v1`, numerical rules and thresholds. This revision translates the current interface, reports, instructions, and issue forms into English; it does not change the detector or establish new performance evidence. The README screenshot is an actual desktop-browser run of the included English example.

## English presentation check — 2026-10-17

The current local preview was opened in an actual desktop browser. The included
PAIR example displayed **Review required**, one deletion at **2.0–2.1 seconds**,
and the corresponding output boundary at **2.0 seconds**. The included SUITE
example displayed one new candidate, zero persistent candidates, and zero
inconclusive cases, with the current assessment still requiring review.
English embedded HTML reports were observed and both HTML and JSON downloads
completed for both modes. Static reports declare `lang="en"` and restrict styles
with a CSP hash. The screenshot contains only the project-owned synthetic example.

The repository checks passed **98 tests** with one OS-restricted symlink fixture
skipped. The native checker passed **284 assertions**, including exact engine/
adapter result parity, English reports, safe escaping, and unchanged withheld
outcomes. A text check prevents untranslated Korean product wording in current
tracked text files. It deliberately does not rewrite the immutable historical
SDK ZIP, wheel, or visitor-supplied labels.

These are bounded presentation and functionality checks on one desktop browser,
not independent detection accuracy, a cross-browser/mobile certification,
an independent customer-computer trial, or real-workflow usefulness. Playback
controls were displayed; this revision does not claim a fresh listening test.

## Checks included here

Run `npm test` for static-payload integrity, the loopback-only server, supported WAV structure, and frontend lifecycle checks. The latter execute the real application JavaScript with controlled DOM, Worker and timer doubles. They exercise initialization failures, cancellation, timeout, restart and stale asynchronous work, but **are not browser UI automation**.

Run `python scripts/check_engine.py` in the declared Python 3.12 numerical environment for the bundled engine and Python adapter smoke checks. No dependency is installed automatically. Only the three owned synthetic demo files are included; no customer audio, model or outside workspace is needed.

The developer workspace additionally contains an offline native/Pyodide comparison harness. It uses generated, known-condition signals to compare result status, review/hold policy, temporal event type and coordinates, and suite change states. Cross-runtime diagnostics may have small floating-point differences; whole result JSON byte identity is not promised. Unsupported or ambiguous inputs must remain withheld or fail, never become a clean result. These checks are functionality and portability evidence, **not independent detection accuracy**.

The historical 2026-10-16 adapter `0.1.20-web.2` check matched **13/13** conditions: eleven pair outcomes (normal, declared gain, deletion, repetition, head loss, ambiguity, invalid WAV, and the explicit FFT resampling path) plus a mixed six-case suite and a six-case suite with 30-second, 48 kHz sources. Status, policy and event type matched; event coordinates were compared with a predeclared 0.125 ms absolute tolerance. Three repeated jobs kept the same allocated WASM heap size and removed temporary job files. A real Node thread containing Pyodide was terminated after analysis dispatch; a genuinely new thread and runtime then completed another job. This is computational Worker-model evidence, not a browser restart test or verification of the English screen.

On that machine the maximum-source suite took approximately 4.8 seconds in Node/WebAssembly. The allocated WASM heap was approximately 229 MiB and sampled Node RSS high-water was approximately 602 MiB. RSS includes non-WASM and test-worker resources; none of these observations establishes browser peak RAM, memory freedom from leaks, or an all-input speed guarantee. The Node check set passed 95 tests with one OS-restricted symlink fixture skipped. The optional native smoke checker passed 265 assertions.

## Resource and compatibility limits

- Inputs: PCM16 mono WAV, 2–30 seconds, supported sample rates, up to six cases and 64 MiB aggregate file bytes.
- The file budget is **not** a memory cap. WAV buffers, in-memory filesystem copies, numerical arrays and the Python runtime add to memory usage.
- Removing job files releases references but WebAssembly linear memory may retain its allocated high-water size. Cancelling terminates the Worker; re-running creates another Worker as needed.
- Developer Node/WebAssembly timings and memory observations are not browser RAM, mobile results, guarantees for all inputs, or a service-level agreement.
- This revision has not been deployed to the existing private hosted Site. The owned English example's desktop UI, runtime loading and report display/export were checked as described above. Other browsers, mobile limits and an independent customer computer remain unverified.
- GitHub Actions checks are manual-only and have not been executed on GitHub. A Windows symlink fixture can be skipped when the operating system does not permit its creation; that path is not claimed as tested.

Public repository access and limited experimental use are governed by the [evaluation licence](../LICENSE.md) and [distribution status](../DISTRIBUTION.md), not by passing checks. No check grants commercial-use or redistribution permission, automatic audio approval, or a claim that a real customer saves time. Actual workflow usefulness still requires real use and observation.
