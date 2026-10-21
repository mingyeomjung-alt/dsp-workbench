// Distribution checks, not a benchmark of detection accuracy or production fitness.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const read = (name) => fs.readFileSync(path.join(web, name), "utf8");
const digest = (name) => createHash("sha256").update(fs.readFileSync(path.join(web, name))).digest("hex");
const webFiles = ["app.css", "app.js", "bridge.py", "demo/baseline.wav", "demo/candidate.wav",
  "demo/source.wav", "dsp-worker.js", "engine/audio_regression_engine-0.1.20-py3-none-any.whl", "index.html"];

function walk(folder, prefix = "") {
  return fs.readdirSync(folder, {withFileTypes: true}).flatMap((entry) => {
    // A clone/checkout necessarily has Git metadata. It is not shipped web data.
    if (prefix === "" && [".git", ".demo-dist"].includes(entry.name)) return [];
    const relative = prefix + entry.name;
    assert.equal(fs.lstatSync(path.join(folder, entry.name)).isSymbolicLink(), false, relative);
    return entry.isDirectory() ? walk(path.join(folder, entry.name), relative + "/") : [relative];
  });
}

test("web payload is a strict independent allowlist without hosting credentials", () => {
  assert.deepEqual(walk(web).sort(), webFiles);
  for (const name of walk(root)) {
    assert.doesNotMatch(name, /(?:^|\/)(?:\.openai|\.venv|\.third_party|node_modules|__pycache__|\.env(?:\..*)?)\//i);
    assert.doesNotMatch(name, /(?:^|\/)(?:hosting\.json|credentials?[^/]*|id_rsa|\.DS_Store)$/i);
    assert.ok(/^(?:README(?:\.[A-Za-z-]+)?\.md|DISTRIBUTION\.md|THIRD_PARTY_NOTICES\.md|SECURITY\.md|CONTRIBUTING\.md|PRIVACY\.md|LICENSE(?:\.md|\.txt)?|package\.json|bundle-manifest\.json|\.gitignore)$/.test(name)
      || /^\.github\/(?:ISSUE_TEMPLATE\/[^/]+\.(?:md|ya?ml)|workflows\/(?:check|pages)\.yml|PULL_REQUEST_TEMPLATE\.md)$/.test(name)
      || /^docs\/[^/]+\.md$/.test(name)
      || name === "assets/workbench-en.jpg"
      || name === "archives/dsp-engine-source-0.1.20.zip"
      || /^(?:scripts\/(?:check_engine\.py|serve\.mjs|build-demo\.mjs)|tests\/(?:bundle|server|frontend_lifecycle|wav_contract|demo_package)\.test\.mjs)$/.test(name)
      || webFiles.some((value) => name === "web/" + value), `Unexpected distribution file: ${name}`);
  }
});

test("payload inventory binds every shipped runtime file and example screenshot", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "bundle-manifest.json"), "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.distribution_status, "public_experimental_evaluation");
  assert.equal(manifest.browser_adapter_version, "0.1.20-web.4");
  assert.equal(manifest.interface_language, "en");
  assert.equal(manifest.engine_version, "0.1.20");
  const names = manifest.files.map((entry) => entry.path);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.slice().sort(), [...webFiles.map((name) => "web/" + name), "assets/workbench-en.jpg"].sort());
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path);
  }
});

test("experimental checkpoint preserves the reviewed frozen source archive", () => {
  const bytes = fs.readFileSync(path.join(root, "archives/dsp-engine-source-0.1.20.zip"));
  assert.equal(bytes.length, 948970);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "f4c26f63f93e8c2c7596e2bc92c0a0144a86d5bdccaa6e5823bcc30c4bdfe4a2");
});

