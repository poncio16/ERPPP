import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, Input, Label, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { formatCuit } from "@/lib/cuit";
import { DomainError } from "@/lib/errors";
import { formatDate, formatDateTime, formatPeriod } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { DocumentListSchema, STATUS_FILTERS } from "@/modules/documents/schemas";
import { documentHistory, getDocument, listDocuments, partyOptions } from "@/modules/documents/service";
import { CLASS_LABELS, CONCEPT_LABELS, displayStatus } from "@/modules/documents/status";
import { formatDocumentNumber } from "@/modules/tax/calc";
import { allTaxes, documentTypesFor, jurisdictions } from "@/modules/tax/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import type { Direction } from "@/server/db/schema";
import { DOCUMENT_UI } from "./config";
import { AnnulDocumentForm, DocumentInfoForm } from "./document-actions";
import { DocumentForm, type DocumentFormInitial } from "./document-form";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATUS_LABELS: Record<(typeof STATUS_FILTERS)[number], string> = {
  ACTIVE: "Vigentes (no anulados)",
  PENDING: "Con saldo",
  OVERDUE: "Vencidos",
  PARTIAL: "Parciales",
  SETTLED: "Cancelados",
  ANNULLED: "Anulados",
  ALL: "Todos",
};

/** Las NC restan en los totales (G.3-5). */
const signedAmount = (cls: string, v: string) => (cls === "CREDIT_NOTE" || cls === "OPENING_CREDIT" ? `-${v}` : v);

