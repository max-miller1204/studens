/** Browser-only runner. Learner source is interpreted inside WASM, never by this worker's JS engine. */
import { newQuickJSWASMModuleFromVariant } from "./vendor/quickjs/core/index.mjs";
import variant from "./vendor/quickjs/variant/index.mjs";
import {
  CODE_ENGINE,
  CODE_PROTOCOL,
  CODE_SOURCE_LIMIT,
  CODE_OUTPUT_LIMIT,
  CODE_TIME_MS,
  CODE_MEMORY_BYTES,
  parseCodeExercise,
  sameCodeJson,
} from "./code.mjs";

// Runs inside QuickJS. Keep handles to these closures outside learner globals.
// No newFunction/newHostRef, callbacks, module loader, browser objects or ports are exposed.
function environment(outputLimit) {
  const stringify = JSON.stringify,
    keys = Object.keys,
    descriptor = Object.getOwnPropertyDescriptor;
  const array = Array.isArray,
    finite = Number.isFinite,
    proto = Object.getPrototypeOf;
  const objectProto = Object.prototype,
    ErrorType = Error;
  let count = 0,
    output = "",
    exceeded = false;
  function encode(value, depth = 0, seen = []) {
    if (++count > 10000 || depth > 16) throw new ErrorType("Result exceeds JSON complexity limit.");
    if (value === null || typeof value === "boolean" || typeof value === "string") {
      const result = stringify(value);
      if (result.length > outputLimit) throw new ErrorType("Result exceeds output limit.");
      return result;
    }
    if (typeof value === "number" && finite(value)) return stringify(value);
    if (typeof value !== "object" || seen.indexOf(value) !== -1)
      throw new ErrorType("Return a finite JSON value, without cycles, functions, or undefined.");
    const isArray = array(value);
    if (!isArray && proto(value) !== objectProto && proto(value) !== null)
      throw new ErrorType(
        "Return a plain JSON value; promises and class instances are unsupported.",
      );
    const next = [...seen, value];
    const names = isArray ? Array.from({ length: value.length }, (_, i) => String(i)) : keys(value);
    let result = isArray ? "[" : "{";
    for (let i = 0; i < names.length; i++) {
      const key = names[i],
        property = descriptor(value, key);
      if (!property || !("value" in property))
        throw new ErrorType("Return JSON data without getters or holes.");
      result +=
        (i ? "," : "") +
        (isArray ? "" : stringify(key) + ":") +
        encode(property.value, depth + 1, next);
      if (result.length > outputLimit) throw new ErrorType("Result exceeds output limit.");
    }
    return result + (isArray ? "]" : "}");
  }
  globalThis.console = {
    log(...values) {
      count = 0;
      const line =
        values.map((value) => (typeof value === "string" ? value : encode(value))).join(" ") + "\n";
      if (line.length + output.length > outputLimit) {
        exceeded = true;
        throw new ErrorType("Console output limit exceeded.");
      }
      output += line;
    },
  };
  return {
    encode(value) {
      count = 0;
      return encode(value);
    },
    output() {
      return stringify({ output, exceeded });
    },
  };
}

function guestError(vm, error) {
  const value = vm.dump(error);
  const message =
    typeof value === "string"
      ? value
      : `${value?.name ?? "Error"}: ${value?.message ?? "Execution failed"}`;
  return message.slice(0, 1000);
}

self.onmessage = async ({ data }) => {
  if (data?.protocol !== CODE_PROTOCOL || !/^[a-f0-9-]{36}$/.test(data.id ?? "")) return;
  self.onmessage = null; // One fixed request per disposable worker, never guest messages.
  const { id, source } = data;
  const run = { id, source, engine: CODE_ENGINE, status: "complete", results: [], output: "" };
  let deadline;
  try {
    if (typeof source !== "string" || !source.trim() || source.length > CODE_SOURCE_LIMIT)
      throw new Error(`Source must contain 1–${CODE_SOURCE_LIMIT} characters.`);
    const exercise = parseCodeExercise(JSON.stringify(data.exercise));
    const engine = await newQuickJSWASMModuleFromVariant(variant);
    deadline = Date.now() + CODE_TIME_MS;
    for (const test of exercise.tests) {
      const runtime = engine.newRuntime();
      runtime.setMemoryLimit(CODE_MEMORY_BYTES);
      runtime.setMaxStackSize(256 * 1024);
      runtime.setInterruptHandler(() => Date.now() > deadline);
      const vm = runtime.newContext();
      let env, encoder, output;
      const inputs = [];
      try {
        env = vm.unwrapResult(
          vm.evalCode(`(${environment.toString()})(${CODE_OUTPUT_LIMIT - run.output.length})`),
        );
        encoder = vm.getProp(env, "encode");
        output = vm.getProp(env, "output");
        // Parse before learner globals can change JSON.parse. Retain private VM handles:
        // JSON object keys such as __proto__ must stay data, not JS literal syntax.
        for (const argument of test.args)
          inputs.push(
            vm.unwrapResult(vm.evalCode(`JSON.parse(${JSON.stringify(JSON.stringify(argument))})`)),
          );
        const result = { id: test.id, outcome: "error" };
        const execute = vm.evalCode(source, "learner.js", { type: "global", strict: true });
        if (execute.error) {
          result.error = guestError(vm, execute.error);
          execute.error.dispose();
        } else {
          execute.value.dispose();
          // Entry is a validated identifier. No executable test string or host callback.
          const target = vm.evalCode(exercise.entry, `test-${test.id}.js`, {
            type: "global",
            strict: true,
          });
          const call = target.error
            ? target
            : vm.callFunction(target.value, vm.undefined, ...inputs);
          if (!target.error) target.value.dispose();
          if (call.error) {
            result.error = guestError(vm, call.error);
            call.error.dispose();
          } else {
            const encoded = vm.callFunction(encoder, vm.undefined, call.value);
            call.value.dispose();
            if (encoded.error) {
              result.error = guestError(vm, encoded.error);
              encoded.error.dispose();
            } else {
              result.actual = vm.getString(encoded.value);
              encoded.value.dispose();
              result.outcome = sameCodeJson(JSON.parse(result.actual), test.expected)
                ? "passed"
                : "failed";
            }
          }
        }
        const logs = vm.callFunction(output, vm.undefined);
        if (logs.error) {
          const message = guestError(vm, logs.error);
          logs.error.dispose();
          throw new Error(message);
        }
        const captured = JSON.parse(vm.getString(logs.value));
        logs.value.dispose();
        run.output += captured.output;
        if (captured.exceeded) throw new Error("Console output limit exceeded.");
        if (Date.now() > deadline) throw new Error("Execution time limit exceeded.");
        run.results.push(result);
      } finally {
        for (const input of inputs) input.dispose();
        output?.dispose();
        encoder?.dispose();
        env?.dispose();
        vm.dispose();
        runtime.dispose();
      }
    }
  } catch (error) {
    run.status = deadline && Date.now() > deadline ? "timeout" : "error";
    run.error = String(error.message ?? error).slice(0, 1000);
    run.results = [];
  }
  self.postMessage({ protocol: CODE_PROTOCOL, run });
  self.close();
};
