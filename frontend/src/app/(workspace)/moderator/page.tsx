import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Moderator dashboard" };

export default function ModeratorHome() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow-small">Provider workspace</p>
          <h1>Moderator dashboard</h1>
          <p>Your provider tools and booking activity will appear here.</p>
        </div>
      </div>
      <EmptyState
        title="Your workspace is getting ready"
        message="Provider management and booking tools are being added in the next frontend work areas."
      />
    </>
  );
}
