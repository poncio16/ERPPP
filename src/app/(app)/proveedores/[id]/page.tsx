import { PartyDetailPage } from "../../_parties/pages";

export default async function Page({ params, searchParams }: PageProps<"/proveedores/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <PartyDetailPage kind="supplier" id={id} saved={sp.guardado === "1"} />;
}
