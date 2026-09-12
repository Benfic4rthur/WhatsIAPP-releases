const { parentPort, workerData } = require("worker_threads");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const pino = require("pino");
const os = require("os");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { pathToFileURL } = require("url");

const consoleLogOriginal = console.log.bind(console);
const consoleInfoOriginal = console.info.bind(console);
const consoleWarnOriginal = console.warn.bind(console);
const consoleErrorOriginal = console.error.bind(console);

function textoLogSignal(args) {
  return (args || [])
    .map((item) => {
      if (item instanceof Error) {
        return `${item.name || "Error"}: ${item.message || ""}`;
      }

      return String(item ?? "");
    })
    .join(" ");
}

function ehLogSignalRuidoso(args) {
  const primeiro = String(args?.[0] ?? "");
  const texto = textoLogSignal(args);

  return (
    primeiro.startsWith(
      "Closing open session in favor of incoming prekey bundle",
    ) ||
    primeiro.startsWith("Closing session: SessionEntry") ||
    (texto.includes("Session error:") && texto.includes("Bad MAC")) ||
    texto.includes("Bad MAC Error: Bad MAC") ||
    texto.includes("Failed to decrypt message with any known session") ||
    texto.includes("MessageCounterError: Key used already or never filled")
  );
}

console.log = (...args) => {
  if (ehLogSignalRuidoso(args)) return;
  consoleLogOriginal(...args);
};

console.info = (...args) => {
  if (ehLogSignalRuidoso(args)) return;
  consoleInfoOriginal(...args);
};

console.warn = (...args) => {
  if (ehLogSignalRuidoso(args)) return;
  consoleWarnOriginal(...args);
};

console.error = (...args) => {
  if (ehLogSignalRuidoso(args)) return;
  consoleErrorOriginal(...args);
};

let sock = null;
let conectando = false;
let encerrando = false;
let timerSalvar = null;
let baileysApi = null;
let ressincronizacaoAppStateExecutada = false;
let timerReconexao = null;
let geracaoSocket = 0;
let resetandoSessao = false;
let falhas428Consecutivas = 0;
let primeiraFalha428Em = 0;
let baileysConectadoParaFotos = false;
let baileysConectadoEm = 0;

// Cache de dispositivos controlado pelo WhatsIAPP. O Baileys usa esta lista
// para criptografar a mensagem para todos os aparelhos vinculados. Mantemos
// TTL curto e podemos invalidar antes de PTT para evitar fan-out com lista velha.
const cacheDispositivosEnvio = (() => {
  const itens = new Map();
  const ttlMs = 60 * 1000;

  return {
    get(chave) {
      const item = itens.get(String(chave));

      if (!item) {
        return undefined;
      }

      if (Date.now() - item.salvoEm > ttlMs) {
        itens.delete(String(chave));
        return undefined;
      }

      return item.valor;
    },

    set(chave, valor) {
      itens.set(String(chave), {
        valor,
        salvoEm: Date.now(),
      });
    },

    del(chave) {
      itens.delete(String(chave));
    },

    flushAll() {
      itens.clear();
    },
  };
})();

const conversas = new Map();
const contatos = new Map();
const contatosSalvos = new Map();
const lidParaPn = new Map();
const pnParaLid = new Map();
const estadoArquivadas = new Map();
const cacheFotosPerfil = new Map();
const cachePresencas = new Map();
const cacheMensagensRetry = new Map();
const chavesStatusBaileys = new Map();

// Estado de nao lidas vindo do proprio WhatsApp/Baileys.
// Fica somente em memoria nesta sessao para nunca restaurar uma contagem
// remota velha do conversas.json na proxima abertura.
const estadoNaoLidasWhatsapp = new Map();
const geracaoNaoLidasWhatsapp = `${Date.now()}-${Math.random()
  .toString(16)
  .slice(2)}`;
let sequenciaRevisaoNaoLidasWhatsapp = 0;

function normalizarTimestampNaoLidasWhatsapp(valor) {
  let numero = Number(valor || 0);

  if (!Number.isFinite(numero) || numero <= 0) {
    return 0;
  }

  if (numero > 1000000000000) {
    numero = Math.floor(numero / 1000);
  }

  return Math.floor(numero);
}

function chavesEstadoNaoLidasWhatsapp(valor) {
  const chaves = [];
  const adicionar = (id) => {
    const normalizado = normalizarJid(id);

    if (normalizado && !chaves.includes(normalizado)) {
      chaves.push(normalizado);
    }
  };

  adicionar(idCanonicoConversaLocal(valor));
  adicionar(valor);

  const normalizado = normalizarJid(valor);

  if (ehPn(normalizado)) {
    adicionar(pnParaLid.get(normalizado));
  }

  if (ehLid(normalizado)) {
    adicionar(lidParaPn.get(normalizado));
  }

  return chaves;
}

function obterEstadoNaoLidasWhatsapp(valor) {
  for (const chave of chavesEstadoNaoLidasWhatsapp(valor)) {
    const estado = estadoNaoLidasWhatsapp.get(chave);

    if (estado) {
      return estado;
    }
  }

  return null;
}

function reconciliarMensagensLidasPorContadorWhatsapp(conversa, totalBruto) {
  if (!conversa || !Array.isArray(conversa.mensagens)) {
    return;
  }

  const total = Math.max(0, Number(totalBruto || 0) || 0);
  const recebidas = conversa.mensagens.filter((msg) => msg && !msg.minha);

  if (!recebidas.length) {
    return;
  }

  for (const msg of recebidas) {
    msg.lidaPorMim = true;
  }

  if (total <= 0) {
    return;
  }

  for (const msg of recebidas.slice(-total)) {
    msg.lidaPorMim = false;
  }
}

function atualizarEstadoNaoLidasWhatsapp(
  conversaId,
  valorBruto,
  fonte = "absoluto",
  timestampBruto = 0,
) {
  if (valorBruto === null || valorBruto === undefined) {
    return null;
  }

  const numero = Number(valorBruto);

  if (!Number.isFinite(numero)) {
    return null;
  }

  const chaves = chavesEstadoNaoLidasWhatsapp(conversaId);
  const chave = chaves[0];

  if (!chave) {
    return null;
  }

  const anterior = obterEstadoNaoLidasWhatsapp(conversaId);
  const timestamp = normalizarTimestampNaoLidasWhatsapp(timestampBruto);
  const fonteNormalizada = String(fonte || "absoluto");

  let total = Math.max(0, Number(anterior?.total || 0) || 0);

  if (fonteNormalizada === "update") {
    // No Baileys, chats.update usa:
    //   > 0 como incremento de novas mensagens,
    //   0 como "marcar como lida",
    //   -1 como "marcar como nao lida".
    if (numero > 0) {
      total += numero;
    } else if (numero === 0) {
      total = 0;
    } else {
      total = Math.max(1, total);
    }
  } else if (numero < 0) {
    total = Math.max(1, total);
  } else {
    // messaging-history.set/chats.upsert trazem o snapshot do chat.
    total = Math.max(0, numero);
  }

  const ultimoTimestamp = Math.max(
    Number(anterior?.ultimoTimestamp || 0) || 0,
    timestamp,
  );

  const mudou =
    !anterior ||
    total !== Number(anterior.total || 0) ||
    ultimoTimestamp !== Number(anterior.ultimoTimestamp || 0);

  if (!mudou) {
    return anterior;
  }

  const estado = {
    total,
    revisao: ++sequenciaRevisaoNaoLidasWhatsapp,
    geracao: geracaoNaoLidasWhatsapp,
    ultimoTimestamp,
    atualizadoEm: Date.now(),
    fonte: fonteNormalizada,
  };

  estadoNaoLidasWhatsapp.set(chave, estado);

  // Remove uma chave antiga do mesmo contato quando LID/PN acabou de ser
  // resolvido, evitando manter duas contagens para a mesma pessoa.
  for (const alternativa of chaves.slice(1)) {
    if (alternativa !== chave) {
      estadoNaoLidasWhatsapp.delete(alternativa);
    }
  }

  const conversa =
    conversas.get(chave) ||
    conversas.get(normalizarJid(conversaId)) ||
    null;

  if (conversa) {
    if (total === 0 || fonteNormalizada !== "update") {
      reconciliarMensagensLidasPorContadorWhatsapp(conversa, total);
    }
  }

  consoleLogOriginal(
    `[NAO LIDAS] ${fonteNormalizada.toUpperCase()} | conversa=${chave} | ` +
      `valor=${numero} | total=${total} | revisao=${estado.revisao}`,
  );

  return estado;
}

function transferirEstadoNaoLidasWhatsapp(origemId, destinoId) {
  const chavesOrigem = chavesEstadoNaoLidasWhatsapp(origemId);
  const chavesDestino = chavesEstadoNaoLidasWhatsapp(destinoId);
  const destino = chavesDestino[0];

  if (!destino) {
    return;
  }

  const candidatos = [];

  for (const chave of [...chavesOrigem, ...chavesDestino]) {
    const estado = estadoNaoLidasWhatsapp.get(chave);

    if (estado) {
      candidatos.push(estado);
    }
  }

  if (!candidatos.length) {
    return;
  }

  candidatos.sort(
    (a, b) => Number(b?.revisao || 0) - Number(a?.revisao || 0),
  );

  estadoNaoLidasWhatsapp.set(destino, candidatos[0]);

  for (const chave of new Set([...chavesOrigem, ...chavesDestino])) {
    if (chave !== destino) {
      estadoNaoLidasWhatsapp.delete(chave);
    }
  }
}

function dadosNaoLidasWhatsappParaEvento(
  conversaId,
  timestampMensagem,
  minha = false,
) {
  const estado = obterEstadoNaoLidasWhatsapp(conversaId);

  if (!estado) {
    return {
      naoLidasWhatsapp: null,
      naoLidasWhatsappRevisao: 0,
      naoLidasWhatsappGeracao: geracaoNaoLidasWhatsapp,
      naoLidasWhatsappTimestamp: 0,
      naoLidasWhatsappIncluiMensagem: false,
    };
  }

  const timestamp = normalizarTimestampNaoLidasWhatsapp(timestampMensagem);
  const incluiMensagem =
    !minha &&
    estado.total > 0 &&
    timestamp > 0 &&
    estado.ultimoTimestamp > 0 &&
    timestamp <= estado.ultimoTimestamp;

  return {
    naoLidasWhatsapp: estado.total,
    naoLidasWhatsappRevisao: estado.revisao,
    naoLidasWhatsappGeracao: estado.geracao,
    naoLidasWhatsappTimestamp: estado.ultimoTimestamp,
    naoLidasWhatsappIncluiMensagem: incluiMensagem,
  };
}

let presencaAssinadaAtiva = null;
let timersReforcoPresencaBaileys = [];

function limparReforcosPresencaBaileys() {
  for (const timer of timersReforcoPresencaBaileys) {
    clearTimeout(timer);
  }

  timersReforcoPresencaBaileys = [];
}

function agendarReforcosPresencaBaileys(assinatura) {
  limparReforcosPresencaBaileys();

  if (!assinatura?.aliases?.size) {
    return;
  }

  const atrasos = [700, 1800, 4000, 7500];

  for (const atraso of atrasos) {
    const timer = setTimeout(() => {
      if (
        encerrando ||
        !sock ||
        !presencaAssinadaAtiva ||
        presencaAssinadaAtiva.assinadaEm !== assinatura.assinadaEm ||
        presencaAssinadaAtiva.ultimoEventoEm
      ) {
        return;
      }

      const ids = Array.from(presencaAssinadaAtiva.aliases);

      for (const jid of ids) {
        Promise.resolve(sock.presenceSubscribe(jid)).catch(() => {});
      }

      console.log(
        `[PRESENCA BAILEYS] reforco de assinatura para ` +
          `${presencaAssinadaAtiva.conversaIdPrincipal} ` +
          `(aliases=${ids.length}, atraso=${atraso}ms).`,
      );
    }, atraso);

    timersReforcoPresencaBaileys.push(timer);
  }
}

let timerSalvarCacheRetry = null;

let timerResumoFotosPerfil = null;
let fotosPerfilProcessadas = 0;
let fotosPerfilCarregadas = 0;
let fotosPerfilIndisponiveis = 0;

function registrarLogFotoPerfil(carregada) {
  fotosPerfilProcessadas++;

  if (carregada) {
    fotosPerfilCarregadas++;
  } else {
    fotosPerfilIndisponiveis++;
  }

  clearTimeout(timerResumoFotosPerfil);

  timerResumoFotosPerfil = setTimeout(() => {
    consoleLogOriginal(
      `Profile pictures: ${fotosPerfilProcessadas} processed, ` +
        `${fotosPerfilCarregadas} loaded, ` +
        `${fotosPerfilIndisponiveis} unavailable.`,
    );

    fotosPerfilProcessadas = 0;
    fotosPerfilCarregadas = 0;
    fotosPerfilIndisponiveis = 0;
    timerResumoFotosPerfil = null;
  }, 1800);
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

function pastaAuth() {
  return path.join(workerData.userDataPath, "baileys-auth");
}

function pastaMedia() {
  return path.join(workerData.userDataPath, "media");
}

function arquivoConversas() {
  return path.join(workerData.userDataPath, "conversas.json");
}

function arquivoMapeamentos() {
  return path.join(workerData.userDataPath, "mapeamentos.json");
}

function arquivoArquivadas() {
  return path.join(workerData.userDataPath, "arquivadas.json");
}

function arquivoResyncAppState() {
  return path.join(workerData.userDataPath, "appstate-resync-v1.done");
}

function arquivoSyncEssencial() {
  return path.join(workerData.userDataPath, "appstate-sync-essential-v6.done");
}

function arquivoCacheMensagensRetry() {
  return path.join(workerData.userDataPath, "mensagens-retry.json");
}

function garantirPasta(caminho) {
  fs.mkdirSync(caminho, { recursive: true });
}

function garantirPastaArquivo(arquivo) {
  garantirPasta(path.dirname(arquivo));
}

function somenteDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function normalizarJid(jid) {
  if (!jid || typeof jid !== "string") return jid;

  let valor = jid.trim();

  if (!valor) return valor;

  if (!valor.includes("@")) {
    const digitos = somenteDigitos(valor);
    if (digitos) return `${digitos}@s.whatsapp.net`;
    return valor;
  }

  const [usuarioOriginal, servidor] = valor.split("@");
  const usuario = usuarioOriginal.replace(/:\d+$/, "");

  return `${usuario}@${servidor}`;
}

function normalizarLid(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (texto.includes("@")) return normalizarJid(texto);
  const digitos = somenteDigitos(texto);
  return digitos ? `${digitos}@lid` : null;
}

function normalizarPn(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (texto.includes("@")) return normalizarJid(texto);
  const digitos = somenteDigitos(texto);
  return digitos ? `${digitos}@s.whatsapp.net` : null;
}

function ehLid(jid) {
  return normalizarJid(jid)?.endsWith("@lid");
}

function ehPn(jid) {
  return normalizarJid(jid)?.endsWith("@s.whatsapp.net");
}

function ehGrupo(jid) {
  return normalizarJid(jid)?.endsWith("@g.us");
}

function nomePadrao(jid) {
  if (!jid) return "Contato";

  return normalizarJid(jid)
    .replace("@s.whatsapp.net", "")
    .replace("@lid", "")
    .replace("@g.us", "");
}

function pareceNomeUtil(nome, jid) {
  if (!nome) return false;
  const limpo = String(nome).trim();
  if (!limpo) return false;
  if (limpo === nomePadrao(jid)) return false;
  if (/^\d{8,}$/.test(limpo)) return false;
  return true;
}

function numeroTimestamp(valor) {
  if (!valor) return Math.floor(Date.now() / 1000);
  if (typeof valor === "number") return valor;
  if (typeof valor === "bigint") return Number(valor);
  if (typeof valor.toNumber === "function") return valor.toNumber();

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : Math.floor(Date.now() / 1000);
}

function formatarHorario(timestamp) {
  return new Date(numeroTimestamp(timestamp) * 1000).toLocaleTimeString(
    "pt-BR",
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}

function comTimeout(promise, ms, mensagem = "Tempo limite excedido.") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(mensagem)), ms);
    }),
  ]);
}

function sanitizarNomeArquivo(nome) {
  const base = String(nome || "arquivo")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return base || "arquivo";
}

function extensaoPorMime(mime, tipo) {
  const m = String(mime || "").toLowerCase();

  if (m.includes("jpeg")) return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("opus")) return ".ogg";
  if (m.includes("mpeg")) return tipo === "audio" ? ".mp3" : ".mpeg";
  if (m.includes("wav")) return ".wav";
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("zip")) return ".zip";
  if (m.includes("plain")) return ".txt";
  if (m.includes("wordprocessingml")) return ".docx";
  if (m.includes("spreadsheetml")) return ".xlsx";
  if (m.includes("presentationml")) return ".pptx";

  if (tipo === "imagem") return ".jpg";
  if (tipo === "video") return ".mp4";
  if (tipo === "audio") return ".ogg";
  if (tipo === "sticker") return ".webp";

  return "";
}

