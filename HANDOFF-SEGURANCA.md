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

- `pnpm test`: 34 testes (regras, resumo, Pix, Caixa, contrato). `pnpm test:e2e`: 26 testes contra Postgres 16 real (`bolao_teste`). `pnpm lint` e `tsc` sem problemas. `nest build` ok.
- Ponta a ponta com o front e importação real da Caixa (concurso 3080): prêmio de quina R$ 38.878,66 + quadra R$ 514,10 = R$ 39.392,76, igual ao calculado.

## Ambientes

- Local: API em localhost:3333 (`node dist/main.js` ou `pnpm start:dev`), Postgres do `docker-compose` em 127.0.0.1:5433.
- Homologação e produção: VPS HostGator com CloudPanel (ver `../HANDOFF-INFRA.md`).
