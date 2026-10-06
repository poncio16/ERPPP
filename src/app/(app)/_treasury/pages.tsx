import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, Input, Label, PageHeader, Pagination, Table, Td, Th, buttonClass } from "@/components/ui";
import { PrintButton } from "@/components/ui/print-button";
import { DomainError } from "@/lib/errors";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { LedgerQuerySchema, type AccountKind } from "@/modules/treasury/schemas";
import {
  accountBalance,
  accountLedger,
  accountOptions,
  bankOptions,
  cashClosureHistory,
  getTreasuryAccount,
  listTransfers,
  manualConcepts,
  treasuryOverview,
  type LedgerRow,
} from "@/modules/treasury/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import {
  AnnulTransferButton,
  CashClosureForm,
  EditBankAccountForm,
  EditCashBoxForm,
  ManualMovementForm,
  NewBankAccountForm,
  NewCashBoxForm,
  OpeningForm,
  ReverseMovementButton,
  TransferForm,
} from "./forms";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const UI = {
  CASH: { title: "Caja", basePath: "/caja", read: "cash.read", manual: "cash.manual_movement", account: "caja" },
  BANK: { title: "Bancos", basePath: "/bancos", read: "banks.read", manual: "banks.manual_movement", account: "cuenta" },
} as const;

const ORIGIN_LABELS: Record<LedgerRow["originType"], string> = {
  OPENING: "Saldo inicial",
  COLLECTION_LINE: "Cobranza",
  PAYMENT_LINE: "Pago",
  CHECK_EVENT: "Cheque",
  ACCOUNT_TRANSFER: "Transferencia interna",
  REFUND: "Devolución",
  MANUAL: "Manual",
  CASH_COUNT_DIFF: "Diferencia de arqueo",
  REVERSAL: "Reversión",
};

function Money({ value, strong }: { value: string; strong?: boolean }) {
  return <span className={`tabular-nums ${value.startsWith("-") ? "text-red-700" : ""} ${strong ? "font-semibold" : ""}`}>{formatMoney(value)}</span>;
}

// ───────────────────────────── Listados ─────────────────────────────

export async function TreasuryListPage({ kind }: { kind: AccountKind }) {
  const ui = UI[kind];
  const { ctx, session } = await requirePagePermission(ui.read);
  const [accounts, banks] = await Promise.all([treasuryOverview(db, ctx, kind), kind === "BANK" ? bankOptions(db) : Promise.resolve([])]);
  const active = accounts.filter((a) => a.active);
  const totalText = active.reduce((s, a) => s.plus(a.balance), new Decimal(0)).toFixed(2);
  const canConfig = session.permissions.has("config.manage");

  return (
    <>
      <PageHeader
        title={ui.title}
        description={kind === "CASH" ? "Saldos de cada caja según sus movimientos. El saldo no se edita: surge de ingresos y egresos." : "Saldo contable según movimientos y saldo disponible descontando cheques propios pendientes de débito."}
        actions={
          session.permissions.has("banks.transfer") && (
            <Link href="/transferencias" className={buttonClass("secondary")}>
              Transferencias entre cuentas
            </Link>
          )
        }
      />
      <Card className="mb-6">
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>{kind === "CASH" ? "Caja" : "Cuenta"}</Th>
              {kind === "BANK" && <Th className="text-right">Cheques pendientes</Th>}
              {kind === "BANK" && <Th className="text-right">Disponible</Th>}
              <Th className="text-right">{kind === "CASH" ? "Saldo" : "Saldo contable"}</Th>
              <Th>{kind === "CASH" ? "Último cierre" : "Último movimiento"}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.length === 0 && (
              <tr>
                <Td colSpan={5} className="py-8 text-center text-slate-500">
                  {kind === "CASH" ? "Todavía no hay cajas." : "Todavía no hay cuentas bancarias."} {canConfig ? "Créela abajo." : "Pídale al administrador que la cree."}
                </Td>
              </tr>
            )}
            {accounts.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`${ui.basePath}/${a.id}`} className="font-medium text-brand-700 hover:underline">
                    {a.name}
                  </Link>
                  {!a.active && (
                    <span className="ml-2">
                      <Badge>Inactiva</Badge>
                    </span>
                  )}
                  {!a.hasOpening && a.active && (
                    <span className="ml-2">
                      <Badge tone="amber">Sin saldo inicial</Badge>
                    </span>
                  )}
                  {kind === "BANK" && (
                    <span className="block text-xs text-slate-500">
                      {a.bankName} · {a.accountType === "CC" ? "Cuenta corriente" : "Caja de ahorro"} {a.accountNumber} · {a.currency}
                    </span>
                  )}
                </Td>
                {kind === "BANK" && (
                  <Td className="text-right">
                    <Money value={a.pendingChecks ?? "0"} />
                  </Td>
                )}
                {kind === "BANK" && (
                  <Td className="text-right">
                    <Money value={a.available ?? "0"} />
                  </Td>
                )}
                <Td className="text-right">
                  <Money value={a.balance} strong />
                </Td>
                <Td>{kind === "CASH" ? formatDate(a.lastClosure) : formatDate(a.lastMovement)}</Td>
              </tr>
            ))}
          </tbody>
          {active.length > 1 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <Td colSpan={kind === "BANK" ? 3 : 1}>Total de {kind === "CASH" ? "cajas" : "cuentas"} activas</Td>
                <Td className="text-right">
                  <Money value={totalText} strong />
                </Td>
                <Td />
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
      {canConfig && (
        <Card className="p-5">
          <h2 className="mb-3 font-medium text-slate-900">{kind === "CASH" ? "Agregar caja" : "Agregar cuenta bancaria"}</h2>
          {kind === "CASH" ? <NewCashBoxForm /> : <NewBankAccountForm banks={banks} />}
        </Card>
      )}
    </>
  );
}

