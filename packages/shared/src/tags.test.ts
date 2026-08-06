import { describe, expect, it } from "vitest";
import { normalizeTag, normalizeTags, TAG_MAX_LENGTH } from "./tags.js";

describe("normalizeTag", () => {
  it("case-folds and hyphenates so near-misses collapse to one tag", () => {
    for (const input of ["Roadmap", "roadmap", "  ROADMAP  "]) {
      expect(normalizeTag(input)).toBe("roadmap");
    }
    expect(normalizeTag("road map")).toBe("road-map");
    expect(normalizeTag("road   map")).toBe("road-map");
    expect(normalizeTag("road--map")).toBe("road-map");
  });

  it("keeps non-ASCII letters — a tag is a label, not a slug", () => {
    expect(normalizeTag("Kırılgan")).toBe("kırılgan");
    expect(normalizeTag("Wysokość")).toBe("wysokość");
    expect(normalizeTag("日本語")).toBe("日本語");
  });

  it("strips characters that would break a Meilisearch filter literal", () => {
    expect(normalizeTag('say "hi"')).toBe("say-hi");
    expect(normalizeTag("a,b")).toBe("ab");
    expect(normalizeTag("x[1]")).toBe("x1");
    expect(normalizeTag("back\\slash")).toBe("backslash");
  });

  it("trims leading and trailing hyphens, including after the length cut", () => {
    expect(normalizeTag("-edge-")).toBe("edge");
    const long = `${"a".repeat(TAG_MAX_LENGTH - 1)} tail`;
    const result = normalizeTag(long)!;
    expect(result.length).toBeLessThanOrEqual(TAG_MAX_LENGTH);
    expect(result.endsWith("-")).toBe(false);
  });

  it("returns null when nothing usable survives", () => {
    for (const input of ["", "   ", "---", '"', "[]"]) {
      expect(normalizeTag(input)).toBeNull();
    }
  });
});

describe("normalizeTags", () => {
  it("drops empties and duplicates while keeping first-seen order", () => {
    expect(normalizeTags(["Beta", "alpha", "  ", "ALPHA", "beta ", "gamma"])).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });
});
