/** Observe an acknowledged fixture stop without connecting to its closing listener. */
import { serviceStatus } from "../src/service-client.ts";
import { serviceOwnerExited, type ServiceOwner } from "../test/service-process-owner.ts";

export async function waitForOwnedServiceStop(
  owner: ServiceOwner,
  paths: { lock: string; socket: string },
  timeoutMs = 185_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!serviceOwnerExited(owner, paths)) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for service owner ${owner.pid} to release ${paths.lock}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  // One assertion after owner exit and path release. Unexpected transport errors
  // still reject; this observer does not reinterpret or retry them.
  if ((await serviceStatus()).running) throw new Error("Stopped fixture service is still running.");
}
