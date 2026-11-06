# Publicação do Bolão na VPS (CloudPanel)

Desenho: o CI constrói a imagem Docker, envia pela própria conexão SSH (`docker save | docker load`, sem registro de imagens), e um comando forçado no servidor sobe, espera a saúde e volta para a versão anterior se falhar. Nada é construído na VPS (1 vCPU, 2 GB).

```
GitHub Actions ──ssh (chave só do deploy, comando forçado)──► VPS
   build da imagem                                          /usr/local/sbin/bolao-deploy
   docker save | gzip                                         carregar-imagem / atualizar-compose / implantar
                                                              docker compose (postgres + api; web em outro compose)
nginx do CloudPanel (TLS, proxy reverso) ──► 127.0.0.1:<porta>
```

## Ambientes

| | Produção | Homologação |
|---|---|---|
| Front | `bolao.joekyy.com.br` (porta 3000) | `homolog-bolao.joekyy.com.br` (porta 3400) |
| API | `api.bolao.joekyy.com.br` (porta 3333) | `api.homolog-bolao.joekyy.com.br` (porta 3433) |
| Postgres | 127.0.0.1:5433 | 127.0.0.1:5533 |
| Pasta | `/srv/bolao/producao/{back,web}` | `/srv/bolao/homolog/{back,web}` |
| Projeto compose | `bolao-prod-back`, `bolao-prod-web` | `bolao-homolog-back`, `bolao-homolog-web` |
| Branch | `main` | `homolog` |

Cada ambiente tem o seu `COMPOSE_PROJECT_NAME`: sem isso dois ambientes derivam o mesmo projeto e um `down` de homologação derruba produção (lição do gestor).

## Fluxo

`dev` → PR → `homolog` (deploy automático na homologação) → validação do Joe → PR → `main` (deploy de produção, **só com aprovação manual** do ambiente `producao`). Sem push direto em `homolog` e `main`. Hotfix: `hotfix/*` → `main`.

## Montagem (uma vez, nesta ordem)

1. **Provisionar a VPS** (instala Docker, cria o usuário `deploy`, pastas e o comando de deploy). Revise o script antes:
   `scp -r deploy vps_joekyy:/root/bolao-deploy-pkg && ssh vps_joekyy 'bash /root/bolao-deploy-pkg/provisionar-vps.sh'`
2. **Chave do deploy.** No seu computador: `ssh-keygen -t ed25519 -N "" -C "bolao-deploy-ci" -f ~/.ssh/bolao_deploy`. Na VPS, em `/home/deploy/.ssh/authorized_keys`, uma linha:
   `restrict,command="/usr/local/sbin/bolao-deploy" ssh-ed25519 AAAA... bolao-deploy-ci`
   Essa chave não abre shell: só executa as quatro ações do script, com argumentos validados.
3. **`.env` de cada ambiente**, a partir de `deploy/env.*.example`, em `/srv/bolao/<ambiente>/back/.env` e `/srv/bolao/<ambiente>/web/.env` (modo 600, dono `deploy`). As senhas do Postgres e do papel `bolao_app` precisam existir ANTES da primeira subida (o papel só é criado na criação do volume).
4. **Sites no CloudPanel**: um site de "Reverse Proxy" por domínio apontando para `http://127.0.0.1:<porta>`, e certificado. **O Let's Encrypt não consegue validar o DNS da HostGator (timeout dos servidores de nome), então os certificados são emitidos com acme.sh na ZeroSSL, por HTTP-01 (modo webroot):** `acme.sh --issue -d <dominio> -w <raiz do site> --keylength ec-256` e depois `acme.sh --install-cert -d <dominio> --ecc --fullchain-file /etc/nginx/ssl-certificates/<dominio>.crt --key-file /etc/nginx/ssl-certificates/<dominio>.key --reloadcmd "nginx -t && systemctl reload nginx"`. A renovação é automática pelo cron do acme.sh. O vhost deve repassar `X-Forwarded-For` (o modelo do CloudPanel usa `$proxy_add_x_forwarded_for`, que é seguro com `TRUST_PROXY=loopback`: a API lê o último valor, o que o nginx acrescentou).
5. **DNS**: A de cada domínio para `143.95.185.142`.
6. **GitHub** (em cada repositório, Settings > Environments): crie `homologacao` e `producao`. (*Required reviewers* e proteção de branch exigem o plano Pro em repositório privado; no lugar deles, a produção só sobe por disparo manual com a frase `publicar producao`, mais a guarda de origem e a esteira de promoção.) Segredos de cada ambiente: `DEPLOY_HOST`, `DEPLOY_PORT` (22022), `DEPLOY_SSH_KEY` (a chave privada), `DEPLOY_KNOWN_HOSTS` (saída de `ssh-keyscan -p 22022 <host>`, conferida com a impressão digital do servidor). Variáveis: `URL_API` (e, no front, `URL_FRONT`).
7. **Primeira publicação**: PR `dev` → `homolog`. O primeiro deploy cria os containers e roda as migrações.

