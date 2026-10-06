import type { z } from "zod";
import { DomainError } from "@/lib/errors";
import { todayIso } from "@/lib/format";
import type { Permission } from "@/modules/auth/permissions";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { DbOrTx } from "@/server/db/drizzle";
import type { Direction } from "@/server/db/schema";
import { agingReport, balancesReport, documentsReport, dueReport, retentionsReport, settlementsReport, statementReport } from "./accounts-reports";
import { cashFlowReport } from "./cash-flow";
import {
  CashFlowSchema,
  CutoffSchema,
  DocumentsReportSchema,
  DueReportSchema,
  IssuedChecksReportSchema,
  LedgerReportSchema,
  PartyPeriodSchema,
  PeriodSchema,
  ReceivedChecksReportSchema,
  SettlementsReportSchema,
  StatementReportSchema,
  VatBookSchema,
} from "./schemas";
import { conceptsReport, issuedChecksReport, ledgerReport, receivedChecksReport } from "./treasury-reports";
import type { ReportResult } from "./types";
import { vatBookReport } from "./vat-book";

/** Catálogo de reportes (G.15): qué filtros tiene cada uno, qué permisos exige y cómo se calcula. */

export type ReportSection = "Clientes" | "Proveedores" | "Tesorería" | "Comprobantes e IVA";

export type FilterField =
  | { kind: "date"; name: string; label: string; hint?: string }
  | { kind: "month"; name: string; label: string }
  | { kind: "party"; direction: Direction; required?: boolean }
  | { kind: "documentType"; direction: Direction }
  | { kind: "account"; accountKind: "CASH" | "BANK" }
  | { kind: "select"; name: string; label: string; options: { value: string; label: string }[] }
  | { kind: "number"; name: string; label: string; min: number; max: number };

export interface ReportDef {
  key: string;
  section: ReportSection;
  title: string;
  description: string;
  permissions: Permission[];
  filters: FilterField[];
  /** Valores normalizados de los filtros (con sus valores por defecto), para completar el formulario. */
  parse(params: Record<string, string | undefined>): Record<string, unknown>;
  run(db: DbOrTx, ctx: ServiceContext, params: Record<string, string | undefined>, today: string): Promise<ReportResult>;
}

function def<S extends z.ZodType<Record<string, unknown>>>(d: Omit<ReportDef, "parse" | "run"> & { schema: S; run: (db: DbOrTx, ctx: ServiceContext, q: z.output<S>, today: string) => Promise<ReportResult> }): ReportDef {
  const { schema, run, ...rest } = d;
  return {
    ...rest,
    parse: (params) => schema.parse(params) as Record<string, unknown>,
    run: (db, ctx, params, today) => run(db, ctx, schema.parse(params), today),
  };
}

const period: FilterField[] = [
  { kind: "date", name: "from", label: "Desde" },
  { kind: "date", name: "to", label: "Hasta" },
];
const cutoff: FilterField = { kind: "date", name: "cutoff", label: "Fecha de corte", hint: "Por defecto, hoy." };
const statusFilter = (plural: "comprobantes" | "operaciones"): FilterField => ({
  kind: "select",
  name: "status",
  label: "Estado",
  options: [
    { value: "ACTIVE", label: "Vigentes" },
    { value: "ANNULLED", label: plural === "comprobantes" ? "Anulados" : "Anuladas" },
    { value: "ALL", label: "Todos" },
  ],
});

