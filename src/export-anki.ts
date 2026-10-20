/** Legacy deck package, generated with SQLite (schema 11) and a stored ZIP container. */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { runtimeAssetsDir } from "./paths.ts";
import type { ClassroomExport } from "./classroom-export.ts";
import { escapeHtml } from "./markdown.ts";
import { contentTree, nodeText } from "./export-content.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const identity = (s: string) => parseInt(sha(s).slice(0, 12), 16);
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** ZIP method 0 keeps the package dependency-free; names are generated, never user paths. */
function zip(entries: { name: string; bytes: Buffer }[]): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const filename = Buffer.from(name),
      crc = crc32(bytes),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function exportAnki(data: ClassroomExport): Buffer {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "studens-export-"));
  let db: DatabaseSync | null = null;
  try {
    const file = path.join(temp, "collection.anki2");
    db = new DatabaseSync(file);
    db.exec(`CREATE TABLE col(id integer PRIMARY KEY,crt integer NOT NULL,mod integer NOT NULL,scm integer NOT NULL,ver integer NOT NULL,dty integer NOT NULL,usn integer NOT NULL,ls integer NOT NULL,conf text NOT NULL,models text NOT NULL,decks text NOT NULL,dconf text NOT NULL,tags text NOT NULL);
    CREATE TABLE notes(id integer PRIMARY KEY,guid text NOT NULL,mid integer NOT NULL,mod integer NOT NULL,usn integer NOT NULL,tags text NOT NULL,flds text NOT NULL,sfld integer NOT NULL,csum integer NOT NULL,flags integer NOT NULL,data text NOT NULL);
    CREATE TABLE cards(id integer PRIMARY KEY,nid integer NOT NULL,did integer NOT NULL,ord integer NOT NULL,mod integer NOT NULL,usn integer NOT NULL,type integer NOT NULL,queue integer NOT NULL,due integer NOT NULL,ivl integer NOT NULL,factor integer NOT NULL,reps integer NOT NULL,lapses integer NOT NULL,left integer NOT NULL,odue integer NOT NULL,odid integer NOT NULL,flags integer NOT NULL,data text NOT NULL);
    CREATE TABLE revlog(id integer PRIMARY KEY,cid integer NOT NULL,usn integer NOT NULL,ease integer NOT NULL,ivl integer NOT NULL,lastIvl integer NOT NULL,factor integer NOT NULL,time integer NOT NULL,type integer NOT NULL);
    CREATE TABLE graves(usn integer NOT NULL,oid integer NOT NULL,type integer NOT NULL);
    CREATE INDEX ix_notes_usn ON notes(usn); CREATE INDEX ix_cards_usn ON cards(usn); CREATE INDEX ix_cards_nid ON cards(nid); CREATE INDEX ix_cards_sched ON cards(did,queue,due); CREATE INDEX ix_revlog_usn ON revlog(usn); CREATE INDEX ix_revlog_cid ON revlog(cid); CREATE INDEX ix_notes_csum ON notes(csum);`);
    const deckId = identity(`studens/deck/${data.name}`),
      modelId = identity("studens/reading-model/v1"),
      now = Math.floor(Date.now() / 1000);
    const model = {
      id: modelId,
      name: "Studens saved reading",
      type: 0,
      mod: 0,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: "Reading",
          ord: 0,
          qfmt: "{{Front}}",
          afmt: '{{FrontSide}}<hr id="answer">{{Back}}<hr>{{Source}}<script src="_studens-mermaid.min.js"></script><script>mermaid.initialize({startOnLoad:false,securityLevel:"strict"});mermaid.run({querySelector:".mermaid"}).catch(()=>{document.querySelectorAll(".mermaid").forEach(n=>{if(!n.querySelector("svg"))n.insertAdjacentHTML("beforebegin","<p>Diagram could not render; its saved source follows.</p>")});});</script>',
          bqfmt: "",
          bafmt: "",
          did: null,
          bfont: "",
          bsize: 0,
        },
      ],
      flds: ["Front", "Back", "Source"].map((name, ord) => ({
        name,
        ord,
        sticky: false,
        rtl: false,
        font: "Arial",
        size: 20,
      })),
      css: ".card{font:18px/1.5 sans-serif;text-align:left}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{padding:.3em;border:1px solid #aaa}",
      latexPre: "",
      latexPost: "",
      latexsvg: false,
      req: [[0, "any", [0]]],
    };
    const deck = {
      id: deckId,
      mod: 0,
      name: `Studens::${data.title.replace(/::/g, " — ").replace(/[\u0000-\u001f]/g, " ")} (${data.name})`,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: "Saved public classroom content. No Studens review history.",
      dyn: 0,
      conf: 1,
      extendNew: 0,
      extendRev: 0,
    };
    db.prepare("INSERT INTO col VALUES(1,?,?,?,?,0,0,0,?,?,?,?,?)").run(
      1609459200,
      now * 1000,
      1609459200000,
      11,
      JSON.stringify({
        nextPos: data.parts.length + 1,
        schedVer: 2,
        curDeck: deckId,
        activeDecks: [deckId],
      }),
      JSON.stringify({ [modelId]: model }),
      JSON.stringify({ [deckId]: deck }),
      "{}",
      "{}",
    );
    const insertNote = db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)"),
      insertCard = db.prepare("INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const [index, part] of data.parts.entries()) {
      const key = `studens/${data.name}/${part.identity}`,
        id = identity(key),
        front = escapeHtml(part.title);
      const back = part.html.replace(/studens-media:([\w.-]+)/g, "$1");
      const source = `<a href="${escapeHtml(part.source)}">${escapeHtml(part.source)}</a>`;
      insertNote.run(
        id,
        sha(key).slice(0, 20),
        modelId,
        part.modified,
        -1,
        "",
        [front, back, source].map((s) => s.replace(/\x1f/g, " ")).join("\x1f"),
        nodeText(contentTree(front)),
        parseInt(
          createHash("sha1")
            .update(nodeText(contentTree(front)))
            .digest("hex")
            .slice(0, 8),
          16,
        ),
        0,
        "",
      );
      insertCard.run(
        id,
        id,
        deckId,
        0,
        part.modified,
        -1,
        0,
        0,
        index + 1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        "",
      );
    }
    db.close();
    db = null;
    const mediaEntries = [
      ...data.media,
      {
        name: "_studens-mermaid.min.js",
        bytes: fs.readFileSync(path.join(runtimeAssetsDir(), "vendor/mermaid/mermaid.min.js")),
      },
    ];
    const media = Object.fromEntries(mediaEntries.map((m, i) => [String(i), m.name]));
    return zip([
      { name: "collection.anki2", bytes: fs.readFileSync(file) },
      { name: "media", bytes: Buffer.from(JSON.stringify(media)) },
      ...mediaEntries.map((m, i) => ({ name: String(i), bytes: m.bytes })),
    ]);
  } finally {
    db?.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
