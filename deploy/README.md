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
   `scp deploy/provisionar-vps.sh deploy/bolao-deploy deploy/initdb/01-papel-app.sh vps_joekyy:/root/ && ssh vps_joekyy 'bash /root/provisionar-vps.sh'`
2. **Chave do deploy.** No seu computador: `ssh-keygen -t ed25519 -N "" -C "bolao-deploy-ci" -f ~/.ssh/bolao_deploy`. Na VPS, em `/home/deploy/.ssh/authorized_keys`, uma linha:
   `restrict,command="/usr/local/sbin/bolao-deploy" ssh-ed25519 AAAA... bolao-deploy-ci`
   Essa chave não abre shell: só executa as quatro ações do script, com argumentos validados.
3. **`.env` de cada ambiente**, a partir de `deploy/env.*.example`, em `/srv/bolao/<ambiente>/back/.env` e `/srv/bolao/<ambiente>/web/.env` (modo 600, dono `deploy`). As senhas do Postgres e do papel `bolao_app` precisam existir ANTES da primeira subida (o papel só é criado na criação do volume).
4. **Sites no CloudPanel**: um site de "Reverse Proxy" por domínio apontando para `http://127.0.0.1:<porta>`, e certificado Let's Encrypt. O vhost deve repassar `X-Forwarded-For` (o modelo do CloudPanel usa `$proxy_add_x_forwarded_for`, que é seguro com `TRUST_PROXY=loopback`: a API lê o último valor, o que o nginx acrescentou).
5. **DNS**: A de cada domínio para `143.95.185.142`.
6. **GitHub** (em cada repositório, Settings > Environments): crie `homologacao` e `producao` (este com *Required reviewers* = Joe). Segredos de cada ambiente: `DEPLOY_HOST`, `DEPLOY_PORT` (22022), `DEPLOY_SSH_KEY` (a chave privada), `DEPLOY_KNOWN_HOSTS` (saída de `ssh-keyscan -p 22022 <host>`, conferida com a impressão digital do servidor). Variáveis: `URL_API` (e, no front, `URL_FRONT`).
7. **Primeira publicação**: PR `dev` → `homolog`. O primeiro deploy cria os containers e roda as migrações.

## Operação

- Estado: `ssh -i ~/.ssh/bolao_deploy -p 22022 deploy@143.95.185.142 "estado homolog back"` (mostra a etiqueta no ar e a anterior).
- Reversão manual: reenviar a imagem anterior não é preciso, ela fica no servidor (as 3 últimas). Rode o job de deploy do commit anterior, ou, como root, `API_TAG=<sha anterior> docker compose --profile servidor up -d --no-deps api` na pasta do ambiente. Migrações são só aditivas, então a versão anterior continua compatível.
- Backup: `bash scripts/backup.sh` agendado no cron do usuário `deploy`, de dentro de `/srv/bolao/<ambiente>/back`, e cópia para fora da VPS (ainda a definir).
- Memória: 2 GB com CloudPanel, MySQL e vários PHP-FPM ligados deixam ~850 MB livres. Postgres (512 MB) + API (384 MB) + web de DOIS ambientes não cabem sem desligar o que não é usado (versões de PHP, Varnish, Memcached, MySQL se ninguém usa). Medir antes de ligar a produção; ver INF-04.
- Segurança do usuário `deploy`: estar no grupo `docker` equivale a root na máquina, por isso a chave é restrita ao comando forçado. Guarde a chave privada só como segredo do GitHub.
