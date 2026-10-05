import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/service";
import { ALL_PERMISSIONS, type Permission, type RoleCode } from "@/modules/auth/permissions";
import { revokeUserSessions } from "@/modules/auth/service";
import { DomainError, ValidationError } from "@/lib/errors";
import { assertPermission } from "@/server/authorization";
import { generateTemporaryPassword, hashPassword } from "@/server/auth/password";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx } from "@/server/db/drizzle";
import { permissions, rolePermissions, roles, sessions, userRoles, users } from "@/server/db/schema";
import type { CreateUserInput, UpdateUserInput } from "./schemas";

export interface UserRow {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  status: string;
  roles: RoleCode[];
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
}

export async function listUsers(db: Db, ctx: ServiceContext): Promise<UserRow[]> {
  assertPermission(ctx, "users.manage");
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      email: users.email,
      status: users.status,
      lockedUntil: users.lockedUntil,
      lastLoginAt: users.lastLoginAt,
      mustChangePassword: users.mustChangePassword,
      roles: sql<RoleCode[]>`coalesce(array_agg(${roles.code} ORDER BY ${roles.code}) FILTER (WHERE ${roles.code} IS NOT NULL), '{}')`,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .groupBy(users.id)
    .orderBy(asc(users.username));
  return rows;
}

export async function getUser(db: Db, ctx: ServiceContext, userId: number): Promise<UserRow> {
  const all = await listUsers(db, ctx);
  const user = all.find((u) => u.id === userId);
  if (!user) throw new DomainError("El usuario no existe.", "NOT_FOUND");
  return user;
}

async function roleIds(tx: DbOrTx, codes: RoleCode[]): Promise<number[]> {
  const rows = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.code, codes));
  if (rows.length !== codes.length) throw new ValidationError({ roles: ["Rol inexistente."] });
  return rows.map((r) => r.id);
}

async function activeAdminCount(tx: DbOrTx, excludeUserId?: number): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(DISTINCT ${users.id})::int` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(roles.code, "ADMIN"),
        eq(users.status, "ACTIVE"),
        excludeUserId ? sql`${users.id} <> ${excludeUserId}` : undefined,
      ),
    );
  return r?.n ?? 0;
}

/** Alta de usuario con contraseña temporal (se muestra una sola vez y debe cambiarse al ingresar). */
export async function createUser(db: Db, ctx: ServiceContext, input: CreateUserInput) {
  assertPermission(ctx, "users.manage");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return db.transaction(async (tx) => {
    const [exists] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${input.username}`);
    if (exists) throw new ValidationError({ username: ["Ya existe un usuario con ese nombre."] });
    if (input.email) {
      const [mail] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${input.email})`);
      if (mail) throw new ValidationError({ email: ["Ya existe un usuario con ese correo."] });
    }
    const [user] = await tx
      .insert(users)
      .values({
        username: input.username,
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        mustChangePassword: true,
        createdBy: ctx.userId,
      })
      .returning({ id: users.id });
    const ids = await roleIds(tx, input.roles);
    await tx.insert(userRoles).values(ids.map((roleId) => ({ userId: user!.id, roleId })));
    await recordAudit(tx, ctx, {
      module: "users",
      action: "create",
      entityType: "user",
      entityId: user!.id,
      after: { username: input.username, fullName: input.fullName, email: input.email, roles: input.roles },
    });
    return { userId: user!.id, temporaryPassword };
  });
}

/**
 * Crea el primer administrador (puesta en marcha). Solo funciona si no existe ningún
 * administrador activo; devuelve la contraseña temporal, que debe cambiarse al ingresar.
 */
export async function createInitialAdmin(db: Db, input: { username: string; fullName: string; requestId: string }) {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return db.transaction(async (tx) => {
    // Serializa para que dos ejecuciones simultáneas no creen dos administradores iniciales.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('erp_initial_admin'))`);
    if ((await activeAdminCount(tx)) > 0) throw new DomainError("Ya existe un administrador activo.");
    const [user] = await tx
      .insert(users)
      .values({ username: input.username.toLowerCase(), fullName: input.fullName, passwordHash, mustChangePassword: true })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ userId: user!.id, roleId: (await roleIds(tx, ["ADMIN"]))[0]! });
    await recordAudit(tx, { requestId: input.requestId, username: "sistema" }, {
      module: "users",
      action: "create_initial_admin",
      entityType: "user",
      entityId: user!.id,
      after: { username: input.username, fullName: input.fullName, roles: ["ADMIN"] },
    });
    return { userId: user!.id, temporaryPassword };
  });
}

