# Imagen de producción del ERP. Ver docs/runbooks/instalacion-produccion.md.
# Una sola imagen sirve la aplicación (next start) y las tareas de consola (migraciones, backups,
# restauración, alta del administrador), que se ejecutan con tsx y necesitan pg_dump 16 y age.
# Base Ubuntu 24.04: trae postgresql-client-16 (misma versión mayor que el servidor, exigida por los
# backups) y age en sus repositorios oficiales. Node 22 se copia de la imagen oficial de Node.
FROM node:22-bookworm-slim AS node

FROM ubuntu:24.04

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

ENV TZ=America/Argentina/Buenos_Aires \
    NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tzdata age postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/* \
 && userdel -r ubuntu \
 && useradd --uid 1000 --create-home --shell /bin/bash erp \
 && install -d -o erp -g erp /app /var/lib/erp /var/backups/erp /var/backups/erp-externo

WORKDIR /app
USER erp

# Dependencias completas: las tareas de consola usan tsx.
COPY --chown=erp:erp package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY --chown=erp:erp . .
# El build importa el cliente de la base, que exige DATABASE_URL aunque no se conecte: va una dirección
# que no existe, solo para el build. La real llega en tiempo de ejecución desde el .env.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:1/build npm run build && rm -rf .next/cache

ENV NODE_ENV=production \
    MAINTENANCE_FILE=/var/lib/erp/.maintenance

EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
