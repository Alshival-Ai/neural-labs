import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";

import type { UserStatus } from "./types";

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Neural Labs landing page">
      <img src="/assets/brand/neural-labs-mark.webp" alt="" />
      <span>Neural Labs</span>
    </a>
  );
}

export function AuthShell({ children }: PropsWithChildren) {
  return (
    <div className="site-shell">
      <header className="auth-topbar">
        <Brand />
        <a href="https://github.com/Alshival-Ai/neural-labs" target="_blank" rel="noreferrer">
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </header>
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function Notice({
  children,
  tone = "error",
}: PropsWithChildren<{ tone?: "error" | "success" | "info" }>) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function LoadingScreen({ label = "Loading Neural Labs" }: { label?: string }) {
  return (
    <div className="loading-screen" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function StatusPill({ status }: { status: UserStatus | "ready" | "starting" | "offline" }) {
  return <span className={`status-pill status-${status}`}>{status.replaceAll("_", " ")}</span>;
}

export function ProviderBadge({ provider }: { provider: "local" | "microsoft" }) {
  return <span className="provider-badge">{provider === "microsoft" ? "Microsoft" : "Local"}</span>;
}

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
}) {
  return (
    <button className={`button button-${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">◇</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatAction(value: string): string {
  return value.replaceAll(".", " · ").replaceAll("_", " ");
}
