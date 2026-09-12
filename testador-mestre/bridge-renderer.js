"use strict";

const CANAIS_LEITURA_PERMITIDOS = new Set([
  "obter-sincronizacao-inicial-atual",
  "testador-mestre-diagnostico-main",
  "listar-contatos-salvos-whatsapp",
  "listar-grupos-whatsapp",
  "listar-grupos-em-comum",
  "listar-participantes-grupo",
  "listar-status-whatsapp",
  "listar-visualizadores-status-whatsapp",
  "status-uso-groq",
  "admin-config-publica",
  "catalogo-status",
]);


const CANAIS_STATUS_TESTE_PERMITIDOS = new Set([
  "publicar-status-whatsapp",
  "apagar-status-whatsapp",
]);

const CANAIS_ACAO_TESTE_PERMITIDOS = new Set([
  "marcar-conversa-lida",
]);
function criarBridgeRenderer(deps = {}) {
  const {
    ipcRenderer,
    document,
    window,
    localStorage,
    obterEstadoRenderer,
    obterConversas,
    ehConversaTecnica,
    hooksRenderer = {},
  } = deps;

  if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
    throw new Error("IPC renderer indisponivel para o Testador Mestre.");
  }

  const referenciasOriginais = Object.freeze({
    ipcInvoke: ipcRenderer.invoke,
    consoleLog: console.log,
    consoleWarn: console.warn,
    consoleError: console.error,
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    clearTimeout: globalThis.clearTimeout,
    clearInterval: globalThis.clearInterval,
    addEventListener:
      typeof EventTarget !== "undefined"
        ? EventTarget.prototype.addEventListener
        : null,
    removeEventListener:
      typeof EventTarget !== "undefined"
        ? EventTarget.prototype.removeEventListener
        : null,
  });

  function copiarEstadoRenderer() {
    const estado =
      typeof obterEstadoRenderer === "function" ? obterEstadoRenderer() : {};

    return JSON.parse(JSON.stringify(estado || {}));
  }

  function listarConversasSanitizadas() {
    const origem =
      typeof obterConversas === "function" ? obterConversas() : [];
    const lista = Array.isArray(origem)
      ? origem
      : Object.values(origem && typeof origem === "object" ? origem : {});

    return lista
      .filter((conversa) => conversa && conversa.id)
      .map((conversa) => {
        const mensagens = Array.isArray(conversa.mensagens)
          ? conversa.mensagens
          : [];
        const ultima = mensagens.reduce((atual, msg) => {
          if (!msg) return atual;
          const timestamp = Number(msg.timestamp || 0) || 0;
          if (!atual || timestamp >= atual.timestamp) {
            return {
              timestamp,
              tipo: String(msg.tipo || ""),
              minha: !!msg.minha,
            };
          }
          return atual;
        }, null);

        return {
          id: String(conversa.id),
          nome: String(conversa.nome || conversa.id),
          numeroWhatsapp: conversa.numeroWhatsapp ? String(conversa.numeroWhatsapp) : null,
          grupo:
            !!conversa.grupo || String(conversa.id).toLowerCase().endsWith("@g.us"),
          arquivada: !!conversa.arquivada,
          trancada: !!conversa.trancada,
          bloqueada: !!conversa.bloqueada,
          naoLidasLocal: Math.max(0, Number(conversa.naoLidasLocal || 0) || 0),
          naoLidasWpp:
            conversa.naoLidasWpp === null ||
            conversa.naoLidasWpp === undefined
              ? null
              : Math.max(0, Number(conversa.naoLidasWpp || 0) || 0),
          naoLidasWppRevisao:
            Math.max(0, Number(conversa.naoLidasWppRevisao || 0) || 0),
          naoLidasWppGeracao:
            String(conversa.naoLidasWppGeracao || ""),
          totalMensagens: mensagens.length,
          timestamp: Number(conversa.timestamp || 0) || 0,
          ultimaMensagem: ultima,
          tecnica:
            typeof ehConversaTecnica === "function"
              ? !!ehConversaTecnica(conversa)
              : false,
          testeIntegridadeIA: !!conversa.testeIntegridadeIA,
        };
      });
  }


  function normalizarBusca(valor) {
    if (typeof hooksRenderer?.normalizarTextoBusca === "function") {
      return String(hooksRenderer.normalizarTextoBusca(valor) || "");
    }

    return String(valor || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function listarMensagensSanitizadas(limite = 2500) {
    const origem =
      typeof obterConversas === "function" ? obterConversas() : [];
    const lista = Array.isArray(origem)
      ? origem
      : Object.values(origem && typeof origem === "object" ? origem : {});

    const saida = [];
    const maximo = Math.max(1, Math.min(5000, Number(limite || 2500) || 2500));

    for (const conversa of lista) {
      if (!conversa?.id) continue;

      const tecnica =
        typeof ehConversaTecnica === "function"
          ? !!ehConversaTecnica(conversa)
          : false;

      for (const msg of Array.isArray(conversa.mensagens) ? conversa.mensagens : []) {
        if (!msg || !msg.idMensagem || msg.apagadaParaTodos || msg.tipo === "apagada") {
          continue;
        }

        saida.push({
          conversaId: String(conversa.id),
          tecnica,
          trancada: !!conversa.trancada,
          idMensagem: String(msg.idMensagem),
          tipo: String(msg.tipo || "texto"),
          texto: String(msg.texto || "").slice(0, 800),
          fileName: String(msg.fileName || "").slice(0, 260),
          timestamp: Number(msg.timestamp || 0) || 0,
          minha: !!msg.minha,
        });

        if (saida.length >= maximo) {
          return saida;
        }
      }
    }

    return saida;
  }

  function obterInfoPlanoRenderer() {
    let pesquisaWebPermitida = null;

    try {
      if (typeof hooksRenderer?.pesquisaWebPermitidaPeloPlano === "function") {
        pesquisaWebPermitida = !!hooksRenderer.pesquisaWebPermitidaPeloPlano();
      }
    } catch {}

    return {
      niveisContextoIA: Array.isArray(hooksRenderer?.niveisContextoIA)
        ? [...hooksRenderer.niveisContextoIA]
        : [],
      pesquisaWebPermitida,
    };
  }

  async function invokeLeitura(canal, dados = undefined) {
    const nome = String(canal || "").trim();

    if (!CANAIS_LEITURA_PERMITIDOS.has(nome)) {
      const erro = new Error(`Canal nao permitido pelo bridge: ${nome || "vazio"}`);
      erro.codigo = "TM_BRIDGE_CHANNEL_BLOCKED";
      throw erro;
    }

    if (dados === undefined) {
      return ipcRenderer.invoke(nome);
    }

    return ipcRenderer.invoke(nome, dados);
  }

  async function invokeStatusTeste(canal, dados = undefined) {
    const nome = String(canal || "").trim();

    if (!CANAIS_STATUS_TESTE_PERMITIDOS.has(nome)) {
      const erro = new Error(`Canal de Status de teste nao permitido: ${nome || "vazio"}`);
      erro.codigo = "TM_STATUS_CHANNEL_BLOCKED";
      throw erro;
    }

    if (dados === undefined) {
      return ipcRenderer.invoke(nome);
    }

    return ipcRenderer.invoke(nome, dados);
  }

  async function invokeAcaoTeste(canal, dados = undefined) {
    const nome = String(canal || "").trim();

    if (!CANAIS_ACAO_TESTE_PERMITIDOS.has(nome)) {
      const erro = new Error(`Canal de acao de teste nao permitido: ${nome || "vazio"}`);
      erro.codigo = "TM_ACTION_CHANNEL_BLOCKED";
      throw erro;
    }

    if (dados === undefined) {
      return ipcRenderer.invoke(nome);
    }

    return ipcRenderer.invoke(nome, dados);
  }

  function verificarReferenciasGlobais() {
    return {
      ipcInvoke: ipcRenderer.invoke === referenciasOriginais.ipcInvoke,
      consoleLog: console.log === referenciasOriginais.consoleLog,
      consoleWarn: console.warn === referenciasOriginais.consoleWarn,
      consoleError: console.error === referenciasOriginais.consoleError,
      setTimeout: globalThis.setTimeout === referenciasOriginais.setTimeout,
      setInterval: globalThis.setInterval === referenciasOriginais.setInterval,
      clearTimeout: globalThis.clearTimeout === referenciasOriginais.clearTimeout,
      clearInterval: globalThis.clearInterval === referenciasOriginais.clearInterval,
      addEventListener:
        !referenciasOriginais.addEventListener ||
        EventTarget.prototype.addEventListener ===
          referenciasOriginais.addEventListener,
      removeEventListener:
        !referenciasOriginais.removeEventListener ||
        EventTarget.prototype.removeEventListener ===
          referenciasOriginais.removeEventListener,
    };
  }

  function snapshotDom() {
    const porId = (id) => document?.getElementById?.(id) || null;
    const compositor = porId("compositorMensagem");
    const overlaySync = porId("sincronizacaoInicialOverlay");
    const btnTrancadas = porId("btnRailTrancadas");

    return {
      body: !!document?.body,
      listaConversas: !!porId("listaConversas"),
      mensagens: !!porId("mensagens"),
      compositor: !!compositor,
      compositorDisplay: compositor?.style?.display || null,
      respostaIA: !!porId("respostaIA"),
      adminOverlay: !!porId("adminOcultoOverlay"),
      adminConteudo: !!porId("adminOcultoConteudo"),
      overlaySincronizacao: !!overlaySync,
      trancadasHidden: btnTrancadas ? !!btnTrancadas.hidden : null,
      testadorRoots: document?.querySelectorAll?.("#testadorMestreOverlay")?.length || 0,
    };
  }

  function listarChavesStorage(prefixo = "") {
    const saida = [];
    const inicio = String(prefixo || "");

    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const chave = localStorage.key(i);
        if (chave && (!inicio || chave.startsWith(inicio))) {
          saida.push(chave);
        }
      }
    } catch {}

    return saida.sort();
  }

  return Object.freeze({
    versao: "1.2.0",
    canaisLeitura: Object.freeze(Array.from(CANAIS_LEITURA_PERMITIDOS)),
    canaisAcaoTeste: Object.freeze(Array.from(CANAIS_ACAO_TESTE_PERMITIDOS)),
    copiarEstadoRenderer,
    listarConversasSanitizadas,
    listarMensagensSanitizadas,
    normalizarBusca,
    obterInfoPlanoRenderer,
    invokeLeitura,
    invokeStatusTeste,
    invokeAcaoTeste,
    verificarReferenciasGlobais,
    snapshotDom,
    listarChavesStorage,
    temWindow: !!window,
  });
}

module.exports = {
  criarBridgeRenderer,
  CANAIS_LEITURA_PERMITIDOS,
  CANAIS_STATUS_TESTE_PERMITIDOS,
  CANAIS_ACAO_TESTE_PERMITIDOS,
};
