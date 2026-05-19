import { describe, expect, it } from "vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  SourceControlChangeRequestReviewSnapshot,
  SourceControlChangeRequestReviewStreamEvent,
} from "./sourceControl.ts";

const decodeSnapshot = Schema.decodeUnknownSync(SourceControlChangeRequestReviewSnapshot);
const decodeStreamEvent = Schema.decodeUnknownSync(SourceControlChangeRequestReviewStreamEvent);

const snapshot = {
  provider: "github",
  number: 42,
  title: "Review agent work",
  url: "https://github.com/acme/repo/pull/42",
  reviewDecision: "changes_requested",
  reviewSummary: {
    approvingReviewCount: 1,
    changesRequestedReviewCount: 1,
    commentedReviewCount: 0,
  },
  checks: {
    state: "pending",
    totalCount: 2,
    successCount: 1,
    pendingCount: 1,
    failureCount: 0,
    skippedCount: 0,
    items: [
      {
        name: "GrepTile Review",
        state: "pending",
        description: "Started 1 minute ago",
        detailsUrl: "https://github.com/acme/repo/actions/runs/1",
        startedAt: DateTime.makeUnsafe("2026-05-19T00:00:00.000Z"),
        completedAt: null,
        workflowName: "GrepTile Review",
      },
    ],
  },
  threadCount: 1,
  resolvedThreadCount: 0,
  unresolvedThreadCount: 1,
  commentCount: 1,
  resolvedCommentCount: 0,
  unresolvedCommentCount: 1,
  threads: [
    {
      id: "PRRT_1",
      isResolved: false,
      isOutdated: false,
      path: "src/app.ts",
      line: 12,
      startLine: null,
      comments: [
        {
          id: "PRRC_1",
          databaseId: 123,
          authorLogin: "reviewer",
          body: "Please fix this.",
          url: "https://github.com/acme/repo/pull/42#discussion_r123",
          path: "src/app.ts",
          diffHunk: "@@ -1 +1 @@",
          line: 12,
          startLine: null,
          createdAt: DateTime.makeUnsafe("2026-05-19T00:00:00.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-05-19T00:00:00.000Z"),
          reviewState: "changes_requested",
        },
      ],
    },
  ],
  fetchedAt: DateTime.makeUnsafe("2026-05-19T00:00:00.000Z"),
  truncated: false,
};

describe("SourceControlChangeRequestReviewSnapshot", () => {
  it("decodes a valid review snapshot", () => {
    expect(decodeSnapshot(snapshot).unresolvedCommentCount).toBe(1);
  });

  it("rejects negative counts", () => {
    expect(() => decodeSnapshot({ ...snapshot, commentCount: -1 })).toThrow();
  });
});

describe("SourceControlChangeRequestReviewStreamEvent", () => {
  it("decodes snapshot and update stream events", () => {
    expect(decodeStreamEvent({ _tag: "snapshot", snapshot })._tag).toBe("snapshot");
    expect(decodeStreamEvent({ _tag: "updated", snapshot })._tag).toBe("updated");
  });
});
