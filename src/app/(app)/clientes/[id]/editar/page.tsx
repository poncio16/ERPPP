import { EditPartyPage } from "../../../_parties/pages";

export default async function Page({ params }: PageProps<"/clientes/[id]/editar">) {
  return <EditPartyPage kind="client" id={(await params).id} />;
}
