import { NewOperationPage } from "../../_operations/pages";

export default async function Page({ searchParams }: PageProps<"/pagos/nuevo">) {
  return <NewOperationPage kind="PAYMENT" searchParams={await searchParams} />;
}
