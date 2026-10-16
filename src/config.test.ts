import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  ADMIN_TOKEN: "0123456789abcdef",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({ port: 3000, host: "0.0.0.0" });
    expect(config.migrationsDir.endsWith("migrations")).toBe(true);
  });

  it("reads overrides", () => {
    expect(loadConfig({ ...valid, PORT: "8080", MIGRATIONS_DIR: "/m" })).toMatchObject({
      port: 8080,
      migrationsDir: "/m",
    });
  });

  it("fails fast on a missing database url", () => {
    expect(() => loadConfig({ ADMIN_TOKEN: valid.ADMIN_TOKEN })).toThrow(/DATABASE_URL/);
  });

  it("rejects a short admin token and a bad port", () => {
    expect(() => loadConfig({ ...valid, ADMIN_TOKEN: "short" })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({ ...valid, PORT: "99999" })).toThrow(/PORT/);
  });
});