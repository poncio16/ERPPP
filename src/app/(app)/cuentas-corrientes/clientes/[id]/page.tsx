import { AccountDetailPage } from "../../../_accounts/pages";

export default async function Page({ params, searchParams }: PageProps<"/cuentas-corrientes/clientes/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <AccountDetailPage direction="ISSUED" id={id} searchParams={sp} />;
}
