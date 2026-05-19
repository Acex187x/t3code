import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  PositiveInt,
  TrimmedNonEmptyString,
  type SourceControlChangeRequestReviewSnapshot,
  type SourceControlCheckRunSummary,
  type SourceControlChangeRequestReviewState,
  type SourceControlCheckRollupState,
  type SourceControlReviewComment,
  type SourceControlReviewCommentState,
  type SourceControlReviewThread,
} from "@t3tools/contracts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";

export interface NormalizedGitHubPullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

const GitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nameWithOwner: Schema.String,
      }),
    ),
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.String,
      }),
    ),
  ),
});

function trimOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGitHubPullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const normalizedState = input.state?.trim().toUpperCase();
  if (
    (typeof input.mergedAt === "string" && input.mergedAt.trim().length > 0) ||
    normalizedState === "MERGED"
  ) {
    return "merged";
  }
  if (normalizedState === "CLOSED") {
    return "closed";
  }
  return "open";
}

function normalizeGitHubPullRequestRecord(
  raw: Schema.Schema.Type<typeof GitHubPullRequestSchema>,
): NormalizedGitHubPullRequestRecord {
  const headRepositoryNameWithOwner = trimOptionalString(raw.headRepository?.nameWithOwner);
  const headRepositoryOwnerLogin =
    trimOptionalString(raw.headRepositoryOwner?.login) ??
    (typeof headRepositoryNameWithOwner === "string" && headRepositoryNameWithOwner.includes("/")
      ? (headRepositoryNameWithOwner.split("/")[0] ?? null)
      : null);

  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizeGitHubPullRequestState(raw),
    updatedAt: raw.updatedAt ?? Option.none(),
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

const decodeGitHubPullRequestList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeGitHubPullRequest = decodeJsonResult(GitHubPullRequestSchema);
const decodeGitHubPullRequestEntry = Schema.decodeUnknownExit(GitHubPullRequestSchema);
const decodeUnknownJson = decodeJsonResult(Schema.Unknown);

export const formatGitHubJsonDecodeError = formatSchemaError;

export function decodeGitHubPullRequestListJson(
  raw: string,
): Result.Result<
  ReadonlyArray<NormalizedGitHubPullRequestRecord>,
  Cause.Cause<Schema.SchemaError>
> {
  const result = decodeGitHubPullRequestList(raw);
  if (Result.isSuccess(result)) {
    const pullRequests: NormalizedGitHubPullRequestRecord[] = [];
    for (const entry of result.success) {
      const decodedEntry = decodeGitHubPullRequestEntry(entry);
      if (Exit.isFailure(decodedEntry)) {
        continue;
      }
      pullRequests.push(normalizeGitHubPullRequestRecord(decodedEntry.value));
    }
    return Result.succeed(pullRequests);
  }
  return Result.fail(result.failure);
}

export function decodeGitHubPullRequestJson(
  raw: string,
): Result.Result<NormalizedGitHubPullRequestRecord, Cause.Cause<Schema.SchemaError>> {
  const result = decodeGitHubPullRequest(raw);
  if (Result.isSuccess(result)) {
    return Result.succeed(normalizeGitHubPullRequestRecord(result.success));
  }
  return Result.fail(result.failure);
}

const MAX_REVIEW_COMMENT_BODY_CHARS = 20_000;
const MAX_REVIEW_COMMENTS = 500;

interface PullRequestReviewBase {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly reviewDecision: SourceControlChangeRequestReviewState;
  readonly reviewSummary: SourceControlChangeRequestReviewSnapshot["reviewSummary"];
  readonly checks: SourceControlChangeRequestReviewSnapshot["checks"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function dateTimeValue(value: unknown): DateTime.Utc {
  const text = stringValue(value);
  return DateTime.makeUnsafe(text ?? "1970-01-01T00:00:00.000Z");
}

function optionalDateTimeValue(value: unknown): DateTime.Utc | null {
  const text = stringValue(value);
  return text === null ? null : DateTime.makeUnsafe(text);
}

function normalizeReviewDecision(input: unknown): SourceControlChangeRequestReviewState {
  switch (stringValue(input)?.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    case "COMMENTED":
      return "commented";
    default:
      return "unknown";
  }
}

function normalizeReviewSummary(
  input: unknown,
): SourceControlChangeRequestReviewSnapshot["reviewSummary"] {
  const reviews = Array.isArray(input) ? input : [];
  let approvingReviewCount = 0;
  let changesRequestedReviewCount = 0;
  let commentedReviewCount = 0;

  for (const review of reviews) {
    if (!isRecord(review)) {
      continue;
    }
    switch (stringValue(review.state)?.toUpperCase()) {
      case "APPROVED":
        approvingReviewCount += 1;
        break;
      case "CHANGES_REQUESTED":
        changesRequestedReviewCount += 1;
        break;
      case "COMMENTED":
        commentedReviewCount += 1;
        break;
    }
  }

  return {
    approvingReviewCount,
    changesRequestedReviewCount,
    commentedReviewCount,
  };
}

function normalizeReviewState(input: unknown): SourceControlReviewCommentState {
  switch (stringValue(input)?.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    case "PENDING":
      return "pending";
    case "DISMISSED":
      return "dismissed";
    default:
      return "unknown";
  }
}

function normalizeCheckState(context: Record<string, unknown>): SourceControlCheckRollupState {
  const conclusion = stringValue(context.conclusion)?.toUpperCase() ?? null;
  const status = stringValue(context.status)?.toUpperCase() ?? null;
  const state = stringValue(context.state)?.toUpperCase() ?? null;

  if (["SUCCESS", "PASSED"].includes(conclusion ?? "") || state === "SUCCESS") {
    return "success";
  }
  if (
    ["FAILURE", "FAILED", "ERROR", "ACTION_REQUIRED", "TIMED_OUT", "CANCELLED"].includes(
      conclusion ?? "",
    ) ||
    ["FAILURE", "ERROR"].includes(state ?? "")
  ) {
    return "failure";
  }
  if (conclusion === "SKIPPED") {
    return "skipped";
  }
  if (conclusion === "NEUTRAL" || state === "NEUTRAL") {
    return "neutral";
  }
  if (
    ["QUEUED", "PENDING", "IN_PROGRESS", "REQUESTED", "WAITING", "EXPECTED"].includes(
      status ?? "",
    ) ||
    ["PENDING", "EXPECTED"].includes(state ?? "")
  ) {
    return "pending";
  }
  if (status === "COMPLETED") {
    return "neutral";
  }
  return "unknown";
}

function collectCheckContexts(value: unknown, contexts: Array<Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCheckContexts(entry, contexts);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if ("status" in value || "conclusion" in value || "state" in value) {
    contexts.push(value);
  }
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) {
      collectCheckContexts(child, contexts);
    }
  }
}

function normalizeCheckRollup(input: unknown): SourceControlChangeRequestReviewSnapshot["checks"] {
  const contexts: Array<Record<string, unknown>> = [];
  collectCheckContexts(input, contexts);

  let successCount = 0;
  let pendingCount = 0;
  let failureCount = 0;
  let skippedCount = 0;
  let neutralCount = 0;

  const items: SourceControlCheckRunSummary[] = [];

  for (const context of contexts) {
    const state = normalizeCheckState(context);
    const name =
      stringValue(context.name) ??
      stringValue(context.context) ??
      stringValue(context.workflowName) ??
      "Unnamed check";

    items.push({
      name,
      state,
      description:
        stringValue(context.description) ??
        stringValue(context.title) ??
        stringValue(context.summary) ??
        null,
      detailsUrl: stringValue(context.detailsUrl) ?? stringValue(context.targetUrl) ?? null,
      startedAt: optionalDateTimeValue(context.startedAt),
      completedAt: optionalDateTimeValue(context.completedAt),
      workflowName: stringValue(context.workflowName),
    });

    if (state === "success") {
      successCount += 1;
    } else if (state === "failure") {
      failureCount += 1;
    } else if (state === "skipped") {
      skippedCount += 1;
    } else if (state === "neutral") {
      neutralCount += 1;
    } else if (state === "pending") {
      pendingCount += 1;
    }
  }

  const totalCount = items.length;
  const state: SourceControlCheckRollupState =
    totalCount === 0
      ? "unknown"
      : failureCount > 0
        ? "failure"
        : pendingCount > 0
          ? "pending"
          : successCount > 0
            ? "success"
            : skippedCount > 0
              ? "skipped"
              : "neutral";

  return {
    state,
    totalCount,
    successCount,
    pendingCount,
    failureCount,
    skippedCount,
    items,
  };
}

function normalizePullRequestReviewBase(raw: unknown): PullRequestReviewBase | null {
  if (!isRecord(raw)) {
    return null;
  }
  const number = numberValue(raw.number);
  const title = stringValue(raw.title);
  const url = stringValue(raw.url);
  if (number === null || title === null || url === null || number < 1) {
    return null;
  }
  return {
    number,
    title,
    url,
    reviewDecision: normalizeReviewDecision(raw.reviewDecision),
    reviewSummary: normalizeReviewSummary(raw.reviews),
    checks: normalizeCheckRollup(raw.statusCheckRollup),
  };
}

function normalizeReviewComment(raw: unknown): SourceControlReviewComment | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = stringValue(raw.id);
  const url = stringValue(raw.url);
  if (id === null || url === null) {
    return null;
  }
  const author = isRecord(raw.author) ? stringValue(raw.author.login) : null;
  const review = isRecord(raw.pullRequestReview) ? raw.pullRequestReview : null;
  const body = typeof raw.body === "string" ? raw.body.slice(0, MAX_REVIEW_COMMENT_BODY_CHARS) : "";

  return {
    id,
    databaseId: numberValue(raw.databaseId),
    authorLogin: author,
    body,
    url,
    path: stringValue(raw.path),
    diffHunk: typeof raw.diffHunk === "string" ? raw.diffHunk : null,
    line: numberValue(raw.line),
    startLine: numberValue(raw.startLine),
    createdAt: dateTimeValue(raw.createdAt),
    updatedAt: dateTimeValue(raw.updatedAt),
    reviewState: normalizeReviewState(review?.state),
  };
}

