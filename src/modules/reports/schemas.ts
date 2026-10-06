import { z } from "zod";
import { todayIso } from "@/lib/format";

/**
 * Filtros de los reportes (query string). Como en los demás listados, un valor inválido vuelve al
 * valor por defecto en lugar de cortar la consulta.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v));
const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const optDate = isoDate.optional().catch(undefined);
const optId = z.coerce.number().int().positive().max(2_147_483_647).optional().catch(undefined);

export const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;

const period = <T extends { from?: string; to?: string }>(v: T) => {
  const today = todayIso();
  let from = v.from ?? firstOfMonth(today);
  let to = v.to ?? today;
  if (from > to) [from, to] = [to, from];
  return { ...v, from, to };
};

export const PeriodSchema = z.object({ from: optDate, to: optDate }).transform(period);

export const DocumentsReportSchema = z
  .object({
    from: optDate,
    to: optDate,
    party: optId,
    type: optId,
    status: z.enum(["ACTIVE", "ANNULLED", "ALL"]).optional().default("ACTIVE").catch("ACTIVE"),
  })
  .transform(period);

export const SettlementsReportSchema = z
  .object({
    from: optDate,
    to: optDate,
    party: optId,
    status: z.enum(["ACTIVE", "ANNULLED", "ALL"]).optional().default("ACTIVE").catch("ACTIVE"),
  })
  .transform(period);

export const PartyPeriodSchema = z.object({ from: optDate, to: optDate, party: optId }).transform(period);

export const CutoffSchema = z
  .object({ cutoff: optDate, party: optId })
  .transform((v) => ({ ...v, cutoff: v.cutoff && v.cutoff <= todayIso() ? v.cutoff : todayIso() }));

/** Vencimientos: sin "desde" incluye todo lo vencido; por defecto hasta 30 días adelante. */
export const DueReportSchema = z.object({ from: optDate, to: optDate, party: optId }).transform((v) => {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  const to = v.to ?? d.toISOString().slice(0, 10);
  return { ...v, to, from: v.from && v.from <= to ? v.from : undefined };
});

export const StatementReportSchema = z.object({ from: optDate, to: optDate, party: optId }).transform((v) => {
  const today = todayIso();
  let from = v.from ?? `${today.slice(0, 4)}-01-01`;
  let to = v.to ?? today;
  if (from > to) [from, to] = [to, from];
  return { ...v, from, to };
});

export const LedgerReportSchema = z
  .object({ from: optDate, to: optDate, account: optId })
  .transform(period);

export const ReceivedChecksReportSchema = z.object({
  status: z.enum(["IN_PORTFOLIO", "DEPOSITED", "REJECTED", "ENDORSED", "ALL"]).optional().default("IN_PORTFOLIO").catch("IN_PORTFOLIO"),
});

export const IssuedChecksReportSchema = z.object({
  status: z.enum(["PENDING", "DEBITED", "REJECTED", "ALL"]).optional().default("PENDING").catch("PENDING"),
});

export const CashFlowSchema = z
  .object({
    start: optDate,
    view: z.enum(["WEEK", "MONTH"]).optional().default("WEEK").catch("WEEK"),
    periods: z.coerce.number().int().min(1).max(24).optional().catch(undefined),
  })
  .transform((v) => {
    const today = todayIso();
    return { view: v.view, start: v.start && v.start <= today ? v.start : today, periods: v.periods ?? (v.view === "WEEK" ? 8 : 6) };
  });

export const VatBookSchema = z
  .object({ from: isoMonth.optional().catch(undefined), to: isoMonth.optional().catch(undefined) })
  .transform((v) => {
    const month = todayIso().slice(0, 7);
    let from = v.from ?? month;
    let to = v.to ?? from;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  });

export type DocumentsReportQuery = z.output<typeof DocumentsReportSchema>;
export type SettlementsReportQuery = z.output<typeof SettlementsReportSchema>;
export type PartyPeriodQuery = z.output<typeof PartyPeriodSchema>;
export type CutoffQuery = z.output<typeof CutoffSchema>;
export type DueReportQuery = z.output<typeof DueReportSchema>;
export type StatementReportQuery = z.output<typeof StatementReportSchema>;
export type LedgerReportQuery = z.output<typeof LedgerReportSchema>;
export type CashFlowQuery = z.output<typeof CashFlowSchema>;
export type VatBookQuery = z.output<typeof VatBookSchema>;
