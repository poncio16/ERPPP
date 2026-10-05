import type { Permission } from "@/modules/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  permission?: Permission;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Menú principal. Cada módulo se agrega al completarse su hito. */
export const NAV: NavSection[] = [
  { title: "General", items: [{ href: "/", label: "Inicio" }] },
  {
    title: "Maestros",
    items: [
      { href: "/clientes", label: "Clientes", permission: "clients.read" },
      { href: "/proveedores", label: "Proveedores", permission: "suppliers.read" },
    ],
  },
  {
    title: "Comprobantes",
    items: [
      { href: "/comprobantes-emitidos", label: "Comprobantes emitidos", permission: "documents.read" },
      { href: "/comprobantes-recibidos", label: "Comprobantes recibidos", permission: "documents.read" },
    ],
  },
  {
    title: "Cuentas corrientes",
    items: [
      { href: "/cuentas-corrientes/clientes", label: "Clientes", permission: "accounts.read" },
      { href: "/cuentas-corrientes/proveedores", label: "Proveedores", permission: "accounts.read" },
    ],
  },
  {
    title: "Tesorería",
    items: [
      { href: "/caja", label: "Caja", permission: "cash.read" },
      { href: "/bancos", label: "Bancos", permission: "banks.read" },
      { href: "/transferencias", label: "Transferencias internas", permission: "banks.read" },
    ],
  },
  {
    title: "Administración del sistema",
    items: [
      { href: "/admin/usuarios", label: "Usuarios", permission: "users.manage" },
      { href: "/admin/roles", label: "Roles y permisos", permission: "users.manage" },
      { href: "/admin/sesiones", label: "Sesiones activas", permission: "users.manage" },
    ],
  },
];
