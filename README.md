# ERP Administrativo-Financiero PyME

ERP web para **registrar y controlar** comprobantes emitidos y recibidos, cuentas corrientes,
cobranzas, pagos, imputaciones, caja, bancos y cheques de una PyME argentina.

> El sistema **no emite comprobantes fiscales**, no solicita CAE ni se comunica con ARCA.
> Registra comprobantes ya emitidos por sistemas externos o recibidos de proveedores.

Diseño aprobado de la Fase 1: [`docs/diseno/fase1-diseno.md`](docs/diseno/fase1-diseno.md).

## Stack

Next.js (App Router) · TypeScript strict · Tailwind CSS · PostgreSQL 16+ · Drizzle ORM · Zod · decimal.js · Vitest.

## Puesta en marcha (desarrollo)

Requisitos: Node.js 22+, PostgreSQL 16+ (local o con `docker compose up -d db`).

```bash
npm install
cp .env.example .env              # completar contraseñas; DATABASE_ADMIN_URL = superusuario
npm run db:bootstrap              # crea roles erp_owner / erp_app / erp_backup y la base
npm run db:migrate                # aplica migraciones (rol erp_owner)
npm run db:seed                   # catálogos base: IVA, comprobantes, alícuotas, bancos, roles, permisos
npm run admin:create -- admin "Nombre Apellido"   # primer administrador; muestra una contraseña temporal
npm run dev
```

Para una base de demostración o desarrollo con los datos ficticios de la sección 45 (10 clientes,
10 proveedores, 20 + 20 comprobantes, cobranzas, pagos, cheques y movimientos de tesorería):

```bash
npm run db:seed:demo              # requiere ALLOW_DEMO_SEED=true; nunca corre con NODE_ENV=production
npm run db:seed:demo -- --usuario otro_admin   # por defecto se registra a nombre de "admin"
```

Se carga solo en una base sin clientes, proveedores ni comprobantes, en una única transacción y con
las mismas acciones que la interfaz (todo queda auditado). Las fechas son relativas al día de la carga.

El primer ingreso con la contraseña temporal obliga a cambiarla. Desde **Administración del sistema**
se crean los demás usuarios, se asignan roles, se ajustan los permisos de cada rol y se cierran sesiones.
`admin:create` solo funciona mientras no exista ningún administrador activo.

## Producción

Instalación en un servidor (VPS) con Docker Compose: PostgreSQL 16, la aplicación y Caddy con HTTPS
automático, más backups programados con copia externa cifrada. Paso a paso en
[`docs/runbooks/instalacion-produccion.md`](docs/runbooks/instalacion-produccion.md); los archivos están en
`Dockerfile`, `compose.produccion.yml` y `deploy/` (Caddyfile, generador del `.env`, script de
actualización, cron de backups y montaje de la copia externa).

## Seguridad de acceso

- Contraseñas con Argon2id; nunca se guardan ni se muestran en claro (la temporal se muestra una sola vez).
- Sesiones en base de datos (la cookie lleva solo un token aleatorio; se guarda su hash). Vencen por
  inactividad (30 min) y por duración máxima (12 h); ambos valores están en `configuration`.
- Bloqueo temporal tras 5 intentos fallidos (15 min) y límite de intentos por IP.
- Cada acción verifica sesión, permiso y datos en el servidor (`executeAction`); los intentos sin
  permiso quedan en auditoría. El menú solo oculta lo que el usuario no puede usar.
- CSP con nonce por petición para los scripts (`src/proxy.ts`) y cabeceras de seguridad (`next.config.ts`).

Para recrear la base de desarrollo desde cero: `npm run db:reset-dev` (nunca en producción).

## Módulos disponibles

- **Administración del sistema** (Hito 1): usuarios, roles y permisos, sesiones activas.
- **Clientes y proveedores** (Hito 2): alta, modificación, consulta con búsqueda y filtros, baja lógica
  con motivo y reactivación, historial de cambios. Se valida la CUIT/CUIL (dígito verificador) y el CBU.
  Un segundo registro con la misma CUIT solo se admite con motivo, con el parámetro
  `allow_duplicate_tax_id` habilitado y con el permiso `*.duplicate_tax_id` (por defecto, solo Administrador).
  La baja exige saldo cero y ningún cheque en circulación.
- **Comprobantes emitidos y comprobantes recibidos** (Hito 3): registro de facturas, notas de débito y
  notas de crédito **ya emitidas** por el sistema de facturación o recibidas de proveedores. El ERP no
  emite, no numera, no solicita CAE ni se conecta con ARCA. Al registrar se valida: duplicado
  (tipo + punto de venta + número + tercero), alícuotas vigentes a la fecha, IVA calculado ± tolerancia
  (`vat_tolerance`), total de control, período IVA, período cerrado, vinculación de NC/ND y límite de
  crédito (advertencia con confirmación). Cada registro genera su movimiento en la cuenta corriente.
  Los importes no se editan: se anula el registro (queda en el historial, con reversión del movimiento)
  y se usa "Registrar corregido", que libera el número y precarga los datos. Solo vencimiento, concepto,
  descripción y referencia externa se corrigen en el lugar, con auditoría.
