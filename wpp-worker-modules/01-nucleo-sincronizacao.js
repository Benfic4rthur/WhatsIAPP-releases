const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");

const ffmpegPath = require("ffmpeg-static");
const wppconnect = require("@wppconnect-team/wppconnect");

let client = null;
let encerrando = false;
let sincronizando = false;
let timerAtualizacao = null;
let timerProntidao = null;

let estadoConexao = "INICIANDO";
let modoStream = null;
let infoStream = null;
let whatsappPronto = false;
let fullReady = false;
let prontidaoInicialFinalizada = false;
let preparandoProntidaoInicial = false;
let qrAceito = false;
let qrAguardandoLeitura = false;

const aliasesParaChat = new Map();
const cacheLidPn = new Map();

let ultimoEstado = [];
let maiorQuantidadeChats = 0;
let estadoPrivacidadeCompleto = false;

let catalogoBaileys = [];
let sincronizandoCatalogo = false;
let catalogoPendente = false;
let timerCatalogo = null;

let quantidadeConversasBaileys = Math.max(
  0,
  Number(workerData?.quantidadeConversasBaileys || 0) || 0,
);
let resumoConversasBaileysRecebido = Number.isFinite(
  Number(workerData?.quantidadeConversasBaileys),
);
let primeiraLeituraVaziaFinalEm = 0;
let ultimoAvisoCatalogoIncompletoEm = 0;
let ultimaQuantidadeCatalogoAvisada = null;
let ultimoAvisoProntidaoWppEm = 0;

let assinaturaUltimoEstadoEmitido = "";
let assinaturaCatalogoAtual = "";
let assinaturaCatalogoSincronizado = "";

let presencaChatAtualWpp = null;
let presencaConversaAtualOrigem = null;
let presencaConversaPendente = null;
let presencaConversaDesejada = null;
let timerRevalidacaoPresenca = null;
let listenerPresenca = null;
let presencaIdsAssinadosWpp = new Set();
let timersReforcoPresencaWpp = [];
let ultimaPresencaEventoWppEm = 0;
const cachePresenca = new Map();
const mensagensEnviadasWpp = new Map();
const desarquivamentosPendentes = new Map();
const arquivamentosAguardandoCliente = new Map();
let processandoArquivamentosAguardando = false;
let timerArquivamentosAguardando = null;
let listenerAckWpp = null;
let listenerMensagensWpp = null;
let listenerReacoesWpp = null;

let ultimoPercentualLoadingWpp = null;
let ultimaMensagemLoadingWpp = null;

const marcosInternosWppVistos = new Set();

function classificarLogInternoWpp(linha) {
  const texto = String(linha || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!texto) {
    return null;
  }

  const regras = [
    {
      chave: "browser-initializing",
      etapa: "wpp-interno-browser",
      termos: ["initializing browser"],
    },
    {
      chave: "browser-started",
      etapa: "wpp-interno-browser-pronto",
      termos: ["browser initialized", "browser started", "browser ready"],
    },
    {
      chave: "client-initializing",
      etapa: "wpp-interno-client-init",
      termos: ["initializing client"],
    },
    {
      chave: "page-loading",
      etapa: "wpp-interno-pagina",
      termos: ["loading page", "page loading", "page loaded"],
    },
    {
      chave: "inject-wapi",
      etapa: "wpp-interno-wapi",
      termos: ["injecting wapi", "wapi.js", "inject wapi"],
    },
    {
      chave: "check-logged",
      etapa: "wpp-interno-check-login",
      termos: ["checking is logged", "checking islogged"],
    },
    {
      chave: "authenticated",
      etapa: "wpp-interno-auth",
      termos: ["authenticated", "is authenticated"],
    },
    {
      chave: "phone-connected",
      etapa: "wpp-interno-phone",
      termos: ["checking phone is connected"],
    },
    {
      chave: "register-state",
      etapa: "wpp-interno-register-state",
      termos: ["registering onstatechange event"],
    },
    {
      chave: "register-stream-mode",
      etapa: "wpp-interno-register-stream-mode",
      termos: ["registering onstreammodechanged event"],
    },
    {
      chave: "register-stream-info",
      etapa: "wpp-interno-register-stream-info",
      termos: ["registering onstreaminfochanged event"],
    },
    {
      chave: "register-ack",
      etapa: "wpp-interno-register-ack",
      termos: ["registering onack event"],
    },
    {
      chave: "register-message",
      etapa: "wpp-interno-register-message",
      termos: ["registering onmessage event"],
    },
    {
      chave: "ready",
      etapa: "wpp-interno-ready",
      termos: ["wppconnect is ready", "client is ready"],
    },
  ];

  const minusculo = texto.toLowerCase();

  for (const regra of regras) {
    if (!regra.termos.some((termo) => minusculo.includes(termo))) {
      continue;
    }

    if (marcosInternosWppVistos.has(regra.chave)) {
      return null;
    }

    marcosInternosWppVistos.add(regra.chave);

    return {
      etapa: regra.etapa,
      detalhe: texto.slice(0, 180),
    };
  }

  return null;
}

