import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/drizzle";
import * as s from "@/server/db/schema";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type RoleCode } from "@/modules/auth/permissions";
import {
  BANKS,
  CONFIGURATION,
  DOCUMENT_TYPES,
  ID_TYPES,
  NUMBERING_SEQUENCES,
  PAYMENT_TERMS,
  PROVINCES,
  TAXES,
  TREASURY_CONCEPTS,
  VAT_CONDITIONS,
} from "./base-data";

/**
 * Carga idempotente de catálogos base. Inserta lo que falta y no pisa lo que el
 * administrador ya modificó (ON CONFLICT DO NOTHING), salvo permisos de roles de sistema.
 */
export async function seedBase(db: Db) {
  await db.transaction(async (tx) => {
    const ins = <T extends Parameters<typeof tx.insert>[0]>(table: T, rows: object[]) =>
      rows.length ? tx.insert(table).values(rows as never).onConflictDoNothing() : Promise.resolve();

    await ins(
      s.vatConditions,
      VAT_CONDITIONS.map((v, i) => ({ ...v, sortOrder: i })),
    );
    await ins(
      s.idTypes,
      ID_TYPES.map((v, i) => ({ ...v, sortOrder: i })),
    );
    await ins(
      s.provinces,
      PROVINCES.map((p, i) => ({
        code: p.code,
        name: p.name,
        arcaCode: p.arcaCode,
        grossIncomeJurisdiction: p.jurisdiction,
        sortOrder: i,
      })),
    );
    await ins(
      s.paymentTerms,
      PAYMENT_TERMS.map((v, i) => ({ ...v, sortOrder: i })),
    );
    await ins(
      s.documentTypes,
      DOCUMENT_TYPES.map((d, i) => ({
        code: d.code,
        name: d.name,
        arcaCode: d.arcaCode,
        letter: d.letter,
        class: d.class,
        isFce: d.isFce ?? false,
        isFiscal: d.isFiscal ?? true,
        allowedIssued: d.allowedIssued,
        allowedReceived: d.allowedReceived,
        vatCreditable: d.vatCreditable,
        sortOrder: i,
      })),
    );
    await ins(
      s.taxCatalog,
      TAXES.map((t, i) => ({ ...t, sortOrder: i })),
    );
    await ins(
      s.treasuryConcepts,
      TREASURY_CONCEPTS.map((c, i) => ({ ...c, sortOrder: i })),
    );
    await ins(
      s.banks,
      BANKS.map((b, i) => ({ ...b, sortOrder: i })),
    );
    await ins(s.numberingSequences, NUMBERING_SEQUENCES);
    await ins(s.configuration, CONFIGURATION);

    await ins(
      s.permissions,
      Object.entries(PERMISSIONS).map(([code, description]) => ({
        code,
        module: code.split(".")[0],
        description,
      })),
    );
    await ins(
      s.roles,
      Object.entries(ROLES).map(([code, name]) => ({ code, name, isSystem: true })),
    );
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS) as [RoleCode, string[]][]) {
      await tx.execute(sql`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (SELECT jsonb_array_elements_text(${JSON.stringify(perms)}::jsonb))
         WHERE r.code = ${role}
        ON CONFLICT DO NOTHING`);
    }
  });
}