function podarCacheMensagensRetry() {
  const agora = Date.now();
  const ttl = 7 * 24 * 60 * 60 * 1000;
  const maximo = 500;

  for (const [id, item] of cacheMensagensRetry.entries()) {
    if (!item?.salvaEm || agora - item.salvaEm > ttl) {
      cacheMensagensRetry.delete(id);
    }
  }

  if (cacheMensagensRetry.size > maximo) {
    const ordenadas = Array.from(cacheMensagensRetry.entries()).sort(
      (a, b) => (a[1]?.salvaEm || 0) - (b[1]?.salvaEm || 0),
    );

    const remover = ordenadas.slice(0, cacheMensagensRetry.size - maximo);

    for (const [id] of remover) {
      cacheMensagensRetry.delete(id);
    }
  }
}

function carregarCacheMensagensRetry() {
  try {
    const arquivo = arquivoCacheMensagensRetry();

    if (!fs.existsSync(arquivo)) {
      return;
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    if (!Array.isArray(dados)) {
      return;
    }

    for (const item of dados) {
      if (!item?.id || !item?.messageBase64) {
        continue;
      }

      cacheMensagensRetry.set(String(item.id), {
        id: String(item.id),
        remoteJid: normalizarJid(item.remoteJid) || null,
        messageBase64: String(item.messageBase64),
        salvaEm: Number(item.salvaEm) || Date.now(),
      });
    }

    podarCacheMensagensRetry();

    consoleLogOriginal(
      `Retry cache loaded: ${cacheMensagensRetry.size} messages.`,
    );
  } catch (erro) {
    console.error("Retry cache load error:", erro?.message || erro);
  }
}

function salvarCacheMensagensRetry() {
  clearTimeout(timerSalvarCacheRetry);

  timerSalvarCacheRetry = setTimeout(() => {
    try {
      podarCacheMensagensRetry();

      const arquivo = arquivoCacheMensagensRetry();
      garantirPastaArquivo(arquivo);

      fs.writeFileSync(
        arquivo,
        JSON.stringify(Array.from(cacheMensagensRetry.values()), null, 2),
        "utf8",
      );
    } catch (erro) {
      console.error("Retry cache save error:", erro?.message || erro);
    }
  }, 250);
}

function codificarMensagemParaRetry(message) {
  try {
    if (!message || !baileysApi?.proto?.Message) {
      return null;
    }

    const bytes = baileysApi.proto.Message.encode(message).finish();

    return Buffer.from(bytes).toString("base64");
  } catch (erro) {
    console.error("Retry message encode error:", erro?.message || erro);

    return null;
  }
}

function decodificarMensagemParaRetry(base64) {
  try {
    if (!base64 || !baileysApi?.proto?.Message) {
      return null;
    }

    return baileysApi.proto.Message.decode(Buffer.from(base64, "base64"));
  } catch (erro) {
    console.error("Retry message decode error:", erro?.message || erro);

    return null;
  }
}

function registrarMensagemParaRetry(mensagem) {
  const id = mensagem?.key?.id;
  const message = mensagem?.message;

  if (!id || !message) {
    return;
  }

  const messageBase64 = codificarMensagemParaRetry(message);

  if (!messageBase64) {
    return;
  }

  cacheMensagensRetry.set(String(id), {
    id: String(id),
    remoteJid: normalizarJid(mensagem.key.remoteJid) || null,
    messageBase64,
    salvaEm: Date.now(),
  });

  salvarCacheMensagensRetry();
}

function buscarMensagemLocalPorId(idMensagem) {
  if (!idMensagem) {
    return null;
  }

  for (const conversa of conversas.values()) {
    const item = conversa.mensagens.find(
      (msg) => msg.minha && String(msg.idMensagem || "") === String(idMensagem),
    );

    if (item) {
      return item;
    }
  }

  return null;
}

async function obterMensagemParaRetry(key) {
  try {
    const id = String(key?.id || "");

    if (!id) {
      return undefined;
    }

    const cache = cacheMensagensRetry.get(id);

    if (cache?.messageBase64) {
      const message = decodificarMensagemParaRetry(cache.messageBase64);

      if (message) {
        consoleLogOriginal(`Retry message served from cache: ${id}.`);
        return message;
      }
    }

    const item = buscarMensagemLocalPorId(id);

    if (!item) {
      return undefined;
    }

    if (item.rawBase64) {
      const info = desserializarMensagemBruta(item.rawBase64);

      if (info?.message) {
        consoleLogOriginal(`Retry message served from history: ${id}.`);
        return info.message;
      }
    }

    if (item.tipo === "texto" && item.texto) {
      consoleLogOriginal(`Retry text rebuilt from history: ${id}.`);

      return baileysApi.proto.Message.fromObject({
        conversation: String(item.texto),
      });
    }

    return undefined;
  } catch (erro) {
    console.error("Retry message lookup error:", erro?.message || erro);

    return undefined;
  }
}

function prepararRessincronizacaoAppState() {
  try {
    const marcador = arquivoResyncAppState();

    if (fs.existsSync(marcador)) {
      return false;
    }

    const authDir = pastaAuth();

    if (!fs.existsSync(authDir)) {
      return false;
    }

    const arquivos = fs.readdirSync(authDir);

    const versoes = arquivos.filter(
      (nome) =>
        nome.startsWith("app-state-sync-version-") && nome.endsWith(".json"),
    );

    for (const nome of versoes) {
      try {
        fs.rmSync(path.join(authDir, nome), { force: true });
      } catch {}
    }

    // O cache antigo de "arquivada" pode estar incompleto.
    // Vamos reconstruí-lo a partir do app-state do WhatsApp.
    estadoArquivadas.clear();

    try {
      fs.rmSync(arquivoArquivadas(), { force: true });
    } catch {}

    garantirPastaArquivo(marcador);

    fs.writeFileSync(
      marcador,
      JSON.stringify(
        {
          criadoEm: new Date().toISOString(),
          versoesRemovidas: versoes.length,
        },
        null,
        2,
      ),
      "utf8",
    );

    ressincronizacaoAppStateExecutada = true;

    console.log(
      `App-state preparado para nova sincronização (${versoes.length} versões reiniciadas).`,
    );

    enviar("status", {
      texto: "Preparando estados e contatos...",
      tipo: "conectando",
    });

    return true;
  } catch (erro) {
    console.error("Erro ao preparar nova sincronização do app-state:", erro);

    return false;
  }
}

function aplicarNomesConhecidosNasConversas() {
  let atualizadas = 0;

  for (const conversa of conversas.values()) {
    const id = normalizarJid(conversa.id);

    const candidatos = [
      contatos.get(id)?.nome,
      contatos.get(lidParaPn.get(id))?.nome,
      contatos.get(pnParaLid.get(id))?.nome,
    ].filter(Boolean);

    const nome = candidatos.find((valor) => pareceNomeUtil(valor, id));

    if (nome && conversa.nome !== nome) {
      conversa.nome = nome;
      atualizadas++;
    }
  }

  return atualizadas;
}

function carregarMapeamentos() {
  try {
    const arquivo = arquivoMapeamentos();
    if (!fs.existsSync(arquivo)) return;

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    for (const item of dados) {
      if (!item?.lid || !item?.pn) continue;

      const lid = normalizarLid(item.lid);
      const pn = normalizarPn(item.pn);

      if (!lid || !pn) continue;

      lidParaPn.set(lid, pn);
      pnParaLid.set(pn, lid);
    }

    console.log(`${lidParaPn.size} mapeamentos LID carregados.`);
  } catch (erro) {
    console.error("Erro ao carregar mapeamentos:", erro);
  }
}

function salvarMapeamentos() {
  try {
    const arquivo = arquivoMapeamentos();
    garantirPastaArquivo(arquivo);

    const dados = Array.from(lidParaPn.entries()).map(([lid, pn]) => ({
      lid,
      pn,
    }));

    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), "utf8");
  } catch (erro) {
    console.error("Erro ao salvar mapeamentos:", erro);
  }
}

function carregarArquivadas() {
  try {
    const arquivo = arquivoArquivadas();
    if (!fs.existsSync(arquivo)) return;

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    for (const item of dados) {
      if (!item?.id || typeof item.arquivada !== "boolean") continue;

      const id = normalizarJid(item.id);
      if (!id) continue;

      estadoArquivadas.set(id, item.arquivada);
    }

    console.log(`${estadoArquivadas.size} estados de arquivamento carregados.`);
  } catch (erro) {
    console.error("Erro ao carregar arquivadas:", erro);
  }
}

function salvarArquivadas() {
  try {
    const arquivo = arquivoArquivadas();
    garantirPastaArquivo(arquivo);

    const dados = Array.from(estadoArquivadas.entries()).map(
      ([id, arquivada]) => ({ id, arquivada }),
    );

    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), "utf8");
  } catch (erro) {
    console.error("Erro ao salvar arquivadas:", erro);
  }
}

function aplicarEstadoArquivado(id, valor, autoritativo = false) {
  id = normalizarJid(id);

  if (!id || typeof valor !== "boolean") return;

  if (autoritativo || !estadoArquivadas.has(id)) {
    estadoArquivadas.set(id, valor);
  }

  const conversa = conversas.get(id);

  if (conversa) {
    conversa.arquivada = estadoArquivadas.get(id) ?? valor;
  }
}

function transferirEstadoArquivado(origemId, destinoId) {
  origemId = normalizarJid(origemId);
  destinoId = normalizarJid(destinoId);

  if (!origemId || !destinoId || origemId === destinoId) return;

  if (estadoArquivadas.has(origemId) && !estadoArquivadas.has(destinoId)) {
    estadoArquivadas.set(destinoId, estadoArquivadas.get(origemId));
  }

  estadoArquivadas.delete(origemId);
}

function idCanonicoConversaLocal(valor) {
  let id = normalizarJid(valor);

  if (!id) {
    return null;
  }

  if (id.endsWith("@c.us")) {
    id = id.replace("@c.us", "@s.whatsapp.net");
  }

  if (ehLid(id) && lidParaPn.has(id)) {
    return normalizarPn(lidParaPn.get(id)) || id;
  }

  return id;
}

function unificarConversasPorMapeamentosConhecidos(origem = "runtime") {
  let unificadas = 0;
  let migradas = 0;
  let mescladas = 0;
  let mensagensAntes = 0;
  let mensagensDepois = 0;

  for (const [lidBruto, pnBruto] of lidParaPn.entries()) {
    const lid = normalizarLid(lidBruto);
    const pn = normalizarPn(pnBruto);

    if (!lid || !pn || lid === pn || !conversas.has(lid)) {
      continue;
    }

    const origemConversa = conversas.get(lid);
    const destinoAntes = conversas.get(pn);
    const destinoJaExistia = !!destinoAntes;

    mensagensAntes +=
      Number(origemConversa?.mensagens?.length || 0) +
      Number(destinoAntes?.mensagens?.length || 0);

    mesclarConversas(lid, pn);

    mensagensDepois += Number(conversas.get(pn)?.mensagens?.length || 0);
    unificadas += 1;

    if (destinoJaExistia) {
      mescladas += 1;
    } else {
      migradas += 1;
    }
  }

  if (unificadas > 0) {
    console.log(
      `[IDENTIDADE] CONVERSAS_UNIFICADAS | origem=${origem} | ` +
        `total=${unificadas} | migradas=${migradas} | mescladas=${mescladas} | ` +
        `mensagensAntes=${mensagensAntes} | mensagensDepois=${mensagensDepois}`,
    );
  }

  return unificadas;
}

function carregarConversasLocais() {
  try {
    const arquivo = arquivoConversas();
    if (!fs.existsSync(arquivo)) return;

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    for (const item of dados) {
      const id = normalizarJid(item.id);
      if (!id) continue;

      const arquivada = estadoArquivadas.has(id)
        ? estadoArquivadas.get(id)
        : !!item.arquivada;

      conversas.set(id, {
        id,
        nome: item.nome || nomePadrao(id),
        arquivada,
        timestamp: item.timestamp || 0,
        mensagens: Array.isArray(item.mensagens) ? item.mensagens : [],
      });
    }

    const unificadas = unificarConversasPorMapeamentosConhecidos("cache");

    if (unificadas > 0) {
      salvarConversas();
    }

    console.log(
      `${conversas.size} conversas carregadas do cache` +
        `${unificadas ? ` (${unificadas} identidades LID/PN normalizadas)` : ""}.`,
    );
  } catch (erro) {
    console.error("Erro ao carregar conversas:", erro);
  }
}

function salvarConversas() {
  clearTimeout(timerSalvar);

  timerSalvar = setTimeout(() => {
    try {
      const arquivo = arquivoConversas();
      garantirPastaArquivo(arquivo);

      const dados = Array.from(conversas.values()).map((conversa) => ({
        ...conversa,
        mensagens: conversa.mensagens.slice(-600),
      }));

      fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), "utf8");
    } catch (erro) {
      console.error("Erro ao salvar conversas:", erro);
    }
  }, 300);
}

function enviarConversas() {
  unificarConversasPorMapeamentosConhecidos("snapshot");

  const lista = Array.from(conversas.values())
    .map((conversa) => ({
      ...conversa,
      ...dadosNaoLidasWhatsappParaEvento(
        conversa.id,
        conversa.timestamp || 0,
        false,
      ),
    }))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  enviar("conversas-iniciais", lista);
}

function obterConversa(id) {
  id = idCanonicoConversaLocal(id);

  if (!conversas.has(id)) {
    conversas.set(id, {
      id,
      nome: contatos.get(id)?.nome || nomePadrao(id),
      arquivada: estadoArquivadas.get(id) ?? false,
      timestamp: 0,
      mensagens: [],
    });
  }

  return conversas.get(id);
}

function definirNomeContato(id, nome) {
  id = normalizarJid(id);
  if (!id || !pareceNomeUtil(nome, id)) return;

  contatos.set(id, { nome: String(nome).trim() });

  const conversa = conversas.get(id);
  if (conversa) {
    conversa.nome = String(nome).trim();
  }
}

function registrarContatoSalvo(id, nome) {
  const jid = normalizarJid(id);
  const nomeLimpo = String(nome || "").trim();

  if (!jid || !nomeLimpo || ehGrupo(jid)) {
    return;
  }

  if (
    jid === "status@broadcast" ||
    jid.endsWith("@broadcast") ||
    jid.endsWith("@newsletter")
  ) {
    return;
  }

  contatosSalvos.set(jid, {
    id: jid,
    nome: nomeLimpo,
  });
}

function removerContatoSalvo(id) {
  const jid = normalizarJid(id);

  if (jid) {
    contatosSalvos.delete(jid);
  }
}

function listarContatosSalvos() {
  const unicos = new Map();

  for (const item of contatosSalvos.values()) {
    const idOriginal = normalizarJid(item?.id);

    if (!idOriginal || ehGrupo(idOriginal)) {
      continue;
    }

    let idPrincipal = idOriginal;

    if (ehLid(idPrincipal) && lidParaPn.has(idPrincipal)) {
      idPrincipal = normalizarPn(lidParaPn.get(idPrincipal)) || idPrincipal;
    }

    if (ehPn(idPrincipal) && pnParaLid.has(idPrincipal)) {
      const lid = normalizarLid(pnParaLid.get(idPrincipal));

      if (lid && contatosSalvos.has(lid) && !contatosSalvos.has(idPrincipal)) {
        registrarContatoSalvo(idPrincipal, item.nome);
      }
    }

    const nome = String(
      item?.nome || contatos.get(idPrincipal)?.nome || "",
    ).trim();

    if (!nome || !pareceNomeUtil(nome, idPrincipal)) {
      continue;
    }

    const chave = ehPn(idPrincipal)
      ? `pn:${somenteDigitos(idPrincipal)}`
      : `jid:${idPrincipal}`;

    const existente = unicos.get(chave);

    if (
      !existente ||
      String(nome).localeCompare(String(existente.nome), "pt-BR", {
        sensitivity: "base",
      }) < 0
    ) {
      unicos.set(chave, {
        id: idPrincipal,
        nome,
        numeroWhatsapp: ehPn(idPrincipal) ? somenteDigitos(idPrincipal) : null,
      });
    }
  }

  return Array.from(unicos.values()).sort((a, b) =>
    String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", {
      sensitivity: "base",
    }),
  );
}

