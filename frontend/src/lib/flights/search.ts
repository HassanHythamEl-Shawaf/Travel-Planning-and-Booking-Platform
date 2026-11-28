export const searchFields = [
  "departureAirportCode", "arrivalAirportCode", "departureDate", "returnDate",
  "tripType", "adults", "children", "infants", "cabinClass", "minPrice", "maxPrice", "sort",
] as const;

export type FlightCriteria = Partial<Record<(typeof searchFields)[number], string>>;

export function validateCriteria(values: FlightCriteria): FlightCriteria {
  const errors: FlightCriteria = {};
  if (!values.departureAirportCode) errors.departureAirportCode = "Select a departure airport.";
  if (!values.arrivalAirportCode) errors.arrivalAirportCode = "Select an arrival airport.";
  if (!values.departureDate) errors.departureDate = "Choose a departure date.";
  if (values.tripType === "round-trip" && (!values.returnDate || values.returnDate < (values.departureDate ?? ""))) {
    errors.returnDate = "Choose a return date on or after departure.";
  }
  if (Number(values.infants ?? 0) > Number(values.adults ?? 1)) {
    errors.infants = "The number of infants cannot exceed the number of adults.";
  }
  if (values.minPrice && values.maxPrice && Number(values.minPrice) > Number(values.maxPrice)) {
    errors.maxPrice = "Maximum price must be at least the minimum price.";
  }
  return errors;
}

export interface FlightOption {
  id: string;
  flightNumber: string;
  departureAirportCode: string;
  arrivalAirportCode: string;
  departureAt: string;
  arrivalAt: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  durationMinutes: number;
  cabins: { id: string; category: string; price: number; infantPrice: number; seatsAvailable: number }[];
}

export interface SearchResults {
  items: FlightOption[];
  totalPages: number;
  page: number;
}
