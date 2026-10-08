# Runbook: instalación en producción

Instalación del ERP en un servidor en la nube (decisión D1 del diseño: VPS) con Docker Compose:
PostgreSQL 16, la aplicación y Caddy como proxy HTTPS con certificado automático. Al terminar quedan:

- el ERP en `https://<tu dominio>`, con certificado de Let's Encrypt que se renueva solo;
- la base de datos sin ningún puerto abierto a internet;
- un backup diario a las 02:00 con copia cifrada fuera del servidor y retención 7/4/12, y una
  verificación del último backup todos los domingos a las 04:30 (sección J del diseño).

Los comandos van en el servidor. Donde dice `<dominio>` va el tuyo, por ejemplo `erp.miempresa.com.ar`.

## 0. Qué hace falta antes de empezar

| Qué | Detalle |
|---|---|
| Servidor (VPS) | Ubuntu 24.04 LTS, 2 vCPU, 4 GB de RAM, 40 GB de disco SSD. Alcanza para decenas de usuarios. |
| Dominio | Un subdominio (por ejemplo `erp.miempresa.com.ar`) con un registro DNS **A** que apunte a la IP del servidor. |
| Copia externa | Un bucket S3 (AWS, Backblaze B2, Cloudflare R2 u otro compatible) con su clave de acceso, o un NAS en otra ubicación. |
| Clave de cifrado | [age](https://age-encryption.org) instalado en la PC del administrador (no en el servidor). |

## 1. Preparar el servidor (como root)

```bash
timedatectl set-timezone America/Argentina/Buenos_Aires
apt update && apt upgrade -y
apt install -y git ufw unattended-upgrades

# Firewall: solo SSH y web. La base y la aplicación no publican puertos.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
```

Docker, desde su repositorio oficial:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Usuario `erp` y carpetas. Pertenecer al grupo `docker` equivale a ser administrador del servidor: solo
lo usa quien administra el ERP.

```bash
useradd --create-home --shell /bin/bash erp
usermod -aG docker erp
install -d -o erp -g erp /opt/erp /var/log/erp
# Los backups los escribe el contenedor, que corre con el uid 1000.
install -d -m 700 -o 1000 -g 1000 /var/backups/erp
```

## 2. Bajar la aplicación y generar el `.env` (como erp)

```bash
su - erp
git clone https://github.com/PONCIO16/ERPPP.git /opt/erp
cd /opt/erp
bash deploy/generar-env.sh <dominio>
```

`generar-env.sh` crea `/opt/erp/.env` con permisos `600` y una clave aleatoria distinta para cada rol de
la base (`postgres`, `erp_owner`, `erp_app`, `erp_backup`). Ese archivo es el único lugar donde quedan;
no se sube al repositorio. Si el repositorio pasa a ser privado, el `git clone` necesita una
[deploy key](https://docs.github.com/es/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
de solo lectura.

## 3. Construir, crear la base y el primer administrador (como erp, en /opt/erp)

```bash
docker compose build
docker compose up -d db
docker compose run --rm --no-deps app npm run db:bootstrap
docker compose run --rm --no-deps app npm run db:migrate
docker compose run --rm --no-deps app npm run db:seed
docker compose run --rm --no-deps app npm run admin:create -- admin "Nombre Apellido"
docker compose up -d
```

- La primera vez, `docker compose build` tarda unos minutos (baja Node, el cliente de PostgreSQL 16 y las
  dependencias, y compila la aplicación).
- `db:bootstrap` crea los roles y la base `erp`; `db:migrate` crea las tablas y los controles de
  integridad; `db:seed` carga los catálogos (IVA, tipos de comprobante, bancos, roles y permisos).
- `admin:create` muestra **una sola vez** la contraseña temporal del administrador: anotarla.
- `docker compose ps` tiene que mostrar `db`, `app` y `caddy` en `running`, con `db` y `app` en
  `(healthy)` al minuto.

Entrar a `https://<dominio>` con `admin` y la contraseña temporal. El sistema pide cambiarla. Desde
**Administración del sistema** se crean los demás usuarios.

> Los datos de demostración (`db:seed:demo`) no corren en producción.

## 4. Backups programados

### 4.1 Clave de cifrado (en la PC del administrador, no en el servidor)

```bash
age-keygen -o erp-backup-clave.txt
```

Muestra la clave pública (`age1…`). El archivo `erp-backup-clave.txt` es la clave privada: guardarlo en
dos lugares seguros fuera del servidor (por ejemplo, el gestor de contraseñas de la empresa y un pendrive).
Sin ella las copias externas no se pueden leer.

### 4.2 Carpeta externa (como root)

Con un **bucket S3**, montado con rclone:

```bash
apt install -y rclone fuse3
rclone config          # crear un remoto llamado "externo" con los datos del bucket
mkdir -p /mnt/erp-externo && chattr +i /mnt/erp-externo
cp /opt/erp/deploy/systemd/erp-externo.service /etc/systemd/system/
# Si el bucket no se llama erp-backups, cambiar "externo:erp-backups" en el servicio.
systemctl daemon-reload
systemctl enable --now erp-externo
```

Con un **NAS** en otra ubicación, montarlo en `/mnt/erp-externo` por NFS o SMB desde `/etc/fstab`, con
escritura para el uid 1000, y hacer el mismo `chattr +i` sobre la carpeta vacía antes del primer montaje.

`chattr +i` deja la carpeta vacía de abajo como inmutable: si el montaje se cae, la copia externa falla y
la pantalla **Backups** lo muestra, en lugar de quedar escrita en el disco del propio servidor.

### 4.3 Completar el `.env` y programar (como erp, en /opt/erp)

En `/opt/erp/.env`:

```
BACKUP_OFFSITE_HOST_DIR=/mnt/erp-externo
BACKUP_AGE_RECIPIENT=age1...          # la clave pública del paso 4.1
```

```bash
docker compose up -d                   # recrea la aplicación con la configuración nueva
docker compose run --rm --no-deps -T app npm run db:backup
docker compose run --rm --no-deps -T app npm run db:backup:verify -- --latest
```

El backup tiene que terminar con la copia externa cifrada, y la verificación con todos los pasos en PASS.
En la pantalla **Backups** figuran los dos.

Por último, como root, el cron de backups (diario 02:00, verificación los domingos 04:30):

```bash
cp /opt/erp/deploy/cron/erp-backup /etc/cron.d/erp-backup
```

Los resultados quedan en `/var/log/erp/backup.log` y `/var/log/erp/backup-verify.log`, en la pantalla
Backups y en la auditoría. Si una verificación falla o pasan 8 días sin una en PASS, el dashboard del
administrador lo avisa.

## 5. Actualizar a una versión nueva (como erp, en /opt/erp)

```bash
bash deploy/actualizar.sh
```

Baja la última versión de `main`, reconstruye la imagen con las actualizaciones de seguridad, detiene la
aplicación, aplica las migraciones (que antes hacen un backup `PRE_MIGRATION`) y levanta todo de nuevo.
La aplicación queda fuera de servicio uno o dos minutos: conviene hacerlo fuera del horario de trabajo.

## 6. Tareas de consola con Docker

El runbook de [backup y restauración](backup-y-restauracion.md) escribe los comandos como `npm run …`.
En esta instalación se ejecutan así, como erp en `/opt/erp`:

| Tarea | Comando |
|---|---|
| Backup manual | `docker compose run --rm --no-deps app npm run db:backup` |
| Verificar un backup | `docker compose run --rm --no-deps app npm run db:backup:verify -- /var/backups/erp/<archivo>.dump` |
| Restaurar | `docker compose exec app npm run db:restore -- /var/backups/erp/<archivo>.dump` y después `docker compose restart app` |
| Nuevo administrador (si no queda ninguno activo) | `docker compose run --rm --no-deps app npm run admin:create -- <usuario> "<Nombre>"` |
| Ver errores de la aplicación | `docker compose logs --tail 200 app` |
| Estado de los servicios | `docker compose ps` |

Cada vez que se cambia el `.env`, `docker compose up -d` recrea la aplicación para que tome los valores nuevos.

Adentro del contenedor, `/var/backups/erp` es la carpeta `BACKUP_HOST_DIR` del servidor y
`/var/backups/erp-externo` es `BACKUP_OFFSITE_HOST_DIR`. Para restaurar una copia externa, descifrarla
en el servidor dentro de `/var/backups/erp` (con la clave privada traída solo para eso y borrada después)
y restaurar ese archivo:

```bash
age --decrypt --identity erp-backup-clave.txt --output /var/backups/erp/restaurar.dump /mnt/erp-externo/<archivo>.dump.age
cp /mnt/erp-externo/<archivo>.dump.age.json /var/backups/erp/restaurar.dump.json
chown 1000:1000 /var/backups/erp/restaurar.dump /var/backups/erp/restaurar.dump.json
```

**Servidor nuevo después de un desastre**: pasos 1 y 2 (con un `.env` nuevo), `docker compose build`,
`docker compose up -d db`, `db:bootstrap`, traer el backup como se indica arriba y restaurarlo con
`docker compose run --rm --no-deps app npm run db:restore -- /var/backups/erp/restaurar.dump`; después
`docker compose up -d` y el paso 4.

## 7. Comprobar que quedó bien

- [ ] `https://<dominio>` abre el ingreso con el candado del navegador y `http://<dominio>` redirige a https.
- [ ] `docker compose ps` muestra `db` y `app` en `(healthy)`.
- [ ] Desde otra máquina, `nc -zv <ip> 5432` y `nc -zv <ip> 3000` fallan (la base y la aplicación no están expuestas).
- [ ] La pantalla **Backups** muestra un backup con copia externa y una verificación en PASS.
- [ ] **Administración del sistema → Verificación de consistencia → Ejecutar** da todo en $ 0,00.
- [ ] Después de `reboot`, todo vuelve a levantar solo (los servicios tienen `restart: unless-stopped`).
