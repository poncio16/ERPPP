@AGENTS.md

# ERP PyME — reglas del proyecto

- Diseño aprobado: `docs/diseno/fase1-diseno.md` (decisiones D1–D18 tomadas con la recomendación). No cambiar reglas de negocio sin aprobación explícita.
- El ERP **no emite** comprobantes fiscales ni se integra con ARCA en Fase 1. No crear nada que lo aparente.
- Capas: UI → Actions/Route Handlers (sesión + permiso + Zod) → servicios (sin `next/*`) → repositorios (Drizzle, reciben `tx`) → PostgreSQL.
- Dinero: `NUMERIC(18,2)` en BD y `decimal.js` en TypeScript. Nunca `number` para importes.
- Toda operación financiera en una transacción, con idempotencia y bloqueo de filas en orden de id.
- Nada financiero se borra ni se edita: anulación o reversión. Los triggers de `0001_integrity.sql` lo hacen cumplir.
- UI y mensajes en español (Argentina); código e identificadores en inglés.
- Antes de cerrar un cambio: `npm run typecheck`, `npm run lint`, `npm test`.
