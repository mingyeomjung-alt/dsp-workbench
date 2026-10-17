"""Fixed browser adapter for the unchanged 0.1.20 DSP package.

Only fixed, worker-created MEMFS paths are accepted. User input is data, never
Python source, processor commands, import names, or filesystem paths. Audio is
temporary; reports are returned to JavaScript and the complete job is removed.
"""
from __future__ import annotations

import base64
import hashlib
import json
from html import escape
from pathlib import Path
import platform
import re
import shutil

import numpy
import scipy

from audio_regression import __version__
from audio_regression.api import analyze_pair
from audio_regression.artifact_integrity import _read_regular
from audio_regression.check_policy import check_result
from audio_regression.regression_suite import run_regression_suite
from audio_regression.regression_suite_contract import (
    normalize_suite_configuration, normalize_suite_manifest, validate_suite_result,
)
from audio_regression.reporting import _STYLE as _REPORT_STYLE
from audio_regression.result_contract import validate_analysis_result

WORK_ROOT = Path("/web-jobs")
MAX_CASES = 6
MAX_FILE_BYTES = 10_000_000
MAX_TOTAL_BYTES = 64 * 1024 * 1024
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
_JOB = re.compile(r"job-[1-9][0-9]{0,8}\Z")
_LOCAL_PATH = re.compile(
    r"(?:[A-Za-z]:[\\/]|\\\\|file://|/(?:Users|home|tmp|mnt|var|etc)/)[^\s<>\"']*"
    r"|(?<!\S)/(?!/)[^\s<>\"']+", re.IGNORECASE,
)
_REPORT_STYLE_DIGEST = base64.b64encode(hashlib.sha256(_REPORT_STYLE.encode("utf-8")).digest()).decode("ascii")
_REPORT_CSP = ("default-src 'none'; style-src 'sha256-" + _REPORT_STYLE_DIGEST
               + "'; base-uri 'none'; form-action 'none'; object-src 'none'")
_GATES = {
    "clear_supported_temporal_check": "No supported temporal candidates",
    "review_required": "Current candidates require review",
    "blocked": "Assessment withheld or check failed",
}
_REGRESSIONS = {
    "new_candidates": "New candidates observed; review required",
    "no_new_candidates_observed": "No new candidates observed; not audio approval",
    "inconclusive": "Version comparison is inconclusive",
}
_LABELS = {
    "duration_ms": "Duration (ms)", "sample_rate_hz": "Sample rate (Hz)",
    "sample_count": "Sample count", "rms": "RMS", "sha256": "SHA-256",
    "max_delay_ms": "Maximum initial-delay search (ms)",
    "reference_interval_ms": "Reference interval (ms)",
    "reference_source_interval_ms": "Reference copy-source interval (ms)",
    "processed_added_interval_ms": "Processed added-copy interval (ms)",
    "processed_boundary_ms": "Corresponding processed boundary (ms)",
    "processed_offset_ms": "Processed offset (ms)",
    "normalized_path_cost": "Normalized path cost",
    "matched_normalized_rmse": "Matched normalized RMSE",
    "offset_before_ms": "Offset before event (ms)",
    "offset_after_ms": "Offset after event (ms)",
    "minimum_event_duration_ms": "Minimum event duration (ms)",
    "maximum_cumulative_edit_shift_ms": "Maximum cumulative edit shift (ms)",
}


def _report_text(value: object) -> str:
    """Escape data, retaining visitor wording but omitting local file paths."""
    return escape(_LOCAL_PATH.sub("[local path omitted]", str(value)), quote=True)


def _report_value(value: object) -> str:
    if value is None:
        return "Not provided"
    if type(value) is bool:
        return "Yes" if value else "No"
    if type(value) in (dict, list):
        return _report_text(json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False))
    return _report_text(value)


