import type {
  OrchestrationThreadActivity,
  SourceControlChangeRequestReviewSnapshot,
  SourceControlCheckRunSummary,
} from "@t3tools/contracts";
import {
  formatChangeRequestReviewContext,
  type ChangeRequestReviewContextMode,
} from "@t3tools/shared/changeRequestReviewContext";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleIcon,
  Clock3Icon,
  ExternalLinkIcon,
  MessageSquareTextIcon,
  MinusCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

interface PullRequestReviewContextPanelProps {
  readonly snapshot: SourceControlChangeRequestReviewSnapshot;
  readonly onSendContext: (markdown: string) => Promise<void> | void;
  readonly markdownCwd?: string | undefined;
  readonly mode?: "panel" | "sidebar";
  readonly workflowStatuses?: ReviewCommentWorkflowStatusMap | undefined;
}

export type ReviewCommentWorkflowStatus =
  | "in_progress"
  | "ready_to_push"
  | "in_review"
  | "unresolved"
  | "resolved";

export interface ReviewCommentWorkflowStatusRecord {
  readonly status: ReviewCommentWorkflowStatus;
  readonly note: string | null;
  readonly updatedAt: string;
}

export interface ReviewCommentWorkflowStatusMap {
  readonly byThreadId: ReadonlyMap<string, ReviewCommentWorkflowStatusRecord>;
  readonly byCommentId: ReadonlyMap<string, ReviewCommentWorkflowStatusRecord>;
}

const REVIEW_COMMENT_WORKFLOW_STATUSES = new Set<ReviewCommentWorkflowStatus>([
  "in_progress",
  "ready_to_push",
  "in_review",
  "unresolved",
  "resolved",
]);

function isReviewCommentWorkflowStatus(value: unknown): value is ReviewCommentWorkflowStatus {
  return (
    typeof value === "string" &&
    REVIEW_COMMENT_WORKFLOW_STATUSES.has(value as ReviewCommentWorkflowStatus)
  );
}

function workflowStatusLabel(status: ReviewCommentWorkflowStatus): string {
  switch (status) {
    case "in_progress":
      return "In progress";
    case "ready_to_push":
      return "Ready to push";
    case "in_review":
      return "In review";
    case "unresolved":
      return "Unresolved";
    case "resolved":
      return "Resolved";
  }
}

function workflowStatusClassName(status: ReviewCommentWorkflowStatus): string {
  switch (status) {
    case "in_progress":
      return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300";
    case "ready_to_push":
      return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300";
    case "in_review":
      return "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300";
    case "resolved":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "unresolved":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";
  }
}

export function buildReviewCommentWorkflowStatuses(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReviewCommentWorkflowStatusMap {
  const byThreadId = new Map<string, ReviewCommentWorkflowStatusRecord>();
  const byCommentId = new Map<string, ReviewCommentWorkflowStatusRecord>();

  for (const activity of activities) {
    if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
      continue;
    }
    const payload = activity.payload as
      | {
          readonly data?: {
            readonly toolName?: unknown;
            readonly input?: {
              readonly reviewThreadId?: unknown;
              readonly commentId?: unknown;
              readonly status?: unknown;
              readonly note?: unknown;
            };
          };
        }
      | null
      | undefined;
    const data = payload?.data;
    if (data?.toolName !== "set_review_comment_status") {
      continue;
    }
    const input = data.input;
    if (!input || typeof input.reviewThreadId !== "string") {
      continue;
    }
    if (!isReviewCommentWorkflowStatus(input.status)) {
      continue;
    }
    const record: ReviewCommentWorkflowStatusRecord = {
      status: input.status,
      note:
        typeof input.note === "string" && input.note.trim().length > 0 ? input.note.trim() : null,
      updatedAt: activity.createdAt,
    };
    byThreadId.set(input.reviewThreadId, record);
    if (typeof input.commentId === "string" && input.commentId.length > 0) {
      byCommentId.set(input.commentId, record);
    }
  }

  return { byThreadId, byCommentId };
}

function ReviewWorkflowStatusBadge({
  record,
}: {
  readonly record: ReviewCommentWorkflowStatusRecord;
}) {
  return (
    <span
      title={record.note ?? undefined}
      className={cn(
        "inline-flex max-w-full shrink-0 items-center rounded-md border px-1.5 py-0.5 font-medium text-[10px]",
        workflowStatusClassName(record.status),
      )}
    >
      {workflowStatusLabel(record.status)}
    </span>
  );
}

function threadLocation(thread: SourceControlChangeRequestReviewSnapshot["threads"][number]) {
  const path = thread.path ?? "unknown file";
  if (thread.startLine !== null && thread.line !== null && thread.startLine !== thread.line) {
    return `${path}:${thread.startLine}-${thread.line}`;
  }
  return thread.line !== null ? `${path}:${thread.line}` : path;
}

