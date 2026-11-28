import type { Metadata } from "next";
import { serverApiRequest } from "@/lib/api/server";
import { AirlineProfileForm } from "@/components/airlines/airline-profile-form";
import { AirlinePolicies } from "@/components/airlines/airline-policies";
import { FlightManagement } from "@/components/airlines/flight-management";
import type { Airport } from "@/components/flights/airport-select";
import type { AirlineWorkspace } from "@/lib/airlines/workspace";

import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Moderator dashboard" };

export default async function ModeratorHome({ searchParams }: { searchParams: Promise<{page?: string}> }) {
  const assignment = await serverApiRequest<{ providerType: string; providerId: string }>("/moderator/assignment");
  if (assignment.providerType === "airline") {
    const { page } = await searchParams;
    const [workspace, airports] = await Promise.all([
      serverApiRequest<AirlineWorkspace>(`/airlines/${assignment.providerId}/workspace?page=${encodeURIComponent(page || "1")}`),
      serverApiRequest<Airport[]>("/airports"),
    ]);
    return <div className="form-stack">
      <header className="page-heading"><div><h1>{workspace.airline.name}</h1>
        <p>Airline dashboard · {workspace.airline.isActive ? "Active" : "Inactive"}</p></div></header>
      <nav className="pagination" aria-label="Airline tools"><a href="#flights">Flights</a><a href="#profile">Profile</a><a href="#policies">Policies</a><span data-slot="moderator-bookings-menu" /></nav>
      <FlightManagement workspace={workspace} airports={airports} />
      <div id="profile"><AirlineProfileForm airline={workspace.airline} /></div>
      <div id="policies" className="form-stack"><AirlinePolicies workspace={workspace} /></div>
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
