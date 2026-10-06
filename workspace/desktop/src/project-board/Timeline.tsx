import { useEffect, useRef, useState } from "react";
import {
  type Item,
  type Status,
  type Change,
  lifecycle,
  labels,
} from "./types";
import "./portal/gantt.js";
export function Timeline({
  items,
  statuses,
  change,
  open,
  reload,
  compact = false,
}: {
  items: Item[];
  statuses: Status[];
  change: Change;
  open: (item: Item) => void;
  reload: () => Promise<void>;
  compact?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    current = useRef({ items, change, reload });
  current.current = { items, change, reload };
  const [message, setMessage] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  useEffect(() => {
    if (!root.current) return;
    const life = lifecycle();
    window.AlshivalGantt(root.current, life, {
      report: setMessage,
      refresh: async () => {
        await current.current.reload();
        root.current?.dispatchEvent(new Event("scrapbook:refresh"));
      },
      saveDates: async (input) => {
        const item = current.current.items.find((row) => row.id === input.id);
        if (!item)
          throw new Error(
            "This item is no longer available. Reload the board.",
          );
        const saved = await current.current.change(
          { ...item, revision: input.revision },
          { starts_on: input.starts_on, due_on: input.due_on },
        );
        return {
          revision: saved.revision,
          starts_on: saved.data.starts_on,
          due_on: saved.data.due_on,
        };
      },
    });
    return () => life.close();
  }, []);
  useEffect(() => {
    root.current?.dispatchEvent(new Event("scrapbook:refresh"));
  }, [items, statuses]);
  const rows = items
    .filter((item) => item.data.starts_on || item.data.due_on)
    .sort((a, b) =>
      (a.data.starts_on ?? a.data.due_on ?? "").localeCompare(
        b.data.starts_on ?? b.data.due_on ?? "",
      ),
    );
  const link = (item: Item) => (event: React.MouseEvent) => {
    event.preventDefault();
    open(item);
  };
  return (
    <div ref={root}>
      <div
        className={`sp-schedule${compact ? " sp-schedule-compact" : ""}`}
        data-gantt
        data-today={today}
      >
        <div className="sp-gantt">
          <div className="sp-gantt-controls">
            <label>
              Scale{" "}
              <select
                className="form-select"
                data-gantt-scale
                defaultValue="week"
              >
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
            <span>Drag to move · Edges resize · Escape cancels</span>
          </div>
          <div
            className="sp-gantt-scroll"
            tabIndex={0}
            role="region"
            aria-label={compact ? "Schedule preview" : "Schedule"}
          >
            <div className="sp-gantt-axis">
              <span>Work &amp; status</span>
              <div data-gantt-axis />
            </div>
            <div className="sp-gantt-body">
              {rows.map((item) => {
                const status = statuses.find(
                    (row) => row.id === item.data.status_id,
                  ),
                  name =
                    status?.name ?? labels[item.data.state] ?? item.data.state;
                const overdue = Boolean(
                  item.data.due_on &&
                    item.data.due_on < today &&
                    status?.category !== "done" &&
                    item.data.state !== "done",
                );
                return (
                  <div
                    key={item.id}
                    className={`sp-gantt-row sp-schedule-item${overdue ? " is-overdue" : ""}`}
                    data-status-color={status?.color ?? "blue"}
                    data-kind={item.kind}
                    data-id={item.id}
                    data-revision={item.revision}
                    data-start={item.data.starts_on ?? ""}
                    data-due={item.data.due_on ?? ""}
                    data-schedule-editable
                  >
                    <div className="sp-gantt-name">
                      <a
                        href={`#item-${item.id}`}
                        onClick={link(item)}
                        title={item.data.title}
                      >
                        {item.data.title}
                      </a>
                      <div>
                        <span className="sp-schedule-status">{name}</span>
                        {overdue && <span className="sp-overdue">Overdue</span>}
                        <button
                          type="button"
                          className="button btn-frost"
                          data-gantt-edit
                          aria-label={`Edit dates for ${item.data.title}`}
                        >
                          Edit dates
                        </button>
                      </div>
                    </div>
                    <div className="sp-gantt-track">
                      <span className="sp-gantt-today" aria-hidden="true" />
                      <a
                        href={`#item-${item.id}`}
                        onClick={link(item)}
                        className="sp-gantt-bar"
                        aria-label={`${item.data.title}: ${name}, ${item.data.starts_on ?? item.data.due_on} to ${item.data.due_on ?? item.data.starts_on}`}
                      >
                        {item.data.starts_on && item.data.due_on && (
                          <>
                            <span data-gantt-edge="start" aria-hidden="true" />
                            <span data-gantt-edge="due" aria-hidden="true" />
                          </>
                        )}
                      </a>
                      <span className="sp-gantt-dates">
                        {item.data.starts_on ?? item.data.due_on}
                      </span>
                    </div>
                  </div>
                );
              })}
              {!rows.length && (
                <p className="sp-empty">
                  Scheduled tasks and deliverables will appear here.
                </p>
              )}
            </div>
          </div>
          <dialog className="sp-gantt-dialog" aria-label="Edit scheduled dates">
            <form data-gantt-form>
              <h3>Edit dates</h3>
              <p data-gantt-title />
              <label>
                Starts <input type="date" name="starts_on" />
              </label>
              <label>
                Due <input type="date" name="due_on" />
              </label>
              <div className="sp-actions">
                <button className="button btn matrix-btn" type="submit">
                  Save dates
                </button>
                <button
                  className="button btn-frost"
                  type="button"
                  data-gantt-cancel
                >
                  Cancel
                </button>
              </div>
            </form>
          </dialog>
        </div>
        <ol className="sp-timeline sp-schedule-fallback">
          {rows.map((item) => (
            <li key={item.id} className="sp-schedule-item">
              <div className="sp-timeline-date">
                {item.data.due_on
                  ? `Due ${item.data.due_on}`
                  : `Starts ${item.data.starts_on}`}
              </div>
              <div>
                <p className="sp-eyebrow">
                  {item.kind} ·{" "}
                  {statuses.find((status) => status.id === item.data.status_id)
                    ?.name ?? labels[item.data.state]}
                </p>
                <h3>
                  <a href={`#item-${item.id}`} onClick={link(item)}>
                    {item.data.title}
                  </a>
                </h3>
                <button
                  type="button"
                  className="button btn-frost"
                  onClick={() => open(item)}
                >
                  Edit dates
                </button>
              </div>
            </li>
          ))}
          {!rows.length && (
            <li className="sp-empty">
              Scheduled tasks and deliverables will appear here.
            </li>
          )}
        </ol>
        <p className="sp-gantt-feedback" role="status">
          {message}
        </p>
      </div>
    </div>
  );
}
