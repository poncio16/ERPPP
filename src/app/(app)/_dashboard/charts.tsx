"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Gráficos del dashboard (Recharts). Reciben importes ya calculados en el servidor como texto y los
 * convierten a número solo para dibujar; los valores que se leen están en las tarjetas y reportes.
 */

const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const money = (v: unknown) => full.format(Number(v));

export function BalanceEvolutionChart({ points }: { points: { date: string; ar: string; ap: string }[] }) {
  const data = points.map((p, i) => ({
    label: i === points.length - 1 ? "Hoy" : `${MONTHS[Number(p.date.slice(5, 7)) - 1]} ${p.date.slice(2, 4)}`,
    ar: Number(p.ar),
    ap: Number(p.ap),
  }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v: number) => compact.format(v)} tick={{ fontSize: 12 }} width={56} />
          <Tooltip formatter={money} />
          <Legend />
          <Line type="monotone" dataKey="ar" name="Cuentas por cobrar" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="ap" name="Cuentas por pagar" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashFlowChart({ points }: { points: { label: string; net: string; balance: string }[] }) {
  const data = points.map((p) => ({ label: p.label, net: Number(p.net), balance: Number(p.balance) }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v: number) => compact.format(v)} tick={{ fontSize: 12 }} width={56} />
          <Tooltip formatter={money} />
          <Legend />
          <Bar dataKey="net" name="Flujo neto proyectado" fill="#94a3b8" fillOpacity={0.6} isAnimationActive={false} />
          <Line type="monotone" dataKey="balance" name="Saldo final proyectado" stroke="#64748b" strokeDasharray="5 4" strokeWidth={2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
