import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { VcsDriverKind } from "./vcs.ts";

export const SourceControlProviderKind = Schema.Literals([
  "github",
  "gitlab",
  "azure-devops",
  "bitbucket",
  "unknown",
]);
export type SourceControlProviderKind = typeof SourceControlProviderKind.Type;

export const SourceControlProviderInfo = Schema.Struct({
  kind: SourceControlProviderKind,
  name: TrimmedNonEmptyString,
  baseUrl: Schema.String,
});
export type SourceControlProviderInfo = typeof SourceControlProviderInfo.Type;

export const ChangeRequestState = Schema.Literals(["open", "closed", "merged"]);
export type ChangeRequestState = typeof ChangeRequestState.Type;

export const SourceControlCheckRollupState = Schema.Literals([
  "success",
  "pending",
  "failure",
  "neutral",
  "skipped",
  "unknown",
]);
export type SourceControlCheckRollupState = typeof SourceControlCheckRollupState.Type;

export const ChangeRequest = Schema.Struct({
  provider: SourceControlProviderKind,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: ChangeRequestState,
  updatedAt: Schema.Option(Schema.DateTimeUtc),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepositoryNameWithOwner: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  headRepositoryOwnerLogin: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  checkRollupState: Schema.optional(SourceControlCheckRollupState),
});
export type ChangeRequest = typeof ChangeRequest.Type;

export const SourceControlRepositoryCloneUrls = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
export type SourceControlRepositoryCloneUrls = typeof SourceControlRepositoryCloneUrls.Type;

export const SourceControlRepositoryVisibility = Schema.Literals(["private", "public"]);
export type SourceControlRepositoryVisibility = typeof SourceControlRepositoryVisibility.Type;

export const SourceControlCloneProtocol = Schema.Literals(["auto", "ssh", "https"]);
export type SourceControlCloneProtocol = typeof SourceControlCloneProtocol.Type;

export const SourceControlRepositoryInfo = Schema.Struct({
  provider: SourceControlProviderKind,
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
export type SourceControlRepositoryInfo = typeof SourceControlRepositoryInfo.Type;

export const SourceControlRepositoryLookupInput = Schema.Struct({
  provider: SourceControlProviderKind,
  repository: TrimmedNonEmptyString,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type SourceControlRepositoryLookupInput = typeof SourceControlRepositoryLookupInput.Type;

export const SourceControlCloneRepositoryInput = Schema.Struct({
  provider: Schema.optional(SourceControlProviderKind),
  repository: Schema.optional(TrimmedNonEmptyString),
  remoteUrl: Schema.optional(TrimmedNonEmptyString),
  destinationPath: TrimmedNonEmptyString,
  protocol: Schema.optional(SourceControlCloneProtocol),
});
export type SourceControlCloneRepositoryInput = typeof SourceControlCloneRepositoryInput.Type;

export const SourceControlCloneRepositoryResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
  repository: Schema.NullOr(SourceControlRepositoryInfo),
});
export type SourceControlCloneRepositoryResult = typeof SourceControlCloneRepositoryResult.Type;

export const SourceControlPublishRepositoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  provider: SourceControlProviderKind,
  repository: TrimmedNonEmptyString,
  visibility: SourceControlRepositoryVisibility,
  remoteName: Schema.optional(TrimmedNonEmptyString),
  protocol: Schema.optional(SourceControlCloneProtocol),
});
export type SourceControlPublishRepositoryInput = typeof SourceControlPublishRepositoryInput.Type;

export const SourceControlPublishStatus = Schema.Literals(["pushed", "remote_added"]);
export type SourceControlPublishStatus = typeof SourceControlPublishStatus.Type;

export const SourceControlPublishRepositoryResult = Schema.Struct({
  repository: SourceControlRepositoryInfo,
  remoteName: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  upstreamBranch: Schema.optional(TrimmedNonEmptyString),
  status: SourceControlPublishStatus,
});
export type SourceControlPublishRepositoryResult = typeof SourceControlPublishRepositoryResult.Type;

export const SourceControlChangeRequestReviewState = Schema.Literals([
  "approved",
  "changes_requested",
  "review_required",
  "commented",
  "unknown",
]);
export type SourceControlChangeRequestReviewState =
  typeof SourceControlChangeRequestReviewState.Type;

export const SourceControlReviewCommentState = Schema.Literals([
  "approved",
  "changes_requested",
  "commented",
  "pending",
  "dismissed",
  "unknown",
]);
export type SourceControlReviewCommentState = typeof SourceControlReviewCommentState.Type;

export const SourceControlReviewComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  databaseId: Schema.NullOr(NonNegativeInt),
  authorLogin: Schema.NullOr(TrimmedNonEmptyString),
  body: Schema.String,
  url: Schema.String,
  path: Schema.NullOr(TrimmedNonEmptyString),
  diffHunk: Schema.NullOr(Schema.String),
  line: Schema.NullOr(NonNegativeInt),
  startLine: Schema.NullOr(NonNegativeInt),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  reviewState: SourceControlReviewCommentState,
});
export type SourceControlReviewComment = typeof SourceControlReviewComment.Type;

export const SourceControlReviewThread = Schema.Struct({
  id: TrimmedNonEmptyString,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  path: Schema.NullOr(TrimmedNonEmptyString),
  line: Schema.NullOr(NonNegativeInt),
  startLine: Schema.NullOr(NonNegativeInt),
  comments: Schema.Array(SourceControlReviewComment),
});
export type SourceControlReviewThread = typeof SourceControlReviewThread.Type;

