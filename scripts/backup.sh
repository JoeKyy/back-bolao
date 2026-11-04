#!/usr/bin/env bash
# Backup diário do Postgres do bolão (BOL-07, SEC-11). Rodar no servidor pelo cron, de dentro
# da pasta do ambiente (onde está o .env), fora do htdocs:
#   15 4 * * * cd /srv/bolao/producao/back-bolao && bash scripts/backup.sh >> backups/backup.log 2>&1
# Restaurar num banco vazio:
#   gunzip -c backups/bolao-AAAAMMDD-HHMMSS.sql.gz | docker compose -p "$COMPOSE_PROJECT_NAME" exec -T postgres psql -U bolao -d bolao
set -euo pipefail

# Carrega o .env do ambiente (COMPOSE_PROJECT_NAME, POSTGRES_USER, POSTGRES_DB).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
: "${COMPOSE_PROJECT_NAME:?defina COMPOSE_PROJECT_NAME no .env (senão o backup pode ler o banco do outro ambiente)}"
USUARIO="${POSTGRES_USER:-bolao}"
BANCO="${POSTGRES_DB:-bolao}"
DESTINO="${BACKUP_DIR:-./backups}"

if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi

umask 077
mkdir -p "$DESTINO"
ARQ="$DESTINO/bolao-$(date +%Y%m%d-%H%M%S).sql.gz"
# BAUD-09: escreve num arquivo temporário e só renomeia depois de conferir. Antes, falha deixava
# um .sql.gz de 20 bytes com nome de backup válido, que podia ser tomado por backup bom.
TMP="$ARQ.parcial"
trap 'rm -f "$TMP"' EXIT
"${COMPOSE[@]}" -p "$COMPOSE_PROJECT_NAME" exec -T postgres pg_dump -U "$USUARIO" -d "$BANCO" --no-owner | gzip > "$TMP"

# Dump cortado no meio também falha: o pg_dump termina sempre com esta linha.
if ! gzip -dc "$TMP" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
  echo "backup incompleto, descartado: $ARQ" >&2
  exit 1
fi
mv "$TMP" "$ARQ"
trap - EXIT
find "$DESTINO" -name 'bolao-*.sql.gz' -mtime +30 -delete
echo "ok $ARQ"
