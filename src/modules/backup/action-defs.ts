import { z } from "zod";
import { assertPermission } from "@/server/authorization";
import { defineAction } from "@/server/action";
import { createBackup } from "./service";

/** Backup manual desde la pantalla. La restauración no tiene acción: se hace solo por consola (J.2). */
export const createBackupDef = defineAction({
  name: "backup.create",
  permission: "backup.run",
  // Confirmación explícita del formulario: una llamada sin ella no dispara un pg_dump.
  schema: z.object({ confirm: z.literal("yes", { error: "Confirme el backup." }) }),
  handler: async (db, ctx) => {
    assertPermission(ctx, "backup.run");
    const r = await createBackup(db, ctx, { kind: "MANUAL" });
    return { id: r.id, fileName: r.fileName, sizeBytes: r.sizeBytes, sha256: r.sha256, offsiteStatus: r.offsiteStatus, offsiteError: r.offsiteError };
  },
});
