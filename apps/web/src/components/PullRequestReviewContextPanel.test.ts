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

  it("moves ready-to-push statuses to addressed after a successful push", () => {
    const result = buildReviewCommentWorkflowStatuses(
      [
        activity({
          id: "activity-1",
          input: {
            reviewThreadId: "thread-1",
            commentId: "comment-1",
            status: "ready_to_push",
            note: "Patch is ready",
          },
          createdAt: "2026-05-19T00:01:00.000Z",
        }),
      ],
      { readyToPushResetAt: "2026-05-19T00:02:00.000Z" },
    );

    expect(result.byThreadId.get("thread-1")).toMatchObject({
      status: "addressed",
      note: "Pushed; waiting for review resolution.",
      updatedAt: "2026-05-19T00:02:00.000Z",
    });
    expect(result.byCommentId.get("comment-1")).toMatchObject({
      status: "addressed",
      note: "Pushed; waiting for review resolution.",
      updatedAt: "2026-05-19T00:02:00.000Z",
    });
  });

  it("keeps done during the active turn and promotes it to ready-for-push after the turn", () => {
    const activities = [
      activity({
        id: "activity-1",
        input: {
          reviewThreadId: "thread-1",
          commentId: "comment-1",
          status: "done",
          note: "Patched locally",
        },
        createdAt: "2026-05-19T00:01:00.000Z",
      }),
    ];

    expect(
      buildReviewCommentWorkflowStatuses(activities, { turnInProgress: true }).byThreadId.get(
        "thread-1",
      ),
    ).toMatchObject({
      status: "done",
      note: "Patched locally",
    });
    expect(
      buildReviewCommentWorkflowStatuses(activities, { turnInProgress: false }).byThreadId.get(
        "thread-1",
      ),
    ).toMatchObject({
      status: "ready_to_push",
      note: "Patched locally",
    });
  });

  it("counts repeated addressing attempts from in-progress transitions", () => {
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
        },
        createdAt: "2026-05-19T00:01:00.000Z",
      }),
      activity({
        id: "activity-3",
        input: {
          reviewThreadId: "thread-1",
          commentId: "comment-1",
          status: "in_progress",
        },
        createdAt: "2026-05-19T00:02:00.000Z",
      }),
    ]);

    expect(result.byThreadId.get("thread-1")).toMatchObject({
      status: "in_progress",
      attemptCount: 2,
    });
    expect(result.byCommentId.get("comment-1")).toMatchObject({
      status: "in_progress",
      attemptCount: 2,
    });
  });

  it("overlays queued status until the agent reports work has started", () => {
    const queuedOnly = buildReviewCommentWorkflowStatuses([], {
      queuedThreadIds: new Set(["thread-1"]),
      turnInProgress: true,
    });
    expect(queuedOnly.byThreadId.get("thread-1")).toMatchObject({
      status: "queued",
      attemptCount: 1,
    });

    const started = buildReviewCommentWorkflowStatuses(
      [
        activity({
          id: "activity-1",
          input: {
            reviewThreadId: "thread-1",
            status: "in_progress",
          },
        }),
      ],
      { queuedThreadIds: new Set(["thread-1"]), turnInProgress: true },
    );
    expect(started.byThreadId.get("thread-1")).toMatchObject({
      status: "in_progress",
      attemptCount: 1,
    });
  });

  it("marks queued comments ignored after the agent turn ends without taking them", () => {
    const activities = [
      activity({
        id: "activity-1",
        input: {
          reviewThreadId: "thread-1",
          status: "queued",
        },
        createdAt: "2026-05-19T00:00:00.000Z",
      }),
    ];

    expect(
      buildReviewCommentWorkflowStatuses(activities, { turnInProgress: true }).byThreadId.get(
        "thread-1",
      ),
    ).toMatchObject({
      status: "queued",
      attemptCount: 1,
    });
    expect(
      buildReviewCommentWorkflowStatuses(activities, { turnInProgress: false }).byThreadId.get(
        "thread-1",
      ),
    ).toMatchObject({
      status: "ignored",
      attemptCount: 1,
    });
  });

  it("allows an addressed thread to be queued for another attempt", () => {
    const result = buildReviewCommentWorkflowStatuses(
      [
        activity({
          id: "activity-1",
          input: {
            reviewThreadId: "thread-1",
            status: "in_progress",
          },
          createdAt: "2026-05-19T00:00:00.000Z",
        }),
        activity({
          id: "activity-2",
          input: {
            reviewThreadId: "thread-1",
            status: "ready_to_push",
          },
          createdAt: "2026-05-19T00:01:00.000Z",
        }),
      ],
      {
        readyToPushResetAt: "2026-05-19T00:02:00.000Z",
        queuedThreadIds: new Set(["thread-1"]),
        turnInProgress: true,
      },
    );

    expect(result.byThreadId.get("thread-1")).toMatchObject({
      status: "queued",
      attemptCount: 2,
    });
  });

  it("keeps ready-to-push statuses set after the latest push", () => {
    const result = buildReviewCommentWorkflowStatuses(
      [
        activity({
          id: "activity-1",
          input: {
            reviewThreadId: "thread-1",
            commentId: "comment-1",
            status: "ready_to_push",
          },
          createdAt: "2026-05-19T00:03:00.000Z",
        }),
      ],
      { readyToPushResetAt: "2026-05-19T00:02:00.000Z" },
    );

    expect(result.byThreadId.get("thread-1")).toMatchObject({
      status: "ready_to_push",
    });
    expect(result.byCommentId.get("comment-1")).toMatchObject({
      status: "ready_to_push",
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
