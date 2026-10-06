"use client";

import { Alert, Field, SelectField, TextareaField } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { FormError, Warnings, fieldErrorsOf } from "@/components/ui/form-feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  cashCheckAction,
  creditCheckAction,
  debitIssuedCheckAction,
  depositCheckAction,
  presentIssuedCheckAction,
  rejectIssuedCheckAction,
  rejectReceivedCheckAction,
} from "@/modules/checks/actions";

/** Operación sobre un cheque: cada formulario lleva id, versión (bloqueo optimista) y fecha. */
export type CheckStep =
  | { step: "deposit"; bankAccounts: { value: string; label: string }[] }
  | { step: "credit" }
  | { step: "cash"; accounts: { value: string; label: string }[] }
  | { step: "reject_received"; status: string }
  | { step: "present" }
  | { step: "debit" }
  | { step: "reject_issued" };

const ACTIONS = {
  deposit: depositCheckAction,
  credit: creditCheckAction,
  cash: cashCheckAction,
  reject_received: rejectReceivedCheckAction,
  present: presentIssuedCheckAction,
  debit: debitIssuedCheckAction,
  reject_issued: rejectIssuedCheckAction,
} as const;

const TEXT: Record<CheckStep["step"], { title: string; button: string; done: string; danger?: boolean; confirm?: string }> = {
  deposit: { title: "Depositar", button: "Registrar depósito", done: "Depósito registrado. El banco se mueve al acreditarse." },
  credit: { title: "Acreditar", button: "Registrar acreditación", done: "Acreditación registrada en el banco." },
  cash: { title: "Cobrar por ventanilla", button: "Registrar cobro", done: "Cobro registrado." },
  reject_received: {
    title: "Rechazar",
    button: "Registrar rechazo",
    done: "Rechazo registrado.",
    danger: true,
    confirm: "¿Registrar el rechazo? Se genera la nota de débito interna al cliente y, si corresponde, se revierte el banco o se carga al proveedor endosatario.",
  },
  present: { title: "Marcar como presentado", button: "Registrar presentación", done: "Presentación registrada." },
  debit: { title: "Debitar", button: "Registrar débito", done: "Débito registrado en el banco." },
  reject_issued: {
    title: "Rechazar",
    button: "Registrar rechazo",
    done: "Rechazo registrado.",
    danger: true,
    confirm: "¿Registrar el rechazo del cheque propio? Se genera la deuda interna con el proveedor.",
  },
};

export function CheckStepForm({ id, version, today, ...step }: { id: number; version: number; today: string } & CheckStep) {
  const { state, pending, onSubmit } = useActionForm(ACTIONS[step.step]);
  const fe = fieldErrorsOf(state);
  const text = TEXT[step.step];
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} confirmMessage={text.confirm} className="space-y-3">
      <h3 className="font-semibold text-slate-900">{text.title}</h3>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <Field label="Fecha" name="date" type="date" required defaultValue={today} max={today} errors={fe?.date} />
      {step.step === "deposit" && (
        <SelectField label="Cuenta bancaria" name="bankAccountId" required options={step.bankAccounts} placeholder="Elegir…" errors={fe?.bankAccountId} />
      )}
      {step.step === "cash" && <SelectField label="Ingresa en" name="account" required options={step.accounts} placeholder="Elegir…" errors={fe?.account} />}
      {(step.step === "reject_received" || step.step === "reject_issued") && (
        <TextareaField label="Motivo del rechazo" name="reason" rows={2} required minLength={3} maxLength={300} errors={fe?.reason} />
      )}
      {step.step === "reject_received" && step.status === "CREDITED" && (
        <p className="text-xs text-amber-800">El cheque ya estaba acreditado: el rechazo registra el egreso en el banco.</p>
      )}
      <Warnings state={state} label="Entiendo y confirmo" />
      <FormError state={state} />
      {state?.ok && <Alert tone="success">{text.done}</Alert>}
      <SubmitButton variant={text.danger ? "danger" : "primary"} pendingText="Registrando…">
        {text.button}
      </SubmitButton>
    </ActionForm>
  );
}
