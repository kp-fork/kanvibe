const RELEASE_VERSION_PART_COUNT = 3;
const RELEASE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseReleaseVersion(value: string): ReleaseVersion | null {
  const match = value.trim().match(RELEASE_VERSION_PATTERN);
  if (!match) {
    return null;
  }

  const versionParts = match.slice(1, RELEASE_VERSION_PART_COUNT + 1).map((part) => Number.parseInt(part, 10));
  if (versionParts.some((part) => !Number.isSafeInteger(part))) {
    return null;
  }

  const [major, minor, patch] = versionParts;
  return { major, minor, patch };
}

export function compareReleaseVersions(left: ReleaseVersion, right: ReleaseVersion): number {
  const comparableKeys: Array<keyof ReleaseVersion> = ["major", "minor", "patch"];

  for (const key of comparableKeys) {
    const difference = left[key] - right[key];
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

export function isReleaseVersionGreaterThan(candidate: string, current: string): boolean {
  const candidateVersion = parseReleaseVersion(candidate);
  const currentVersion = parseReleaseVersion(current);

  if (!candidateVersion || !currentVersion) {
    return false;
  }

  return compareReleaseVersions(candidateVersion, currentVersion) > 0;
}
