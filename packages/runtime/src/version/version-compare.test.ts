import { describe, expect, it } from "vitest";

import { compareVersions, isVersionOlder } from "./version-compare";

describe("compareVersions", () => {
  it("orders by numeric component", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
    expect(compareVersions("0.2.0", "0.1.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1); // not lexicographic
  });

  it("treats missing trailing parts as zero", () => {
    expect(compareVersions("0.1", "0.1.0")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBe(-1);
  });

  it("ignores pre-release / build suffixes", () => {
    expect(compareVersions("0.1.0-beta.2", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0+build5", "0.1.0")).toBe(0);
  });
});

describe("isVersionOlder", () => {
  it("is true only when strictly behind", () => {
    expect(isVersionOlder("0.1.0", "0.2.0")).toBe(true);
    expect(isVersionOlder("0.2.0", "0.2.0")).toBe(false);
    expect(isVersionOlder("0.3.0", "0.2.0")).toBe(false);
  });
});
