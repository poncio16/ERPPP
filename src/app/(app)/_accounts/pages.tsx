import Decimal from "decimal.js";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, Input, Label, PageHeader, Pagination, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { PrintButton } from "@/components/ui/print-button";
import { formatCuit } from "@/lib/cuit";
import { DomainError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_FILTERS, AccountListSchema, StatementSchema, type AccountFilter } from "@/modules/accounts/schemas";
import { accountDetail, listAccounts, type CompositionItem, type StatementRow } from "@/modules/accounts/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import type { Direction } from "@/server/db/schema";
import { ACCOUNT_UI } from "./config";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const plain = (sp: SearchParams) => Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, first(v) || undefined]));

const FILTER_LABELS: Record<AccountFilter, string> = {
  WITH_BALANCE: "Con movimientos pendientes",
  DEBT: "Con deuda",
  OVERDUE: "Con vencidos",
  CREDIT: "Con saldo a favor",
  ALL: "Todos",
};

/** Saldo con su lectura: positivo = deuda del tercero; negativo = saldo a favor. */
function BalanceText({ value }: { value: string }) {
  const credit = value.startsWith("-");
  return <span className={credit ? "text-emerald-700" : undefined}>{formatMoney(value)}</span>;
}

export async function AccountListPage({ direction, searchParams }: { direction: Direction; searchParams: SearchParams }) {
  const ui = ACCOUNT_UI[direction];
  const { ctx } = await requirePagePermission("accounts.read");
  const query = AccountListSchema.parse(plain(searchParams));
  const list = await listAccounts(db, ctx, direction, query);
  const href = (page: number) => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (query.filter !== "WITH_BALANCE") sp.set("filter", query.filter);
    if (page > 1) sp.set("page", String(page));
    const s = sp.toString();
    return s ? `${ui.basePath}?${s}` : ui.basePath;
  };

  return (
    <>
      <PageHeader title={ui.title} description="Saldos surgidos del libro de movimientos. Un saldo negativo es saldo a favor del tercero." />
      <Card className="mb-4 p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
          <div>
            <Label htmlFor="q">Buscar</Label>
            <Input id="q" name="q" defaultValue={query.q} placeholder="Razón social, código o CUIT" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="filter">Mostrar</Label>
            <Select id="filter" name="filter" defaultValue={query.filter} className="mt-1">
              {ACCOUNT_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {FILTER_LABELS[f]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
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
              <Th>{ui.party}</Th>
              <Th className="text-right">Vencido</Th>
              <Th className="text-right">A vencer</Th>
              <Th className="text-right">Saldo a favor</Th>
              <Th className="text-right">Saldo</Th>
              <Th>Último movimiento</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.rows.length === 0 && (
              <tr>
                <Td colSpan={6} className="py-8 text-center text-slate-500">
                  No hay cuentas con esos filtros.
                </Td>
              </tr>
            )}
            {list.rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`${ui.basePath}/${r.id}`} className="font-medium text-brand-700 hover:underline">
                    {r.legalName}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    {r.code}
                    {r.taxId ? ` · ${formatCuit(r.taxId)}` : ""}
                    {r.status !== "ACTIVE" ? " · inactivo" : ""}
                  </span>
                </Td>
                <Td className={`text-right tabular-nums ${r.overdue !== "0.00" ? "text-red-700" : ""}`}>{formatMoney(r.overdue)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(r.notDue)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(r.credit)}</Td>
                <Td className="text-right font-medium tabular-nums">
                  <BalanceText value={r.balance} />
                </Td>
                <Td>{formatDate(r.lastEntryDate)}</Td>
              </tr>
            ))}
          </tbody>
          {list.total > 0 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <Td>{list.total} cuentas</Td>
                <Td className="text-right tabular-nums">{formatMoney(list.totals.overdue)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(list.totals.notDue)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(list.totals.credit)}</Td>
                <Td className="text-right tabular-nums">
                  <BalanceText value={list.totals.balance} />
                </Td>
                <Td />
              </tr>
            </tfoot>
          )}
        </Table>
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} href={href} />
      </Card>
    </>
  );
}

