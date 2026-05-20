import type {
  SourceControlChangeRequestReviewSnapshot,
  SourceControlReviewComment,
  SourceControlReviewThread,
} from "@t3tools/contracts";

export type ChangeRequestReviewContextMode = "selected" | "all_unresolved" | "all";

export interface FormatChangeRequestReviewContextInput {
  readonly snapshot: SourceControlChangeRequestReviewSnapshot;
  readonly selectedThreadIds?: ReadonlyArray<string>;
  readonly selectedCommentIds?: ReadonlyArray<string>;
  readonly reviewAttemptByThreadId?: ReadonlyMap<string, ReviewAttemptContext>;
  readonly mode: ChangeRequestReviewContextMode;
}

export interface ReviewAttemptContext {
  readonly attemptNumber: number;
}

export interface FormatChangeRequestReviewContextResult {
  readonly ok: true;
  readonly markdown: string;
  readonly includedCommentCount: number;
}

export interface FormatChangeRequestReviewContextError {
  readonly ok: false;
  readonly message: string;
}

function formatThreadLocation(thread: SourceControlReviewThread): string {
  const path = thread.path ?? "unknown file";
  if (thread.startLine !== null && thread.line !== null && thread.startLine !== thread.line) {
    return `${path}:${thread.startLine}-${thread.line}`;
  }
  if (thread.line !== null) {
    return `${path}:${thread.line}`;
  }
  return path;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function normalizeSummaryText(value: string): string {
  return decodeBasicHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isReviewBotPromptSummary(summary: string): boolean {
  const normalized = normalizeSummaryText(summary);
  return (
    /\bprompt\b/.test(normalized) &&
    (/\bfix\b/.test(normalized) ||
      /\bai\b/.test(normalized) ||
      /\bagents?\b/.test(normalized) ||
      /\bclaude\b/.test(normalized) ||
      /\bcodex\b/.test(normalized) ||
      /\bresolve\b/.test(normalized))
  );
}

function unwrapMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = /^(`{3,}|~{3,})(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/i.exec(trimmed);
  return match ? match[2]!.trim() : trimmed;
}

function stripPromptEnvelope(value: string): string {
  const lines = value.trim().split(/\r?\n/);
  if (lines[0]?.trim() === "This is a comment left during a code review.") {
    lines.shift();
  }
  if (/^Path:\s+/.test(lines[0]?.trim() ?? "")) {
    lines.shift();
  }
  if (/^Line:\s+/.test(lines[0]?.trim() ?? "")) {
    lines.shift();
  }
  while (lines[0]?.trim() === "") {
    lines.shift();
  }
  if (lines[0]?.trim() === "Comment:") {
    lines.shift();
  }
  while (lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.at(-1)?.trim() === "") {
    lines.pop();
  }
  if (
    lines.at(-1)?.trim() === "How can I resolve this? If you propose a fix, please make it concise."
  ) {
    lines.pop();
  }
  return lines.join("\n").trim();
}

function stripReviewBotBoilerplate(value: string): string {
  return stripPromptEnvelope(value)
    .replace(
      /^Verify each finding against current code\.\s+Fix only still-valid issues,\s+skip the\s+rest with a brief reason,\s+keep changes minimal,\s+and validate\.\s*/i,
      "",
    )
    .replace(/^In\s+`?@?[^`\n]+`?\s+around\s+lines?\s+\d+\s*(?:-\s*\d+)?\s*,\s*/i, "")
    .replaceAll(/<sub><sub>!\[[^\]]* Badge\]\([^)]+\)<\/sub><\/sub>\s*/gi, "")
    .replaceAll(/^\s*Useful\?\s*React with[^\n]*$/gimu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractReviewBotPromptBlocks(body: string): ReadonlyArray<string> {
  const blocks: string[] = [];
  const detailsPattern = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;

  for (const match of body.matchAll(detailsPattern)) {
    const detailsBody = match[1] ?? "";
    const summaryMatch = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(detailsBody);
    if (!summaryMatch || !isReviewBotPromptSummary(summaryMatch[1] ?? "")) {
      continue;
    }

    const summaryEndIndex = summaryMatch.index + summaryMatch[0].length;
    const promptBody = detailsBody.slice(summaryEndIndex).trim();
    if (promptBody.length > 0) {
      blocks.push(stripReviewBotBoilerplate(unwrapMarkdownFence(promptBody)));
    }
  }

  return blocks;
}

function selectThreads(
  input: FormatChangeRequestReviewContextInput,
): ReadonlyArray<SourceControlReviewThread> {
  const threadIds = new Set(input.selectedThreadIds ?? []);
  const commentIds = new Set(input.selectedCommentIds ?? []);
  const selected: SourceControlReviewThread[] = [];

  for (const thread of input.snapshot.threads) {
    const includeThread =
      input.mode === "all" ||
      (input.mode === "all_unresolved" && isActionableReviewThread(thread)) ||
      (input.mode === "selected" && threadIds.has(thread.id));
    const comments = thread.comments.filter((comment) => {
      if (input.mode === "selected" && commentIds.size > 0) {
        return commentIds.has(comment.id);
      }
      return includeThread;
    });
    if (comments.length > 0) {
      selected.push({ ...thread, comments });
    }
  }

  return selected.toSorted(
    (left, right) =>
      Number(!isActionableReviewThread(left)) - Number(!isActionableReviewThread(right)),
  );
}

function isActionableReviewThread(thread: SourceControlReviewThread): boolean {
  return !thread.isResolved && !thread.isOutdated;
}

function formatComment(comment: SourceControlReviewComment): string {
  const promptBlocks = extractReviewBotPromptBlocks(comment.body);
  const body =
    promptBlocks.length > 0
      ? promptBlocks.join("\n\n---\n\n")
      : comment.body.trim().length > 0
        ? stripReviewBotBoilerplate(unwrapMarkdownFence(comment.body))
        : "(empty)";
  return body;
}

export function formatChangeRequestReviewContext(
  input: FormatChangeRequestReviewContextInput,
): FormatChangeRequestReviewContextResult | FormatChangeRequestReviewContextError {
  const threads = selectThreads(input);
  const includedCommentCount = threads.reduce((count, thread) => count + thread.comments.length, 0);

  if (includedCommentCount === 0) {
    return {
      ok: false,
      message: "Select at least one review comment before sending review context.",
    };
  }

  const snapshot = input.snapshot;
  const lines = [
    "Follow the pull request review workflow instructions from the system prompt.",
    "For each comment, verify current code, fix only valid issues, skip invalid findings with a brief reason, keep changes minimal, and validate.",
    "These comments are queued for you now. Set a review thread/comment to in_progress only when you actually start working on it, not all queued comments at once; set it to done when your local changes for it are complete.",
  ];

  if (snapshot.truncated) {
    lines.push("", "Only part of the review snapshot was included.");
  }

  for (const thread of threads) {
    const attempt = input.reviewAttemptByThreadId?.get(thread.id) ?? null;
    lines.push(
      "",
      `<review_comment reviewThreadId="${escapeAttribute(thread.id)}" location="${escapeAttribute(formatThreadLocation(thread))}">`,
    );
    if (attempt !== null && attempt.attemptNumber > 1) {
      lines.push(
        `Addressing attempt: ${attempt.attemptNumber}. This thread was already addressed before and is still unresolved; re-check current code before changing anything.`,
      );
    }
    for (let index = 0; index < thread.comments.length; index += 1) {
      const comment = thread.comments[index]!;
      if (thread.comments.length > 1 && index > 0) {
        lines.push("", "---", "");
      }
      lines.push(
        `<comment commentId="${escapeAttribute(comment.id)}">`,
        formatComment(comment),
        "</comment>",
      );
    }
    lines.push("</review_comment>");
  }

  return {
    ok: true,
    markdown: lines.join("\n").trimEnd(),
    includedCommentCount,
  };
}
