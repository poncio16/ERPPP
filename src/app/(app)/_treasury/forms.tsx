"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Field, Label, Select, SelectField, TextareaField, buttonClass } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/server/action";
import {
  annulTransferAction,
  bankMovementAction,
  cashMovementAction,
  closeCashBoxAction,
  createBankAccountAction,
  createCashBoxAction,
  registerOpeningAction,
  reverseBankMovementAction,
  reverseCashMovementAction,
  transferAction,
  updateBankAccountAction,
  updateCashBoxAction,
} from "@/modules/treasury/actions";

type Kind = "CASH" | "BANK";
type State = ActionResult<unknown> | undefined;

/** Vacía el formulario después de una operación exitosa (la clave de idempotencia nueva llega del servidor). */
function useResetOnSuccess(state: State) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

function FormError({ state }: { state: State }) {
  if (!state || state.ok) return null;
  const fe = state.fieldErrors;
  const hasFieldErrors = fe && Object.keys(fe).some((k) => k !== "_warnings");
  if (fe?._warnings) return null;
  return <Alert tone="error">{hasFieldErrors ? "Revise los datos marcados." : state.error}</Alert>;
}

function Warnings({ state, label }: { state: State; label: string }) {
  const warnings = state && !state.ok ? state.fieldErrors?._warnings : undefined;
  if (!warnings?.length) return null;
  return (
    <Alert tone="warning">
      <ul className="list-disc pl-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <label className="mt-2 flex items-center gap-2 font-medium">
        <input type="checkbox" name="confirmWarnings" value="1" className="h-4 w-4" required />
        {label}
      </label>
    </Alert>
  );
}

const fe = (state: State) => (state && !state.ok ? state.fieldErrors : undefined);

// ───────────────────────────── Alta y edición de cuentas ─────────────────────────────

export function NewCashBoxForm() {
  const { state, pending, onSubmit } = useActionForm(createCashBoxAction);
  const ref = useResetOnSuccess(state);
  return (
    <ActionForm ref={ref} pending={pending} onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1">
        <Field label="Nueva caja" name="name" placeholder="Ej.: Caja chica" required maxLength={80} errors={fe(state)?.name} />
      </div>
      <SubmitButton pendingText="Creando…">Crear caja</SubmitButton>
      {state?.ok && <span className="text-sm text-emerald-700">Caja creada.</span>}
      {state && !state.ok && !fe(state) && <span className="text-sm text-red-700">{state.error}</span>}
    </ActionForm>
  );
}

export function EditCashBoxForm({ id, name, active }: { id: number; name: string; active: boolean }) {
  const { state, pending, onSubmit } = useActionForm(updateCashBoxAction);
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-3">
      <FormError state={state} />
      {state?.ok && <Alert tone="success">Cambios guardados.</Alert>}
      <input type="hidden" name="id" value={id} />
      <Field label="Nombre" name="name" defaultValue={name} required maxLength={80} errors={fe(state)?.name} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" value="1" defaultChecked={active} className="h-4 w-4" />
        Activa
      </label>
      {fe(state)?.active && <p className="text-sm text-red-700">{fe(state)!.active![0]}</p>}
      <SubmitButton variant="secondary" pendingText="Guardando…">
        Guardar
      </SubmitButton>
    </ActionForm>
  );
}

export function NewBankAccountForm({ banks }: { banks: { id: number; name: string; code: string }[] }) {
  const { state, pending, onSubmit } = useActionForm(createBankAccountAction);
  const ref = useResetOnSuccess(state);
  const errors = fe(state);
  return (
    <ActionForm ref={ref} pending={pending} onSubmit={onSubmit} className="grid gap-3 md:grid-cols-3">
      <div className="md:col-span-3">
        <FormError state={state} />
        {state?.ok && <Alert tone="success">Cuenta creada. Cargue su saldo inicial desde la cuenta.</Alert>}
      </div>
      <SelectField label="Banco" name="bankId" required placeholder="Elegir…" options={banks.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))} errors={errors?.bankId} />
      <SelectField
        label="Tipo"
        name="accountType"
        required
        options={[
          { value: "CC", label: "Cuenta corriente" },
          { value: "CA", label: "Caja de ahorro" },
        ]}
        errors={errors?.accountType}
      />
      <Field label="Número de cuenta" name="accountNumber" required maxLength={40} errors={errors?.accountNumber} />
      <Field label="Nombre para identificarla" name="displayName" required maxLength={80} placeholder="Ej.: Galicia CC pesos" errors={errors?.displayName} />
      <Field label="CBU" name="cbu" inputMode="numeric" maxLength={26} errors={errors?.cbu} />
      <Field label="Alias" name="alias" maxLength={20} errors={errors?.alias} />
      <div className="md:col-span-3">
        <SubmitButton pendingText="Creando…">Crear cuenta</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditBankAccountForm({ id, displayName, alias, active }: { id: number; displayName: string; alias: string | null; active: boolean }) {
  const { state, pending, onSubmit } = useActionForm(updateBankAccountAction);
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-3">
      <FormError state={state} />
      {state?.ok && <Alert tone="success">Cambios guardados.</Alert>}
      <input type="hidden" name="id" value={id} />
      <Field label="Nombre" name="displayName" defaultValue={displayName} required maxLength={80} errors={fe(state)?.displayName} />
      <Field label="Alias" name="alias" defaultValue={alias ?? ""} maxLength={20} errors={fe(state)?.alias} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" value="1" defaultChecked={active} className="h-4 w-4" />
        Activa
      </label>
      {fe(state)?.active && <p className="text-sm text-red-700">{fe(state)!.active![0]}</p>}
      <SubmitButton variant="secondary" pendingText="Guardando…">
        Guardar
      </SubmitButton>
    </ActionForm>
  );
}

