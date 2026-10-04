import type { PullRequestDeployment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  latestPullRequestDeployment,
  rollupPullRequestDeployments,
} from "./pullRequestDeployments.logic";

const deployment = (
  overrides: Partial<PullRequestDeployment> & Pick<PullRequestDeployment, "name">,
): PullRequestDeployment => ({
  deployer: "vercel",
  state: "success",
  url: `https://${overrides.name.toLowerCase()}.example.com/`,
  detailsUrl: null,
  description: null,
  updatedAt: "2026-07-02T00:00:00Z",
  commit: { sha: "head", shortSha: "head", headline: null, isHead: true },
  ...overrides,
});
const older = { sha: "old", shortSha: "old", headline: "fix: first try", isHead: false };

describe("rollupPullRequestDeployments", () => {
  it("ranks what needs the reader first, from the head's rows alone while it has any", () => {
    expect(rollupPullRequestDeployments([])).toBeNull();
    expect(
      rollupPullRequestDeployments([
        deployment({ name: "a" }),
        deployment({ name: "b", state: "inactive" }),
      ]),
    ).toBe("success");
    expect(
      rollupPullRequestDeployments([
        deployment({ name: "a", state: "in-progress" }),
        deployment({ name: "b", state: "waiting" }),
        deployment({ name: "c", state: "failure", commit: older }),
      ]),
    ).toBe("waiting");
    expect(
      rollupPullRequestDeployments([deployment({ name: "c", state: "failure", commit: older })]),
    ).toBe("failure");
  });
});

describe("latestPullRequestDeployment", () => {
  it("opens the newest deployment that is up and has an address", () => {
    const building = deployment({ name: "Preview", state: "in-progress", url: null });
    const head = deployment({ name: "Docs" });
    const old = deployment({ name: "Preview", commit: older });
    expect(latestPullRequestDeployment([building, head, old])).toBe(head);
    expect(latestPullRequestDeployment([building, { ...old, url: null }])).toBeNull();
    expect(latestPullRequestDeployment([])).toBeNull();
  });
});
