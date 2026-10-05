import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600",
  secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
  ghost: "text-slate-700 hover:bg-slate-100",
};
export const buttonClass = (variant: Variant = "primary", extra?: string) =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium shadow-sm",
    "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant],
    extra,
  );

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)} {...props} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const tones = {
    info: "border-brand-100 bg-brand-50 text-brand-800",
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-4 py-3 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "red" | "amber" | "blue"; children: ReactNode }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    red: "bg-red-50 text-red-700 ring-red-600/20",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
    blue: "bg-brand-50 text-brand-700 ring-brand-600/20",
  };
  return (
    <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-slate-500/10", tones[tone])}>
      {children}
    </span>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cx("block text-sm font-medium text-slate-700", className)} {...props} />;
}

export const inputClass =
  "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 aria-[invalid=true]:ring-red-400";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(inputClass, "pr-8", className)} {...props} />;
}

export function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-red-700">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

/** Campo con etiqueta, input y errores de validación del servidor. */
export function Field({
  label,
  name,
  errors,
  hint,
  ...input
}: ComponentProps<"input"> & { label: string; name: string; errors?: string[]; hint?: string }) {
  const id = input.id ?? `f-${name}`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1">
        <Input id={id} name={name} aria-invalid={errors?.length ? true : undefined} {...input} />
      </div>
      {hint && !errors?.length && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <FieldErrors errors={errors} />
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return <th scope="col" className={cx("px-4 py-2.5 text-left font-semibold text-slate-700", className)} {...props} />;
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cx("whitespace-nowrap px-4 py-2.5 text-slate-700", className)} {...props} />;
}

/** Select con etiqueta y errores. `options` en el orden en que se muestran. */
export function SelectField({
  label,
  name,
  errors,
  hint,
  options,
  placeholder,
  ...select
}: ComponentProps<"select"> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
  options: { value: string | number; label: string }[];
  placeholder?: string;
}) {
  const id = select.id ?? `f-${name}`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1">
        <Select id={id} name={name} aria-invalid={errors?.length ? true : undefined} {...select}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      {hint && !errors?.length && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <FieldErrors errors={errors} />
    </div>
  );
}

export function TextareaField({
  label,
  name,
  errors,
  className,
  ...props
}: ComponentProps<"textarea"> & { label: string; name: string; errors?: string[] }) {
  const id = props.id ?? `f-${name}`;
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <textarea id={id} name={name} rows={3} className={cx(inputClass, "mt-1")} aria-invalid={errors?.length ? true : undefined} {...props} />
      <FieldErrors errors={errors} />
    </div>
  );
}

/** Paginación simple por número de página, conservando los filtros de la URL. */
export function Pagination({
  page,
  pageSize,
  total,
  href,
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm" aria-label="Paginación">
      <span className="text-slate-600">
        Página {page} de {pages} · {total} registros
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <LinkButton variant="secondary" href={href(page - 1)}>
            Anterior
          </LinkButton>
        )}
        {page < pages && (
          <LinkButton variant="secondary" href={href(page + 1)}>
            Siguiente
          </LinkButton>
        )}
      </div>
    </nav>
  );
}
