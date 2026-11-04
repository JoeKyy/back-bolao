import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { config } from "../common/config";
import { muitasTentativas, naoAutenticado } from "../common/erros";
import { LimitesService } from "../common/limites.service";
import { hashToken, novoTokenSecreto } from "../common/tokens";
import { PrismaService } from "../prisma/prisma.service";

export const COOKIE_SESSAO = "bolao_sessao";
export const SESSAO_DIAS = 7;
/** Sem uso por este tempo, a sessão cai mesmo dentro do prazo absoluto. */
export const SESSAO_OCIOSA_MS = 48 * 60 * 60 * 1000;
export const LOGIN_JANELA_MS = 10 * 60 * 1000;
export const LOGIN_MAX_POR_IP = 5;
/** Teto global: protege contra força bruta distribuída entre muitos IPs. */
export const LOGIN_MAX_GLOBAL = 30;

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar isso.
const HASH_FALSO = bcrypt.hashSync("senha-que-nao-existe-em-lugar-nenhum", 12);

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger("Auth");

  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
  ) {}

  /** Cria o organizador do .env no primeiro boot. Depois disso o .env não troca a senha. */
  async onModuleInit() {
    const { adminEmail, adminSenha } = config();
    const existe = await this.prisma.usuario.count();
    if (existe > 0) return;
    if (!adminEmail || !adminSenha) {
      this.log.warn("Nenhum organizador cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD e reinicie.");
      return;
    }
    await this.prisma.usuario.create({
      data: { email: adminEmail, senhaHash: await bcrypt.hash(adminSenha, 12) },
    });
    this.log.log("Organizador criado a partir do .env.");
  }

  async entrar(email: string, senha: string, ip: string): Promise<{ token: string; expiraEm: Date }> {
    const chaveIp = `login:ip:${ip}`;
    const [porIp, global] = await Promise.all([
      this.limites.contar(chaveIp, LOGIN_JANELA_MS),
      this.limites.contar("login:global", LOGIN_JANELA_MS),
    ]);
    if (porIp >= LOGIN_MAX_POR_IP || global >= LOGIN_MAX_GLOBAL) {
      throw muitasTentativas("Muitas tentativas. Aguarde alguns minutos.");
    }

    const usuario = await this.prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    const confere = await bcrypt.compare(senha, usuario?.senhaHash ?? HASH_FALSO);
    if (!usuario || !confere) {
      await Promise.all([this.limites.registrar(chaveIp), this.limites.registrar("login:global")]);
      throw naoAutenticado("E-mail ou senha incorretos.");
    }

    await this.limites.limpar(chaveIp);
    const token = novoTokenSecreto();
    const expiraEm = new Date(Date.now() + SESSAO_DIAS * 24 * 60 * 60 * 1000);
    await this.prisma.sessao.create({ data: { tokenHash: hashToken(token), usuarioId: usuario.id, expiraEm } });
    return { token, expiraEm };
  }

  /** Devolve o id do organizador da sessão, ou null. Sessão vencida ou ociosa é apagada. */
  async validar(token: string | undefined): Promise<number | null> {
    if (!token || token.length > 100) return null;
    const s = await this.prisma.sessao.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!s) return null;
    const agora = Date.now();
    if (s.expiraEm.getTime() <= agora || agora - s.ultimoUsoEm.getTime() > SESSAO_OCIOSA_MS) {
      await this.prisma.sessao.deleteMany({ where: { id: s.id } });
      return null;
    }
    // Atualiza o último uso no máximo uma vez por minuto, para não escrever a cada requisição.
    if (agora - s.ultimoUsoEm.getTime() > 60_000) {
      await this.prisma.sessao.update({ where: { id: s.id }, data: { ultimoUsoEm: new Date() } });
    }
    return s.usuarioId;
  }

  async sair(token: string | undefined) {
    if (!token) return;
    await this.prisma.sessao.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  /** Troca a senha e derruba todas as sessões do organizador (inclusive a atual). */
  async trocarSenha(usuarioId: number, atual: string, nova: string) {
    const u = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    if (!(await bcrypt.compare(atual, u.senhaHash))) throw naoAutenticado("Senha atual incorreta.");
    await this.prisma.$transaction([
      this.prisma.usuario.update({ where: { id: usuarioId }, data: { senhaHash: await bcrypt.hash(nova, 12) } }),
      this.prisma.sessao.deleteMany({ where: { usuarioId } }),
    ]);
  }
}
