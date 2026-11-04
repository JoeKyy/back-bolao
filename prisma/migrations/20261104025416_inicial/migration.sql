-- CreateEnum
CREATE TYPE "TipoBolao" AS ENUM ('VIRADA', 'NORMAL');

-- CreateEnum
CREATE TYPE "FonteResultado" AS ENUM ('caixa', 'manual');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sessao" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tentativa" (
    "id" SERIAL NOT NULL,
    "chave" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tentativa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bolao" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoBolao" NOT NULL DEFAULT 'NORMAL',
    "convite" TEXT NOT NULL,
    "concurso" INTEGER,
    "dataSorteio" TIMESTAMP(3),
    "precoSimples" INTEGER NOT NULL DEFAULT 600,
    "maxDezenasParticipante" INTEGER NOT NULL DEFAULT 10,
    "maxParticipantes" INTEGER NOT NULL DEFAULT 200,
    "inscricoesAbertas" BOOLEAN NOT NULL DEFAULT true,
    "instrucoes" TEXT NOT NULL DEFAULT '',
    "pixChave" TEXT,
    "pixNome" TEXT,
    "pixCidade" TEXT,
    "estimativaPremio" BIGINT,
    "resultadoDezenas" INTEGER[],
    "premioSena" BIGINT,
    "premioQuina" BIGINT,
    "premioQuadra" BIGINT,
    "resultadoFonte" "FonteResultado",
    "resultadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bolao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participante" (
    "id" SERIAL NOT NULL,
    "bolaoId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "valorPago" INTEGER NOT NULL DEFAULT 0,
    "pagoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispositivoAcesso" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "participanteId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispositivoAcesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jogo" (
    "id" SERIAL NOT NULL,
    "bolaoId" INTEGER NOT NULL,
    "participanteId" INTEGER NOT NULL,
    "dezenas" INTEGER[],
    "surpresinha" BOOLEAN NOT NULL DEFAULT false,
    "registrado" BOOLEAN NOT NULL DEFAULT false,
    "comprovante" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Jogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evento" (
    "id" SERIAL NOT NULL,
    "bolaoId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Sessao_tokenHash_key" ON "Sessao"("tokenHash");

-- CreateIndex
CREATE INDEX "Sessao_usuarioId_idx" ON "Sessao"("usuarioId");

-- CreateIndex
CREATE INDEX "Tentativa_chave_criadoEm_idx" ON "Tentativa"("chave", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Bolao_convite_key" ON "Bolao"("convite");

-- CreateIndex
CREATE INDEX "Participante_bolaoId_idx" ON "Participante"("bolaoId");

-- CreateIndex
CREATE INDEX "DispositivoAcesso_tokenHash_idx" ON "DispositivoAcesso"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DispositivoAcesso_tokenHash_participanteId_key" ON "DispositivoAcesso"("tokenHash", "participanteId");

-- CreateIndex
CREATE INDEX "Jogo_bolaoId_idx" ON "Jogo"("bolaoId");

-- CreateIndex
CREATE INDEX "Jogo_participanteId_idx" ON "Jogo"("participanteId");

-- CreateIndex
CREATE INDEX "Evento_bolaoId_criadoEm_idx" ON "Evento"("bolaoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "Sessao" ADD CONSTRAINT "Sessao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participante" ADD CONSTRAINT "Participante_bolaoId_fkey" FOREIGN KEY ("bolaoId") REFERENCES "Bolao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositivoAcesso" ADD CONSTRAINT "DispositivoAcesso_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "Participante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_bolaoId_fkey" FOREIGN KEY ("bolaoId") REFERENCES "Bolao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "Participante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_bolaoId_fkey" FOREIGN KEY ("bolaoId") REFERENCES "Bolao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
