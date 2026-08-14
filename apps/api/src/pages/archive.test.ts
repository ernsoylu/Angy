import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { normaliseArchivePath, resolveArchiveRef, stripExportId, unpackArchive } from "./archive";

/**
 * Unpacking an export archive (V2 H2). The shape under test is a real Notion
 * export: every name carries the page's 32-hex id, a page's children live in a
 * folder named after it, and the whole thing is wrapped in an export folder
 * with an editor's debris scattered through it.
 */

const HANDBOOK = "Handbook 24d0e0e5f5e2809ab5a5cdb6ca1ea1e0";
const ONBOARDING = "Onboarding aabbccddeeff00112233445566778899";

function notionExport(extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    [`Export-9f2/${HANDBOOK}.md`]: strToU8(`# Handbook\n\nHow we work.\n`),
    [`Export-9f2/${HANDBOOK}/${ONBOARDING}.md`]: strToU8(
      `# Onboarding\n\n![Diagram](${encodeURIComponent(ONBOARDING)}/diagram.png)\n`,
    ),
    [`Export-9f2/${HANDBOOK}/${ONBOARDING}/diagram.png`]: new Uint8Array([137, 80, 78, 71]),
    // Debris nobody meant to import.
    "__MACOSX/._Handbook.md": strToU8("junk"),
    "Export-9f2/.DS_Store": strToU8("junk"),
    ...extra,
  });
}

describe("unpackArchive", () => {
  it("turns an export into the bundle the importer already takes", () => {
    const archive = unpackArchive(notionExport());

    expect(archive.files.map((file) => file.path)).toEqual([
      `Export-9f2/${HANDBOOK}.md`,
      `Export-9f2/${HANDBOOK}/${ONBOARDING}.md`,
    ]);
    expect(archive.files[0]!.markdown).toContain("How we work.");
    expect([...archive.media.keys()]).toEqual([
      `Export-9f2/${HANDBOOK}/${ONBOARDING}/diagram.png`,
    ]);
    expect(archive.media.values().next().value?.mimeType).toBe("image/png");
  });

  it("drops OS debris without reporting it, because nobody meant to import it", () => {
    const archive = unpackArchive(notionExport());
    const mentioned = [...archive.files.map((f) => f.path), ...archive.skipped.map((s) => s.path)];
    expect(mentioned.some((path) => path.includes("MACOSX") || path.includes("DS_Store"))).toBe(
      false,
    );
  });

  it("names HTML as the export format it is, rather than ignoring it", () => {
    const archive = unpackArchive(
      notionExport({ "Export-9f2/Meeting notes.html": strToU8("<h1>Notes</h1>") }),
    );
    expect(archive.skipped).toContainEqual({
      path: "Export-9f2/Meeting notes.html",
      reason: "HTML is not importable — re-export as Markdown",
    });
  });

  it("unpacks the parts a split export is delivered in", () => {
    const part = zipSync({ "Release notes.md": strToU8("# Release notes\n") });
    const archive = unpackArchive(notionExport({ "Export-9f2/Part-1.zip": part }));

    // Flattened: the parts of one export are one tree, not a "Part 1" section.
    expect(archive.files.map((f) => f.path)).toContain("Release notes.md");
  });

  it("refuses an entry that inflates past the per-file cap", () => {
    // The guard reads the size from the entry header, so nothing this large is
    // ever allocated — which is the whole point of checking before inflating.
    const huge = zipSync({ "big.bin": new Uint8Array(26 * 1024 * 1024) });
    const archive = unpackArchive(huge);

    expect(archive.media.size).toBe(0);
    expect(archive.skipped[0]?.reason).toBe("Larger than 25 MB");
  });

  it("reports an archive it cannot read instead of throwing at the caller", () => {
    const archive = unpackArchive(new Uint8Array([1, 2, 3, 4]));
    expect(archive.files).toEqual([]);
    expect(archive.skipped[0]?.reason).toBe("The archive could not be read");
  });
});

describe("resolveArchiveRef", () => {
  const from = `Export-9f2/${HANDBOOK}/${ONBOARDING}.md`;

  it("resolves a percent-encoded sibling reference", () => {
    expect(resolveArchiveRef(from, `${encodeURIComponent(ONBOARDING)}/diagram.png`)).toBe(
      `Export-9f2/${HANDBOOK}/${ONBOARDING}/diagram.png`,
    );
  });

  it("walks up out of its own folder", () => {
    expect(resolveArchiveRef(from, "../Team.md")).toBe("Export-9f2/Team.md");
  });

  it("ignores the fragment and query, which name nothing in an archive", () => {
    expect(resolveArchiveRef(from, "Team.md#week-one")).toBe(`Export-9f2/${HANDBOOK}/Team.md`);
  });

  it("leaves URLs that already point somewhere real", () => {
    expect(resolveArchiveRef(from, "https://example.com/x.png")).toBeNull();
    expect(resolveArchiveRef(from, "mailto:team@example.com")).toBeNull();
    expect(resolveArchiveRef(from, "#heading")).toBeNull();
  });

  it("takes a malformed escape literally rather than throwing", () => {
    expect(resolveArchiveRef(from, "100%25 done.md")).toBe(`Export-9f2/${HANDBOOK}/100% done.md`);
    expect(resolveArchiveRef(from, "50% off.png")).toBe(`Export-9f2/${HANDBOOK}/50% off.png`);
  });
});

describe("path handling", () => {
  it("strips the export id a page name carries", () => {
    expect(stripExportId(HANDBOOK)).toBe("Handbook");
    // A name that is only an id keeps it — better an ugly title than none.
    expect(stripExportId("24d0e0e5f5e2809ab5a5cdb6ca1ea1e0")).toBe(
      "24d0e0e5f5e2809ab5a5cdb6ca1ea1e0",
    );
    expect(stripExportId("Quarterly review")).toBe("Quarterly review");
  });

  it("normalises traversal away — a path here names a hierarchy, not a disk", () => {
    expect(normaliseArchivePath("../../etc/passwd")).toBe("etc/passwd");
    expect(normaliseArchivePath("./a//b/c.md")).toBe("a/b/c.md");
    expect(normaliseArchivePath("a\\b.md")).toBe("a/b.md");
  });
});
