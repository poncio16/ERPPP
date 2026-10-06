"use server";

import { revalidatePath } from "next/cache";
import type { ActionDef, ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import { annulRefundDef, registerRefundDef } from "./action-defs";

type State = ActionResult<unknown> | undefined;

/** Una devolución mueve caja o bancos, la cuenta corriente y las imputaciones. */
async function run(def: ActionDef, fd: FormData) {
  const r = await runAction(def, fd);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function registerRefundAction(_prev: State, fd: FormData) {
  return run(registerRefundDef as ActionDef, fd);
}
export async function annulRefundAction(_prev: State, fd: FormData) {
  return run(annulRefundDef as ActionDef, fd);
}
