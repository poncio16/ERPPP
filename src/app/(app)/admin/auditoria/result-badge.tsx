import { Badge } from "@/components/ui";
import { RESULT_LABELS } from "@/modules/audit/labels";

export function ResultBadge({ result }: { result: string }) {
  const tone = result === "SUCCESS" ? "green" : result === "DENIED" ? "amber" : "red";
  return <Badge tone={tone}>{RESULT_LABELS[result as keyof typeof RESULT_LABELS] ?? result}</Badge>;
}