function listarGruposLocais() {
  return Array.from(conversas.values())
    .filter((conversa) => ehGrupo(conversa?.id))
    .map((conversa) => ({
      ...conversa,
      grupo: true,
      mensagens: Array.isArray(conversa?.mensagens)
        ? conversa.mensagens.slice(-600)
        : [],
    }))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

async function listarGruposAtuaisBaileys() {
  if (
    !sock ||
    encerrando ||
    typeof sock.groupFetchAllParticipating !== "function"
  ) {
    return {
      disponivel: false,
      grupos: listarGruposLocais(),
    };
  }

  try {
    const metadados = await sock.groupFetchAllParticipating();
    const grupos = [];

    for (const grupo of Object.values(
      metadados && typeof metadados === "object" ? metadados : {},
    )) {
      const idGrupo = normalizarJid(grupo?.id);

      if (!idGrupo || !ehGrupo(idGrupo)) {
        continue;
      }

      const conversaLocal = conversas.get(idGrupo);
      const participantes = Array.isArray(grupo?.participants)
        ? grupo.participants
        : [];

      grupos.push({
        ...(conversaLocal || {}),
        id: idGrupo,
        nome:
          String(grupo?.subject || conversaLocal?.nome || idGrupo).trim() ||
          idGrupo,
        grupo: true,
        totalParticipantes: participantes.length,
        mensagens: Array.isArray(conversaLocal?.mensagens)
          ? conversaLocal.mensagens.slice(-600)
          : [],
        timestamp: Number(conversaLocal?.timestamp || 0) || 0,
      });
    }

    grupos.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    console.log(`[GRUPOS ATUAIS BAILEYS] participantes=${grupos.length}.`);

    return {
      disponivel: true,
      grupos,
    };
  } catch (erro) {
    console.warn(
      `[GRUPOS ATUAIS BAILEYS] fallback local | erro=${String(
        erro?.message || erro || "unknown",
      )
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 180)}.`,
    );

    return {
      disponivel: false,
      grupos: listarGruposLocais(),
    };
  }
}

async function listarGruposEmComumBaileys(dados = {}) {
  if (
    !sock ||
    encerrando ||
    typeof sock.groupFetchAllParticipating !== "function"
  ) {
    return {
      disponivel: false,
      grupos: [],
    };
  }

  const alvos = new Set();

  const adicionarAlvo = (valor) => {
    const jid = normalizarJid(String(valor || "").trim());

    if (!jid || ehGrupo(jid)) {
      return;
    }

    alvos.add(jid);

    if (ehPn(jid)) {
      const lid = normalizarJid(pnParaLid.get(jid));

      if (lid) {
        alvos.add(lid);
      }
    }

    if (ehLid(jid)) {
      const pn = normalizarJid(lidParaPn.get(jid));

      if (pn) {
        alvos.add(pn);
      }
    }
  };

  adicionarAlvo(dados?.conversaId);

  const numeroWhatsapp = somenteDigitos(dados?.numeroWhatsapp);

  if (numeroWhatsapp) {
    adicionarAlvo(`${numeroWhatsapp}@s.whatsapp.net`);
  }

  if (!alvos.size) {
    return {
      disponivel: true,
      grupos: [],
    };
  }

  const metadados = await sock.groupFetchAllParticipating();
  const grupos = [];

  for (const grupo of Object.values(
    metadados && typeof metadados === "object" ? metadados : {},
  )) {
    const idGrupo = normalizarJid(grupo?.id);

    if (!idGrupo || !ehGrupo(idGrupo)) {
      continue;
    }

    const participantes = Array.isArray(grupo?.participants)
      ? grupo.participants
      : [];

    const emComum = participantes.some((participante) => {
      const idsParticipante = [
        participante?.id,
        participante?.phoneNumber,
        participante?.lid,
        participante?.pn,
        participante?.wid,
      ]
        .map((valor) =>
          typeof valor === "string" ? normalizarJid(valor) : null,
        )
        .filter(Boolean);

      return idsParticipante.some((idParticipante) =>
        Array.from(alvos).some((alvo) =>
          mesmaIdentidadeJid(idParticipante, alvo),
        ),
      );
    });

    if (!emComum) {
      continue;
    }

    const conversaLocal = conversas.get(idGrupo);

    grupos.push({
      id: idGrupo,
      nome:
        String(grupo?.subject || conversaLocal?.nome || idGrupo).trim() ||
        idGrupo,
      grupo: true,
      totalParticipantes: participantes.length,
      timestamp: Number(conversaLocal?.timestamp || 0) || 0,
    });
  }

  grupos.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  console.log(
    `[GRUPOS EM COMUM BAILEYS] contato=${String(
      dados?.conversaId || dados?.numeroWhatsapp || "-",
    )} | aliases=${alvos.size} | grupos=${grupos.length}.`,
  );

  return {
    disponivel: true,
    grupos,
  };
}

function mesclarConversas(origemId, destinoId) {
  origemId = normalizarJid(origemId);
  destinoId = normalizarJid(destinoId);

  if (!origemId || !destinoId || origemId === destinoId) return;

  const origem = conversas.get(origemId);
  if (!origem) return;

  const destino = obterConversa(destinoId);

  if (
    pareceNomeUtil(origem.nome, origemId) &&
    !pareceNomeUtil(destino.nome, destinoId)
  ) {
    destino.nome = origem.nome;
  }

  transferirEstadoArquivado(origemId, destinoId);

  if (estadoArquivadas.has(destinoId)) {
    destino.arquivada = estadoArquivadas.get(destinoId);
  } else {
    destino.arquivada = destino.arquivada || origem.arquivada;
  }
  destino.timestamp = Math.max(destino.timestamp || 0, origem.timestamp || 0);

  const ids = new Set(
    destino.mensagens.map((msg) => msg.idMensagem).filter(Boolean),
  );

  for (const msg of origem.mensagens) {
    if (!msg.idMensagem || !ids.has(msg.idMensagem)) {
      destino.mensagens.push(msg);
      if (msg.idMensagem) ids.add(msg.idMensagem);
    }
  }

  destino.mensagens.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  destino.mensagens = destino.mensagens.slice(-600);
  transferirEstadoNaoLidasWhatsapp(origemId, destinoId);
  conversas.delete(origemId);
}

function registrarMapeamento(lid, pn, nome = null) {
  lid = normalizarLid(lid);
  pn = normalizarPn(pn);

  if (!lid || !pn || !ehLid(lid) || !ehPn(pn)) return;

  lidParaPn.set(lid, pn);
  pnParaLid.set(pn, lid);

  const nomeLid = contatos.get(lid)?.nome;
  const nomePn = contatos.get(pn)?.nome;
  const nomeFinal = nome || nomePn || nomeLid;

  if (nomeFinal) {
    definirNomeContato(pn, nomeFinal);
    definirNomeContato(lid, nomeFinal);
  }

  transferirEstadoArquivado(lid, pn);
  mesclarConversas(lid, pn);
  salvarMapeamentos();
}

function tentarRegistrarPar(a, b) {
  const aa = normalizarJid(a);
  const bb = normalizarJid(b);

  if (ehLid(aa) && ehPn(bb)) registrarMapeamento(aa, bb);
  if (ehPn(aa) && ehLid(bb)) registrarMapeamento(bb, aa);
}

async function resolverJid(jid) {
  jid = normalizarJid(jid);
  if (!jid || !ehLid(jid)) return jid;

  const salvo = lidParaPn.get(jid);
  if (salvo) return salvo;

  try {
    const repositorio = sock?.signalRepository?.lidMapping;

    if (repositorio && typeof repositorio.getPNForLID === "function") {
      const pn = await repositorio.getPNForLID(jid);
      if (pn) {
        registrarMapeamento(jid, pn);
        return normalizarPn(pn);
      }
    }
  } catch {}

  return jid;
}

async function hidratarMapeamentosSignalRepository() {
  const repositorio = sock?.signalRepository?.lidMapping;

  if (
    !repositorio ||
    typeof repositorio.storeLIDPNMappings !== "function" ||
    !lidParaPn.size
  ) {
    return 0;
  }

  const pares = Array.from(lidParaPn.entries())
    .map(([lid, pn]) => ({
      lid: normalizarLid(lid),
      pn: normalizarPn(pn),
    }))
    .filter((item) => item.lid && item.pn);

  if (!pares.length) {
    return 0;
  }

  try {
    await repositorio.storeLIDPNMappings(pares);

    consoleLogOriginal(`Block mappings hydrated: ${pares.length}.`);

    return pares.length;
  } catch (erro) {
    console.warn("Block mappings hydrate failed:", erro?.message || erro);

    return 0;
  }
}

async function resolverIdentidadeBloqueio(conversaId) {
  const original = normalizarJid(conversaId);

  if (!original) {
    throw new Error("Conversa invalida.");
  }

  if (ehGrupo(original)) {
    return {
      original,
      lid: null,
      pn: null,
      podeBloquear: false,
    };
  }

  const repositorio = sock?.signalRepository?.lidMapping;

  let lid = ehLid(original) ? original : null;
  let pn = ehPn(original) ? original : null;

  if (lid && lidParaPn.has(lid)) {
    pn = normalizarPn(lidParaPn.get(lid)) || pn;
  }

  if (pn && pnParaLid.has(pn)) {
    lid = normalizarLid(pnParaLid.get(pn)) || lid;
  }

  if (lid && !pn && repositorio) {
    try {
      if (typeof repositorio.getPNForLID === "function") {
        const encontrado = await repositorio.getPNForLID(lid);

        if (encontrado) {
          pn = normalizarPn(encontrado);
        }
      }
    } catch {}
  }

  if (pn && !lid && repositorio) {
    try {
      if (typeof repositorio.getLIDForPN === "function") {
        const encontrado = await repositorio.getLIDForPN(pn);

        if (encontrado) {
          lid = normalizarLid(encontrado);
        }
      }
    } catch {}
  }

  if (lid && pn) {
    registrarMapeamento(lid, pn);

    try {
      if (repositorio && typeof repositorio.storeLIDPNMappings === "function") {
        await repositorio.storeLIDPNMappings([
          {
            lid,
            pn,
          },
        ]);
      }
    } catch {}
  }

  return {
    original,
    lid,
    pn,
    podeBloquear: !!lid && !!pn,
  };
}

function aliasesIdentidadeBloqueio(identidade) {
  const aliases = new Set();

  for (const valor of [identidade?.original, identidade?.lid, identidade?.pn]) {
    const jid = normalizarJid(valor);

    if (jid) {
      aliases.add(jid);
    }
  }

  return aliases;
}

async function resolverJidParaEnvio(jid) {
  const original = normalizarJid(jid);

  if (!original) {
    return null;
  }

  const resolvido = await resolverJid(original);

  if (!ehLid(resolvido)) {
    return resolvido;
  }

  const salvo = lidParaPn.get(resolvido);

  if (salvo) {
    return salvo;
  }

  // LID is valid in modern WhatsApp. We do not invent a phone number.
  // If no PN mapping exists, keep the real LID instead of guessing.
  return resolvido;
}

function desembrulharMensagem(message) {
  let atual = message;

  while (atual) {
    if (atual.ephemeralMessage?.message) {
      atual = atual.ephemeralMessage.message;
      continue;
    }

    if (atual.viewOnceMessage?.message) {
      atual = atual.viewOnceMessage.message;
      continue;
    }

    if (atual.viewOnceMessageV2?.message) {
      atual = atual.viewOnceMessageV2.message;
      continue;
    }

    if (atual.viewOnceMessageV2Extension?.message) {
      atual = atual.viewOnceMessageV2Extension.message;
      continue;
    }

    if (atual.documentWithCaptionMessage?.message) {
      atual = atual.documentWithCaptionMessage.message;
      continue;
    }

    break;
  }

  return atual;
}

function detectarVisualizacaoUnica(message) {
  let atual = message;

  while (atual) {
    if (atual.ephemeralMessage?.message) {
      atual = atual.ephemeralMessage.message;

      continue;
    }

    const wrappers = [
      atual.viewOnceMessage,
      atual.viewOnceMessageV2,
      atual.viewOnceMessageV2Extension,
    ].filter(Boolean);

    if (wrappers.length) {
      const interna = wrappers[0]?.message || null;

      if (interna?.imageMessage) {
        return {
          tipo: "view_once",
          viewOnceKind: "imagem",
          texto:
            "① Foto de visualização única\\nAbra no celular para visualizar",
        };
      }

      if (interna?.videoMessage) {
        return {
          tipo: "view_once",
          viewOnceKind: "video",
          texto:
            "① Vídeo de visualização única\\nAbra no celular para visualizar",
        };
      }

      if (interna?.audioMessage) {
        return {
          tipo: "view_once",
          viewOnceKind: "audio",
          texto: "① Áudio de reprodução única\\nAbra no celular para ouvir",
        };
      }

      return {
        tipo: "view_once",
        viewOnceKind: "midia",
        texto:
          "① Mídia de visualização única\\nAbra no celular para visualizar",
      };
    }

    if (atual.imageMessage?.viewOnce) {
      return {
        tipo: "view_once",
        viewOnceKind: "imagem",
        texto: "① Foto de visualização única\\nAbra no celular para visualizar",
      };
    }

    if (atual.videoMessage?.viewOnce) {
      return {
        tipo: "view_once",
        viewOnceKind: "video",
        texto:
          "① Vídeo de visualização única\\nAbra no celular para visualizar",
      };
    }

    if (atual.audioMessage?.viewOnce) {
      return {
        tipo: "view_once",
        viewOnceKind: "audio",
        texto: "① Áudio de reprodução única\\nAbra no celular para ouvir",
      };
    }

    if (atual.documentWithCaptionMessage?.message) {
      atual = atual.documentWithCaptionMessage.message;

      continue;
    }

    break;
  }

  return null;
}

function interpretarMensagem(message) {
  const visualizacaoUnica = detectarVisualizacaoUnica(message);

  if (visualizacaoUnica) {
    return visualizacaoUnica;
  }

  const msg = desembrulharMensagem(message);
  if (!msg) return null;

  if (msg.conversation) {
    return { tipo: "texto", texto: msg.conversation };
  }

  if (msg.extendedTextMessage?.text) {
    return { tipo: "texto", texto: msg.extendedTextMessage.text };
  }

  if (msg.imageMessage) {
    return {
      tipo: "imagem",
      texto: msg.imageMessage.caption?.trim() || "",
      mime: msg.imageMessage.mimetype || "image/jpeg",
    };
  }

  if (msg.audioMessage) {
    return {
      tipo: "audio",
      texto: "",
      mime: msg.audioMessage.mimetype || "audio/ogg",
    };
  }

  if (msg.videoMessage) {
    return {
      tipo: "video",
      texto: msg.videoMessage.caption?.trim() || "",
      mime: msg.videoMessage.mimetype || "video/mp4",
    };
  }

  if (msg.documentMessage) {
    return {
      tipo: "documento",
      texto: msg.documentMessage.caption?.trim() || "",
      fileName: msg.documentMessage.fileName || "Documento",
      mime: msg.documentMessage.mimetype || "application/octet-stream",
    };
  }

  if (msg.stickerMessage) {
    return {
      tipo: "sticker",
      texto: "",
      mime: msg.stickerMessage.mimetype || "image/webp",
    };
  }

  if (msg.locationMessage) {
    return { tipo: "localizacao", texto: "📍 Localização" };
  }

  if (msg.contactMessage) {
    return {
      tipo: "contato",
      texto: `👤 ${msg.contactMessage.displayName || "Contato"}`,
    };
  }

  return null;
}

function obterContextInfoMensagem(message) {
  const msg = desembrulharMensagem(message);

  if (!msg || typeof msg !== "object") {
    return null;
  }

  const candidatos = [
    msg.extendedTextMessage,
    msg.imageMessage,
    msg.videoMessage,
    msg.audioMessage,
    msg.documentMessage,
    msg.stickerMessage,
    msg.locationMessage,
    msg.contactMessage,
  ];

  for (const item of candidatos) {
    if (item?.contextInfo?.stanzaId) {
      return item.contextInfo;
    }
  }

  return null;
}

function mesmaIdentidadeJid(a, b) {
  const aa = normalizarJid(a);
  const bb = normalizarJid(b);

  if (!aa || !bb) {
    return false;
  }

  if (aa === bb) {
    return true;
  }

  const pnA = ehLid(aa) ? normalizarJid(lidParaPn.get(aa)) : aa;
  const pnB = ehLid(bb) ? normalizarJid(lidParaPn.get(bb)) : bb;

  if (pnA && pnB && pnA === pnB) {
    return true;
  }

  const lidA = ehPn(aa) ? normalizarJid(pnParaLid.get(aa)) : aa;
  const lidB = ehPn(bb) ? normalizarJid(pnParaLid.get(bb)) : bb;

  return !!lidA && !!lidB && lidA === lidB;
}

function autoriaCitacaoBaileys(contextInfo) {
  const participante = normalizarJid(contextInfo?.participant);

  if (!participante) {
    return null;
  }

  const meusIds = [
    sock?.user?.id,
    sock?.user?.lid,
    normalizarJid(sock?.user?.id)
      ? pnParaLid.get(normalizarJid(sock?.user?.id))
      : null,
    normalizarJid(sock?.user?.lid)
      ? lidParaPn.get(normalizarJid(sock?.user?.lid))
      : null,
  ]
    .map(normalizarJid)
    .filter(Boolean);

  if (!meusIds.length) {
    return null;
  }

  return meusIds.some((meuId) => mesmaIdentidadeJid(participante, meuId));
}

function extrairRespostaBaileys(message) {
  const contextInfo = obterContextInfoMensagem(message);
  const idMensagem = String(contextInfo?.stanzaId || "").trim();

  if (!idMensagem) {
    return null;
  }

  const quotedMessage = contextInfo?.quotedMessage || null;
  const interpretada = quotedMessage
    ? interpretarMensagem(quotedMessage)
    : null;

  const minha = autoriaCitacaoBaileys(contextInfo);

  const remotoCitacao = normalizarJid(
    contextInfo?.remoteJid ||
      contextInfo?.remoteJidAlt ||
      contextInfo?.quotedMessageKey?.remoteJid ||
      contextInfo?.quotedMessageKey?.remoteJidAlt,
  );

  const participanteCitacao = normalizarJid(
    contextInfo?.participant ||
      contextInfo?.participantAlt ||
      contextInfo?.quotedMessageKey?.participant ||
      contextInfo?.quotedMessageKey?.participantAlt,
  );

  const ehCitacaoStatus = remotoCitacao === "status@broadcast";

  let idMensagemWpp = null;

  if (ehCitacaoStatus) {
    const prefixo = minha === true ? "true" : "false";
    idMensagemWpp = `${prefixo}_status@broadcast_${idMensagem}${
      participanteCitacao ? `_${participanteCitacao}` : ""
    }`;

    consoleLogOriginal(
      `[STATUS BAILEYS] CITACAO_STATUS | id=${idMensagem} | ` +
        `participante=${participanteCitacao || "-"} | minha=${minha === true}.`,
    );
  }

  const resposta = {
    idMensagem,
    idMensagemWpp,
    origemStatus: ehCitacaoStatus,
    texto: String(interpretada?.texto || ""),
    tipo: String(interpretada?.tipo || "texto"),
    fileName: interpretada?.fileName || null,
  };

  if (typeof minha === "boolean") {
    resposta.minha = minha;
  }

  return resposta;
}

function mesclarRespostaPersistida(atual, nova) {
  if (!nova?.idMensagem) {
    return atual || null;
  }

  if (!atual?.idMensagem) {
    return nova;
  }

  if (String(atual.idMensagem) !== String(nova.idMensagem)) {
    return nova;
  }

  const resultado = {
    ...atual,
    ...nova,
    texto: nova.texto || atual.texto || "",
    tipo: nova.tipo || atual.tipo || "texto",
    fileName: nova.fileName || atual.fileName || null,
    idMensagemWpp: nova.idMensagemWpp || atual.idMensagemWpp || null,
    origemStatus: !!(nova.origemStatus || atual.origemStatus),
  };

  if (typeof nova.minha !== "boolean" && typeof atual.minha === "boolean") {
    resultado.minha = atual.minha;
  }

  return resultado;
}

function mensagemTemMidia(tipo) {
  return ["imagem", "audio", "video", "documento", "sticker"].includes(tipo);
}

function serializarMensagemBruta(mensagem) {
  try {
    if (!baileysApi?.proto?.WebMessageInfo) return null;
    const bytes = baileysApi.proto.WebMessageInfo.encode(mensagem).finish();
    return Buffer.from(bytes).toString("base64");
  } catch (erro) {
    console.error("Erro ao serializar mídia:", erro.message);
    return null;
  }
}

function desserializarMensagemBruta(base64) {
  try {
    if (!base64 || !baileysApi?.proto?.WebMessageInfo) return null;
    return baileysApi.proto.WebMessageInfo.decode(
      Buffer.from(base64, "base64"),
    );
  } catch (erro) {
    console.error("Erro ao desserializar mídia:", erro.message);
    return null;
  }
}

async function atualizarContato(contato) {
  if (!contato) return;

  const id = normalizarJid(contato.id);
  const lid = normalizarLid(
    contato.lid || contato.lidJid || (ehLid(id) ? id : null),
  );
  const pn = normalizarPn(
    contato.phoneNumber ||
      contato.pnJid ||
      contato.jid ||
      (ehPn(id) ? id : null),
  );

  const nomeSalvo = String(contato.name || "").trim();
  const campoNomeSalvoInformado = Object.prototype.hasOwnProperty.call(
    contato,
    "name",
  );

  const nome =
    nomeSalvo ||
    contato.notify ||
    contato.verifiedName ||
    contato.pushName ||
    contato.displayName ||
    null;

  const aliases = [id, lid, pn].filter(Boolean);

  if (nomeSalvo) {
    for (const alias of aliases) {
      registrarContatoSalvo(alias, nomeSalvo);
    }
  } else if (campoNomeSalvoInformado) {
    for (const alias of aliases) {
      removerContatoSalvo(alias);
    }
  }

  if (id && nome) definirNomeContato(id, nome);
  if (lid && nome) definirNomeContato(lid, nome);
  if (pn && nome) definirNomeContato(pn, nome);

  if (lid && pn) {
    registrarMapeamento(lid, pn, nome);

    if (nomeSalvo) {
      registrarContatoSalvo(lid, nomeSalvo);
      registrarContatoSalvo(pn, nomeSalvo);
    }
  }

  if (id) {
    const resolvido = pn || (await resolverJid(id));

    if (resolvido && nome) {
      definirNomeContato(resolvido, nome);
    }

    if (resolvido && nomeSalvo) {
      registrarContatoSalvo(resolvido, nomeSalvo);
    }
  }
}

async function atualizarChat(chat, fonte = "historico") {
  if (!chat?.id) return;

  const id = normalizarJid(chat.id);
  const lid = normalizarLid(
    chat.lidJid || chat.accountLid || (ehLid(id) ? id : null),
  );
  const pn = normalizarPn(
    chat.pnJid || chat.phoneNumber || (ehPn(id) ? id : null),
  );

  if (lid && pn) {
    registrarMapeamento(lid, pn, chat.name || chat.displayName || null);
  }

  const resolvido = pn || (await resolverJid(id));
  if (!resolvido) return;

  const conversa = obterConversa(resolvido);

  const nome =
    chat.name ||
    chat.displayName ||
    chat.subject ||
    contatos.get(resolvido)?.nome ||
    contatos.get(id)?.nome;

  if (pareceNomeUtil(nome, resolvido)) conversa.nome = nome;

  if (chat.unreadCount !== null && chat.unreadCount !== undefined) {
    atualizarEstadoNaoLidasWhatsapp(
      resolvido,
      chat.unreadCount,
      fonte === "update" ? "update" : fonte,
      chat.conversationTimestamp || chat.timestamp || 0,
    );
  }

  if (typeof chat.archived === "boolean") {
    const autoritativo = fonte === "update";
    aplicarEstadoArquivado(resolvido, chat.archived, autoritativo);
    conversa.arquivada = estadoArquivadas.get(resolvido) ?? chat.archived;
  } else if (estadoArquivadas.has(resolvido)) {
    conversa.arquivada = estadoArquivadas.get(resolvido);
  }

  const timestamp = numeroTimestamp(
    chat.conversationTimestamp || chat.timestamp || conversa.timestamp,
  );

  conversa.timestamp = Math.max(conversa.timestamp || 0, timestamp || 0);
}

function normalizarStatusEntrega(status) {
  if (status === null || status === undefined) {
    return null;
  }

  const texto = String(status).toUpperCase();

  if (texto.includes("PLAYED") || texto.includes("READ")) {
    return "lida";
  }

  if (texto.includes("DELIVERY") || texto.includes("DELIVERED")) {
    return "entregue";
  }

  if (texto.includes("SERVER_ACK") || texto.includes("SENT")) {
    return "enviada";
  }

  const numero = Number(status);

  if (Number.isFinite(numero)) {
    if (numero >= 4) return "lida";
    if (numero === 3) return "entregue";
    if (numero === 2) return "enviada";
    if (numero === 1) return "pendente";
  }

  return null;
}

function prioridadeStatusEntrega(status) {
  const mapa = {
    pendente: 1,
    enviada: 2,
    entregue: 3,
    lida: 4,
  };

  return mapa[status] || 0;
}

function atualizarStatusMensagemLocal(idMensagem, statusEntrega, origem = "") {
  if (!idMensagem || !statusEntrega) {
    return false;
  }

  for (const conversa of conversas.values()) {
    const mensagem = conversa.mensagens.find(
      (msg) => msg.idMensagem === idMensagem,
    );

    if (!mensagem) {
      continue;
    }

    const atual = mensagem.statusEntrega || null;

    if (
      prioridadeStatusEntrega(statusEntrega) <= prioridadeStatusEntrega(atual)
    ) {
      return false;
    }

    mensagem.statusEntrega = statusEntrega;

    enviar("mensagem-status", {
      conversaId: conversa.id,
      idMensagem,
      statusEntrega,
    });

    consoleLogOriginal(
      `Message status ${origem || "update"}: ${idMensagem} -> ${statusEntrega}.`,
    );

    return true;
  }

  return false;
}

function statusPorReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") {
    return null;
  }

  if (
    receipt.playedTimestamp ||
    receipt.readTimestamp ||
    receipt.type === "played" ||
    receipt.type === "read" ||
    receipt.type === "read-self"
  ) {
    return "lida";
  }

  if (
    receipt.receiptTimestamp ||
    receipt.type === "delivery" ||
    receipt.type === "delivered"
  ) {
    return "entregue";
  }

  return null;
}

