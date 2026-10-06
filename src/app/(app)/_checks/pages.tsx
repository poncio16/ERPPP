import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, Input, Label, PageHeader, Pagination, Select, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { formatCuit } from "@/lib/cuit";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { IssuedCheckListSchema, ReceivedCheckListSchema } from "@/modules/checks/schemas";
import {
  CHECK_PAGE_SIZE,
  ISSUED_STATUS_LABEL,
  RECEIVED_STATUS_LABEL,
  getIssuedCheck,
  getReceivedCheck,
  listIssuedChecks,
  listReceivedChecks,
  portfolioTotal,
  type IssuedStatus,
  type ReceivedStatus,
} from "@/modules/checks/service";
import { accountOptions } from "@/modules/treasury/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { CheckStepForm, type CheckStep } from "./forms";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const FORMAT_LABEL: Record<string, string> = { PHYSICAL: "Físico", ECHEQ: "ECHEQ" };
const TYPE_LABEL: Record<string, string> = { COMMON: "Común", DEFERRED: "Pago diferido" };
const TONE: Record<string, "slate" | "green" | "red" | "amber" | "blue"> = {
  IN_PORTFOLIO: "blue",
  DEPOSITED: "amber",
  CREDITED: "green",
  ENDORSED: "slate",
  ISSUED: "blue",
  DELIVERED: "blue",
  PRESENTED: "amber",
  DEBITED: "green",
  REJECTED: "red",
  ANNULLED: "slate",
};

function CheckBadge({ kind, status }: { kind: "RECEIVED" | "ISSUED"; status: string }) {
  const label = kind === "RECEIVED" ? RECEIVED_STATUS_LABEL[status as ReceivedStatus] : ISSUED_STATUS_LABEL[status as IssuedStatus];
  return <Badge tone={TONE[status] ?? "slate"}>{label ?? status}</Badge>;
}

function Tabs({ active }: { active: "RECEIVED" | "ISSUED" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} className={cx("-mb-px border-b-2 px-4 py-2 text-sm font-medium", on ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}>
      {label}
    </Link>
  );
  return (
    <nav className="mb-4 flex border-b border-slate-200">
      {tab("/cheques", "Cheques recibidos", active === "RECEIVED")}
      {tab("/cheques/emitidos", "Cheques propios", active === "ISSUED")}
    </nav>
  );
}

const isOverdue = (status: string, paymentDate: string) => ["IN_PORTFOLIO", "DELIVERED", "PRESENTED"].includes(status) && paymentDate < todayIso();

// ───────────────────────────── Listados ─────────────────────────────

