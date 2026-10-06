# Matriz de aceptación — Fase 1

> Archivo generado por `npm run test:acceptance` a partir de la ejecución real de las pruebas. No se edita a mano:
> un criterio figura en PASS solo si todas las pruebas que lo verifican se ejecutaron y pasaron (§48, K.3).

- Generada: 6/10/26, 13:44:57 (hora argentina)
- Código: hito-10-pruebas-integrales @ d310a8f (con cambios sin confirmar)
- Entorno: Node 22.22.0, PostgreSQL 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
- Pruebas ejecutadas: 468 (468 PASS, 0 FAIL, 0 omitidas). Navegador: ejecutado (Playwright, Chromium)
- Criterios: 46 (46 PASS, 0 FAIL, 0 BLOQUEADO)

## Criterios de aceptación (§46)

| ID | Módulo | Criterio | Resultado esperado | Resultado obtenido | Estado |
| -- | ------ | -------- | ------------------ | ------------------ | ------ |
| AC-CLI-01 | Clientes | Crear cliente | Se crea con código automático, CUIT validada y auditoría | CLI-01 PASS, CLI-01b PASS, CLI-01c PASS | **PASS** |
| AC-CLI-02 | Clientes | Modificar cliente | Guarda valores anteriores y nuevos; control de edición concurrente | CLI-02 PASS | **PASS** |
| AC-CLI-03 | Clientes | Detectar CUIT duplicado | Avisa y bloquea; la base impide el duplicado aunque se saltee el servicio | CLI-03 PASS, CLI-03b PASS | **PASS** |
| AC-CLI-04 | Clientes | Dar de baja lógicamente | Queda inactivo, no se borra, se puede reactivar; con saldo no se permite | CLI-04 PASS | **PASS** |
| AC-CLI-05 | Clientes | Mantener historial | Alta, modificación, baja y reactivación quedan registradas | CLI-05 PASS | **PASS** |
| AC-PRV-01 | Proveedores | Crear proveedor | Se crea con datos bancarios y auditoría | PRV-01 PASS | **PASS** |
| AC-PRV-02 | Proveedores | Modificar proveedor | Guarda valores anteriores y nuevos | PRV-02 PASS | **PASS** |
| AC-PRV-03 | Proveedores | Detectar CUIT duplicado | Avisa y bloquea el proveedor duplicado | PRV-03 PASS | **PASS** |
| AC-PRV-04 | Proveedores | Impedir eliminación incorrecta | Sin borrado físico; baja bloqueada con saldo o cheques en circulación | PRV-04 PASS, DB-07 5/5 | **PASS** |
| AC-CMP-01 | Comprobantes | Registrar neto $100.000 + IVA 21% $21.000 = total $121.000 | Se registra, genera saldo $121.000 y movimiento en cuenta corriente | CMP-01 PASS, CMP-IVA-02 PASS, DB-01 6/6 | **PASS** |
| AC-CMP-02 | Comprobantes | No permitir duplicados | Mismo tipo + punto de venta + número (y proveedor) se rechaza; doble envío registra uno solo | CMP-02 PASS, CMP-08 PASS, CMP-13 PASS, DB-02 3/3 | **PASS** |
| AC-CC-01 | Cuentas corrientes | Comprobante $100.000 y cobranza $40.000 | Saldo = $60.000 | CC-01 PASS | **PASS** |
| AC-IMP-01 | Imputaciones | Comprobantes $100.000 y $50.000, cobranza $120.000 | Comprobante 1: $100.000; comprobante 2: $20.000; saldo disponible $0 | IMP-01 PASS | **PASS** |
| AC-IMP-02 | Imputaciones | Rechazar imputación superior al pago | Se rechaza y no se registra nada | IMP-02 PASS, DB-04 6/6 | **PASS** |
| AC-IMP-03 | Imputaciones | Rechazar imputación superior al saldo del comprobante | Se rechaza, también con dos imputaciones simultáneas | IMP-02 PASS, IMP-07 PASS, DB-04 6/6 | **PASS** |
| AC-CAJ-01 | Caja | Saldo inicial $500.000, ingreso $100.000, egreso $150.000 | $600.000 y luego $450.000 | CAJ-01 PASS | **PASS** |
| AC-BCO-01 | Bancos | Transferencia recibida +$100.000 y pago por transferencia −$100.000 | Saldo bancario +$100.000 y luego −$100.000 | BCO-01 PASS | **PASS** |
| AC-BCO-02 | Bancos | No generar doble impacto | Un solo movimiento por operación, aun con doble envío | BCO-01 PASS, COB-04 PASS, CAJ-03 PASS, DB-05 6/6 | **PASS** |
| AC-CHQ-01 | Cheques | Cheque recibido | Aumenta la cartera y no aumenta el banco | CHQ-01 PASS | **PASS** |
| AC-CHQ-02 | Cheques | Cheque depositado | Disminuye la cartera y cambia de estado | CHQ-02 PASS | **PASS** |
| AC-CHQ-03 | Cheques | Cheque rechazado | Mantiene historial y revierte el efecto financiero (banco y deuda del cliente) | CHQ-03 PASS, CHQ-04 PASS, CHQ-06 PASS, CHQ-08 PASS | **PASS** |
| AC-AUD-01 | Auditoría | Toda modificación financiera registra usuario, fecha, operación, valor anterior y nuevo | Registro completo e inalterable | AUD-01 PASS, AUD-04 PASS, AUD-06 PASS | **PASS** |
| AC-BKP-01 | Backup | Crear backup | Archivo con SHA-256, versiones, totales de control y copia cifrada | BKP-01 PASS, BKP-02 PASS | **PASS** |
| AC-BKP-02 | Backup | Restaurarlo y comprobar que los datos coinciden | Totales de control idénticos a los del backup | BKP-03 PASS, BKP-05 PASS | **PASS** |

