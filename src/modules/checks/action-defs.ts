import { defineAction } from "@/server/action";
import { CashCheckSchema, CreditCheckSchema, DepositCheckSchema, IssuedCheckStepSchema, RejectCheckSchema } from "./schemas";
import {
  cashReceivedCheck,
  creditReceivedCheck,
  debitIssuedCheck,
  depositReceivedCheck,
  presentIssuedCheck,
  rejectIssuedCheck,
  rejectReceivedCheck,
} from "./service";

export const depositCheckDef = defineAction({
  name: "checks.deposit",
  permission: "checks.operate",
  schema: DepositCheckSchema,
  handler: (db, ctx, input) => depositReceivedCheck(db, ctx, input),
});

export const creditCheckDef = defineAction({
  name: "checks.credit",
  permission: "checks.operate",
  schema: CreditCheckSchema,
  handler: (db, ctx, input) => creditReceivedCheck(db, ctx, input),
});

export const cashCheckDef = defineAction({
  name: "checks.cash",
  permission: "checks.operate",
  schema: CashCheckSchema,
  handler: (db, ctx, input) => cashReceivedCheck(db, ctx, input),
});

export const rejectReceivedCheckDef = defineAction({
  name: "checks.reject_received",
  permission: "checks.operate",
  schema: RejectCheckSchema,
  handler: (db, ctx, input) => rejectReceivedCheck(db, ctx, input),
});

export const presentIssuedCheckDef = defineAction({
  name: "checks.present_issued",
  permission: "checks.operate",
  schema: IssuedCheckStepSchema,
  handler: (db, ctx, input) => presentIssuedCheck(db, ctx, input),
});

export const debitIssuedCheckDef = defineAction({
  name: "checks.debit_issued",
  permission: "checks.operate",
  schema: IssuedCheckStepSchema,
  handler: (db, ctx, input) => debitIssuedCheck(db, ctx, input),
});

export const rejectIssuedCheckDef = defineAction({
  name: "checks.reject_issued",
  permission: "checks.operate",
  schema: RejectCheckSchema,
  handler: (db, ctx, input) => rejectIssuedCheck(db, ctx, input),
});
