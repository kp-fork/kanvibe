import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(() => "1.0.0"),
}));

vi.mock("electron", () => ({
  app: {
    getVersion: mocks.getVersion,
  },
}));

describe("releaseUpdateService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getVersion.mockReturnValue("1.0.0");
    delete process.env.KANVIBE_RENDERER_URL;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KANVIBE_RENDERER_URL;
  });

  it("uses 0.0.0 as the current version in desktop dev mode", async () => {
    process.env.KANVIBE_RENDERER_URL = "http://127.0.0.1:5173";

    const { getCurrentReleaseVersion } = await import("@/desktop/main/services/releaseUpdateService");

    expect(getCurrentReleaseVersion()).toBe("0.0.0");
    expect(mocks.getVersion).not.toHaveBeenCalled();
  });

  it("uses Electron app version outside desktop dev mode", async () => {
    mocks.getVersion.mockReturnValue("1.2.3");

    const { getCurrentReleaseVersion } = await import("@/desktop/main/services/releaseUpdateService");

    expect(getCurrentReleaseVersion()).toBe("1.2.3");
  });

  it("selects the highest non-draft release greater than current version", async () => {
    const { selectLatestReleaseUpdate } = await import("@/desktop/main/services/releaseUpdateService");

    const release = selectLatestReleaseUpdate([
      {
        tag_name: "1.0.1",
        name: "Small fix",
        body: "Patch notes",
        html_url: "https://github.com/rookedsysc/kanvibe/releases/tag/1.0.1",
      },
      {
        tag_name: "1.2.0",
        name: "Draft release",
        body: "Hidden",
        html_url: "https://github.com/rookedsysc/kanvibe/releases/tag/1.2.0",
        draft: true,
      },
      {
        tag_name: "1.1.0",
        name: "Feature release",
        body: "Feature notes",
        html_url: "https://github.com/rookedsysc/kanvibe/releases/tag/1.1.0",
        published_at: "2026-05-10T00:00:00Z",
      },
    ], "1.0.0");

    expect(release).toEqual({
      version: "1.1.0",
      tagName: "1.1.0",
      name: "Feature release",
      body: "Feature notes",
      htmlUrl: "https://github.com/rookedsysc/kanvibe/releases/tag/1.1.0",
      publishedAt: "2026-05-10T00:00:00Z",
    });
  });

  it("returns no update when GitHub request fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: vi.fn(),
    } as unknown as Response);

    const { checkForReleaseUpdate } = await import("@/desktop/main/services/releaseUpdateService");

    await expect(checkForReleaseUpdate()).resolves.toMatchObject({
      currentVersion: "1.0.0",
      isUpdateAvailable: false,
      release: null,
      error: "GitHub releases request failed with status 403",
    });
  });

  it("returns release update details from GitHub releases", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          tag_name: "1.0.0",
          name: "Current",
          body: "",
          html_url: "https://github.com/rookedsysc/kanvibe/releases/tag/1.0.0",
        },
        {
          tag_name: "1.0.2",
          name: "New release",
          body: "Release notes",
          html_url: "https://github.com/rookedsysc/kanvibe/releases/tag/1.0.2",
        },
      ]),
    } as unknown as Response);

    const { checkForReleaseUpdate } = await import("@/desktop/main/services/releaseUpdateService");

    await expect(checkForReleaseUpdate()).resolves.toMatchObject({
      currentVersion: "1.0.0",
      isUpdateAvailable: true,
      release: {
        version: "1.0.2",
        tagName: "1.0.2",
        name: "New release",
        body: "Release notes",
      },
    });
  });

  it("does not consume the same release before a desktop window claims it", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          tag_name: "1.0.2",
          name: "New release",
          body: "Release notes",
          html_url: "https://github.com/rookedsysc/kanvibe/releases/tag/1.0.2",
        },
      ]),
    } as unknown as Response);

    const { checkForReleaseUpdate } = await import("@/desktop/main/services/releaseUpdateService");

    const [firstResult, secondResult] = await Promise.all([
      checkForReleaseUpdate(),
      checkForReleaseUpdate(),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(firstResult).toMatchObject({
      isUpdateAvailable: true,
      release: { version: "1.0.2" },
    });
    expect(secondResult).toMatchObject({
      currentVersion: "1.0.0",
      isUpdateAvailable: true,
      release: { version: "1.0.2" },
    });
  });

  it("hides a cached release after a desktop window claims it", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          tag_name: "1.0.2",
          name: "New release",
          body: "Release notes",
          html_url: "https://github.com/rookedsysc/kanvibe/releases/tag/1.0.2",
        },
      ]),
    } as unknown as Response);

    const {
      checkForReleaseUpdate,
      claimReleaseUpdateVersion,
    } = await import("@/desktop/main/services/releaseUpdateService");

    await expect(checkForReleaseUpdate()).resolves.toMatchObject({
      isUpdateAvailable: true,
      release: { version: "1.0.2" },
    });
    expect(claimReleaseUpdateVersion("1.0.2")).toBe(true);
    expect(claimReleaseUpdateVersion("1.0.2")).toBe(false);
    await expect(checkForReleaseUpdate()).resolves.toMatchObject({
      isUpdateAvailable: false,
      release: null,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
