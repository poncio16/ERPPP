/**
 * Catálogo de criterios de aceptación (§46 a §49 y K.1–K.3): cada criterio con su resultado
 * esperado y las pruebas automatizadas que lo verifican, por su ID. La matriz
 * (tests/acceptance/matriz.md) se genera cruzando este catálogo con el reporte de ejecución de
 * las pruebas (`npm run test:acceptance`): un criterio figura en PASS solo si todas sus pruebas
 * se ejecutaron y pasaron.
 */

export interface Criterion {
  id: string;
  module: string;
  criterion: string;
  expected: string;
  /** IDs de las pruebas (prefijo del nombre de la prueba o del grupo que la contiene). */
  tests: string[];
  /** Sección de la especificación. */
  section: "§46" | "§47" | "§49" | "K.1" | "§45";
}

export const ALL_TESTS = "*";

export const CRITERIA: Criterion[] = [
  // ------------------------------------------------------------------ §46
  { section: "§46", id: "AC-CLI-01", module: "Clientes", criterion: "Crear cliente", expected: "Se crea con código automático, CUIT validada y auditoría", tests: ["CLI-01", "CLI-01b", "CLI-01c"] },
  { section: "§46", id: "AC-CLI-02", module: "Clientes", criterion: "Modificar cliente", expected: "Guarda valores anteriores y nuevos; control de edición concurrente", tests: ["CLI-02"] },
  { section: "§46", id: "AC-CLI-03", module: "Clientes", criterion: "Detectar CUIT duplicado", expected: "Avisa y bloquea; la base impide el duplicado aunque se saltee el servicio", tests: ["CLI-03", "CLI-03b"] },
  { section: "§46", id: "AC-CLI-04", module: "Clientes", criterion: "Dar de baja lógicamente", expected: "Queda inactivo, no se borra, se puede reactivar; con saldo no se permite", tests: ["CLI-04"] },
  { section: "§46", id: "AC-CLI-05", module: "Clientes", criterion: "Mantener historial", expected: "Alta, modificación, baja y reactivación quedan registradas", tests: ["CLI-05"] },
  { section: "§46", id: "AC-PRV-01", module: "Proveedores", criterion: "Crear proveedor", expected: "Se crea con datos bancarios y auditoría", tests: ["PRV-01"] },
  { section: "§46", id: "AC-PRV-02", module: "Proveedores", criterion: "Modificar proveedor", expected: "Guarda valores anteriores y nuevos", tests: ["PRV-02"] },
  { section: "§46", id: "AC-PRV-03", module: "Proveedores", criterion: "Detectar CUIT duplicado", expected: "Avisa y bloquea el proveedor duplicado", tests: ["PRV-03"] },
  { section: "§46", id: "AC-PRV-04", module: "Proveedores", criterion: "Impedir eliminación incorrecta", expected: "Sin borrado físico; baja bloqueada con saldo o cheques en circulación", tests: ["PRV-04", "DB-07"] },
  {
    section: "§46",
    id: "AC-CMP-01",
    module: "Comprobantes",
    criterion: "Registrar neto $100.000 + IVA 21% $21.000 = total $121.000",
    expected: "Se registra, genera saldo $121.000 y movimiento en cuenta corriente",
    tests: ["CMP-01", "CMP-IVA-02", "DB-01"],
  },
  { section: "§46", id: "AC-CMP-02", module: "Comprobantes", criterion: "No permitir duplicados", expected: "Mismo tipo + punto de venta + número (y proveedor) se rechaza; doble envío registra uno solo", tests: ["CMP-02", "CMP-08", "CMP-13", "DB-02"] },
  { section: "§46", id: "AC-CC-01", module: "Cuentas corrientes", criterion: "Comprobante $100.000 y cobranza $40.000", expected: "Saldo = $60.000", tests: ["CC-01"] },
  {
    section: "§46",
    id: "AC-IMP-01",
    module: "Imputaciones",
    criterion: "Comprobantes $100.000 y $50.000, cobranza $120.000",
    expected: "Comprobante 1: $100.000; comprobante 2: $20.000; saldo disponible $0",
    tests: ["IMP-01"],
  },
  { section: "§46", id: "AC-IMP-02", module: "Imputaciones", criterion: "Rechazar imputación superior al pago", expected: "Se rechaza y no se registra nada", tests: ["IMP-02", "DB-04"] },
  { section: "§46", id: "AC-IMP-03", module: "Imputaciones", criterion: "Rechazar imputación superior al saldo del comprobante", expected: "Se rechaza, también con dos imputaciones simultáneas", tests: ["IMP-02", "IMP-07", "DB-04"] },
  { section: "§46", id: "AC-CAJ-01", module: "Caja", criterion: "Saldo inicial $500.000, ingreso $100.000, egreso $150.000", expected: "$600.000 y luego $450.000", tests: ["CAJ-01"] },
  { section: "§46", id: "AC-BCO-01", module: "Bancos", criterion: "Transferencia recibida +$100.000 y pago por transferencia −$100.000", expected: "Saldo bancario +$100.000 y luego −$100.000", tests: ["BCO-01"] },
  { section: "§46", id: "AC-BCO-02", module: "Bancos", criterion: "No generar doble impacto", expected: "Un solo movimiento por operación, aun con doble envío", tests: ["BCO-01", "COB-04", "CAJ-03", "DB-05"] },
  { section: "§46", id: "AC-CHQ-01", module: "Cheques", criterion: "Cheque recibido", expected: "Aumenta la cartera y no aumenta el banco", tests: ["CHQ-01"] },
  { section: "§46", id: "AC-CHQ-02", module: "Cheques", criterion: "Cheque depositado", expected: "Disminuye la cartera y cambia de estado", tests: ["CHQ-02"] },
  {
    section: "§46",
    id: "AC-CHQ-03",
    module: "Cheques",
    criterion: "Cheque rechazado",
    expected: "Mantiene historial y revierte el efecto financiero (banco y deuda del cliente)",
    tests: ["CHQ-03", "CHQ-04", "CHQ-06", "CHQ-08"],
  },
  { section: "§46", id: "AC-AUD-01", module: "Auditoría", criterion: "Toda modificación financiera registra usuario, fecha, operación, valor anterior y nuevo", expected: "Registro completo e inalterable", tests: ["AUD-01", "AUD-04", "AUD-06"] },
  { section: "§46", id: "AC-BKP-01", module: "Backup", criterion: "Crear backup", expected: "Archivo con SHA-256, versiones, totales de control y copia cifrada", tests: ["BKP-01", "BKP-02"] },
  { section: "§46", id: "AC-BKP-02", module: "Backup", criterion: "Restaurarlo y comprobar que los datos coinciden", expected: "Totales de control idénticos a los del backup", tests: ["BKP-03", "BKP-05"] },

  // ------------------------------------------------------------------ §47
  {
    section: "§47",
    id: "AC-INT-CLI",
    module: "Integral",
    criterion: "Cliente: comprobante $500.000, cobranzas $200.000 y $300.000 imputadas, recibo, caja/banco y auditoría",
    expected: "Saldo $300.000 y luego $0; recibos generados; caja y banco impactados; operaciones auditadas",
    tests: ["INT-CLI", "INT-CLI-E2E"],
  },
  {
    section: "§47",
    id: "AC-INT-PRV",
    module: "Integral",
    criterion: "Proveedor: comprobante $500.000, pagos $200.000 y $300.000 imputados, orden de pago, caja/banco y auditoría",
    expected: "Saldo $300.000 y luego $0; órdenes de pago generadas; caja y banco impactados; operaciones auditadas",
    tests: ["INT-PRV", "INT-PRV-E2E"],
  },
  {
    section: "§47",
    id: "AC-INT-GLB",
    module: "Integral",
    criterion: "Prueba global: 3 clientes, 3 proveedores, comprobantes, NC, ND, cobranzas y pagos completos y parciales, efectivo, transferencias, cheques, vencidos",
    expected: "Comprobantes, cuentas corrientes, imputaciones, caja, bancos, cheques, tesorería y reportes coinciden con lo calculado a mano; invariantes en $0",
    tests: ["INT-GLB"],
  },

  // ------------------------------------------------------------- §45 y K.1
  {
    section: "§45",
    id: "AC-DAT-01",
    module: "Datos de prueba",
    criterion: "10 clientes, 10 proveedores, 20 + 20 comprobantes con todos los casos de §45",
    expected: "Se cargan con las acciones reales, bloqueados en producción, y con ellos cierran cuentas, caja, bancos, cheques, tesorería y reportes",
    tests: ["DAT-01", "DAT-02", "DAT-03", "DAT-04", "DAT-05"],
  },
  {
    section: "K.1",
    id: "AC-PROP-01",
    module: "Propiedades",
    criterion: "Secuencias aleatorias de comprobantes, cobranzas, pagos, imputaciones y anulaciones",
    expected: "Ningún saldo negativo, ninguna sobreimputación, invariantes de G.14 en $0",
    tests: ["PROP-01"],
  },
  {
    section: "K.1",
    id: "AC-CONC-01",
    module: "Concurrencia",
    criterion: "Operaciones simultáneas",
    expected: "Números de recibo distintos y consecutivos; imputaciones simultáneas sin sobreimputar; doble envío sin doble registro",
    tests: ["COB-05", "IMP-07", "DB-09", "COB-04", "CMP-08"],
  },

  {
    section: "K.1",
    id: "AC-UI-01",
    module: "Interfaz",
    criterion: "Pantallas principales en el navegador",
    expected: "Cargan sin errores de consola (incluida la política de seguridad), sin desborde horizontal y con los gráficos del dashboard dibujados",
    tests: ["UI-01"],
  },

  // ------------------------------------------------------------------ §49
  { section: "§49", id: "AC-FIN-01", module: "Fase 1", criterion: "Todas las pruebas críticas en PASS", expected: "Ninguna prueba falla ni queda sin ejecutar", tests: [ALL_TESTS] },
  { section: "§49", id: "AC-FIN-02", module: "Fase 1", criterion: "No existen errores financieros", expected: "Invariantes de G.14 en $0 en todos los escenarios", tests: ["INT-GLB", "PROP-01", "CON-01", "DAT-04"] },
  { section: "§49", id: "AC-FIN-03", module: "Fase 1", criterion: "No existen duplicaciones", expected: "Duplicados e idempotencia controlados en servicio y base", tests: ["CLI-03", "CMP-02", "CMP-08", "COB-04", "CAJ-03", "DB-02", "DB-05"] },
  { section: "§49", id: "AC-FIN-04", module: "Fase 1", criterion: "No existen sobreimputaciones", expected: "Imputado ≤ crédito y ≤ saldo del comprobante", tests: ["IMP-02", "IMP-03", "IMP-07", "DB-04", "PROP-01"] },
  { section: "§49", id: "AC-FIN-05", module: "Fase 1", criterion: "Cuentas por cobrar consistentes", expected: "Saldos, vencidos y saldos a favor iguales en cuenta corriente, composición y reportes", tests: ["CC-01", "CC-02", "CC-03", "CC-04", "CC-05", "CC-07", "REP-01", "INT-GLB"] },
  { section: "§49", id: "AC-FIN-06", module: "Fase 1", criterion: "Cuentas por pagar consistentes", expected: "Saldos de proveedores iguales en cuenta corriente y reportes", tests: ["CC-06", "REP-03", "PAG-03", "INT-GLB"] },
  { section: "§49", id: "AC-FIN-07", module: "Fase 1", criterion: "Caja consistente", expected: "Saldo = movimientos; sin negativos; arqueo cuadra", tests: ["CAJ-01", "CAJ-02", "CAJ-04", "CAJ-06", "CAJ-07", "CAJ-08", "INT-GLB"] },
  { section: "§49", id: "AC-FIN-08", module: "Fase 1", criterion: "Bancos consistentes", expected: "Saldo contable y disponible correctos; transferencias internas balanceadas", tests: ["BCO-01", "BCO-03", "BCO-04", "BCO-05", "INT-GLB"] },
  { section: "§49", id: "AC-FIN-09", module: "Fase 1", criterion: "Cheques consistentes", expected: "Estados, cartera e impactos en banco y cuentas correctos", tests: ["CHQ-01", "CHQ-02", "CHQ-03", "CHQ-05", "CHQ-06", "CHQ-07", "CHQ-08", "DB-06", "INT-GLB"] },
  { section: "§49", id: "AC-FIN-10", module: "Fase 1", criterion: "Existe trazabilidad", expected: "Cada operación queda auditada y nada se borra: se anula o revierte", tests: ["AUD-01", "AUD-02", "CLI-05", "CMP-07", "CAJ-06", "COB-07"] },
  { section: "§49", id: "AC-FIN-11", module: "Fase 1", criterion: "Funcionan los permisos", expected: "Matriz acción × rol aplicada en el backend; rechazos auditados", tests: ["PERM-01", "PERM-02", "AUTH-04", "CMP-16", "COB-09", "CHQ-10"] },
  { section: "§49", id: "AC-FIN-12", module: "Fase 1", criterion: "Funciona la auditoría", expected: "Registro, consulta, inviolabilidad y verificación de la cadena", tests: ["AUD-01", "AUD-02", "AUD-03", "AUD-04", "AUD-05", "AUD-07", "DB-08"] },
  { section: "§49", id: "AC-FIN-13", module: "Fase 1", criterion: "Funciona el backup", expected: "Backup verificable, cifrado fuera del servidor, retención y alertas", tests: ["BKP-01", "BKP-02", "BKP-08", "BKP-09", "BKP-10", "BKP-11", "BKP-12", "BKP-13"] },
  { section: "§49", id: "AC-FIN-14", module: "Fase 1", criterion: "Funciona la restauración", expected: "Restaura y verifica; si no verifica no toca la base actual", tests: ["BKP-03", "BKP-04", "BKP-05", "BKP-06", "BKP-07"] },
  { section: "§49", id: "AC-FIN-15", module: "Fase 1", criterion: "Los reportes coinciden con los datos", expected: "Totales de reportes = módulos de origen (G.14-8)", tests: ["REP-06", "REP-10", "REP-11", "REP-12", "INT-GLB", "DAT-04"] },
  { section: "§49", id: "AC-FIN-16", module: "Fase 1", criterion: "Se ejecutaron las pruebas integrales", expected: "Cliente, proveedor (servicio y navegador) y global en PASS", tests: ["INT-CLI", "INT-PRV", "INT-GLB", "INT-CLI-E2E", "INT-PRV-E2E"] },
];
