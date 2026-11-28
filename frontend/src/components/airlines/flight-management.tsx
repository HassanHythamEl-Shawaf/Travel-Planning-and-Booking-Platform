"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AirportSelect, type Airport } from "@/components/flights/airport-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField, TextField } from "@/components/ui/text-field";
import { EmptyState } from "@/components/ui/states";
import { apiRequest } from "@/lib/api/client";
import { formatInZone } from "@/lib/flights/format-in-zone";
import type { AirlineWorkspace, Cabin, ManagedFlight } from "@/lib/airlines/workspace";
import { EditorForm } from "./editor-form";

const categories = ["Economy", "Premium Economy", "Business", "First"];

function localInput(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function ScheduleFields({ flight }: { flight?: ManagedFlight }) {
  const id = useId();
  return <>
    <TextField id={id + "-departure"} name="departureLocalTime" label="Departure (departure airport local time)" type="datetime-local" required
      defaultValue={flight && localInput(flight.departureAt, flight.departureTimeZone)} />
    <TextField id={id + "-arrival"} name="arrivalLocalTime" label="Arrival (arrival airport local time)" type="datetime-local" required
      defaultValue={flight && localInput(flight.arrivalAt, flight.arrivalTimeZone)} />
  </>;
}

function CabinEditor({ flight, cabin }: { flight: ManagedFlight; cabin?: Cabin }) {
  const id = useId();
  const unused = categories.filter(name => !flight.cabins.some(c => c.category === name));
  if (!cabin && !unused.length) return null;
  return <details><summary>{cabin ? cabin.category + " cabin" : "Add cabin"}</summary>
    <EditorForm label={cabin ? "Save cabin" : "Add cabin"} save={async data => {
      const payload = {
        seatCount: Number(data.get("seats")), price: Number(data.get("price")),
        freeBaggageAllowance: Number(data.get("bags")), maxWeightPerBagKg: Number(data.get("weight")),
        category: cabin ? undefined : data.get("category"),
      };
      await apiRequest(`/flights/${flight.id}/cabins` + (cabin ? "/" + cabin.id : ""), {
        method: cabin ? "PATCH" : "POST", body: JSON.stringify(payload),
      });
    }}>
      {!cabin && <SelectField id={id + "-category"} name="category" label="Cabin category">{unused.map(name => <option key={name}>{name}</option>)}</SelectField>}
      <TextField id={id + "-seats"} name="seats" label="Total seats" type="number" min="1" required defaultValue={cabin?.seatCount} />
      <TextField id={id + "-price"} name="price" label="Fare (USD)" type="number" min=".01" step=".01" required defaultValue={cabin?.price} />
      <TextField id={id + "-bags"} name="bags" label="Included bags" type="number" min="0" required defaultValue={cabin?.freeBaggageAllowance} />
      <TextField id={id + "-weight"} name="weight" label="Weight per bag (kg)" type="number" min="0" step="any" required defaultValue={cabin?.maxWeightPerBagKg} />
    </EditorForm>
  </details>;
}

function FlightCard({ flight }: { flight: ManagedFlight }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/flights/${flight.id}`;
  async function cancelFlight() {
    setBusy(true); setError("");
    try {
      await apiRequest(path + "/cancel", { method: "POST", body: JSON.stringify({confirm: true}) });
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Cancellation failed."); }
    finally { setConfirm(false); setBusy(false); }
  }
  return <article className="panel form-stack">
    <h3>{flight.flightNumber} · {flight.departureAirportCode} → {flight.arrivalAirportCode}</h3>
    <p>{flight.status}<br />Departure · {formatInZone(flight.departureAt, flight.departureTimeZone)}<br />
      Arrival · {formatInZone(flight.arrivalAt, flight.arrivalTimeZone)}</p>
    <Link className="text-link" href={path}>View flight details</Link>
    <div data-slot="flight-bookings" data-flight-id={flight.id} />
    {flight.status === "Scheduled" && <>
      <details><summary>Edit schedule</summary>
        <EditorForm label="Save schedule" save={async data => {
          await apiRequest(path, {method: "PATCH", body: JSON.stringify(Object.fromEntries(data))});
        }}><ScheduleFields flight={flight} /></EditorForm>
      </details>
      {flight.cabins.map(cabin => <CabinEditor key={cabin.id} flight={flight} cabin={cabin} />)}
      <CabinEditor key={flight.cabins.length} flight={flight} />
      <Button variant="danger" onClick={() => setConfirm(true)}>Cancel flight</Button>
      <ConfirmDialog open={confirm} title={`Cancel ${flight.flightNumber}?`}
        message="The flight will be cancelled and affected bookings will be processed under the airline cancellation rules."
        confirmLabel="Cancel flight" cancelLabel="Keep flight" busy={busy} onCancel={() => setConfirm(false)} onConfirm={cancelFlight} />
    </>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </article>;
}

export function FlightManagement({ workspace, airports }: { workspace: AirlineWorkspace; airports: Airport[] }) {
  return <section id="flights" className="form-stack"><h2>Flights</h2>
    <details className="panel"><summary>Create flight</summary>
      <EditorForm label="Create flight" save={async data => {
        if (data.get("departureAirportCode") === data.get("arrivalAirportCode")) throw new Error("Choose different departure and arrival airports.");
        await apiRequest("/flights", {method: "POST", body: JSON.stringify({ ...Object.fromEntries(data), airlineId: workspace.airline.id })});
      }}>
        <TextField name="flightNumber" label="Flight number" pattern="[A-Za-z0-9\-]{2,10}" required minLength={2} maxLength={10} />
        <AirportSelect name="departureAirportCode" label="Departure airport" airports={airports} required />
        <AirportSelect name="arrivalAirportCode" label="Arrival airport" airports={airports} required />
        <ScheduleFields />
      </EditorForm>
    </details>
    {workspace.flights.length ? workspace.flights.map(flight => <FlightCard key={flight.id} flight={flight} />)
      : <EmptyState title="No flights on this page" message="Create a flight or return to the previous page." />}
    {(workspace.totalPages > 1 || workspace.page > 1) && <nav className="pagination" aria-label="Flight pages">
      {workspace.page > 1 && <Link href={`/moderator?page=${workspace.page-1}#flights`}>Previous</Link>}
      <span>Page {workspace.page}</span>
      {workspace.page < workspace.totalPages && <Link href={`/moderator?page=${workspace.page+1}#flights`}>Next</Link>}
    </nav>}
  </section>;
}
