import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string;
    reason?: string;
    registered?: string;
    deactivated?: string;
    changedPassword?: string;
  }>;
}) {
  const query = await searchParams;

  return (
    <main className="account-layout workspace-main">
      <aside className="account-aside">
        <p className="eyebrow-small">Welcome back</p>
        <h2>Your next journey is closer than you think.</h2>
        <p>Sign in to pick up where you left off and keep every travel detail together.</p>
        <Link className="text-link" href="/">Back to Wayfarer</Link>
      </aside>
      <LoginForm
        returnTo={query.returnTo}
        sessionExpired={query.reason === "session-expired"}
        registered={query.registered === "1"}
        deactivated={query.deactivated === "1"}
        changedPassword={query.changedPassword === "1"}
      />
    </main>
  );
}
