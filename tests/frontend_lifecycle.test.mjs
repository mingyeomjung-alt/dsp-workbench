// Behavioral orchestration checks with a fake DOM/Worker; not browser or DSP accuracy proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "web/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const wav = fs.readFileSync(path.join(root, "web/demo/source.wav"));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const flush = async () => { for (let n = 0; n < 25; n++) await Promise.resolve(); };

class Target {
  listeners = new Map();
  addEventListener(type, callback, options = {}) { const list = this.listeners.get(type) || []; list.push({callback, once: !!options.once}); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry.callback !== callback)); }
  fire(type, data = {}) { return [...(this.listeners.get(type) || [])].map((entry) => { if (entry.once) this.removeEventListener(type, entry.callback); return entry.callback({target: this, preventDefault() {}, ...data}); }); }
}
class Element extends Target {
  children = []; parentNode = null; attributes = new Map(); dataset = {}; hidden = false; disabled = false; checked = false; value = ""; _text = ""; _class = "";
  readyState = 4; currentTime = 0; ended = false; pauseCount = 0; playCount = 0;
  constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); this.classList = {add: (...v) => { this._class = [...new Set([...this._class.split(/\s+/).filter(Boolean), ...v])].join(" "); }, remove: (...v) => { this._class = this._class.split(/\s+/).filter((s) => !v.includes(s)).join(" "); }, toggle: (v, force) => { const has = this._class.split(/\s+/).includes(v), yes = force === undefined ? !has : !!force; if (yes) this.classList.add(v); else this.classList.remove(v); return yes; }, contains: (v) => this._class.split(/\s+/).includes(v)}; }
  set className(value) { this._class = value; } get className() { return this._class; }
  set textContent(value) { this._text = String(value); this.children = []; } get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (let child of children) { if (typeof child === "string") { const text = new Element("#text"); text.textContent = child; child = text; } child.parentNode = this; this.children.push(child); } }
  prepend(...children) { for (const child of [...children].reverse()) { child.parentNode = this; this.children.unshift(child); } }
  replaceChildren(...children) { this.children.forEach((child) => { child.parentNode = null; }); this.children = []; this._text = ""; this.append(...children); }
  get lastChild() { return this.children.at(-1); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); if (key === "src") this.src = String(value); }
  removeAttribute(key) { this.attributes.delete(key); if (key === "srcdoc") delete this.srcdoc; if (key === "src") delete this.src; }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  pause() { this.pauseCount++; } load() {} async play() { this.playCount++; if (this.playDeferred) await this.playDeferred.promise; }
  click() { return this.fire("click"); } showModal() { this.open = true; } close() { this.open = false; }
  getBoundingClientRect() { return {left: 0, top: 0, right: 100, bottom: 100}; }
}
function harness() {
  const document = new Target(), window = new Target(), ids = new Map(), body = new Element("body");
  for (const [, tag, attributes] of html.matchAll(/<([A-Za-z][A-Za-z0-9-]*)\b([^>]*)>/g)) {
    const id = attributes.match(/\bid="([^"]+)"/)?.[1];
    if (!id) continue;
    const el = new Element(tag); el.id = id; el.className = attributes.match(/\bclass="([^"]+)"/)?.[1] || "";
    el.value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || "";
    el.checked = /\bchecked\b/.test(attributes); el.hidden = /\bhidden\b/.test(attributes); body.append(el); ids.set(id, el);
  }
  for (const mode of ["pair", "suite"]) { const nav = new Element("button"); nav.className = "nav-item"; nav.dataset.mode = mode; body.append(nav); }
  ids.get("engine-select").value = "v1";
  ids.get("demo-button").append(new Element("#text"));
  const all = () => { const visit = (el) => [el, ...el.children.flatMap(visit)]; return visit(body); };
  document.body = body; document.getElementById = (id) => { assert.ok(ids.has(id), id); return ids.get(id); };
  document.createElement = (tag) => new Element(tag); document.createElementNS = (_, tag) => new Element(tag);
  document.createTextNode = (text) => { const el = new Element("#text"); el.textContent = text; return el; };
  document.querySelectorAll = (query) => all().filter((el) => query.split(",").some((part) => { const s = part.trim(); return s.startsWith(".") ? el.classList.contains(s.slice(1)) : s.startsWith("#") ? el.id === s.slice(1) : el.tagName === s.toUpperCase(); }));
  let timerId = 0, urlId = 0;
  const timers = new Map(), workers = [], urls = new Set(), revoked = [], fetches = [];
  const options = {constructorError: false, postError: null};
  class Worker extends Target {
    sent = []; terminated = false;
    constructor(url) { super(); if (options.constructorError) throw new Error("fixture constructor failure"); this.url = url; workers.push(this); }
    postMessage(data, transfers) { if (options.postError === data.type) throw new Error("fixture post failure"); this.sent.push({data, transfers}); }
    terminate() { this.terminated = true; }
    message(data) { this.fire("message", {data}); }
    crash() { this.fire("error", {message: "fixture worker stopped"}); }
  }
  class File extends Blob { constructor(parts, name, config) { super(parts, config); this.name = name; } }
  const context = vm.createContext({document, window, Worker, File, Blob, DataView, Uint8Array, ArrayBuffer, console,
    URL: {createObjectURL() { const url = `blob:fixture-${++urlId}`; urls.add(url); return url; }, revokeObjectURL(url) { urls.delete(url); revoked.push(url); }},
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, {fn, delay, repeat: false}); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { const id = ++timerId; timers.set(id, {fn, delay, repeat: true}); return id; }, clearInterval(id) { timers.delete(id); },
    fetch(url) { const item = {url, ...deferred()}; fetches.push(item); return item.promise; }});
  const exposed = source.replace(/  updateConfig\(\);\s*\}\)\(\);\s*$/, `  globalThis.fixture = { run, cancel, demo, setFile, setMode, clearAll, listen, stopAudio, pair, suite, addCase, updateControls, get state() { return {busy, worker, runtime, currentRun, resultPayload, workerInitTimer}; } };\n  updateConfig();\n})();`);
  assert.notEqual(exposed, source);
  vm.runInContext(exposed, context, {filename: "app.js"});
  const file = (name = "fixture.wav", bytes = wav) => ({name, size: bytes.length, async arrayBuffer() { return Uint8Array.from(bytes).buffer; }});
  const fixture = context.fixture;
  const selectPair = () => { fixture.setFile(fixture.pair, "source", file()); fixture.setFile(fixture.pair, "candidate", file()); };
  const fireTimer = async (delay) => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { if (!timer.repeat) timers.delete(id); timer.fn(); } await flush(); };
  const start = async () => { const result = fixture.run(); await flush(); return {result, worker: workers.at(-1)}; };
  const ready = async (worker = workers.at(-1)) => { worker.message({type: "ready", runtime: {engine: "0.1.20"}}); await flush(); };
  return {fixture, ids, options, workers, timers, urls, revoked, fetches, window, file, selectPair, fireTimer, start, ready};
}
function payload() { return {kind: "pair", result: {status: "analyzed", engine: "fixture", events: [], complete_audio_approval: false, commercial_performance_validated: false}, gate: {gate_state: "clear_supported_temporal_check", contract_valid: true}, report_html: "<p>fixture report</p>"}; }
const latestRun = (worker) => worker.sent.filter((item) => item.data.type === "run").at(-1)?.data;
async function success(h, worker = h.workers.at(-1)) { const request = latestRun(worker); assert.ok(request); worker.message({type: "result", id: request.id, payload: payload()}); await flush(); }