function normalizeReviewThread(raw: unknown): SourceControlReviewThread | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = stringValue(raw.id);
  if (id === null) {
    return null;
  }
  const commentsContainer = isRecord(raw.comments) ? raw.comments : null;
  const nodes = Array.isArray(commentsContainer?.nodes) ? commentsContainer.nodes : [];
  const comments = nodes
    .map(normalizeReviewComment)
    .filter((comment): comment is SourceControlReviewComment => comment !== null);
  return {
    id,
    isResolved: raw.isResolved === true,
    isOutdated: raw.isOutdated === true,
    path: stringValue(raw.path),
    line: numberValue(raw.line),
    startLine: numberValue(raw.startLine),
    comments,
  };
}

function extractReviewThreadNodes(page: unknown): ReadonlyArray<unknown> {
  if (!isRecord(page)) {
    return [];
  }
  const repository =
    isRecord(page.data) && isRecord(page.data.repository) ? page.data.repository : null;
  const pullRequest =
    repository && isRecord(repository.pullRequest) ? repository.pullRequest : null;
  const reviewThreads =
    pullRequest && isRecord(pullRequest.reviewThreads) ? pullRequest.reviewThreads : null;
  return Array.isArray(reviewThreads?.nodes) ? reviewThreads.nodes : [];
}

