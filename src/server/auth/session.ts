import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Permission } from "@/modules/auth/permissions";
import { validateSessionToken, type SessionInfo } from "@/modules/auth/service";
import { executeAction, formDataToObject, type ActionDef, type ActionResult } from "@/server/action";
import type { RequestMeta, ServiceContext } from "@/server/context";
import { db } from "@/server/db/client";
import type { z } from "zod";

const isProd = process.env.NODE_ENV === "production";
/** En producción el prefijo __Host- obliga a Secure, Path=/ y sin Domain. */
export const SESSION_COOKIE = isProd ? "__Host-erp_session" : "erp_session";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
    requestId: h.get("x-request-id") ?? randomUUID(),
  };
}

/** Sesión actual (una consulta por petición gracias a `cache`). */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = await readSessionToken();
  return token ? validateSessionToken(db, token) : null;
});

export function toContext(session: SessionInfo, meta: RequestMeta): ServiceContext {
  return {
    userId: session.userId,
    username: session.username,
    sessionId: session.sessionId,
    permissions: session.permissions,
    ...meta,
  };
}

/** Para páginas: exige sesión válida y, si corresponde, el cambio de contraseña pendiente. */
export async function requireUser(options: { allowPasswordChange?: boolean } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword && !options.allowPasswordChange) redirect("/cambiar-clave");
  return { session, ctx: toContext(session, await getRequestMeta()) };
}

/** Para páginas: exige un permiso; si falta, muestra la página de acceso denegado. */
export async function requirePagePermission(permission: Permission) {
  const result = await requireUser();
  if (!result.session.permissions.has(permission)) redirect("/sin-permiso");
  return result;
}

/** Ejecuta una acción declarada con `defineAction` desde una Server Action. */
export async function runAction<S extends z.ZodType, R>(
  def: ActionDef<S, R>,
  input: FormData | Record<string, unknown>,
): Promise<ActionResult<R>> {
  const session = await getSession();
  const meta = await getRequestMeta();
  const raw = input instanceof FormData ? formDataToObject(input) : input;
  return executeAction(
    db,
    session ? { ctx: toContext(session, meta), mustChangePassword: session.mustChangePassword } : null,
    meta,
    def,
    raw,
  );
}
