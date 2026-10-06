"use server";

import type { ActionDef, ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import { runConsistencyDef } from "./action-defs";
import type { InvariantResult } from "./service";

type State = ActionResult<{ results: InvariantResult[]; ranAt: Date; ok: boolean }> | undefined;

export async function runConsistencyAction(_prev: State, fd: FormData) {
  return (await runAction(runConsistencyDef as ActionDef, fd)) as State;
}
