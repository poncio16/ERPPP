import { OperationListPage } from "../_operations/pages";

export default async function Page({ searchParams }: PageProps<"/cobranzas">) {
  return <OperationListPage kind="COLLECTION" searchParams={await searchParams} />;
}
