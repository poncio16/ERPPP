"use client";

import Decimal from "decimal.js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, FieldErrors, Input, Label, Select, TextareaField, cx } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { FormError, Warnings, fieldErrorsOf } from "@/components/ui/form-feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { proposeFifo } from "@/modules/allocations/plan";
import { registerCollectionAction } from "@/modules/collections/actions";
import { registerPaymentAction } from "@/modules/payments/actions";
import { formatDate } from "@/lib/format";
import { formatMoney, parseAmount } from "@/lib/money";

/**
 * Formulario único de cobranza o pago (F-8/F-9): tercero → comprobantes pendientes → medios →
 * imputación → confirmación. Los medios y las imputaciones viajan como JSON; el servidor vuelve
 * a validar todo (importes, saldos, cheques, cuentas) dentro de la transacción.
 */

type Kind = "COLLECTION" | "PAYMENT";
type Option = { id: number; name: string };

export interface OpenDebitOption {
  id: number;
  label: string;
  issueDate: string;
  dueDate: string;
  total: string;
  balance: string;
}

export interface PortfolioCheckOption {
  id: number;
  label: string;
  amount: string;
}

interface Props {
  kind: Kind;
  party: { id: number; name: string };
  idempotencyKey: string;
  today: string;
  openDebits: OpenDebitOption[];
  cashBoxes: Option[];
  bankAccounts: Option[];
  issuerBanks: Option[];
  retentionTaxes: Option[];
  portfolio: PortfolioCheckOption[];
  preselect?: number;
}

type Method = "CASH" | "TRANSFER" | "CHECK" | "OWN_CHECK" | "THIRD_PARTY_CHECK" | "RETENTION";
interface LineState {
  key: number;
  method: Method;
  amount: string;
  cashBoxId: string;
  bankAccountId: string;
  transferDate: string;
  transferReference: string;
  checkFormat: "PHYSICAL" | "ECHEQ";
  checkType: "COMMON" | "DEFERRED";
  checkBankId: string;
  checkNumber: string;
  drawerTaxId: string;
  drawerName: string;
  issueDate: string;
  paymentDate: string;
  receivedCheckId: string;
  retentionTaxId: string;
  certificate: string;
  retentionDate: string;
}

const METHODS: Record<Kind, { value: Method; label: string }[]> = {
  COLLECTION: [
    { value: "CASH", label: "Efectivo" },
    { value: "TRANSFER", label: "Transferencia" },
    { value: "CHECK", label: "Cheque" },
    { value: "RETENTION", label: "Retención sufrida" },
  ],
  PAYMENT: [
    { value: "CASH", label: "Efectivo" },
    { value: "TRANSFER", label: "Transferencia" },
    { value: "OWN_CHECK", label: "Cheque propio" },
    { value: "THIRD_PARTY_CHECK", label: "Cheque de terceros (endoso)" },
    { value: "RETENTION", label: "Retención practicada" },
  ],
};

const TEXT = {
  COLLECTION: { party: "Cliente", total: "Total cobrado", unapplied: "Queda como saldo a favor del cliente", submit: "Registrar cobranza", pending: "Registrando…", base: "/cobranzas" },
  PAYMENT: { party: "Proveedor", total: "Total pagado", unapplied: "Queda como anticipo / saldo a favor ante el proveedor", submit: "Registrar pago", pending: "Registrando…", base: "/pagos" },
} as const;

const toDecimal = (v: string) => {
  const d = parseAmount(v);
  return d && d.isFinite() ? d : new Decimal(0);
};

let lineKey = 0;
const newLine = (method: Method, today: string, amount = ""): LineState => ({
  key: ++lineKey,
  method,
  amount,
  cashBoxId: "",
  bankAccountId: "",
  transferDate: today,
  transferReference: "",
  checkFormat: "PHYSICAL",
  checkType: "COMMON",
  checkBankId: "",
  checkNumber: "",
  drawerTaxId: "",
  drawerName: "",
  issueDate: today,
  paymentDate: today,
  receivedCheckId: "",
  retentionTaxId: "",
  certificate: "",
  retentionDate: today,
});