export const SourceControlCheckRunSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  state: SourceControlCheckRollupState,
  description: Schema.NullOr(Schema.String),
  detailsUrl: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.DateTimeUtc),
  completedAt: Schema.NullOr(Schema.DateTimeUtc),
  workflowName: Schema.NullOr(TrimmedNonEmptyString),
});
export type SourceControlCheckRunSummary = typeof SourceControlCheckRunSummary.Type;

export const SourceControlChecksSummary = Schema.Struct({
  state: SourceControlCheckRollupState,
  totalCount: NonNegativeInt,
  successCount: NonNegativeInt,
  pendingCount: NonNegativeInt,
  failureCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
  items: Schema.Array(SourceControlCheckRunSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type SourceControlChecksSummary = typeof SourceControlChecksSummary.Type;

export const SourceControlReviewSummary = Schema.Struct({
  approvingReviewCount: NonNegativeInt,
  changesRequestedReviewCount: NonNegativeInt,
  commentedReviewCount: NonNegativeInt,
}).pipe(
  Schema.withDecodingDefault(
    Effect.succeed({
      approvingReviewCount: 0,
      changesRequestedReviewCount: 0,
      commentedReviewCount: 0,
    }),
  ),
);
export type SourceControlReviewSummary = typeof SourceControlReviewSummary.Type;

export const SourceControlChangeRequestReviewSnapshot = Schema.Struct({
  provider: SourceControlProviderKind,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  reviewDecision: SourceControlChangeRequestReviewState,
  reviewSummary: SourceControlReviewSummary,
  checks: SourceControlChecksSummary,
  threadCount: NonNegativeInt,
  resolvedThreadCount: NonNegativeInt,
  unresolvedThreadCount: NonNegativeInt,
  commentCount: NonNegativeInt,
  resolvedCommentCount: NonNegativeInt,
  unresolvedCommentCount: NonNegativeInt,
  threads: Schema.Array(SourceControlReviewThread),
  fetchedAt: Schema.DateTimeUtc,
  truncated: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type SourceControlChangeRequestReviewSnapshot =
  typeof SourceControlChangeRequestReviewSnapshot.Type;

export const SourceControlChangeRequestReviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
});
export type SourceControlChangeRequestReviewInput =
  typeof SourceControlChangeRequestReviewInput.Type;

export const SourceControlChangeRequestReviewStreamEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", {
    snapshot: SourceControlChangeRequestReviewSnapshot,
  }),
  Schema.TaggedStruct("updated", {
    snapshot: SourceControlChangeRequestReviewSnapshot,
  }),
]);
export type SourceControlChangeRequestReviewStreamEvent =
  typeof SourceControlChangeRequestReviewStreamEvent.Type;

export const SourceControlDiscoveryStatus = Schema.Literals(["available", "missing"]);
export type SourceControlDiscoveryStatus = typeof SourceControlDiscoveryStatus.Type;

export const SourceControlProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type SourceControlProviderAuthStatus = typeof SourceControlProviderAuthStatus.Type;

export const SourceControlProviderAuth = Schema.Struct({
  status: SourceControlProviderAuthStatus,
  account: Schema.Option(TrimmedNonEmptyString),
  host: Schema.Option(TrimmedNonEmptyString),
  detail: Schema.Option(TrimmedNonEmptyString),
});
export type SourceControlProviderAuth = typeof SourceControlProviderAuth.Type;

const SourceControlDiscoverySharedFields = {
  label: TrimmedNonEmptyString,
  executable: Schema.optional(TrimmedNonEmptyString),
  status: SourceControlDiscoveryStatus,
  version: Schema.Option(TrimmedNonEmptyString),
  installHint: TrimmedNonEmptyString,
  detail: Schema.Option(TrimmedNonEmptyString),
} as const;

export const VcsDiscoveryItem = Schema.Struct({
  kind: VcsDriverKind,
  implemented: Schema.Boolean,
  ...SourceControlDiscoverySharedFields,
});
export type VcsDiscoveryItem = typeof VcsDiscoveryItem.Type;

export const SourceControlProviderDiscoveryItem = Schema.Struct({
  kind: SourceControlProviderKind,
  ...SourceControlDiscoverySharedFields,
  auth: SourceControlProviderAuth,
});
export type SourceControlProviderDiscoveryItem = typeof SourceControlProviderDiscoveryItem.Type;

export const SourceControlDiscoveryResult = Schema.Struct({
  versionControlSystems: Schema.Array(VcsDiscoveryItem),
  sourceControlProviders: Schema.Array(SourceControlProviderDiscoveryItem),
});
export type SourceControlDiscoveryResult = typeof SourceControlDiscoveryResult.Type;

export class SourceControlProviderError extends Schema.TaggedErrorClass<SourceControlProviderError>()(
  "SourceControlProviderError",
  {
    provider: SourceControlProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Source control provider ${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}

export class SourceControlRepositoryError extends Schema.TaggedErrorClass<SourceControlRepositoryError>()(
  "SourceControlRepositoryError",
  {
    provider: SourceControlProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Source control repository operation ${this.operation} failed for ${this.provider}: ${this.detail}`;
  }
}