export async function ChecksListPage({ kind, searchParams }: { kind: "RECEIVED" | "ISSUED"; searchParams: SearchParams }) {
  const { ctx } = await requirePagePermission("checks.read");
  const raw = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, first(v) || undefined]));
  const basePath = kind === "RECEIVED" ? "/cheques" : "/cheques/emitidos";
  const received = kind === "RECEIVED" ? ReceivedCheckListSchema.parse(raw) : null;
  const issued = kind === "ISSUED" ? IssuedCheckListSchema.parse(raw) : null;
  const [list, portfolio] = await Promise.all([
    received ? listReceivedChecks(db, ctx, received) : listIssuedChecks(db, ctx, issued!),
    kind === "RECEIVED" ? portfolioTotal(db) : Promise.resolve(null),
  ]);
  const query = received ?? issued!;
  const href = (page: number) => {
    const sp = new URLSearchParams();
    if (query.status) sp.set("status", query.status);
    if (query.q) sp.set("q", query.q);
    if (page > 1) sp.set("page", String(page));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const statusOptions =
    kind === "RECEIVED"
      ? [...(Object.keys(RECEIVED_STATUS_LABEL) as ReceivedStatus[]).map((s) => ({ value: s, label: RECEIVED_STATUS_LABEL[s] })), { value: "ALL", label: "Todos" }]
      : [
          { value: "PENDING", label: "Pendientes de débito" },
          ...(Object.keys(ISSUED_STATUS_LABEL) as IssuedStatus[]).map((s) => ({ value: s, label: ISSUED_STATUS_LABEL[s] })),
          { value: "ALL", label: "Todos" },
        ];

  return (
    <>
      <PageHeader
        title="Cheques"
        description="Cartera de cheques recibidos y cheques propios entregados. Los cheques se cargan desde cobranzas y pagos; aquí se registran depósito, acreditación, cobro, débito y rechazo."
      />
      <Tabs active={kind} />
      {portfolio && (
        <p className="mb-4 text-sm text-slate-700">
          Total en cartera: <strong className="tabular-nums">{formatMoney(portfolio)}</strong>
        </p>
      )}
      <Card className="mb-4 p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <div className="sm:col-span-2">
            <Label htmlFor="q">Buscar</Label>
            <Input id="q" name="q" defaultValue={query.q} placeholder={kind === "RECEIVED" ? "Número, librador, CUIT o cliente" : "Número o proveedor"} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="status">Estado</Label>
            <Select id="status" name="status" defaultValue={list.status} className="mt-1">
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("secondary")}>
              Filtrar
            </button>
            <Link href={basePath} className={buttonClass("ghost")}>
              Limpiar
            </Link>
          </div>
        </form>
      </Card>
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Fecha de pago</Th>
              <Th>Número</Th>
              <Th>{kind === "RECEIVED" ? "Banco" : "Cuenta"}</Th>
              <Th>{kind === "RECEIVED" ? "Librador / cliente" : "Proveedor"}</Th>
              <Th>Tipo</Th>
              <Th className="text-right">Importe</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.rows.length === 0 && (
              <tr>
                <Td colSpan={7} className="py-8 text-center text-slate-500">
                  No hay cheques con esos filtros.
                </Td>
              </tr>
            )}
            {list.rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td className={cx(isOverdue(r.status, r.paymentDate) && "font-medium text-red-700")}>{formatDate(r.paymentDate)}</Td>
                <Td>
                  <Link href={`/cheques/${kind === "RECEIVED" ? "recibidos" : "emitidos"}/${r.id}`} className="font-medium text-brand-700 hover:underline">
                    {r.number}
                  </Link>
                </Td>
                <Td>{"bankName" in r ? r.bankName : r.accountName}</Td>
                <Td className="whitespace-normal">
                  {"drawerName" in r ? (
                    <>
                      {r.drawerName}
                      {r.clientName && r.clientName !== r.drawerName && <span className="block text-xs text-slate-500">Cliente: {r.clientName}</span>}
                    </>
                  ) : (
                    (r.supplierName ?? "—")
                  )}
                </Td>
                <Td>
                  {FORMAT_LABEL[r.format]} · {TYPE_LABEL[r.checkType]}
                </Td>
                <Td className="text-right tabular-nums">{formatMoney(r.amount)}</Td>
                <Td>
                  <CheckBadge kind={kind} status={r.status} />
                </Td>
              </tr>
            ))}
          </tbody>
          {list.total > 0 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <Td colSpan={5}>{list.total} cheques</Td>
                <Td className="text-right tabular-nums">{formatMoney(list.amount)}</Td>
                <Td />
              </tr>
            </tfoot>
          )}
        </Table>
        <Pagination page={list.page} pageSize={CHECK_PAGE_SIZE} total={list.total} href={href} />
      </Card>
    </>
  );
}

// ───────────────────────────── Detalle ─────────────────────────────

type History = NonNullable<Awaited<ReturnType<typeof getReceivedCheck>>>["history"];

