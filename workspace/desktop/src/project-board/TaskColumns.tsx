import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Item,
  type Status,
  type Member,
  type Change,
  lifecycle,
} from "./types";
import "./portal/responsive-board.js";
export function TaskColumns({
  tasks,
  statuses,
  members,
  namespace,
  board,
  open,
  change,
  report,
  expanded,
  manager,
}: {
  tasks: Item[];
  statuses: Status[];
  members: Member[];
  namespace?: string;
  board: string;
  open: (item: Item) => void;
  change: Change;
  report: (text: string) => void;
  expanded: boolean;
  manager: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    adapter = useRef<ReturnType<Window["AlshivalResponsiveBoard"]>>(null);
  const dragged = useRef<Item | null>(null),
    hold = useRef<ReturnType<typeof setTimeout> | null>(null),
    point = useRef({ x: 0, y: 0 }),
    frame = useRef(0),
    ignoreClick = useRef(false);
  const [ghost, setGhost] = useState<{
      title: string;
      x: number;
      y: number;
    } | null>(null),
    [moving, setMoving] = useState<string | null>(null);
  const current = useRef({ change, report });
  current.current = { change, report };
  const cancel = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
    dragged.current = null;
    setGhost(null);
    cancelAnimationFrame(frame.current);
    adapter.current?.finishDrag();
  };
  useEffect(() => {
    if (!root.current) return;
    const life = lifecycle();
    adapter.current = window.AlshivalResponsiveBoard(root.current, life, {
      cancel,
      availableWidth: () => root.current?.clientWidth ?? window.innerWidth,
      report: (text) => current.current.report(text),
    });
    life.listen(
      root.current,
      "touchstart",
      ((event: TouchEvent) => {
        if (event.touches.length !== 1) {
          cancel();
          return;
        }
        adapter.current?.touchStart(event);
      }) as EventListener,
      { passive: true },
    );
    life.listen(
      root.current,
      "touchmove",
      ((event: TouchEvent) => {
        if (dragged.current) event.preventDefault();
        else adapter.current?.touchMove(event);
      }) as EventListener,
      { passive: false },
    );
    life.listen(root.current, "touchend", (() =>
      adapter.current?.touchEnd()) as EventListener);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      life.close();
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, [board, namespace]);
  useEffect(() => adapter.current?.refresh(), [tasks, statuses, expanded]);
  const move = (item: Item, status: string) => {
    if (status === item.data.status_id) return;
    void current.current
      .change(item, { status_id: status })
      .catch((error) => current.current.report(error.message));
    setMoving(null);
  };
  const target = (x: number, y: number) => {
    const swipe = adapter.current?.dragTarget(
      x,
      y,
      statuses.map((status) => status.id),
    );
    if (swipe !== undefined) return swipe?.state;
    const column = document
      .elementFromPoint?.(x, y)
      ?.closest<HTMLElement>("[data-sp-state]");
    return column && root.current?.contains(column)
      ? column.dataset.spState
      : undefined;
  };
  const tick = () => {
    if (!dragged.current) return;
    adapter.current?.dragTick(
      point.current.x,
      point.current.y,
      performance.now(),
    );
    frame.current = requestAnimationFrame(tick);
  };
  return (
    <div
      ref={root}
      className="shared-project project-columns-adapter"
      data-shared-project
      data-board-user={namespace}
      data-board-url={board || "workspace"}
      data-board-expanded={expanded ? "" : undefined}
    >
      <div data-shared-project-content>
        <div className="sp-board-navigation">
          <div
            className="sp-layout-switch"
            role="group"
            aria-label="Board layout"
          >
            <button
              type="button"
              className="button btn-frost"
              data-board-layout-choice="swipe"
            >
              Swipe
            </button>
            <button
              type="button"
              className="button btn-frost"
              data-board-layout-choice="stacked"
            >
              Stacked
            </button>
          </div>
          <label className="sp-status-select">
            <span className="sr-only">Task status</span>
            <select data-board-status-select aria-label="Task status">
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name} ·{" "}
                  {
                    tasks.filter((item) => item.data.status_id === status.id)
                      .length
                  }
                </option>
              ))}
            </select>
          </label>
          <p className="sp-gesture-hint">
            Swipe to browse · Hold a task to move it
          </p>
          <div
            className="sp-column-navigation"
            role="group"
            aria-label="Navigate columns"
          >
            <button
              type="button"
              className="button btn-frost"
              data-board-step="-1"
              aria-label="Previous column"
            >
              ←
            </button>
            <button
              type="button"
              className="button btn-frost"
              data-board-step="1"
              aria-label="Next column"
            >
              →
            </button>
          </div>
        </div>
        <nav className="sp-mobile-filter" aria-label="Task status">
          {statuses.map((status) => (
            <button
              type="button"
              key={status.id}
              data-shared-status={status.id}
            >
              {status.name}
              <span>
                {
                  tasks.filter((task) => task.data.status_id === status.id)
                    .length
                }
              </span>
            </button>
          ))}
        </nav>
        <div className="sp-columns">
          {statuses.map((status) => (
            <section
              className="sp-column"
              key={status.id}
              data-sp-state={status.id}
              data-status-label={status.name}
              data-status-color={status.color}
              onDragOver={(event) => {
                if (dragged.current) {
                  event.preventDefault();
                  point.current = { x: event.clientX, y: event.clientY };
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged.current) move(dragged.current, status.id);
                cancel();
              }}
            >
              <header>
                <h3>
                  <span className="sp-status-dot" aria-hidden="true" />
                  {status.name}
                </h3>
                <span>
                  {
                    tasks.filter((item) => item.data.status_id === status.id)
                      .length
                  }
                </span>
              </header>
              <div className="sp-stack">
                {tasks
                  .filter((item) => item.data.status_id === status.id)
                  .map((item) => (
                    <article
                      key={item.id}
                      className="sp-card project-task"
                      data-status-color={status.color}
                      draggable
                      data-project-card
                      onClickCapture={(event) => {
                        if (ignoreClick.current) {
                          event.preventDefault();
                          event.stopPropagation();
                          ignoreClick.current = false;
                        }
                      }}
                      onDragStart={(event) => {
                        dragged.current = item;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                        adapter.current?.beginDrag();
                        tick();
                      }}
                      onDragEnd={cancel}
                      onPointerDown={(event) => {
                        if (
                          event.pointerType !== "touch" ||
                          !(event.target instanceof Element) ||
                          event.target.closest(
                            "button:not(.project-text-button),select,input,summary",
                          )
                        )
                          return;
                        cancel();
                        point.current = { x: event.clientX, y: event.clientY };
                        const start = { ...point.current };
                        hold.current = setTimeout(() => {
                          dragged.current = item;
                          ignoreClick.current = true;
                          adapter.current?.beginDrag();
                          setGhost({ title: item.data.title, ...start });
                          tick();
                        }, 350);
                      }}
                      onPointerMove={(event) => {
                        if (event.pointerType !== "touch") return;
                        const old = point.current;
                        point.current = { x: event.clientX, y: event.clientY };
                        if (dragged.current) {
                          event.preventDefault();
                          setGhost({
                            title: item.data.title,
                            ...point.current,
                          });
                        } else if (
                          Math.abs(old.x - event.clientX) +
                            Math.abs(old.y - event.clientY) >
                          8
                        )
                          cancel();
                      }}
                      onPointerUp={(event) => {
                        if (event.pointerType !== "touch") return;
                        if (dragged.current) {
                          const state = target(event.clientX, event.clientY);
                          if (state) move(dragged.current, state);
                        }
                        cancel();
                      }}
                      onPointerCancel={cancel}
                    >
                      <p className="sp-card-kind">
                        {item.kind === "ticket" ? "Service ticket" : "Task"}
                      </p>
                      {manager && (
                        <details className="sp-task-menu">
                          <summary
                            aria-label={`Actions for ${item.data.title}`}
                          >
                            •••
                          </summary>
                          <button
                            type="button"
                            className="button btn-frost"
                            onClick={() =>
                              void change(item, {
                                archived: !item.data.archived,
                              }).catch((error) => report(error.message))
                            }
                          >
                            {item.data.archived
                              ? "Restore from archive"
                              : "Archive"}
                          </button>
                          <button
                            type="button"
                            className="button btn-frost"
                            onClick={() =>
                              void change(item, { deleted: true }).catch(
                                (error) => report(error.message),
                              )
                            }
                          >
                            Move to Trash
                          </button>
                        </details>
                      )}
                      <h4>
                        <button
                          type="button"
                          className="project-text-button"
                          onClick={() => open(item)}
                        >
                          {item.data.title}
                        </button>
                      </h4>
                      <div className="sp-card-meta">
                        <label className="project-assignee">
                          <span className="sr-only">
                            Assign {item.data.title}
                          </span>
                          <select
                            aria-label={`Assign ${item.data.title}`}
                            value={item.data.assignee ?? ""}
                            onChange={(event) =>
                              void change(item, {
                                assignee: event.target.value || null,
                              }).catch((error) => report(error.message))
                            }
                          >
                            <option value="">Unassigned</option>
                            {members.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.display_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {item.data.due_on && (
                          <time dateTime={item.data.due_on}>
                            {item.data.due_on}
                          </time>
                        )}
                      </div>
                      <span
                        className={`sp-pill${["urgent", "high"].includes(item.data.priority) ? " sp-attention" : ""}`}
                      >
                        {item.data.priority}
                      </span>
                      <button
                        type="button"
                        className="sp-move"
                        aria-expanded={moving === item.id}
                        onClick={() =>
                          setMoving(moving === item.id ? null : item.id)
                        }
                      >
                        Move to…
                      </button>
                      {moving === item.id && (
                        <label className="project-move-menu">
                          Move {item.data.title}
                          <select
                            value={item.data.status_id ?? ""}
                            onChange={(event) => move(item, event.target.value)}
                          >
                            {statuses.map((destination) => (
                              <option
                                key={destination.id}
                                value={destination.id}
                              >
                                {destination.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </article>
                  ))}
                {!tasks.some((item) => item.data.status_id === status.id) && (
                  <p className="sp-empty-small">Nothing here yet.</p>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
      {ghost &&
        createPortal(
          <div
            className="project-drag-ghost"
            style={{
              position: "fixed",
              left: ghost.x + 12,
              top: ghost.y + 12,
              pointerEvents: "none",
              zIndex: 10000,
            }}
          >
            {ghost.title}
          </div>,
          document.body,
        )}
    </div>
  );
}
