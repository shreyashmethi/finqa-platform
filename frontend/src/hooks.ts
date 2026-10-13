// Small data hooks. useAsync runs a loader whenever its dependencies change and exposes
// {data, error, loading, reload}; usePolling re-runs it on an interval while a condition holds;
// useHotkeys binds single-key shortcuts that stay quiet while the user is typing.
import { useCallback, useEffect, useRef, useState } from "react";

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0); // ignore responses from superseded requests

  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    loader()
      .then((d) => {
        if (id === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => id === seq.current && setError(e.message))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

/** Call ``tick`` every ``ms`` milliseconds while ``active`` is true. */
export function usePolling(tick: () => void, active: boolean, ms = 1500) {
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(tick, ms);
    return () => window.clearInterval(t);
  }, [tick, active, ms]);
}

/** ``value`` once it has stopped changing for ``ms`` milliseconds. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Single-key shortcuts, e.g. {j: next, k: previous}. Ignored while focus is in a form field
 * (Escape still fires there so it can blur) and when a modifier key is held.
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) && e.key !== "Escape") return;
      const fn = ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** A boolean remembered in localStorage (per-browser preference). */
export function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* storage unavailable: keep the in-memory value */
      }
    },
    [key],
  );
  return [value, set];
}
