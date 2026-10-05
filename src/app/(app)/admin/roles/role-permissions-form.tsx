"use client";

import { Alert } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { Permission, RoleCode } from "@/modules/auth/permissions";
import { setRolePermissionsAction } from "@/modules/users/actions";

interface PermissionInfo {
  code: Permission;
  description: string;
  module: string;
}

export function RolePermissionsForm({
  role,
  name,
  granted,
  permissions,
  readOnly,
}: {
  role: RoleCode;
  name: string;
  granted: Permission[];
  permissions: PermissionInfo[];
  readOnly: boolean;
}) {
  const { state, pending, onSubmit } = useActionForm(setRolePermissionsAction);
  const modules = [...new Set(permissions.map((p) => p.module))];
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">{name}</h2>
      {state?.ok && <Alert tone="success">Permisos actualizados.</Alert>}
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="role" value={role} />
      <fieldset disabled={readOnly} className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
        <legend className="sr-only">Permisos de {name}</legend>
        {modules.map((m) => (
          <div key={m}>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{m}</p>
            <ul className="mt-1 space-y-1">
              {permissions
                .filter((p) => p.module === m)
                .map((p) => (
                  <li key={p.code}>
                    <label className="flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="permissions[]"
                        value={p.code}
                        defaultChecked={granted.includes(p.code)}
                        className="mt-0.5 h-4 w-4"
                      />
                      {p.description}
                    </label>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </fieldset>
      {!readOnly && <SubmitButton pendingText="Guardando…">Guardar permisos de {name}</SubmitButton>}
    </ActionForm>
  );
}
