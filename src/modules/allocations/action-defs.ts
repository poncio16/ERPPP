import { defineAction } from "@/server/action";
import { AllocateSchema, ReverseAllocationSchema } from "./schemas";
import { allocateCredit, reverseAllocation } from "./service";

export const allocateDef = defineAction({
  name: "allocations.create",
  permission: "allocations.create",
  schema: AllocateSchema,
  handler: (db, ctx, input) => allocateCredit(db, ctx, { source: { kind: input.sourceKind, id: input.sourceId }, items: input.allocations }),
});

export const reverseAllocationDef = defineAction({
  name: "allocations.reverse",
  permission: "allocations.reverse",
  schema: ReverseAllocationSchema,
  handler: (db, ctx, input) => reverseAllocation(db, ctx, input),
});
