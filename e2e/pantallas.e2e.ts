/**
 * Pantallas principales en el navegador: sin errores de consola (incluida la CSP), sin
 * desborde horizontal de la página y con los gráficos del dashboard dibujados.
 */
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const PAGES = [
  "/",
  "/clientes",
  "/proveedores",
  "/comprobantes-emitidos",
  "/comprobantes-recibidos",
  "/cuentas-corrientes/clientes",
  "/cuentas-corrientes/proveedores",
  "/cobranzas",
  "/pagos",
  "/imputaciones",
  "/caja",
  "/bancos",
  "/cheques",
  "/tesoreria",
  "/reportes",
  "/reportes/clientes-deuda",
  "/reportes/flujo-de-fondos",
  "/reportes/iva-ventas",
  "/admin/auditoria",
  "/admin/backups",
  "/admin/consistencia",
];

test("UI-01 las pantallas principales cargan sin errores de consola ni desborde, y el dashboard dibuja sus gráficos", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${new URL(page.url()).pathname}: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message}`));
  await login(page);
  for (const path of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `desborde horizontal en ${path}`).toBe(true);
    if (path === "/") {
      // Dos gráficos (evolución y flujo de fondos) con sus trazos dibujados.
      await expect(page.locator(".recharts-wrapper")).toHaveCount(2);
      expect(await page.locator(".recharts-wrapper path.recharts-curve").count()).toBeGreaterThan(0);
    }
  }
  expect(errors).toEqual([]);
});
