/** Format an API timestamp in the airport's IANA zone, including the local date. */
export function formatInZone(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(instant));
}
