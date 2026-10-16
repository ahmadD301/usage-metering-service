import { describe, expect, it } from "vitest";
import { fingerprintOf } from "./fingerprint.js";

describe("fingerprintOf", () => {
  it("is stable for the same payload", () => {
    expect(fingerprintOf("alice", 10)).toBe(fingerprintOf("alice", 10));
    expect(fingerprintOf("alice", 10)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the user or the amount changes", () => {
    expect(fingerprintOf("alice", 10)).not.toBe(fingerprintOf("alice", 11));
    expect(fingerprintOf("alice", 10)).not.toBe(fingerprintOf("bob", 10));
  });
});