import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildDemo, DEMO_DIRECTORY, DEMO_FILES, ENGINE_SHA256, GENERATED_FILES } from "../scripts/build-demo.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "dsp-demo-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [source] of DEMO_FILES) {
    const target = join(root, source);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(ROOT, source)));
  }
  return root;
}
async function allFiles(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await allFiles(root, path));
    else result.push(path);
  }
  return result.sort();
}

test("demo package copies only explicit runtime, synthetic examples and notices", async t => {
  const root = await fixture(t);
  for (const privatePath of ["web/unreviewed.wav", "web/.env", ".git/config", "archives/private.zip", "recordings/private.m4a"]) {
    await mkdir(dirname(join(root, privatePath)), { recursive: true });
    await writeFile(join(root, privatePath), "must never be copied");
  }
  const manifest = await buildDemo({ projectRoot: root });
  assert.deepEqual(await allFiles(join(root, DEMO_DIRECTORY)), [...DEMO_FILES.map(([, path]) => path), ...GENERATED_FILES].sort());
  assert.equal(manifest.engine_wheel_sha256, ENGINE_SHA256);
  assert.equal(manifest.audio, "three_owned_synthetic_examples_only");
  for (const [source, path] of DEMO_FILES) {
    assert.deepEqual(await readFile(join(root, DEMO_DIRECTORY, path)), await readFile(join(root, source)));
  }
  const text = await readFile(join(root, DEMO_DIRECTORY, "demo-manifest.json"), "utf8");
  assert.ok(!text.includes(root));
  assert.doesNotMatch(text, /[A-Za-z]:\\|\/Users\/|\/home\//);
  assert.deepEqual(JSON.parse(text), manifest);
});

test("demo package is deterministic and safely rebuilds only its owned allowlist", async t => {
  const root = await fixture(t);
  const first = await buildDemo({ projectRoot: root });
  const second = await buildDemo({ projectRoot: root });
  assert.deepEqual(second, first);
  for (const item of second.files) {
    const bytes = await readFile(join(root, DEMO_DIRECTORY, item.path));
    assert.equal(item.bytes, bytes.length);
    assert.equal(item.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
});

test("unexpected output files fail closed and are preserved", async t => {
  const root = await fixture(t);
  await buildDemo({ projectRoot: root });
  const unexpected = join(root, DEMO_DIRECTORY, "private.wav");
  await writeFile(unexpected, "preserve this");
  await assert.rejects(buildDemo({ projectRoot: root }), /Unexpected files/);
  assert.equal(await readFile(unexpected, "utf8"), "preserve this");
});

test("unowned existing output is not overwritten", async t => {
  const root = await fixture(t);
  await mkdir(join(root, DEMO_DIRECTORY));
  await writeFile(join(root, DEMO_DIRECTORY, "index.html"), "not our output");
  await assert.rejects(buildDemo({ projectRoot: root }), /not an owned/);
  assert.equal(await readFile(join(root, DEMO_DIRECTORY, "index.html"), "utf8"), "not our output");
});

test("unexpected empty output directories are not silently included", async t => {
  const root = await fixture(t);
  await buildDemo({ projectRoot: root });
  await mkdir(join(root, DEMO_DIRECTORY, "unreviewed"));
  await assert.rejects(buildDemo({ projectRoot: root }), /Unexpected directories/);
});

test("hard-linked output files cannot cause writes outside the package", async t => {
  const root = await fixture(t);
  await buildDemo({ projectRoot: root });
  const external = join(root, "preserved.html");
  const output = join(root, DEMO_DIRECTORY, "index.html");
  await writeFile(external, "leave unchanged");
  await rm(output);
  try { await link(external, output); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip("OS does not permit hard links."); return; } throw error; }
  await assert.rejects(buildDemo({ projectRoot: root }), /Hard-linked/);
  assert.equal(await readFile(external, "utf8"), "leave unchanged");
});

test("modified engine wheel fails before creating output", async t => {
  const root = await fixture(t);
  await writeFile(join(root, DEMO_FILES.find(([, target]) => target.endsWith(".whl"))[0]), "modified wheel");
  await assert.rejects(buildDemo({ projectRoot: root }), /pinned DSP wheel/);
  await assert.rejects(readdir(join(root, DEMO_DIRECTORY)), { code: "ENOENT" });
});

test("a missing required asset fails before creating output", async t => {
  const root = await fixture(t);
  await rm(join(root, "web/demo/source.wav"));
  await assert.rejects(buildDemo({ projectRoot: root }), { code: "ENOENT" });
  await assert.rejects(readdir(join(root, DEMO_DIRECTORY)), { code: "ENOENT" });
});

test("symlink output cannot redirect package writes", async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "dsp-demo-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  try { await symlink(outside, join(root, DEMO_DIRECTORY), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip("OS does not permit directory symlinks."); return; } throw error; }
  await assert.rejects(buildDemo({ projectRoot: root }), /regular directory/);
  assert.deepEqual(await readdir(outside), []);
});

test("all runtime entry points resolve under a GitHub project-site prefix", async () => {
  const base = "https://example.github.io/dsp-workbench/";
  const targets = new Set(DEMO_FILES.map(([, target]) => target));
  for (const relative of ["./app.css", "./app.js", "./dsp-worker.js", "./bridge.py", "./engine/audio_regression_engine-0.1.20-py3-none-any.whl", "./demo/source.wav", "./demo/baseline.wav", "./demo/candidate.wav"]) {
    const url = new URL(relative, base);
    assert.equal(url.origin, "https://example.github.io");
    assert.ok(url.pathname.startsWith("/dsp-workbench/"));
    assert.ok(targets.has(url.pathname.slice("/dsp-workbench/".length)));
  }
  const html = await readFile(join(ROOT, "web/index.html"), "utf8");
  const version = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version;
  assert.ok(html.includes(`href="./app.css?v=${version}"`));
  assert.ok(html.includes(`src="./app.js?v=${version}"`));
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/);
  const app = await readFile(join(ROOT, "web/app.js"), "utf8");
  const worker = await readFile(join(ROOT, "web/dsp-worker.js"), "utf8");
  assert.match(app, /new Worker\("\.\/dsp-worker\.js"\)/);
  assert.match(worker, /fetchAsset\("\.\/bridge\.py"/);
  assert.match(worker, /"\.\/engine\/audio_regression_engine-0\.1\.20-py3-none-any\.whl"/);
});

test("Pages workflow is manual-only, pinned, and uploads only the built allowlist", async () => {
  const workflow = await readFile(join(ROOT, ".github/workflows/pages.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|pull_request_target|schedule|release):/m);
  assert.match(workflow, /path: \.demo-dist/);
  assert.match(workflow, /node scripts\/build-demo\.mjs/);
  assert.match(workflow, /inputs\.publish/);
  for (const match of workflow.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|enablement: true/);
});
