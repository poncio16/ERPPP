"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import { annulPaymentDef, registerPaymentDef } from "./action-defs";

type State = ActionResult<unknown> | undefined;

/** Un pago cambia comprobantes, cuenta corriente, caja, bancos y cheques: se revalida todo el área. */
export async function registerPaymentAction(_prev: State, fd: FormData) {
  const r = await runAction(registerPaymentDef, fd);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function annulPaymentAction(_prev: State, fd: FormData) {
  const r = await runAction(annulPaymentDef, fd);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
