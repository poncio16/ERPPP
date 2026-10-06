import { TreasuryAccountPage } from "../../_treasury/pages";

export default async function Page({ params, searchParams }: PageProps<"/caja/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <TreasuryAccountPage kind="CASH" id={id} searchParams={sp} />;
}
