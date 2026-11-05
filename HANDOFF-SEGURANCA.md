# Handoff: segurança e confiabilidade (back)

Aberto em 03/11/2026, reescrito em 04/11/2026 com a separação em `back-bolao` (API) e `bolao-web` (front), no formato de `nahub/back-gestao-conteudo/HANDOFF-SEGURANCA.md`. Os achados do front estão em `bolao-web/HANDOFF-SEGURANCA.md` e os de servidor em `../HANDOFF-INFRA.md`. A análise original do código recebido está em `../legado/HANDOFF-SEGURANCA.md`.

## Fluxo obrigatório

Um achado por vez. Branch de feature, PR para `dev`, PR `dev` para `homolog`, validação completa em homologação pelo Joe, PR `homolog` para `main`, conferência em produção, e `dev` volta a ficar igual a `main`. Nenhuma etapa é marcada sem evidência. Correção reinicia as validações afetadas. Produção só com ordem explícita no chat. Publicar a API compatível antes do front.

## Achados (todos da análise de 03/11/2026, corrigidos na reescrita)

| ID | Gravidade | Problema no legado | Correção | Local | Homolog | Produção |
|---|---|---|---|---|---|---|
| BOL-01 | Alta, P0 | Limite de login usava o 1º valor de `X-Forwarded-For` (falsificável) e vivia na memória. Reproduzido. | `Tentativa` no Postgres; IP de `req.ip` com `trust proxy` só para o proxy definido em `TRUST_PROXY`; 5 por IP e 30 globais em 10 min. e2e: trocar o cabeçalho a cada tentativa dá 429 na 6ª; reiniciar a API não zera. | testado | pendente | pendente |
| BOL-02 | Alta, P1 | Sessão = valor fixo `"admin"` assinado, sem revogação. | Token aleatório de 32 bytes no cookie, só o sha256 no banco (`Sessao`), prazo absoluto de 7 dias e ocioso de 48 h, logout apaga, troca de senha derruba todas. e2e: cookie copiado antes do logout dá 401. | testado | pendente | pendente |
| BOL-03 | Média, P1 | `?erro=` mostrava texto livre da URL. Reproduzido. | Sem mensagens por URL; a API só devolve `{codigo, mensagem}` com texto fixo; validação não ecoa a entrada. e2e. | testado | pendente | pendente |
| BOL-04 | Média, P1 | Pagamento e resultado sem histórico. | `Evento` em toda mudança de pagamento, jogo, registro, resultado e convite; mudar pagamento com resultado exige `confirmarComResultado`; registro de jogo travado após o resultado. e2e. | testado | pendente | pendente |
| BOL-05 | Média, P1 | Inscrição pelo link sem limite. | 10 por IP por bolão em 10 min, teto `maxParticipantes` (padrão 200), 50 jogos por participante, 60 jogos por IP em 10 min, 2.000 por bolão. e2e. | testado | pendente | pendente |
| BOL-06 | Média, P1 | Escritas múltiplas sem transação. | Toda escrita composta em `$transaction` com `SELECT ... FOR UPDATE` na linha do bolão (serializa inscrição e teto). | testado | pendente | pendente |
| BOL-07 | Média, P1 | Sem backup. | `scripts/backup.sh` (pg_dump diário, 30 dias, 600). Falta agendar no cron e testar restauração no servidor. | n/a | pendente | pendente |
| BOL-08 | Média, P2 | Sem cabeçalhos; `X-Powered-By`. Reproduzido. | helmet (CSP `default-src 'none'`, `frame-ancestors 'none'`, nosniff, `no-referrer`, HSTS em produção), `no-store`, corpo JSON até 64 kB. e2e. | testado | pendente | pendente |
| BOL-09 | Média, P2 | Sem CI. | Pendente: `esteira.yml` (lint, typecheck, test, e2e com Postgres de serviço, build, `pnpm audit --prod`) e deploy com verificação de saúde em `/saude` e conferência de `/saude/contrato` com o front. | n/a | pendente | pendente |
| BOL-10 | Média, P2 | LGPD: nome e WhatsApp sem aviso nem retenção. | Aviso na inscrição feito no front. Pendente: rotina de limpeza de bolões encerrados há N meses (decisão de N). | parcial | pendente | pendente |

