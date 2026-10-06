"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import { allocateDef, reverseAllocationDef } from "./action-defs";

type State = ActionResult<unknown> | undefined;

export async function allocateAction(_prev: State, fd: FormData) {
  const r = await runAction(allocateDef, fd);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function reverseAllocationAction(_prev: State, fd: FormData) {
  const r = await runAction(reverseAllocationDef, fd);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
