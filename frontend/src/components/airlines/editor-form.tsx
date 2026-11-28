"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function EditorForm({ children, label, save }: {
  children: ReactNode; label: string; save: (data: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return <form className="form-stack" onChange={() => { setMessage(""); setError(""); }}
    onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(event.currentTarget);
      setBusy(true); setMessage(""); setError("");
      try {
        await save(data);
        setMessage("Saved.");
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The changes could not be saved.");
      } finally { setBusy(false); }
    }}>
    <fieldset className="form-grid" disabled={busy}>{children}</fieldset>
    {error && <p className="field-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <Button type="submit" disabled={busy}>{busy ? "Saving…" : label}</Button>
  </form>;
}