## Auditoria do agente (04/11/2026), branch `fix/auditoria-agente`

Revisão independente sobre a reescrita. Reproduzidos pelo agente: SEC-01, 03, 04, 05, 07, 08, 10 (e SEC-02 em parte, no Docker do Mac). Cada correção tem teste; os e2e ficam em `test/auditoria.e2e-spec.ts`.

| ID | Gravidade | Problema | Correção | Local | Homolog | Produção |
|---|---|---|---|---|---|---|
| SEC-01 | Alta, P0 | Quem entrava e pagava depois do sorteio levava o prêmio sem ter jogo registrado; dava para reabrir inscrições depois do resultado. | Peso = min(pago, jogos REGISTRADOS); inscrição e jogo recusados a partir de `dataSorteio`; reabrir com resultado ou depois do sorteio dá 409. | testado | pendente | pendente |
| SEC-02 | Alta, P0 | Atrás do Docker com porta publicada, `TRUST_PROXY=loopback` via todos com o IP do gateway (um travaria login e inscrições de todos). | API no compose com `network_mode: host` em 127.0.0.1:`API_PORT`; nginx com `X-Forwarded-For $remote_addr`. Aceite só na homologação: duas origens com chaves de IP diferentes. | n/a | pendente | pendente |
| SEC-03 | Média, P1 | BR Code inválido com chave aleatória + nome de bolão longo (campo 26 > 99). | Descrição cortada para caber; campo > 99 ou fora do ASCII lança erro; e-mail só ASCII. Testes percorrem o EMV inteiro. | testado | pendente | pendente |
| SEC-04 | Média, P1 | Depois do resultado, preço, jogos, remoções e reabertura mudavam o rateio sem confirmação. | `bolaoTravado` (resultado ou sorteio passado) exige `?confirmar=1` em preço, data, jogos, remoções, pagamento e registro; tudo vira `Evento` (inclusive edição de participante); exclusão de bolão vai para o log. | testado | pendente | pendente |
| SEC-05 | Média, P1 | Limites "conta e depois grava": 40 logins paralelos testavam 40 senhas; 8 inscrições paralelas criavam 8 participantes. | `consumir()` com `pg_advisory_xact_lock` registra antes de conferir a senha; inscrição checa aparelho e limite dentro da trava do bolão. e2e com 40 e 8 paralelos. | testado | pendente | pendente |
| SEC-06 | Média, P2 | Teto global de 30 falhas trancava o organizador indefinidamente. | Teto global conta só falhas e não vale para o aparelho conhecido (`AparelhoOrganizador`, cookie `bolao_org`); IPv6 agrupado por /64. | testado | pendente | pendente |
| SEC-07 | Baixa, P2 | Cookie de aparelho aceitava valor escolhido pelo cliente (fixação). | Só reaproveita token já emitido pelo servidor; prefixo `__Host-` nos três cookies em produção. | testado | pendente | pendente |
| SEC-08 | Baixa, P2 | Id acima de int4 dava 500 com stack. | `IdPipe` (1 a 2^31-1, só dígitos) responde 404. | testado | pendente | pendente |
| SEC-09 | Baixa, P2 | Resposta da Caixa lida inteira antes do limite; prêmio sem teto. | Leitura em stream abortando em 200 kB (e por `content-length`); valor acima de R$ 10 bi invalida o resultado. | testado | pendente | pendente |
| SEC-10 | Baixa, P2 | Prêmio total voltava a `Number` antes do rateio. | BigInt até o `ratear`; prêmio acima de 2^53 é recusado; teto de R$ 10 bi por faixa na DTO. | testado | pendente | pendente |
| SEC-11 | Baixa, P2 | `backup.sh` com compose v1, sem `.env`, sem projeto e sem `pipefail`. | bash com `pipefail`, carrega `.env`, exige `COMPOSE_PROJECT_NAME`, usa `docker compose` (cai para v1), confere o fim do dump, `umask 077`. Backup gerado localmente; restauração fica para a homologação. | parcial | pendente | pendente |
| SEC-12 | Baixa, P2 | `.dockerignore` sem `backups`/`.env.*`; `env_file` com todo o `.env`; imagem sem digest; front sem URL da API caía em localhost. | Corrigidos os quatro: ignore ampliado, variáveis explícitas no compose, `node:22-alpine@sha256:fe4f6d…`, build do front falha sem `NEXT_PUBLIC_API_URL`. | testado | pendente | pendente |

