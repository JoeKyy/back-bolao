#!/usr/bin/env bash
# Provisiona a VPS (Ubuntu 22.04 com CloudPanel) para receber o Bolão. Rode como root, UMA vez
# (é idempotente). NÃO é executado pelo CI. Lê o que faz antes de agir e não mexe em PHP, MySQL,
# nginx nem no CloudPanel.
#
#   scp deploy/provisionar-vps.sh deploy/bolao-deploy vps_joekyy:/root/ && ssh vps_joekyy 'bash /root/provisionar-vps.sh'
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "rode como root"; exit 1; }
AQUI="$(cd "$(dirname "$0")" && pwd)"

echo "== 1. Docker Engine e plugin compose (repositório oficial)"
if ! command -v docker >/dev/null; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
# Limites de log do Docker no host (o compose também limita por serviço).
install -d /etc/docker
[ -f /etc/docker/daemon.json ] || cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
JSON
systemctl enable --now docker
docker --version && docker compose version

echo "== 2. Usuário de deploy (sem senha; a chave só roda o comando forçado)"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "Deploy do Bolão" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

echo "== 3. Comando de deploy"
install -m 0755 -o root -g root "$AQUI/bolao-deploy" /usr/local/sbin/bolao-deploy

echo "== 4. Pastas por ambiente (cada uma com seu .env, fora do git)"
for amb in producao homolog; do
  for svc in back web; do
    install -d -m 750 -o deploy -g deploy "/srv/bolao/$amb/$svc"
  done
  install -d -m 750 -o deploy -g deploy "/srv/bolao/$amb/back/initdb" "/srv/bolao/$amb/back/backups"
  install -m 0755 -o deploy -g deploy "$AQUI/initdb/01-papel-app.sh" "/srv/bolao/$amb/back/initdb/01-papel-app.sh" 2>/dev/null || true
done

echo "== 5. Conferências (somente leitura)"
free -m | sed -n 1,2p
swapon --show || true
ufw status | head -12 || true
echo
echo "Próximos passos (manuais, ver deploy/README.md):"
echo "  - gerar a chave de deploy e colocar em /home/deploy/.ssh/authorized_keys com restrict,command=\"/usr/local/sbin/bolao-deploy\""
echo "  - criar o .env de cada ambiente em /srv/bolao/<ambiente>/<back|web>/.env (modelos em deploy/)"
echo "  - criar os sites de proxy reverso no CloudPanel e emitir os certificados"
