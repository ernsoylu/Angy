import { describe, expect, it } from "vitest";
import { apiError, apiErrorSchema, ok } from "./api-envelope.js";
import { healthSchema } from "./health.js";

describe("api envelope", () => {
  it("builds and validates the canonical error shape", () => {
    const err = apiError("PAGE_NOT_FOUND", "Page does not exist");
    expect(apiErrorSchema.parse(err)).toEqual(err);
    expect(err.error.details).toBeUndefined();
  });

  it("keeps details when provided", () => {
    const err = apiError("VALIDATION", "Bad request", { field: "title" });
    expect(apiErrorSchema.parse(err).error.details).toEqual({ field: "title" });
  });

  it("wraps success payloads", () => {
    expect(ok({ id: "x" })).toEqual({ success: true, data: { id: "x" } });
  });
});

describe("health schema", () => {
  it("accepts a valid health payload", () => {
    const parsed = healthSchema.parse({
      status: "ok",
      service: "api",
      time: new Date().toISOString(),
    });
    expect(parsed.service).toBe("api");
  });
});
