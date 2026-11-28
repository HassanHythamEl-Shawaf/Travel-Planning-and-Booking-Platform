import type { Metadata } from "next";
import { serverApiRequest } from "@/lib/api/server";
import { AirlineProfileForm } from "@/components/airlines/airline-profile-form";
import { AirlinePolicies } from "@/components/airlines/airline-policies";
import type { AirlineWorkspace } from "@/lib/airlines/workspace";

import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Moderator dashboard" };

export default async function ModeratorHome() {
  const assignment = await serverApiRequest<{ providerType: string; providerId: string }>("/moderator/assignment");
  if (assignment.providerType === "airline") {
    const workspace = await serverApiRequest<AirlineWorkspace>(`/airlines/${assignment.providerId}/workspace`);
    return <div className="form-stack">
      <header className="page-heading"><div><h1>{workspace.airline.name}</h1>
        <p>Airline dashboard · {workspace.airline.isActive ? "Active" : "Inactive"}</p></div></header>
      <AirlineProfileForm airline={workspace.airline} />
      <AirlinePolicies workspace={workspace} />
    </div>;
  }
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
