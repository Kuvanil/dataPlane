"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseWidgetDataResult<T> {
  data: T | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | undefined;
  refetch: () => void;
}

/**
 * Per-widget fetch state (dashboard_tasks #3). Each caller gets isolated
 * loading/error state so one failing widget never degrades another (FR6).
 *
 * Stale responses are discarded via a request counter ("latest wins"):
 * api.get() has no abort hook, so a slow response for a superseded range
 * is ignored rather than cancelled — same user-visible guarantee the
 * spec's AbortController asked for (no stale overwrite).
 */
export function useWidgetData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): UseWidgetDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setIsError(false);
    setErrorMessage(undefined);
    try {
      const result = await fetcher();
      if (seq !== requestSeq.current) return; // superseded — drop
      setData(result);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setIsError(true);
      setErrorMessage(err instanceof Error ? err.message : "An error occurred");
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are forwarded by the caller; fetcher is intentionally re-read on each run
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, isLoading, isError, errorMessage, refetch: load };
}
