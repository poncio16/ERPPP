import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { cuitCheckDigit } from "@/lib/cuit";
import { allocateDef } from "@/modules/allocations/action-defs";
import { cashCheckDef, creditCheckDef, debitIssuedCheckDef, depositCheckDef, presentIssuedCheckDef, rejectIssuedCheckDef, rejectReceivedCheckDef } from "@/modules/checks/action-defs";
import { registerCollectionDef } from "@/modules/collections/action-defs";
import { registerIssuedDocumentDef, registerReceivedDocumentDef } from "@/modules/documents/action-defs";
import { createClientDef, createSupplierDef } from "@/modules/parties/action-defs";
import { registerPaymentDef } from "@/modules/payments/action-defs";
import { registerRefundDef } from "@/modules/refunds/action-defs";
import {
  bankMovementDef,
  cashMovementDef,
  createBankAccountDef,
  createCashBoxDef,
  registerOpeningDef,
  transferDef,
} from "@/modules/treasury/action-defs";
import { executeAction, type ActionDef } from "@/server/action";
import type { ServiceContext } from "@/server/context";
import type { Db } from "@/server/db/drizzle";

/**
 * Constructor de escenarios: registra operaciones a través de las mismas acciones que usa la
 * interfaz (permiso → validación → servicio → auditoría), de modo que cuentas corrientes, caja,
 * bancos, cheques y auditoría quedan exactamente como si las hubiera cargado un usuario.
 * Lo usan los datos de prueba de §45 (`db:seed:demo`) y la prueba global INT-GLB.
 *
 * Las fechas se expresan en días relativos a `today` (negativos = pasado) y las claves de
 * idempotencia se derivan de una etiqueta: el mismo escenario produce siempre los mismos datos.
 */

export type AccountKind = "CASH" | "BANK";
export interface Account {
  kind: AccountKind;
  id: number;
}
export const ref = (a: Account) => `${a.kind}:${a.id}`;

export type VatCode = "RI" | "MT" | "CF" | "EX";

export interface PartySpec {
  name: string;
  /** Prefijo de la CUIT (30 sociedades, 20/27 personas); el resto se deriva de `seed`. */
  cuitPrefix?: "20" | "27" | "30" | "33";
  seed: number;
  vat: VatCode;
  city: string;
  creditDays?: number;
  creditLimit?: string;
}

export interface DocumentSpec {
  /** Etiqueta única dentro del escenario (deriva la clave de idempotencia). */
  key: string;
  type: string;
  party: number;
  pointOfSale: number;
  number: number;
  /** Días relativos a hoy. */
  issue: number;
  due: number;
  /** Neto gravado al 21 %: el IVA se calcula y se carga discriminado. */
  net21?: string;
  /** Importe no gravado o IVA no discriminado (facturas B/C recibidas). */
  untaxed?: string;
  related?: number[];
  reason?: string;
}

export type CollectionLine =
  | { cash: number; amount: string }
  | { transfer: number; amount: string; reference: string; date?: number }
  | { check: CheckSpec };

export interface CheckSpec {
  amount: string;
  number: string;
  bank: string;
  drawerCuitSeed: number;
  drawerName: string;
  issue: number;
  payment: number;
  format?: "PHYSICAL" | "ECHEQ";
}

export type PaymentLine =
  | { cash: number; amount: string }
  | { transfer: number; amount: string; reference: string; date?: number }
  | { ownCheck: { bankAccount: number; amount: string; number: string; issue: number; payment: number } }
  | { endorse: number };

export type Allocation = [documentId: number, amount: string];

export class ScenarioError extends Error {}

/** CUIT válida y estable: prefijo + 8 dígitos derivados de `seed`, evitando el dígito verificador 10. */
export function cuitFor(prefix: string, seed: number): string {
  for (let n = seed; ; n += 7919) {
    const base = `${prefix}${String((n * 2654435761) % 1e8).padStart(8, "0")}`;
    let sum = 0;
    const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    for (let i = 0; i < 10; i++) sum += Number(base[i]) * w[i]!;
    if (11 - (sum % 11) !== 10) return base + cuitCheckDigit(base);
  }
}

