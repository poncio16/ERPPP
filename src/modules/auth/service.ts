import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/service";
import { getConfig } from "@/modules/config/service";
import { DomainError, ValidationError } from "@/lib/errors";
import {
  hashPassword,
  passwordPolicyErrors,
  verifyAgainstDummy,
  verifyPassword,
} from "@/server/auth/password";
import { generateSessionToken, hashToken } from "@/server/auth/tokens";
import type { RequestMeta, ServiceContext } from "@/server/context";
import type { Db, DbOrTx, Tx } from "@/server/db/drizzle";
import { auditLog, permissions, rolePermissions, sessions, userRoles, users } from "@/server/db/schema";
import type { Permission } from "./permissions";

export const INVALID_CREDENTIALS_MESSAGE =
  "Usuario o contraseña incorrectos. Después de varios intentos fallidos el usuario se bloquea temporalmente.";

/** Intentos fallidos desde una misma IP, en 15 minutos, a partir de los cuales se rechaza todo intento. */
const MAX_FAILED_PER_IP = 20;

export interface NewSession {
  token: string;
  sessionId: number;
  expiresAt: Date;
}

export type LoginResult =
  | ({ ok: true; mustChangePassword: boolean } & NewSession)
  | { ok: false; message: string };

export interface SessionInfo {
  sessionId: number;
  userId: number;
  username: string;
  fullName: string;
  mustChangePassword: boolean;
  permissions: ReadonlySet<Permission>;
  expiresAt: Date;
}

export async function loadPermissions(db: DbOrTx, userId: number): Promise<Set<Permission>> {
  const rows = await db
    .selectDistinct({ code: permissions.code })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
  return new Set(rows.map((r) => r.code as Permission));
}

export async function createSession(tx: DbOrTx, userId: number, meta: RequestMeta): Promise<NewSession> {
  const hours = await getConfig(tx, "session_absolute_hours");
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  const [row] = await tx
    .insert(sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row!.id, expiresAt };
}

export async function revokeUserSessions(tx: DbOrTx, userId: number, reason: string, exceptSessionId?: number) {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    );
}

/** Inicio de sesión con usuario y contraseña. Nunca revela si el usuario existe. */
export async function login(db: Db, input: { username: string; password: string }, meta: RequestMeta): Promise<LoginResult> {
  const username = input.username.trim().toLowerCase();
  const actor = { ...meta, username };
  const fail = async (message: string, userId?: number) => {
    await recordAudit(db, { ...actor, userId }, { module: "auth", action: "login", result: "DENIED", message });
    return { ok: false as const, message: INVALID_CREDENTIALS_MESSAGE };
  };

  if (meta.ip) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.module, "auth"),
          eq(auditLog.action, "login"),
          eq(auditLog.result, "DENIED"),
          eq(auditLog.ip, meta.ip),
          gt(auditLog.occurredAt, sql`now() - interval '15 minutes'`),
        ),
      );
    if ((r?.n ?? 0) >= MAX_FAILED_PER_IP) return fail("Demasiados intentos fallidos desde la misma IP");
  }

  const [user] = await db.select().from(users).where(sql`lower(${users.username}) = ${username}`);
  if (!user) {
    await verifyAgainstDummy(input.password);
    return fail("Usuario inexistente");
  }
  if (user.status !== "ACTIVE") {
    await verifyAgainstDummy(input.password);
    return fail(`Usuario en estado ${user.status}`, user.id);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await verifyAgainstDummy(input.password);
    return fail("Usuario bloqueado temporalmente", user.id);
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const maxAttempts = await getConfig(db, "login_max_attempts");
    const lockMinutes = await getConfig(db, "login_lock_minutes");
    await db.transaction(async (tx) => {
      const [u] = await tx
        .update(users)
        .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
        .where(eq(users.id, user.id))
        .returning({ failed: users.failedLoginCount });
      if ((u?.failed ?? 0) >= maxAttempts) {
        await tx
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + lockMinutes * 60_000) })
          .where(eq(users.id, user.id));
        await recordAudit(tx, { ...actor, userId: user.id }, {
          module: "auth",
          action: "lock",
          entityType: "user",
          entityId: user.id,
          message: `Bloqueado ${lockMinutes} minutos por ${maxAttempts} intentos fallidos`,
        });
      }
    });
    return fail("Contraseña incorrecta", user.id);
  }

  return db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    const session = await createSession(tx, user.id, meta);
    await recordAudit(tx, { ...actor, userId: user.id, sessionId: session.sessionId }, {
      module: "auth",
      action: "login",
      entityType: "session",
      entityId: session.sessionId,
    });
    return { ok: true as const, mustChangePassword: user.mustChangePassword, ...session };
  });
}

/** Valida el token de la cookie. Devuelve null si no existe, expiró, fue revocado o el usuario no está activo. */
export async function validateSessionToken(db: Db, token: string): Promise<SessionInfo | null> {
  if (!token || token.length > 100) return null;
  const idleMinutes = await getConfig(db, "session_idle_minutes");
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      username: users.username,
      fullName: users.fullName,
      mustChangePassword: users.mustChangePassword,
      status: users.status,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)));
  if (!row || row.revokedAt || row.status !== "ACTIVE") return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) return null;
  if (row.lastSeenAt.getTime() + idleMinutes * 60_000 <= now) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: "Inactividad" })
      .where(eq(sessions.id, row.sessionId));
    return null;
  }
  // Se actualiza la última actividad como máximo una vez por minuto.
  if (now - row.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    username: row.username,
    fullName: row.fullName,
    mustChangePassword: row.mustChangePassword,
    permissions: await loadPermissions(db, row.userId),
    expiresAt: row.expiresAt,
  };
}

export async function logout(db: Db, token: string, meta: RequestMeta): Promise<void> {
  await db.transaction(async (tx) => {
    const [s] = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: "Cierre de sesión" })
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id, userId: sessions.userId });
    if (s) {
      await recordAudit(tx, { ...meta, userId: s.userId, sessionId: s.id }, {
        module: "auth",
        action: "logout",
        entityType: "session",
        entityId: s.id,
      });
    }
  });
}

/**
 * Cambio de contraseña por el propio usuario. Revoca todas sus sesiones y abre una nueva,
 * de modo que una sesión robada deja de servir.
 */
export async function changeOwnPassword(
  db: Db,
  ctx: ServiceContext,
  input: { currentPassword: string; newPassword: string },
): Promise<NewSession> {
  const [user] = await db.select().from(users).where(eq(users.id, ctx.userId));
  if (!user) throw new DomainError("Usuario inexistente.");
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    await recordAudit(db, ctx, {
      module: "auth",
      action: "change_password",
      entityType: "user",
      entityId: user.id,
      result: "DENIED",
      message: "Contraseña actual incorrecta",
    });
    throw new ValidationError({ currentPassword: ["La contraseña actual no es correcta."] });
  }
  const minLength = await getConfig(db, "password_min_length");
  const errors = passwordPolicyErrors(input.newPassword, minLength, user.username);
  if (input.newPassword === input.currentPassword) errors.push("Debe ser distinta de la actual.");
  if (errors.length) throw new ValidationError({ newPassword: errors });

  const passwordHash = await hashPassword(input.newPassword);
  return db.transaction(async (tx: Tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(users.id, user.id));
    await revokeUserSessions(tx, user.id, "Cambio de contraseña");
    const session = await createSession(tx, user.id, ctx);
    await recordAudit(tx, { ...ctx, sessionId: session.sessionId }, {
      module: "auth",
      action: "change_password",
      entityType: "user",
      entityId: user.id,
    });
    return session;
  });
}
