import { IssuedCheckPage } from "../../../_checks/pages";

export default async function Page({ params }: PageProps<"/cheques/emitidos/[id]">) {
  const { id } = await params;
  return <IssuedCheckPage id={id} />;
}
