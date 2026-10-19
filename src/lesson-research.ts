/** Read a public source during an explicit live Pi lesson request. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return !/^(::|fc|fd|fe[89ab])/i.test(address) && isIP(address) === 6;
}
export async function readLessonSource(input: unknown): Promise<string> {
  if (!input || typeof input !== "object" || typeof (input as { url?: unknown }).url !== "string")
    throw new Error("A public source URL is required.");
  let url = new URL((input as { url: string }).url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Lesson research requires an HTTP or HTTPS public URL without credentials.");
    const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error("Lesson research cannot read loopback or private network sources.");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error(`Research source redirected without a location: ${url}.`);
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Research source returned HTTP ${response.status}: ${url}.`);
    }
    const type = response.headers.get("content-type") ?? "";
    if (!/(text\/|application\/(json|xml|xhtml\+xml))/.test(type)) {
      await response.body?.cancel();
      throw new Error(`Research source has unsupported content type ${type}: ${url}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`Research source has no body: ${url}.`);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new Error(`Research source exceeds 2 MB: ${url}.`);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    return `Source: ${url}\n${Buffer.concat(chunks).toString("utf8")}`;
  }
  throw new Error("Research source exceeded five redirects.");
}
