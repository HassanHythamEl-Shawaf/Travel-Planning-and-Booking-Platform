import Link from "next/link";
import type { ReactNode } from "react";

export function LoadingState({
  label = "Loading",
}: {
  label?: string;
}) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({
  title = "We couldn’t load this page",
  message = "Please try again in a moment.",
  retryHref,
}: {
  title?: string;
  message?: string;
  retryHref?: string;
}) {
  return (
    <section className="state-card state-error" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {retryHref ? (
        <Link className="text-link" href={retryHref}>
          Try again
        </Link>
      ) : null}
    </section>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <section className="state-card state-empty">
      <span className="empty-mark" aria-hidden="true">
        ◇
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </section>
  );
}
