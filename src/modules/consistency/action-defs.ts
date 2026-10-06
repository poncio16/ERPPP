import { z } from "zod";
import { defineAction } from "@/server/action";
import { runConsistencyCheck } from "./service";

export const runConsistencyDef = defineAction({
  name: "consistency.run",
  permission: "consistency.run",
  schema: z.object({}),
  handler: (db, ctx) => runConsistencyCheck(db, ctx),
});
