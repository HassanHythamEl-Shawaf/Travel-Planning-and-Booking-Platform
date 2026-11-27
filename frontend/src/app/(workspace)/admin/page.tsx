import type { Metadata } from "next";

import { DataTable } from "@/components/ui/data-table";
import type { TableColumn } from "@/components/ui/data-table";

export const metadata: Metadata = { title: "Administrator dashboard" };

const foundationRows = [
  { area: "Account management", status: "Coming soon" },
  { area: "Reports and moderation", status: "Coming soon" },
  { area: "Bookings and audit log", status: "Coming soon" },
];

const columns: TableColumn<(typeof foundationRows)[number]>[] = [
  { key: "area", heading: "Workspace", render: (row) => row.area },
  { key: "status", heading: "Status", render: (row) => row.status },
];

export default function AdminHome() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow-small">Administration</p>
          <h1>Platform overview</h1>
          <p>Manage accounts, providers, reports and platform activity.</p>
        </div>
      </div>
      <DataTable columns={columns} rows={foundationRows} rowKey={(row) => row.area} />
    </>
  );
}
