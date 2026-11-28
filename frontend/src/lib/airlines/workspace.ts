export interface Airline {
  id: string; name: string; code: string; logoUrl: string | null; isActive: boolean;
}

export interface Cabin {
  id: string; category: string; seatCount: number; price: number;
  freeBaggageAllowance: number; maxWeightPerBagKg: number;
}

export interface ManagedFlight {
  id: string; flightNumber: string; departureAirportCode: string; arrivalAirportCode: string;
  departureAt: string; arrivalAt: string; departureTimeZone: string; arrivalTimeZone: string;
  status: "Scheduled" | "Cancelled" | "Departed"; cabins: Cabin[];
}

export interface AirlineWorkspace {
  airline: Airline;
  baggagePolicy: { pricePerExtraBag: number; maxExtraBagsPerPassenger: number } | null;
  cancellationPolicy: { daysBeforeDeparture: number; refundPercentage: number }[];
  flights: ManagedFlight[];
  page: number;
  totalPages: number;
}
