import { defineAction } from "@/server/action";
import {
  AnnulTransferSchema,
  BankAccountSchema,
  CashBoxSchema,
  CashClosureSchema,
  ManualMovementSchema,
  OpeningSchema,
  ReverseMovementSchema,
  TransferSchema,
  UpdateBankAccountSchema,
  UpdateCashBoxSchema,
} from "./schemas";
import {
  annulTransfer,
  closeCashBox,
  createBankAccount,
  createCashBox,
  registerManualMovement,
  registerOpening,
  registerTransfer,
  reverseManualMovement,
  updateBankAccount,
  updateCashBox,
} from "./service";

export const createCashBoxDef = defineAction({
  name: "treasury.create_cash_box",
  permission: "config.manage",
  schema: CashBoxSchema,
  handler: (db, ctx, input) => createCashBox(db, ctx, input),
});

export const updateCashBoxDef = defineAction({
  name: "treasury.update_cash_box",
  permission: "config.manage",
  schema: UpdateCashBoxSchema,
  handler: (db, ctx, input) => updateCashBox(db, ctx, input),
});

export const createBankAccountDef = defineAction({
  name: "treasury.create_bank_account",
  permission: "config.manage",
  schema: BankAccountSchema,
  handler: (db, ctx, input) => createBankAccount(db, ctx, input),
});

export const updateBankAccountDef = defineAction({
  name: "treasury.update_bank_account",
  permission: "config.manage",
  schema: UpdateBankAccountSchema,
  handler: (db, ctx, input) => updateBankAccount(db, ctx, input),
});

export const registerOpeningDef = defineAction({
  name: "treasury.opening",
  permission: "treasury.opening",
  schema: OpeningSchema,
  handler: (db, ctx, input) => registerOpening(db, ctx, input),
});

export const cashMovementDef = defineAction({
  name: "treasury.cash_movement",
  permission: "cash.manual_movement",
  schema: ManualMovementSchema,
  handler: (db, ctx, input) => registerManualMovement(db, ctx, "CASH", input),
});

export const bankMovementDef = defineAction({
  name: "treasury.bank_movement",
  permission: "banks.manual_movement",
  schema: ManualMovementSchema,
  handler: (db, ctx, input) => registerManualMovement(db, ctx, "BANK", input),
});

export const reverseCashMovementDef = defineAction({
  name: "treasury.reverse_cash_movement",
  permission: "cash.manual_movement",
  schema: ReverseMovementSchema,
  handler: (db, ctx, input) => reverseManualMovement(db, ctx, "CASH", input),
});

export const reverseBankMovementDef = defineAction({
  name: "treasury.reverse_bank_movement",
  permission: "banks.manual_movement",
  schema: ReverseMovementSchema,
  handler: (db, ctx, input) => reverseManualMovement(db, ctx, "BANK", input),
});

export const transferDef = defineAction({
  name: "treasury.transfer",
  permission: "banks.transfer",
  schema: TransferSchema,
  handler: (db, ctx, input) => registerTransfer(db, ctx, input),
});

export const annulTransferDef = defineAction({
  name: "treasury.annul_transfer",
  permission: "banks.transfer",
  schema: AnnulTransferSchema,
  handler: (db, ctx, input) => annulTransfer(db, ctx, input),
});

export const closeCashBoxDef = defineAction({
  name: "treasury.cash_close",
  permission: "cash.close",
  schema: CashClosureSchema,
  handler: (db, ctx, input) => closeCashBox(db, ctx, input),
});
