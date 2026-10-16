/** A loopback-only static preview. Analysis runs in the browser, not here. */
import { createServer as createHttpServer } from "node:http";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WEB_ROOT = resolve(PROJECT_ROOT, "web");
const ASSETS = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["app.js", "text/javascript; charset=utf-8"],
  ["app.css", "text/css; charset=utf-8"],
  ["dsp-worker.js", "text/javascript; charset=utf-8"],
  ["bridge.py", "text/plain; charset=utf-8"],
  ["engine/audio_regression_engine-0.1.20-py3-none-any.whl", "application/octet-stream"],
  ["demo/source.wav", "audio/wav"],
  ["demo/baseline.wav", "audio/wav"],
  ["demo/candidate.wav", "audio/wav"],
]);

// The same header is sent for the Worker script: an HTML meta policy alone does
// not restrict requests made from a dedicated worker.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function normalizeBasePath(value = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || !value.endsWith("/")) {
    throw new Error("Base path must begin and end with /, for example /dsp-workbench/.");
  }
  if (value !== "/" && !/^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)+$/.test(value)) {
    throw new Error("Base path must contain ordinary repository-name segments only.");
  }
  return value;
}

function setHeaders(response) {
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "microphone=(), camera=(), geolocation=()");
}

function sendText(request, response, status, body) {
  const bytes = Buffer.from(body, "utf8");
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": bytes.length,
  });
  response.end(request.method === "HEAD" ? undefined : bytes);
}

function permittedHost(request) {
  const host = request.headers.host;
  const port = request.socket.localPort;
  if (typeof host !== "string" || !Number.isInteger(port)) return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`].includes(host.toLowerCase());
}

function selectAsset(requestTarget, basePath) {
  // Inspect the raw target first. WHATWG URL parsing normalizes dot segments,
  // which would otherwise hide an attempted traversal before validation.
  if (typeof requestTarget !== "string" || !requestTarget.startsWith("/")
      || requestTarget.includes("#") || /%2f|%5c/i.test(requestTarget.split("?", 1)[0])) return null;
  const rawPath = requestTarget.split("?", 1)[0];
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(path) || path.includes("//")) return null;
  const segments = path.split("/").filter(Boolean);
  if (segments.some(segment => segment === "." || segment === ".." || segment.startsWith("."))) return null;
  if (!path.startsWith(basePath)) return null;
  const relative = path.slice(basePath.length);
  const asset = relative === "" ? "index.html" : relative;
  return ASSETS.has(asset) ? asset : null;
}

async function readAsset(webRoot, asset) {
  const target = resolve(webRoot, ...asset.split("/"));
  const resolvedRoot = await realpath(webRoot);
  const resolvedTarget = await realpath(target);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) throw new Error("Invalid asset path.");
  // Only the known regular assets are served; symlinks must not expose files
  // that happen to live outside the handoff directory.
  const relativeParts = asset.split("/");
  let component = webRoot;
  for (const part of relativeParts) {
    component = resolve(component, part);
    if ((await lstat(component)).isSymbolicLink()) throw new Error("Symlink assets are not served.");
  }
  const handle = await open(target, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Asset is not a regular file.");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export function createServer({ webRoot = DEFAULT_WEB_ROOT, basePath = "/" } = {}) {
  const root = resolve(webRoot);
  const prefix = normalizeBasePath(basePath);
  return createHttpServer({ maxHeaderSize: 8192 }, (request, response) => {
    setHeaders(response);
    if (!permittedHost(request)) {
      sendText(request, response, 403, "Loopback host required.\n");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(request, response, 405, "Only GET and HEAD are supported. No upload endpoint exists.\n");
      request.resume();
      return;
    }
    const asset = selectAsset(request.url, prefix);
    if (!asset) {
      sendText(request, response, 404, "Not found.\n");
      return;
    }
    readAsset(root, asset).then(bytes => {
      response.writeHead(200, {
        "Content-Type": ASSETS.get(asset),
        "Content-Length": bytes.length,
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    }).catch(() => {
      sendText(request, response, 404, "Not found.\n");
    });
  });
}

export function parseArguments(argumentsList, environment = process.env) {
  let port = environment.PORT ?? "8000";
  let basePath = "/";
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--port" || argument === "--base-path") {
      const value = argumentsList[++index];
      if (value === undefined) throw new Error(`${argument} requires a value.`);
      if (argument === "--port") port = value;
      else basePath = value;
    } else {
      throw new Error(`Unsupported argument: ${argument}`);
    }
  }
  if (typeof port !== "string" || !/^[0-9]{1,5}$/.test(port)
      || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("Port must be an integer from 1 to 65535.");
  }
  return { port: Number(port), basePath: normalizeBasePath(basePath) };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const server = createServer(options);
  server.on("error", error => {
    console.error(error.code === "EADDRINUSE"
      ? "Port is already in use. Choose another with --port."
      : "Local preview could not start. Check the chosen port and file permissions.");
    process.exitCode = 1;
  });
  server.listen(options.port, "127.0.0.1", () => {
    console.log(`DSP Workbench local preview: http://127.0.0.1:${options.port}${options.basePath}`);
    console.log("Local preview only. No audio uploads. Stop with Ctrl+C.");
  });
  const shutdown = () => {
    server.close();
    server.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
