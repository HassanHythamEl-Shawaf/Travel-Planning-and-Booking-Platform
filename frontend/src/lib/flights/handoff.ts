import { searchFields } from "./search";

export type PageQuery = Record<string, string | string[] | undefined>;

export function flightQuery(raw: PageQuery) {
  const params = new URLSearchParams();
  for (const key of [...searchFields, "page", "returnPage", "outboundId", "outboundCabin", "leg"]) {
    const value = raw[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  return params;
}

export function partyCounts(query: URLSearchParams) {
  const adults = Number(query.get("adults") ?? 1);
  const children = Number(query.get("children") ?? 0);
  const infants = Number(query.get("infants") ?? 0);
  if (![adults, children, infants].every(n => Number.isInteger(n) && n >= 0 && n <= 100)
      || adults < 1 || infants > adults || adults + children + infants > 100) return null;
  return { adults, children, infants };
}

export function chooseCabin(query: URLSearchParams, flightId: string, cabinCategory: string) {
  const party = partyCounts(query);
  if (!party) return null;
  const returning = query.get("leg") === "return";
  if (query.get("tripType") === "round-trip" && !returning) {
    const next = new URLSearchParams(query);
    next.delete("leg");
    next.set("outboundId", flightId);
    next.set("outboundCabin", cabinCategory);
    return `/flights?${next}#returnPage`;
  }
  if (returning && (!query.get("outboundId") || !query.get("outboundCabin"))) return null;
  const booking = new URLSearchParams({
    outboundId: returning ? query.get("outboundId")! : flightId,
    outboundCabin: returning ? query.get("outboundCabin")! : cabinCategory,
    adults: String(party.adults), children: String(party.children), infants: String(party.infants),
  });
  if (returning) {
    booking.set("returnId", flightId);
    booking.set("returnCabin", cabinCategory);
  }
  return `/flights/book?${booking}`;
}