def _report_details(items: dict) -> str:
    return "<dl>" + "".join(
        "<dt>" + _report_text(_LABELS.get(key, key.replace("_", " ").capitalize()))
        + "</dt><dd><code>" + _report_value(value) + "</code></dd>"
        for key, value in items.items()
    ) + "</dl>"


def _report_card(title: str, content: str) -> str:
    # Content is only assembled by the escaped presentation functions below.
    return '<section class="card"><h2>' + _report_text(title) + "</h2>" + content + "</section>"


def _report_document(title: str, content: str) -> str:
    return ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="' + _REPORT_CSP + '">'
            '<title>' + _report_text(title) + '</title><style>' + _REPORT_STYLE
            + '</style></head><body><main><header><div class="eyebrow">DSP WORKBENCH / STATIC REPORT</div>'
            '<h1>' + _report_text(title) + '</h1></header>' + content
            + '<footer>Self-contained static HTML. No JavaScript, external requests, audio reanalysis, '
            'file reopening, or automatic baseline update.</footer></main></body></html>\n')


def _report_timeline(axis: str, duration: float, interval=None, boundary=None) -> str:
    """Use each input's own duration and retain exact machine-readable times."""
    label = "Reference timeline" if axis == "reference" else "Processed timeline"
    marks = ""
    if interval is not None:
        start, end = interval
        marks += (f'<rect class="interval" x="{48 + 840 * start / duration:.3f}" y="15" '
                  f'width="{840 * (end - start) / duration:.3f}" height="14" rx="3" '
                  f'data-start-ms="{start:.3f}" data-end-ms="{end:.3f}"/>')
    if boundary is not None:
        position = 48 + 840 * boundary / duration
        marks += (f'<line class="boundary" x1="{position:.3f}" x2="{position:.3f}" '
                  f'y1="10" y2="34" data-boundary-ms="{boundary:.3f}"/>')
    return (f'<div class="axis">{label} · 0–{duration:g} ms</div>'
            f'<svg class="timeline-plot" viewBox="0 0 940 42" role="img" '
            f'aria-label="Event position on the {label.lower()}" data-axis="{axis}" '
            f'data-duration-ms="{duration:.3f}"><rect class="track" x="48" y="15" '
            f'width="840" height="14" rx="7"/>{marks}</svg>'
            f'<div class="timeline-ticks"><span>0 ms</span><span>{duration:g} ms</span></div>')


