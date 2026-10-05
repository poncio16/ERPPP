import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditColumns, id, ref, tstz } from "./_common";

export const users = pgTable(
  "users",
  {
    id: id(),
    username: text().notNull(),
    fullName: text().notNull(),
    email: text(),
    passwordHash: text().notNull(),
    status: text().notNull().default("ACTIVE"),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: tstz(),
    mustChangePassword: boolean().notNull().default(true),
    totpSecret: text(),
    passwordChangedAt: tstz(),
    lastLoginAt: tstz(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("ux_users_username").on(sql`lower(${t.username})`),
    uniqueIndex("ux_users_email").on(sql`lower(${t.email})`).where(sql`${t.email} IS NOT NULL`),
    check("ck_users_status", sql`${t.status} IN ('ACTIVE','BLOCKED','INACTIVE')`),
    check("ck_users_failed", sql`${t.failedLoginCount} >= 0`),
  ],
);

export const roles = pgTable("roles", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  isSystem: boolean().notNull().default(false),
  ...auditColumns(),
});

export const permissions = pgTable("permissions", {
  id: id(),
  code: text().notNull().unique(),
  module: text().notNull(),
  description: text().notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: ref()
      .notNull()
      .references(() => roles.id),
    permissionId: ref()
      .notNull()
      .references(() => permissions.id),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: ref()
      .notNull()
      .references(() => users.id),
    roleId: ref()
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text().notNull().unique("ux_sessions_token_hash"),
    userId: ref()
      .notNull()
      .references(() => users.id),
    createdAt: tstz().notNull().defaultNow(),
    lastSeenAt: tstz().notNull().defaultNow(),
    expiresAt: tstz().notNull(),
    ip: text(),
    userAgent: text(),
    revokedAt: tstz(),
    revokeReason: text(),
  },
  (t) => [index("ix_sessions_user").on(t.userId)],
);
