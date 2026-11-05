import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { createHash, randomInt } from "node:crypto";
import { muitasTentativas, naoAutenticado } from "../common/erros";
import { LimitesService, agruparIp } from "../common/limites.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConvitesService } from "../usuarios/convites.service";
import { exigirSenhaAceitavel } from "./senha";

export const QUANTIDADE_DE_CODIGOS = 8;
const ALFABETO = "ACDEFGHJKMNPQRTUVWXYZ2346789"; // sem 0/O, 1/I/L, 5/S, B/8
const JANELA_MS = 10 * 60 * 1000;
const MAX_POR_IP = 5;

export const normalizarCodigo = (c: string) => c.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
const hashCodigo = (c: string) => createHash("sha256").update(normalizarCodigo(c)).digest("hex");

function gerarCodigo(): string {
  const blocos: string[] = [];
  for (let b = 0; b < 3; b++) {
    let bloco = "";
    for (let i = 0; i < 4; i++) bloco += ALFABETO[randomInt(ALFABETO.length)];
    blocos.push(bloco);
  }
  return blocos.join("-");
}

/**
 * Códigos de recuperação, como no gestor: 8 por lote, uso único, só o hash no banco. Gerar um
 * lote novo apaga o anterior. Servem para trocar a senha sem o administrador e sem e-mail.
 */
@Injectable()
export class CodigosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
    private readonly convites: ConvitesService,
  ) {}

  async gerar(usuarioId: number): Promise<string[]> {
    const codigos = Array.from({ length: QUANTIDADE_DE_CODIGOS }, gerarCodigo);
    await this.prisma.$transaction([
      this.prisma.codigoRecuperacao.deleteMany({ where: { usuarioId } }),
      this.prisma.codigoRecuperacao.createMany({ data: codigos.map((c) => ({ usuarioId, codigoHash: hashCodigo(c) })) }),
      // RVAL-04: gerar códigos dá acesso reserva à conta; fica na trilha que a pessoa vê.
      this.prisma.eventoConta.create({ data: { usuarioId, porId: null, tipo: "codigos_gerados", descricao: "Novos códigos de recuperação gerados (os anteriores deixaram de valer)." } }),
    ]);
    return codigos;
  }

  contar(usuarioId: number): Promise<number> {
    return this.prisma.codigoRecuperacao.count({ where: { usuarioId, usadoEm: null } });
  }

  /** Troca a senha com um código; derruba as sessões. Devolve o id para abrir sessão nova. */
  async recuperar(email: string, codigo: string, novaSenha: string, ip: string): Promise<number> {
    if (!(await this.limites.consumir(`recuperar:${agruparIp(ip)}`, MAX_POR_IP, JANELA_MS))) {
      throw muitasTentativas("Muitas tentativas. Aguarde alguns minutos.");
    }
    const invalido = naoAutenticado("E-mail ou código de recuperação inválido.");
    const u = await this.prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Conta sem senha ainda está no convite; conta desativada não recupera.
    if (!u || !u.senhaHash || !u.ativo) throw invalido;
    const reg = await this.prisma.codigoRecuperacao.findUnique({ where: { codigoHash: hashCodigo(codigo) } });
    if (!reg || reg.usadoEm || reg.usuarioId !== u.id) throw invalido;
    exigirSenhaAceitavel(novaSenha, { email: u.email, nome: u.nome });
    const senhaHash = await bcrypt.hash(novaSenha, 12);
    return this.prisma.$transaction(async (tx) => {
      const ok = await tx.codigoRecuperacao.updateMany({ where: { id: reg.id, usadoEm: null }, data: { usadoEm: new Date() } });
      if (ok.count === 0) throw invalido;
      await tx.usuario.update({ where: { id: u.id }, data: { senhaHash } });
      await tx.sessao.deleteMany({ where: { usuarioId: u.id } });
      await this.convites.revogarTodos(tx, u.id); // RVAL-03
      await tx.eventoConta.create({ data: { usuarioId: u.id, porId: null, tipo: "senha_por_codigo", descricao: "Senha trocada com um código de recuperação. Se não foi você, avise o administrador." } });
      return u.id;
    });
  }
}
