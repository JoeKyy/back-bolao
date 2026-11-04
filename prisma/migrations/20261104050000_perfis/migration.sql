-- Perfis combináveis (admin, tesoureiro) no lugar de papel único, e participante com conta.
-- Escrita à mão para converter os dados: ADMIN vira admin + tesoureiro; ORGANIZADOR vira
-- tesoureiro. Ninguém perde acesso.

ALTER TABLE "Usuario" ADD COLUMN "admin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tesoureiro" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Usuario" SET "admin" = true, "tesoureiro" = true WHERE "papel" = 'ADMIN';
UPDATE "Usuario" SET "tesoureiro" = true WHERE "papel" = 'ORGANIZADOR';

ALTER TABLE "Usuario" DROP COLUMN "papel";
DROP TYPE "Papel";

-- Participante pode estar ligado a uma conta (uma por bolão).
ALTER TABLE "Participante" ADD COLUMN "usuarioId" INTEGER;
CREATE UNIQUE INDEX "Participante_bolaoId_usuarioId_key" ON "Participante"("bolaoId", "usuarioId");
CREATE INDEX "Participante_usuarioId_idx" ON "Participante"("usuarioId");
ALTER TABLE "Participante" ADD CONSTRAINT "Participante_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