function sideReports(direction: Direction): ReportDef[] {
  const ar = direction === "ISSUED";
  const section: ReportSection = ar ? "Clientes" : "Proveedores";
  const slug = ar ? "clientes" : "proveedores";
  const party: FilterField = { kind: "party", direction };
  return [
    def({
      key: `${slug}-comprobantes`,
      section,
      title: ar ? "Comprobantes emitidos registrados" : "Comprobantes recibidos",
      description: "Por período, tipo y tercero, con neto, IVA, percepciones y total.",
      permissions: ["documents.read"],
      filters: [...period, party, { kind: "documentType", direction }, statusFilter("comprobantes")],
      schema: DocumentsReportSchema,
      run: (db, _ctx, q) => documentsReport(db, direction, q),
    }),
    def({
      key: ar ? "clientes-cobranzas" : "proveedores-pagos",
      section,
      title: ar ? "Cobranzas" : "Pagos",
      description: "Operaciones del período con sus medios, lo imputado y lo pendiente de imputar.",
      permissions: [ar ? "collections.read" : "payments.read"],
      filters: [...period, party, statusFilter("operaciones")],
      schema: SettlementsReportSchema,
      run: (db, _ctx, q) => settlementsReport(db, direction, q),
    }),
    def({
      key: `${slug}-deuda`,
      section,
      title: ar ? "Deuda de clientes" : "Deuda con proveedores",
      description: "Saldo de cada tercero a una fecha: vencido, a vencer y créditos sin aplicar.",
      permissions: ["accounts.read"],
      filters: [cutoff, party],
      schema: CutoffSchema,
      run: (db, _ctx, q) => balancesReport(db, direction, q),
    }),
    def({
      key: `${slug}-vencimientos`,
      section,
      title: "Vencimientos",
      description: "Comprobantes pendientes ordenados por fecha de vencimiento.",
      permissions: ["accounts.read"],
      filters: [
        { kind: "date", name: "from", label: "Vencimiento desde", hint: "Vacío: incluye todo lo vencido." },
        { kind: "date", name: "to", label: "Vencimiento hasta", hint: "Por defecto, 30 días." },
        party,
      ],
      schema: DueReportSchema,
      run: (db, _ctx, q, today) => dueReport(db, direction, q, today),
    }),
    def({
      key: `${slug}-antiguedad`,
      section,
      title: "Antigüedad de saldos",
      description: "Tramos de 0–30 a más de 180 días, vencido y a vencer por separado.",
      permissions: ["accounts.read"],
      filters: [cutoff, party],
      schema: CutoffSchema,
      run: (db, _ctx, q) => agingReport(db, direction, q),
    }),
    def({
      key: `${slug}-cuenta-corriente`,
      section,
      title: "Cuenta corriente",
      description: "Resumen de cuenta de un tercero con saldo progresivo.",
      permissions: ["accounts.read"],
      filters: [...period, { kind: "party", direction, required: true }],
      schema: StatementReportSchema,
      run: (db, ctx, q) => statementReport(db, ctx, direction, q),
    }),
    def({
      key: `${slug}-retenciones`,
      section,
      title: ar ? "Retenciones sufridas" : "Retenciones practicadas",
      description: ar ? "Retenciones informadas en cobranzas, por impuesto." : "Retenciones aplicadas en pagos, por impuesto.",
      permissions: [ar ? "collections.read" : "payments.read"],
      filters: [...period, party],
      schema: PartyPeriodSchema,
      run: (db, _ctx, q) => retentionsReport(db, direction, q),
    }),
  ];
}