async function identificarParticipanteMensagemGrupo(mensagem, conversaId) {
  if (!mensagem?.key || !ehGrupo(conversaId)) {
    return {
      participant: null,
      participantAlt: null,
      participantPn: null,
      participantAliases: [],
    };
  }

  const participant = normalizarJid(
    mensagem.key.participant || mensagem.key.participantAlt,
  );

  const participantAlt = normalizarJid(mensagem.key.participantAlt);

  let participantPn = normalizarPn(
    mensagem.participantPn ||
      mensagem.senderPn ||
      (ehPn(participant) ? participant : null) ||
      (ehPn(participantAlt) ? participantAlt : null),
  );

  if (!participantPn) {
    for (const candidato of [participant, participantAlt]) {
      if (!candidato || !ehLid(candidato)) continue;

      const resolvido = await resolverJid(candidato);

      if (ehPn(resolvido)) {
        participantPn = normalizarPn(resolvido);
        break;
      }
    }
  }

  const aliases = Array.from(
    new Set(
      [participant, participantAlt, participantPn]
        .map(normalizarJid)
        .filter(Boolean),
    ),
  );

  return {
    participant,
    participantAlt,
    participantPn,
    participantAliases: aliases,
  };
}

async function adicionarMensagem(mensagem, emitir = false, extras = {}) {
  try {
    if (!mensagem?.key) return;

    const remoto = normalizarJid(mensagem.key.remoteJid);
    if (!remoto) return;

    if (remoto === "status@broadcast") {
      tentarRegistrarPar(mensagem.key.participant, mensagem.key.participantAlt);
      tentarRegistrarPar(mensagem.key.participant, mensagem.participantPn);
      registrarChaveStatusBaileys(mensagem);
      return;
    }

    if (remoto.endsWith("@newsletter")) {
      return;
    }

    tentarRegistrarPar(mensagem.key.remoteJid, mensagem.key.remoteJidAlt);
    tentarRegistrarPar(mensagem.key.participant, mensagem.key.participantAlt);
    tentarRegistrarPar(mensagem.key.remoteJid, mensagem.senderPn);
    tentarRegistrarPar(mensagem.key.participant, mensagem.participantPn);

    const id = await resolverJid(remoto);
    const interpretada = interpretarMensagem(mensagem.message);
    if (!interpretada) return;

    const conversa = obterConversa(id);
    const idMensagem = mensagem.key.id;
    const respostaExtraida = extrairRespostaBaileys(mensagem.message);
    const identidadeParticipante = await identificarParticipanteMensagemGrupo(
      mensagem,
      id,
    );

    if (idMensagem) {
      const existente = conversa.mensagens.find(
        (msg) => msg.idMensagem === idMensagem,
      );

      if (existente) {
        const respostaAnterior = JSON.stringify(existente.resposta || null);
        const identidadeAnterior = JSON.stringify({
          participant: existente.participant || null,
          participantAlt: existente.participantAlt || null,
          participantPn: existente.participantPn || null,
          participantAliases: existente.participantAliases || [],
        });

        existente.resposta = mesclarRespostaPersistida(
          existente.resposta,
          respostaExtraida,
        );

        if (identidadeParticipante.participant) {
          existente.participant = identidadeParticipante.participant;
        }

        if (identidadeParticipante.participantAlt) {
          existente.participantAlt = identidadeParticipante.participantAlt;
        }

        if (identidadeParticipante.participantPn) {
          existente.participantPn = identidadeParticipante.participantPn;
        }

        if (identidadeParticipante.participantAliases.length) {
          existente.participantAliases =
            identidadeParticipante.participantAliases;
        }

        const respostaNova = JSON.stringify(existente.resposta || null);
        const identidadeNova = JSON.stringify({
          participant: existente.participant || null,
          participantAlt: existente.participantAlt || null,
          participantPn: existente.participantPn || null,
          participantAliases: existente.participantAliases || [],
        });

        if (
          emitir &&
          (respostaAnterior !== respostaNova ||
            identidadeAnterior !== identidadeNova)
        ) {
          enviar("mensagem", {
            id: conversa.id,
            nome: conversa.nome,
            arquivada: conversa.arquivada,
            ...existente,
          });
        }

        return;
      }
    }

    const timestamp = numeroTimestamp(mensagem.messageTimestamp);

    if (
      mensagem.pushName &&
      !mensagem.key.fromMe &&
      !ehGrupo(id) &&
      !pareceNomeUtil(conversa.nome, id)
    ) {
      conversa.nome = mensagem.pushName;
      definirNomeContato(id, mensagem.pushName);
    }

    const item = {
      idMensagem,
      texto: interpretada.texto,
      tipo: interpretada.tipo,
      mime: interpretada.mime || null,
      fileName: interpretada.fileName || null,
      viewOnceKind: interpretada.viewOnceKind || null,
      horario: formatarHorario(timestamp),
      timestamp,
      minha: !!mensagem.key.fromMe,
      remoteJid: normalizarJid(mensagem.key.remoteJid) || id,
      participant: identidadeParticipante.participant,
      participantAlt: identidadeParticipante.participantAlt,
      participantPn: identidadeParticipante.participantPn,
      participantAliases: identidadeParticipante.participantAliases,
      lidaPorMim: !!mensagem.key.fromMe,
      statusEntrega: mensagem.key.fromMe
        ? normalizarStatusEntrega(mensagem.status) || "enviada"
        : null,
      resposta: respostaExtraida,
      mediaPath: null,
      mediaUrl: null,
      rawBase64: mensagemTemMidia(interpretada.tipo)
        ? serializarMensagemBruta(mensagem)
        : null,
      ...extras,
    };

    conversa.mensagens.push(item);
    conversa.mensagens.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    conversa.mensagens = conversa.mensagens.slice(-600);
    conversa.timestamp = Math.max(conversa.timestamp || 0, timestamp);

    if (emitir) {
      enviar("mensagem", {
        id: conversa.id,
        nome: conversa.nome,
        arquivada: conversa.arquivada,
        ...item,
        ...dadosNaoLidasWhatsappParaEvento(
          conversa.id,
          timestamp,
          item.minha,
        ),
      });
    }
  } catch (erro) {
    console.error("Erro ao adicionar mensagem:", erro);
  }
}

async function processarHistorico(dados) {
  enviarEtapaSincronizacao("historico");

  enviar("status", {
    texto: "Sincronizando em segundo plano...",
    tipo: "conectando",
  });

  console.log(
    `Histórico recebido: ${dados.chats?.length || 0} conversas, ` +
      `${dados.messages?.length || 0} mensagens, ` +
      `${dados.contacts?.length || 0} contatos.`,
  );

  for (const mapa of dados.lidPnMappings || []) {
    registrarMapeamento(mapa.lid, mapa.pn);
  }

  for (const contato of dados.contacts || []) {
    await atualizarContato(contato);
  }

  for (const chat of dados.chats || []) {
    await atualizarChat(chat, "historico");
  }

  for (const mensagem of dados.messages || []) {
    await adicionarMensagem(mensagem, false);
  }

  for (const conversa of conversas.values()) {
    const estadoNaoLidas = obterEstadoNaoLidasWhatsapp(conversa.id);

    if (estadoNaoLidas) {
      reconciliarMensagensLidasPorContadorWhatsapp(
        conversa,
        estadoNaoLidas.total,
      );
    }
  }

  const nomesAplicados = aplicarNomesConhecidosNasConversas();

  salvarConversas();
  salvarMapeamentos();
  salvarArquivadas();

  const totalArquivadas = Array.from(conversas.values()).filter(
    (conversa) => conversa.arquivada,
  ).length;

  console.log(
    `Arquivadas reconhecidas: ${totalArquivadas}. ` +
      `Nomes aplicados: ${nomesAplicados}.`,
  );

  enviarConversas();

  enviarEtapaSincronizacao("historico-pronto");

  enviar("status", {
    texto: "Conectado",
    tipo: "conectado",
  });
}

