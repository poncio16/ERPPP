"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import {
  createUserDef,
  resetPasswordDef,
  revokeSessionDef,
  setRolePermissionsDef,
  unlockUserDef,
  updateUserDef,
} from "./action-defs";

type State<T = unknown> = ActionResult<T> | undefined;

export async function createUserAction(_prev: State, formData: FormData) {
  const r = await runAction(createUserDef, formData);
  if (r.ok) revalidatePath("/admin/usuarios");
  return r;
}

export async function updateUserAction(_prev: State, formData: FormData) {
  const r = await runAction(updateUserDef, formData);
  if (r.ok) revalidatePath("/admin/usuarios");
  return r;
}

export async function resetPasswordAction(_prev: State, formData: FormData) {
  return runAction(resetPasswordDef, formData);
}

export async function unlockUserAction(_prev: State, formData: FormData) {
  const r = await runAction(unlockUserDef, formData);
  if (r.ok) revalidatePath("/admin/usuarios");
  return r;
}

export async function setRolePermissionsAction(_prev: State, formData: FormData) {
  const r = await runAction(setRolePermissionsDef, formData);
  if (r.ok) revalidatePath("/admin/roles");
  return r;
}

export async function revokeSessionAction(_prev: State, formData: FormData) {
  const r = await runAction(revokeSessionDef, formData);
  if (r.ok) revalidatePath("/admin/sesiones");
  return r;
}
