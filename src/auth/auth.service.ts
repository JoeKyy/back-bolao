import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { config } from "../common/config";
import { muitasTentativas, naoAutenticado } from "../common/erros";
import { LimitesService, agruparIp } from "../common/limites.service";
import { TOKEN_RE, hashToken, novoTokenSecreto } from "../common/tokens";
import { PrismaService } from "../prisma/prisma.service";

export const SESSAO_DIAS = 7;
/** Sem uso por este tempo, a sessão cai mesmo dentro do prazo absoluto. */
export const SESSAO_OCIOSA_MS = 48 * 60 * 60 * 1000;
export const LOGIN_JANELA_MS = 10 * 60 * 1000;
export const LOGIN_MAX_POR_IP = 5;
/** Teto global de FALHAS: protege contra força bruta distribuída entre muitos IPs. */
export const LOGIN_MAX_GLOBAL = 30;
const CHAVE_FALHA_GLOBAL = "login:falha";

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

  async entrar(
    email: string,
    senha: string,
    ip: string,
    aparelho: string | undefined,
  ): Promise<{ token: string; expiraEm: Date; aparelho: string }> {
    // SEC-05: a tentativa é registrada ANTES de conferir a senha, de forma atômica. Requisições
    // paralelas não passam todas pela mesma contagem antiga.
    const chaveIp = `login:ip:${agruparIp(ip)}`;
    if (!(await this.limites.consumir(chaveIp, LOGIN_MAX_POR_IP, LOGIN_JANELA_MS))) {
      throw muitasTentativas("Muitas tentativas. Aguarde alguns minutos.");
    }
    // SEC-06: o teto global de falhas não tranca o organizador no aparelho onde ele já entrou.
    const aparelhoConhecido = await this.aparelhoConhecido(aparelho);
    if (!aparelhoConhecido && (await this.limites.contar(CHAVE_FALHA_GLOBAL, LOGIN_JANELA_MS)) >= LOGIN_MAX_GLOBAL) {
      throw muitasTentativas("Muitas tentativas no sistema. Aguarde alguns minutos ou entre pelo aparelho de sempre.");
    }

    const usuario = await this.prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    const confere = await bcrypt.compare(senha, usuario?.senhaHash ?? HASH_FALSO);
    if (!usuario || !confere) {
      await this.limites.registrar(CHAVE_FALHA_GLOBAL);
      throw naoAutenticado("E-mail ou senha incorretos.");
    }

    await this.limites.limpar(chaveIp);
    const token = novoTokenSecreto();
    const expiraEm = new Date(Date.now() + SESSAO_DIAS * 24 * 60 * 60 * 1000);
    await this.prisma.sessao.create({ data: { tokenHash: hashToken(token), usuarioId: usuario.id, expiraEm } });

    // Mesmo aparelho de antes: mantém o token. Senão, emite um novo (nunca aceita valor do cliente).
    const tokenAparelho = aparelhoConhecido === usuario.id ? aparelho! : novoTokenSecreto();
    if (aparelhoConhecido !== usuario.id) {
      await this.prisma.aparelhoOrganizador.create({ data: { tokenHash: hashToken(tokenAparelho), usuarioId: usuario.id } });
    }
    return { token, expiraEm, aparelho: tokenAparelho };
  }

  /** Id do organizador dono do aparelho, ou null. */
  private async aparelhoConhecido(token: string | undefined): Promise<number | null> {
    if (!token || !TOKEN_RE.test(token)) return null;
    const a = await this.prisma.aparelhoOrganizador.findUnique({ where: { tokenHash: hashToken(token) } });
    return a?.usuarioId ?? null;
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
