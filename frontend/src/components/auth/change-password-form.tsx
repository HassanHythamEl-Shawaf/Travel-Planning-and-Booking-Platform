"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast-provider";

export function ChangePasswordForm() {
  const router = useRouter();
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [currentPasswordError, setCurrentPasswordError] = useState<string>();
  const [newPasswordError, setNewPasswordError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setCurrentPasswordError(undefined);
    setNewPasswordError(undefined);

    if (!currentPassword) {
      setCurrentPasswordError("Enter your current password.");
      return;
    }
    if (
      newPassword.length < 8 ||
      !/[A-Za-z]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      setNewPasswordError("Use at least 8 characters, including a letter and a number.");
      return;
    }

    setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>("/auth/change-password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showToast(result.message);
      router.replace("/login?changedPassword=1");
      router.refresh();
    } catch (changeError) {
      if (changeError instanceof ApiError) {
        if (changeError.status === 401) {
          setCurrentPasswordError(changeError.message);
        } else if (changeError.status === 403) {
          setNewPasswordError(changeError.message);
        } else {
          setError(changeError.message);
        }
      } else {
        setError("We couldn’t change your password. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-card">
      <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
        {error ? <div className="form-alert" role="alert">{error}</div> : null}
        <TextField
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          error={currentPasswordError}
          onChange={(event) => setCurrentPassword(event.currentTarget.value)}
        />
        <TextField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          error={newPasswordError}
          onChange={(event) => setNewPassword(event.currentTarget.value)}
        />
        <p className="password-requirement">
          At least 8 characters, with at least one letter and one number.
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? "Updating password…" : "Update password"}
        </Button>
      </form>
    </section>
  );
}
