import { assert, it, afterEach, describe, expect, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";
import { VcsProcessExitError } from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const mockRun = vi.fn<VcsProcess.VcsProcessShape["run"]>();

const layer = GitHubCli.layer.pipe(
  Layer.provide(
    Layer.mock(VcsProcess.VcsProcess)({
      run: mockRun,
    }),
  ),
);

afterEach(() => {
  mockRun.mockReset();
});

describe("GitHubCli.layer", () => {
  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 42,
              title: "Add PR thread creation",
              url: "https://github.com/pingdotgg/codething-mvp/pull/42",
              baseRefName: "main",
              headRefName: "feature/pr-threads",
              state: "OPEN",
              mergedAt: null,
              isCrossRepository: true,
              headRepository: {
                nameWithOwner: "octocat/codething-mvp",
              },
              headRepositoryOwner: {
                login: "octocat",
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockRun).toHaveBeenCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "pr",
          "view",
          "#42",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("trims pull request fields decoded from gh json", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 42,
              title: "  Add PR thread creation  \n",
              url: " https://github.com/pingdotgg/codething-mvp/pull/42 ",
              baseRefName: " main ",
              headRefName: "\tfeature/pr-threads\t",
              state: "OPEN",
              mergedAt: null,
              isCrossRepository: true,
              headRepository: {
                nameWithOwner: " octocat/codething-mvp ",
              },
              headRepositoryOwner: {
                login: " octocat ",
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("skips invalid entries when parsing pr lists", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 0,
                title: "invalid",
                url: "https://github.com/pingdotgg/codething-mvp/pull/0",
                baseRefName: "main",
                headRefName: "feature/invalid",
              },
              {
                number: 43,
                title: "  Valid PR  ",
                url: " https://github.com/pingdotgg/codething-mvp/pull/43 ",
                baseRefName: " main ",
                headRefName: " feature/pr-list ",
                headRepository: {
                  nameWithOwner: "   ",
                },
                headRepositoryOwner: {
                  login: "   ",
                },
              },
            ]),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listOpenPullRequests({
        cwd: "/repo",
        headSelector: "feature/pr-list",
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid PR",
          url: "https://github.com/pingdotgg/codething-mvp/pull/43",
          baseRefName: "main",
          headRefName: "feature/pr-list",
          state: "open",
        },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              nameWithOwner: "octocat/codething-mvp",
              url: "https://github.com/octocat/codething-mvp",
              sshUrl: "git@github.com:octocat/codething-mvp.git",
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getRepositoryCloneUrls({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads pull request review snapshots", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({
                number: 42,
                title: "Review agent work",
                url: "https://github.com/acme/repo/pull/42",
                reviewDecision: "CHANGES_REQUESTED",
                reviews: [{ state: "APPROVED" }, { state: "CHANGES_REQUESTED" }],
                statusCheckRollup: [
                  {
                    name: "Vercel",
                    status: "COMPLETED",
                    conclusion: "SUCCESS",
                    detailsUrl: "https://vercel.com/acme/repo",
                    completedAt: "2026-05-19T00:02:00.000Z",
                  },
                  {
                    name: "GrepTile Review",
                    status: "IN_PROGRESS",
                    conclusion: null,
                    detailsUrl: "https://github.com/acme/repo/actions/runs/1",
                    startedAt: "2026-05-19T00:01:00.000Z",
                    workflowName: "GrepTile Review",
                  },
                ],
              }),
            ),
          ),
        )
        .mockReturnValueOnce(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          Effect.succeed(processOutput(JSON.stringify({ nameWithOwner: "acme/repo" }))),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify([
                {
                  data: {
                    repository: {
                      pullRequest: {
                        reviewThreads: {
                          nodes: [
                            {
                              id: "PRRT_1",
                              isResolved: false,
                              isOutdated: false,
                              path: "src/app.ts",
                              line: 12,
                              startLine: null,
                              comments: {
                                nodes: [
                                  {
                                    id: "PRRC_1",
                                    databaseId: 123,
                                    author: { login: "reviewer" },
                                    body: "Please fix this.",
                                    url: "https://github.com/acme/repo/pull/42#discussion_r123",
                                    path: "src/app.ts",
                                    diffHunk: "@@ -1 +1 @@",
                                    line: 12,
                                    startLine: null,
                                    createdAt: "2026-05-19T00:00:00.000Z",
                                    updatedAt: "2026-05-19T00:00:00.000Z",
                                    pullRequestReview: { state: "CHANGES_REQUESTED" },
                                  },
                                ],
                              },
                            },
                            {
                              id: "PRRT_2",
                              isResolved: true,
                              isOutdated: false,
                              path: "src/done.ts",
                              line: 5,
                              startLine: null,
                              comments: {
                                nodes: [
                                  {
                                    id: "PRRC_2",
                                    databaseId: 124,
                                    author: null,
                                    body: "Done.",
                                    url: "https://github.com/acme/repo/pull/42#discussion_r124",
                                    path: "src/done.ts",
                                    diffHunk: null,
                                    line: 5,
                                    startLine: null,
                                    createdAt: "2026-05-19T00:00:00.000Z",
                                    updatedAt: "2026-05-19T00:00:00.000Z",
                                    pullRequestReview: { state: "COMMENTED" },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              ]),
            ),
          ),
        );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequestReviewSnapshot({
        cwd: "/repo",
        reference: "42",
      });

      assert.strictEqual(result.reviewDecision, "changes_requested");
      assert.strictEqual(result.reviewSummary.approvingReviewCount, 1);
      assert.strictEqual(result.reviewSummary.changesRequestedReviewCount, 1);
      assert.strictEqual(result.checks.state, "pending");
      assert.strictEqual(result.checks.items.length, 2);
      assert.strictEqual(result.checks.items[0]?.name, "Vercel");
      assert.strictEqual(result.checks.items[1]?.state, "pending");
      assert.strictEqual(result.commentCount, 2);
      assert.strictEqual(result.unresolvedCommentCount, 1);
      assert.strictEqual(result.resolvedCommentCount, 1);
      assert.strictEqual(result.threads[0]?.comments[0]?.reviewState, "changes_requested");
      expect(mockRun).toHaveBeenLastCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: expect.arrayContaining([
          "api",
          "graphql",
          "--paginate",
          "--slurp",
          "-F",
          "owner=acme",
          "-F",
          "name=repo",
          "-F",
          "number=42",
        ]),
        cwd: "/repo",
        timeoutMs: 60_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("creates repositories and parses clone URLs from create output", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            "✓ Created repository octocat/codething-mvp on github.com\nhttps://github.com/octocat/codething-mvp\n",
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.createRepository({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
        visibility: "private",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
      expect(mockRun).toHaveBeenCalledTimes(1);
      expect(mockRun).toHaveBeenNthCalledWith(1, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["repo", "create", "octocat/codething-mvp", "--private"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("falls back to constructed URLs when create output omits a URL", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.createRepository({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
        visibility: "private",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("surfaces a friendly error when the pull request is not found", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.fail(
          new VcsProcessExitError({
            operation: "GitHubCli.execute",
            command: "gh pr view",
            cwd: "/repo",
            exitCode: 1,
            detail:
              "GraphQL: Could not resolve to a PullRequest with the number of 4888. (repository.pullRequest)",
          }),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const error = yield* gh
        .getPullRequest({
          cwd: "/repo",
          reference: "4888",
        })
        .pipe(Effect.flip);

      assert.equal(error.message.includes("Pull request not found"), true);
    }).pipe(Effect.provide(layer)),
  );
});
