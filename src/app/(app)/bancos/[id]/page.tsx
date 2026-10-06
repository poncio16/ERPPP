import { TreasuryAccountPage } from "../../_treasury/pages";

export default async function Page({ params, searchParams }: PageProps<"/bancos/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <TreasuryAccountPage kind="BANK" id={id} searchParams={sp} />;
}
