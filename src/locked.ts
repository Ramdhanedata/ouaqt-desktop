import { createContext, useContext } from "react";

/*
 * The software after a trial or a licence has ended: everything recorded
 * can be read, nothing new can be written. A button that would write is not
 * dead under the owner's finger: pressing it asks him, kindly, to subscribe,
 * with one button to the payment window. App.tsx answers the ask.
 */

let answer: (() => void) | null = null;

/** App.tsx says who answers. Returns how to stop answering. */
export function answerSubscribeAsks(show: () => void): () => void {
  answer = show;
  return () => {
    if (answer === show) answer = null;
  };
}

/** A press the licence does not allow: the window asking to subscribe comes up. */
export function askToSubscribe(): void {
  answer?.();
}

/* Whether the software is read-only right now, for the buttons drawn deep in a screen. */
export const LockedContext = createContext(false);
export const useLocked = () => useContext(LockedContext);
