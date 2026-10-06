import type { Scenario } from "../../../database/seeds/scenario";

/**
 * Escenario de la prueba global (§47, INT-GLB): 3 clientes, 3 proveedores, comprobantes
 * vencidos y a vencer, NC y ND, cobranzas y pagos completos y parciales, efectivo,
 * transferencias y cheques (acreditado, endosado, rechazado, en cartera, propio pendiente y
 * propio debitado). Los resultados esperados están calculados a mano en `global-expected.ts`.
 * Fechas en días relativos a hoy.
 */
export async function buildGlobalScenario(s: Scenario) {
  // Tesorería: saldos iniciales hace 60 días.
  const caja = await s.cashBox("Caja central");
  const nacion = await s.bankAccount({ bank: "011", number: "4401-1", name: "Nación cuenta corriente" });
  const galicia = await s.bankAccount({ bank: "007", number: "9902-3", name: "Galicia cuenta corriente" });
  await s.opening("caja", caja, "200000", -60);
  await s.opening("nacion", nacion, "1000000", -60);
  await s.opening("galicia", galicia, "300000", -60);

  const c1 = await s.client({ name: "Alfa S.A.", seed: 101, vat: "RI", city: "Rosario" });
  const c2 = await s.client({ name: "Beta S.R.L.", seed: 102, vat: "RI", city: "Córdoba" });
  const c3 = await s.client({ name: "Gamma Servicios", seed: 103, vat: "MT", city: "Mendoza" });
  const p1 = await s.supplier({ name: "Delta S.A.", seed: 201, vat: "RI", city: "Buenos Aires" });
  const p2 = await s.supplier({ name: "Épsilon S.R.L.", seed: 202, vat: "RI", city: "La Plata" });
  const p3 = await s.supplier({ name: "Zeta Fletes", seed: 203, vat: "MT", city: "Santa Fe" });

  // Comprobantes emitidos (neto gravado al 21 %).
  const e1 = await s.issued({ key: "E1", type: "FA", party: c1, pointOfSale: 3, number: 101, issue: -40, due: -10, net21: "100000" });
  const e2 = await s.issued({ key: "E2", type: "FA", party: c1, pointOfSale: 3, number: 102, issue: -20, due: 10, net21: "200000" });
  const e3 = await s.issued({ key: "E3", type: "FA", party: c2, pointOfSale: 3, number: 103, issue: -35, due: -5, net21: "300000" });
  const e4 = await s.issued({ key: "E4", type: "NDA", party: c2, pointOfSale: 3, number: 1, issue: -15, due: 15, net21: "10000", related: [e3], reason: "Intereses por mora" });
  const e5 = await s.issued({ key: "E5", type: "FB", party: c3, pointOfSale: 3, number: 51, issue: -30, due: -1, net21: "50000" });
  const e6 = await s.issued({ key: "E6", type: "NCB", party: c3, pointOfSale: 3, number: 1, issue: -25, due: -25, net21: "10000", related: [e5], reason: "Bonificación comercial" });
  const e7 = await s.issued({ key: "E7", type: "FA", party: c2, pointOfSale: 3, number: 104, issue: -10, due: 20, net21: "80000" });

  // Comprobantes recibidos.
  const r1 = await s.received({ key: "R1", type: "FA", party: p1, pointOfSale: 7, number: 1001, issue: -45, due: -15, net21: "150000" });
  const r2 = await s.received({ key: "R2", type: "FA", party: p1, pointOfSale: 7, number: 1002, issue: -20, due: 10, net21: "100000" });
  const r3 = await s.received({ key: "R3", type: "FA", party: p2, pointOfSale: 2, number: 5001, issue: -30, due: -2, net21: "400000" });
  const r4 = await s.received({ key: "R4", type: "NCA", party: p2, pointOfSale: 2, number: 301, issue: -25, due: -25, net21: "40000", related: [r3], reason: "Descuento por volumen" });
  const r5 = await s.received({ key: "R5", type: "NDA", party: p2, pointOfSale: 2, number: 401, issue: -10, due: 20, net21: "5000", related: [r3], reason: "Gastos de flete" });
  const r6 = await s.received({ key: "R6", type: "FC", party: p3, pointOfSale: 1, number: 77, issue: -15, due: 5, untaxed: "80000" });

  // Movimientos de tesorería en orden de fecha.
  await s.transfer("Nación a caja", nacion, caja, "40000", -9);

  // Cobranzas.
  const k3 = await s.collection("K3", c2, -12, [
    { check: { amount: "200000", number: "A-1001", bank: "017", drawerCuitSeed: 501, drawerName: "Beta S.R.L.", issue: -13, payment: -12 } },
    { check: { amount: "150000", number: "B-2002", bank: "072", drawerCuitSeed: 502, drawerName: "Comercial Norte S.A.", issue: -12, payment: 20 } },
  ], [[e3, "350000"]]);
  const [checkA, checkB] = k3.checkIds as [number, number];
  await s.deposit(checkA, nacion, -11);
  await s.credit(checkA, -9);
  const k1 = await s.collection("K1", c1, -8, [{ cash: caja.id, amount: "121000" }], [[e1, "121000"]]);
  await s.allocate("NC E6 contra E5", "CREDIT_DOCUMENT", e6, [[e5, "12100"]]);
  const k5 = await s.collection("K5", c3, -7, [{ cash: caja.id, amount: "60000" }], [[e5, "48400"]]);
  const k2 = await s.collection("K2", c1, -5, [{ transfer: nacion.id, amount: "100000", reference: "TR-K2" }], [[e2, "100000"]]);
  const k4 = await s.collection("K4", c2, -4, [
    { check: { amount: "50000", number: "C-3003", bank: "029", drawerCuitSeed: 503, drawerName: "Beta S.R.L.", issue: -5, payment: -4 } },
  ], [[e7, "50000"]]);
  const [checkC] = k4.checkIds as [number];
  await s.deposit(checkC, galicia, -3);
  await s.credit(checkC, -2);
  const k6 = await s.collection("K6", c1, -2, [
    { check: { amount: "30000", number: "D-4004", bank: "011", drawerCuitSeed: 504, drawerName: "Alfa S.A.", issue: -2, payment: 30 } },
  ], [[e2, "30000"]]);
  const [checkD] = k6.checkIds as [number];
  await s.rejectReceived(checkC, -1, "Sin fondos suficientes");

  // Pagos.
  const g1 = await s.payment("G1", p1, -10, [{ transfer: nacion.id, amount: "181500", reference: "TR-G1" }], [[r1, "181500"]]);
  const g2 = await s.payment("G2", p1, -6, [{ endorse: checkB }], [[r2, "121000"]]);
  await s.allocate("NC R4 contra R3", "CREDIT_DOCUMENT", r4, [[r3, "48400"]]);
  const g3 = await s.payment("G3", p2, -5, [{ ownCheck: { bankAccount: galicia.id, amount: "200000", number: "E-0001", issue: -5, payment: 25 } }], [[r3, "200000"]]);
  const g4 = await s.payment("G4", p2, -3, [{ ownCheck: { bankAccount: nacion.id, amount: "100000", number: "E-0002", issue: -3, payment: -1 } }], [[r3, "100000"]]);
  const [ownE2] = g4.issuedCheckIds as [number];
  const g5 = await s.payment("G5", p3, -2, [{ cash: caja.id, amount: "50000" }], [[r6, "50000"]]);
  await s.presentIssued(ownE2, -1);
  await s.debitIssued(ownE2, 0);

  await s.movement("comisión", nacion, "OUT", "GASTOS_BANCARIOS", "1500", -1, "Comisión mantenimiento de cuenta");
  await s.movement("librería", caja, "OUT", "GASTOS_MENORES", "3000", -1, "Artículos de librería");

  return {
    accounts: { caja, nacion, galicia },
    clients: { c1, c2, c3 },
    suppliers: { p1, p2, p3 },
    issued: { e1, e2, e3, e4, e5, e6, e7 },
    received: { r1, r2, r3, r4, r5, r6 },
    collections: { k1: k1.id, k2: k2.id, k3: k3.id, k4: k4.id, k5: k5.id, k6: k6.id },
    payments: { g1: g1.id, g2: g2.id, g3: g3.id, g4: g4.id, g5: g5.id },
    checks: { checkA, checkB, checkC, checkD, ownE1: g3.issuedCheckIds[0]!, ownE2 },
  };
}

export type GlobalScenario = Awaited<ReturnType<typeof buildGlobalScenario>>;
