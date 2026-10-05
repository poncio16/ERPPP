"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Field, LinkButton, SelectField, TextareaField } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  createClientAction,
  createSupplierAction,
  updateClientAction,
  updateSupplierAction,
} from "@/modules/parties/actions";
import type { PartyKind } from "@/modules/parties/schemas";
import type { PartyFormCatalogs } from "@/modules/parties/service";
import { formatCuit } from "@/lib/cuit";

/** Valores iniciales del formulario (todo como texto, tal como viaja en el formulario). */
export interface PartyFormValues {
  id?: number;
  version?: number;
  legalName: string;
  idTypeId: string;
  taxId: string;
  vatConditionId: string;
  address: string;
  city: string;
  provinceId: string;
  postalCode: string;
  phone: string;
  email: string;
  contactName: string;
  paymentTermId: string;
  creditDays: string;
  creditLimit: string;
  notes: string;
  duplicateTaxIdReason: string;
  activity: string;
  bankId: string;
  cbu: string;
  cbuAlias: string;
}

const ACTIONS = {
  client: { create: createClientAction, update: updateClientAction },
  supplier: { create: createSupplierAction, update: updateSupplierAction },
};

export function PartyForm({
  kind,
  basePath,
  catalogs,
  initial,
  canDuplicate,
}: {
  kind: PartyKind;
  basePath: string;
  catalogs: PartyFormCatalogs;
  initial: PartyFormValues;
  canDuplicate: boolean;
}) {
  const editing = initial.id !== undefined;
  const action = editing ? ACTIONS[kind].update : ACTIONS[kind].create;
  const { state, pending, onSubmit } = useActionForm(action);
  const router = useRouter();
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const [idTypeId, setIdTypeId] = useState(initial.idTypeId);
  const creditDaysRef = useRef<HTMLInputElement>(null);
  const idType = catalogs.idTypes.find((t) => String(t.id) === idTypeId);
  const duplicateDetected = Boolean(fe?.taxId?.some((m) => m.includes("Ya existe")));

  useEffect(() => {
    if (!state?.ok) return;
    const data = state.data as { id: number };
    router.push(`${basePath}/${data.id}?guardado=1`);
  }, [state, router, basePath]);

  const opts = (rows: { id: number; name: string }[]) => rows.map((r) => ({ value: r.id, label: r.name }));
  const taxIdHint = idType?.requiresCuit
    ? "11 dígitos; se valida el dígito verificador. Puede escribirse con guiones."
    : idType?.code === "SIN"
      ? "Sin número (por ejemplo, consumidor final no identificado)."
      : idType?.code === "DNI"
        ? "7 u 8 dígitos."
        : undefined;

  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-8">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {editing && (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version} />
        </>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <h2 className="text-sm font-semibold text-slate-900 md:col-span-2">Datos fiscales</h2>
        <div className="md:col-span-2">
          <Field label="Razón social o nombre" name="legalName" required maxLength={200} defaultValue={initial.legalName} errors={fe?.legalName} />
        </div>
        <SelectField
          label="Tipo de identificación"
          name="idTypeId"
          value={idTypeId}
          onChange={(e) => setIdTypeId(e.target.value)}
          options={catalogs.idTypes.map((t) => ({ value: t.id, label: t.name }))}
          errors={fe?.idTypeId}
        />
        <Field
          label={idType?.requiresCuit ? idType.name : "Número de documento"}
          name="taxId"
          defaultValue={idType?.requiresCuit ? formatCuit(initial.taxId) : initial.taxId}
          disabled={idType?.code === "SIN"}
          required={idType?.requiresCuit}
          maxLength={20}
          inputMode={idType?.requiresCuit || idType?.code === "DNI" ? "numeric" : undefined}
          hint={taxIdHint}
          errors={fe?.taxId}
        />
        {(duplicateDetected || initial.duplicateTaxIdReason) && (
          <div className="md:col-span-2">
            {canDuplicate ? (
              <Field
                label="Motivo del segundo registro con el mismo número"
                name="duplicateTaxIdReason"
                maxLength={300}
                defaultValue={initial.duplicateTaxIdReason}
                hint="Por ejemplo: sucursal con cuenta corriente separada. Queda registrado en auditoría."
                errors={fe?.duplicateTaxIdReason}
              />
            ) : (
              <Alert tone="warning">
                Para registrar un segundo {kind === "client" ? "cliente" : "proveedor"} con el mismo número hace falta un permiso
                especial. Pídaselo al administrador o use el registro existente.
              </Alert>
            )}
          </div>
        )}
        <SelectField
          label="Condición frente al IVA"
          name="vatConditionId"
          defaultValue={initial.vatConditionId}
          placeholder="Elegir…"
          options={opts(catalogs.vatConditions)}
          errors={fe?.vatConditionId}
          required
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <h2 className="text-sm font-semibold text-slate-900 md:col-span-2">Domicilio y contacto</h2>
        <div className="md:col-span-2">
          <Field label="Domicilio" name="address" maxLength={200} defaultValue={initial.address} errors={fe?.address} />
        </div>
        <Field label="Localidad" name="city" maxLength={100} defaultValue={initial.city} errors={fe?.city} />
        <SelectField label="Provincia" name="provinceId" defaultValue={initial.provinceId} placeholder="—" options={opts(catalogs.provinces)} errors={fe?.provinceId} />
        <Field label="Código postal" name="postalCode" maxLength={10} defaultValue={initial.postalCode} errors={fe?.postalCode} />
        <Field label="Teléfono" name="phone" maxLength={60} defaultValue={initial.phone} errors={fe?.phone} />
        <Field label="Correo electrónico" name="email" type="email" maxLength={200} defaultValue={initial.email} errors={fe?.email} />
        <Field label="Contacto" name="contactName" maxLength={120} defaultValue={initial.contactName} errors={fe?.contactName} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <h2 className="text-sm font-semibold text-slate-900 md:col-span-3">Condiciones comerciales</h2>
        <SelectField
          label="Condición de pago"
          name="paymentTermId"
          defaultValue={initial.paymentTermId}
          placeholder="—"
          options={opts(catalogs.paymentTerms)}
          errors={fe?.paymentTermId}
          onChange={(e) => {
            const term = catalogs.paymentTerms.find((t) => String(t.id) === e.target.value);
            if (term && creditDaysRef.current) creditDaysRef.current.value = String(term.days);
          }}
        />
        <Field ref={creditDaysRef} label="Días de plazo" name="creditDays" type="number" min={0} max={3650} defaultValue={initial.creditDays} errors={fe?.creditDays} />
        <Field
          label={kind === "client" ? "Límite de crédito" : "Crédito otorgado por el proveedor"}
          name="creditLimit"
          inputMode="decimal"
          defaultValue={initial.creditLimit}
          hint="Vacío = sin límite. Ej.: 1.500.000,00"
          errors={fe?.creditLimit}
        />
      </section>

      {kind === "supplier" && (
        <section className="grid gap-4 md:grid-cols-2">
          <h2 className="text-sm font-semibold text-slate-900 md:col-span-2">Rubro y datos bancarios</h2>
          <Field label="Rubro / actividad" name="activity" maxLength={120} defaultValue={initial.activity} errors={fe?.activity} />
          <SelectField label="Banco" name="bankId" defaultValue={initial.bankId} placeholder="—" options={opts(catalogs.banks)} errors={fe?.bankId} />
          <Field label="CBU" name="cbu" inputMode="numeric" maxLength={26} defaultValue={initial.cbu} hint="22 dígitos" errors={fe?.cbu} />
          <Field label="Alias" name="cbuAlias" maxLength={20} defaultValue={initial.cbuAlias} errors={fe?.cbuAlias} />
        </section>
      )}

      <TextareaField label="Observaciones" name="notes" maxLength={2000} defaultValue={initial.notes} errors={fe?.notes} />

      <div className="flex gap-3">
        <SubmitButton pendingText="Guardando…">{editing ? "Guardar cambios" : "Crear"}</SubmitButton>
        <LinkButton variant="secondary" href={editing ? `${basePath}/${initial.id}` : basePath}>
          Cancelar
        </LinkButton>
      </div>
    </ActionForm>
  );
}
