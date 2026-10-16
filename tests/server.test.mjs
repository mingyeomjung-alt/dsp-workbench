import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm, symlink, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CONTENT_SECURITY_POLICY, createServer, normalizeBasePath, parseArguments } from "../scripts/serve.mjs";

async function fixture(context, options = {}) {
  const webRoot = await mkdtemp(join(tmpdir(), "dsp-static-preview-"));
  await mkdir(join(webRoot, "engine"));
  await mkdir(join(webRoot, "demo"));
  for (const [name, content] of [
    ["index.html", "<!doctype html><title>DSP fixture</title>"],
    ["app.js", "console.log('fixture');"],
    ["app.css", "body { color: #123; }"],
    ["dsp-worker.js", "self.onmessage = () => {};"],
    ["bridge.py", "pass\n"],
    ["demo/source.wav", "RIFFsource"],
    ["demo/baseline.wav", "RIFFbaseline"],
    ["demo/candidate.wav", "RIFFcandidate"],
    ["engine/audio_regression_engine-0.1.20-py3-none-any.whl", "fixture wheel"],
    ["secret.txt", "must not serve"],
    [".env", "must not serve"],
  ]) await writeFile(join(webRoot, ...name.split("/")), content);
  const server = createServer({ webRoot, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(webRoot, { recursive: true, force: true });
  });
  return { port, webRoot };
}

function get(port, path = "/", options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, ...options }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("root serves known static files with correct MIME and bounded content", async context => {
  const { port } = await fixture(context);
  const root = await get(port);
  assert.equal(root.status, 200);
  assert.match(root.body.toString(), /DSP fixture/);
  assert.equal(Number(root.headers["content-length"]), root.body.length);
  assert.equal(root.headers["content-type"], "text/html; charset=utf-8");
  for (const [path, mime] of [
    ["/index.html", "text/html; charset=utf-8"],
    ["/app.js", "text/javascript; charset=utf-8"],
    ["/app.css", "text/css; charset=utf-8"],
    ["/dsp-worker.js", "text/javascript; charset=utf-8"],
    ["/bridge.py", "text/plain; charset=utf-8"],
    ["/demo/source.wav", "audio/wav"],
    ["/demo/baseline.wav", "audio/wav"],
    ["/demo/candidate.wav", "audio/wav"],
    ["/engine/audio_regression_engine-0.1.20-py3-none-any.whl", "application/octet-stream"],
  ]) {
    const response = await get(port, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers["content-type"], mime, path);
    assert.equal(Number(response.headers["content-length"]), response.body.length, path);
  }
  assert.equal((await get(port, "/app.js?cache=ignored")).status, 200);
  assert.equal((await get(port, "/%61pp.js")).status, 200);
});

test("HEAD returns asset headers without a body", async context => {
  const { port } = await fixture(context);
  for (const path of ["/", "/app.js", "/demo/source.wav", "/missing"]) {
    const normal = await get(port, path);
    const head = await get(port, path, { method: "HEAD" });
    assert.equal(head.status, normal.status);
    assert.equal(head.headers["content-length"], normal.headers["content-length"]);
    assert.equal(head.body.length, 0);
  }
});

test("GitHub Pages-style subpath works without exposing root assets", async context => {
  const { port } = await fixture(context, { basePath: "/dsp-workbench/" });
  for (const path of ["/dsp-workbench/", "/dsp-workbench/index.html", "/dsp-workbench/app.js", "/dsp-workbench/dsp-worker.js", "/dsp-workbench/demo/source.wav", "/dsp-workbench/engine/audio_regression_engine-0.1.20-py3-none-any.whl"]) {
    assert.equal((await get(port, path)).status, 200, path);
  }
  for (const path of ["/", "/app.js", "/dsp-workbench", "/dsp-workbench-other/app.js"]) {
    assert.equal((await get(port, path)).status, 404, path);
  }
});

test("unknown, dot, traversal, encoded separator and malformed paths are rejected", async context => {
  const { port } = await fixture(context);
  for (const path of [
    "/secret.txt", "/.env", "/.git/config", "/engine/", "/demo/", "/scripts/serve.mjs", "/package.json",
    "/../index.html", "/demo/../app.js", "/%2e%2e/index.html", "/%2e/index.html", "/demo/%2E%2E/app.js",
    "/demo%2fsource.wav", "/demo%2Fsource.wav", "/demo%5csource.wav", "/demo\\source.wav",
    "/%00index.html", "/index.html%00", "/%1findex.html", "/%7findex.html", "/%", "/%zz", "/%E0%A4%A",
    "//app.js", "/app.js/", "/app.js#fragment", "/%252e%252e/index.html",
  ]) assert.equal((await get(port, path)).status, 404, path);
});

