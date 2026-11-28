import Link from "next/link";
import { getFlightDetails, type FlightDetails } from "@/lib/flights/details";
import { flightQuery, partyCounts, type PageQuery } from "@/lib/flights/handoff";
import { formatInZone } from "@/lib/flights/format-in-zone";

export const metadata = { title: "Review flight selection | Wayfarer", robots: { index: false } };

function unavailable(message: string) {
  return <main className="workspace-main form-stack"><h1>Check your flight selection</h1>
    <p>{message}</p><Link className="text-link" href="/flights">Return to flight search</Link></main>;
}

export default async function BookingEntry({ searchParams }: { searchParams: Promise<PageQuery> }) {
  const raw = await searchParams;
  const party = partyCounts(flightQuery(raw));
  if (!party || typeof raw.outboundId !== "string" || typeof raw.outboundCabin !== "string") {
    return unavailable("Choose a flight, cabin and passengers to continue.");
  }
  const segments = [{ flightId: raw.outboundId, cabinCategory: raw.outboundCabin }];
  if (raw.returnId !== undefined || raw.returnCabin !== undefined) {
    if (typeof raw.returnId !== "string" || typeof raw.returnCabin !== "string") return unavailable("Choose a return flight and cabin.");
    segments.push({ flightId: raw.returnId, cabinCategory: raw.returnCabin });
  }
  const flights: FlightDetails[] = await Promise.all(segments.map(segment => getFlightDetails(segment.flightId)));
  const [outbound, inbound] = flights;
  if (inbound && (outbound.departureAirportCode !== inbound.arrivalAirportCode ||
      outbound.arrivalAirportCode !== inbound.departureAirportCode ||
      Date.parse(inbound.departureLocalTime) <= Date.parse(outbound.arrivalLocalTime))) {
    return unavailable("Choose a return flight on the reverse route that departs after your outbound flight arrives.");
  }
  const requiredSeats = party.adults + party.children;
  for (const [index, flight] of flights.entries()) {
    const cabin = flight.cabins.find(item => item.category === segments[index].cabinCategory);
    if (flight.status !== "Scheduled" || !cabin || cabin.seatsRemaining < requiredSeats) {
      return unavailable("The selected cabin is no longer available for your party.");
    }
  }
  return <main className="workspace-main form-stack">
    <header className="page-heading"><h1>Review your flight selection</h1></header>
    {flights.map((flight, index) => <section key={flight.id} className="panel form-stack">
      <h2>{index ? "Return" : "Outbound"} · {flight.flightNumber}</h2>
      <p>{flight.airlineName} · {segments[index].cabinCategory}</p>
      <p>{flight.departureAirportCode} · {formatInZone(flight.departureLocalTime, flight.departureTimeZone)}<br />
        {flight.arrivalAirportCode} · {formatInZone(flight.arrivalLocalTime, flight.arrivalTimeZone)}</p>
    </section>)}
    <p>Adults: {party.adults} · Children: {party.children} · Infants: {party.infants}</p>
    <Link className="text-link" href="/flights">Change flights</Link>
  </main>;
}
