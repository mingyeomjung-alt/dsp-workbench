"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_FILE = 10000000;
  const MAX_TOTAL = 64 * 1024 * 1024;
  const MAX_CASES = 6;
  const FFT_MODEL = "scipy_fft_periodic_48k_16k_pcm16_postedit_v1";
  const ROLES = { source: ["Source", "SOURCE"], baseline: ["Baseline output", "BASELINE"], candidate: ["Candidate output", "CANDIDATE"] };
  const NOTES = {
    v1: "Default comparison. Diagnoses identifiable deletion and adjacent-repeat candidates; it does not approve overall audio quality.",
    v9: "A research candidate using global context. Improved accuracy in real-world use has not been established.",
    v10: "Precisely compares short interior deletions and adjacent repeats of 50–200 ms in untransformed PCM at the same sample rate. Other cases may use the existing comparison.",
    v11: "Adds head and tail loss checks of 50–2000 ms to v10's short interior checks. Intended for untransformed PCM at the same sample rate.",
    v12: "Only compares the declared path: full-source SciPy FFT periodic-signal resampling from 48→16 kHz, PCM16 rounding, then editing. The source sample count must be divisible by 3."
  };
  const GATES = { clear_supported_temporal_check: "No temporal candidates", review_required: "Review required", blocked: "Inconclusive" };
  const REGRESSIONS = { new_candidates: "New candidates observed", no_new_candidates_observed: "No new candidates observed", inconclusive: "Cannot compare versions" };
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
  function seconds(ms) { return `${(ms / 1000).toFixed(3).replace(/\.?0+$/, "")} s`; }
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
    if (["v10", "v11"].includes(engine) && ($("allow-gain").checked || $("allow-resampling").checked)) return "This precise comparison requires untransformed PCM at the same sample rate. Choose the default comparison for the processing you actually applied.";
    if (engine === "v12" && ($("allow-gain").checked || !$("allow-resampling").checked || !$("fft-confirm").checked)) return "FFT mode requires confirmation of the actual 48→16 kHz resampling path with no gain change. Select resampling and confirm the processing path.";
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
    $("run-label").textContent = busy ? "Analysis running" : mode === "pair" ? "Run comparison" : "Run regression suite";
    $("run-note").textContent = busy ? "Running in this tab without uploading audio." : !complete ? "Choose a WAV file for each required slot." : !versions ? "Enter the baseline and candidate version names." : totalBytes() > MAX_TOTAL ? "Total input exceeds 64 MiB." : "Ready · Files are used only inside this browser.";
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
    $("demo-button").lastChild.textContent = "Load example";
    $("demo-button").disabled = busy;
  }
  function setFile(item, role, file, fromDemo = false) {
    if (busy) return false;
    if (!fromDemo) invalidateDemo();
    if (file && (!/\.wav$/i.test(file.name) || file.size === 0 || file.size > MAX_FILE)) {
      showError("Choose a non-empty WAV file, up to 10,000,000 bytes per file.", "unsupported_file");
      return false;
    }
    const entry = item.entries[role];
    const old = item.files[role];
    if (file && totalBytes() - (old?.size || 0) + file.size > MAX_TOTAL) {
      showError("Total input must not exceed 64 MiB per run. Use fewer or shorter files.", "total_input_limit");
      return false;
    }
    releaseEntry(entry);
    item.files[role] = file;
    entry.input.value = "";
    entry.card.classList.toggle("has-file", !!file);
    entry.clear.hidden = !file;
    entry.audio.hidden = !file;
    entry.name.textContent = file ? file.name : "Choose or drop a file";
    entry.meta.textContent = file ? `${size(file.size)} · Click to replace` : "PCM16 mono WAV";
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
    label.append(element("span", `role-marker ${role}`), document.createTextNode(mode === "pair" && role === "candidate" ? "Processed output" : ROLES[role][0]));
    const en = element("span", "file-role-en", role === "candidate" && item === pair ? "PROCESSED" : ROLES[role][1]);
    const clear = element("button", "file-clear");
    clear.type = "button";
    clear.append(icon("close"));
    clear.setAttribute("aria-label", `Remove ${ROLES[role][0]} file`);
    clear.hidden = true;
    header.append(label, en, clear);
    const picker = element("button", "file-picker");
    picker.type = "button";
    picker.setAttribute("aria-label", `Choose ${ROLES[role][0]} WAV for ${item.case_id}`);
    const upload = element("span", "upload-icon");
    upload.append(icon("upload"));
    const name = element("strong", "", "Choose or drop a file");
    const meta = element("small", "", "PCM16 mono WAV");
    picker.append(upload, name, meta);
    const input = element("input", "sr-only");
    input.type = "file";
    input.accept = ".wav,audio/wav,audio/x-wav";
    input.tabIndex = -1;
    input.setAttribute("aria-label", `${item.case_id} ${ROLES[role][0]} WAV file`);
    const audio = element("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.hidden = true;
    audio.setAttribute("aria-label", `Play ${item.case_id} ${ROLES[role][0]}`);
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
      if (e.dataTransfer.files.length !== 1) return showError("Drop one WAV file into each slot.", "one_file_per_slot");
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
    remove.setAttribute("aria-label", `Remove case ${item.case_id}`);
    remove.append(icon("close"));
    heading.append(element("h3", "", `Test case · ${item.case_id}`), remove);
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
    $("breadcrumb-title").textContent = mode === "pair" ? "Pair comparison" : "Regression suite";
    $("page-title").textContent = mode === "pair" ? "Find where your audio changed." : "Check what changed in the new version.";
    $("page-description").textContent = mode === "pair" ? "Compare a source WAV with its processed output to locate possible deletions and adjacent repeats." : "Compare source, baseline, and candidate outputs to distinguish newly observed candidates.";
    $("input-description").replaceChildren(document.createTextNode(mode === "pair" ? "Choose a source and its processed output, not two separate recordings." : "For each case, choose outputs from two versions processing the same source. Input hashes are recorded automatically."));
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
    if (readyReject) readyReject(failure || Object.assign(new Error("Runtime preparation was interrupted."), { code: reason }));
    readyPromise = readyResolve = readyReject = null;
    if (currentRun) {
      clearTimeout(currentRun.timer);
      currentRun.reject(failure || Object.assign(new Error(reason === "analysis_timeout" ? "Analysis timed out. Retry with fewer or shorter files." : "Analysis was cancelled."), { code: reason }));
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
    setRuntimeState("loading", "Downloading runtime");
    try { worker = new Worker("./dsp-worker.js"); }
    catch (err) {
      destroyWorker("worker_start_failed", Object.assign(new Error("The Worker could not start. Check browser support and execution restrictions, then try again."), { code: "worker_start_failed" }));
      setRuntimeState("failed", "Worker execution restricted");
      return pending;
    }
    workerInitTimer = setTimeout(() => {
      if (generation !== workerGeneration || runtime) return;
      destroyWorker("runtime_timeout", Object.assign(new Error("Runtime preparation timed out. Check your network connection and try again."), { code: "runtime_timeout" }));
      setRuntimeState("failed", "Runtime preparation failed");
    }, 240000);
    worker.addEventListener("message", (event) => {
      if (generation !== workerGeneration) return;
      const data = event.data || {};
      if (data.type === "progress") {
        $("progress-message").textContent = typeof data.message === "string" ? data.message : "Processing signals.";
      } else if (data.type === "ready") {
        if (!readyResolve) return;
        clearTimeout(workerInitTimer);
        workerInitTimer = null;
        runtime = data.runtime;
        setRuntimeState("ready", "Browser engine ready");
        readyResolve(runtime);
        readyResolve = readyReject = null;
      } else if (data.type === "result" && currentRun && data.id === currentRun.id) {
        const run = currentRun;
        currentRun = null;
        clearTimeout(run.timer);
        run.resolve(data.payload);
      } else if (data.type === "error") {
        const err = Object.assign(new Error(typeof data.message === "string" ? data.message : "Analysis could not run."), { code: data.code || "worker_error" });
        if (currentRun && data.id === currentRun.id) {
          const run = currentRun;
          currentRun = null;
          clearTimeout(run.timer);
          run.reject(err);
        } else if (!runtime && readyReject) {
          destroyWorker(err.code, err);
          setRuntimeState("failed", "Runtime preparation failed");
        }
      }
    });
    worker.addEventListener("error", (event) => {
      if (generation !== workerGeneration) return;
      const err = Object.assign(new Error(event.message || "The browser runtime stopped. Check available memory and browser support."), { code: "worker_crashed" });
      destroyWorker("worker_crashed", err);
      setRuntimeState("failed", "Browser engine stopped");
    });
    try { worker.postMessage({ type: "init" }); }
    catch (err) {
      destroyWorker("worker_message_failed", Object.assign(new Error("The request could not reach the runtime. Please try again."), { code: "worker_message_failed" }));
      setRuntimeState("failed", "Runtime request failed");
    }
    return pending;
  }
  async function validateWav(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const fourcc = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    if (buffer.byteLength < 44 || fourcc(0) !== "RIFF" || fourcc(8) !== "WAVE") throw Object.assign(new Error(`${file.name}: Not a RIFF/WAVE file. Choose a PCM16 mono WAV.`), { code: "invalid_wav_header" });
    if (buffer.byteLength > MAX_FILE || view.getUint32(4, true) !== buffer.byteLength - 8) throw Object.assign(new Error(`${file.name}: The declared WAV length does not match the file.`), { code: "invalid_wav_length" });
    let format = null;
    let dataBytes = null;
    for (let pos = 12; pos < buffer.byteLength;) {
      if (buffer.byteLength - pos < 8) throw Object.assign(new Error(`${file.name}: Incomplete WAV chunk header.`), { code: "invalid_wav_chunk" });
      const tag = fourcc(pos);
      const length = view.getUint32(pos + 4, true);
      if (pos + 8 + length + (length % 2) > buffer.byteLength) throw Object.assign(new Error(`${file.name}: A WAV chunk extends beyond the file.`), { code: "invalid_wav_chunk" });
      if (tag === "fmt ") {
        if (format !== null || ![16, 18].includes(length) || length === 18 && view.getUint16(pos + 24, true) !== 0) throw Object.assign(new Error(`${file.name}: Duplicate or unsupported WAV format chunk.`), { code: "invalid_wav_format_chunk" });
        format = { code: view.getUint16(pos + 8, true), channels: view.getUint16(pos + 10, true), rate: view.getUint32(pos + 12, true), byteRate: view.getUint32(pos + 16, true), bits: view.getUint16(pos + 22, true), align: view.getUint16(pos + 20, true) };
      }
      if (tag === "data") {
        if (dataBytes !== null) throw Object.assign(new Error(`${file.name}: Duplicate WAV data chunk.`), { code: "invalid_wav_data_chunk" });
        dataBytes = length;
      }
      pos += 8 + length + (length % 2);
    }
    if (!format || format.code !== 1 || format.channels !== 1 || format.bits !== 16 || format.align !== 2 || ![8000, 16000, 44100, 48000].includes(format.rate) || format.byteRate !== format.rate * 2 || dataBytes === null || dataBytes % 2) throw Object.assign(new Error(`${file.name}: Only PCM16 mono WAV at 8 / 16 / 44.1 / 48 kHz is supported. Files are not converted automatically.`), { code: "unsupported_wav_format" });
    const duration = dataBytes / 2 / format.rate;
    if (duration < 2 || duration > 30) throw Object.assign(new Error(`${file.name}: Duration is ${duration.toFixed(2)} seconds. Choose a 2–30 second file.`), { code: "unsupported_wav_duration" });
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
    $("progress-message").textContent = "Checking file formats and sizes.";
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
      $("progress-message").textContent = "The first run downloads the Python, NumPy, and SciPy runtime.";
      await ensureWorker();
      if (generation !== runCounter) return;
      $("progress-message").textContent = "Running the analysis engine. Keep this tab open.";
      const payload = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!currentRun || currentRun.id !== id) return;
          destroyWorker("analysis_timeout");
          setRuntimeState("failed", "Analysis timed out");
        }, 600000);
        currentRun = { id, resolve, reject, timer };
        try {
          worker.postMessage({ type: "run", id, mode: runMode, configuration, versions: runMode === "pair" ? { baseline: "pair-reference", candidate: "pair-processed" } : { baseline: $("baseline-version").value.trim(), candidate: $("candidate-version").value.trim() }, cases }, transfer);
        } catch (err) {
          destroyWorker("worker_message_failed", Object.assign(new Error("The analysis request could not be sent. Check your files and try again."), { code: "worker_message_failed" }));
          setRuntimeState("failed", "Analysis request failed");
        }
      });
      if (generation !== runCounter) return;
      if (!payload || payload.kind !== runMode || typeof payload.report_html !== "string" || !payload.result || payload.result.complete_audio_approval !== false || payload.result.commercial_performance_validated !== false) throw Object.assign(new Error("The result format could not be verified. This run is not treated as passed."), { code: "invalid_worker_result" });
      resultPayload = payload;
      renderResult(payload, selectedCases);
    } catch (err) {
      if (generation !== runCounter) return;
      clearResult();
      showError(err.message || "Analysis could not be completed.", err.code || "analysis_failed");
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
    $("run-note").textContent = "Analysis cancelled. Results from the cancelled run are not used.";
    setRuntimeState("", "Runtime not loaded");
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
        const failed = () => { cleanup(); reject(new Error("Playback failed.")); };
        const cancelled = () => { cleanup(); reject(new Error("Playback cancelled.")); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error("Playback information could not be loaded.")); }, 5000);
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
    } catch (err) { if (generation === audioGeneration) showError("This region could not be played in the browser. Use the player above or an external player to review the file.", "audio_playback_failed"); }
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
    title.append(element("span", "candidate-index", String(index + 1).padStart(2, "0")), document.createTextNode(deleted ? event.location === "head" ? "Head loss candidate" : event.location === "tail" ? "Tail loss candidate" : "Deletion candidate" : "Adjacent-repeat candidate"));
    heading.append(title, element("span", "candidate-type", deleted ? "MISSING INTERVAL" : "ADJACENT REPEAT"));
    const axes = element("div", "event-axes");
    function axis(fileRole, label, position, start, end) {
      const box = element("div", "event-axis");
      const button = element("button", "button", "Play region");
      button.type = "button";
      button.prepend(icon("play"));
      button.setAttribute("aria-label", `Play ${item.case_id} ${label} ${position}`);
      button.addEventListener("click", () => listen(item, fileRole, start, end));
      box.append(element("small", "", label), element("strong", "", position), button);
      return box;
    }
    axes.append(axis("source", "Source · original region", interval(source), source[0], source[1]), axis(role, mode === "suite" ? "Candidate output · corresponding position" : "Processed output · corresponding position", deleted ? `Boundary at ${seconds(processed)}` : interval(processed), deleted ? processed : processed[0], deleted ? processed + 700 : processed[1]));
    card.append(heading, axes, element("p", "event-next", deleted ? "Listen to the source region and corresponding output boundary to check for an unintended deletion. Each file has its own timeline; the actual cause of an edit is not established." : "The later of two adjacent copies is shown. Listen to the source region and repeated output region to check whether the processing was intentional."));
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
      if (!Object.hasOwn(GATES, gate) || payload.gate.contract_valid !== true) throw Object.assign(new Error("The analysis state could not be verified. This run is not treated as passed."), { code: "invalid_gate_result" });
      summary.append(makeSummary(gate, GATES[gate], gate === "clear_supported_temporal_check" ? "No deletion or adjacent-repeat candidates were observed within the supported scope. This does not mean overall audio quality is acceptable." : gate === "review_required" ? "Listen to the candidate regions below and check whether the processing was intentional. Defects and the actual cause of an edit are not confirmed automatically." : "The input or supported scope did not allow a conclusion. Do not interpret this as a passing or defect-free result.", `${result.engine || "DSP ENGINE"} · Analysis complete`));
      const n = showEvents(result, cases[0], list);
      if (!n) list.append(element("p", "no-events", gate === "blocked" ? `Inconclusive reason: ${result.reason_code || payload.gate.reason_code || "See the full report for details."}` : "No temporal candidates to display. Review the input conditions and full report together."));
      $("result-count").textContent = `${n} candidate${n === 1 ? "" : "s"}`;
    } else {
      const s = result.summary;
      if (!s || !Object.hasOwn(GATES, s.current_gate_state) || !Object.hasOwn(REGRESSIONS, s.regression_state) || !Array.isArray(result.cases)) throw Object.assign(new Error("The regression suite summary could not be verified."), { code: "invalid_suite_result" });
      summary.append(makeSummary(s.current_gate_state, GATES[s.current_gate_state], "The current candidate analysis state is separate from changes between versions. No new candidates or candidates not observed now do not confirm a fix or approve a release.", `${s.completed_count} / ${s.case_count} cases complete · Regression suite`));
      const metrics = element("div", "summary-metrics");
      [["New candidates", s.new_candidate_count], ["Persistent candidates", s.persistent_candidate_count], ["Not observed now", s.not_observed_now_count], ["Inconclusive cases", s.inconclusive_case_count]].forEach(([label, value]) => { const metric = element("div", "summary-metric"); metric.append(element("small", "", label), element("strong", "", String(value))); metrics.append(metric); });
      const states = element("div", "suite-state-grid");
      [["Current analysis state", GATES[s.current_gate_state]], ["Observed version changes", REGRESSIONS[s.regression_state]]].forEach(([label, value]) => { const box = element("div", "suite-state-card"); box.append(element("small", "", label), element("strong", "", value)); states.append(box); });
      summary.append(metrics, states);
      result.cases.forEach((item) => {
        const section = element("article", "suite-result-case");
        const heading = element("div", "suite-case-title");
        const analyzed = item.candidate_analysis;
        const state = item.status !== "completed" || !analyzed || analyzed.status !== "analyzed" ? "blocked" : analyzed.events?.length ? "review_required" : "clear_supported_temporal_check";
        heading.append(element("h3", "", item.case_id), element("span", `state-chip ${state === "blocked" ? "blocked" : state === "review_required" ? "review" : ""}`, GATES[state]));
        section.append(heading);
        const delta = item.delta;
        section.append(element("p", "delta-description", delta?.status === "compared" ? `New ${delta.new_candidates.length} · Persistent ${delta.persistent_pairs.length} · Not observed now ${delta.not_observed_now.length}` : `Cannot compare versions · ${item.reason_code || delta?.reason_code || "inconclusive"}`));
        const selected = cases.find((c) => c.case_id === item.case_id);
        if (selected && analyzed) showEvents(analyzed, selected, section);
        if (analyzed?.reason_code) section.append(element("p", "event-reason", `Inconclusive reason: ${analyzed.reason_code}`));
        list.append(section);
      });
      $("result-count").textContent = `${s.case_count} case${s.case_count === 1 ? "" : "s"}`;
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
    $("demo-button").lastChild.textContent = "Loading example";
    clearError();
    try {
      const roles = [...caseRoles()];
      const files = await Promise.all(roles.map(async (role) => {
        const response = await fetch(`./demo/${role}.wav`, { credentials: "same-origin" });
        if (!response.ok) throw new Error("The example files could not be downloaded.");
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
      $("run-note").textContent = "Synthetic example · A 100 ms deletion at 2 seconds. This does not establish performance in customer environments.";
    } catch (err) { if (generation === loadGeneration) showError(err.message, "demo_load_failed"); }
    finally { if (generation === loadGeneration) { $("demo-button").lastChild.textContent = "Load example"; updateControls(); } }
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
      entry.name.textContent = "Choose or drop a file";
      entry.meta.textContent = "PCM16 mono WAV";
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
    setRuntimeState("", "Runtime not loaded");
  });
  updateConfig();
})();
