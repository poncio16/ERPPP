import { InternalDocumentPage } from "../../../_operations/pages";

export default async function Page({ params }: PageProps<"/cobranzas/[id]/recibo">) {
  const { id } = await params;
  return <InternalDocumentPage kind="COLLECTION" id={id} />;
}
