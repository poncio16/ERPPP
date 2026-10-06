#!/usr/bin/env bash
# Actualiza el ERP en producción a la última versión de main.
# Uso (en la carpeta de la aplicación, como el usuario erp): bash deploy/actualizar.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== Bajando la versión nueva"
git pull --ff-only

echo "== Construyendo la imagen (con las actualizaciones de seguridad de la base)"
docker compose build --pull app
docker compose pull db caddy

echo "== Deteniendo la aplicación (la base sigue en marcha)"
docker compose stop app

# db:migrate hace un backup PRE_MIGRATION antes de aplicar migraciones pendientes.
echo "== Aplicando migraciones"
docker compose run --rm --no-deps app npm run -s db:migrate

echo "== Levantando todo con la versión nueva"
docker compose up -d

docker compose ps
