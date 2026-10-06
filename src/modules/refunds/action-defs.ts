import { defineAction } from "@/server/action";
import { AnnulRefundSchema, RegisterRefundSchema } from "./schemas";
import { annulRefund, registerRefund } from "./service";

export const registerRefundDef = defineAction({
  name: "refunds.create",
  permission: "refunds.create",
  schema: RegisterRefundSchema,
  handler: (db, ctx, input) => registerRefund(db, ctx, input),
});

export const annulRefundDef = defineAction({
  name: "refunds.annul",
  permission: "refunds.annul",
  schema: AnnulRefundSchema,
  handler: (db, ctx, input) => annulRefund(db, ctx, input),
});