// ───────────────────────────── Operaciones ─────────────────────────────

export function OpeningForm({ kind, id, idempotencyKey, today }: { kind: Kind; id: number; idempotencyKey: string; today: string }) {
  const { state, pending, onSubmit } = useActionForm(registerOpeningAction);
  const errors = fe(state);
  if (state?.ok) return <Alert tone="success">Saldo inicial registrado.</Alert>;
  return (
    <ActionForm
      pending={pending}
      onSubmit={onSubmit}
      className="space-y-3"
      confirmMessage="El saldo inicial se carga una sola vez y no se puede modificar. ¿Confirma el importe y la fecha?"
    >
      <FormError state={state} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="account" value={`${kind}:${id}`} />
      <Field label="Fecha" name="date" type="date" max={today} defaultValue={today} required errors={errors?.date} />
      <Field label="Importe" name="amount" inputMode="decimal" placeholder="0,00" required errors={errors?.amount} />
      {kind === "BANK" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="overdraft" value="1" className="h-4 w-4" />
          Saldo deudor (descubierto)
        </label>
      )}
      <SubmitButton pendingText="Registrando…">Registrar saldo inicial</SubmitButton>
    </ActionForm>
  );
}

export function ManualMovementForm({
  kind,
  id,
  concepts,
  idempotencyKey,
  today,
}: {
  kind: Kind;
  id: number;
  concepts: { id: number; name: string; direction: string }[];
  idempotencyKey: string;
  today: string;
}) {
  const { state, pending, onSubmit } = useActionForm(kind === "CASH" ? cashMovementAction : bankMovementAction);
  const ref = useResetOnSuccess(state);
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const errors = fe(state);
  const options = concepts.filter((c) => c.direction === "BOTH" || c.direction === direction);
  return (
    <ActionForm ref={ref} pending={pending} onSubmit={onSubmit} className="space-y-3">
      {state?.ok && <Alert tone="success">Movimiento registrado.</Alert>}
      <FormError state={state} />
      <Warnings state={state} label="Confirmo el egreso aunque la cuenta quede en negativo" />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="account" value={`${kind}:${id}`} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`f-direction-${kind}`}>Tipo</Label>
          <Select id={`f-direction-${kind}`} name="direction" value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT")} className="mt-1">
            <option value="OUT">Egreso</option>
            <option value="IN">Ingreso</option>
          </Select>
        </div>
        <Field label="Fecha" name="date" type="date" max={today} defaultValue={today} required errors={errors?.date} />
      </div>
      <SelectField label="Concepto" name="conceptId" required placeholder="Elegir…" options={options.map((c) => ({ value: c.id, label: c.name }))} errors={errors?.conceptId} />
      <Field label="Importe" name="amount" inputMode="decimal" placeholder="0,00" required errors={errors?.amount} />
      <Field label="Descripción" name="description" required minLength={3} maxLength={300} errors={errors?.description} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Referencia" name="reference" maxLength={100} placeholder={kind === "BANK" ? "N.º de operación" : ""} errors={errors?.reference} />
        {kind === "BANK" && <Field label="Fecha valor" name="valueDate" type="date" errors={errors?.valueDate} />}
      </div>
      <SubmitButton pendingText="Registrando…">Registrar movimiento</SubmitButton>
      <p className="text-xs text-slate-500">
        Cobranzas, pagos y gastos con comprobante no se cargan aquí: se registran en su módulo y generan el movimiento solos.
      </p>
    </ActionForm>
  );
}