/** UUID estable (formato v5) a partir de una etiqueta. */
export function stableUuid(label: string): string {
  const h = createHash("sha256").update(label).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const money = (v: Decimal.Value) => new Decimal(v).toFixed(2);

export class Scenario {
  private catalog = new Map<string, number>();

  constructor(
    readonly db: Db,
    readonly ctx: ServiceContext,
    readonly opts: { today: string; keyPrefix: string },
  ) {}

  /** Fecha a `days` días de hoy. */
  date(days: number) {
    return addDays(this.opts.today, days);
  }

  key(label: string) {
    return stableUuid(`${this.opts.keyPrefix}:${label}`);
  }

  async run<T = { id: number }>(def: ActionDef<never, unknown> | ActionDef, input: Record<string, unknown>, what: string): Promise<T> {
    const r = await executeAction(this.db, { ctx: this.ctx, mustChangePassword: false }, { ip: null, userAgent: "escenario", requestId: this.ctx.requestId }, def as ActionDef, input);
    if (!r.ok) {
      const detail = Object.entries(r.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v.join(" ")}`);
      throw new ScenarioError(`${what}: ${r.error}${detail.length ? ` (${detail.join("; ")})` : ""}`);
    }
    return r.data as T;
  }

  private async lookup(table: "vat_conditions" | "id_types" | "document_types" | "tax_catalog" | "banks" | "treasury_concepts", code: string) {
    const k = `${table}:${code}`;
    if (!this.catalog.has(k)) {
      const { rows } = await this.db.execute<{ id: string }>(sql`SELECT id FROM ${sql.identifier(table)} WHERE code = ${code}`);
      if (!rows[0]) throw new ScenarioError(`No existe ${code} en ${table}: ejecute primero npm run db:seed`);
      this.catalog.set(k, Number(rows[0].id));
    }
    return this.catalog.get(k)!;
  }

  // ---------------------------------------------------------------- terceros

  private async partyInput(p: PartySpec) {
    const prefix = p.cuitPrefix ?? (p.vat === "RI" || p.vat === "EX" ? "30" : "20");
    return {
      legalName: p.name,
      idTypeId: String(await this.lookup("id_types", "CUIT")),
      taxId: cuitFor(prefix, p.seed),
      vatConditionId: String(await this.lookup("vat_conditions", p.vat)),
      address: `Calle ${p.seed} 100`,
      city: p.city,
      creditDays: String(p.creditDays ?? 30),
      creditLimit: p.creditLimit ?? "",
    };
  }

  async client(p: PartySpec) {
    return (await this.run(createClientDef, await this.partyInput(p), `Cliente ${p.name}`)).id;
  }

  async supplier(p: PartySpec) {
    return (await this.run(createSupplierDef, await this.partyInput(p), `Proveedor ${p.name}`)).id;
  }

  // --------------------------------------------------------------- tesorería

  async cashBox(name: string): Promise<Account> {
    return { kind: "CASH", id: (await this.run(createCashBoxDef, { name }, `Caja ${name}`)).id };
  }

  async bankAccount(spec: { bank: string; number: string; name: string }): Promise<Account> {
    const input = { bankId: String(await this.lookup("banks", spec.bank)), accountType: "CC", accountNumber: spec.number, displayName: spec.name };
    return { kind: "BANK", id: (await this.run(createBankAccountDef, input, `Cuenta ${spec.name}`)).id };
  }

  async opening(label: string, account: Account, amount: string, days: number) {
    await this.run(registerOpeningDef, { idempotencyKey: this.key(`opening:${label}`), account: ref(account), date: this.date(days), amount: money(amount) }, `Saldo inicial ${label}`);
  }

  async movement(label: string, account: Account, direction: "IN" | "OUT", concept: string, amount: string, days: number, description: string) {
    const def = account.kind === "CASH" ? cashMovementDef : bankMovementDef;
    return (
      await this.run(
        def,
        {
          idempotencyKey: this.key(`movement:${label}`),
          account: ref(account),
          date: this.date(days),
          direction,
          conceptId: String(await this.lookup("treasury_concepts", concept)),
          amount: money(amount),
          description,
          confirmWarnings: "1",
        },
        `Movimiento ${label}`,
      )
    ).id;
  }

  async transfer(label: string, from: Account, to: Account, amount: string, days: number) {
    return (
      await this.run(
        transferDef,
        { idempotencyKey: this.key(`transfer:${label}`), from: ref(from), to: ref(to), date: this.date(days), amount: money(amount), description: label, confirmWarnings: "1" },
        `Transferencia ${label}`,
      )
    ).id;
  }

  // ------------------------------------------------------------ comprobantes

  async document(direction: "ISSUED" | "RECEIVED", d: DocumentSpec) {
    const input: Record<string, unknown> = {
      idempotencyKey: this.key(`document:${d.key}`),
      documentTypeId: String(await this.lookup("document_types", d.type)),
      pointOfSale: String(d.pointOfSale),
      number: String(d.number),
      partyId: String(d.party),
      issueDate: this.date(d.issue),
      dueDate: this.date(d.due),
      concept: "PRODUCTS",
      confirmWarnings: "1",
    };
    if (d.net21) {
      input.vatTaxId = [String(await this.lookup("tax_catalog", "IVA_21"))];
      input.vatBase = [money(d.net21)];
      input.vatAmount = [new Decimal(d.net21).mul("0.21").toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)];
    }
    if (d.untaxed) input.netUntaxed = money(d.untaxed);
    if (direction === "RECEIVED") input.vatPeriod = this.date(d.issue).slice(0, 7);
    if (d.reason) input.reason = d.reason;
    if (d.related?.length) input.relatedDocumentIds = d.related.map(String);
    const def = direction === "ISSUED" ? registerIssuedDocumentDef : registerReceivedDocumentDef;
    return (await this.run(def, input, `Comprobante ${d.key}`)).id;
  }

  issued(d: DocumentSpec) {
    return this.document("ISSUED", d);
  }

  received(d: DocumentSpec) {
    return this.document("RECEIVED", d);
  }

  // ------------------------------------------------------- cobranzas y pagos

  private async checkData(c: CheckSpec) {
    return {
      format: c.format ?? "PHYSICAL",
      checkType: c.payment > c.issue ? "DEFERRED" : "COMMON",
      issuerBankId: String(await this.lookup("banks", c.bank)),
      number: c.number,
      drawerTaxId: cuitFor("30", c.drawerCuitSeed),
      drawerName: c.drawerName,
      issueDate: this.date(c.issue),
      paymentDate: this.date(c.payment),
    };
  }

  /** Registra una cobranza y devuelve su id, el del recibo y los ids de los cheques recibidos (en el orden de las líneas). */
  async collection(label: string, client: number, days: number, lines: CollectionLine[], allocations: Allocation[] = []) {
    const raw = [];
    const checks: CheckSpec[] = [];
    for (const l of lines) {
      if ("cash" in l) raw.push({ method: "CASH", amount: money(l.amount), cashBoxId: l.cash });
      else if ("transfer" in l) raw.push({ method: "TRANSFER", amount: money(l.amount), bankAccountId: l.transfer, transferDate: this.date(l.date ?? days), transferReference: l.reference });
      else {
        raw.push({ method: "CHECK", amount: money(l.check.amount), check: await this.checkData(l.check) });
        checks.push(l.check);
      }
    }
    const data = await this.run<{ id: number; receiptId: number }>(
      registerCollectionDef,
      {
        idempotencyKey: this.key(`collection:${label}`),
        clientId: String(client),
        date: this.date(days),
        lines: JSON.stringify(raw),
        allocations: JSON.stringify(allocations.map(([documentId, amount]) => ({ documentId, amount: money(amount) }))),
        confirmWarnings: "1",
      },
      `Cobranza ${label}`,
    );
    const checkIds: number[] = [];
    for (const c of checks) {
      const { rows } = await this.db.execute<{ id: string }>(
        sql`SELECT id FROM received_checks WHERE number = ${c.number} AND drawer_tax_id = ${cuitFor("30", c.drawerCuitSeed)} AND status <> 'ANNULLED'`,
      );
      checkIds.push(Number(rows[0]!.id));
    }
    return { ...data, checkIds };
  }

  /** Registra un pago y devuelve su id, el de la orden de pago y los ids de los cheques propios emitidos. */
  async payment(label: string, supplier: number, days: number, lines: PaymentLine[], allocations: Allocation[] = []) {
    const raw = [];
    const own: { bankAccount: number; number: string }[] = [];
    for (const l of lines) {
      if ("cash" in l) raw.push({ method: "CASH", amount: money(l.amount), cashBoxId: l.cash });
      else if ("transfer" in l) raw.push({ method: "TRANSFER", amount: money(l.amount), bankAccountId: l.transfer, transferDate: this.date(l.date ?? days), transferReference: l.reference });
      else if ("endorse" in l) raw.push({ method: "THIRD_PARTY_CHECK", receivedCheckId: l.endorse });
      else {
        const c = l.ownCheck;
        raw.push({
          method: "OWN_CHECK",
          amount: money(c.amount),
          check: { bankAccountId: c.bankAccount, format: "ECHEQ", checkType: c.payment > c.issue ? "DEFERRED" : "COMMON", number: c.number, issueDate: this.date(c.issue), paymentDate: this.date(c.payment) },
        });
        own.push(c);
      }
    }
    const data = await this.run<{ id: number; orderId: number }>(
      registerPaymentDef,
      {
        idempotencyKey: this.key(`payment:${label}`),
        supplierId: String(supplier),
        date: this.date(days),
        lines: JSON.stringify(raw),
        allocations: JSON.stringify(allocations.map(([documentId, amount]) => ({ documentId, amount: money(amount) }))),
        confirmWarnings: "1",
      },
      `Pago ${label}`,
    );
    const issuedCheckIds: number[] = [];
    for (const c of own) {
      const { rows } = await this.db.execute<{ id: string }>(
        sql`SELECT id FROM issued_checks WHERE bank_account_id = ${c.bankAccount} AND number = ${c.number} AND status <> 'ANNULLED'`,
      );
      issuedCheckIds.push(Number(rows[0]!.id));
    }
    return { ...data, issuedCheckIds };
  }

  async allocate(label: string, sourceKind: "COLLECTION" | "PAYMENT" | "CREDIT_DOCUMENT", sourceId: number, items: Allocation[]) {
    await this.run(
      allocateDef,
      { sourceKind, sourceId: String(sourceId), allocations: JSON.stringify(items.map(([documentId, amount]) => ({ documentId, amount: money(amount) }))) },
      `Imputación ${label}`,
    );
  }

  async refund(label: string, sourceKind: "COLLECTION" | "PAYMENT" | "CREDIT_DOCUMENT", sourceId: number, amount: string, days: number, to: Account, reason: string) {
    return (
      await this.run(
        registerRefundDef,
        {
          idempotencyKey: this.key(`refund:${label}`),
          sourceKind,
          sourceId: String(sourceId),
          date: this.date(days),
          amount: money(amount),
          method: to.kind === "CASH" ? "CASH" : "TRANSFER",
          cashBoxId: to.kind === "CASH" ? String(to.id) : "",
          bankAccountId: to.kind === "BANK" ? String(to.id) : "",
          reason,
          confirmWarnings: "1",
        },
        `Devolución ${label}`,
      )
    ).id;
  }

  // ----------------------------------------------------------------- cheques

  private async version(table: "received_checks" | "issued_checks", id: number) {
    const { rows } = await this.db.execute<{ version: number }>(sql`SELECT version FROM ${sql.identifier(table)} WHERE id = ${id}`);
    return String(rows[0]!.version);
  }

  async deposit(check: number, bank: Account, days: number) {
    await this.run(depositCheckDef, { id: String(check), version: await this.version("received_checks", check), date: this.date(days), bankAccountId: String(bank.id), confirmWarnings: "1" }, `Depósito del cheque ${check}`);
  }

  async credit(check: number, days: number) {
    await this.run(creditCheckDef, { id: String(check), version: await this.version("received_checks", check), date: this.date(days) }, `Acreditación del cheque ${check}`);
  }

  async cashCheck(check: number, account: Account, days: number) {
    await this.run(cashCheckDef, { id: String(check), version: await this.version("received_checks", check), date: this.date(days), account: ref(account), confirmWarnings: "1" }, `Cobro por ventanilla del cheque ${check}`);
  }

  async rejectReceived(check: number, days: number, reason: string) {
    await this.run(rejectReceivedCheckDef, { id: String(check), version: await this.version("received_checks", check), date: this.date(days), reason, confirmWarnings: "1" }, `Rechazo del cheque ${check}`);
  }

  async presentIssued(check: number, days: number) {
    await this.run(presentIssuedCheckDef, { id: String(check), version: await this.version("issued_checks", check), date: this.date(days), confirmWarnings: "1" }, `Presentación del cheque propio ${check}`);
  }

  async debitIssued(check: number, days: number) {
    await this.run(debitIssuedCheckDef, { id: String(check), version: await this.version("issued_checks", check), date: this.date(days), confirmWarnings: "1" }, `Débito del cheque propio ${check}`);
  }

  async rejectIssued(check: number, days: number, reason: string) {
    await this.run(rejectIssuedCheckDef, { id: String(check), version: await this.version("issued_checks", check), date: this.date(days), reason, confirmWarnings: "1" }, `Rechazo del cheque propio ${check}`);
  }
}