## Pruebas integrales (§47)

| ID | Módulo | Criterio | Resultado esperado | Resultado obtenido | Estado |
| -- | ------ | -------- | ------------------ | ------------------ | ------ |
| AC-INT-CLI | Integral | Cliente: comprobante $500.000, cobranzas $200.000 y $300.000 imputadas, recibo, caja/banco y auditoría | Saldo $300.000 y luego $0; recibos generados; caja y banco impactados; operaciones auditadas | INT-CLI PASS, INT-CLI-E2E PASS | **PASS** |
| AC-INT-PRV | Integral | Proveedor: comprobante $500.000, pagos $200.000 y $300.000 imputados, orden de pago, caja/banco y auditoría | Saldo $300.000 y luego $0; órdenes de pago generadas; caja y banco impactados; operaciones auditadas | INT-PRV PASS, INT-PRV-E2E PASS | **PASS** |
| AC-INT-GLB | Integral | Prueba global: 3 clientes, 3 proveedores, comprobantes, NC, ND, cobranzas y pagos completos y parciales, efectivo, transferencias, cheques, vencidos | Comprobantes, cuentas corrientes, imputaciones, caja, bancos, cheques, tesorería y reportes coinciden con lo calculado a mano; invariantes en $0 | INT-GLB 7/7 | **PASS** |

## Datos de prueba (§45)

| ID | Módulo | Criterio | Resultado esperado | Resultado obtenido | Estado |
| -- | ------ | -------- | ------------------ | ------------------ | ------ |
| AC-DAT-01 | Datos de prueba | 10 clientes, 10 proveedores, 20 + 20 comprobantes con todos los casos de §45 | Se cargan con las acciones reales, bloqueados en producción, y con ellos cierran cuentas, caja, bancos, cheques, tesorería y reportes | DAT-01 PASS, DAT-02 PASS, DAT-03 PASS, DAT-04 PASS, DAT-05 PASS | **PASS** |

## Propiedades y concurrencia (K.1)

| ID | Módulo | Criterio | Resultado esperado | Resultado obtenido | Estado |
| -- | ------ | -------- | ------------------ | ------------------ | ------ |
| AC-PROP-01 | Propiedades | Secuencias aleatorias de comprobantes, cobranzas, pagos, imputaciones y anulaciones | Ningún saldo negativo, ninguna sobreimputación, invariantes de G.14 en $0 | PROP-01 PASS | **PASS** |
| AC-CONC-01 | Concurrencia | Operaciones simultáneas | Números de recibo distintos y consecutivos; imputaciones simultáneas sin sobreimputar; doble envío sin doble registro | COB-05 PASS, IMP-07 PASS, DB-09 PASS, COB-04 PASS, CMP-08 PASS | **PASS** |

## Condición para terminar la Fase 1 (§49)

