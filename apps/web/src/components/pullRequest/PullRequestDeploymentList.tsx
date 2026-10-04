import type { PullRequestDeployment, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";

import { useOpenLink, useOpenLinkIn } from "~/browser/useOpenLink";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";

import { showExternalLinkContextMenu } from "../chat/externalLinkContextMenu";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  PullRequestDeploymentStateIcon,
  pullRequestDeploymentStatePresentation,
} from "./pullRequestPresentation";

function reportOpenFailure(error: unknown) {
  console.error(error);
  toastManager.add({
    type: "error",
    title: "Unable to open deployment",
    description: error instanceof Error ? error.message : "An error occurred.",
  });
}

/**
 * One deployment: its name over the commit it was built from, so what belongs to what is read
 * without a heading. The row follows the "Open links in" setting like any other link beside a
 * thread, and a modifier still forces the system browser; the trailing button is the explicit
 * way to the system browser, and a right-click offers both browsers and a copy, the same menu
 * every other link in the app has. State is the icon; a tooltip spells it out.
 */
function DeploymentRow({
  deployment,
  threadRef,
}: {
  deployment: PullRequestDeployment;
  threadRef: ScopedThreadRef | null;
}) {
  const openLink = useOpenLink(threadRef);
  const { canOpenInApp, openInApp, openExternal } = useOpenLinkIn(threadRef);
  const presentation = pullRequestDeploymentStatePresentation(deployment.state);
  const url = deployment.url;
  const title = `${deployment.name}: ${presentation.label}${
    deployment.description ? `. ${deployment.description}` : ""
  }`;
  const body = (
    <>
      <span className="truncate">{deployment.name}</span>
      <span className="flex min-w-0 items-baseline gap-1.5 text-2xs text-muted-foreground">
        <span className="shrink-0 font-mono">{deployment.commit.shortSha}</span>
        {deployment.commit.headline ? (
          <span className="min-w-0 truncate">{deployment.commit.headline}</span>
        ) : null}
        {deployment.commit.isHead ? <span className="shrink-0">· latest</span> : null}
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-2 text-xs">
      <PullRequestDeploymentStateIcon state={deployment.state} />
      <Tooltip>
        <TooltipTrigger
          render={
            url === null ? (
              <span className="flex min-w-0 flex-1 flex-col text-left" />
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer flex-col text-left hover:[&>span:first-child]:underline"
                onClick={(event) => void openLink(url, { event }).catch(reportOpenFailure)}
                onContextMenu={(event) => {
                  const api = readLocalApi();
                  if (!api) return;
                  event.preventDefault();
                  event.stopPropagation();
                  void showExternalLinkContextMenu({
                    href: url,
                    canOpenInPreview: canOpenInApp,
                    position: { x: event.clientX, y: event.clientY },
                    showContextMenu: (items, position) => api.contextMenu.show(items, position),
                    openInPreview: openInApp,
                    openExternal,
                    copyLink: (target) => writeTextToClipboard(target, "link"),
                    reportFailure: (_operation, cause) => reportOpenFailure(cause),
                  });
                }}
              />
            )
          }
        >
          {body}
        </TooltipTrigger>
        <TooltipPopup side="top">{title}</TooltipPopup>
      </Tooltip>
      {url !== null ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-tiny"
                variant="ghost-muted"
                aria-label={`Open ${deployment.name} in system browser`}
                onClick={() => void openExternal(url).catch(reportOpenFailure)}
              />
            }
          >
            <ExternalLinkIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup side="top">Open in system browser</TooltipPopup>
        </Tooltip>
      ) : null}
    </li>
  );
}

/** Every deployment on the change request, newest first, one row each. */
export function PullRequestDeploymentList({
  deployments,
  threadRef,
  className,
}: {
  deployments: ReadonlyArray<PullRequestDeployment>;
  threadRef: ScopedThreadRef | null;
  className?: string;
}) {
  if (deployments.length === 0) {
    return <p className="text-muted-foreground text-xs">No deployments</p>;
  }
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {deployments.map((deployment) => (
        <DeploymentRow
          key={`${deployment.commit.sha}:${deployment.name}:${deployment.state}:${deployment.url ?? ""}`}
          deployment={deployment}
          threadRef={threadRef}
        />
      ))}
    </ul>
  );
}
