/**
 * Importa todas las definiciones de acciones para que queden registradas.
 * Cada módulo nuevo con acciones debe agregarse aquí (la prueba de permisos recorre este registro).
 */
import "@/modules/allocations/action-defs";
import "@/modules/audit/action-defs";
import "@/modules/backup/action-defs";
import "@/modules/checks/action-defs";
import "@/modules/collections/action-defs";
import "@/modules/consistency/action-defs";
import "@/modules/documents/action-defs";
import "@/modules/parties/action-defs";
import "@/modules/payments/action-defs";
import "@/modules/refunds/action-defs";
import "@/modules/treasury/action-defs";
import "@/modules/users/action-defs";

export { actionRegistry } from "./action";
