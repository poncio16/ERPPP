#!/usr/bin/env bash
# Genera el .env de producción con claves aleatorias a partir de deploy/env.produccion.example.
# Uso (en la carpeta de la aplicación): bash deploy/generar-env.sh erp.miempresa.com.ar
set -euo pipefail

cd "$(dirname "$0")/.."
domain="${1:-}"
if [[ -z "$domain" ]]; then
  echo "Uso: bash deploy/generar-env.sh <dominio>   (por ejemplo: erp.miempresa.com.ar)" >&2
  exit 1
fi
if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "El dominio solo lleva letras, números, puntos y guiones (sin https:// ni barras): ${domain}" >&2
  exit 1
fi
if [[ -e .env ]]; then
  echo "Ya existe un .env: no se pisa. Si de verdad hay que regenerarlo, moverlo antes a otro lugar." >&2
  exit 1
fi

# Solo letras y números: las claves van dentro de URLs y Docker Compose interpreta el signo $.
clave() { openssl rand -hex 24; }

umask 077
sed -e "s/__DOMINIO__/${domain}/" \
    -e "s/__CLAVE_POSTGRES__/$(clave)/g" \
    -e "s/__CLAVE_APP__/$(clave)/g" \
    -e "s/__CLAVE_OWNER__/$(clave)/g" \
    -e "s/__CLAVE_BACKUP__/$(clave)/g" \
    deploy/env.produccion.example > .env

echo ".env creado (permisos 600) para https://${domain}"
echo "Falta completar BACKUP_OFFSITE_HOST_DIR y BACKUP_AGE_RECIPIENT (ver la guía, paso de backups)."
