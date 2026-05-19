import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import type {
  SourceControlChangeRequestReviewInput,
  SourceControlChangeRequestReviewSnapshot,
  SourceControlChangeRequestReviewStreamEvent,
  SourceControlProviderError,
} from "@t3tools/contracts";

import { SourceControlProviderRegistry } from "./SourceControlProviderRegistry.ts";

const DEFAULT_REVIEW_REFRESH_INTERVAL = Duration.seconds(10);
const REVIEW_REFRESH_FAILURE_BASE_DELAY = Duration.seconds(10);
const REVIEW_REFRESH_FAILURE_MAX_DELAY = Duration.minutes(5);

interface ReviewSnapshotChange {
  readonly key: string;
  readonly event: SourceControlChangeRequestReviewStreamEvent;
}

interface CachedSnapshot {
  readonly fingerprint: string;
  readonly value: SourceControlChangeRequestReviewSnapshot;
}

interface ActivePoller {
  readonly fiber: Fiber.Fiber<void, never>;
  readonly subscriberCount: number;
}

export interface ChangeRequestReviewBroadcasterShape {
  readonly getSnapshot: (
    input: SourceControlChangeRequestReviewInput,
  ) => Effect.Effect<SourceControlChangeRequestReviewSnapshot, SourceControlProviderError>;
  readonly refreshSnapshot: (
    input: SourceControlChangeRequestReviewInput,
  ) => Effect.Effect<SourceControlChangeRequestReviewSnapshot, SourceControlProviderError>;
  readonly streamSnapshot: (
    input: SourceControlChangeRequestReviewInput,
  ) => Stream.Stream<SourceControlChangeRequestReviewStreamEvent, SourceControlProviderError>;
}

export class ChangeRequestReviewBroadcaster extends Context.Service<
  ChangeRequestReviewBroadcaster,
  ChangeRequestReviewBroadcasterShape
>()("t3/source-control/ChangeRequestReviewBroadcaster") {}

function snapshotFingerprint(snapshot: SourceControlChangeRequestReviewSnapshot): string {
  const { fetchedAt: _fetchedAt, ...stable } = snapshot;
  return JSON.stringify(stable);
}

function failureDelay(consecutiveFailures: number) {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const backoffMs = Duration.toMillis(REVIEW_REFRESH_FAILURE_BASE_DELAY) * Math.pow(2, exponent);
  return Duration.min(Duration.millis(backoffMs), REVIEW_REFRESH_FAILURE_MAX_DELAY);
}

const normalizeCwd = (cwd: string) =>
  Effect.service(FileSystem.FileSystem).pipe(
    Effect.flatMap((fs) => fs.realPath(cwd)),
    Effect.orElseSucceed(() => cwd),
  );

