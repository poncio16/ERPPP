import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { ConsistencyRunner } from "./consistency-runner";

export default async function ConsistencyPage() {
  await requirePagePermission("consistency.run");
  return (
    <>
      <PageHeader
        title="Verificación de consistencia"
        description="Recalcula los invariantes financieros desde los registros de origen: cuentas corrientes, saldos de comprobantes, cobranzas y pagos, movimientos de tesorería, cheques, cierres de caja y la cadena de auditoría. Cada uno debe dar diferencia $ 0,00. La ejecución queda auditada."
      />
      <ConsistencyRunner />
    </>
  );
}
