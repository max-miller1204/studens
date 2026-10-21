/** Load device appearance before the shared stylesheet paints. */
export function appearanceHead(): string {
  return `<script src="/static/appearance.js"></script>
<link rel="stylesheet" href="/static/classroom.css">`;
}
