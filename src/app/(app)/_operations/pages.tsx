import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, Input, Label, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { PrintButton } from "@/components/ui/print-button";
import { formatCuit } from "@/lib/cuit";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { openDebits, type AllocationRow } from "@/modules/allocations/service";
import { portfolioChecks } from "@/modules/checks/service";
import { OperationListSchema } from "@/modules/collections/schemas";
import { getCollection, listCollections, receiptData } from "@/modules/collections/service";
import { partyOptions } from "@/modules/documents/service";
import { companyHeader } from "@/modules/internal-docs/service";
import type { OperationLine } from "@/modules/internal-docs/types";
import { getPayment, listPayments, paymentOrderData } from "@/modules/payments/service";
import { retentionTaxes } from "@/modules/tax/service";
import { accountOptions, bankOptions } from "@/modules/treasury/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { AllocateCreditForm, AnnulOperationForm, ReverseAllocationButton } from "./forms";
import { InternalDocument } from "./internal-doc";
import { OperationForm } from "./operation-form";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export type OperationKind = "COLLECTION" | "PAYMENT";

const UI = {
  COLLECTION: {
    title: "Cobranzas",
    one: "Cobranza",
    basePath: "/cobranzas",
    newPath: "/cobranzas/nueva",
    newLabel: "Registrar cobranza",
    party: "Cliente",
    partyPath: "/clientes",
    accountPath: "/cuentas-corrientes/clientes",
    direction: "ISSUED",
    read: "collections.read",
    create: "collections.create",
    annul: "collections.annul",
    voucher: "Recibo",
    voucherPath: "recibo",
    pdfPath: "/api/recibos",
    documentsPath: "/comprobantes-emitidos",
  },
  PAYMENT: {
    title: "Pagos",
    one: "Pago",
    basePath: "/pagos",
    newPath: "/pagos/nuevo",
    newLabel: "Registrar pago",
    party: "Proveedor",
    partyPath: "/proveedores",
    accountPath: "/cuentas-corrientes/proveedores",
    direction: "RECEIVED",
    read: "payments.read",
    create: "payments.create",
    annul: "payments.annul",
    voucher: "Orden de pago",
    voucherPath: "orden-de-pago",
    pdfPath: "/api/ordenes-de-pago",
    documentsPath: "/comprobantes-recibidos",
  },
} as const;

export const METHOD_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  CHECK: "Cheque",
  OWN_CHECK: "Cheque propio",
  THIRD_PARTY_CHECK: "Cheque de terceros",
  RETENTION: "Retención",
};

const CHECK_STATUS: Record<string, string> = {
  IN_PORTFOLIO: "en cartera",
  DEPOSITED: "depositado",
  CREDITED: "acreditado",
  REJECTED: "rechazado",
  ENDORSED: "endosado",
  ANNULLED: "anulado",
  ISSUED: "emitido",
  DELIVERED: "entregado",
  PRESENTED: "presentado",
  DEBITED: "debitado",
};

function StatusBadge({ status, kind }: { status: string; kind: OperationKind }) {
  return status === "ANNULLED" ? <Badge tone="red">{kind === "COLLECTION" ? "Anulada" : "Anulado"}</Badge> : <Badge tone="green">Vigente</Badge>;
}

// ───────────────────────────── Listado ─────────────────────────────

