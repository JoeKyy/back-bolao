# Fixada por digest (SEC-12). Atualizar: conferir o digest novo de node:22-alpine e trocar aqui.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm prisma:generate && pnpm build

# Só dependências de produção na imagem final.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --prod --frozen-lockfile && pnpm prisma:generate

FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
USER node
EXPOSE 3333
# BAUD-07 (como o AUD-07 do gestor): as migrações rodam com MIGRATION_DATABASE_URL (papel dono do
# schema) e a API sobe SEM essa credencial, com DATABASE_URL (papel só de dados). O `env -u` tira
# a credencial das migrações do ambiente da API: um processo comprometido não herda o papel mais
# poderoso. Sem MIGRATION_DATABASE_URL tudo usa DATABASE_URL (desenvolvimento local).
CMD ["sh", "-c", "DATABASE_URL=\"${MIGRATION_DATABASE_URL:-$DATABASE_URL}\" npx prisma migrate deploy && env -u MIGRATION_DATABASE_URL node dist/main.js"]
