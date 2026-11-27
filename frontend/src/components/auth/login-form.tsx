"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { roleHome, type UserRole } from "@/lib/session-types";

interface LoginResponse {
  message: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    mustChangePassword: boolean;
  };
}

function safeReturnTo(value?: string): string | undefined {
  if (!value || !value.startsWith("/")) return undefined;
  try {
    const destination = new URL(value, "https://wayfarer.invalid");
    if (destination.origin !== "https://wayfarer.invalid") return undefined;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return undefined;
  }
}

export function LoginForm({
  returnTo,
  sessionExpired,
  registered,
  deactivated,
  changedPassword,
}: {
  returnTo?: string;
  sessionExpired: boolean;
  registered: boolean;
  deactivated: boolean;
  changedPassword: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setEmailError(undefined);
    setPasswordError(undefined);

    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setPasswordError("Enter your password.");
      return;
    }

    setBusy(true);
    try {
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const destination = result.user.mustChangePassword
        ? "/account/change-password"
        : safeReturnTo(returnTo) ?? roleHome(result.user.role);
      router.replace(destination);
      router.refresh();
    } catch (loginError) {
      if (loginError instanceof ApiError) {
        if (loginError.status === 401) {
          setError("Invalid email or password.");
        } else if (loginError.status === 403 || loginError.status === 429) {
          setError(loginError.message);
        } else {
          setError(loginError.message);
        }
      } else {
        setError("We couldn’t sign you in. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-card">
      <p className="eyebrow-small">Log in</p>
      <h1 className="form-title">Good to have you back.</h1>
      <p className="form-intro">Enter your account details to continue.</p>
      <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
        {sessionExpired ? (
          <div className="form-alert" role="status">
            Your session expired. Please log in again to continue.
          </div>
        ) : null}
        {registered ? (
          <div className="form-success" role="status">
            Your account is ready. Log in to start planning.
          </div>
        ) : null}
        {deactivated ? (
          <div className="form-success" role="status">Your account has been deactivated.</div>
        ) : null}
        {changedPassword ? (
          <div className="form-success" role="status">
            Password changed. Please log in with your new password.
          </div>
        ) : null}
        {error ? <div className="form-alert" role="alert">{error}</div> : null}
        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          error={emailError}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          error={passwordError}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Signing you in…" : "Log in"}
        </Button>
        <p className="form-footer">
          New to Wayfarer? <Link href="/register">Create an account</Link>
        </p>
      </form>
    </section>
  );
}
