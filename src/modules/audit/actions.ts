"use server";

import type { ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import { verifyAuditChainDef } from "./action-defs";
import type { ChainVerification } from "./query";

type State = ActionResult<ChainVerification> | undefined;

export async function verifyAuditChainAction(_prev: State, fd: FormData) {
  return (await runAction(verifyAuditChainDef, fd)) as State;
}
