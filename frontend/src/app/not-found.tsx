import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="standalone-state">
      <section className="state-card">
        <p className="eyebrow-small">404 · Not found</p>
        <h1>We can’t find that page.</h1>
        <p>It may have moved, or the link may no longer be available.</p>
        <Link className="button button-primary" href="/">Return to the home page</Link>
      </section>
    </main>
  );
}