export async function OperationListPage({ kind, searchParams }: { kind: OperationKind; searchParams: SearchParams }) {
  const ui = UI[kind];
  const { ctx, session } = await requirePagePermission(ui.read);
  const raw = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, first(v) || undefined]));
  const query = OperationListSchema.parse(raw);
  const [list, parties] = await Promise.all([kind === "COLLECTION" ? listCollections(db, ctx, query) : listPayments(db, ctx, query), partyOptions(db, ctx, ui.direction)]);
  const href = (page: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "" && k !== "page") sp.set(k, String(v));
    if (page > 1) sp.set("page", String(page));
    const s = sp.toString();
    return s ? `${ui.basePath}?${s}` : ui.basePath;
  };
  const rows = list.rows.map((r) =>
    "clientName" in r
      ? { id: r.id, date: r.date, partyName: r.clientName, voucher: r.receipt, total: r.total, unapplied: r.unapplied, status: r.status, methods: r.methods }
      : { id: r.id, date: r.date, partyName: r.supplierName, voucher: r.order, total: r.total, unapplied: r.unapplied, status: r.status, methods: r.methods },
  );

  return (
    <>
      <PageHeader
        title={ui.title}
        description={
          kind === "COLLECTION"
            ? "Cobranzas registradas con sus medios, imputaciones y recibo interno. Lo no imputado queda como saldo a favor del cliente."
            : "Pagos a proveedores con sus medios, imputaciones y orden de pago interna. Lo no imputado queda como anticipo."
        }
        actions={session.permissions.has(ui.create) && <LinkButton href={ui.newPath}>{ui.newLabel}</LinkButton>}
      />
      <Card className="mb-4 p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <div className="lg:col-span-2">
            <Label htmlFor="q">Buscar</Label>
            <Input id="q" name="q" defaultValue={query.q} placeholder={`N° de ${ui.voucher.toLowerCase()}, nombre o CUIT`} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="partyId">{ui.party}</Label>
            <Select id="partyId" name="partyId" defaultValue={query.partyId ?? ""} className="mt-1">
              <option value="">Todos</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.legalName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Estado</Label>
            <Select id="status" name="status" defaultValue={query.status ?? ""} className="mt-1">
              <option value="">Todas</option>
              <option value="ACTIVE">Vigentes</option>
              <option value="UNAPPLIED">Con saldo sin imputar</option>
              <option value="ANNULLED">Anuladas</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:col-span-2">
            <div>
              <Label htmlFor="from">Desde</Label>
              <Input id="from" name="from" type="date" defaultValue={query.from} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="to">Hasta</Label>
              <Input id="to" name="to" type="date" defaultValue={query.to} className="mt-1" />
            </div>
          </div>
          <div className="flex gap-2 lg:col-span-6">
            <button type="submit" className={buttonClass("secondary")}>
              Filtrar
            </button>
            <Link href={ui.basePath} className={buttonClass("ghost")}>
              Limpiar
            </Link>
          </div>
        </form>
      </Card>
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Fecha</Th>
              <Th>{ui.voucher}</Th>
              <Th>{ui.party}</Th>
              <Th>Medios</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Sin imputar</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <Td colSpan={7} className="py-8 text-center text-slate-500">
                  No hay {ui.title.toLowerCase()} con esos filtros.
                </Td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td>{formatDate(r.date)}</Td>
                <Td>
                  <Link href={`${ui.basePath}/${r.id}`} className="font-medium text-brand-700 hover:underline">
                    {r.voucher ?? `#${r.id}`}
                  </Link>
                </Td>
                <Td>{r.partyName}</Td>
                <Td className="whitespace-normal">{(r.methods ?? "").split(",").filter(Boolean).map((m) => METHOD_LABELS[m] ?? m).join(", ")}</Td>
                <Td className="text-right tabular-nums">{formatMoney(r.total)}</Td>
                <Td className="text-right tabular-nums">{r.status === "ACTIVE" ? formatMoney(r.unapplied) : "—"}</Td>
                <Td>
                  <StatusBadge status={r.status} kind={kind} />
                </Td>
              </tr>
            ))}
          </tbody>
          {list.count > 0 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <Td colSpan={4}>{list.count} registros (los totales no incluyen anuladas)</Td>
                <Td className="text-right tabular-nums">{formatMoney(list.total)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(list.unapplied)}</Td>
                <Td />
              </tr>
            </tfoot>
          )}
        </Table>
        <Pagination page={list.page} pageSize={50} total={list.count} href={href} />
      </Card>
    </>
  );
}

// ───────────────────────────── Alta ─────────────────────────────

