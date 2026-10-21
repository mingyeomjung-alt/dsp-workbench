/** Build only the reviewed browser payload, never a recursive repository copy. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO_DIRECTORY = ".demo-dist";
export const ENGINE_SHA256 = "3f6dd9a01b68591bf2dd6a9851091b0e124661a2d509739a3f68d679eceab5d7";
export const DEMO_FILES = Object.freeze([
  ["web/index.html", "index.html"],
  ["web/app.js", "app.js"],
  ["web/app.css", "app.css"],
  ["web/dsp-worker.js", "dsp-worker.js"],
  ["web/bridge.py", "bridge.py"],
  ["web/engine/audio_regression_engine-0.1.20-py3-none-any.whl", "engine/audio_regression_engine-0.1.20-py3-none-any.whl"],
  ["web/demo/source.wav", "demo/source.wav"],
  ["web/demo/baseline.wav", "demo/baseline.wav"],
  ["web/demo/candidate.wav", "demo/candidate.wav"],
  ["LICENSE.md", "LICENSE.md"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
].map(entry => Object.freeze(entry)));
export const GENERATED_FILES = Object.freeze([".nojekyll", "demo-manifest.json"]);
const PACKAGE_KIND = "dsp-workbench-allowlisted-browser-demo";

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function inspectPath(root, relative, kind) {
  const parts = relative.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[\\\u0000]/.test(part))) {
    throw new Error("Invalid demo package path.");
  }
  let target = root;
  for (let index = 0; index < parts.length; index += 1) {
    target = resolve(target, parts[index]);
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error("Symlinks are not allowed in the demo package.");
    const final = index === parts.length - 1;
    if ((!final || kind === "directory") && !info.isDirectory()) throw new Error("Expected a regular demo directory.");
    if (final && kind === "file" && !info.isFile()) throw new Error("Expected a regular demo file.");
  }
  const canonical = await realpath(target);
  if (!canonical.startsWith(`${root}${sep}`)) throw new Error("Demo path is outside the package root.");
  return target;
}

async function listOutput(root, allowedDirectories, prefix = "") {
  const paths = [];
  for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error("Symlinks are not allowed in the demo output.");
    if (entry.isDirectory()) {
      if (!allowedDirectories.has(relative)) throw new Error("Unexpected directories found in demo output; no files were changed.");
      paths.push(...await listOutput(root, allowedDirectories, relative));
    } else if (entry.isFile()) {
      const info = await lstat(resolve(root, relative));
      if (info.nlink > 1) throw new Error("Hard-linked output files are not replaced.");
      paths.push(relative);
    }
    else throw new Error("Only regular files are allowed in the demo output.");
  }
  return paths;
}

/** Fixed output location; no arbitrary copy, deletion, publication or network operation. */
export async function buildDemo({ projectRoot = PROJECT_ROOT } = {}) {
  const root = await realpath(projectRoot);
  if (!(await lstat(projectRoot)).isDirectory() || (await lstat(projectRoot)).isSymbolicLink()) {
    throw new Error("The project root must be a regular directory.");
  }
  const files = [];
  for (const [source, path] of DEMO_FILES) {
    const bytes = await readFile(await inspectPath(root, source, "file"));
    if (bytes.length > 4 * 1024 * 1024) throw new Error("A reviewed demo asset exceeded its size limit.");
    if (path.endsWith(".whl") && digest(bytes) !== ENGINE_SHA256) throw new Error("The pinned DSP wheel does not match its reviewed hash.");
    files.push({ path, bytes });
  }
  const manifest = {
    schema_version: 1,
    package_kind: PACKAGE_KIND,
    engine_version: "0.1.20",
    engine_wheel_sha256: ENGINE_SHA256,
    audio: "three_owned_synthetic_examples_only",
    collection: "no_audio_or_result_analytics_added",
    files: files.map(({ path, bytes }) => ({ path, bytes: bytes.length, sha256: digest(bytes) })),
  };
  const output = resolve(root, DEMO_DIRECTORY);
  let exists = false;
  try {
    const info = await lstat(output);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Demo output must be a regular directory.");
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (exists) {
    const directories = new Set(files.map(file => dirname(file.path).replaceAll("\\", "/")).filter(path => path !== "."));
    const present = await listOutput(output, directories);
    const allowed = new Set([...files.map(file => file.path), ...GENERATED_FILES]);
    if (present.some(path => !allowed.has(path))) throw new Error("Unexpected files found in demo output; no files were changed.");
    if (present.length) {
      let previous;
      try { previous = JSON.parse(await readFile(await inspectPath(output, "demo-manifest.json", "file"), "utf8")); }
      catch { throw new Error("Existing output is not an owned demo package; no files were changed."); }
      if (previous.schema_version !== 1 || previous.package_kind !== PACKAGE_KIND) {
        throw new Error("Existing output is not an owned demo package; no files were changed.");
      }
    }
  } else await mkdir(output);
  // No recursive deletion is used. Only this exact allowlist can be replaced.
  for (const { path, bytes } of files) {
    const parent = dirname(resolve(output, path));
    await mkdir(parent, { recursive: true });
    await writeFile(resolve(output, path), bytes);
  }
  await writeFile(resolve(output, ".nojekyll"), "");
  await writeFile(resolve(output, "demo-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error("This builder takes no arguments and writes only to .demo-dist/.");
    process.exitCode = 1;
  } else {
    try {
      const result = await buildDemo();
      console.log(`Prepared ${result.files.length} reviewed payload files in ${DEMO_DIRECTORY}/. No publication was performed.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
