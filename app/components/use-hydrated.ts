import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server-rendered HTML and until React has hydrated the page,
 * then true. Editors use it to block input until their state is live:
 * clicks made before hydration only change the raw HTML, and React then
 * keeps its own (different) state, so the screen and the data disagree.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
