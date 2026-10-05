import { AccountListPage } from "../../_accounts/pages";

export default async function Page({ searchParams }: PageProps<"/cuentas-corrientes/clientes">) {
  return <AccountListPage direction="ISSUED" searchParams={await searchParams} />;
}