def _report_analysis(result: dict) -> str:
    """English presentation only; never modify the frozen result or decisions."""
    validate_analysis_result(result)
    gate = check_result(result)
    events = result.get("events")
    count = len(events) if isinstance(events, list) else "Not established"
    sections = [_report_card("Assessment", '<p><strong>' + _report_text(_GATES[gate["gate_state"]])
                            + '</strong></p>' + _report_details({
                                "analysis_status": result["status"], "event_candidate_count": count,
                                "engine": result.get("engine"), "gate_state": gate["gate_state"],
                                "exit_code": gate["exit_code"], "policy_reason_code": gate["reason_code"],
                                "content_preservation_status": result.get("content_preservation_status"),
                                **({"proof_kind": result["proof_kind"]} if "proof_kind" in result else {}),
                                "complete_audio_approval": False, "commercial_performance_validated": False,
                            }))]
    sections.append('<aside class="notice"><strong>Interpretation limits</strong>'
                    'Temporal diagnostic candidates are not calibrated probabilities, complete audio approval, '
                    'commercial accuracy, fault provenance, or a decision about intentional editing. '
                    'A withheld or inconclusive result is not a successful check.</aside>')
    if result["status"] in {"withheld", "error"}:
        detail = '<p>The stored final reason remains authoritative; additional stages do not replace it.</p>'
        detail += _report_details({"final_reason_code": result.get("reason_code")})
        review = result.get("review_diagnostics")
        if review is not None:
            detail += _report_details({key: value for key, value in review.items() if key != "stages"})
            for stage in review["stages"]:
                detail += '<article class="event"><h3>Recorded additional check</h3>'
                detail += _report_details(stage) + '</article>'
            detail += ('<p class="scope muted">Only the stored bounded diagnostic summary is shown. '
                       'Missing or unavailable records do not prove a check failed or was never attempted. '
                       'A not-attempted stage is not a defect finding. Separate trace files are not opened.</p>')
        else:
            detail += '<p>No additional check summary is provided.</p>'
        sections.append(_report_card("Withholding or error reason", detail))
    if events is None:
        event_html = '<p>No event list was established because assessment was withheld or failed.</p>'
    elif not events:
        event_html = '<p>No supported temporal candidates were observed. This is not complete audio approval.</p>'
    else:
        event_html = ('<p class="scope muted">The two timelines are independently scaled to their own durations. '
                      'Use the millisecond coordinates for exact positions. Event indices start at 1.</p>')
        for index, event in enumerate(events, 1):
            title = "Deletion candidate" if event["type"] == "delete" else "Repetition candidate"
            if event.get("location") in {"head", "tail"}:
                title = ("Head-loss candidate" if event["location"] == "head" else "Tail-loss candidate")
            event_html += '<article class="event"><h3>' + str(index) + '. ' + title + '</h3>'
            event_html += _report_details({key: value for key, value in event.items() if key != "evidence"})
            if event["type"] == "delete":
                event_html += _report_timeline("reference", result["reference"]["duration_ms"],
                                               interval=event["reference_interval_ms"])
                event_html += _report_timeline("processed", result["processed"]["duration_ms"],
                                               boundary=event["processed_boundary_ms"])
            else:
                event_html += _report_timeline("reference", result["reference"]["duration_ms"],
                                               interval=event["reference_source_interval_ms"])
                event_html += _report_timeline("processed", result["processed"]["duration_ms"],
                                               interval=event["processed_added_interval_ms"])
                event_html += ('<p class="scope muted">The later adjacent copy is displayed by convention; '
                               'this does not establish the actual edit position or cause.</p>')
            event_html += '<details open><summary>Event diagnostic evidence</summary>'
            event_html += _report_details(event.get("evidence", {})) + '</details></article>'
    sections.append(_report_card("Temporal candidates", event_html))
    for key, title in (("reference", "Reference input metadata"), ("processed", "Processed input metadata"),
                       ("configuration", "Declared transformations"), ("analysis", "Analysis scope"),
                       ("diagnostics", "Diagnostic metrics")):
        if key in result:
            sections.append(_report_card(title, _report_details(result[key])))
    if result.get("engine") == "local_content_alignment_v12":
        metadata = result.get("resampling_reference")
        sections.append(_report_card("Model-derived comparison signal", (
            _report_details(metadata) if metadata else '<p>The declared comparison signal was not generated.</p>')
            + '<p>The raw reference remains the 48 kHz input. The comparison signal uses the declared '
            'whole-record FFT transform and PCM16 rounding at 16 kHz. Reference event times share physical '
            'time with the raw input; they do not prove raw 48 kHz samples were removed at those positions. '
            'Only the declared post-transform editing model is assessed, not arbitrary resamplers, filters, '
            'gain changes, processing history, or cause. FFT periodic-boundary assumptions apply.</p>'))
    if "alignment_segments" in result:
        alignments = "".join('<article class="event">' + _report_details(item) + '</article>'
                             for item in result["alignment_segments"])
        sections.append(_report_card("Stored alignment segments", '<details><summary>Show correspondence evidence</summary>'
                                     + alignments + '</details>'))
    limitations = ''.join('<li>' + _report_text(item) + '</li>' for item in result.get("limitations", []))
    sections.append(_report_card("Scope and limitations", '<ul>' + limitations + '</ul>'
                    '<p>Correlation and residual metrics are diagnostic, not calibrated probabilities. '
                    'Overall quality, pronunciation, naturalness, noise, frequency distortion, '
                    'network-loss causes, and real-world performance are outside this assessment. '
                    'Hashes identify analyzed inputs; raw audio and local paths are not included.</p>'))
    return "".join(sections)


