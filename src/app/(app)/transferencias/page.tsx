import { TransfersPage } from "../_treasury/pages";

export default async function Page({ searchParams }: PageProps<"/transferencias">) {
  return <TransfersPage searchParams={await searchParams} />;
}
