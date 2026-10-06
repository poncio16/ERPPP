import type { Allocation, DocumentSpec, PartySpec, Scenario } from "./scenario";

/**
 * Datos de prueba de la sección 45: 10 clientes, 10 proveedores, 20 comprobantes emitidos y 20
 * recibidos, cobranzas y pagos completos y parciales, efectivo, transferencias, cheques (en
 * cartera, depositados, acreditados, endosados, rechazados y propios), comprobantes vencidos y a
 * vencer, notas de crédito y de débito y saldos a favor de ambos lados.
 *
 * Todo se registra con las acciones reales, así que cuentas corrientes, imputaciones, caja,
 * bancos, cheques y auditoría quedan consistentes. Las fechas son relativas al día de la carga.
 * Todos los nombres y CUIT son ficticios.
 */

const CLIENTS: PartySpec[] = [
  { name: "Ferretería El Tornillo S.R.L.", seed: 1001, vat: "RI", city: "Rosario", creditDays: 30 },
  { name: "Distribuidora Los Andes S.A.", seed: 1002, vat: "RI", city: "Mendoza", creditDays: 30 },
  { name: "Constructora del Litoral S.A.", seed: 1003, vat: "RI", city: "Santa Fe", creditDays: 30, creditLimit: "1000000" },
  { name: "Panificadora La Espiga S.R.L.", seed: 1004, vat: "RI", city: "Córdoba", creditDays: 30 },
  { name: "Agroinsumos Pampa S.A.", seed: 1005, vat: "RI", city: "Pergamino", creditDays: 30 },
  { name: "Metalúrgica Río Cuarto S.A.", seed: 1006, vat: "RI", city: "Río Cuarto", creditDays: 30 },
  { name: "Hotel Patagonia Austral S.A.", seed: 1007, vat: "RI", city: "Ushuaia", creditDays: 30 },
  { name: "Martín Gómez", seed: 1008, cuitPrefix: "20", vat: "MT", city: "La Plata", creditDays: 30 },
  { name: "Lucía Fernández", seed: 1009, cuitPrefix: "27", vat: "MT", city: "Mar del Plata", creditDays: 30 },
  { name: "Taller Mecánico Sur", seed: 1010, cuitPrefix: "20", vat: "MT", city: "Bahía Blanca", creditDays: 30 },
];

const SUPPLIERS: PartySpec[] = [
  { name: "Aceros del Plata S.A.", seed: 2001, vat: "RI", city: "Campana" },
  { name: "Papelera Central S.R.L.", seed: 2002, vat: "RI", city: "Buenos Aires" },
  { name: "Transportes Ruta 9 S.A.", seed: 2003, vat: "RI", city: "Rosario" },
  { name: "Energía Sustentable S.A.", seed: 2004, vat: "RI", city: "Neuquén" },
  { name: "Plásticos Industriales S.R.L.", seed: 2005, vat: "RI", city: "San Luis" },
  { name: "Servicios Informáticos Delta S.A.", seed: 2006, vat: "RI", city: "Córdoba" },
  { name: "Maderera Misiones S.A.", seed: 2007, vat: "RI", city: "Posadas" },
  { name: "Juan Pérez Fletes", seed: 2008, cuitPrefix: "20", vat: "MT", city: "Zárate" },
  { name: "Limpieza Integral Ana Ruiz", seed: 2009, cuitPrefix: "27", vat: "MT", city: "Tigre" },
  { name: "Electricidad Benítez", seed: 2010, cuitPrefix: "20", vat: "MT", city: "Luján" },
];

/** [cliente, tipo, neto o importe, emisión, vencimiento, vinculado a (n° de fila), motivo] */
type Row = [party: number, type: string, amount: string, issue: number, due: number, related?: number, reason?: string];

// Emitidos: facturas A a responsables inscriptos y B a monotributistas, con IVA 21 % discriminado.
const ISSUED: Row[] = [
  [0, "FA", "120000", -75, -45],
  [0, "FA", "80000", -20, 10],
  [1, "FA", "250000", -60, -30],
  [1, "FA", "95000", -12, 18],
  [2, "FA", "310000", -50, -20],
  [2, "NDA", "15000", -18, 12, 5, "Intereses por pago fuera de término"],
  [3, "FA", "60000", -45, -15],
  [3, "NCA", "6000", -40, -40, 7, "Bonificación por pronto pago"],
  [4, "FA", "180000", -35, -5],
  [4, "FA", "140000", -8, 22],
  [5, "FA", "400000", -30, 0],
  [5, "FA", "75000", -5, 25],
  [6, "FA", "220000", -65, -35],
  [6, "NDA", "8000", -25, 5, 13, "Diferencia de precio"],
  [7, "FB", "45000", -55, -25],
  [7, "FB", "38000", -15, 15],
  [8, "FB", "90000", -28, 2],
  [8, "NCB", "9000", -26, -26, 17, "Devolución de mercadería"],
  [9, "FB", "70000", -22, 8],
  [9, "FB", "52000", -3, 27],
];

