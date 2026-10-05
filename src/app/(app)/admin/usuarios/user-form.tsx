"use client";

import { Alert, Field, FieldErrors, Label, LinkButton, Select } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ROLES, type RoleCode } from "@/modules/auth/permissions";
import { createUserAction, updateUserAction } from "@/modules/users/actions";
import { TemporaryPassword } from "./temporary-password";

interface EditableUser {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  status: string;
  roles: RoleCode[];
}

function RolesField({ selected, errors }: { selected: RoleCode[]; errors?: string[] }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">Roles</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(Object.entries(ROLES) as [RoleCode, string][]).map(([code, label]) => (
          <label key={code} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="roles[]" value={code} defaultChecked={selected.includes(code)} className="h-4 w-4" />
            {label}
          </label>
        ))}
      </div>
      <FieldErrors errors={errors} />
    </fieldset>
  );
}

export function NewUserForm() {
  const { state, pending, onSubmit } = useActionForm(createUserAction);
  if (state?.ok) {
    return (
      <div className="space-y-4">
        <TemporaryPassword username={state.data.username} password={state.data.temporaryPassword} />
        <div className="flex gap-3">
          <LinkButton href={`/admin/usuarios/${state.data.userId}`}>Ver usuario</LinkButton>
          <LinkButton href="/admin/usuarios" variant="secondary">
            Volver al listado
          </LinkButton>
        </div>
      </div>
    );
  }
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-5">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <Field label="Usuario" name="username" required maxLength={40} autoComplete="off" errors={fe?.username}
        hint="Letras minúsculas, números, punto, guion o guion bajo." />
      <Field label="Nombre y apellido" name="fullName" required maxLength={120} errors={fe?.fullName} />
      <Field label="Correo electrónico (opcional)" name="email" type="email" maxLength={200} errors={fe?.email} />
      <RolesField selected={[]} errors={fe?.roles} />
      <SubmitButton pendingText="Creando…">Crear usuario</SubmitButton>
    </ActionForm>
  );
}

export function EditUserForm({ user }: { user: EditableUser }) {
  const { state, pending, onSubmit } = useActionForm(updateUserAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-5">
      {state?.ok && <Alert tone="success">Los cambios se guardaron.</Alert>}
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="userId" value={user.id} />
      <Field label="Nombre y apellido" name="fullName" required maxLength={120} defaultValue={user.fullName} errors={fe?.fullName} />
      <Field label="Correo electrónico (opcional)" name="email" type="email" maxLength={200} defaultValue={user.email ?? ""} errors={fe?.email} />
      <div>
        <Label htmlFor="f-status">Estado</Label>
        <Select id="f-status" name="status" defaultValue={user.status} className="mt-1">
          <option value="ACTIVE">Activo</option>
          <option value="BLOCKED">Bloqueado</option>
          <option value="INACTIVE">Inactivo</option>
        </Select>
        <FieldErrors errors={fe?.status} />
      </div>
      <RolesField selected={user.roles} errors={fe?.roles} />
      <p className="text-xs text-slate-500">
        Al cambiar roles o estado se cierran las sesiones abiertas del usuario.
      </p>
      <SubmitButton pendingText="Guardando…">Guardar cambios</SubmitButton>
    </ActionForm>
  );
}
