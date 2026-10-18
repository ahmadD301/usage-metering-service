import { describe, expect, it } from "vitest";
import { loadClientConfig } from "../../client/config.js";

const valid = { ADMIN_TOKEN: "0123456789abcdef" };

describe("loadClientConfig", () => {
  it("applies defaults", () => {
    expect(loadClientConfig(valid)).toEqual({
      meteringUrl: "http://localhost:3000",
      adminToken: "0123456789abcdef",
      port: 8080,
      requestTimeoutMs: 5_000,
      maxRetries: 3,
    });
  });

  it("reads overrides and strips a trailing slash from the url", () => {
    const config = loadClientConfig({
      ...valid,
      METERING_URL: "http://service:3000/",
      PORT: "9000",
      MAX_RETRIES: "0",
    });
    expect(config).toMatchObject({
      meteringUrl: "http://service:3000",
      port: 9000,
      maxRetries: 0,
    });
  });

  it("treats empty values as unset", () => {
    expect(
      loadClientConfig({ ...valid, PORT: "", METERING_URL: "" }).port,
    ).toBe(8080);
  });

  it("fails fast on a missing or short admin token and a bad url", () => {
    expect(() => loadClientConfig({})).toThrow(/ADMIN_TOKEN/);
    expect(() => loadClientConfig({ ADMIN_TOKEN: "short" })).toThrow(
      /ADMIN_TOKEN/,
    );
    expect(() =>
      loadClientConfig({ ...valid, METERING_URL: "not a url" }),
    ).toThrow(/METERING_URL/);
  });
});
