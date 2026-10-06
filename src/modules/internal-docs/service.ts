import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/drizzle";
import { company, provinces, vatConditions } from "@/server/db/schema";

/** Encabezado de los documentos internos con los datos de la empresa (configuración). */
export async function companyHeader(db: DbOrTx) {
  const [row] = await db
    .select({
      legalName: company.legalName,
      tradeName: company.tradeName,
      taxId: company.taxId,
      vatCondition: vatConditions.name,
      address: company.address,
      city: company.city,
      province: provinces.name,
      postalCode: company.postalCode,
      grossIncomeNumber: company.grossIncomeNumber,
      phone: company.phone,
      email: company.email,
    })
    .from(company)
    .innerJoin(vatConditions, eq(vatConditions.id, company.vatConditionId))
    .leftJoin(provinces, eq(provinces.id, company.provinceId))
    .where(eq(company.id, 1));
  return row ?? null;
}
export type CompanyHeader = NonNullable<Awaited<ReturnType<typeof companyHeader>>>;
