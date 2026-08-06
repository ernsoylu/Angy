import { describe, expect, it } from "vitest";
import {
  grantWidensBaseline,
  maxLevel,
  resolveEffectiveLevel,
  satisfies,
} from "./permissions.js";

describe("permission lattice", () => {
  it("orders levels VIEW < EDIT < FULL < ADMIN", () => {
    expect(satisfies("ADMIN", "VIEW")).toBe(true);
    expect(satisfies("EDIT", "EDIT")).toBe(true);
    expect(satisfies("VIEW", "EDIT")).toBe(false);
    expect(satisfies(null, "VIEW")).toBe(false);
  });

  it("takes the maximum of two levels", () => {
    expect(maxLevel("VIEW", "FULL")).toBe("FULL");
    expect(maxLevel(null, "EDIT")).toBe("EDIT");
    expect(maxLevel(null, null)).toBeNull();
  });
});

describe("resolveEffectiveLevel", () => {
  it("gives workspace users the baseline of a public space", () => {
    expect(
      resolveEffectiveLevel({
        spaceVisibility: "PUBLIC",
        spaceDefaultLevel: "VIEW",
        memberLevel: null,
        pageGrantLevel: null,
      }),
    ).toBe("VIEW");
  });

  it("denies non-members of a private space", () => {
    expect(
      resolveEffectiveLevel({
        spaceVisibility: "PRIVATE",
        spaceDefaultLevel: "VIEW",
        memberLevel: null,
        pageGrantLevel: null,
      }),
    ).toBeNull();
  });

  it("uses the membership level when present", () => {
    expect(
      resolveEffectiveLevel({
        spaceVisibility: "PRIVATE",
        spaceDefaultLevel: "VIEW",
        memberLevel: "EDIT",
        pageGrantLevel: null,
      }),
    ).toBe("EDIT");
  });

  it("page grants widen the baseline (Notion rule)", () => {
    expect(
      resolveEffectiveLevel({
        spaceVisibility: "PUBLIC",
        spaceDefaultLevel: "VIEW",
        memberLevel: null,
        pageGrantLevel: "EDIT",
      }),
    ).toBe("EDIT");
  });

  it("page grants can never reduce access", () => {
    expect(
      resolveEffectiveLevel({
        spaceVisibility: "PUBLIC",
        spaceDefaultLevel: "EDIT",
        memberLevel: "FULL",
        pageGrantLevel: "VIEW",
      }),
    ).toBe("FULL");
  });

  it("grants page access to non-members of private spaces", () => {
    expect(
      resolveEffectiveLevel({
        spaceVisibility: "PRIVATE",
        spaceDefaultLevel: "VIEW",
        memberLevel: null,
        pageGrantLevel: "VIEW",
      }),
    ).toBe("VIEW");
  });
});

describe("grantWidensBaseline", () => {
  it("accepts grants above the baseline", () => {
    expect(grantWidensBaseline("EDIT", "VIEW")).toBe(true);
    expect(grantWidensBaseline("VIEW", null)).toBe(true);
  });

  it("rejects grants at or below the baseline", () => {
    expect(grantWidensBaseline("VIEW", "VIEW")).toBe(false);
    expect(grantWidensBaseline("VIEW", "EDIT")).toBe(false);
  });
});