async function baixarMidiaDaMensagem(conversaId, idMensagem) {
  if (!sock || !baileysApi?.downloadMediaMessage) {
    throw new Error("WhatsApp ainda não está pronto.");
  }

  const idResolvido = await resolverJid(conversaId);
  const conversa =
    conversas.get(idResolvido) || conversas.get(normalizarJid(conversaId));

  if (!conversa) {
    throw new Error("Conversa não encontrada.");
  }

  const item = conversa.mensagens.find((msg) => msg.idMensagem === idMensagem);

  if (!item) {
    throw new Error("Mensagem não encontrada.");
  }

  if (!mensagemTemMidia(item.tipo)) {
    throw new Error("Essa mensagem não possui mídia.");
  }

  if (item.mediaPath && fs.existsSync(item.mediaPath)) {
    return {
      mediaUrl: pathToFileURL(item.mediaPath).href,
      mediaPath: item.mediaPath,
      fileName: item.fileName || path.basename(item.mediaPath),
      tipo: item.tipo,
      mime: item.mime,
    };
  }

  if (!item.rawBase64) {
    throw new Error(
      "Mídia histórica sem os metadados necessários para download.",
    );
  }

  let mensagemBruta = desserializarMensagemBruta(item.rawBase64);

  if (!mensagemBruta) {
    throw new Error("Não foi possível reconstruir a mídia.");
  }

  const loggerSilencioso = pino({ level: "silent" });

  async function baixarDireto(msg, tempo = 12000) {
    return comTimeout(
      baileysApi.downloadMediaMessage(
        msg,
        "buffer",
        {},
        {
          logger: loggerSilencioso,
        },
      ),
      tempo,
      "O WhatsApp demorou demais para entregar a mídia.",
    );
  }

  let buffer = null;
  let primeiroErro = null;

  try {
    buffer = await baixarDireto(mensagemBruta, 10000);
  } catch (erro) {
    primeiroErro = erro;
  }

  if (!buffer?.length && typeof sock.updateMediaMessage === "function") {
    try {
      await comTimeout(
        sock.updateMediaMessage(mensagemBruta),
        10000,
        "O WhatsApp não respondeu ao pedido de reenvio da mídia.",
      );

      // O Baileys pode atualizar o objeto em memória. Reconstruímos apenas
      // se ainda houver um rawBase64 mais recente salvo futuramente.
      buffer = await baixarDireto(mensagemBruta, 12000);
    } catch (erro) {
      if (!primeiroErro) primeiroErro = erro;
    }
  }

  if (!buffer?.length) {
    const detalhe = primeiroErro?.message || "Mídia indisponível.";
    throw new Error(`Não foi possível baixar esta mídia. ${detalhe}`);
  }

  garantirPasta(pastaMedia());

  const ext = extensaoPorMime(item.mime, item.tipo);
  const nomeBase = item.fileName
    ? sanitizarNomeArquivo(item.fileName)
    : sanitizarNomeArquivo(item.idMensagem || `${Date.now()}`);

  const jaTemExt = path.extname(nomeBase);
  const nomeFinal = jaTemExt ? nomeBase : `${nomeBase}${ext}`;
  const caminho = path.join(
    pastaMedia(),
    `${sanitizarNomeArquivo(item.idMensagem || Date.now())}_${nomeFinal}`,
  );

  fs.writeFileSync(caminho, buffer);

  item.mediaPath = caminho;
  salvarConversas();

  return {
    mediaUrl: pathToFileURL(caminho).href,
    mediaPath: caminho,
    fileName: item.fileName || path.basename(caminho),
    tipo: item.tipo,
    mime: item.mime,
  };
}

function localizarMensagemMidiaLocal(conversaId, idMensagem) {
  const alvoMensagem = String(idMensagem || "").trim();

  if (!alvoMensagem) {
    return null;
  }

  const idsConversa = [];
  const vistos = new Set();

  const adicionarId = (valor) => {
    const id = normalizarJid(valor);

    if (!id || vistos.has(id)) {
      return;
    }

    vistos.add(id);
    idsConversa.push(id);

    if (ehPn(id)) {
      const lid = normalizarJid(pnParaLid.get(id));

      if (lid && !vistos.has(lid)) {
        vistos.add(lid);
        idsConversa.push(lid);
      }
    }

    if (ehLid(id)) {
      const pn = normalizarJid(lidParaPn.get(id));

      if (pn && !vistos.has(pn)) {
        vistos.add(pn);
        idsConversa.push(pn);
      }
    }
  };

  adicionarId(idCanonicoConversaLocal(conversaId));
  adicionarId(conversaId);

  for (const id of idsConversa) {
    const conversa = conversas.get(id);

    if (!conversa) {
      continue;
    }

    const item = conversa.mensagens.find(
      (msg) => String(msg?.idMensagem || "") === alvoMensagem,
    );

    if (item) {
      return {
        conversa,
        item,
      };
    }
  }

  // Message IDs are unique enough for this recovery fallback. This covers
  // the short window where a chat changed between LID and PN before mapping
  // stabilization.
  for (const conversa of conversas.values()) {
    const item = conversa.mensagens.find(
      (msg) => String(msg?.idMensagem || "") === alvoMensagem,
    );

    if (item) {
      consoleLogOriginal(
        `[MIDIA CACHE] MENSAGEM_LOCALIZADA_FALLBACK | id=${alvoMensagem} | ` +
          `conversa=${conversa.id}`,
      );

      return {
        conversa,
        item,
      };
    }
  }

  return null;
}

function metadadosMensagemMidiaLocal(conversaId, idMensagem) {
  const localizada = localizarMensagemMidiaLocal(conversaId, idMensagem);
  const item = localizada?.item;

  if (!item) {
    return {};
  }

  return {
    conversaIdLocal: localizada.conversa?.id || null,
    idMensagemWpp: String(item.idMensagemWpp || "").trim() || null,
    tipo: String(item.tipo || "").trim() || null,
    mime: item.mime || null,
    fileName: item.fileName || null,
    timestamp: Number(item.timestamp || 0) || null,
  };
}

function registrarMidiaRecuperadaLocal(dados = {}) {
  const conversaId = String(dados?.conversaId || "").trim();
  const idMensagem = String(dados?.idMensagem || "").trim();
  const mediaPath = String(dados?.mediaPath || "").trim();

  if (!conversaId || !idMensagem || !mediaPath) {
    return {
      ok: false,
      erro: "Dados incompletos para persistir a midia recuperada.",
    };
  }

  if (!fs.existsSync(mediaPath)) {
    return {
      ok: false,
      erro: "Arquivo recuperado nao existe no disco.",
    };
  }

  const localizada = localizarMensagemMidiaLocal(conversaId, idMensagem);

  if (!localizada?.item) {
    return {
      ok: false,
      erro: "Mensagem local nao encontrada para persistir a midia.",
    };
  }

  const item = localizada.item;

  if (!mensagemTemMidia(item.tipo)) {
    return {
      ok: false,
      erro: "A mensagem local nao e uma midia.",
    };
  }

  item.mediaPath = mediaPath;

  const idMensagemWpp = String(dados?.idMensagemWpp || "").trim();

  if (idMensagemWpp && !String(item.idMensagemWpp || "").trim()) {
    item.idMensagemWpp = idMensagemWpp;
  }

  if (dados?.mime && !item.mime) {
    item.mime = dados.mime;
  }

  if (dados?.fileName && !item.fileName) {
    item.fileName = dados.fileName;
  }

  salvarConversas();

  consoleLogOriginal(
    `[MIDIA CACHE] RECUPERADA_PERSISTIDA | conversa=${localizada.conversa.id} | ` +
      `id=${idMensagem} | tipo=${item.tipo}`,
  );

  return {
    ok: true,
    conversaId: localizada.conversa.id,
    idMensagem,
    mediaPath,
    idMensagemWpp: item.idMensagemWpp || null,
  };
}

async function enviarMensagemTexto(conversaId, texto) {
  if (!sock) {
    throw new Error("WhatsApp ainda não está conectado.");
  }

  const conteudo = String(texto || "").trim();

  if (!conteudo) {
    throw new Error("Digite uma mensagem.");
  }

  const jidOrigem = normalizarJid(conversaId);

  if (!jidOrigem) {
    throw new Error("Conversa invalida.");
  }

  const jidDestino = await resolverJidParaEnvio(jidOrigem);

  if (!jidDestino) {
    throw new Error("Nao consegui localizar o destinatario.");
  }

  const enviada = await comTimeout(
    sock.sendMessage(jidDestino, {
      text: conteudo,
    }),
    20000,
    "O WhatsApp demorou demais para enviar a mensagem.",
  );

  if (!enviada?.key?.id) {
    throw new Error("O WhatsApp nao confirmou o envio.");
  }

  registrarMensagemParaRetry(enviada);

  // Mostra a mensagem imediatamente no WhatsIAPP.
  // Se o Baileys também emitir messages.upsert, o deduplicador pelo
  // idMensagem impede que ela apareça duas vezes.
  await adicionarMensagem(enviada, true);

  salvarConversas();
  enviarConversas();

  return {
    idMensagem: enviada.key.id,
    conversaId: jidDestino,
  };
}

async function marcarConversaComoLida(conversaId, idsMensagem = []) {
  if (!sock || typeof sock.readMessages !== "function") {
    throw new Error(
      "WhatsApp ainda não está pronto para marcar mensagens como lidas.",
    );
  }

  const jidOrigem = normalizarJid(conversaId);

  if (!jidOrigem) {
    throw new Error("Conversa invalida.");
  }

  const jidDestino = await resolverJid(jidOrigem);

  if (!jidDestino) {
    throw new Error("Não consegui localizar a conversa.");
  }

  const conversa = conversas.get(jidDestino) || conversas.get(jidOrigem);

  if (!conversa) {
    return {
      marcadas: 0,
    };
  }

  const filtroIds = new Set((idsMensagem || []).map(String).filter(Boolean));

  let pendentes = conversa.mensagens.filter(
    (msg) =>
      !msg.minha &&
      !msg.lidaPorMim &&
      msg.idMensagem &&
      (!filtroIds.size || filtroIds.has(String(msg.idMensagem))),
  );

  // Mantemos um limite defensivo por chamada. Como as mensagens
  // mais recentes ficam no fim do histórico, priorizamos as últimas.
  pendentes = pendentes.slice(-600);

  if (!pendentes.length) {
    atualizarEstadoNaoLidasWhatsapp(
      jidDestino,
      0,
      "leitura-local",
      conversa.timestamp || 0,
    );

    return {
      marcadas: 0,
    };
  }

  const chaves = pendentes.map((msg) => {
    const chave = {
      remoteJid: normalizarJid(msg.remoteJid) || jidDestino,
      id: msg.idMensagem,
      fromMe: false,
    };

    if (msg.participant) {
      chave.participant = msg.participant;
    }

    return chave;
  });

  const tamanhoLote = 100;

  for (let i = 0; i < chaves.length; i += tamanhoLote) {
    await comTimeout(
      sock.readMessages(chaves.slice(i, i + tamanhoLote)),
      20000,
      "O WhatsApp demorou demais para marcar as mensagens como lidas.",
    );
  }

  for (const msg of pendentes) {
    msg.lidaPorMim = true;
  }

  atualizarEstadoNaoLidasWhatsapp(
    jidDestino,
    0,
    "leitura-local",
    conversa.timestamp || 0,
  );

  salvarConversas();

  return {
    marcadas: pendentes.length,
  };
}

function mimePorArquivo(caminho, tipo) {
  const ext = path.extname(String(caminho || "")).toLowerCase();

  const mapa = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": tipo === "audio" ? "audio/webm" : "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg; codecs=opus",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };

  return (
    mapa[ext] ||
    (tipo === "imagem"
      ? "image/jpeg"
      : tipo === "video"
        ? "video/mp4"
        : tipo === "audio"
          ? "audio/mpeg"
          : "application/octet-stream")
  );
}

function salvarMidiaEnviadaNoCache(caminhoOrigem, idMensagem) {
  garantirPasta(pastaMedia());

  const ext = path.extname(caminhoOrigem) || "";

  const nome = `${sanitizarNomeArquivo(
    idMensagem || Date.now(),
  )}_enviada${ext}`;

  const destino = path.join(pastaMedia(), nome);

  try {
    if (path.resolve(caminhoOrigem) !== path.resolve(destino)) {
      fs.copyFileSync(caminhoOrigem, destino);
    }

    return destino;
  } catch {
    return caminhoOrigem;
  }
}

async function enviarAnexo(conversaId, caminho, tipo, legenda = "") {
  if (!sock) {
    throw new Error("WhatsApp ainda não está conectado.");
  }

  if (!caminho || !fs.existsSync(caminho)) {
    throw new Error("O arquivo selecionado não foi encontrado.");
  }

  const jidOrigem = normalizarJid(conversaId);

  if (!jidOrigem) {
    throw new Error("Conversa invalida.");
  }

  const jidDestino = await resolverJidParaEnvio(jidOrigem);

  if (!jidDestino) {
    throw new Error("Nao consegui localizar o destinatario.");
  }

  const buffer = fs.readFileSync(caminho);

  const fileName = path.basename(caminho);

  const mime = mimePorArquivo(caminho, tipo);

  const textoLegenda = String(legenda || "").trim();

  let conteudo;

  if (tipo === "imagem") {
    conteudo = {
      image: buffer,
      caption: textoLegenda,
      mimetype: mime,
    };
  } else if (tipo === "video") {
    conteudo = {
      video: buffer,
      caption: textoLegenda,
      mimetype: mime,
    };
  } else if (tipo === "audio") {
    conteudo = {
      audio: buffer,
      mimetype: mime,
      ptt: false,
    };
  } else {
    conteudo = {
      document: buffer,
      fileName,
      mimetype: mime,
      caption: textoLegenda,
    };
  }

  const enviada = await comTimeout(
    sock.sendMessage(jidDestino, conteudo),
    90000,
    "O WhatsApp demorou demais para enviar o arquivo.",
  );

  if (!enviada?.key?.id) {
    throw new Error("O WhatsApp nao confirmou o envio do arquivo.");
  }

  registrarMensagemParaRetry(enviada);

  const mediaPath = salvarMidiaEnviadaNoCache(caminho, enviada.key.id);

  await adicionarMensagem(enviada, true, {
    mediaPath,
    mediaUrl: pathToFileURL(mediaPath).href,
    fileName: tipo === "documento" ? fileName : null,
    statusEntrega: "enviada",
  });

  salvarConversas();
  enviarConversas();

  return {
    idMensagem: enviada.key.id,
    conversaId: jidDestino,
  };
}

function extensaoEntradaAudioPorMime(mime) {
  const valor = String(mime || "").toLowerCase();

  if (valor.includes("ogg") || valor.includes("opus")) return ".ogg";
  if (valor.includes("webm")) return ".webm";
  if (valor.includes("mp4") || valor.includes("m4a")) return ".m4a";
  if (valor.includes("mpeg") || valor.includes("mp3")) return ".mp3";
  if (valor.includes("wav")) return ".wav";

  return ".bin";
}

async function converterAudioGravadoParaOggOpusCompat(buffer, mimeOrigem) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("A gravacao de audio esta vazia.");
  }

  if (!ffmpegPath) {
    throw new Error("FFmpeg nao foi localizado pelo ffmpeg-static.");
  }

  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const caminhoEntrada = path.join(
    os.tmpdir(),
    `whatsiapp-ptt-${token}-entrada${extensaoEntradaAudioPorMime(mimeOrigem)}`,
  );
  const caminhoSaida = path.join(
    os.tmpdir(),
    `whatsiapp-ptt-${token}-normalizado.ogg`,
  );

  fs.writeFileSync(caminhoEntrada, buffer);

  try {
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          "-y",
          "-loglevel",
          "error",
          "-fflags",
          "+genpts",
          "-i",
          caminhoEntrada,
          "-vn",
          "-c:a",
          "libopus",
          "-application",
          "voip",
          "-ac",
          "1",
          "-ar",
          "48000",
          "-b:a",
          "32k",
          "-avoid_negative_ts",
          "make_zero",
          caminhoSaida,
        ],
        {
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
        (erro, _stdout, stderr) => {
          if (!erro) {
            resolve();
            return;
          }

          const detalhe = String(stderr || erro?.message || erro)
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-4)
            .join(" | ");

          reject(
            new Error(
              detalhe
                ? `Falha ao normalizar audio PTT: ${detalhe}`
                : "Falha ao normalizar audio PTT.",
            ),
          );
        },
      );
    });

    if (!fs.existsSync(caminhoSaida)) {
      throw new Error("FFmpeg nao gerou o audio OGG/Opus.");
    }

    const convertido = fs.readFileSync(caminhoSaida);

    if (!convertido.length) {
      throw new Error("FFmpeg gerou um audio OGG/Opus vazio.");
    }

    return convertido;
  } finally {
    for (const caminho of [caminhoEntrada, caminhoSaida]) {
      try {
        fs.rmSync(caminho, { force: true });
      } catch {}
    }
  }
}

async function enviarAudioGravado(conversaId, bytes, mime) {
  if (!sock) {
    throw new Error("WhatsApp ainda nao esta conectado.");
  }

  const jidOrigem = normalizarJid(conversaId);

  if (!jidOrigem) {
    throw new Error("Conversa invalida.");
  }

  const jidDestino = await resolverJidParaEnvio(jidOrigem);

  if (!jidDestino) {
    throw new Error("Nao consegui localizar o destinatario.");
  }

  const bufferOrigem = Buffer.from(bytes || []);

  if (!bufferOrigem.length) {
    throw new Error("A gravacao de audio esta vazia.");
  }

  const mimeOrigem = String(mime || "audio/webm");
  const mimeFinal = "audio/ogg; codecs=opus";

  consoleLogOriginal(
    `[AUDIO PTT OGG] inicio | jid=${jidDestino} | mimeOrigem=${mimeOrigem} | bytes=${bufferOrigem.length}.`,
  );

  const bufferOgg = await converterAudioGravadoParaOggOpusCompat(
    bufferOrigem,
    mimeOrigem,
  );

  if (!bufferOgg?.length) {
    throw new Error("Nao foi possivel gerar o audio OGG/Opus para envio.");
  }

  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const caminhoEnvio = path.join(
    os.tmpdir(),
    `whatsiapp-ptt-envio-${token}.ogg`,
  );

  fs.writeFileSync(caminhoEnvio, bufferOgg);

  let enviada = null;

  // O retry do Baileys ja ignora o cache de dispositivos. Fazemos a mesma
  // invalidacao antes do primeiro PTT para que o WhatsApp Web receba a chave
  // no envio inicial, em vez de depender do retry para sair de "Aguardando".
  cacheDispositivosEnvio.flushAll();
  consoleLogOriginal(
    `[AUDIO PTT SYNC] cache de dispositivos invalidado antes do envio | jid=${jidDestino}.`,
  );

  try {
    enviada = await comTimeout(
      sock.sendMessage(jidDestino, {
        audio: {
          url: caminhoEnvio,
        },
        mimetype: mimeFinal,
        ptt: true,
      }),
      90000,
      "O WhatsApp demorou demais para enviar o audio.",
    );
  } finally {
    try {
      fs.rmSync(caminhoEnvio, { force: true });
    } catch {}
  }

  if (!enviada?.key?.id) {
    throw new Error("O WhatsApp nao confirmou o envio do audio.");
  }

  registrarMensagemParaRetry(enviada);

  garantirPasta(pastaMedia());

  const mediaPath = path.join(
    pastaMedia(),
    `${sanitizarNomeArquivo(enviada.key.id)}_voz.ogg`,
  );

  fs.writeFileSync(mediaPath, bufferOgg);

  const mediaUrl = pathToFileURL(mediaPath).href;

  await adicionarMensagem(enviada, true, {
    mediaPath,
    mediaUrl,
    statusEntrega: "enviada",
  });

  salvarConversas();
  enviarConversas();

  consoleLogOriginal(
    `[AUDIO PTT OGG] enviado | id=${enviada.key.id} | jid=${jidDestino} | bytes=${bufferOgg.length}.`,
  );

  return {
    idMensagem: enviada.key.id,
    conversaId: jidDestino,
    mediaPath,
    mediaUrl,
    mime: mimeFinal,
    via: "baileys-ogg-opus",
  };
}

