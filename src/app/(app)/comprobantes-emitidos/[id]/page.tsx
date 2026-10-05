import { DocumentDetailPage } from "../../_documents/pages";

export default async function Page({ params, searchParams }: PageProps<"/comprobantes-emitidos/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <DocumentDetailPage direction="ISSUED" id={id} searchParams={sp} />;
}