const normalizeReference = (reference: string) => reference.trim().replace(/^#/, "");
const cacheKey = (cwd: string, reference: string) => `${cwd}:${normalizeReference(reference)}`;

export const layer = Layer.effect(
  ChangeRequestReviewBroadcaster,
  Effect.gen(function* () {
    const providers = yield* SourceControlProviderRegistry;
    const fs = yield* FileSystem.FileSystem;
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReviewSnapshotChange>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const broadcasterScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    const cacheRef = yield* Ref.make(new Map<string, CachedSnapshot>());
    const pollersRef = yield* SynchronizedRef.make(new Map<string, ActivePoller>());

    const withFileSystem = Effect.provideService(FileSystem.FileSystem, fs);

    const loadSnapshot = Effect.fn("ChangeRequestReviewBroadcaster.loadSnapshot")(function* (
      cwd: string,
      reference: string,
    ) {
      const provider = yield* providers.resolve({ cwd });
      return yield* provider.getChangeRequestReviewSnapshot({
        cwd,
        reference: normalizeReference(reference),
      });
    });

    const updateCachedSnapshot = Effect.fn("ChangeRequestReviewBroadcaster.updateCachedSnapshot")(
      function* (
        key: string,
        snapshot: SourceControlChangeRequestReviewSnapshot,
        options?: { publish?: boolean },
      ) {
        const next = {
          fingerprint: snapshotFingerprint(snapshot),
          value: snapshot,
        } satisfies CachedSnapshot;
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(key) ?? null;
          const nextCache = new Map(cache);
          nextCache.set(key, next);
          return [previous?.fingerprint !== next.fingerprint, nextCache] as const;
        });

        if (options?.publish && shouldPublish) {
          yield* PubSub.publish(changesPubSub, {
            key,
            event: {
              _tag: "updated" as const,
              snapshot,
            },
          } satisfies ReviewSnapshotChange);
        }

        return snapshot;
      },
    );

    const getSnapshot: ChangeRequestReviewBroadcasterShape["getSnapshot"] = Effect.fn(
      "ChangeRequestReviewBroadcaster.getSnapshot",
    )(function* (input) {
      const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
      const key = cacheKey(cwd, input.reference);
      const cached = yield* Ref.get(cacheRef).pipe(Effect.map((cache) => cache.get(key) ?? null));
      if (cached) {
        return cached.value;
      }
      const snapshot = yield* loadSnapshot(cwd, input.reference);
      return yield* updateCachedSnapshot(key, snapshot);
    });

    const refreshSnapshot: ChangeRequestReviewBroadcasterShape["refreshSnapshot"] = Effect.fn(
      "ChangeRequestReviewBroadcaster.refreshSnapshot",
    )(function* (input) {
      const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
      const key = cacheKey(cwd, input.reference);
      const snapshot = yield* loadSnapshot(cwd, input.reference);
      return yield* updateCachedSnapshot(key, snapshot, { publish: true });
    });

    const makeRefreshLoop = (input: SourceControlChangeRequestReviewInput) =>
      Effect.gen(function* () {
        const consecutiveFailuresRef = yield* Ref.make(0);
        const refreshWithBackoff = Effect.gen(function* () {
          const exit = yield* refreshSnapshot(input).pipe(Effect.exit);
          if (Exit.isSuccess(exit)) {
            yield* Ref.set(consecutiveFailuresRef, 0);
            return DEFAULT_REVIEW_REFRESH_INTERVAL;
          }

          const consecutiveFailures = yield* Ref.updateAndGet(
            consecutiveFailuresRef,
            (count) => count + 1,
          );
          const nextDelay = failureDelay(consecutiveFailures);
          yield* Effect.logWarning("Change request review snapshot refresh failed", {
            cwd: input.cwd,
            reference: input.reference,
            detail: exit.cause.toString(),
            consecutiveFailures,
            nextDelayMs: Duration.toMillis(nextDelay),
          });
          return nextDelay;
        });

        return yield* refreshWithBackoff.pipe(
          Effect.repeat(
            Schedule.identity<Duration.Duration>().pipe(
              Schedule.addDelay((delay) => Effect.succeed(delay)),
            ),
          ),
          Effect.asVoid,
        );
      });

    const retainPoller = Effect.fn("ChangeRequestReviewBroadcaster.retainPoller")(function* (
      key: string,
      input: SourceControlChangeRequestReviewInput,
    ) {
      yield* SynchronizedRef.modifyEffect(pollersRef, (activePollers) => {
        const existing = activePollers.get(key);
        if (existing) {
          const nextPollers = new Map(activePollers);
          nextPollers.set(key, {
            ...existing,
            subscriberCount: existing.subscriberCount + 1,
          });
          return Effect.succeed([undefined, nextPollers] as const);
        }

        return makeRefreshLoop(input).pipe(
          Effect.forkIn(broadcasterScope),
          Effect.map((fiber) => {
            const nextPollers = new Map(activePollers);
            nextPollers.set(key, { fiber, subscriberCount: 1 });
            return [undefined, nextPollers] as const;
          }),
        );
      });
    });

    const releasePoller = Effect.fn("ChangeRequestReviewBroadcaster.releasePoller")(function* (
      key: string,
    ) {
      const fiber = yield* SynchronizedRef.modify(pollersRef, (activePollers) => {
        const existing = activePollers.get(key);
        if (!existing) {
          return [null, activePollers] as const;
        }
        const nextPollers = new Map(activePollers);
        if (existing.subscriberCount > 1) {
          nextPollers.set(key, {
            ...existing,
            subscriberCount: existing.subscriberCount - 1,
          });
          return [null, nextPollers] as const;
        }
        nextPollers.delete(key);
        return [existing.fiber, nextPollers] as const;
      });

      if (fiber) {
        yield* Fiber.interrupt(fiber).pipe(Effect.asVoid);
      }
    });

    const streamSnapshot: ChangeRequestReviewBroadcasterShape["streamSnapshot"] = (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
          const normalizedInput = { ...input, cwd, reference: normalizeReference(input.reference) };
          const key = cacheKey(cwd, normalizedInput.reference);
          const subscription = yield* PubSub.subscribe(changesPubSub);
          const snapshot = yield* getSnapshot(normalizedInput);
          yield* retainPoller(key, normalizedInput);

          const liveStream = Stream.fromSubscription(subscription).pipe(
            Stream.filter((change) => change.key === key),
            Stream.map((change) => change.event),
          );
          const release = releasePoller(key).pipe(Effect.ignore, Effect.asVoid);

          return Stream.concat(
            Stream.make({
              _tag: "snapshot" as const,
              snapshot,
            }),
            liveStream,
          ).pipe(Stream.ensuring(release));
        }),
      );

    return ChangeRequestReviewBroadcaster.of({
      getSnapshot,
      refreshSnapshot,
      streamSnapshot,
    });
  }),
);
