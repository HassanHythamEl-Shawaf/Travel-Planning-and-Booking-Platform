"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="standalone-state">
      <section className="state-card state-error">
        <p className="eyebrow-small">Something went wrong</p>
        <h1>We couldn’t load this page.</h1>
        <p>Please check your connection and try again.</p>
        <Button onClick={reset}>Try again</Button>
      </section>
    </main>
  );
}
