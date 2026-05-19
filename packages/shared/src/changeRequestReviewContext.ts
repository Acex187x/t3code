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
  readonly mode: ChangeRequestReviewContextMode;
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
      /\bcodex\b/.test(normalized))
  );
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
      blocks.push(promptBody);
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
      (input.mode === "all_unresolved" && !thread.isResolved) ||
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

  return selected.toSorted((left, right) => Number(left.isResolved) - Number(right.isResolved));
}

function formatComment(comment: SourceControlReviewComment): string {
  const promptBlocks = extractReviewBotPromptBlocks(comment.body);
  const body =
    promptBlocks.length > 0
      ? promptBlocks.join("\n\n---\n\n")
      : comment.body.trim().length > 0
        ? comment.body.trim()
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
  const lines = ["Follow the pull request review workflow instructions from the system prompt."];

  if (snapshot.truncated) {
    lines.push("", "Only part of the review snapshot was included.");
  }

  for (const thread of threads) {
    lines.push(
      "",
      `<review_comment reviewThreadId="${escapeAttribute(thread.id)}" location="${escapeAttribute(formatThreadLocation(thread))}">`,
    );
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
