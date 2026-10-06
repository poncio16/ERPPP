"use client";

import { Alert, Badge, Card } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { runConsistencyAction } from "@/modules/consistency/actions";

/** Ejecuta la verificación (G.14) y muestra PASS/FAIL por invariante, con los casos que no cumplen. */
export function ConsistencyRunner() {
  const { state, pending, onSubmit } = useActionForm(runConsistencyAction);
  const data = state?.ok ? state.data : null;
  return (
    <div className="space-y-4">
      <ActionForm pending={pending} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Verificando…">Ejecutar verificación</SubmitButton>
        {data && <span className="text-sm text-slate-600">Última ejecución: {formatDateTime(data.ranAt)}</span>}
      </ActionForm>
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {data && (data.ok ? <Alert tone="success">Todos los invariantes dan diferencia $ 0,00.</Alert> : <Alert tone="error">Hay invariantes con diferencias. Revise los casos señalados.</Alert>)}
      {data?.results.map((r) => (
        <Card key={r.code} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">
                {r.code} · {r.title}
              </p>
              <p className="text-sm text-slate-600">{r.description}</p>
            </div>
            <div className="shrink-0 text-right">
              <Badge tone={r.ok ? "green" : "red"}>{r.ok ? "PASS" : "FAIL"}</Badge>
              {r.difference !== null && <p className="mt-1 text-sm tabular-nums">Diferencia {formatMoney(r.difference)}</p>}
            </div>
          </div>
          {!r.ok && (
            <div className="mt-3 text-sm">
              <p className="text-red-700">{r.failures} caso(s) no cumplen{r.failures > r.samples.length ? `; se muestran los primeros ${r.samples.length}` : ""}:</p>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {r.samples.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