/** Modificación de datos, roles y estado. Cambiar roles o estado revoca las sesiones del usuario. */
export async function updateUser(db: Db, ctx: ServiceContext, input: UpdateUserInput) {
  assertPermission(ctx, "users.manage");
  const before = await getUser(db, ctx, input.userId);
  if (input.userId === ctx.userId && input.status !== "ACTIVE")
    throw new ValidationError({ status: ["No puede desactivar su propio usuario."] });
  const removesAdmin = before.roles.includes("ADMIN") && (!input.roles.includes("ADMIN") || input.status !== "ACTIVE");

  await db.transaction(async (tx) => {
    // Bloquea la fila para serializar modificaciones concurrentes del mismo usuario.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
    if (removesAdmin && (await activeAdminCount(tx, input.userId)) === 0)
      throw new ValidationError({ roles: ["Debe quedar al menos un administrador activo."] });
    if (input.email) {
      const [mail] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${input.email})`, sql`${users.id} <> ${input.userId}`));
      if (mail) throw new ValidationError({ email: ["Ya existe un usuario con ese correo."] });
    }
    await tx
      .update(users)
      .set({
        fullName: input.fullName,
        email: input.email,
        status: input.status,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(users.id, input.userId));
    const rolesChanged = [...before.roles].sort().join() !== [...input.roles].sort().join();
    if (rolesChanged) {
      await tx.delete(userRoles).where(eq(userRoles.userId, input.userId));
      const ids = await roleIds(tx, input.roles);
      await tx.insert(userRoles).values(ids.map((roleId) => ({ userId: input.userId, roleId })));
    }
    if (rolesChanged || input.status !== before.status) {
      await revokeUserSessions(tx, input.userId, "Cambio de roles o estado");
    }
    await recordAudit(tx, ctx, {
      module: "users",
      action: rolesChanged ? "update_roles" : "update",
      entityType: "user",
      entityId: input.userId,
      before: { fullName: before.fullName, email: before.email, status: before.status, roles: before.roles },
      after: { fullName: input.fullName, email: input.email, status: input.status, roles: input.roles },
    });
  });
}

/** Blanqueo de contraseña por el administrador: genera una temporal, desbloquea y revoca sesiones. */
export async function resetPassword(db: Db, ctx: ServiceContext, userId: number) {
  assertPermission(ctx, "users.manage");
  await getUser(db, ctx, userId);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(users.id, userId));
    await revokeUserSessions(tx, userId, "Blanqueo de contraseña");
    await recordAudit(tx, ctx, { module: "users", action: "reset_password", entityType: "user", entityId: userId });
  });
  return { temporaryPassword };
}

export async function unlockUser(db: Db, ctx: ServiceContext, userId: number) {
  assertPermission(ctx, "users.manage");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
    await recordAudit(tx, ctx, { module: "users", action: "unlock", entityType: "user", entityId: userId });
  });
}

export async function listRolePermissions(db: Db, ctx: ServiceContext) {
  assertPermission(ctx, "users.manage");
  const allRoles = await db.select().from(roles).orderBy(asc(roles.id));
  const links = await db
    .select({ roleId: rolePermissions.roleId, code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));
  const catalog = await db.select().from(permissions).orderBy(asc(permissions.module), asc(permissions.code));
  return {
    roles: allRoles.map((r) => ({
      ...r,
      permissions: new Set(links.filter((l) => l.roleId === r.id).map((l) => l.code as Permission)),
    })),
    catalog,
  };
}

/** Reemplaza los permisos de un rol. El rol Administrador conserva siempre todos los permisos. */
export async function setRolePermissions(db: Db, ctx: ServiceContext, role: RoleCode, perms: Permission[]) {
  assertPermission(ctx, "users.manage");
  if (role === "ADMIN") throw new DomainError("Los permisos del rol Administrador no se pueden modificar.");
  const wanted = [...new Set(perms)].filter((p) => ALL_PERMISSIONS.includes(p));
  await db.transaction(async (tx) => {
    const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, role)).for("update");
    if (!r) throw new DomainError("Rol inexistente.");
    const current = await tx
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, r.id));
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, r.id));
    if (wanted.length) {
      const ids = await tx.select({ id: permissions.id }).from(permissions).where(inArray(permissions.code, wanted));
      await tx.insert(rolePermissions).values(ids.map((p) => ({ roleId: r.id, permissionId: p.id })));
    }
    // Los usuarios con este rol deben volver a ingresar para tomar los permisos nuevos.
    const affected = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, r.id));
    for (const { userId } of affected) await revokeUserSessions(tx, userId, "Cambio de permisos del rol", ctx.sessionId ?? undefined);
    await recordAudit(tx, ctx, {
      module: "users",
      action: "set_role_permissions",
      entityType: "role",
      entityId: role,
      before: { permissions: current.map((c) => c.code).sort() },
      after: { permissions: [...wanted].sort() },
    });
  });
}

export async function listActiveSessions(db: Db, ctx: ServiceContext) {
  assertPermission(ctx, "users.manage");
  return db
    .select({
      id: sessions.id,
      username: users.username,
      fullName: users.fullName,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function revokeSession(db: Db, ctx: ServiceContext, sessionId: number) {
  assertPermission(ctx, "users.manage");
  await db.transaction(async (tx) => {
    const [s] = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: `Revocada por ${ctx.username}` })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning({ userId: sessions.userId });
    if (!s) throw new DomainError("La sesión no existe o ya fue cerrada.");
    await recordAudit(tx, ctx, { module: "users", action: "revoke_session", entityType: "session", entityId: sessionId });
  });
}