test("frontend stays idle without complete inputs", async () => { const h = harness(); assert.equal(h.ids.get("run-button").disabled, true); await h.fixture.run(); assert.equal(h.workers.length, 0); assert.equal(h.timers.size, 0); });
test("Worker constructor failure resets initialization and a second run can succeed", async () => { const h = harness(); h.selectPair(); h.options.constructorError = true; await h.fixture.run(); assert.equal(h.ids.get("error-code").textContent, "worker_start_failed"); assert.equal(h.fixture.state.busy, false); assert.equal(h.fixture.state.worker, null); h.options.constructorError = false; const next = await h.start(); await h.ready(); await success(h); await next.result; assert.ok(h.fixture.state.resultPayload); });
test("initialization post failure resets timers and permits retry", async () => { const h = harness(); h.selectPair(); h.options.postError = "init"; await h.fixture.run(); assert.equal(h.ids.get("error-code").textContent, "worker_message_failed"); assert.equal(h.workers[0].terminated, true); assert.equal(h.timers.size, 0); h.options.postError = null; const next = await h.start(); await h.ready(); await success(h); await next.result; });
test("initialization error invalidates old Worker messages and allows another attempt", async () => { const h = harness(); h.selectPair(); const first = await h.start(); first.worker.message({type: "error", code: "runtime_asset_unavailable", message: "fixture failure"}); await first.result; assert.equal(h.ids.get("error-code").textContent, "runtime_asset_unavailable"); assert.equal(first.worker.terminated, true); first.worker.message({type: "ready", runtime: {engine: "stale"}}); assert.equal(h.fixture.state.runtime, null); const next = await h.start(); await h.ready(); await success(h); await next.result; });
test("ready clears the initialization deadline and duplicate ready is harmless", async () => { const h = harness(); h.selectPair(); const pending = await h.start(); assert.equal([...h.timers.values()].filter((timer) => timer.delay === 240000).length, 1); await h.ready(); assert.equal([...h.timers.values()].filter((timer) => timer.delay === 240000).length, 0); assert.doesNotThrow(() => pending.worker.message({type: "ready", runtime: {engine: "duplicate"}})); assert.equal(h.fixture.state.runtime.engine, "0.1.20"); await success(h); await pending.result; });
test("initialization timeout frees Worker and retains the actionable timeout reason", async () => { const h = harness(); h.selectPair(); const pending = await h.start(); await h.fireTimer(240000); await pending.result; assert.equal(h.ids.get("error-code").textContent, "runtime_timeout"); assert.match(h.ids.get("error-message").textContent, /network/i); assert.equal(pending.worker.terminated, true); assert.equal(h.fixture.state.busy, false); assert.equal(h.timers.size, 0); });
test("run post failure clears current request and supports clean restart", async () => { const h = harness(); h.selectPair(); h.options.postError = "run"; const first = await h.start(); await h.ready(); await first.result; assert.equal(h.ids.get("error-code").textContent, "worker_message_failed"); assert.equal(h.fixture.state.currentRun, null); assert.equal(h.timers.size, 0); assert.equal(first.worker.terminated, true); h.options.postError = null; const next = await h.start(); await h.ready(); await success(h); await next.result; });
test("Worker crash during initialization can be retried", async () => { const h = harness(); h.selectPair(); const first = await h.start(); first.worker.crash(); await first.result; assert.equal(h.ids.get("error-code").textContent, "worker_crashed"); assert.equal(h.timers.size, 0); const next = await h.start(); await h.ready(); await success(h); await next.result; });
test("Worker crash during analysis terminates its generation and clears deadlines", async () => { const h = harness(); h.selectPair(); const pending = await h.start(); await h.ready(); pending.worker.crash(); await pending.result; pending.worker.message({type: "result", id: "run-1", payload: payload()}); assert.equal(h.ids.get("error-code").textContent, "worker_crashed"); assert.equal(h.fixture.state.resultPayload, null); assert.equal(h.timers.size, 0); assert.equal(h.fixture.state.busy, false); });
test("a matching analysis error withholds the result but reuses a healthy runtime", async () => { const h = harness(); h.selectPair(); const first = await h.start(); await h.ready(); first.worker.message({type: "error", id: latestRun(first.worker).id, code: "fixture_input_rejected", message: "fixture rejection"}); await first.result; assert.equal(h.fixture.state.resultPayload, null); assert.equal(first.worker.terminated, false); const next = await h.start(); assert.equal(h.workers.length, 1); await success(h); await next.result; });
test("analysis timeout terminates the Worker without exposing old results", async () => { const h = harness(); h.selectPair(); const pending = await h.start(); await h.ready(); await h.fireTimer(600000); await pending.result; assert.equal(h.ids.get("error-code").textContent, "analysis_timeout"); assert.equal(h.fixture.state.resultPayload, null); assert.equal(h.fixture.state.currentRun, null); assert.equal(pending.worker.terminated, true); assert.equal(h.timers.size, 0); });
test("cancel while reading a WAV never starts a runtime when the read later resolves", async () => { const h = harness(); h.selectPair(); const read = deferred(); h.fixture.pair.files.source.arrayBuffer = () => read.promise; const pending = h.fixture.run(); await flush(); h.fixture.cancel(); read.resolve(Uint8Array.from(wav).buffer); await pending; assert.equal(h.workers.length, 0); assert.equal(h.fixture.state.busy, false); assert.equal(h.ids.get("error-banner").hidden, true); });
test("cancel during initialization does not restart downloads and clears all deadlines", async () => { const h = harness(); h.selectPair(); const pending = await h.start(); h.fixture.cancel(); await pending.result; assert.equal(h.workers.length, 1); assert.equal(pending.worker.terminated, true); assert.equal(h.timers.size, 0); pending.worker.message({type: "progress", message: "stale progress"}); pending.worker.message({type: "ready", runtime: {engine: "stale"}}); assert.equal(h.fixture.state.runtime, null); assert.notEqual(h.ids.get("progress-message").textContent, "stale progress"); });
test("cancel analysis then rerun ignores stale replies from the retired Worker", async () => { const h = harness(); h.selectPair(); const first = await h.start(); await h.ready(); const oldId = latestRun(first.worker).id; h.fixture.cancel(); await first.result; const next = await h.start(); await h.ready(); first.worker.message({type: "result", id: oldId, payload: payload()}); assert.equal(h.fixture.state.resultPayload, null); assert.equal(h.fixture.state.busy, true); await success(h); await next.result; assert.equal(h.workers.length, 2); });
test("unrelated reply IDs cannot finish the current request", async () => { const h = harness(); h.selectPair(); const pending = await h.start(); await h.ready(); pending.worker.message({type: "result", id: "unrelated", payload: payload()}); pending.worker.message({type: "error", id: "unrelated", code: "unrelated", message: "ignore"}); assert.equal(h.fixture.state.busy, true); assert.ok(h.fixture.state.currentRun); await success(h); await pending.result; });
test("invalid approval flags and invalid gate payloads never leave downloadable results", async (t) => { for (const variant of ["approval", "gate"]) await t.test(variant, async () => { const h = harness(); h.selectPair(); const pending = await h.start(); await h.ready(); const result = payload(); if (variant === "approval") result.result.complete_audio_approval = true; else result.gate.contract_valid = false; pending.worker.message({type: "result", id: latestRun(pending.worker).id, payload: result}); await pending.result; assert.equal(h.fixture.state.resultPayload, null); assert.equal(h.ids.get("result-actions").hidden, true); assert.equal(h.ids.get("result-content").hidden, true); }); });
test("demo completion after a manual file edit cannot replace the user's selection", async () => { const h = harness(); const pending = h.fixture.demo(); assert.equal(h.fetches.length, 2); const chosen = h.file("manual.wav"); h.fixture.setFile(h.fixture.pair, "source", chosen); h.fetches.forEach((request) => request.resolve({ok: true, blob: async () => new Blob([wav])})); await pending; assert.equal(h.fixture.pair.files.source, chosen); assert.equal(h.fixture.pair.files.candidate, undefined); assert.equal(h.ids.get("engine-select").value, "v1"); });
test("switching mode invalidates an outstanding demo and preserves the new mode", async () => { const h = harness(); const pending = h.fixture.demo(); h.fixture.setMode("suite"); h.fetches.forEach((request) => request.resolve({ok: true, blob: async () => new Blob([wav])})); await pending; assert.equal(h.fixture.suite[0].files.source, undefined); assert.equal(h.ids.get("pair-files").hidden, true); assert.equal(h.ids.get("suite-inputs").hidden, false); });
test("pagehide invalidates pending demos and does not recreate object URLs", async () => { const h = harness(); const pending = h.fixture.demo(); h.window.fire("pagehide"); h.fetches.forEach((request) => request.resolve({ok: true, blob: async () => new Blob([wav])})); await pending; assert.equal(h.urls.size, 0); assert.equal(h.fixture.pair.files.source, undefined); });
test("pagehide during analysis clears Worker, audio URLs, and timers; BFCache restores empty state", async () => { const h = harness(); h.selectPair(); const pending = await h.start(); await h.ready(); h.window.fire("pagehide"); await pending.result; assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0); assert.equal(pending.worker.terminated, true); h.window.fire("pageshow", {persisted: true}); assert.equal(h.fixture.pair.files.source, null); assert.equal(h.ids.get("run-button").disabled, true); assert.equal(h.fixture.state.resultPayload, null); });
test("clearing selected files releases audio URLs and invalidates old results", () => { const h = harness(); h.selectPair(); assert.equal(h.urls.size, 2); h.fixture.clearAll(); assert.equal(h.urls.size, 0); assert.equal(h.revoked.length, 2); assert.equal(h.fixture.pair.files.source, null); assert.equal(h.ids.get("run-button").disabled, true); });
test("a cancelled metadata load cannot resume old audio or show a stale playback error", async () => { const h = harness(); h.selectPair(); const audio = h.fixture.pair.entries.source.audio; audio.readyState = 0; const pending = h.fixture.listen(h.fixture.pair, "source", 1000, 1200); assert.equal([...h.timers.values()].filter((timer) => timer.delay === 5000).length, 1); h.fixture.clearAll(); audio.fire("loadedmetadata"); await pending; assert.equal(audio.playCount, 0); assert.equal(h.ids.get("error-banner").hidden, true); assert.equal(h.timers.size, 0); assert.equal((audio.listeners.get("loadedmetadata") || []).length, 0); assert.equal((audio.listeners.get("error") || []).length, 0); });
test("a cancelled play promise cannot install an obsolete listening interval", async () => { const h = harness(); h.selectPair(); const audio = h.fixture.pair.entries.source.audio; audio.playDeferred = deferred(); const pending = h.fixture.listen(h.fixture.pair, "source", 1000, 1200); await flush(); h.fixture.clearAll(); audio.playDeferred.resolve(); await pending; assert.equal([...h.timers.values()].filter((timer) => timer.repeat).length, 0); assert.equal(h.ids.get("error-banner").hidden, true); });
test("new listening request cancels the previous metadata listener", async () => { const h = harness(); h.selectPair(); const oldAudio = h.fixture.pair.entries.source.audio; oldAudio.readyState = 0; const old = h.fixture.listen(h.fixture.pair, "source", 1000, 1200); const next = h.fixture.listen(h.fixture.pair, "candidate", 2000, 2200); await next; oldAudio.fire("loadedmetadata"); await old; assert.equal(oldAudio.playCount, 0); assert.equal(h.fixture.pair.entries.candidate.audio.playCount, 1); assert.equal([...h.timers.values()].filter((timer) => timer.repeat).length, 1); h.fixture.stopAudio(); assert.equal(h.timers.size, 0); });

