"use client";

import { forwardRef } from "react";

type ButtonVariant = "solid" | "ghost" | "danger";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  children,
  className,
  variant = "solid",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  return (
    <button
      type="button"
      className={cn("nl-button", `nl-button--${variant}`, className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("nl-icon-button", className)}
      {...props}
    >
      {children}
    </button>
  );
}

export const TextInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} className={cn("nl-input", className)} {...props} />;
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("nl-textarea", className)} {...props} />;
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn("nl-input", className)} {...props}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="nl-field">
      <span className="nl-field__label">{label}</span>
      {hint ? <span className="nl-field__hint">{hint}</span> : null}
      {children}
    </label>
  );
}

export function Badge({
  children,
  accent = "neutral",
}: {
  children: React.ReactNode;
  accent?: "neutral" | "success" | "warn";
}) {
  return <span className={cn("nl-badge", `nl-badge--${accent}`)}>{children}</span>;
}