// Recibidos: facturas A con IVA discriminado; C de monotributistas sin IVA discriminado.
const RECEIVED: Row[] = [
  [0, "FA", "200000", -80, -50],
  [0, "FA", "150000", -25, 5],
  [1, "FA", "90000", -60, -30],
  [1, "NCA", "9000", -55, -55, 3, "Descuento comercial"],
  [2, "FA", "500000", -40, -10],
  [2, "NDA", "12000", -20, 10, 5, "Recargo por flete"],
  [3, "FA", "130000", -35, -5],
  [3, "FA", "70000", -10, 20],
  [4, "FA", "260000", -45, -15],
  [4, "FA", "110000", -6, 24],
  [5, "FA", "45000", -30, 0],
  [5, "NCA", "4500", -28, -28, 11, "Ajuste de precio"],
  [6, "FA", "330000", -50, -20],
  [6, "FA", "85000", -14, 16],
  [7, "FC", "60000", -40, -10],
  [7, "FC", "25000", -9, 21],
  [8, "FC", "48000", -33, -3],
  [8, "NDC", "3000", -20, 10, 17, "Gastos administrativos"],
  [9, "FC", "72000", -18, 12],
  [9, "FC", "36000", -4, 26],
];

export const DEMO_COUNTS = { clients: CLIENTS.length, suppliers: SUPPLIERS.length, issued: ISSUED.length, received: RECEIVED.length } as const;

