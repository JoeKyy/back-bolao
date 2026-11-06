# Bolão da Mega: API (`back-bolao`)

API do **Bolão da Mega**, um organizador de bolões informais da Mega-Sena (primeiro alvo: **Mega da Virada 2026**, sorteio em 01/01/2027, 10h de Brasília). Este repositório é o **back-end**. O front-end fica em [`JoeKyy/bolao-web`](https://github.com/JoeKyy/bolao-web).

> **O aplicativo só organiza.** Ele não vende aposta, não recebe dinheiro e não verifica Pix. O tesoureiro recebe o Pix na conta dele, confirma os pagamentos na mão, exporta os jogos e os registra na Caixa (app ou lotérica). Quem define o que é "valor pago" é sempre o tesoureiro.

Endereços:

| | Produção | Homologação |
|---|---|---|
| Front | https://bolao.joekyy.com.br | https://homolog-bolao.joekyy.com.br |
| API | https://api.bolao.joekyy.com.br | https://api.homolog-bolao.joekyy.com.br |
| Saúde | `GET /saude` | `GET /saude` |

---

## Sumário

1. [Visão geral da arquitetura](#1-visão-geral-da-arquitetura)
2. [Stack](#2-stack)
3. [Estrutura do repositório](#3-estrutura-do-repositório)
4. [Modelo de dados](#4-modelo-de-dados)
5. [Regras de negócio](#5-regras-de-negócio)
6. [Perfis e permissões](#6-perfis-e-permissões)
7. [Referência da API](#7-referência-da-api)
8. [Segurança](#8-segurança)
9. [Configuração (variáveis de ambiente)](#9-configuração-variáveis-de-ambiente)
10. [Rodando localmente](#10-rodando-localmente)
11. [Testes](#11-testes)
12. [Contrato com o front](#12-contrato-com-o-front)
13. [E-mail](#13-e-mail)
14. [CI/CD e ambientes](#14-cicd-e-ambientes)
15. [Operação](#15-operação)
16. [Documentos relacionados](#16-documentos-relacionados)
17. [Pendências conhecidas](#17-pendências-conhecidas)

---

## 1. Visão geral da arquitetura

Dois repositórios independentes (back e front), publicados na mesma VPS, atrás do nginx do CloudPanel.

```
                         Internet (HTTPS, certificados ZeroSSL renovados pelo acme.sh)
                                          |
                          nginx do CloudPanel (proxy reverso, TLS)
                  +-----------------------+------------------------+
                  |                                                |
     bolao.joekyy.com.br                              api.bolao.joekyy.com.br
        -> 127.0.0.1:3000                                  -> 127.0.0.1:3333
                  |                                                |
        container web (Next.js)                         container api (NestJS)
        repositório bolao-web                           network_mode host, 127.0.0.1
                                                                   |
                                          +------------------------+---------------+
                                          |                                        |
                                 Postgres 16 (container)                 Postfix do host (relay)
                                 127.0.0.1:5433                          127.0.0.1:25 + OpenDKIM
```

Pontos de desenho que valem saber antes de mexer:

- **Tudo escuta só em `127.0.0.1`.** Nada do Docker é exposto à internet; o nginx do CloudPanel é a única porta de entrada.
- **A API usa `network_mode: host`.** Assim o `X-Forwarded-For` do nginx chega com o IP verdadeiro do visitante (`TRUST_PROXY=loopback`) e o limite de tentativas por IP funciona. Na rede bridge do Docker o nginx apareceria como `172.x.0.1` e todo mundo dividiria o mesmo limite.
- **Dois papéis no Postgres.** A API conecta como `bolao_app` (só leitura e escrita de dados, sem criar nem alterar tabelas). As migrações rodam com o dono do banco, numa variável (`MIGRATION_DATABASE_URL`) que existe só no processo de migração e é removida do ambiente antes de a API subir.
- **Três ambientes independentes de verdade**: cada um tem pasta, portas, projeto Docker Compose e `.env` próprios (ver [seção 14](#14-cicd-e-ambientes)).

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node 22 (imagem `node:22-alpine` fixada por digest) |
| Framework | NestJS 11 (Express) |
| Banco | PostgreSQL 16, Prisma 6 (migrações SQL versionadas) |
| Validação | class-validator + class-transformer (`whitelist` e `forbidNonWhitelisted`) |
| Segurança HTTP | helmet, cookie-parser, CORS restrito, proteção CSRF por cabeçalho + Origin |
| Senhas | bcryptjs (custo fixo), política própria (12 a 128 caracteres, lista de senhas comuns) |
| Login | RSA-OAEP (SHA-256): a senha viaja cifrada com a chave pública da API |
| E-mail | nodemailer, via relay local (Postfix) com SPF e DKIM |
| Testes | Jest (unitários), Jest + supertest com Postgres real (e2e) |
| Gerenciador | pnpm 11 |
| Empacotamento | Docker (multi-stage), Docker Compose |
| CI/CD | GitHub Actions, deploy por SSH com comando forçado |

## 3. Estrutura do repositório

```
back-bolao/
├── README.md                     Este arquivo
├── Dockerfile                    Imagem da API (multi-stage); o CMD migra e depois sobe a API
├── docker-compose.yml            Postgres 16 + API (limites de memória, healthcheck, host network)
├── package.json / pnpm-*.yaml    Dependências e scripts
├── tsconfig*.json, nest-cli.json, eslint.config.mjs, jest.config.js
│
├── prisma/
│   ├── schema.prisma             Modelo de dados
│   └── migrations/               Migrações SQL (6): inicial, aparelho_organizador,
│                                 varios_organizadores, login_gestor, perfis, evento_conta
│                                 (as quatro últimas foram escritas à mão para preservar dados)
│
├── src/
│   ├── main.ts                   Ponto de entrada (carrega config, sobe o Nest)
│   ├── app.module.ts             Módulo raiz; `GET /saude` e `GET /saude/contrato`
│   ├── configurar-app.ts         Middlewares globais: helmet, CORS, CSRF, pipes, filtro de erros
│   │
│   ├── auth/                     Autenticação
│   │   ├── auth.controller.ts    Rotas /auth/*
│   │   ├── auth.service.ts       Login, sessão, "minha conta", esqueci a senha, recuperação
│   │   ├── auth.guard.ts         AdminGuard (exige sessão), TesoureiroGuard, PerfilAdminGuard
│   │   ├── login-cripto.service.ts   Par RSA-OAEP em memória; decifra a senha; barra repetição
│   │   ├── codigos.service.ts    Códigos de recuperação (8, uso único)
│   │   ├── senha.ts              Política de senha (tamanho, comuns, nome/e-mail) e hash
│   │   └── senha.spec.ts
│   │
│   ├── usuarios/                 Contas e perfis (área do administrador)
│   │   ├── usuarios.controller.ts   /usuarios/* e /convite-organizador/:token
│   │   ├── usuarios.service.ts   Criar conta, perfis, ativar/desativar, proteção do último admin
│   │   └── convites.service.ts   Convites de organizador (7 dias, uso único, só o hash no banco)
│   │
│   ├── boloes/                   Parte do tesoureiro (dono do bolão)
│   │   ├── boloes.controller.ts  /boloes/* e /caixa/megasena
│   │   ├── boloes.service.ts     Criar/editar, participantes, pagamentos, jogos, resultado, exportação
│   │   ├── dono.guard.ts         Isola por dono: bolão de outra pessoa responde 404
│   │   ├── carregar.ts           Carrega o bolão com participantes e jogos
│   │   ├── resumo.ts             Totais, pesos e rateio (SQL agregado + regras compartilhadas)
│   │   ├── dto.ts                DTOs validados
│   │   └── resumo.spec.ts
│   │
│   ├── publico/                  Parte do participante (por link de convite)
│   │   ├── publico.controller.ts /convites/:convite/* e /participacoes
│   │   └── publico.service.ts    Inscrição, vínculo com conta, painel, jogos do participante
│   │
│   ├── caixa/                    Cliente da API pública da Caixa (resultado e estimativa)
│   │   ├── caixa.service.ts      Timeout 6 s, cache de 10 min, leitura limitada, valida rateio
│   │   └── caixa*.spec.ts
│   │
│   ├── pix/                      Gerador do Pix copia e cola (BR Code, CRC16)
│   │   ├── pix.ts
│   │   └── pix.spec.ts
│   │
│   ├── mail/                     Envio de e-mail
│   │   ├── mail.service.ts       Transporte nodemailer; HELO e TLS do relay local
│   │   ├── layout.ts             Gerador do HTML e do texto puro dos e-mails
│   │   └── *.spec.ts
│   │
│   ├── common/                   Peças transversais
│   │   ├── config.ts             Leitura única e validada do ambiente
│   │   ├── seguranca.middleware.ts   Proteção CSRF (X-Bolao + Origin) e cabeçalhos sem cache
│   │   ├── cookies.ts            Cookies de sessão (`__Host-` em produção)
│   │   ├── tokens.ts             Tokens opacos de 32 bytes e hash sha256
│   │   ├── limites.service.ts    Limite de tentativas persistido no Postgres (advisory lock)
│   │   ├── validacao.ts          Erros de validação por campo, sem ecoar a entrada
│   │   ├── filtro-erros.ts       Todo erro sai como { codigo, mensagem } de texto fixo
│   │   ├── erros.ts, id.pipe.ts
│   │
│   ├── prisma/prisma.service.ts  Conexão com o Postgres
│   │
│   └── shared/                   CONTRATO COMPARTILHADO COM O FRONT (cópia idêntica nos dois repos)
│       ├── regras.ts             Regras puras: dezenas, preço, conferência, rateio, formatação
│       ├── tipos.ts              Tipos das respostas da API
│       ├── contrato.json         Impressão digital (sha256) dos dois arquivos acima
│       └── *.spec.ts
│
├── test/                         Testes ponta a ponta (Postgres real, supertest)
│   ├── fluxo.e2e-spec.ts         Fluxo completo do bolão
│   ├── seguranca.e2e-spec.ts     CSRF, CORS, cookies, cabeçalhos, validação
│   ├── usuarios.e2e-spec.ts      Perfis, convites, último admin
│   ├── auditoria / baud / rval   Regressões dos achados da auditoria e da revalidação
│   └── util.ts, env.ts, global-setup.ts, jest-e2e.json
│
├── scripts/
│   ├── backup.sh                 Backup atômico do Postgres para uso manual/local
│   └── gerar-contrato.mjs        Gera e confere o contrato.json
│
├── deploy/                       Tudo que roda na VPS
│   ├── README.md                 Passo a passo de montagem e operação
│   ├── provisionar-vps.sh        Instala Docker, usuário `deploy`, pastas e o comando de deploy
│   ├── bolao-deploy              Comando forçado da chave de deploy (4 ações validadas)
│   ├── env.homolog.example       Modelo do .env da homologação
│   ├── env.producao.example      Modelo do .env da produção
│   └── initdb/01-papel-app.sh    Cria o papel `bolao_app` (só DML) na primeira subida do Postgres
│
└── .github/workflows/
    ├── esteira.yml               Confere o caminho de promoção (dev -> homolog -> main)
    └── deploy.yml                Verificação, e2e, imagem, deploy por SSH, health check, rollback
```

## 4. Modelo de dados

Dinheiro sempre em **centavos** (inteiro). Prêmios e rateio usam `BigInt`, porque um prêmio da Virada passa de R$ 100 milhões.

| Modelo | Para que serve |
|---|---|
| `Usuario` | Conta com e-mail, nome, `admin`, `tesoureiro` (combináveis), `ativo` e `senhaHash` (nulo = convite ainda não aceito). |
| `Sessao` | Sessão no servidor: só o sha256 do token fica no banco. Vale 7 dias no total e 48 h sem uso. |
| `Tentativa` | Contadores do limite de tentativas (login, esqueci a senha, inscrição, jogos), por chave. |
| `ConviteOrganizador` | Link para criar a conta ou trocar a senha: 7 dias, uso único, só o hash no banco. |
| `CodigoRecuperacao` | Oito códigos de uso único por conta, só o hash no banco. |
| `AparelhoOrganizador` | Aparelho do organizador, identificado por um token (só o hash fica no banco) e ligado à conta. |
| `EventoConta` | Trilha de ações sobre a conta (link emitido, senha trocada, perfis). A própria pessoa vê em "Minha conta". |
| `Bolao` | O bolão: dono (tesoureiro), tipo (`VIRADA` ou `NORMAL`), token do convite, concurso, data do sorteio, preço da aposta simples, limites, Pix, resultado e prêmios por faixa. |
| `Participante` | Pessoa dentro de um bolão: nome, WhatsApp, valor pago, e a conta (`usuarioId`) quando participa logada. |
| `DispositivoAcesso` | Liga o aparelho do participante (cookie aleatório, só o hash no banco) ao cadastro dele. |
| `Jogo` | Dezenas de um participante, se veio da surpresinha, se foi `registrado` na Caixa e o comprovante. |
| `Evento` | Histórico de tudo que mexe com dinheiro e resultado (inscrição, pagamento, registro, resultado). |

Relações principais: `Usuario 1-N Bolao` (dono, `onDelete: Restrict`); `Bolao 1-N Participante/Jogo/Evento` (cascata); `Participante 1-N Jogo`; `Usuario 1-N Participante` (opcional, `SetNull`).

## 5. Regras de negócio

As regras puras vivem em `src/shared/regras.ts` (idênticas no front):

- **Dezenas**: de 1 a 60; um jogo tem de 6 a 20 dezenas (o bolão limita a 10 por participante por padrão). Há `surpresinha`, que sorteia com `crypto.getRandomValues` sem viés.
- **Preço do jogo**: `C(k, 6) x preço da aposta simples` (R$ 6,00 por padrão, editável). Um jogo de 7 dezenas são 7 apostas simples, R$ 42,00.
- **Participação por jogos, não por cotas**: cada pessoa escolhe quantos jogos quer e a conta é a soma.
- **Só jogo registrado conta no rateio.** O tesoureiro marca o jogo como registrado depois de apostar na Caixa. Isso impede que uma pessoa receba parte do prêmio por um jogo que nunca foi comprado.
- **Peso no rateio** = `min(valor pago, valor dos jogos registrados)`. O prêmio é dividido proporcionalmente ao peso, com o método do **maior resto**, então a soma das partes é exatamente o prêmio, sem sobrar nem faltar centavo.
- **Faixas**: conferência de sena, quina e quadra por jogo; o prêmio do bolão é a soma dos prêmios de cada jogo registrado.
- **Pix**: BR Code estático (CRC16, campos até 99 caracteres) com identificador `BOL<bolão>P<participante>`. A chave é validada ao salvar.
- **Travas**:
  - `aceitaApostas` exige data do sorteio e ausência de resultado; depois do sorteio, inscrições e jogos fecham.
  - Mexer em dinheiro ou jogos de um bolão travado exige confirmação explícita (`?confirmar=1`, código `bolao_travado`) e fica registrado no histórico.
  - Teto de R$ 1.000.000 devidos por participante.
- **Caixa**: o resultado e a estimativa vêm da API pública da Caixa; resultados sem rateio completo são rejeitados. Também é possível lançar o resultado manualmente.
- **Exportação**: CSV para a lotérica ou para digitar no app Loterias Caixa, com neutralização de injeção de fórmula (CSV injection). **Só o tesoureiro dono exporta.**

## 6. Perfis e permissões

Os perfis se combinam: uma pessoa pode ser administradora, tesoureira, as duas coisas ou nenhuma (só participa).

| Ação | Sem login (participante por link) | Logado sem perfil | Tesoureiro | Administrador |
|---|:-:|:-:|:-:|:-:|
| Ver o convite e se inscrever | sim | sim | sim | sim |
| Montar os próprios jogos, ver o painel, Pix e calculadora | sim | sim | sim | sim |
| Ver participações em qualquer aparelho | não | sim | sim | sim |
| Criar bolão, configurar Pix, convidar | não | não | sim (só os seus) | não, a menos que também seja tesoureiro |
| Confirmar pagamentos, registrar jogos, lançar resultado | não | não | sim (só os seus) | não, a menos que também seja tesoureiro |
| **Exportar os jogos** | não | não | **sim (só os seus)** | não, a menos que seja o dono |
| Gerenciar contas, perfis e links de acesso | não | não | não | sim |

Regras de proteção:

- **Isolamento por dono**: um tesoureiro nunca enxerga bolão de outro; o `DonoDoBolaoGuard` responde 404 (não 403) para não revelar que o bolão existe.
- **Último administrador**: nunca é possível tirar o perfil ou desativar o último admin ativo com senha definida. A checagem roda sob um advisory lock global do Postgres, então duas requisições simultâneas não conseguem zerar os administradores.
- **O administrador não vê nem altera bolões de outras pessoas** só por ser admin.
- O primeiro administrador nasce do `ADMIN_EMAIL` e `ADMIN_PASSWORD` do `.env`, apenas no primeiro boot.

## 7. Referência da API

Todas as escritas exigem o cabeçalho `X-Bolao: 1` e `Origin` permitido. Os erros têm sempre o formato `{ codigo, mensagem }`; falhas de validação trazem também `campos`: `{ "nome": "Use pelo menos 2 caracteres." }`.

### Sistema

| Método e rota | Descrição |
|---|---|
| `GET /saude` | Verifica a conexão com o banco. Usada pelo healthcheck do Docker e pelo deploy. |
| `GET /saude/contrato` | Impressão digital do contrato compartilhado; o deploy compara com a do front. |

### Autenticação (`/auth`)

| Método e rota | Acesso | Descrição |
|---|---|---|
| `GET /auth/chave-publica` | público | Chave RSA-OAEP para cifrar a senha. |
| `POST /auth/entrar` | público, com limite | Login (e-mail e senha cifrada). Cria a sessão em cookie. |
| `POST /auth/sair` | sessão | Encerra a sessão. |
| `GET /auth/eu` | sessão | Quem sou eu e meus perfis. |
| `GET /auth/atividade` | sessão | Trilha de ações da minha conta. |
| `POST /auth/senha` | sessão | Troca a senha (exige a senha atual). |
| `POST /auth/esqueci` | público, com limite | "Esqueci minha senha". Resposta sempre igual (202), o envio roda em segundo plano. |
| `GET /auth/codigos`, `POST /auth/codigos` | sessão | Ver a situação e gerar novos códigos de recuperação. |
| `POST /auth/recuperar` | público, com limite | Nova senha por código de recuperação. |

### Contas (`/usuarios`, só administrador)

| Método e rota | Descrição |
|---|---|
| `GET /usuarios`, `POST /usuarios` | Listar contas; criar conta e gerar o link de convite. |
| `PATCH /usuarios/:uid/perfis` | Alterar `admin` e `tesoureiro`. |
| `POST /usuarios/:uid/ativo` | Ativar ou desativar (derruba as sessões na hora). |
| `POST /usuarios/:uid/link` | Gerar novo link (criar conta ou trocar senha). |
| `GET/POST /convite-organizador/:token` | Público: abrir e aceitar o convite (define nome e senha). |

### Tesoureiro (`/boloes`, `/caixa`)

| Método e rota | Descrição |
|---|---|
| `GET /boloes`, `POST /boloes` | Meus bolões; criar. |
| `GET/PATCH /boloes/:id` | Ver tudo do bolão; editar (nome, data, preço, limites, Pix, instruções). |
| `POST /boloes/:id/excluir` | Excluir (exige digitar o nome exato). |
| `POST /boloes/:id/inscricoes` | Abrir ou fechar inscrições. |
| `POST /boloes/:id/convite` | Gerar novo link de convite (invalida o anterior). |
| `POST /boloes/:id/participantes`, `PATCH`/`DELETE .../:pid` | Adicionar, editar e remover participantes. |
| `POST /boloes/:id/participantes/:pid/pagamento` | Confirmar o valor recebido. |
| `POST /boloes/:id/jogos`, `DELETE .../jogos/:jid` | Lançar jogos pelo organizador; remover. |
| `POST /boloes/:id/jogos/:jid/registro` | Marcar como registrado na Caixa (com comprovante). |
| `POST /boloes/:id/resultado`, `POST .../resultado/caixa`, `DELETE .../resultado` | Lançar manualmente, importar da Caixa ou desfazer. |
| `GET /boloes/:id/eventos` | Histórico do bolão. |
| `GET /boloes/:id/exportar.csv` | Exportar os jogos (só o dono). |
| `GET /caixa/megasena`, `GET /caixa/megasena/:numero` | Último resultado ou um concurso, via API pública da Caixa. |

### Participante (`/convites/:convite`, `/participacoes`)

| Método e rota | Descrição |
|---|---|
| `GET /convites/:convite` | Dados públicos do bolão e se este aparelho já está inscrito. |
| `POST /convites/:convite/inscricao` | Inscrever-se (nome e WhatsApp opcional). |
| `POST /convites/:convite/vincular` | Vincular o cadastro do aparelho à conta logada. |
| `GET /convites/:convite/painel` | Meu painel: jogos, quanto devo, Pix, calculadora. |
| `POST /convites/:convite/jogos`, `DELETE .../jogos/:jid` | Adicionar jogo (inclusive surpresinha) ou remover um ainda não pago. |
| `GET /participacoes` | Meus bolões em qualquer aparelho (conta logada). |

## 8. Segurança

O modelo de segurança segue o padrão descrito abaixo. Em resumo, por camada:

- **Sessão**: token opaco de 32 bytes em cookie `HttpOnly`, `Secure`, `SameSite`, com prefixo `__Host-` em produção; só o sha256 vai ao banco; expira em 7 dias no total e 48 h de inatividade.
- **CSRF**: toda escrita exige `X-Bolao: 1` **e** `Origin` na lista de `CORS_ORIGINS`.
- **CORS**: apenas as origens configuradas; em produção só `https://`.
- **Login**: senha cifrada no navegador (RSA-OAEP com SHA-256), chave só em memória (um par novo a cada boot) e repetição de cifra bloqueada; mensagem única para e-mail inexistente ou senha errada.
- **Limites de tentativa**: persistidos no Postgres com advisory lock, por IP (IPv6 agrupado em /64) e por conta, com resposta uniforme.
- **Senhas**: 12 a 128 caracteres, recusa senhas comuns e iguais ao nome ou e-mail.
- **Convites e códigos**: só o hash é guardado, uso único, com prazo.
- **Entrada**: `whitelist` e `forbidNonWhitelisted` em todo DTO; texto sem caracteres de controle; **os erros nunca ecoam o que o cliente enviou** (mensagens fixas por regra, nome de campo desconhecido não volta).
- **Banco**: a API não tem permissão de DDL; migrações só pelo dono, fora do processo da API.
- **Rede**: tudo em `127.0.0.1`; `TRUST_PROXY=loopback` atrás do nginx; Postfix só em loopback.
- **Container**: imagem fixada por digest, limites de memória, usuário sem privilégio, healthcheck.
- **Deploy**: chave SSH dedicada com **comando forçado** (não abre shell), `known_hosts` fixado, travas de concorrência e de disco.
- **Cadeia de suprimentos**: `pnpm audit` na esteira e `overrides` para versões corrigidas.

## 9. Configuração (variáveis de ambiente)

Lidas e validadas uma vez em `src/common/config.ts`. Modelos prontos: `.env.example` (local) e `deploy/env.*.example` (servidor).

| Variável | Obrigatória | Descrição |
|---|:-:|---|
| `NODE_ENV` | sim em produção | `production` liga cookies `__Host-`, exige CORS em `https://` e endurece os cabeçalhos. |
| `PORT`, `HOST` | não | Porta (padrão 3333) e interface (`127.0.0.1` no servidor). |
| `DATABASE_URL` | sim | Conexão da API (papel `bolao_app` no servidor). |
| `MIGRATION_DATABASE_URL` | só no deploy | Dono do banco, usada **apenas** pela migração e removida antes da API subir. |
| `CORS_ORIGINS` | sim | Origens do front, separadas por vírgula. |
| `TRUST_PROXY` | no servidor | `loopback` atrás do nginx da mesma máquina; vazio localmente. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | no 1º boot | Cria o primeiro administrador (senha de 12+ caracteres). Depois de criado, mudar aqui **não** troca a senha; apague a senha do `.env`. |
| `CAIXA_API_URL` | não | Liga a consulta à API pública da Caixa. |
| `APP_URL` | recomendada | Endereço público do front, usado nos links dos e-mails. Nunca é deduzido da requisição (evita phishing assinado por nós). |
| `SMTP_URL` | não | Sem ela a API sobe normal e o "esqueci minha senha" responde igual, mas não envia. No servidor: `smtp://127.0.0.1:25`. |
| `MAIL_FROM` | não | Remetente. Padrão `Bolão da Mega <nao-responda@joekyy.com.br>`. |
| `MAIL_HELO` | com relay | Nome anunciado no EHLO (FQDN que resolva para a VPS). |
| `SMTP_TLS_SERVERNAME` | não | Nome contra o qual validar o certificado do relay, quando difere do endereço. |
| `POSTGRES_*`, `BOLAO_APP_PASSWORD`, `COMPOSE_PROJECT_NAME`, `API_PORT`, `INITDB_DIR` | no servidor | Usadas pelo `docker-compose.yml`. |

## 10. Rodando localmente

Requisitos: Node 22, pnpm, Docker.

```bash
pnpm install
cp .env.example .env            # ajuste as senhas
docker compose up -d postgres   # Postgres local em 127.0.0.1:5433
pnpm prisma migrate deploy      # aplica as migrações
pnpm start:dev                  # API em http://localhost:3333 (com watch)
```

Com o front rodando em `http://localhost:3000`, o login funciona direto (o `CORS_ORIGINS` padrão já o aceita). O primeiro administrador sai do `ADMIN_EMAIL` e `ADMIN_PASSWORD` do `.env`.

Scripts úteis:

| Comando | O que faz |
|---|---|
| `pnpm start:dev` | API com recarga automática |
| `pnpm build` / `pnpm start` | Compila e roda `dist/main.js` |
| `pnpm typecheck` | `prisma generate` e `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Testes unitários (Jest) |
| `pnpm test:e2e` | Testes ponta a ponta (precisam do Postgres) |
| `pnpm contrato:gerar` | Atualiza `src/shared/contrato.json` |
| `pnpm backup` | Backup do Postgres (ver [Operação](#15-operação)) |

## 11. Testes

- **Unitários** (`pnpm test`, ~60 testes): regras (`regras`, `resumo`), Pix, política de senha, cliente da Caixa e seu cache, layout e transporte do e-mail, contrato.
- **Ponta a ponta** (`pnpm test:e2e`, ~76 testes): sobem a aplicação inteira contra um Postgres real. Cobrem o fluxo completo do bolão, segurança (CSRF, CORS, cookies, cabeçalhos, erros sem eco), perfis e convites, e os achados da auditoria e da revalidação (`auditoria`, `baud`, `rval`). A mesma suíte roda na esteira, com um Postgres de serviço.

Os e2e usam `TEST_DATABASE_URL` ou, na falta dele, o `DATABASE_URL` do `.env`. Use um banco descartável: a suíte limpa as tabelas.

## 12. Contrato com o front

`src/shared/regras.ts` e `src/shared/tipos.ts` existem **idênticos** nos dois repositórios (o front os usa como o pacote `@bolao/shared`). O `contrato.json` guarda o sha256 dos dois.

- Mudou um desses arquivos? Rode `pnpm contrato:gerar`, copie os arquivos e o `contrato.json` para o outro repositório e publique os dois.
- A esteira confere o contrato local (`gerar-contrato.mjs --conferir`) e, no deploy, compara o `contrato.json` do back com o do front (`GET /saude/contrato`); divergência avisa no log.

## 13. E-mail

Hoje o único e-mail é o do **"esqueci minha senha"** (e ativação de conta). O envio segue o modelo do gestor de conteúdo da Nahub: **o Postfix do próprio servidor é o relay, sem credencial.**

- **Transporte** (`src/mail/mail.service.ts`): `SMTP_URL=smtp://127.0.0.1:25`. O HELO vem de `MAIL_HELO`. A verificação do certificado do relay só é dispensada quando o endereço é privado (127.x, 10.x, 172.16-31.x, 192.168.x, localhost); um nome de domínio como `127.evil.com` nunca é tratado como privado. Para relay público a verificação continua valendo.
- **Postfix** (na VPS): escuta só em `127.0.0.1:25`, `myhostname` e `smtp_helo_name` com FQDN válido, e `smtpd_milters` apontando para o OpenDKIM (`127.0.0.1:8891`).
- **Autenticação do remetente** (domínio `joekyy.com.br`): SPF inclui o IP da VPS e o DKIM assina com o seletor `bolao` (chave publicada em `bolao._domainkey`). Sem isso o Gmail tende a mandar para o spam.
- **Layout** (`src/mail/layout.ts`): gerador único em tabelas, com botão compatível com Outlook, cores explícitas (não depende do modo escuro do cliente), pré-cabeçalho, versão em texto puro e o endereço do link visível sob o botão. O HTML escapa todo texto de usuário.
- **Privacidade nos logs**: o conteúdo (que traz o link) nunca é registrado; falhas registram só o destinatário mascarado.

## 14. CI/CD e ambientes

### Branches e promoção

```
dev  --PR-->  homolog  --PR-->  main
              (deploy automático)   (deploy só com disparo manual e frase de confirmação)
```

| Branch | Ambiente | Como publica |
|---|---|---|
| `dev` | nenhum | Só roda verificação (lint, tipos, testes, build, audit e e2e). |
| `homolog` | Homologação | Merge do PR dispara o deploy automático. |
| `main` | Produção | Merge só roda a verificação. A publicação é por **`workflow_dispatch`** com a frase `publicar producao`. |

O workflow `esteira.yml` recusa PR que pule etapa (para `homolog` só vindo de `dev`; para `main` só vindo de `homolog`). Como o repositório é privado, a exigência de revisores no ambiente e a proteção de branch (recursos do plano Pro) não estão ativas; a proteção equivalente é a frase de confirmação, a guarda de origem e a esteira de promoção.

### O que o `deploy.yml` faz

1. **Verificação** (`Lint, tipos, testes, build e audit`) e **e2e com Postgres real**.
2. **Imagem Docker** construída (em PR para `homolog` ou `main`, sem publicar).
3. **Guarda de origem** (em `main`): o commit precisa ter vindo pela esteira.
4. **Publicar na VPS**: monta o SSH com a chave do deploy e o host fixado; pula se o commit já está no ar; constrói a imagem e envia por `docker save | gzip | ssh` (sem registro de imagens); chama o comando forçado `bolao-deploy`, que migra, sobe e confere a saúde, **voltando para a imagem anterior se falhar**; confere a saúde pelo endereço público; compara o contrato com o do front.
5. Arquivos de documentação não disparam a esteira (`paths-ignore`).

### O comando de deploy da VPS

`/usr/local/sbin/bolao-deploy` é o **único** comando que a chave do CI pode executar (`restrict,command=...`). Aceita só quatro ações, com argumentos validados: `carregar-imagem`, `atualizar-compose`, `implantar` e `estado`. Usa `flock` (um deploy por vez), recusa se houver menos de 3 GB de disco livre e mantém as 2 últimas imagens.

### Segredos e variáveis (por ambiente do GitHub: `homologacao` e `producao`)

| Nome | Tipo | Conteúdo |
|---|---|---|
| `DEPLOY_SSH_KEY` | segredo | Chave privada do deploy (sem shell, só o comando forçado) |
| `DEPLOY_KNOWN_HOSTS` | segredo | Impressão digital do servidor (`[host]:porta chave`) |
| `DEPLOY_HOST`, `DEPLOY_PORT` | segredo | IP e porta SSH da VPS |
| `URL_API`, `URL_FRONT` | variável | Endereços públicos do ambiente (health check e contrato) |

### Ambientes na VPS

| | Produção | Homologação |
|---|---|---|
| Pasta | `/srv/bolao/producao/{back,web}` | `/srv/bolao/homolog/{back,web}` |
| Portas (web / API / Postgres) | 3000 / 3333 / 5433 | 3400 / 3433 / 5533 |
| Projeto Compose | `bolao-prod-back`, `bolao-prod-web` | `bolao-homolog-back`, `bolao-homolog-web` |
| Domínios | `bolao.` e `api.bolao.joekyy.com.br` | `homolog-bolao.` e `api.homolog-bolao.joekyy.com.br` |

Cada ambiente tem o seu `COMPOSE_PROJECT_NAME`: sem isso dois ambientes derivariam o mesmo projeto e um `down` na homologação derrubaria a produção.

Passo a passo de montagem (provisionamento, chave, `.env`, sites, DNS, certificados, segredos): [`deploy/README.md`](deploy/README.md).

## 15. Operação

- **Estado do que está no ar**: `ssh -i ~/.ssh/bolao_deploy -p 22022 deploy@143.95.185.142 "estado <homolog|producao> back"`.
- **Logs**: `docker logs bolao-<prod|homolog>-back-api-1`. Os logs não contêm links, senhas nem credenciais.
- **Migrações**: rodam sozinhas na subida do container, com o papel dono.
- **Reversão**: o deploy volta sozinho para a imagem anterior se a saúde falhar. Para voltar manualmente, rode o job de deploy do commit anterior (as duas últimas imagens ficam na VPS).
- **Backup**: `deploy/bolao-backup` (instalado em `/usr/local/sbin`) roda pelo cron (`/etc/cron.d/bolao-backup`) como `deploy`: dump diário às 04:15 (produção) e 04:25 (homologação), atômico, guardando 30 dias em `/srv/bolao/<ambiente>/back/backups` (modo 700). Aos domingos, `verificar` restaura o dump mais recente num banco temporário, confere tabelas e usuário e apaga o temporário. Sinais: `backups/ultimo-ok` (data do último bom), `backups/ULTIMA-FALHA` (existe se o último falhou) e `backups/backup.log`. Restaurar: `gunzip -c backups/bolao-AAAAMMDD-HHMMSS.sql.gz | docker compose -p <projeto> exec -T postgres psql -U bolao -d bolao`. **Ainda não há cópia para fora da VPS** (ver pendências).
- **Primeiro acesso do administrador**: a senha inicial está em `/srv/bolao/<ambiente>/back/.env`. Entre, troque em "Minha conta" e apague a linha `ADMIN_PASSWORD` do `.env`.
- **Certificados**: emitidos com acme.sh (ZeroSSL, validação HTTP-01) e instalados em `/etc/nginx/ssl-certificates/`; a renovação é automática pelo cron do acme.sh, com recarga do nginx. (O Let's Encrypt não conseguiu validar o DNS da HostGator, por isso a escolha.)
- **Memória**: a VPS tem 2 GB, compartilhados com CloudPanel e outros serviços. Os limites são Postgres 512 MB, API 384 MB e web 256 MB por ambiente; o uso real fica perto de 40 MB por container.

## 16. Documentos relacionados

- [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md) e [`LICENSE`](LICENSE) (MIT): contribuição, relato de vulnerabilidades e licença.
- [`deploy/README.md`](deploy/README.md): publicação e operação na VPS.
- Front-end: [`JoeKyy/bolao-web`](https://github.com/JoeKyy/bolao-web).

## 17. Pendências conhecidas

- **Cópia externa do backup**: o backup diário já roda, mas os arquivos ficam só na própria VPS. Falta definir o destino fora dela (bucket S3/Backblaze via rclone, Google Drive ou cópia puxada de outra máquina).
- **Retenção de dados**: a tela de inscrição promete apagar os dados quando o bolão acabar, mas a rotina de limpeza ainda não existe.
- **DMARC** do domínio de e-mail ainda não publicado (recomendado `p=none` para começar).
- **Memória e serviços da VPS**: há serviços sem uso (MySQL, FTP) escutando em todas as interfaces; vale desligar ou restringir.
