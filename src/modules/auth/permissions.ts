/**
 * Catálogo de permisos (fuente única de verdad para el seed y para requirePermission).
 * La asignación por rol es la propuesta aprobada (decisión D17) y el administrador puede ajustarla.
 */
export const PERMISSIONS = {
  "clients.read": "Consultar clientes",
  "clients.write": "Crear y modificar clientes",
  "clients.deactivate": "Dar de baja y reactivar clientes",
  "clients.duplicate_tax_id": "Registrar un cliente con CUIT ya existente (con motivo)",
  "suppliers.read": "Consultar proveedores",
  "suppliers.write": "Crear y modificar proveedores",
  "suppliers.deactivate": "Dar de baja y reactivar proveedores",
  "suppliers.duplicate_tax_id": "Registrar un proveedor con CUIT ya existente (con motivo)",
  "documents.read": "Consultar comprobantes emitidos y recibidos",
  "documents.create": "Registrar comprobantes emitidos y recibidos",
  "documents.edit": "Corregir comprobantes registrados",
  "documents.annul": "Anular el registro de comprobantes",
  "accounts.read": "Consultar cuentas corrientes",
  "collections.read": "Consultar cobranzas",
  "collections.create": "Registrar cobranzas",
  "collections.annul": "Anular cobranzas",
  "payments.read": "Consultar pagos",
  "payments.create": "Registrar pagos",
  "payments.annul": "Anular pagos",
  "allocations.create": "Imputar cobranzas, pagos y notas de crédito",
  "allocations.reverse": "Desimputar",
  "refunds.create": "Registrar devoluciones de saldo a favor",
  "refunds.annul": "Anular devoluciones de saldo a favor",
  "cash.read": "Consultar caja",
  "cash.manual_movement": "Registrar movimientos manuales de caja",
  "cash.close": "Arqueo y cierre de caja",
  "banks.read": "Consultar bancos",
  "banks.manual_movement": "Registrar movimientos bancarios manuales",
  "banks.transfer": "Transferencias entre cuentas propias",
  "checks.read": "Consultar cheques",
  "checks.operate": "Depositar, acreditar, rechazar y debitar cheques",
  "treasury.read": "Consultar tesorería y flujo de fondos",
  "treasury.plan": "Cargar ingresos y egresos proyectados",
  "treasury.opening": "Registrar saldos iniciales de caja y bancos",
  "reports.read": "Consultar reportes",
  "reports.export": "Exportar reportes a Excel y PDF",
  "dashboard.read": "Ver el dashboard",
  "users.manage": "Administrar usuarios, roles y permisos",
  "config.manage": "Modificar la configuración",
  "audit.read": "Consultar la auditoría",
  "backup.run": "Ejecutar y verificar backups",
  "consistency.run": "Ejecutar la verificación de consistencia",
  "opening.import": "Importar saldos iniciales",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLES = {
  ADMIN: "Administrador",
  ADMINISTRACION: "Administración",
  TESORERIA: "Tesorería",
  CONSULTA: "Consulta",
} as const;
export type RoleCode = keyof typeof ROLES;

const READS = ALL_PERMISSIONS.filter((p) => p.endsWith(".read") && !["audit.read"].includes(p));

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  ADMINISTRACION: [
    ...READS,
    "clients.write",
    "clients.deactivate",
    "suppliers.write",
    "suppliers.deactivate",
    "documents.create",
    "documents.edit",
    "documents.annul",
    "collections.create",
    "collections.annul",
    "payments.create",
    "payments.annul",
    "allocations.create",
    "allocations.reverse",
    "refunds.create",
    "refunds.annul",
    "reports.export",
  ],
  TESORERIA: [
    ...READS,
    "collections.create",
    "payments.create",
    "allocations.create",
    "refunds.create",
    "cash.manual_movement",
    "cash.close",
    "banks.manual_movement",
    "banks.transfer",
    "checks.operate",
    "treasury.plan",
    "reports.export",
  ],
  CONSULTA: [...READS, "reports.export"],
};
