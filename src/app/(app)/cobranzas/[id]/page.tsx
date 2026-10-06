import { OperationDetailPage } from "../../_operations/pages";

export default async function Page({ params, searchParams }: PageProps<"/cobranzas/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <OperationDetailPage kind="COLLECTION" id={id} searchParams={sp} />;
}
