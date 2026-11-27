import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SessionExpiryRedirect } from "@/components/session-expiry-redirect";
import { ToastProvider } from "@/components/ui/toast-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Wayfarer — Travel, thoughtfully planned",
    template: "%s | Wayfarer",
  },
  description:
    "Plan trips, explore stays and flights, and keep every travel detail in one place.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <SessionExpiryRedirect />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
