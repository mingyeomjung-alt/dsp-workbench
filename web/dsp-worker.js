/* Runs the unchanged pinned Python DSP engine in volatile browser memory. */
"use strict";

const PYODIDE_VERSION = "0.29.3";
const PYODIDE_INDEX = "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/";
const ENGINE_WHEEL = "./engine/audio_regression_engine-0.1.20-py3-none-any.whl";
const ENGINE_SHA256 = "3f6dd9a01b68591bf2dd6a9851091b0e124661a2d509739a3f68d679eceab5d7";
const MAX_CASES = 6;
const MAX_FILE_BYTES = 10_000_000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MODEL = "scipy_fft_periodic_48k_16k_pcm16_postedit_v1";
let initialization = null;
let pyodide = null;
let runtime = null;
let active = false;
let jobNumber = 0;

function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, names, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== names.slice().sort().join("\0")) reject(code);
}

function progress(message) { self.postMessage({ type: "progress", message }); }

function validateRequest(message) {
  exactFields(message, ["type", "id", "mode", "configuration", "versions", "cases"], "invalid_web_request");
  if (message.type !== "run" || !["pair", "suite"].includes(message.mode)) reject("invalid_web_mode");
  if (!(typeof message.id === "string" && message.id.length <= 100
        || Number.isSafeInteger(message.id))) reject("invalid_web_request_id");
  const config = message.configuration;
  exactFields(config, ["engine", "allow_gain", "allow_resampling", "max_delay_ms", "resampling_model"], "invalid_web_configuration");
  if (!["v1", "v9", "v10", "v11", "v12"].includes(config.engine)
      || typeof config.allow_gain !== "boolean" || typeof config.allow_resampling !== "boolean"
      || typeof config.max_delay_ms !== "number" || !Number.isFinite(config.max_delay_ms)
      || config.max_delay_ms < 0 || config.max_delay_ms > 5000) reject("invalid_web_configuration");
  if (config.engine === "v12") {
    if (config.allow_gain || !config.allow_resampling || config.resampling_model !== MODEL) reject("invalid_web_resampling_declaration");
  } else if (config.resampling_model !== null) reject("invalid_web_resampling_declaration");
  exactFields(message.versions, ["baseline", "candidate"], "invalid_web_versions");
  for (const version of Object.values(message.versions)) {
    if (typeof version !== "string" || version.length < 1 || [...version].length > 80
        || version !== version.trim() || /[\p{C}\u2028\u2029]/u.test(version)) reject("invalid_web_versions");
  }
  if (!Array.isArray(message.cases) || message.cases.length < 1 || message.cases.length > MAX_CASES
      || message.mode === "pair" && message.cases.length !== 1) reject("invalid_web_case_count");
  const seen = new Set();
  let total = 0;
  const cases = message.cases.map((item) => {
    const roles = message.mode === "suite" ? ["source", "baseline", "candidate"] : ["source", "candidate"];
    exactFields(item, ["case_id", ...roles], "invalid_web_case");
    if (typeof item.case_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item.case_id)) reject("invalid_web_case_id");
    const folded = item.case_id.toLowerCase();
    if (seen.has(folded)) reject("duplicate_web_case_id");
    seen.add(folded);
    const sizes = {};
    for (const role of roles) {
      const data = item[role];
      if (!(data instanceof ArrayBuffer) || data.byteLength < 44 || data.byteLength > MAX_FILE_BYTES) reject("invalid_web_file_size");
      sizes[role] = data.byteLength;
      total += data.byteLength;
      if (total > MAX_TOTAL_BYTES) reject("web_input_budget_exceeded");
    }
    return { case_id: item.case_id, sizes };
  });
  return { mode: message.mode, configuration: { ...config }, versions: { ...message.versions }, cases };
}

async function fetchAsset(url, maximum) {
  const response = await fetch(url, { credentials: "same-origin", redirect: "error" });
  if (!response.ok) reject("runtime_asset_unavailable");
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > maximum) reject("runtime_asset_too_large");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maximum) reject("runtime_asset_too_large");
  return bytes;
}

