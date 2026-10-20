/** Read quoted HTML attributes without ending a tag inside an attribute value. */
export const TAG_ATTRIBUTES = String.raw`(?:[^"'<>]|"[^"]*"|'[^']*')*`;

export function htmlAttributes(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [
      a[1].toLowerCase(),
      a[2] ?? a[3],
    ]),
  );
}

/** Decode quoted data-code attributes; authors escape the five HTML syntax characters. */
export function decodeHtmlAttribute(text: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) return named[name.toLowerCase()] ?? entity;
    const code =
      name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : "\uFFFD";
  });
}

export function authoringContent(html: string): string {
  return html.replace(
    new RegExp(
      `<!--[\\s\\S]*?-->|<(script|style)\\b${TAG_ATTRIBUTES}>[\\s\\S]*?<\\/\\1\\s*>`,
      "gi",
    ),
    "",
  );
}