Dependências (`pnpm audit --prod`): no back, `multer` (sem upload no código) e `deepmerge-ts` (CLI do Prisma), sem caminho alcançável; reavaliar no próximo ciclo. Front sem alertas.

## Vários organizadores (04/11/2026), branch `feat/varios-organizadores`

Pedido do Joe: o criador do bolão é o tesoureiro; só ele registra o Pix, manda convites, confirma pagamentos, exporta e registra os jogos. Decisões tomadas por segurança (revisáveis): sem cadastro aberto; o ADMIN convida por link de uso único (7 dias); o ADMIN gerencia contas mas não vê os bolões dos outros.

| ID | Item | Como | Evidência |
|---|---|---|---|
| ORG-01 | Dono do bolão | `Bolao.donoId`; migração escrita à mão passa os bolões existentes ao primeiro usuário e o promove a ADMIN (sem perda de dados, conferido no banco de dev). | migração `20261104033039_varios_organizadores` |
| ORG-02 | Isolamento entre organizadores | `DonoDoBolaoGuard` em todas as rotas `boloes/:id` (404 se não for o dono, igual a inexistente); lista e criação filtradas por dono; visão de organizador no painel do participante só para o dono. | e2e: 14 rotas de outro organizador dão 404 e nada muda no bolão |
| ORG-03 | Tesoureiro exclusivo | Planilha, folha, digitação, registro, pagamento, Pix e convite só com sessão do dono. | e2e "tesoureiro": participante e anônimo recebem 401 |
| ORG-04 | Convite de organizador | Token de 32 bytes, só o hash no banco, 7 dias, uso único consumido de forma atômica (3 aceites simultâneos criam 1 conta), convite novo invalida o anterior, e-mail já cadastrado dá 409, senha 12+, limite de 20 por IP em 10 min. | e2e |
| ORG-05 | Gestão de contas | Só ADMIN (`PapelAdminGuard`, 403 para organizador): convidar, desativar (sessões caem na hora, login responde igual a senha errada), reativar, link de troca de senha (derruba as sessões antigas). ADMIN não desativa a si mesmo. | e2e |

## Login no esquema do gestor (04/11/2026), branch `feat/login-gestor`

Pedido do Joe: login por convite e usuário e senha no mesmo esquema do Gestor de Conteúdo. Portado de `nahub/back-gestao-conteudo/src/auth`.