def render_english_pair_html(result: dict) -> str:
    return _report_document("Temporal regression analysis", _report_analysis(result))


def render_english_suite_html(value: dict) -> str:
    """Render validated embedded data; no paths, audio, or saved HTML are read."""
    validate_suite_result(value)
    summary, manifest = value["summary"], value["manifest"]
    manifest_by_id = {case["case_id"]: case for case in manifest["cases"]}
    overview = _report_details({
        "suite_id": manifest["suite_id"], "baseline_version": manifest["baseline_version"],
        "candidate_version": manifest["candidate_version"], "execution_complete": value["execution_complete"],
        "producer_version": value["producer_version"], "manifest_sha256": value["manifest_sha256"],
    })
    overview += '<p>Execution completed means all cases were visited, not that all analyses succeeded.</p>'
    body = _report_card("Suite record", overview)
    body += _report_card("Two distinct assessment states", '<h3>Current candidate output</h3><p>'
                         + _report_text(_GATES[summary["current_gate_state"]]) + '</p><h3>Change from baseline</h3><p>'
                         + _report_text(_REGRESSIONS[summary["regression_state"]]) + '</p>'
                         + _report_details(summary))
    body += ('<aside class="notice"><strong>Interpretation limits</strong>Persistent candidates are not '
             'normal results. Not observed now does not establish that a defect was fixed or quality improved. '
             'The baseline may itself contain defects. An inconclusive comparison is not zero new candidates. '
             'This report does not approve complete audio quality, intended edits, causes, or commercial accuracy.</aside>')

    def priority(item):
        case = item[1]
        if case["status"] != "completed":
            rank = 0
        elif case["delta"]["status"] == "inconclusive":
            rank = 1
        elif case["delta"]["new_candidates"]:
            rank = 2
        elif case["delta"]["persistent_pairs"]:
            rank = 3
        else:
            rank = 4
        return rank, item[0]

    index_rows, articles = [], []
    axes = {"raw_reference_time_ms": "Raw reference timeline (ms)",
            "canonical_reference_time_ms": "Declared-transform comparison timeline (ms), not raw sample positions",
            None: "Common coordinates not established"}
    for index, case in sorted(enumerate(value["cases"]), key=priority):
        analysis, delta = case["candidate_analysis"], case["delta"]
        gate = "blocked" if case["status"] != "completed" or analysis is None else check_result(analysis)["gate_state"]
        index_rows.append('<tr><td><a href="#case-' + str(index) + '">' + _report_text(case["case_id"])
                          + '</a></td><td>' + _report_text(case["status"]) + '</td><td>'
                          + _report_text(_GATES[gate]) + '</td><td>' + _report_text(delta["status"]) + '</td></tr>')
        article = '<article class="card"><h2 id="case-' + str(index) + '">' + _report_text(case["case_id"]) + '</h2>'
        article += _report_details({"execution_status": case["status"], "current_gate_state": gate,
                                    "case_reason_code": case["reason_code"], "comparison_status": delta["status"],
                                    "delta_reason_code": delta["reason_code"],
                                    "coordinate_axis": axes[delta["coordinate_axis"]]})
        article += '<h3>Candidate changes</h3>'
        if delta["status"] == "compared":
            # Engine JSON uses zero-based indices; the report consistently uses one-based event numbers.
            article += _report_details({
                "new_candidate_event_numbers": [number + 1 for number in delta["new_candidates"]],
                "persistent_event_pairs": [{"baseline_event": pair["baseline_event_index"] + 1,
                                             "candidate_event": pair["candidate_event_index"] + 1}
                                            for pair in delta["persistent_pairs"]],
                "not_observed_now_baseline_event_numbers": [number + 1 for number in delta["not_observed_now"]],
            }) + '<p>Event numbers start at 1 in their respective detailed analyses.</p>'
        else:
            article += '<p>Insufficient coordinate, analysis, or integrity evidence; no change categories assigned.</p>'
        article += '<details><summary>Fixed case configuration</summary>'
        article += _report_details(manifest_by_id[case["case_id"]]["configuration"]) + '</details>'
        for field, label in (("baseline_analysis", "Baseline output"), ("candidate_analysis", "Candidate output")):
            article += '<details><summary>' + label + ' — stored analysis</summary>'
            article += (_report_analysis(case[field]) if case[field] is not None
                        else '<p>No analysis result. This does not mean no events occurred.</p>') + '</details>'
        articles.append(article + '</article>')
    body += _report_card("Review priority", '<p>Execution problems → inconclusive comparisons → new candidates '
                         '→ persistent candidates.</p><div class="table-wrap"><table><thead><tr><th>Case</th>'
                         '<th>Execution status</th><th>Current assessment</th><th>Comparison status</th></tr></thead><tbody>'
                         + ''.join(index_rows) + '</tbody></table></div>')
    integrity = value["input_integrity"]
    integrity_html = _report_details({"integrity_status": integrity["status"]})
    integrity_html += ''.join('<article class="event">' + _report_details(issue) + '</article>'
                              for issue in integrity["issues"])
    integrity_html += '<p>Stored integrity evidence only; report generation does not recheck the actual files.</p>'
    body += _report_card("Input integrity record", integrity_html) + ''.join(articles)
    return _report_document("Saved WAV regression suite", body)


