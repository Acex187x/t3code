import { describe, expect, it } from "vitest";
import * as DateTime from "effect/DateTime";
import type { SourceControlChangeRequestReviewSnapshot } from "@t3tools/contracts";

import {
  extractReviewBotPromptBlocks,
  formatChangeRequestReviewContext,
} from "./changeRequestReviewContext.ts";

const snapshot: SourceControlChangeRequestReviewSnapshot = {
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
      {
        name: "Vercel",
        state: "success",
        description: "Deployment has completed",
        detailsUrl: "https://vercel.com/acme/repo",
        startedAt: null,
        completedAt: DateTime.makeUnsafe("2026-05-19T00:01:00.000Z"),
        workflowName: null,
      },
    ],
  },
  threadCount: 2,
  resolvedThreadCount: 1,
  unresolvedThreadCount: 1,
  commentCount: 2,
  resolvedCommentCount: 1,
  unresolvedCommentCount: 1,
  threads: [
    {
      id: "unresolved-thread",
      isResolved: false,
      isOutdated: false,
      path: "src/app.ts",
      line: 12,
      startLine: null,
      comments: [
        {
          id: "unresolved-comment",
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
    {
      id: "resolved-thread",
      isResolved: true,
      isOutdated: false,
      path: "src/done.ts",
      line: 5,
      startLine: null,
      comments: [
        {
          id: "resolved-comment",
          databaseId: 124,
          authorLogin: "reviewer",
          body: "Already done.",
          url: "https://github.com/acme/repo/pull/42#discussion_r124",
          path: "src/done.ts",
          diffHunk: null,
          line: 5,
          startLine: null,
          createdAt: DateTime.makeUnsafe("2026-05-19T00:00:00.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-05-19T00:00:00.000Z"),
          reviewState: "commented",
        },
      ],
    },
  ],
  fetchedAt: DateTime.makeUnsafe("2026-05-19T00:00:00.000Z"),
  truncated: false,
};

describe("formatChangeRequestReviewContext", () => {
  it("includes unresolved comments by default", () => {
    const result = formatChangeRequestReviewContext({ snapshot, mode: "all_unresolved" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.includedCommentCount).toBe(1);
      expect(result.markdown).toContain("Please fix this.");
      expect(result.markdown).toContain(
        "Follow the pull request review workflow instructions from the system prompt.",
      );
      expect(result.markdown).toContain(
        '<review_comment reviewThreadId="unresolved-thread" location="src/app.ts:12">',
      );
      expect(result.markdown).toContain('<comment commentId="unresolved-comment">');
      expect(result.markdown).not.toContain("Already done.");
      expect(result.markdown).not.toContain("PR: #42");
      expect(result.markdown).not.toContain("Checks:");
      expect(result.markdown).not.toContain("@@ -1 +1 @@");
    }
  });

  it("includes selected resolved comments", () => {
    const result = formatChangeRequestReviewContext({
      snapshot,
      mode: "selected",
      selectedThreadIds: ["resolved-thread"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toContain("Already done.");
      expect(result.markdown).toContain(
        '<review_comment reviewThreadId="resolved-thread" location="src/done.ts:5">',
      );
    }
  });

  it("returns a validation error for empty selection", () => {
    const result = formatChangeRequestReviewContext({
      snapshot,
      mode: "selected",
      selectedThreadIds: [],
    });
    expect(result.ok).toBe(false);
  });

  it("sends only review bot prompt details when a selected comment contains one", () => {
    const result = formatChangeRequestReviewContext({
      snapshot: {
        ...snapshot,
        threads: [
          {
            ...snapshot.threads[0]!,
            comments: [
              {
                ...snapshot.threads[0]!.comments[0]!,
                body: [
                  "**Visible review summary**",
                  "",
                  "This prose should stay in the rendered comment, but not in the model prompt.",
                  "",
                  "<details><summary>Prompt To Fix With AI</summary>",
                  "",
                  "This is a comment left during a code review.",
                  "Path: src/app.ts",
                  "Line: 12",
                  "",
                  "Comment:",
                  "Fix the duplicated hook.",
                  "",
                  "</details>",
                ].join("\n"),
              },
            ],
          },
        ],
      },
      mode: "all_unresolved",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toContain("Fix the duplicated hook.");
      expect(result.markdown).not.toContain("Visible review summary");
      expect(result.markdown).not.toContain("This prose should stay");
    }
  });
});

describe("extractReviewBotPromptBlocks", () => {
  it("extracts prompt-oriented GitHub details blocks", () => {
    expect(
      extractReviewBotPromptBlocks(
        [
          "<details>",
          "<summary><strong>Prompt To Fix With AI</strong></summary>",
          "",
          "Prompt payload",
          "</details>",
        ].join("\n"),
      ),
    ).toEqual(["Prompt payload"]);
  });

  it("ignores generic details blocks", () => {
    expect(
      extractReviewBotPromptBlocks(
        "<details><summary>Implementation notes</summary>Not a prompt</details>",
      ),
    ).toEqual([]);
  });
});
