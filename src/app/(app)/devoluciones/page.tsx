import { RefundsPage } from "../_operations/refunds-page";

export default async function Page({ searchParams }: PageProps<"/devoluciones">) {
  return <RefundsPage searchParams={await searchParams} />;
}
