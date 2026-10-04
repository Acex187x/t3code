import type { PullRequestDeployment, PullRequestDeploymentState } from "@t3tools/contracts";

/**
 * The one state a trigger carries for a list of deployments, ranked by what needs the reader
 * first. A failed deployment outranks a live one beside it, because the live one is still there
 * to open from the list and the failure is what changed. Only the head's own deployments count
 * while it has any: an older commit's deployment is history, not a signal.
 */
const ROLLUP_ORDER = [
  "failure",
  "waiting",
  "in-progress",
  "pending",
  "success",
  "inactive",
] as const satisfies ReadonlyArray<PullRequestDeploymentState>;

export function rollupPullRequestDeployments(
  deployments: ReadonlyArray<PullRequestDeployment>,
): PullRequestDeploymentState | null {
  const head = deployments.filter((deployment) => deployment.commit.isHead);
  const candidates = head.length > 0 ? head : deployments;
  for (const state of ROLLUP_ORDER) {
    if (candidates.some((deployment) => deployment.state === state)) return state;
  }
  return null;
}

/**
 * The deployment one button opens: the newest that is up and has somewhere to go. The server
 * lists deployments newest first, so the first such row is the branch as it stands. Null when
 * nothing is open-able yet, which the button says instead.
 */
export function latestPullRequestDeployment(
  deployments: ReadonlyArray<PullRequestDeployment>,
): PullRequestDeployment | null {
  return (
    deployments.find((deployment) => deployment.state === "success" && deployment.url !== null) ??
    null
  );
}
