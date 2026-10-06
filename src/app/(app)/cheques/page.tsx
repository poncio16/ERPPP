import { ChecksListPage } from "../_checks/pages";

export default async function Page({ searchParams }: PageProps<"/cheques">) {
  return <ChecksListPage kind="RECEIVED" searchParams={await searchParams} />;
}
