import type { EnvironmentId, OrchestrationThreadActivity } from "@t3tools/contracts";
import { MessageSquareTextIcon, PanelRightCloseIcon } from "lucide-react";
import { useMemo } from "react";

import { useChangeRequestReviewSnapshot } from "~/lib/changeRequestReviewState";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";
import {
  buildReviewCommentWorkflowStatuses,
  PullRequestReviewContextPanel,
} from "./PullRequestReviewContextPanel";
import { cn } from "~/lib/utils";

interface PullRequestReviewSidebarProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly markdownCwd?: string | undefined;
  readonly mode?: "sheet" | "sidebar";
  readonly activities?: ReadonlyArray<OrchestrationThreadActivity> | undefined;
  readonly onClose: () => void;
  readonly onSendReviewContext: (markdown: string) => Promise<void> | void;
}

function decisionLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function reviewSummaryText(snapshot: {
  readonly reviewSummary: {
    readonly approvingReviewCount: number;
    readonly changesRequestedReviewCount: number;
    readonly commentedReviewCount: number;
  };
}): string {
  const parts: string[] = [];
  if (snapshot.reviewSummary.approvingReviewCount > 0) {
    parts.push(`${snapshot.reviewSummary.approvingReviewCount} approval`);
  }
  if (snapshot.reviewSummary.changesRequestedReviewCount > 0) {
    parts.push(`${snapshot.reviewSummary.changesRequestedReviewCount} changes requested`);
  }
  if (snapshot.reviewSummary.commentedReviewCount > 0) {
    parts.push(`${snapshot.reviewSummary.commentedReviewCount} commented`);
  }
  return parts.length > 0 ? parts.join(", ") : "No submitted reviews";
}

export function PullRequestReviewSidebar({
  environmentId,
  cwd,
  reference,
  markdownCwd,
  mode = "sidebar",
  activities = [],
  onClose,
  onSendReviewContext,
}: PullRequestReviewSidebarProps) {
  const reviewSnapshotState = useChangeRequestReviewSnapshot({
    environmentId,
    cwd,
    reference,
    enabled: Boolean(cwd && reference),
  });
  const snapshot = reviewSnapshotState.data;
  const workflowStatuses = useMemo(
    () => buildReviewCommentWorkflowStatuses(activities),
    [activities],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card/50",
        mode === "sidebar"
          ? "h-full w-[390px] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-amber-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-amber-500 uppercase"
          >
            Review
          </Badge>
          {snapshot ? (
            <span className="truncate text-muted-foreground text-xs">#{snapshot.number}</span>
          ) : null}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          aria-label="Close review sidebar"
          className="text-muted-foreground/50 hover:text-foreground/70"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {snapshot ? (
            <>
              <div className="space-y-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">{snapshot.title}</div>
                  <a
                    href={snapshot.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-muted-foreground text-xs hover:text-foreground"
                  >
                    {snapshot.url}
                  </a>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                    {decisionLabel(snapshot.reviewDecision)}
                  </span>
                  <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                    {reviewSummaryText(snapshot)}
                  </span>
                  <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                    {snapshot.checks.state} checks
                  </span>
                  <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                    {snapshot.unresolvedCommentCount} unresolved
                  </span>
                  <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                    {snapshot.resolvedCommentCount} resolved
                  </span>
                </div>
              </div>
              <PullRequestReviewContextPanel
                snapshot={snapshot}
                markdownCwd={markdownCwd}
                mode="sidebar"
                workflowStatuses={workflowStatuses}
                onSendContext={onSendReviewContext}
              />
            </>
          ) : reviewSnapshotState.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              Loading pull request review...
            </div>
          ) : reviewSnapshotState.error ? (
            <div className="rounded-lg border border-border/70 bg-muted/16 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <MessageSquareTextIcon className="size-4" />
                Review unavailable
              </div>
              <p className="text-muted-foreground text-xs">{reviewSnapshotState.error.message}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 bg-muted/16 p-3 text-muted-foreground text-sm">
              No active GitHub pull request review is available for this thread.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
