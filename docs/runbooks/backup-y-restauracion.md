# Runbook: backup y restauración

Procedimientos de la sección J del diseño. Todo lo que dice "consola" se ejecuta en el servidor, en la
carpeta de la aplicación, con el `.env` de producción.

## 0. Puesta en marcha (una sola vez)

1. **Cliente de PostgreSQL de la misma versión mayor que el servidor** (16): `pg_dump --version`. Si no está
   en el `PATH`, indicar la carpeta en `PG_BIN_DIR`. El backup se niega a correr con otra versión mayor.
2. **Variables en `.env`** (ver `.env.example`):
   - `DATABASE_BACKUP_URL`: rol `erp_backup`, solo lectura. Lo crea `npm run db:bootstrap` con esa contraseña.
   - `DATABASE_ADMIN_URL`: superusuario, solo para verificar y restaurar (crean bases temporales).
   - `BACKUP_DIR`: carpeta local (por defecto `/var/backups/erp`), con permisos `700` para el usuario que corre la app.
   - `BACKUP_OFFSITE_DIR`: copia fuera del servidor. Puede ser un NAS en otra ubicación montado por NFS/SMB o un
     bucket S3 montado con `rclone mount` o `s3fs`. Vacío = sin copia externa (la pantalla Backup lo marca como alerta).
   - `BACKUP_AGE_RECIPIENT`: clave **pública** de [age](https://age-encryption.org) con la que se cifra la copia externa.
   - `BACKUP_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY`: retención (por defecto 7 / 4 / 12).
3. **Clave de cifrado**: generarla **fuera del servidor** (en la PC del administrador o un pendrive):
   `age-keygen -o erp-backup-clave.txt`. El comando muestra la clave pública (`age1…`): esa va en
   `BACKUP_AGE_RECIPIENT`. El archivo `erp-backup-clave.txt` es la clave privada: se guarda en dos lugares
   seguros fuera del servidor (por ejemplo, gestor de contraseñas de la empresa y un pendrive en caja fuerte).
   Sin ella las copias externas no se pueden leer.
4. **Cron**: copiar `deploy/cron/erp-backup` a `/etc/cron.d/erp-backup` y ajustar usuario y carpeta.
5. Hacer un primer backup y su verificación (pasos 1 y 3) y confirmar en la pantalla **Backups** que ambos figuran.

## 1. Cómo hacer un backup

- **Automático**: todos los días a las 02:00 (cron). Aplica la retención al terminar.
- **Manual desde la web**: menú *Administración del sistema → Backups → Hacer backup ahora* (permiso `backup.run`).
- **Manual por consola**: `npm run db:backup`.
- **Antes de migrar**: `npm run db:migrate` hace un backup `PRE_MIGRATION` si hay migraciones pendientes.
- **Antes de restaurar**: `npm run db:restore` hace un backup `PRE_RESTORE` de la base actual.

Cada backup es un `pg_dump` en formato custom tomado de la misma instantánea que sus **totales de control**
(filas por tabla, sumas de comprobantes, cuentas corrientes, cobranzas, pagos, imputaciones, saldo de cada caja
y cuenta, cheques por estado, último hash de auditoría y resultado de los invariantes de G.14). Se identifica por:

- el nombre `erp_AAAAMMDD_HHMMSS_<tipo>_v<versión app>_s<versión esquema>.dump`;
- el archivo de control `<nombre>.json` al lado (SHA-256, tamaño, versiones, totales);
- el registro en `backup_runs` y en la auditoría.

## 2. Dónde se guarda

- `BACKUP_DIR` en el servidor: el `.dump` y su `.json`.
- `BACKUP_OFFSITE_DIR`: `<nombre>.dump.age` (cifrado con age) y su `.json`.
- La pantalla **Backups** lista ambos lugares, indica si cada archivo sigue presente y muestra los archivos que
  están en las carpetas pero no en la base (por ejemplo, los tomados antes de una restauración).
- Retención: se conserva el último backup de cada uno de los últimos 7 días, 4 semanas y 12 meses. Los
  `PRE_RESTORE` y `PRE_MIGRATION` no se borran solos. El registro en `backup_runs` nunca se borra.
- Regla 3-2-1: base en uso + copia local + copia externa cifrada en otro lugar físico.

## 3. Cómo verificarlo

```
npm run db:backup:verify -- /var/backups/erp/erp_20261006_020000_AUTO_v0.1.0_s0004.dump
npm run db:backup:verify -- --latest
```

Comprueba el SHA-256, ejecuta `pg_restore --list`, restaura en la base temporal `erp_verify`, recalcula los totales
de control y los invariantes y los compara con los guardados. Muestra PASS/FAIL por paso, guarda el resultado en la
pantalla Backups y en la auditoría, borra `erp_verify` (salvo `--keep`) y sale con código 1 si falla. El cron lo hace
todos los domingos; si una verificación falla o pasan 8 días sin una en PASS, el dashboard del administrador lo avisa.

Para verificar una **copia externa**, descifrarla primero en una carpeta de trabajo y verificar ese archivo
(con su `.json`):

```
age --decrypt --identity erp-backup-clave.txt --output /tmp/erp.dump erp_…dump.age
cp erp_…dump.age.json /tmp/erp.dump.json
npm run db:backup:verify -- /tmp/erp.dump
```

## 4. Cómo restaurarlo

La restauración reemplaza **toda** la información. No hay botón en la web: se hace por consola, avisando antes a los usuarios.

```
npm run db:restore -- /var/backups/erp/erp_20261006_020000_AUTO_v0.1.0_s0004.dump
```

El script pide escribir el nombre de la base para confirmar (o `--yes`) y luego:

1. verifica el archivo (archivo de control, SHA-256, `pg_restore --list`);
2. pone la aplicación en **modo mantenimiento** (crea `MAINTENANCE_FILE`; la web responde 503);
3. hace un backup `PRE_RESTORE` de la base actual;
4. restaura en una base nueva `<base>_restore_<fecha>` y la verifica contra los totales de control e invariantes;
   si algo no coincide, la borra y **no toca** la base actual;
5. intercambia las bases: la actual queda como `<base>_prev_<fecha>` y la restaurada toma su nombre;
6. registra en la base restaurada el backup previo y la restauración (auditoría);
7. sale del modo mantenimiento. Después, **reiniciar la aplicación** (`systemctl restart erp` o equivalente).

**Desastre (servidor nuevo)**: instalar PostgreSQL 16 y la aplicación, completar el `.env`, correr
`npm run db:bootstrap` (crea los roles), traer el backup (descifrar la copia externa como en el paso 3) y
ejecutar `npm run db:restore -- <archivo>`. Si la base no existe, se crea sin backup previo.

**Volver atrás**: la base anterior queda intacta como `<base>_prev_<fecha>`; también está el backup `PRE_RESTORE`.
Cuando ya no se la necesite: `DROP DATABASE <base>_prev_<fecha>;` (con el superusuario).

## 5. Cómo comprobar la restauración

- **Automático**: el script ya comparó los totales de control y los invariantes de la base restaurada con los del
  backup antes de habilitarla (todos los pasos deben decir PASS).
- **En la aplicación**: *Administración del sistema → Verificación de consistencia → Ejecutar* (todo en $ 0,00) y
  *Auditoría → Verificar integridad* (cadena íntegra).
- **Verificación humana**: comparar contra un reporte impreso previo al backup el saldo de 3 clientes, 3 proveedores,
  la caja y un banco (reportes *Deuda de clientes*, *Deuda con proveedores*, *Libro de caja*, *Libro de banco* a la
  fecha del backup).
