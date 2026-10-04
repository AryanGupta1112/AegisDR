import { useCallback, useState, useSyncExternalStore } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(listener: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export function useSystemReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

// Store display choices only. Server data and credentials never go into localStorage.
export function readPreference<T extends string | boolean>(
  key: string,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    if (typeof fallback === "boolean") return (raw === "true") as T;
    return raw as T;
  } catch {
    return fallback;
  }
}

export function usePreference<T extends string | boolean>(
  key: string,
  fallback: T,
) {
  const [value, setValue] = useState<T>(() => readPreference(key, fallback));
  const save = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* Display choices still work when storage is full or disabled. */
      }
    },
    [key],
  );
  return [value, save] as const;
}
