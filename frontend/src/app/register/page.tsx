import type { Metadata } from "next";
import Link from "next/link";

import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create an account" };

export default function RegisterPage() {
  return (
    <main className="account-layout workspace-main">
      <aside className="account-aside">
        <p className="eyebrow-small">Make it yours</p>
        <h2>Start with a place, a plan, or a faraway idea.</h2>
        <p>Create an account to bring your travel plans together and find inspiration along the way.</p>
        <Link className="text-link" href="/">Back to Wayfarer</Link>
      </aside>
      <RegisterForm />
    </main>
  );
}