test("check workflow stays read-only and local scripts cannot publish", () => {
  const value = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(value.private, true);
  assert.deepEqual(Object.keys(value.scripts).sort(), ["build:demo", "start", "test"]);
  assert.equal(value.scripts["build:demo"], "node scripts/build-demo.mjs");
  assert.equal(value.dependencies, undefined);
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/check.yml"), "utf8");
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request|pull_request_target|release|schedule|pages)\s*:/m);
  assert.doesNotMatch(workflow, /(?:contents|id-token|packages|pages):\s*write|publish-pages|deploy-pages|npm publish|git push/);
  for (const [, reference] of workflow.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(reference, /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+@[0-9a-f]{40}$/);
});

test("frozen engine and only three owned synthetic WAVs retain their exact pins", () => {
  assert.equal(digest("engine/audio_regression_engine-0.1.20-py3-none-any.whl"),
    "3f6dd9a01b68591bf2dd6a9851091b0e124661a2d509739a3f68d679eceab5d7");
  assert.deepEqual(walk(root).filter((value) => /\.(?:wav|mp3|m4a|ogg|flac)$/i.test(value)).sort(),
    ["web/demo/baseline.wav", "web/demo/candidate.wav", "web/demo/source.wav"]);
  assert.equal(digest("demo/source.wav"), "dbca1c247fae6de0f7ea5dd8886c6fe603554e9a8a0578e031de9917084c9c8b");
  assert.equal(digest("demo/baseline.wav"), digest("demo/source.wav"));
  assert.equal(digest("demo/candidate.wav"), "e40bf02b7a183bac2caecf7ab295faf33f92030e9f7121e4394e8cf0bb98b5d4");
});

test("text assets expose neither workstation paths nor the existing private Site", () => {
  for (const name of walk(root).filter((value) => /\.(?:html|js|mjs|css|py|json|md|ya?ml|txt)$/i.test(value))) {
    if (name === "tests/bundle.test.mjs") continue; // This test contains forbidden test patterns.
    const value = fs.readFileSync(path.join(root, name), "utf8");
    assert.doesNotMatch(value, /[A-Z]:[\\/](?:Users|Program Files)|OneDrive|\uce74\uce74\uc624\ud1a1 \ubc1b\uc740 \ud30c\uc77c|\ud1b5\ud654\uae30\ub85d\.m4a|\ub179\uc74c\ubcf8\ub098\uc758\.m4a/i, name);
    assert.doesNotMatch(value, /[a-z0-9-]+\.chatgpt\.site|appgprj_[a-z0-9]+|poetic-civet/i, name);
    assert.doesNotMatch(value, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, name);
  }
});

