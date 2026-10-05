import { PartyListPage } from "../_parties/party-list";

export default async function Page({ searchParams }: PageProps<"/proveedores">) {
  return <PartyListPage kind="supplier" searchParams={await searchParams} />;
}
