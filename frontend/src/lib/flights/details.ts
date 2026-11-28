import { notFound } from "next/navigation";
import { serverApiRequest } from "@/lib/api/server";

export interface FlightDetails {
  id: string;
  airlineName: string;
  airlineCode: string;
  flightNumber: string;
  departureAirportCode: string;
  arrivalAirportCode: string;
  departureLocalTime: string;
  arrivalLocalTime: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  durationMinutes: number;
  status: "Scheduled" | "Cancelled" | "Departed";
  cabins: {
    id: string; category: string; price: number; seatsRemaining: number;
    freeBaggageAllowance: number; maxWeightPerBagKg: number;
  }[];
  cancellationPolicy: { daysBeforeDeparture: number; refundPercentage: number }[];
}

export function getFlightDetails(id: string) {
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  return serverApiRequest<FlightDetails>(`/flights/${id}`);
}
