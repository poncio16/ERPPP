import { describe, expect, it } from "vitest";
import { ALL_TESTS, CRITERIA, type Criterion } from "../acceptance/criterios";
import { evaluate, parsePlaywright, parseVitest, renderMatrix, testId, type TestRun } from "../../scripts/acceptance/matrix";

const c = (tests: string[]): Criterion => ({ section: "§46", id: "AC-X", module: "M", criterion: "C", expected: "E", tests });
const run = (id: string | null, status: TestRun["status"], message?: string): TestRun => ({ id, name: `${id} prueba`, file: "tests/x.test.ts", status, message, runner: "vitest" });

describe("ACC Matriz de aceptación generada desde la ejecución (§48, K.3)", () => {
  it("ACC-01 el ID se toma del nombre de la prueba o del grupo que la contiene", () => {
    expect(testId(["CLI-01 crear cliente"])).toBe("CLI-01");
    expect(testId(["CLI-01b rechaza CUIT inválida"])).toBe("CLI-01b");
    expect(testId(["CMP-IVA-03 tolerancia"])).toBe("CMP-IVA-03");
    expect(testId(["INT-CLI comprobante 500.000"])).toBe("INT-CLI");
    expect(testId(["INT-PRV-E2E proveedor"])).toBe("INT-PRV-E2E");
    expect(testId(["DB-04 Imputaciones", "rechaza la sobreimputación"])).toBe("DB-04");
    expect(testId(["Validadores", "CUIT correcta"])).toBeNull();
  });

  it("ACC-02 PASS solo si todas las pruebas del criterio corrieron y pasaron; FAIL si alguna falla; BLOQUEADO si falta u se omitió", () => {
    const runs = [run("A-01", "passed"), run("A-02", "passed"), run("A-02", "failed", "esperaba 60.000"), run("A-03", "skipped")];
    const [pass, fail, missing, skipped, all] = evaluate([c(["A-01"]), c(["A-01", "A-02"]), c(["A-01", "Z-99"]), c(["A-03"]), c([ALL_TESTS])], runs, null);
    expect(pass!.verdict).toBe("PASS");
    expect(fail!.verdict).toBe("FAIL");
    expect(fail!.obtained).toContain("esperaba 60.000");
    expect(missing!.verdict).toBe("BLOQUEADO");
    expect(missing!.obtained).toContain("Z-99 (sin ejecutar)");
    expect(skipped!.verdict).toBe("BLOQUEADO");
    expect(all!.verdict).toBe("FAIL");
    expect(evaluate([c([ALL_TESTS])], [run("A-01", "passed")], null)[0]!.verdict).toBe("PASS");
    expect(evaluate([c([ALL_TESTS])], [], null)[0]!.verdict).toBe("BLOQUEADO");
    // Sin el navegador, sus criterios quedan bloqueados (nunca PASS).
    const e2e = evaluate([c(["A-01", "INT-CLI-E2E"])], [run("A-01", "passed")], { runner: "playwright", reason: "navegador no ejecutado" })[0]!;
    expect(e2e).toMatchObject({ verdict: "BLOQUEADO" });
    expect(e2e.obtained).toContain("INT-CLI-E2E (navegador no ejecutado)");
  });

  it("ACC-03 lee los reportes de Vitest y Playwright y documenta cada FAIL con el formato de §48", () => {
    const v = parseVitest({
      testResults: [{ name: `${process.cwd()}/tests/integration/x.test.ts`, assertionResults: [{ ancestorTitles: ["CC-01 cuenta"], title: "saldo", status: "failed", failureMessages: ["AssertionError: expected '60000.00'\n at x"] }] }],
    });
    expect(v[0]).toMatchObject({ id: "CC-01", status: "failed", file: "tests/integration/x.test.ts" });
    const p = parsePlaywright({ suites: [{ title: "integral.e2e.ts", specs: [{ title: "INT-CLI-E2E cliente", ok: true, file: "integral.e2e.ts", tests: [{ status: "expected", results: [{ status: "passed" }] }] }] }] });
    expect(p[0]).toMatchObject({ id: "INT-CLI-E2E", status: "passed", runner: "playwright" });
    const rows = evaluate([c(["CC-01"])], v, null);
    const md = renderMatrix(rows, v, { generatedAt: "hoy", commit: "x", node: "22", postgres: "16", e2e: "no" });
    expect(md).toContain("| AC-X | M | C | E |");
    expect(md).toContain("**FAIL**");
    for (const step of ["1. Problema: AssertionError", "2. Causa", "3. Archivo/módulo afectado: tests/integration/x.test.ts", "4. Solución", "5. Prueba realizada", "6. Nuevo resultado"]) expect(md).toContain(step);
  });

  it("ACC-04 el catálogo cubre §46, §47 y §49 con IDs únicos y cada criterio tiene pruebas", () => {
    expect(new Set(CRITERIA.map((x) => x.id)).size).toBe(CRITERIA.length);
    for (const s of ["§46", "§47", "§49"]) expect(CRITERIA.some((x) => x.section === s)).toBe(true);
    expect(CRITERIA.every((x) => x.tests.length > 0)).toBe(true);
    expect(CRITERIA.find((x) => x.id === "AC-INT-GLB")!.tests).toContain("INT-GLB");
  });
});