async function consultarBloqueioContato(conversaId) {
  if (!sock || typeof sock.fetchBlocklist !== "function") {
    throw new Error("WhatsApp ainda nao esta pronto.");
  }

  const identidade = await resolverIdentidadeBloqueio(conversaId);

  if (!identidade?.original) {
    throw new Error("Conversa invalida.");
  }

  if (ehGrupo(identidade.original)) {
    return {
      bloqueada: false,
      podeBloquear: false,
      jid: identidade.original,
    };
  }

  const lista = await comTimeout(
    sock.fetchBlocklist(),
    15000,
    "O WhatsApp demorou demais para consultar bloqueios.",
  );

  const bloqueados = new Set(
    (Array.isArray(lista) ? lista : []).map(normalizarJid).filter(Boolean),
  );

  const aliases = aliasesIdentidadeBloqueio(identidade);

  const bloqueada = Array.from(aliases).some((jid) => bloqueados.has(jid));

  return {
    bloqueada,
    podeBloquear: identidade.podeBloquear,
    jid: identidade.lid || identidade.pn || identidade.original,
  };
}

async function alterarBloqueioContato(conversaId, bloquear) {
  if (!sock || typeof sock.query !== "function") {
    throw new Error("WhatsApp ainda nao esta pronto.");
  }

  const identidade = await resolverIdentidadeBloqueio(conversaId);

  if (!identidade?.original) {
    throw new Error("Conversa invalida.");
  }

  if (ehGrupo(identidade.original)) {
    throw new Error("Grupos nao podem ser bloqueados.");
  }

  if (!identidade.lid || !identidade.pn) {
    console.warn(`Block mapping missing: ${identidade.original}.`);

    throw new Error(
      "Nao consegui resolver o numero real e o LID deste contato. " +
        "Abra a conversa no WhatsApp e tente novamente.",
    );
  }

  consoleLogOriginal(
    `Block action: ${bloquear ? "block" : "unblock"} ` +
      `${identidade.lid} / ${identidade.pn}.`,
  );

  const atributosItem = {
    action: bloquear ? "block" : "unblock",
    jid: identidade.lid,
  };

  if (bloquear) {
    atributosItem.pn_jid = identidade.pn;
  }

  await comTimeout(
    sock.query({
      tag: "iq",
      attrs: {
        xmlns: "blocklist",
        to: "s.whatsapp.net",
        type: "set",
      },
      content: [
        {
          tag: "item",
          attrs: atributosItem,
        },
      ],
    }),
    20000,
    "O WhatsApp demorou demais para alterar o bloqueio.",
  );

  let bloqueadaConfirmada = !!bloquear;

  try {
    const lista = await comTimeout(
      sock.fetchBlocklist(),
      12000,
      "Block confirmation timeout.",
    );

    const bloqueados = new Set(
      (Array.isArray(lista) ? lista : []).map(normalizarJid).filter(Boolean),
    );

    const aliases = aliasesIdentidadeBloqueio(identidade);

    bloqueadaConfirmada = Array.from(aliases).some((jid) =>
      bloqueados.has(jid),
    );
  } catch (erro) {
    console.warn("Block confirmation failed:", erro?.message || erro);
  }

  consoleLogOriginal(
    `Block result: ${identidade.lid} => ` +
      `${bloqueadaConfirmada ? "blocked" : "unblocked"}.`,
  );

  return {
    bloqueada: bloqueadaConfirmada,
    jid: identidade.lid,
    pn: identidade.pn,
  };
}

async function consultarFotoPerfilDireto(jid, tipo = "preview") {
  if (!sock || typeof sock.query !== "function") {
    return null;
  }

  const alvo = normalizarJid(jid);

  if (!alvo) {
    return null;
  }

  try {
    const resposta = await comTimeout(
      sock.query({
        tag: "iq",
        attrs: {
          target: alvo,
          to: "s.whatsapp.net",
          type: "get",
          xmlns: "w:profile:picture",
        },
        content: [
          {
            tag: "picture",
            attrs: {
              type: tipo,
              query: "url",
            },
          },
        ],
      }),
      4500,
      "Direct profile picture timeout.",
    );

    const filhos = Array.isArray(resposta?.content) ? resposta.content : [];
    const picture = filhos.find((item) => item?.tag === "picture");

    return picture?.attrs?.url || null;
  } catch {
    return null;
  }
}

