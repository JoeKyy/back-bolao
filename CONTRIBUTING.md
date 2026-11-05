# Como contribuir

Obrigado pelo interesse no Bolão da Mega. Este repositório é a API (NestJS, Prisma e Postgres); a interface web (Next.js) fica em outro repositório. O app apenas organiza o bolão: não vende apostas, não recebe dinheiro e não confere Pix. Propostas que mudem isso não serão aceitas.

## Antes de começar

- Procure nas issues se o assunto já foi tratado. Para mudanças grandes, abra uma issue antes e combine a direção.
- **Vulnerabilidades não vão em issue pública.** Veja [`SECURITY.md`](SECURITY.md).
- Ao contribuir, você concorda que sua contribuição seja licenciada sob a [MIT](LICENSE).

## Fluxo

1. Faça um fork e crie uma branch a partir de `dev` (`feat/...`, `fix/...` ou `docs/...`).
2. Faça mudanças pequenas e focadas, com teste quando mudar comportamento.
3. Rode localmente o que a esteira roda (abaixo) até passar.
4. Abra o pull request **para `dev`**, descrevendo o problema, a solução e como testou.
5. Um PR de colaborador externo só roda a esteira depois da aprovação do mantenedor.
6. A promoção segue `dev` para `homolog` (publica a homologação) e `homolog` para `main` (aprovação do mantenedor). A produção só sobe por disparo manual do mantenedor. Ninguém além dele publica.

A `main` é protegida: só recebe pull request com 1 aprovação e com os checks da esteira verdes. Não há push direto.

## O que rodar antes do PR

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e   # precisa de Postgres (docker compose up -d postgres)
pnpm build
```

Se mudar a API, regenere o contrato (`contrato.json`) e abra o PR correspondente no `bolao-web`. Veja a seção "Contrato com o front" do README.

## Padrões

- Texto para pessoas (interface, mensagens, documentos) em português do Brasil, sem travessão. Use ponto, vírgula, parênteses ou conectivos.
- Mensagens de erro da API são fixas e nunca repetem o que o usuário digitou.
- Nunca inclua segredos, senhas, chaves, `.env` ou dados reais de participantes em código, testes, issues ou capturas de tela. Use valores de exemplo.
- Commits curtos e no imperativo, em português.

## Dúvidas

Abra uma issue com a etiqueta de pergunta.
