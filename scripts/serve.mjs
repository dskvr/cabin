import http from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
function option(name, fallback) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const buildRequested = process.argv.includes("--build");
const port = Number(option("--port", process.env.PORT ?? "4173"));
const host = option("--host", process.env.HOST ?? "127.0.0.1");

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid port: ${String(port)}`);
}

const distExists = await access(path.join(dist, "index.html")).then(() => true).catch(() => false);
if (buildRequested || !distExists) {
  const result = spawnSync("node", [path.join(root, "scripts/build.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".map", "application/json; charset=utf-8"],
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(dist, safePath === "/" ? "index.html" : safePath);
    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) filePath = path.join(dist, "index.html");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      "cache-control": path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=3600",
      "content-security-policy": "default-src 'self'; connect-src 'self' wss: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Not found");
  }
});

server.listen(port, host, () => {
  const printableHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Sovereign Demo Day: http://${printableHost}:${port}`);
});
