import { NewDocumentPage } from "../../_documents/pages";

export default async function Page({ searchParams }: PageProps<"/comprobantes-recibidos/nuevo">) {
  return <NewDocumentPage direction="RECEIVED" searchParams={await searchParams} />;
}
