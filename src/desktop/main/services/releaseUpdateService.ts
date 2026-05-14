import { app } from "electron";
import {
  compareReleaseVersions,
  isReleaseVersionGreaterThan,
  parseReleaseVersion,
  type ReleaseVersion,
} from "@/desktop/shared/releaseUpdates";

const KANVIBE_RELEASES_API_URL = "https://api.github.com/repos/rookedsysc/kanvibe/releases";
const DEVELOPMENT_APP_VERSION = "0.0.0";
const RELEASE_UPDATE_CHECK_CACHE_MS = 60 * 60 * 1000;

interface GitHubReleaseResponse {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
}

export interface ReleaseUpdate {
  version: string;
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
}

export interface ReleaseUpdateCheckResult {
  currentVersion: string;
  isUpdateAvailable: boolean;
  release: ReleaseUpdate | null;
  error?: string;
}

interface ComparableReleaseUpdate {
  release: ReleaseUpdate;
  version: ReleaseVersion;
}

interface CachedReleaseUpdateCheck {
  checkedAt: number;
  result: ReleaseUpdateCheckResult;
}

let pendingReleaseUpdateCheck: Promise<ReleaseUpdateCheckResult> | null = null;
let cachedReleaseUpdateCheck: CachedReleaseUpdateCheck | null = null;
const shownReleaseVersions = new Set<string>();

export function getCurrentReleaseVersion(): string {
  if (process.env.KANVIBE_RENDERER_URL) {
    return DEVELOPMENT_APP_VERSION;
  }

  return app.getVersion();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toReleaseUpdate(release: GitHubReleaseResponse): ReleaseUpdate | null {
  if (release.draft === true || release.prerelease === true) {
    return null;
  }

  const tagName = getStringValue(release.tag_name).trim();
  const version = parseReleaseVersion(tagName);
  const htmlUrl = getStringValue(release.html_url).trim();

  if (!version || !htmlUrl) {
    return null;
  }

  return {
    version: tagName.replace(/^v/, ""),
    tagName,
    name: getStringValue(release.name).trim() || tagName,
    body: getStringValue(release.body).trim(),
    htmlUrl,
    publishedAt: getStringValue(release.published_at).trim() || null,
  };
}

export function selectLatestReleaseUpdate(
  releases: GitHubReleaseResponse[],
  currentVersion: string,
): ReleaseUpdate | null {
  const comparableReleases: ComparableReleaseUpdate[] = [];

  for (const githubRelease of releases) {
    const release = toReleaseUpdate(githubRelease);
    if (!release || !isReleaseVersionGreaterThan(release.tagName, currentVersion)) {
      continue;
    }

    const version = parseReleaseVersion(release.tagName);
    if (version) {
      comparableReleases.push({ release, version });
    }
  }

  comparableReleases.sort((left, right) => compareReleaseVersions(right.version, left.version));
  return comparableReleases[0]?.release ?? null;
}

async function fetchGitHubReleases(): Promise<GitHubReleaseResponse[]> {
  const response = await fetch(KANVIBE_RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "KanVibe",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub releases request failed with status ${response.status}`);
  }

  const body = await response.json();
  if (!Array.isArray(body)) {
    throw new Error("GitHub releases response was not an array");
  }

  return body as GitHubReleaseResponse[];
}

function hideReleaseUpdate(result: ReleaseUpdateCheckResult): ReleaseUpdateCheckResult {
  return {
    ...result,
    isUpdateAvailable: false,
    release: null,
  };
}

function hideShownReleaseUpdateResult(result: ReleaseUpdateCheckResult): ReleaseUpdateCheckResult {
  if (!result.isUpdateAvailable || !result.release) {
    return result;
  }

  if (shownReleaseVersions.has(result.release.version)) {
    return hideReleaseUpdate(result);
  }

  return result;
}

export function claimReleaseUpdateVersion(version: string): boolean {
  if (!version || shownReleaseVersions.has(version)) {
    return false;
  }

  shownReleaseVersions.add(version);
  return true;
}

function getCachedReleaseUpdateCheck(): ReleaseUpdateCheckResult | null {
  if (!cachedReleaseUpdateCheck) {
    return null;
  }

  if (Date.now() - cachedReleaseUpdateCheck.checkedAt >= RELEASE_UPDATE_CHECK_CACHE_MS) {
    cachedReleaseUpdateCheck = null;
    return null;
  }

  return cachedReleaseUpdateCheck.result;
}

async function createReleaseUpdateCheck(): Promise<ReleaseUpdateCheckResult> {
  const currentVersion = getCurrentReleaseVersion();

  try {
    const releases = await fetchGitHubReleases();
    const release = selectLatestReleaseUpdate(releases, currentVersion);

    return {
      currentVersion,
      isUpdateAvailable: Boolean(release),
      release,
    };
  } catch (error) {
    return {
      currentVersion,
      isUpdateAvailable: false,
      release: null,
      error: getErrorMessage(error),
    };
  }
}

export async function checkForReleaseUpdate(): Promise<ReleaseUpdateCheckResult> {
  const cachedResult = getCachedReleaseUpdateCheck();
  if (cachedResult) {
    return hideShownReleaseUpdateResult(cachedResult);
  }

  if (!pendingReleaseUpdateCheck) {
    pendingReleaseUpdateCheck = createReleaseUpdateCheck().then((result) => {
      if (!result.error) {
        cachedReleaseUpdateCheck = {
          checkedAt: Date.now(),
          result,
        };
      }

      return result;
    }).finally(() => {
      pendingReleaseUpdateCheck = null;
    });
  }

  const result = await pendingReleaseUpdateCheck;
  return hideShownReleaseUpdateResult(result);
}