| ID | Item | Como | Evidência |
|---|---|---|---|
| LOG-01 | Conta criada pelo ADMIN | Convidar cria o `Usuario` (nome, e-mail) com `senhaHash` nulo ("convite pendente"); o link (7 dias, uso único, só hash) define a senha. Reemitir o link troca a senha (rota `/organizadores/:uid/link`). Migração `login_gestor` escrita à mão converte convites pendentes em contas pendentes (ensaiada em banco descartável). | e2e; ensaio da migração |
| LOG-02 | Senha cifrada no login | `GET /auth/chave-publica` + RSA-OAEP/SHA-256 no navegador (mesmo código do gestor); texto puro é recusado (400). Chave em memória, renovada a cada subida (uma instância). | e2e; no navegador o corpo do login só tem `email` e `senhaCifrada` |
| LOG-03 | Política de senha | `exigirSenhaAceitavel`: lista do gestor + palavras do bolão (mega, bolão, virada...), sequências e repetição, nome e e-mail; mínimo 12. Vale no convite, na troca e na recuperação. | unitários e e2e |
| LOG-04 | Esqueci minha senha | `POST /auth/esqueci` sempre 202 com a mesma mensagem; 5 por IP em 10 min e 3 por conta por hora; link por e-mail se `SMTP_URL` existir; o link nunca vai para o log. | e2e (mesma resposta; só a conta existente ganha link) |
| LOG-05 | Códigos de recuperação | 8 por lote (alfabeto sem caracteres ambíguos), uso único atômico, só hash; gerar exige a senha atual (com limite); recuperar troca a senha, derruba as sessões e entra. | e2e e navegador |
| LOG-06 | Sessão | Mantida a sessão opaca do bolão (revogação imediata) em vez do JWT + refresh do gestor; para quem usa, o comportamento é o mesmo. Decisão registrada. | n/a |

Pendente: configurar SMTP no servidor (ou aceitar que a recuperação seja só por código e por link do ADMIN).

## Perfis e participante com conta (04/11/2026), branch `feat/perfis`

Pedido do Joe: perfis alterados numa página de usuários como no gestor, porque ele pode ou não ser também tesoureiro e admin.

| ID | Item | Como | Evidência |
|---|---|---|---|
| PERF-01 | Perfis combináveis | `Usuario.admin` e `Usuario.tesoureiro` no lugar do papel único. Admin gerencia contas e perfis; tesoureiro cria e administra os próprios bolões; sem nenhum é pessoa comum. Migração `perfis` escrita à mão converte (ADMIN vira admin e tesoureiro; ORGANIZADOR vira tesoureiro) e foi ensaiada; `prisma migrate diff` fica vazio. | e2e |
| PERF-02 | Último administrador | Alterar perfil ou desativar o último admin ativo dá 409 (`ultimo_admin`), sob trava global de contas. Não desativa a si mesmo. | e2e |
| PERF-03 | Efeito imediato | Perfis são lidos do banco a cada requisição: perder tesoureiro tira a gestão dos bolões na hora (403), mas o participante continua vendo; voltar o perfil restaura. | e2e |
| PERF-04 | Pessoa comum com conta | `Participante.usuarioId`: entra no bolão logada (sem digitar nome), vê o bolão em qualquer aparelho, "Meus bolões" (`/participacoes`) e `POST /convites/:c/vincular` para guardar na conta a participação feita só pelo aparelho. Uma participação por conta por bolão. | e2e |
| PERF-05 | Visão de organizador | Só para o dono do bolão que ainda é tesoureiro. | e2e |

## Auditoria completa (04/11/2026): correções

Relatório em `../auditoria-2026-11-04/RELATORIO.md`. Corrigidos na branch `feat/perfis`:

