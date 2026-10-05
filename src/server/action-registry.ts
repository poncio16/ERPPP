/**
 * Importa todas las definiciones de acciones para que queden registradas.
 * Cada módulo nuevo con acciones debe agregarse aquí (la prueba de permisos recorre este registro).
 */
import "@/modules/documents/action-defs";
import "@/modules/parties/action-defs";
import "@/modules/users/action-defs";

export { actionRegistry } from "./action";
