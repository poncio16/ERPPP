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
npm run dev
```

Para recrear la base de desarrollo desde cero: `npm run db:reset-dev` (nunca en producción).

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
