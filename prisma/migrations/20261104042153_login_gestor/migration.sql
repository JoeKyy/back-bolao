-- Login no esquema do gestor: conta criada antes (senha nula = convite pendente), convite sempre
-- ligado a uma conta, códigos de recuperação. Escrita à mão para não perder convites pendentes.

-- Senha passa a ser opcional (conta pendente).
ALTER TABLE "Usuario" ALTER COLUMN "senhaHash" DROP NOT NULL;

-- Convites de conta nova ainda vivos viram contas pendentes com o mesmo nome e e-mail.
INSERT INTO "Usuario" ("email", "nome", "papel", "ativo", "senhaHash", "criadoEm")
SELECT DISTINCT ON (c."email") c."email", c."nome", 'ORGANIZADOR', true, NULL, c."criadoEm"
FROM "ConviteOrganizador" c
WHERE c."usuarioId" IS NULL AND c."usadoEm" IS NULL AND c."expiraEm" > NOW()
  AND NOT EXISTS (SELECT 1 FROM "Usuario" u WHERE u."email" = c."email")
ORDER BY c."email", c."id" DESC;

UPDATE "ConviteOrganizador" c SET "usuarioId" = u."id"
FROM "Usuario" u
WHERE c."usuarioId" IS NULL AND u."email" = c."email";

-- O que sobrou sem conta (usado ou expirado) não serve para nada.
DELETE FROM "ConviteOrganizador" WHERE "usuarioId" IS NULL;

-- DropIndex
DROP INDEX "ConviteOrganizador_email_idx";

-- AlterTable
ALTER TABLE "ConviteOrganizador" DROP COLUMN "email",
DROP COLUMN "nome",
ALTER COLUMN "usuarioId" SET NOT NULL;

-- CreateTable
CREATE TABLE "CodigoRecuperacao" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoRecuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CodigoRecuperacao_codigoHash_key" ON "CodigoRecuperacao"("codigoHash");

-- CreateIndex
CREATE INDEX "CodigoRecuperacao_usuarioId_idx" ON "CodigoRecuperacao"("usuarioId");

-- CreateIndex
CREATE INDEX "ConviteOrganizador_usuarioId_idx" ON "ConviteOrganizador"("usuarioId");

-- AddForeignKey
ALTER TABLE "CodigoRecuperacao" ADD CONSTRAINT "CodigoRecuperacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
