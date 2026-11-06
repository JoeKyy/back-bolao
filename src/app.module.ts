import { Controller, Get, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller";
import { AdminGuard, PerfilAdminGuard, TesoureiroGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { BoloesController } from "./boloes/boloes.controller";
import { BoloesService } from "./boloes/boloes.service";
import { DonoDoBolaoGuard } from "./boloes/dono.guard";
import { CaixaService } from "./caixa/caixa.service";
import { LimitesModule, LimitesService } from "./common/limites.service";
import { PrismaModule, PrismaService } from "./prisma/prisma.service";
import { ConviteOrganizadorController, UsuariosController } from "./usuarios/usuarios.controller";
import { UsuariosService } from "./usuarios/usuarios.service";
import { ConvitesService } from "./usuarios/convites.service";
import { CodigosService } from "./auth/codigos.service";
import { LoginCriptoService } from "./auth/login-cripto.service";
import { MailService } from "./mail/mail.service";
import { ParticipacoesController, PublicoController, VinculoController } from "./publico/publico.controller";
import { VinculoService } from "./publico/vinculo.service";
import { PublicoService } from "./publico/publico.service";
import contrato from "./shared/contrato.json";

@Controller("saude")
class SaudeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async saude() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }

  /** Impressão digital do contrato com o front (o deploy compara com o do front). */
  @Get("contrato")
  contrato() {
    return contrato;
  }
}

/** Limpeza periódica: tentativas antigas e sessões vencidas. */
@Injectable()
class Varredura implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger("Varredura");
  constructor(
    private readonly limites: LimitesService,
    private readonly prisma: PrismaService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.rodar(), 60 * 60 * 1000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async rodar() {
    try {
      await this.limites.varrer();
      await this.prisma.sessao.deleteMany({ where: { expiraEm: { lt: new Date() } } });
      await this.prisma.vinculoConta.deleteMany({ where: { expiraEm: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    } catch (e) {
      this.log.warn(`Falha na varredura: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

@Module({
  imports: [PrismaModule, LimitesModule],
  controllers: [SaudeController, AuthController, BoloesController, PublicoController, VinculoController, ParticipacoesController, UsuariosController, ConviteOrganizadorController],
  providers: [AuthService, LoginCriptoService, CodigosService, ConvitesService, MailService, AdminGuard, PerfilAdminGuard, TesoureiroGuard, DonoDoBolaoGuard, UsuariosService, BoloesService, CaixaService, PublicoService, VinculoService, Varredura],
})
export class AppModule {}