export async function NewOperationPage({ kind, searchParams }: { kind: OperationKind; searchParams: SearchParams }) {
  const ui = UI[kind];
  const { ctx } = await requirePagePermission(ui.create);
  const parties = await partyOptions(db, ctx, ui.direction);
  const partyId = Number(first(searchParams.tercero));
  const party = Number.isSafeInteger(partyId) ? parties.find((p) => p.id === partyId) : undefined;

  if (!party) {
    return (
      <>
        <PageHeader title={ui.newLabel} description={`Paso 1: elija el ${ui.party.toLowerCase()}. Después se muestran sus comprobantes pendientes.`} />
        <Card className="max-w-xl p-5">
          <form method="get" className="space-y-4">
            <div>
              <Label htmlFor="tercero">{ui.party}</Label>
              <Select id="tercero" name="tercero" required defaultValue="" className="mt-1">
                <option value="" disabled>
                  Elija…
                </option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.legalName} {p.taxId ? `(${formatCuit(p.taxId)})` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <button type="submit" className={buttonClass()}>
              Continuar
            </button>
          </form>
        </Card>
      </>
    );
  }

  const [debits, accounts, banks, taxes, portfolio] = await Promise.all([
    openDebits(db, ui.direction, party.id),
    accountOptions(db),
    bankOptions(db),
    retentionTaxes(db),
    kind === "PAYMENT" ? portfolioChecks(db) : Promise.resolve([]),
  ]);
  const cashBoxes = accounts.filter((a) => a.value.startsWith("CASH:")).map((a) => ({ id: Number(a.value.slice(5)), name: a.label.replace(/^Caja · /, "") }));
  const bankAccounts = accounts.filter((a) => a.value.startsWith("BANK:")).map((a) => ({ id: Number(a.value.slice(5)), name: a.label.replace(/^Banco · /, "") }));
  const preselect = Number(first(searchParams.comprobante));

  return (
    <>
      <PageHeader
        title={ui.newLabel}
        description={`${ui.party}: ${party.legalName}. Cargue los medios, impute a los comprobantes pendientes y confirme.`}
        actions={
          <Link href={ui.newPath} className={buttonClass("ghost")}>
            Cambiar {ui.party.toLowerCase()}
          </Link>
        }
      />
      <OperationForm
        kind={kind}
        party={{ id: party.id, name: party.legalName }}
        idempotencyKey={randomUUID()}
        today={todayIso()}
        openDebits={debits}
        cashBoxes={cashBoxes}
        bankAccounts={bankAccounts}
        issuerBanks={banks.map((b) => ({ id: b.id, name: b.name }))}
        retentionTaxes={taxes}
        portfolio={portfolio.map((c) => ({ id: c.id, label: `${c.bankName} N° ${c.number} — ${c.drawerName} — pago ${formatDate(c.paymentDate)}`, amount: c.amount }))}
        preselect={Number.isSafeInteger(preselect) && preselect > 0 ? preselect : undefined}
      />
    </>
  );
}

// ───────────────────────────── Detalle ─────────────────────────────

function LineRows({ lines, kind }: { lines: OperationLine[]; kind: OperationKind }) {
  return (
    <>
      {lines.map((l) => {
        const checkHref = l.checkId ? (l.method === "OWN_CHECK" ? `/cheques/emitidos/${l.checkId}` : `/cheques/recibidos/${l.checkId}`) : null;
        const ledgerHref = l.account ? `${l.account.kind === "CASH" ? "/caja" : "/bancos"}/${l.account.id}` : null;
        return (
          <tr key={l.id}>
            <Td>{METHOD_LABELS[l.method] ?? l.method}</Td>
            <Td className="whitespace-normal">
              {l.detail}
              {checkHref && (
                <>
                  {" · "}
                  <Link href={checkHref} className="text-brand-700 hover:underline">
                    cheque {CHECK_STATUS[l.checkStatus ?? ""] ?? ""}
                  </Link>
                </>
              )}
              {ledgerHref && l.movementId && (
                <>
                  {" · "}
                  <Link href={ledgerHref} className="text-brand-700 hover:underline">
                    ver movimiento de {l.account!.kind === "CASH" ? "caja" : "banco"}
                  </Link>
                </>
              )}
              {kind === "COLLECTION" && l.method === "CHECK" && <span className="block text-xs text-slate-500">En cartera hasta depositarse: no mueve el banco.</span>}
            </Td>
            <Td className="text-right tabular-nums">{formatMoney(l.amount)}</Td>
          </tr>
        );
      })}
    </>
  );
}

