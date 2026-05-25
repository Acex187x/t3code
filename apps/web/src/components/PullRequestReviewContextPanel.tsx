import type {
  SourceControlChangeRequestReviewSnapshot,
  SourceControlCheckRunSummary,
} from "@t3tools/contracts";
import {
  formatChangeRequestReviewContext,
  type ChangeRequestReviewContextMode,
  type ReviewAttemptContext,
} from "@t3tools/shared/changeRequestReviewContext";
import { autoAnimate } from "@formkit/auto-animate";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  Clock3Icon,
  ExternalLinkIcon,
  MinusCircleIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import {
  nextReviewAttemptContext,
  type ReviewCommentWorkflowStatus,
  type ReviewCommentWorkflowStatusMap,
  type ReviewCommentWorkflowStatusRecord,
} from "~/reviewCommentWorkflow";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { ScrollArea } from "./ui/scroll-area";

const THREAD_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

interface PullRequestReviewContextPanelProps {
  readonly snapshot: SourceControlChangeRequestReviewSnapshot;
  readonly onSendContext: (
    markdown: string,
    queuedThreadIds: ReadonlySet<string>,
  ) => Promise<void> | void;
  readonly markdownCwd?: string | undefined;
  readonly mode?: "panel" | "sidebar";
  readonly workflowStatuses?: ReviewCommentWorkflowStatusMap | undefined;
}

function workflowStatusLabel(status: ReviewCommentWorkflowStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "in_progress":
      return "Working";
    case "done":
      return "Done";
    case "ready_to_push":
      return "Ready for push";
    case "addressed":
      return "Addressed";
    case "ignored":
      return "Ignored";
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
    case "queued":
      return "border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-300";
    case "in_progress":
      return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300";
    case "done":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300";
    case "ready_to_push":
      return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300";
    case "addressed":
      return "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300";
    case "ignored":
      return "border-zinc-500/25 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400";
    case "in_review":
      return "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300";
    case "resolved":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "unresolved":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";
  }
}

function reviewContextErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === "object") {
    const message = "message" in error ? error.message : undefined;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
    const tag = "_tag" in error ? error._tag : undefined;
    if (typeof tag === "string" && tag.trim().length > 0) {
      return tag;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Fall through to the generic fallback below.
    }
  }
  const fallback = String(error);
  return fallback && fallback !== "[object Object]" ? fallback : "Failed to send review context.";
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
        "inline-flex max-w-full shrink-0 items-center rounded-md border px-1.5 py-0.5 font-medium text-[10px] transition-colors duration-200",
        workflowStatusClassName(record.status),
      )}
    >
      {workflowStatusLabel(record.status)}
    </span>
  );
}

function ReviewAttemptBadge({ record }: { readonly record: ReviewCommentWorkflowStatusRecord }) {
  if (record.attemptCount <= 1) {
    return null;
  }
  return (
    <span className="inline-flex max-w-full shrink-0 items-center rounded-md border border-fuchsia-500/25 bg-fuchsia-500/10 px-1.5 py-0.5 font-medium text-[10px] text-fuchsia-600 transition-colors duration-200 dark:text-fuchsia-300">
      x{record.attemptCount}
    </span>
  );
}

function isActionableReviewThread(
  thread: SourceControlChangeRequestReviewSnapshot["threads"][number],
): boolean {
  return !thread.isResolved && !thread.isOutdated;
}

function ReviewResolutionBadge({
  thread,
}: {
  readonly thread: SourceControlChangeRequestReviewSnapshot["threads"][number];
}) {
  const label = thread.isOutdated ? "Outdated" : thread.isResolved ? "Resolved" : "Unresolved";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-medium text-[10px] transition-colors duration-200",
        thread.isOutdated
          ? "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"
          : thread.isResolved
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
            : "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
      )}
    >
      {label}
    </span>
  );
}

function threadLocation(thread: SourceControlChangeRequestReviewSnapshot["threads"][number]) {
  const path = thread.path ?? "unknown file";
  const lineRef =
    thread.startLine !== null && thread.line !== null && thread.startLine !== thread.line
      ? `:${thread.startLine}-${thread.line}`
      : thread.line !== null
        ? `:${thread.line}`
        : "";
  const basename = path.split("/").pop() ?? path;
  const dir = path.length > basename.length ? path.slice(0, -basename.length - 1) : "";
  return { basename: `${basename}${lineRef}`, dir };
}

