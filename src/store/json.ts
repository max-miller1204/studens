import * as fs from "node:fs";
import * as path from "node:path";
import { isDir } from "../paths.ts";

export function readJson<T>(
  file: string,
  shape: "object" | "array" = "object",
  optional = true,
): T | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value) !== (shape === "array"))
      throw new Error(`Expected a JSON ${shape}.`);
    return value as T;
  } catch (err) {
    if (optional && (err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read JSON state ${file}: ${(err as Error).message}`, { cause: err });
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
}

export function listJsonFiles<T>(dir: string): T[] {
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson<T>(path.join(dir, f), "object", false))
    .filter((v): v is T => v !== null);
}
