"use client";

import { useState } from "react";
import Form from "next/form";
import { AirportSelect, type Airport } from "./airport-select";
import { SelectField, TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { validateCriteria, type FlightCriteria } from "@/lib/flights/search";

interface Props {
  airports: Airport[];
  initialValues?: FlightCriteria;
  initialErrors?: FlightCriteria;
}

export function FlightSearchPanel({ airports, initialValues = {}, initialErrors = {} }: Props) {
  const [tripType, setTripType] = useState(initialValues.tripType ?? "one-way");
  const [errors, setErrors] = useState(initialErrors);
  const field = (name: keyof FlightCriteria) => ({
    name, defaultValue: initialValues[name], error: errors[name],
  });

  return (
    <Form action="/flights" className="panel form-stack" onSubmit={(event) => {
      const values = Object.fromEntries(new FormData(event.currentTarget)) as FlightCriteria;
      const nextErrors = validateCriteria(values);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        event.preventDefault();
        const invalid = event.currentTarget.elements.namedItem(Object.keys(nextErrors)[0]);
        if (invalid instanceof HTMLElement) invalid.focus();
      }
    }}>
      <div className="form-grid">
        <AirportSelect {...field("departureAirportCode")} airports={airports} label="From" required />
        <AirportSelect {...field("arrivalAirportCode")} airports={airports} label="To" required />
        <SelectField name="tripType" label="Trip type" value={tripType} onChange={e => setTripType(e.target.value)}>
          <option value="one-way">One way</option><option value="round-trip">Round trip</option>
        </SelectField>
        <TextField {...field("departureDate")} type="date" label="Departure date" required />
        {tripType === "round-trip" && <TextField {...field("returnDate")} type="date" label="Return date" required />}
        {(["adults", "children", "infants"] as const).map((name) => (
          <TextField {...field(name)} key={name} label={{ adults: "Adults (12+)", children: "Children (2–11)", infants: "Infants (under 2)" }[name]}
            type="number" min={name === "adults" ? 1 : 0} max={100} required
            defaultValue={initialValues[name] ?? (name === "adults" ? 1 : 0)} />
        ))}
        <SelectField {...field("cabinClass")} label="Cabin class">
          <option value="">Any cabin</option>
          {["Economy", "Premium Economy", "Business", "First"].map(cabin => <option key={cabin}>{cabin}</option>)}
        </SelectField>
        <TextField {...field("minPrice")} type="number" min="0" step="any" label="Minimum price" />
        <TextField {...field("maxPrice")} type="number" min="0" step="any" label="Maximum price" />
        <SelectField {...field("sort")} label="Sort by">
          <option value="departure">Departure time</option><option value="price">Price</option><option value="duration">Duration</option>
        </SelectField>
      </div>
      <Button type="submit">Search flights</Button>
    </Form>
  );
}
