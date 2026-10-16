"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_FILE = 10000000;
  const MAX_TOTAL = 64 * 1024 * 1024;
  const MAX_CASES = 6;
  const FFT_MODEL = "scipy_fft_periodic_48k_16k_pcm16_postedit_v1";
  const ROLES = { source: ["원본", "SOURCE"], baseline: ["기준 출력", "BASELINE"], candidate: ["새 출력", "CANDIDATE"] };
  const NOTES = {
    v1: "기본 비교입니다. 식별 가능한 누락·인접 반복 후보를 진단하며 전체 음질을 승인하지 않습니다.",
    v9: "전역 문맥을 이용하는 연구 후보입니다. 실제 사용 환경에서의 정확도 개선은 확정되지 않았습니다.",
    v10: "동일 샘플률·변환 없는 PCM의 짧은 내부 누락·인접 반복 50–200 ms를 정밀 비교합니다. 지원 범위 밖은 기존 비교를 사용할 수 있습니다.",
    v11: "v10의 짧은 내부 구간에 시작·끝 손실 50–2000 ms 검사를 더합니다. 동일 샘플률·변환 없는 PCM용입니다.",
    v12: "SciPy FFT 주기 신호 방식으로 전체 원본을 48→16 kHz 변환하고 PCM16 반올림한 후 편집한 경로만 비교합니다. 원본 샘플 수는 3의 배수여야 합니다."
  };
  const GATES = { clear_supported_temporal_check: "시간적 후보 없음", review_required: "구간 검토 필요", blocked: "판단 보류" };
  const REGRESSIONS = { new_candidates: "신규 후보 관측", no_new_candidates_observed: "신규 후보 미관측", inconclusive: "버전 간 비교 불가" };
  let mode = "pair";
  let busy = false;
  let worker = null;
  let workerGeneration = 0;
  let readyPromise = null;
  let readyResolve = null;
  let readyReject = null;
  let workerInitTimer = null;
  let runtime = null;
  let currentRun = null;
  let runCounter = 0;
  let resultPayload = null;
  let activeAudio = null;
  let pendingAudio = null;
  let audioGeneration = 0;
  let listenTimer = null;
  let nextCase = 1;
  let loadGeneration = 0;
  const pair = { case_id: "pair-01", files: {}, entries: {} };
  const suite = [];
  const objectUrls = new Set();

  function element(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }
  function size(bytes) { return bytes < 1000000 ? `${(bytes / 1000).toFixed(0)} KB` : `${(bytes / 1000000).toFixed(2)} MB`; }
  function seconds(ms) { return `${(ms / 1000).toFixed(3).replace(/\.?0+$/, "")}초`; }
  function validTime(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
  function validRange(v) { return Array.isArray(v) && v.length === 2 && v.every(validTime) && v[1] > v[0]; }
  function interval(v) { return `${seconds(v[0])}–${seconds(v[1])}`; }
  function caseRoles() { return mode === "pair" ? ["source", "candidate"] : ["source", "baseline", "candidate"]; }
  function currentCases() { return mode === "pair" ? [pair] : suite; }
  function totalBytes() { return currentCases().reduce((n, item) => n + caseRoles().reduce((s, role) => s + (item.files[role]?.size || 0), 0), 0); }
  function setRuntimeState(state, message) {
    $("runtime-status").className = `runtime-status ${state}`;
    $("runtime-label").textContent = message;
  }
  function showError(message, code = "input_error") {
    $("error-message").textContent = message;
    $("error-code").textContent = code;
    $("error-banner").hidden = false;
  }
  function clearError() { $("error-banner").hidden = true; }
  function stopAudio() {
    audioGeneration++;
    if (pendingAudio) pendingAudio.cancel();
    pendingAudio = null;
    if (activeAudio) activeAudio.pause();
    if (listenTimer) clearInterval(listenTimer);
    activeAudio = null;
    listenTimer = null;
  }
  function clearResult() {
    resultPayload = null;
    stopAudio();
    $("result-content").hidden = true;
    $("result-actions").hidden = true;
    $("result-count").hidden = true;
    $("empty-state").hidden = busy;
    $("candidate-list").replaceChildren();
    $("result-summary").replaceChildren();
    $("technical-json").textContent = "";
    $("report-frame").removeAttribute("srcdoc");
  }
  function configError() {
    const engine = $("engine-select").value;
    if (["v10", "v11"].includes(engine) && ($("allow-gain").checked || $("allow-resampling").checked)) return "이 정밀 검사는 변환 없는 동일 샘플률 PCM용입니다. 실제 처리에 맞는 기본 비교를 선택하세요.";
    if (engine === "v12" && ($("allow-gain").checked || !$("allow-resampling").checked || !$("fft-confirm").checked)) return "FFT 방식은 음량 변경 없이 실제 수행한 48→16 kHz 변환 경로를 직접 확인해야 합니다. 리샘플링과 경로 확인을 체크하세요.";
    return "";
  }
  function updateConfig() {
    const engine = $("engine-select").value;
    $("engine-note").textContent = NOTES[engine];
    $("fft-confirm-label").hidden = engine !== "v12";
    $("mode-warning").textContent = configError();
    $("mode-warning").hidden = !configError();
    updateControls();
  }
  function updateControls() {
    document.querySelectorAll("input, select, #add-case, #demo-button, #clear-button, .file-picker, .file-clear, .remove-case, .nav-item").forEach((el) => { el.disabled = busy; });
    const complete = currentCases().length > 0 && currentCases().every((item) => caseRoles().every((role) => item.files[role]));
    const versions = mode === "pair" || ($("baseline-version").value.trim() && $("candidate-version").value.trim());
    $("run-button").disabled = busy || !complete || !versions || !!configError() || totalBytes() > MAX_TOTAL;
    $("cancel-button").hidden = !busy;
    $("add-case").disabled = busy || suite.length >= MAX_CASES;
    $("run-label").textContent = busy ? "검사 실행 중" : mode === "pair" ? "비교 검사 시작" : "회귀 검사 시작";
    $("run-note").textContent = busy ? "오디오를 전송하지 않고 이 탭에서 실행합니다." : !complete ? "각 위치에 비교할 WAV 파일을 선택하세요." : !versions ? "기준 버전과 새 버전 이름을 입력하세요." : totalBytes() > MAX_TOTAL ? "파일 합계가 64 MiB를 초과했습니다." : "준비 완료 · 파일은 이 브라우저 안에서만 사용됩니다.";
    $("busy-state").hidden = !busy;
    $("empty-state").hidden = busy || !!resultPayload;
    $("results-panel").setAttribute("aria-busy", String(busy));
    $("case-count").textContent = `${suite.length} / ${MAX_CASES}`;
  }
  function releaseEntry(entry) {
    if (entry.url) { URL.revokeObjectURL(entry.url); objectUrls.delete(entry.url); }
    entry.audio.pause();
    entry.audio.removeAttribute("src");
    entry.audio.load();
    entry.url = null;
  }
  function invalidateDemo() {
    loadGeneration++;
    $("demo-button").lastChild.textContent = "예시 파일로 시작";
    $("demo-button").disabled = busy;
  }
  function setFile(item, role, file, fromDemo = false) {
    if (busy) return false;
    if (!fromDemo) invalidateDemo();
    if (file && (!/\.wav$/i.test(file.name) || file.size === 0 || file.size > MAX_FILE)) {
      showError("비어 있지 않은 WAV 파일을 선택하세요. 파일 하나는 최대 10,000,000바이트입니다.", "unsupported_file");
      return false;
    }
    const entry = item.entries[role];
    const old = item.files[role];
    if (file && totalBytes() - (old?.size || 0) + file.size > MAX_TOTAL) {
      showError("이번 검사 파일 합계는 64 MiB 이하여야 합니다. 파일 수나 길이를 줄여 주세요.", "total_input_limit");
      return false;
    }
    releaseEntry(entry);
    item.files[role] = file;
    entry.input.value = "";
    entry.card.classList.toggle("has-file", !!file);
    entry.clear.hidden = !file;
    entry.audio.hidden = !file;
    entry.name.textContent = file ? file.name : "파일 선택 또는 끌어놓기";
    entry.meta.textContent = file ? `${size(file.size)} · 파일을 바꾸려면 클릭` : "PCM16 모노 WAV";
    if (file) {
      entry.url = URL.createObjectURL(file);
      objectUrls.add(entry.url);
      entry.audio.src = entry.url;
    }
    clearResult();
    clearError();
    updateControls();
    return true;
  }
  function createFileCard(item, role) {
    const card = element("div", "file-card");
    const header = element("div", "file-card-header");
    const label = element("span", "role-label");
    label.append(element("span", `role-marker ${role}`), document.createTextNode(mode === "pair" && role === "candidate" ? "처리본" : ROLES[role][0]));
    const en = element("span", "file-role-en", role === "candidate" && item === pair ? "PROCESSED" : ROLES[role][1]);
    const clear = element("button", "file-clear");
    clear.type = "button";
    clear.append(icon("close"));
    clear.setAttribute("aria-label", `${ROLES[role][0]} 파일 제거`);
    clear.hidden = true;
    header.append(label, en, clear);
    const picker = element("button", "file-picker");
    picker.type = "button";
    picker.setAttribute("aria-label", `${item.case_id} ${ROLES[role][0]} WAV 선택`);
    const upload = element("span", "upload-icon");
    upload.append(icon("upload"));
    const name = element("strong", "", "파일 선택 또는 끌어놓기");
    const meta = element("small", "", "PCM16 모노 WAV");
    picker.append(upload, name, meta);
    const input = element("input", "sr-only");
    input.type = "file";
    input.accept = ".wav,audio/wav,audio/x-wav";
    input.tabIndex = -1;
    input.setAttribute("aria-label", `${item.case_id} ${ROLES[role][0]} WAV 파일`);
    const audio = element("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.hidden = true;
    audio.setAttribute("aria-label", `${item.case_id} ${ROLES[role][0]} 재생`);
    audio.addEventListener("play", () => {
      document.querySelectorAll("audio").forEach((other) => { if (other !== audio) other.pause(); });
    });
    card.append(header, picker, input, audio);
    item.entries[role] = { card, input, audio, clear, name, meta, url: null };
    picker.addEventListener("click", () => input.click());
    input.addEventListener("change", () => { if (input.files?.[0]) setFile(item, role, input.files[0]); });
    clear.addEventListener("click", () => setFile(item, role, null));
    card.addEventListener("dragover", (e) => { e.preventDefault(); if (!busy) card.classList.add("dragging"); });
    card.addEventListener("dragleave", () => card.classList.remove("dragging"));
    card.addEventListener("drop", (e) => {
      e.preventDefault(); card.classList.remove("dragging");
      if (busy) return;
      if (e.dataTransfer.files.length !== 1) return showError("파일 위치마다 WAV 한 개씩 놓아 주세요.", "one_file_per_slot");
      setFile(item, role, e.dataTransfer.files[0]);
    });
    return card;
  }
  function addCase() {
    if (busy || suite.length >= MAX_CASES) return;
    const item = { case_id: `case-${String(nextCase++).padStart(2, "0")}`, files: {}, entries: {} };
    const section = element("section", "suite-case");
    const heading = element("div", "suite-case-heading");
    const remove = element("button", "icon-button remove-case");
    remove.type = "button";
    remove.setAttribute("aria-label", `${item.case_id} 사례 제거`);
    remove.append(icon("close"));
    heading.append(element("h3", "", `검사 사례 · ${item.case_id}`), remove);
    const grid = element("div", "file-grid");
    ["source", "baseline", "candidate"].forEach((role) => grid.append(createFileCard(item, role)));
    section.append(heading, grid);
    item.section = section;
    suite.push(item);
    $("suite-cases").append(section);
    remove.addEventListener("click", () => {
      if (busy) return;
      invalidateDemo();
      Object.values(item.entries).forEach(releaseEntry);
      suite.splice(suite.indexOf(item), 1);
      section.remove();
      clearResult();
      if (!suite.length) addCase();
      updateControls();
    });
    clearResult();
    updateControls();
    return item;
  }
  function setMode(next) {
    if (busy || next === mode) return;
    invalidateDemo();
    mode = next;
    document.querySelectorAll(".nav-item").forEach((button) => {
      const selected = button.dataset.mode === mode;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    $("pair-files").hidden = mode !== "pair";
    $("suite-inputs").hidden = mode !== "suite";
    $("breadcrumb-title").textContent = mode === "pair" ? "개별 비교" : "회귀 검사";
    $("page-title").textContent = mode === "pair" ? "소리의 변화를, 구간으로 확인하세요." : "새 버전에서도, 놓치는 소리 없도록.";
    $("page-description").textContent = mode === "pair" ? "같은 원본의 처리 전후 WAV를 비교해 누락·인접 반복 후보를 찾습니다." : "원본·기준 출력·새 출력을 함께 비교하고 새로 관측한 후보를 구분합니다.";
    $("input-description").replaceChildren(document.createTextNode(mode === "pair" ? "서로 따로 녹음한 파일이 아닌, 같은 원본과 그 처리 결과를 선택하세요." : "사례마다 같은 원본에서 만든 두 버전의 출력을 선택하세요. 입력 해시는 자동 기록됩니다."));
    clearError();
    clearResult();
    updateControls();
  }
  function destroyWorker(reason = "cancelled", failure = null) {
    workerGeneration++;
    if (workerInitTimer !== null) clearTimeout(workerInitTimer);
    workerInitTimer = null;
    if (worker) worker.terminate();
    worker = null;
    runtime = null;
    if (readyReject) readyReject(failure || Object.assign(new Error("실행 환경 준비가 중단되었습니다."), { code: reason }));
    readyPromise = readyResolve = readyReject = null;
    if (currentRun) {
      clearTimeout(currentRun.timer);
      currentRun.reject(failure || Object.assign(new Error(reason === "analysis_timeout" ? "검사 시간이 초과되었습니다. 파일 수나 길이를 줄여 다시 시도하세요." : "검사가 취소되었습니다."), { code: reason }));
      currentRun = null;
    }
  }
  function ensureWorker() {
    if (readyPromise) return readyPromise;
    const generation = ++workerGeneration;
    readyPromise = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const pending = readyPromise;
    // A worker may be cancelled before a caller starts awaiting initialization.
    readyPromise.catch(() => {});
    setRuntimeState("loading", "실행 환경 내려받는 중");
    try { worker = new Worker("./dsp-worker.js"); }
    catch (err) {
      destroyWorker("worker_start_failed", Object.assign(new Error("Worker를 시작하지 못했습니다. 브라우저 지원과 실행 제한을 확인하고 다시 시도하세요."), { code: "worker_start_failed" }));
      setRuntimeState("failed", "Worker 실행 제한");
      return pending;
    }
    workerInitTimer = setTimeout(() => {
      if (generation !== workerGeneration || runtime) return;
      destroyWorker("runtime_timeout", Object.assign(new Error("실행 환경 준비 시간이 초과되었습니다. 네트워크 연결을 확인하고 다시 시도하세요."), { code: "runtime_timeout" }));
      setRuntimeState("failed", "실행 환경 준비 실패");
    }, 240000);
    worker.addEventListener("message", (event) => {
      if (generation !== workerGeneration) return;
      const data = event.data || {};
      if (data.type === "progress") {
        $("progress-message").textContent = typeof data.message === "string" ? data.message : "신호를 처리하고 있습니다.";
      } else if (data.type === "ready") {
        if (!readyResolve) return;
        clearTimeout(workerInitTimer);
        workerInitTimer = null;
        runtime = data.runtime;
        setRuntimeState("ready", "브라우저 엔진 준비 완료");
        readyResolve(runtime);
        readyResolve = readyReject = null;
      } else if (data.type === "result" && currentRun && data.id === currentRun.id) {
        const run = currentRun;
        currentRun = null;
        clearTimeout(run.timer);
        run.resolve(data.payload);
      } else if (data.type === "error") {
        const err = Object.assign(new Error(typeof data.message === "string" ? data.message : "검사를 실행하지 못했습니다."), { code: data.code || "worker_error" });
        if (currentRun && data.id === currentRun.id) {
          const run = currentRun;
          currentRun = null;
          clearTimeout(run.timer);
          run.reject(err);
        } else if (!runtime && readyReject) {
          destroyWorker(err.code, err);
          setRuntimeState("failed", "실행 환경 준비 실패");
        }
      }
    });
    worker.addEventListener("error", (event) => {
      if (generation !== workerGeneration) return;
      const err = Object.assign(new Error(event.message || "브라우저 실행 환경이 중단되었습니다. 메모리와 브라우저 지원을 확인해 주세요."), { code: "worker_crashed" });
      destroyWorker("worker_crashed", err);
      setRuntimeState("failed", "브라우저 엔진 중단");
    });
    try { worker.postMessage({ type: "init" }); }
    catch (err) {
      destroyWorker("worker_message_failed", Object.assign(new Error("실행 환경에 요청을 전달하지 못했습니다. 다시 시도해 주세요."), { code: "worker_message_failed" }));
      setRuntimeState("failed", "실행 환경 요청 실패");
    }
    return pending;
  }
  async function validateWav(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const fourcc = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    if (buffer.byteLength < 44 || fourcc(0) !== "RIFF" || fourcc(8) !== "WAVE") throw Object.assign(new Error(`${file.name}: RIFF/WAVE 형식이 아닙니다. PCM16 모노 WAV를 선택하세요.`), { code: "invalid_wav_header" });
    if (buffer.byteLength > MAX_FILE || view.getUint32(4, true) !== buffer.byteLength - 8) throw Object.assign(new Error(`${file.name}: WAV 전체 길이 표기가 파일과 일치하지 않습니다.`), { code: "invalid_wav_length" });
    let format = null;
    let dataBytes = null;
    for (let pos = 12; pos < buffer.byteLength;) {
      if (buffer.byteLength - pos < 8) throw Object.assign(new Error(`${file.name}: WAV 청크 헤더가 완전하지 않습니다.`), { code: "invalid_wav_chunk" });
      const tag = fourcc(pos);
      const length = view.getUint32(pos + 4, true);
      if (pos + 8 + length + (length % 2) > buffer.byteLength) throw Object.assign(new Error(`${file.name}: WAV 청크 길이가 파일 범위를 벗어납니다.`), { code: "invalid_wav_chunk" });
      if (tag === "fmt ") {
        if (format !== null || ![16, 18].includes(length) || length === 18 && view.getUint16(pos + 24, true) !== 0) throw Object.assign(new Error(`${file.name}: WAV 형식 청크가 중복되었거나 지원 형식이 아닙니다.`), { code: "invalid_wav_format_chunk" });
        format = { code: view.getUint16(pos + 8, true), channels: view.getUint16(pos + 10, true), rate: view.getUint32(pos + 12, true), byteRate: view.getUint32(pos + 16, true), bits: view.getUint16(pos + 22, true), align: view.getUint16(pos + 20, true) };
      }
      if (tag === "data") {
        if (dataBytes !== null) throw Object.assign(new Error(`${file.name}: WAV 데이터 청크가 중복되었습니다.`), { code: "invalid_wav_data_chunk" });
        dataBytes = length;
      }
      pos += 8 + length + (length % 2);
    }
    if (!format || format.code !== 1 || format.channels !== 1 || format.bits !== 16 || format.align !== 2 || ![8000, 16000, 44100, 48000].includes(format.rate) || format.byteRate !== format.rate * 2 || dataBytes === null || dataBytes % 2) throw Object.assign(new Error(`${file.name}: PCM16 모노, 8 / 16 / 44.1 / 48 kHz WAV만 지원합니다. 자동 변환은 수행하지 않습니다.`), { code: "unsupported_wav_format" });
    const duration = dataBytes / 2 / format.rate;
    if (duration < 2 || duration > 30) throw Object.assign(new Error(`${file.name}: 길이가 ${duration.toFixed(2)}초입니다. 2–30초 파일을 선택하세요.`), { code: "unsupported_wav_duration" });
    return buffer;
  }
  async function run() {
    if (busy || $("run-button").disabled) return;
    invalidateDemo();
    clearError();
    clearResult();
    busy = true;
    updateControls();
    document.querySelectorAll("audio").forEach((audio) => audio.pause());
    $("progress-message").textContent = "파일 형식과 크기를 확인하고 있습니다.";
    const id = `run-${++runCounter}`;
    const generation = runCounter;
    const runMode = mode;
    const selectedCases = [...currentCases()];
    const roles = [...caseRoles()];
    const configuration = { engine: $("engine-select").value, allow_gain: $("allow-gain").checked, allow_resampling: $("allow-resampling").checked, max_delay_ms: 1000, resampling_model: $("engine-select").value === "v12" ? FFT_MODEL : null };
    try {
      const cases = [];
      const transfer = [];
      for (const item of selectedCases) {
        const prepared = { case_id: item.case_id };
        for (const role of roles) {
          const buffer = await validateWav(item.files[role]);
          if (generation !== runCounter) return;
          prepared[role] = buffer;
          transfer.push(buffer);
        }
        cases.push(prepared);
      }
      $("progress-message").textContent = "첫 실행은 Python·NumPy·SciPy 환경 다운로드가 필요합니다.";
      await ensureWorker();
      if (generation !== runCounter) return;
      $("progress-message").textContent = "검사 엔진을 실행하고 있습니다. 탭을 열어 두세요.";
      const payload = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!currentRun || currentRun.id !== id) return;
          destroyWorker("analysis_timeout");
          setRuntimeState("failed", "검사 시간 초과");
        }, 600000);
        currentRun = { id, resolve, reject, timer };
        try {
          worker.postMessage({ type: "run", id, mode: runMode, configuration, versions: runMode === "pair" ? { baseline: "pair-reference", candidate: "pair-processed" } : { baseline: $("baseline-version").value.trim(), candidate: $("candidate-version").value.trim() }, cases }, transfer);
        } catch (err) {
          destroyWorker("worker_message_failed", Object.assign(new Error("검사 요청을 전달하지 못했습니다. 파일을 확인하고 다시 시도해 주세요."), { code: "worker_message_failed" }));
          setRuntimeState("failed", "검사 요청 실패");
        }
      });
      if (generation !== runCounter) return;
      if (!payload || payload.kind !== runMode || typeof payload.report_html !== "string" || !payload.result || payload.result.complete_audio_approval !== false || payload.result.commercial_performance_validated !== false) throw Object.assign(new Error("결과 형식을 확인하지 못했습니다. 통과로 간주하지 않습니다."), { code: "invalid_worker_result" });
      resultPayload = payload;
      renderResult(payload, selectedCases);
    } catch (err) {
      if (generation !== runCounter) return;
      clearResult();
      showError(err.message || "검사를 완료하지 못했습니다.", err.code || "analysis_failed");
    } finally {
      if (generation === runCounter) { busy = false; updateControls(); }
    }
  }
  function cancel() {
    if (!busy) return;
    runCounter++;
    destroyWorker();
    busy = false;
    clearResult();
    updateControls();
    $("run-note").textContent = "검사를 취소했습니다. 이전 작업의 결과는 사용하지 않습니다.";
    setRuntimeState("", "실행 환경 준비 전");
  }
  async function listen(item, role, beginMs, endMs) {
    const audio = item.entries[role]?.audio;
    if (!audio || !item.files[role] || !validTime(beginMs)) return;
    stopAudio();
    const generation = audioGeneration;
    try {
      if (audio.readyState < 1) await new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          audio.removeEventListener("loadedmetadata", loaded);
          audio.removeEventListener("error", failed);
          if (pendingAudio?.cancel === cancelled) pendingAudio = null;
        };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("재생하지 못했습니다.")); };
        const cancelled = () => { cleanup(); reject(new Error("재생이 취소되었습니다.")); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error("재생 정보를 읽지 못했습니다.")); }, 5000);
        pendingAudio = { cancel: cancelled };
        audio.addEventListener("loadedmetadata", loaded, { once: true });
        audio.addEventListener("error", failed, { once: true });
        audio.load();
      });
      if (generation !== audioGeneration) return;
      audio.currentTime = Math.max(0, beginMs / 1000 - 0.3);
      activeAudio = audio;
      await audio.play();
      if (generation !== audioGeneration) return;
      const end = validTime(endMs) ? endMs / 1000 + 0.35 : beginMs / 1000 + 1.5;
      listenTimer = setInterval(() => { if (audio.currentTime >= end || audio.ended) stopAudio(); }, 80);
    } catch (err) { if (generation === audioGeneration) showError("브라우저에서 구간을 재생하지 못했습니다. 위 재생기나 별도 플레이어에서 파일을 확인하세요.", "audio_playback_failed"); }
  }
  function makeSummary(gate, title, text, subtitle) {
    const state = gate === "review_required" ? "review" : gate === "clear_supported_temporal_check" ? "" : "blocked";
    const banner = element("div", `summary-banner ${state}`);
    const body = element("div");
    body.append(element("div", "summary-kicker", subtitle), element("h3", "", title), element("p", "", text));
    banner.append(element("span", "summary-symbol", state === "review" ? "!" : state === "blocked" ? "–" : "✓"), body);
    return banner;
  }
  function eventCard(event, index, item, role = "candidate") {
    if (!event || !["delete", "repeat"].includes(event.type)) return null;
    const deleted = event.type === "delete";
    const source = deleted ? event.reference_interval_ms : event.reference_source_interval_ms;
    const processed = deleted ? event.processed_boundary_ms : event.processed_added_interval_ms;
    if (!validRange(source) || (deleted ? !validTime(processed) : !validRange(processed))) return null;
    const card = element("article", "candidate-card");
    const heading = element("div", "candidate-heading");
    const title = element("h3");
    title.append(element("span", "candidate-index", String(index + 1).padStart(2, "0")), document.createTextNode(deleted ? event.location === "head" ? "시작 손실 후보" : event.location === "tail" ? "끝 손실 후보" : "누락 후보" : "인접 반복 후보"));
    heading.append(title, element("span", "candidate-type", deleted ? "MISSING INTERVAL" : "ADJACENT REPEAT"));
    const axes = element("div", "event-axes");
    function axis(fileRole, label, position, start, end) {
      const box = element("div", "event-axis");
      const button = element("button", "button", "구간 듣기");
      button.type = "button";
      button.prepend(icon("play"));
      button.setAttribute("aria-label", `${item.case_id} ${label} ${position} 듣기`);
      button.addEventListener("click", () => listen(item, fileRole, start, end));
      box.append(element("small", "", label), element("strong", "", position), button);
      return box;
    }
    axes.append(axis("source", "원본 · 출처 구간", interval(source), source[0], source[1]), axis(role, mode === "suite" ? "새 출력 · 대응 위치" : "처리본 · 대응 위치", deleted ? `${seconds(processed)} 경계` : interval(processed), deleted ? processed : processed[0], deleted ? processed + 700 : processed[1]));
    card.append(heading, axes, element("p", "event-next", deleted ? "원본 구간과 출력의 대응 경계를 듣고 의도하지 않은 누락인지 확인하세요. 각 파일의 시간축은 독립적이며 실제 편집 원인은 확정하지 않습니다." : "인접 복사 중 뒤쪽 구간을 표시합니다. 원본 출처와 출력의 반복 구간을 듣고 의도한 처리인지 확인하세요."));
    return card;
  }
  function showEvents(result, item, container) {
    let count = 0;
    (Array.isArray(result?.events) ? result.events : []).forEach((event, i) => { const card = eventCard(event, i, item); if (card) { container.append(card); count++; } });
    return count;
  }
  function renderResult(payload, cases) {
    const result = payload.result;
    const summary = $("result-summary");
    const list = $("candidate-list");
    summary.replaceChildren();
    list.replaceChildren();
    if (payload.kind === "pair") {
      const gate = payload.gate?.gate_state;
      if (!Object.hasOwn(GATES, gate) || payload.gate.contract_valid !== true) throw Object.assign(new Error("검사 상태를 확인하지 못했습니다. 통과로 처리하지 않습니다."), { code: "invalid_gate_result" });
      summary.append(makeSummary(gate, GATES[gate], gate === "clear_supported_temporal_check" ? "지원 범위에서 누락·인접 반복 후보가 관측되지 않았습니다. 전체 음질이 정상이라는 뜻은 아닙니다." : gate === "review_required" ? "아래 후보 위치를 직접 듣고 의도한 처리인지 확인하세요. 결함이나 실제 편집 원인을 자동 확정하지 않습니다." : "입력이나 지원 범위로 결론을 확정하지 못했습니다. 정상·결함 없음으로 해석하지 마세요.", `${result.engine || "DSP ENGINE"} · 실행 완료`));
      const n = showEvents(result, cases[0], list);
      if (!n) list.append(element("p", "no-events", gate === "blocked" ? `보류 사유: ${result.reason_code || payload.gate.reason_code || "보고서에서 상세 내용을 확인하세요."}` : "표시할 시간적 후보가 없습니다. 입력 조건과 전체 보고서를 함께 확인하세요."));
      $("result-count").textContent = `${n}개 후보`;
    } else {
      const s = result.summary;
      if (!s || !Object.hasOwn(GATES, s.current_gate_state) || !Object.hasOwn(REGRESSIONS, s.regression_state) || !Array.isArray(result.cases)) throw Object.assign(new Error("회귀 검사 요약을 확인하지 못했습니다."), { code: "invalid_suite_result" });
      summary.append(makeSummary(s.current_gate_state, GATES[s.current_gate_state], "현재 새 출력의 검사 상태와 버전 간 변화는 다릅니다. 신규 후보 미관측이나 이번 미관측은 해결·배포 승인이 아닙니다.", `${s.completed_count} / ${s.case_count} 사례 완료 · 회귀 검사`));
      const metrics = element("div", "summary-metrics");
      [["신규 후보", s.new_candidate_count], ["유지 후보", s.persistent_candidate_count], ["이번 미관측", s.not_observed_now_count], ["비교 불가 사례", s.inconclusive_case_count]].forEach(([label, value]) => { const metric = element("div", "summary-metric"); metric.append(element("small", "", label), element("strong", "", String(value))); metrics.append(metric); });
      const states = element("div", "suite-state-grid");
      [["현재 검사 상태", GATES[s.current_gate_state]], ["버전 간 변화 관측", REGRESSIONS[s.regression_state]]].forEach(([label, value]) => { const box = element("div", "suite-state-card"); box.append(element("small", "", label), element("strong", "", value)); states.append(box); });
      summary.append(metrics, states);
      result.cases.forEach((item) => {
        const section = element("article", "suite-result-case");
        const heading = element("div", "suite-case-title");
        const analyzed = item.candidate_analysis;
        const state = item.status !== "completed" || !analyzed || analyzed.status !== "analyzed" ? "blocked" : analyzed.events?.length ? "review_required" : "clear_supported_temporal_check";
        heading.append(element("h3", "", item.case_id), element("span", `state-chip ${state === "blocked" ? "blocked" : state === "review_required" ? "review" : ""}`, GATES[state]));
        section.append(heading);
        const delta = item.delta;
        section.append(element("p", "delta-description", delta?.status === "compared" ? `신규 ${delta.new_candidates.length} · 유지 ${delta.persistent_pairs.length} · 이번 미관측 ${delta.not_observed_now.length}` : `비교 불가 · ${item.reason_code || delta?.reason_code || "inconclusive"}`));
        const selected = cases.find((c) => c.case_id === item.case_id);
        if (selected && analyzed) showEvents(analyzed, selected, section);
        if (analyzed?.reason_code) section.append(element("p", "event-reason", `보류 사유: ${analyzed.reason_code}`));
        list.append(section);
      });
      $("result-count").textContent = `${s.case_count}개 사례`;
    }
    $("report-frame").srcdoc = payload.report_html;
    $("technical-json").textContent = JSON.stringify({ runtime: payload.runtime || runtime, result: result, ...(payload.gate ? { gate: payload.gate } : {}) }, null, 2);
    $("result-content").hidden = false;
    $("result-actions").hidden = false;
    $("result-count").hidden = false;
  }
  async function demo() {
    if (busy) return;
    const generation = ++loadGeneration;
    $("demo-button").disabled = true;
    $("demo-button").lastChild.textContent = "예시 불러오는 중";
    clearError();
    try {
      const roles = [...caseRoles()];
      const files = await Promise.all(roles.map(async (role) => {
        const response = await fetch(`./demo/${role}.wav`, { credentials: "same-origin" });
        if (!response.ok) throw new Error("예시 파일을 내려받지 못했습니다.");
        const blob = await response.blob();
        return [role, new File([blob], `demo-${role}.wav`, { type: "audio/wav" })];
      }));
      if (generation !== loadGeneration || busy) return;
      const item = mode === "pair" ? pair : suite[0];
      files.forEach(([role, file]) => setFile(item, role, file, true));
      $("engine-select").value = "v11";
      $("allow-gain").checked = false;
      $("allow-resampling").checked = false;
      $("fft-confirm").checked = false;
      if (mode === "suite") { $("baseline-version").value = "demo-baseline"; $("candidate-version").value = "demo-100ms-delete"; }
      updateConfig();
      $("run-note").textContent = "자체 제작 예시 · 2초 지점의 100 ms 누락. 실제 고객 환경 성능을 의미하지 않습니다.";
    } catch (err) { if (generation === loadGeneration) showError(err.message, "demo_load_failed"); }
    finally { if (generation === loadGeneration) { $("demo-button").lastChild.textContent = "예시 파일로 시작"; updateControls(); } }
  }
  function download(kind) {
    if (!resultPayload) return;
    const text = kind === "html" ? resultPayload.report_html : JSON.stringify({ ...resultPayload, report_html: undefined }, null, 2);
    const blob = new Blob([text], { type: kind === "html" ? "text/html;charset=utf-8" : "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = element("a");
    link.href = url;
    link.download = `dsp-${resultPayload.kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.${kind}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function clearAll() {
    if (busy) return;
    invalidateDemo();
    [pair, ...suite].forEach((item) => Object.keys(item.entries).forEach((role) => {
      const entry = item.entries[role];
      releaseEntry(entry);
      item.files[role] = null;
      entry.card.classList.remove("has-file");
      entry.clear.hidden = true;
      entry.audio.hidden = true;
      entry.input.value = "";
      entry.name.textContent = "파일 선택 또는 끌어놓기";
      entry.meta.textContent = "PCM16 모노 WAV";
    }));
    $("baseline-version").value = "";
    $("candidate-version").value = "";
    clearResult();
    clearError();
    updateControls();
  }

  ["source", "candidate"].forEach((role) => $("pair-files").append(createFileCard(pair, role)));
  addCase();
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  ["engine-select", "allow-gain", "allow-resampling", "fft-confirm"].forEach((id) => $(id).addEventListener("change", () => { invalidateDemo(); clearResult(); updateConfig(); }));
  ["baseline-version", "candidate-version"].forEach((id) => $(id).addEventListener("input", () => { invalidateDemo(); clearResult(); updateControls(); }));
  $("run-button").addEventListener("click", run);
  $("cancel-button").addEventListener("click", cancel);
  $("add-case").addEventListener("click", () => { invalidateDemo(); addCase(); });
  $("demo-button").addEventListener("click", demo);
  $("clear-button").addEventListener("click", clearAll);
  $("download-json").addEventListener("click", () => download("json"));
  $("download-html").addEventListener("click", () => download("html"));
  $("dismiss-error").addEventListener("click", clearError);
  $("help-button").addEventListener("click", () => $("help-dialog").showModal());
  $("footer-help").addEventListener("click", () => $("help-dialog").showModal());
  $("close-help").addEventListener("click", () => $("help-dialog").close());
  $("help-dialog").addEventListener("click", (event) => { if (event.target === $("help-dialog")) { const r = $("help-dialog").getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $("help-dialog").close(); } });
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());
  window.addEventListener("pagehide", () => {
    runCounter++;
    loadGeneration++;
    busy = false;
    stopAudio();
    destroyWorker("page_left");
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    clearAll();
    setRuntimeState("", "실행 환경 준비 전");
  });
  updateConfig();
})();
