import http from "node:http";
import { watch } from "node:fs";
import { access, cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const publicDir = path.join(root, "public");
function option(name, fallback) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const buildRequested = process.argv.includes("--build");
const watchRequested = process.argv.includes("--watch");
const port = Number(option("--port", process.env.PORT ?? "4173"));
const host = option("--host", process.env.HOST ?? "127.0.0.1");

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid port: ${String(port)}`);
}

if (watchRequested) {
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await cp(publicDir, dist, { recursive: true, force: true });
} else {
  const distExists = await access(path.join(dist, "index.html")).then(() => true).catch(() => false);
  if (buildRequested || !distExists) {
    const result = spawnSync("node", [path.join(root, "scripts/build.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const reloadClients = new Set();
let reloadTimer;

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const response of reloadClients) response.write("data: reload\n\n");
  }, 75);
}

if (watchRequested) {
  const compiler = spawn("tsc", ["-p", path.join(root, "tsconfig.json"), "--watch", "--preserveWatchOutput"], {
    cwd: root,
    stdio: "inherit",
  });
  const publicWatcher = watch(publicDir, { recursive: true }, async (_event, filename) => {
    if (!filename) return;
    const source = path.join(publicDir, filename);
    const target = path.join(dist, filename);
    const info = await stat(source).catch(() => null);
    if (!info?.isFile()) return;
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { force: true });
  });
  const distWatcher = watch(dist, { recursive: true }, scheduleReload);
  const stop = () => {
    compiler.kill();
    publicWatcher.close();
    distWatcher.close();
    server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  compiler.once("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
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
    if (watchRequested && url.pathname === "/__dev_reload") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      response.write("data: connected\n\n");
      reloadClients.add(response);
      request.once("close", () => reloadClients.delete(response));
      return;
    }
    if (watchRequested && url.pathname === "/__dev_reload.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end("const events = new EventSource('/__dev_reload'); events.onmessage = ({ data }) => { if (data === 'reload') location.reload(); };\n");
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(dist, safePath === "/" ? "index.html" : safePath);
    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) filePath = path.join(dist, "index.html");
    let body = await readFile(filePath);
    if (watchRequested && path.extname(filePath) === ".html") {
      body = Buffer.from(body.toString().replace("</body>", '<script type="module" src="/__dev_reload.js"></script></body>'));
    }
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; connect-src 'self' wss: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Not found");
  }
});

server.listen(port, host, () => {
  const hosts = host === "0.0.0.0"
    ? ["localhost", ...Object.values(networkInterfaces()).flatMap((addresses) =>
        (addresses ?? [])
          .filter((address) => address.family === "IPv4" && !address.internal)
          .map((address) => address.address),
      )]
    : [host];
  console.log("Sovereign Demo Day listening on:");
  for (const listeningHost of [...new Set(hosts)]) {
    console.log(`  http://${listeningHost}:${port}`);
  }
});
