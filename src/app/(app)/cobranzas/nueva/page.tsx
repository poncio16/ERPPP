import { NewOperationPage } from "../../_operations/pages";

export default async function Page({ searchParams }: PageProps<"/cobranzas/nueva">) {
  return <NewOperationPage kind="COLLECTION" searchParams={await searchParams} />;
}
