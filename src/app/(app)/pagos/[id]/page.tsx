import { OperationDetailPage } from "../../_operations/pages";

export default async function Page({ params, searchParams }: PageProps<"/pagos/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <OperationDetailPage kind="PAYMENT" id={id} searchParams={sp} />;
}
