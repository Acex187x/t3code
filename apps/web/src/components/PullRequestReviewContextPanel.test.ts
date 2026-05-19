import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildReviewCommentWorkflowStatuses } from "./PullRequestReviewContextPanel";

function activity(
  input: Omit<Partial<OrchestrationThreadActivity>, "id"> & {
    readonly id?: string;
    readonly input?: Record<string, unknown>;
  },
): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id ?? "activity-1"),
    tone: "tool",
    kind: input.kind ?? "tool.updated",
    summary: input.summary ?? "Review comment status",
    payload:
      input.payload ??
      ({
        data: {
          toolName: "set_review_comment_status",
          input: input.input,
        },
      } satisfies unknown),
    turnId: input.turnId ?? TurnId.make("turn-1"),
    createdAt: input.createdAt ?? "2026-05-19T00:00:00.000Z",
  };
}

describe("buildReviewCommentWorkflowStatuses", () => {
  it("keeps the latest workflow status by review thread and comment", () => {
    const result = buildReviewCommentWorkflowStatuses([
      activity({
        id: "activity-1",
        input: {
          reviewThreadId: "thread-1",
          commentId: "comment-1",
          status: "in_progress",
        },
        createdAt: "2026-05-19T00:00:00.000Z",
      }),
      activity({
        id: "activity-2",
        input: {
          reviewThreadId: "thread-1",
          commentId: "comment-1",
          status: "ready_to_push",
          note: "Patch is ready",
        },
        createdAt: "2026-05-19T00:01:00.000Z",
      }),
    ]);

    expect(result.byThreadId.get("thread-1")).toMatchObject({
      status: "ready_to_push",
      note: "Patch is ready",
    });
    expect(result.byCommentId.get("comment-1")).toMatchObject({
      status: "ready_to_push",
      note: "Patch is ready",
    });
  });

  it("ignores unrelated tool activities", () => {
    const result = buildReviewCommentWorkflowStatuses([
      activity({
        input: {
          reviewThreadId: "thread-1",
          status: "in_progress",
        },
        payload: {
          data: {
            toolName: "Bash",
            input: {
              reviewThreadId: "thread-1",
              status: "in_progress",
            },
          },
        },
      }),
    ]);

    expect(result.byThreadId.size).toBe(0);
    expect(result.byCommentId.size).toBe(0);
  });
});
