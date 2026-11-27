import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/states";
import { requireCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Your travel dashboard" };

export default async function TravellerDashboard() {
  const user = await requireCurrentUser();

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow-small">Your space</p>
          <h1>Welcome back, {user.name.split(" ")[0]}.</h1>
          <p>Your travel plans and saved details will find a home here.</p>
        </div>
        <Link className="button button-primary" href="/flights">Explore flights <span aria-hidden="true">↗</span></Link>
      </div>
      <EmptyState
        title="Your next journey starts here"
        message="Once you book a trip or create an itinerary, you’ll find it here."
        action={<Link className="button button-secondary" href="/itineraries">Start an itinerary</Link>}
      />
    </>
  );
}
