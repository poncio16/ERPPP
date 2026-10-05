import { Card, PageHeader } from "@/components/ui";
import type { Permission, RoleCode } from "@/modules/auth/permissions";
import { listRolePermissions } from "@/modules/users/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { RolePermissionsForm } from "./role-permissions-form";

export default async function RolesPage() {
  const { ctx } = await requirePagePermission("users.manage");
  const { roles, catalog } = await listRolePermissions(db, ctx);
  const permissions = catalog.map((p) => ({ code: p.code as Permission, description: p.description, module: p.module }));
  return (
    <>
      <PageHeader
        title="Roles y permisos"
        description="Cada cambio cierra las sesiones de los usuarios del rol para que tome efecto al volver a ingresar. El rol Administrador tiene siempre todos los permisos."
      />
      <div className="space-y-6">
        {roles.map((r) => (
          <Card key={r.id} className="p-6">
            <RolePermissionsForm
              role={r.code as RoleCode}
              name={r.name}
              granted={[...r.permissions]}
              permissions={permissions}
              readOnly={r.code === "ADMIN"}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
