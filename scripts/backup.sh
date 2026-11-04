#!/bin/sh
# Backup diário do Postgres do bolão (BOL-07). Rodar no servidor pelo cron, fora do htdocs:
#   15 4 * * * cd /caminho/back-bolao && sh scripts/backup.sh >> backups/backup.log 2>&1
# Mantém 30 dias. Restaurar: gunzip -c arquivo.sql.gz | docker-compose exec -T postgres psql -U bolao -d bolao
set -eu
DESTINO="${BACKUP_DIR:-./backups}"
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
ARQ="$DESTINO/bolao-$(date +%Y%m%d-%H%M%S).sql.gz"
docker-compose exec -T postgres pg_dump -U "${POSTGRES_USER:-bolao}" -d "${POSTGRES_DB:-bolao}" --no-owner | gzip > "$ARQ"
# Arquivo vazio = falha silenciosa; melhor falhar alto.
[ "$(gzip -dc "$ARQ" | head -c 100 | wc -c)" -gt 0 ] || { echo "backup vazio: $ARQ"; exit 1; }
chmod 600 "$ARQ"
find "$DESTINO" -name 'bolao-*.sql.gz' -mtime +30 -delete
echo "ok $ARQ"
