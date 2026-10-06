"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import { annulCollectionDef, registerCollectionDef } from "./action-defs";

type State = ActionResult<unknown> | undefined;

/** Una cobranza cambia comprobantes, cuenta corriente, caja, bancos y cheques: se revalida todo el área. */
export async function registerCollectionAction(_prev: State, fd: FormData) {
  const r = await runAction(registerCollectionDef, fd);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function annulCollectionAction(_prev: State, fd: FormData) {
  const r = await runAction(annulCollectionDef, fd);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