function HistoryTable({ kind, history }: { kind: "RECEIVED" | "ISSUED"; history: History }) {
  const label = (s: string | null) => (s ? (kind === "RECEIVED" ? RECEIVED_STATUS_LABEL[s as ReceivedStatus] : ISSUED_STATUS_LABEL[s as IssuedStatus]) : "Alta");
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <Th>Fecha</Th>
          <Th>Cambio de estado</Th>
          <Th>Detalle</Th>
          <Th>Registrado</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {history.map((h) => (
          <tr key={h.id}>
            <Td>{formatDate(h.date)}</Td>
            <Td>
              {label(h.from)} → {label(h.to)}
            </Td>
            <Td className="whitespace-normal">
              {h.notes}
              {h.movement && (
                <Link href={`/${h.movement.kind === "CASH" ? "caja" : "bancos"}/${h.movement.accountId}`} className="ml-2 text-brand-700 hover:underline">
                  Ver movimiento
                </Link>
              )}
              {h.debitDocumentId && (
                <Link href={`/comprobantes-emitidos/${h.debitDocumentId}`} className="ml-2 text-brand-700 hover:underline">
                  Nota de débito interna al cliente
                </Link>
              )}
              {h.supplierDebitDocumentId && (
                <Link href={`/comprobantes-recibidos/${h.supplierDebitDocumentId}`} className="ml-2 text-brand-700 hover:underline">
                  Deuda interna con el proveedor
                </Link>
              )}
            </Td>
            <Td className="text-xs text-slate-500">
              {h.username ?? "—"} · {formatDateTime(h.createdAt)}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Detail({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-slate-500">{k}</dt>
          <dd className="font-medium text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function StepsCard({ id, version, steps }: { id: number; version: number; steps: CheckStep[] }) {
  if (!steps.length) return null;
  const today = todayIso();
  return (
    <Card className="mt-4 p-4">
      <h2 className="mb-3 text-base font-semibold text-slate-900">Registrar operación</h2>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((s) => (
          <div key={s.step} className="rounded-md border border-slate-200 p-3">
            <CheckStepForm id={id} version={version} today={today} {...s} />
          </div>
        ))}
      </div>
    </Card>
  );
}

export async function ReceivedCheckPage({ id }: { id: string }) {
  const { ctx, session } = await requirePagePermission("checks.read");
  const checkId = Number(id);
  if (!Number.isSafeInteger(checkId) || checkId <= 0) notFound();
  const data = await getReceivedCheck(db, ctx, checkId);
  if (!data) notFound();
  const c = data.check;
  const canOperate = session.permissions.has("checks.operate");
  const steps: CheckStep[] = [];
  if (canOperate) {
    const accounts = await accountOptions(db);
    if (c.status === "IN_PORTFOLIO") {
      steps.push({ step: "deposit", bankAccounts: accounts.filter((a) => a.value.startsWith("BANK:")).map((a) => ({ value: a.value.slice(5), label: a.label })) });
      steps.push({ step: "cash", accounts });
    }
    if (c.status === "DEPOSITED") steps.push({ step: "credit" });
    if (["IN_PORTFOLIO", "DEPOSITED", "CREDITED", "ENDORSED"].includes(c.status)) steps.push({ step: "reject_received", status: c.status });
  }

  return (
    <>
      <PageHeader
        title={`Cheque recibido N° ${c.number}`}
        description={`${data.bankName} · ${FORMAT_LABEL[c.format]} · ${TYPE_LABEL[c.checkType]}`}
        actions={
          <Link href="/cheques" className={buttonClass("ghost")}>
            Volver a cheques
          </Link>
        }
      />
      {isOverdue(c.status, c.paymentDate) && <Alert tone="warning">La fecha de pago ya pasó y el cheque sigue en cartera.</Alert>}
      <Card className="mt-4">
        <Detail
          items={[
            ["Estado", <CheckBadge key="s" kind="RECEIVED" status={c.status} />],
            ["Importe", formatMoney(c.amount)],
            ["Fecha de emisión", formatDate(c.issueDate)],
            ["Fecha de pago", formatDate(c.paymentDate)],
            ["Librador", `${c.drawerName} (CUIT ${formatCuit(c.drawerTaxId)})`],
            ["Cliente", c.clientId ? <Link key="c" href={`/clientes/${c.clientId}`} className="text-brand-700 hover:underline">{data.clientName}</Link> : "—"],
            [
              "Ingresó por",
              data.collection ? (
                <Link key="col" href={`/cobranzas/${data.collection.id}`} className="text-brand-700 hover:underline">
                  Cobranza {data.collection.receipt ?? `#${data.collection.id}`} del {formatDate(data.collection.date)}
                  {data.collection.status === "ANNULLED" && " (anulada)"}
                </Link>
              ) : (
                "—"
              ),
            ],
            ["Depositado en", data.depositAccountName ? `${data.depositAccountName} el ${formatDate(c.depositedAt!)}` : "—"],
            ["Rechazo", c.rejectedAt ? `${formatDate(c.rejectedAt)}: ${c.rejectionReason ?? ""}` : "—"],
          ]}
        />
        {data.endorsements.length > 0 && (
          <div className="border-t border-slate-200 p-4 text-sm">
            <p className="mb-1 text-slate-500">Endosos</p>
            <ul className="space-y-1">
              {data.endorsements.map((e) => (
                <li key={e.paymentId}>
                  <Link href={`/pagos/${e.paymentId}`} className="text-brand-700 hover:underline">
                    Pago {e.order ?? `#${e.paymentId}`} a {e.supplierName}
                  </Link>
                  {e.status === "ANNULLED" && " (anulado, el cheque volvió a cartera)"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <StepsCard id={c.id} version={c.version} steps={steps} />
      <Card className="mt-4">
        <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Historial</h2>
        <HistoryTable kind="RECEIVED" history={data.history} />
      </Card>
    </>
  );
}

export async function IssuedCheckPage({ id }: { id: string }) {
  const { ctx, session } = await requirePagePermission("checks.read");
  const checkId = Number(id);
  if (!Number.isSafeInteger(checkId) || checkId <= 0) notFound();
  const data = await getIssuedCheck(db, ctx, checkId);
  if (!data) notFound();
  const c = data.check;
  const steps: CheckStep[] = [];
  if (session.permissions.has("checks.operate")) {
    if (c.status === "DELIVERED") steps.push({ step: "present" });
    if (c.status === "DELIVERED" || c.status === "PRESENTED") steps.push({ step: "debit" }, { step: "reject_issued" });
  }

  return (
    <>
      <PageHeader
        title={`Cheque propio N° ${c.number}`}
        description={`${data.accountName} · ${FORMAT_LABEL[c.format]} · ${TYPE_LABEL[c.checkType]}`}
        actions={
          <Link href="/cheques/emitidos" className={buttonClass("ghost")}>
            Volver a cheques propios
          </Link>
        }
      />
      <Card>
        <Detail
          items={[
            ["Estado", <CheckBadge key="s" kind="ISSUED" status={c.status} />],
            ["Importe", formatMoney(c.amount)],
            ["Fecha de emisión", formatDate(c.issueDate)],
            ["Fecha de pago", formatDate(c.paymentDate)],
            ["Cuenta", <Link key="a" href={`/bancos/${c.bankAccountId}`} className="text-brand-700 hover:underline">{data.accountName}</Link>],
            ["Proveedor", c.supplierId ? <Link key="p" href={`/proveedores/${c.supplierId}`} className="text-brand-700 hover:underline">{data.supplierName}</Link> : "—"],
            [
              "Entregado en",
              data.payment ? (
                <Link key="pay" href={`/pagos/${data.payment.id}`} className="text-brand-700 hover:underline">
                  Pago {data.payment.order ?? `#${data.payment.id}`}
                  {data.payment.status === "ANNULLED" && " (anulado)"}
                </Link>
              ) : (
                "—"
              ),
            ],
            ["Debitado", c.debitedAt ? formatDate(c.debitedAt) : "—"],
            ["Rechazado", c.rejectedAt ? formatDate(c.rejectedAt) : "—"],
          ]}
        />
      </Card>
      <StepsCard id={c.id} version={c.version} steps={steps} />
      <Card className="mt-4">
        <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Historial</h2>
        <HistoryTable kind="ISSUED" history={data.history} />
      </Card>
    </>
  );
}