const ENTRY_LABELS: Record<StatementRow["entryType"], string> = { DOCUMENT: "Comprobante", COLLECTION: "Cobranza", PAYMENT: "Pago", REVERSAL: "Anulación" };

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" | "green" }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-slate-900"}`}>{value}</dd>
    </div>
  );
}

function CompositionTable({ title, items, empty, basePath, kind }: { title: string; items: CompositionItem[]; empty: string; basePath: string; kind: "debt" | "credit" }) {
  return (
    <Card>
      <h2 className="border-b border-slate-100 px-4 py-3 font-medium text-slate-900">{title}</h2>
      <Table>
        <thead className="bg-slate-50">
          <tr>
            <Th>Fecha</Th>
            <Th>{kind === "debt" ? "Comprobante" : "Crédito"}</Th>
            {kind === "debt" && <Th>Vencimiento</Th>}
            <Th className="text-right">Total</Th>
            <Th className="text-right">{kind === "debt" ? "Pendiente" : "Disponible"}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.length === 0 && (
            <tr>
              <Td colSpan={kind === "debt" ? 5 : 4} className="text-slate-500">
                {empty}
              </Td>
            </tr>
          )}
          {items.map((i) => (
            <tr key={`${i.kind}-${i.id}`}>
              <Td>{formatDate(i.date)}</Td>
              <Td>
                {i.kind === "DOCUMENT" ? (
                  <Link href={`${basePath}/${i.id}`} className="text-brand-700 hover:underline">
                    {i.description}
                  </Link>
                ) : (
                  i.description
                )}
              </Td>
              {kind === "debt" && (
                <Td>
                  {formatDate(i.dueDate)}
                  {i.daysOverdue !== null && i.daysOverdue > 0 && (
                    <span className="ml-2">
                      <Badge tone="red">{i.daysOverdue} días vencido</Badge>
                    </span>
                  )}
                </Td>
              )}
              <Td className="text-right tabular-nums">{formatMoney(i.total)}</Td>
              <Td className="text-right font-medium tabular-nums">{formatMoney(i.open)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

export async function AccountDetailPage({ direction, id, searchParams }: { direction: Direction; id: string; searchParams: SearchParams }) {
  const ui = ACCOUNT_UI[direction];
  const { ctx, session } = await requirePagePermission("accounts.read");
  const partyId = Number(id);
  if (!Number.isSafeInteger(partyId) || partyId <= 0) notFound();
  const query = StatementSchema.parse(plain(searchParams));
  const { party, summary, statement, composition } = await accountDetail(db, ctx, direction, partyId, query).catch((e: unknown) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const exportHref = `/api/cuentas-corrientes/${ui.side}/${party.id}/excel?from=${statement.from}&to=${statement.to}`;
  const overLimit = party.creditLimit !== null && new Decimal(party.creditLimit).isPositive() && new Decimal(summary.balance).greaterThan(party.creditLimit);

  return (
    <>
      <PageHeader
        title={party.legalName}
        description={`Cuenta corriente · ${ui.party} ${party.code}${party.taxId ? ` · CUIT ${formatCuit(party.taxId)}` : ""}`}
        actions={
          <div className="no-print flex gap-2">
            <Link href={`${ui.partyPath}/${party.id}`} className={buttonClass("ghost")}>
              Ficha del {ui.party.toLowerCase()}
            </Link>
            {session.permissions.has("reports.export") && (
              <a href={exportHref} className={buttonClass("secondary")}>
                Exportar a Excel
              </a>
            )}
            <PrintButton />
          </div>
        }
      />
      {summary.difference !== "0.00" && (
        <div className="mb-4">
          <Alert tone="error">
            El saldo del libro no coincide con la composición por comprobantes (diferencia {formatMoney(summary.difference)}). Informe al administrador.
          </Alert>
        </div>
      )}
      <Card className="mb-6 p-5">
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Saldo total" value={formatMoney(summary.balance)} tone={summary.balance.startsWith("-") ? "green" : undefined} />
          <Stat label="Vencido" value={formatMoney(summary.overdue)} tone={summary.overdue !== "0.00" ? "red" : undefined} />
          <Stat label="A vencer" value={formatMoney(summary.notDue)} />
          <Stat label="Saldo a favor" value={formatMoney(summary.credit)} tone={summary.credit !== "0.00" ? "green" : undefined} />
          <Stat label="Última operación" value={formatDate(summary.lastEntryDate)} />
          <Stat label={ui.billed} value={formatMoney(summary.billed)} />
          <Stat label={ui.settled} value={formatMoney(summary.settled)} />
          <Stat label={ui.lastSettlement} value={formatDate(summary.lastSettlementDate)} />
          {party.creditLimit !== null && <Stat label="Límite de crédito" value={formatMoney(party.creditLimit)} tone={overLimit ? "red" : undefined} />}
          <Stat label="Plazo" value={`${party.creditDays} días`} />
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          Saldo positivo: deuda del {ui.party.toLowerCase()}. Saldo negativo: saldo a favor. Los totales del período corresponden al {formatDate(statement.from)} – {formatDate(statement.to)}.
        </p>
      </Card>

      <Card className="mb-6">
        <div className="no-print flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="font-medium text-slate-900">Movimientos</h2>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="from">Desde</Label>
              <Input id="from" name="from" type="date" defaultValue={statement.from} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="to">Hasta</Label>
              <Input id="to" name="to" type="date" defaultValue={statement.to} className="mt-1" />
            </div>
            <button type="submit" className={buttonClass("secondary")}>
              Ver período
            </button>
          </form>
        </div>
        <p className="hidden px-4 py-2 text-sm print:block">
          Movimientos del {formatDate(statement.from)} al {formatDate(statement.to)}
        </p>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Fecha</Th>
              <Th>Tipo</Th>
              <Th>Comprobante / concepto</Th>
              <Th className="text-right">Débito</Th>
              <Th className="text-right">Crédito</Th>
              <Th className="text-right">Saldo</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50/50">
              <Td>{formatDate(statement.from)}</Td>
              <Td colSpan={4} className="text-slate-600">
                Saldo anterior
              </Td>
              <Td className="text-right tabular-nums">
                <BalanceText value={statement.opening} />
              </Td>
            </tr>
            {statement.rows.length === 0 && (
              <tr>
                <Td colSpan={6} className="text-slate-500">
                  Sin movimientos en el período.
                </Td>
              </tr>
            )}
            {statement.rows.map((r) => (
              <tr key={r.id}>
                <Td>{formatDate(r.entryDate)}</Td>
                <Td>{ENTRY_LABELS[r.entryType]}</Td>
                <Td>
                  {r.documentId ? (
                    <Link href={`${ui.documentsPath}/${r.documentId}`} className="text-brand-700 hover:underline">
                      {r.description}
                    </Link>
                  ) : (
                    r.description
                  )}
                  {r.voucherNumber && <span className="text-slate-500"> · {r.voucherNumber}</span>}
                </Td>
                <Td className="text-right tabular-nums">{r.debit !== "0.00" ? formatMoney(r.debit) : ""}</Td>
                <Td className="text-right tabular-nums">{r.credit !== "0.00" ? formatMoney(r.credit) : ""}</Td>
                <Td className="text-right tabular-nums">
                  <BalanceText value={r.balance} />
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-medium">
            <tr>
              <Td colSpan={3}>Totales del período y saldo al {formatDate(statement.to)}</Td>
              <Td className="text-right tabular-nums">{formatMoney(statement.totalDebit)}</Td>
              <Td className="text-right tabular-nums">{formatMoney(statement.totalCredit)}</Td>
              <Td className="text-right tabular-nums">
                <BalanceText value={statement.closing} />
              </Td>
            </tr>
          </tfoot>
        </Table>
      </Card>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">Composición del saldo</h2>
      <div className="space-y-6">
        <CompositionTable title="Comprobantes con saldo pendiente" items={composition.debts} empty="No hay comprobantes pendientes." basePath={ui.documentsPath} kind="debt" />
        <CompositionTable
          title="Créditos sin aplicar"
          items={composition.credits}
          empty="No hay saldo a favor."
          basePath={ui.documentsPath}
          kind="credit"
        />
      </div>
      <Card className="mt-4 p-4 text-sm">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="inline text-slate-600">Pendiente: </dt>
            <dd className="inline font-medium tabular-nums">{formatMoney(composition.totalDebt)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-600">Créditos sin aplicar: </dt>
            <dd className="inline font-medium tabular-nums">{composition.totalCredit === "0.00" ? formatMoney("0") : `−${formatMoney(composition.totalCredit)}`}</dd>
          </div>
          <div>
            <dt className="inline text-slate-600">Saldo: </dt>
            <dd className="inline font-semibold tabular-nums">
              <BalanceText value={composition.net} />
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          Las notas de crédito y {direction === "ISSUED" ? "cobranzas" : "pagos"} sin imputar figuran como créditos hasta aplicarse a un comprobante.
        </p>
      </Card>
    </>
  );
}
