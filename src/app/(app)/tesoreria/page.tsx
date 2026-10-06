import { ConsolidatedTreasuryPage } from "../_treasury/consolidated-page";

export default async function Page({ searchParams }: PageProps<"/tesoreria">) {
  return <ConsolidatedTreasuryPage searchParams={await searchParams} />;
}
