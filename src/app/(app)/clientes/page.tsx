import { PartyListPage } from "../_parties/party-list";

export default async function Page({ searchParams }: PageProps<"/clientes">) {
  return <PartyListPage kind="client" searchParams={await searchParams} />;
}