function observarLinhaInternaWpp(linha) {
  try {
    const marco = classificarLogInternoWpp(linha);

    if (!marco) {
      return;
    }

    enviarEtapaSincronizacao(marco.etapa, marco.detalhe);
  } catch {}
}

function instalarObservadorLogsInternosWpp() {
  const stdoutOriginal = process.stdout.write.bind(process.stdout);
  const stderrOriginal = process.stderr.write.bind(process.stderr);

  const criarWrapper = (original) => {
    return function (chunk, encoding, callback) {
      try {
        const texto = Buffer.isBuffer(chunk)
          ? chunk.toString(typeof encoding === "string" ? encoding : "utf8")
          : String(chunk || "");

        for (const linha of texto.split(/\r?\n/)) {
          observarLinhaInternaWpp(linha);
        }
      } catch {}

      return original(chunk, encoding, callback);
    };
  };

  process.stdout.write = criarWrapper(stdoutOriginal);
  process.stderr.write = criarWrapper(stderrOriginal);
}

instalarObservadorLogsInternosWpp();

function registrarLoadingScreenWpp(percent, message) {
  const percentualNumero = Number(percent);

  const percentual = Number.isFinite(percentualNumero)
    ? Math.max(0, Math.min(100, Math.round(percentualNumero)))
    : null;

  const mensagem = String(message || "")
    .replace(/\s+/g, " ")
    .trim();

  const mudouPercentual =
    percentual !== null && percentual !== ultimoPercentualLoadingWpp;

  const mudouMensagem = !!mensagem && mensagem !== ultimaMensagemLoadingWpp;

  if (!mudouPercentual && !mudouMensagem) {
    return;
  }

  ultimoPercentualLoadingWpp = percentual;
  ultimaMensagemLoadingWpp = mensagem || ultimaMensagemLoadingWpp;

  const partes = [];

  if (percentual !== null) {
    partes.push(`${percentual}%`);
  }

  if (mensagem) {
    partes.push(mensagem);
  }

  enviarEtapaSincronizacao(
    "wpp-loading",
    partes.join(" | ") || "loading-screen",
  );
}

function enviar(evento, dados) {
  parentPort.postMessage({
    tipo: "evento",
    evento,
    dados,
  });
}

function enviarEtapaSincronizacao(etapa, detalhe = null) {
  enviar("sync-stage", {
    etapa,
    detalhe,
  });
}

function normalizarNaoLidasChatWpp(valor) {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) {
    return null;
  }

  // O WhatsApp usa valor negativo quando o chat foi marcado manualmente
  // como nao lido, mesmo sem uma quantidade numerica normal.
  if (numero < 0) {
    return 1;
  }

  return Math.max(0, Math.floor(numero));
}

