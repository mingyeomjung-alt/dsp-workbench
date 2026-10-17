# Experimental project checkpoint — 2026-10-17

> Historical private checkpoint. A later owner decision on the same date
> authorizes public experimental evaluation of this reviewed repository under
> [the current evaluation terms](../LICENSE.md). The private-only and external-
> trial restrictions below record the earlier decision, not current visibility.
> The frozen archive, runtime version and hashes remain unchanged. See the
> [current distribution status](../DISTRIBUTION.md) and [public quick start](../README.md).

## Decision and preservation status

The owner requested saving the current project to the existing **private** GitHub repository because it remains too experimental for customer meetings. Customer interviews, outreach, invitations and external trials are **on hold at the owner's request**. This does not claim the product is complete or commercially validated, and does not authorize publication or a new licence. No further feature work is part of this checkpoint.

The checkpoint preserves the project while customer interviews, outreach, and external trials are deferred. It does not discard the project as a failure or declare commercialization complete. The repository was not made read-only, so development can resume later.

## What is saved

- Browser adapter **0.1.20-web.2**: application source, Worker, fixed Python bridge, owned examples, local preview server, automated checks and manual-only GitHub workflow.
- Frozen DSP engine **0.1.20**: the runtime wheel under `web/engine/`, plus the reviewed [full SDK source/test ZIP](../archives/dsp-engine-source-0.1.20.zip). The default remains `v1`; this checkpoint changes no detector or threshold.
- Usage, privacy, dependency notices, first-trial checklist and verification limits.

The source ZIP contains **278 files**, including core code, schemas, tests, tools and dependency notices. Its size is **948,970 bytes**, with **3,289,279 bytes** of expanded file content. SHA-256:

```text
f4c26f63f93e8c2c7596e2bc92c0a0144a86d5bdccaa6e5823bcc30c4bdfe4a2
```

This ZIP is an immutable SDK source snapshot, not a newly trained model, new build or new performance evaluation. The separate runtime wheel retains SHA-256:

```text
3f6dd9a01b68591bf2dd6a9851091b0e124661a2d509739a3f68d679eceab5d7
```

The later English presentation revision, browser adapter `0.1.20-web.3`, does not
rewrite this archive or wheel. The archive retains its original historical
documentation and test fixtures, including earlier-language material; it is not
the active English browser interface.

## What is implemented, and what remains unproved

The prototype compares supported same-source original/processed PCM16 mono WAVs, estimates temporal correspondence, reports deletion/adjacent-repeat candidates, enables region listening, and exports JSON/HTML. The browser supports 2–30 seconds per file and up to six regression cases. The SDK source includes the separate library/CLI and broader SDK suite interface; those limits are not the browser limits.

Existing evidence includes 13 controlled native/WASM semantic comparisons, the maximum-source six-case computational check, and cancellation/retry tests. These establish bounded functionality, not customer detection accuracy, superiority to existing tools, or reduced investigation time. See [verification scope](VERIFICATION.md).

Still unverified: the latest adapter in a real browser/CSP environment and independent customer computer, low-memory/mobile behavior, actual workflow usefulness, commercial performance, and final external usage/support conditions. A source archive does not close those items.

## Resume locally

1. Clone or download the private repository using the owner's authorized account. Use a new folder, preserving earlier evidence.
2. For the browser tool, use Node.js 20 or later and run `npm start` from the repository root. Open its loopback URL. No `npm install` is needed; the first Python/WASM runtime load requires internet access. Selected audio is not uploaded.
3. Run `npm test` for the repository checks. Optional `python scripts/check_engine.py` requires Python 3.12 with compatible NumPy/SciPy already installed. Do not treat passing checks as detection-accuracy evidence.
4. For SDK source work, verify the ZIP hash above and extract it into a **new separate directory**. Start with its `README.md`, `pyproject.toml`, dependency notices and tests. Historical example/evaluation references may point to material not bundled in the source ZIP. Runtime dependency binaries and full historical evidence are not included.
5. When the owner chooses to resume product validation, first verify actual browser startup/playback/export/retry behavior; then use a lawful same-source real processing pair. Do not substitute another synthetic run for real workflow usefulness.

## Preservation and access boundaries

The checkpoint does **not** contain personal recordings, downloaded datasets/models, credentials, unrelated projects, cached runtimes, the entire parent workspace, or the full historical evaluation store. The three browser demo WAVs are project-owned synthetic examples. The frozen source ZIP was inspected for unsafe paths, duplicate entries, audio/model/executable files and secret patterns; no such blocker was found. Fictional privacy-redaction fixtures and third-party copyright notices remain source material, not personal user recordings.

The browser and source archive expose project code to any recipient who receives them. This private repository is not encryption or a code-hiding mechanism. Hashes identify content but are not digital authenticity signatures. Public visibility, Pages, outside invitations, organisation transfer and external ZIP delivery all remain outside this checkpoint's authorization.
