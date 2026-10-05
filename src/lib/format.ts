/** Formatos regionales de Argentina (es-AR, zona America/Argentina/Buenos_Aires). */
export const TIME_ZONE = "America/Argentina/Buenos_Aires";

const dateTimeFmt = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateTimeFmt.format(typeof d === "string" ? new Date(d) : d);
}

/** Fecha de negocio (DATE 'AAAA-MM-DD') a dd/mm/aaaa, sin conversiones de zona horaria. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const isoDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Fecha de hoy en Argentina como AAAA-MM-DD (para comparar con fechas de negocio). */
export function todayIso(now: Date = new Date()): string {
  return isoDayFmt.format(now);
}

/** "2026-10-01" → "10/2026". */
export function formatPeriod(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  return `${m}/${y}`;
}
