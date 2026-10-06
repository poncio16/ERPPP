import { OperationListPage } from "../_operations/pages";

export default async function Page({ searchParams }: PageProps<"/pagos">) {
  return <OperationListPage kind="PAYMENT" searchParams={await searchParams} />;
}
