"use client";

import { useRef, useState } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { API_BASE_URL } from "@/lib/api/config";

export interface UploadedImage {
  id: string;
  url: string;
  name?: string;
}

export function ImageUploader({
  images,
  maxImages,
  onUpload,
  onRemove,
  disabled = false,
}: {
  images: UploadedImage[];
  maxImages: number;
  onUpload: (file: File) => Promise<void>;
  onRemove: (image: UploadedImage) => Promise<void>;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [imageToRemove, setImageToRemove] = useState<UploadedImage>();
  const remaining = Math.max(0, maxImages - images.length);

  async function upload(file?: File) {
    if (!file) return;
    setError(undefined);

    let signature: Uint8Array;
    try {
      signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    } catch {
      setError("The image could not be checked. Please try another file.");
      return;
    }

    const isJpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
    const isPng =
      signature[0] === 0x89 &&
      signature[1] === 0x50 &&
      signature[2] === 0x4e &&
      signature[3] === 0x47 &&
      signature[4] === 0x0d &&
      signature[5] === 0x0a &&
      signature[6] === 0x1a &&
      signature[7] === 0x0a;
    if (!isJpeg && !isPng) {
      setError("Choose a JPG or PNG image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Images must be 5 MB or smaller.");
      return;
    }
    if (remaining === 0) {
      setError(`You can add up to ${maxImages} image${maxImages === 1 ? "" : "s"}.`);
      return;
    }

    setBusy(true);
    try {
      await onUpload(file);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The image could not be uploaded.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!imageToRemove) return;
    setError(undefined);
    setBusy(true);
    try {
      await onRemove(imageToRemove);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "The image could not be removed.",
      );
    } finally {
      setBusy(false);
      setImageToRemove(undefined);
    }
  }

  return (
    <section className="image-uploader" aria-label="Image uploads">
      <div className="image-uploader-heading">
        <div>
          <h3>Images</h3>
          <p>
            JPG or PNG, up to 5 MB each. {remaining} of {maxImages} remaining.
          </p>
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png"
          aria-label="Choose a JPG or PNG image"
          disabled={disabled || busy || remaining === 0}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void upload(file);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="small"
          disabled={disabled || busy || remaining === 0}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Working…" : "Add image"}
        </Button>
      </div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {images.length > 0 ? (
        <ul className="image-grid">
          {images.map((image) => (
            <li className="image-card" key={image.id}>
              <Image
                src={
                  image.url.startsWith("http")
                    ? image.url
                    : new URL(image.url, API_BASE_URL).toString()
                }
                alt={image.name ?? "Uploaded image"}
                width={400}
                height={300}
                unoptimized
              />
              <Button
                type="button"
                variant="ghost"
                size="small"
                disabled={disabled || busy}
                onClick={() => setImageToRemove(image)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No images added yet.</p>
      )}
      <ConfirmDialog
        open={imageToRemove !== undefined}
        title="Remove this image?"
        message="This image will be removed from this item."
        confirmLabel="Remove image"
        cancelLabel="Keep image"
        busy={busy}
        onCancel={() => setImageToRemove(undefined)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
