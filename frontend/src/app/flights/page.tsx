import Link from "next/link";
import { FlightSearchPanel } from "@/components/flights/flight-search-panel";
import type { Airport } from "@/components/flights/airport-select";
import { EmptyState } from "@/components/ui/states";
import { serverApiRequest } from "@/lib/api/server";
import { formatInZone } from "@/lib/flights/format-in-zone";
import { searchFields, validateCriteria, type FlightCriteria, type SearchResults } from "@/lib/flights/search";

export const metadata = { title: "Flight search | Wayfarer", description: "Compare flights by departure time, duration, cabin and price." };

type Query = Record<string, string | string[] | undefined>;

async function FlightLeg({ criteria, returning, query }: {
  criteria: FlightCriteria; returning?: boolean; query: URLSearchParams;
}) {
  const params = new URLSearchParams(criteria);
  const pageKey = returning ? "returnPage" : "page";
  const page = Number(query.get(pageKey)) || 1;
  params.set("page", String(page));
  params.set("tripType", "one-way");
  params.delete("returnDate");
  if (returning) {
    params.set("departureAirportCode", criteria.arrivalAirportCode!);
    params.set("arrivalAirportCode", criteria.departureAirportCode!);
    params.set("departureDate", criteria.returnDate!);
  }
  const results = await serverApiRequest<SearchResults>(`/flights/search?${params}`);
  function pageHref(next: number) {
    const updated = new URLSearchParams(query);
    updated.set(pageKey, String(next));
    return `/flights?${updated}#${pageKey}`;
  }
  return (
    <section className="form-stack" id={pageKey}>
      <h2>{returning ? "Return flights" : "Outbound flights"}</h2>
      {results.items.length === 0 && <EmptyState title="No flights found" message="Try another date, cabin or price range." />}
      {results.items.map(flight => (
        <article className="panel form-stack" key={flight.id}>
          <h3>{flight.flightNumber} · {flight.departureAirportCode} → {flight.arrivalAirportCode}</h3>
          <Link className="text-link" href={`/flights/${flight.id}?${new URLSearchParams([...query, ["leg", returning ? "return" : "outbound"]])}`}>
            View details for {flight.flightNumber}
          </Link>
          <p>Departs {formatInZone(flight.departureAt, flight.departureTimeZone)}<br />
            Arrives {formatInZone(flight.arrivalAt, flight.arrivalTimeZone)} · {flight.durationMinutes} min</p>
          <ul>{flight.cabins.map(cabin => <li key={cabin.id}>{cabin.category} · Fare {cabin.price} · Infant fare {cabin.infantPrice} · {cabin.seatsAvailable} seats available</li>)}</ul>
        </article>
      ))}
      {results.totalPages > 1 && <nav aria-label={returning ? "Return flight pages" : "Outbound flight pages"} className="pagination">
        {page > 1 && <Link href={pageHref(page - 1)}>Previous</Link>}
        <span>Page {page} of {results.totalPages}</span>
        {page < results.totalPages && <Link href={pageHref(page + 1)}>Next</Link>}
      </nav>}
    </section>
  );
}

export default async function FlightsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const raw = await searchParams;
  const airports = await serverApiRequest<Airport[]>("/airports");
  const criteria: FlightCriteria = {};
  for (const key of searchFields) {
    const value = raw[key];
    if (typeof value === "string" && value) criteria[key] = value;
  }
  const searched = Object.keys(criteria).length > 0;
  criteria.adults ??= "1";
  const errors = searched ? validateCriteria(criteria) : {};
  const query = new URLSearchParams(criteria);
  if (criteria.tripType === "round-trip" && typeof raw.outboundId === "string" && typeof raw.outboundCabin === "string") {
    query.set("outboundId", raw.outboundId);
    query.set("outboundCabin", raw.outboundCabin);
  }
  for (const key of ["page", "returnPage"]) {
    const value = raw[key];
    if (typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) query.set(key, value);
  }
  return (
    <main className="workspace-main form-stack">
      <Link className="text-link" href="/">Wayfarer home</Link>
      <header className="page-heading"><h1>Search flights</h1></header>
      {airports.length ? <FlightSearchPanel key={query.toString()} initialValues={criteria} initialErrors={errors} airports={airports} />
        : <EmptyState title="No airports available" message="Flight search will be available when airports have been added." />}
      {airports.length > 0 && searched && Object.keys(errors).length === 0 && <>
        {query.has("outboundId") && <p role="status">Outbound cabin selected ({query.get("outboundCabin")}). Choose your return flight.</p>}
        <FlightLeg criteria={criteria} query={query} />
        {criteria.tripType === "round-trip" && <FlightLeg criteria={criteria} query={query} returning />}
      </>}
    </main>
  );
}
