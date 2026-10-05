import { EditPartyPage } from "../../../_parties/pages";

export default async function Page({ params }: PageProps<"/proveedores/[id]/editar">) {
  return <EditPartyPage kind="supplier" id={(await params).id} />;
}
