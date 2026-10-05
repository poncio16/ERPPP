import type { Permission } from "@/modules/auth/permissions";

/** Datos de la petición que se registran en auditoría. */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId: string;
}

/** Contexto con el que se invoca a todo servicio de negocio. */
export interface ServiceContext extends RequestMeta {
  userId: number;
  username: string;
  sessionId?: number | null;
  permissions: ReadonlySet<Permission>;
}
