"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-provider";

export function LogoutButton() {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await apiRequest<{ message: string }>("/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not log out. Please try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="small"
      disabled={busy}
      onClick={() => void logout()}
    >
      {busy ? "Leaving…" : "Log out"}
    </Button>
  );
}
