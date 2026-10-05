import { NewDocumentPage } from "../../_documents/pages";

export default async function Page({ searchParams }: PageProps<"/comprobantes-emitidos/nuevo">) {
  return <NewDocumentPage direction="ISSUED" searchParams={await searchParams} />;
}
