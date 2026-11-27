import type { Metadata } from "next";
import Link from "next/link";

import { ChangePasswordForm } from "@/components/auth/change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default function ChangePasswordPage() {
  return (
    <main className="standalone-account">
      <Link className="brand standalone-brand" href="/">
        <span className="brand-mark" aria-hidden="true">W</span>
        <span>wayfarer</span>
      </Link>
      <div className="standalone-copy">
        <p className="eyebrow-small">Account security</p>
        <h1>Choose a new password</h1>
        <p>
          Your account needs a new password before you can continue. Use at
          least 8 characters with a letter and a number.
        </p>
      </div>
      <ChangePasswordForm />
    </main>
  );
}