| ID | Gravidade | Correção | Local | Homolog | Produção |
|---|---|---|---|---|---|
| BAUD-06 | Alta, P1 | `GET /boloes` agrega no banco (contagens, soma paga, quitados por `LATERAL`), sem carregar jogos. Reensaiar o cenário 10x na homologação (aceite: 30 listas simultâneas abaixo de 300 MB). | testado (resultado idêntico ao do resumo) | pendente | pendente |
| BAUD-03 | Média, P1 | Concurso normal exige `dataSorteio` na criação; sem data o bolão não aceita inscrição nem jogo. | testado | pendente | pendente |
| BAUD-05 | Média, P1 | Importação da Caixa recusa (`resultado_incompleto`) faixa com ganhadores e valor zero ou nenhum ganhador. | parcial (regra testada por leitura; falta o formato real logo após o sorteio) | pendente | pendente |
| BAUD-01 | Média, P1 | Login válido não devolve a tentativa; teto por IP 10 em 10 min; aparelho conhecido só dispensa o teto global para a própria conta, ativa. | testado | pendente | pendente |
| BAUD-02 | Média, P1 | `EventoConta`: link emitido, senha por link, perfis, ativação e troca de senha ficam registrados; a pessoa vê em "Atividade da conta". O administrador continua podendo gerar link de troca de senha (necessário para suporte), agora com rastro. Risco aceito e documentado. | testado | pendente | pendente |
| BAUD-04 | Média, P2 | Sobrescrever ou apagar resultado já lançado exige `?confirmar=1`. | testado | pendente | pendente |
| BAUD-08 | Baixa, P2 | Teto de R$ 1.000.000,00 de devido por participante e de valor recebido. | testado | pendente | pendente |
| BAUD-09 | Baixa, P2 | `backup.sh` grava em arquivo parcial e só renomeia depois de conferir o fim do dump. | testado (backup real) | pendente | pendente |
| BAUD-11 | Baixa, P2 | Texto da calculadora por tipo (Virada não acumula; concurso normal acumula). | testado no navegador | pendente | pendente |
| BAUD-07 | Média, P1 | **Aberto:** API conecta como superusuário e roda `migrate deploy` no boot. Seguir o AUD-07 do gestor: papel só DML para a API e `MIGRATION_DATABASE_URL` para as migrações. Fazer na montagem da VPS. | n/a | pendente | pendente |
| BAUD-10 | Média, P1 | **Aberto:** nenhum repositório tem remote. Depende do acesso ao GitHub do Joe. | n/a | pendente | pendente |
| BOL-10 | Média, P2 | **Subestimado pela auditoria:** a tela de inscrição promete apagar os dados quando o bolão acabar, e a rotina não existe. Implementar antes de publicar, ou trocar o texto. | n/a | pendente | pendente |

SEC-06, BOL-01, SEC-05, SEC-01, SEC-04 e ORG-05 foram reabertos pela auditoria e estão cobertos pelas linhas acima.

## Revalidação independente (04/11/2026): resultado e correções

Relatório em `../auditoria-2026-11-04-revalidacao/REVALIDACAO.md`: dos 65 itens, 45 corrigidos, 9 parciais e 11 abertos; **nenhum bloqueador de código** para a homologação (os bloqueios são de infraestrutura). BAUD-06 no cenário 10x: memória de 525 MB (2 listas) e 1.989 MB (30 listas) caiu para 105 MB e 111 MB. Achados novos, corrigidos na branch `fix/revalidacao`:

| ID | Gravidade | Correção | Local | Homolog | Produção |
|---|---|---|---|---|---|
| RVAL-01 | Média | Participação guardada em uma conta não é herdada por outra conta logada no mesmo aparelho (painel, Pix e jogos). | testado | pendente | pendente |
| RVAL-02 | Média | Senha de 1 a 128 caracteres e no máximo 190 bytes (limite do RSA-OAEP do login); a mensagem aparece na tela. | testado | pendente | pendente |
| RVAL-03 | Média | Trocar senha por qualquer caminho (troca, código, link) revoga os links de convite pendentes. | testado | pendente | pendente |
| RVAL-04 | Média | Códigos gerados, senha por código e "esqueci minha senha" entram na atividade da conta. | testado | pendente | pendente |
| RVAL-05 | Baixa | Administrador com convite pendente não conta como administrador que sobra. | testado | pendente | pendente |
| RVAL-06 | Média | "Buscar na Caixa" ignora o cache de 10 min (intervalo mínimo de 30 s); resolve o resíduo do BAUD-05. | testado (unitário com relógio simulado) | pendente | pendente |
| RVAL-07 | Baixa | "Esqueci minha senha" não invalida o link que o administrador gerou. | testado | pendente | pendente |
| RVAL-08 | Baixa | "Esqueci" responde sem esperar a busca nem o envio (tempo uniforme); o link sai em segundo plano. Não medido contra SMTP real. | parcial | pendente | pendente |
| RVAL-09 | Média | `/participacoes` por agregação no banco (como o BAUD-06), máximo de 50. | testado | pendente | pendente |
| RVAL-10 | Baixa | A mesma cifra do login não vale duas vezes (10 min, em memória, uma instância). | testado | pendente | pendente |
| BAUD-03 (resíduo) | Média | Com a Caixa disponível, concurso já apurado é recusado na criação. Não coberto por teste automático (a Caixa fica desligada nos testes). | parcial | pendente | pendente |

