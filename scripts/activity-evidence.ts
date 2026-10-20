/** Retain real canonical activity invalidations without starting or retrying teacher work. */
import * as fs from "node:fs";
import * as path from "node:path";

export async function recordActivity(
  base: string,
  artifacts: string | null,
  name = "activity-events",
): Promise<() => Promise<void>> {
  const controller = new AbortController();
  const snapshots: unknown[] = [];
  let failure: unknown;
  const capture = async () => {
    const response = await fetch(`${base}/api/activity?scope=root`, { signal: controller.signal });
    const state = await response.json();
    if (!response.ok) throw new Error(`Activity evidence: ${JSON.stringify(state)}`);
    snapshots.push({ at: Date.now(), state });
  };
  const stream = await fetch(`${base}/api/events?scope=root`, { signal: controller.signal });
  if (!stream.ok || !stream.body) throw new Error(`Activity stream returned ${stream.status}.`);
  await capture();
  const work = (async () => {
    const reader = stream.body!.getReader();
    let buffer = "";
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        buffer += new TextDecoder().decode(next.value);
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.startsWith("event: activity")) await capture();
        }
      }
      if (!controller.signal.aborted) throw new Error("Activity stream ended before host cleanup.");
    } catch (error) {
      if (!controller.signal.aborted) failure = error;
    }
  })();
  return async () => {
    controller.abort();
    await work;
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, `${name}.json`),
        JSON.stringify({ snapshots, error: failure ? String(failure) : null }, null, 2),
      );
    if (failure) throw failure;
  };
}
