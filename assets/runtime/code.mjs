/** Public runnable JavaScript contract. No execution occurs in this shared module. */
export const CODE_ENGINE = "quickjs-emscripten@0.32.0";
export const CODE_PROTOCOL = "studens-code-1";
export const CODE_SOURCE_LIMIT = 8000;
export const CODE_OUTPUT_LIMIT = 8192;
export const CODE_TIME_MS = 2000;
export const CODE_WATCHDOG_MS = 10000;
export const CODE_MEMORY_BYTES = 16 * 1024 * 1024;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value);
const reserved = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield eval arguments".split(
    " ",
  ),
);

/** Portable results/inputs: finite JSON values, bounded depth, no executable test strings. */
export function codeJson(value, depth = 0) {
  if (depth > 16) throw new Error("Code test JSON exceeds 16 levels.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((v) => codeJson(v, depth + 1));
  if (object(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, codeJson(v, depth + 1)]));
  throw new Error("Code tests and results require finite JSON values.");
}

export function parseCodeExercise(raw) {
  if (typeof raw !== "string" || raw.length > 16000)
    throw new Error("Code question needs data-code JSON (at most 16000 characters).");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Code question has invalid data-code JSON.");
  }
  if (
    !object(value) ||
    !exactKeys(value, ["version", "language", "entry", "tests"]) ||
    value.version !== 1 ||
    value.language !== "javascript"
  )
    throw new Error("Code exercises require version: 1 and language: javascript.");
  if (
    typeof value.entry !== "string" ||
    !/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(value.entry) ||
    reserved.has(value.entry)
  )
    throw new Error("Code entry must name one JavaScript function (no property paths).");
  if (!Array.isArray(value.tests) || value.tests.length < 1 || value.tests.length > 20)
    throw new Error("Code exercises need 1–20 public tests.");
  const seen = new Set();
  const tests = value.tests.map((test) => {
    if (
      !object(test) ||
      !exactKeys(test, ["id", "args", "expected"]) ||
      !id(test.id) ||
      seen.has(test.id) ||
      !Array.isArray(test.args) ||
      test.args.length > 20 ||
      !("expected" in test)
    )
      throw new Error("Each public code test needs a unique id, args array, and expected JSON.");
    seen.add(test.id);
    return { id: test.id, args: codeJson(test.args), expected: codeJson(test.expected) };
  });
  return { version: 1, language: "javascript", entry: value.entry, tests };
}

/** An exact structural comparison, with object key order ignored and array order retained. */
export function sameCodeJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameCodeJson(v, b[i]));
  if (object(a) && object(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k) && sameCodeJson(a[k], b[k]))
    );
  }
  return false;
}

/** Validate contextual browser feedback, never a trusted score or learning event. */
export function parseCodeRun(raw, source, exercise) {
  if (raw === undefined) return undefined;
  if (
    !object(raw) ||
    !exactKeys(raw, ["id", "source", "engine", "status", "results", "output", "error"]) ||
    typeof raw.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(raw.id) ||
    raw.source !== source ||
    raw.engine !== CODE_ENGINE ||
    !["complete", "error", "stopped", "timeout"].includes(raw.status) ||
    !Array.isArray(raw.results) ||
    raw.results.length > exercise.tests.length ||
    typeof raw.output !== "string" ||
    raw.output.length > CODE_OUTPUT_LIMIT ||
    (raw.error !== undefined && (typeof raw.error !== "string" || raw.error.length > 1000))
  )
    throw new Error("Invalid or stale browser code run snapshot.");
  if (raw.status !== "complete" && (raw.results.length !== 0 || !raw.error))
    throw new Error("An interrupted code run cannot contain passing test results.");
  if (
    raw.status === "complete" &&
    (raw.results.length !== exercise.tests.length || raw.error !== undefined)
  )
    throw new Error("A complete code run needs every public test exactly once.");
  const results = raw.results.map((result, index) => {
    if (
      !object(result) ||
      !exactKeys(result, ["id", "outcome", "actual", "error"]) ||
      result.id !== exercise.tests[index].id ||
      !["passed", "failed", "error"].includes(result.outcome) ||
      (result.actual !== undefined &&
        (typeof result.actual !== "string" || result.actual.length > CODE_OUTPUT_LIMIT)) ||
      (result.error !== undefined &&
        (typeof result.error !== "string" || result.error.length > 1000)) ||
      (result.outcome === "error"
        ? !result.error || result.actual !== undefined
        : result.actual === undefined || result.error !== undefined)
    )
      throw new Error("Invalid public code test result.");
    if (result.actual !== undefined) {
      const actual = codeJson(JSON.parse(result.actual));
      const outcome = sameCodeJson(actual, exercise.tests[index].expected) ? "passed" : "failed";
      if (result.outcome !== outcome)
        throw new Error("Code result outcome contradicts its saved output.");
    }
    return { ...result };
  });
  return {
    id: raw.id,
    source,
    engine: CODE_ENGINE,
    status: raw.status,
    results,
    output: raw.output,
    ...(raw.error === undefined ? {} : { error: raw.error }),
  };
}
