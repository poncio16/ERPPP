import { AccountListPage } from "../../_accounts/pages";

export default async function Page({ searchParams }: PageProps<"/cuentas-corrientes/proveedores">) {
  return <AccountListPage direction="RECEIVED" searchParams={await searchParams} />;
}
