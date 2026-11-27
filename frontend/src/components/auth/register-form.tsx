"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { apiRequest } from "@/lib/api/client";
import { ApiError, type FieldErrors } from "@/lib/api/errors";

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [errors, setErrors] = useState<FieldErrors>({});

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = ["Enter your name."];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = ["Enter a valid email address."];
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      next.password = ["Use at least 8 characters, including a letter and a number."];
    }
    if (!consent) {
      next.termsAccepted = ["Consent to the terms and privacy policy is required."];
    }
    return next;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    const localErrors = validate();
    setErrors(localErrors);
    if (Object.keys(localErrors).length > 0) return;

    setBusy(true);
    try {
      await apiRequest<{ message: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          termsAccepted: consent,
          privacyPolicyAccepted: consent,
        }),
      });
      router.replace("/login?registered=1");
    } catch (registrationError) {
      if (registrationError instanceof ApiError) {
        setErrors(registrationError.fieldErrors);
        setMessage(registrationError.message);
      } else {
        setMessage("We couldn’t create your account. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const termsError =
    errors.termsAccepted?.[0] ?? errors.privacyPolicyAccepted?.[0];

  return (
    <section className="form-card">
      <p className="eyebrow-small">Create your account</p>
      <h1 className="form-title">A little closer to your next trip.</h1>
      <p className="form-intro">It only takes a moment to get started.</p>
      <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
        {message ? <div className="form-alert" role="alert">{message}</div> : null}
        <TextField
          label="Full name"
          name="name"
          autoComplete="name"
          required
          value={name}
          error={errors.name?.[0]}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          error={errors.email?.[0]}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          error={errors.password?.[0]}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <p className="password-requirement">
          At least 8 characters, with at least one letter and one number.
        </p>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="consent"
            required
            checked={consent}
            aria-invalid={Boolean(termsError)}
            aria-describedby={termsError ? "consent-error" : undefined}
            onChange={(event) => setConsent(event.currentTarget.checked)}
          />
          <span>
            I agree to the Terms and Conditions and acknowledge the Privacy Policy.
            {termsError ? <span className="field-error" id="consent-error">{termsError}</span> : null}
          </span>
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
        <p className="form-footer">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </section>
  );
}
