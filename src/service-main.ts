/** Capture installed bytes before loading the service graph or claiming any state. */
import {
  runtimeIdentity,
  assertRuntimeUnchanged,
  guardRuntimeModules,
} from "./service-identity.ts";
import * as path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const files = new Map<string, string>();
const identity = runtimeIdentity(root, files);
guardRuntimeModules(files);
const { startService } = await import("./service-runtime.ts");
assertRuntimeUnchanged(root, identity);
await startService(identity);
