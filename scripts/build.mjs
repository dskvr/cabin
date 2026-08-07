import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "assets"), { recursive: true });

const result = spawnSync("tsc", ["-p", path.join(root, "tsconfig.json")], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

await cp(path.join(root, "public"), dist, { recursive: true });
await cp(
  path.join(root, "node_modules", "qrcode-generator", "qrcode.js"),
  path.join(dist, "assets", "qrcode.js"),
);
console.log(`Built ${dist}`);
