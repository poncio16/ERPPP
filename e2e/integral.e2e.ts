/**
 * Pruebas integrales de §47 a través del navegador (K.1): cliente y proveedor de punta a punta,
 * con los mismos pasos que haría un usuario, incluida la descarga del recibo y de la orden de pago.
 */
import { expect, test } from "@playwright/test";
import { cuitFor } from "../database/seeds/scenario";
import { expectPdf, idFromUrl, onlyMethod, login, pageText, selectContaining, submitConfirmingWarnings } from "./helpers";

// Las dos pruebas comparten la caja y la cuenta bancaria de partida: corren en orden.
test.describe.configure({ mode: "serial" });

test("INT-CLI-E2E cliente: comprobante 500.000, cobranzas 200.000 y 300.000, recibo, caja/banco y auditoría", async ({ page }) => {
  await login(page);

  // 1. Crear cliente.
  await page.goto("/clientes/nuevo");
  await page.getByLabel("Razón social o nombre").fill("Cliente Navegador S.A.");
  await page.getByLabel("CUIT").fill(cuitFor("30", 9101));
  await selectContaining(page.getByLabel("Condición frente al IVA"), "Responsable Inscripto");
  await page.getByLabel("Domicilio").fill("Mitre 500");
  await page.getByLabel("Localidad").fill("Rosario");
  await submitConfirmingWarnings(page, page.getByRole("button", { name: "Crear" }));
  const clientId = idFromUrl(page);

  // 2. Registrar comprobante por $500.000 (neto 413.223,14 + IVA 21 % 86.776,86).
  await page.goto("/comprobantes-emitidos/nuevo");
  await selectContaining(page.getByLabel("Tipo"), "Factura A");
  await page.getByLabel("Punto de venta").fill("1");
  await page.getByLabel("Número").fill("1001");
  await selectContaining(page.getByLabel("Cliente"), "Cliente Navegador");
  await selectContaining(page.locator('select[name="vatTaxId[]"]').first(), "IVA 21%");
  await page.locator('input[name="vatBase[]"]').first().fill("413.223,14");
  await page.locator('input[name="vatAmount[]"]').first().fill("86.776,86");
  await page.getByLabel("Total según comprobante (control)").fill("500.000,00");
  await submitConfirmingWarnings(page, page.getByRole("button", { name: "Registrar comprobante" }));

  // 3. Verificar cuenta corriente.
  await page.goto(`/cuentas-corrientes/clientes/${clientId}`);
  expect(await pageText(page)).toContain("SALDO TOTAL $ 500.000,00");

  // 4-5. Cobranza de $200.000 en efectivo, imputada a la factura.
  await page.goto(`/cobranzas/nueva?tercero=${clientId}`);
  await page.getByLabel("Importe", { exact: true }).fill("200.000,00");
  await selectContaining(page.getByLabel("Caja"), "Caja E2E");
  await page.getByLabel(/Importe a imputar a Factura A 00001-00001001/).fill("200.000,00");
  await submitConfirmingWarnings(page, page.getByRole("button", { name: /Registrar cobranza/ }));
  const first = idFromUrl(page);

  // 6. Saldo $300.000.
  await page.goto(`/cuentas-corrientes/clientes/${clientId}`);
  expect(await pageText(page)).toContain("SALDO TOTAL $ 300.000,00");

  // 7-8. Cobranza de $300.000 por transferencia, imputada.
  await page.goto(`/cobranzas/nueva?tercero=${clientId}`);
  await onlyMethod(page, "Transferencia");
  await page.getByLabel("Importe", { exact: true }).fill("300.000,00");
  await selectContaining(page.getByLabel("Cuenta bancaria"), "Banco E2E");
  await page.getByLabel("Referencia").fill("TRF-E2E-1");
  await page.getByRole("button", { name: "Total" }).click();
  await submitConfirmingWarnings(page, page.getByRole("button", { name: /Registrar cobranza/ }));
  const second = idFromUrl(page);

  // 9. Saldo $0.
  await page.goto(`/cuentas-corrientes/clientes/${clientId}`);
  const account = await pageText(page);
  expect(account).toContain("SALDO TOTAL $ 0,00");
  expect(account).toContain("COBRADO EN EL PERÍODO $ 500.000,00");

  // 10. Recibo interno: pantalla y PDF.
  for (const id of [first, second]) {
    await page.goto(`/cobranzas/${id}`);
    const href = await page.getByRole("link", { name: "Descargar PDF" }).getAttribute("href");
    await expectPdf(page, href!);
  }
  await page.goto(`/cobranzas/${first}/recibo`);
  const receipt = await pageText(page);
  expect(receipt).toContain("Cliente Navegador S.A.");
  expect(receipt).toContain("Recibimos la suma de: $ 200.000,00 Son pesos doscientos mil con 00/100");
  expect(receipt).toContain("DOCUMENTO INTERNO – NO VÁLIDO COMO COMPROBANTE FISCAL");
  expect(receipt).toContain("COMPROBANTES IMPUTADOS Factura A 00001-00001001 $ 200.000,00");

  // 11. Caja y banco.
  await page.goto("/caja");
  expect(await pageText(page)).toContain("$ 1.200.000,00");
  await page.goto("/bancos");
  expect(await pageText(page)).toContain("$ 2.300.000,00");

  // 12. Auditoría: alta del cliente, comprobante y ambas cobranzas a nombre del usuario.
  await page.goto(`/admin/auditoria?entityType=client&entityId=${clientId}`);
  expect(await pageText(page)).toMatch(/admin_e2e.*Clientes/);
  await page.goto("/admin/auditoria?module=collections&result=SUCCESS");
  const audit = await pageText(page);
  expect(audit.match(/Cobranzas/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
});

test("INT-PRV-E2E proveedor: comprobante 500.000, pagos 200.000 y 300.000, orden de pago, caja/banco y auditoría", async ({ page }) => {
  await login(page);

  // 1. Crear proveedor.
  await page.goto("/proveedores/nuevo");
  await page.getByLabel("Razón social o nombre").fill("Proveedor Navegador S.R.L.");
  await page.getByLabel("CUIT").fill(cuitFor("30", 9201));
  await selectContaining(page.getByLabel("Condición frente al IVA"), "Responsable Inscripto");
  await page.getByLabel("Domicilio").fill("Belgrano 1200");
  await page.getByLabel("Localidad").fill("Córdoba");
  await submitConfirmingWarnings(page, page.getByRole("button", { name: "Crear" }));
  const supplierId = idFromUrl(page);

  // 2. Registrar comprobante recibido por $500.000.
  await page.goto("/comprobantes-recibidos/nuevo");
  await selectContaining(page.getByLabel("Tipo"), "Factura A");
  await page.getByLabel("Punto de venta").fill("12");
  await page.getByLabel("Número").fill("4501");
  await selectContaining(page.getByLabel("Proveedor"), "Proveedor Navegador");
  await selectContaining(page.getByLabel("Alícuota"), "IVA 21%");
  await page.getByLabel("Neto gravado").fill("413.223,14");
  await page.getByLabel("IVA", { exact: true }).fill("86.776,86");
  await page.getByLabel("Total según comprobante (control)").fill("500.000,00");
  await submitConfirmingWarnings(page, page.getByRole("button", { name: "Registrar comprobante" }));

  // 3. Verificar cuenta corriente.
  await page.goto(`/cuentas-corrientes/proveedores/${supplierId}`);
  expect(await pageText(page)).toContain("SALDO TOTAL $ 500.000,00");

  // 4-5. Pago de $200.000 por transferencia, imputado.
  await page.goto(`/pagos/nuevo?tercero=${supplierId}`);
  await onlyMethod(page, "Transferencia");
  await page.getByLabel("Importe", { exact: true }).fill("200.000,00");
  await selectContaining(page.getByLabel("Cuenta bancaria"), "Banco E2E");
  await page.getByLabel("Referencia").fill("OP-E2E-1");
  await page.getByLabel(/Importe a imputar a Factura A 00012-00004501/).fill("200.000,00");
  await submitConfirmingWarnings(page, page.getByRole("button", { name: /Registrar pago/ }));
  const first = idFromUrl(page);

  // 6. Saldo $300.000.
  await page.goto(`/cuentas-corrientes/proveedores/${supplierId}`);
  expect(await pageText(page)).toContain("SALDO TOTAL $ 300.000,00");

  // 7-8. Pago de $300.000 en efectivo, imputado.
  await page.goto(`/pagos/nuevo?tercero=${supplierId}`);
  await page.getByLabel("Importe", { exact: true }).fill("300.000,00");
  await selectContaining(page.getByLabel("Caja"), "Caja E2E");
  await page.getByRole("button", { name: "Total" }).click();
  await submitConfirmingWarnings(page, page.getByRole("button", { name: /Registrar pago/ }));
  const second = idFromUrl(page);

  // 9. Saldo $0.
  await page.goto(`/cuentas-corrientes/proveedores/${supplierId}`);
  expect(await pageText(page)).toContain("SALDO TOTAL $ 0,00");

  // 10. Orden de pago interna: pantalla y PDF.
  for (const id of [first, second]) {
    await page.goto(`/pagos/${id}`);
    const href = await page.getByRole("link", { name: "Descargar PDF" }).getAttribute("href");
    await expectPdf(page, href!);
  }
  await page.goto(`/pagos/${second}/orden-de-pago`);
  const order = await pageText(page);
  expect(order).toContain("Proveedor Navegador S.R.L.");
  expect(order).toContain("Son pesos trescientos mil con 00/100");
  expect(order).toContain("NO VÁLIDO COMO COMPROBANTE FISCAL");

  // 11. Caja y banco (después de la prueba del cliente: caja 1.200.000 − 300.000, banco 2.300.000 − 200.000).
  await page.goto("/caja");
  expect(await pageText(page)).toContain("$ 900.000,00");
  await page.goto("/bancos");
  expect(await pageText(page)).toContain("$ 2.100.000,00");

  // 12. Auditoría.
  await page.goto(`/admin/auditoria?entityType=supplier&entityId=${supplierId}`);
  expect(await pageText(page)).toMatch(/admin_e2e.*Proveedores/);
  await page.goto("/admin/auditoria?module=payments&result=SUCCESS");
  expect((await pageText(page)).match(/Pagos/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
});
