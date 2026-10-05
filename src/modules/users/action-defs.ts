import { defineAction } from "@/server/action";
import { changeOwnPassword } from "@/modules/auth/service";
import {
  ChangePasswordSchema,
  CreateUserSchema,
  SessionIdSchema,
  SetRolePermissionsSchema,
  UpdateUserSchema,
  UserIdSchema,
} from "./schemas";
import { createUser, resetPassword, revokeSession, setRolePermissions, unlockUser, updateUser } from "./service";

export const createUserDef = defineAction({
  name: "users.create",
  permission: "users.manage",
  schema: CreateUserSchema,
  handler: async (db, ctx, input) => ({ ...(await createUser(db, ctx, input)), username: input.username }),
});

export const updateUserDef = defineAction({
  name: "users.update",
  permission: "users.manage",
  schema: UpdateUserSchema,
  handler: (db, ctx, input) => updateUser(db, ctx, input),
});

export const resetPasswordDef = defineAction({
  name: "users.reset_password",
  permission: "users.manage",
  schema: UserIdSchema,
  handler: (db, ctx, input) => resetPassword(db, ctx, input.userId),
});

export const unlockUserDef = defineAction({
  name: "users.unlock",
  permission: "users.manage",
  schema: UserIdSchema,
  handler: (db, ctx, input) => unlockUser(db, ctx, input.userId),
});

export const setRolePermissionsDef = defineAction({
  name: "users.set_role_permissions",
  permission: "users.manage",
  schema: SetRolePermissionsSchema,
  handler: (db, ctx, input) => setRolePermissions(db, ctx, input.role, input.permissions),
});

export const revokeSessionDef = defineAction({
  name: "users.revoke_session",
  permission: "users.manage",
  schema: SessionIdSchema,
  handler: (db, ctx, input) => revokeSession(db, ctx, input.sessionId),
});

export const changePasswordDef = defineAction({
  name: "auth.change_password",
  permission: "authenticated",
  allowWhenPasswordChangeRequired: true,
  schema: ChangePasswordSchema,
  handler: (db, ctx, input) => changeOwnPassword(db, ctx, input),
});