function assinaturaEstado(lista) {
  return JSON.stringify(
    (lista || [])
      .map((item) => ({
        id: normalizarId(item?.id),
        arquivada: !!item?.arquivada,
        trancada: !!item?.trancada,
        naoLidas:
          item?.naoLidas === null || item?.naoLidas === undefined
            ? null
            : Number(item.naoLidas),
      }))
      .filter((item) => item.id)
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function assinaturaCatalogo(ids) {
  return (ids || []).map(normalizarId).filter(Boolean).sort().join("|");
}

function receberResumoConversasBaileys(dados = {}) {
  const quantidade = Number(dados?.quantidade);

  if (!Number.isFinite(quantidade) || quantidade < 0) {
    return false;
  }

  quantidadeConversasBaileys = Math.floor(quantidade);
  resumoConversasBaileysRecebido = true;
  primeiraLeituraVaziaFinalEm = 0;

  return true;
}

function streamWppEstaFinal() {
  return (
    String(modoStream || "").toUpperCase() === "MAIN" &&
    String(infoStream || "").toUpperCase() === "NORMAL"
  );
}

function quantidadeCatalogoWppPronta(quantidade) {
  const total = Math.max(0, Number(quantidade || 0) || 0);

  if (!resumoConversasBaileysRecebido) {
    return total > 0;
  }

  if (quantidadeConversasBaileys === 0) {
    if (total > 0) {
      primeiraLeituraVaziaFinalEm = 0;
      return true;
    }

    if (!streamWppEstaFinal()) {
      primeiraLeituraVaziaFinalEm = 0;
      return false;
    }

    if (!primeiraLeituraVaziaFinalEm) {
      primeiraLeituraVaziaFinalEm = Date.now();
      return false;
    }

    // Contas realmente vazias também concluem, mas somente depois de o
    // Baileys confirmar zero e o WPP permanecer vazio em MAIN/NORMAL.
    return Date.now() - primeiraLeituraVaziaFinalEm >= 5000;
  }

  primeiraLeituraVaziaFinalEm = 0;

  // As duas sessões pertencem à mesma conta. Aceitamos uma pequena diferença
  // para metadados que um motor filtra e o outro mantém, mas não um catálogo
  // transitório de 0/3 chats enquanto centenas ainda estão sincronizando.
  const tolerancia = Math.max(
    2,
    Math.ceil(quantidadeConversasBaileys * 0.02),
  );
  const minimoEsperado = Math.max(
    1,
    quantidadeConversasBaileys - tolerancia,
  );

  return total >= minimoEsperado;
}

function avisarCatalogoWppIncompleto(quantidade) {
  const agora = Date.now();

  if (
    ultimaQuantidadeCatalogoAvisada === quantidade &&
    agora - ultimoAvisoCatalogoIncompletoEm < 10000
  ) {
    return;
  }

  ultimaQuantidadeCatalogoAvisada = quantidade;
  ultimoAvisoCatalogoIncompletoEm = agora;

  console.log(
    `WPPConnect: catálogo ainda sincronizando ` +
      `(wpp=${quantidade}, baileys=${quantidadeConversasBaileys}).`,
  );
}

function emitirEstadoSeMudou(forcar = false) {
  const assinatura =
    `${estadoPrivacidadeCompleto ? "1" : "0"}:` +
    assinaturaEstado(ultimoEstado);

  if (!forcar && assinatura === assinaturaUltimoEstadoEmitido) {
    return false;
  }

  assinaturaUltimoEstadoEmitido = assinatura;

  enviar("archive-state", {
    itens: ultimoEstado,
    completo: estadoPrivacidadeCompleto,
  });

  return true;
}

function serializarId(valor) {
  if (!valor) return null;

  if (typeof valor === "string") {
    return valor;
  }

  return (
    valor._serialized ||
    valor.id ||
    (valor.user && valor.server ? `${valor.user}@${valor.server}` : null)
  );
}

function normalizarId(valor) {
  const id = serializarId(valor);

  if (!id) return null;

  return String(id)
    .trim()
    .toLowerCase()
    .replace(/:\d+(?=@)/, "");
}

function chaveCanonica(valor) {
  const id = normalizarId(valor);

  if (!id) return null;

  if (id.endsWith("@s.whatsapp.net")) {
    return `u:${id.replace("@s.whatsapp.net", "")}`;
  }

  if (id.endsWith("@c.us")) {
    return `u:${id.replace("@c.us", "")}`;
  }

  if (id.endsWith("@lid")) {
    return `l:${id.replace("@lid", "")}`;
  }

  if (id.endsWith("@g.us")) {
    return `g:${id.replace("@g.us", "")}`;
  }

  return `r:${id}`;
}

function converterBaileysParaWpp(valor) {
  const id = normalizarId(valor);

  if (!id) return null;

  if (id.endsWith("@s.whatsapp.net")) {
    return id.replace("@s.whatsapp.net", "@c.us");
  }

  return id;
}

function formatarNumeroContatoWpp(valor) {
  const id = normalizarId(valor);

  if (!id || (!id.endsWith("@c.us") && !id.endsWith("@s.whatsapp.net"))) {
    return null;
  }

  const digitos = id.replace(/@(c\.us|s\.whatsapp\.net)$/i, "").replace(/\D/g, "");

  if (digitos.startsWith("55") && digitos.length >= 12) {
    const ddd = digitos.slice(2, 4);
    const telefone = digitos.slice(4);

    if (telefone.length === 9) {
      return `+55 (${ddd}) ${telefone.slice(0, 5)}-${telefone.slice(5)}`;
    }

    if (telefone.length === 8) {
      return `+55 (${ddd}) ${telefone.slice(0, 4)}-${telefone.slice(4)}`;
    }
  }

  return digitos ? `+${digitos}` : null;
}

function nomeDoChat(chat) {
  const id = normalizarId(chat?.id || chat?.contact?.id);

  if (id?.endsWith("@g.us")) {
    return chat?.name || chat?.subject || null;
  }

  if (chat?.contact?.isMe === true) {
    return chat?.contact?.name || chat?.name || chat?.contact?.pushname || null;
  }

  if (chat?.contact?.isMyContact === true) {
    return (
      chat?.contact?.name ||
      chat?.contact?.formattedName ||
      chat?.contact?.shortName ||
      null
    );
  }

  return (
    formatarNumeroContatoWpp(chat?.contact?.phoneNumber) ||
    formatarNumeroContatoWpp(chat?.contact?.id) ||
    formatarNumeroContatoWpp(chat?.id) ||
    null
  );
}

function adicionarVariantesDeId(set, valor) {
  const id = normalizarId(valor);

  if (!id) return;

  set.add(id);

  if (id.endsWith("@c.us")) {
    set.add(id.replace("@c.us", "@s.whatsapp.net"));
  }

  if (id.endsWith("@s.whatsapp.net")) {
    set.add(id.replace("@s.whatsapp.net", "@c.us"));
  }
}

function aliasesBasicosDoChat(chat) {
  const aliases = new Set();

  const candidatos = [
    chat?.id,
    chat?.contact?.id,
    chat?.groupMetadata?.id,
    chat?.contact?.wid,
    chat?.contact?.lid,
    chat?.contact?.phoneNumber,
    chat?.contact?.pn,
  ];

  for (const candidato of candidatos) {
    adicionarVariantesDeId(aliases, candidato);
  }

  return aliases;
}

async function completarAliasesLid(chat, aliases) {
  if (!client || typeof client.getPnLidEntry !== "function") {
    return;
  }

  const idsLid = Array.from(aliases).filter((id) => id.endsWith("@lid"));

  for (const lid of idsLid) {
    if (cacheLidPn.has(lid)) {
      const salvo = cacheLidPn.get(lid);

      adicionarVariantesDeId(aliases, salvo?.lid);

      adicionarVariantesDeId(aliases, salvo?.phoneNumber);

      continue;
    }

    try {
      const info = await client.getPnLidEntry(lid);

      if (info) {
        cacheLidPn.set(lid, info);

        adicionarVariantesDeId(aliases, info.lid);

        adicionarVariantesDeId(aliases, info.phoneNumber);
      }
    } catch {
      cacheLidPn.set(lid, null);
    }
  }
}

function idChat(chat) {
  return normalizarId(chat?.id);
}

function mesclarChats(destino, origem, forcarArquivada = false) {
  for (const chat of origem || []) {
    const id = idChat(chat);

    if (!id) continue;

    const existente = destino.get(id);

    if (!existente) {
      destino.set(id, {
        ...chat,
        archive: forcarArquivada ? true : !!chat.archive,
      });

      continue;
    }

    destino.set(id, {
      ...existente,
      ...chat,
      archive: forcarArquivada
        ? true
        : typeof chat.archive === "boolean"
          ? chat.archive
          : !!existente.archive,
    });
  }
}

async function tentarListChats(options) {
  if (!client || typeof client.listChats !== "function") {
    return [];
  }

  try {
    const chats = await client.listChats(options);

    return Array.isArray(chats) ? chats : [];
  } catch (erro) {
    console.log(`WPPConnect listChats falhou: ${erro?.message || erro}`);

    return [];
  }
}

async function listarChatsRobusto() {
  const mapa = new Map();

  // 1. Lista normal sem opções.
  const listaNormal = await tentarListChats();

  mesclarChats(mapa, listaNormal, false);

  // 2. Pede as arquivadas explicitamente.
  // Mesmo que a lista normal ainda esteja parcial,
  // esta consulta pode trazer as arquivadas separadamente.
  const listaArquivadas = await tentarListChats({
    onlyArchived: true,
  });

  mesclarChats(mapa, listaArquivadas, true);

  return Array.from(mapa.values());
}

async function emitirDiagnosticoWaJs() {
  if (!client?.page || encerrando) {
    return false;
  }

  let dados = null;

  try {
    dados = await client.page.evaluate(() => {
      const d = window.__WHATSIAPP_WAJS_DIAG;

      if (!d || typeof d !== "object") {
        return null;
      }

      return {
        bootAt: Number(d.bootAt) || null,
        settleStart: Number(d.settleStart) || null,
        settleEnd: Number(d.settleEnd) || null,
        settleResult: d.settleResult || null,
        settleCount: Number(d.settleCount) || null,
        injectedAt: Number(d.injectedAt) || null,
        mainInitEventAt: Number(d.mainInitEventAt) || null,
        mainInitAwaitStart: Number(d.mainInitAwaitStart) || null,
        mainInitAwaitEnd: Number(d.mainInitAwaitEnd) || null,
        coreStart: Number(d.coreStart) || null,
        coreEnd: Number(d.coreEnd) || null,
        readyAt: Number(d.readyAt) || null,
        mainReadyEventAt: Number(d.mainReadyEventAt) || null,
        fullReadyAt: Number(d.fullReadyAt) || null,
      };
    });
  } catch {
    return false;
  }

  if (!dados) {
    enviarEtapaSincronizacao(
      "wajs-diagnostico",
      "objeto __WHATSIAPP_WAJS_DIAG nao encontrado",
    );

    return false;
  }

  const duracao = (inicio, fim) => {
    const a = Number(inicio);
    const b = Number(fim);

    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {
      return null;
    }

    return `${(b - a).toFixed(1)}ms`;
  };

  const desdeBoot = (momento) => {
    const a = Number(dados.bootAt);
    const b = Number(momento);

    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {
      return null;
    }

    return `${(b - a).toFixed(1)}ms desde loader`;
  };

  const settleDuracao = duracao(dados.settleStart, dados.settleEnd);

  enviarEtapaSincronizacao(
    "wajs-settle",
    [
      `resultado=${dados.settleResult || "?"}`,
      settleDuracao ? `duracao=${settleDuracao}` : null,
      Number.isFinite(dados.settleCount)
        ? `modulos=${dados.settleCount}`
        : null,
    ]
      .filter(Boolean)
      .join(" | "),
  );

  enviarEtapaSincronizacao(
    "wajs-main-init",
    [
      duracao(dados.mainInitAwaitStart, dados.mainInitAwaitEnd)
        ? `espera=${duracao(dados.mainInitAwaitStart, dados.mainInitAwaitEnd)}`
        : null,
      desdeBoot(dados.mainInitEventAt),
    ]
      .filter(Boolean)
      .join(" | ") || "sem dados",
  );

  enviarEtapaSincronizacao(
    "wajs-core-module",
    duracao(dados.coreStart, dados.coreEnd)
      ? `espera=${duracao(dados.coreStart, dados.coreEnd)}`
      : "sem dados",
  );

  enviarEtapaSincronizacao(
    "wajs-is-ready",
    desdeBoot(dados.readyAt) || "sem dados",
  );

  enviarEtapaSincronizacao(
    "wajs-main-ready",
    desdeBoot(dados.mainReadyEventAt) || "sem dados",
  );

  enviarEtapaSincronizacao(
    "wajs-full-ready",
    desdeBoot(dados.fullReadyAt) || "sem dados",
  );

  return true;
}

async function verificarProntidao() {
  if (!client || encerrando) {
    return false;
  }

  let estado = null;
  let isFullReady = false;

  try {
    if (typeof client.getConnectionState === "function") {
      estado = await client.getConnectionState();

      if (estado) {
        estadoConexao = String(estado);
      }
    }
  } catch {}

  try {
    if (client?.page) {
      const estadoPagina = await client.page.evaluate(() => ({
        fullReady: !!window.WPP?.isFullReady,
        stream:
          typeof window.WPP?.conn?.getStreamData === "function"
            ? window.WPP.conn.getStreamData()
            : null,
      }));

      isFullReady = !!estadoPagina?.fullReady;

      if (estadoPagina?.stream?.mode) {
        modoStream = String(estadoPagina.stream.mode);
      }

      if (estadoPagina?.stream?.info) {
        infoStream = String(estadoPagina.stream.info);
      }
    }
  } catch {}

  // API publica de autenticacao, inclusive para sessao restaurada e revogada.
  if (!(await confirmarAutenticacaoWpp("poll:autenticado"))) return false;

  const interfacePronta = streamWppEstaFinal();

  if (isFullReady && interfacePronta && !fullReady) {
    fullReady = true;
    whatsappPronto = true;

    console.log("WPPConnect: FULL_READY detectado, preparando estado interno.");

    await emitirDiagnosticoWaJs();

    enviarEtapaSincronizacao("wpp-full-ready-detectado", "FULL_READY");

    agendarRevalidacaoPresenca(500, "FULL_READY");
  }

  if (fullReady && interfacePronta) {
    return true;
  }

  const textoModo = String(modoStream || "").toUpperCase();

  const textoInfo = String(infoStream || "").toUpperCase();

  // MAIN significa que a interface carregou, mas NÃO que o histórico completo
  // terminou. Para contas grandes, só consideramos realmente pronto quando
  // WPP.isFullReady ficar true.
  if (
    (textoModo === "MAIN" || textoInfo === "NORMAL") &&
    Date.now() - ultimoAvisoProntidaoWppEm >= 10000
  ) {
    ultimoAvisoProntidaoWppEm = Date.now();
    console.log(
      "WPPConnect: aguardando MAIN/NORMAL e catálogo completo...",
    );
  }

  return false;
}

function marcarDesarquivamentoPendente(chave) {
  if (!chave) {
    return;
  }

  desarquivamentosPendentes.set(chave, Date.now() + 15000);
}

function aplicarDesarquivamentosPendentes(novoEstado) {
  const agora = Date.now();

  for (const [chave, expiraEm] of desarquivamentosPendentes.entries()) {
    if (agora > expiraEm) {
      desarquivamentosPendentes.delete(chave);
    }
  }

  for (const item of novoEstado || []) {
    const aliases = [item.id, ...(item.aliases || [])];

    for (const alias of aliases) {
      const chave = chaveCanonica(alias);

      if (!chave || !desarquivamentosPendentes.has(chave)) {
        continue;
      }

      if (item.arquivada === false) {
        desarquivamentosPendentes.delete(chave);
      } else {
        // Snapshot do WhatsApp Web ainda esta atrasado.
        item.arquivada = false;
      }
    }
  }
}

async function atualizarEstadoArquivamento(emitir = true, forcar = false) {
  if (!client || sincronizando || encerrando) {
    return ultimoEstado;
  }

  const pronto = await verificarProntidao();

  if (!pronto && !forcar) {
    console.log(
      `WPPConnect aguardando FULL_READY ` +
        `(estado=${estadoConexao}, modo=${modoStream || "-"}, info=${infoStream || "-"}).`,
    );

    return ultimoEstado;
  }

  sincronizando = true;

  try {
    const revisao = revisaoAutenticacaoWpp;
    const chats = await listarChatsRobusto();

    if (chats.length === 0) {
      if (!quantidadeCatalogoWppPronta(0)) {
        avisarCatalogoWppIncompleto(0);
        return ultimoEstado;
      }
    }

    if (
      !prontidaoInicialFinalizada &&
      !quantidadeCatalogoWppPronta(chats.length)
    ) {
      avisarCatalogoWppIncompleto(chats.length);
      return ultimoEstado;
    }
    if (!qrAceito || revisao !== revisaoAutenticacaoWpp) return ultimoEstado;

    const novoEstado = [];
    const novosAliases = new Map();

    for (const chat of chats) {
      const id = idChat(chat);

      if (!id) continue;

      const aliases = aliasesBasicosDoChat(chat);

      // Só tenta resolver LID -> telefone quando o WhatsApp
      // já está pronto, e guarda em cache.
      if (pronto) {
        await completarAliasesLid(chat, aliases);
      }

      for (const alias of aliases) {
        const chave = chaveCanonica(alias);

        if (chave) {
          novosAliases.set(chave, id);
        }
      }

      novoEstado.push({
        id,
        aliases: Array.from(aliases),
        arquivada: !!chat.archive,
        trancada: !!chat.isLocked,
        nome: nomeDoChat(chat),
        naoLidas: normalizarNaoLidasChatWpp(chat?.unreadCount),
      });
    }

    if (!qrAceito || revisao !== revisaoAutenticacaoWpp) return ultimoEstado;

    // Durante a primeira sincronização o WhatsApp pode devolver
    // listas parciais. Não deixa uma leitura menor apagar
    // um estado maior que já foi carregado.
    aplicarDesarquivamentosPendentes(novoEstado);

    const podeSubstituir =
      maiorQuantidadeChats === 0 ||
      novoEstado.length >= maiorQuantidadeChats ||
      (prontidaoInicialFinalizada &&
        novoEstado.length >= Math.floor(maiorQuantidadeChats * 0.98));

    if (!podeSubstituir) {
      console.log(
        `WPPConnect ignorou leitura parcial: ` +
          `${novoEstado.length} < ${maiorQuantidadeChats}.`,
      );

      return ultimoEstado;
    }

    aliasesParaChat.clear();

    for (const [chave, id] of novosAliases.entries()) {
      aliasesParaChat.set(chave, id);
    }

    ultimoEstado = novoEstado;

    maiorQuantidadeChats = Math.max(maiorQuantidadeChats, novoEstado.length);

    if (pronto) {
      estadoPrivacidadeCompleto = true;
    }

    const mudou = emitir ? emitirEstadoSeMudou(false) : false;

    if (mudou) {
      const totalArquivadas = ultimoEstado.filter(
        (item) => item.arquivada,
      ).length;

      const totalTrancadas = ultimoEstado.filter(
        (item) => item.trancada,
      ).length;

      console.log(
        `WPPConnect: estado alterado, ` +
          `${ultimoEstado.length} chats, ` +
          `${totalArquivadas} arquivados, ` +
          `${totalTrancadas} trancados.`,
      );
    }

    return ultimoEstado;
  } finally {
    sincronizando = false;
  }
}

function converterCatalogoParaWpp(valor) {
  const id = normalizarId(valor);

  if (!id) return null;

  if (
    id === "status@broadcast" ||
    id.endsWith("@broadcast") ||
    id.endsWith("@newsletter")
  ) {
    return null;
  }

  if (id.endsWith("@s.whatsapp.net")) {
    return id.replace("@s.whatsapp.net", "@c.us");
  }

  return id;
}

function atualizarUltimoEstadoComCatalogo(resultados) {
  const mapa = new Map();

  for (const item of ultimoEstado || []) {
    const chave = chaveCanonica(item.id);

    if (chave) {
      mapa.set(chave, item);
    }

    for (const alias of item.aliases || []) {
      const chaveAlias = chaveCanonica(alias);

      if (chaveAlias) {
        mapa.set(chaveAlias, item);
      }
    }
  }

  for (const item of resultados || []) {
    const aliases = new Set();

    adicionarVariantesDeId(aliases, item.idOrigem);

    adicionarVariantesDeId(aliases, item.idWpp);

    const registro = {
      id:
        item.idWpp || converterCatalogoParaWpp(item.idOrigem) || item.idOrigem,
      aliases: Array.from(aliases),
      arquivada: !!item.arquivada,
      trancada: !!item.trancada,
      nome: item.nome || null,
      naoLidas:
        item?.naoLidas === null || item?.naoLidas === undefined
          ? null
          : normalizarNaoLidasChatWpp(item.naoLidas),
    };

    for (const alias of aliases) {
      const chave = chaveCanonica(alias);

      if (chave) {
        mapa.set(chave, registro);
      }
    }
  }

  const unicos = new Map();

  for (const item of mapa.values()) {
    const chave = chaveCanonica(item.id);

    if (!chave) continue;

    unicos.set(chave, item);
  }

  ultimoEstado = Array.from(unicos.values());

  aliasesParaChat.clear();

  for (const item of ultimoEstado) {
    const aliases = [item.id, ...(item.aliases || [])];

    for (const alias of aliases) {
      const chave = chaveCanonica(alias);

      if (chave) {
        aliasesParaChat.set(chave, item.id);
      }
    }
  }

  maiorQuantidadeChats = Math.max(maiorQuantidadeChats, ultimoEstado.length);
}

async function consultarLoteCatalogo(lote) {
  if (!client?.page) {
    return [];
  }

  const entrada = lote
    .map((idOrigem) => ({
      idOrigem,
      idWpp: converterCatalogoParaWpp(idOrigem),
    }))
    .filter((item) => item.idWpp);

  if (!entrada.length) {
    return [];
  }

  return await client.page.evaluate(async (entradaPagina) => {
    const resultados = [];

    if (typeof WPP === "undefined" || !WPP.chat) {
      return resultados;
    }

    for (const item of entradaPagina) {
      try {
        let chat = WPP.chat.get(item.idWpp);

        if (!chat) {
          chat = await WPP.chat.find(item.idWpp);
        }

        if (!chat) {
          resultados.push({
            idOrigem: item.idOrigem,
            idWpp: item.idWpp,
            encontrado: false,
          });

          continue;
        }

        const idReal =
          chat.id?.toString?.() || chat.id?._serialized || item.idWpp;

        resultados.push({
          idOrigem: item.idOrigem,
          idWpp: idReal,
          encontrado: true,
          arquivada: !!chat.archive,
          trancada: !!chat.isLocked,
          nome:
            chat.contact?.name ||
            chat.name ||
            chat.contact?.formattedName ||
            chat.contact?.pushname ||
            null,
          naoLidas: Number.isFinite(Number(chat.unreadCount))
            ? Number(chat.unreadCount) < 0
              ? 1
              : Math.max(0, Math.floor(Number(chat.unreadCount)))
            : null,
        });
      } catch (erro) {
        resultados.push({
          idOrigem: item.idOrigem,
          idWpp: item.idWpp,
          encontrado: false,
          erro: erro?.message || String(erro),
        });
      }
    }

    return resultados;
  }, entrada);
}

async function sincronizarCatalogoBaileys() {
  if (encerrando || !client || !catalogoBaileys.length) {
    return;
  }

  if (sincronizandoCatalogo) {
    catalogoPendente = true;
    return;
  }

  if (!whatsappPronto && !fullReady) {
    catalogoPendente = true;

    clearTimeout(timerCatalogo);

    timerCatalogo = setTimeout(sincronizarCatalogoBaileys, 700);

    return;
  }

  sincronizandoCatalogo = true;
  catalogoPendente = false;

  const ids = Array.from(new Set(catalogoBaileys));

  console.log(`WPPConnect: analisando ${ids.length} conversas em chunks.`);

  let totalLocalizadas = 0;

  try {
    const tamanhoLote = 12;

    for (let i = 0; i < ids.length; i += tamanhoLote) {
      if (encerrando) {
        break;
      }

      const lote = ids.slice(i, i + tamanhoLote);

      const resultados = await consultarLoteCatalogo(lote);

      const validosLote = resultados.filter((item) => item?.encontrado);

      if (validosLote.length) {
        totalLocalizadas += validosLote.length;

        atualizarUltimoEstadoComCatalogo(validosLote);

        emitirEstadoSeMudou(false);
      }

      if (
        i === 0 ||
        (i + tamanhoLote) % 60 === 0 ||
        i + tamanhoLote >= ids.length
      ) {
        console.log(
          `WPPConnect chunks: ` +
            `${Math.min(i + tamanhoLote, ids.length)}/${ids.length}, ` +
            `${totalLocalizadas} localizadas.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    if (totalLocalizadas > 0) {
      assinaturaCatalogoSincronizado = assinaturaCatalogoAtual;
    } else if (!fullReady) {
      catalogoPendente = true;

      clearTimeout(timerCatalogo);

      timerCatalogo = setTimeout(sincronizarCatalogoBaileys, 700);
    }

    if (fullReady && !estadoPrivacidadeCompleto) {
      await atualizarEstadoArquivamento(true, true);
    }
  } catch (erro) {
    console.error(
      "Erro ao sincronizar catalogo Baileys no WPPConnect:",
      erro?.message || erro,
    );

    if (!encerrando) {
      catalogoPendente = true;

      clearTimeout(timerCatalogo);

      timerCatalogo = setTimeout(sincronizarCatalogoBaileys, 900);
    }
  } finally {
    sincronizandoCatalogo = false;

    if (catalogoPendente && !encerrando) {
      catalogoPendente = false;

      clearTimeout(timerCatalogo);

      timerCatalogo = setTimeout(sincronizarCatalogoBaileys, 500);
    }
  }
}

function receberCatalogoBaileys(ids) {
  const novoCatalogo = Array.from(
    new Set((ids || []).map(normalizarId).filter(Boolean)),
  );

  const novaAssinatura = assinaturaCatalogo(novoCatalogo);

  catalogoBaileys = novoCatalogo;
  assinaturaCatalogoAtual = novaAssinatura;

  if (
    fullReady &&
    novaAssinatura &&
    novaAssinatura === assinaturaCatalogoSincronizado
  ) {
    return;
  }

  clearTimeout(timerCatalogo);

  timerCatalogo = setTimeout(sincronizarCatalogoBaileys, 200);
}

async function resolverChatId(idOrigem) {
  const chave = chaveCanonica(idOrigem);

  if (chave && aliasesParaChat.has(chave)) {
    return aliasesParaChat.get(chave);
  }

  // Nao bloqueia envio/presenca esperando FULL_READY ou uma leitura
  // global de centenas de chats. Para IDs normais, a conversao direta
  // e suficiente. LID continua sendo resolvido pontualmente depois.
  return converterBaileysParaWpp(idOrigem);
}
