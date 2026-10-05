import { Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { FIELD_LABELS, HISTORY_ACTIONS } from "./config";

interface HistoryEntry {
  id: number;
  occurredAt: Date;
  username: string | null;
  action: string;
  before: unknown;
  after: unknown;
  message: string | null;
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Historial del registro tomado de la auditoría (no editable). */
export function PartyHistory({ entries, names }: { entries: HistoryEntry[]; names: Record<string, Record<string, string>> }) {
  const label = (field: string, v: unknown) => {
    const map = names[field];
    return map && v != null ? (map[String(v)] ?? show(v)) : show(v);
  };
  return (
    <Card className="p-5">
      <h2 className="font-medium text-slate-900">Historial</h2>
      {entries.length === 0 && <p className="mt-2 text-sm text-slate-500">Sin movimientos registrados.</p>}
      <ol className="mt-3 space-y-4">
        {entries.map((e) => {
          const before = (e.before ?? {}) as Record<string, unknown>;
          const after = (e.after ?? {}) as Record<string, unknown>;
          const fields = e.action === "update" ? Object.keys(after) : [];
          return (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3 text-sm">
              <p className="text-slate-900">
                <span className="font-medium">{HISTORY_ACTIONS[e.action] ?? e.action}</span>
                <span className="text-slate-500">
                  {" "}
                  · {formatDateTime(e.occurredAt)} · {e.username ?? "sistema"}
                </span>
              </p>
              {e.action === "deactivate" && <p className="text-slate-600">Motivo: {show(after.reason)}</p>}
              {e.message && <p className="text-slate-600">{e.message}</p>}
              {fields.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-slate-600">
                  {fields.map((f) => (
                    <li key={f}>
                      {FIELD_LABELS[f] ?? f}: <span className="line-through decoration-slate-400">{label(f, before[f])}</span> →{" "}
                      <span className="text-slate-900">{label(f, after[f])}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
