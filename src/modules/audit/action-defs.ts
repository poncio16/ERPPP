import { z } from "zod";
import { defineAction } from "@/server/action";
import { verifyAuditChain } from "./query";

export const verifyAuditChainDef = defineAction({
  name: "audit.verify_chain",
  permission: "audit.read",
  schema: z.object({}),
  handler: (db, ctx) => verifyAuditChain(db, ctx),
});
