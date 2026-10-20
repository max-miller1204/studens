import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const failures: string[] = [];
let checked = 0;
for (const [location, entry] of Object.entries(lock.packages) as [
  string,
  { version?: string; dev?: boolean; optional?: boolean },
][]) {
  if (!location || entry.dev) continue;
  const manifest = path.join(root, location, "package.json");
  if (!fs.existsSync(manifest)) {
    if (!entry.optional) failures.push(`${location}: required production package is missing`);
    continue;
  }
  const installed = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (installed.version !== entry.version)
    failures.push(`${location}: installed ${installed.version}, lock expects ${entry.version}`);
  checked++;
}
if (failures.length) {
  console.error(`Production dependency files differ from the lock:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${checked} installed production package versions against the lock.`);
}
