"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import {
  checkForReleaseUpdate,
  type ReleaseUpdate,
} from "@/desktop/renderer/actions/releaseUpdates";
import {
  dismissReleaseUpdateVersion,
  getReleaseUpdateDismissedVersions,
} from "@/desktop/renderer/actions/appSettings";
import { useBoardCommands } from "@/desktop/renderer/components/BoardCommandProvider";

const RELEASE_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RELEASE_NOTES_SANITIZE_CONFIG = {
  ADD_ATTR: ["target", "rel", "loading", "referrerpolicy"],
};
const RELEASE_DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function addReleaseNotesElementAttributes(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const link of template.content.querySelectorAll("a")) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }

  for (const image of template.content.querySelectorAll("img")) {
    image.setAttribute("loading", "lazy");
    image.setAttribute("referrerpolicy", "no-referrer");
  }

  return template.innerHTML;
}

function renderReleaseNotesHtml(markdown: string) {
  const rawHtml = marked.parse(markdown, {
    async: false,
    gfm: true,
  }) as string;
  const sanitizedHtml = DOMPurify.sanitize(rawHtml, RELEASE_NOTES_SANITIZE_CONFIG);
  return addReleaseNotesElementAttributes(sanitizedHtml);
}

function getFocusableDialogElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(RELEASE_DIALOG_FOCUSABLE_SELECTOR))
    .filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function ReleaseNotesContent({ body, emptyMessage }: { body: string; emptyMessage: string }) {
  const releaseNotesHtml = useMemo(() => (
    body ? renderReleaseNotesHtml(body) : ""
  ), [body]);

  if (!body) {
    return <p className="text-sm text-text-muted">{emptyMessage}</p>;
  }

  return (
    <div
      className="release-notes-content text-sm leading-6 text-text-secondary [&_*:first-child]:mt-0 [&_*:last-child]:mb-0 [&_a]:text-brand-primary [&_a]:underline-offset-2 [&_a:hover]:underline [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border-default [&_blockquote]:pl-4 [&_blockquote]:text-text-muted [&_code]:rounded [&_code]:bg-bg-page [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.86em] [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-text-primary [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text-primary [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-text-primary [&_hr]:my-5 [&_hr]:border-border-subtle [&_img]:max-h-[420px] [&_img]:w-full [&_img]:rounded-md [&_img]:border [&_img]:border-border-subtle [&_img]:object-contain [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border-subtle [&_pre]:bg-bg-page [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_strong]:text-text-primary [&_table]:my-4 [&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-2 [&_td]:align-top [&_th]:align-top [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: releaseNotesHtml }}
    />
  );
}

export default function ReleaseUpdateDialog() {
  const { registerShortcutBlocker } = useBoardCommands();
  const t = useTranslations("common.releaseUpdate");
  const tc = useTranslations("common");
  const [release, setRelease] = useState<ReleaseUpdate | null>(null);
  const [shouldDismissReleaseVersion, setShouldDismissReleaseVersion] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const shownReleaseVersionsRef = useRef<Set<string>>(new Set());
  const isCheckingRef = useRef(false);

  const isReleaseVersionDismissed = useCallback(async (version: string) => {
    try {
      const dismissedVersions = await getReleaseUpdateDismissedVersions();
      return dismissedVersions.includes(version);
    } catch {
      return false;
    }
  }, []);

  const runReleaseUpdateCheck = useCallback(async () => {
    if (isCheckingRef.current) {
      return;
    }

    isCheckingRef.current = true;
    try {
      const result = await checkForReleaseUpdate();
      const nextRelease = result.release;
      if (!result.isUpdateAvailable || !nextRelease) {
        return;
      }

      if (shownReleaseVersionsRef.current.has(nextRelease.version)) {
        return;
      }

      if (await isReleaseVersionDismissed(nextRelease.version)) {
        shownReleaseVersionsRef.current.add(nextRelease.version);
        return;
      }

      shownReleaseVersionsRef.current.add(nextRelease.version);
      setShouldDismissReleaseVersion(false);
      setRelease(nextRelease);
    } catch {
      // 업데이트 확인 실패는 앱 사용을 막지 않는다.
    } finally {
      isCheckingRef.current = false;
    }
  }, [isReleaseVersionDismissed]);

  const closeDialog = useCallback(() => {
    if (release && shouldDismissReleaseVersion) {
      void dismissReleaseUpdateVersion(release.version);
    }

    setRelease(null);
    setShouldDismissReleaseVersion(false);
  }, [release, shouldDismissReleaseVersion]);

  useEffect(() => {
    if (!release) {
      return;
    }

    return registerShortcutBlocker();
  }, [registerShortcutBlocker, release]);

  useEffect(() => {
    if (!release) {
      return;
    }

    const previousFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    dialogRef.current?.focus({ preventScroll: true });

    return () => {
      if (previousFocusedElement?.isConnected) {
        previousFocusedElement.focus({ preventScroll: true });
      }
    };
  }, [release]);

  useEffect(() => {
    void runReleaseUpdateCheck();
    const intervalId = window.setInterval(() => {
      void runReleaseUpdateCheck();
    }, RELEASE_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [runReleaseUpdateCheck]);

  if (!release) {
    return null;
  }

  function openReleasePage() {
    if (!release) {
      return;
    }

    window.open(release.htmlUrl, "_blank", "noopener,noreferrer");
    closeDialog();
  }

  function handleModalKeyDownCapture(event: ReactKeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();

    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableElements = getFocusableDialogElements(dialog);
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const isFocusOutsideDialog = !activeElement || !dialog.contains(activeElement);

    if (event.shiftKey) {
      if (isFocusOutsideDialog || activeElement === dialog || activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
      }
      return;
    }

    if (isFocusOutsideDialog || activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus({ preventScroll: true });
    }
  }

  return (
    <div
      data-shortcut-capture="true"
      data-terminal-focus-blocker="true"
      onKeyDownCapture={handleModalKeyDownCapture}
      className="fixed inset-0 z-[540] flex items-center justify-center bg-bg-overlay px-4 py-8"
    >
      <button
        type="button"
        aria-label={t("dismissOverlay")}
        className="absolute inset-0 cursor-default"
        onClick={closeDialog}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-update-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[calc(100vh-4rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border-default bg-bg-surface shadow-2xl"
      >
        <div className="border-b border-border-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                {t("eyebrow")}
              </p>
              <h2 id="release-update-title" className="mt-1 text-base font-semibold text-text-primary">
                {t("title", { version: release.version })}
              </h2>
            </div>
            <span className="shrink-0 rounded-full border border-border-default bg-bg-page px-2.5 py-1 text-xs font-medium text-text-secondary">
              v{release.version}
            </span>
          </div>
          <p className="mt-2 truncate text-sm text-text-secondary">
            {release.name}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ReleaseNotesContent body={release.body} emptyMessage={t("emptyBody")} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-bg-page px-5 py-3">
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={shouldDismissReleaseVersion}
              onChange={(event) => setShouldDismissReleaseVersion(event.target.checked)}
              className="h-4 w-4 rounded border-border-default text-brand-primary focus:ring-brand-primary"
            />
            <span>{t("dontShowVersionAgain")}</span>
          </label>
          <button
            type="button"
            onClick={closeDialog}
            className="rounded-md border border-border-default bg-bg-surface px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand-primary"
          >
            {tc("close")}
          </button>
          <button
            type="button"
            onClick={openReleasePage}
            className="rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-text-inverse transition-colors hover:bg-brand-hover"
          >
            {t("viewRelease")}
          </button>
        </div>
      </section>
    </div>
  );
}
