import Link from "next/link";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { ROLES } from "@/modules/auth/permissions";
import { listUsers } from "@/modules/users/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { UserStatusBadge } from "./status-badge";

export default async function UsersPage() {
  const { ctx } = await requirePagePermission("users.manage");
  const users = await listUsers(db, ctx);
  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Alta, roles, bloqueo y blanqueo de contraseña. Los usuarios no se borran: se desactivan."
        actions={<LinkButton href="/admin/usuarios/nuevo">Nuevo usuario</LinkButton>}
      />
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Usuario</Th>
              <Th>Nombre</Th>
              <Th>Roles</Th>
              <Th>Estado</Th>
              <Th>Último ingreso</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/admin/usuarios/${u.id}`} className="font-medium text-brand-700 hover:underline">
                    {u.username}
                  </Link>
                </Td>
                <Td>{u.fullName}</Td>
                <Td className="space-x-1">
                  {u.roles.map((r) => (
                    <Badge key={r} tone="blue">
                      {ROLES[r]}
                    </Badge>
                  ))}
                </Td>
                <Td>
                  <UserStatusBadge user={u} />
                </Td>
                <Td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Nunca"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
