import {
  type SourceControlChangeRequestReviewSnapshot,
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { DiffIcon, MessageSquareTextIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { useGitStatus } from "../../lib/gitStatusState";
import { useChangeRequestReviewSnapshot } from "../../lib/changeRequestReviewState";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onOpenReviewSidebar: () => void;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export function resolveHeaderPullRequestReviewReference(input: {
  readonly pullRequest:
    | {
        readonly number: number;
        readonly state: string;
      }
    | null
    | undefined;
}): string | null {
  return input.pullRequest?.state === "open" ? String(input.pullRequest.number) : null;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onOpenReviewSidebar,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {showOpenInPicker && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        )}
        {activeProjectName ? (
          <PullRequestReviewHeaderControl
            environmentId={activeThreadEnvironmentId}
            cwd={gitCwd}
            onOpenReviewSidebar={onOpenReviewSidebar}
          />
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo && !diffOpen}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo && !diffOpen
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});

function reviewDecisionLabel(snapshot: SourceControlChangeRequestReviewSnapshot): string {
  return snapshot.reviewDecision.replaceAll("_", " ");
}

function checksLabel(snapshot: SourceControlChangeRequestReviewSnapshot): string {
  if (snapshot.checks.totalCount === 0) {
    return "checks unknown";
  }
  return `${snapshot.checks.state} checks`;
}

function reviewSummaryLabel(snapshot: SourceControlChangeRequestReviewSnapshot): string {
  if (snapshot.reviewSummary.changesRequestedReviewCount > 0) {
    return `${snapshot.reviewSummary.changesRequestedReviewCount} changes requested`;
  }
  if (snapshot.reviewSummary.approvingReviewCount > 0) {
    return `${snapshot.reviewSummary.approvingReviewCount} approval`;
  }
  return "no submitted reviews";
}

function PullRequestReviewHeaderControl({
  environmentId,
  cwd,
  onOpenReviewSidebar,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly onOpenReviewSidebar: () => void;
}) {
  const { data: gitStatus = null } = useGitStatus({
    environmentId,
    cwd,
  });
  const reviewReference = resolveHeaderPullRequestReviewReference({
    pullRequest: gitStatus?.pr,
  });
  const {
    data: snapshot,
    isLoading,
    error,
  } = useChangeRequestReviewSnapshot({
    environmentId,
    cwd,
    reference: reviewReference,
    enabled: reviewReference !== null,
  });

  if (reviewReference === null) {
    return null;
  }

  const tooltip = snapshot
    ? `#${snapshot.number}: ${snapshot.unresolvedCommentCount} unresolved, ${reviewSummaryLabel(
        snapshot,
      )}, ${reviewDecisionLabel(snapshot)}, ${checksLabel(snapshot)}`
    : error
      ? "Unable to load review comments"
      : "Loading review comments";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="gap-1.5 px-2 text-[10px]"
            onClick={onOpenReviewSidebar}
            aria-label={tooltip}
          >
            {isLoading && !snapshot ? (
              <Spinner className="size-3" />
            ) : (
              <MessageSquareTextIcon className="size-3" />
            )}
            <span>{snapshot ? snapshot.unresolvedCommentCount : "..."}</span>
            {snapshot ? (
              <span className="hidden @4xl/header-actions:inline">unresolved</span>
            ) : null}
          </Button>
        }
      />
      <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
