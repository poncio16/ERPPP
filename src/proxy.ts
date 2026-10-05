import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-erp_session" : "erp_session";
const PUBLIC_PATHS = new Set(["/login"]);

function contentSecurityPolicy(nonce: string, isDev: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // En desarrollo el overlay de errores de Next inyecta estilos en línea.
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Proxy: genera el nonce de la CSP por petición y redirige al login cuando no hay cookie de sesión.
 * Es solo un filtro optimista: la sesión y los permisos se validan siempre en el servidor
 * (páginas con requireUser/requirePagePermission y acciones con executeAction).
 */
export function proxy(request: NextRequest) {
  if (!PUBLIC_PATHS.has(request.nextUrl.pathname) && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  if (!requestHeaders.has("x-request-id")) requestHeaders.set("x-request-id", crypto.randomUUID());

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