test("worker and main documents carry restrictive connection policies and no CORS", async context => {
  const { port } = await fixture(context);
  for (const path of ["/", "/dsp-worker.js", "/bridge.py", "/missing"]) {
    const response = await get(port, path);
    assert.equal(response.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
    assert.match(response.headers["content-security-policy"], /connect-src 'self' https:\/\/cdn\.jsdelivr\.net(?:;|$)/);
    assert.match(response.headers["content-security-policy"], /'wasm-unsafe-eval'/);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  }
});

test("Host rebinding and non-read methods cannot expose an upload endpoint", async context => {
  const { port } = await fixture(context);
  for (const host of ["evil.example", `evil.example:${port}`, `127.0.0.1.evil.example:${port}`, "127.0.0.1:1", `localhost:${port}@evil.example`]) {
    assert.equal((await get(port, "/", { headers: { Host: host } })).status, 403, host);
  }
  assert.equal((await get(port, "/", { headers: { Host: `localhost:${port}` } })).status, 200);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await get(port, "/api/analyze", { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.allow, "GET, HEAD");
  }
  assert.equal((await get(port, "/api/analyze")).status, 404);
  // Newer Node versions reject missing HTTP/1.1 Host at the parser layer.
  assert.ok([400, 403].includes((await get(port, "/", { setHost: false })).status));
});

test("a known asset name cannot expose a symlink target", async context => {
  const { port, webRoot } = await fixture(context);
  await unlink(join(webRoot, "app.js"));
  try {
    await symlink(join(webRoot, "secret.txt"), join(webRoot, "app.js"), "file");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      context.skip("OS does not permit this test to create symlinks.");
      return;
    }
    throw error;
  }
  const response = await get(port, "/app.js");
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.body.toString(), /must not serve/);
});

test("missing files fail closed without disclosing a local path", async context => {
  const { port, webRoot } = await fixture(context);
  await unlink(join(webRoot, "bridge.py"));
  const response = await get(port, "/bridge.py");
  assert.equal(response.status, 404);
  assert.equal(response.body.toString(), "Not found.\n");
  assert.equal(response.body.includes(Buffer.from(webRoot)), false);
});

test("importing the module does not start a preview server", { timeout: 5000 }, async () => {
  const moduleUrl = new URL("../scripts/serve.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(moduleUrl)}); console.log('imported');`], { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", text => { stdout += text; });
  child.stderr.setEncoding("utf8").on("data", text => { stderr += text; });
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr);
  assert.equal(stdout.trim(), "imported");
});

test("invalid CLI arguments exit without starting a server", { timeout: 5000 }, async () => {
  const script = fileURLToPath(new URL("../scripts/serve.mjs", import.meta.url));
  const child = spawn(process.execPath, [script, "--host", "0.0.0.0"], { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", text => { stdout += text; });
  child.stderr.setEncoding("utf8").on("data", text => { stderr += text; });
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /Unsupported argument/);
});

test("argument parsing fixes loopback host and validates port and base path", () => {
  assert.deepEqual(parseArguments([], {}), { port: 8000, basePath: "/" });
  assert.deepEqual(parseArguments([], { PORT: "8123" }), { port: 8123, basePath: "/" });
  assert.deepEqual(parseArguments(["--port", "8124", "--base-path", "/repo.name/"], { PORT: "8123" }), { port: 8124, basePath: "/repo.name/" });
  assert.equal(normalizeBasePath("/org/repo/"), "/org/repo/");
  for (const args of [["--port"], ["--base-path"], ["--host", "0.0.0.0"], ["--port", "0"], ["--port", "65536"], ["--port", "1.5"], ["--port", "-1"], ["--port", "8000x"], ["--base-path", "repo/"], ["--base-path", "/repo"], ["--base-path", "/../"], ["--base-path", "/.private/"], ["--base-path", "/repo//"], ["--base-path", "/repo%20name/"]]) {
    assert.throws(() => parseArguments(args, {}), args.join(" "));
  }
});
