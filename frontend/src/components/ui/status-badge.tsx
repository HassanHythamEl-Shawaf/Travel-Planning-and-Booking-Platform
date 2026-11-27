export type BookingStatus =
  | "Pending Payment"
  | "Confirmed"
  | "Completed"
  | "Expired"
  | "Cancelled"
  | "Failed"
  | "Refunded";

const STATUS_CLASS: Record<BookingStatus, string> = {
  "Pending Payment": "status-pending",
  Confirmed: "status-confirmed",
  Completed: "status-completed",
  Expired: "status-expired",
  Cancelled: "status-cancelled",
  Failed: "status-failed",
  Refunded: "status-refunded",
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span className={`status-badge ${STATUS_CLASS[status]}`}>{status}</span>
  );
}
