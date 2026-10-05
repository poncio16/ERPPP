#!/usr/bin/env bash
# Recrea la base de desarrollo desde cero (NUNCA usar en producción).
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
DB=$(node -e "console.log(new URL(process.env.DATABASE_URL).pathname.slice(1))")
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
npx tsx scripts/db/bootstrap.ts
npx tsx scripts/db/migrate.ts
npx tsx scripts/db/seed.ts
