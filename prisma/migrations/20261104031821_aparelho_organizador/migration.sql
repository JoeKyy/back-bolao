-- CreateTable
CREATE TABLE "AparelhoOrganizador" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AparelhoOrganizador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AparelhoOrganizador_tokenHash_key" ON "AparelhoOrganizador"("tokenHash");

-- CreateIndex
CREATE INDEX "AparelhoOrganizador_usuarioId_idx" ON "AparelhoOrganizador"("usuarioId");

-- AddForeignKey
ALTER TABLE "AparelhoOrganizador" ADD CONSTRAINT "AparelhoOrganizador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
