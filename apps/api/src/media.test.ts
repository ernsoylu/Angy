import { afterEach, describe, expect, it } from "vitest";
import { env } from "./env";
import { bareMediaUrl } from "./media";

/**
 * Object storage answers at two addresses in a tunnelled deployment
 * (ADR 0012): an internal one for SDK traffic and a public one for anything a
 * browser will fetch. Collapsing them is a silent failure — the app works
 * perfectly on the host and serves unreachable image URLs to everyone else —
 * so the split is pinned here rather than left to review.
 */

const original = process.env.S3_PUBLIC_ENDPOINT;

afterEach(() => {
  if (original === undefined) delete process.env.S3_PUBLIC_ENDPOINT;
  else process.env.S3_PUBLIC_ENDPOINT = original;
});

describe("media URLs", () => {
  it("falls back to the internal endpoint when no public one is set", () => {
    delete process.env.S3_PUBLIC_ENDPOINT;
    expect(env.s3.publicEndpoint()).toBe(env.s3.endpoint.replace(/\/+$/, ""));
  });

  it("prefers the public endpoint for browser-facing URLs", () => {
    process.env.S3_PUBLIC_ENDPOINT = "https://media.example.com";
    expect(bareMediaUrl("media/abc123.png")).toBe(
      `https://media.example.com/${env.s3.bucket}/media/abc123.png`,
    );
  });

  it("tolerates a trailing slash rather than emitting a double slash", () => {
    process.env.S3_PUBLIC_ENDPOINT = "https://media.example.com/";
    expect(bareMediaUrl("media/abc123.png")).not.toContain("com//");
  });
});
