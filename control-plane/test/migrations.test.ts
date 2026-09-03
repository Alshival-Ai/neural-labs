import { describe, expect, it } from "vitest";

import { migrations } from "../src/migrations.js";

describe("database migrations", () => {
  it("keeps migration versions unique and strictly increasing", () => {
    const versions = migrations.map((migration) => migration.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([...versions].sort((left, right) => left - right));
  });
});
