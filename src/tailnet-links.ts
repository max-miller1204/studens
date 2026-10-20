/** Tailnet links for this process's server. The server still listens on loopback. */
import { configPath, tailscaleLinks } from "./config.ts";
import type { PhoneAccess } from "./phone-access.ts";
import * as server from "./server.ts";

export class TailnetLinks {
  private readonly phone: PhoneAccess;
  constructor(phone: PhoneAccess) {
    this.phone = phone;
  }
  /** Start the owned route and check its base URL before any link uses it. */
  async checked(port?: number): Promise<string> {
    const base = await this.phone.start(server.getBaseUrl()!, port);
    const checked = await fetch(base, { signal: AbortSignal.timeout(15_000) }).catch((err) => {
      const cause = (err as Error).cause as Error | undefined;
      throw new Error(`Tailnet URL check failed for ${base}: ${cause?.message ?? err.message}.`);
    });
    if (!checked.ok) throw new Error(`Tailnet URL check returned ${checked.status}: ${base}.`);
    await checked.body?.cancel();
    server.setLinkBase(base);
    return base;
  }
  /** Use tailnet links while Tailscale is connected. A connected node with a failed route is an error.
   * Disabling them in config removes the owned route on the next open. */
  async share(): Promise<void> {
    const settings = tailscaleLinks();
    if (!settings.enabled) {
      await this.stop();
      return;
    }
    if (!(await this.phone.available())) {
      server.setLinkBase(null);
      return;
    }
    try {
      await this.checked(settings.port);
    } catch (err) {
      throw new Error(
        `Tailscale is connected, but its classroom link failed: ${(err as Error).message} ` +
          `Set "tailscalePort" when another route holds that port, or set "tailscale": false in ${configPath()} for local links.`,
        { cause: err },
      );
    }
  }
  /** Remove the owned route. */
  async stop(): Promise<unknown> {
    const removed = await this.phone.stop();
    server.setLinkBase(null);
    return removed;
  }
}
