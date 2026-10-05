import { DocumentListPage } from "../_documents/pages";

export default async function Page({ searchParams }: PageProps<"/comprobantes-emitidos">) {
  return <DocumentListPage direction="ISSUED" searchParams={await searchParams} />;
}
