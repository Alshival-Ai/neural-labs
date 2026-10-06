export type Resource = {
  kind: string;
  status: string;
  provider: string;
  environment: string;
  public_url: string;
  external_id: string | null;
};
export type ItemData = {
  title: string;
  body: string;
  status_id: string | null;
  state: string;
  visibility: string;
  priority: string;
  acceptance: string;
  assignee: string | null;
  reviewer: string | null;
  starts_on: string | null;
  due_on: string | null;
  position?: { x: number; y: number } | null;
  board_id?: string | null;
  parent_id: string | null;
  resource_id?: string | null;
  archived: boolean;
  deleted: boolean;
  color: string;
  resource?: Resource | null;
  checklist: Array<{ id: string; text: string; done: boolean }>;
  details: Record<string, string>;
};
export type Item = {
  id: string;
  kind: string;
  revision: number;
  data: ItemData;
  author_id: string;
  created_at: string;
  updated_at: string;
};
export type Edge = {
  revision?: number;
  id: string;
  source_id: string;
  target_id: string;
  kind: "depends_on" | "related";
};
export type Status = {
  board_id?: string | null;
  id: string;
  revision: number;
  name: string;
  color: string;
  category: string;
  legacy_state: string;
  position: number;
  is_default: boolean;
  retired: boolean;
  replacement_id: string | null;
};
export type Member = { id: string; display_name: string };
export type Change = (item: Item, data: Partial<ItemData>) => Promise<Item>;
export const colors = [
  "yellow",
  "blue",
  "pink",
  "green",
  "orange",
  "purple",
  "teal",
  "gray",
];
export const labels: Record<string, string> = {
  todo: "To do",
  doing: "In progress",
  waiting: "Waiting",
  review: "Review",
  done: "Done",
};
export function lifecycle() {
  const controller = new AbortController(),
    callbacks: Array<() => void> = [];
  return {
    listen: (
      target: EventTarget,
      event: string,
      fn: EventListener,
      options: AddEventListenerOptions | boolean = {},
    ) =>
      target.addEventListener(event, fn, {
        ...(typeof options === "boolean" ? { capture: options } : options),
        signal: controller.signal,
      }),
    onClose: (fn: () => void) => callbacks.push(fn),
    close: () => {
      callbacks.forEach((fn) => fn());
      controller.abort();
    },
  };
}
