import {
  EventId,
  type OrchestrationThreadActivity,
  SourceControlReviewCommentWorkflowStatus,
  type SourceControlChangeRequestReviewSnapshot,
  type SourceControlReviewCommentWorkflowSource,
  type SourceControlReviewCommentWorkflowStatus as ReviewCommentWorkflowStatus,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export type { ReviewCommentWorkflowStatus };

export interface ReviewCommentWorkflowStatusRecord {
  readonly status: ReviewCommentWorkflowStatus;
  readonly note: string | null;
  readonly updatedAt: string;
  readonly attemptCount: number;
}

export interface ReviewCommentWorkflowStatusMap {
  readonly byThreadId: ReadonlyMap<string, ReviewCommentWorkflowStatusRecord>;
  readonly byCommentId: ReadonlyMap<string, ReviewCommentWorkflowStatusRecord>;
}

interface BuildReviewCommentWorkflowStatusesOptions {
  readonly readyToPushResetAt?: string | null | undefined;
  readonly turnInProgress?: boolean | undefined;
  readonly queuedThreadIds?: ReadonlySet<string> | undefined;
  readonly reviewThreads?:
    | SourceControlChangeRequestReviewSnapshot["threads"]
    | ReadonlyArray<{
        readonly id: string;
        readonly isResolved: boolean;
        readonly isOutdated: boolean;
        readonly comments: ReadonlyArray<{ readonly id: string }>;
      }>
    | undefined;
}

interface ReviewCommentStatusInput {
  readonly reviewThreadId: string;
  readonly commentId: string | null;
  readonly status: ReviewCommentWorkflowStatus;
  readonly note: string | null;
  readonly attempt: number | null;
}

interface CreateReviewCommentStatusChangedActivityInput {
  readonly id: string;
  readonly createdAt: string;
  readonly reviewThreadId: string;
  readonly commentId?: string | undefined;
  readonly status: ReviewCommentWorkflowStatus;
  readonly note?: string | undefined;
  readonly attempt?: number | undefined;
  readonly source: SourceControlReviewCommentWorkflowSource;
  readonly turnId?: string | null | undefined;
}

const isReviewCommentWorkflowStatus = Schema.is(SourceControlReviewCommentWorkflowStatus);

export function createReviewCommentStatusChangedActivity(
  input: CreateReviewCommentStatusChangedActivityInput,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: input.source === "agent" ? "tool" : "info",
    kind: "review-comment.status.changed",
    summary: reviewCommentStatusSummary(input.status),
    payload: {
      reviewThreadId: input.reviewThreadId,
      ...(input.commentId ? { commentId: input.commentId } : {}),
      status: input.status,
      ...(input.note ? { note: input.note } : {}),
      ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
      source: input.source,
    },
    turnId: input.turnId ? TurnId.make(input.turnId) : null,
    createdAt: input.createdAt,
  };
}

export function nextReviewAttemptContext(
  record: ReviewCommentWorkflowStatusRecord | null,
): { readonly attemptNumber: number } | null {
  if (record === null) {
    return null;
  }
  if (record.status === "resolved" || record.status === "unresolved") {
    return null;
  }
  const attemptNumber = nextAttemptCount(record);
  return attemptNumber > 1 ? { attemptNumber } : null;
}

export function buildReviewCommentWorkflowStatuses(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  options: BuildReviewCommentWorkflowStatusesOptions = {},
): ReviewCommentWorkflowStatusMap {
  const byThreadId = new Map<string, ReviewCommentWorkflowStatusRecord>();
  const byCommentId = new Map<string, ReviewCommentWorkflowStatusRecord>();
  const attemptCountByThreadId = new Map<string, number>();
  const attemptCountByCommentId = new Map<string, number>();
  const resetAt = options.readyToPushResetAt ?? null;
  const turnInProgress = options.turnInProgress ?? false;

  for (const activity of activities) {
    const input = parseReviewCommentStatusActivity(activity);
    if (input === null) {
      continue;
    }
    if (input.status === "in_progress") {
      attemptCountByThreadId.set(
        input.reviewThreadId,
        (attemptCountByThreadId.get(input.reviewThreadId) ?? 0) + 1,
      );
      if (input.commentId !== null) {
        attemptCountByCommentId.set(
          input.commentId,
          (attemptCountByCommentId.get(input.commentId) ?? 0) + 1,
        );
      }
    }
    const attemptCount =
      input.attempt ??
      (input.status === "queued"
        ? nextAttemptCount(byThreadId.get(input.reviewThreadId) ?? null)
        : Math.max(1, attemptCountByThreadId.get(input.reviewThreadId) ?? 0));
    const record: ReviewCommentWorkflowStatusRecord = {
      status: input.status,
      note: input.note,
      updatedAt: activity.createdAt,
      attemptCount,
    };
    byThreadId.set(input.reviewThreadId, record);
    if (input.commentId !== null) {
      byCommentId.set(input.commentId, {
        ...record,
        attemptCount:
          input.attempt ??
          Math.max(1, attemptCountByCommentId.get(input.commentId) ?? attemptCount),
      });
    }
  }

  if (!turnInProgress) {
    promoteDoneStatuses(byThreadId);
    promoteDoneStatuses(byCommentId);
    ignoreQueuedStatuses(byThreadId);
    ignoreQueuedStatuses(byCommentId);
  }

  if (resetAt !== null) {
    addressReadyToPushStatuses(byThreadId, resetAt);
    addressReadyToPushStatuses(byCommentId, resetAt);
  }

  if (turnInProgress) {
    for (const threadId of options.queuedThreadIds ?? []) {
      const existing = byThreadId.get(threadId) ?? null;
      if (
        existing !== null &&
        existing.status !== "addressed" &&
        existing.status !== "unresolved"
      ) {
        continue;
      }
      const attemptCount = nextAttemptCount(existing);
      byThreadId.set(threadId, {
        status: "queued",
        note: "Queued for the agent.",
        updatedAt: new Date().toISOString(),
        attemptCount,
      });
    }
  }

  hideInactiveResolvedOrOutdatedStatuses(byThreadId, byCommentId, options.reviewThreads ?? []);

  return { byThreadId, byCommentId };
}

