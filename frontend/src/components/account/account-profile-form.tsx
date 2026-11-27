"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { FieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField, TextField } from "@/components/ui/text-field";

interface AccountProfile {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin" | "moderator";
  phone?: string;
  preferredCurrency?: string;
}

interface Currency {
  id: string;
  countryCodes: string[];
}

export function AccountProfileForm({
  profile,
  currencies,
}: {
  profile: AccountProfile;
  currencies: Currency[];
}) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [preferredCurrency, setPreferredCurrency] = useState(
    profile.preferredCurrency ?? currencies[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    setError(undefined);
    setFieldErrors({});

    const localErrors: FieldErrors = {};
    if (!name.trim()) localErrors.name = ["Enter your name."];
    if (name.trim().length > 100) {
      localErrors.name = ["Name must be 100 characters or fewer."];
    }
    if (phone.length > 20) {
      localErrors.phone = ["Phone number must be 20 characters or fewer."];
    }
    if (!currencies.some((currency) => currency.id === preferredCurrency)) {
      localErrors.preferredCurrency = ["Choose a supported currency."];
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          preferredCurrency,
        }),
      });
      setMessage(result.message);
      router.refresh();
    } catch (saveError) {
      if (saveError instanceof ApiError) {
        setFieldErrors(saveError.fieldErrors);
        setError(saveError.message);
      } else {
        setError("Your profile could not be saved. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function deactivateAccount() {
    setError(undefined);
    setDeactivating(true);
    try {
      await apiRequest<{ message: string }>("/users/me", {
        method: "DELETE",
        body: JSON.stringify({ confirm: true }),
      });
      setDialogOpen(false);
      router.replace("/login?deactivated=1");
      router.refresh();
    } catch (deactivationError) {
      setDialogOpen(false);
      setError(
        deactivationError instanceof Error
          ? deactivationError.message
          : "Your account could not be deactivated. Please try again.",
      );
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <div className="account-settings-grid">
      <section className="form-card form-card-wide">
        <h2 className="card-title">Personal details</h2>
        <p className="form-intro">Your email address is used to sign in and cannot be changed here.</p>
        <form className="form-stack" onSubmit={(event) => void saveProfile(event)} noValidate>
          {error ? <div className="form-alert" role="alert">{error}</div> : null}
          {message ? <div className="form-success" role="status">{message}</div> : null}
          <TextField
            label="Full name"
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            error={fieldErrors.name?.[0]}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <TextField
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            value={profile.email}
            disabled
          />
          <div className="form-grid">
            <TextField
              label="Phone number"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={20}
              value={phone}
              error={fieldErrors.phone?.[0]}
              onChange={(event) => setPhone(event.currentTarget.value)}
            />
            <SelectField
              label="Preferred currency"
              name="preferredCurrency"
              value={preferredCurrency}
              error={fieldErrors.preferredCurrency?.[0]}
              disabled={currencies.length === 0}
              onChange={(event) => setPreferredCurrency(event.currentTarget.value)}
            >
              {currencies.length === 0 ? (
                <option value="">No supported currencies available</option>
              ) : null}
              {currencies.map((currency) => (
                <option key={currency.id} value={currency.id}>{currency.id}</option>
              ))}
            </SelectField>
          </div>
          {currencies.length === 0 ? (
            <p className="field-error" role="alert">
              Supported currencies could not be loaded. Please try again after the reference data is available.
            </p>
          ) : null}
          <div className="field-actions">
            <Button type="submit" disabled={busy || currencies.length === 0}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </section>

      <section className="danger-zone">
        <p className="eyebrow-small">Account</p>
        <h2>Deactivate account</h2>
        <p>
          Deactivation is permanent. The backend will block it if you have upcoming
          confirmed bookings.
        </p>
        <Button
          type="button"
          variant="danger"
          onClick={() => setDialogOpen(true)}
        >
          Deactivate my account
        </Button>
      </section>
      <ConfirmDialog
        open={dialogOpen}
        title="Deactivate your account?"
        message="You’ll be signed out. Any upcoming confirmed bookings must be resolved first."
        confirmLabel="Deactivate account"
        cancelLabel="Keep account"
        busy={deactivating}
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => void deactivateAccount()}
      />
    </div>
  );
}
