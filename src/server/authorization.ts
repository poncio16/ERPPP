import type { Permission } from "@/modules/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import type { ServiceContext } from "./context";

/**
 * Verificación de permiso en la capa de servicios. Las acciones ya lo verifican antes de
 * llamar al servicio; esta segunda verificación protege a los servicios si se los invoca
 * desde otro punto de entrada (defensa en profundidad).
 */
export function assertPermission(ctx: Pick<ServiceContext, "permissions">, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError(permission);
}
