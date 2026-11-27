"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function SessionExpiryRedirect() {
  const router = useRouter();

  useEffect(() => {
    function redirectToLogin() {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      router.replace(
        `/login?reason=session-expired&returnTo=${encodeURIComponent(returnTo)}`,
      );
    }

    function redirectToForbidden() {
      router.replace("/forbidden");
    }

    window.addEventListener("session-expired", redirectToLogin);
    window.addEventListener("session-forbidden", redirectToForbidden);
    return () => {
      window.removeEventListener("session-expired", redirectToLogin);
      window.removeEventListener("session-forbidden", redirectToForbidden);
    };
  }, [router]);

  return null;
}
