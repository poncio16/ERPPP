import type { Permission } from "@/modules/auth/permissions";
import type { PartyKind } from "@/modules/parties/schemas";

export interface PartyUi {
  kind: PartyKind;
  plural: string;
  singular: string;
  /** "el cliente" / "el proveedor" */
  the: string;
  basePath: string;
  perm: { read: Permission; write: Permission; deactivate: Permission; duplicate: Permission };
}

export const PARTY_UI: Record<PartyKind, PartyUi> = {
  client: {
    kind: "client",
    plural: "Clientes",
    singular: "Cliente",
    the: "el cliente",
    basePath: "/clientes",
    perm: { read: "clients.read", write: "clients.write", deactivate: "clients.deactivate", duplicate: "clients.duplicate_tax_id" },
  },
  supplier: {
    kind: "supplier",
    plural: "Proveedores",
    singular: "Proveedor",
    the: "el proveedor",
    basePath: "/proveedores",
    perm: { read: "suppliers.read", write: "suppliers.write", deactivate: "suppliers.deactivate", duplicate: "suppliers.duplicate_tax_id" },
  },
};

/** Nombres de campos para el historial de cambios. */
export const FIELD_LABELS: Record<string, string> = {
  code: "Código",
  legalName: "Razón social",
  idTypeId: "Tipo de identificación",
  taxId: "CUIT / documento",
  vatConditionId: "Condición IVA",
  address: "Domicilio",
  city: "Localidad",
  provinceId: "Provincia",
  postalCode: "Código postal",
  phone: "Teléfono",
  email: "Correo",
  contactName: "Contacto",
  paymentTermId: "Condición de pago",
  creditDays: "Días de plazo",
  creditLimit: "Límite de crédito",
  notes: "Observaciones",
  duplicateTaxIdReason: "Motivo de CUIT duplicado",
  activity: "Rubro",
  bankId: "Banco",
  cbu: "CBU",
  cbuAlias: "Alias",
  status: "Estado",
  reason: "Motivo",
  createdBy: "Creado por",
};

export const HISTORY_ACTIONS: Record<string, string> = {
  create: "Alta",
  update: "Modificación",
  deactivate: "Baja",
  reactivate: "Reactivación",
};
