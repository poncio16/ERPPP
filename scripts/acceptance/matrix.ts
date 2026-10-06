/**
 * Genera la matriz de aceptación (§48, K.3) a partir de una ejecución real de las pruebas:
 * corre Vitest (y Playwright, salvo --sin-navegador), lee sus reportes JSON y cruza cada
 * criterio de tests/acceptance/criterios.ts con las pruebas que lo verifican.
 * Nunca se completa a mano: un criterio figura en PASS solo si todas sus pruebas corrieron y pasaron.
 *
 * Uso: npm run build && npm run test:acceptance          (unitarias, integración y navegador)
 *      npm run test:acceptance -- --sin-navegador        (los criterios del navegador quedan BLOQUEADO)
 *      npm run test:acceptance -- --solo-reporte         (regenera desde los últimos reportes, sin correr pruebas)
 */
import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { ALL_TESTS, CRITERIA, type Criterion } from "../../tests/acceptance/criterios";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RESULTS = path.join(ROOT, "test-results");
const VITEST_JSON = path.join(RESULTS, "vitest.json");
const E2E_JSON = path.join(RESULTS, "e2e.json");
const OUTPUT = path.join(ROOT, "tests/acceptance/matriz.md");

export type Status = "passed" | "failed" | "skipped";
export interface TestRun {
  id: string | null;
  name: string;
  file: string;
  status: Status;
  message?: string;
  runner: "vitest" | "playwright";
}

/** ID al comienzo del nombre: CLI-01, CLI-01b, CMP-IVA-03, INT-CLI, INT-CLI-E2E… */
const ID_RE = /^((?:[A-Z]+-)+\d+[a-z]?|INT-[A-Z]+(?:-E2E)?)(?=\s|$)/;
export const testId = (titles: string[]) => {
  for (const t of [...titles].reverse()) {
    const m = ID_RE.exec(t.trim());
    if (m) return m[1]!;
  }
  return null;
};

interface VitestJson {
  testResults: { name: string; assertionResults: { ancestorTitles: string[]; title: string; status: string; failureMessages: string[] }[] }[];
}
export function parseVitest(json: VitestJson): TestRun[] {
  return json.testResults.flatMap((f) =>
    f.assertionResults.map((a) => ({
      id: testId([...a.ancestorTitles, a.title]),
      name: [...a.ancestorTitles, a.title].join(" › "),
      file: path.relative(ROOT, f.name),
      status: a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped",
      message: a.failureMessages[0],
      runner: "vitest" as const,
    })),
  );
}

interface PwSuite {
  title: string;
  file?: string;
  specs?: { title: string; ok: boolean; file: string; tests: { status: string; results: { status: string; error?: { message?: string } }[] }[] }[];
  suites?: PwSuite[];
}
export function parsePlaywright(json: { suites: PwSuite[] }): TestRun[] {
  const out: TestRun[] = [];
  const walk = (s: PwSuite, titles: string[]) => {
    for (const spec of s.specs ?? []) {
      const results = spec.tests.flatMap((t) => t.results);
      const skipped = spec.tests.every((t) => t.status === "skipped");
      out.push({
        id: testId([...titles, spec.title]),
        name: [...titles, spec.title].join(" › "),
        file: path.join("e2e", spec.file),
        status: skipped ? "skipped" : spec.ok ? "passed" : "failed",
        message: results.find((r) => r.error)?.error?.message,
        runner: "playwright",
      });
    }
    for (const child of s.suites ?? []) walk(child, [...titles, child.title]);
  };
  for (const s of json.suites) walk(s, []);
  return out;
}

export type Verdict = "PASS" | "FAIL" | "BLOQUEADO";
export interface Row {
  criterion: Criterion;
  verdict: Verdict;
  obtained: string;
  failures: TestRun[];
}

const firstLine = (s?: string) => (s ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim())?.trim().slice(0, 200) ?? "";

