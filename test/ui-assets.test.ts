import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { icon } from "../assets/runtime/icons.mjs";
import { injectLessonRuntime } from "../src/lesson-html.ts";
import { runtimeAssetsDir, packageRoot } from "../src/paths.ts";

const vendor = path.join(runtimeAssetsDir(), "vendor");

describe("bundled UI asset contracts", () => {
  it("keeps package provenance, file hashes, and license notices with every subset", () => {
    for (const id of ["inter", "source-serif-4", "jetbrains-mono", "lucide"]) {
      const dir = path.join(vendor, id);
      const provenance = JSON.parse(fs.readFileSync(path.join(dir, "PROVENANCE.json"), "utf8"));
      expect(fs.readFileSync(path.join(dir, "VERSION"), "utf8").trim()).toBe(provenance.version);
      expect(provenance.integrity).toMatch(/^sha512-/);
      for (const [file, hash] of Object.entries(provenance.files)) {
        expect(
          createHash("sha256")
            .update(fs.readFileSync(path.join(dir, file)))
            .digest("hex"),
          `${id}/${file}`,
        ).toBe(hash);
      }
      const license = fs.readFileSync(path.join(dir, "LICENSE"), "utf8");
      if (id === "source-serif-4") {
        expect(fs.readFileSync(path.join(dir, "OFL.upstream.txt"), "utf8")).toContain(
          "The Source Serif 4 Project Authors",
        );
        expect(provenance.upstreamLicense).toMatch(
          /google\/fonts\/[a-f0-9]{40}\/ofl\/sourceserif4\/OFL.txt$/,
        );
      }
      if (id === "lucide") {
        expect(license).toContain("ISC License");
        expect(license).toContain("Cole Bemis");
      } else {
        expect(license).toContain("SIL OPEN FONT LICENSE");
        const css = fs.readFileSync(path.join(dir, "font.css"), "utf8");
        expect(css.match(/@font-face/g)).toHaveLength(4);
        for (const match of css.matchAll(/url\(\.\/([^\)]+)\)/g)) {
          expect(fs.readFileSync(path.join(dir, match[1])).subarray(0, 4).toString()).toBe("wOF2");
        }
        expect(css.match(/font-display: swap/g)).toHaveLength(4);
        expect(css.match(/unicode-range:/g)).toHaveLength(4);
      }
    }
  });

  it("inlines only named bundled icons with identical standalone SVG content", () => {
    const files = fs
      .readdirSync(path.join(vendor, "lucide"))
      .filter((file) => file.endsWith(".svg"));
    expect(files).toHaveLength(25);
    for (const file of files) {
      const svg = icon(file.slice(0, -4));
      expect(svg).toBe(fs.readFileSync(path.join(vendor, "lucide", file), "utf8").trim());
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toContain('stroke-width="1.75"');
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).not.toMatch(/<script|\bon\w+=|href=/);
    }
    for (const name of ["missing", "__proto__", "toString", "../sun", '<svg onload="x">']) {
      expect(() => icon(name)).toThrow("Unknown bundled icon");
    }
  });

  it("upgrades saved runtime pages once and preserves the updated configuration", () => {
    const config = {
      classroom: "rust",
      lesson: "001-ownership",
      classroomTitle: "Rust",
      lessonTitle: "Ownership",
      baseUrl: "http://127.0.0.1:1234",
    };
    const old =
      '<html><head></head><body><script id="cl-config" type="application/json">{}</script></body></html>';
    const updated = injectLessonRuntime(old, config);
    expect(updated.match(/rel="preload"/g)).toHaveLength(2);
    expect(updated).toContain('href="/static/ui-fonts.css"');
    expect(injectLessonRuntime(updated, config)).toBe(updated);
    expect(updated).toContain(JSON.stringify(config));
  });

  it("rejects unpinned updater input before changing an output directory", () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "studens-vendor-input-"));
    const marker = path.join(output, "keep.txt");
    fs.writeFileSync(marker, "Existing assets");
    try {
      expect(() =>
        execFileSync(
          process.execPath,
          [
            path.join(packageRoot(), "scripts/vendor-ui.ts"),
            "latest",
            "5.3.1",
            "5.3.0",
            "1.61.0",
            "--output",
            output,
          ],
          { stdio: "pipe" },
        ),
      ).toThrow();
      expect(fs.readdirSync(output)).toEqual(["keep.txt"]);
      expect(fs.readFileSync(marker, "utf8")).toBe("Existing assets");
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });

  it("rejects a package without its font license before replacing existing assets", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studens-vendor-license-"));
    try {
      const unpacked = path.join(scratch, "package");
      fs.mkdirSync(unpacked);
      fs.writeFileSync(
        path.join(unpacked, "package.json"),
        JSON.stringify({ name: "@fontsource-variable/inter", version: "5.3.0" }),
      );
      fs.writeFileSync(path.join(unpacked, "LICENSE"), "Wrong license");
      const tarball = path.join(scratch, "fixture.tgz");
      execFileSync("tar", ["czf", tarball, "package"], { cwd: scratch });
      const bin = path.join(scratch, "bin");
      fs.mkdirSync(bin);
      const packed = [
        {
          name: "@fontsource-variable/inter",
          version: "5.3.0",
          filename: tarball,
          integrity: "sha512-fixture",
        },
      ];
      fs.writeFileSync(
        path.join(bin, "npm"),
        `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(packed))});\n`,
        { mode: 0o755 },
      );
      const output = path.join(scratch, "output");
      fs.mkdirSync(path.join(output, "inter"), { recursive: true });
      const marker = path.join(output, "inter", "keep.txt");
      fs.writeFileSync(marker, "Existing assets");
      const result = spawnSync(
        process.execPath,
        [
          path.join(packageRoot(), "scripts/vendor-ui.ts"),
          "5.3.0",
          "5.3.1",
          "5.3.0",
          "1.61.0",
          "--output",
          output,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Missing required license notices");
      expect(fs.readFileSync(marker, "utf8")).toBe("Existing assets");
      expect(fs.readdirSync(output)).toEqual(["inter"]);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
