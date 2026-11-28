"use client";

import { useRef, useState } from "react";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/client";
import type { AirlineWorkspace } from "@/lib/airlines/workspace";
import { EditorForm } from "./editor-form";

export function AirlinePolicies({ workspace }: { workspace: AirlineWorkspace }) {
  const { airline, baggagePolicy, cancellationPolicy } = workspace;
  const [rows, setRows] = useState(() => (cancellationPolicy.length ? cancellationPolicy : [undefined])
    .map((tier, key) => ({ key, tier })));
  const nextKey = useRef(rows.length);
  const path = `/airlines/${airline.id}`;
  return <>
    <section className="panel form-stack"><h2>Extra baggage</h2>
      <EditorForm label="Save baggage policy" save={async data => {
        await apiRequest(path + "/baggage-policy", { method: "PUT", body: JSON.stringify({
          pricePerExtraBag: Number(data.get("price")), maxExtraBagsPerPassenger: Number(data.get("bags")),
        }) });
      }}>
        <TextField name="price" label="Price per extra bag (USD)" type="number" min=".01" step=".01" required defaultValue={baggagePolicy?.pricePerExtraBag} />
        <TextField name="bags" label="Maximum extra bags per passenger" type="number" min="0" required defaultValue={baggagePolicy?.maxExtraBagsPerPassenger} />
      </EditorForm>
    </section>
    <section className="panel form-stack"><h2>Cancellation refunds</h2>
      <EditorForm label="Save cancellation tiers" save={async data => {
        const tiers = rows.map(({ key }) => ({ daysBeforeDeparture: Number(data.get("days" + key)), refundPercentage: Number(data.get("refund" + key)) }));
        if (new Set(tiers.map(tier => tier.daysBeforeDeparture)).size !== tiers.length) throw new Error("Use a different departure threshold for each tier.");
        await apiRequest(path + "/cancellation-policy", {method: "PUT", body: JSON.stringify({ tiers })});
      }}>
        {rows.map(({ key, tier }, index) => <div className="panel form-stack" key={key}>
          <h3>Tier {index + 1}</h3>
          <TextField name={"days" + key} label="Days before departure" type="number" min="0" required defaultValue={tier?.daysBeforeDeparture} />
          <TextField name={"refund" + key} label="Refund (%)" type="number" min="0" max="100" step="any" required defaultValue={tier?.refundPercentage} />
          <Button variant="secondary" disabled={rows.length === 1} onClick={() => setRows(rows.filter(row => row.key !== key))}>Remove tier</Button>
        </div>)}
        <Button variant="secondary" disabled={rows.length >= 20} onClick={() => setRows([...rows, {key: nextKey.current++, tier: undefined}])}>Add tier</Button>
      </EditorForm>
    </section>
  </>;
}
