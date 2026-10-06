import type { lifecycle } from "./types";
type Lifecycle = ReturnType<typeof lifecycle>;
type Responsive = {
  refresh: () => void;
  select: (id: string) => void;
  beginDrag: () => void;
  finishDrag: () => void;
  dragTick: (x: number, y: number, now: number) => void;
  dragTarget: (
    x: number,
    y: number,
    states: string[],
  ) => { target: HTMLElement; state: string } | null | undefined;
  isSwipe: () => boolean;
  touchStart: (event: TouchEvent) => void;
  touchMove: (event: TouchEvent) => boolean;
  touchEnd: () => boolean;
};
declare global {
  interface Window {
    AlshivalResponsiveBoard: (
      root: HTMLElement,
      lifecycle: Lifecycle,
      actions: {
        availableWidth?: () => number;
        cancel: () => void;
        report: (text: string) => void;
      },
    ) => Responsive | null;
    AlshivalGantt: (
      root: HTMLElement,
      lifecycle: Lifecycle,
      actions: {
        refresh: () => Promise<void>;
        report: (text: string) => void;
        saveDates: (value: {
          id: string;
          revision: number;
          starts_on: string | null;
          due_on: string | null;
        }) => Promise<{
          revision: number;
          starts_on: string | null;
          due_on: string | null;
        }>;
      },
    ) => { busy: () => boolean };
  }
}
export {};
