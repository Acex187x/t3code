import type {
  EnvironmentId,
  SourceControlChangeRequestReviewSnapshot,
  SourceControlChangeRequestReviewStreamEvent,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { readEnvironmentApi } from "../environmentApi";

export interface ChangeRequestReviewSnapshotState {
  readonly data: SourceControlChangeRequestReviewSnapshot | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
}

export function useChangeRequestReviewSnapshot(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly enabled?: boolean;
}): ChangeRequestReviewSnapshotState {
  const [state, setState] = useState<ChangeRequestReviewSnapshotState>({
    data: null,
    error: null,
    isLoading: false,
  });

  useEffect(() => {
    if (!input.enabled || !input.environmentId || !input.cwd || !input.reference) {
      setState({ data: null, error: null, isLoading: false });
      return;
    }

    const api = readEnvironmentApi(input.environmentId);
    if (!api) {
      setState({
        data: null,
        error: new Error(`Environment API not found for environment ${input.environmentId}`),
        isLoading: false,
      });
      return;
    }

    let disposed = false;
    setState((current) => ({ ...current, error: null, isLoading: current.data === null }));
    const unsubscribe = api.sourceControl.subscribeChangeRequestReviewSnapshot(
      { cwd: input.cwd, reference: input.reference },
      (event: SourceControlChangeRequestReviewStreamEvent) => {
        if (disposed) return;
        setState({ data: event.snapshot, error: null, isLoading: false });
      },
      {
        onResubscribe: () => {
          if (!disposed) {
            setState((current) => ({ ...current, isLoading: current.data === null }));
          }
        },
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [input.cwd, input.enabled, input.environmentId, input.reference]);

  return state;
}

export async function refreshChangeRequestReviewSnapshot(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly reference: string;
}): Promise<SourceControlChangeRequestReviewSnapshot> {
  const api = readEnvironmentApi(input.environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${input.environmentId}`);
  }
  return api.sourceControl.getChangeRequestReviewSnapshot({
    cwd: input.cwd,
    reference: input.reference,
  });
}