async function aguardarBaileysProntoParaFotos(timeoutMs = 10000) {
  const inicio = Date.now();

  while (!encerrando && Date.now() - inicio < timeoutMs) {
    if (
      sock &&
      baileysConectadoParaFotos &&
      typeof sock.profilePictureUrl === "function"
    ) {
      const tempoDesdeConexao = Date.now() - baileysConectadoEm;
      const esperaEstabilizacao = Math.max(0, 500 - tempoDesdeConexao);

      if (esperaEstabilizacao > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, esperaEstabilizacao),
        );
      }

      return (
        !!sock &&
        baileysConectadoParaFotos &&
        typeof sock.profilePictureUrl === "function"
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return (
    !!sock &&
    baileysConectadoParaFotos &&
    typeof sock.profilePictureUrl === "function"
  );
}

async function consultarFotoPerfilRobusta(jid) {
  const alvo = normalizarJid(jid);

  if (!alvo) {
    return null;
  }

  // A consulta IQ direta era o caminho estavel antes da regressao.
  // Comeca pelo preview, que e menor e costuma responder mais rapido.
  let url = await consultarFotoPerfilDireto(alvo, "preview");

  if (url) {
    return url;
  }

  if (typeof sock?.profilePictureUrl === "function") {
    for (const tipo of ["preview", "image"]) {
      try {
        url = await comTimeout(
          sock.profilePictureUrl(alvo, tipo),
          5500,
          "Profile picture API timeout.",
        );
      } catch {
        url = null;
      }

      if (url) {
        return url;
      }
    }
  }

  return await consultarFotoPerfilDireto(alvo, "image");
}

async function obterFotoPerfil(conversaId) {
  const prontoParaFotos = await aguardarBaileysProntoParaFotos();

  if (!prontoParaFotos) {
    throw new Error("WhatsApp ainda nao esta pronto.");
  }

  const jidOrigem = normalizarJid(conversaId);

  if (!jidOrigem) {
    throw new Error("Conversa invalida.");
  }

  const jidDestino = await resolverJid(jidOrigem);
  const chave = jidDestino || jidOrigem;
  const agora = Date.now();

  const cache = cacheFotosPerfil.get(chave);

  const numero = String(jidDestino || jidOrigem)
    .replace("@s.whatsapp.net", "")
    .replace("@c.us", "")
    .replace("@lid", "");

  const ttlCache = cache?.url ? 30 * 60 * 1000 : 5000;

  if (cache && agora - cache.em < ttlCache) {
    return {
      url: cache.url || null,
      numero,
      jid: jidDestino || jidOrigem,
    };
  }

  const candidatos = [];

  function adicionarCandidato(valor) {
    const jid = normalizarJid(valor);

    if (jid && !candidatos.includes(jid)) {
      candidatos.push(jid);
    }
  }

  adicionarCandidato(jidDestino);
  adicionarCandidato(jidOrigem);

  if (ehPn(jidDestino)) {
    adicionarCandidato(pnParaLid.get(jidDestino));
  }

  if (ehLid(jidDestino)) {
    adicionarCandidato(lidParaPn.get(jidDestino));
  }

  if (ehPn(jidOrigem)) {
    adicionarCandidato(pnParaLid.get(jidOrigem));
  }

  if (ehLid(jidOrigem)) {
    adicionarCandidato(lidParaPn.get(jidOrigem));
  }

  let url = null;
  let jidUsado = jidDestino || jidOrigem;

  for (const candidato of candidatos) {
    try {
      const resultado = await consultarFotoPerfilRobusta(candidato);

      if (resultado) {
        url = resultado;
        jidUsado = candidato;
        break;
      }
    } catch {}
  }

  if (!url && Date.now() - baileysConectadoEm < 7000) {
    await new Promise((resolve) => setTimeout(resolve, 900));

    if (baileysConectadoParaFotos) {
      for (const candidato of candidatos) {
        try {
          const resultado = await consultarFotoPerfilRobusta(candidato);

          if (resultado) {
            url = resultado;
            jidUsado = candidato;
            break;
          }
        } catch {}
      }
    }
  }

  cacheFotosPerfil.set(chave, {
    url: url || null,
    em: agora,
  });

  registrarLogFotoPerfil(!!url);

  return {
    url: url || null,
    numero,
    jid: jidUsado,
  };
}

async function obterMinhaFotoPerfil() {
  const prontoParaFotos = await aguardarBaileysProntoParaFotos();

  if (!prontoParaFotos) {
    throw new Error("WhatsApp ainda nao esta pronto.");
  }

  const agora = Date.now();
  const chaveCache = "__minha_foto__";
  const cache = cacheFotosPerfil.get(chaveCache);
  const ttlCache = cache?.url ? 30 * 60 * 1000 : 5000;

  if (cache && agora - cache.em < ttlCache) {
    return {
      url: cache.url || null,
      jid: cache.jid || null,
      nome: sock?.user?.name || null,
    };
  }

  const candidatos = [];

  function adicionarCandidato(valor) {
    const jid = normalizarJid(valor);

    if (jid && !candidatos.includes(jid)) {
      candidatos.push(jid);
    }
  }

  adicionarCandidato(sock?.user?.id);
  adicionarCandidato(sock?.user?.lid);

  const idPrincipal = normalizarJid(sock?.user?.id);
  const lidPrincipal = normalizarJid(sock?.user?.lid);

  if (ehPn(idPrincipal)) {
    adicionarCandidato(pnParaLid.get(idPrincipal));
  }

  if (ehLid(idPrincipal)) {
    adicionarCandidato(lidParaPn.get(idPrincipal));
  }

  if (ehPn(lidPrincipal)) {
    adicionarCandidato(pnParaLid.get(lidPrincipal));
  }

  if (ehLid(lidPrincipal)) {
    adicionarCandidato(lidParaPn.get(lidPrincipal));
  }

  let url = null;
  let jidUsado = candidatos[0] || null;

  for (const candidato of candidatos) {
    try {
      const resultado = await consultarFotoPerfilRobusta(candidato);

      if (resultado) {
        url = resultado;
        jidUsado = candidato;
        break;
      }
    } catch {}
  }

  if (!url && Date.now() - baileysConectadoEm < 7000) {
    await new Promise((resolve) => setTimeout(resolve, 900));

    if (baileysConectadoParaFotos) {
      for (const candidato of candidatos) {
        try {
          const resultado = await consultarFotoPerfilRobusta(candidato);

          if (resultado) {
            url = resultado;
            jidUsado = candidato;
            break;
          }
        } catch {}
      }
    }
  }

  cacheFotosPerfil.set(chaveCache, {
    url: url || null,
    jid: jidUsado || null,
    em: agora,
  });

  return {
    url: url || null,
    jid: jidUsado || null,
    nome: sock?.user?.name || null,
  };
}

function normalizarPresenca(dados) {
  if (!dados || typeof dados !== "object") {
    return null;
  }

  const tipoBruto = String(dados.lastKnownPresence || dados.presence || "")
    .trim()
    .toLowerCase();

  let tipo = null;

  if (tipoBruto === "available" || tipoBruto === "online") {
    tipo = "online";
  } else if (tipoBruto === "composing" || tipoBruto === "typing") {
    tipo = "digitando";
  } else if (tipoBruto === "recording") {
    tipo = "gravando";
  } else if (tipoBruto === "unavailable" || tipoBruto === "offline") {
    tipo = "offline";
  } else if (tipoBruto === "paused") {
    tipo = "online";
  }

  let lastSeen = null;

  if (dados.lastSeen !== null && dados.lastSeen !== undefined) {
    const numero = Number(dados.lastSeen);

    if (Number.isFinite(numero) && numero > 0) {
      lastSeen = numero;
    }
  }

  if (!tipo && !lastSeen) {
    return null;
  }

  return {
    tipo,
    lastSeen,
    atualizadoEm: Date.now(),
  };
}

async function assinarPresenca(conversaId) {
  if (!sock || typeof sock.presenceSubscribe !== "function") {
    return {
      ok: false,
      disponivel: false,
      pendente: true,
      erro: "Presenca do WhatsApp ainda nao esta disponivel.",
    };
  }

  const jidOrigem = normalizarJid(conversaId);

  if (!jidOrigem) {
    return {
      ok: false,
      disponivel: false,
      pendente: false,
      erro: "Conversa invalida.",
    };
  }

  const jidDestino = await resolverJid(jidOrigem);

  if (!jidDestino) {
    return {
      ok: false,
      disponivel: false,
      pendente: true,
      erro: "Nao consegui localizar o contato.",
    };
  }

  if (ehGrupo(jidDestino)) {
    return {
      ok: true,
      disponivel: false,
      pendente: false,
      grupo: true,
    };
  }

  const aliases = new Set();

  const adicionarAlias = (valor) => {
    const normalizado = normalizarJid(valor);

    if (normalizado) {
      aliases.add(normalizado);
    }
  };

  adicionarAlias(jidOrigem);
  adicionarAlias(jidDestino);

  if (ehPn(jidDestino)) {
    adicionarAlias(pnParaLid.get(jidDestino));
  }

  if (ehLid(jidDestino)) {
    adicionarAlias(lidParaPn.get(jidDestino));
  }

  if (ehPn(jidOrigem)) {
    adicionarAlias(pnParaLid.get(jidOrigem));
  }

  if (ehLid(jidOrigem)) {
    adicionarAlias(lidParaPn.get(jidOrigem));
  }

  limparReforcosPresencaBaileys();

  presencaAssinadaAtiva = {
    conversaIdSolicitada: jidOrigem,
    conversaIdPrincipal: jidDestino,
    aliases,
    assinadaEm: Date.now(),
    ultimoEventoEm: 0,
  };

  // O JID principal precisa confirmar a assinatura antes de informarmos ao
  // renderer que o Baileys esta ativo. A versao anterior retornava sucesso
  // imediatamente e podia cancelar as tentativas mesmo se presenceSubscribe
  // falhasse depois.
  const promessaPrincipal = Promise.resolve(sock.presenceSubscribe(jidDestino));

  // Os aliases PN/LID sao complementares. Eles nao bloqueiam a assinatura
  // principal e servem para capturar presence.update em qualquer identidade.
  for (const jidAssinatura of aliases) {
    if (jidAssinatura === jidDestino) {
      continue;
    }

    Promise.resolve(sock.presenceSubscribe(jidAssinatura)).catch((erro) => {
      console.warn(
        `[PRESENCA BAILEYS] falha no alias ${jidAssinatura}: ` +
          `${erro?.message || erro || "erro desconhecido"}.`,
      );
    });
  }

  try {
    await comTimeout(
      promessaPrincipal,
      4500,
      "Timeout ao confirmar assinatura de presenca pelo Baileys.",
    );
  } catch (erro) {
    console.warn(
      `[PRESENCA BAILEYS] assinatura principal pendente para ${jidDestino}: ` +
        `${erro?.message || erro || "erro desconhecido"}.`,
    );

    return {
      ok: false,
      disponivel: false,
      pendente: true,
      conversaId: normalizarJid(jidDestino),
      aliases: Array.from(aliases),
      erro: erro?.message || String(erro),
    };
  }

  console.log(
    `[PRESENCA BAILEYS] assinatura confirmada para ${jidDestino} ` +
      `(aliases=${aliases.size}).`,
  );

  // Algumas sessoes multi-device confirmam presenceSubscribe mas so passam a
  // entregar presence.update depois de uma nova solicitacao. Reforcamos a
  // assinatura por poucos segundos e paramos assim que chegar o primeiro evento.
  agendarReforcosPresencaBaileys(presencaAssinadaAtiva);

  let cache = null;

  for (const alias of aliases) {
    const encontrado = cachePresencas.get(normalizarJid(alias));

    if (encontrado) {
      cache = encontrado;
      break;
    }
  }

  return {
    ok: true,
    disponivel: true,
    pendente: false,
    conversaId: normalizarJid(jidDestino),
    aliases: Array.from(aliases),
    presenca: cache || null,
  };
}

function limparTimerReconexao() {
  if (timerReconexao) {
    clearTimeout(timerReconexao);
    timerReconexao = null;
  }
}

function agendarReconexao(ms = 2000) {
  if (encerrando || resetandoSessao || timerReconexao) {
    return;
  }

  timerReconexao = setTimeout(() => {
    timerReconexao = null;
    iniciarWhatsApp();
  }, ms);
}

async function recriarSessaoParaQr() {
  if (resetandoSessao || encerrando) {
    return;
  }

  resetandoSessao = true;
  limparTimerReconexao();

  enviar("status", {
    texto: "Sessão removida. Gerando novo QR Code...",
    tipo: "conectando",
  });

  enviar("qr", null);

  try {
    try {
      sock?.end?.();
    } catch {}

    sock = null;

    fs.rmSync(pastaAuth(), {
      recursive: true,
      force: true,
    });

    // Garante que a próxima instância ignore qualquer evento atrasado
    // emitido pelo socket que acabou de ser invalidado.
    geracaoSocket++;

    await new Promise((resolve) => setTimeout(resolve, 2500));
  } catch (erro) {
    console.error("Erro ao limpar sessão desconectada:", erro);
  } finally {
    resetandoSessao = false;
    conectando = false;
  }

  if (!encerrando) {
    await iniciarWhatsApp();
  }
}

async function sincronizarArquivadasEContatos() {
  const marcador = arquivoSyncEssencial();

  if (fs.existsSync(marcador)) {
    return;
  }

  if (!sock || typeof sock.resyncAppState !== "function") {
    console.log(
      "resyncAppState não está disponível nesta instância do Baileys.",
    );
    return;
  }

  try {
    enviar("status", {
      texto: "Lendo arquivadas e contatos...",
      tipo: "conectando",
    });

    // O ponto que faltava:
    // resyncAppState parte da versão local já salva.
    // Se a versão já está atual, ele não pede snapshot e não reemite
    // as ações antigas de archive/contact.
    //
    // Apagamos SOMENTE as versões das duas coleções necessárias.
    // Credenciais, Signal keys, login, mensagens e mídias permanecem.
    const authDir = pastaAuth();

    const arquivosVersao = [
      "app-state-sync-version-regular_low.json",
      "app-state-sync-version-critical_unblock_low.json",
    ];

    for (const nome of arquivosVersao) {
      const arquivo = path.join(authDir, nome);

      try {
        if (fs.existsSync(arquivo)) {
          fs.rmSync(arquivo, { force: true });
          console.log(`Versão app-state zerada: ${nome}`);
        }
      } catch (erro) {
        console.error(`Erro ao zerar ${nome}:`, erro?.message || erro);
      }
    }

    // Limpa somente o nosso cache derivado de arquivamento,
    // porque agora ele será reconstruído do snapshot real.
    estadoArquivadas.clear();

    try {
      fs.rmSync(arquivoArquivadas(), { force: true });
    } catch {}

    console.log("V6: solicitando app-state de arquivadas e contatos.");

    await sock.resyncAppState(["regular_low", "critical_unblock_low"], false);

    if (sock?.ev?.isBuffering?.()) {
      console.log("V6: liberando buffer do app-state.");
      sock.ev.flush();
    }

    // Aguarda os chats.update / contacts.* emitidos pelo processamento
    // do snapshot antes de calcular e persistir o resultado.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    aplicarNomesConhecidosNasConversas();

    salvarArquivadas();
    salvarConversas();
    salvarMapeamentos();

    const totalArquivadas = Array.from(conversas.values()).filter(
      (conversa) => conversa.arquivada,
    ).length;

    garantirPastaArquivo(marcador);

    fs.writeFileSync(
      marcador,
      JSON.stringify(
        {
          concluidoEm: new Date().toISOString(),
          arquivadasReconhecidas: totalArquivadas,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(`V6 concluída. Arquivadas reconhecidas: ${totalArquivadas}.`);

    enviarConversas();

    enviar("status", {
      texto: "Conectado",
      tipo: "conectado",
    });
  } catch (erro) {
    console.error("Erro ao reconstruir app-state essencial:", erro);

    enviar("status", {
      texto: "Conectado",
      tipo: "conectado",
    });
  }
}

async function iniciarWhatsApp() {
  if (conectando || encerrando || resetandoSessao) return;

  limparTimerReconexao();

  conectando = true;

  try {
    enviarEtapaSincronizacao("baileys-conectando");

    prepararRessincronizacaoAppState();
    enviar("status", {
      texto: "Conectando...",
      tipo: "conectando",
    });

    const baileys = await import("@whiskeysockets/baileys");
    baileysApi = baileys;

    const makeWASocket =
      typeof baileys.default === "function"
        ? baileys.default
        : baileys.makeWASocket || baileys.default?.default;

    const { useMultiFileAuthState, DisconnectReason, Browsers } = baileys;

    if (typeof makeWASocket !== "function") {
      throw new Error("Não foi possível carregar makeWASocket.");
    }

    const { state, saveCreds } = await useMultiFileAuthState(pastaAuth());

    const minhaGeracao = ++geracaoSocket;

    // Nunca reaproveita lista de dispositivos de um socket anterior.
    cacheDispositivosEnvio.flushAll();

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: true,
      fireInitQueries: true,
      shouldSyncHistoryMessage: () => true,
      markOnlineOnConnect: false,
      emitOwnEvents: true,
      userDevicesCache: cacheDispositivosEnvio,
      appStateMacVerification: {
        patch: false,
        snapshot: false,
      },
      getMessage: obterMensagemParaRetry,
    });

    // Baileys 6.7.24 sempre adiciona "conditional" em archiveChatAction.
    // O event-buffer pode reter esse update indefinidamente quando o chat
    // correspondente não está no mesmo buffer. Para o campo archived,
    // nós já temos o estado explícito true/false vindo do app-state.
    //
    // Removemos SOMENTE a condição dos updates de arquivamento antes de
    // eles entrarem no buffer. Os demais tipos de chats.update continuam
    // intactos, preservando o comportamento normal da biblioteca.
    const emitOriginal = sock.ev.emit.bind(sock.ev);

    sock.ev.emit = (evento, dados) => {
      if (evento === "chats.update" && Array.isArray(dados)) {
        dados = dados.map((update) => {
          if (update && typeof update.archived === "boolean") {
            const copia = { ...update };

            if ("conditional" in copia) {
              delete copia.conditional;
            }

            console.log(
              `V6: arquivamento interceptado: ${copia.id} => ${copia.archived}`,
            );

            return copia;
          }

          return update;
        });
      }

      return emitOriginal(evento, dados);
    };

    await hidratarMapeamentosSignalRepository();

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      // Eventos de sockets antigos não podem disparar novas reconexões.
      if (minhaGeracao !== geracaoSocket) {
        return;
      }

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const imagem = await QRCode.toDataURL(qr);

          enviarEtapaSincronizacao("qr");
          enviar("qr", imagem);

          enviar("status", {
            texto: "Escaneie o QR Code",
            tipo: "qr",
          });
        } catch (erro) {
          console.error("Erro ao gerar QR Code:", erro);
        }
      }

      if (connection === "open") {
        limparTimerReconexao();

        baileysConectadoParaFotos = true;
        baileysConectadoEm = Date.now();

        enviarEtapaSincronizacao("baileys-conectado");

        conectando = false;
        resetandoSessao = false;
        falhas428Consecutivas = 0;
        primeiraFalha428Em = 0;

        enviar("qr", null);

        enviar("status", {
          texto: "Conectado",
          tipo: "conectado",
        });

        console.log(
          ressincronizacaoAppStateExecutada
            ? "WhatsIAPP conectado. Ressincronização de estados ativa em segundo plano."
            : "WhatsIAPP conectado.",
        );

        // A interface segue livre; este processamento acontece no worker.
        setTimeout(() => {
          sincronizarArquivadasEContatos();
        }, 1800);

        return;
      }

      if (connection !== "close") {
        return;
      }

      baileysConectadoParaFotos = false;
      baileysConectadoEm = 0;
      conectando = false;

      if (encerrando || resetandoSessao) {
        return;
      }

      const erro = lastDisconnect?.error;

      const statusBruto =
        erro?.output?.statusCode ??
        erro?.data?.statusCode ??
        erro?.statusCode ??
        erro?.status;

      const statusCode = Number(statusBruto);

      console.log(
        `Conexão fechada. Código: ${
          Number.isFinite(statusCode) ? statusCode : "desconhecido"
        }`,
      );

      const logout =
        statusCode === Number(DisconnectReason.loggedOut) || statusCode === 401;

      if (logout) {
        console.log(
          "WhatsApp removeu este aparelho. Limpando somente a autenticação e preparando novo QR.",
        );

        falhas428Consecutivas = 0;
        primeiraFalha428Em = 0;

        await recriarSessaoParaQr();
        return;
      }

      if (statusCode === 428) {
        const agora = Date.now();

        if (!primeiraFalha428Em || agora - primeiraFalha428Em > 15000) {
          primeiraFalha428Em = agora;
          falhas428Consecutivas = 1;
        } else {
          falhas428Consecutivas++;
        }

        console.log(`Falha 428 consecutiva: ${falhas428Consecutivas}.`);

        // 428 normalmente é "connectionClosed". Em uma sessão válida
        // fazemos uma reconexão normal. Porém, quando o aparelho foi
        // removido pelo celular, algumas versões do WhatsApp/Baileys
        // podem devolver 428 repetidamente em vez de 401.
        // Após 3 fechamentos rápidos seguidos, tratamos a credencial
        // registrada como inválida e recriamos a sessão para gerar QR.
        if (state?.creds?.registered && falhas428Consecutivas >= 3) {
          console.log(
            "Sessão registrada presa em 428. Recriando autenticação para gerar QR.",
          );

          falhas428Consecutivas = 0;
          primeiraFalha428Em = 0;

          await recriarSessaoParaQr();
          return;
        }

        enviar("status", {
          texto: "Reconectando...",
          tipo: "conectando",
        });

        agendarReconexao(2500);
        return;
      }

      falhas428Consecutivas = 0;
      primeiraFalha428Em = 0;

      enviar("status", {
        texto: "Reconectando...",
        tipo: "conectando",
      });

      agendarReconexao(2500);
    });

    sock.ev.on("lid-mapping.update", (dados) => {
      registrarMapeamento(dados.lid, dados.pn);
      salvarConversas();
      enviarConversas();
    });

    sock.ev.on("contacts.upsert", async (lista) => {
      let nomes = 0;

      for (const contato of lista) {
        await atualizarContato(contato);

        if (
          contato?.name ||
          contato?.notify ||
          contato?.verifiedName ||
          contato?.pushName ||
          contato?.displayName
        ) {
          nomes++;
        }
      }

      const aplicados = aplicarNomesConhecidosNasConversas();

      if (lista.length) {
        console.log(
          `Contatos recebidos: ${lista.length}, ` +
            `com nome: ${nomes}, aplicados: ${aplicados}.`,
        );
      }

      salvarConversas();
      enviarConversas();
    });

    sock.ev.on("contacts.update", async (lista) => {
      let nomes = 0;

      for (const contato of lista) {
        await atualizarContato(contato);

        if (
          contato?.name ||
          contato?.notify ||
          contato?.verifiedName ||
          contato?.pushName ||
          contato?.displayName
        ) {
          nomes++;
        }
      }

      const aplicados = aplicarNomesConhecidosNasConversas();

      if (lista.length) {
        console.log(
          `Contatos atualizados: ${lista.length}, ` +
            `com nome: ${nomes}, aplicados: ${aplicados}.`,
        );
      }

      salvarConversas();
      enviarConversas();
    });

    sock.ev.on("chats.upsert", async (lista) => {
      for (const chat of lista) {
        await atualizarChat(chat, "upsert");
      }
      salvarConversas();
      salvarArquivadas();
      enviarConversas();
    });

    sock.ev.on("chats.update", async (lista) => {
      let mudouArquivamento = false;

      for (const chat of lista) {
        if (typeof chat?.archived === "boolean") {
          mudouArquivamento = true;
        }

        await atualizarChat(chat, "update");

        if (typeof chat?.archived === "boolean") {
          const resolvido = await resolverJid(normalizarJid(chat.id));

          aplicarEstadoArquivado(resolvido, chat.archived, true);

          console.log(
            `Arquivamento atualizado: ${resolvido} => ${chat.archived}`,
          );
        }
      }

      salvarConversas();
      salvarArquivadas();

      if (mudouArquivamento) {
        const totalArquivadas = Array.from(conversas.values()).filter(
          (conversa) => conversa.arquivada,
        ).length;

        console.log(`Total de arquivadas: ${totalArquivadas}.`);
      }

      enviarConversas();
    });

    sock.ev.on("presence.update", async (dados) => {
      try {
        const idBruto = normalizarJid(dados?.id);

        if (!idBruto) {
          return;
        }

        const conversaResolvida = await resolverJid(idBruto);

        if (!conversaResolvida || ehGrupo(conversaResolvida)) {
          return;
        }

        const presencas =
          dados?.presences && typeof dados.presences === "object"
            ? Object.values(dados.presences)
            : [];

        if (!presencas.length) {
          return;
        }

        let escolhida = null;

        for (const item of presencas) {
          const normalizada = normalizarPresenca(item);

          if (!normalizada) {
            continue;
          }

          if (
            !escolhida ||
            normalizada.tipo === "digitando" ||
            normalizada.tipo === "gravando" ||
            normalizada.tipo === "online"
          ) {
            escolhida = normalizada;
          }

          if (
            normalizada.tipo === "digitando" ||
            normalizada.tipo === "gravando"
          ) {
            break;
          }
        }

        if (!escolhida) {
          return;
        }

        const aliasesEvento = new Set();

        const adicionarAliasEvento = (valor) => {
          const normalizado = normalizarJid(valor);

          if (normalizado) {
            aliasesEvento.add(normalizado);
          }
        };

        adicionarAliasEvento(idBruto);
        adicionarAliasEvento(conversaResolvida);

        if (ehPn(conversaResolvida)) {
          adicionarAliasEvento(pnParaLid.get(conversaResolvida));
        }

        if (ehLid(conversaResolvida)) {
          adicionarAliasEvento(lidParaPn.get(conversaResolvida));
        }

        let conversaEvento = conversaResolvida;

        if (presencaAssinadaAtiva?.aliases?.size) {
          const correspondeAtiva = Array.from(aliasesEvento).some((alias) =>
            presencaAssinadaAtiva.aliases.has(alias),
          );

          if (correspondeAtiva) {
            for (const alias of aliasesEvento) {
              presencaAssinadaAtiva.aliases.add(alias);
            }

            conversaEvento =
              presencaAssinadaAtiva.conversaIdPrincipal ||
              presencaAssinadaAtiva.conversaIdSolicitada ||
              conversaResolvida;
          }
        }

        const chave = normalizarJid(conversaEvento);
        const anterior = cachePresencas.get(chave);

        if (escolhida.lastSeen === null && anterior?.lastSeen) {
          escolhida.lastSeen = anterior.lastSeen;
        }

        cachePresencas.set(chave, escolhida);

        // Mantem o mesmo estado nos aliases conhecidos para uma proxima
        // abertura da conversa nao depender de nova conversao PN/LID.
        for (const alias of aliasesEvento) {
          cachePresencas.set(alias, escolhida);
        }

        enviar("presenca", {
          conversaId: chave,
          aliases: Array.from(aliasesEvento),
          ...escolhida,
        });

        if (
          presencaAssinadaAtiva &&
          (chave === presencaAssinadaAtiva.conversaIdPrincipal ||
            presencaAssinadaAtiva.aliases.has(idBruto))
        ) {
          presencaAssinadaAtiva.ultimoEventoEm = Date.now();
          limparReforcosPresencaBaileys();

          console.log(
            `[PRESENCA BAILEYS] evento ${escolhida.tipo || "lastSeen"} ` +
              `para ${chave}.`,
          );
        }
      } catch (erro) {
        console.error("Erro ao processar presença:", erro?.message || erro);
      }
    });

    sock.ev.on("messaging-history.set", processarHistorico);

    sock.ev.on("messages.upsert", async (dados) => {
      for (const mensagem of dados.messages || []) {
        if (mensagem?.key?.fromMe && mensagem?.message) {
          registrarMensagemParaRetry(mensagem);
        }

        await adicionarMensagem(mensagem, true);
      }

      salvarConversas();
      enviarConversas();
    });

    sock.ev.on("messages.update", async (updates) => {
      let mudou = false;

      for (const item of updates || []) {
        const idMensagem = item?.key?.id;
        const status = normalizarStatusEntrega(item?.update?.status);

        if (!idMensagem || !status) {
          continue;
        }

        if (
          atualizarStatusMensagemLocal(idMensagem, status, "messages.update")
        ) {
          mudou = true;
        }
      }

      if (mudou) {
        salvarConversas();
      }
    });

    sock.ev.on("message-receipt.update", async (updates) => {
      let mudou = false;

      for (const item of updates || []) {
        const idMensagem = item?.key?.id;
        const receipt = item?.receipt || item?.userReceipt || null;
        const status = statusPorReceipt(receipt);

        if (!idMensagem || !status) {
          continue;
        }

        if (
          atualizarStatusMensagemLocal(
            idMensagem,
            status,
            "message-receipt.update",
          )
        ) {
          mudou = true;
        }
      }

      if (mudou) {
        salvarConversas();
      }
    });
  } catch (erro) {
    conectando = false;
    console.error("Erro ao iniciar WhatsIAPP:", erro);
    enviar("status", {
      texto: "Erro ao conectar",
      tipo: "erro",
    });
  }
}