export async function DocumentListPage({ direction, searchParams }: { direction: Direction; searchParams: SearchParams }) {
  const ui = DOCUMENT_UI[direction];
  const { ctx, session } = await requirePagePermission("documents.read");
  const raw = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, first(v) || undefined]));
  const query = DocumentListSchema.parse(raw);
  const [list, types, parties] = await Promise.all([
    listDocuments(db, ctx, direction, query),
    documentTypesFor(db, direction),
    partyOptions(db, ctx, direction),
  ]);
  const href = (page: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "" && k !== "page" && !(k === "status" && v === "ACTIVE")) sp.set(k, String(v));
    if (page > 1) sp.set("page", String(page));
    const s = sp.toString();
    return s ? `${ui.basePath}?${s}` : ui.basePath;
  };

  return (
    <>
      <PageHeader
        title={ui.title}
        description={direction === "ISSUED" ? "Registro de comprobantes ya emitidos con el sistema de facturación." : "Registro de comprobantes recibidos de proveedores."}
        actions={session.permissions.has("documents.create") && <LinkButton href={`${ui.basePath}/nuevo`}>Registrar comprobante</LinkButton>}
      />
      <Card className="mb-4 p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <div className="lg:col-span-2">
            <Label htmlFor="q">Buscar</Label>
            <Input id="q" name="q" defaultValue={query.q} placeholder="Número (1-123) o nombre" className="mt-1" />
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
            <Label htmlFor="documentTypeId">Tipo</Label>
            <Select id="documentTypeId" name="documentTypeId" defaultValue={query.documentTypeId ?? ""} className="mt-1">
              <option value="">Todos</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Estado</Label>
            <Select id="status" name="status" defaultValue={query.status} className="mt-1">
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
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
              <Th>Comprobante</Th>
              <Th>{ui.party}</Th>
              <Th>Vencimiento</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Saldo</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.rows.length === 0 && (
              <tr>
                <Td colSpan={7} className="py-8 text-center text-slate-500">
                  No hay comprobantes con esos filtros.
                </Td>
              </tr>
            )}
            {list.rows.map((r) => {
              const st = displayStatus(r, list.today);
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td>{formatDate(r.issueDate)}</Td>
                  <Td>
                    <Link href={`${ui.basePath}/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {r.typeName} {formatDocumentNumber(r.pointOfSale, r.number)}
                    </Link>
                  </Td>
                  <Td>
                    {r.partyName}
                    {r.partyTaxId && <span className="block text-xs text-slate-500">{formatCuit(r.partyTaxId)}</span>}
                  </Td>
                  <Td>{formatDate(r.dueDate)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(signedAmount(r.documentClass, r.total))}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(signedAmount(r.documentClass, r.balance))}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                </tr>
              );
            })}
          </tbody>
          {list.total > 0 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <Td colSpan={4}>
                  {list.total} comprobantes (sin anulados; las notas de crédito restan)
                </Td>
                <Td className="text-right tabular-nums">{formatMoney(list.sumTotal)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(list.sumBalance)}</Td>
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

const EMPTY_INITIAL = (today: string): DocumentFormInitial => ({
  documentTypeId: "",
  pointOfSale: "",
  number: "",
  partyId: "",
  issueDate: today,
  dueDate: "",
  vatPeriod: "",
  concept: "",
  description: "",
  externalRef: "",
  currency: "ARS",
  exchangeRate: "1",
  netUntaxed: "",
  netExempt: "",
  discount: "",
  vat: [],
  other: [],
  reason: "",
});

const comma = (v: string | null) => (v && v !== "0.00" ? v.replace(".", ",") : "");

export async function NewDocumentPage({ direction, searchParams }: { direction: Direction; searchParams: SearchParams }) {
  const ui = DOCUMENT_UI[direction];
  const { ctx } = await requirePagePermission("documents.create");
  const [types, parties, taxes, juris] = await Promise.all([
    documentTypesFor(db, direction),
    partyOptions(db, ctx, direction),
    allTaxes(db),
    jurisdictions(db),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  let initial = EMPTY_INITIAL(today);
  const preset = first(searchParams.partyId);
  if (preset) initial.partyId = preset;

  // "Registrar corregido": parte de los datos de un comprobante anulado (D3).
  const from = Number(first(searchParams.desde));
  let correcting: string | null = null;
  if (Number.isSafeInteger(from) && from > 0) {
    const d = await getDocument(db, ctx, from).catch(() => null);
    if (d && d.direction === direction) {
      const fx = d.exchangeRate === "1.000000" ? null : d.exchangeRate;
      // Los importes se guardaron en pesos; si había cotización se proponen en pesos y moneda ARS.
      initial = {
        documentTypeId: String(d.documentTypeId),
        pointOfSale: String(d.pointOfSale),
        number: String(d.number),
        partyId: String(d.clientId ?? d.supplierId),
        issueDate: d.issueDate,
        dueDate: d.dueDate,
        vatPeriod: d.vatPeriod.slice(0, 7),
        concept: d.concept ?? "",
        description: d.description ?? "",
        externalRef: d.externalRef ?? "",
        currency: "ARS",
        exchangeRate: "1",
        netUntaxed: comma(d.netUntaxed),
        netExempt: comma(d.netExempt),
        discount: comma(d.discountTotal),
        vat: d.lines.filter((l) => l.kind === "VAT").map((l) => ({ taxId: String(taxes.find((t) => t.name === l.name)?.id ?? ""), base: comma(l.base), amount: comma(l.amount) })),
        other: d.lines
          .filter((l) => l.kind !== "VAT")
          .map((l) => ({ taxId: String(taxes.find((t) => t.name === l.name)?.id ?? ""), amount: comma(l.amount), jurisdictionId: String(juris.find((j) => j.name === l.jurisdiction)?.id ?? "") })),
        reason: d.reason ?? "",
      };
      correcting = `${d.typeName} ${formatDocumentNumber(d.pointOfSale, d.number)}${fx ? ` (importes convertidos a pesos a ${fx})` : ""}`;
    }
  }

  return (
    <>
      <PageHeader
        title={`Registrar ${ui.singular}`}
        description="Ingrese los datos tal como figuran en el comprobante. El ERP no emite comprobantes fiscales ni genera numeración."
      />
      {correcting && (
        <div className="mb-4">
          <Alert tone="info">Datos tomados de {correcting}. Corrija lo que corresponda antes de registrar.</Alert>
        </div>
      )}
      <Card className="max-w-5xl p-6">
        <DocumentForm
          direction={direction}
          basePath={ui.basePath}
          partyLabel={ui.party}
          types={types.map((t) => ({ id: t.id, name: t.name, letter: t.letter, class: t.class, vatCreditable: t.vatCreditable }))}
          parties={parties}
          taxes={taxes.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, code: t.code, kind: t.kind, rate: t.rate, validFrom: t.validFrom, validTo: t.validTo }))}
          jurisdictions={juris}
          initial={initial}
          idempotencyKey={randomUUID()}
        />
      </Card>
    </>
  );
}

const HISTORY_LABELS: Record<string, string> = { create: "Registro", update: "Corrección de datos", annul: "Anulación del registro" };
const FIELD_LABELS: Record<string, string> = { dueDate: "Vencimiento", concept: "Concepto", description: "Descripción", externalRef: "Referencia externa" };

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between border-t border-slate-200 pt-2 font-semibold" : "flex justify-between"}>
      <dt className="text-slate-600">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export async function DocumentDetailPage({ direction, id, searchParams }: { direction: Direction; id: string; searchParams: SearchParams }) {
  const ui = DOCUMENT_UI[direction];
  const { ctx, session } = await requirePagePermission("documents.read");
  const docId = Number(id);
  if (!Number.isSafeInteger(docId) || docId <= 0) notFound();
  const d = await getDocument(db, ctx, docId).catch((e: unknown) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (d.direction !== direction) notFound();
  const history = await documentHistory(db, ctx, docId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const st = displayStatus(d, today);
  const partyId = d.clientId ?? d.supplierId;
  const annulled = d.status === "ANNULLED";
  const number = formatDocumentNumber(d.pointOfSale, d.number);

  return (
    <>
      <PageHeader
        title={`${d.typeName} ${number}`}
        description={`${CLASS_LABELS[d.documentClass] ?? "Comprobante"} · ${direction === "ISSUED" ? "comprobante emitido" : "comprobante recibido"} · registrado el ${formatDateTime(d.createdAt)}`}
        actions={
          annulled &&
          session.permissions.has("documents.create") && (
            <LinkButton href={`${ui.basePath}/nuevo?desde=${d.id}`}>Registrar corregido</LinkButton>
          )
        }
      />
      {first(searchParams.registrado) === "1" && (
        <div className="mb-4">
          <Alert tone="success">Comprobante registrado. Se generó su movimiento en la cuenta corriente.</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="p-5">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Estado</dt>
                <dd className="mt-1">
                  <Badge tone={st.tone}>{st.label}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{ui.party}</dt>
                <dd className="mt-1">
                  <Link href={`${ui.partyPath}/${partyId}`} className="text-brand-700 hover:underline">
                    {d.partyName}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    {d.partyTaxId ? formatCuit(d.partyTaxId) : "Sin identificación"} · {d.vatCondition}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Fechas</dt>
                <dd className="mt-1">
                  Emisión {formatDate(d.issueDate)}
                  <span className="block">Vencimiento {formatDate(d.dueDate)}</span>
                  <span className="block text-xs text-slate-500">Período IVA {formatPeriod(d.vatPeriod)}</span>
                </dd>
              </div>
              {d.concept && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Concepto</dt>
                  <dd className="mt-1">{CONCEPT_LABELS[d.concept]}</dd>
                </div>
              )}
              {d.currency !== "ARS" && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Moneda</dt>
                  <dd className="mt-1">
                    {d.currency} a {d.exchangeRate} · importe original {d.currency} {formatMoney(String(Number(d.total) / Number(d.exchangeRate)), false)}
                  </dd>
                </div>
              )}
              {d.reason && (
                <div className="sm:col-span-3">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Motivo</dt>
                  <dd className="mt-1">{d.reason}</dd>
                </div>
              )}
              {d.description && (
                <div className="sm:col-span-3">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Descripción</dt>
                  <dd className="mt-1 whitespace-pre-line">{d.description}</dd>
                </div>
              )}
              {d.externalRef && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Referencia externa</dt>
                  <dd className="mt-1">{d.externalRef}</dd>
                </div>
              )}
            </dl>
            {annulled && (
              <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-red-700">
                Registro anulado el {formatDateTime(d.annulledAt)}. Motivo: {d.annulReason}
              </p>
            )}
          </Card>

          <Card>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Detalle tributario</Th>
                  <Th className="text-right">Base</Th>
                  <Th className="text-right">Importe</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.lines.length === 0 && (
                  <tr>
                    <Td colSpan={3} className="text-slate-500">
                      Sin IVA discriminado ni percepciones.
                    </Td>
                  </tr>
                )}
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      {l.name}
                      {l.jurisdiction ? ` · ${l.jurisdiction}` : ""}
                    </Td>
                    <Td className="text-right tabular-nums">{l.base ? formatMoney(l.base) : ""}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(l.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {(d.relatesTo.length > 0 || d.relatedBy.length > 0) && (
            <Card className="p-5 text-sm">
              <h2 className="font-medium text-slate-900">Comprobantes vinculados</h2>
              <ul className="mt-2 space-y-1">
                {[...d.relatesTo.map((r) => ({ ...r, dir: "Corrige a" })), ...d.relatedBy.map((r) => ({ ...r, dir: "Corregido por" }))].map((r) => (
                  <li key={`${r.dir}-${r.id}`}>
                    {r.dir}{" "}
                    <Link href={`${ui.basePath}/${r.id}`} className="text-brand-700 hover:underline">
                      {r.typeName} {formatDocumentNumber(r.pointOfSale, r.number)}
                    </Link>{" "}
                    · {formatMoney(r.total)}
                    {r.status === "ANNULLED" && " (anulado)"}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="font-medium text-slate-900">Historial</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {history.map((h) => {
                const before = (h.before ?? {}) as Record<string, unknown>;
                const after = (h.after ?? {}) as Record<string, unknown>;
                return (
                  <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                    <p>
                      <span className="font-medium">{HISTORY_LABELS[h.action] ?? h.action}</span>
                      <span className="text-slate-500">
                        {" "}
                        · {formatDateTime(h.occurred_at)} · {h.username ?? "sistema"}
                      </span>
                    </p>
                    {h.action === "update" &&
                      Object.keys(after).map((k) => (
                        <p key={k} className="text-slate-600">
                          {FIELD_LABELS[k] ?? k}: <span className="line-through">{String(before[k] ?? "—")}</span> → {String(after[k] ?? "—")}
                        </p>
                      ))}
                    {h.action === "annul" && <p className="text-slate-600">Motivo: {String(after.reason ?? "")}</p>}
                    {h.message && <p className="text-slate-600">{h.message}</p>}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <dl className="space-y-1 text-sm">
              {d.netTaxed !== "0.00" && <Row label="Neto gravado" value={formatMoney(d.netTaxed)} />}
              {d.netUntaxed !== "0.00" && <Row label={d.vatCreditable || direction === "ISSUED" ? "No gravado" : "IVA no discriminado"} value={formatMoney(d.netUntaxed)} />}
              {d.netExempt !== "0.00" && <Row label="Exento" value={formatMoney(d.netExempt)} />}
              {d.vatTotal !== "0.00" && <Row label="IVA" value={formatMoney(d.vatTotal)} />}
              {d.perceptionsTotal !== "0.00" && <Row label="Percepciones" value={formatMoney(d.perceptionsTotal)} />}
              {d.otherTaxesTotal !== "0.00" && <Row label="Otros impuestos" value={formatMoney(d.otherTaxesTotal)} />}
              {d.discountTotal !== "0.00" && <Row label="Descuentos" value={`-${formatMoney(d.discountTotal)}`} />}
              <Row label="Total" value={formatMoney(d.total)} strong />
              <Row label={d.documentClass === "CREDIT_NOTE" ? "Crédito disponible" : "Saldo"} value={formatMoney(d.balance)} strong />
            </dl>
          </Card>
          {!annulled && session.permissions.has("documents.edit") && (
            <Card className="p-5">
              <h2 className="mb-3 font-medium text-slate-900">Corregir datos</h2>
              <DocumentInfoForm
                id={d.id}
                version={d.version}
                dueDate={d.dueDate}
                issueDate={d.issueDate}
                concept={d.concept}
                description={d.description}
                externalRef={d.externalRef}
              />
              <p className="mt-3 text-xs text-slate-500">
                Para corregir importes, tipo, número o {ui.party.toLowerCase()}, anule el registro y vuelva a cargarlo: el número queda libre.
              </p>
            </Card>
          )}
          {!annulled && session.permissions.has("documents.annul") && (
            <Card className="p-5">
              <h2 className="mb-3 font-medium text-slate-900">Anular registro</h2>
              <AnnulDocumentForm id={d.id} version={d.version} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
