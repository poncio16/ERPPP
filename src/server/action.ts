import type { z } from "zod";
import { recordAudit } from "@/modules/audit/service";
import type { Permission } from "@/modules/auth/permissions";
import { DomainError, ForbiddenError } from "@/lib/errors";
import type { RequestMeta, ServiceContext } from "./context";
import type { Db } from "./db/drizzle";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Definición de una acción del servidor: permiso requerido + esquema de entrada + servicio.
 * Todas las Server Actions de negocio se declaran así; `executeAction` aplica, en orden,
 * sesión → permiso → validación → servicio, y traduce errores a mensajes para la UI.
 */
export interface ActionDef<S extends z.ZodType = z.ZodType, R = unknown> {
  name: string;
  /** Permiso requerido, o "authenticated" para acciones que cualquier usuario puede hacer sobre sí mismo. */
  permission: Permission | "authenticated";
  schema: S;
  /** Permite ejecutarla aunque el usuario deba cambiar su contraseña (solo el propio cambio). */
  allowWhenPasswordChangeRequired?: boolean;
  handler: (db: Db, ctx: ServiceContext, input: z.output<S>) => Promise<R>;
}

const registry: ActionDef[] = [];

export function defineAction<S extends z.ZodType, R>(def: ActionDef<S, R>): ActionDef<S, R> {
  registry.push(def as unknown as ActionDef);
  return def;
}

/** Todas las acciones declaradas (lo usa la prueba de matriz de permisos). */
export const actionRegistry = (): readonly ActionDef[] => registry;

export interface ActionSession {
  ctx: ServiceContext;
  mustChangePassword: boolean;
}

export async function executeAction<S extends z.ZodType, R>(
  db: Db,
  session: ActionSession | null,
  meta: RequestMeta,
  def: ActionDef<S, R>,
  rawInput: unknown,
): Promise<ActionResult<R>> {
  if (!session) return { ok: false, error: "Su sesión expiró. Vuelva a ingresar." };
  const { ctx } = session;
  const moduleName = def.name.split(".")[0] ?? def.name;

  if (session.mustChangePassword && !def.allowWhenPasswordChangeRequired) {
    return { ok: false, error: "Debe cambiar su contraseña antes de continuar." };
  }
  if (def.permission !== "authenticated" && !ctx.permissions.has(def.permission)) {
    await recordAudit(db, { ...ctx, ...meta }, {
      module: moduleName,
      action: def.name,
      result: "DENIED",
      message: `Sin permiso ${def.permission}`,
    });
    return { ok: false, error: new ForbiddenError(def.permission).message };
  }

  const parsed = def.schema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: "Revise los datos ingresados.", fieldErrors };
  }

  try {
    const data = await def.handler(db, ctx, parsed.data);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      await recordAudit(db, ctx, { module: moduleName, action: def.name, result: "DENIED", message: `Sin permiso ${e.permission}` });
      return { ok: false, error: e.message };
    }
    if (e instanceof DomainError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    const friendly = databaseErrorMessage(e);
    await recordAudit(db, ctx, {
      module: moduleName,
      action: def.name,
      result: "ERROR",
      message: e instanceof Error ? e.message.slice(0, 1000) : String(e),
    }).catch(() => undefined);
    if (!friendly) console.error(`[acción ${def.name}]`, e);
    return { ok: false, error: friendly ?? "Ocurrió un error inesperado. La operación no se registró." };
  }
}

/** Traduce los rechazos de la base (última barrera) a un mensaje comprensible. */
export function databaseErrorMessage(e: unknown): string | null {
  const err = (e as { cause?: unknown }).cause ?? e;
  const code = (err as { code?: string }).code;
  const message = (err as { message?: string }).message ?? "";
  if (code === "23505") return "Ya existe un registro con esos datos (operación duplicada).";
  if (code === "23503") return "El registro está relacionado con otro dato inexistente o en uso.";
  if (code === "40P01" || code === "40001") return "Otra operación modificó los mismos datos. Intente nuevamente.";
  // Errores lanzados por los triggers de integridad: el mensaje ya está en español.
  if (code === "23514" || code === "23001" || code === "P0001") return `La base de datos rechazó la operación: ${message}`;
  return null;
}

/** Convierte FormData en objeto. Las claves terminadas en [] se agrupan como arreglos. */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    if (key.endsWith("[]")) out[key.slice(0, -2)] = fd.getAll(key).map(String);
    else out[key] = String(fd.get(key) ?? "");
  }
  return out;
}
