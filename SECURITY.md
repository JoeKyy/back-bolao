# Política de segurança

## Como reportar

**Não abra issue pública para vulnerabilidades.** Use o relato privado do GitHub: aba **Security**, **Report a vulnerability** neste repositório. Se não conseguir, escreva para contato@joekyy.com.br com o assunto "Segurança Bolão da Mega".

Inclua o que afeta, os passos para reproduzir e o impacto que você enxerga. Não acesse dados de outras pessoas, não faça testes de carga nem engenharia social. Respondo em até 7 dias.

## Escopo

Os dois repositórios (`back-bolao` e `bolao-web`) e os ambientes publicados. Fora do escopo: ataques de negação de serviço, spam e problemas que dependem de acesso físico ou de um aparelho já comprometido.

## Boas práticas já adotadas

Sessão opaca em cookie `__Host-`, proteção CSRF, CORS restrito, limites de tentativas no banco, senha de login cifrada no navegador, erros que não repetem a entrada e banco com papel de aplicação sem DDL. Detalhes no README e em `HANDOFF-SEGURANCA.md`.