function parseReviewCommentStatusActivity(
  activity: OrchestrationThreadActivity,
): ReviewCommentStatusInput | null {
  if (activity.kind === "review-comment.status.changed") {
    const payload = activity.payload as
      | {
          readonly reviewThreadId?: unknown;
          readonly commentId?: unknown;
          readonly status?: unknown;
          readonly note?: unknown;
          readonly attempt?: unknown;
        }
      | null
      | undefined;
    if (typeof payload?.reviewThreadId !== "string" || payload.reviewThreadId.length === 0) {
      return null;
    }
    if (!isReviewCommentWorkflowStatus(payload.status)) {
      return null;
    }
    return {
      reviewThreadId: payload.reviewThreadId,
      commentId:
        typeof payload.commentId === "string" && payload.commentId.length > 0
          ? payload.commentId
          : null,
      status: payload.status,
      note:
        typeof payload.note === "string" && payload.note.trim().length > 0
          ? payload.note.trim()
          : null,
      attempt:
        typeof payload.attempt === "number" &&
        Number.isInteger(payload.attempt) &&
        payload.attempt > 0
          ? payload.attempt
          : null,
    };
  }

  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return null;
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
    return null;
  }
  const input = data.input;
  if (!input || typeof input.reviewThreadId !== "string" || input.reviewThreadId.length === 0) {
    return null;
  }
  if (!isReviewCommentWorkflowStatus(input.status)) {
    return null;
  }
  return {
    reviewThreadId: input.reviewThreadId,
    commentId:
      typeof input.commentId === "string" && input.commentId.length > 0 ? input.commentId : null,
    status: input.status,
    note: typeof input.note === "string" && input.note.trim().length > 0 ? input.note.trim() : null,
    attempt: null,
  };
}

function promoteDoneStatuses(records: Map<string, ReviewCommentWorkflowStatusRecord>) {
  for (const [key, record] of records) {
    if (record.status !== "done") {
      continue;
    }
    records.set(key, {
      ...record,
      status: "ready_to_push",
      note: record.note ?? "Agent finished; ready to push.",
    });
  }
}

function ignoreQueuedStatuses(records: Map<string, ReviewCommentWorkflowStatusRecord>) {
  for (const [key, record] of records) {
    if (record.status !== "queued") {
      continue;
    }
    records.set(key, {
      ...record,
      status: "ignored",
      note: record.note ?? "Agent finished without taking this comment.",
    });
  }
}

function addressReadyToPushStatuses(
  records: Map<string, ReviewCommentWorkflowStatusRecord>,
  resetAt: string,
) {
  const resetTime = Date.parse(resetAt);
  if (!Number.isFinite(resetTime)) {
    return;
  }

  for (const [key, record] of records) {
    if (record.status !== "ready_to_push") {
      continue;
    }
    const updatedTime = Date.parse(record.updatedAt);
    if (!Number.isFinite(updatedTime) || updatedTime > resetTime) {
      continue;
    }
    records.set(key, {
      status: "addressed",
      note: "Pushed; waiting for review resolution.",
      updatedAt: resetAt,
      attemptCount: record.attemptCount,
    });
  }
}

function hideInactiveResolvedOrOutdatedStatuses(
  byThreadId: Map<string, ReviewCommentWorkflowStatusRecord>,
  byCommentId: Map<string, ReviewCommentWorkflowStatusRecord>,
  reviewThreads: NonNullable<BuildReviewCommentWorkflowStatusesOptions["reviewThreads"]>,
) {
  for (const thread of reviewThreads) {
    if (!thread.isResolved && !thread.isOutdated) {
      continue;
    }
    const threadRecord = byThreadId.get(thread.id) ?? null;
    if (threadRecord !== null && !isActiveAttemptStatus(threadRecord.status)) {
      byThreadId.delete(thread.id);
    }
    for (const comment of thread.comments) {
      const commentRecord = byCommentId.get(comment.id) ?? null;
      if (commentRecord !== null && !isActiveAttemptStatus(commentRecord.status)) {
        byCommentId.delete(comment.id);
      }
    }
  }
}

function isActiveAttemptStatus(status: ReviewCommentWorkflowStatus): boolean {
  return status === "queued" || status === "in_progress" || status === "done";
}

function nextAttemptCount(record: ReviewCommentWorkflowStatusRecord | null): number {
  if (record === null) {
    return 1;
  }
  return record.status === "queued" || record.status === "in_progress"
    ? record.attemptCount
    : record.attemptCount + 1;
}

function reviewCommentStatusSummary(status: ReviewCommentWorkflowStatus): string {
  switch (status) {
    case "queued":
      return "Review comment queued";
    case "in_progress":
      return "Review comment in progress";
    case "done":
      return "Review comment done";
    case "ready_to_push":
      return "Review comment ready to push";
    case "addressed":
      return "Review comment addressed";
    case "ignored":
      return "Review comment ignored";
    case "in_review":
      return "Review comment in review";
    case "unresolved":
      return "Review comment unresolved";
    case "resolved":
      return "Review comment resolved";
  }
}
