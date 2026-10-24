/** Versioned, path-independent evidence for the installed runtime, never a release signature. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

export interface RuntimeIdentity {
  schema: 1;
  sha256: string;
}

// These are consumed at runtime or by the packaged authoring/checking entry points.
// Keep development recipes, tests, screenshots, and tooling out of the closure.
export const runtimePaths = [
  "src",
  "assets",
  "skills",
  "mcp",
  "index.ts",
  "package.json",
  "package-lock.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".codex-plugin/mcp.json",
  "scripts/check-lesson.ts",
  "scripts/playwright.ts",
  "scripts/browser-actions.ts",
  "scripts/code-browser-actions.ts",
  "scripts/faded-browser-actions.ts",
  "scripts/stepper-browser-actions.ts",
  "scripts/lesson-inputs.ts",
  ...[
    "ATTRIBUTION.md",
    "LICENSE.upstream",
    "TEACHING.md",
    "TEACHING-PLAN.md",
    "CODE-EXERCISES.md",
    "COMPONENTS.md",
    "EVIDENCE.md",
    "EVALUATION.md",
    "GLOSSARY-FORMAT.md",
    "LEARNING-RECORD-FORMAT.md",
    "LESSON-OUTPUT.md",
    "MISSION-FORMAT.md",
    "NOTES-FORMAT.md",
    "RESOURCES-FORMAT.md",
    "SOURCE-LINKS.md",
  ].map((name) => `docs/${name}`),
];

export function validRuntimeIdentity(value: unknown): value is RuntimeIdentity {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join(",") === "schema,sha256" &&
    v.schema === 1 &&
    typeof v.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(v.sha256)
  );
}

export function sameRuntimeIdentity(a: unknown, b: unknown): boolean {
  return validRuntimeIdentity(a) && validRuntimeIdentity(b) && a.sha256 === b.sha256;
}

export function runtimeIdentity(root: string, files?: Map<string, string>): RuntimeIdentity {
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`Unsafe runtime package root: ${root}`);
  const hash = createHash("sha256").update("studens-runtime-identity:1\n");
  function safe(relative: string): string {
    const parts = relative.split("/");
    if (parts.some((p) => !p || p === "." || p === ".." || p.includes("\\")))
      throw new Error(`Unsafe runtime identity path: ${relative}`);
    let file = root;
    for (const part of parts) {
      file = path.join(file, part);
      if (fs.lstatSync(file).isSymbolicLink())
        throw new Error(`Runtime identity does not support symbolic links: ${file}`);
    }
    return file;
  }
  function visit(relative: string, dependency = false, nested = false): void {
    // Descendants are reached only through already checked directories.
    const file = nested ? path.join(root, relative) : safe(relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink())
      throw new Error(`Runtime identity does not support symbolic links: ${file}`);
    if (stat.isDirectory()) {
      hash.update(JSON.stringify([relative, "directory"]) + "\n");
      for (const name of fs.readdirSync(file).sort()) {
        // npm's nested dependency trees are covered separately by the lock's production closure.
        if (dependency && name === "node_modules") continue;
        visit(`${relative}/${name}`, dependency, true);
      }
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(file);
      files?.set(file, createHash("sha256").update(bytes).digest("hex"));
      hash.update(JSON.stringify([relative, "file", bytes.length]) + "\n").update(bytes);
    } else throw new Error(`Unsupported runtime identity file: ${file}`);
  }
  try {
    for (const relative of [...runtimePaths].sort()) visit(relative);
    const lock = JSON.parse(fs.readFileSync(safe("package-lock.json"), "utf8"));
    if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object")
      throw new Error("Runtime identity requires a version 3 package lock.");
    const installed = new Set<string>();
    for (const [location, entry] of Object.entries(lock.packages) as [string, any][]) {
      if (!location || entry.dev) continue;
      if (
        !/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(
          location,
        ) ||
        entry.link
      )
        throw new Error(`Unsupported production dependency location: ${location}`);
      try {
        safe(location);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && entry.optional) continue;
        throw error;
      }
      const manifest = JSON.parse(fs.readFileSync(safe(`${location}/package.json`), "utf8"));
      if (manifest.version !== entry.version)
        throw new Error(`Production dependency version differs from lock: ${location}`);
      installed.add(location);
      visit(location, true);
    }
    // Check actual Node search order, including development packages that could shadow
    // the production closure. Never resolve a missing dependency outside this installation.
    for (const location of ["", ...installed]) {
      const manifest = JSON.parse(
        fs.readFileSync(safe(location ? `${location}/package.json` : "package.json"), "utf8"),
      );
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      };
      for (const name of Object.keys(dependencies)) {
        if (!/^(?:@[^/]+\/)?[^/.][^/]*$/.test(name))
          throw new Error(`Invalid dependency name: ${name}`);
        let cursor = path.join(root, location);
        let found: string | undefined;
        while (cursor.startsWith(root + path.sep) || cursor === root) {
          if (path.basename(cursor) !== "node_modules") {
            const candidate = path.join(cursor, "node_modules", name);
            if (fs.existsSync(candidate)) {
              found = path.relative(root, candidate).split(path.sep).join("/");
              break;
            }
          }
          if (cursor === root) break;
          cursor = path.dirname(cursor);
        }
        if (
          found
            ? !installed.has(found)
            : !(
                name in (manifest.optionalDependencies ?? {}) ||
                manifest.peerDependenciesMeta?.[name]?.optional
              )
        )
          throw new Error(
            `Production dependency ${name} of ${location || "package"} is missing or outside the production closure.`,
          );
      }
    }
    return { schema: 1, sha256: hash.digest("hex") };
  } catch (error) {
    throw new Error(`Cannot establish runtime package identity: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

export function assertRuntimeUnchanged(root: string, startup: RuntimeIdentity): void {
  if (!sameRuntimeIdentity(startup, runtimeIdentity(root)))
    throw new Error(
      "Runtime package changed after startup. Stop the service explicitly and retry; no replacement was started.",
    );
}

/** Keep actual module resolution inside the hashed closure, including lazy imports.
 * Compare the bytes supplied by Node's loader, before evaluation, with the snapshot.
 * Development-only/undeclared dependencies must never become invisible runtime code.
 */
export function guardRuntimeModules(
  files: ReadonlyMap<string, string>,
): ReturnType<typeof registerHooks> {
  function expected(url: string): string | undefined {
    if (url.startsWith("node:")) return;
    if (url.startsWith("file:")) {
      const digest = files.get(fileURLToPath(url));
      if (digest) return digest;
    }
    throw new Error(`Runtime module is outside the package identity: ${url}`);
  }
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      expected(result.url);
      return result;
    },
    load(url, context, nextLoad) {
      const digest = expected(url);
      const result = nextLoad(url, context);
      if (digest) {
        const source = result.source;
        // Native addons expose no source; their installed binary is still hashed.
        const bytes =
          source == null
            ? fs.readFileSync(fileURLToPath(url))
            : typeof source === "string"
              ? Buffer.from(source)
              : Buffer.from(source as Uint8Array);
        if (createHash("sha256").update(bytes).digest("hex") !== digest)
          throw new Error(
            `Runtime module changed after startup: ${url}. Stop explicitly and retry.`,
          );
      }
      return result;
    },
  });
}
