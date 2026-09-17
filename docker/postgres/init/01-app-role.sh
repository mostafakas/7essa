#!/bin/sh
# ينشئ دور التطبيق المقيد: بلا صلاحيات مدير وبلا تجاوز لسياسات RLS
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'EOSQL'
SELECT format('CREATE ROLE hessa_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hessa_app') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
EOSQL
