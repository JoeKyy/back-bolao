#!/bin/sh
# BAUD-07: cria o papel `bolao_app`, só de dados (sem DDL, sem superusuário). A API conecta com
# ele; as migrações rodam com o dono do schema (MIGRATION_DATABASE_URL). O Postgres só executa
# este script na PRIMEIRA criação do volume. Sem BOLAO_APP_PASSWORD (desenvolvimento local), nada
# é criado e a API usa o dono, como sempre.
set -e
if [ -z "${BOLAO_APP_PASSWORD:-}" ]; then
  echo "BOLAO_APP_PASSWORD vazio: papel bolao_app não criado (uso local)."
  exit 0
fi
psql -v ON_ERROR_STOP=1 -v senha="$BOLAO_APP_PASSWORD" -v dono="$POSTGRES_USER" -v banco="$POSTGRES_DB" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE bolao_app LOGIN PASSWORD :'senha' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE :"banco" TO bolao_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bolao_app;
-- Tabelas e sequências criadas pelas migrações (rodadas pelo dono) ficam acessíveis à API.
ALTER DEFAULT PRIVILEGES FOR ROLE :"dono" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bolao_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"dono" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bolao_app;
SQL
