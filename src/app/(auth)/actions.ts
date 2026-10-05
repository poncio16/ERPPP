"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/modules/auth/service";
import { changePasswordDef } from "@/modules/users/action-defs";
import { LoginSchema } from "@/modules/users/schemas";
import type { ActionResult } from "@/server/action";
import {
  clearSessionCookie,
  getRequestMeta,
  readSessionToken,
  runAction,
  setSessionCookie,
} from "@/server/auth/session";
import { db } from "@/server/db/client";

export type FormState = ActionResult<unknown> | undefined;

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = LoginSchema.safeParse({ username: formData.get("username"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: "Ingrese usuario y contraseña." };
  const result = await login(db, parsed.data, await getRequestMeta());
  if (!result.ok) return { ok: false, error: result.message };
  await setSessionCookie(result.token, result.expiresAt);
  redirect(result.mustChangePassword ? "/cambiar-clave" : "/");
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await logout(db, token, await getRequestMeta());
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction(changePasswordDef, formData);
  if (!result.ok) return result;
  await setSessionCookie(result.data.token, result.data.expiresAt);
  redirect("/?clave=actualizada");
}