/** Convierte el estado de una línea en el objeto que espera el esquema del servidor. */
function serializeLine(l: LineState) {
  switch (l.method) {
    case "CASH":
      return { method: l.method, amount: l.amount, cashBoxId: l.cashBoxId };
    case "TRANSFER":
      return { method: l.method, amount: l.amount, bankAccountId: l.bankAccountId, transferDate: l.transferDate, transferReference: l.transferReference };
    case "CHECK":
      return {
        method: l.method,
        amount: l.amount,
        check: {
          format: l.checkFormat,
          checkType: l.checkType,
          issuerBankId: l.checkBankId,
          number: l.checkNumber,
          drawerTaxId: l.drawerTaxId,
          drawerName: l.drawerName,
          issueDate: l.issueDate,
          paymentDate: l.paymentDate,
        },
      };
    case "OWN_CHECK":
      return {
        method: l.method,
        amount: l.amount,
        check: { bankAccountId: l.bankAccountId, format: l.checkFormat, checkType: l.checkType, number: l.checkNumber, issueDate: l.issueDate, paymentDate: l.paymentDate },
      };
    case "THIRD_PARTY_CHECK":
      return { method: l.method, receivedCheckId: l.receivedCheckId };
    case "RETENTION":
      return { method: l.method, amount: l.amount, retentionTaxId: l.retentionTaxId, certificate: l.certificate, retentionDate: l.retentionDate };
  }
}

