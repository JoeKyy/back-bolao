-- Senha escolhida já no pedido de conta (confirmada depois pelo link do e-mail).
ALTER TABLE "VinculoConta" ADD COLUMN "senhaHash" TEXT;

-- Link de acesso emitido pelo organizador para quem perdeu o aparelho/cookie.
CREATE TABLE "AcessoParticipante" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "participanteId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "AcessoParticipante_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcessoParticipante_tokenHash_key" ON "AcessoParticipante"("tokenHash");

CREATE INDEX "AcessoParticipante_participanteId_idx" ON "AcessoParticipante"("participanteId");

ALTER TABLE "AcessoParticipante" ADD CONSTRAINT "AcessoParticipante_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "Participante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
