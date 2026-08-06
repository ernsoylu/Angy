import { describe, expect, it } from "vitest";
import { chooseRevisionsToThin } from "./revisions.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-06T12:00:00Z");
const at = (daysAgo: number, hour: number) =>
  new Date(NOW.getTime() - daysAgo * DAY + (hour - 12) * 3600_000).toISOString();

describe("chooseRevisionsToThin", () => {
  it("keeps everything younger than the threshold", () => {
    const revisions = [
      { version: 1, createdAt: at(5, 9) },
      { version: 2, createdAt: at(2, 9) },
      { version: 3, createdAt: at(0, 9) },
    ];
    expect(chooseRevisionsToThin(revisions, NOW, 30 * DAY)).toEqual([]);
  });

  it("thins old days down to their newest revision", () => {
    const revisions = [
      { version: 1, createdAt: at(40, 9) },
      { version: 2, createdAt: at(40, 11) },
      { version: 3, createdAt: at(40, 15) }, // newest of day -40 → kept
      { version: 4, createdAt: at(35, 9) }, // alone on its day → kept
      { version: 5, createdAt: at(1, 9) }, // young → kept
    ];
    expect(chooseRevisionsToThin(revisions, NOW, 30 * DAY).sort()).toEqual([1, 2]);
  });

  it("never deletes the newest revision, however old", () => {
    const revisions = [
      { version: 1, createdAt: at(90, 9) },
      { version: 2, createdAt: at(90, 15) },
    ];
    // v2 is the head: exempt. v1 loses its per-day slot to nothing else → kept as day's best.
    expect(chooseRevisionsToThin(revisions, NOW, 30 * DAY)).toEqual([]);
  });

  it("handles empty input", () => {
    expect(chooseRevisionsToThin([], NOW, 30 * DAY)).toEqual([]);
  });
});