- **Cuentas corrientes** (Hito 4): listado por cliente y por proveedor con vencido, a vencer, saldo a favor
  y saldo, con filtros y totales; ficha con resumen (saldo, vencido, a vencer, facturado/comprado y
  cobrado/pagado del período, saldo a favor, última operación, última cobranza/pago), movimientos con saldo
  anterior y saldo progresivo, y composición del saldo por comprobante. El saldo surge del libro de
  movimientos y la pantalla avisa si no coincide con la composición (invariante G.14-1). Exportación a
  Excel con importes numéricos (`/api/cuentas-corrientes/{clientes|proveedores}/{id}/excel`, permiso
  `reports.export`, auditada) e impresión desde el navegador.
- **Caja y bancos** (Hito 5): cajas y cuentas bancarias (alta por el administrador), un saldo inicial por
  cuenta, movimientos manuales solo con conceptos habilitados (gastos bancarios, aportes, retiros, gastos
  menores, etc.), reversión de movimientos manuales, transferencias entre cuentas propias (depósito de
  efectivo, extracción, entre bancos) con anulación, y arqueo y cierre de caja con registro de la
  diferencia. Los saldos surgen de un único libro de tesorería; la caja no queda en negativo
  (`cash_allow_negative`) y un banco en negativo pide confirmación. Bancos muestra saldo contable y saldo
  disponible (descontando cheques propios pendientes de débito). Una caja cerrada no acepta movimientos
  con fecha igual o anterior al cierre, también controlado por la base (migración `0002`).
- **Cobranzas, pagos, imputaciones y cheques** (Hito 6): cobranzas a clientes y pagos a proveedores con
  varios medios (efectivo, transferencia, cheque recibido, cheque propio, endoso de cheque en cartera y
  retenciones), imputación a comprobantes pendientes con propuesta por vencimiento, y lo no imputado como
  saldo a favor o anticipo. Cada operación genera un recibo interno o una orden de pago interna numerados,
  imprimibles y en PDF (`/api/recibos/{id}/pdf`, `/api/ordenes-de-pago/{id}/pdf`), siempre con la
  leyenda "Documento interno – no válido como comprobante fiscal". Panel `/imputaciones` para aplicar
  después saldos a favor, anticipos y notas de crédito; desimputación con motivo. Anulación de cobranzas
  y pagos con motivo (revierte imputaciones, tesorería, cheques y cuenta corriente). Cheques: cartera de
  recibidos (depósito, acreditación, cobro por ventanilla, rechazo) y cheques propios (presentación,
  débito, rechazo). El rechazo de un cheque recibido genera una nota de débito interna al cliente
  (`INT_CHEQUE_RECHAZADO`, migración `0003`) y, si estaba endosado, la deuda con el proveedor.
- **Tesorería consolidada y consistencia** (Hito 7): `/tesoreria` con cajas, bancos (contable y
  disponible), cartera, depositados a acreditar y cheques propios pendientes; ingresos y egresos por
  concepto en un período (las anulaciones se restan del concepto original) e ingresos/egresos proyectados
  (permiso `treasury.plan`) para el flujo de fondos. Devoluciones de saldo a favor (D14): desde
  `/imputaciones`, consumen el crédito con un débito interno `INT_DEVOLUCION` y mueven caja o banco; se
  listan y anulan en `/devoluciones`. `/admin/consistencia` (permiso `consistency.run`) recalcula los
  invariantes G.14 y muestra PASS/FAIL con los casos que no cumplen; cada ejecución queda auditada.
- **Reportes, dashboard y flujo de fondos** (Hito 8): `/reportes` (permiso `reports.read` más el
  permiso de lectura del módulo de origen) con 22 reportes: comprobantes, cobranzas/pagos, deuda,
  vencimientos, antigüedad de saldos (tramos 0–30 a >180, vencido y a vencer por separado, fecha de
  corte elegible y créditos sin aplicar en columna aparte), cuenta corriente y retenciones de clientes y
  proveedores; libro de caja y de banco, cartera de cheques, cheques emitidos, ingresos y egresos por
  concepto y flujo de fondos (semanal o mensual, real vs. proyectado, columna "Atrasado", planificados
  con recurrencia mensual); subdiario de IVA ventas y compras (control interno, no es el Libro IVA
  Digital). Todos se exportan a Excel (números reales) y PDF desde `/api/reportes/{reporte}/{excel|pdf}`
  con los mismos filtros de la URL (permiso `reports.export`, auditado). La antigüedad a una fecha
  pasada se reconstruye desde el libro de cuenta corriente y las imputaciones vigentes a esa fecha, por
  lo que su total siempre coincide con el saldo de cuenta corriente a esa fecha. El inicio (`/`) muestra
  el dashboard (permiso `dashboard.read`) con indicadores calculados por las mismas funciones de los
  reportes que enlazan y gráficos de evolución y de flujo con Recharts. La verificación de consistencia
  suma el invariante G.14-8 (totales de reportes = módulos de origen).
