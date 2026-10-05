import { notFound } from "next/navigation";
import { Alert, Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { formatCuit } from "@/lib/cuit";
import { DomainError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { PartyKind } from "@/modules/parties/schemas";
import { getParty, partyFormCatalogs, partyHistory, type PartyDetail } from "@/modules/parties/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { PARTY_UI } from "./config";
import { PartyForm, type PartyFormValues } from "./party-form";
import { PartyHistory } from "./party-history";
import { DeactivateForm, ReactivateForm } from "./status-forms";

const EMPTY: PartyFormValues = {
  legalName: "",
  idTypeId: "",
  taxId: "",
  vatConditionId: "",
  address: "",
  city: "",
  provinceId: "",
  postalCode: "",
  phone: "",
  email: "",
  contactName: "",
  paymentTermId: "",
  creditDays: "0",
  creditLimit: "",
  notes: "",
  duplicateTaxIdReason: "",
  activity: "",
  bankId: "",
  cbu: "",
  cbuAlias: "",
};

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function toFormValues(p: PartyDetail): PartyFormValues {
  return {
    id: p.id,
    version: p.version,
    legalName: p.legalName,
    idTypeId: s(p.idTypeId),
    taxId: s(p.taxId),
    vatConditionId: s(p.vatConditionId),
    address: s(p.address),
    city: s(p.city),
    provinceId: s(p.provinceId),
    postalCode: s(p.postalCode),
    phone: s(p.phone),
    email: s(p.email),
    contactName: s(p.contactName),
    paymentTermId: s(p.paymentTermId),
    creditDays: s(p.creditDays),
    creditLimit: p.creditLimit ? p.creditLimit.replace(".", ",") : "",
    notes: s(p.notes),
    duplicateTaxIdReason: s(p.duplicateTaxIdReason),
    activity: s(p.activity),
    bankId: s(p.bankId),
    cbu: s(p.cbu),
    cbuAlias: s(p.cbuAlias),
  };
}

async function loadParty(kind: PartyKind, rawId: string, ctx: Parameters<typeof getParty>[1]) {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return getParty(db, ctx, kind, id).catch((e: unknown) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
}

export async function NewPartyPage({ kind }: { kind: PartyKind }) {
  const ui = PARTY_UI[kind];
  const { session } = await requirePagePermission(ui.perm.write);
  const catalogs = await partyFormCatalogs(db);
  const defaults: PartyFormValues = {
    ...EMPTY,
    idTypeId: s(catalogs.idTypes.find((t) => t.code === "CUIT")?.id),
  };
  return (
    <>
      <PageHeader title={`Nuevo ${ui.singular.toLowerCase()}`} description="El código interno se asigna automáticamente." />
      <Card className="max-w-4xl p-6">
        <PartyForm kind={kind} basePath={ui.basePath} catalogs={catalogs} initial={defaults} canDuplicate={session.permissions.has(ui.perm.duplicate)} />
      </Card>
    </>
  );
}

export async function EditPartyPage({ kind, id }: { kind: PartyKind; id: string }) {
  const ui = PARTY_UI[kind];
  const { ctx, session } = await requirePagePermission(ui.perm.write);
  const [party, catalogs] = await Promise.all([loadParty(kind, id, ctx), partyFormCatalogs(db)]);
  return (
    <>
      <PageHeader title={`Modificar ${party.legalName}`} description={`Código ${party.code}`} />
      <Card className="max-w-4xl p-6">
        <PartyForm kind={kind} basePath={ui.basePath} catalogs={catalogs} initial={toFormValues(party)} canDuplicate={session.permissions.has(ui.perm.duplicate)} />
      </Card>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children || "—"}</dd>
    </div>
  );
}

export async function PartyDetailPage({ kind, id, saved }: { kind: PartyKind; id: string; saved: boolean }) {
  const ui = PARTY_UI[kind];
  const { ctx, session } = await requirePagePermission(ui.perm.read);
  const party = await loadParty(kind, id, ctx);
  const [catalogs, history] = await Promise.all([partyFormCatalogs(db), partyHistory(db, ctx, kind, party.id)]);
  const byId = (rows: { id: number; name: string }[]) => Object.fromEntries(rows.map((r) => [String(r.id), r.name]));
  const names = {
    idTypeId: byId(catalogs.idTypes),
    vatConditionId: byId(catalogs.vatConditions),
    provinceId: byId(catalogs.provinces),
    paymentTermId: byId(catalogs.paymentTerms),
    bankId: byId(catalogs.banks),
    status: { ACTIVE: "Activo", INACTIVE: "Baja" },
  };
  const name = (field: keyof typeof names, v: number | null) => (v == null ? "" : (names[field] as Record<string, string>)[String(v)] ?? "");
  const canWrite = session.permissions.has(ui.perm.write);
  const canDeactivate = session.permissions.has(ui.perm.deactivate);
  const active = party.status === "ACTIVE";
  const balance = party.balance;

  return (
    <>
      <PageHeader
        title={party.legalName}
        description={`${ui.singular} ${party.code}`}
        actions={
          canWrite && (
            <LinkButton href={`${ui.basePath}/${party.id}/editar`} variant="secondary">
              Modificar
            </LinkButton>
          )
        }
      />
      {saved && (
        <div className="mb-4">
          <Alert tone="success">Los datos se guardaron.</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="p-5">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Estado">{active ? <Badge tone="green">Activo</Badge> : <Badge tone="red">Dado de baja</Badge>}</Item>
              <Item label={name("idTypeId", party.idTypeId) || "Identificación"}>{party.taxId ? formatCuit(party.taxId) : ""}</Item>
              <Item label="Condición IVA">{name("vatConditionId", party.vatConditionId)}</Item>
              <Item label="Domicilio">{party.address}</Item>
              <Item label="Localidad">{[party.city, name("provinceId", party.provinceId), party.postalCode].filter(Boolean).join(", ")}</Item>
              <Item label="Teléfono">{party.phone}</Item>
              <Item label="Correo">{party.email}</Item>
              <Item label="Contacto">{party.contactName}</Item>
              <Item label="Condición de pago">{name("paymentTermId", party.paymentTermId)}</Item>
              <Item label="Días de plazo">{String(party.creditDays)}</Item>
              <Item label={kind === "client" ? "Límite de crédito" : "Crédito otorgado"}>{party.creditLimit ? formatMoney(party.creditLimit) : "Sin límite"}</Item>
              {kind === "supplier" && (
                <>
                  <Item label="Rubro">{party.activity}</Item>
                  <Item label="Banco">{name("bankId", party.bankId)}</Item>
                  <Item label="CBU">{party.cbu}</Item>
                  <Item label="Alias">{party.cbuAlias}</Item>
                </>
              )}
              {party.duplicateTaxIdReason && <Item label="Motivo de CUIT duplicado">{party.duplicateTaxIdReason}</Item>}
            </dl>
            {party.notes && <p className="mt-4 whitespace-pre-line border-t border-slate-100 pt-4 text-sm text-slate-700">{party.notes}</p>}
            {!active && (
              <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-red-700">
                Dado de baja el {formatDateTime(party.deactivatedAt)}. Motivo: {party.deactivationReason}
              </p>
            )}
          </Card>
          <PartyHistory entries={history} names={names} />
        </div>
        <div className="space-y-6">
          {session.permissions.has("accounts.read") && (
            <Card className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Saldo de cuenta corriente</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{formatMoney(balance)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {balance.startsWith("-") ? "Saldo a favor del " + ui.singular.toLowerCase() : "Positivo = deuda pendiente"}
              </p>
            </Card>
          )}
          {canDeactivate && (
            <Card className="p-5">
              <h2 className="mb-3 font-medium text-slate-900">{active ? "Baja" : "Reactivación"}</h2>
              {active ? (
                <DeactivateForm kind={kind} id={party.id} version={party.version} the={ui.the} />
              ) : (
                <ReactivateForm kind={kind} id={party.id} version={party.version} />
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
