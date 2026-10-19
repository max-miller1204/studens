/** Exercise the actual Pi extension and dedicated Pi teacher through shared service paths. */
const artifacts = process.argv[2];
process.argv[2] = "pi";
process.argv[3] = artifacts;
await import("./e2e.ts");
const { verifyPiLifecycle } = await import("./e2e-pi-lifecycle.ts");
await verifyPiLifecycle((artifacts ?? "/tmp/studens-pi") + "/lifecycle");

export {};
