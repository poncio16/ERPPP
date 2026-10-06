"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import { createBackupDef } from "./action-defs";

type State = ActionResult<{ id: number; fileName: string; sizeBytes: number; sha256: string; offsiteStatus: string; offsiteError: string | null }> | undefined;

export async function createBackupAction(_prev: State, fd: FormData) {
  const r = (await runAction(createBackupDef, fd)) as State;
  if (r?.ok) revalidatePath("/admin/backups");
  return r;
}
