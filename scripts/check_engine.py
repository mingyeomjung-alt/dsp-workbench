#!/usr/bin/env python3
"""Check the bundled frozen engine on owned fixtures, without workspace imports.

Requires Python 3.12 and installed NumPy/SciPy. No browser, network calls, model
downloads, or private recordings are used. These are functionality/parity checks,
not independent accuracy or commercial-utility evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import platform
import re
import shutil
import sys
import tempfile
import time
import wave
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

# Do not leave a new cache in the distributable when importing its adapter.
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
WHEEL = WEB / "engine" / "audio_regression_engine-0.1.20-py3-none-any.whl"
PINS = {
    WHEEL: "3f6dd9a01b68591bf2dd6a9851091b0e124661a2d509739a3f68d679eceab5d7",
    WEB / "demo/source.wav": "dbca1c247fae6de0f7ea5dd8886c6fe603554e9a8a0578e031de9917084c9c8b",
    WEB / "demo/baseline.wav": "dbca1c247fae6de0f7ea5dd8886c6fe603554e9a8a0578e031de9917084c9c8b",
    WEB / "demo/candidate.wav": "e40bf02b7a183bac2caecf7ab295faf33f92030e9f7121e4394e8cf0bb98b5d4",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path,
                        help="Optional new directory for JSON and static HTML evidence; never overwrite.")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        parser.error("Use the supported native verification runtime: Python 3.12.")
    started = time.perf_counter()
    count = 0

    def check(condition, message):
        nonlocal count
        if not condition:
            raise AssertionError(message)
        count += 1

    for filename, expected in PINS.items():
        check(filename.is_file() and not filename.is_symlink(), "Missing or linked bundle asset")
        check(hashlib.sha256(filename.read_bytes()).hexdigest() == expected,
              "Asset hash differs from the frozen bundle pin")
    with ZipFile(WHEEL) as archive:
        names = archive.namelist()
        check(len(names) == len(set(names)) == 107, "Unexpected or duplicate wheel members")
        check(archive.testzip() is None, "Wheel member CRC mismatch")
        for name in names:
            parts = PurePosixPath(name).parts
            check(not name.startswith("/") and "\\" not in name and ".." not in parts
                  and parts[0] in {"audio_regression", "audio_regression_engine-0.1.20.dist-info"},
                  "Unsafe or unexpected wheel member")
            check(not name.lower().endswith((".wav", ".m4a", ".mp3", ".onnx", ".pkl", ".exe")),
                  "Unexpected recording, model, or executable in engine wheel")
    # The immutable ZIP is first on sys.path. No checkout source is imported.
    sys.path.insert(0, str(WHEEL))
    import audio_regression
    import numpy
    import scipy
    from audio_regression.api import analyze_pair
    from audio_regression.audio import AudioInputError
    from audio_regression.check_policy import check_result
    from audio_regression.regression_suite import run_regression_suite
    from audio_regression.regression_suite_contract import (
        canonical_manifest_sha256, validate_suite_result,
    )

    check(audio_regression.__version__ == "0.1.20", "Wrong engine version")
    check(str(WHEEL) in audio_regression.__file__, "Engine was not imported from bundled ZIP")
    source, baseline, candidate = (WEB / "demo" / (role + ".wav")
                                   for role in ("source", "baseline", "candidate"))
    configuration = {"engine": "v11", "allow_gain": False, "allow_resampling": False,
                     "max_delay_ms": 1000, "resampling_model": None}
    original_hashes = {filename: hashlib.sha256(filename.read_bytes()).hexdigest() for filename in PINS}
    identity = analyze_pair(source, baseline, engine="v1", profile="basic")
    check(identity["status"] == "analyzed", "Identity comparison failed")
    check(check_result(identity)["gate_state"] == "clear_supported_temporal_check",
          "Byte-identical reference did not clear the supported temporal check")
    direct_pair = analyze_pair(source, candidate, engine="v11", profile="basic")
    check(direct_pair["status"] == "analyzed", "Demonstration pair was not analyzed")
    check(len(direct_pair["events"]) == 1, "Expected exactly one demonstration candidate")
    event = direct_pair["events"][0]
    check(event["type"] == "delete" and event["reference_interval_ms"] == [2000, 2100],
          "Demonstration deletion does not have its known 2.0-2.1 second location")
    check(check_result(direct_pair)["gate_state"] == "review_required",
          "Detected deletion must remain a review candidate")

    with tempfile.TemporaryDirectory(prefix="dsp-bundle-check-") as directory:
        temporary = Path(directory)
        bad_wav = temporary / "malformed.wav"
        bad_wav.write_bytes(b"not a WAV file")
        try:
            invalid = analyze_pair(source, bad_wav, engine="v1", profile="basic")
        except AudioInputError:
            invalid = None  # Direct API rejects malformed input before a result exists.
            check(True, "Direct API explicitly rejected the malformed WAV")
        else:
            check(invalid["status"] in {"withheld", "error"}, "Invalid WAV must not be analyzed")
            check(check_result(invalid)["gate_state"] == "blocked", "Invalid WAV must never pass")

        # Keep labels hostile to accidental HTML interpolation; safe escaped text is expected.
        versions = {"baseline": "<img src=x onerror=alert(1)>", "candidate": "candidate & test"}
        control = temporary / "control"
        folder = control / "inputs/001"
        folder.mkdir(parents=True)
        case = {"case_id": "case-1", "configuration": configuration}
        for role in ("source", "baseline", "candidate"):
            target = folder / (role + ".wav")
            shutil.copyfile(WEB / "demo" / (role + ".wav"), target)
            case[role] = {"path": "inputs/001/" + role + ".wav",
                          "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}
        manifest = {"schema_version": 1, "suite_id": "browser-suite",
                    "baseline_version": versions["baseline"], "candidate_version": versions["candidate"],
                    "cases": [case]}
        manifest_path = control / "suite.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        direct_suite = run_regression_suite(manifest_path, control / "result")
        check(validate_suite_result(direct_suite) == direct_suite, "Invalid suite result contract")
        for field, expected in {"new_candidate_count": 1, "persistent_candidate_count": 0,
                                "not_observed_now_count": 0, "current_gate_state": "review_required",
                                "regression_state": "new_candidates", "exit_code": 1}.items():
            check(direct_suite["summary"][field] == expected, "Unexpected suite summary: " + field)

        # Exact adapter parity does not silently swap in another engine or repair holds.
        spec = importlib.util.spec_from_file_location("standalone_bundle_bridge", WEB / "bridge.py")
        bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bridge)
        bridge.WORK_ROOT = temporary / "web-jobs"
        bridge.WORK_ROOT.mkdir()
        reports = {}
        for index, mode, roles, expected in [
                (1, "pair", ("source", "candidate"), direct_pair),
                (2, "suite", ("source", "baseline", "candidate"), direct_suite)]:
            job = bridge.WORK_ROOT / f"job-{index}"
            job_folder = job / "inputs/001"
            job_folder.mkdir(parents=True)
            sizes = {}
            for role in roles:
                target = job_folder / (role + ".wav")
                shutil.copyfile(WEB / "demo" / (role + ".wav"), target)
                sizes[role] = target.stat().st_size
            request = {"mode": mode, "configuration": configuration, "versions": versions,
                       "cases": [{"case_id": "case-1", "sizes": sizes}]}
            outcome = json.loads(bridge.dispatch_web_request(json.dumps(request), str(job)))
            check(outcome["ok"] is True, "Browser adapter rejected a supported request")
            check(outcome["payload"]["result"] == expected, "Browser adapter and frozen engine differ")
            check(not job.exists(), "Browser adapter retained temporary audio")
            reports[mode] = outcome["payload"]["report_html"]

        pair_snapshot = json.dumps(direct_pair, sort_keys=True)
        suite_snapshot = json.dumps(direct_suite, sort_keys=True)
        pair_html = bridge.render_english_pair_html(direct_pair)
        suite_html = bridge.render_english_suite_html(direct_suite)
        check(pair_html == reports["pair"] and suite_html == reports["suite"],
              "Adapter did not use the English presentation boundary")
        check(json.dumps(direct_pair, sort_keys=True) == pair_snapshot
              and json.dumps(direct_suite, sort_keys=True) == suite_snapshot,
              "Report presentation modified numerical results or decision codes")
        for report in (pair_html, suite_html):
            check('<html lang="en">' in report, "Browser report does not declare English")
            check(re.search(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]", report) is None,
                  "English demonstration report contains untranslated Korean UI")
            check("Interpretation limits" in report and "not calibrated probabilities" in report,
                  "English report omitted diagnostic interpretation limits")
        check("Temporal regression analysis" in pair_html and "Deletion candidate" in pair_html,
              "English PAIR headings are missing")
        check('data-start-ms="2000.000"' in pair_html and 'data-end-ms="2100.000"' in pair_html
              and 'data-boundary-ms="2000.000"' in pair_html,
              "English report changed known event positions")
        check("Event diagnostic evidence" in pair_html and "Offset after event (ms)" in pair_html
              and "-100.0" in pair_html, "English report omitted event evidence")
        check("Saved WAV regression suite" in suite_html and "Candidate changes" in suite_html
              and "Baseline output" in suite_html and "Candidate output" in suite_html,
              "English SUITE headings or embedded details are missing")

        # Localize product wording, not a visitor's own version labels.
        labelled_suite = json.loads(suite_snapshot)
        visitor_label = "\ud55c\uad6d\uc5b4 <visitor & label>"
        labelled_suite["manifest"]["candidate_version"] = visitor_label
        visitor_path = "/".join(("C:", "Users", "private", "local-version"))
        labelled_suite["manifest"]["baseline_version"] = visitor_path
        labelled_suite["manifest_sha256"] = canonical_manifest_sha256(labelled_suite["manifest"])
        labelled_html = bridge.render_english_suite_html(labelled_suite)
        check("\ud55c\uad6d\uc5b4 &lt;visitor &amp; label&gt;" in labelled_html,
              "Visitor text was translated, stripped, or emitted as markup")
        check(visitor_path not in labelled_html and "[local path omitted]" in labelled_html,
              "English report exposed a visitor-supplied local path")

        silence = temporary / "silence.wav"
        with wave.open(str(silence), "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(8000)
            stream.writeframes(b"\0\0" * 16000)
        withheld = analyze_pair(source, silence, engine="v11", profile="basic")
        check(withheld["status"] == "withheld", "Silent fixture must remain withheld")
        withheld_snapshot = json.dumps(withheld, sort_keys=True)
        withheld_html = bridge.render_english_pair_html(withheld)
        check("Withholding or error reason" in withheld_html
              and withheld["reason_code"] in withheld_html
              and re.search(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]", withheld_html) is None,
              "Withheld report is not English or lost the unchanged final reason")
        check(json.dumps(withheld, sort_keys=True) == withheld_snapshot
              and check_result(withheld)["gate_state"] == "blocked",
              "English presentation changed a withheld decision")

        invalid_job = bridge.WORK_ROOT / "job-3"
        invalid_folder = invalid_job / "inputs/001"
        invalid_folder.mkdir(parents=True)
        shutil.copyfile(source, invalid_folder / "source.wav")
        (invalid_folder / "candidate.wav").write_bytes(b"x" * 44)
        invalid_request = {"mode": "pair", "configuration": configuration, "versions": versions,
                           "cases": [{"case_id": "case-invalid", "sizes": {
                               "source": source.stat().st_size, "candidate": 44}}]}
        invalid_outcome = json.loads(bridge.dispatch_web_request(json.dumps(invalid_request), str(invalid_job)))
        check(invalid_outcome["ok"] is False and "payload" not in invalid_outcome,
              "Malformed WAV must produce a failure envelope, never a passing result")
        check(not invalid_job.exists(), "Malformed WAV job was not cleaned up")

    for result in (identity, direct_pair, direct_suite, *([invalid] if invalid is not None else [])):
        check(result["complete_audio_approval"] is False, "Whole-audio approval must remain false")
        check(result["commercial_performance_validated"] is False,
              "Commercial-performance claim must remain false")
    for html in (pair_html, suite_html):
        check("Content-Security-Policy" in html and "default-src 'none'" in html,
              "Static report lacks restrictive CSP")
        check("style-src 'sha256-" in html and "'unsafe-inline'" not in html,
              "Static report must allow only the fixed stylesheet by hash")
        check("<script" not in html.lower(), "Static report contains executable JavaScript")
        check("<img src=x onerror=alert(1)>" not in html, "Unsafe label was emitted as HTML")
    check("&lt;img src=x onerror=alert(1)&gt;" in suite_html, "Report label escaping was not exercised")
    for filename, expected in original_hashes.items():
        check(hashlib.sha256(filename.read_bytes()).hexdigest() == expected, "Input bundle was modified")
    evidence = {"status": "passed", "scope": "owned_demo_functionality_and_native_adapter_parity_only",
                "checks": count, "engine": audio_regression.__version__, "python": platform.python_version(),
                "numpy": numpy.__version__, "scipy": scipy.__version__,
                "pair_gate": check_result(direct_pair)["gate_state"], "suite_exit_code": 1,
                "browser_report_language": "en", "visitor_labels_preserved": True,
                "complete_audio_approval": False, "commercial_performance_validated": False,
                "elapsed_seconds": round(time.perf_counter() - started, 3)}
    if args.output_dir is not None:
        output = args.output_dir.resolve()
        output.mkdir(parents=True, exist_ok=False)
        for name, content in {"summary.json": json.dumps(evidence, indent=2) + "\n",
                              "pair_report.html": pair_html, "suite_report.html": suite_html}.items():
            with (output / name).open("x", encoding="utf-8") as stream:
                stream.write(content)
    print(json.dumps(evidence, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
