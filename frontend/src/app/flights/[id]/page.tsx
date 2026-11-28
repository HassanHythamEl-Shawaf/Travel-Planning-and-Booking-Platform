import Link from "next/link";
import { getFlightDetails } from "@/lib/flights/details";
import { formatInZone } from "@/lib/flights/format-in-zone";
import { chooseCabin, flightQuery, partyCounts, type PageQuery } from "@/lib/flights/handoff";

export const metadata = { title: "Flight details | Wayfarer", description: "View flight times, cabin fares, baggage allowances and cancellation terms." };

export default async function FlightPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<PageQuery>;
}) {
  const flight = await getFlightDetails((await params).id);
  const query = flightQuery(await searchParams);
  const party = partyCounts(query);
  const search = new URLSearchParams(query);
  search.delete("leg");
  const outboundStep = query.get("tripType") === "round-trip" && query.get("leg") !== "return";
  return (
    <main className="workspace-main form-stack">
      <Link className="text-link" href={`/flights?${search}`}>Back to flight search</Link>
      <header className="page-heading"><div>
        <p>{flight.airlineName} ({flight.airlineCode}) · {flight.status}</p>
        <h1>{flight.flightNumber} · {flight.departureAirportCode} → {flight.arrivalAirportCode}</h1>
      </div></header>
      <section className="panel form-stack" aria-label="Schedule">
        <div className="form-grid">
          <div><h2>Departure · {flight.departureAirportCode}</h2><time dateTime={flight.departureLocalTime}>{formatInZone(flight.departureLocalTime, flight.departureTimeZone)}</time></div>
          <div><h2>Arrival · {flight.arrivalAirportCode}</h2><time dateTime={flight.arrivalLocalTime}>{formatInZone(flight.arrivalLocalTime, flight.arrivalTimeZone)}</time></div>
        </div>
        <p>Duration · {Math.floor(flight.durationMinutes / 60)} h {flight.durationMinutes % 60} min</p>
      </section>
      <section className="form-stack"><h2>Cabins</h2>
        {flight.cabins.length === 0 && <p>No cabins available.</p>}
        {flight.cabins.map(cabin => {
          const available = party && flight.status === "Scheduled" && cabin.seatsRemaining >= party.adults + party.children;
          const href = available && chooseCabin(query, flight.id, cabin.category);
          return <article className="panel form-stack" key={cabin.id}>
            <h3>{cabin.category}</h3>
            <p>Fare · USD {cabin.price.toFixed(2)}<br />Seats remaining · {cabin.seatsRemaining}<br />
              Included baggage · {cabin.freeBaggageAllowance} bags, up to {cabin.maxWeightPerBagKg} kg each</p>
            {href ? <Link className="button button-primary" href={href}>
              {outboundStep ? `Select ${cabin.category} and choose return` : `Continue with ${cabin.category}`}
            </Link> : <p>{!party ? "Check your passenger counts in flight search." : !available ? "Unavailable for this flight or party." : "Choose an outbound cabin first."}</p>}
          </article>;
        })}
      </section>
      <section className="panel form-stack"><h2>Cancellation policy</h2>
        {flight.cancellationPolicy.length ? <ul>{flight.cancellationPolicy.toSorted((a,b) => b.daysBeforeDeparture - a.daysBeforeDeparture).map(tier =>
          <li key={tier.daysBeforeDeparture}>At least {tier.daysBeforeDeparture} days before departure · {tier.refundPercentage}% refund</li>
        )}</ul> : <p>No cancellation tiers listed by the airline.</p>}
      </section>
    </main>
  );
}