// ───────────────────────────── Libro de una cuenta ─────────────────────────────

function originLink(r: LedgerRow) {
  if (r.transferId) return "/transferencias";
  if (r.collectionId) return `/cobranzas/${r.collectionId}`;
  if (r.paymentId) return `/pagos/${r.paymentId}`;
  if (r.receivedCheckId) return `/cheques/recibidos/${r.receivedCheckId}`;
  if (r.issuedCheckId) return `/cheques/emitidos/${r.issuedCheckId}`;
  return null;
}

export async function TreasuryAccountPage({ kind, id, searchParams }: { kind: AccountKind; id: string; searchParams: SearchParams }) {
  const ui = UI[kind];
  const { ctx, session } = await requirePagePermission(ui.read);
  const accountId = Number(id);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) notFound();
  const ref = { kind, id: accountId };
  const account = await getTreasuryAccount(db, ctx, ref).catch((e: unknown) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const query = LedgerQuerySchema.parse({ from: first(searchParams.from) || undefined, to: first(searchParams.to) || undefined });
  const today = todayIso();
  const [ledger, concepts, closures] = await Promise.all([
    accountLedger(db, ctx, ref, query),
    manualConcepts(db),
    kind === "CASH" ? cashClosureHistory(db, ctx, accountId) : Promise.resolve([]),
  ]);
  const can = (p: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(p);
  const canManual = can(ui.manual) && account.active;
  const systemToday = (await accountBalance(db, ref, today)).toFixed(2);

  return (
    <>
      <PageHeader
        title={account.name}
        description={
          kind === "CASH"
            ? `Caja en ${account.currency}${account.lastClosure ? ` · cerrada hasta el ${formatDate(account.lastClosure)}` : ""}`
            : `${account.bankName} · ${account.accountType === "CC" ? "Cuenta corriente" : "Caja de ahorro"} ${account.accountNumber}${account.cbu ? ` · CBU ${account.cbu}` : ""}${account.alias ? ` · Alias ${account.alias}` : ""}`
        }
        actions={
          <div className="no-print flex gap-2">
            <Link href={ui.basePath} className={buttonClass("ghost")}>
              Volver
            </Link>
            <PrintButton />
          </div>
        }
      />
      {!account.active && (
        <div className="mb-4">
          <Alert tone="warning">Esta {ui.account} está inactiva: no admite movimientos nuevos.</Alert>
        </div>
      )}
      <Card className="mb-6 p-5">
        <dl className="grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{kind === "CASH" ? "Saldo" : "Saldo contable"}</dt>
            <dd className="mt-1 text-xl font-semibold">
              <Money value={account.balance} />
            </dd>
          </div>
          {kind === "BANK" && (
            <>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Cheques propios pendientes</dt>
                <dd className="mt-1 text-xl font-semibold">
                  <Money value={account.pendingChecks ?? "0"} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Saldo disponible</dt>
                <dd className="mt-1 text-xl font-semibold">
                  <Money value={account.available ?? "0"} />
                </dd>
              </div>
            </>
          )}
          {kind === "CASH" && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Último cierre</dt>
              <dd className="mt-1 text-xl font-semibold">{formatDate(account.lastClosure)}</dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="space-y-6">
        <Card>
          <div className="no-print flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <h2 className="font-medium text-slate-900">Movimientos</h2>
            <form method="get" className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="from">Desde</Label>
                <Input id="from" name="from" type="date" defaultValue={ledger.from} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="to">Hasta</Label>
                <Input id="to" name="to" type="date" defaultValue={ledger.to} className="mt-1" />
              </div>
              <button type="submit" className={buttonClass("secondary")}>
                Ver período
              </button>
            </form>
          </div>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Fecha</Th>
                <Th>Concepto</Th>
                <Th className="text-right">Ingreso</Th>
                <Th className="text-right">Egreso</Th>
                <Th className="text-right">Saldo</Th>
                <Th className="no-print">Origen</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/50">
                <Td>{formatDate(ledger.from)}</Td>
                <Td colSpan={3} className="text-slate-600">
                  Saldo anterior
                </Td>
                <Td className="text-right">
                  <Money value={ledger.opening} />
                </Td>
                <Td className="no-print" />
              </tr>
              {ledger.rows.length === 0 && (
                <tr>
                  <Td colSpan={6} className="text-slate-500">
                    Sin movimientos en el período.
                  </Td>
                </tr>
              )}
              {ledger.rows.map((r) => {
                const link = originLink(r);
                return (
                  <tr key={r.id} className={r.reversedById ? "text-slate-400" : undefined}>
                    <Td>
                      {formatDate(r.date)}
                      {r.valueDate && r.valueDate !== r.date && <span className="block text-xs text-slate-500">Valor {formatDate(r.valueDate)}</span>}
                    </Td>
                    <Td>
                      <div className="max-w-md whitespace-normal">
                        <span className="font-medium">{r.concept}</span>
                        <span className="block text-xs text-slate-500">
                          {r.description}
                          {r.reference ? ` · Ref. ${r.reference}` : ""}
                          {r.username ? ` · ${r.username}` : ""}
                        </span>
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{r.direction === "IN" ? formatMoney(r.amount) : ""}</Td>
                    <Td className="text-right tabular-nums">{r.direction === "OUT" ? formatMoney(r.amount) : ""}</Td>
                    <Td className="text-right">
                      <Money value={r.balance} />
                    </Td>
                    <Td className="no-print">
                      {link ? (
                        <Link href={link} className="text-brand-700 hover:underline">
                          {ORIGIN_LABELS[r.originType]}
                        </Link>
                      ) : (
                        ORIGIN_LABELS[r.originType]
                      )}
                      {r.reversedById && <span className="block text-xs">Revertido</span>}
                      {r.originType === "MANUAL" && !r.reversedById && can(ui.manual) && (
                        <span className="block">
                          <ReverseMovementButton kind={kind} id={r.id} />
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <Td colSpan={2}>Totales y saldo al {formatDate(ledger.to)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(ledger.totalIn)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(ledger.totalOut)}</Td>
                <Td className="text-right">
                  <Money value={ledger.closing} strong />
                </Td>
                <Td className="no-print" />
              </tr>
            </tfoot>
          </Table>
        </Card>

        <div className="no-print grid items-start gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {!account.hasOpening && can("treasury.opening") && account.active && (
            <Card className="p-5">
              <h2 className="mb-3 font-medium text-slate-900">Saldo inicial</h2>
              <OpeningForm kind={kind} id={account.id} idempotencyKey={randomUUID()} today={today} />
            </Card>
          )}
          {canManual && (
            <Card className="p-5">
              <h2 className="mb-3 font-medium text-slate-900">Movimiento manual</h2>
              <ManualMovementForm kind={kind} id={account.id} concepts={concepts} idempotencyKey={randomUUID()} today={today} />
            </Card>
          )}
          {kind === "CASH" && can("cash.close") && account.active && (
            <Card className="p-5">
              <h2 className="mb-3 font-medium text-slate-900">Arqueo y cierre</h2>
              <CashClosureForm cashBoxId={account.id} today={today} systemBalanceToday={formatMoney(systemToday)} />
            </Card>
          )}
          {can("config.manage") && (
            <Card className="p-5">
              <h2 className="mb-3 font-medium text-slate-900">Datos de la {ui.account}</h2>
              {kind === "CASH" ? (
                <EditCashBoxForm id={account.id} name={account.name} active={account.active} />
              ) : (
                <EditBankAccountForm id={account.id} displayName={account.name} alias={account.alias} active={account.active} />
              )}
            </Card>
          )}
        </div>
      </div>

      {kind === "CASH" && closures.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-slate-100 px-4 py-3 font-medium text-slate-900">Cierres de caja</h2>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Fecha</Th>
                <Th className="text-right">Saldo del sistema</Th>
                <Th className="text-right">Contado</Th>
                <Th className="text-right">Diferencia</Th>
                <Th>Observaciones</Th>
                <Th>Cerró</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {closures.map((c) => (
                <tr key={c.id}>
                  <Td>{formatDate(c.date)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(c.system)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(c.counted)}</Td>
                  <Td className="text-right">
                    {c.difference === "0.00" ? <span className="text-slate-500">Sin diferencia</span> : <Money value={c.difference} strong />}
                  </Td>
                  <Td>
                    <div className="max-w-xs whitespace-normal">{c.notes}</div>
                  </Td>
                  <Td>
                    {c.username ?? "—"}
                    <span className="block text-xs text-slate-500">{formatDateTime(c.createdAt)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

// ───────────────────────────── Transferencias ─────────────────────────────

export async function TransfersPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, session } = await requirePagePermission("banks.read");
  const page = Math.max(1, Number(first(searchParams.page)) || 1);
  const [list, accounts] = await Promise.all([listTransfers(db, ctx, page), accountOptions(db)]);
  const canTransfer = session.permissions.has("banks.transfer");
  return (
    <>
      <PageHeader title="Transferencias entre cuentas propias" description="Depósitos de efectivo, extracciones y transferencias entre bancos propios. Cada una genera un egreso en el origen y un ingreso en el destino." />
      {canTransfer && (
        <Card className="mb-6 p-5">
          <h2 className="mb-3 font-medium text-slate-900">Nueva transferencia</h2>
          {accounts.length < 2 ? (
            <p className="text-sm text-slate-500">Se necesitan al menos dos cajas o cuentas activas.</p>
          ) : (
            <TransferForm accounts={accounts} idempotencyKey={randomUUID()} today={todayIso()} />
          )}
        </Card>
      )}
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Fecha</Th>
              <Th>Desde</Th>
              <Th>Hacia</Th>
              <Th className="text-right">Importe</Th>
              <Th>Descripción</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.rows.length === 0 && (
              <tr>
                <Td colSpan={6} className="py-8 text-center text-slate-500">
                  No hay transferencias registradas.
                </Td>
              </tr>
            )}
            {list.rows.map((t) => (
              <tr key={t.id} className={t.status === "ANNULLED" ? "text-slate-400" : undefined}>
                <Td>{formatDate(t.date)}</Td>
                <Td>{t.from}</Td>
                <Td>{t.to}</Td>
                <Td className="text-right tabular-nums">{formatMoney(t.amount)}</Td>
                <Td>
                  <div className="max-w-xs whitespace-normal">
                    {t.description}
                    {t.username && <span className="block text-xs text-slate-500">{t.username}</span>}
                  </div>
                </Td>
                <Td>
                  {t.status === "ANNULLED" ? (
                    <>
                      <Badge tone="red">Anulada</Badge>
                      {t.annulReason && <span className="block text-xs">{t.annulReason}</span>}
                    </>
                  ) : canTransfer ? (
                    <AnnulTransferButton id={t.id} />
                  ) : (
                    <Badge tone="green">Vigente</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} href={(p) => (p > 1 ? `/transferencias?page=${p}` : "/transferencias")} />
      </Card>
    </>
  );
}
