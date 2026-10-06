import { expect, type Locator, type Page } from "@playwright/test";
import { E2E_PASSWORD, E2E_USER } from "./env";

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USER);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Elige la opción cuyo texto contiene `text` (los combos muestran código + nombre). */
export async function selectContaining(select: Locator, text: string) {
  const value = await select.locator("option").filter({ hasText: text }).first().getAttribute("value");
  if (!value) throw new Error(`No hay una opción con "${text}"`);
  await select.selectOption(value);
}

/** Envía el formulario y, si el sistema muestra advertencias para confirmar, las confirma y reenvía. */
export async function submitConfirmingWarnings(page: Page, button: Locator) {
  await button.click();
  const confirm = page.getByLabel(/Revisé las advertencias/);
  const outcome = await Promise.race([
    page.waitForURL(/\?(registrad[ao]|guardado)=1/).then(() => "done" as const),
    confirm.waitFor().then(() => "warn" as const),
  ]);
  if (outcome === "warn") {
    await confirm.check();
    await button.click();
    await page.waitForURL(/\?(registrad[ao]|guardado)=1/);
  }
}

export const idFromUrl = (page: Page) => Number(new URL(page.url()).pathname.split("/").filter(Boolean).at(-1));

/** Texto de la página sin espacios duplicados, para buscar importes y rótulos. */
export async function pageText(page: Page) {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

export async function expectPdf(page: Page, href: string) {
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  return body;
}

/** El formulario de cobranza o pago arranca con una línea en efectivo: la reemplaza por el medio indicado. */
export async function onlyMethod(page: Page, method: string) {
  await page.getByRole("button", { name: `+ ${method}`, exact: true }).click();
  await page.getByRole("button", { name: "Quitar" }).first().click();
  await expect(page.getByText(`1. ${method}`, { exact: true })).toBeVisible();
}