| ID | Módulo | Criterio | Resultado esperado | Resultado obtenido | Estado |
| -- | ------ | -------- | ------------------ | ------------------ | ------ |
| AC-FIN-01 | Fase 1 | Todas las pruebas críticas en PASS | Ninguna prueba falla ni queda sin ejecutar | 468 de 468 pruebas en PASS | **PASS** |
| AC-FIN-02 | Fase 1 | No existen errores financieros | Invariantes de G.14 en $0 en todos los escenarios | INT-GLB 7/7, PROP-01 PASS, CON-01 PASS, DAT-04 PASS | **PASS** |
| AC-FIN-03 | Fase 1 | No existen duplicaciones | Duplicados e idempotencia controlados en servicio y base | CLI-03 PASS, CMP-02 PASS, CMP-08 PASS, COB-04 PASS, CAJ-03 PASS, DB-02 3/3, DB-05 6/6 | **PASS** |
| AC-FIN-04 | Fase 1 | No existen sobreimputaciones | Imputado ≤ crédito y ≤ saldo del comprobante | IMP-02 PASS, IMP-03 PASS, IMP-07 PASS, DB-04 6/6, PROP-01 PASS | **PASS** |
| AC-FIN-05 | Fase 1 | Cuentas por cobrar consistentes | Saldos, vencidos y saldos a favor iguales en cuenta corriente, composición y reportes | CC-01 PASS, CC-02 PASS, CC-03 PASS, CC-04 PASS, CC-05 PASS, CC-07 PASS, REP-01 PASS, INT-GLB 7/7 | **PASS** |
| AC-FIN-06 | Fase 1 | Cuentas por pagar consistentes | Saldos de proveedores iguales en cuenta corriente y reportes | CC-06 PASS, REP-03 PASS, PAG-03 PASS, INT-GLB 7/7 | **PASS** |
| AC-FIN-07 | Fase 1 | Caja consistente | Saldo = movimientos; sin negativos; arqueo cuadra | CAJ-01 PASS, CAJ-02 PASS, CAJ-04 PASS, CAJ-06 PASS, CAJ-07 PASS, CAJ-08 PASS, INT-GLB 7/7 | **PASS** |
| AC-FIN-08 | Fase 1 | Bancos consistentes | Saldo contable y disponible correctos; transferencias internas balanceadas | BCO-01 PASS, BCO-03 PASS, BCO-04 PASS, BCO-05 PASS, INT-GLB 7/7 | **PASS** |
| AC-FIN-09 | Fase 1 | Cheques consistentes | Estados, cartera e impactos en banco y cuentas correctos | CHQ-01 PASS, CHQ-02 PASS, CHQ-03 PASS, CHQ-05 PASS, CHQ-06 PASS, CHQ-07 PASS, CHQ-08 PASS, DB-06 4/4, INT-GLB 7/7 | **PASS** |
| AC-FIN-10 | Fase 1 | Existe trazabilidad | Cada operación queda auditada y nada se borra: se anula o revierte | AUD-01 PASS, AUD-02 PASS, CLI-05 PASS, CMP-07 PASS, CAJ-06 PASS, COB-07 PASS | **PASS** |
| AC-FIN-11 | Fase 1 | Funcionan los permisos | Matriz acción × rol aplicada en el backend; rechazos auditados | PERM-01 213/213, PERM-02 2/2, AUTH-04 5/5, CMP-16 PASS, COB-09 PASS, CHQ-10 PASS | **PASS** |
| AC-FIN-12 | Fase 1 | Funciona la auditoría | Registro, consulta, inviolabilidad y verificación de la cadena | AUD-01 PASS, AUD-02 PASS, AUD-03 PASS, AUD-04 PASS, AUD-05 PASS, AUD-07 PASS, DB-08 2/2 | **PASS** |
| AC-FIN-13 | Fase 1 | Funciona el backup | Backup verificable, cifrado fuera del servidor, retención y alertas | BKP-01 PASS, BKP-02 PASS, BKP-08 PASS, BKP-09 4/4, BKP-10 2/2, BKP-11 PASS, BKP-12 PASS, BKP-13 PASS | **PASS** |
| AC-FIN-14 | Fase 1 | Funciona la restauración | Restaura y verifica; si no verifica no toca la base actual | BKP-03 PASS, BKP-04 PASS, BKP-05 PASS, BKP-06 PASS, BKP-07 PASS | **PASS** |
| AC-FIN-15 | Fase 1 | Los reportes coinciden con los datos | Totales de reportes = módulos de origen (G.14-8) | REP-06 PASS, REP-10 PASS, REP-11 PASS, REP-12 PASS, INT-GLB 7/7, DAT-04 PASS | **PASS** |
| AC-FIN-16 | Fase 1 | Se ejecutaron las pruebas integrales | Cliente, proveedor (servicio y navegador) y global en PASS | INT-CLI PASS, INT-PRV PASS, INT-GLB 7/7, INT-CLI-E2E PASS, INT-PRV-E2E PASS | **PASS** |

