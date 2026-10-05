import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { logoutAction } from "../(auth)/actions";
import { NAV } from "./nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { session } = await requireUser();
  const sections = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.permission || session.permissions.has(i.permission)),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="border-b border-slate-200 px-5 py-4">
          <Link href="/" className="text-lg font-semibold text-brand-800">
            ERP
          </Link>
          <p className="text-xs text-slate-500">Gestión administrativa y financiera</p>
        </div>
        <nav className="space-y-6 px-3 py-4" aria-label="Menú principal">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{section.title}</p>
              <ul className="mt-2 space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <details className="md:hidden">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Menú</summary>
            <nav className="absolute z-10 mt-2 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {sections.flatMap((s) => s.items).map((item) => (
                <Link key={item.href} href={item.href} className="block rounded px-2 py-1.5 text-sm hover:bg-slate-100">
                  {item.label}
                </Link>
              ))}
            </nav>
          </details>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-slate-600">
              {session.fullName} <span className="text-slate-400">({session.username})</span>
            </span>
            <Link href="/cambiar-clave" className="text-brand-700 hover:underline">
              Cambiar contraseña
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="text-slate-600 hover:text-slate-900 hover:underline">
                Salir
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
