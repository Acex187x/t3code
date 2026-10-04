import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";

import { recordVisitForThread } from "~/browserHistoryStore";
import { readLocalApi } from "~/localApi";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  canOpenLinksInApp,
  resolveBrowserLinkTargetPreference,
  resolveLinkTarget,
} from "./browserLinkTarget";
import { BrowserSettingsReadError, openUrlInPreview } from "./openFileInPreview";

const NO_MODIFIER = { metaKey: false, ctrlKey: false } as const;

/**
 * Opens a URL where the "Open links in" setting says, for buttons that sit
 * beside a thread but are not markdown anchors: CI check details, a pull
 * request that has no project to open in the panel. Without a thread there is
 * nowhere to put an in-app tab, so the link goes to the system browser.
 *
 * An in-app open that fails falls back to the system browser rather than
 * dropping the click: the user asked for the link, and the setting only says
 * where it should go first. Failed settings reads reject without opening a
 * browser. The promise also rejects if the system-browser fallback fails.
 */
export function useOpenLink(threadRef: ScopedThreadRef | null | undefined): (
  url: string,
  options?: {
    readonly event?: { readonly metaKey: boolean; readonly ctrlKey: boolean };
    /** Thread to open beside when it is not the hook's own, e.g. a sidebar row's. */
    readonly threadRef?: ScopedThreadRef | undefined;
  },
) => Promise<void> {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  return useCallback(
    async (url, options = {}) => {
      const targetThreadRef = options.threadRef ?? threadRef;
      const target = resolveLinkTarget({
        url,
        event: options.event ?? NO_MODIFIER,
        preference: await resolveBrowserLinkTargetPreference(),
        canOpenInApp: canOpenLinksInApp(Boolean(targetThreadRef)),
      });
      if (target === "app" && targetThreadRef) {
        const result = await openUrlInPreview({ threadRef: targetThreadRef, url, openPreview });
        if (isAtomCommandInterrupted(result)) return;
        if (result._tag === "Success") {
          recordVisitForThread(targetThreadRef, url);
          return;
        }
        const failure = squashAtomCommandFailure(result);
        if (failure instanceof BrowserSettingsReadError) throw failure;
        console.error(result.cause);
      }
      const api = readLocalApi();
      if (!api) throw new Error("Link opening is unavailable.");
      await api.shell.openExternal(url);
    },
    [openPreview, threadRef],
  );
}

/**
 * The two places a link can go, each on its own, for a control that offers both rather than
 * following the setting: an "Open in integrated browser" beside an "Open in system browser".
 * `canOpenInApp` is false where the first has nowhere to go — no thread to open beside, or a
 * runtime without the in-app browser — so the control can leave it out instead of offering a
 * button that falls through to the other.
 */
export function useOpenLinkIn(threadRef: ScopedThreadRef | null | undefined): {
  readonly canOpenInApp: boolean;
  readonly openInApp: (url: string) => Promise<void>;
  readonly openExternal: (url: string) => Promise<void>;
} {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const canOpenInApp = canOpenLinksInApp(Boolean(threadRef));
  const openInApp = useCallback(
    async (url: string) => {
      if (!threadRef) throw new Error("The integrated browser needs a thread to open beside.");
      const result = await openUrlInPreview({ threadRef, url, openPreview });
      if (isAtomCommandInterrupted(result)) return;
      if (result._tag === "Success") {
        recordVisitForThread(threadRef, url);
        return;
      }
      throw squashAtomCommandFailure(result);
    },
    [openPreview, threadRef],
  );
  const openExternal = useCallback(async (url: string) => {
    const api = readLocalApi();
    if (!api) throw new Error("Link opening is unavailable.");
    await api.shell.openExternal(url);
  }, []);
  return { canOpenInApp, openInApp, openExternal };
}