/** Reversión de un movimiento manual: botón que despliega el motivo. */
export function ReverseMovementButton({ kind, id }: { kind: Kind; id: number }) {
  const { state, pending, onSubmit } = useActionForm(kind === "CASH" ? reverseCashMovementAction : reverseBankMovementAction);
  const [open, setOpen] = useState(false);
  if (state?.ok) return <span className="text-xs text-emerald-700">Revertido</span>;
  if (!open)
    return (
      <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setOpen(true)}>
        Revertir
      </button>
    );
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="flex items-center gap-2" confirmMessage="¿Revertir este movimiento? Se registra un movimiento espejo con fecha de hoy.">
      <input type="hidden" name="id" value={id} />
      <input name="reason" required minLength={5} maxLength={300} placeholder="Motivo" aria-label="Motivo de la reversión" className="w-44 rounded border border-slate-300 px-2 py-1 text-xs" />
      <button type="submit" disabled={pending} className="text-xs font-medium text-red-700 hover:underline">
        {pending ? "…" : "Confirmar"}
      </button>
      {state && !state.ok && <span className="text-xs text-red-700">{fe(state)?.reason?.[0] ?? state.error}</span>}
    </ActionForm>
  );
}

export function CashClosureForm({ cashBoxId, today, systemBalanceToday }: { cashBoxId: number; today: string; systemBalanceToday: string }) {
  const { state, pending, onSubmit } = useActionForm(closeCashBoxAction);
  const ref = useResetOnSuccess(state);
  const errors = fe(state);
  const result = state?.ok ? (state.data as { difference: string }) : null;
  return (
    <ActionForm
      ref={ref}
      pending={pending}
      onSubmit={onSubmit}
      className="space-y-3"
      confirmMessage="Después del cierre la caja no acepta movimientos con esa fecha o anteriores. ¿Cerrar?"
    >
      {result && (
        <Alert tone={result.difference === "0.00" ? "success" : "warning"}>
          Caja cerrada. {result.difference === "0.00" ? "Sin diferencias." : `Se registró una diferencia de ${result.difference.replace(".", ",")}.`}
        </Alert>
      )}
      <FormError state={state} />
      <input type="hidden" name="cashBoxId" value={cashBoxId} />
      <Field label="Fecha del cierre" name="closureDate" type="date" max={today} defaultValue={today} required errors={errors?.closureDate} />
      <Field
        label="Efectivo contado"
        name="countedAmount"
        inputMode="decimal"
        placeholder="0,00"
        required
        errors={errors?.countedAmount}
        hint={`Saldo del sistema hoy: ${systemBalanceToday}. Para otra fecha se calcula al cerrar.`}
      />
      <TextareaField label="Observaciones (obligatorias si hay diferencia)" name="notes" maxLength={500} errors={errors?.notes} />
      <SubmitButton pendingText="Cerrando…">Arquear y cerrar</SubmitButton>
    </ActionForm>
  );
}

export function TransferForm({ accounts, idempotencyKey, today }: { accounts: { value: string; label: string; currency: string }[]; idempotencyKey: string; today: string }) {
  const { state, pending, onSubmit } = useActionForm(transferAction);
  const ref = useResetOnSuccess(state);
  const errors = fe(state);
  const options = accounts.map((a) => ({ value: a.value, label: `${a.label} (${a.currency})` }));
  return (
    <ActionForm ref={ref} pending={pending} onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        {state?.ok && <Alert tone="success">Transferencia registrada.</Alert>}
        <FormError state={state} />
        <Warnings state={state} label="Confirmo la transferencia aunque el origen quede en negativo" />
      </div>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <SelectField label="Desde" name="from" required placeholder="Elegir…" options={options} errors={errors?.from} />
      <SelectField label="Hacia" name="to" required placeholder="Elegir…" options={options} errors={errors?.to} />
      <Field label="Fecha" name="date" type="date" max={today} defaultValue={today} required errors={errors?.date} />
      <Field label="Importe" name="amount" inputMode="decimal" placeholder="0,00" required errors={errors?.amount} />
      <div className="md:col-span-2">
        <Field label="Descripción" name="description" maxLength={300} placeholder="Ej.: Depósito de la recaudación" errors={errors?.description} />
      </div>
      <div className="md:col-span-2">
        <SubmitButton pendingText="Registrando…">Registrar transferencia</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AnnulTransferButton({ id }: { id: number }) {
  const { state, pending, onSubmit } = useActionForm(annulTransferAction);
  const [open, setOpen] = useState(false);
  if (state?.ok) return <span className="text-xs text-emerald-700">Anulada</span>;
  if (!open)
    return (
      <button type="button" className={buttonClass("ghost", "px-2 py-1 text-xs text-red-700")} onClick={() => setOpen(true)}>
        Anular
      </button>
    );
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="flex items-center gap-2" confirmMessage="¿Anular la transferencia? Se revierten sus dos movimientos con fecha de hoy.">
      <input type="hidden" name="id" value={id} />
      <input name="reason" required minLength={5} maxLength={300} placeholder="Motivo" aria-label="Motivo de la anulación" className="w-44 rounded border border-slate-300 px-2 py-1 text-xs" />
      <button type="submit" disabled={pending} className="text-xs font-medium text-red-700 hover:underline">
        {pending ? "…" : "Confirmar"}
      </button>
      {state && !state.ok && <span className="text-xs text-red-700">{fe(state)?.reason?.[0] ?? state.error}</span>}
    </ActionForm>
  );
}
