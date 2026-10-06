import { ReceivedCheckPage } from "../../../_checks/pages";

export default async function Page({ params }: PageProps<"/cheques/recibidos/[id]">) {
  const { id } = await params;
  return <ReceivedCheckPage id={id} />;
}