## E-mail (relay local)

O "esqueci minha senha" envia pelo Postfix do próprio host, sem credencial, no modelo do gestor de conteúdo da Nahub:

1. **Postfix** só em loopback e com nome válido: `postconf -e "inet_interfaces = loopback-only" "inet_protocols = ipv4" "myhostname = <fqdn>" "smtp_helo_name = <fqdn>"` e **reiniciar** (`reload` não basta para `inet_interfaces`).
2. **API**: `SMTP_URL=smtp://127.0.0.1:25` e `MAIL_HELO=<fqdn>` no `.env` (a API usa `network_mode: host`, então `127.0.0.1:25` chega no Postfix).
3. **SPF** do domínio do remetente com o IP da VPS (`+ip4:143.95.185.142`).
4. **DKIM**: `apt install opendkim opendkim-tools`, chave com seletor `bolao` (`opendkim-genkey -b 2048 -d joekyy.com.br -s bolao`), `KeyTable` e `SigningTable`, socket `inet:8891@127.0.0.1`, e no Postfix `smtpd_milters` e `non_smtpd_milters` apontando para ele. Publicar o TXT em `bolao._domainkey.<dominio>` (valide com `opendkim-testkey`).
5. Teste: o log do Postfix (`/var/log/mail.log`) mostra `DKIM-Signature field added` e `status=sent`.

## Operação

- Estado: `ssh -i ~/.ssh/bolao_deploy -p 22022 deploy@143.95.185.142 "estado homolog back"` (mostra a etiqueta no ar e a anterior).
- Reversão manual: reenviar a imagem anterior não é preciso, ela fica no servidor (as 2 últimas). Rode o job de deploy do commit anterior, ou, como root, `API_TAG=<sha anterior> docker compose --profile servidor up -d --no-deps api` na pasta do ambiente. Migrações são só aditivas, então a versão anterior continua compatível.
- Backup: `bolao-backup` (instalado pelo `provisionar-vps.sh` junto com `/etc/cron.d/bolao-backup`): dump diário por ambiente com retenção de 30 dias e verificação semanal por restauração num banco temporário. Dumps, log e sinais em `/srv/backups/bolao/<ambiente>` (`backup.log`, `ultimo-ok`, `ULTIMA-FALHA`). Cópia para fora da VPS: puxada pelo Mac (próxima seção).
- Memória: 2 GB com CloudPanel, MySQL e vários PHP-FPM ligados deixam ~850 MB livres. Postgres (512 MB) + API (384 MB) + web de DOIS ambientes não cabem sem desligar o que não é usado (versões de PHP, Varnish, Memcached, MySQL se ninguém usa). Medir antes de ligar a produção; ver INF-04.
- Segurança do usuário `deploy`: estar no grupo `docker` equivale a root na máquina, por isso a chave é restrita ao comando forçado. Guarde a chave privada só como segredo do GitHub.

## Cópia dos backups para o Mac (somente leitura)

O Mac puxa os dumps todo dia às 05:30 (a VPS faz o backup às 04:15). Nada é empurrado de dentro da VPS e a chave não dá acesso a mais nada:

- **Chave dedicada** `~/.ssh/bolao_backup` (ed25519). Na VPS ela entra em `/home/deploy/.ssh/authorized_keys` com `restrict,command="/usr/bin/rrsync -ro /srv/backups/bolao"`: só lê essa pasta, não abre shell e não enxerga os `.env`.
- **Host** `vps_bolao_backup` no `~/.ssh/config` (porta 22022, usuário `deploy`, `known_hosts` próprio com a chave do servidor conferida).
- **Script** `deploy/mac/bolao-backup-pull.sh` copiado para `~/bin/`: `rsync` de `producao/` e `homolog/` para `~/Backups/bolao`, confere cada dump (`gzip -t`) e a idade do mais recente (36 h) e avisa por notificação do macOS se algo estiver errado. O Mac guarda 90 dias e nunca apaga o que a VPS apagou.
- **Agendamento** `deploy/mac/br.com.joekyy.bolao-backup.plist` em `~/Library/LaunchAgents` (carregar com `launchctl bootstrap gui/$(id -u) ...`). Log em `~/Library/Logs/bolao-backup.log`.
- Os dumps têm nomes, WhatsApp e hashes de senha: mantenha o disco do Mac criptografado (FileVault).
