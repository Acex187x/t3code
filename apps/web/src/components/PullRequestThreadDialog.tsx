import type { EnvironmentId, GitResolvePullRequestResult, ThreadId } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  gitPreparePullRequestThreadMutationOptions,
  gitResolvePullRequestQueryOptions,
} from "~/lib/gitReactQuery";
import { useChangeRequestReviewSnapshot } from "~/lib/changeRequestReviewState";
import { useGitStatus } from "~/lib/gitStatusState";
import { cn } from "~/lib/utils";
import { parsePullRequestReference } from "~/pullRequestReference";
import { getSourceControlPresentation } from "~/sourceControlPresentation";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

interface PullRequestThreadDialogProps {
  open: boolean;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  cwd: string | null;
  initialReference: string | null;
  onOpenChange: (open: boolean) => void;
  onPrepared: (input: { branch: string; worktreePath: string | null }) => Promise<void> | void;
  onOpenReviewSidebar: (reference: string) => void;
}

function formatReviewSummary(input: {
  readonly approvingReviewCount: number;
  readonly changesRequestedReviewCount: number;
  readonly commentedReviewCount: number;
}): string {
  const parts: string[] = [];
  if (input.approvingReviewCount > 0) parts.push(`${input.approvingReviewCount} approval`);
  if (input.changesRequestedReviewCount > 0) {
    parts.push(`${input.changesRequestedReviewCount} changes requested`);
  }
  if (input.commentedReviewCount > 0) parts.push(`${input.commentedReviewCount} commented`);
  return parts.length > 0 ? parts.join(", ") : "No submitted reviews";
}