test("GitHub-project subpaths resolve the same local worker, assets, and demos", () => {
  const html = read("index.html"), app = read("app.js"), worker = read("dsp-worker.js");
  const base = new URL("https://example.invalid/owner-project/web/");
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (url.startsWith("#")) continue;
    if (url.startsWith("https://")) {
      assert.equal(new URL(url.replaceAll("&amp;", "&")).origin, "https://github.com");
      assert.ok(new URL(url).pathname.startsWith("/mingyeomjung-alt/dsp-workbench"));
      continue;
    }
    assert.ok(url.startsWith("./"), `Page URL must be project-relative: ${url}`);
    assert.equal(new URL(url, base).pathname.startsWith("/owner-project/web/"), true);
    if (/\/app\.(?:js|css)$/.test(new URL(url, base).pathname)) {
      const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
      assert.equal(new URL(url, base).searchParams.get("v"), version, "Browser assets must use the adapter revision as a cache key");
    }
  }
  assert.match(app, /new Worker\("\.\/dsp-worker\.js"/);
  assert.match(app, /fetch\(`\.\/demo\/\$\{role\}\.wav`/);
  assert.match(worker, /ENGINE_WHEEL = "\.\/engine\/audio_regression_engine-0\.1\.20-py3-none-any\.whl"/);
  assert.match(worker, /fetchAsset\("\.\/bridge\.py"/);
  for (const value of [app, worker]) {
    assert.doesNotMatch(value, /(?:fetch|new\s+Worker|importScripts)\s*\(\s*["'`]\/(?!\/)/);
  }
});

test("documentation links and screenshots resolve within the reviewed repository", () => {
  const files = walk(root).filter((name) => /\.md$/.test(name));
  assert.ok(files.includes("README.md"));
  for (const name of files) {
    const markdown = fs.readFileSync(path.join(root, name), "utf8");
    for (const [, raw] of markdown.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = raw.replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
      assert.doesNotMatch(link, /^(?:\/|[A-Za-z]:|file:)/);
      const target = path.resolve(root, path.dirname(name), decodeURIComponent(link.split("#")[0]));
      assert.ok(target === root || target.startsWith(root + path.sep), `Escaping README link: ${link}`);
      assert.ok(fs.existsSync(target), `Broken README link: ${name} -> ${link}`);
    }
  }
});

test("public evaluation entry points retain narrow rights and privacy-safe feedback", () => {
  const licence = fs.readFileSync(path.join(root, "LICENSE.md"), "utf8");
  assert.match(licence, /solely to\s+evaluate the prototype/);
  assert.match(licence, /production use is\s+not/);
  assert.match(licence, /requires separate written permission/);
  assert.match(licence, /GitHub's Terms of Service/);
  const packageInfo = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageInfo.private, true); // npm publication guard, not GitHub visibility.
  assert.equal(packageInfo.license, "SEE LICENSE IN LICENSE.md");
  for (const name of ["README.md"]) {
    const value = fs.readFileSync(path.join(root, name), "utf8");
    assert.match(value, /git clone https:\/\/github\.com\/mingyeomjung-alt\/dsp-workbench\.git/);
    assert.match(value, /\[.*?\]\(LICENSE\.md\)/);
    for (const template of ["bug_report.yml", "usage_feedback.yml"]) {
      assert.ok(value.includes(`issues/new?template=${template}`), `${name}: ${template}`);
    }
  }
  for (const name of ["bug_report.yml", "usage_feedback.yml"]) {
    const value = fs.readFileSync(path.join(root, ".github/ISSUE_TEMPLATE", name), "utf8");
    assert.match(value, /This issue and its attachments are public/);
    assert.match(value, /required: true/);
    assert.match(value, /credentials/);
    assert.match(value, /audio/);
  }
  const security = fs.readFileSync(path.join(root, "SECURITY.md"), "utf8");
  assert.match(security, /Do not put vulnerabilities/);
  assert.match(security, /without technical exploit details or private information/);
});

test("current documentation, application, and issue forms use English presentation", () => {
  const currentText = walk(root).filter((name) => /\.(?:md|html|js|mjs|css|py|json|ya?ml)$/.test(name));
  for (const name of currentText) {
    const value = fs.readFileSync(path.join(root, name), "utf8");
    assert.doesNotMatch(value, /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u, name);
  }
  assert.match(read("index.html"), /<html lang="en">/);
  assert.match(read("app.js"), /Run comparison/);
  assert.match(read("app.js"), /Review required/);
  assert.match(read("index.html"), /Load example/);
});

test("page CSP blocks forms, objects, base overrides, and unsandboxed reports", () => {
  const html = read("index.html");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1];
  assert.ok(csp);
  for (const directive of ["default-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(csp.includes(directive), directive);
  }
  assert.match(csp, /connect-src 'self' https:\/\/cdn\.jsdelivr\.net(?:;|$)/);
  assert.doesNotMatch(csp, /(?:connect-src|script-src)[^;]*\*/);
  assert.match(html, /<iframe[^>]+id="report-frame"[^>]+sandbox=""/);
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(html, /\bon(?:click|load|error|submit)\s*=/i);
});

test("audio remains local, outputs use downloadable blobs, and untrusted text is not HTML", () => {
  const app = read("app.js"), worker = read("dsp-worker.js"), bridge = read("bridge.py");
  for (const value of [app, worker]) {
    assert.doesNotMatch(value, /XMLHttpRequest|WebSocket|sendBeacon|indexedDB|localStorage|FormData\s*\(/);
    assert.doesNotMatch(value, /method\s*:\s*["'](?:POST|PUT|PATCH)["']/i);
  }
  assert.doesNotMatch(bridge, /\b(?:from|import)\s+(?:requests|urllib|socket|httpx|pyfetch)\b/);
  assert.doesNotMatch(app, /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|\beval\s*\(|new\s+Function\s*\(/);
  assert.match(app, /el\.textContent = text/);
  assert.match(app, /new Blob\(\[text\]/);
  assert.match(app, /link\.download = `dsp-/);
  assert.match(app, /URL\.revokeObjectURL\(url\)/);
  assert.match(bridge, /from audio_regression\.api import analyze_pair/);
  assert.match(bridge, /from audio_regression\.regression_suite import run_regression_suite/);
});

test("frontend IDs exist once and stale/cancelled results cannot replace the active run", () => {
  const html = read("index.html"), app = read("app.js");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of app.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  assert.match(app, /if \(generation !== workerGeneration\) return/);
  assert.match(app, /data\.id === currentRun\.id/);
  assert.match(app, /if \(generation !== runCounter\) return/);
  assert.match(app, /function cancel\(\)\s*\{[\s\S]*?runCounter\+\+;[\s\S]*?destroyWorker\(\);[\s\S]*?clearResult\(\)/);
  assert.match(app, /if \(worker\) worker\.terminate\(\)/);
  assert.match(app, /payload\.result\.complete_audio_approval !== false/);
  assert.match(app, /payload\.result\.commercial_performance_validated !== false/);
});

function harness() {
  const messages = [], requests = [];
  let imports = 0;
  const context = vm.createContext({ArrayBuffer, Uint8Array, TextDecoder, crypto: webcrypto,
    self: {crypto: webcrypto, postMessage(value) {messages.push(value);}},
    importScripts() {imports += 1; throw new Error("Unexpected download");},
    async fetch(...args) {requests.push(args); throw new Error("Unexpected fetch");}});
  vm.runInContext(read("dsp-worker.js"), context, {filename: "dsp-worker.js"});
  return {context, messages, requests, imports: () => imports,
    send: (data) => context.self.onmessage({data}), validate: vm.runInContext("validateRequest", context)};
}

function request(mode = "pair") {
  return {type: "run", id: "bundle-test-1", mode,
    configuration: {engine: "v11", allow_gain: false, allow_resampling: false, max_delay_ms: 1000, resampling_model: null},
    versions: {baseline: "fixed baseline", candidate: "candidate"},
    cases: [{case_id: "case-1", source: new ArrayBuffer(44), candidate: new ArrayBuffer(44),
      ...(mode === "suite" ? {baseline: new ArrayBuffer(44)} : {})}]};
}

test("worker rejects bad inputs before downloading runtime or touching files", async (t) => {
  const mutations = [
    ["unknown field", (v) => {v.upload_url = "https://example.invalid/audio";}],
    ["unknown mode", (v) => {v.mode = "execute";}],
    ["invalid ID", (v) => {v.id = Infinity;}],
    ["unknown engine", (v) => {v.configuration.engine = "v2";}],
    ["nonboolean declaration", (v) => {v.configuration.allow_gain = "false";}],
    ["negative delay", (v) => {v.configuration.max_delay_ms = -1;}],
    ["nonfinite delay", (v) => {v.configuration.max_delay_ms = Infinity;}],
    ["unbounded delay", (v) => {v.configuration.max_delay_ms = 5001;}],
    ["undeclared resampler", (v) => {v.configuration.resampling_model = "unknown";}],
    ["wrong v12 declaration", (v) => {v.configuration.engine = "v12";}],
    ["blank label", (v) => {v.versions.baseline = " ";}],
    ["control in label", (v) => {v.versions.candidate = "bad\nlabel";}],
    ["no cases", (v) => {v.cases = [];}],
    ["two pair cases", (v) => {v.cases.push({...v.cases[0], case_id: "case-2"});}],
    ["case path", (v) => {v.cases[0].case_id = "../private";}],
    ["unexpected role", (v) => {v.cases[0].baseline = new ArrayBuffer(44);}],
    ["view instead of buffer", (v) => {v.cases[0].source = new Uint8Array(44);}],
    ["truncated file", (v) => {v.cases[0].candidate = new ArrayBuffer(43);}],
    ["oversized file", (v) => {v.cases[0].candidate = new ArrayBuffer(10_000_001);}],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const worker = harness(), value = request(); mutate(value);
    await worker.send(value);
    assert.equal(worker.messages.at(-1).type, "error");
    assert.match(worker.messages.at(-1).code, /^(?:invalid|duplicate|web_input_budget)_/);
    assert.equal(worker.imports(), 0); assert.equal(worker.requests.length, 0);
  });
});

test("worker guards six-case, role-byte budgets, and case-insensitive duplicates", () => {
  const worker = harness();
  const duplicate = request("suite"); duplicate.cases.push({...duplicate.cases[0], case_id: "CASE-1"});
  assert.throws(() => worker.validate(duplicate), /duplicate_web_case_id/);
  const many = request("suite"); many.cases = Array.from({length: 7}, (_, index) => ({...many.cases[0], case_id: `case-${index}`}));
  assert.throws(() => worker.validate(many), /invalid_web_case_count/);
  const large = request("suite"), shared = new ArrayBuffer(10_000_000);
  large.cases = Array.from({length: 3}, (_, index) => ({case_id: `case-${index}`, source: shared, baseline: shared, candidate: shared}));
  assert.throws(() => worker.validate(large), /web_input_budget_exceeded/);
});

test("worker only accepts explicit v12 processing and pins dependency/runtime initialization", () => {
  const worker = harness(), value = request();
  Object.assign(value.configuration, {engine: "v12", allow_resampling: true,
    resampling_model: "scipy_fft_periodic_48k_16k_pcm16_postedit_v1"});
  assert.equal(worker.validate(value).configuration.engine, "v12");
  value.configuration.allow_gain = true;
  assert.throws(() => worker.validate(value), /invalid_web_resampling_declaration/);
  const text = read("dsp-worker.js");
  assert.match(text, /const PYODIDE_VERSION = "0\.29\.3"/);
  assert.match(text, /if \(pyodide\.version !== PYODIDE_VERSION\) reject/);
  assert.match(text, /if \(digest !== ENGINE_SHA256\) reject\("engine_integrity_mismatch"\)/);
  assert.match(text, /if \(runtime\.engine !== "0\.1\.20"\) reject/);
});

test("frontend WAV validation rejects unsupported encodings rather than silently converting", async (t) => {
  const app = read("app.js"), start = app.indexOf("  async function validateWav(file) {");
  const end = app.indexOf("  async function run() {", start);
  assert.ok(start >= 0 && end > start);
  const validate = vm.runInNewContext("(" + app.slice(start, end).trim() + ")", {DataView, Uint8Array, MAX_FILE: 10_000_000});
  const original = fs.readFileSync(path.join(web, "demo/source.wav"));
  const file = (bytes) => ({name: "selected.wav", arrayBuffer: async () => Uint8Array.from(bytes).buffer});
  assert.equal((await validate(file(original))).byteLength, original.byteLength);
  const variants = [
    ["short", original.subarray(0, 40)],
    ["wrong signature", (() => {const b = Buffer.from(original); b.write("OggS", 0); return b;})()],
    ["float", (() => {const b = Buffer.from(original); b.writeUInt16LE(3, 20); return b;})()],
    ["stereo", (() => {const b = Buffer.from(original); b.writeUInt16LE(2, 22); return b;})()],
    ["24 bit", (() => {const b = Buffer.from(original); b.writeUInt16LE(24, 34); return b;})()],
    ["unsupported rate", (() => {const b = Buffer.from(original); b.writeUInt32LE(22050, 24); return b;})()],
    ["truncated", original.subarray(0, original.length - 1)],
  ];
  for (const [name, bytes] of variants) await t.test(name, () => assert.rejects(validate(file(bytes)),
    (error) => /^invalid_wav_|^unsupported_wav_/.test(error.code)));
});
