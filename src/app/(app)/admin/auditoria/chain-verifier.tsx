"use client";

import Link from "next/link";
import { Alert } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/format";
import { verifyAuditChainAction } from "@/modules/audit/actions";

/** "Verificar integridad" (I.3): recorre la cadena de hashes y la compara con el último hash guardado en cada backup. */
export function ChainVerifier() {
  const { state, pending, onSubmit } = useActionForm(verifyAuditChainAction);
  const data = state?.ok ? state.data : null;
  return (
    <div className="space-y-3">
      <ActionForm pending={pending} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingText="Verificando…">
          Verificar integridad
        </SubmitButton>
        {data && <span className="text-sm text-slate-600">Verificado: {formatDateTime(data.verifiedAt)}</span>}
      </ActionForm>
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {data?.ok && (
        <Alert tone="success">
          La cadena está íntegra: {data.total} registros{data.lastId ? `, hasta el #${data.lastId}` : ""}. Se comparó con el último hash guardado en{" "}
          {data.backupsChecked} backup(s) y coincide.
        </Alert>
      )}
      {data && !data.ok && (
        <Alert tone="error">
          {data.brokenAt && (
            <p>
              La cadena se rompe en el{" "}
              <Link className="underline" href={`/admin/auditoria/${data.brokenAt.id}`}>
                registro #{data.brokenAt.id}
              </Link>{" "}
              ({formatDateTime(data.brokenAt.occurredAt)}, {data.brokenAt.username ?? "sin usuario"}): ese registro o el anterior fue alterado.
            </p>
          )}
          {data.backupMismatches.map((m) => (
            <p key={m.backupId}>
              El backup {m.fileName ?? `#${m.backupId}`} guardó otro hash para el registro #{m.auditId}: la auditoría fue reescrita después de ese backup.
            </p>
          ))}
        </Alert>
      )}
    </div>
  );
}
