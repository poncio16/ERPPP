/**
 * Backup y restauración (sección J y criterios BKP-xx): backup con identificación y totales de control,
 * copia externa cifrada, verificación, restauración con comprobación de que los datos coinciden con el
 * estado anterior, fallos, permisos y retención. Usa pg_dump/pg_restore/age reales.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { verifyAuditChain } from "@/modules/audit/query";
import { createBackupDef } from "@/modules/backup/action-defs";
import { backupConfig, type BackupConfig } from "@/modules/backup/config";
import { computeControlTotals } from "@/modules/backup/control-totals";
import { readManifest, sha256File } from "@/modules/backup/files";
import { withDatabase } from "@/modules/backup/pg-tools";
import { restoreBackup, verifyBackup } from "@/modules/backup/restore";
import { backupAlerts, createBackup, listBackups, pruneBackups, type BackupResult } from "@/modules/backup/service";
import type { ServiceContext } from "@/server/context";
import { createDb } from "@/server/db/drizzle";
import { TEST_DB, testUrls } from "../setup/test-env";
import { run } from "./operations-fixtures";
import { ctxWithRoles, db, lastAudit, ownerPool, pool } from "./helpers";

const urls = testUrls();
const RESTORE_DB = `${TEST_DB}_bkp`;
let tmp: string;
let cfg: BackupConfig;
let admin: ServiceContext;
let identity: string;
let first: BackupResult;

async function adminQuery(sqlText: string, params: unknown[] = [], dbName = "postgres") {
  const c = new Client({ connectionString: withDatabase(urls.admin, dbName) });
  await c.connect();
  try {
    return await c.query(sqlText, params);
  } finally {
    await c.end();
  }
}

async function totalsOf(dbName: string) {
  const c = new Client({ connectionString: withDatabase(urls.admin, dbName) });
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return await computeControlTotals(c);
  } finally {
    await c.query("COMMIT");
    await c.end();
  }
}

async function dropRestoreDbs() {
  const { rows } = await adminQuery("SELECT datname FROM pg_database WHERE datname LIKE $1", [`${RESTORE_DB}%`]);
  for (const r of rows) await adminQuery(`DROP DATABASE IF EXISTS ${r.datname} WITH (FORCE)`);
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "erp-bkp-"));
  identity = path.join(tmp, "clave-privada.txt");
  execFileSync("age-keygen", ["-o", identity], { stdio: "ignore" });
  const recipient = execFileSync("age-keygen", ["-y", identity]).toString().trim();
  cfg = { ...backupConfig({}), dir: path.join(tmp, "local"), offsiteDir: path.join(tmp, "nas"), ageRecipient: recipient, backupUrl: urls.backup, maintenanceFile: path.join(tmp, ".maintenance") };
  admin = (await ctxWithRoles(["ADMIN"])).ctx;
  await dropRestoreDbs();
});

afterAll(async () => {
  await dropRestoreDbs();
  await adminQuery("DROP DATABASE IF EXISTS erp_test_verify WITH (FORCE)");
  await rm(tmp, { recursive: true, force: true });
  await pool.end();
  await ownerPool.end();
});

describe("Backup", () => {
  it("BKP-01 backup manual: archivo con fecha, tamaño, SHA-256, versiones, totales de control y auditoría", async () => {
    first = await createBackup(db, admin, { kind: "MANUAL", config: cfg });
    expect(first.fileName).toMatch(/^erp_\d{8}_\d{6}_MANUAL_v0\.1\.0_s0004\.dump$/);
    expect(existsSync(first.filePath)).toBe(true);
    expect(await sha256File(first.filePath)).toBe(first.sha256);
    const { rows } = await pool.query("SELECT * FROM backup_runs WHERE id = $1", [first.id]);
    expect(rows[0]).toMatchObject({ kind: "MANUAL", status: "OK", file_name: first.fileName, sha256: first.sha256, size_bytes: String(first.sizeBytes), app_version: "0.1.0", schema_version: "0004_backup_offsite" });
    expect(rows[0].pg_version).toMatch(/^16\./);
    expect(rows[0].finished_at).not.toBeNull();

    // Totales de control: filas por tabla, sumas, auditoría e invariantes, también en el .json.
    const t = first.controlTotals;
    const { rows: clients } = await pool.query("SELECT count(*)::int AS n FROM clients");
    expect(t.tables["public.clients"]).toBe(clients[0].n);
    expect(t.tables["drizzle.__drizzle_migrations"]).toBe(5);
    expect(Object.keys(t.sums)).toEqual(expect.arrayContaining(["documents_issued", "customer_accounts", "treasury_liquid", "collections", "payments"]));
    expect(t.audit.chainBrokenAt).toBeNull();
    expect(t.invariants["G14-9"]).toEqual({ ok: true, failures: 0, difference: null });
    const manifest = await readManifest(first.filePath);
    expect(manifest).toMatchObject({ runId: first.id, fileName: first.fileName, sha256: first.sha256, sizeBytes: first.sizeBytes, kind: "MANUAL", appVersion: "0.1.0" });
    expect(manifest!.controlTotals).toEqual(t);

    const audit = await lastAudit("module = 'backup' AND action = 'create'");
    expect(audit).toMatchObject({ result: "SUCCESS", entity_type: "backup_run", entity_id: String(first.id), user_id: String(admin.userId) });
    // No quedan archivos temporales.
    expect((await readdir(cfg.dir)).filter((f) => f.endsWith(".partial"))).toEqual([]);
  });

  it("BKP-02 copia fuera del servidor cifrada con age: solo se lee con la clave privada", async () => {
    expect(first.offsiteStatus).toBe("OK");
    const encrypted = path.join(cfg.offsiteDir!, `${first.fileName}.age`);
    expect((await readFile(encrypted)).subarray(0, 5).toString()).not.toBe("PGDMP");
    const plain = path.join(tmp, "descifrado.dump");
    execFileSync("age", ["--decrypt", "--identity", identity, "--output", plain, encrypted]);
    expect(await sha256File(plain)).toBe(first.sha256);
    expect(existsSync(`${encrypted}.json`)).toBe(true);

    // Sin clave pública no se copia sin cifrar.
    const r = await createBackup(db, admin, { kind: "MANUAL", config: { ...cfg, ageRecipient: null } });
    expect(r).toMatchObject({ offsiteStatus: "FAILED", offsiteError: expect.stringMatching(/BACKUP_AGE_RECIPIENT/) });
    expect(existsSync(path.join(cfg.offsiteDir!, `${r.fileName}.age`))).toBe(false);
  });

  it("BKP-03 verificación: SHA-256, índice, restauración en base temporal y totales e invariantes idénticos", async () => {
    const report = await verifyBackup({ file: first.filePath, adminUrl: urls.admin, appDb: db, actor: admin, config: cfg, verifyDb: "erp_test_verify" });
    expect(report.steps.map((s) => [s.name, s.ok])).toEqual([
      ["Archivo de control", true],
      ["SHA-256", true],
      ["pg_restore --list", true],
      ["Restauración en erp_test_verify", true],
      ["Totales de control e invariantes", true],
    ]);
    expect(report.ok).toBe(true);
    expect(report.differences).toEqual([]);
    const { rows } = await pool.query("SELECT verify_status, verified_at FROM backup_runs WHERE id = $1", [first.id]);
    expect(rows[0].verify_status).toBe("PASS");
    expect(await lastAudit("module = 'backup' AND action = 'verify'")).toMatchObject({ entity_id: String(first.id), message: expect.stringMatching(/PASS/) });
    // La base temporal se borra.
    expect((await adminQuery("SELECT 1 FROM pg_database WHERE datname = 'erp_test_verify'")).rowCount).toBe(0);
  });

  it("BKP-04 la verificación detecta un archivo alterado y totales que no coinciden", async () => {
    const corrupt = path.join(tmp, "alterado.dump");
    await copyFile(first.filePath, corrupt);
    await copyFile(`${first.filePath}.json`, `${corrupt}.json`);
    const bytes = await readFile(corrupt);
    const mid = Math.floor(bytes.length / 2);
    bytes.writeUInt8(bytes.readUInt8(mid) ^ 0xff, mid);
    await writeFile(corrupt, bytes);
    const r1 = await verifyBackup({ file: corrupt, adminUrl: urls.admin, actor: admin, config: cfg, verifyDb: "erp_test_verify" });
    expect(r1.ok).toBe(false);
    expect(r1.steps.find((s) => s.name === "SHA-256")?.ok).toBe(false);

    // Archivo íntegro pero con totales de control que no corresponden: la restauración no "coincide".
    const other = path.join(tmp, "otros-totales.dump");
    await copyFile(first.filePath, other);
    const manifest = JSON.parse(await readFile(`${first.filePath}.json`, "utf8"));
    manifest.controlTotals.sums.collections = "999999.99";
    manifest.controlTotals.tables["public.clients"] += 1;
    await writeFile(`${other}.json`, JSON.stringify(manifest));
    const r2 = await verifyBackup({ file: other, adminUrl: urls.admin, actor: admin, config: cfg, verifyDb: "erp_test_verify" });
    expect(r2.ok).toBe(false);
    expect(r2.differences).toEqual(expect.arrayContaining([expect.stringMatching(/^Filas de public\.clients/), expect.stringMatching(/^Suma collections: backup "999999\.99"/)]));
  });

  it("BKP-05 restauración: los datos restaurados coinciden con el estado anterior; antes se hace un backup PRE_RESTORE", async () => {
    const target = RESTORE_DB;
    const appUrl = withDatabase(urls.app, target);
    const backupUrl = withDatabase(urls.backup, target);
    // 1) Restauración en un servidor sin la base (recuperación ante desastre).
    const r1 = await restoreBackup({ file: first.filePath, adminUrl: urls.admin, targetDb: target, appUrl, backupUrl, actor: admin, config: cfg });
    expect(r1).toMatchObject({ targetDb: target, previousDb: null, preRestore: null });
    // Idéntica al backup, salvo el registro de auditoría de la propia restauración.
    const sameAsBackup = (t: Awaited<ReturnType<typeof totalsOf>>, extraRuns: number) => {
      expect(t.tables).toEqual({
        ...first.controlTotals.tables,
        "public.audit_log": first.controlTotals.tables["public.audit_log"]! + 1,
        "public.backup_runs": first.controlTotals.tables["public.backup_runs"]! + extraRuns,
      });
      expect(t.sums).toEqual(first.controlTotals.sums);
      expect(t.treasury).toEqual(first.controlTotals.treasury);
      expect(t.checks).toEqual(first.controlTotals.checks);
      expect(t.invariants).toEqual(first.controlTotals.invariants);
      expect(t.audit.count).toBe(first.controlTotals.audit.count + 1);
      expect(t.audit.chainBrokenAt).toBeNull();
    };
    sameAsBackup(await totalsOf(target), 0);

    // 2) Se modifican datos en la base restaurada…
    const appPool = new Pool({ connectionString: appUrl, max: 1 });
    try {
      await appPool.query("INSERT INTO banks (code, name) VALUES ('BKP05', 'Banco modificado después del backup')");
    } finally {
      await appPool.end();
    }
    expect((await totalsOf(target)).tables["public.banks"]).toBe(first.controlTotals.tables["public.banks"]! + 1);

    // 3) …y se vuelve a restaurar el backup: queda igual al estado del backup.
    const r2 = await restoreBackup({ file: first.filePath, adminUrl: urls.admin, targetDb: target, appUrl, backupUrl, actor: admin, config: cfg });
    expect(r2.report.ok).toBe(true);
    expect(r2.preRestore?.fileName).toMatch(/_PRE_RESTORE_/);
    expect(r2.previousDb).toMatch(new RegExp(`^${target}_prev_\\d{8}_\\d{6}$`));
    sameAsBackup(await totalsOf(target), 1);
    expect((await adminQuery("SELECT count(*)::int AS n FROM banks WHERE code = 'BKP05'", [], target)).rows[0].n).toBe(0);
    // La base anterior se conserva con la modificación; el backup previo la contiene.
    expect((await adminQuery("SELECT count(*)::int AS n FROM banks WHERE code = 'BKP05'", [], r2.previousDb!)).rows[0].n).toBe(1);
    expect(r2.preRestore!.controlTotals.tables["public.banks"]).toBe(first.controlTotals.tables["public.banks"]! + 1);

    // En la base restaurada: el registro del backup quedó completo, el PRE_RESTORE registrado y la restauración auditada.
    const runs = await adminQuery("SELECT id, kind, status, file_name FROM backup_runs ORDER BY id", [], target);
    expect(runs.rows.find((r) => Number(r.id) === first.id)).toMatchObject({ status: "OK", file_name: first.fileName });
    expect(runs.rows.filter((r) => r.status === "RUNNING")).toEqual([]);
    expect(runs.rows.find((r) => r.kind === "PRE_RESTORE")).toMatchObject({ status: "OK", file_name: r2.preRestore!.fileName });
    const audit = await adminQuery("SELECT * FROM audit_log WHERE module = 'backup' AND action = 'restore' ORDER BY id DESC LIMIT 1", [], target);
    expect(audit.rows[0]).toMatchObject({ result: "SUCCESS", message: expect.stringContaining(first.fileName) });
    expect((await adminQuery("SELECT erp_verify_audit_chain() AS broken", [], target)).rows[0].broken).toBeNull();
    // "Verificar integridad" en la base restaurada: el PRE_RESTORE viene de la base reemplazada y no se compara.
    const targetPool = new Pool({ connectionString: appUrl, max: 1 });
    try {
      expect(await verifyAuditChain(createDb(targetPool), admin)).toMatchObject({ ok: true, brokenAt: null, backupMismatches: [] });
    } finally {
      await targetPool.end();
    }
    // Se sale del modo mantenimiento.
    expect(existsSync(cfg.maintenanceFile)).toBe(false);
  });

  it("BKP-06 una restauración que no verifica no toca la base actual", async () => {
    const other = path.join(tmp, "no-coincide.dump");
    await copyFile(first.filePath, other);
    const manifest = JSON.parse(await readFile(`${first.filePath}.json`, "utf8"));
    manifest.controlTotals.sums.payments = "1.00";
    await writeFile(`${other}.json`, JSON.stringify(manifest));
    const before = await adminQuery("SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY 1", [`${RESTORE_DB}%`]);
    await expect(
      restoreBackup({ file: other, adminUrl: urls.admin, targetDb: RESTORE_DB, appUrl: withDatabase(urls.app, RESTORE_DB), backupUrl: withDatabase(urls.backup, RESTORE_DB), actor: admin, config: cfg }),
    ).rejects.toThrow(/no coincide con los totales de control/);
    const after = await adminQuery("SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY 1", [`${RESTORE_DB}%`]);
    expect(after.rows).toEqual(before.rows);
    expect(existsSync(cfg.maintenanceFile)).toBe(false);
  });

  it("BKP-07 modo mantenimiento: la aplicación responde 503 mientras se restaura", async () => {
    process.env.MAINTENANCE_FILE = cfg.maintenanceFile;
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    await writeFile(cfg.maintenanceFile, "{}");
    const res = proxy(new NextRequest("http://localhost/clientes"));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/mantenimiento/);
    await rm(cfg.maintenanceFile);
    expect(proxy(new NextRequest("http://localhost/clientes")).status).toBe(307);
  });

  it("BKP-08 un backup que falla queda registrado como fallido, auditado y sin archivos a medio escribir", async () => {
    const bad = new URL(urls.backup);
    bad.password = "clave-incorrecta";
    await expect(createBackup(db, admin, { kind: "MANUAL", config: { ...cfg, backupUrl: bad.toString() } })).rejects.toThrow(DomainError);
    const { rows } = await pool.query("SELECT status, error_message FROM backup_runs ORDER BY id DESC LIMIT 1");
    expect(rows[0]).toMatchObject({ status: "FAILED", error_message: expect.stringMatching(/password authentication failed/) });
    expect(await lastAudit("module = 'backup' AND action = 'create'")).toMatchObject({ result: "ERROR" });
    expect((await readdir(cfg.dir)).filter((f) => f.endsWith(".partial"))).toEqual([]);
    await expect(createBackup(db, admin, { kind: "MANUAL", config: { ...cfg, backupUrl: null } })).rejects.toThrow(/DATABASE_BACKUP_URL/);
  });

  it("BKP-11 un solo backup a la vez y los datos de un backup terminado no se modifican", async () => {
    const { rows } = await ownerPool.query("INSERT INTO backup_runs (kind, status) VALUES ('AUTO', 'RUNNING') RETURNING id");
    try {
      await expect(createBackup(db, admin, { kind: "MANUAL", config: cfg })).rejects.toThrow(/Ya hay un backup en curso/);
    } finally {
      await ownerPool.query("UPDATE backup_runs SET status = 'FAILED', finished_at = now(), error_message = 'prueba' WHERE id = $1", [rows[0].id]);
    }
    await expect(ownerPool.query("UPDATE backup_runs SET sha256 = 'x' WHERE id = $1", [first.id])).rejects.toThrow(/ya terminó/);
    await expect(ownerPool.query("UPDATE backup_runs SET control_totals = '{}' WHERE id = $1", [first.id])).rejects.toThrow(/ya terminó/);
    await expect(pool.query("DELETE FROM backup_runs WHERE id = $1", [first.id])).rejects.toThrow();
  });

  it("BKP-12 permisos: solo el administrador hace backups; la restauración no existe como acción web", async () => {
    for (const role of ["ADMINISTRACION", "TESORERIA", "CONSULTA"] as const) {
      const { ctx } = await ctxWithRoles([role]);
      await expect(listBackups(db, ctx, cfg)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(backupAlerts(db, ctx)).rejects.toBeInstanceOf(ForbiddenError);
      const r = await run(ctx, createBackupDef, { confirm: "yes" });
      expect(r).toEqual({ ok: false, error: "No tiene permiso para realizar esta operación." });
    }
    // Sin la confirmación del formulario no se dispara un backup.
    const count = async () => (await pool.query("SELECT count(*)::int AS n FROM backup_runs")).rows[0].n;
    const n = await count();
    expect((await run(admin, createBackupDef, {})).ok).toBe(false);
    expect(await count()).toBe(n);
    const { actionRegistry } = await import("@/server/action-registry");
    expect(actionRegistry().filter((d) => d.name.startsWith("backup.")).map((d) => d.name)).toEqual(["backup.create"]);
  });

  it("BKP-13 la pantalla lista los backups con sus copias y las alertas del dashboard", async () => {
    const list = await listBackups(db, admin, cfg);
    const row = list.runs.find((r) => r.id === first.id)!;
    expect(row).toMatchObject({ localExists: true, offsiteExists: true, verifyStatus: "PASS" });
    expect(list.config).toMatchObject({ dir: cfg.dir, offsiteDir: cfg.offsiteDir, encrypted: true, configured: true });
    // Archivos de las carpetas que no figuran en la base (los de las pruebas de alteración no están en estas carpetas).
    await copyFile(first.filePath, path.join(cfg.dir, "erp_20200101_000000_MANUAL_v0.0.1_s0001.dump"));
    // (También figura el PRE_RESTORE de BKP-05, que quedó registrado en la base restaurada y no en esta.)
    const unregistered = (await listBackups(db, admin, cfg)).unregistered.local;
    expect(unregistered).toContain("erp_20200101_000000_MANUAL_v0.0.1_s0001.dump");
    expect(unregistered.filter((f) => !f.includes("PRE_RESTORE"))).toHaveLength(1);

    // El último backup fue el fallido de BKP-08 → alerta; dentro de 10 días, además, sin backup ni verificación recientes.
    const now = await backupAlerts(db, admin);
    expect(now).toEqual(expect.arrayContaining([expect.stringMatching(/El último backup falló/)]));
    expect(now.join(" ")).not.toMatch(/verificación/);
    const later = await backupAlerts(db, admin, new Date(Date.now() + 10 * 86_400_000));
    expect(later).toEqual(expect.arrayContaining([expect.stringMatching(/hace 10 día/), expect.stringMatching(/No hay una verificación/)]));
  });

  it("AUD-07 una reescritura completa de la cadena de auditoría se detecta contra el hash guardado en el backup", async () => {
    const snapshot = await createBackup(db, admin, { kind: "MANUAL", config: { ...cfg, offsiteDir: null } });
    const lastId = snapshot.controlTotals.audit.lastId!;
    expect(lastId).toBeGreaterThan(0);
    const su = new Client({ connectionString: withDatabase(urls.admin, TEST_DB) });
    await su.connect();
    const { rows: original } = await su.query("SELECT id, message, prev_hash, hash FROM audit_log WHERE id >= $1 ORDER BY id", [lastId]);
    try {
      await su.query("SET session_replication_role = replica");
      // Se altera el registro y se recalculan todos los hashes siguientes: la cadena en sí vuelve a cerrar.
      await su.query(`
        DO $$ DECLARE r audit_log; prev text; BEGIN
          SELECT hash INTO prev FROM audit_log WHERE id < ${lastId} ORDER BY id DESC LIMIT 1;
          prev := coalesce(prev, 'GENESIS');
          FOR r IN SELECT * FROM audit_log WHERE id >= ${lastId} ORDER BY id LOOP
            IF r.id = ${lastId} THEN r.message := coalesce(r.message, '') || ' (reescrito)'; END IF;
            r.prev_hash := prev;
            r.hash := encode(sha256(convert_to(erp_audit_canonical(r), 'UTF8')), 'hex');
            UPDATE audit_log SET message = r.message, prev_hash = r.prev_hash, hash = r.hash WHERE id = r.id;
            prev := r.hash;
          END LOOP;
        END $$`);
      expect((await su.query("SELECT erp_verify_audit_chain() AS broken")).rows[0].broken).toBeNull();
      const v = await verifyAuditChain(db, admin);
      expect(v.ok).toBe(false);
      expect(v.brokenAt).toBeNull();
      expect(v.backupMismatches).toEqual(expect.arrayContaining([expect.objectContaining({ backupId: snapshot.id, auditId: lastId })]));
    } finally {
      await su.query("SET session_replication_role = replica");
      for (const r of original) await su.query("UPDATE audit_log SET message = $2, prev_hash = $3, hash = $4 WHERE id = $1", [r.id, r.message, r.prev_hash, r.hash]);
      // La verificación de arriba agregó un registro encadenado al hash reescrito: se vuelve a encadenar.
      const maxId = Number(original.at(-1).id);
      await su.query(`
        DO $$ DECLARE r audit_log; prev text; BEGIN
          SELECT hash INTO prev FROM audit_log WHERE id = ${maxId};
          FOR r IN SELECT * FROM audit_log WHERE id > ${maxId} ORDER BY id LOOP
            r.prev_hash := prev;
            r.hash := encode(sha256(convert_to(erp_audit_canonical(r), 'UTF8')), 'hex');
            UPDATE audit_log SET prev_hash = r.prev_hash, hash = r.hash WHERE id = r.id;
            prev := r.hash;
          END LOOP;
        END $$`);
      await su.end();
    }
    expect((await verifyAuditChain(db, admin)).ok).toBe(true);
  });

  it("BKP-09 la retención borra los archivos que no conserva y mantiene el registro", async () => {
    const before = await pool.query("SELECT id, file_name, kind FROM backup_runs WHERE status = 'OK' AND pruned_at IS NULL ORDER BY id");
    const pruned = await pruneBackups(db, admin, { ...cfg, retention: { daily: 1, weekly: 0, monthly: 0 } });
    // Se conserva el último del día; los anteriores de hoy se borran.
    const rotated = before.rows.filter((r) => r.kind === "MANUAL" || r.kind === "AUTO");
    expect(pruned).toEqual(rotated.slice(0, -1).map((r) => r.file_name));
    expect(pruned).toContain(first.fileName);
    expect(existsSync(first.filePath)).toBe(false);
    expect(existsSync(path.join(cfg.offsiteDir!, `${first.fileName}.age`))).toBe(false);
    expect(existsSync(path.join(cfg.dir, rotated.at(-1)!.file_name))).toBe(true);
    const { rows } = await pool.query("SELECT pruned_at, sha256 FROM backup_runs WHERE id = $1", [first.id]);
    expect(rows[0].pruned_at).not.toBeNull();
    expect(rows[0].sha256).toBe(first.sha256);
    expect(await lastAudit("module = 'backup' AND action = 'prune'")).toMatchObject({ result: "SUCCESS" });
  });
});
