import { z } from "zod";
import { ALL_PERMISSIONS, ROLES, type Permission, type RoleCode } from "@/modules/auth/permissions";

const roleCodes = Object.keys(ROLES) as [RoleCode, ...RoleCode[]];

/** Un grupo de casillas sin ninguna marcada no viaja en el formulario: se toma como lista vacía. */
const checkboxList = <T extends z.ZodType>(schema: T) => z.preprocess((v) => v ?? [], schema);

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .pipe(z.email({ error: "Correo electrónico inválido." }).nullable());

export const CreateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, { error: "Entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo." }),
  fullName: z.string().trim().min(3, { error: "Ingrese nombre y apellido." }).max(120),
  email: optionalEmail,
  roles: checkboxList(z.array(z.enum(roleCodes)).min(1, { error: "Asigne al menos un rol." })),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  userId: z.coerce.number().int().positive(),
  fullName: z.string().trim().min(3, { error: "Ingrese nombre y apellido." }).max(120),
  email: optionalEmail,
  roles: checkboxList(z.array(z.enum(roleCodes)).min(1, { error: "Asigne al menos un rol." })),
  status: z.enum(["ACTIVE", "BLOCKED", "INACTIVE"]),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const UserIdSchema = z.object({ userId: z.coerce.number().int().positive() });

export const SessionIdSchema = z.object({ sessionId: z.coerce.number().int().positive() });

export const SetRolePermissionsSchema = z.object({
  role: z.enum(roleCodes),
  permissions: checkboxList(z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]))),
});

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { error: "Ingrese la contraseña actual." }).max(200),
    newPassword: z.string().min(1, { error: "Ingrese la nueva contraseña." }).max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    error: "La confirmación no coincide.",
    path: ["confirmPassword"],
  });

export const LoginSchema = z.object({
  username: z.string().trim().min(1, { error: "Ingrese el usuario." }).max(100),
  password: z.string().min(1, { error: "Ingrese la contraseña." }).max(200),
});