function MiniField({ label, errors, children, className }: { label: string; errors?: string[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {/* El <label> envuelve al control: queda asociado (lectores de pantalla y pruebas en el navegador). */}
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        <span className="mt-1 block">{children}</span>
      </label>
      <FieldErrors errors={errors} />
    </div>
  );
}

export function OperationForm(props: Props) {
  const { kind, party, today, openDebits, portfolio } = props;
  const t = TEXT[kind];
  const router = useRouter();
  const action = kind === "COLLECTION" ? registerCollectionAction : registerPaymentAction;
  const { state, pending, onSubmit } = useActionForm(action);
  const errors = fieldErrorsOf(state);

  const [lines, setLines] = useState<LineState[]>(() => [newLine("CASH", today)]);
  const [amounts, setAmounts] = useState<Record<number, string>>(() => (props.preselect ? { [props.preselect]: openDebits.find((d) => d.id === props.preselect)?.balance ?? "" } : {}));

  useEffect(() => {
    if (state?.ok) router.push(`${t.base}/${(state.data as { id: number }).id}?registrada=1`);
  }, [state, router, t.base]);

  const portfolioById = useMemo(() => new Map(portfolio.map((c) => [String(c.id), c])), [portfolio]);
  const lineAmount = (l: LineState) => (l.method === "THIRD_PARTY_CHECK" ? new Decimal(portfolioById.get(l.receivedCheckId)?.amount ?? 0) : toDecimal(l.amount));
  const total = lines.reduce((a, l) => a.plus(lineAmount(l)), new Decimal(0));
  const allocated = Object.values(amounts).reduce((a, v) => a.plus(toDecimal(v)), new Decimal(0));
  const unapplied = total.minus(allocated);

  const update = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));
  const propose = () => {
    const plan = proposeFifo(openDebits, total.toFixed(2));
    setAmounts(Object.fromEntries(plan.map((p) => [p.documentId, p.amount.replace(".", ",")])));
  };

  const linesJson = JSON.stringify(lines.map(serializeLine));
  const allocationsJson = JSON.stringify(
    Object.entries(amounts)
      .filter(([, v]) => v.trim() !== "")
      .map(([documentId, amount]) => ({ documentId: Number(documentId), amount })),
  );
  const lineErrors = (i: number, field: string) => errors?.[`lines.${i}.${field}`];
  const generalLineErrors = Object.entries(errors ?? {})
    .filter(([k]) => k === "lines" || /^lines\.\d+$/.test(k))
    .flatMap(([, v]) => v);
  const allocationErrors = Object.entries(errors ?? {})
    .filter(([k]) => k.startsWith("allocations"))
    .flatMap(([, v]) => v);
  const usedChecks = new Set(lines.filter((l) => l.method === "THIRD_PARTY_CHECK").map((l) => l.receivedCheckId));

  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      <input type="hidden" name={kind === "COLLECTION" ? "clientId" : "supplierId"} value={party.id} />
      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="allocations" value={allocationsJson} />

      <Card className="grid gap-4 p-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label>{t.party}</Label>
          <p className="mt-1 font-medium text-slate-900">{party.name}</p>
        </div>
        <MiniField label="Fecha" errors={errors?.date}>
          <Input type="date" name="date" defaultValue={today} max={today} required />
        </MiniField>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">{kind === "COLLECTION" ? "Medios de cobro" : "Medios de pago"}</h2>
          <div className="flex flex-wrap gap-2">
            {METHODS[kind].map((m) => (
              <Button key={m.value} type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, newLine(m.value, today)])}>
                + {m.label}
              </Button>
            ))}
          </div>
        </div>
        {generalLineErrors.length > 0 && <Alert tone="error">{generalLineErrors.join(" ")}</Alert>}
        <div className="space-y-4">
          {lines.map((l, i) => (
            <div key={l.key} className="rounded-md border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">
                  {i + 1}. {METHODS[kind].find((m) => m.value === l.method)?.label}
                </span>
                {lines.length > 1 && (
                  <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => remove(l.key)}>
                    Quitar
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                {l.method !== "THIRD_PARTY_CHECK" && (
                  <MiniField label="Importe" errors={lineErrors(i, "amount")}>
                    <Input inputMode="decimal" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} placeholder="0,00" required />
                  </MiniField>
                )}
                {l.method === "CASH" && (
                  <MiniField label="Caja" errors={lineErrors(i, "cashBoxId")}>
                    <Select value={l.cashBoxId} onChange={(e) => update(l.key, { cashBoxId: e.target.value })} required>
                      <option value="">Elija…</option>
                      {props.cashBoxes.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </MiniField>
                )}
                {l.method === "TRANSFER" && (
                  <>
                    <MiniField label="Cuenta bancaria" errors={lineErrors(i, "bankAccountId")}>
                      <Select value={l.bankAccountId} onChange={(e) => update(l.key, { bankAccountId: e.target.value })} required>
                        <option value="">Elija…</option>
                        {props.bankAccounts.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                    </MiniField>
                    <MiniField label="Fecha de la transferencia" errors={lineErrors(i, "transferDate")}>
                      <Input type="date" value={l.transferDate} max={today} onChange={(e) => update(l.key, { transferDate: e.target.value })} required />
                    </MiniField>
                    <MiniField label="Referencia" errors={lineErrors(i, "transferReference")}>
                      <Input value={l.transferReference} maxLength={100} onChange={(e) => update(l.key, { transferReference: e.target.value })} />
                    </MiniField>
                  </>
                )}
                {(l.method === "CHECK" || l.method === "OWN_CHECK") && (
                  <>
                    {l.method === "CHECK" ? (
                      <MiniField label="Banco emisor" errors={lineErrors(i, "check.issuerBankId")}>
                        <Select value={l.checkBankId} onChange={(e) => update(l.key, { checkBankId: e.target.value })} required>
                          <option value="">Elija…</option>
                          {props.issuerBanks.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </Select>
                      </MiniField>
                    ) : (
                      <MiniField label="Cuenta del cheque" errors={lineErrors(i, "check.bankAccountId")}>
                        <Select value={l.bankAccountId} onChange={(e) => update(l.key, { bankAccountId: e.target.value })} required>
                          <option value="">Elija…</option>
                          {props.bankAccounts.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </Select>
                      </MiniField>
                    )}
                    <MiniField label="Número" errors={lineErrors(i, "check.number")}>
                      <Input value={l.checkNumber} maxLength={20} onChange={(e) => update(l.key, { checkNumber: e.target.value })} required />
                    </MiniField>
                    <MiniField label="Formato y tipo" errors={lineErrors(i, "check.format") ?? lineErrors(i, "check.checkType")}>
                      <div className="flex gap-2">
                        <Select value={l.checkFormat} onChange={(e) => update(l.key, { checkFormat: e.target.value as LineState["checkFormat"] })}>
                          <option value="PHYSICAL">Físico</option>
                          <option value="ECHEQ">ECHEQ</option>
                        </Select>
                        <Select value={l.checkType} onChange={(e) => update(l.key, { checkType: e.target.value as LineState["checkType"] })}>
                          <option value="COMMON">Común</option>
                          <option value="DEFERRED">Pago diferido</option>
                        </Select>
                      </div>
                    </MiniField>
                    <MiniField label="Fecha de emisión" errors={lineErrors(i, "check.issueDate")}>
                      <Input type="date" value={l.issueDate} onChange={(e) => update(l.key, { issueDate: e.target.value })} required />
                    </MiniField>
                    <MiniField label="Fecha de pago" errors={lineErrors(i, "check.paymentDate")}>
                      <Input type="date" value={l.paymentDate} onChange={(e) => update(l.key, { paymentDate: e.target.value })} required />
                    </MiniField>
                    {l.method === "CHECK" && (
                      <>
                        <MiniField label="CUIT del librador" errors={lineErrors(i, "check.drawerTaxId")}>
                          <Input value={l.drawerTaxId} maxLength={13} onChange={(e) => update(l.key, { drawerTaxId: e.target.value })} required />
                        </MiniField>
                        <MiniField label="Librador" errors={lineErrors(i, "check.drawerName")}>
                          <Input value={l.drawerName} maxLength={150} onChange={(e) => update(l.key, { drawerName: e.target.value })} required />
                        </MiniField>
                      </>
                    )}
                  </>
                )}
                {l.method === "THIRD_PARTY_CHECK" && (
                  <MiniField label="Cheque en cartera" errors={lineErrors(i, "receivedCheckId")} className="sm:col-span-3">
                    <Select value={l.receivedCheckId} onChange={(e) => update(l.key, { receivedCheckId: e.target.value })} required>
                      <option value="">Elija…</option>
                      {portfolio
                        .filter((c) => c.id === Number(l.receivedCheckId) || !usedChecks.has(String(c.id)))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label} — {formatMoney(c.amount)}
                          </option>
                        ))}
                    </Select>
                  </MiniField>
                )}
                {l.method === "RETENTION" && (
                  <>
                    <MiniField label="Impuesto" errors={lineErrors(i, "retentionTaxId")}>
                      <Select value={l.retentionTaxId} onChange={(e) => update(l.key, { retentionTaxId: e.target.value })} required>
                        <option value="">Elija…</option>
                        {props.retentionTaxes.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </Select>
                    </MiniField>
                    <MiniField label="N° de certificado" errors={lineErrors(i, "certificate")}>
                      <Input value={l.certificate} maxLength={50} onChange={(e) => update(l.key, { certificate: e.target.value })} required />
                    </MiniField>
                    <MiniField label="Fecha" errors={lineErrors(i, "retentionDate")}>
                      <Input type="date" value={l.retentionDate} max={today} onChange={(e) => update(l.key, { retentionDate: e.target.value })} required />
                    </MiniField>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-right text-sm">
          {t.total}: <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
        </p>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Imputación a comprobantes pendientes</h2>
          {openDebits.length > 0 && (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={propose} disabled={total.lte(0)}>
                Proponer por vencimiento
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAmounts({})}>
                Limpiar
              </Button>
            </div>
          )}
        </div>
        {allocationErrors.length > 0 && (
          <Alert tone="error">
            <ul className="list-disc pl-5">
              {allocationErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}
        {openDebits.length === 0 ? (
          <p className="text-sm text-slate-600">No hay comprobantes pendientes. El importe quedará como saldo a favor.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Comprobante</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Fecha</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Vencimiento</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-700">Total</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-700">Saldo</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-700">A imputar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openDebits.map((d) => {
                  const overdue = d.dueDate < today;
                  const value = amounts[d.id] ?? "";
                  const tooMuch = value !== "" && toDecimal(value).gt(d.balance);
                  return (
                    <tr key={d.id}>
                      <td className="px-3 py-2">{d.label}</td>
                      <td className="px-3 py-2">{formatDate(d.issueDate)}</td>
                      <td className={cx("px-3 py-2", overdue && "font-medium text-red-700")}>{formatDate(d.dueDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(d.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(d.balance)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setAmounts((a) => ({ ...a, [d.id]: d.balance.replace(".", ",") }))}>
                            Total
                          </button>
                          <Input
                            aria-label={`Importe a imputar a ${d.label}`}
                            className={cx("w-36 text-right", tooMuch && "border-red-500")}
                            inputMode="decimal"
                            value={value}
                            placeholder="0,00"
                            onChange={(e) => setAmounts((a) => ({ ...a, [d.id]: e.target.value }))}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <dl className="mt-3 grid gap-1 text-right text-sm">
          <div>
            <dt className="inline">Imputado: </dt>
            <dd className="inline font-semibold tabular-nums">{formatMoney(allocated)}</dd>
          </div>
          <div className={unapplied.isNegative() ? "text-red-700" : ""}>
            <dt className="inline">{unapplied.isNegative() ? "El imputado supera el total en: " : `${t.unapplied}: `}</dt>
            <dd className="inline font-semibold tabular-nums">{formatMoney(unapplied.abs())}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-4">
        <TextareaField label="Observaciones" name="notes" rows={2} maxLength={500} errors={errors?.notes} />
      </Card>

      <FormError state={state} />
      <Warnings state={state} label="Revisé las advertencias y confirmo el registro" />
      <div className="flex justify-end">
        <SubmitButton pendingText={t.pending} disabled={total.lte(0) || unapplied.isNegative()}>
          {t.submit} por {formatMoney(total)}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
