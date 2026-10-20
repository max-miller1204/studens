/** Vendor browser ES modules without a build or runtime package dependency. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Usage: node scripts/vendor-quickjs.ts <version>");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "assets/runtime/vendor/quickjs");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "studens-quickjs-"));
const packages = [
  ["core", "quickjs-emscripten-core"],
  ["variant", "@jitl/quickjs-singlefile-browser-release-sync"],
  ["ffi-types", "@jitl/quickjs-ffi-types"],
];
const receipts = [];
try {
  for (const [name, pkg] of packages) {
    const dir = path.join(work, name);
    fs.mkdirSync(dir);
    const [receipt] = JSON.parse(
      execFileSync("npm", ["pack", `${pkg}@${version}`, "--json"], {
        cwd: dir,
        encoding: "utf8",
      }),
    );
    execFileSync("tar", ["xzf", receipt.filename], { cwd: dir });
    const source = path.join(dir, "package");
    const manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    if (manifest.name !== pkg || manifest.version !== version)
      throw new Error(`Unexpected package: ${manifest.name}@${manifest.version}`);
    const dest = path.join(target, name);
    fs.mkdirSync(dest, { recursive: true });
    const files: Record<string, string> = {};
    for (const file of fs.readdirSync(path.join(source, "dist"))) {
      if (!file.endsWith(".mjs")) continue;
      const original = fs.readFileSync(path.join(source, "dist", file), "utf8");
      // Browser modules cannot resolve npm's bare package specifier. No code generation.
      const browser = original.replaceAll('"@jitl/quickjs-ffi-types"', '"../ffi-types/index.mjs"');
      fs.writeFileSync(path.join(dest, file), browser);
      files[file] = createHash("sha256").update(browser).digest("hex");
    }
    fs.copyFileSync(path.join(source, "LICENSE"), path.join(dest, "LICENSE"));
    fs.copyFileSync(path.join(source, "README.md"), path.join(dest, "README.md"));
    receipts.push({
      name: pkg,
      version,
      integrity: receipt.integrity,
      shasum: receipt.shasum,
      files,
    });
  }
  fs.writeFileSync(path.join(target, "VERSION"), `${version}\n`);
  fs.writeFileSync(path.join(target, "provenance.json"), JSON.stringify(receipts, null, 2) + "\n");
  console.log(`Vendored QuickJS browser runtime ${version}.`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