export const REPORTS: ReportDef[] = [
  ...sideReports("ISSUED"),
  ...sideReports("RECEIVED"),
  def({
    key: "libro-caja",
    section: "Tesorería",
    title: "Libro de caja",
    description: "Movimientos de una caja con saldo anterior, saldo progresivo y saldo final.",
    permissions: ["cash.read"],
    filters: [{ kind: "account", accountKind: "CASH" }, ...period],
    schema: LedgerReportSchema,
    run: (db, ctx, q) => ledgerReport(db, ctx, "CASH", q),
  }),
  def({
    key: "libro-banco",
    section: "Tesorería",
    title: "Libro de banco",
    description: "Movimientos de una cuenta bancaria con saldo progresivo.",
    permissions: ["banks.read"],
    filters: [{ kind: "account", accountKind: "BANK" }, ...period],
    schema: LedgerReportSchema,
    run: (db, ctx, q) => ledgerReport(db, ctx, "BANK", q),
  }),
  def({
    key: "cartera-cheques",
    section: "Tesorería",
    title: "Cartera de cheques",
    description: "Cheques de terceros por estado y fecha de pago.",
    permissions: ["checks.read"],
    filters: [
      {
        kind: "select",
        name: "status",
        label: "Estado",
        options: [
          { value: "IN_PORTFOLIO", label: "En cartera" },
          { value: "DEPOSITED", label: "Depositados a acreditar" },
          { value: "REJECTED", label: "Rechazados" },
          { value: "ENDORSED", label: "Endosados" },
          { value: "ALL", label: "Todos" },
        ],
      },
    ],
    schema: ReceivedChecksReportSchema,
    run: (db, _ctx, q, today) => receivedChecksReport(db, q, today),
  }),
  def({
    key: "cheques-emitidos",
    section: "Tesorería",
    title: "Cheques emitidos",
    description: "Cheques propios por estado y fecha de pago.",
    permissions: ["checks.read"],
    filters: [
      {
        kind: "select",
        name: "status",
        label: "Estado",
        options: [
          { value: "PENDING", label: "Pendientes de débito" },
          { value: "DEBITED", label: "Debitados" },
          { value: "REJECTED", label: "Rechazados" },
          { value: "ALL", label: "Todos" },
        ],
      },
    ],
    schema: IssuedChecksReportSchema,
    run: (db, _ctx, q, today) => issuedChecksReport(db, q, today),
  }),
  def({
    key: "ingresos-egresos",
    section: "Tesorería",
    title: "Ingresos y egresos por concepto",
    description: "Movimientos reales del período agrupados por concepto.",
    permissions: ["treasury.read"],
    filters: period,
    schema: PeriodSchema,
    run: (db, ctx, q) => conceptsReport(db, ctx, q),
  }),
  def({
    key: "flujo-de-fondos",
    section: "Tesorería",
    title: "Flujo de fondos",
    description: "Saldo real, ingresos y egresos proyectados por semana o por mes.",
    permissions: ["treasury.read"],
    filters: [
      { kind: "date", name: "start", label: "Desde", hint: "Hoy o una fecha anterior." },
      {
        kind: "select",
        name: "view",
        label: "Vista",
        options: [
          { value: "WEEK", label: "Semanal" },
          { value: "MONTH", label: "Mensual" },
        ],
      },
      { kind: "number", name: "periods", label: "Cantidad de períodos", min: 1, max: 24 },
    ],
    schema: CashFlowSchema,
    run: (db, _ctx, q, today) => cashFlowReport(db, q, today),
  }),
  def({
    key: "iva-ventas",
    section: "Comprobantes e IVA",
    title: "Subdiario de IVA ventas",
    description: "Comprobantes emitidos por período de IVA, con neto e IVA por alícuota y percepciones.",
    permissions: ["documents.read"],
    filters: [
      { kind: "month", name: "from", label: "Período desde" },
      { kind: "month", name: "to", label: "Período hasta" },
    ],
    schema: VatBookSchema,
    run: (db, _ctx, q) => vatBookReport(db, "ISSUED", q),
  }),
  def({
    key: "iva-compras",
    section: "Comprobantes e IVA",
    title: "Subdiario de IVA compras",
    description: "Comprobantes recibidos por período de IVA, con neto e IVA por alícuota y percepciones.",
    permissions: ["documents.read"],
    filters: [
      { kind: "month", name: "from", label: "Período desde" },
      { kind: "month", name: "to", label: "Período hasta" },
    ],
    schema: VatBookSchema,
    run: (db, _ctx, q) => vatBookReport(db, "RECEIVED", q),
  }),
];

export const REPORT_SECTIONS: ReportSection[] = ["Clientes", "Proveedores", "Tesorería", "Comprobantes e IVA"];

export function findReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

export const canReadReport = (ctx: Pick<ServiceContext, "permissions">, report: ReportDef) =>
  ctx.permissions.has("reports.read") && report.permissions.every((p) => ctx.permissions.has(p));

/** Ejecuta un reporte verificando reports.read y los permisos del módulo de origen. */
export async function runReport(db: DbOrTx, ctx: ServiceContext, key: string, params: Record<string, string | undefined>, today = todayIso()) {
  const report = findReport(key);
  if (!report) throw new DomainError("El reporte no existe.", "NOT_FOUND");
  assertPermission(ctx, "reports.read");
  for (const p of report.permissions) assertPermission(ctx, p);
  return report.run(db, ctx, params, today);
}
