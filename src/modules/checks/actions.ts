"use server";

import { revalidatePath } from "next/cache";
import type { ActionDef, ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import {
  cashCheckDef,
  creditCheckDef,
  debitIssuedCheckDef,
  depositCheckDef,
  presentIssuedCheckDef,
  rejectIssuedCheckDef,
  rejectReceivedCheckDef,
} from "./action-defs";

type State = ActionResult<unknown> | undefined;

/** Un cambio de estado de un cheque puede mover bancos, caja y cuentas corrientes. */
async function run(def: ActionDef, fd: FormData) {
  const r = await runAction(def, fd);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function depositCheckAction(_prev: State, fd: FormData) {
  return run(depositCheckDef as ActionDef, fd);
}
export async function creditCheckAction(_prev: State, fd: FormData) {
  return run(creditCheckDef as ActionDef, fd);
}
export async function cashCheckAction(_prev: State, fd: FormData) {
  return run(cashCheckDef as ActionDef, fd);
}
export async function rejectReceivedCheckAction(_prev: State, fd: FormData) {
  return run(rejectReceivedCheckDef as ActionDef, fd);
}
export async function presentIssuedCheckAction(_prev: State, fd: FormData) {
  return run(presentIssuedCheckDef as ActionDef, fd);
}
export async function debitIssuedCheckAction(_prev: State, fd: FormData) {
  return run(debitIssuedCheckDef as ActionDef, fd);
}
export async function rejectIssuedCheckAction(_prev: State, fd: FormData) {
  return run(rejectIssuedCheckDef as ActionDef, fd);
}
