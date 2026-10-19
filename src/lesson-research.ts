/** Read a public source during an explicit live Pi lesson request. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  // Only global unicast IPv6; exclude mapped/transition and documentation ranges.
  if (isIP(address) !== 6) return false;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  return /^[23]/i.test(canonical) && !/^(2001:(0*:|db8:)|2002:)/i.test(canonical);
}

/** Pin the connection to the checked address, retaining the URL hostname for Host and TLS. */
async function publicRequest(url: URL): Promise<{ location?: string; text?: string }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(hostname, { all: true }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Research source DNS timed out: ${url}.`)), 30_000);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Lesson research cannot read loopback or private network sources.");
  const selected = addresses[0];
  const normalize = (address: string) =>
    isIP(address) === 6 ? new URL(`http://[${address}]/`).hostname : address;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        agent: false,
        family: selected.family,
        // No second resolver call can replace the checked answer. Never reuse a pooled socket.
        lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
        signal: AbortSignal.timeout(30_000),
      },
      (response) => {
        const peer = response.socket.remoteAddress;
        if (!peer || !publicAddress(peer) || normalize(peer) !== normalize(selected.address)) {
          response.destroy();
          reject(new Error("Research connection did not reach its validated public address."));
          return;
        }
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.destroy();
          if (!location)
            reject(new Error(`Research source redirected without a location: ${url}.`));
          else resolve({ location });
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          reject(new Error(`Research source returned HTTP ${status}: ${url}.`));
          return;
        }
        if (
          !/(text\/|application\/(json|xml|xhtml\+xml))/.test(
            response.headers["content-type"] ?? "",
          )
        ) {
          response.destroy();
          reject(new Error(`Research source has unsupported content type: ${url}.`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > 2 * 1024 * 1024) {
            response.destroy(new Error(`Research source exceeds 2 MB: ${url}.`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    request.on("error", (error) =>
      reject(
        new Error(`Research source request failed for ${url}: ${error.message}`, { cause: error }),
      ),
    );
    request.end();
  });
}
export async function readLessonSource(input: unknown): Promise<string> {
  if (!input || typeof input !== "object" || typeof (input as { url?: unknown }).url !== "string")
    throw new Error("A public source URL is required.");
  let url = new URL((input as { url: string }).url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Lesson research requires an HTTP or HTTPS public URL without credentials.");
    const response = await publicRequest(url);
    if (response.location) {
      url = new URL(response.location, url);
      continue;
    }
    return `Source: ${url}\n${response.text}`;
  }
  throw new Error("Research source exceeded five redirects.");
}
