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
        "Set a review thread/comment to in_progress only when you actually start working on it",
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

  it("does not include outdated threads in unresolved review context", () => {
    const result = formatChangeRequestReviewContext({
      snapshot: {
        ...snapshot,
        threads: [
          ...snapshot.threads,
          {
            ...snapshot.threads[0]!,
            id: "outdated-thread",
            isOutdated: true,
            comments: [
              {
                ...snapshot.threads[0]!.comments[0]!,
                id: "outdated-comment",
                body: "This comment is outdated.",
              },
            ],
          },
        ],
      },
      mode: "all_unresolved",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toContain("Please fix this.");
      expect(result.markdown).not.toContain("This comment is outdated.");
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

  it("unwraps CodeRabbit markdown prompt details before sending review context", () => {
    const result = formatChangeRequestReviewContext({
      snapshot: {
        ...snapshot,
        threads: [
          {
            ...snapshot.threads[0]!,
            id: "PRRT_kwDORymRIM6DUZ4_",
            path: "packages/backend/convex/internalNotes.ts",
            line: 176,
            startLine: 164,
            comments: [
              {
                ...snapshot.threads[0]!.comments[0]!,
                id: "PRRC_kwDORymRIM7C68ak",
                body: [
                  "**Deduplication issue**",
                  "",
                  "<details>",
                  "<summary>Prompt for AI Agents</summary>",
                  "",
                  "```markdown",
                  "This is a comment left during a code review.",
                  "Path: packages/backend/convex/internalNotes.ts",
                  "Line: 164-176",
                  "",
                  "Comment:",
                  "Deduplicate createAuto using the same time window as create.",
                  "```",
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
      expect(result.markdown).toContain(
        '<review_comment reviewThreadId="PRRT_kwDORymRIM6DUZ4_" location="packages/backend/convex/internalNotes.ts:164-176">',
      );
      expect(result.markdown).toContain("Deduplicate createAuto");
      expect(result.markdown).not.toContain("```markdown");
      expect(result.markdown).not.toContain("This is a comment left during a code review.");
      expect(result.markdown).not.toContain("Path: packages/backend/convex/internalNotes.ts");
      expect(result.markdown).not.toContain("How can I resolve this?");
      expect(result.markdown).not.toContain("Deduplication issue");
    }
  });

  it("keeps noisy CodeRabbit comments compact", () => {
    const result = formatChangeRequestReviewContext({
      snapshot: {
        ...snapshot,
        threads: [
          {
            ...snapshot.threads[0]!,
            id: "PRRT_kwDORymRIM6DVGJV",
            path: "packages/backend/convex/payroll.ts",
            line: 348,
            startLine: 345,
            comments: [
              {
                ...snapshot.threads[0]!.comments[0]!,
                id: "PRRC_kwDORymRIM7C77mI",
                body: [
                  "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Read newest shifts before applying take(2000) cap**",
                  "",
                  "This scan takes the first 2000 rows from `by_projectId` and only then filters by the requested period.",
                  "",
                  "Useful? React with 👍 / 👎.",
                ].join("\n"),
              },
            ],
          },
          {
            ...snapshot.threads[0]!,
            id: "PRRT_kwDORymRIM6DVHLd",
            path: "apps/dashboard/components/payroll/payroll-export.ts",
            line: 58,
            startLine: 51,
            comments: [
              {
                ...snapshot.threads[0]!.comments[0]!,
                id: "PRRC_kwDORymRIM7C79EE",
                body: [
                  "Verify each finding against current code. Fix only still-valid issues, skip the",
                  "rest with a brief reason, keep changes minimal, and validate.",
                  "",
                  "In `@apps/dashboard/components/payroll/payroll-export.ts` around lines 51 - 58,",
                  "The csvEscape function is vulnerable to Excel formula injection.",
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
      expect(result.markdown).toContain(
        "For each comment, verify current code, fix only valid issues",
      );
      expect(result.markdown).toContain("**Read newest shifts before applying take(2000) cap**");
      expect(result.markdown).toContain(
        "The csvEscape function is vulnerable to Excel formula injection.",
      );
      expect(result.markdown).not.toContain("img.shields.io");
      expect(result.markdown).not.toContain("Useful? React");
      expect(result.markdown).not.toContain("Verify each finding against current code");
      expect(result.markdown).not.toContain("In `@apps/dashboard");
    }
  });

  it("adds compact retry context for repeated review attempts", () => {
    const result = formatChangeRequestReviewContext({
      snapshot,
      mode: "all_unresolved",
      reviewAttemptByThreadId: new Map([["unresolved-thread", { attemptNumber: 2 }]]),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toContain(
        "Addressing attempt: 2. This thread was already addressed before and is still unresolved; re-check current code before changing anything.",
      );
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

  it("extracts fenced CodeRabbit AI-agent prompt details as plain markdown", () => {
    expect(
      extractReviewBotPromptBlocks(
        [
          "<details>",
          "<summary>Prompt for AI Agents</summary>",
          "",
          "`````markdown",
          "This is a comment left during a code review.",
          "Path: packages/backend/convex/internalNotes.ts",
          "Line: 164-176",
          "",
          "Comment:",
          "Use the existing deduplication window.",
          "",
          "How can I resolve this? If you propose a fix, please make it concise.",
          "`````",
          "</details>",
        ].join("\n"),
      ),
    ).toEqual(["Use the existing deduplication window."]);
  });

  it("ignores generic details blocks", () => {
    expect(
      extractReviewBotPromptBlocks(
        "<details><summary>Implementation notes</summary>Not a prompt</details>",
      ),
    ).toEqual([]);
  });
});
