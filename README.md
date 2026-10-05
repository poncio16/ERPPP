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

El primer ingreso con la contraseña temporal obliga a cambiarla. Desde **Administración del sistema**
se crean los demás usuarios, se asignan roles, se ajustan los permisos de cada rol y se cierran sesiones.
`admin:create` solo funciona mientras no exista ningún administrador activo.

## Seguridad de acceso

- Contraseñas con Argon2id; nunca se guardan ni se muestran en claro (la temporal se muestra una sola vez).
- Sesiones en base de datos (la cookie lleva solo un token aleatorio; se guarda su hash). Vencen por
  inactividad (30 min) y por duración máxima (12 h); ambos valores están en `configuration`.
- Bloqueo temporal tras 5 intentos fallidos (15 min) y límite de intentos por IP.
- Cada acción verifica sesión, permiso y datos en el servidor (`executeAction`); los intentos sin
  permiso quedan en auditoría. El menú solo oculta lo que el usuario no puede usar.
- CSP con nonce por petición (`src/proxy.ts`) y cabeceras de seguridad (`next.config.ts`).

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

## Pruebas

```bash
npm test            # crea la base erp_test desde cero, aplica migraciones y corre todas las pruebas
npm run typecheck
npm run lint
```

Las pruebas de `tests/db/` intentan violar cada regla financiera escribiendo directamente en la base
con el rol de la aplicación; todas deben ser rechazadas por PostgreSQL (última barrera de defensa).

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
scripts/                 bootstrap, migraciones, seeds, backup
tests/                   pruebas de base de datos, integración y aceptación
docs/                    diseño y runbooks
```