Aberto: o aceite do convite deixa a pessoa trocar o nome definido pelo administrador (aceito: é o nome dela). BAUD-06: a meta de p95 abaixo de 200 ms com 30 listas simultâneas não foi atingida (577 ms com 10, 1,1 s com 30 em rajada, ainda abaixo dos 1,4 s anteriores); medir de novo na VPS, dentro do limite de memória do container. GitGuardian (04/11): dois alertas "Generic Password" nos commits `7bc60c9` e `af8576d` são falsos positivos (exemplo `smtps://usuario:senha@...` em comentário e o Postgres descartável do CI); os exemplos foram trocados por placeholders e a senha do banco de teste da esteira passou a ser única por execução. Marcar os incidentes como falso positivo no painel do GitGuardian.

## Novos controles (entraram com a reescrita)

- CSRF: escrita exige `X-Bolao: 1` e `Origin` na lista de `CORS_ORIGINS`; CORS só para essas origens, com credenciais.
- Participante: cookie de aparelho aleatório (só o hash no banco), válido apenas para bolões em que aquele aparelho se inscreveu. Jogo de outro participante responde 404. Painel do participante sem WhatsApp, convite nem Pix do organizador.
- Dinheiro: rateio e prêmio em BigInt (R$ 1 bi em centavos estoura `Number` ao multiplicar por peso). Testado com 97 pesos e R$ 1 bi, soma exata.
- Caixa: API pública não documentada, só no servidor, timeout de 6 s, cache de 10 min, `redirect: "error"`, resposta até 200 kB e conferência campo a campo (`lerConcursoCaixa`). Falha vira 502 com digitação manual de reserva.
- CSV: células que começam com `= + - @` levam apóstrofo (CSV injection). e2e.
- Chave Pix validada (e-mail, CPF, CNPJ, +55, aleatória); texto do BR Code sem acento nem caractere de controle; CRC16 conferido com o vetor padrão.
- Organizador criado no primeiro boot a partir do `.env` (senha 12+); depois disso o `.env` não troca a senha. Bcrypt custo 12; e-mail inexistente compara com hash falso (tempo constante).

## Decisões de produto pendentes

- Participantes veem nome e situação de pagamento uns dos outros (mantido por transparência do grupo).
- Gerar link novo não remove quem já entrou pelo antigo (o acesso é pelo aparelho).
- Prazo de retenção dos dados pessoais depois do sorteio (sugestão: 90 dias após o resultado).

## Evidências (04/11/2026, local)

- `pnpm test`: 44 testes (regras, resumo, Pix, Caixa, contrato). `pnpm test:e2e`: 75 testes contra Postgres 16 real (`bolao_teste`), incluindo os da auditoria. `pnpm lint` e `tsc` sem problemas. `nest build` ok.
- Ponta a ponta com o front e importação real da Caixa (concurso 3080): prêmio de quina R$ 38.878,66 + quadra R$ 514,10 = R$ 39.392,76, igual ao calculado.

## Ambientes

- Local: API em localhost:3333 (`node dist/main.js` ou `pnpm start:dev`), Postgres do `docker-compose` em 127.0.0.1:5433.
- Homologação e produção: VPS HostGator com CloudPanel (ver `../HANDOFF-INFRA.md`).
