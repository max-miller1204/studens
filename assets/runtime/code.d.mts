export type CodeJson = null | string | boolean | number | CodeJson[] | { [key: string]: CodeJson };
export interface CodeExercise {
  version: 1;
  language: "javascript";
  entry: string;
  tests: Array<{ id: string; args: CodeJson[]; expected: CodeJson }>;
}
export interface CodeRun {
  id: string;
  source: string;
  engine: string;
  status: "complete" | "error" | "stopped" | "timeout";
  results: Array<{
    id: string;
    outcome: "passed" | "failed" | "error";
    actual?: string;
    error?: string;
  }>;
  output: string;
  error?: string;
}
export declare const CODE_ENGINE: string;
export declare const CODE_PROTOCOL: string;
export declare const CODE_SOURCE_LIMIT: number;
export declare const CODE_OUTPUT_LIMIT: number;
export declare const CODE_TIME_MS: number;
export declare const CODE_WATCHDOG_MS: number;
export declare const CODE_MEMORY_BYTES: number;
export declare function codeJson(value: unknown, depth?: number): CodeJson;
export declare function parseCodeExercise(raw: unknown): CodeExercise;
export declare function sameCodeJson(a: unknown, b: unknown): boolean;
export declare function parseCodeRun(
  raw: unknown,
  source: string,
  exercise: CodeExercise,
): CodeRun | undefined;
