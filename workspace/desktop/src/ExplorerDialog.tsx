import { useEffect, useRef, useState, type ReactNode } from "react";

export function ExplorerDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const prior = dialog?.ownerDocument.activeElement as HTMLElement | null;
    if (typeof dialog?.showModal === "function") dialog.showModal();
    else dialog?.setAttribute("open", "");
    dialog?.querySelector<HTMLElement>("input,button,select")?.focus();
    return () => {
      dialog?.close?.();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="explorer-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") {
          const nodes = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input,select,a[href]",
            ) ?? [],
          );
          if (
            e.shiftKey &&
            ref.current?.ownerDocument.activeElement === nodes[0]
          ) {
            e.preventDefault();
            nodes.at(-1)?.focus();
          } else if (
            !e.shiftKey &&
            ref.current?.ownerDocument.activeElement === nodes.at(-1)
          ) {
            e.preventDefault();
            nodes[0]?.focus();
          }
        }
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
export function NameDialog({
  title,
  initial,
  label = "Name",
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  label?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ExplorerDialog title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit(value.trim());
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Operation failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {label}
          <input
            value={value}
            required
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy || !value.trim()} type="submit">
            {busy ? "Working…" : "Save"}
          </button>
        </footer>
      </form>
    </ExplorerDialog>
  );
}
