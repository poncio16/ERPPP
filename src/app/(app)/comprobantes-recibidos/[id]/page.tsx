import { DocumentDetailPage } from "../../_documents/pages";

export default async function Page({ params, searchParams }: PageProps<"/comprobantes-recibidos/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <DocumentDetailPage direction="RECEIVED" id={id} searchParams={sp} />;
}