export function PullRequestThreadDialog({
  open,
  environmentId,
  threadId,
  cwd,
  initialReference,
  onOpenChange,
  onPrepared,
  onOpenReviewSidebar,
}: PullRequestThreadDialogProps) {
  const queryClient = useQueryClient();
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState(initialReference ?? "");
  const [referenceDirty, setReferenceDirty] = useState(false);
  const [preparingMode, setPreparingMode] = useState<"local" | "worktree" | null>(null);
  const [debouncedReference, referenceDebouncer] = useDebouncedValue(
    reference,
    { wait: 450 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const { data: gitStatus = null } = useGitStatus({ environmentId, cwd });
  const sourceControlPresentation = useMemo(
    () => getSourceControlPresentation(gitStatus?.sourceControlProvider),
    [gitStatus?.sourceControlProvider],
  );
  const terminology = sourceControlPresentation.terminology;
  const SourceControlIcon = sourceControlPresentation.Icon;

  useEffect(() => {
    if (!open) return;
    setReference(initialReference ?? "");
    setReferenceDirty(false);
    setPreparingMode(null);
  }, [initialReference, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      referenceInputRef.current?.focus();
      referenceInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const parsedReference = parsePullRequestReference(reference);
  const parsedDebouncedReference = parsePullRequestReference(debouncedReference);
  const resolvePullRequestQuery = useQuery(
    gitResolvePullRequestQueryOptions({
      environmentId,
      cwd,
      reference: open ? parsedDebouncedReference : null,
    }),
  );
  const cachedPullRequest = useMemo(() => {
    if (!cwd || !parsedReference) {
      return null;
    }
    const cached = queryClient.getQueryData<GitResolvePullRequestResult>([
      "git",
      "pull-request",
      environmentId,
      cwd,
      parsedReference,
    ]);
    return cached?.pullRequest ?? null;
  }, [cwd, environmentId, parsedReference, queryClient]);
  const preparePullRequestThreadMutation = useMutation(
    gitPreparePullRequestThreadMutationOptions({ environmentId, cwd, queryClient }),
  );

  const liveResolvedPullRequest =
    parsedReference !== null && parsedReference === parsedDebouncedReference
      ? (resolvePullRequestQuery.data?.pullRequest ?? null)
      : null;
  const resolvedPullRequest = liveResolvedPullRequest ?? cachedPullRequest;
  const reviewSnapshotState = useChangeRequestReviewSnapshot({
    environmentId,
    cwd,
    reference: resolvedPullRequest ? String(resolvedPullRequest.number) : null,
    enabled: open && gitStatus?.sourceControlProvider?.kind === "github",
  });
  const reviewThreadCounts = reviewSnapshotState.data
    ? {
        unresolved: reviewSnapshotState.data.threads.filter(
          (thread) => !thread.isResolved && !thread.isOutdated,
        ).length,
        resolved: reviewSnapshotState.data.threads.filter(
          (thread) => thread.isResolved || thread.isOutdated,
        ).length,
      }
    : null;
  const isResolving =
    open &&
    parsedReference !== null &&
    resolvedPullRequest === null &&
    (referenceDebouncer.state.isPending ||
      parsedReference !== parsedDebouncedReference ||
      resolvePullRequestQuery.isPending ||
      resolvePullRequestQuery.isFetching);
  const statusTone = useMemo(() => {
    switch (resolvedPullRequest?.state) {
      case "merged":
        return "text-violet-600 dark:text-violet-300/90";
      case "closed":
        return "text-zinc-500 dark:text-zinc-400/80";
      case "open":
        return "text-emerald-600 dark:text-emerald-300/90";
      default:
        return "text-muted-foreground";
    }
  }, [resolvedPullRequest?.state]);

  const handleConfirm = useCallback(
    async (mode: "local" | "worktree") => {
      if (!parsedReference) {
        setReferenceDirty(true);
        return;
      }
      if (!parsedReference || !resolvedPullRequest || !cwd) {
        return;
      }
      setPreparingMode(mode);
      try {
        const result = await preparePullRequestThreadMutation.mutateAsync({
          reference: parsedReference,
          mode,
          ...(mode === "worktree" ? { threadId } : {}),
        });
        await onPrepared({
          branch: result.branch,
          worktreePath: result.worktreePath,
        });
        onOpenChange(false);
      } finally {
        setPreparingMode(null);
      }
    },
    [
      cwd,
      onOpenChange,
      onPrepared,
      parsedReference,
      preparePullRequestThreadMutation,
      resolvedPullRequest,
      threadId,
    ],
  );

  const validationMessage = !referenceDirty
    ? null
    : reference.trim().length === 0
      ? `Paste a ${terminology.singular} URL, checkout command, or enter 123 / #123.`
      : parsedReference === null
        ? `Use a ${terminology.singular} URL, checkout command, 123, or #123.`
        : null;
  const errorMessage =
    validationMessage ??
    (resolvedPullRequest === null && resolvePullRequestQuery.isError
      ? resolvePullRequestQuery.error instanceof Error
        ? resolvePullRequestQuery.error.message
        : `Failed to resolve ${terminology.singular}.`
      : preparePullRequestThreadMutation.error instanceof Error
        ? preparePullRequestThreadMutation.error.message
        : preparePullRequestThreadMutation.error
          ? `Failed to prepare ${terminology.singular} thread.`
          : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!preparePullRequestThreadMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SourceControlIcon className="size-4" />
            Checkout {terminology.singular}
          </DialogTitle>
          <DialogDescription>
            Resolve a {sourceControlPresentation.providerName} {terminology.singular}, then create
            the draft thread in the main repo or in a dedicated worktree.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground capitalize">
              {terminology.singular}
            </span>
            <Input
              ref={referenceInputRef}
              placeholder={`${terminology.shortLabel} URL, checkout command, or #42`}
              value={reference}
              onChange={(event) => {
                setReferenceDirty(true);
                setReference(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                if (!isResolving && !preparePullRequestThreadMutation.isPending) {
                  void handleConfirm("local");
                }
              }}
            />
          </label>

          {resolvedPullRequest ? (
            <div className="rounded-lg border border-border/70 bg-muted/24 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{resolvedPullRequest.title}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    #{resolvedPullRequest.number} · {resolvedPullRequest.headBranch} to{" "}
                    {resolvedPullRequest.baseBranch}
                  </p>
                </div>
                <span className={cn("shrink-0 text-xs capitalize", statusTone)}>
                  {resolvedPullRequest.state}
                </span>
              </div>
              {gitStatus?.sourceControlProvider?.kind === "github" ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {reviewSnapshotState.data ? (
                      <>
                        <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                          Review {reviewSnapshotState.data.reviewDecision.replaceAll("_", " ")}
                        </span>
                        <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                          {formatReviewSummary(reviewSnapshotState.data.reviewSummary)}
                        </span>
                        <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                          Checks {reviewSnapshotState.data.checks.state}
                        </span>
                        <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                          {reviewSnapshotState.data.commentCount} comments
                        </span>
                        <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                          {reviewThreadCounts?.unresolved ?? 0} unresolved
                        </span>
                        <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                          {reviewThreadCounts?.resolved ?? 0} resolved
                        </span>
                      </>
                    ) : reviewSnapshotState.isLoading ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Spinner className="size-3" />
                        Loading review comments...
                      </span>
                    ) : reviewSnapshotState.error ? (
                      <span className="text-muted-foreground">
                        Review comments unavailable: {reviewSnapshotState.error.message}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenReviewSidebar(String(resolvedPullRequest.number))}
                  >
                    Open review sidebar
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {isResolving ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              Resolving {terminology.singular}...
            </div>
          ) : null}

          {errorMessage ? <p className="text-destructive text-xs">{errorMessage}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={preparePullRequestThreadMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void handleConfirm("local");
            }}
            disabled={
              !cwd ||
              !resolvedPullRequest ||
              isResolving ||
              preparePullRequestThreadMutation.isPending
            }
          >
            {preparingMode === "local" ? "Preparing local..." : "Local"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleConfirm("worktree");
            }}
            disabled={
              !cwd ||
              !resolvedPullRequest ||
              isResolving ||
              preparePullRequestThreadMutation.isPending
            }
          >
            {preparingMode === "worktree" ? "Preparing worktree..." : "Worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