async function listarAutoresGrupoLocal(conversaId) {
  const idGrupo = normalizarJid(conversaId);

  if (!idGrupo || !ehGrupo(idGrupo)) {
    return [];
  }

  const conversa = conversas.get(idGrupo);

  if (!conversa) {
    return [];
  }

  const autores = [];

  for (const msg of Array.isArray(conversa.mensagens)
    ? conversa.mensagens.slice(-600)
    : []) {
    if (!msg?.idMensagem || msg.minha) {
      continue;
    }

    let participant = normalizarJid(msg.participant);
    let participantAlt = normalizarJid(msg.participantAlt);
    let participantPn = normalizarPn(msg.participantPn);

    if (!participantPn) {
      for (const candidato of [participant, participantAlt]) {
        if (!candidato) continue;

        if (ehPn(candidato)) {
          participantPn = normalizarPn(candidato);
          break;
        }

        if (ehLid(candidato)) {
          const resolvido = await resolverJid(candidato);

          if (ehPn(resolvido)) {
            participantPn = normalizarPn(resolvido);
            break;
          }
        }
      }
    }

    const aliases = new Set();

    for (const valor of [
      participant,
      participantAlt,
      participantPn,
      ...(Array.isArray(msg.participantAliases) ? msg.participantAliases : []),
    ]) {
      const jid = normalizarJid(valor);
      if (jid) aliases.add(jid);
    }

    if (participantPn) {
      const lid = normalizarJid(pnParaLid.get(participantPn));
      if (lid) aliases.add(lid);
    }

    for (const alias of Array.from(aliases)) {
      if (ehLid(alias)) {
        const pn = normalizarJid(lidParaPn.get(alias));
        if (pn) aliases.add(pn);
      }
    }

    if (!participant && !participantPn && !aliases.size) {
      continue;
    }

    autores.push({
      idMensagem: String(msg.idMensagem),
      participant: participant || participantPn || null,
      participantAlt: participantAlt || null,
      participantPn: participantPn || null,
      participantAliases: Array.from(aliases),
    });
  }

  consoleLogOriginal(
    `[GRUPO BAILEYS] authors=${autores.length} | group=${idGrupo}.`,
  );

  return autores;
}

function normalizarParticipanteStatusBaileys(valor) {
  let jid = String(valor || "").trim();

  if (!jid) {
    return null;
  }

  if (jid.endsWith("@c.us")) {
    jid = jid.replace("@c.us", "@s.whatsapp.net");
  }

  if (!jid.includes("@")) {
    const digitos = somenteDigitos(jid);

    if (digitos) {
      jid = `${digitos}@s.whatsapp.net`;
    }
  }

  return normalizarJid(jid);
}

function limparChavesStatusBaileys() {
  const agora = Date.now();
  const ttl = 30 * 60 * 60 * 1000;

  for (const [id, registro] of chavesStatusBaileys.entries()) {
    if (agora - Number(registro?.salvaEm || 0) > ttl) {
      chavesStatusBaileys.delete(id);
    }
  }

  while (chavesStatusBaileys.size > 1200) {
    const primeiro = chavesStatusBaileys.keys().next().value;
    chavesStatusBaileys.delete(primeiro);
  }
}

function registrarChaveStatusBaileys(mensagem) {
  const key = mensagem?.key;
  const remoteJid = normalizarJid(key?.remoteJid);
  const id = String(key?.id || "").trim();
  const participant = normalizarJid(key?.participant);

  if (remoteJid !== "status@broadcast" || !id || !participant || key?.fromMe) {
    return false;
  }

  const chaveOriginal = {
    remoteJid: String(key.remoteJid || "status@broadcast"),
    fromMe: !!key.fromMe,
    id: String(key.id),
    participant: String(key.participant),
  };

  chavesStatusBaileys.set(id, {
    key: chaveOriginal,
    participantAlt: normalizarJid(key?.participantAlt) || null,
    participantPn: normalizarPn(mensagem?.participantPn) || null,
    salvaEm: Date.now(),
  });

  limparChavesStatusBaileys();

  consoleLogOriginal(
    `[STATUS BAILEYS] CHAVE_CAPTURADA | id=${id} | participant=${chaveOriginal.participant}`,
  );

  return true;
}

function buscarChaveStatusBaileys(idRaw) {
  const id = String(idRaw || "").trim();

  if (!id) {
    return null;
  }

  limparChavesStatusBaileys();

  return chavesStatusBaileys.get(id) || null;
}

function extrairDadosReacaoStatusBaileys(dados = {}) {
  const idCompleto = String(dados?.idMensagem || "").trim();
  let idRaw = String(dados?.idMensagemRaw || "").trim();
  let participante = String(dados?.contatoId || "").trim();

  if (!idRaw && idCompleto) {
    const partes = idCompleto.split("_").filter(Boolean);
    const indiceBroadcast = partes.findIndex(
      (parte) => parte === "status@broadcast",
    );

    if (indiceBroadcast >= 0 && partes[indiceBroadcast + 1]) {
      idRaw = partes[indiceBroadcast + 1];
    }
  }

  if (idRaw && idCompleto) {
    const marcadorParticipante = `_${idRaw}_`;
    const indiceParticipante = idCompleto.indexOf(marcadorParticipante);

    if (indiceParticipante >= 0) {
      const candidato = idCompleto
        .slice(indiceParticipante + marcadorParticipante.length)
        .trim();

      if (candidato) {
        participante = candidato;
      }
    }
  }

  return {
    idRaw,
    participante: normalizarParticipanteStatusBaileys(participante),
  };
}

async function reagirStatusBaileys(dados = {}) {
  if (!sock || typeof sock.sendMessage !== "function") {
    throw new Error("WhatsApp ainda nao esta pronto para reagir ao Status.");
  }

  const emoji = String(dados?.emoji || "").trim();
  const { idRaw } = extrairDadosReacaoStatusBaileys(dados);

  if (!emoji) {
    throw new Error("Reacao invalida.");
  }

  if (!idRaw) {
    throw new Error("Status sem identificador valido para reacao.");
  }

  const registro = buscarChaveStatusBaileys(idRaw);
  const chaveStatus = registro?.key || null;

  if (!chaveStatus?.participant) {
    console.warn(
      `[STATUS BAILEYS] CHAVE_NAO_ENCONTRADA | id=${idRaw} | contato=${String(
        dados?.contatoId || "",
      )}`,
    );

    throw new Error(
      "Nao encontrei a chave original deste Status no Baileys. " +
        "Atualize os Status ou teste uma publicacao recebida depois de abrir o WhatsIAPP.",
    );
  }

  console.log(
    `[STATUS BAILEYS] REACAO_INICIO | id=${idRaw} | ` +
      `participant=${chaveStatus.participant} | emoji=${emoji} | key=original`,
  );

  const enviada = await comTimeout(
    sock.sendMessage(
      chaveStatus.remoteJid,
      {
        react: {
          text: emoji,
          key: { ...chaveStatus },
        },
      },
      {
        statusJidList: [chaveStatus.participant],
      },
    ),
    20000,
    "O WhatsApp demorou demais para reagir ao Status.",
  );

  if (!enviada?.key?.id) {
    throw new Error("O WhatsApp nao confirmou o envio da reacao ao Status.");
  }

  console.log(
    `[STATUS BAILEYS] REACAO_ENVIADA | alvo=${idRaw} | ` +
      `confirmacao=${enviada.key.id} | key=original`,
  );

  return {
    ok: true,
    idMensagem: String(dados?.idMensagem || idRaw),
    idMensagemRaw: idRaw,
    participante: chaveStatus.participant,
    emoji,
    via: "baileys-chave-original",
  };
}

function importarHistoricoNormalizadoWpp(dados = {}) {
  const lista = Array.isArray(dados?.mensagens) ? dados.mensagens : [];

  let importadas = 0;
  let atualizadas = 0;
  let duplicadas = 0;
  let ignoradas = 0;
  const conversasAlteradas = new Set();

  for (const recebida of lista) {
    const id = idCanonicoConversaLocal(
      recebida?.id || recebida?.conversaId,
    );
    const idMensagem = String(recebida?.idMensagem || "").trim();

    if (
      !id ||
      !idMensagem ||
      id === "status@broadcast" ||
      id.endsWith("@broadcast") ||
      id.endsWith("@newsletter")
    ) {
      ignoradas++;
      continue;
    }

    const conversa = obterConversa(id);

    if (
      recebida?.nome &&
      pareceNomeUtil(recebida.nome, id) &&
      !pareceNomeUtil(conversa.nome, id)
    ) {
      conversa.nome = String(recebida.nome).trim();
    }

    const existente = conversa.mensagens.find(
      (msg) => String(msg?.idMensagem || "") === idMensagem,
    );

    if (existente) {
      let mudou = false;

      const preencher = (campo, valor) => {
        if (
          (existente[campo] === null ||
            existente[campo] === undefined ||
            existente[campo] === "") &&
          valor !== null &&
          valor !== undefined &&
          valor !== ""
        ) {
          existente[campo] = valor;
          mudou = true;
        }
      };

      preencher("idMensagemWpp", recebida.idMensagemWpp);
      preencher("resposta", recebida.resposta);
      preencher("mime", recebida.mime);
      preencher("fileName", recebida.fileName);
      preencher("viewOnceKind", recebida.viewOnceKind);
      preencher("participant", recebida.participant);
      preencher("remoteJid", recebida.remoteJid);

      if (
        recebida.statusEntrega &&
        existente.minha &&
        recebida.statusEntrega !== existente.statusEntrega
      ) {
        existente.statusEntrega = recebida.statusEntrega;
        mudou = true;
      }

      if (mudou) {
        atualizadas++;
        conversasAlteradas.add(id);
      } else {
        duplicadas++;
      }

      continue;
    }

    const timestamp = numeroTimestamp(recebida?.timestamp);

    conversa.mensagens.push({
      idMensagem,
      idMensagemWpp: recebida?.idMensagemWpp || null,
      texto: String(recebida?.texto || ""),
      tipo: String(recebida?.tipo || "texto"),
      mime: recebida?.mime || null,
      fileName: recebida?.fileName || null,
      viewOnceKind: recebida?.viewOnceKind || null,
      horario:
        String(recebida?.horario || "").trim() || formatarHorario(timestamp),
      timestamp,
      minha: !!recebida?.minha,
      remoteJid: normalizarJid(recebida?.remoteJid) || id,
      participant: normalizarJid(recebida?.participant) || null,
      lidaPorMim: !!recebida?.lidaPorMim,
      statusEntrega: recebida?.minha
        ? recebida?.statusEntrega || "enviada"
        : null,
      resposta: recebida?.resposta || null,
      mediaPath: null,
      mediaUrl: null,
      rawBase64: null,
    });

    conversa.mensagens.sort(
      (a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0),
    );
    conversa.mensagens = conversa.mensagens.slice(-600);
    conversa.timestamp = Math.max(
      Number(conversa.timestamp || 0) || 0,
      timestamp,
    );

    importadas++;
    conversasAlteradas.add(id);
  }

  if (importadas || atualizadas) {
    salvarConversas();
    enviarConversas();
  }

  console.log(
    `[HISTORICO GAP] IMPORTACAO_BAILEYS | recebidas=${lista.length} | ` +
      `importadas=${importadas} | atualizadas=${atualizadas} | ` +
      `duplicadas=${duplicadas} | ignoradas=${ignoradas} | ` +
      `conversas=${conversasAlteradas.size}`,
  );

  return {
    ok: true,
    recebidas: lista.length,
    importadas,
    atualizadas,
    duplicadas,
    ignoradas,
    conversasAlteradas: conversasAlteradas.size,
  };
}

async function responderSolicitacao(id, acao, dados) {
  try {
    if (acao === "importar-historico-wpp") {
      const resultado = importarHistoricoNormalizadoWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "reagir-status") {
      const resultado = await reagirStatusBaileys(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "listar-contatos-salvos") {
      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          contatos: listarContatosSalvos(),
        },
      });

      return;
    }

    if (acao === "listar-grupos") {
      const resultado = await listarGruposAtuaisBaileys();

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          disponivel: resultado.disponivel !== false,
          grupos: Array.isArray(resultado.grupos) ? resultado.grupos : [],
        },
      });

      return;
    }

    if (acao === "listar-grupos-em-comum") {
      const resultado = await listarGruposEmComumBaileys(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          disponivel: resultado.disponivel !== false,
          grupos: Array.isArray(resultado.grupos) ? resultado.grupos : [],
        },
      });

      return;
    }

    if (acao === "listar-autores-grupo") {
      const autoresMensagens = await listarAutoresGrupoLocal(dados?.conversaId);

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          autoresMensagens,
        },
      });

      return;
    }

    if (acao === "marcar-conversa-lida") {
      const resultado = await marcarConversaComoLida(
        dados.conversaId,
        dados.idsMensagem || [],
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "assinar-presenca") {
      const resultado = await assinarPresenca(dados.conversaId);

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "enviar-anexo") {
      const resultado = await enviarAnexo(
        dados.conversaId,
        dados.caminho,
        dados.tipo,
        dados.legenda,
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "enviar-audio-gravado") {
      const resultado = await enviarAudioGravado(
        dados.conversaId,
        dados.bytes,
        dados.mime,
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "consultar-bloqueio") {
      const resultado = await consultarBloqueioContato(dados.conversaId);

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "alterar-bloqueio") {
      const resultado = await alterarBloqueioContato(
        dados.conversaId,
        !!dados.bloquear,
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "carregar-foto-perfil") {
      const resultado = await obterFotoPerfil(dados.conversaId);

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "carregar-minha-foto") {
      const resultado = await obterMinhaFotoPerfil();

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "enviar-texto") {
      const resultado = await enviarMensagemTexto(
        dados.conversaId,
        dados.texto,
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "registrar-midia-recuperada") {
      const resultado = registrarMidiaRecuperadaLocal(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "carregar-midia") {
      try {
        const resultado = await baixarMidiaDaMensagem(
          dados.conversaId,
          dados.idMensagem,
        );

        parentPort.postMessage({
          tipo: "resposta",
          id,
          resultado: {
            ok: true,
            ...resultado,
          },
        });
      } catch (erro) {
        const metadados = metadadosMensagemMidiaLocal(
          dados?.conversaId,
          dados?.idMensagem,
        );

        parentPort.postMessage({
          tipo: "resposta",
          id,
          resultado: {
            ok: false,
            erro: erro?.message || "Nao foi possivel carregar a midia.",
            ...metadados,
          },
        });
      }

      return;
    }

    parentPort.postMessage({
      tipo: "resposta",
      id,
      resultado: {
        ok: false,
        erro: `Ação desconhecida: ${acao}`,
      },
    });
  } catch (erro) {
    parentPort.postMessage({
      tipo: "resposta",
      id,
      resultado: {
        ok: false,
        erro: erro?.message || "Erro no serviço do WhatsApp.",
      },
    });
  }
}

async function encerrarWorker() {
  encerrando = true;
  limparTimerReconexao();

  salvarConversas();
  salvarMapeamentos();
  salvarArquivadas();

  clearTimeout(timerSalvarCacheRetry);
  clearTimeout(timerResumoFotosPerfil);

  try {
    podarCacheMensagensRetry();
    garantirPastaArquivo(arquivoCacheMensagensRetry());

    fs.writeFileSync(
      arquivoCacheMensagensRetry(),
      JSON.stringify(Array.from(cacheMensagensRetry.values()), null, 2),
      "utf8",
    );
  } catch {}

  try {
    sock?.end?.();
  } catch {}

  setTimeout(() => process.exit(0), 150);
}

parentPort.on("message", (mensagem) => {
  if (!mensagem) return;

  if (mensagem.tipo === "solicitacao") {
    responderSolicitacao(mensagem.id, mensagem.acao, mensagem.dados || {});
    return;
  }

  if (mensagem.tipo === "encerrar") {
    encerrarWorker();
  }
});

async function iniciarServico() {
  // Ordem importante: o estado de arquivamento precisa existir
  // antes de reconstruirmos as conversas do cache.
  carregarMapeamentos();
  carregarArquivadas();
  carregarConversasLocais();
  carregarCacheMensagensRetry();

  enviarConversas();

  console.log(
    `Inicialização em background: ${conversas.size} conversas locais, ` +
      `${estadoArquivadas.size} estados de arquivamento.`,
  );

  await iniciarWhatsApp();
}

iniciarServico().catch((erro) => {
  console.error("Falha ao iniciar serviço WhatsIAPP:", erro);

  enviar("status", {
    texto: "Erro ao iniciar serviço",
    tipo: "erro",
  });
});
