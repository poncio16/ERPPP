/**
 * Resultados esperados de la prueba global INT-GLB, calculados a mano a partir de
 * `global-scenario.ts`. No se derivan del sistema: si una cifra del sistema no coincide con
 * estas, la prueba falla.
 *
 * IVA 21 % sobre cada neto:
 *   E1 100.000 → 121.000   E2 200.000 → 242.000   E3 300.000 → 363.000   E4 (ND) 10.000 → 12.100
 *   E5 50.000 → 60.500     E6 (NC) 10.000 → 12.100   E7 80.000 → 96.800
 *   R1 150.000 → 181.500   R2 100.000 → 121.000   R3 400.000 → 484.000   R4 (NC) 40.000 → 48.400
 *   R5 (ND) 5.000 → 6.050  R6 (factura C, IVA no discriminado) 80.000
 */
export const GLOBAL_EXPECTED = {
  issued: {
    /** Saldo de cada comprobante emitido. */
    balances: {
      e1: "0.00", // 121.000 − K1 121.000
      e2: "112000.00", // 242.000 − K2 100.000 − K6 30.000
      e3: "13000.00", // 363.000 − K3 350.000
      e4: "12100.00", // ND sin cobrar
      e5: "0.00", // 60.500 − NC E6 12.100 − K5 48.400
      e6: "0.00", // NC aplicada completa contra E5
      e7: "46800.00", // 96.800 − K4 50.000
    },
    status: { e1: "SETTLED", e2: "PARTIAL", e3: "PARTIAL", e4: "OPEN", e5: "SETTLED", e7: "PARTIAL" },
    /** Débito interno por el cheque C rechazado (50.000), a cargo de Beta. */
    rejectedCheckDebit: "50000.00",
    /** Débitos: 121.000 + 242.000 + 363.000 + 12.100 + 60.500 + 96.800 = 895.400 (sin el débito interno). */
    debitTotal: "895400.00",
    creditTotal: "12100.00",
  },
  received: {
    balances: {
      r1: "0.00", // 181.500 − G1 181.500
      r2: "0.00", // 121.000 − G2 121.000 (del cheque endosado de 150.000)
      r3: "135600.00", // 484.000 − NC R4 48.400 − G3 200.000 − G4 100.000
      r4: "0.00",
      r5: "6050.00",
      r6: "30000.00", // 80.000 − G5 50.000
    },
    status: { r1: "SETTLED", r2: "SETTLED", r3: "PARTIAL", r5: "OPEN", r6: "PARTIAL" },
    /** 181.500 + 121.000 + 484.000 + 6.050 + 80.000 = 872.550. */
    debitTotal: "872550.00",
    creditTotal: "48400.00",
  },
  clients: {
    /** Alfa: 363.000 − (121.000 + 100.000 + 30.000) = 112.000 → E2. */
    c1: { balance: "112000.00", overdue: "0.00", notDue: "112000.00", credit: "0.00" },
    /** Beta: 363.000 + 12.100 + 96.800 + 50.000 (rechazo) − 350.000 − 50.000 = 121.900. Vencido: E3 13.000 + débito por rechazo 50.000. */
    c2: { balance: "121900.00", overdue: "63000.00", notDue: "58900.00", credit: "0.00" },
    /** Gamma: 60.500 − 12.100 − 60.000 = −11.600: saldo a favor (cobranza K5 sin imputar). */
    c3: { balance: "-11600.00", overdue: "0.00", notDue: "0.00", credit: "11600.00" },
    total: { balance: "222300.00", overdue: "63000.00", notDue: "170900.00", credit: "11600.00" },
  },
  suppliers: {
    /** Delta: 302.500 − 181.500 − 150.000 = −29.000: anticipo (pago G2 sin imputar). */
    p1: { balance: "-29000.00", overdue: "0.00", notDue: "0.00", credit: "29000.00" },
    /** Épsilon: 490.050 − 48.400 − 200.000 − 100.000 = 141.650 (R3 vencida 135.600 + R5 a vencer 6.050). */
    p2: { balance: "141650.00", overdue: "135600.00", notDue: "6050.00", credit: "0.00" },
    /** Zeta: 80.000 − 50.000 = 30.000, a vencer. */
    p3: { balance: "30000.00", overdue: "0.00", notDue: "30000.00", credit: "0.00" },
    total: { balance: "142650.00", overdue: "135600.00", notDue: "36050.00", credit: "29000.00" },
  },
  collections: {
    /** K1 121.000 + K2 100.000 + K3 350.000 + K4 50.000 + K5 60.000 + K6 30.000. */
    total: "711000.00",
    unapplied: { k1: "0.00", k2: "0.00", k3: "0.00", k4: "0.00", k5: "11600.00", k6: "0.00" },
  },
  payments: {
    /** G1 181.500 + G2 150.000 + G3 200.000 + G4 100.000 + G5 50.000. */
    total: "681500.00",
    unapplied: { g1: "0.00", g2: "29000.00", g3: "0.00", g4: "0.00", g5: "0.00" },
  },
  /** Imputaciones vigentes: cobranzas 121.000 + 100.000 + 350.000 + 50.000 + 48.400 + 30.000 = 699.400, + NC 12.100 = 711.500;
   *  pagos 181.500 + 121.000 + 200.000 + 100.000 + 50.000 = 652.500, + NC 48.400 = 700.900. */
  allocations: { issued: "711500.00", received: "700900.00" },
  treasury: {
    /** 200.000 + 40.000 (transferencia) + 121.000 (K1) + 60.000 (K5) − 50.000 (G5) − 3.000 (gasto) */
    caja: "368000.00",
    /** 1.000.000 − 40.000 − 181.500 (G1) + 200.000 (cheque A) + 100.000 (K2) − 100.000 (E-0002) − 1.500 (comisión) */
    nacion: "977000.00",
    /** 300.000 + 50.000 (cheque C acreditado) − 50.000 (rechazo) */
    galicia: "300000.00",
    /** Disponible Galicia = contable − cheque propio E-0001 pendiente (200.000) */
    galiciaAvailable: "100000.00",
    liquid: "1645000.00",
    portfolio: "30000.00",
    ownPending: "200000.00",
    /** Caja + bancos disponibles (977.000 + 100.000) + cartera 30.000 */
    position: "1475000.00",
  },
  checks: {
    received: { checkA: "CREDITED", checkB: "ENDORSED", checkC: "REJECTED", checkD: "IN_PORTFOLIO" },
    issued: { ownE1: "DELIVERED", ownE2: "DEBITED" },
  },
  vat: {
    /** Ventas: netos 100.000 + 200.000 + 300.000 + 10.000 + 50.000 − 10.000 + 80.000 = 730.000; IVA 153.300. */
    sales: { net: "730000.00", vat: "153300.00", total: "883300.00" },
    /** Compras: netos 150.000 + 100.000 + 400.000 − 40.000 + 5.000 = 615.000; IVA 129.150; no gravado (factura C) 80.000. */
    purchases: { net: "615000.00", vat: "129150.00", untaxed: "80000.00", total: "824150.00" },
  },
} as const;
