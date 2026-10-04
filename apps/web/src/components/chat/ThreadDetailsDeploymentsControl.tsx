/**
 * The thread details panel's deployments row, shaped like "Open in editor" beside it: the
 * primary half opens the newest deployment that is up, the chevron lists every deployment the
 * pull request carries. A row of its own rather than a segment of the pull request row, because
 * a deployment is somewhere to go, not a fact about the pull request.
 *
 * The detail is the same read the pull request row makes; the deployments are read on request
 * once it says the host keeps them and the pull request is still open.
 */
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestDeployment,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";
import { ChevronDownIcon, RocketIcon } from "lucide-react";
import { useRef } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { useServerConfigs } from "~/state/entities";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import {
  latestPullRequestDeployment,
  rollupPullRequestDeployments,
} from "../pullRequest/pullRequestDeployments.logic";
import {
  PullRequestDeploymentStateIcon,
  pullRequestDeploymentStatePresentation,
} from "../pullRequest/pullRequestPresentation";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadDetailsDeploymentsControl({
  environmentId,
  threadRef,
  number,
  reference: linkedReference,
  project,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  number: number;
  reference?: Pick<PullRequestRef, "host" | "repository" | "number"> | null;
  project: EnvironmentProject | null;
}) {
  const serverConfigs = useServerConfigs();
  const supportsPullRequests =
    serverConfigs.get(environmentId)?.environment.capabilities.pullRequests === true;
  const repository = sourceControlRepositorySelector(project?.repositoryIdentity);
  const reference: PullRequestRef | null =
    supportsPullRequests && project !== null
      ? linkedReference
        ? { ...linkedReference, projectId: project.id as ProjectId }
        : repository !== null
          ? { projectId: project.id as ProjectId, repository, number }
          : null
      : null;
  const detailQuery = useEnvironmentQuery(
    reference === null
      ? null
      : pullRequestEnvironment.detail({
          environmentId,
          input: { ...reference, allowStale: false },
        }),
  );
  const detail = detailQuery.data;
  const deploymentsQuery = useEnvironmentQuery(
    detail && detail.capabilities.deployments === true && detail.state === "open"
      ? pullRequestEnvironment.deployments({ environmentId, input: reference! })
      : null,
  );
  const openLink = useOpenLink(threadRef);
  const anchorRef = useRef<HTMLDivElement>(null);

  const deployments = deploymentsQuery.data ?? [];
  const rollup = rollupPullRequestDeployments(deployments);
  if (rollup === null) return null;
  const latest = latestPullRequestDeployment(deployments);
  const tone = pullRequestDeploymentStatePresentation(rollup).toneClassName;

  const open = (
    deployment: PullRequestDeployment,
    event: { readonly metaKey: boolean; readonly ctrlKey: boolean },
  ) => {
    if (deployment.url === null) return;
    void openLink(deployment.url, { event }).catch((error: unknown) => {
      console.error(error);
      toastManager.add({
        type: "error",
        title: "Unable to open deployment",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };

  return (
    <div
      ref={anchorRef}
      role="group"
      aria-label="Deployments"
      className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              type="button"
              variant="ghost"
              size="sm"
              part="primary"
              disabled={latest === null}
              onClick={(event) => latest !== null && open(latest, event)}
            />
          }
        >
          <RocketIcon aria-hidden className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, tone)} />
          <span className="min-w-0 truncate">
            {latest === null
              ? pullRequestDeploymentStatePresentation(rollup).label
              : "Open deployment"}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          {latest === null
            ? "No deployment is up yet"
            : `Open ${latest.name}. Hold Cmd or Ctrl for the system browser.`}
        </TooltipPopup>
      </Tooltip>
      <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
      <Menu>
        <MenuTrigger
          render={
            <ThreadDetailsControl
              aria-label="Choose deployment"
              variant="ghost"
              size="sm"
              part="secondary"
            />
          }
        >
          <ChevronDownIcon aria-hidden className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
        </MenuTrigger>
        <MenuPopup align="end" anchor={anchorRef} className="w-(--anchor-width)">
          {deployments.map((deployment) => (
            <MenuItem
              key={`${deployment.commit.sha}:${deployment.name}:${deployment.state}:${deployment.url ?? ""}`}
              disabled={deployment.url === null}
              onClick={(event) => open(deployment, event)}
            >
              <PullRequestDeploymentStateIcon state={deployment.state} className="size-4" />
              <MenuItemLabel>{deployment.name}</MenuItemLabel>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                {deployment.commit.isHead
                  ? `${deployment.commit.shortSha} · latest`
                  : deployment.commit.shortSha}
              </span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}
