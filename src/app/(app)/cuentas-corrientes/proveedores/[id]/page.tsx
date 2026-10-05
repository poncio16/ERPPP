import { AccountDetailPage } from "../../../_accounts/pages";

export default async function Page({ params, searchParams }: PageProps<"/cuentas-corrientes/proveedores/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <AccountDetailPage direction="RECEIVED" id={id} searchParams={sp} />;
}
