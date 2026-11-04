import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

const aparar = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
/** Texto sem caracteres de controle (exceto quebra de linha). */
const SEM_CONTROLE = /^[^\u0000-\u0009\u000B-\u001F\u007F]*$/;

export class CriarBolaoDto {
  @Transform(aparar) @IsString() @MinLength(2) @MaxLength(80) @Matches(SEM_CONTROLE)
  nome!: string;

  @IsIn(["VIRADA", "NORMAL"])
  tipo!: "VIRADA" | "NORMAL";

  @IsOptional() @IsInt() @Min(1) @Max(99999)
  concurso?: number | null;
}

export class AtualizarBolaoDto {
  @IsOptional() @Transform(aparar) @IsString() @MinLength(2) @MaxLength(80) @Matches(SEM_CONTROLE)
  nome?: string;

  @IsOptional() @IsInt() @Min(1) @Max(99999)
  concurso?: number | null;

  /** ISO 8601. */
  @IsOptional() @IsString() @MaxLength(40)
  dataSorteio?: string | null;

  @IsOptional() @IsInt() @Min(100) @Max(100_000)
  precoSimples?: number;

  @IsOptional() @IsInt() @Min(6) @Max(20)
  maxDezenasParticipante?: number;

  @IsOptional() @IsInt() @Min(1) @Max(1000)
  maxParticipantes?: number;

  @IsOptional() @Transform(aparar) @IsString() @MaxLength(400) @Matches(SEM_CONTROLE)
  instrucoes?: string;

  @IsOptional() @Transform(aparar) @IsString() @MaxLength(80)
  pixChave?: string | null;

  @IsOptional() @Transform(aparar) @IsString() @MaxLength(25) @Matches(SEM_CONTROLE)
  pixNome?: string | null;

  @IsOptional() @Transform(aparar) @IsString() @MaxLength(15) @Matches(SEM_CONTROLE)
  pixCidade?: string | null;

  /** Centavos. Até R$ 100 bilhões. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000_000)
  estimativaPremio?: number | null;
}

export class ExcluirBolaoDto {
  @IsString() @MaxLength(80)
  confirmacao!: string;
}

export class InscricoesDto {
  @IsBoolean()
  abertas!: boolean;
}

export class ParticipanteDto {
  @Transform(aparar) @IsString() @MinLength(2) @MaxLength(60) @Matches(SEM_CONTROLE)
  nome!: string;

  @IsOptional() @Transform(aparar) @IsString() @MaxLength(30) @Matches(/^[0-9()+\-\s]*$/)
  whatsapp?: string;
}

export class PagamentoDto {
  /** Valor recebido (centavos). Sem valor: confirma o total devido. */
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000)
  valor?: number;

  /** Compatibilidade: mesmo efeito de `?confirmar=1` (BOL-04/SEC-04). */
  @IsOptional() @IsBoolean()
  confirmarComResultado?: boolean;
}

export class JogosDto {
  @IsInt() @Min(1)
  participanteId!: number;

  /** Cada jogo é validado no serviço (validarDezenas: inteiros 1 a 60, sem repetição, 6 a 20). */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @IsArray({ each: true })
  jogos!: number[][];

  @IsOptional() @IsBoolean()
  surpresinha?: boolean;
}

export class RegistroJogoDto {
  @IsBoolean()
  registrado!: boolean;

  @IsOptional() @Transform(aparar) @IsString() @MaxLength(80) @Matches(SEM_CONTROLE)
  comprovante?: string | null;
}

/** Teto por faixa: R$ 10 bilhões (MAX_PREMIO_FAIXA). */
class PremiosDto {
  @IsInt() @Min(0) @Max(1_000_000_000_000)
  sena!: number;
  @IsInt() @Min(0) @Max(1_000_000_000_000)
  quina!: number;
  @IsInt() @Min(0) @Max(1_000_000_000_000)
  quadra!: number;
}

export class ResultadoManualDto {
  @IsArray() @ArrayMinSize(6) @ArrayMaxSize(6) @IsInt({ each: true })
  dezenas!: number[];

  @ValidateNested() @Type(() => PremiosDto)
  premios!: PremiosDto;
}

export class ResultadoCaixaDto {
  @IsOptional() @IsInt() @Min(1) @Max(99999)
  concurso?: number;
}
