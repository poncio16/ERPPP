"use server";

import { revalidatePath } from "next/cache";
import type { ActionDef, ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import {
  annulTransferDef,
  bankMovementDef,
  cashMovementDef,
  closeCashBoxDef,
  createBankAccountDef,
  createCashBoxDef,
  registerOpeningDef,
  reverseBankMovementDef,
  reverseCashMovementDef,
  transferDef,
  updateBankAccountDef,
  updateCashBoxDef,
  createPlannedItemDef,
  setPlannedItemStatusDef,
} from "./action-defs";

type State = ActionResult<unknown> | undefined;

/** Las pantallas de tesorería muestran saldos de varias cuentas: se revalidan juntas. */
async function run(def: ActionDef, fd: FormData): Promise<ActionResult<unknown>> {
  const r = await runAction(def, fd);
  if (r.ok) {
    revalidatePath("/caja", "layout");
    revalidatePath("/bancos", "layout");
    revalidatePath("/transferencias");
  }
  return r;
}

export async function createCashBoxAction(_prev: State, fd: FormData) {
  return run(createCashBoxDef as ActionDef, fd);
}
export async function updateCashBoxAction(_prev: State, fd: FormData) {
  return run(updateCashBoxDef as ActionDef, fd);
}
export async function createBankAccountAction(_prev: State, fd: FormData) {
  return run(createBankAccountDef as ActionDef, fd);
}
export async function updateBankAccountAction(_prev: State, fd: FormData) {
  return run(updateBankAccountDef as ActionDef, fd);
}
export async function registerOpeningAction(_prev: State, fd: FormData) {
  return run(registerOpeningDef as ActionDef, fd);
}
export async function cashMovementAction(_prev: State, fd: FormData) {
  return run(cashMovementDef as ActionDef, fd);
}
export async function bankMovementAction(_prev: State, fd: FormData) {
  return run(bankMovementDef as ActionDef, fd);
}
export async function reverseCashMovementAction(_prev: State, fd: FormData) {
  return run(reverseCashMovementDef as ActionDef, fd);
}
export async function reverseBankMovementAction(_prev: State, fd: FormData) {
  return run(reverseBankMovementDef as ActionDef, fd);
}
export async function transferAction(_prev: State, fd: FormData) {
  return run(transferDef as ActionDef, fd);
}
export async function annulTransferAction(_prev: State, fd: FormData) {
  return run(annulTransferDef as ActionDef, fd);
}
export async function closeCashBoxAction(_prev: State, fd: FormData) {
  return run(closeCashBoxDef as ActionDef, fd);
}
export async function createPlannedItemAction(_prev: State, fd: FormData) {
  return run(createPlannedItemDef as ActionDef, fd);
}
export async function setPlannedItemStatusAction(_prev: State, fd: FormData) {
  return run(setPlannedItemStatusDef as ActionDef, fd);
}
