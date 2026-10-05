import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { DomainError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { getUser } from "@/modules/users/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { isTemporarilyLocked, UserStatusBadge } from "../status-badge";
import { EditUserForm } from "../user-form";
import { ResetPasswordForm, UnlockUserForm } from "./security-forms";

export default async function UserDetailPage({ params }: PageProps<"/admin/usuarios/[id]">) {
  const { ctx } = await requirePagePermission("users.manage");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const user = await getUser(db, ctx, id).catch((e: unknown) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <>
      <PageHeader title={user.username} description={user.fullName} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-6">
          <EditUserForm user={user} />
        </Card>
        <div className="space-y-6">
          <Card className="space-y-2 p-5 text-sm">
            <UserStatusBadge user={user} />
            <p className="text-slate-600">
              Último ingreso: {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "nunca"}
            </p>
            {user.lockedUntil && isTemporarilyLocked(user, new Date()) && (
              <p className="text-slate-600">Bloqueado hasta {formatDateTime(user.lockedUntil)}</p>
            )}
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="font-medium text-slate-900">Seguridad</h2>
            {isTemporarilyLocked(user, new Date()) && <UnlockUserForm userId={user.id} />}
            <ResetPasswordForm userId={user.id} username={user.username} />
          </Card>
        </div>
      </div>
    </>
  );
}
