"use client";

import { createContext, useContext, type ComponentProps } from "react";
import { AirportSelect } from "@/components/flights/airport-select";
import { SelectField, TextField } from "@/components/ui/text-field";

export const EditorErrors = createContext<Record<string, string>>({});

export function EditorTextField(props: ComponentProps<typeof TextField> & { name: string }) {
  return <TextField {...props} error={useContext(EditorErrors)[props.name]} />;
}

export function EditorSelectField(props: ComponentProps<typeof SelectField> & { name: string }) {
  return <SelectField {...props} error={useContext(EditorErrors)[props.name]} />;
}

export function EditorAirportSelect(props: ComponentProps<typeof AirportSelect> & { name: string }) {
  return <AirportSelect {...props} error={useContext(EditorErrors)[props.name]} />;
}

// Local cross-field checks know the exact input, including dynamically added tiers.
export class EditorFieldError extends Error {
  constructor(readonly field: string, message: string) { super(message); }
}

const businessErrors: [RegExp, string][] = [
  [/airline with this code/i, "code"],
  [/flight number already exists/i, "flightNumber"],
  [/departure must be in the future|departure date is invalid/i, "departureLocalTime"],
  [/arrival must be after departure/i, "arrivalLocalTime"],
  [/airports must differ/i, "arrivalAirportCode"],
  [/each cabin category/i, "category"],
  [/below booked and held seats/i, "seats"],
];

const apiFields: Record<string, string> = {
  seatCount: "seats", freeBaggageAllowance: "bags", maxWeightPerBagKg: "weight",
  maxExtraBagsPerPassenger: "bags", pricePerExtraBag: "price",
};

export function editorErrorField(reason: unknown, data: FormData) {
  if (reason instanceof EditorFieldError) return reason.field;
  if (!(reason instanceof Error)) return;
  const rule = businessErrors.find(([pattern]) => pattern.test(reason.message));
  const dtoField = reason.message.match(/^(\w+)\s/)?.[1];
  const field = rule?.[1] ?? (dtoField && (apiFields[dtoField] ?? dtoField));
  if (field && data.has(field)) return field;
}
