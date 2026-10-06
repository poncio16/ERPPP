import { z } from "zod";

/** Filtros de la consulta de auditoría (query string); un valor inválido se ignora. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v));
const code = z.string().trim().regex(/^[a-z_.]{1,60}$/);

export const AUDIT_PAGE_SIZE = 50;

export const AuditQuerySchema = z
  .object({
    from: isoDate.optional().catch(undefined),
    to: isoDate.optional().catch(undefined),
    user: z.coerce.number().int().positive().max(2_147_483_647).optional().catch(undefined),
    module: code.optional().catch(undefined),
    action: code.optional().catch(undefined),
    result: z.enum(["SUCCESS", "DENIED", "ERROR"]).optional().catch(undefined),
    entityType: code.optional().catch(undefined),
    entityId: z.string().trim().min(1).max(60).optional().catch(undefined),
    q: z.string().trim().min(1).max(100).optional().catch(undefined),
    page: z.coerce.number().int().min(1).max(1_000_000).optional().default(1).catch(1),
  })
  .transform((v) => (v.from && v.to && v.from > v.to ? { ...v, from: v.to, to: v.from } : v));

export type AuditQuery = z.infer<typeof AuditQuerySchema>;
