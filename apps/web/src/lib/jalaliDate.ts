const jalaliDateFormatter = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const tehranTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tehran",
  hour: "numeric",
  minute: "2-digit",
});

export function formatJalaliDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const parts = jalaliDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return "—";
  return `${year}/${month.padStart(2, "0")}/${day.padStart(2, "0")}`;
}

export function formatJalaliDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatJalaliDate(value)} · ${tehranTimeFormatter.format(date)}`;
}
