import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <main className="standalone-state">
      <EmptyState
        title="You don’t have access to this page"
        message="This content may belong to another account. The server remains the authority for access."
        action={<Link className="button button-primary" href="/">Return home</Link>}
      />
    </main>
  );
}
