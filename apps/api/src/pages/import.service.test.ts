import { describe, expect, it } from "vitest";
import { planPages } from "./import.service";

/**
 * The plan phase: what tree an archive becomes, decided before anything is
 * written. Pure, so the rules that make an export legible are pinned here
 * rather than inferred from a database afterwards.
 */

const file = (path: string, markdown = "Body.\n") => ({ path, markdown });
const byPath = (pages: { path: string }[]) => pages.map((page) => page.path);

describe("planPages", () => {
  it("makes an index file its folder's page, with siblings beneath it", () => {
    const plan = planPages([
      file("handbook/index.md", "# Handbook\n"),
      file("handbook/onboarding.md", "# Onboarding\n"),
    ]);

    const handbook = plan.pages.find((page) => page.title === "Handbook")!;
    const onboarding = plan.pages.find((page) => page.title === "Onboarding")!;
    expect(handbook.parentId).toBeNull();
    expect(onboarding.parentId).toBe(handbook.id);
  });

  it("pairs a bare Page.md with its sibling Page/ directory", () => {
    // The shape Notion exports use, and the reason `standsFor` exists.
    const plan = planPages([
      file("Handbook.md", "# Handbook\n"),
      file("Handbook/Onboarding.md", "# Onboarding\n"),
    ]);

    const handbook = plan.pages.find((page) => page.title === "Handbook")!;
    expect(plan.pages.find((page) => page.title === "Onboarding")!.parentId).toBe(handbook.id);
    expect(plan.pages).toHaveLength(2);
  });

  it("invents a page for a folder no file stands for, rather than orphaning its children", () => {
    const plan = planPages([file("team/eng/charter.md", "# Charter\n")]);

    expect(byPath(plan.pages)).toEqual(["team", "team/eng", "team/eng/charter.md"]);
    // Creation order, not a coincidence: `createPage` needs the parent row to
    // exist, so a synthesized ancestor has to be written before its child.
    const [team, eng, charter] = plan.pages;
    expect(team!.parentId).toBeNull();
    expect(eng!.parentId).toBe(team!.id);
    expect(charter!.parentId).toBe(eng!.id);
    expect(team!.doc).toBeNull();
    expect(team!.title).toBe("Team");
  });

  it("titles a page from its leading H1, and falls back to the filename", () => {
    const plan = planPages([
      file("release-notes.md", "Just a body.\n"),
      file("Getting started 24d0e0e5f5e2809ab5a5cdb6ca1ea1e0.md", "# Getting started\n"),
      file("Quarterly review 24d0e0e5f5e2809ab5a5cdb6ca1ea1e1.md", "No heading here.\n"),
    ]);

    const titles = plan.pages.map((page) => page.title);
    expect(titles).toContain("Release notes");
    expect(titles).toContain("Getting started");
    // No H1, so the filename carries it — with the export id stripped off.
    expect(titles).toContain("Quarterly review");
  });

  it("maps every file path to its page, which is what makes links resolvable", () => {
    const plan = planPages([
      file("Handbook.md", "# Handbook\n"),
      file("Handbook/Onboarding.md", "# Onboarding\n"),
    ]);

    const onboarding = plan.pages.find((page) => page.title === "Onboarding")!;
    expect(plan.pageIdByPath.get("Handbook/Onboarding.md")).toBe(onboarding.id);
    // A link may name the folder a file stands for instead of the file.
    expect(plan.pageIdByPath.get("Handbook")).toBe(
      plan.pages.find((page) => page.title === "Handbook")!.id,
    );
  });

  it("reports a duplicate path instead of creating the page twice", () => {
    const plan = planPages([file("a.md", "# A\n"), file("a.md", "# A again\n")]);

    expect(plan.pages).toHaveLength(1);
    expect(plan.skipped).toEqual([{ path: "a.md", reason: "Duplicate path in the bundle" }]);
  });

  it("gives an index file a home when another file already owns its folder", () => {
    // Both want to be the page for `Handbook`; the shallower one wins and the
    // other becomes an ordinary child rather than escaping to the root.
    const plan = planPages([
      file("Handbook.md", "# Handbook\n"),
      file("Handbook/index.md", "# Overview\n"),
    ]);

    const handbook = plan.pages.find((page) => page.title === "Handbook")!;
    expect(plan.pages.find((page) => page.title === "Overview")!.parentId).toBe(handbook.id);
  });

  it("does not hand out a slug the space already uses", () => {
    const plan = planPages([file("handbook.md", "# Handbook\n")], new Set(["handbook"]));
    expect(plan.pages[0]!.slug).toBe("handbook-2");
  });
});
