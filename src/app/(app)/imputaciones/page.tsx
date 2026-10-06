import { AllocationsPanelPage } from "../_operations/allocations-panel";

export default async function Page({ searchParams }: PageProps<"/imputaciones">) {
  return <AllocationsPanelPage searchParams={await searchParams} />;
}