class WebRequestError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _reject(code: str) -> None:
    raise WebRequestError(code)


def _fields(value, expected: set[str], code: str) -> dict:
    if type(value) is not dict or set(value) != expected:
        _reject(code)
    return value


def _pairs(pairs) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            _reject("duplicate_web_request_key")
        result[key] = value
    return result


def _job_root(value: str) -> Path:
    if type(value) is not str:
        _reject("invalid_web_job")
    root = Path(value)
    if (not root.is_absolute() or root.parent != WORK_ROOT
            or not _JOB.fullmatch(root.name) or root.is_symlink()
            or not root.is_dir() or WORK_ROOT.is_symlink()):
        _reject("invalid_web_job")
    return root


def _request(raw: str) -> dict:
    if type(raw) is not str or len(raw.encode("utf-8")) > 32_768:
        _reject("invalid_web_request")
    try:
        value = json.loads(raw, object_pairs_hook=_pairs,
                           parse_constant=lambda _: _reject("non_finite_web_value"))
    except WebRequestError:
        raise
    except (ValueError, RecursionError, OverflowError):
        _reject("invalid_web_request")
    _fields(value, {"mode", "configuration", "versions", "cases"}, "invalid_web_request")
    if type(value["mode"]) is not str or value["mode"] not in {"pair", "suite"}:
        _reject("invalid_web_mode")
    value["configuration"] = normalize_suite_configuration(value["configuration"])
    versions = _fields(value["versions"], {"baseline", "candidate"}, "invalid_web_versions")
    # The frozen manifest validator supplies the complete printable-text rules.
    dummy = {"schema_version": 1, "suite_id": "web-validation",
             "baseline_version": versions["baseline"], "candidate_version": versions["candidate"],
             "cases": [{"case_id": "validation", "configuration": value["configuration"],
                        **{role: {"path": role + ".wav", "sha256": "0" * 64}
                           for role in ("source", "baseline", "candidate")}}]}
    normalize_suite_manifest(dummy)
    cases = value["cases"]
    if (type(cases) is not list or not 1 <= len(cases) <= MAX_CASES
            or value["mode"] == "pair" and len(cases) != 1):
        _reject("invalid_web_case_count")
    seen, total = set(), 0
    for case in cases:
        _fields(case, {"case_id", "sizes"}, "invalid_web_case")
        name = case["case_id"]
        if type(name) is not str or not _ID.fullmatch(name):
            _reject("invalid_web_case_id")
        if name.casefold() in seen:
            _reject("duplicate_web_case_id")
        seen.add(name.casefold())
        roles = {"source", "baseline", "candidate"} if value["mode"] == "suite" else {"source", "candidate"}
        sizes = _fields(case["sizes"], roles, "invalid_web_files")
        for size in sizes.values():
            if type(size) is not int or not 44 <= size <= MAX_FILE_BYTES:
                _reject("invalid_web_file_size")
            total += size
            if total > MAX_TOTAL_BYTES:
                _reject("web_input_budget_exceeded")
    return value