export function evaluate(criteria: Criterion[], runs: TestRun[], notRun: { runner: "playwright"; reason: string } | null): Row[] {
  const byId = new Map<string, TestRun[]>();
  for (const r of runs) if (r.id) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  return criteria.map((c) => {
    if (c.tests.includes(ALL_TESTS)) {
      const failed = runs.filter((r) => r.status === "failed");
      const skipped = runs.filter((r) => r.status === "skipped");
      const passed = runs.length - failed.length - skipped.length;
      if (failed.length) return { criterion: c, verdict: "FAIL", obtained: `${failed.length} de ${runs.length} pruebas fallaron`, failures: failed };
      if (skipped.length || notRun || runs.length === 0) {
        const why = [skipped.length ? `${skipped.length} omitidas` : "", notRun ? notRun.reason : "", runs.length === 0 ? "no se ejecutaron pruebas" : ""].filter(Boolean).join("; ");
        return { criterion: c, verdict: "BLOQUEADO", obtained: `${passed} en PASS; ${why}`, failures: [] };
      }
      return { criterion: c, verdict: "PASS", obtained: `${passed} de ${runs.length} pruebas en PASS`, failures: [] };
    }
    const missing: string[] = [];
    const failures: TestRun[] = [];
    const parts: string[] = [];
    for (const id of c.tests) {
      const rs = byId.get(id) ?? [];
      if (rs.length === 0) {
        missing.push(notRun && id.endsWith("-E2E") ? `${id} (${notRun.reason})` : `${id} (sin ejecutar)`);
        continue;
      }
      const failed = rs.filter((r) => r.status === "failed");
      const skipped = rs.filter((r) => r.status === "skipped");
      failures.push(...failed);
      if (skipped.length && !failed.length) missing.push(`${id} (omitida)`);
      parts.push(rs.length > 1 ? `${id} ${rs.length - failed.length - skipped.length}/${rs.length}` : `${id} ${failed.length ? "FAIL" : skipped.length ? "omitida" : "PASS"}`);
    }
    if (failures.length) return { criterion: c, verdict: "FAIL", obtained: `${parts.join(", ")}. ${firstLine(failures[0]!.message)}`, failures };
    if (missing.length) return { criterion: c, verdict: "BLOQUEADO", obtained: `${parts.length ? `${parts.join(", ")}; ` : ""}falta: ${missing.join(", ")}`, failures: [] };
    return { criterion: c, verdict: "PASS", obtained: parts.join(", "), failures: [] };
  });
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderMatrix(rows: Row[], runs: TestRun[], meta: { generatedAt: string; commit: string; node: string; postgres: string; e2e: string }) {
  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  const st = (s: Status) => runs.filter((r) => r.status === s).length;
  const lines: string[] = [
    "# Matriz de aceptación — Fase 1",
    "",
    "> Archivo generado por `npm run test:acceptance` a partir de la ejecución real de las pruebas. No se edita a mano:",
    "> un criterio figura en PASS solo si todas las pruebas que lo verifican se ejecutaron y pasaron (§48, K.3).",
    "",
    `- Generada: ${meta.generatedAt}`,
    `- Código: ${meta.commit}`,
    `- Entorno: Node ${meta.node}, PostgreSQL ${meta.postgres}`,
    `- Pruebas ejecutadas: ${runs.length} (${st("passed")} PASS, ${st("failed")} FAIL, ${st("skipped")} omitidas). Navegador: ${meta.e2e}`,
    `- Criterios: ${rows.length} (${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("BLOQUEADO")} BLOQUEADO)`,
    "",
  ];
  for (const section of ["§46", "§47", "§45", "K.1", "§49"] as const) {
    const title = { "§46": "Criterios de aceptación (§46)", "§47": "Pruebas integrales (§47)", "§45": "Datos de prueba (§45)", "K.1": "Propiedades y concurrencia (K.1)", "§49": "Condición para terminar la Fase 1 (§49)" }[section];
    lines.push(`## ${title}`, "", "| ID | Módulo | Criterio | Resultado esperado | Resultado obtenido | Estado |", "| -- | ------ | -------- | ------------------ | ------------------ | ------ |");
    for (const r of rows.filter((x) => x.criterion.section === section)) {
      const c = r.criterion;
      lines.push(`| ${c.id} | ${cell(c.module)} | ${cell(c.criterion)} | ${cell(c.expected)} | ${cell(r.obtained)} | **${r.verdict}** |`);
    }
    lines.push("");
  }

  lines.push("## Fallas", "");
  const failing = rows.filter((r) => r.verdict === "FAIL");
  if (failing.length === 0) lines.push("No hay criterios en FAIL en esta ejecución.", "");
  for (const r of failing) {
    for (const f of r.failures) {
      lines.push(
        `### ${r.criterion.id} — ${f.name}`,
        "",
        `1. Problema: ${firstLine(f.message) || "la prueba falló sin mensaje"}`,
        "2. Causa: (análisis de quien corrige)",
        `3. Archivo/módulo afectado: ${f.file}`,
        "4. Solución: (a completar al corregir)",
        `5. Prueba realizada: ${f.name}`,
        "6. Nuevo resultado: se informa al volver a generar esta matriz.",
        "",
      );
    }
  }

  lines.push("## Anexo: todas las pruebas por ID", "", "| ID | Archivo | Pruebas | PASS | FAIL | Omitidas |", "| -- | ------- | ------- | ---- | ---- | -------- |");
  const groups = new Map<string, TestRun[]>();
  for (const r of runs) {
    const key = r.id ? `${r.id}\u0000${r.file}` : `(sin ID)\u0000${r.file}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }));
  for (const [key, rs] of sorted) {
    const [id, file] = key.split("\u0000");
    const n = (s: Status) => rs.filter((r) => r.status === s).length;
    lines.push(`| ${id} | ${file} | ${rs.length} | ${n("passed")} | ${n("failed")} | ${n("skipped")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

async function postgresVersion() {
  const c = new Client({ connectionString: process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL });
  try {
    await c.connect();
    return (await c.query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0]!.v;
  } catch {
    return "desconocida";
  } finally {
    await c.end().catch(() => undefined);
  }
}

function git(args: string[]) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function main() {
  const withBrowser = !process.argv.includes("--sin-navegador");
  const reportOnly = process.argv.includes("--solo-reporte");
  mkdirSync(RESULTS, { recursive: true });
  const started = Date.now();
  let exit = 0;

  if (!reportOnly) {
    const v = spawnSync("npx", ["vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${VITEST_JSON}`], { cwd: ROOT, stdio: "inherit" });
    if (v.status !== 0) exit = 1;
    if (withBrowser) {
      if (!existsSync(path.join(ROOT, ".next/BUILD_ID"))) {
        console.error("Falta compilar la aplicación para las pruebas en el navegador: npm run build (o use --sin-navegador).");
        process.exit(2);
      }
      const p = spawnSync("npx", ["playwright", "test"], { cwd: ROOT, stdio: "inherit" });
      if (p.status !== 0) exit = 1;
    }
  }

  const vitest = readJson<VitestJson>(VITEST_JSON);
  if (!vitest) {
    console.error("No se encontró el reporte de Vitest.");
    process.exit(2);
  }
  const runs = parseVitest(vitest);
  // Al correr las pruebas, el reporte del navegador cuenta solo si lo escribió esta misma corrida.
  const e2eFresh = existsSync(E2E_JSON) && (reportOnly || statSync(E2E_JSON).mtimeMs >= started);
  const pw = withBrowser && e2eFresh ? readJson<{ suites: PwSuite[] }>(E2E_JSON) : null;
  if (pw) runs.push(...parsePlaywright(pw));
  const notRun = pw ? null : { runner: "playwright" as const, reason: withBrowser ? "sin reporte del navegador" : "navegador no ejecutado" };

  const rows = evaluate(CRITERIA, runs, notRun);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]) ? " (con cambios sin confirmar)" : "";
  const md = renderMatrix(rows, runs, {
    generatedAt: `${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "medium", hourCycle: "h23" })} (hora argentina)`,
    commit: `${git(["rev-parse", "--abbrev-ref", "HEAD"])} @ ${git(["rev-parse", "--short", "HEAD"])}${dirty}`,
    node: process.versions.node,
    postgres: await postgresVersion(),
    e2e: pw ? "ejecutado (Playwright, Chromium)" : notRun!.reason,
  });
  writeFileSync(OUTPUT, md);
  const summary = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  console.log(`\nMatriz generada en ${path.relative(ROOT, OUTPUT)}: ${summary("PASS")} PASS, ${summary("FAIL")} FAIL, ${summary("BLOQUEADO")} BLOQUEADO.`);
  if (summary("FAIL") > 0) exit = 1;
  process.exit(exit);
}

if (process.argv[1]?.endsWith("matrix.ts")) main();
