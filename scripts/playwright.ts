/** Run the installed Playwright CLI in a separate test session. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { assetsDir } from "../src/paths.ts";

const exec = promisify(execFile);

async function diagnose(error: unknown, session: string, cwd: string): Promise<Error> {
  const failure = error instanceof Error ? error : new Error(String(error));
  const diagnostics = [];
  for (const command of ["snapshot", "tab-list", "console"]) {
    try {
      const { stdout, stderr } = await exec("playwright-cli", [`-s=${session}`, command], {
        cwd,
        timeout: 15_000,
      });
      diagnostics.push({ command, stdout, stderr, exitCode: 0 });
    } catch (error) {
      const detail = error as Error & { stdout?: string; stderr?: string; code?: unknown };
      diagnostics.push({
        command,
        stdout: detail.stdout,
        stderr: detail.stderr,
        exitCode: detail.code,
        error: String(error),
      });
    }
  }
  return Object.assign(failure, { browserDiagnostics: diagnostics });
}

export async function playwright(session: string, cwd: string, ...args: string[]): Promise<string> {
  if (args.includes("--headed")) throw new Error("Browser checks must run headlessly.");
  const command =
    args[0] === "open"
      ? [...args, `--config=${path.join(assetsDir(), "playwright-headless.json")}`]
      : args;
  let stdout: string;
  try {
    ({ stdout } = await exec("playwright-cli", [`-s=${session}`, "--raw", ...command], {
      cwd,
      // A run-code command can drive a complete regression, with many bounded browser actions.
      timeout: args[0] === "run-code" ? 180_000 : 60_000,
      maxBuffer: 4 * 1024 * 1024,
    }));
    if (stdout.includes("### Error") || stdout.startsWith("Error:")) throw new Error(stdout);
  } catch (error) {
    throw await diagnose(error, session, cwd);
  }
  return stdout.trim();
}

export async function playwrightCode<T>(session: string, cwd: string, code: string): Promise<T> {
  const stdout = await playwright(session, cwd, "run-code", code);
  try {
    return JSON.parse(stdout) as T;
  } catch (cause) {
    throw await diagnose(
      Object.assign(new Error("Playwright did not return a completed JSON result.", { cause }), {
        stdout,
      }),
      session,
      cwd,
    );
  }
}
