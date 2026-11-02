# RADAR INTELIGENTE DE PROMOÇÕES — Etapa 3: Planilha (Google Sheets)

> Status: **aguardando você executar e confirmar**.
> O script `apps-script/Setup.gs` cria toda a estrutura automaticamente. Ele foi testado aqui com uma
> planilha simulada (`node radar-promocoes/testes/teste-setup.cjs`, 9 testes). O teste real é você
> rodá-lo no Google.

## Passo a passo

1. Acesse https://sheets.google.com com a conta Google que vai usar no radar → **Em branco**.
2. Renomeie a planilha (canto superior esquerdo) para `RADAR DE PROMOÇÕES`.
3. Menu **Extensões → Apps Script**. Abre o editor numa nova aba.
4. No editor, renomeie o projeto (canto superior esquerdo, "Projeto sem título") para `Radar de Promoções`.
5. **Fuso horário do projeto:** clique na engrenagem ⚙️ (**Configurações do projeto**) → marque
   **"Mostrar arquivo de manifesto 'appsscript.json' no editor"**. Volte ao **Editor** (ícone `< >`),
   abra `appsscript.json`, apague tudo e cole o conteúdo de `apps-script/appsscript.json`. Salve (Ctrl+S).
6. Clique em `Código.gs`. Renomeie para `Setup` (três pontinhos ao lado do nome → Renomear).
   Apague todo o conteúdo e cole **todo** o arquivo `apps-script/Setup.gs`. Salve (Ctrl+S).
7. Na barra de cima, na lista de funções, escolha **`criarEstrutura`** e clique em **Executar**.
8. Autorização (só na primeira vez):
   - "Autorização necessária" → **Revisar permissões** → escolha sua conta.
   - "O Google não verificou este app" → **Avançado** → **Acessar Radar de Promoções (não seguro)**.
     (Aparece porque o script é seu e não passou por revisão do Google; ele só acessa esta planilha.)
   - **Permitir**.
9. Aguarde o **Registro de execução** mostrar "Execução concluída".

## Resultado esperado

No Registro de execução:
```
RADAR — estrutura verificada:
• PRODUTOS: criada com 10 linhas de exemplo
• LOJAS: criada com 6 linhas de exemplo
• FONTES: criada com 5 linhas de exemplo
• OFERTAS: criada
• HISTORICO_PRECOS: criada
• CONFIGURACOES: criada
• NOTIFICACOES: criada
• LOGS: criada
• CONFIGURACOES: 22 chave(s) adicionada(s)
• PAINEL: montado (10 indicadores e 9 tabelas)
```
Na planilha: 9 abas coloridas (PAINEL primeiro) e a "Página1" removida.
Os indicadores do PAINEL ficam zerados e as tabelas mostram "Nenhuma ... ainda" — é o normal: ainda não há coleta.

## O que cada aba faz

| Aba | Para quê | Quem preenche |
|---|---|---|
| PAINEL | Indicadores e tabelas-resumo (só fórmulas; é refeito a cada execução do setup) | Sistema |
| PRODUTOS | **Os produtos que você quer**: palavras obrigatórias/proibidas, preço-alvo, preço mínimo | Você (colunas cinza = sistema) |
| LOJAS | Lojas, domínios oficiais aceitos e situação da integração | Você liga/desliga |
| FONTES | De onde vêm as ofertas e o status real de cada fonte | Você liga/desliga; status = sistema |
| OFERTAS | Toda oferta encontrada, com classificação e motivo. Também aceita lançamento manual (Fonte = MANUAL) | Sistema / você |
| HISTORICO_PRECOS | Memória de preços usada para detectar desconto falso | Sistema |
| CONFIGURACOES | Frequência, horário, descontos mínimos, limites | Você muda a coluna **Valor** |
| NOTIFICACOES | Cada mensagem enviada ao Telegram e o resultado | Sistema |
| LOGS | Eventos e erros | Sistema |

### Como escrever as palavras dos produtos
- **Vírgula = E**: `galaxy tab, s10 fe` → o título precisa ter "galaxy tab" **e** "s10 fe".
- **Barra `|` = OU**: `s10 fe+|s10 fe plus` → aceita qualquer uma.
- **Proibidas**: se qualquer uma aparecer, a oferta é descartada (`capa, película, usado`).
- Maiúsculas e acentos são ignorados.

Os produtos P004 a P010 vêm **desmarcados** (exemplos). Para usar: preencha o preço-alvo e marque **Ativo**.

## Segurança
- Rodar `criarEstrutura` de novo **não apaga nada**: só recria o que faltar (testado).
- Token do Telegram **não** vai na planilha. Entra nas Propriedades do Script na Etapa 4.
