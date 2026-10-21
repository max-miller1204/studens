/** Shared local font declarations for shell, lesson, review, and reference heads. */
export function uiFontHead(): string {
  return `<link rel="preload" href="/static/vendor/inter/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/vendor/source-serif-4/source-serif-4-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/ui-fonts.css">`;
}
