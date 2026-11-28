import { SelectField } from "@/components/ui/text-field";

export interface Airport {
  iataCode: string;
  name: string;
  city: string;
  country: string;
  timeZone: string;
}

type AirportSelectProps = Omit<React.ComponentProps<typeof SelectField>, "children"> & {
  airports: Airport[];
};

export function AirportSelect({ airports, ...props }: AirportSelectProps) {
  return (
    <SelectField {...props}>
      <option value="">Select an airport</option>
      {airports.map((airport) => (
        <option key={airport.iataCode} value={airport.iataCode}>
          {airport.city} ({airport.iataCode}) · {airport.name}, {airport.country}
        </option>
      ))}
    </SelectField>
  );
}
