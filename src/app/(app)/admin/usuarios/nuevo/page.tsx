import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { NewUserForm } from "../user-form";

export default async function NewUserPage() {
  await requirePagePermission("users.manage");
  return (
    <>
      <PageHeader
        title="Nuevo usuario"
        description="Se genera una contraseña temporal que el usuario debe cambiar en su primer ingreso."
      />
      <Card className="max-w-xl p-6">
        <NewUserForm />
      </Card>
    </>
  );
}
