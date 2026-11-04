-- Vários organizadores. Migração escrita à mão para preservar dados: os bolões que já existem
-- passam a ser do primeiro usuário (o organizador original), que vira ADMIN.
-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'ORGANIZADOR');


-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nome" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "papel" "Papel" NOT NULL DEFAULT 'ORGANIZADOR';

-- O organizador original (menor id) vira ADMIN.
UPDATE "Usuario" SET "papel" = 'ADMIN' WHERE "id" = (SELECT MIN("id") FROM "Usuario");

-- donoId: entra opcional, recebe o organizador original e só então vira obrigatório.
-- Se houver bolão e nenhum usuário, o SET NOT NULL falha e a migração inteira é desfeita.
ALTER TABLE "Bolao" ADD COLUMN "donoId" INTEGER;
UPDATE "Bolao" SET "donoId" = (SELECT MIN("id") FROM "Usuario") WHERE "donoId" IS NULL;
ALTER TABLE "Bolao" ALTER COLUMN "donoId" SET NOT NULL;

-- CreateTable
CREATE TABLE "ConviteOrganizador" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT '',
    "usuarioId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "ConviteOrganizador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConviteOrganizador_tokenHash_key" ON "ConviteOrganizador"("tokenHash");

-- CreateIndex
CREATE INDEX "ConviteOrganizador_email_idx" ON "ConviteOrganizador"("email");

-- CreateIndex
CREATE INDEX "Bolao_donoId_idx" ON "Bolao"("donoId");

-- AddForeignKey
ALTER TABLE "ConviteOrganizador" ADD CONSTRAINT "ConviteOrganizador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bolao" ADD CONSTRAINT "Bolao_donoId_fkey" FOREIGN KEY ("donoId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
