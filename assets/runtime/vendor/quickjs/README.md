# Browser JavaScript interpreter

Vendored quickjs-emscripten **0.32.0** with the browser release synchronous
single-file variant. Its embedded QuickJS is **2025-09-13+f1139494**. The variant
is compiled with `FILESYSTEM=0`; WASM bytes are embedded, with no runtime CDN.
The upstream MIT notices are retained in each package's `LICENSE`.

`provenance.json` records npm tarball integrity and SHA-256 hashes of the copied
modules. `node scripts/vendor-quickjs.ts 0.32.0` reproduces the copies without
installing dependencies or compiling. The only source adaptation replaces the
core's bare `@jitl/quickjs-ffi-types` imports with relative vendored module paths.
Published source-map references are retained; maps are not runtime dependencies.

Primary references:

- [Upstream repository and API](https://github.com/justjake/quickjs-emscripten)
- [Pinned browser variant](https://www.npmjs.com/package/@jitl/quickjs-singlefile-browser-release-sync/v/0.32.0)
- [Runtime limits and module loading](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md)
- [Context handles and evaluation](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSContext.md)

Studens imports this runtime only in `code-worker.mjs`, after an explicit Run.
Learner code is passed as text to the interpreter. It never runs as browser/worker
JavaScript. No guest host functions, module loader, browser globals, filesystem,
network, storage, ports or parent callbacks are installed. The worker's own module
loader reads these local packaged files; the guest cannot invoke it.
