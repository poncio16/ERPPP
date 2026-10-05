import { DocumentListPage } from "../_documents/pages";

export default async function Page({ searchParams }: PageProps<"/comprobantes-recibidos">) {
  return <DocumentListPage direction="RECEIVED" searchParams={await searchParams} />;
}
