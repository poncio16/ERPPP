import { Alert, Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { backupAlerts, listBackups } from "@/modules/backup/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { BackupButton } from "./backup-button";

const KIND_LABELS: Record<string, string> = { AUTO: "Automático", MANUAL: "Manual", PRE_RESTORE: "Previo a restauración", PRE_MIGRATION: "Previo a migración" };

function size(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}

function Status({ status }: { status: string }) {
  if (status === "OK") return <Badge tone="green">Correcto</Badge>;
  if (status === "RUNNING") return <Badge tone="blue">En curso</Badge>;
  return <Badge tone="red">Falló</Badge>;
}

export default async function BackupsPage() {
  const { ctx } = await requirePagePermission("backup.run");
  const [list, alerts] = await Promise.all([listBackups(db, ctx), backupAlerts(db, ctx)]);
  const { config } = list;
  return (
    <>
      <PageHeader
        title="Backups"
        description="Copias de seguridad completas de la base (pg_dump) con fecha, tamaño, SHA-256, versión de la aplicación y del esquema y totales de control. El backup automático corre todos los días a las 02:00 y la verificación, una vez por semana."
      />
      <div className="mb-4 space-y-2">
        {alerts.map((a) => (
          <Alert key={a} tone="warning">
            {a}
          </Alert>
        ))}
        {!config.configured && <Alert tone="error">Falta configurar DATABASE_BACKUP_URL en el servidor: no se pueden hacer backups desde esta pantalla.</Alert>}
        {!config.offsiteDir && <Alert tone="warning">No hay copia fuera del servidor configurada (BACKUP_OFFSITE_DIR). Ante una falla del disco se perderían también los backups.</Alert>}
        {config.offsiteDir && !config.encrypted && <Alert tone="error">La copia fuera del servidor necesita la clave pública BACKUP_AGE_RECIPIENT: sin ella no se copia.</Alert>}
        {list.dirErrors.map((e) => (
          <Alert key={e} tone="error">
            No se puede leer la carpeta {e}
          </Alert>
        ))}
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-2 font-semibold text-slate-900">Dónde se guardan</h2>
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="inline text-slate-500">En el servidor: </dt>
              <dd className="inline font-mono">{config.dir}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Fuera del servidor (cifrado con age): </dt>
              <dd className="inline font-mono">{config.offsiteDir ?? "sin configurar"}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Retención: </dt>
              <dd className="inline">
                {config.retention.daily} diarios, {config.retention.weekly} semanales y {config.retention.monthly} mensuales. Los previos a una restauración o migración no se borran.
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-slate-600">
            La verificación y la restauración se hacen por consola en el servidor (<code>npm run db:backup:verify</code> y <code>npm run db:restore</code>), con la aplicación en
            mantenimiento; ver el procedimiento en docs/runbooks/backup-y-restauracion.md.
          </p>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-slate-900">Backup manual</h2>
          <p className="mb-3 text-sm text-slate-600">Toma una copia completa en este momento. Queda registrada en la auditoría.</p>
          <BackupButton disabled={!config.configured} />
        </Card>
      </div>
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Fecha</Th>
              <Th>Tipo</Th>
              <Th>Archivo</Th>
              <Th className="text-right">Tamaño</Th>
              <Th>Estado</Th>
              <Th>Copias</Th>
              <Th>Verificación</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.runs.length === 0 && (
              <tr>
                <Td colSpan={7} className="text-center text-slate-500">
                  Todavía no se hizo ningún backup.
                </Td>
              </tr>
            )}
            {list.runs.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-normal!">{formatDateTime(r.finishedAt ?? r.startedAt)}</Td>
                <Td className="whitespace-normal!">{KIND_LABELS[r.kind] ?? r.kind}</Td>
                <Td className="max-w-xs break-all whitespace-normal!">
                  <span className="font-mono text-xs">{r.fileName ?? "—"}</span>
                  {r.sha256 && (
                    <span className="block font-mono text-xs text-slate-400" title={r.sha256}>
                      SHA-256 {r.sha256.slice(0, 16)}…
                    </span>
                  )}
                  {r.status === "OK" && (
                    <span className="block break-normal text-xs text-slate-500">
                      App {r.appVersion} · esquema {r.schemaVersion?.slice(0, 4)} · PostgreSQL {r.pgVersion?.split(" ")[0]}
                    </span>
                  )}
                  {r.errorMessage && <span className="block whitespace-normal text-xs text-red-700">{r.errorMessage}</span>}
                </Td>
                <Td className="text-right tabular-nums">{size(r.sizeBytes)}</Td>
                <Td>
                  <Status status={r.status} />
                </Td>
                <Td className="text-xs whitespace-normal!">
                  {r.status === "OK" && (
                    <>
                      <span className="block">{r.prunedAt ? `Servidor: borrado por retención (${formatDateTime(r.prunedAt)})` : r.localExists ? "Servidor: sí" : "Servidor: no está el archivo"}</span>
                      <span className="block">
                        {r.offsiteStatus === "OK" ? (r.offsiteExists === false ? "Externa: no está el archivo" : "Externa: sí, cifrada") : r.offsiteStatus === "FAILED" ? `Externa: falló (${r.offsiteError})` : "Externa: no"}
                      </span>
                    </>
                  )}
                </Td>
                <Td>
                  {r.verifyStatus ? (
                    <>
                      <Badge tone={r.verifyStatus === "PASS" ? "green" : "red"}>{r.verifyStatus}</Badge>
                      <span className="block text-xs text-slate-500">{formatDateTime(r.verifiedAt)}</span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">Sin verificar</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {(list.unregistered.local.length > 0 || list.unregistered.offsite.length > 0) && (
        <Card className="mt-4 p-4">
          <h2 className="mb-2 font-semibold text-slate-900">Archivos sin registro en esta base</h2>
          <p className="mb-2 text-sm text-slate-600">Backups presentes en las carpetas que no figuran arriba (por ejemplo, tomados antes de la última restauración). Se pueden verificar y restaurar por consola.</p>
          <ul className="list-disc pl-5 font-mono text-xs">
            {list.unregistered.local.map((f) => (
              <li key={`l-${f}`}>Servidor: {f}</li>
            ))}
            {list.unregistered.offsite.map((f) => (
              <li key={`o-${f}`}>Externa: {f}</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
