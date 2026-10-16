"""Fixed browser adapter for the unchanged 0.1.20 DSP package.

Only fixed, worker-created MEMFS paths are accepted. User input is data, never
Python source, processor commands, import names, or filesystem paths. Audio is
temporary; reports are returned to JavaScript and the complete job is removed.
"""
from __future__ import annotations

import json
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
    normalize_suite_configuration, normalize_suite_manifest,
)
from audio_regression.regression_suite_reporting import render_suite_html
from audio_regression.reporting import render_html

WORK_ROOT = Path("/web-jobs")
MAX_CASES = 6
MAX_FILE_BYTES = 10_000_000
MAX_TOTAL_BYTES = 64 * 1024 * 1024
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
_JOB = re.compile(r"job-[1-9][0-9]{0,8}\Z")


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
                       "report_html": render_html(result)}
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
                       "report_html": render_suite_html(result)}
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
