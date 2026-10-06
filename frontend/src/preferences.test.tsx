// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePreference, useSystemReducedMotion } from "./preferences";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("restores a saved display choice after remounting", () => {
  const first = renderHook(() => usePreference<boolean>("test-sidebar", false));
  act(() => first.result.current[1](true));
  first.unmount();
  const second = renderHook(() =>
    usePreference<boolean>("test-sidebar", false),
  );
  expect(second.result.current[0]).toBe(true);
});

it("keeps display controls usable when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  const control = renderHook(() => usePreference<string>("test-theme", "dark"));
  expect(control.result.current[0]).toBe("dark");
  act(() => control.result.current[1]("light"));
  expect(control.result.current[0]).toBe("light");
});

it("reacts when the device reduced-motion setting changes without a reload", () => {
  let reduced = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  const hook = renderHook(() => useSystemReducedMotion());
  expect(hook.result.current).toBe(false);
  act(() => {
    reduced = true;
    listeners.forEach((listener) => listener());
  });
  expect(hook.result.current).toBe(true);
});
