import { PartyDetailPage } from "../../_parties/pages";

export default async function Page({ params, searchParams }: PageProps<"/clientes/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <PartyDetailPage kind="client" id={id} saved={sp.guardado === "1"} />;
}
