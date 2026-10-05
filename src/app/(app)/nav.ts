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
    title: "Administración del sistema",
    items: [
      { href: "/admin/usuarios", label: "Usuarios", permission: "users.manage" },
      { href: "/admin/roles", label: "Roles y permisos", permission: "users.manage" },
      { href: "/admin/sesiones", label: "Sesiones activas", permission: "users.manage" },
    ],
  },
];