export function AllocationsTable({ rows, canReverse, documentsPath, show }: { rows: AllocationRow[]; canReverse: boolean; documentsPath: string; show: "target" | "source" | "both" }) {
  if (!rows.length) return <p className="px-4 py-3 text-sm text-slate-600">Sin imputaciones.</p>;
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <Th>Fecha</Th>
          {show !== "source" && <Th>Comprobante imputado</Th>}
          {show !== "target" && <Th>Crédito aplicado</Th>}
          <Th className="text-right">Importe</Th>
          <Th>Estado</Th>
          {canReverse && <Th />}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((a) => {
          const sourceHref = a.sourceKind === "COLLECTION" ? `/cobranzas/${a.sourceId}` : a.sourceKind === "PAYMENT" ? `/pagos/${a.sourceId}` : `${documentsPath}/${a.sourceId}`;
          return (
            <tr key={a.id} className={a.status === "REVERSED" ? "text-slate-400" : ""}>
              <Td>{formatDate(a.date)}</Td>
              {show !== "source" && (
                <Td>
                  <Link href={`${documentsPath}/${a.targetId}`} className="text-brand-700 hover:underline">
                    {a.targetLabel}
                  </Link>
                </Td>
              )}
              {show !== "target" && (
                <Td>
                  <Link href={sourceHref} className="text-brand-700 hover:underline">
                    {a.sourceLabel}
                  </Link>
                </Td>
              )}
              <Td className="text-right tabular-nums">{formatMoney(a.amount)}</Td>
              <Td className="whitespace-normal">
                {a.status === "ACTIVE" ? (
                  <Badge tone="green">Activa</Badge>
                ) : (
                  <span title={a.reversalReason ?? undefined}>
                    <Badge tone="slate">Desimputada</Badge>
                    <span className="block text-xs">{a.reversalReason}</span>
                  </span>
                )}
              </Td>
              {canReverse && <Td>{a.status === "ACTIVE" && <ReverseAllocationButton id={a.id} label={`${formatMoney(a.amount)} de ${a.targetLabel}`} />}</Td>}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export async function OperationDetailPage({ kind, id, searchParams }: { kind: OperationKind; id: string; searchParams: SearchParams }) {
  const ui = UI[kind];
  const { ctx, session } = await requirePagePermission(ui.read);
  const opId = Number(id);
  if (!Number.isSafeInteger(opId) || opId <= 0) notFound();
  const data = kind === "COLLECTION" ? await getCollection(db, ctx, opId) : await getPayment(db, ctx, opId);
  if (!data) notFound();
  const op =
    "collection" in data
      ? { ...data.collection, date: data.collection.collectionDate, partyId: data.collection.clientId, partyName: data.clientName, partyTaxId: data.clientTaxId, voucher: data.receiptNumber }
      : { ...data.payment, date: data.payment.paymentDate, partyId: data.payment.supplierId, partyName: data.supplierName, partyTaxId: data.supplierTaxId, voucher: data.orderNumber };
  const active = op.status === "ACTIVE";
  const canAllocate = active && Number(op.unappliedAmount) > 0 && session.permissions.has("allocations.create");
  const debits = canAllocate ? await openDebits(db, ui.direction, op.partyId) : [];
  const today = todayIso();

  return (
    <>
      <PageHeader
        title={`${ui.one} ${op.voucher ?? `#${op.id}`}`}
        description={`${ui.party}: ${op.partyName} · ${formatDate(op.date)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton variant="secondary" href={`${ui.basePath}/${op.id}/${ui.voucherPath}`}>
              Ver {ui.voucher.toLowerCase()}
            </LinkButton>
            {session.permissions.has(ui.create) && (
              <LinkButton href={`${ui.newPath}?tercero=${op.partyId}`}>
                {kind === "COLLECTION" ? "Otra cobranza de este cliente" : "Otro pago a este proveedor"}
              </LinkButton>
            )}
          </div>
        }
      />
      {first(searchParams.registrada) === "1" && (
        <div className="mb-4">
          <Alert tone="success">
            {ui.one} registrad{kind === "COLLECTION" ? "a" : "o"} con {ui.voucher.toLowerCase()} {op.voucher}. Se generaron los movimientos de cuenta corriente y tesorería.{" "}
            <Link href={`${ui.basePath}/${op.id}/${ui.voucherPath}`} className="font-medium underline">
              Imprimir {ui.voucher.toLowerCase()}
            </Link>
          </Alert>
        </div>
      )}
      {!active && (
        <div className="mb-4">
          <Alert tone="warning">
            Anulad{kind === "COLLECTION" ? "a" : "o"} el {formatDateTime(op.annulledAt)}. Motivo: {op.annulReason}. Sus imputaciones, movimientos y cheques se revirtieron; el historial se conserva.
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="p-5">
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{ui.party}</dt>
                <dd className="mt-1">
                  <Link href={`${ui.partyPath}/${op.partyId}`} className="text-brand-700 hover:underline">
                    {op.partyName}
                  </Link>
                  <span className="block text-xs text-slate-500">{op.partyTaxId ? formatCuit(op.partyTaxId) : "Sin identificación"}</span>
                  <Link href={`${ui.accountPath}/${op.partyId}`} className="text-xs text-brand-700 hover:underline">
                    Ver cuenta corriente
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Total</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(op.totalAmount)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Sin imputar</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{active ? formatMoney(op.unappliedAmount) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Estado</dt>
                <dd className="mt-1">
                  <StatusBadge status={op.status} kind={kind} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Registró</dt>
                <dd className="mt-1">
                  {data.createdByName ?? "—"}
                  <span className="block text-xs text-slate-500">{formatDateTime(op.createdAt)}</span>
                </dd>
              </div>
              {op.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Observaciones</dt>
                  <dd className="mt-1 whitespace-pre-line">{op.notes}</dd>
                </div>
              )}
            </dl>
          </Card>
          <Card>
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">{kind === "COLLECTION" ? "Medios de cobro" : "Medios de pago"}</h2>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Medio</Th>
                  <Th>Detalle</Th>
                  <Th className="text-right">Importe</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <LineRows lines={data.lines} kind={kind} />
              </tbody>
            </Table>
          </Card>
          <Card>
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Imputaciones</h2>
            <AllocationsTable rows={data.allocations} canReverse={active && session.permissions.has("allocations.reverse")} documentsPath={ui.documentsPath} show="target" />
          </Card>
          {canAllocate && (
            <Card className="p-4">
              <h2 className="mb-3 font-semibold text-slate-900">Imputar el saldo sin aplicar</h2>
              <AllocateCreditForm source={{ kind, id: op.id }} available={op.unappliedAmount} openDebits={debits} today={today} />
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card className="space-y-2 p-4 text-sm">
            <h2 className="font-semibold text-slate-900">{ui.voucher} interno</h2>
            <p className="text-slate-600">Documento interno, no válido como comprobante fiscal.</p>
            <div className="flex flex-wrap gap-2">
              <LinkButton variant="secondary" href={`${ui.basePath}/${op.id}/${ui.voucherPath}`}>
                Ver e imprimir
              </LinkButton>
              <a href={`${ui.pdfPath}/${op.id}/pdf`} className={buttonClass("secondary")}>
                Descargar PDF
              </a>
            </div>
          </Card>
          {active && session.permissions.has(ui.annul) && (
            <Card className="p-4">
              <h2 className="mb-2 font-semibold text-slate-900">Anular</h2>
              <p className="mb-3 text-sm text-slate-600">
                {kind === "COLLECTION"
                  ? "Solo si los cheques recibidos siguen en cartera. Si un cheque fue rechazado, registre el rechazo desde Cheques."
                  : "Solo si los cheques propios siguen entregados (no presentados ni debitados) y los endosados no fueron rechazados."}
              </p>
              <AnnulOperationForm kind={kind} id={op.id} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── Recibo / orden de pago ─────────────────────────────

export async function InternalDocumentPage({ kind, id }: { kind: OperationKind; id: string }) {
  const ui = UI[kind];
  const { ctx } = await requirePagePermission(ui.read);
  const opId = Number(id);
  if (!Number.isSafeInteger(opId) || opId <= 0) notFound();
  const [data, company] = await Promise.all([kind === "COLLECTION" ? receiptData(db, ctx, opId) : paymentOrderData(db, ctx, opId), companyHeader(db)]);
  if (!data) notFound();
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href={`${ui.basePath}/${opId}`} className="text-sm text-brand-700 hover:underline">
          ← Volver a {kind === "COLLECTION" ? "la cobranza" : "el pago"}
        </Link>
        <div className="flex gap-2">
          <PrintButton />
          <a href={`${ui.pdfPath}/${opId}/pdf`} className={buttonClass("secondary")}>
            Descargar PDF
          </a>
        </div>
      </div>
      {!company && (
        <div className="no-print mb-4">
          <Alert tone="warning">Faltan los datos de la empresa en la configuración: el encabezado sale incompleto.</Alert>
        </div>
      )}
      <InternalDocument data={data} company={company} />
    </>
  );
}