function cleanCommentPreview(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^[#>\s\-*+|]+/gm, " ")
    .replace(/[_*~]+/g, "")
    .replace(/&nbsp;|&amp;|&lt;|&gt;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstCommentPreview(thread: SourceControlChangeRequestReviewSnapshot["threads"][number]) {
  const body = thread.comments[0]?.body ?? "";
  const cleaned = cleanCommentPreview(body);
  return cleaned.length > 0 ? cleaned : "No comment body";
}

function checkStateTone(state: SourceControlCheckRunSummary["state"]): string {
  switch (state) {
    case "success":
      return "text-emerald-500";
    case "failure":
      return "text-destructive";
    case "pending":
      return "text-amber-500";
    case "skipped":
    case "neutral":
      return "text-muted-foreground/60";
    default:
      return "text-muted-foreground/60";
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

function SectionHeader({
  title,
  right,
}: {
  readonly title: string;
  readonly right?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/50 uppercase">
        {title}
      </p>
      {right ? <div className="text-[10px] text-muted-foreground/60">{right}</div> : null}
    </div>
  );
}

function checksSummary(checks: SourceControlChangeRequestReviewSnapshot["checks"]) {
  if (checks.failureCount > 0) {
    return <span className="text-destructive">{checks.failureCount} failing</span>;
  }
  if (checks.pendingCount > 0) {
    return <span className="text-amber-500">{checks.pendingCount} pending</span>;
  }
  return (
    <span className="text-emerald-500">
      {checks.successCount}/{checks.totalCount} passing
    </span>
  );
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
    <section className="space-y-1.5">
      <SectionHeader title="Checks" right={checksSummary(checks)} />
      <div className="-mx-2">
        {sortedChecks.map((check) => {
          const subline = check.description ?? check.workflowName ?? null;
          const content = (
            <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-200 hover:bg-muted/40">
              <CheckStateIcon
                state={check.state}
                className={cn(
                  "size-3.5 shrink-0 transition-colors duration-200",
                  checkStateTone(check.state),
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{check.name}</div>
                {subline ? (
                  <div className="truncate text-[11px] text-muted-foreground/70">{subline}</div>
                ) : null}
              </div>
              {check.detailsUrl ? (
                <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground/70" />
              ) : null}
            </div>
          );

          return check.detailsUrl ? (
            <a
              key={`${check.name}:${check.detailsUrl}`}
              href={check.detailsUrl}
              target="_blank"
              rel="noreferrer"
              className="group block"
            >
              {content}
            </a>
          ) : (
            <div key={`${check.name}:${check.state}:${check.description ?? ""}`}>{content}</div>
          );
        })}
      </div>
    </section>
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
    () => new Set(snapshot.threads.filter(isActionableReviewThread).map((thread) => thread.id)),
    [snapshot.threads],
  );
  const [selectedThreadIds, setSelectedThreadIds] = useState(defaultSelectedIds);
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sendingMode, setSendingMode] = useState<ChangeRequestReviewContextMode | null>(null);
  const animatedListRef = useRef<HTMLDivElement | null>(null);
  const attachThreadListRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || animatedListRef.current === node) return;
    autoAnimate(node, THREAD_LIST_ANIMATION_OPTIONS);
    animatedListRef.current = node;
  }, []);

  useEffect(() => {
    setSelectedThreadIds(defaultSelectedIds);
    setExpandedThreadIds(new Set());
    setErrorMessage(null);
  }, [defaultSelectedIds]);

  const selectedThreadCount = snapshot.threads.filter((thread) =>
    selectedThreadIds.has(thread.id),
  ).length;
  const unresolvedThreads = snapshot.threads.filter(isActionableReviewThread);
  const resolvedThreads = snapshot.threads.filter((thread) => !isActionableReviewThread(thread));
  const unresolvedThreadCount = unresolvedThreads.length;
  const resolvedThreadCount = resolvedThreads.length;
  const allUnresolvedSelected =
    unresolvedThreadCount > 0 &&
    unresolvedThreads.every((thread) => selectedThreadIds.has(thread.id));
  const allResolvedSelected =
    resolvedThreadCount > 0 && resolvedThreads.every((thread) => selectedThreadIds.has(thread.id));
  const groupedThreads = useMemo(
    () =>
      snapshot.threads.toSorted(
        (left, right) =>
          Number(!isActionableReviewThread(left)) - Number(!isActionableReviewThread(right)),
      ),
    [snapshot.threads],
  );

  const send = async (mode: ChangeRequestReviewContextMode) => {
    setErrorMessage(null);
    const threadIdsToQueue = new Set(
      snapshot.threads
        .filter((thread) => {
          if (mode === "all_unresolved") {
            return isActionableReviewThread(thread);
          }
          if (mode === "selected") {
            return selectedThreadIds.has(thread.id);
          }
          return true;
        })
        .map((thread) => thread.id),
    );
    const reviewAttemptByThreadId = new Map<string, ReviewAttemptContext>();
    for (const thread of snapshot.threads) {
      const attempt = nextReviewAttemptContext(workflowStatuses?.byThreadId.get(thread.id) ?? null);
      if (attempt !== null) {
        reviewAttemptByThreadId.set(thread.id, attempt);
      }
    }
    const result = formatChangeRequestReviewContext({
      snapshot,
      mode,
      selectedThreadIds: [...selectedThreadIds],
      reviewAttemptByThreadId,
    });
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setSendingMode(mode);
    try {
      await onSendContext(result.markdown, threadIdsToQueue);
    } catch (error) {
      setErrorMessage(reviewContextErrorMessage(error));
    } finally {
      setSendingMode(null);
    }
  };

  const toggleGroupSelection = useCallback(
    (group: "unresolved" | "resolved", select: boolean) => {
      setSelectedThreadIds((current) => {
        const next = new Set(current);
        const targets = group === "unresolved" ? unresolvedThreads : resolvedThreads;
        for (const thread of targets) {
          if (select) {
            next.add(thread.id);
          } else {
            next.delete(thread.id);
          }
        }
        return next;
      });
    },
    [resolvedThreads, unresolvedThreads],
  );

  const toggleExpanded = (threadId: string) => {
    setExpandedThreadIds((current) => {
      const next = new Set(current);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  };

  const reviewThreads = (
    <div ref={attachThreadListRef} className="-mx-1 space-y-0.5">
      {groupedThreads.map((thread, index) => {
        const selected = selectedThreadIds.has(thread.id);
        const expanded = expandedThreadIds.has(thread.id);
        const { basename, dir } = threadLocation(thread);
        const authors = [
          ...new Set(thread.comments.map((comment) => comment.authorLogin ?? "unknown")),
        ];
        const preview = firstCommentPreview(thread);
        const subline = [dir, authors.join(", "), preview].filter(Boolean).join(" · ");
        const startsGroup =
          index === 0 ||
          isActionableReviewThread(groupedThreads[index - 1]!) !== isActionableReviewThread(thread);
        const isActionable = isActionableReviewThread(thread);
        const threadWorkflowStatus = isActionable
          ? (workflowStatuses?.byThreadId.get(thread.id) ?? null)
          : null;
        const groupCount = isActionable ? unresolvedThreadCount : resolvedThreadCount;
        const allGroupSelected = isActionable ? allUnresolvedSelected : allResolvedSelected;
        const groupKey = isActionable ? "unresolved" : "resolved";
        return (
          <Fragment key={thread.id}>
            {startsGroup ? (
              <div className={cn("px-1 pb-1", index > 0 && "pt-3")}>
                <SectionHeader
                  title={isActionable ? "Unresolved" : "Resolved"}
                  right={
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
                        onClick={() => toggleGroupSelection(groupKey, !allGroupSelected)}
                      >
                        {allGroupSelected ? "Clear" : "Select all"}
                      </button>
                      <span className="text-[10px] text-muted-foreground/60">
                        {groupCount} thread{groupCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  }
                />
              </div>
            ) : null}
            <div
              className={cn(
                "group rounded-md transition-colors duration-200",
                expanded ? "bg-muted/30" : "hover:bg-muted/20",
              )}
            >
              <div className="flex items-start gap-2 px-2 py-2">
                <Checkbox
                  className="mt-0.5"
                  checked={selected}
                  onCheckedChange={(value) => {
                    setSelectedThreadIds((current) => {
                      const next = new Set(current);
                      if (value === true) {
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
                  aria-expanded={expanded}
                  onClick={() => toggleExpanded(thread.id)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ReviewResolutionBadge thread={thread} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{basename}</span>
                    {threadWorkflowStatus ? (
                      <>
                        <ReviewAttemptBadge record={threadWorkflowStatus} />
                        <ReviewWorkflowStatusBadge record={threadWorkflowStatus} />
                      </>
                    ) : null}
                    <ChevronDownIcon
                      className={cn(
                        "size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200 group-hover:text-muted-foreground/70",
                        expanded && "rotate-180",
                      )}
                    />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{subline}</p>
                </button>
              </div>
              <Collapsible
                open={expanded}
                onOpenChange={(open) => !open && toggleExpanded(thread.id)}
              >
                <CollapsibleContent>
                  <div className="space-y-2 px-2 pb-3">
                    {thread.comments.map((comment) => {
                      const commentWorkflowStatus =
                        workflowStatuses?.byCommentId.get(comment.id) ?? threadWorkflowStatus;
                      return (
                        <div
                          key={comment.id}
                          className="min-w-0 rounded-md border border-border/50 bg-background/70 p-3 transition-colors duration-200"
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span className="truncate">{comment.authorLogin ?? "unknown"}</span>
                            <span className="shrink-0">{comment.reviewState}</span>
                          </div>
                          {commentWorkflowStatus ? (
                            <div className="mb-2 flex min-w-0 items-center gap-2">
                              <ReviewAttemptBadge record={commentWorkflowStatus} />
                              <ReviewWorkflowStatusBadge record={commentWorkflowStatus} />
                              {commentWorkflowStatus.note ? (
                                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                                  {commentWorkflowStatus.note}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="min-w-0 text-xs">
                            <ChatMarkdown text={comment.body} cwd={markdownCwd} allowRawHtml />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </Fragment>
        );
      })}
    </div>
  );

  const sendActions = (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={unresolvedThreadCount === 0 || sendingMode !== null}
        onClick={() => void send("all_unresolved")}
      >
        {sendingMode === "all_unresolved" ? "Sending…" : "Send all unresolved"}
      </Button>
      <Button
        type="button"
        size="xs"
        disabled={selectedThreadCount === 0 || sendingMode !== null}
        onClick={() => void send("selected")}
      >
        {sendingMode === "selected"
          ? "Sending…"
          : selectedThreadCount > 0
            ? `Send ${selectedThreadCount} selected`
            : "Send selected"}
      </Button>
    </div>
  );

  const emptyThreads = (
    <p className="px-2 py-3 text-[11px] text-muted-foreground/60">No review comments.</p>
  );

  if (mode === "sidebar") {
    const hasChecks = snapshot.checks.items.length > 0;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {hasChecks ? (
          <div className="shrink-0 border-b border-border/60 p-3">
            <PullRequestChecksList checks={snapshot.checks} />
          </div>
        ) : null}
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3">{snapshot.threads.length > 0 ? reviewThreads : emptyThreads}</div>
        </ScrollArea>
        <div className="shrink-0 space-y-2 border-t border-border/60 p-3">
          {errorMessage ? <p className="text-[11px] text-destructive">{errorMessage}</p> : null}
          {sendActions}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border/70 bg-muted/16 p-3">
      {snapshot.checks.items.length > 0 ? <PullRequestChecksList checks={snapshot.checks} /> : null}
      {snapshot.threads.length > 0 ? (
        <ScrollArea className="max-h-72" scrollFade>
          {reviewThreads}
        </ScrollArea>
      ) : (
        emptyThreads
      )}
      {errorMessage ? <p className="text-[11px] text-destructive">{errorMessage}</p> : null}
      <div className="border-t border-border/60 pt-3">{sendActions}</div>
    </div>
  );
}
