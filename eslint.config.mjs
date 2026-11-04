// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Scripts de linha de comando (seed, migração de dados): `console` NÃO é descuido ali, é a
    // interface. A seed já convivia com o aviso; o script de migração de pessoas imprime um
    // relatório de 11 linhas — nomes que não casaram com nenhuma conta, nomes ambíguos — que é
    // justamente o que alguém precisa ler pra decidir o que fazer à mão depois. Avisos que a
    // gente sabe que vai ignorar treinam o time a ignorar a saída do linter inteira.
    rules: {
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
);
