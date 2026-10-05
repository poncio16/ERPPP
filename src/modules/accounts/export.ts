import ExcelJS from "exceljs";
import { recordAudit } from "@/modules/audit/service";
import { formatCuit } from "@/lib/cuit";
import { formatDate } from "@/lib/format";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db } from "@/server/db/drizzle";
import type { Direction } from "@/server/db/schema";
import type { StatementQuery } from "./schemas";
import { accountDetail } from "./service";

const ENTRY_LABELS = { DOCUMENT: "Comprobante", COLLECTION: "Cobranza", PAYMENT: "Pago", REVERSAL: "Anulación" } as const;
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

/**
 * Excel recibe importes como número binario: la conversión se hace recién aquí, al salir del
 * sistema, a partir de valores ya redondeados a 2 decimales con decimal.js.
 */
const num = (v: string) => Number(v);

/** Resumen de cuenta corriente en Excel (números reales, con formato y totales). Queda auditado. */
export async function exportStatementXlsx(db: Db, ctx: ServiceContext, direction: Direction, partyId: number, query: StatementQuery) {
  assertPermission(ctx, "reports.export");
  const { party, summary, statement, composition } = await accountDetail(db, ctx, direction, partyId, query);
  const partyLabel = direction === "ISSUED" ? "Cliente" : "Proveedor";

  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  wb.created = new Date();

  const ws = wb.addWorksheet("Cuenta corriente", { views: [{ state: "frozen", ySplit: 6 }] });
  ws.columns = [{ width: 12 }, { width: 14 }, { width: 44 }, { width: 16 }, { width: 16 }, { width: 16 }];
  ws.addRow([`Cuenta corriente · ${partyLabel}: ${party.legalName}`]).font = { bold: true, size: 13 };
  ws.addRow([`CUIT ${party.taxId ? formatCuit(party.taxId) : "—"} · Código ${party.code}`]);
  ws.addRow([`Período ${formatDate(statement.from)} al ${formatDate(statement.to)}`]);
  ws.addRow([]);
  ws.addRow(["", "", "Saldo anterior", "", "", num(statement.opening)]).getCell(6).numFmt = MONEY_FMT;
  const header = ws.addRow(["Fecha", "Tipo", "Comprobante / concepto", "Débito", "Crédito", "Saldo"]);
  header.font = { bold: true };
  header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } }));
  for (const r of statement.rows) {
    const row = ws.addRow([
      new Date(`${r.entryDate}T00:00:00Z`),
      ENTRY_LABELS[r.entryType],
      r.voucherNumber ? `${r.description} (${r.voucherNumber})` : r.description,
      r.debit === "0.00" ? null : num(r.debit),
      r.credit === "0.00" ? null : num(r.credit),
      num(r.balance),
    ]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    for (const i of [4, 5, 6]) row.getCell(i).numFmt = MONEY_FMT;
  }
  const total = ws.addRow(["", "", "Totales del período / saldo final", num(statement.totalDebit), num(statement.totalCredit), num(statement.closing)]);
  total.font = { bold: true };
  for (const i of [4, 5, 6]) total.getCell(i).numFmt = MONEY_FMT;

  const rs = wb.addWorksheet("Resumen");
  rs.columns = [{ width: 34 }, { width: 18 }];
  const add = (label: string, value: string | null, money = true) => {
    const row = rs.addRow([label, value === null ? "—" : money ? num(value) : formatDate(value)]);
    if (money) row.getCell(2).numFmt = MONEY_FMT;
  };
  rs.addRow([`${partyLabel}: ${party.legalName}`]).font = { bold: true };
  add("Saldo total", summary.balance);
  add("Vencido", summary.overdue);
  add("A vencer", summary.notDue);
  add("Saldo a favor (créditos sin aplicar)", summary.credit);
  add(direction === "ISSUED" ? "Total facturado del período" : "Total comprado del período", summary.billed);
  add(direction === "ISSUED" ? "Total cobrado del período" : "Total pagado del período", summary.settled);
  add("Última operación", summary.lastEntryDate, false);
  add(direction === "ISSUED" ? "Última cobranza" : "Último pago", summary.lastSettlementDate, false);

  const cs = wb.addWorksheet("Composición del saldo");
  cs.columns = [{ width: 12 }, { width: 44 }, { width: 12 }, { width: 10 }, { width: 16 }, { width: 16 }];
  const ch = cs.addRow(["Fecha", "Comprobante / operación", "Vencimiento", "Días", "Total", "Pendiente"]);
  ch.font = { bold: true };
  const addItem = (i: (typeof composition.debts)[number], sign: 1 | -1) => {
    const row = cs.addRow([
      new Date(`${i.date}T00:00:00Z`),
      i.description,
      i.dueDate ? new Date(`${i.dueDate}T00:00:00Z`) : null,
      i.daysOverdue,
      num(i.total),
      sign * num(i.open),
    ]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(3).numFmt = "dd/mm/yyyy";
    for (const c of [5, 6]) row.getCell(c).numFmt = MONEY_FMT;
  };
  composition.debts.forEach((i) => addItem(i, 1));
  composition.credits.forEach((i) => addItem(i, -1));
  const cn = cs.addRow(["", "Saldo", "", "", "", num(composition.net)]);
  cn.font = { bold: true };
  cn.getCell(6).numFmt = MONEY_FMT;

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await recordAudit(db, ctx, {
    module: "accounts",
    action: "export",
    entityType: direction === "ISSUED" ? "client" : "supplier",
    entityId: partyId,
    after: { format: "xlsx", from: statement.from, to: statement.to, rows: statement.rows.length },
  });
  const safe = party.code.replace(/[^A-Za-z0-9_-]/g, "");
  return { buffer, filename: `cuenta-corriente-${direction === "ISSUED" ? "cliente" : "proveedor"}-${safe}-${statement.to}.xlsx` };
}