const start = source.indexOf("  async function validateWav(file) {"), end = source.indexOf("  async function run() {", start);
const validateWav = vm.runInNewContext("(" + source.slice(start, end).trim() + ")", {DataView, Uint8Array, MAX_FILE: 10_000_000});
const asFile = (bytes) => ({name: "fixture.wav", arrayBuffer: async () => Uint8Array.from(bytes).buffer});
function riff(chunks) { const body = Buffer.concat([Buffer.from("WAVE"), ...chunks]); const header = Buffer.alloc(8); header.write("RIFF"); header.writeUInt32LE(body.length, 4); return Buffer.concat([header, body]); }
function chunk(tag, bytes, padded = true) { const header = Buffer.alloc(8); header.write(tag); header.writeUInt32LE(bytes.length, 4); return Buffer.concat([header, bytes, ...(padded && bytes.length % 2 ? [Buffer.alloc(1)] : [])]); }
const fmt = wav.subarray(20, 36), pcm = wav.subarray(44);
test("frontend RIFF contract accepts SDK-permitted metadata, ordering, padding, and empty extensions", async (t) => { const valid = [
  ["standard", wav], ["unknown padded chunk", riff([chunk("JUNK", Buffer.from([1, 2, 3])), chunk("fmt ", fmt), chunk("data", pcm)])],
  ["fmt18 empty extension", riff([chunk("fmt ", Buffer.concat([fmt, Buffer.alloc(2)])), chunk("data", pcm)])],
  ["data before format", riff([chunk("data", pcm), chunk("fmt ", fmt)])],
  ["unknown trailing even chunk", riff([chunk("fmt ", fmt), chunk("data", pcm), chunk("LIST", Buffer.from([0, 1]))])],
]; for (const [name, bytes] of valid) await t.test(name, async () => assert.equal((await validateWav(asFile(bytes))).byteLength, bytes.length)); });
test("frontend RIFF contract rejects malformed containers before runtime startup", async (t) => { const wrongSize = Buffer.from(wav); wrongSize.writeUInt32LE(wav.length - 9, 4); const wrongRate = Buffer.from(fmt); wrongRate.writeUInt32LE(1, 8); const badExtension = Buffer.concat([fmt, Buffer.from([1, 0])]); const partial = riff([chunk("fmt ", fmt), chunk("data", pcm), Buffer.from("JUNK")]); const invalid = [
  ["RIFF size mismatch", wrongSize], ["unannounced trailing bytes", Buffer.concat([wav, Buffer.from([0])])], ["trailing partial header", partial],
  ["duplicate format", riff([chunk("fmt ", fmt), chunk("fmt ", fmt), chunk("data", pcm)])], ["duplicate data", riff([chunk("fmt ", fmt), chunk("data", pcm), chunk("data", pcm)])],
  ["fmt17", riff([chunk("fmt ", Buffer.concat([fmt, Buffer.alloc(1)])), chunk("data", pcm)])], ["nonempty extension", riff([chunk("fmt ", badExtension), chunk("data", pcm)])],
  ["fmt20", riff([chunk("fmt ", Buffer.concat([fmt, Buffer.alloc(4)])), chunk("data", pcm)])], ["wrong byte rate", riff([chunk("fmt ", wrongRate), chunk("data", pcm)])],
  ["missing final padding", riff([chunk("fmt ", fmt), chunk("data", pcm), chunk("JUNK", Buffer.from([1]), false)])], ["missing format", riff([chunk("data", pcm)])], ["missing data", riff([chunk("fmt ", fmt)])],
]; for (const [name, bytes] of invalid) await t.test(name, () => assert.rejects(validateWav(asFile(bytes)), (error) => /^invalid_wav_|^unsupported_wav_/.test(error.code))); });
