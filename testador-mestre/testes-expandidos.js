"use strict";

function registrarTestesExpandidos(ctx = {}) {
  const {
    implementar,
    pass,
    warning,
    fail,
    skip,
    bridge,
    document,
    window,
    localStorage,
    fs,
    path,
    hooksRenderer = {},
    backupStorage,
    restaurarStorage,
    idSintetico,
    diagnosticoMain,
  } = ctx;

  if (typeof implementar !== "function") {
    throw new Error("Registrar testes expandidos requer implementar().");
  }

  const raizProjeto = path.join(__dirname, "..");
  implementar('TM-F017', 'rapido', async () => {
    try {
      const resultado = await require('../scripts/testar-cartoes').testarCartoes();
      return pass('Cartoes validados com dados sinteticos, sem mensagens reais.', resultado);
    } catch (erro) { return fail(erro.message); }
  });

  function esperar(ms) {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Number(ms || 0) || 0)),
    );
  }

  function lerFonte(relativo) {
    const arquivo = path.join(raizProjeto, relativo);
    try {
      return fs.readFileSync(arquivo, "utf8");
    } catch (erro) {
      throw new Error(
        `Nao foi possivel ler ${relativo}: ${erro?.message || erro}`,
      );
    }
  }

  function contemTodos(fonte, termos = []) {
    return termos.every((termo) =>
      termo instanceof RegExp ? termo.test(fonte) : fonte.includes(String(termo)),
    );
  }

  function validarContratoFonte(relativo, termos, detalhe, observado = null) {
    const fonte = lerFonte(relativo);
    return contemTodos(fonte, termos)
      ? pass(detalhe, observado)
      : fail(`Contrato esperado nao foi encontrado em ${relativo}.`, {
          faltantes: termos
            .filter((termo) =>
              termo instanceof RegExp
                ? !termo.test(fonte)
                : !fonte.includes(String(termo)),
            )
            .map(String),
        });
  }

  function chaveConversaTeste(valor) {
    let id = String(valor || "")
      .trim()
      .toLowerCase()
      .replace(/:\d+(?=@)/, "");

    if (!id) return null;
    if (id.startsWith("u:") || id.startsWith("l:") || id.startsWith("g:")) {
      return id;
    }
    if (id.endsWith("@s.whatsapp.net")) return `u:${id.replace("@s.whatsapp.net", "")}`;
    if (id.endsWith("@c.us")) return `u:${id.replace("@c.us", "")}`;
    if (id.endsWith("@lid")) return `l:${id.replace("@lid", "")}`;
    if (id.endsWith("@g.us")) return `g:${id.replace("@g.us", "")}`;
    return `r:${id}`;
  }

  function criarControleConversaSintetico() {
    const {
      criarModuloControleConversa,
    } = require(path.join(raizProjeto, "renderer-modules", "controle-conversa.js"));

    const conversas = {
      "tm-a@s.whatsapp.net": {
        id: "tm-a@s.whatsapp.net",
        nome: "Teste A",
        mensagens: [],
        naoLidasLocal: 2,
      },
      "tm-b@s.whatsapp.net": {
        id: "tm-b@s.whatsapp.net",
        nome: "Teste B",
        mensagens: [],
        naoLidasLocal: 0,
      },
    };

    let conversaAtual = null;
    let modoIA = "manual";
    let aba = "conversas";
    let filtro = "";
    let trancadas = false;

    const modulo = criarModuloControleConversa({
      document,
      window,
      localStorage,
      conversas,
      CHAVE_HASH_TRANCADAS: "whatsiapp.testador.hash-sintetico",
      obterConversaAtual: () => conversaAtual,
      definirConversaAtual: (valor) => {
        conversaAtual = valor;
      },
      obterModoIAAtual: () => modoIA,
      definirModoIAAtual: (valor) => {
        modoIA = valor;
      },
      obterAbaAtual: () => aba,
      definirAbaAtual: (valor) => {
        aba = valor;
      },
      definirFiltro: (valor) => {
        filtro = valor;
      },
      definirTrancadasLiberadas: (valor) => {
        trancadas = !!valor;
      },
      obterModuloListaConversas: () => null,
    });

    const compositor = document.createElement("div");
    const barraResposta = document.createElement("div");
    const autorBarraResposta = document.createElement("span");
    const previewBarraResposta = document.createElement("span");
    const campoMensagem = document.createElement("textarea");
    const nomeChat = document.createElement("div");
    campoMensagem.disabled = false;

    const contadores = {
      render: 0,
      compositor: 0,
      cabecalho: 0,
      lidaLocal: 0,
      lidaRemota: 0,
    };

    modulo.configurarIntegracoes({
      compositor,
      barraResposta,
      autorBarraResposta,
      previewBarraResposta,
      campoMensagem,
      nomeChat,
      fecharPerfilContato: () => {},
      cancelarRespostaAutomaticaIAEmAndamento: () => {},
      obterModoIAConversa: () => "manual",
      atualizarBotoesModoIA: () => {},
      atualizarControleSegundoPlanoIA: () => {},
      atualizarIndicadorGeracaoAutomaticaIA: () => {},
      marcarConversaComoLidaLocal: () => {
        contadores.lidaLocal += 1;
      },
      marcarConversaComoLidaWhatsapp: () => {
        contadores.lidaRemota += 1;
      },
      atualizarStatusCabecalho: () => {},
      renderConversas: () => {
        contadores.render += 1;
      },
      atualizarCompositor: () => {
        contadores.compositor += 1;
      },
      renderMensagens: () => {
        contadores.render += 1;
      },
      atualizarBotaoArquivar: () => {},
      atualizarBotaoTrancar: () => {},
      atualizarCabecalhoConversa: () => {
        contadores.cabecalho += 1;
      },
      carregarFotoPerfil: () => {},
      assinarPresencaConversa: () => {},
      ehConversaGrupo: () => false,
      carregarNomesParticipantesGrupo: () => {},
      carregarMidiasDaConversa: () => {},
      obterUltimaMensagemRelevanteIA: () => null,
      requestAnimationFrame: (cb) => cb(),
    });

    return {
      modulo,
      conversas,
      compositor,
      barraResposta,
      autorBarraResposta,
      previewBarraResposta,
      campoMensagem,
      nomeChat,
      contadores,
      obterConversaAtual: () => conversaAtual,
      obterEstado: () => ({ modoIA, aba, filtro, trancadas }),
    };
  }

  function criarPrivacidadeSintetica(conversaInicial = {}) {
    const {
      criarModuloPrivacidadeConversa,
    } = require(path.join(raizProjeto, "renderer-modules", "privacidade-conversa.js"));

    const conversa = {
      id: "tm-priv@s.whatsapp.net",
      nome: "Teste Privacidade",
      grupo: false,
      arquivada: false,
      trancada: false,
      bloqueada: false,
      naoLidasLocal: 3,
      mensagens: [],
      ...conversaInicial,
    };
    const conversas = { [conversa.id]: conversa };
    const overrides = {};
    let persistencias = 0;
    let recalculos = 0;
    let renders = 0;

    const modulo = criarModuloPrivacidadeConversa({
      ipcRenderer: {
        invoke: async (_canal, dados) => ({
          ok: true,
          arquivada: !!dados?.arquivar,
          bloqueada: !!dados?.bloquear,
        }),
      },
      document,
      window,
      conversas,
      statusChat: document.createElement("div"),
      botaoArquivar: null,
      botaoTrancar: null,
      obterConversaAtual: () => conversa.id,
      solicitarSenhaParaTrancamento: async () => true,
      animarTrancamentoConversa: () => Promise.resolve(),
      overridesTrancadas: overrides,
      salvarOverridesTrancadas: () => {},
      persistirNaoLidasConversa: () => {
        persistencias += 1;
      },
      recalcularNaoLidasGlobal: () => {
        recalculos += 1;
      },
      atualizarContadores: () => {},
      limparSelecaoConversa: () => {},
      renderConversas: () => {
        renders += 1;
      },
      animarConversaParaAba: () => Promise.resolve(),
      abaArquivadas: document.createElement("div"),
      abaConversas: document.createElement("div"),
      atualizarStatusCabecalho: () => {},
      atualizarCabecalhoConversa: () => {},
      abrirConfirmacaoGerenciamentoConversa: () => {},
      notificacoesAtivasConversa: () => true,
      definirNotificacoesConversa: () => {},
      fecharMenuContexto: () => {},
      registrarMenuContexto: () => {},
    });

    return {
      modulo,
      conversa,
      overrides,
      metricas: () => ({ persistencias, recalculos, renders }),
    };
  }

  implementar("TM-C006", "rapido", async () =>
    validarContratoFonte(
      "index.js",
      [
        /function\s+solicitarAoWorker\s*\(/,
        "const timer = setTimeout(() => {",
        "solicitacoesPendentes.delete(id);",
        'erro: "O servico demorou demais para responder."'.replace("servico", "serviço"),
        "solicitacoesPendentes.set(id",
      ],
      "O transporte de workers possui timeout, remove a pendencia e resolve erro controlado sem travar a fila.",
    ),
  );

  implementar("TM-D011", "rapido", async () => {
    const teste = criarControleConversaSintetico();
    teste.modulo.abrirConversa("tm-a@s.whatsapp.net");
    const primeiro = teste.obterConversaAtual();
    teste.modulo.abrirConversa("tm-b@s.whatsapp.net");
    const segundo = teste.obterConversaAtual();

    const ok =
      primeiro === "tm-a@s.whatsapp.net" &&
      segundo === "tm-b@s.whatsapp.net" &&
      teste.nomeChat.textContent === "Teste B" &&
      teste.contadores.compositor >= 2 &&
      teste.contadores.cabecalho >= 2;

    return ok
      ? pass("A troca sintetica de conversa atualizou alvo, cabecalho e compositor sem tocar no estado real.", {
          primeiro,
          segundo,
          nomeChat: teste.nomeChat.textContent,
        })
      : fail("A troca sintetica de conversa nao atualizou todos os componentes esperados.", {
          primeiro,
          segundo,
          nomeChat: teste.nomeChat.textContent,
          contadores: teste.contadores,
        });
  });

  implementar("TM-E004", "rapido", async () => {
    const teste = criarControleConversaSintetico();
    teste.modulo.abrirConversa("tm-a@s.whatsapp.net");
    teste.modulo.ativarRespostaMensagem({
      idMensagem: "tm-reply-1",
      texto: "Mensagem original do teste",
      tipo: "texto",
      minha: false,
    });

    const ok =
      teste.barraResposta.style.display === "flex" &&
      teste.autorBarraResposta.textContent.includes("Teste A") &&
      teste.previewBarraResposta.textContent === "Mensagem original do teste";

    return ok
      ? pass("Barra de reply exibiu autor e preview corretos em fixture isolada.", {
          autor: teste.autorBarraResposta.textContent,
          preview: teste.previewBarraResposta.textContent,
        })
      : fail("Barra de reply sintetica divergiu do comportamento esperado.", {
          display: teste.barraResposta.style.display,
          autor: teste.autorBarraResposta.textContent,
          preview: teste.previewBarraResposta.textContent,
        });
  });

  implementar("TM-E005", "rapido", async () => {
    const teste = criarControleConversaSintetico();
    teste.modulo.abrirConversa("tm-a@s.whatsapp.net");
    teste.modulo.ativarRespostaMensagem({
      idMensagem: "tm-reply-2",
      texto: "Original imutavel",
      tipo: "texto",
      minha: true,
    });
    teste.modulo.limparRespostaMensagem(false);

    const originalPreservado =
      teste.conversas["tm-a@s.whatsapp.net"].mensagens.length === 0;
    const ok =
      teste.modulo.obterMensagemRespondendo() === null &&
      teste.barraResposta.style.display === "none" &&
      originalPreservado;

    return ok
      ? pass("Cancelar reply removeu somente o estado temporario e ocultou a barra.")
      : fail("Cancelamento do reply deixou estado temporario ativo.", {
          resposta: teste.modulo.obterMensagemRespondendo(),
          display: teste.barraResposta.style.display,
        });
  });

  implementar("TM-E006", "rapido", async () => {
    const {
      criarModuloAcoesMensagens,
    } = require(path.join(raizProjeto, "renderer-modules", "acoes-mensagens.js"));

    let copiado = null;
    let menuCriado = null;
    const modulo = criarModuloAcoesMensagens({
      ipcRenderer: { invoke: async () => ({ ok: true }) },
      document,
      window,
      clipboard: { writeText: (valor) => { copiado = String(valor); } },
      statusChat: document.createElement("div"),
      conversas: { "tm@s.whatsapp.net": { id: "tm@s.whatsapp.net", mensagens: [] } },
      obterConversaAtual: () => "tm@s.whatsapp.net",
      obterMensagemRespondendo: () => null,
      atualizarBarraRespostaMensagem: () => {},
      limparRespostaMensagem: () => {},
      registrarMensagemEditadaLocalmente: () => {},
      registrarMensagemApagadaLocalmente: () => {},
      obterRegistroMensagemApagada: () => null,
      criarTombstoneMensagemApagada: (msg) => msg,
      moduloAudio: { removerRegistroAudioOtimista: () => false },
      midiasEnviadasLocais: {},
      salvarMidiasEnviadasLocais: () => {},
      atualizarContadores: () => {},
      recalcularNaoLidasGlobal: () => {},
      renderConversas: () => {},
      renderMensagens: () => {},
      atualizarStatusCabecalho: () => {},
      fecharMenuContexto: () => { menuCriado?.remove?.(); menuCriado = null; },
      definirMenuContextoAtual: (menu) => { menuCriado = menu; },
      ativarRespostaMensagem: () => {},
      dadosMensagemParaReacao: () => null,
      abrirReacoesMensagem: () => {},
      dadosMensagemParaFavorito: () => null,
      mensagemEstaFavoritada: () => false,
      alterarFavoritoMensagem: () => {},
      abrirEncaminhamentoMensagem: () => {},
    });

    try {
      modulo.abrirMenuContextoMensagem(
        { preventDefault() {}, stopPropagation() {}, clientX: 20, clientY: 20 },
        { idMensagem: "tm-copy", tipo: "texto", texto: "Texto copiado pelo teste" },
      );
      const botao = Array.from(menuCriado?.querySelectorAll?.("button") || []).find(
        (item) => String(item.textContent || "").trim() === "Copiar",
      );
      botao?.click?.();
      return copiado === "Texto copiado pelo teste"
        ? pass("Acao Copiar enviou exatamente o texto da mensagem ao clipboard sintetico.")
        : fail("Acao Copiar nao produziu o texto esperado.", { copiado, botao: !!botao });
    } finally {
      menuCriado?.remove?.();
    }
  });

  implementar("TM-E014", "rapido", async () =>
    validarContratoFonte(
      "renderer-modules/acoes-mensagens.js",
      ['msg?.tipo !== "view_once"', 'criarOpcaoMenu("Encaminhar"'],
      "Menu de mensagem mantem encaminhamento indisponivel para view once.",
    ),
  );

  implementar("TM-F004", "seguro", async () =>
    validarContratoFonte(
      "renderer-modules/anexos.js",
      [
        /function\s+reconciliarVideoOtimista\s*\(/,
        "videosLocaisPendentes.entries()",
        "mensagemLocal.idMensagem = dados.idMensagem",
        "videosLocaisPendentes.delete(localId)",
      ],
      "Contrato de reconciliacao do video otimista atualiza o ID real e limpa o registro pendente.",
    ),
  );

  implementar("TM-F010", "seguro", async () =>
    validarContratoFonte(
      "renderer-modules/audio.js",
      [
        /function\s+cancelarGravacaoAtual\s*\(/,
        "descartarAoParar = true",
        "gravadorAudio.stop()",
        "restaurarInterfaceGravacao()",
      ],
      "Cancelamento de gravacao possui descarte explicito, parada do gravador e restauracao da interface.",
    ),
  );

  implementar("TM-F014", "rapido", async () => {
    const {
      criarModuloRenderizacaoMensagens,
    } = require(path.join(raizProjeto, "renderer-modules", "renderizacao-mensagens.js"));

    const conversaId = "tm-midia@s.whatsapp.net";
    const msg = {
      idMensagem: "tm-midia-historica",
      tipo: "imagem",
      texto: "",
      minha: false,
      timestamp: 1,
      mediaUrl: null,
      mediaPath: null,
    };
    const conversas = {
      [conversaId]: { id: conversaId, nome: "Midia", mensagens: [msg] },
    };
    let conversaAtual = conversaId;
    const mensagens = document.createElement("div");
    let invocacoes = 0;
    let liberarDownload;
    const modulo = criarModuloRenderizacaoMensagens({
      ipcRenderer: {
        invoke: (canal, dados) => {
          if (canal !== "carregar-midia" || dados?.idMensagem !== msg.idMensagem) {
            return { ok: false };
          }
          invocacoes += 1;
          return new Promise((resolve) => {
            liberarDownload = () => resolve({
              ok: true,
              mediaUrl: "file:///tm-fixture.png",
              mediaPath: "C:/tm-fixture.png",
              fileName: "tm-fixture.png",
            });
          });
        },
      },
      shell: { openExternal: async () => {} },
      document,
      console,
      mensagens,
      conversas,
      cargaMidiaEmAndamento: new Set(),
      obterConversaAtual: () => conversaAtual,
      proximaOcorrenciaLinkOuTelefone: () => null,
      criarLinkTelefoneMensagem: (valor) => document.createTextNode(String(valor || "")),
      criarConteudoMidia: () => document.createElement("div"),
      resolverNomeParticipanteGrupo: () => null,
      descricaoCurtaMensagemResposta: () => "Mensagem",
      destacarMensagemRespondida: () => {},
      abrirMenuContextoMensagem: () => {},
      criarLinhaReacoes: () => null,
      mensagemEstaFavoritada: () => false,
    });

    const antes = JSON.stringify({ id: msg.idMensagem, tipo: msg.tipo, timestamp: msg.timestamp });
    const carregamento = modulo.carregarUmaMidia(conversas[conversaId], msg);
    await Promise.resolve();
    conversas[conversaId] = {
      ...conversas[conversaId],
      mensagens: [{ ...msg }],
    };
    conversaAtual = null;
    liberarDownload();
    await carregamento;
    const mensagemAtual = conversas[conversaId].mensagens[0];
    const depois = JSON.stringify({ id: msg.idMensagem, tipo: msg.tipo, timestamp: msg.timestamp });

    return invocacoes === 1 && !!mensagemAtual.mediaUrl && antes === depois
      ? pass("Midia historica foi materializada na mensagem substituida, sem alterar sua identidade.", {
          invocacoes,
          mediaUrl: !!mensagemAtual.mediaUrl,
        })
      : fail("Carregamento sintetico nao reconciliou a midia com a mensagem atual.", {
          invocacoes,
          mediaUrl: mensagemAtual.mediaUrl,
          antes,
          depois,
        });
  });

  implementar("TM-G003", "seguro", async () => {
    const {
      criarModuloNovaConversa,
    } = require(path.join(raizProjeto, "renderer-modules", "nova-conversa.js"));

    const conversas = {};
    const provisorias = new Map();
    const documentoIsolado = { getElementById: () => null };
    const modulo = criarModuloNovaConversa({
      ipcRenderer: { invoke: async () => ({ ok: true, contatos: [], grupos: [] }) },
      document: documentoIsolado,
      requestAnimationFrame: (cb) => cb(),
      conversas,
      conversasProvisoriasNovaMensagem: provisorias,
      statusChat: null,
      naoLidasPersistidas: {},
      normalizarTextoBusca: (v) => String(v || "").toLowerCase(),
      criarAvatarContato: () => null,
      formatarNumeroWhatsapp: (v) => String(v || ""),
      ehConversaTecnica: () => false,
      trancamentoEfetivo: () => false,
      bloquearTrancadas: () => {},
      ativarAba: () => {},
      abrirConversa: () => {},
    });

    const contato = {
      id: "5511999999999@c.us",
      nome: "Contato Fixture",
      numeroWhatsapp: "5511999999999",
    };
    const primeira = modulo.obterOuCriarConversaContatoSalvo(contato);
    const segunda = modulo.obterOuCriarConversaContatoSalvo(contato);
    const total = Object.keys(conversas).length;

    return primeira === segunda && total === 1 && provisorias.size === 1
      ? pass("Criacao de conversa provisoria reutilizou a existente e nao duplicou o contato.", { total, provisorias: provisorias.size })
      : fail("Conversa provisoria sintetica foi duplicada.", { total, provisorias: provisorias.size });
  });

  implementar("TM-H005", "seguro", async () => {
    const teste = criarPrivacidadeSintetica({ trancada: false, naoLidasLocal: 5 });
    const okAcao = await teste.modulo.alterarTrancamento(teste.conversa);
    const metricas = teste.metricas();
    return okAcao && teste.conversa.trancada && teste.conversa.naoLidasLocal === 0 && teste.overrides[teste.conversa.id] === true && metricas.persistencias > 0
      ? pass("Trancamento sintetico ocultou nao lidas e persistiu override sem tocar em conversa real.")
      : fail("Trancamento sintetico divergiu do contrato.", { conversa: teste.conversa, overrides: teste.overrides, metricas });
  });

  implementar("TM-H006", "seguro", async () => {
    const teste = criarPrivacidadeSintetica({ trancada: true, naoLidasLocal: 0 });
    const okAcao = await teste.modulo.alterarTrancamento(teste.conversa);
    return okAcao && !teste.conversa.trancada && teste.overrides[teste.conversa.id] === false
      ? pass("Destrancamento sintetico restaurou a conversa ao fluxo normal.")
      : fail("Destrancamento sintetico nao restaurou o estado esperado.", { conversa: teste.conversa, overrides: teste.overrides });
  });

  implementar("TM-H008", "seguro", async () => {
    const {
      criarModuloControleConversa,
    } = require(path.join(raizProjeto, "renderer-modules", "controle-conversa.js"));
    const botao = { hidden: false };
    const busca = { value: "segredo" };
    const doc = {
      getElementById(id) {
        if (id === "btnRailTrancadas") return botao;
        if (id === "busca") return busca;
        return null;
      },
    };
    let aba = "trancadas";
    let filtro = "segredo";
    let liberadas = true;
    const modulo = criarModuloControleConversa({
      document: doc,
      window: {},
      localStorage,
      conversas: {},
      CHAVE_HASH_TRANCADAS: "tm",
      obterConversaAtual: () => null,
      definirConversaAtual: () => {},
      obterModoIAAtual: () => "manual",
      definirModoIAAtual: () => {},
      obterAbaAtual: () => aba,
      definirAbaAtual: (v) => { aba = v; },
      definirFiltro: (v) => { filtro = v; },
      definirTrancadasLiberadas: (v) => { liberadas = !!v; },
      obterModuloListaConversas: () => null,
    });
    modulo.bloquearTrancadas();
    return aba === "conversas" && filtro === "" && liberadas === false && botao.hidden === true && busca.value === ""
      ? pass("Fechamento sintetico de Trancadas limpou aba, filtro, busca e liberacao.")
      : fail("Estado de Trancadas nao foi totalmente limpo.", { aba, filtro, liberadas, hidden: botao.hidden, busca: busca.value });
  });

  implementar("TM-H011", "seguro", async () => {
    const teste = criarPrivacidadeSintetica({ naoLidasLocal: 0 });
    const okAcao = teste.modulo.marcarComoNaoLida(teste.conversa);
    const metricas = teste.metricas();
    return okAcao && teste.conversa.naoLidasLocal >= 1 && metricas.persistencias > 0 && metricas.recalculos > 0
      ? pass("Marcar como nao lida atualizou contador sintetico, persistencia e recalculo global.", { naoLidas: teste.conversa.naoLidasLocal })
      : fail("Marcar como nao lida nao atualizou todos os estados esperados.", { conversa: teste.conversa, metricas });
  });

  implementar("TM-I004", "rapido", async () =>
    validarContratoFonte(
      "renderer-modules/eventos-whatsapp.js",
      ["!conversa.trancada", "notificacoesAtivasConversa(conversa)", "tocarSomNovaMensagem({"],
      "Gate de mensagem recebida exige conversa nao trancada e notificacoes ativas antes do som.",
    ),
  );

  implementar("TM-I005", "rapido", async () =>
    validarContratoFonte(
      "renderer-modules/eventos-whatsapp.js",
      ["!conversa.trancada", "mostrarToastInternoNovaMensagem(conversa, dados)", "solicitarNotificacaoExternaMensagem(conversa, dados, jaExiste)"],
      "Gate de notificacao bloqueia fluxo publico para conversa trancada.",
    ),
  );

  implementar("TM-I006", "rapido", async () =>
    validarContratoFonte(
      "index.js",
      [
        'ipcMain.handle("mostrar-notificacao-mensagem"',
        "estadoJanela.focada && !estadoJanela.minimizada",
        'exibida: false',
        'motivo: "janela-em-foco"',
      ],
      "Processo principal suprime notificacao externa quando a janela esta focada e nao minimizada.",
    ),
  );

  implementar(
    "TM-K008",
    "rapido",
    async () => {
      const resultado = await bridge.invokeLeitura("catalogo-status");
      if (!resultado || typeof resultado !== "object") {
        return fail("Configuracao do catalogo nao retornou estrutura valida.", resultado);
      }
      const limites = resultado?.limites || resultado?.configuracao?.limites || null;
      return pass("Estado do catalogo pode ser lido sem acionar IA nem abrir seletor de arquivo.", {
        ok: resultado?.ok !== false,
        possuiLimites: !!limites,
        possuiArquivo: !!(resultado?.arquivo || resultado?.catalogo || resultado?.configuracao),
      });
    },
    10000,
  );

  implementar("TM-K010", "seguro", async () =>
    validarContratoFonte(
      "renderer-modules/admin.js",
      [
        "coletarAlteracoesPendentesAdmin",
        "confirmarRollbackAdmin",
        "adminRollbackOverlay",
        "Descartar alterações",
      ],
      "Admin possui deteccao de alteracoes pendentes e confirmacao explicita de rollback antes do descarte.",
    ),
  );

  implementar("TM-K014", "seguro", async () => {
    const {
      criarPersistenciaNaoLidas,
    } = require(path.join(raizProjeto, "renderer-modules", "lista-conversas.js"));
    const {
      criarPersistenciaMidiasEnviadasLocais,
    } = require(path.join(raizProjeto, "renderer-modules", "midia.js"));

    const chaves = [
      "whatsiapp.naoLidas.v1",
      "whatsiapp.midiasEnviadasLocais.v1",
    ];
    const backup = backupStorage(chaves);
    const idA = idSintetico("k014-a");
    const idB = idSintetico("k014-b");
    const caminhoFixture = path.join(__dirname, "assets", "status-teste.png");

    try {
      const naoLidas = criarPersistenciaNaoLidas({ localStorage });
      naoLidas.persistirNaoLidasConversa({ id: idA, naoLidasLocal: 4, trancada: false });
      naoLidas.persistirNaoLidasConversa({ id: idB, naoLidasLocal: 0, trancada: false });

      const midias = criarPersistenciaMidiasEnviadasLocais({
        localStorage,
        fs,
        pathToFileURL: (arquivo) => ({ href: `file:///${String(arquivo).replace(/\\/g, "/")}` }),
      });
      midias.persistirMidiaEnviadaLocal({
        idMensagem: `tm-k014-${Date.now()}`,
        mediaPath: caminhoFixture,
        mime: "image/png",
        fileName: "status-teste.png",
      });

      const dadosNaoLidas = JSON.parse(localStorage.getItem(chaves[0]) || "{}");
      const dadosMidia = JSON.parse(localStorage.getItem(chaves[1]) || "{}");
      const isolado = dadosNaoLidas[idA] === 4 && !dadosNaoLidas[idB] && Object.keys(dadosMidia).length >= 1;

      return isolado
        ? pass("Persistencias locais de nao lidas e midia ficaram isoladas por chave/conversa sem contaminar fixture vizinha.")
        : fail("Persistencias locais sinteticas se contaminaram ou nao foram gravadas.", { dadosNaoLidas, midias: Object.keys(dadosMidia).length });
    } finally {
      restaurarStorage(backup);
    }
  });

  implementar("TM-B015", "seguro", async () => {
    const conversas =
      typeof bridge?.listarConversasSanitizadas === "function"
        ? bridge.listarConversasSanitizadas()
        : [];
    const arquivo = path.join(
      path.dirname(path.join(process.env.HOME || "", "Library")),
      "Application Support",
      "WhatsIAPP",
      "privacidade-conversas-cache-v2.json",
    );

    let itens = [];
    try {
      const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
      itens = Array.isArray(dados?.itens) ? dados.itens : [];
    } catch (erro) {
      return warning("Cache de privacidade nao pode ser lido para a comparacao.", {
        arquivo,
        erro: erro?.message || String(erro),
      });
    }

    const chavesCache = new Set(
      itens.map((item) => String(item?.chave || "").trim()).filter(Boolean),
    );
    const candidatos = conversas.filter((item) => {
      const id = String(item?.id || "").toLowerCase();
      return id && id !== "status@broadcast" && !item?.tecnica;
    });
    const faltantes = candidatos
      .map((item) => ({ id: item.id, nome: item.nome }))
      .filter((item) => !chavesCache.has(chaveConversaTeste(item.id)));

    return faltantes.length === 0
      ? pass("Todas as conversas reais visiveis possuem estado no catalogo de privacidade.", {
          conversas: candidatos.length,
          itensCache: itens.length,
        })
      : warning("Existem conversas reais sem correspondencia no catalogo do WPPConnect.", {
          totalConversas: candidatos.length,
          faltantes: faltantes.slice(0, 20),
          totalFaltantes: faltantes.length,
        });
  });

  implementar("TM-L013", "seguro", async () => {
    const arquivo = path.join(
      path.dirname(path.join(process.env.HOME || "", "Library")),
      "Application Support",
      "WhatsIAPP",
      "privacidade-conversas-cache-v2.json",
    );

    let itens = [];
    try {
      const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
      itens = Array.isArray(dados?.itens) ? dados.itens : [];
    } catch (erro) {
      return warning("Cache de privacidade nao pode ser lido.", {
        arquivo,
        erro: erro?.message || String(erro),
      });
    }

    const chaves = itens.map((item) => String(item?.chave || "").trim());
    const duplicadas = chaves.filter(
      (chave, indice) => chave && chaves.indexOf(chave) !== indice,
    );
    const invalidos = itens.filter(
      (item) =>
        !String(item?.chave || "").trim() ||
        typeof item?.arquivada !== "boolean" ||
        typeof item?.trancada !== "boolean",
    );

    return !duplicadas.length && !invalidos.length
      ? pass("Cache de privacidade possui chaves unicas e estados validos.", {
          itens: itens.length,
          arquivadas: itens.filter((item) => item.arquivada).length,
          trancadas: itens.filter((item) => item.trancada).length,
        })
      : fail("Cache de privacidade possui duplicidades ou registros invalidos.", {
          duplicadas: [...new Set(duplicadas)].slice(0, 20),
          invalidos: invalidos.slice(0, 20),
        });
  });

  implementar("TM-L006", "rapido", async () =>
    validarContratoFonte(
      "index.js",
      [
        'ipcMain.handle("carregar-midia"',
        'solicitarAoWorker(\n    "baileys",\n    "carregar-midia"',
        "const ehMidiaConhecida = [",
        "const possuiIdHistoricoWpp = !!payloadWpp.idMensagemWpp",
        "const erroSemMetadados =",
        '"Mídia histórica sem os metadados necessários para download."',
        "if (!ehMidiaConhecida && !possuiIdHistoricoWpp && !erroSemMetadados)",
        '"recuperar-midia-historica"',
        '"registrar-midia-recuperada"',
      ],
      "Fallback de midia preserva Baileys como primeira rota, usa WPP para midia conhecida/ID historico/erro sem metadados e persiste a recuperacao localmente.",
    ),
  );

  implementar("TM-L009", "rapido", async () => {
    const fonte = lerFonte("renderer-modules/notificacoes-presenca.js");
    const listeners = (fonte.match(/ipcRenderer\.on\("presenca"/g) || []).length;
    const contrato = contemTodos(fonte, [
      "cancelarReassinaturaPresenca()",
      "agendarReassinaturaPresenca(conversa, atraso)",
      "tentativaAssinaturaPresenca",
    ]);
    return listeners === 1 && contrato
      ? pass("Modulo de presenca possui um unico listener e controla reassinaturas por timer cancelavel.", { listeners })
      : fail("Reassinatura de presenca perdeu contrato de listener unico/timer controlado.", { listeners, contrato });
  });

  implementar("TM-L010", "rapido", async () =>
    validarContratoFonte(
      "wpp-worker-modules/10-dispatcher-encerramento.js",
      [
        /async\s+function\s+encerrar\s*\(/,
        "clearInterval",
        "clearTimeout",
        "client?.close?.()",
        'mensagem.tipo === "encerrar"',
      ],
      "Encerramento WPP possui limpeza de timers e fechamento do cliente em handler dedicado.",
    ),
  );

  implementar("TM-L011", "rapido", async () =>
    validarContratoFonte(
      "whatsapp-worker.js",
      [
        /async\s+function\s+encerrarWorker\s*\(/,
        'mensagem.tipo === "encerrar"',
        /sock|socket/i,
        /end|close|logout/i,
      ],
      "Worker Baileys possui rotina dedicada de encerramento e fechamento de recursos.",
    ),
  );

  implementar("TM-M008", "seguro", async () => {
    if (
      typeof hooksRenderer?.registrarReacoesLocalmente !== "function" ||
      typeof hooksRenderer?.aplicarEstadoReacoesPersistidas !== "function" ||
      typeof hooksRenderer?.removerRegistroReacoes !== "function"
    ) {
      return fail("Hooks de reacao necessarios ao teste de rerender nao estao disponiveis.");
    }

    const chave = "whatsiapp.reacoesMensagens.v1";
    const backup = backupStorage([chave]);
    const conversaId = idSintetico("m008");
    const idMensagem = `tm-m008-${Date.now()}`;

    try {
      hooksRenderer.registrarReacoesLocalmente(conversaId, idMensagem, [
        { emoji: "👍", total: 1, minha: true },
      ]);
      const primeira = hooksRenderer.aplicarEstadoReacoesPersistidas(conversaId, {
        idMensagem,
        tipo: "texto",
        texto: "fixture",
      });
      const segunda = hooksRenderer.aplicarEstadoReacoesPersistidas(conversaId, {
        idMensagem,
        tipo: "texto",
        texto: "fixture recriada",
      });
      const ok = [primeira, segunda].every((msg) =>
        Array.isArray(msg?.reacoes) && msg.reacoes.some((r) => r.emoji === "👍" && r.minha),
      );
      return ok
        ? pass("Reacao persistida foi reaplicada em duas materializacoes consecutivas da mesma mensagem.")
        : fail("Reacao sintetica nao sobreviveu ao ciclo equivalente a rerender.", { primeira: primeira?.reacoes, segunda: segunda?.reacoes });
    } finally {
      try { hooksRenderer.removerRegistroReacoes(conversaId, idMensagem); } catch {}
      restaurarStorage(backup);
    }
  });

  // Testes novos de contratos importantes que nao existiam na matriz original.
  implementar("TM-P001", "rapido", async () =>
    validarContratoFonte(
      "wpp-worker.js",
      [
        '"historico-gap.js"',
        '"10-dispatcher-encerramento.js"',
      ],
      "Carregador WPP inclui historico-gap e dispatcher final na lista de modulos.",
    ),
  );

  implementar("TM-P002", "rapido", async () => {
    const fonte = lerFonte("index.js");
    const separado = contemTodos(fonte, [
      "fullReadyInicialLiberado",
      "wppFullReady",
      'origem: "bootstrap"',
      "wppFullReady: !!wppFullReady",
    ]);
    return separado
      ? pass("READY rapido e WPP FULL_READY usam estados separados no processo principal.")
      : fail("Contrato de separacao entre READY rapido e WPP FULL_READY nao foi encontrado no processo principal.");
  });

  implementar("TM-P003", "rapido", async () =>
    validarContratoFonte(
      "index.js",
      [
        "fotosPrincipaisProntas",
        'etapa: "fotos-principais"',
        "fullReadyInicialLiberado",
      ],
      "Bootstrap mantem etapa dedicada de fotos Principais antes da liberacao rapida.",
    ),
  );

  implementar("TM-P004", "rapido", async () =>
    validarContratoFonte(
      "index.js",
      [
        'ipcMain.handle("enviar-audio-gravado"',
        'solicitarAoWorker("baileys", "enviar-audio-gravado"',
      ],
      "PTT gravado continua roteado diretamente ao Baileys.",
    ),
  );

  implementar("TM-P005", "rapido", async () =>
    validarContratoFonte(
      "index.js",
      [
        'if (tipo === "video")',
        '"baileys",\n      "enviar-anexo"',
      ],
      "Video continua usando rota direta Baileys para evitar regressao do WPPConnect.",
    ),
  );

  implementar("TM-P006", "rapido", async () =>
    validarContratoFonte(
      "wpp-worker-modules/02-mensagens-operacoes.js",
      [
        "deleteChat",
        /reconsult|consult|confirm/i,
        /ultimoEstado/,
      ],
      "Exclusao de conversa mantem confirmacao contra estado real antes de limpar estado local.",
    ),
  );

  implementar("TM-P007", "rapido", async () => {
    const pasta = path.join(raizProjeto, "wpp-worker-modules");
    const esperados = [
      "01-nucleo-sincronizacao.js",
      "02-mensagens-operacoes.js",
      "03-midia-recebimento.js",
      "04-arquivamento-presenca.js",
      "05-inicializacao-wpp.js",
      "06-contatos-grupos.js",
      "07-figurinhas-contatos.js",
      "08-status-base-listagem.js",
      "09-status-operacoes.js",
      "historico-gap.js",
      "10-dispatcher-encerramento.js",
    ];
    const faltantes = esperados.filter((nome) => !fs.existsSync(path.join(pasta, nome)));
    return !faltantes.length
      ? pass("Todos os modulos esperados do worker WPP estao presentes no pacote.", { total: esperados.length })
      : fail("Faltam modulos obrigatorios do worker WPP.", faltantes);
  });

  implementar("TM-P008", "rapido", async () => {
    const retry = await diagnosticoMain("snapshot");
    const arquivo = retry?.caches?.retry || {};
    return arquivo.existe && Number(arquivo.bytes || 0) > 2
      ? pass("Cache de retry de mensagens/PTT existe e possui conteudo.", arquivo)
      : skip("Cache de retry ainda nao foi utilizado nesta instalacao; teste nao se aplica agora.", arquivo);
  }, 5000);

  implementar("TM-P009", "rapido", async () => {
    const fonte = lerFonte("index.js");
    const inicioWpp = fonte.indexOf(
      'if (tipoWorker === "wpp" && mensagem.evento === "mensagem")',
    );
    const inicioBaileys = fonte.indexOf(
      'if (tipoWorker === "baileys" && mensagem.evento === "mensagem")',
    );

    const blocoWpp =
      inicioWpp >= 0 ? fonte.slice(inicioWpp, inicioWpp + 1500) : "";
    const blocoBaileys =
      inicioBaileys >= 0 ? fonte.slice(inicioBaileys, inicioBaileys + 1700) : "";

    function gateAntesDoTempoReal(bloco) {
      const gate = bloco.indexOf("mensagemEhCatchupDaInicializacao");
      const som = bloco.indexOf("dispararSomMensagemImediato");
      const encaminhar = bloco.indexOf("encaminharMensagemTempoReal");
      const registro = bloco.indexOf(
        "registrarCatchupSilencioso(dadosMensagem",
      );
      const retorno = bloco.indexOf("return;", registro);

      return (
        gate >= 0 &&
        registro >= 0 &&
        retorno > registro &&
        som > retorno &&
        encaminhar > retorno
      );
    }

    const contratoBase = contemTodos(fonte, [
      "inicioSessaoMensagensSegundos",
      "sincronizacaoMensagensSilenciosaAtiva",
      "timestamp < inicioSessaoMensagensSegundos",
      "[SYNC MENSAGENS] CATCHUP_SILENCIOSO",
      "[SYNC MENSAGENS] MODO_AO_VIVO",
    ]);

    const ok =
      contratoBase &&
      gateAntesDoTempoReal(blocoWpp) &&
      gateAntesDoTempoReal(blocoBaileys);

    return ok
      ? pass(
          "Catch-up anterior a sessao e bloqueado antes do som e do encaminhamento ao renderer nas duas fontes.",
        )
      : fail(
          "O gate de sincronizacao silenciosa nao antecede integralmente o fluxo de tempo real.",
          {
            contratoBase,
            wpp: gateAntesDoTempoReal(blocoWpp),
            baileys: gateAntesDoTempoReal(blocoBaileys),
          },
        );
  });

  implementar("TM-P010", "rapido", async () =>
    validarContratoFonte(
      "wpp-worker-modules/01-nucleo-sincronizacao.js",
      [
        /function\s+normalizarNaoLidasChatWpp\s*\(/,
        "chat?.unreadCount",
        "naoLidas: normalizarNaoLidasChatWpp(chat?.unreadCount)",
        "item?.naoLidas",
      ],
      "WPPConnect transporta unreadCount do chat para o estado compartilhado.",
    ),
  );

  implementar("TM-P011", "rapido", async () =>
    validarContratoFonte(
      "index.js",
      [
        "const estadoNaoLidasWpp = new Map()",
        "geracaoEstadoNaoLidasWpp",
        "sequenciaEstadoNaoLidasWpp",
        "naoLidasWpp:",
        "naoLidasWppRevisao:",
        "naoLidasWppGeracao:",
      ],
      "Processo principal mantem nao lidas WPP com geracao/revisao e injeta o estado nos snapshots.",
    ),
  );

  implementar("TM-P012", "rapido", async () =>
    validarContratoFonte(
      "renderer-modules/eventos-whatsapp.js",
      [
        /function\s+lerEstadoNaoLidasWpp\s*\(/,
        /function\s+estadoWppMaisNovoQueConversa\s*\(/,
        "const wppJaAutoritativo",
        "!wppJaAutoritativo &&",
        "[NAO LIDAS] WPP_AUTORITATIVO",
      ],
      "Renderer prioriza revisao autoritativa WPP e impede fallback Baileys atrasado de rebaixar o contador.",
    ),
  );

  implementar(
    "TM-P013",
    "seguro",
    async () => {
      const primeira = bridge
        .listarConversasSanitizadas()
        .filter(
          (item) =>
            !item.tecnica &&
            !item.trancada &&
            item.naoLidasWpp !== null &&
            Number(item.naoLidasWppRevisao || 0) > 0 &&
            !!String(item.naoLidasWppGeracao || ""),
        );

      if (!primeira.length) {
        return skip(
          "Nenhuma conversa possui estado WPP autoritativo exposto nesta execucao.",
        );
      }

      const porIdPrimeira = new Map(
        primeira.map((item) => [item.id, item]),
      );

      await esperar(2400);

      const segunda = bridge
        .listarConversasSanitizadas()
        .filter((item) => porIdPrimeira.has(item.id));

      const divergenciasEstaveis = segunda.filter((atual) => {
        const anterior = porIdPrimeira.get(atual.id);
        const mesmaGeracao =
          String(anterior?.naoLidasWppGeracao || "") ===
          String(atual?.naoLidasWppGeracao || "");
        const mesmaRevisao =
          Number(anterior?.naoLidasWppRevisao || 0) ===
          Number(atual?.naoLidasWppRevisao || 0);
        const mesmoTotal =
          Number(anterior?.naoLidasWpp || 0) ===
          Number(atual?.naoLidasWpp || 0);
        const aindaDiverge =
          Number(atual?.naoLidasLocal || 0) !==
          Number(atual?.naoLidasWpp || 0);

        return mesmaGeracao && mesmaRevisao && mesmoTotal && aindaDiverge;
      });

      if (divergenciasEstaveis.length) {
        return fail(
          "Existem conversas cujo contador local permaneceu divergente de uma revisao WPP estavel por mais de um ciclo de polling.",
          divergenciasEstaveis.slice(0, 5).map((item) => ({
            id: item.id,
            local: item.naoLidasLocal,
            wpp: item.naoLidasWpp,
            revisao: item.naoLidasWppRevisao,
          })),
        );
      }

      return pass(
        "Contadores locais convergiram ou o estado remoto mudou durante a janela de observacao.",
        {
          conversasObservadas: primeira.length,
          janelaMs: 2400,
        },
      );
    },
    6000,
  );

  implementar("TM-P014", "rapido", async () => {
    const fonte = lerFonte("wpp-worker-modules/05-inicializacao-wpp.js");
    const inicio = fonte.indexOf("function iniciarPolling()");
    const bloco = inicio >= 0 ? fonte.slice(inicio, inicio + 1800) : "";

    const polling2s =
      /timerAtualizacao\s*=\s*setInterval\([\s\S]*?\},\s*2000\s*\);/.test(
        bloco,
      );
    const reconcilia = bloco.includes(
      "atualizarEstadoArquivamento(true, false)",
    );

    return polling2s && reconcilia
      ? pass(
          "Polling WPP de unreadCount permanece em 2000 ms, dentro da meta de ate 3 segundos.",
          { intervaloMs: 2000 },
        )
      : fail(
          "Polling de reconciliacao de leitura nao esta mais configurado em 2 segundos.",
          { polling2s, reconcilia },
        );
  });

  implementar("TM-P015", "rapido", async () => {
    const fonteMain = lerFonte("index.js");
    const fonteWpp = lerFonte(
      "wpp-worker-modules/10-dispatcher-encerramento.js",
    );

    const inicio = fonteMain.indexOf(
      'ipcMain.handle("marcar-conversa-lida"',
    );
    const blocoMain =
      inicio >= 0 ? fonteMain.slice(inicio, inicio + 2200) : "";

    const mainOk = contemTodos(blocoMain, [
      "Promise.all",
      'solicitarAoWorker("baileys", "marcar-conversa-lida"',
      'solicitarAoWorker("wpp", "marcar-conversa-lida"',
      "leituraBaileys:",
      "leituraWpp:",
    ]);

    const wppOk = contemTodos(fonteWpp, [
      /async\s+function\s+marcarConversaComoLidaWpp\s*\(/,
      "client.sendSeen(chatId)",
      'acao === "marcar-conversa-lida"',
      "[LEITURA WPP] SEND_SEEN_OK",
    ]);

    return mainOk && wppOk
      ? pass(
          "Leitura bidirecional continua roteada em paralelo por Baileys e WPPConnect sendSeen.",
        )
      : fail(
          "Contrato de leitura bidirecional perdeu um dos caminhos.",
          { mainOk, wppOk },
        );
  });

  implementar("TM-P018", "rapido", async () => {
    const {
      normalizarStatus,
      mesclarStatus,
      criarRegistroStatus,
      criarIndicadorStatus,
    } = require(path.join(raizProjeto, "scripts/status-entrega.js"));

    const estados = ["pendente", "enviada", "entregue", "lida"];
    const progressao = estados.reduce(
      (atual, estado) => mesclarStatus(atual, estado),
      null,
    );
    const semRebaixamento =
      progressao === "lida" &&
      mesclarStatus("lida", "entregue") === "lida" &&
      mesclarStatus("erro", "pendente") === "erro";

    const memoria = new Map();
    const storage = {
      getItem: (chave) => memoria.get(chave) || null,
      setItem: (chave, valor) => memoria.set(chave, valor),
    };
    const registro = criarRegistroStatus(storage);
    registro.mesclar("5511999999999@c.us", "status-teste", "enviada");
    registro.mesclar("5511999999999@s.whatsapp.net", "status-teste", "lida");
    await Promise.resolve();
    const restaurado = criarRegistroStatus(storage).mesclar(
      "5511999999999@c.us",
      "status-teste",
    );

    const documento = {
      createElement: () => ({
        dataset: {},
        setAttribute() {},
        className: "",
        innerHTML: "",
      }),
    };
    const indicador = criarIndicadorStatus(documento, {
      minha: true,
      statusEntrega: "lida",
    });
    const indicadorDesconhecido = criarIndicadorStatus(documento, {
      minha: true,
      statusEntrega: "desconhecido",
    });

    const ok =
      normalizarStatus("desconhecido") === null &&
      semRebaixamento &&
      restaurado === "lida" &&
      indicador?.dataset?.statusEntrega === "lida" &&
      indicadorDesconhecido === null;

    return ok
      ? pass(
          "Estados de entrega sao mesclados monotonicamente, persistem somente apos confirmacao e nao exibem tique para estado desconhecido.",
          { progressao, restaurado, indicador: indicador?.dataset?.statusEntrega },
        )
      : fail("O contrato de status de entrega permitiu rebaixamento ou exibicao sem confirmacao.", {
          progressao,
          restaurado,
          indicador: indicador?.dataset?.statusEntrega || null,
          indicadorDesconhecido: indicadorDesconhecido ? "presente" : null,
        });
  });

  implementar(
    "TM-P016",
    "real",
    async (contexto = {}) => {
      const alvo = String(contexto?.alvoTeste || "").trim();

      if (!alvo) {
        return fail(
          "O executor liberou o teste R2 sem uma conversa alvo autorizada.",
          null,
        );
      }

      const conversaAntes = bridge
        .listarConversasSanitizadas()
        .find((item) => item.id === alvo);

      if (!conversaAntes) {
        return fail(
          "A conversa autorizada nao esta disponivel no snapshot atual.",
          { alvo },
        );
      }

      const inicio = Date.now();
      const resultado = await bridge.invokeAcaoTeste(
        "marcar-conversa-lida",
        { conversaId: alvo },
      );

      const doisCaminhos =
        resultado?.ok === true &&
        resultado?.leituraBaileys === true &&
        resultado?.leituraWpp === true;

      let conversaDepois = null;
      const limite = Date.now() + 3200;

      do {
        conversaDepois = bridge
          .listarConversasSanitizadas()
          .find((item) => item.id === alvo);

        if (Number(conversaDepois?.naoLidasLocal || 0) === 0) {
          break;
        }

        await esperar(250);
      } while (Date.now() < limite);

      const zerouLocal =
        Number(conversaDepois?.naoLidasLocal || 0) === 0;

      return doisCaminhos && zerouLocal
        ? pass(
            "Conversa autorizada foi marcada como lida pelos dois workers e o contador local convergiu para zero.",
            {
              antes: Number(conversaAntes.naoLidasLocal || 0),
              depois: Number(conversaDepois?.naoLidasLocal || 0),
              leituraBaileys: !!resultado?.leituraBaileys,
              leituraWpp: !!resultado?.leituraWpp,
              duracaoMs: Date.now() - inicio,
            },
          )
        : fail(
            "A propagacao real de leitura nao confirmou os dois caminhos ou nao convergiu para zero.",
            {
              resultado,
              antes: Number(conversaAntes.naoLidasLocal || 0),
              depois: Number(conversaDepois?.naoLidasLocal || 0),
              duracaoMs: Date.now() - inicio,
            },
          );
    },
    10000,
  );
}

module.exports = {
  registrarTestesExpandidos,
};