export async function loadDemoData(s: Scenario) {
  // Cajas y cuentas bancarias con saldo inicial hace 120 días.
  const caja = await s.cashBox("Caja principal");
  const cajaChica = await s.cashBox("Caja chica");
  const nacion = await s.bankAccount({ bank: "011", number: "0450-12345/7", name: "Nación cuenta corriente" });
  const galicia = await s.bankAccount({ bank: "007", number: "9750-4 001-8", name: "Galicia cuenta corriente" });
  const santander = await s.bankAccount({ bank: "072", number: "305-007788/1", name: "Santander cuenta corriente" });
  await s.opening("caja", caja, "800000", -120);
  await s.opening("caja chica", cajaChica, "50000", -120);
  await s.opening("nacion", nacion, "2500000", -120);
  await s.opening("galicia", galicia, "1200000", -120);
  await s.opening("santander", santander, "600000", -120);

  const clients: number[] = [];
  for (const c of CLIENTS) clients.push(await s.client(c));
  const suppliers: number[] = [];
  for (const p of SUPPLIERS) suppliers.push(await s.supplier(p));

  const register = async (direction: "ISSUED" | "RECEIVED", rows: Row[], parties: number[], pointOfSale: number) => {
    const ids: number[] = [];
    const numbers = new Map<string, number>();
    for (const [i, [party, type, amount, issue, due, related, reason]] of rows.entries()) {
      const number = (numbers.get(type) ?? (direction === "ISSUED" ? 1200 : 3400)) + 1;
      numbers.set(type, number);
      const noVat = type.endsWith("C"); // factura / nota C: IVA no discriminado
      const spec: DocumentSpec = {
        key: `${direction}-${i + 1}`,
        type,
        party: parties[party]!,
        pointOfSale: direction === "ISSUED" ? pointOfSale : 10 + party,
        number,
        issue,
        due,
        ...(noVat ? { untaxed: amount } : { net21: amount }),
        ...(related ? { related: [ids[related - 1]!], reason } : {}),
      };
      ids.push(await s.document(direction, spec));
    }
    return ids;
  };
  const e = await register("ISSUED", ISSUED, clients, 4);
  const r = await register("RECEIVED", RECEIVED, suppliers, 0);
  const E = (n: number) => e[n - 1]!;
  const R = (n: number) => r[n - 1]!;
  const C = (n: number) => clients[n]!;
  const P = (n: number) => suppliers[n]!;
  const alloc = (...items: Allocation[]) => items;

  await s.transfer("Nación a caja chica", nacion, cajaChica, "20000", -50);

  // --- Cobranzas ---------------------------------------------------------
  // Completas en efectivo, transferencia y cheque; parciales; con saldo a favor.
  await s.collection("K1", C(0), -40, [{ cash: caja.id, amount: "145200" }], alloc([E(1), "145200"]));
  await s.collection("K2", C(1), -25, [{ transfer: nacion.id, amount: "302500", reference: "TRF-88120" }], alloc([E(3), "302500"]));
  await s.collection("K8", C(6), -30, [{ transfer: nacion.id, amount: "300000", reference: "TRF-88007" }], alloc([E(13), "266200"], [E(14), "9680"]));
  await s.collection("K9", C(7), -20, [{ cash: caja.id, amount: "54450" }], alloc([E(15), "54450"]));
  const k4 = await s.collection("K4", C(2), -15, [
    { check: { amount: "375100", number: "10045871", bank: "017", drawerCuitSeed: 3001, drawerName: "Constructora del Litoral S.A.", issue: -15, payment: -10 } },
  ], alloc([E(5), "375100"]));
  await s.deposit(k4.checkIds[0]!, nacion, -10);
  await s.credit(k4.checkIds[0]!, -8);
  const k10 = await s.collection("K10", C(9), -12, [
    { check: { amount: "84700", number: "20078812", bank: "029", drawerCuitSeed: 3002, drawerName: "Taller Mecánico Sur", issue: -12, payment: -12 } },
  ], alloc([E(19), "84700"]));
  await s.deposit(k10.checkIds[0]!, galicia, -11);
  await s.credit(k10.checkIds[0]!, -9);
  await s.rejectReceived(k10.checkIds[0]!, -6, "Sin fondos suficientes");
  await s.allocate("NC E8 contra E7", "CREDIT_DOCUMENT", E(8), [[E(7), "7260"]]);
  await s.collection("K5", C(3), -10, [{ cash: caja.id, amount: "65340" }], alloc([E(7), "65340"]));
  await s.collection("K3", C(1), -5, [{ transfer: galicia.id, amount: "50000", reference: "TRF-90231" }], alloc([E(4), "50000"]));
  await s.collection("K6", C(4), -4, [
    { check: { amount: "100000", number: "30012907", bank: "014", drawerCuitSeed: 3003, drawerName: "Agroinsumos Pampa S.A.", issue: -4, payment: 25 } },
  ], alloc([E(9), "100000"]));
  const k12 = await s.collection("K12", C(4), -3, [
    { check: { amount: "120000", number: "30012955", bank: "014", drawerCuitSeed: 3003, drawerName: "Agroinsumos Pampa S.A.", issue: -3, payment: 10 } },
  ], alloc([E(10), "120000"]));
  const k7 = await s.collection("K7", C(5), -2, [
    { check: { format: "ECHEQ", amount: "200000", number: "E7781203", bank: "072", drawerCuitSeed: 3004, drawerName: "Metalúrgica Río Cuarto S.A.", issue: -2, payment: 15 } },
  ], alloc([E(11), "200000"]));
  await s.deposit(k7.checkIds[0]!, santander, -1);
  await s.collection("K11", C(0), -1, [{ cash: caja.id, amount: "40000" }], alloc([E(2), "40000"]));

  // --- Pagos -------------------------------------------------------------
  await s.payment("G1", P(0), -45, [{ transfer: nacion.id, amount: "242000", reference: "OP-TRF-1001" }], alloc([R(1), "242000"]));
  await s.allocate("NC R4 contra R3", "CREDIT_DOCUMENT", R(4), [[R(3), "10890"]]);
  await s.payment("G2", P(1), -28, [{ cash: caja.id, amount: "98010" }], alloc([R(3), "98010"]));
  await s.payment("G7", P(6), -25, [{ cash: caja.id, amount: "100000" }], alloc([R(13), "100000"]));
  await s.allocate("NC R12 contra R11", "CREDIT_DOCUMENT", R(12), [[R(11), "5445"]]);
  await s.payment("G6", P(5), -20, [{ transfer: galicia.id, amount: "60000", reference: "OP-TRF-1006" }], alloc([R(11), "49005"]));
  await s.payment("G5", P(4), -12, [{ transfer: santander.id, amount: "150000", reference: "OP-TRF-1005" }], alloc([R(9), "150000"]));
  await s.payment("G8", P(7), -9, [{ cash: caja.id, amount: "60000" }], alloc([R(15), "60000"]));
  await s.payment("G3", P(2), -2, [
    { endorse: k12.checkIds[0]! },
    { ownCheck: { bankAccount: galicia.id, amount: "300000", number: "ECH-000101", issue: -2, payment: 20 } },
  ], alloc([R(5), "420000"]));
  const g4 = await s.payment("G4", P(3), -6, [{ ownCheck: { bankAccount: nacion.id, amount: "157300", number: "ECH-000102", issue: -6, payment: -2 } }], alloc([R(7), "157300"]));
  await s.presentIssued(g4.issuedCheckIds[0]!, -2);
  await s.debitIssued(g4.issuedCheckIds[0]!, -1);
  await s.payment("G9", P(9), -3, [{ transfer: nacion.id, amount: "30000", reference: "OP-TRF-1009" }], alloc([R(19), "30000"]));

  // --- Otros movimientos de tesorería -----------------------------------
  await s.movement("comisión nación", nacion, "OUT", "GASTOS_BANCARIOS", "4850", -31, "Comisión mantenimiento de cuenta");
  await s.movement("impuesto nación", nacion, "OUT", "IMP_DEB_CRED", "3627.60", -31, "Impuesto a los débitos y créditos del mes");
  await s.movement("intereses galicia", galicia, "IN", "INTERESES_GANADOS", "12540.25", -15, "Intereses plazo fijo");
  await s.movement("librería", cajaChica, "OUT", "GASTOS_MENORES", "6300", -7, "Artículos de librería y limpieza");
  await s.movement("aporte", caja, "IN", "APORTE", "150000", -3, "Aporte de socios");

  return { clients, suppliers, issued: e, received: r };
}