function firstCommentPreview(thread: SourceControlChangeRequestReviewSnapshot["threads"][number]) {
  return thread.comments[0]?.body.replace(/\s+/g, " ").trim() ?? "No comment body";
}

function checkStateLabel(state: SourceControlCheckRunSummary["state"]): string {
  return state.replaceAll("_", " ");
}

function checkStateTone(state: SourceControlCheckRunSummary["state"]): string {
  switch (state) {
    case "success":
      return "text-emerald-600 dark:text-emerald-300";
    case "failure":
      return "text-destructive";
    case "pending":
      return "text-amber-600 dark:text-amber-300";
    case "skipped":
    case "neutral":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function checkStateRank(state: SourceControlCheckRunSummary["state"]): number {
  if (state === "failure") return 0;
  if (state === "pending") return 1;
  if (state === "success") return 2;
  return 3;
}

function CheckStateIcon({
  state,
  className,
}: {
  readonly state: SourceControlCheckRunSummary["state"];
  readonly className?: string;
}) {
  if (state === "success") return <CheckCircle2Icon className={className} />;
  if (state === "failure") return <AlertCircleIcon className={className} />;
  if (state === "pending") return <Clock3Icon className={className} />;
  if (state === "skipped" || state === "neutral") return <MinusCircleIcon className={className} />;
  return <CircleIcon className={className} />;
}

export function PullRequestChecksList({
  checks,
}: {
  readonly checks: SourceControlChangeRequestReviewSnapshot["checks"];
}) {
  if (checks.items.length === 0) {
    return null;
  }

  const sortedChecks = checks.items.toSorted((left, right) => {
    return (
      checkStateRank(left.state) - checkStateRank(right.state) ||
      left.name.localeCompare(right.name)
    );
  });

  return (
    <div className="rounded-lg border border-border/70 bg-background/60">
      <div className="border-border/70 border-b px-3 py-2">
        <div className="font-medium text-sm">Checks</div>
        <div className="text-muted-foreground text-xs">
          {checks.pendingCount} pending, {checks.successCount} successful, {checks.failureCount}{" "}
          failed
        </div>
      </div>
      <div className="divide-y divide-border/60">
        {sortedChecks.map((check) => {
          const content = (
            <div className="flex min-w-0 items-center gap-2 px-3 py-2">
              <CheckStateIcon
                state={check.state}
                className={cn("size-4 shrink-0", checkStateTone(check.state))}
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="truncate font-medium text-sm">{check.name}</span>
                  <span className={cn("text-xs", checkStateTone(check.state))}>
                    {checkStateLabel(check.state)}
                  </span>
                </div>
                {check.description || check.workflowName ? (
                  <div className="truncate text-muted-foreground text-xs">
                    {check.description ?? check.workflowName}
                  </div>
                ) : null}
              </div>
              {check.detailsUrl ? (
                <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
            </div>
          );

          return check.detailsUrl ? (
            <a
              key={`${check.name}:${check.detailsUrl}`}
              href={check.detailsUrl}
              target="_blank"
              rel="noreferrer"
              className="block hover:bg-muted/40"
            >
              {content}
            </a>
          ) : (
            <div key={`${check.name}:${check.state}:${check.description ?? ""}`}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}

export function PullRequestReviewContextPanel({
  snapshot,
  onSendContext,
  markdownCwd,
  mode = "panel",
  workflowStatuses,
}: PullRequestReviewContextPanelProps) {
  const defaultSelectedIds = useMemo(
    () =>
      new Set(snapshot.threads.filter((thread) => !thread.isResolved).map((thread) => thread.id)),
    [snapshot.threads],
  );
  const [selectedThreadIds, setSelectedThreadIds] = useState(defaultSelectedIds);
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sendingMode, setSendingMode] = useState<ChangeRequestReviewContextMode | null>(null);

  useEffect(() => {
    setSelectedThreadIds(defaultSelectedIds);
    setExpandedThreadIds(new Set());
    setErrorMessage(null);
  }, [defaultSelectedIds]);

  const selectedCount = snapshot.threads
    .filter((thread) => selectedThreadIds.has(thread.id))
    .reduce((count, thread) => count + thread.comments.length, 0);

  const send = async (mode: ChangeRequestReviewContextMode) => {
    setErrorMessage(null);
    const result = formatChangeRequestReviewContext({
      snapshot,
      mode,
      selectedThreadIds: [...selectedThreadIds],
    });
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setSendingMode(mode);
    try {
      await onSendContext(result.markdown);
    } finally {
      setSendingMode(null);
    }
  };

  const reviewThreads = (
    <div className="divide-y divide-border/60">
      {snapshot.threads.map((thread) => {
        const selected = selectedThreadIds.has(thread.id);
        const expanded = expandedThreadIds.has(thread.id);
        const threadWorkflowStatus = workflowStatuses?.byThreadId.get(thread.id) ?? null;
        const authors = [
          ...new Set(thread.comments.map((comment) => comment.authorLogin ?? "unknown")),
        ];
        return (
          <div key={thread.id} className="p-3">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 size-3.5"
                checked={selected}
                onChange={(event) => {
                  setSelectedThreadIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) {
                      next.add(thread.id);
                    } else {
                      next.delete(thread.id);
                    }
                    return next;
                  });
                }}
                aria-label={`Select review thread ${thread.id}`}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  setExpandedThreadIds((current) => {
                    const next = new Set(current);
                    if (next.has(thread.id)) {
                      next.delete(thread.id);
                    } else {
                      next.add(thread.id);
                    }
                    return next;
                  });
                }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {thread.isResolved ? (
                    <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
                  ) : (
                    <CircleIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
                  )}
                  <span className="truncate font-medium text-xs">{threadLocation(thread)}</span>
                  <span
                    className={cn(
                      "shrink-0 text-[10px]",
                      thread.isResolved
                        ? "text-emerald-600 dark:text-emerald-300/90"
                        : "text-amber-600 dark:text-amber-300/90",
                    )}
                  >
                    {thread.isResolved ? "resolved" : "unresolved"}
                  </span>
                  {threadWorkflowStatus ? (
                    <ReviewWorkflowStatusBadge record={threadWorkflowStatus} />
                  ) : null}
                </div>
                <p className="mt-1 truncate text-muted-foreground text-xs">
                  {authors.join(", ")} · {thread.comments.length} comments ·{" "}
                  {firstCommentPreview(thread)}
                </p>
              </button>
            </div>
            {expanded ? (
              <div className="mt-3 space-y-3">
                {thread.comments.map((comment) => {
                  const commentWorkflowStatus =
                    workflowStatuses?.byCommentId.get(comment.id) ?? threadWorkflowStatus;
                  return (
                    <div
                      key={comment.id}
                      className="min-w-0 rounded-md border border-border/60 bg-background/70 p-3"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
                        <span className="truncate text-xs">{comment.authorLogin ?? "unknown"}</span>
                        <span className="shrink-0 text-xs">{comment.reviewState}</span>
                      </div>
                      {commentWorkflowStatus ? (
                        <div className="mb-2 flex min-w-0 items-center gap-2">
                          <ReviewWorkflowStatusBadge record={commentWorkflowStatus} />
                          {commentWorkflowStatus.note ? (
                            <span className="min-w-0 truncate text-muted-foreground text-xs">
                              {commentWorkflowStatus.note}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <ChatMarkdown text={comment.body} cwd={markdownCwd} allowRawHtml />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      className={cn(
        mode === "panel" ? "rounded-lg border border-border/70 bg-muted/16" : "min-w-0",
      )}
    >
      {snapshot.checks.items.length > 0 ? (
        <div className="border-border/70 border-b p-3">
          <PullRequestChecksList checks={snapshot.checks} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-border/70 border-b p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium text-sm">
            <MessageSquareTextIcon className="size-4" />
            Review comments
          </div>
          <p className="text-muted-foreground text-xs">
            {snapshot.unresolvedCommentCount} unresolved, {snapshot.resolvedCommentCount} resolved
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSelectedThreadIds(defaultSelectedIds)}
          >
            Unresolved
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setSelectedThreadIds(new Set(snapshot.threads.map((thread) => thread.id)))
            }
          >
            All
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSelectedThreadIds(new Set())}
          >
            None
          </Button>
        </div>
      </div>

      {snapshot.threads.length > 0 ? (
        mode === "panel" ? (
          <ScrollArea className="max-h-72" scrollFade>
            {reviewThreads}
          </ScrollArea>
        ) : (
          reviewThreads
        )
      ) : (
        <div className="p-3 text-muted-foreground text-xs">No review comments found.</div>
      )}

      {errorMessage ? <p className="px-3 pt-2 text-destructive text-xs">{errorMessage}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-border/70 border-t p-3">
        <span className="text-muted-foreground text-xs">{selectedCount} selected comments</span>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={snapshot.unresolvedCommentCount === 0 || sendingMode !== null}
            onClick={() => void send("all_unresolved")}
          >
            {sendingMode === "all_unresolved" ? "Sending..." : "Send unresolved"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selectedCount === 0 || sendingMode !== null}
            onClick={() => void send("selected")}
          >
            {sendingMode === "selected" ? "Sending..." : "Send selected"}
          </Button>
        </div>
      </div>
    </div>
  );
}