- **Auditoría y backups** (Hito 9): `/admin/auditoria` (permiso `audit.read`) con filtros por fecha,
  usuario, módulo, acción, resultado, registro y texto, detalle de cada registro con los valores
  anteriores y nuevos campo por campo, y "Verificar integridad", que recorre la cadena de hashes, señala el
  primer registro alterado y compara el último hash guardado con cada backup (detecta una reescritura de la
  cadena). `/admin/backups` (permiso `backup.run`) lista los backups con fecha, tamaño, SHA-256, versiones,
  estado, copias local y externa y verificación, y permite un backup manual. Backups con `pg_dump` (rol
  `erp_backup`) tomados en la misma instantánea que sus totales de control, copia externa cifrada con age,
  retención 7/4/12, verificación (`npm run db:backup:verify`) que restaura en `erp_verify` y compara totales
  e invariantes, y restauración por consola (`npm run db:restore`) con modo mantenimiento, backup previo,
  verificación antes de intercambiar las bases y la base anterior conservada. `npm run db:migrate` hace un
  backup previo si hay migraciones pendientes. El dashboard avisa al administrador si el último backup
  falló, si no hay uno reciente o si no hay una verificación en PASS en 8 días. Procedimientos en
  `docs/runbooks/backup-y-restauracion.md`; cron de ejemplo en `deploy/cron/erp-backup`. Migración `0004`
  (copia externa y retención en `backup_runs`, datos de un backup terminado inmodificables, lectura de la
  tabla de migraciones para `erp_backup`).

## Pruebas

```bash
npm test                  # crea la base erp_test desde cero, aplica migraciones y corre todas las pruebas
npm run typecheck
npm run lint
npm run build && npm run test:e2e     # pruebas en el navegador (Playwright) contra la app compilada
npm run build && npm run test:acceptance   # todo lo anterior y genera tests/acceptance/matriz.md
```

- `tests/db/` intenta violar cada regla financiera escribiendo directamente en la base con el rol de la
  aplicación; todas deben ser rechazadas por PostgreSQL (última barrera de defensa).
- `tests/integration/global.test.ts` (INT-GLB, §47) arma en una base nueva un escenario con 3 clientes y
  3 proveedores y compara comprobantes, cuentas corrientes, imputaciones, caja, bancos, cheques,
  tesorería, reportes y dashboard contra valores calculados a mano en
  `tests/acceptance/fixtures/global-expected.ts`, con todos los invariantes de G.14 en $0.
- `tests/integration/properties.test.ts` (PROP-01) genera secuencias aleatorias de comprobantes, NC, ND,
  cobranzas, pagos, imputaciones y anulaciones (fast-check) y comprueba que nunca quedan saldos
  negativos, sobreimputaciones ni invariantes distintos de $0. Otra semilla: `PROP_SEED=123 npm test`.
- `e2e/` (Playwright) recorre en el navegador las pruebas integrales de cliente y proveedor de §47, con
  descarga del recibo y de la orden de pago, y revisa las pantallas principales. Usa su propia base
  (`erp_e2e`) y el puerto 3200; con un Chromium propio, `E2E_CHROMIUM_PATH=/ruta/al/chrome`.
- La matriz de aceptación (`tests/acceptance/matriz.md`, §48) **se genera** cruzando
  `tests/acceptance/criterios.ts` con el reporte de la ejecución: un criterio solo figura en PASS si
  todas sus pruebas corrieron y pasaron; sin el navegador (`--sin-navegador`) esos criterios quedan
  BLOQUEADO.

## Base de datos

- Roles: `erp_owner` (dueño del esquema, solo migraciones), `erp_app` (aplicación: sin `DELETE` en
  tablas financieras, solo `INSERT/SELECT` en auditoría, sin DDL), `erp_backup` (solo lectura).
- `database/migrations/0000_*`: esquema generado por drizzle-kit desde `src/server/db/schema/`.
- `database/migrations/0001_integrity.sql`: triggers de inmutabilidad y borrado prohibido, restricciones
  diferidas de consistencia (totales y saldos), máquinas de estado de cheques, cadena de hashes de
  auditoría, vistas y permisos.
- Importes en `NUMERIC(18,2)`; fechas de negocio en `DATE`; zona `America/Argentina/Buenos_Aires`.

## Estructura

```
src/app/                 rutas Next.js (UI)
src/modules/<módulo>/    acciones, servicio, repositorio, esquemas y componentes por dominio
src/server/db/           cliente y esquema Drizzle
database/                migraciones y seeds
scripts/                 bootstrap, migraciones, seeds, backup, matriz de aceptación
tests/                   pruebas unitarias, de base de datos, de integración y catálogo de aceptación
e2e/                     pruebas en el navegador (Playwright)
docs/                    diseño y runbooks (backup y restauración, instalación en producción)
deploy/                  producción: Caddyfile, .env de ejemplo, actualización, cron y montaje externo
```
