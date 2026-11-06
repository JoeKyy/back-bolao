#!/usr/bin/env bash
# Puxa os backups do Postgres da VPS para este Mac (somente leitura), pelo launchd.
#
# A chave SSH (~/.ssh/bolao_backup) só consegue LER /srv/backups/bolao na VPS (comando forçado
# rrsync -ro): não abre shell e não enxerga os .env nem o resto do servidor. Host definido em
# ~/.ssh/config como "vps_bolao_backup" (ver deploy/README.md, "Cópia dos backups para o Mac").
#
# O Mac guarda mais tempo que a VPS (90 dias contra 30) e NUNCA apaga o que a VPS apagou.
# Confere cada dump novo (gzip íntegro) e o mais recente (menos de 36 h); se algo estiver errado,
# avisa por notificação do macOS e sai com erro.
set -euo pipefail

HOST="${BOLAO_BACKUP_HOST:-vps_bolao_backup}"
DEST="${BOLAO_BACKUP_DESTINO:-$HOME/Backups/bolao}"
RETENCAO_DIAS=90
IDADE_MAX_HORAS=36

avisar() {
  echo "$(date '+%F %T') $*" >&2
  /usr/bin/osascript -e "display notification \"$*\" with title \"Backup do Bolão\"" >/dev/null 2>&1 || true
}
trap 'avisar "FALHA na cópia dos backups do Bolão (veja ~/Library/Logs/bolao-backup.log)"' ERR

umask 077
mkdir -p "$DEST"

for amb in producao homolog; do
  mkdir -p "$DEST/$amb"
  # -rt: recursivo e preserva a data; --partial: retoma transferência interrompida.
  /usr/bin/rsync -rt --partial -e "ssh -o ConnectTimeout=30" "$HOST:$amb/" "$DEST/$amb/"
  # Todo dump precisa ser um gzip íntegro (um arquivo cortado não vale como backup).
  for f in "$DEST/$amb"/bolao-*.sql.gz; do
    [ -e "$f" ] || continue
    gzip -t "$f" || { avisar "dump corrompido: $f"; exit 1; }
  done
  ultimo="$(ls -t "$DEST/$amb"/bolao-*.sql.gz 2>/dev/null | head -1 || true)"
  [ -n "$ultimo" ] || { avisar "nenhum backup de $amb no Mac"; exit 1; }
  idade_h=$(( ( $(date +%s) - $(stat -f %m "$ultimo") ) / 3600 ))
  if [ "$idade_h" -gt "$IDADE_MAX_HORAS" ]; then
    avisar "o backup mais recente de $amb tem ${idade_h} h: o agendamento da VPS parou?"
    exit 1
  fi
  echo "$(date '+%F %T') $amb ok: $(basename "$ultimo") (${idade_h} h), $(ls "$DEST/$amb"/bolao-*.sql.gz | wc -l | tr -d ' ') arquivos"
done

find "$DEST" -name 'bolao-*.sql.gz' -mtime +"$RETENCAO_DIAS" -delete
trap - ERR
