import { AnnulOperationSchema } from "@/modules/collections/schemas";
import { defineAction } from "@/server/action";
import { RegisterPaymentSchema } from "./schemas";
import { annulPayment, registerPayment } from "./service";

export const registerPaymentDef = defineAction({
  name: "payments.create",
  permission: "payments.create",
  schema: RegisterPaymentSchema,
  handler: (db, ctx, input) => registerPayment(db, ctx, input),
});

export const annulPaymentDef = defineAction({
  name: "payments.annul",
  permission: "payments.annul",
  schema: AnnulOperationSchema,
  handler: (db, ctx, input) => annulPayment(db, ctx, input),
});
