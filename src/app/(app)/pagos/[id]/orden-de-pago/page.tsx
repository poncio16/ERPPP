import { InternalDocumentPage } from "../../../_operations/pages";

export default async function Page({ params }: PageProps<"/pagos/[id]/orden-de-pago">) {
  const { id } = await params;
  return <InternalDocumentPage kind="PAYMENT" id={id} />;
}
