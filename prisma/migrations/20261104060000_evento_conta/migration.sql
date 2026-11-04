-- Trilha das ações sobre a conta (BAUD-02).
CREATE TABLE "EventoConta" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "porId" INTEGER,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoConta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventoConta_usuarioId_criadoEm_idx" ON "EventoConta"("usuarioId", "criadoEm");

ALTER TABLE "EventoConta" ADD CONSTRAINT "EventoConta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
