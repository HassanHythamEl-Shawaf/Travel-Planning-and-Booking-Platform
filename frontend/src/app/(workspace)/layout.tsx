import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireCurrentUser } from "@/lib/session";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireCurrentUser();
  return <AppShell user={user}>{children}</AppShell>;
}
