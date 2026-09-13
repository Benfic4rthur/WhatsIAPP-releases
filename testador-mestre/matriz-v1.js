const MATRIZ_TESTADOR_MESTRE_V1 = [
  {
    "id": "TM-F017",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cartoes de localizacao e links",
    "esperado": "recebimento, envio nativo, mesclagem e atualizacao tardia sem duplicar notificacoes",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-A001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Carregamento como modulo separado",
    "esperado": "carrega sem substituir funcoes globais",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Nenhum monkey patch de ipcRenderer.invoke",
    "esperado": "referencia permanece intacta",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A003",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Nenhum monkey patch de console/timers/eventos",
    "esperado": "APIs globais intactas",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Nenhuma reinicializacao de modulos funcionais",
    "esperado": "sem listeners/paineis/workers duplicados",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Namespace proprio de persistencia",
    "esperado": "somente whatsiapp.testador.*",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Diretorio temporario proprio",
    "esperado": "arquivos somente na pasta do testador",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A007",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Executor serial",
    "esperado": "um teste de efeito real por vez",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A008",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Timeout individual",
    "esperado": "teste travado vira TIMEOUT sem travar app",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A009",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cancelamento da bateria",
    "esperado": "interrompe fila sem encerrar workers normais",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A010",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Relatorio sem correcao automatica",
    "esperado": "falha nunca modifica codigo/configuracao",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A011",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Bloqueio R3",
    "esperado": "acao irreversivel nao executa em lote",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-A012",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Alvo de teste obrigatorio para R2",
    "esperado": "nenhuma acao real sem conversa configurada",
    "secao": "A. ISOLAMENTO E SEGURANCA DO TESTADOR"
  },
  {
    "id": "TM-B001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Processo principal ativo",
    "esperado": "responde ao diagnostico",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Renderer carregado",
    "esperado": "DOM base e IPC disponiveis",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B003",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Worker Baileys online",
    "esperado": "worker existe e responde",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Worker WPPConnect online",
    "esperado": "worker existe e responde",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Snapshot inicial de conversas",
    "esperado": "lista inicial valida",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Baileys conectado",
    "esperado": "sessao ativa",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B007",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "WPPConnect criou cliente",
    "esperado": "cliente inicializado",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B008",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "WPPConnect FULL_READY real",
    "esperado": "marco real do WPPConnect atingido",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B009",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "WPP live receive pronto",
    "esperado": "recepcao ao vivo ativa",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B010",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Aliases preparados antes da liberacao",
    "esperado": "mapa pronto antes de Conectado",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B011",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Privacidade preparada antes da liberacao",
    "esperado": "arquivadas/trancadas conhecidas ou cacheadas",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B012",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Overlay da abertura conclui",
    "esperado": "fecha apos READY rapido sem esperar WPP FULL_READY",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B013",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Eventos pendentes do renderer liberados",
    "esperado": "fila pre-render esvazia",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B014",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Diagnostico de tempo",
    "esperado": "marcos obrigatorios presentes e duracoes coletadas",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-B015",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cobertura LID/PN do catalogo",
    "esperado": "conversas do Baileys encontram estado no WPPConnect",
    "secao": "B. INICIALIZACAO E SINCRONIZACAO"
  },
  {
    "id": "TM-C001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Ponte renderer-main responde",
    "esperado": "diagnostico dentro do timeout",
    "secao": "C. IPC E SAUDE DOS WORKERS"
  },
  {
    "id": "TM-C002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Ponte main-Baileys responde",
    "esperado": "resposta estruturada",
    "secao": "C. IPC E SAUDE DOS WORKERS"
  },
  {
    "id": "TM-C003",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Ponte main-WPP responde",
    "esperado": "resposta estruturada",
    "secao": "C. IPC E SAUDE DOS WORKERS"
  },
  {
    "id": "TM-C004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Correlacao por id de solicitacao",
    "esperado": "resposta do request correto",
    "secao": "C. IPC E SAUDE DOS WORKERS"
  },
  {
    "id": "TM-C005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Acao desconhecida controlada",
    "esperado": "ok=false sem derrubar worker",
    "secao": "C. IPC E SAUDE DOS WORKERS"
  },
  {
    "id": "TM-C006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Timeout de worker controlado",
    "esperado": "falha diagnosticavel sem travar fila",
    "secao": "C. IPC E SAUDE DOS WORKERS"
  },
  {
    "id": "TM-C007",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Baileys nao duplicado",
    "esperado": "uma instancia funcional",
    "secao": "C. IPC E SAUDE DOS WORKERS"
  },
  {
    "id": "TM-C008",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "WPPConnect nao duplicado",
    "esperado": "uma instancia funcional",
    "secao": "C. IPC E SAUDE DOS WORKERS"
  },
  {
    "id": "TM-D001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Lista principal renderiza",
    "esperado": "tecnicas ocultas, validas visiveis",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Ordenacao por atividade",
    "esperado": "mais recente primeiro",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D003",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Contador de nao lidas",
    "esperado": "total coerente",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Aba Nao lidas",
    "esperado": "somente conversas elegiveis",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Aba Favoritos",
    "esperado": "favoritos sem expor trancadas",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Aba Grupos",
    "esperado": "somente grupos atuais",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D007",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Aba Arquivadas",
    "esperado": "arquivadas e contador coerente",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D008",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Trancadas ocultas por padrao",
    "esperado": "aba nao aparece sem liberacao",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D009",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Busca por nome",
    "esperado": "ignora caixa/acento",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D010",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Busca por mensagem",
    "esperado": "encontra por conteudo carregado",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D011",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Abrir/trocar conversa",
    "esperado": "cabecalho, mensagens e compositor acompanham",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-D012",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Estado vazio",
    "esperado": "compositor desabilitado e tela inicial visivel",
    "secao": "D. CONVERSAS, LISTAS, BUSCA E NAVEGACAO"
  },
  {
    "id": "TM-E001",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Enviar texto simples",
    "esperado": "WhatsApp confirma no alvo de teste",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E002",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Receber texto simples",
    "esperado": "entra uma unica vez no historico",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E003",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Reply de texto",
    "esperado": "referencia original preservada",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Barra de reply",
    "esperado": "autor e preview corretos",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cancelar reply",
    "esperado": "barra some sem alterar original",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Copiar mensagem",
    "esperado": "clipboard com texto correto",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E007",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Editar mensagem propria",
    "esperado": "remoto/local atualizados e flag editada",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E008",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Apagar somente para mim",
    "esperado": "estado local e persistencia coerentes",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E009",
    "tipo": "MANUAL",
    "risco": "R3",
    "nome": "Apagar para todos",
    "esperado": "somente mensagem descartavel, nunca em lote",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E010",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Encaminhar mensagem",
    "esperado": "chega ao destino e respeita limite",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E011",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Reagir a mensagem",
    "esperado": "emoji confirmado e exibido",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E012",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Remover propria reacao",
    "esperado": "reacao removida e persistencia atualizada",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E013",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Favoritar/desfavoritar",
    "esperado": "WhatsApp e lista local acompanham",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-E014",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "View once bloqueia encaminhamento",
    "esperado": "opcao indisponivel",
    "secao": "E. TEXTO, REPLY E ACOES DE MENSAGEM"
  },
  {
    "id": "TM-F001",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Enviar imagem",
    "esperado": "imagem real confirmada",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F002",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Imagem com legenda",
    "esperado": "legenda e midia associadas",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F003",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Enviar video",
    "esperado": "chega e fallback nao duplica",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F004",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Video otimista",
    "esperado": "pendente local reconciliado com mensagem real",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F005",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Enviar documento",
    "esperado": "arquivo com nome/mime coerentes",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F006",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Enviar arquivo de audio",
    "esperado": "anexo de audio confirmado",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F007",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Gravar e enviar audio",
    "esperado": "arquivo valido e audio real",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F008",
    "tipo": "MANUAL",
    "risco": "R1",
    "nome": "Pausar/retomar gravacao",
    "esperado": "UI e cronometro corretos",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F009",
    "tipo": "MANUAL",
    "risco": "R1",
    "nome": "Preview de audio",
    "esperado": "reproduz gravacao local",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F010",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Cancelar gravacao",
    "esperado": "estado temporario descartado",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F011",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Figurinha estatica",
    "esperado": "chega como sticker",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F012",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Figurinha animada",
    "esperado": "chega animada, nao como imagem comum",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F013",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Compartilhar contato",
    "esperado": "cartao de contato chega",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F014",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Carregar midia historica",
    "esperado": "materializa sem alterar mensagem",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F015",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Viewer imagem",
    "esperado": "abrir/zoom/arrastar/navegar/fechar",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-F016",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Viewer video",
    "esperado": "abrir/tocar/fechar sem quebrar chat",
    "secao": "F. ANEXOS, MIDIA, AUDIO, FIGURINHAS E CONTATO"
  },
  {
    "id": "TM-G001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Listar contatos salvos",
    "esperado": "contatos validos e ordenados",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Buscar contato salvo",
    "esperado": "nome/numero filtram corretamente",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G003",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Criar conversa provisoria",
    "esperado": "sem duplicar conversa existente",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G004",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Primeiro envio em conversa provisoria",
    "esperado": "conversa real inicia",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Listar grupos atuais",
    "esperado": "IDs/nomes validos",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Listar participantes",
    "esperado": "total/euNoGrupo coerentes",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G007",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Autores em grupo",
    "esperado": "nome salvo ou numero correto por mensagem",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G008",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Grupos em comum",
    "esperado": "perfil lista grupos compartilhados",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G009",
    "tipo": "MANUAL",
    "risco": "R3",
    "nome": "Sair de grupo",
    "esperado": "nunca automatico",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-G010",
    "tipo": "MANUAL",
    "risco": "R3",
    "nome": "Sair e apagar grupo",
    "esperado": "nunca automatico, dupla confirmacao",
    "secao": "G. CONTATOS, NOVA CONVERSA, GRUPOS E PERFIL"
  },
  {
    "id": "TM-H001",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Arquivar conversa de teste",
    "esperado": "WhatsApp confirma e move para Arquivadas",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H002",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Desarquivar conversa de teste",
    "esperado": "volta para principal",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H003",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Enviar em arquivada",
    "esperado": "desarquiva e nao duplica",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H004",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Receber em arquivada",
    "esperado": "volta para principal",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H005",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Trancar conversa de teste",
    "esperado": "some das listas comuns e nao expoe nao lidas",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H006",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Destrancar conversa de teste",
    "esperado": "volta ao fluxo normal",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H007",
    "tipo": "MANUAL",
    "risco": "R1",
    "nome": "Acesso por senha na busca",
    "esperado": "correta revela, incorreta nao",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H008",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Escape fecha Trancadas",
    "esperado": "aba/filtro/texto limpos",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H009",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Silenciar notificacoes",
    "esperado": "estado persistido",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H010",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Reativar notificacoes",
    "esperado": "estado normal restaurado",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H011",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Marcar como nao lida",
    "esperado": "contador/persistencia atualizados",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H012",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Bloquear/desbloquear contato de teste",
    "esperado": "remoto/local coerentes, indisponivel em grupo",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H013",
    "tipo": "MANUAL",
    "risco": "R3",
    "nome": "Limpar conversa",
    "esperado": "somente alvo descartavel",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-H014",
    "tipo": "MANUAL",
    "risco": "R3",
    "nome": "Apagar conversa",
    "esperado": "somente alvo descartavel",
    "secao": "H. PRIVACIDADE E GERENCIAMENTO DE CONVERSA"
  },
  {
    "id": "TM-I001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Deduplicacao de toast interno",
    "esperado": "mesmo id nao gera dois toasts",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I002",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Toast interno visivel",
    "esperado": "avatar/nome/preview corretos",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I003",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Som de nova mensagem",
    "esperado": "audivel quando permitido",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Silenciada nao toca som",
    "esperado": "gate bloqueia som",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Trancada nao toca som",
    "esperado": "gate bloqueia som",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Janela focada suprime externa",
    "esperado": "exibida=false, motivo janela-em-foco",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I007",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Janela fora de foco solicita externa",
    "esperado": "main aceita e tenta exibir",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I008",
    "tipo": "MANUAL",
    "risco": "R2",
    "nome": "Notificacao Windows aparece",
    "esperado": "icone/titulo/corpo corretos",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I009",
    "tipo": "MANUAL",
    "risco": "R2",
    "nome": "Clique na notificacao abre conversa",
    "esperado": "restaura/foca e abre alvo correto",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I010",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Foto da notificacao",
    "esperado": "cache usado quando disponivel",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I011",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Presenca online",
    "esperado": "cabecalho atualiza",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I012",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Presenca digitando",
    "esperado": "mostra digitando",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I013",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Presenca gravando",
    "esperado": "mostra gravando audio",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-I014",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "ACK enviada/entregue/lida",
    "esperado": "progresso sem regressao/duplicacao",
    "secao": "I. NOTIFICACOES, PRESENCA, ACK E LEITURA"
  },
  {
    "id": "TM-J001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Listar Status",
    "esperado": "feeds e Meu status validos",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Recentes/vistos",
    "esperado": "contagens/grupos coerentes",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J003",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Status texto",
    "esperado": "texto/fundo/horario/progresso corretos",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J004",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Status imagem",
    "esperado": "midia carrega sem payload exposto",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J005",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Status video",
    "esperado": "carrega/reproduz",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J006",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Marcar visto",
    "esperado": "WhatsApp confirma leitura",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J007",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Avanco e navegacao",
    "esperado": "anterior/proximo/timer corretos",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J008",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Responder Status",
    "esperado": "chega no privado com contexto",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J009",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Reagir Status",
    "esperado": "emoji contextualizado chega no privado",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J010",
    "tipo": "SEMI",
    "risco": "R2",
    "requerAlvoConversa": false,
    "nome": "Citacao de Status no chat",
    "esperado": "referencia preservada",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J011",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Clique na citacao reabre Status",
    "esperado": "abre Status certo e retorna ao chat",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J012",
    "tipo": "SEMI",
    "risco": "R2",
    "requerAlvoConversa": false,
    "nome": "Publicar Status texto",
    "esperado": "confirmado e aparece em Meu status",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J013",
    "tipo": "SEMI",
    "risco": "R2",
    "requerAlvoConversa": false,
    "nome": "Publicar Status imagem",
    "esperado": "imagem confirmada",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J014",
    "tipo": "SEMI",
    "risco": "R2",
    "requerAlvoConversa": false,
    "nome": "Publicar Status video",
    "esperado": "SKIP enquanto o recurso estiver temporariamente indisponivel",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J015",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Listar visualizadores",
    "esperado": "lista/contador sem duplicatas",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-J016",
    "tipo": "SEMI",
    "risco": "R2",
    "requerAlvoConversa": false,
    "nome": "Limpar Status criados pelo Testador Mestre",
    "esperado": "apaga somente os dois Status criados pela propria execucao",
    "secao": "J. STATUS"
  },
  {
    "id": "TM-K001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Abrir Configuracoes",
    "esperado": "painel unico e funcional",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Abrir area administrativa",
    "esperado": "carrega sem duplicar estado",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K003",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Configuracao comercial publica",
    "esperado": "nome/plano/permissoes validos",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Niveis por plano",
    "esperado": "nivel proibido nao oferecido",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Pesquisa web por plano",
    "esperado": "permissao respeitada sem pesquisar",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Resumo de consumo IA",
    "esperado": "carrega sem chamada de IA",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K007",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Periodos de consumo",
    "esperado": "hora/dia/semana/mes atualizam sem erro",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K008",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Configuracao do catalogo",
    "esperado": "estado/limites exibidos sem consultar IA",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K009",
    "tipo": "MANUAL",
    "risco": "R1",
    "nome": "Troca de senha das Trancadas",
    "esperado": "somente chave prevista muda",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K010",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Rollback de alteracoes admin nao salvas",
    "esperado": "detecta e permite descarte",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K011",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Persistencia de favoritos",
    "esperado": "recarregar restaura",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K012",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Persistencia de reacoes",
    "esperado": "recarregar restaura",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K013",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Persistencia de editadas/apagadas",
    "esperado": "reaplica tombstones/edicoes",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-K014",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Nao lidas/personalizacao/midia local",
    "esperado": "restaura sem contaminar outras conversas",
    "secao": "K. CONFIGURACOES, ADMIN E PERSISTENCIAS LOCAIS"
  },
  {
    "id": "TM-L001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cache de conversas antes da rede",
    "esperado": "estado inicial local disponivel",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cache de aliases",
    "esperado": "LID/PN restaurados",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L003",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cache de arquivamento",
    "esperado": "estados restaurados",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cache de privacidade",
    "esperado": "trancadas/arquivadas nao piscam como normais",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Snapshot autoritativo",
    "esperado": "estado real vence temporario quando apropriado",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Fallback de midia Baileys->WPP",
    "esperado": "tenta fallback sem duplicar",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L007",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Deduplicacao WPP/Baileys",
    "esperado": "mesmo evento entra uma vez",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L008",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Prioridade de presenca Baileys",
    "esperado": "WPP assume so apos janela prevista",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L009",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Reassinatura de presenca",
    "esperado": "sem listeners duplicados",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L010",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Encerramento limpo WPP",
    "esperado": "timers/listeners/client fecham",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L011",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Encerramento limpo Baileys",
    "esperado": "caches salvos/socket encerrado",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L012",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Reconexao temporaria",
    "esperado": "volta sem QR se credenciais validas",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-L013",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Coerencia do cache de privacidade",
    "esperado": "chaves unicas e estados booleanos",
    "secao": "L. REINICIO, CACHE, FALLBACK E RESILIENCIA"
  },
  {
    "id": "TM-M001",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Arquivada -> enviar -> principal",
    "esperado": "desarquiva, envia e fica consistente",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M002",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Arquivada -> receber -> principal",
    "esperado": "entrada remove arquivamento",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M003",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Trancada -> receber",
    "esperado": "entra no privado sem toast/som/contador publico",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M004",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Silenciada -> receber",
    "esperado": "entra sem som/toast e historico atualiza",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M005",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Reply -> imagem",
    "esperado": "imagem chega com citacao",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M006",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Reply -> audio",
    "esperado": "audio chega com citacao",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M007",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Favoritar -> editar",
    "esperado": "favorito mostra texto editado",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M008",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Reagir -> rerender",
    "esperado": "reacao permanece",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M009",
    "tipo": "AUTO",
    "risco": "R1",
    "nome": "Favoritar/reagir -> apagar",
    "esperado": "persistencias associadas limpas",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M010",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Perfil -> trocar conversa",
    "esperado": "perfil fecha e nao fica preso",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M011",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Viewer -> navegar -> fechar",
    "esperado": "volta ao mesmo chat/estado",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-M012",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Status citado -> abrir -> fechar",
    "esperado": "retorna a conversa de origem",
    "secao": "M. CENARIOS CRUZADOS DE REGRESSAO"
  },
  {
    "id": "TM-N001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Modulo/painel de IA carregado",
    "esperado": "sem erro de inicializacao",
    "secao": "N. FRONTEIRA COM A IA, SEM REPETIR O TESTADOR DE IA"
  },
  {
    "id": "TM-N002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Modos por conversa carregam",
    "esperado": "Manual/Assistido/Automatico lidos sem gerar resposta",
    "secao": "N. FRONTEIRA COM A IA, SEM REPETIR O TESTADOR DE IA"
  },
  {
    "id": "TM-N003",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Segundo plano carrega",
    "esperado": "estado lido sem acionar IA",
    "secao": "N. FRONTEIRA COM A IA, SEM REPETIR O TESTADOR DE IA"
  },
  {
    "id": "TM-N004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Testador Mestre nao chama modelos",
    "esperado": "zero Groq/web/OCR/visao disparados pelo Mestre",
    "secao": "N. FRONTEIRA COM A IA, SEM REPETIR O TESTADOR DE IA"
  },
  {
    "id": "TM-O001",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Fluxo de QR sem sessao",
    "esperado": "QR aparece, login conclui, overlay fecha",
    "secao": "O. VALIDACOES DE PLATAFORMA E MANUAIS"
  },
  {
    "id": "TM-O002",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Microfone/MediaRecorder",
    "esperado": "permissao e captura reais",
    "secao": "O. VALIDACOES DE PLATAFORMA E MANUAIS"
  },
  {
    "id": "TM-O003",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Dialogos de arquivo",
    "esperado": "selecionar/cancelar nao trava UI",
    "secao": "O. VALIDACOES DE PLATAFORMA E MANUAIS"
  },
  {
    "id": "TM-O004",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Notificacao Windows real",
    "esperado": "comportamento esperado com permissoes do SO",
    "secao": "O. VALIDACOES DE PLATAFORMA E MANUAIS"
  },
  {
    "id": "TM-O005",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Audio do sistema real",
    "esperado": "som/volume percebidos",
    "secao": "O. VALIDACOES DE PLATAFORMA E MANUAIS"
  },
  {
    "id": "TM-O006",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Minimizado/tray",
    "esperado": "recepcao/workers/notificacoes continuam e app restaura",
    "secao": "O. VALIDACOES DE PLATAFORMA E MANUAIS"
  }  ,
  {
    "id": "TM-P001",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Historico Gap registrado",
    "esperado": "modulo e dispatcher carregados pelo worker WPP",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P002",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "READY rapido separado do WPP completo",
    "esperado": "diagnostico preserva marcos distintos",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P003",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Fotos Principais priorizadas",
    "esperado": "bootstrap possui etapa dedicada antes da liberacao rapida",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P004",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "PTT continua no Baileys",
    "esperado": "audio gravado nao regressa para envio WPP",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P005",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Video continua no Baileys",
    "esperado": "video usa rota direta Baileys",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P006",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Exclusao de conversa confirmada",
    "esperado": "estado remoto e reconsultado antes da limpeza local",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P007",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Modulos WPP obrigatorios presentes",
    "esperado": "nenhum modulo do worker esta ausente",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P008",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Cache de retry presente",
    "esperado": "retry de mensagens/PTT possui persistencia quando ja utilizada",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P009",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Catch-up inicial silencioso",
    "esperado": "mensagens anteriores a abertura atualizam historico sem som, toast ou fluxo de tempo real",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P010",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "UnreadCount capturado pelo WPP",
    "esperado": "contador real do ChatStore entra no estado WPP",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P011",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Nao lidas WPP autoritativas",
    "esperado": "main distribui total com geracao/revisao por conversa",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P012",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Snapshot antigo nao rebaixa nao lidas",
    "esperado": "renderer prioriza revisao WPP e bloqueia fallback Baileys atrasado",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P013",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Convergencia real de nao lidas",
    "esperado": "estado local converge para o total WPP quando a revisao permanece estavel",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P014",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Polling de leitura em 2 segundos",
    "esperado": "reconciliacao externa permanece abaixo da meta de 3 segundos",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P015",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Leitura usa Baileys e WPPConnect",
    "esperado": "marcar como lida dispara os dois caminhos e WPP usa sendSeen",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P016",
    "tipo": "SEMI",
    "risco": "R2",
    "nome": "Propagacao real de leitura",
    "esperado": "alvo autorizado e marcado como lido por Baileys e WPPConnect e converge para zero",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P017",
    "tipo": "MANUAL",
    "risco": "R0",
    "nome": "Leitura externa em ate 3 segundos",
    "esperado": "ler no celular ou WhatsApp Web zera o WhatsIAPP em ate 3 segundos",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  },
  {
    "id": "TM-P018",
    "tipo": "AUTO",
    "risco": "R0",
    "nome": "Status de entrega do remetente permanece verdadeiro",
    "esperado": "relogio, tique enviado, dois tiques entregue/lido e erro nao regridem nem inventam confirmacao",
    "secao": "P. CONTRATOS CRITICOS DE REGRESSAO"
  }

];

module.exports = { MATRIZ_TESTADOR_MESTRE_V1 };
