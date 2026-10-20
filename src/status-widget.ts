/** Pi displays the persistent service status without owning its lifecycle. */
import { serviceStatus } from "./service-client.ts";

/** Namespaced so it never collides with another extension's widget. */
export const WIDGET_KEY = "classroom-server";

/** The slice of `ctx.ui` this module needs, kept narrow so tests can stub it. */
export interface WidgetHost {
  setWidget(
    key: string,
    content: string[] | undefined,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
  theme?: { fg(color: string, text: string): string };
}

let host: WidgetHost | null = null;

/**
 * The widget's lines, or undefined when there is nothing to show.
 *
 * Pure, so the wording is testable without a TUI.
 */
export function statusWidgetLines(
  port: number | null,
  theme?: WidgetHost["theme"],
): string[] | undefined {
  if (port === null) return undefined;
  const paint = (color: string, text: string) => theme?.fg(color, text) ?? text;
  return [
    `${paint("accent", "📚 classroom")} ${paint("dim", "persistent service running on port")} ${paint("accent", String(port))}`,
  ];
}

/** Adopt a session's UI and draw the current state. Pass null to forget it. */
export async function attachStatusWidget(ui: WidgetHost | null): Promise<void> {
  host = ui;
  await refreshStatusWidget();
}

/** Read the stable service owner; only unsupported widget APIs are optional. */
export async function refreshStatusWidget(): Promise<void> {
  if (!host) return;
  const ui = host;
  const status = await serviceStatus();
  if (!host || host !== ui) return;
  try {
    host.setWidget(WIDGET_KEY, statusWidgetLines(status.running ? status.port : null, host.theme), {
      placement: "belowEditor",
    });
  } catch {
    // A mode without widgets does not own or interrupt the service.
  }
}

/** Clear the widget and drop the UI reference, on session shutdown. */
export function detachStatusWidget(): void {
  if (host) {
    try {
      host.setWidget(WIDGET_KEY, undefined);
    } catch {
      /* nothing to clear */
    }
  }
  host = null;
}
