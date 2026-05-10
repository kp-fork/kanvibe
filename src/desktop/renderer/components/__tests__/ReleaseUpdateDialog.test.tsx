import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReleaseUpdateDialog from "@/desktop/renderer/components/ReleaseUpdateDialog";
import type { ReleaseUpdateCheckResult } from "@/desktop/renderer/actions/releaseUpdates";

const RELEASE_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  checkForReleaseUpdate: vi.fn(),
  getReleaseUpdateDismissedVersions: vi.fn(),
  dismissReleaseUpdateVersion: vi.fn(),
}));

vi.mock("@/desktop/renderer/actions/releaseUpdates", () => ({
  checkForReleaseUpdate: mocks.checkForReleaseUpdate,
}));

vi.mock("@/desktop/renderer/actions/appSettings", () => ({
  getReleaseUpdateDismissedVersions: mocks.getReleaseUpdateDismissedVersions,
  dismissReleaseUpdateVersion: mocks.dismissReleaseUpdateVersion,
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => (
    values?.version ? `${namespace}.${key}:${values.version}` : `${namespace}.${key}`
  ),
}));

function createNoUpdateResult(): ReleaseUpdateCheckResult {
  return {
    currentVersion: "1.0.0",
    isUpdateAvailable: false,
    release: null,
  };
}

function createUpdateResult(version = "1.1.0", body = "Release notes"): ReleaseUpdateCheckResult {
  return {
    currentVersion: "1.0.0",
    isUpdateAvailable: true,
    release: {
      version,
      tagName: `v${version}`,
      name: `KanVibe ${version}`,
      body,
      htmlUrl: `https://github.com/rookedsysc/kanvibe/releases/tag/v${version}`,
      publishedAt: "2026-05-10T00:00:00Z",
    },
  };
}

async function flushReleaseUpdateCheck() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ReleaseUpdateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkForReleaseUpdate.mockResolvedValue(createNoUpdateResult());
    mocks.getReleaseUpdateDismissedVersions.mockResolvedValue([]);
    mocks.dismissReleaseUpdateVersion.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows release notes when an update is available on app start", async () => {
    mocks.checkForReleaseUpdate.mockResolvedValueOnce(createUpdateResult("1.1.0"));

    render(<ReleaseUpdateDialog />);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("common.releaseUpdate.title:1.1.0")).toBeTruthy();
    expect(screen.getByText("KanVibe 1.1.0")).toBeTruthy();
    expect(screen.getByText("Release notes")).toBeTruthy();
  });

  it("renders release markdown, tables, and safe html images", async () => {
    mocks.checkForReleaseUpdate.mockResolvedValueOnce(createUpdateResult("1.1.0", [
      "# KanVibe 0.0.1 Release Notes",
      "",
      "- **From prompt to review, fully visible:** 5-stage Kanban flow",
      "",
      "<table><tr><td><img src=\"https://raw.githubusercontent.com/rookedsysc/kanvibe/main/docs/images/main-page.png\" alt=\"Kanban Board\" width=\"100%\"></td></tr></table>",
      "",
      "<script>alert('xss')</script>",
      "[bad link](javascript:alert('xss'))",
    ].join("\n")));

    render(<ReleaseUpdateDialog />);

    expect(await screen.findByRole("heading", { name: "KanVibe 0.0.1 Release Notes" })).toBeTruthy();
    expect(screen.getByText("From prompt to review, fully visible:")).toBeTruthy();
    const image = screen.getByRole("img", { name: "Kanban Board" });
    expect(image.getAttribute("src")).toBe("https://raw.githubusercontent.com/rookedsysc/kanvibe/main/docs/images/main-page.png");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("a[href^='javascript:']")).toBeNull();
  });

  it("does not show a release version dismissed in app settings", async () => {
    vi.useFakeTimers();
    mocks.checkForReleaseUpdate.mockResolvedValueOnce(createUpdateResult("1.1.0"));
    mocks.getReleaseUpdateDismissedVersions.mockResolvedValueOnce(["1.1.0"]);

    render(<ReleaseUpdateDialog />);

    await flushReleaseUpdateCheck();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.getReleaseUpdateDismissedVersions).toHaveBeenCalled();
  });

  it("stores the current release version when don't show again is checked", async () => {
    mocks.checkForReleaseUpdate.mockResolvedValueOnce(createUpdateResult("1.1.0"));

    render(<ReleaseUpdateDialog />);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("common.releaseUpdate.dontShowVersionAgain"));
    fireEvent.click(screen.getByText("common.close"));

    expect(mocks.dismissReleaseUpdateVersion).toHaveBeenCalledWith("1.1.0");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not persist a version when the don't show again checkbox is unchecked", async () => {
    mocks.checkForReleaseUpdate.mockResolvedValueOnce(createUpdateResult("1.1.0"));

    render(<ReleaseUpdateDialog />);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("common.close"));

    expect(mocks.dismissReleaseUpdateVersion).not.toHaveBeenCalled();
  });

  it("checks again after one hour and then shows a newer release", async () => {
    vi.useFakeTimers();
    mocks.checkForReleaseUpdate
      .mockResolvedValueOnce(createNoUpdateResult())
      .mockResolvedValueOnce(createUpdateResult("1.2.0"));

    render(<ReleaseUpdateDialog />);

    await flushReleaseUpdateCheck();
    expect(mocks.checkForReleaseUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELEASE_UPDATE_CHECK_INTERVAL_MS);
    });

    expect(screen.getByText("common.releaseUpdate.title:1.2.0")).toBeTruthy();
  });

  it("does not show the same release again in the same app session", async () => {
    vi.useFakeTimers();
    mocks.checkForReleaseUpdate.mockResolvedValue(createUpdateResult("1.1.0"));

    render(<ReleaseUpdateDialog />);

    await flushReleaseUpdateCheck();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("common.close"));
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELEASE_UPDATE_CHECK_INTERVAL_MS);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.checkForReleaseUpdate).toHaveBeenCalledTimes(2);
  });

  it("opens the release page and closes the dialog", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    mocks.checkForReleaseUpdate.mockResolvedValueOnce(createUpdateResult("1.1.0"));

    render(<ReleaseUpdateDialog />);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "common.releaseUpdate.viewRelease" }));

    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/rookedsysc/kanvibe/releases/tag/v1.1.0",
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