## Fallas

No hay criterios en FAIL en esta ejecución.

## Anexo: todas las pruebas por ID

| ID | Archivo | Pruebas | PASS | FAIL | Omitidas |
| -- | ------- | ------- | ---- | ---- | -------- |
| (sin ID) | tests/unit/number-to-words.test.ts | 21 | 21 | 0 | 0 |
| (sin ID) | tests/unit/tax-calc.test.ts | 1 | 1 | 0 | 0 |
| (sin ID) | tests/unit/validators.test.ts | 15 | 15 | 0 | 0 |
| ACC-01 | tests/unit/acceptance-matrix.test.ts | 1 | 1 | 0 | 0 |
| ACC-02 | tests/unit/acceptance-matrix.test.ts | 1 | 1 | 0 | 0 |
| ACC-03 | tests/unit/acceptance-matrix.test.ts | 1 | 1 | 0 | 0 |
| ACC-04 | tests/unit/acceptance-matrix.test.ts | 1 | 1 | 0 | 0 |
| AUD-01 | tests/integration/audit.test.ts | 1 | 1 | 0 | 0 |
| AUD-02 | tests/integration/audit.test.ts | 1 | 1 | 0 | 0 |
| AUD-03 | tests/integration/audit.test.ts | 1 | 1 | 0 | 0 |
| AUD-04 | tests/integration/audit.test.ts | 1 | 1 | 0 | 0 |
| AUD-05 | tests/integration/audit.test.ts | 1 | 1 | 0 | 0 |
| AUD-06 | tests/integration/audit.test.ts | 1 | 1 | 0 | 0 |
| AUD-07 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| AUTH-01 | tests/integration/auth.test.ts | 5 | 5 | 0 | 0 |
| AUTH-02 | tests/integration/auth.test.ts | 6 | 6 | 0 | 0 |
| AUTH-03 | tests/integration/auth.test.ts | 1 | 1 | 0 | 0 |
| AUTH-04 | tests/integration/auth.test.ts | 5 | 5 | 0 | 0 |
| BCO-01 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| BCO-02 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| BCO-03 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| BCO-04 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| BCO-05 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| BCO-06 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| BKP-01 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-02 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-03 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-04 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-05 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-06 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-07 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-08 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-09 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-09 | tests/unit/backup-retention.test.ts | 3 | 3 | 0 | 0 |
| BKP-10 | tests/unit/backup-retention.test.ts | 2 | 2 | 0 | 0 |
| BKP-11 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-12 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| BKP-13 | tests/integration/backup.test.ts | 1 | 1 | 0 | 0 |
| CAJ-01 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CAJ-02 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CAJ-03 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CAJ-04 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CAJ-05 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CAJ-06 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CAJ-07 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CAJ-08 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CAJ-09 | tests/integration/treasury.test.ts | 1 | 1 | 0 | 0 |
| CC-01 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CC-02 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CC-03 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CC-04 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CC-05 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CC-06 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CC-07 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CC-08 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CC-09 | tests/integration/accounts.test.ts | 1 | 1 | 0 | 0 |
| CHQ-01 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-02 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-03 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-04 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-05 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-06 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-07 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-08 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-09 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CHQ-10 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| CLI-01b | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CLI-01c | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CLI-01 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CLI-02 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CLI-03b | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CLI-03 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CLI-04 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CLI-05 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CLI-06 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| CMP-01 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-02 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-03 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-04 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-05 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-06 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-07 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-08 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-09 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-10 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-11 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-12 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-13 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-14 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-15 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-16 | tests/integration/documents.test.ts | 1 | 1 | 0 | 0 |
| CMP-IVA-01 | tests/unit/tax-calc.test.ts | 1 | 1 | 0 | 0 |
| CMP-IVA-02 | tests/unit/tax-calc.test.ts | 1 | 1 | 0 | 0 |
| CMP-IVA-03 | tests/unit/tax-calc.test.ts | 1 | 1 | 0 | 0 |
| CMP-IVA-04 | tests/unit/tax-calc.test.ts | 1 | 1 | 0 | 0 |
| CMP-IVA-05 | tests/unit/tax-calc.test.ts | 1 | 1 | 0 | 0 |
| COB-01 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| COB-02 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| COB-03 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| COB-04 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| COB-05 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| COB-06 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| COB-07 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| COB-08 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| COB-09 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| CON-01 | tests/integration/consistency.test.ts | 1 | 1 | 0 | 0 |
| CON-02 | tests/integration/consistency.test.ts | 1 | 1 | 0 | 0 |
| CON-03 | tests/integration/consistency.test.ts | 1 | 1 | 0 | 0 |
| CON-04 | tests/integration/consistency.test.ts | 1 | 1 | 0 | 0 |
| DAT-01 | tests/integration/demo-data.test.ts | 1 | 1 | 0 | 0 |
| DAT-02 | tests/integration/demo-data.test.ts | 1 | 1 | 0 | 0 |
| DAT-03 | tests/integration/demo-data.test.ts | 1 | 1 | 0 | 0 |
| DAT-04 | tests/integration/demo-data.test.ts | 1 | 1 | 0 | 0 |
| DAT-05 | tests/integration/demo-data.test.ts | 1 | 1 | 0 | 0 |
| DB-01 | tests/db/constraints.test.ts | 6 | 6 | 0 | 0 |
| DB-02 | tests/db/constraints.test.ts | 3 | 3 | 0 | 0 |
| DB-03 | tests/db/constraints.test.ts | 5 | 5 | 0 | 0 |
| DB-04 | tests/db/constraints.test.ts | 6 | 6 | 0 | 0 |
| DB-05 | tests/db/constraints.test.ts | 6 | 6 | 0 | 0 |
| DB-06 | tests/db/constraints.test.ts | 4 | 4 | 0 | 0 |
| DB-07 | tests/db/constraints.test.ts | 5 | 5 | 0 | 0 |
| DB-08 | tests/db/constraints.test.ts | 2 | 2 | 0 | 0 |
| DB-09 | tests/db/constraints.test.ts | 1 | 1 | 0 | 0 |
| DB-10 | tests/db/constraints.test.ts | 2 | 2 | 0 | 0 |
| DEV-01 | tests/integration/refunds.test.ts | 1 | 1 | 0 | 0 |
| DEV-02 | tests/integration/refunds.test.ts | 1 | 1 | 0 | 0 |
| DEV-03 | tests/integration/refunds.test.ts | 1 | 1 | 0 | 0 |
| DEV-04 | tests/integration/refunds.test.ts | 1 | 1 | 0 | 0 |
| DEV-05 | tests/integration/refunds.test.ts | 1 | 1 | 0 | 0 |
| DEV-06 | tests/integration/refunds.test.ts | 1 | 1 | 0 | 0 |
| DEV-07 | tests/integration/refunds.test.ts | 1 | 1 | 0 | 0 |
| IMP-01 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| IMP-02 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| IMP-03 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| IMP-04 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| IMP-05 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| IMP-06 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| IMP-07 | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| INT-CLI-E2E | e2e/integral.e2e.ts | 1 | 1 | 0 | 0 |
| INT-CLI | tests/integration/collections.test.ts | 1 | 1 | 0 | 0 |
| INT-GLB | tests/integration/global.test.ts | 7 | 7 | 0 | 0 |
| INT-PRV-E2E | e2e/integral.e2e.ts | 1 | 1 | 0 | 0 |
| INT-PRV | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| PAG-01 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| PAG-02 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| PAG-03 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| PAG-04 | tests/integration/payments-checks.test.ts | 1 | 1 | 0 | 0 |
| PERM-01 | tests/integration/permissions-matrix.test.ts | 213 | 213 | 0 | 0 |
| PERM-02 | tests/integration/permissions-matrix.test.ts | 2 | 2 | 0 | 0 |
| PROP-01 | tests/integration/properties.test.ts | 1 | 1 | 0 | 0 |
| PRV-01 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| PRV-02 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| PRV-03 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| PRV-04 | tests/integration/parties.test.ts | 1 | 1 | 0 | 0 |
| REP-01 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-02 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-03 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-04 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-05 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-06 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-07 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-08 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-09 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-10 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-11 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| REP-12 | tests/integration/reports.test.ts | 1 | 1 | 0 | 0 |
| TES-01 | tests/integration/consistency.test.ts | 1 | 1 | 0 | 0 |
| TES-02 | tests/integration/consistency.test.ts | 1 | 1 | 0 | 0 |
| TES-03 | tests/integration/consistency.test.ts | 1 | 1 | 0 | 0 |