async function initialize() {
  if (initialization) return initialization;
  initialization = (async () => {
    progress("브라우저 분석 엔진을 준비하고 있습니다. 처음에는 다운로드가 필요합니다.");
    if (!self.crypto?.subtle) reject("secure_context_required");
    importScripts(`${PYODIDE_INDEX}pyodide.js`);
    pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
    if (pyodide.version !== PYODIDE_VERSION) reject("browser_runtime_version_mismatch");
    progress("수치 계산 모듈을 불러오고 있습니다. 오디오는 전송되지 않습니다.");
    await pyodide.loadPackage(["numpy", "scipy"]);
    const wheel = await fetchAsset(ENGINE_WHEEL, 2 * 1024 * 1024);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", wheel)),
      value => value.toString(16).padStart(2, "0")).join("");
    if (digest !== ENGINE_SHA256) reject("engine_integrity_mismatch");
    pyodide.FS.mkdirTree("/dsp-engine");
    pyodide.unpackArchive(wheel, "zip", { extractDir: "/dsp-engine" });
    pyodide.runPython("import sys\nsys.path.insert(0, '/dsp-engine')");
    const bridge = new TextDecoder("utf-8", { fatal: true }).decode(await fetchAsset("./bridge.py", 256 * 1024));
    pyodide.runPython(bridge);
    pyodide.globals.set("_web_pyodide_version", pyodide.version);
    runtime = JSON.parse(pyodide.runPython("runtime_info(_web_pyodide_version)"));
    pyodide.globals.delete("_web_pyodide_version");
    if (runtime.engine !== "0.1.20") reject("engine_version_mismatch");
    pyodide.FS.mkdirTree("/web-jobs");
    self.postMessage({ type: "ready", runtime });
    return pyodide;
  })().catch((error) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

function removeTree(path) {
  // Every path is assigned by this worker; visitor strings never reach FS APIs.
  for (const name of pyodide.FS.readdir(path)) {
    if (name === "." || name === "..") continue;
    const child = `${path}/${name}`;
    if (pyodide.FS.isDir(pyodide.FS.lstat(child).mode)) removeTree(child);
    else pyodide.FS.unlink(child);
  }
  pyodide.FS.rmdir(path);
}

async function run(message) {
  const spec = validateRequest(message); // Reject before initialization or FS writes.
  await initialize();
  if (++jobNumber > 999999999) reject("web_session_exhausted");
  const root = `/web-jobs/job-${jobNumber}`;
  try {
    pyodide.FS.mkdirTree(root);
    for (let index = 0; index < spec.cases.length; index += 1) {
      const folder = `${root}/inputs/${String(index + 1).padStart(3, "0")}`;
      pyodide.FS.mkdirTree(folder);
      for (const role of Object.keys(spec.cases[index].sizes)) {
        pyodide.FS.writeFile(`${folder}/${role}.wav`, new Uint8Array(message.cases[index][role]));
      }
    }
    progress(spec.mode === "suite" ? "기준 버전과 새 버전의 결과를 비교하고 있습니다." : "원본과 처리본의 시간 대응을 분석하고 있습니다.");
    pyodide.globals.set("_web_request_json", JSON.stringify(spec));
    pyodide.globals.set("_web_input_root", root);
    const outcome = JSON.parse(pyodide.runPython("dispatch_web_request(_web_request_json, _web_input_root)"));
    if (!outcome.ok) reject(outcome.code);
    const payload = outcome.payload;
    payload.runtime = runtime;
    self.postMessage({ type: "result", id: message.id, payload });
  } finally {
    pyodide.globals.delete("_web_request_json");
    pyodide.globals.delete("_web_input_root");
    if (pyodide.FS.analyzePath(root).exists) removeTree(root);
  }
}

self.onmessage = async ({ data }) => {
  const id = data?.id ?? null;
  if (active) {
    self.postMessage({ type: "error", id, code: "web_worker_busy", message: "진행 중인 분석을 마친 뒤 다시 시도해 주세요." });
    return;
  }
  active = true;
  try {
    if (data?.type === "init") {
      exactFields(data, ["type"], "invalid_web_request");
      if (runtime) self.postMessage({ type: "ready", runtime });
      else await initialize();
    } else await run(data);
  } catch (error) {
    const code = typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,127}$/.test(error.code)
      ? error.code : "browser_analysis_failed";
    self.postMessage({ type: "error", id, code,
      message: "분석을 완료하지 못했습니다. 입력 형식과 설정을 확인하거나 엔진을 다시 준비해 주세요." });
    // Diagnostics contain no audio, visitor labels, paths, or Python traceback.
  } finally { active = false; }
};