export function decodeGitHubPullRequestReviewSnapshot(input: {
  readonly pullRequestJson: string;
  readonly reviewThreadsJson: string;
}): Result.Result<SourceControlChangeRequestReviewSnapshot, Cause.Cause<Schema.SchemaError>> {
  const pullRequestResult = decodeUnknownJson(input.pullRequestJson);
  if (!Result.isSuccess(pullRequestResult)) {
    return Result.fail(pullRequestResult.failure);
  }
  const pullRequest = normalizePullRequestReviewBase(pullRequestResult.success);
  if (pullRequest === null) {
    return Result.fail(
      Cause.die(new Error("GitHub CLI returned invalid pull request review JSON.")),
    );
  }

  const reviewThreadsResult = decodeUnknownJson(input.reviewThreadsJson);
  if (!Result.isSuccess(reviewThreadsResult)) {
    return Result.fail(reviewThreadsResult.failure);
  }

  const pages = Array.isArray(reviewThreadsResult.success)
    ? reviewThreadsResult.success
    : [reviewThreadsResult.success];
  let totalCommentCount = 0;
  let truncated = false;
  const threads: SourceControlReviewThread[] = [];

  for (const page of pages) {
    for (const node of extractReviewThreadNodes(page)) {
      const thread = normalizeReviewThread(node);
      if (thread === null) {
        continue;
      }
      const remaining = MAX_REVIEW_COMMENTS - totalCommentCount;
      if (remaining <= 0) {
        truncated = true;
        continue;
      }
      const comments = thread.comments.slice(0, remaining);
      if (comments.length < thread.comments.length) {
        truncated = true;
      }
      totalCommentCount += comments.length;
      threads.push({ ...thread, comments });
    }
  }

  const resolvedThreadCount = threads.filter((thread) => thread.isResolved).length;
  const unresolvedThreadCount = threads.length - resolvedThreadCount;
  const resolvedCommentCount = threads
    .filter((thread) => thread.isResolved)
    .reduce((count, thread) => count + thread.comments.length, 0);
  const unresolvedCommentCount = threads
    .filter((thread) => !thread.isResolved)
    .reduce((count, thread) => count + thread.comments.length, 0);

  return Result.succeed({
    provider: "github",
    ...pullRequest,
    threadCount: threads.length,
    resolvedThreadCount,
    unresolvedThreadCount,
    commentCount: resolvedCommentCount + unresolvedCommentCount,
    resolvedCommentCount,
    unresolvedCommentCount,
    threads,
    fetchedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
    truncated,
  });
}
