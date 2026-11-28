"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorErrors, editorErrorField } from "./editor-fields";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function EditorForm({ children, label, save }: {
  children: ReactNode; label: string; save: (data: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const control = form.current?.elements.namedItem(Object.keys(fieldErrors)[0] ?? "");
    if (control instanceof HTMLElement) control.focus();
  }, [fieldErrors]);
  return <form ref={form} className="form-stack" onChange={() => { setMessage(""); setError(""); setFieldErrors({}); }}
    onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(event.currentTarget);
      setBusy(true); setMessage(""); setError(""); setFieldErrors({});
      try {
        await save(data);
        setMessage("Saved.");
        router.refresh();
      } catch (reason) {
        const text = reason instanceof Error ? reason.message : "The changes could not be saved.";
        const field = editorErrorField(reason, data);
        if (field) setFieldErrors({ [field]: text });
        else setError(text);
      } finally { setBusy(false); }
    }}>
    <EditorErrors.Provider value={fieldErrors}>
      <fieldset className="form-grid" disabled={busy}>{children}</fieldset>
    </EditorErrors.Provider>
    {error && <p className="field-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <Button type="submit" disabled={busy}>{busy ? "Saving…" : label}</Button>
  </form>;
}
