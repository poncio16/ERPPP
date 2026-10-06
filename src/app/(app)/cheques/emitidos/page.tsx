import { ChecksListPage } from "../../_checks/pages";

export default async function Page({ searchParams }: PageProps<"/cheques/emitidos">) {
  return <ChecksListPage kind="ISSUED" searchParams={await searchParams} />;
}