def runtime_info(pyodide_version: str = "0.29.3") -> str:
    return json.dumps({"python": platform.python_version(), "numpy": numpy.__version__,
                       "scipy": scipy.__version__, "engine": __version__,
                       "pyodide": pyodide_version}, allow_nan=False)


def run_web_request(raw: str, input_root: str) -> str:
    """Analyze bounded fixed-path inputs and return one JSON-safe result.

    ``input_root`` is assigned by the worker, never taken from a visitor field.
    Cleanup also occurs for malformed requests and detector exceptions. Invalid
    roots are rejected before cleanup so a caller cannot name another tree.
    """
    root = _job_root(input_root)
    try:
        request = _request(raw)
        cases, config = request["cases"], request["configuration"]
        declarations = []
        for index, case in enumerate(cases, 1):
            declaration = {"case_id": case["case_id"], "configuration": config}
            for role, expected_size in case["sizes"].items():
                relative = f"inputs/{index:03d}/{role}.wav"
                digest, size, _, _ = _read_regular(root / relative, MAX_FILE_BYTES)
                if size != expected_size:
                    _reject("web_input_size_changed")
                declaration[role] = {"path": relative, "sha256": digest}
            declarations.append(declaration)
        if request["mode"] == "pair":
            case = declarations[0]
            options = {key: config[key] for key in
                       ("engine", "allow_gain", "allow_resampling", "max_delay_ms")}
            if config["resampling_model"] is not None:
                options["resampling_model"] = config["resampling_model"]
            result = analyze_pair(root / case["source"]["path"],
                                  root / case["candidate"]["path"], profile="basic", **options)
            payload = {"kind": "pair", "result": result, "gate": check_result(result),
                       "report_html": render_english_pair_html(result)}
        else:
            manifest = normalize_suite_manifest({
                "schema_version": 1, "suite_id": "browser-suite",
                "baseline_version": request["versions"]["baseline"],
                "candidate_version": request["versions"]["candidate"], "cases": declarations})
            manifest_path = root / "suite.json"
            with manifest_path.open("x", encoding="utf-8") as stream:
                json.dump(manifest, stream, ensure_ascii=False, allow_nan=False)
            result = run_regression_suite(manifest_path, root / "result")
            payload = {"kind": "suite", "result": result,
                       "report_html": render_english_suite_html(result)}
        return json.dumps(payload, ensure_ascii=False, allow_nan=False)
    finally:
        # root has been checked against the dedicated temporary parent above.
        shutil.rmtree(root)


def dispatch_web_request(raw: str, input_root: str) -> str:
    """Return a bounded code-only failure without exposing Python tracebacks."""
    try:
        return json.dumps({"ok": True, "payload": json.loads(run_web_request(raw, input_root))},
                          ensure_ascii=False, allow_nan=False)
    except Exception as exc:
        code = getattr(exc, "code", "browser_analysis_failed")
        if type(code) is not str or not re.fullmatch(r"[a-z][a-z0-9_]{0,127}", code):
            code = "browser_analysis_failed"
        return json.dumps({"ok": False, "code": code}, allow_nan=False)
