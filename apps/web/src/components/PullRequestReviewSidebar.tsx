import type { EnvironmentId, OrchestrationThreadActivity } from "@t3tools/contracts";
import { ExternalLinkIcon, MessageSquareTextIcon, PanelRightCloseIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useChangeRequestReviewSnapshot } from "~/lib/changeRequestReviewState";
import { buildReviewCommentWorkflowStatuses } from "~/reviewCommentWorkflow";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { PullRequestReviewContextPanel } from "./PullRequestReviewContextPanel";
import { cn } from "~/lib/utils";

type SidebarTab = "review" | "files" | "overview";

const SIDEBAR_TABS: ReadonlyArray<{
  readonly id: SidebarTab;
  readonly label: string;
  readonly available: boolean;
}> = [
  { id: "review", label: "Review", available: true },
  { id: "files", label: "Files", available: false },
  { id: "overview", label: "Overview", available: false },
];

interface PullRequestReviewSidebarProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly markdownCwd?: string | undefined;
  readonly mode?: "sheet" | "sidebar";
  readonly activities?: ReadonlyArray<OrchestrationThreadActivity> | undefined;
  readonly readyToPushResetAt?: string | null | undefined;
  readonly turnInProgress?: boolean | undefined;
  readonly onClose: () => void;
  readonly onSendReviewContext: (
    markdown: string,
    queuedThreadIds: ReadonlySet<string>,
  ) => Promise<void> | void;
}

type ReviewDecision =
  | "approved"
  | "changes_requested"
  | "review_required"
  | "commented"
  | "unknown";

function decisionLabel(value: ReviewDecision): string {
  switch (value) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes requested";
    case "review_required":
      return "Review required";
    case "commented":
      return "Commented";
    case "unknown":
      return "Unknown";
  }
}

function decisionClassName(value: ReviewDecision): string {
  switch (value) {
    case "approved":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "changes_requested":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";
    case "commented":
      return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300";
    case "review_required":
    case "unknown":
      return "border-border/60 bg-muted/30 text-muted-foreground";
  }
}

function reviewSummaryText(snapshot: {
  readonly reviewSummary: {
    readonly approvingReviewCount: number;
    readonly changesRequestedReviewCount: number;
    readonly commentedReviewCount: number;
  };
}): string | null {
  const parts: string[] = [];
  if (snapshot.reviewSummary.approvingReviewCount > 0) {
    parts.push(`${snapshot.reviewSummary.approvingReviewCount} approval`);
  }
  if (snapshot.reviewSummary.changesRequestedReviewCount > 0) {
    parts.push(`${snapshot.reviewSummary.changesRequestedReviewCount} requested changes`);
  }
  if (snapshot.reviewSummary.commentedReviewCount > 0) {
    parts.push(`${snapshot.reviewSummary.commentedReviewCount} commented`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function SidebarTabStrip({
  activeTab,
  onSelectTab,
}: {
  readonly activeTab: SidebarTab;
  readonly onSelectTab: (tab: SidebarTab) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto">
      {SIDEBAR_TABS.map((tab) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            className="shrink-0 rounded-md disabled:cursor-not-allowed"
            disabled={!tab.available}
            onClick={() => tab.available && onSelectTab(tab.id)}
            title={tab.available ? undefined : "Coming soon"}
            data-sidebar-tab-selected={selected}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                selected
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80",
                tab.available && !selected && "hover:border-border hover:text-foreground/80",
                !tab.available && "opacity-50",
              )}
            >
              <div className="text-[10px] font-medium leading-tight">{tab.label}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SidebarTabPlaceholder({ label }: { readonly label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-8 text-center">
      <p className="text-[11px] text-muted-foreground/70">
        {label} view is coming soon. Use the Review tab to triage pull request comments.
      </p>
    </div>
  );
}

function HeaderActions({
  url,
  onClose,
}: {
  readonly url?: string | undefined;
  readonly onClose: () => void;
}) {
  return (
    <div className="-mt-0.5 -mr-1 flex shrink-0 items-center gap-0.5">
      {url ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Open on GitHub"
          className="text-muted-foreground/50 hover:text-foreground/70"
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon className="size-3.5" />
        </Button>
      ) : null}
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
  );
}

export function PullRequestReviewSidebar({
  environmentId,
  cwd,
  reference,
  markdownCwd,
  mode = "sidebar",
  activities = [],
  readyToPushResetAt = null,
  turnInProgress = false,
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
    () =>
      buildReviewCommentWorkflowStatuses(activities, {
        readyToPushResetAt,
        turnInProgress,
        reviewThreads: snapshot?.threads,
      }),
    [activities, readyToPushResetAt, snapshot?.threads, turnInProgress],
  );
  const reviewersSummary = snapshot ? reviewSummaryText(snapshot) : null;
  const [activeTab, setActiveTab] = useState<SidebarTab>("review");

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card/50",
        mode === "sidebar"
          ? "h-full w-[390px] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
    >
      {snapshot ? (
        <>
          <div className="shrink-0 border-b border-border/60 px-3 pt-3 pb-3">
            <div className="flex items-start justify-between gap-2">
              <h2 className="min-w-0 flex-1 font-medium text-sm leading-snug">{snapshot.title}</h2>
              <HeaderActions url={snapshot.url} onClose={onClose} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-medium text-[10px] transition-colors duration-200",
                  decisionClassName(snapshot.reviewDecision),
                )}
              >
                {decisionLabel(snapshot.reviewDecision)}
              </span>
              {reviewersSummary ? (
                <span className="text-[11px] text-muted-foreground/70">{reviewersSummary}</span>
              ) : null}
            </div>
            <div className="mt-3">
              <SidebarTabStrip activeTab={activeTab} onSelectTab={setActiveTab} />
            </div>
          </div>
          {activeTab === "review" ? (
            <PullRequestReviewContextPanel
              snapshot={snapshot}
              markdownCwd={markdownCwd}
              mode="sidebar"
              workflowStatuses={workflowStatuses}
              onSendContext={onSendReviewContext}
            />
          ) : (
            <SidebarTabPlaceholder
              label={activeTab === "files" ? "Files" : "Overview"}
            />
          )}
        </>
      ) : (
        <div className="flex items-start justify-between gap-2 border-b border-border/60 p-3">
          <div className="min-w-0 flex-1">
            {reviewSnapshotState.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner className="size-4" />
                Loading pull request review…
              </div>
            ) : reviewSnapshotState.error ? (
              <div>
                <div className="mb-1 flex items-center gap-2 font-medium text-sm">
                  <MessageSquareTextIcon className="size-4" />
                  Review unavailable
                </div>
                <p className="text-muted-foreground text-xs">{reviewSnapshotState.error.message}</p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No active GitHub pull request review is available for this thread.
              </p>
            )}
          </div>
          <HeaderActions onClose={onClose} />
        </div>
      )}
    </div>
  );
}
