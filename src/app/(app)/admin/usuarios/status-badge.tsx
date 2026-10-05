import { Badge } from "@/components/ui";
import type { UserRow } from "@/modules/users/service";

export const USER_STATUS_LABELS = { ACTIVE: "Activo", BLOCKED: "Bloqueado", INACTIVE: "Inactivo" } as const;

export function isTemporarilyLocked(user: Pick<UserRow, "lockedUntil">, now: Date) {
  return user.lockedUntil !== null && user.lockedUntil > now;
}

export function UserStatusBadge({ user }: { user: UserRow }) {
  const locked = isTemporarilyLocked(user, new Date());
  return (
    <span className="space-x-1">
      {user.status === "ACTIVE" ? (
        <Badge tone="green">Activo</Badge>
      ) : (
        <Badge tone="red">{USER_STATUS_LABELS[user.status as keyof typeof USER_STATUS_LABELS] ?? user.status}</Badge>
      )}
      {locked && <Badge tone="amber">Bloqueo temporal</Badge>}
      {user.mustChangePassword && <Badge tone="slate">Debe cambiar contraseña</Badge>}
    </span>
  );
}
