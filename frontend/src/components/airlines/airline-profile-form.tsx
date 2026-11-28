"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api/client";
import type { Airline } from "@/lib/airlines/workspace";
import { ImageUploader } from "@/components/ui/image-uploader";
import { TextField } from "@/components/ui/text-field";
import { EditorForm } from "./editor-form";

export function AirlineProfileForm({ airline, onSaved }: {
  airline?: Airline; onSaved?: (airline: Airline) => void;
}) {
  const [saved, setSaved] = useState(airline);
  const path = saved ? `/airlines/${saved.id}` : "/airlines";
  if (!airline && saved) return <p role="status">Created {saved.name} ({saved.code}).</p>;
  return <section className="panel form-stack"><h2>Airline profile</h2>
    <EditorForm label={saved ? "Save profile" : "Create airline"} save={async data => {
      const result = await apiRequest<Airline>(path, {
        method: saved ? "PATCH" : "POST",
        body: JSON.stringify({ name: data.get("name"), code: data.get("code") }),
      });
      setSaved(result); onSaved?.(result);
    }}>
      <TextField label="Airline name" name="name" required minLength={2} maxLength={100} defaultValue={saved?.name} />
      <TextField label="Airline code" name="code" required pattern="[A-Za-z0-9]{2,3}" maxLength={3} defaultValue={saved?.code} />
    </EditorForm>
    {airline && saved && <ImageUploader maxImages={1}
      images={saved.logoUrl ? [{ id: saved.id, url: saved.logoUrl, name: saved.name + " logo" }] : []}
      onUpload={async file => {
        const body = new FormData(); body.set("file", file);
        setSaved(await apiRequest<Airline>(path + "/logo", { method: "PUT", body }));
      }}
      onRemove={async () => setSaved(await apiRequest<Airline>(path + "/logo", { method: "DELETE" }))} />}
  </section>;
}
