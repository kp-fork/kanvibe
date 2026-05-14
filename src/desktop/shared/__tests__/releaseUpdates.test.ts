import { describe, expect, it } from "vitest";
import {
  compareReleaseVersions,
  isReleaseVersionGreaterThan,
  parseReleaseVersion,
} from "@/desktop/shared/releaseUpdates";

describe("releaseUpdates", () => {
  it("parses plain and v-prefixed release versions", () => {
    expect(parseReleaseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseReleaseVersion("v10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it("rejects invalid or pre-release tags", () => {
    expect(parseReleaseVersion("1.2")).toBeNull();
    expect(parseReleaseVersion("1.2.3-beta.1")).toBeNull();
    expect(parseReleaseVersion("release-1.2.3")).toBeNull();
  });

  it("compares release versions by major, minor, and patch", () => {
    expect(compareReleaseVersions(
      { major: 2, minor: 0, patch: 0 },
      { major: 1, minor: 9, patch: 9 },
    )).toBeGreaterThan(0);
    expect(compareReleaseVersions(
      { major: 1, minor: 3, patch: 0 },
      { major: 1, minor: 2, patch: 9 },
    )).toBeGreaterThan(0);
    expect(compareReleaseVersions(
      { major: 1, minor: 2, patch: 4 },
      { major: 1, minor: 2, patch: 3 },
    )).toBeGreaterThan(0);
    expect(compareReleaseVersions(
      { major: 1, minor: 2, patch: 3 },
      { major: 1, minor: 2, patch: 3 },
    )).toBe(0);
  });

  it("detects only semver releases greater than the current version", () => {
    expect(isReleaseVersionGreaterThan("1.0.1", "1.0.0")).toBe(true);
    expect(isReleaseVersionGreaterThan("v1.1.0", "1.0.9")).toBe(true);
    expect(isReleaseVersionGreaterThan("1.0.0", "1.0.0")).toBe(false);
    expect(isReleaseVersionGreaterThan("0.9.9", "1.0.0")).toBe(false);
    expect(isReleaseVersionGreaterThan("1.1.0-beta.1", "1.0.0")).toBe(false);
  });
});
