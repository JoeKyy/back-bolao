-- Pedido de guardar o bolão numa conta, confirmado por e-mail (participante sem conta).
CREATE TABLE "VinculoConta" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "participanteId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "VinculoConta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VinculoConta_tokenHash_key" ON "VinculoConta"("tokenHash");

CREATE INDEX "VinculoConta_participanteId_idx" ON "VinculoConta"("participanteId");

ALTER TABLE "VinculoConta" ADD CONSTRAINT "VinculoConta_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "Participante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
