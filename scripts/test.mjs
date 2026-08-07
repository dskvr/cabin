import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = spawnSync("node", [path.join(root, "scripts/build.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const tests = spawnSync(process.execPath, ["--test", "tests/*.test.mjs"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
process.exit(tests.status ?? 1);
