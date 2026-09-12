const protegerStdio = require("./scripts/proteger-stdio");
protegerStdio(process.stdout);
protegerStdio(process.stderr);

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  session,
  Notification,
  nativeImage,
  safeStorage,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { Worker } = require("worker_threads");
const { AsyncLocalStorage } = require("async_hooks");
const path = require("path");
const { pathToFileURL } = require("url");
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const pdfParse = require("pdf-parse");

// Mantem o audio de notificacao liberado mesmo quando a janela esta minimizada/tray.
// Precisa ser definido antes do app ficar pronto.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let janela = null;
let whatsappWorker = null;
let archiveWorker = null;
let encerrando = false;
let encerramentoAppIniciado = false;
let encerramentoAppConcluido = false;
let sequenciaSolicitacao = 0;
let telaPronta = false;
const qrsPendentes = { baileys: null, wpp: null };
let qrOrigemAtiva = null;

function atualizarQrConexao(origem, imagem) {
  qrsPendentes[origem] = imagem || null;

  if (imagem) {
    // O QR mais recente é o que precisa estar visível. Isso evita que o QR
    // do Baileys esconda o segundo QR do WPPConnect durante a autenticação.
    qrOrigemAtiva = origem;
  } else if (qrOrigemAtiva === origem) {
    qrOrigemAtiva = qrsPendentes.baileys
      ? "baileys"
      : qrsPendentes.wpp
        ? "wpp"
        : null;
  }

  const qrAtual = qrOrigemAtiva
    ? qrsPendentes[qrOrigemAtiva]
    : qrsPendentes.baileys || qrsPendentes.wpp;

  enviarParaTela("qr", qrAtual);
}
const eventosTelaPendentes = [];

let conversasBase = [];
let conversasBaseHistoricoInicial = null;
const estadoArquivamento = new Map();
const estadoTrancamento = new Map();
const estadoAliasesPrivacidade = new Map();

// Contagem autoritativa de nao lidas vinda do proprio WhatsApp Web.
// A revisao so muda quando o total real daquele chat muda.
const estadoNaoLidasWpp = new Map();
const geracaoEstadoNaoLidasWpp = `${Date.now()}-${Math.random()
  .toString(16)
  .slice(2)}`;
let sequenciaEstadoNaoLidasWpp = 0;

let estadoPrivacidadePronto = false;
let estadoPrivacidadeCompleto = false;
const estadoPrivacidadeConhecido = new Set();
const mensagensPendentesPrivacidade = [];
let cachePrivacidadeCarregado = false;
let timerFallbackPrivacidadeInicial = null;
let fallbackPrivacidadeInicialAtivado = false;

let wppRecepcaoAoVivoPronta = false;
let wppFullReady = false;
let baileysProntoInicial = false;
let fotosPrincipaisProntas = false;
let fullReadyInicialLiberado = false;
let dadosFullReadyInicialPendente = null;
let ultimaEtapaSincronizacaoInicial = null;
let atualizadorConfigurado = false;

let historicoGapWppExecutado = false;
let historicoGapWppEmAndamento = false;
let timerHistoricoGapWpp = null;

// Presenca: Baileys e a fonte primaria por ser disponibilizada mais cedo.
// O WPPConnect fica assinado em segundo plano e so assume quando o Baileys
// nao entregar atualizacoes recentes para a conversa ativa.
let sequenciaAssinaturaPresenca = 0;
let presencaAtiva = null;
let timerAssinaturaFallbackWpp = null;
let timerCronometroPresenca = null;
const JANELA_PRIORIDADE_PRESENCA_BAILEYS_MS = 15000;

function formatarTempoPresenca(ms) {
  return `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(3)}s`;
}

function limparCronometroPresenca() {
  if (timerCronometroPresenca) {
    clearInterval(timerCronometroPresenca);
    timerCronometroPresenca = null;
  }
}

function iniciarCronometroPresenca(tokenAssinatura) {
  limparCronometroPresenca();

  if (!presencaAtiva || presencaAtiva.token !== tokenAssinatura) {
    return;
  }

  const inicio = presencaAtiva.cronometroIniciadoEm || Date.now();

  console.log(
    `[PRESENCA TIMER] 0.000s | aguardando primeira presenca real para ` +
      `${presencaAtiva.conversaIdOriginal}.`,
  );

  timerCronometroPresenca = setInterval(() => {
    if (
      !presencaAtiva ||
      presencaAtiva.token !== tokenAssinatura ||
      presencaAtiva.primeiroEventoRealEm
    ) {
      limparCronometroPresenca();
      return;
    }

    console.log(
      `[PRESENCA TIMER] ${formatarTempoPresenca(Date.now() - inicio)} | ` +
        `ainda aguardando presenca real para ${presencaAtiva.conversaIdOriginal}.`,
    );
  }, 5000);
}

function registrarTempoPresencaReal(fonte, dados = {}) {
  if (!presencaAtiva?.cronometroIniciadoEm) {
    return;
  }

  const agora = Date.now();
  const campoFonte =
    fonte === "baileys" ? "primeiroEventoBaileysEm" : "primeiroEventoWppEm";
  const tipo = String(dados?.tipo || "desconhecido");
  const decorrido = agora - presencaAtiva.cronometroIniciadoEm;

  if (!presencaAtiva[campoFonte]) {
    presencaAtiva[campoFonte] = agora;
    console.log(
      `[PRESENCA TIMER] ${formatarTempoPresenca(decorrido)} | ` +
        `primeiro evento ${fonte.toUpperCase()} | tipo=${tipo} | ` +
        `contato=${presencaAtiva.conversaIdOriginal}.`,
    );
  }

  if (!presencaAtiva.primeiroEventoRealEm) {
    presencaAtiva.primeiroEventoRealEm = agora;
    limparCronometroPresenca();

    console.log(
      `[PRESENCA TIMER] PRIMEIRA PRESENCA REAL EM ${formatarTempoPresenca(decorrido)} ` +
        `| fonte=${fonte} | tipo=${tipo} | contato=${presencaAtiva.conversaIdOriginal}.`,
    );
  }
}

function limparFallbackPresencaWpp() {
  if (timerAssinaturaFallbackWpp) {
    clearTimeout(timerAssinaturaFallbackWpp);
    timerAssinaturaFallbackWpp = null;
  }
}

function chavePresenca(valor) {
  return chaveCanonica(valor);
}

function mapearEventoPresencaParaConversaAtiva(dados) {
  if (!presencaAtiva?.conversaIdOriginal) {
    return null;
  }

  const chavesEvento = new Set();

  const adicionarChaveEvento = (valor) => {
    const chave = chavePresenca(valor);

    if (chave) {
      chavesEvento.add(chave);
    }
  };

  adicionarChaveEvento(dados?.conversaId);

  for (const alias of Array.isArray(dados?.aliases) ? dados.aliases : []) {
    adicionarChaveEvento(alias);
  }

  if (!chavesEvento.size) {
    return null;
  }

  const correspondeAtiva = Array.from(chavesEvento).some((chave) =>
    presencaAtiva.chavesAceitas.has(chave),
  );

  if (!correspondeAtiva) {
    return null;
  }

  for (const chave of chavesEvento) {
    presencaAtiva.chavesAceitas.add(chave);
  }

  return {
    ...(dados || {}),
    conversaId: presencaAtiva.conversaIdOriginal,
  };
}

function agendarAssinaturaFallbackWpp(tokenAssinatura, dadosOriginais) {
  limparFallbackPresencaWpp();

  timerAssinaturaFallbackWpp = setTimeout(async () => {
    timerAssinaturaFallbackWpp = null;

    if (
      !presencaAtiva ||
      presencaAtiva.token !== tokenAssinatura ||
      encerrando
    ) {
      return;
    }

    try {
      const resultado = await solicitarAoWorker(
        "wpp",
        "assinar-presenca",
        dadosOriginais,
        5000,
      );

      if (!presencaAtiva || presencaAtiva.token !== tokenAssinatura) {
        return;
      }

      const idRetornado = resultado?.conversaId;

      if (idRetornado) {
        const chave = chavePresenca(idRetornado);

        if (chave) {
          presencaAtiva.chavesAceitas.add(chave);
        }
      }

      console.log(
        `[PRESENCA] fallback WPPConnect preparado para ` +
          `${presencaAtiva.conversaIdOriginal} ` +
          `(disponivel=${!!resultado?.disponivel}, pendente=${!!resultado?.pendente}).`,
      );
    } catch (erro) {
      console.warn(
        `[PRESENCA] fallback WPPConnect indisponivel: ` +
          `${erro?.message || erro || "erro desconhecido"}.`,
      );
    }
  }, 3000);
}

// =========================================================
// TESTE DE INTEGRIDADE DA IA - AREA ADMINISTRATIVA
// Sessao temporaria. Nunca envia mensagens ao contato real.
// =========================================================

let testeIntegridadeIAAtivo = null;

const consoleTesteIAOriginal = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function textoLogTesteIntegridadeIA(args = []) {
  return args
    .map((valor) => {
      if (typeof valor === "string") {
        return valor;
      }

      try {
        return JSON.stringify(valor);
      } catch {
        return String(valor);
      }
    })
    .join(" ");
}

function capturarLogTesteIntegridadeIA(nivel, args = []) {
  const atual = testeIntegridadeIAAtivo?.etapaAtual;

  if (!atual || atual.finalizada) {
    return;
  }

  const prefixo =
    nivel === "warn" ? "[WARN] " : nivel === "error" ? "[ERROR] " : "";

  atual.logs.push(`${prefixo}${textoLogTesteIntegridadeIA(args)}`);
}

console.log = (...args) => {
  capturarLogTesteIntegridadeIA("log", args);
  consoleTesteIAOriginal.log(...args);
};

console.warn = (...args) => {
  capturarLogTesteIntegridadeIA("warn", args);
  consoleTesteIAOriginal.warn(...args);
};

console.error = (...args) => {
  capturarLogTesteIntegridadeIA("error", args);
  consoleTesteIAOriginal.error(...args);
};

function normalizarTextoTesteIntegridadeIA(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function nomeArquivoTesteIntegridadeIA() {
  const agora = new Date();
  const pad = (valor) => String(valor).padStart(2, "0");

  return [
    String(agora.getFullYear()),
    pad(agora.getMonth() + 1),
    pad(agora.getDate()),
    "-",
    pad(agora.getHours()),
    pad(agora.getMinutes()),
    pad(agora.getSeconds()),
  ].join("");
}

function limparTesteIntegridadeIAAtivo() {
  testeIntegridadeIAAtivo = null;
}

function validarTesteIntegridadeIAAdmin(token) {
  const admin = exigirSessaoAdmin(token);

  if (!admin.ok) {
    return admin;
  }

  return {
    ok: true,
    sessao: admin.sessao,
  };
}

let diagnosticoInicioInicializacao = null;
let diagnosticoInicializacaoConcluido = false;
const diagnosticoMarcosInicializacao = [];
const diagnosticoMarcosVistos = new Set();

function tempoMonotonicoMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function iniciarDiagnosticoInicializacao() {
  diagnosticoInicioInicializacao = tempoMonotonicoMs();
  diagnosticoInicializacaoConcluido = false;
  diagnosticoMarcosInicializacao.length = 0;
  diagnosticoMarcosVistos.clear();

  registrarMarcoInicializacao("app", "inicio");
}

function registrarMarcoInicializacao(origem, etapa, detalhe = null) {
  if (
    diagnosticoInicializacaoConcluido ||
    diagnosticoInicioInicializacao === null
  ) {
    return;
  }

  const origemNormalizada = String(origem || "app").trim() || "app";
  const etapaNormalizada = String(etapa || "").trim();

  if (!etapaNormalizada) {
    return;
  }

  const detalheNormalizado =
    detalhe === null || detalhe === undefined ? "" : String(detalhe).trim();

  const chave = `${origemNormalizada}|${etapaNormalizada}|${detalheNormalizado}`;

  if (diagnosticoMarcosVistos.has(chave)) {
    return;
  }

  diagnosticoMarcosVistos.add(chave);

  diagnosticoMarcosInicializacao.push({
    origem: origemNormalizada,
    etapa: etapaNormalizada,
    detalhe: detalheNormalizado || null,
    emMs: tempoMonotonicoMs() - diagnosticoInicioInicializacao,
  });
}

function formatarTempoDiagnostico(ms) {
  return `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(3)}s`;
}

function imprimirResumoDiagnosticoInicializacao() {
  if (
    diagnosticoInicializacaoConcluido ||
    diagnosticoInicioInicializacao === null
  ) {
    return;
  }

  diagnosticoInicializacaoConcluido = true;

  const totalMs = tempoMonotonicoMs() - diagnosticoInicioInicializacao;

  const linhas = [];
  let anteriorMs = 0;

  linhas.push("");
  linhas.push("============================================================");
  linhas.push("WHATSIAPP - DIAGNOSTICO DE INICIALIZACAO");
  linhas.push(`TOTAL: ${formatarTempoDiagnostico(totalMs)}`);
  linhas.push("------------------------------------------------------------");

  diagnosticoMarcosInicializacao.forEach((marco, indice) => {
    const deltaMs = indice === 0 ? marco.emMs : marco.emMs - anteriorMs;

    const origem = String(marco.origem || "app").toUpperCase();
    const detalhe = marco.detalhe ? ` | ${marco.detalhe}` : "";

    linhas.push(
      `${String(indice + 1).padStart(2, "0")}. ` +
        `${formatarTempoDiagnostico(marco.emMs).padStart(8, " ")} ` +
        `(+${formatarTempoDiagnostico(deltaMs)}) ` +
        `[${origem}] ${marco.etapa}${detalhe}`,
    );

    anteriorMs = marco.emMs;
  });

  linhas.push("------------------------------------------------------------");
  linhas.push(
    `FULL_READY: ${formatarTempoDiagnostico(totalMs)} apos o inicio.`,
  );
  linhas.push("============================================================");
  linhas.push("");

  console.log(linhas.join("\n"));
}

const mensagensRecentesTempoReal = new Map();
const mensagensBaileysAguardandoWpp = new Map();
const sonsMensagemImediatosRecentes = new Map();

// Mensagens que ja existiam antes desta execucao pertencem ao catch-up da
// sincronizacao inicial. Elas devem atualizar o historico pelos snapshots,
// mas nunca podem ser tratadas como notificacoes novas da sessao atual.
const inicioSessaoMensagensSegundos = Math.floor(Date.now() / 1000);
let sincronizacaoMensagensSilenciosaAtiva = true;
let totalMensagensSincronizacaoSilenciosa = 0;
let timerResumoSincronizacaoSilenciosa = null;

function timestampMensagemEmSegundos(dados = {}) {
  let valor = Number(dados?.timestamp || 0);

  if (!Number.isFinite(valor) || valor <= 0) {
    return 0;
  }

  if (valor > 1000000000000) {
    valor = Math.floor(valor / 1000);
  }

  return Math.floor(valor);
}

function mensagemEhCatchupDaInicializacao(dados = {}) {
  if (!sincronizacaoMensagensSilenciosaAtiva) {
    return false;
  }

  const timestamp = timestampMensagemEmSegundos(dados);

  // Sem timestamp confiavel, nao bloqueamos. E mais seguro tratar como vivo
  // do que correr o risco de esconder uma mensagem realmente nova.
  if (!timestamp) {
    return false;
  }

  return timestamp < inicioSessaoMensagensSegundos;
}

function registrarCatchupSilencioso(dados = {}, origem = "desconhecida") {
  totalMensagensSincronizacaoSilenciosa += 1;

  clearTimeout(timerResumoSincronizacaoSilenciosa);

  timerResumoSincronizacaoSilenciosa = setTimeout(() => {
    console.log(
      `[SYNC MENSAGENS] CATCHUP_SILENCIOSO | total=${totalMensagensSincronizacaoSilenciosa} | ` +
        `ultima_origem=${origem} | ultimo_id=${idMensagemTempoReal(dados) || "sem-id"}`,
    );
  }, 500);
}

function finalizarSincronizacaoMensagensSilenciosa(origem = "fluxo") {
  if (!sincronizacaoMensagensSilenciosaAtiva) {
    return;
  }

  sincronizacaoMensagensSilenciosaAtiva = false;
  clearTimeout(timerResumoSincronizacaoSilenciosa);
  timerResumoSincronizacaoSilenciosa = null;

  console.log(
    `[SYNC MENSAGENS] MODO_AO_VIVO | origem=${origem} | ` +
      `catchup_silencioso=${totalMensagensSincronizacaoSilenciosa}`,
  );
}

// Fail-safe: mesmo se o WPP nao concluir o HISTORICO GAP, a protecao de
// inicializacao nao fica ativa indefinidamente. Mensagens realmente novas
// continuam notificando durante esse periodo porque possuem timestamp posterior
// ao inicio desta sessao.
setTimeout(() => {
  finalizarSincronizacaoMensagensSilenciosa("timeout-120s");
}, 120000);

const solicitacoesPendentes = new Map();
const notificacoesAtivas = new Set();
const fotosNotificacaoContato = new Map();
const carregamentosFotoNotificacaoContato = new Map();
const indiceFotosPerfilPersistentes = new Map();
let cacheFotosPerfilPersistentesCarregado = false;
let timerSalvarIndiceFotosPerfilPersistente = null;
let indiceFotosPerfilPersistenteSujo = false;
let fotosPerfilCacheadasDesdeUltimoLog = 0;
let timerLogFotosPerfilCacheadas = null;

const APP_USER_MODEL_ID = "com.whatsiapp.desktop";

// Contexto por chamada da Groq. Permite separar uso real do cliente de
// ferramentas administrativas sem misturar requisicoes concorrentes.
const contextoCobrancaGroq = new AsyncLocalStorage();

function ehConversaTesteIntegridadeIAId(valor) {
  return /^teste-integridade-\d+@/i.test(String(valor || "").trim());
}

function contextoCobrancaGroqAtual() {
  const contexto = contextoCobrancaGroq.getStore();

  return {
    faturavel: contexto?.faturavel !== false,
    origem: String(contexto?.origem || "cliente").trim() || "cliente",
    canalApi: contexto?.canalApi === "teste" ? "teste" : "motor",
  };
}

function executarComContextoCobrancaGroq(dados, origem, callback) {
  const conversaId = String(dados?.conversaId || "").trim();
  const faturavel = !ehConversaTesteIntegridadeIAId(conversaId);

  return contextoCobrancaGroq.run(
    {
      faturavel,
      origem: faturavel ? String(origem || "cliente") : "teste-integridade",
      canalApi: faturavel ? "motor" : "teste",
    },
    callback,
  );
}

function executarGroqNaoFaturavel(origem, callback, canalApi = "motor") {
  return contextoCobrancaGroq.run(
    {
      faturavel: false,
      origem: String(origem || "administracao").trim() || "administracao",
      canalApi: canalApi === "teste" ? "teste" : "motor",
    },
    callback,
  );
}

function caminhoLogoPng() {
  return path.join(__dirname, "assets", "logo-macos.png");
}

function caminhoLogoIco() {
  return path.join(__dirname, "assets", "logo-taskbar.ico");
}

function configurarIconeMacOS() {
  if (process.platform !== "darwin" || !app.dock?.setIcon) {
    return;
  }

  const caminho = caminhoLogoPng();

  try {
    const imagem = nativeImage.createFromPath(caminho);

    if (imagem.isEmpty()) {
      console.warn("Dock icon setup skipped: logo-macos.png is empty.");
      return;
    }

    app.dock.setIcon(imagem);
    console.log("Dock icon configured: WhatsIAPP logo.");
  } catch (erro) {
    console.warn("Dock icon setup failed:", erro?.message || erro);
  }
}

function garantirIconeWindows() {
  if (process.platform !== "win32") {
    return caminhoLogoPng();
  }

  const origem = caminhoLogoPng();
  const destino = caminhoLogoIco();

  try {
    if (fs.existsSync(destino) && fs.statSync(destino).size > 100) {
      return destino;
    }

    const imagem = nativeImage.createFromPath(origem);

    if (imagem.isEmpty()) {
      return origem;
    }

    const png = imagem
      .resize({
        width: 256,
        height: 256,
        quality: "best",
      })
      .toPNG();

    const cabecalho = Buffer.alloc(22);

    cabecalho.writeUInt16LE(0, 0);
    cabecalho.writeUInt16LE(1, 2);
    cabecalho.writeUInt16LE(1, 4);

    cabecalho.writeUInt8(0, 6);
    cabecalho.writeUInt8(0, 7);
    cabecalho.writeUInt8(0, 8);
    cabecalho.writeUInt8(0, 9);

    cabecalho.writeUInt16LE(1, 10);
    cabecalho.writeUInt16LE(32, 12);
    cabecalho.writeUInt32LE(png.length, 14);
    cabecalho.writeUInt32LE(22, 18);

    fs.writeFileSync(destino, Buffer.concat([cabecalho, png]));

    return destino;
  } catch (erro) {
    console.warn("Windows icon setup failed:", erro?.message || erro);

    return origem;
  }
}

function configurarNotificacoesWindowsDev() {
  if (process.platform !== "win32") {
    return;
  }

  const appId = APP_USER_MODEL_ID;
  const icone = garantirIconeWindows();

  try {
    app.setName("WhatsIAPP");
    app.setAppUserModelId(appId);
  } catch (erro) {
    console.warn("AppUserModelId setup failed:", erro?.message || erro);
  }

  if (app.isPackaged) {
    return;
  }

  try {
    const pastaAtalhos = path.join(
      app.getPath("appData"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
    );

    fs.mkdirSync(pastaAtalhos, {
      recursive: true,
    });

    const atalhosAntigos = ["WhatsIAPP Dev.lnk", "WhatsIAPP Electron.lnk"];

    for (const nomeAtalho of atalhosAntigos) {
      try {
        const antigo = path.join(pastaAtalhos, nomeAtalho);

        if (fs.existsSync(antigo)) {
          fs.unlinkSync(antigo);
        }
      } catch {}
    }

    const caminhoAtalho = path.join(pastaAtalhos, "WhatsIAPP.lnk");

    const detalhes = {
      target: process.execPath,
      args: `"${app.getAppPath()}"`,
      cwd: app.getAppPath(),
      description: "WhatsIAPP",
      icon: icone,
      iconIndex: 0,
      appUserModelId: appId,
    };

    const operacao = fs.existsSync(caminhoAtalho) ? "replace" : "create";

    const ok = shell.writeShortcutLink(caminhoAtalho, operacao, detalhes);

    if (!ok) {
      console.warn("Start Menu shortcut setup failed.");
    }
  } catch (erro) {
    console.warn("Start Menu shortcut setup failed:", erro?.message || erro);
  }
}

function enviarParaTela(evento, dados) {
  if (!janela || janela.isDestroyed()) {
    return;
  }

  if (!telaPronta) {
    eventosTelaPendentes.push({
      evento,
      dados,
    });

    if (eventosTelaPendentes.length > 500) {
      eventosTelaPendentes.shift();
    }

    return;
  }

  janela.webContents.send(evento, dados);
}

function liberarEventosTelaPendentes() {
  if (!janela || janela.isDestroyed()) {
    return;
  }

  telaPronta = true;

  while (eventosTelaPendentes.length) {
    const item = eventosTelaPendentes.shift();
    janela.webContents.send(item.evento, item.dados);
  }
}

function arquivoCachePrivacidade() {
  return path.join(
    app.getPath("userData"),
    "privacidade-conversas-cache-v2.json",
  );
}

function salvarCachePrivacidade() {
  try {
    const itens = [];

    for (const chave of estadoPrivacidadeConhecido) {
      itens.push({
        chave,
        arquivada: !!estadoArquivamento.get(chave),
        trancada: !!estadoTrancamento.get(chave),
      });
    }

    fs.writeFileSync(
      arquivoCachePrivacidade(),
      JSON.stringify(
        {
          atualizadoEm: Date.now(),
          itens,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (erro) {
    console.warn("Privacy cache save failed:", erro?.message || erro);
  }
}

function carregarCachePrivacidade() {
  try {
    const arquivo = arquivoCachePrivacidade();

    if (!fs.existsSync(arquivo)) {
      return false;
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    const itens = Array.isArray(dados?.itens) ? dados.itens : [];

    if (!itens.length) {
      return false;
    }

    estadoArquivamento.clear();
    estadoTrancamento.clear();
    estadoPrivacidadeConhecido.clear();

    for (const item of itens) {
      const chave = String(item?.chave || "").trim();

      if (!chave) {
        continue;
      }

      estadoArquivamento.set(chave, !!item.arquivada);
      estadoTrancamento.set(chave, !!item.trancada);
      estadoPrivacidadeConhecido.add(chave);
    }

    cachePrivacidadeCarregado = true;
    // O cache serve apenas como aquecimento. Nunca o usamos para liberar a
    // interface: arquivadas/trancadas precisam vir do snapshot atual do WPP.
    estadoPrivacidadePronto = false;
    estadoPrivacidadeCompleto = false;

    console.log(
      `Privacy cache loaded: ${estadoPrivacidadeConhecido.size} aliases.`,
    );

    return estadoPrivacidadePronto;
  } catch (erro) {
    console.warn("Privacy cache load failed:", erro?.message || erro);

    return false;
  }
}

function ativarFallbackPrivacidadeInicial() {
  if (
    fallbackPrivacidadeInicialAtivado ||
    encerrando ||
    !cachePrivacidadeCarregado ||
    estadoPrivacidadeConhecido.size === 0 ||
    estadoPrivacidadeCompleto
  ) {
    return false;
  }

  fallbackPrivacidadeInicialAtivado = true;
  estadoPrivacidadePronto = true;
  estadoPrivacidadeCompleto = true;

  console.warn(
    "[READY FALLBACK] WPPConnect ainda sem chats; liberando com o cache de privacidade e mantendo a sincronizacao em segundo plano.",
  );

  enviarParaTela("status", {
    texto: "Conectado — sincronização do WPPConnect em segundo plano",
    tipo: "conectado",
  });

  enviarConversasMescladas();
  liberarMensagensPendentesPrivacidade();
  tentarLiberarFullReadyInicial();

  return true;
}

function agendarFallbackPrivacidadeInicial() {
  clearTimeout(timerFallbackPrivacidadeInicial);

  timerFallbackPrivacidadeInicial = setTimeout(() => {
    timerFallbackPrivacidadeInicial = null;
    ativarFallbackPrivacidadeInicial();
  }, 15000);
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

function chaveCanonica(valor) {
  let id = serializarId(valor);

  if (!id) return null;

  id = String(id)
    .trim()
    .toLowerCase()
    .replace(/:\d+(?=@)/, "");

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

function aplicarEstadoArquivamento(lista) {
  return (lista || [])
    .filter((conversa) => {
      const chave = chaveCanonica(conversa.id);

      // O WPPConnect e a autoridade da lista de chats existentes.
      // Mesmo depois da sincronizacao completa, um chat do historico
      // do Baileys so aparece se estiver presente no catalogo real do WPP.
      return !!chave && estadoPrivacidadeConhecido.has(chave);
    })
    .map((conversa) => {
      const chave = chaveCanonica(conversa.id);
      const estadoNaoLidas =
        chave && estadoNaoLidasWpp.has(chave)
          ? estadoNaoLidasWpp.get(chave)
          : null;

      return {
        ...conversa,
        privacidadeAliases: estadoAliasesPrivacidade.get(chave) || [],
        arquivada:
          chave && estadoArquivamento.has(chave)
            ? estadoArquivamento.get(chave)
            : false,
        trancada:
          chave && estadoTrancamento.has(chave)
            ? estadoTrancamento.get(chave)
            : false,
        naoLidasWpp: estadoNaoLidas?.total ?? null,
        naoLidasWppRevisao: Number(estadoNaoLidas?.revisao || 0) || 0,
        naoLidasWppGeracao: estadoNaoLidas?.geracao || "",
      };
    });
}

function enviarConversasMescladas() {
  // Privacidade primeiro:
  // não exibimos nenhuma conversa até o WPPConnect informar
  // quais chats estão trancados.
  if (!estadoPrivacidadeCompleto) {
    return;
  }

  enviarParaTela(
    "conversas-iniciais",
    aplicarEstadoArquivamento(conversasBase),
  );
}

function enviarCatalogoAoWpp() {
  // Intencionalmente desativado.
  // O catalogo do Baileys inclui conversas historicas/apagadas e nao deve
  // criar ou validar chats na lista atual do WhatsIAPP.
  return;
}

function prepararMensagemComPrivacidade(dadosOriginais) {
  const dados = {
    ...(dadosOriginais || {}),
  };

  const chave = chaveCanonica(dados.id);

  dados.arquivada =
    chave && estadoArquivamento.has(chave)
      ? estadoArquivamento.get(chave)
      : false;

  dados.trancada =
    chave && estadoTrancamento.has(chave)
      ? estadoTrancamento.get(chave)
      : false;

  dados.privacidadeAliases = estadoAliasesPrivacidade.get(chave) || [];

  return dados;
}

function idMensagemTempoReal(dados) {
  const id = String(dados?.idMensagem || "").trim();

  return id || null;
}

function limparMensagensRecentesTempoReal() {
  const agora = Date.now();
  const ttl = 10 * 60 * 1000;

  for (const [id, timestamp] of mensagensRecentesTempoReal.entries()) {
    if (agora - timestamp > ttl) {
      mensagensRecentesTempoReal.delete(id);
    }
  }

  if (mensagensRecentesTempoReal.size > 1000) {
    const excedente = mensagensRecentesTempoReal.size - 1000;

    for (const id of Array.from(mensagensRecentesTempoReal.keys()).slice(
      0,
      excedente,
    )) {
      mensagensRecentesTempoReal.delete(id);
    }
  }
}

function mensagemTempoRealJaEncaminhada(dados) {
  const id = idMensagemTempoReal(dados);

  if (!id) {
    return false;
  }

  limparMensagensRecentesTempoReal();

  return mensagensRecentesTempoReal.has(id);
}

function marcarMensagemTempoRealEncaminhada(dados) {
  const id = idMensagemTempoReal(dados);

  if (!id) {
    return;
  }

  mensagensRecentesTempoReal.set(id, Date.now());
  limparMensagensRecentesTempoReal();
}

function cancelarFallbackBaileys(dados) {
  const id = idMensagemTempoReal(dados);

  if (!id) {
    return false;
  }

  const pendente = mensagensBaileysAguardandoWpp.get(id);

  if (!pendente) {
    return false;
  }

  clearTimeout(pendente.timer);
  mensagensBaileysAguardandoWpp.delete(id);

  return true;
}

function solicitarAtualizacaoPrivacidadeParaMensagem() {
  solicitarAoWorker("wpp", "atualizar-estado", {}, 15000)
    .then((resultado) => {
      if (resultado?.ok && Array.isArray(resultado.estado)) {
        atualizarEstadoArquivamento({
          itens: resultado.estado,
          completo: true,
        });
      }
    })
    .catch(() => {});
}

function limparSonsMensagemImediatosRecentes() {
  const agora = Date.now();
  const ttl = 2 * 60 * 1000;

  for (const [chave, salvoEm] of sonsMensagemImediatosRecentes.entries()) {
    if (agora - salvoEm > ttl) {
      sonsMensagemImediatosRecentes.delete(chave);
    }
  }
}

function chaveSomMensagemImediato(dadosMensagem) {
  const id = idMensagemTempoReal(dadosMensagem);

  if (id) {
    return `id:${id}`;
  }

  const conversa = chaveCanonica(dadosMensagem?.id) || "sem-conversa";
  const timestamp = Number(dadosMensagem?.timestamp || 0);
  const texto = String(dadosMensagem?.texto || "").slice(0, 80);

  return `fallback:${conversa}:${timestamp}:${texto}`;
}

function dispararSomMensagemImediato(dadosMensagem, origem = "desconhecida") {
  if (
    !dadosMensagem ||
    dadosMensagem.minha ||
    dadosMensagem?.testeIntegridadeIA
  ) {
    return false;
  }

  const chaveConversa = chaveCanonica(dadosMensagem.id);

  // Nunca antecipa notificacao quando a privacidade ainda nao e conhecida.
  // Assim conversa trancada continua sem vazar som/notificacao.
  if (
    !chaveConversa ||
    !estadoPrivacidadeConhecido.has(chaveConversa) ||
    estadoTrancamento.get(chaveConversa)
  ) {
    return false;
  }

  limparSonsMensagemImediatosRecentes();

  const chaveSom = chaveSomMensagemImediato(dadosMensagem);

  if (sonsMensagemImediatosRecentes.has(chaveSom)) {
    return false;
  }

  sonsMensagemImediatosRecentes.set(chaveSom, Date.now());

  enviarParaTela("som-mensagem-imediato", {
    conversaId: dadosMensagem.id,
    idMensagem: idMensagemTempoReal(dadosMensagem),
    timestamp: dadosMensagem.timestamp || Date.now(),
    origem,
  });

  console.log(
    `[NOTIFICACOES] som imediato solicitado via ${origem} para ${dadosMensagem.id}.`,
  );

  return true;
}

function encaminharMensagemTempoReal(dadosMensagem) {
  if (!dadosMensagem || mensagemTempoRealJaEncaminhada(dadosMensagem)) {
    return false;
  }

  const chaveMensagem = chaveCanonica(dadosMensagem.id);

  const privacidadeConhecida =
    !!chaveMensagem && estadoPrivacidadeConhecido.has(chaveMensagem);

  if (!privacidadeConhecida) {
    const id = idMensagemTempoReal(dadosMensagem);

    const jaPendente =
      !!id &&
      mensagensPendentesPrivacidade.some(
        (item) => idMensagemTempoReal(item) === id,
      );

    if (!jaPendente) {
      mensagensPendentesPrivacidade.push(dadosMensagem);
    }

    solicitarAtualizacaoPrivacidadeParaMensagem();

    return false;
  }

  marcarMensagemTempoRealEncaminhada(dadosMensagem);

  enviarParaTela("mensagem", prepararMensagemComPrivacidade(dadosMensagem));

  return true;
}

function agendarFallbackMensagemBaileys(dadosMensagem) {
  const id = idMensagemTempoReal(dadosMensagem);

  if (!id || mensagemTempoRealJaEncaminhada(dadosMensagem)) {
    return;
  }

  if (mensagensBaileysAguardandoWpp.has(id)) {
    return;
  }

  const timer = setTimeout(() => {
    mensagensBaileysAguardandoWpp.delete(id);

    if (!mensagemTempoRealJaEncaminhada(dadosMensagem)) {
      encaminharMensagemTempoReal(dadosMensagem);
    }
  }, 1800);

  mensagensBaileysAguardandoWpp.set(id, {
    timer,
    dados: dadosMensagem,
  });
}

function liberarFallbacksBaileysImediatamente() {
  const pendentes = Array.from(mensagensBaileysAguardandoWpp.values());

  mensagensBaileysAguardandoWpp.clear();

  for (const item of pendentes) {
    clearTimeout(item.timer);

    if (!mensagemTempoRealJaEncaminhada(item.dados)) {
      encaminharMensagemTempoReal(item.dados);
    }
  }
}

function liberarMensagensPendentesPrivacidade() {
  const aindaPendentes = [];
  const idsAindaPendentes = new Set();

  while (mensagensPendentesPrivacidade.length) {
    const dados = mensagensPendentesPrivacidade.shift();
    const chave = chaveCanonica(dados?.id);
    const id = idMensagemTempoReal(dados);

    if (mensagemTempoRealJaEncaminhada(dados)) {
      continue;
    }

    const conhecida = !!chave && estadoPrivacidadeConhecido.has(chave);

    if (!conhecida) {
      if (!id || !idsAindaPendentes.has(id)) {
        aindaPendentes.push(dados);

        if (id) {
          idsAindaPendentes.add(id);
        }
      }

      continue;
    }

    marcarMensagemTempoRealEncaminhada(dados);

    enviarParaTela("mensagem", prepararMensagemComPrivacidade(dados));
  }

  mensagensPendentesPrivacidade.push(...aindaPendentes);
}

function atualizarEstadoArquivamento(payload) {
  const lista = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.itens)
      ? payload.itens
      : [];

  const completo = Array.isArray(payload) ? true : !!payload?.completo;
  const chavesNaoLidasVistas = new Set();

  if (completo) {
    clearTimeout(timerFallbackPrivacidadeInicial);
    timerFallbackPrivacidadeInicial = null;
    estadoArquivamento.clear();
    estadoTrancamento.clear();
    estadoAliasesPrivacidade.clear();
    estadoPrivacidadeConhecido.clear();
  }

  for (const item of lista || []) {
    const ids = [item.id, ...(Array.isArray(item.aliases) ? item.aliases : [])];

    for (const id of ids) {
      const chave = chaveCanonica(id);

      if (!chave) {
        continue;
      }

      estadoArquivamento.set(chave, !!item.arquivada);
      estadoTrancamento.set(chave, !!item.trancada);
      estadoAliasesPrivacidade.set(
        chave,
        ids.map((id) => String(id || "").trim()).filter(Boolean),
      );
      estadoPrivacidadeConhecido.add(chave);

      const valorNaoLidas = Number(item?.naoLidas);

      if (
        item?.naoLidas !== null &&
        item?.naoLidas !== undefined &&
        Number.isFinite(valorNaoLidas)
      ) {
        const totalNaoLidas = Math.max(0, Math.floor(valorNaoLidas));
        const anteriorNaoLidas = estadoNaoLidasWpp.get(chave);

        if (
          !anteriorNaoLidas ||
          Number(anteriorNaoLidas.total || 0) !== totalNaoLidas
        ) {
          estadoNaoLidasWpp.set(chave, {
            total: totalNaoLidas,
            revisao: ++sequenciaEstadoNaoLidasWpp,
            geracao: geracaoEstadoNaoLidasWpp,
            atualizadoEm: Date.now(),
          });
        }

        chavesNaoLidasVistas.add(chave);
      }
    }
  }

  if (completo) {
    for (const chave of Array.from(estadoNaoLidasWpp.keys())) {
      if (!chavesNaoLidasVistas.has(chave)) {
        estadoNaoLidasWpp.delete(chave);
      }
    }

    estadoPrivacidadeCompleto = true;
  }

  const totalTrancadas = (lista || []).filter((item) => item.trancada).length;

  const totalComNaoLidasWpp = new Set(
    Array.from(estadoNaoLidasWpp.entries())
      .filter(([, estado]) => Number(estado?.total || 0) > 0)
      .map(([chave]) => chave),
  ).size;

  console.log(
    `WPPConnect: ${estadoPrivacidadeConhecido.size} aliases validados, ` +
      `${totalTrancadas} conversas trancadas, ` +
      `nao_lidas=${totalComNaoLidasWpp}, ` +
      `completo=${estadoPrivacidadeCompleto}.`,
  );

  estadoPrivacidadePronto = estadoPrivacidadeCompleto;

  if (estadoPrivacidadeConhecido.size > 0) {
    salvarCachePrivacidade();
  }

  enviarConversasMescladas();
  liberarMensagensPendentesPrivacidade();
  tentarLiberarFullReadyInicial();
}

function tentarLiberarFullReadyInicial() {
  if (
    fullReadyInicialLiberado ||
    !baileysProntoInicial ||
    !estadoPrivacidadeCompleto ||
    !Array.isArray(conversasBase) ||
    conversasBase.length === 0 ||
    !fotosPrincipaisProntas
  ) {
    return false;
  }

  fullReadyInicialLiberado = true;

  const dadosEtapa = {
    etapa: "full-ready",
    origem: "bootstrap",
    detalhe: "Baileys + cache local + conversas principais + fotos principais.",
  };

  ultimaEtapaSincronizacaoInicial = { ...dadosEtapa };

  enviarParaTela("status", {
    texto: "Conectado",
    tipo: "conectado",
  });

  enviarParaTela("sincronizacao-etapa", dadosEtapa);

  const tempoMs =
    diagnosticoInicioInicializacao === null
      ? 0
      : tempoMonotonicoMs() - diagnosticoInicioInicializacao;

  console.log(
    `[READY RAPIDO] LIBERADO EM ${formatarTempoDiagnostico(tempoMs)} | ` +
      `baileys=true | privacidade_cache=true | conversas=${conversasBase.length} | ` +
      `fotos_principais=true | wpp_background=${wppFullReady}`,
  );

  return true;
}

ipcMain.handle("fotos-principais-ready", async (_evento, dados = {}) => {
  fotosPrincipaisProntas = true;

  registrarMarcoInicializacao(
    "renderer",
    "fotos-principais-prontas",
    `total=${Number(dados?.total || 0) || 0} | com_foto=${Number(dados?.comFoto || 0) || 0} | sem_foto=${Number(dados?.semFoto || 0) || 0}`,
  );

  console.log(
    `[READY] FOTOS_PRINCIPAIS_OK | total=${Number(dados?.total || 0) || 0} | ` +
      `com_foto=${Number(dados?.comFoto || 0) || 0} | ` +
      `sem_foto=${Number(dados?.semFoto || 0) || 0}`,
  );

  tentarLiberarFullReadyInicial();

  return {
    ok: true,
    liberado: fullReadyInicialLiberado,
  };
});

function registrarWorker(worker, tipoWorker) {
  worker.on("online", () => {
    registrarMarcoInicializacao(tipoWorker, "worker-online");
  });

  worker.on("message", (mensagem) => {
    if (!mensagem) return;

    if (mensagem.tipo === "evento") {
      if (mensagem.evento === "sync-stage") {
        const dadosEtapa = {
          ...(mensagem.dados || {}),
          origem: tipoWorker,
        };

        const etapaAtual = String(dadosEtapa.etapa || "");

        registrarMarcoInicializacao(tipoWorker, etapaAtual, dadosEtapa.detalhe);

        if (tipoWorker === "wpp" && etapaAtual === "full-ready") {
          wppFullReady = true;
          dadosFullReadyInicialPendente = { ...dadosEtapa };

          // O WPP continua sendo inicializado por completo, mas fora do
          // caminho critico da abertura. Aqui apenas confirmamos o backend,
          // liberamos fotos secundarias e mantemos o diagnostico completo.
          if (fullReadyInicialLiberado) {
            ultimaEtapaSincronizacaoInicial = { ...dadosEtapa };
          } else {
            ultimaEtapaSincronizacaoInicial = {
              etapa: "fotos-principais",
              origem: "renderer",
              detalhe: "Preparando fotos das conversas principais.",
            };

            enviarParaTela("sincronizacao-etapa", {
              ...ultimaEtapaSincronizacaoInicial,
            });
          }

          enviarParaTela("liberar-fotos-secundarias", {
            solicitadoEm: Date.now(),
          });

          // A interface pode ja ter sido liberada pelo READY rapido.
          // Mesmo assim o renderer precisa receber o FULL_READY real do WPP
          // para finalizar o indicador visual de sincronizacao em 100%.
          enviarParaTela("sincronizacao-etapa", {
            ...dadosEtapa,
            origem: "wpp",
            conclusaoBackground: true,
          });

          imprimirResumoDiagnosticoInicializacao();
          agendarSincronizacaoHistoricoGapWpp(350);

          console.log(
            `[READY BACKGROUND] WPP_COMPLETO | ui_ja_liberada=${fullReadyInicialLiberado}`,
          );

          tentarLiberarFullReadyInicial();
          return;
        }

        // Mantem o ultimo marco para o renderer poder recuperar o estado
        // caso uma etapa aconteca antes de o listener IPC ser registrado.
        ultimaEtapaSincronizacaoInicial = { ...dadosEtapa };
        enviarParaTela("sincronizacao-etapa", dadosEtapa);
        return;
      }

      if (
        tipoWorker === "baileys" &&
        mensagem.evento === "conversas-iniciais"
      ) {
        registrarMarcoInicializacao(
          "baileys",
          "conversas-iniciais",
          `${Array.isArray(mensagem.dados) ? mensagem.dados.length : 0} conversas`,
        );

        const listaConversasBaileys = Array.isArray(mensagem.dados)
          ? mensagem.dados
          : [];

        if (conversasBaseHistoricoInicial === null) {
          conversasBaseHistoricoInicial = listaConversasBaileys
            .filter((conversa) => conversa?.id)
            .map((conversa) => ({
              id: conversa.id,
              timestamp: timestampMaisRecenteConversaLocal(conversa),
            }));

          console.log(
            `[HISTORICO GAP] BASELINE_INICIAL | conversas=${conversasBaseHistoricoInicial.length}`,
          );
        }

        conversasBase = listaConversasBaileys;

        enviarConversasMescladas();
        enviarCatalogoAoWpp();
        tentarLiberarFullReadyInicial();

        if (wppFullReady) {
          agendarSincronizacaoHistoricoGapWpp(700);
        }

        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "wpp-live-ready") {
        wppRecepcaoAoVivoPronta = !!mensagem.dados?.ativo;

        if (wppRecepcaoAoVivoPronta) {
          registrarMarcoInicializacao("wpp", "live-receive-ready");
        }

        console.log(
          `WPPConnect live receive: ${
            wppRecepcaoAoVivoPronta ? "ready" : "offline"
          }.`,
        );

        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "mensagem") {
        const dadosMensagem = mensagem.dados || {};

        if (mensagemEhCatchupDaInicializacao(dadosMensagem)) {
          cancelarFallbackBaileys(dadosMensagem);
          registrarCatchupSilencioso(dadosMensagem, "wpp");
          return;
        }

        dispararSomMensagemImediato(dadosMensagem, "wpp");
        cancelarFallbackBaileys(dadosMensagem);
        encaminharMensagemTempoReal(dadosMensagem);

        return;
      }

      if (tipoWorker === "baileys" && mensagem.evento === "mensagem") {
        const dadosMensagem = mensagem.dados || {};

        if (mensagemEhCatchupDaInicializacao(dadosMensagem)) {
          registrarCatchupSilencioso(dadosMensagem, "baileys");
          return;
        }

        dispararSomMensagemImediato(dadosMensagem, "baileys");

        if (mensagemTempoRealJaEncaminhada(dadosMensagem)) {
          return;
        }

        if (wppRecepcaoAoVivoPronta && idMensagemTempoReal(dadosMensagem)) {
          agendarFallbackMensagemBaileys(dadosMensagem);
          return;
        }

        encaminharMensagemTempoReal(dadosMensagem);

        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "mensagem-status") {
        enviarParaTela("mensagem-status", mensagem.dados);
        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "archive-state") {
        atualizarEstadoArquivamento(mensagem.dados);
        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "wpp-qr") {
        enviarParaTela("status", {
          texto: "Conecte o módulo de Arquivadas",
          tipo: "qr",
        });

        atualizarQrConexao("wpp", mensagem.dados);

        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "wpp-qr-read") {
        // Confirmação explícita do WPPConnect: agora podemos remover o QR
        // dele sem confundir sincronização com autenticação.
        atualizarQrConexao("wpp", null);
        enviarParaTela("status", {
          texto: "Módulo de Arquivadas conectado",
          tipo: "conectando",
        });
        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "wpp-ready") {
        registrarMarcoInicializacao("wpp", "wpp-ready");

        // Só limpe o QR quando o WPP confirmar a leitura. Estados como
        // syncing/inchat podem chegar antes e não representam autenticação.
        if (mensagem.dados?.qrConfirmado === true) {
          atualizarQrConexao("wpp", null);
        }

        if (!wppFullReady) {
          enviarParaTela("status", {
            texto: "Sincronizando...",
            tipo: "conectando",
          });
        }

        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "wpp-status") {
        console.log(`WPPConnect: ${mensagem.dados?.texto || mensagem.dados}`);
        return;
      }

      if (tipoWorker === "baileys" && mensagem.evento === "presenca") {
        const dadosMapeados = mapearEventoPresencaParaConversaAtiva(
          mensagem.dados,
        );

        if (!dadosMapeados || !presencaAtiva) {
          if (presencaAtiva && mensagem.dados?.conversaId) {
            console.log(
              `[PRESENCA] evento Baileys ignorado por alias: ` +
                `${mensagem.dados.conversaId} != ${presencaAtiva.conversaIdOriginal}.`,
            );
          }

          return;
        }

        presencaAtiva.ultimaAtualizacaoBaileysEm = Date.now();
        registrarTempoPresencaReal("baileys", dadosMapeados);

        enviarParaTela("presenca", {
          ...dadosMapeados,
          fonte: "baileys",
        });

        return;
      }

      if (tipoWorker === "wpp" && mensagem.evento === "presenca") {
        const dadosMapeados = mapearEventoPresencaParaConversaAtiva(
          mensagem.dados,
        );

        if (!dadosMapeados || !presencaAtiva) {
          return;
        }

        registrarTempoPresencaReal("wpp", dadosMapeados);

        // So damos prioridade ao Baileys depois de receber um evento real.
        // Uma assinatura confirmada sem nenhum presence.update nao pode
        // bloquear o WPPConnect, que continua sendo o fallback imediato.
        const referenciaBaileys = presencaAtiva.ultimaAtualizacaoBaileysEm || 0;

        const idadeBaileys =
          referenciaBaileys > 0
            ? Date.now() - referenciaBaileys
            : Number.POSITIVE_INFINITY;

        if (
          presencaAtiva.baileysDisponivel &&
          idadeBaileys < JANELA_PRIORIDADE_PRESENCA_BAILEYS_MS
        ) {
          return;
        }

        console.log(
          `[PRESENCA] WPPConnect assumiu fallback para ${presencaAtiva.conversaIdOriginal} ` +
            `(sem evento Baileys recente por ${Math.round(idadeBaileys)}ms).`,
        );

        enviarParaTela("presenca", {
          ...dadosMapeados,
          fonte: "wpp-fallback",
        });

        return;
      }

      // QR/status principal continuam vindo do Baileys.
      if (tipoWorker === "baileys") {
        if (mensagem.evento === "qr") {
          atualizarQrConexao("baileys", mensagem.dados);
          return;
        }
        if (
          mensagem.evento === "status" &&
          String(mensagem.dados?.tipo || "") === "conectado"
        ) {
          baileysProntoInicial = true;

          enviarParaTela("baileys-pronto", {
            conectado: true,
          });

          enviarParaTela("preparar-fotos-principais", {
            solicitadoEm: Date.now(),
          });

          tentarLiberarFullReadyInicial();

          if (!fullReadyInicialLiberado) {
            enviarParaTela("status", {
              texto: "Preparando conversas...",
              tipo: "conectando",
            });

            return;
          }
        }

        enviarParaTela(mensagem.evento, mensagem.dados);
      }

      return;
    }

    if (mensagem.tipo === "resposta") {
      const pendente = solicitacoesPendentes.get(mensagem.id);

      if (!pendente) return;

      solicitacoesPendentes.delete(mensagem.id);
      clearTimeout(pendente.timer);

      pendente.resolve(mensagem.resultado);
    }
  });

  worker.on("error", (erro) => {
    registrarMarcoInicializacao(
      tipoWorker,
      "worker-error",
      erro?.message || String(erro),
    );

    console.error(`Erro no worker ${tipoWorker}:`, erro);

    if (!wppFullReady) {
      enviarParaTela("sincronizacao-etapa", {
        etapa: "erro",
        origem: tipoWorker,
        detalhe: erro?.message || "Falha durante a inicializacao.",
      });
    }

    if (tipoWorker === "baileys") {
      enviarParaTela("status", {
        texto: "Erro no serviço do WhatsApp",
        tipo: "erro",
      });
    }
  });

  worker.on("exit", (codigo) => {
    registrarMarcoInicializacao(tipoWorker, "worker-exit", `codigo=${codigo}`);

    if (tipoWorker === "baileys") {
      whatsappWorker = null;
    } else {
      archiveWorker = null;
      wppRecepcaoAoVivoPronta = false;
      liberarFallbacksBaileysImediatamente();
    }

    for (const [id, pendente] of solicitacoesPendentes.entries()) {
      if (pendente.tipoWorker !== tipoWorker) {
        continue;
      }

      clearTimeout(pendente.timer);

      pendente.resolve({
        ok: false,
        erro: `O serviço ${tipoWorker} foi encerrado.`,
      });

      solicitacoesPendentes.delete(id);
    }

    if (!encerrando && codigo !== 0) {
      setTimeout(() => {
        if (tipoWorker === "baileys") {
          criarWorkerWhatsApp();
        } else {
          criarWorkerArquivadas();
        }
      }, 2000);
    }
  });
}

function criarWorkerWhatsApp() {
  if (whatsappWorker) return;

  conversasBaseHistoricoInicial = null;
  historicoGapWppExecutado = false;
  historicoGapWppEmAndamento = false;
  clearTimeout(timerHistoricoGapWpp);
  timerHistoricoGapWpp = null;

  registrarMarcoInicializacao("baileys", "worker-create");

  whatsappWorker = new Worker(path.join(__dirname, "whatsapp-worker.js"), {
    workerData: {
      userDataPath: app.getPath("userData"),
    },
  });

  registrarWorker(whatsappWorker, "baileys");
}

function criarWorkerArquivadas() {
  if (archiveWorker) return;

  wppFullReady = false;
  historicoGapWppExecutado = false;
  historicoGapWppEmAndamento = false;
  clearTimeout(timerHistoricoGapWpp);
  timerHistoricoGapWpp = null;

  registrarMarcoInicializacao("wpp", "worker-create");

  archiveWorker = new Worker(path.join(__dirname, "wpp-worker.js"), {
    workerData: {
      userDataPath: app.getPath("userData"),
    },
  });

  registrarWorker(archiveWorker, "wpp");

  setTimeout(enviarCatalogoAoWpp, 1500);
}

function solicitarAoWorker(tipoWorker, acao, dados = {}, timeout = 30000) {
  return new Promise((resolve) => {
    const worker = tipoWorker === "baileys" ? whatsappWorker : archiveWorker;

    if (!worker) {
      resolve({
        ok: false,
        erro:
          tipoWorker === "baileys"
            ? "Serviço do WhatsApp indisponível."
            : "Módulo de arquivamento indisponível.",
      });

      return;
    }

    const id = ++sequenciaSolicitacao;

    const timer = setTimeout(() => {
      solicitacoesPendentes.delete(id);

      resolve({
        ok: false,
        erro: "O serviço demorou demais para responder.",
      });
    }, timeout);

    solicitacoesPendentes.set(id, {
      resolve,
      timer,
      tipoWorker,
    });

    worker.postMessage({
      tipo: "solicitacao",
      id,
      acao,
      dados,
    });
  });
}

function timestampMaisRecenteConversaLocal(conversa) {
  let maior = Number(conversa?.timestamp || 0) || 0;

  for (const mensagem of Array.isArray(conversa?.mensagens)
    ? conversa.mensagens.slice(-20)
    : []) {
    maior = Math.max(maior, Number(mensagem?.timestamp || 0) || 0);
  }

  return Math.floor(Math.max(0, maior));
}

function agendarSincronizacaoHistoricoGapWpp(atraso = 700) {
  if (
    encerrando ||
    historicoGapWppExecutado ||
    historicoGapWppEmAndamento ||
    !wppFullReady
  ) {
    return;
  }

  clearTimeout(timerHistoricoGapWpp);

  timerHistoricoGapWpp = setTimeout(
    () => {
      timerHistoricoGapWpp = null;

      sincronizarHistoricoGapWpp().catch((erro) => {
        console.warn(
          `[HISTORICO GAP] ERRO_MAIN | ${erro?.message || erro || "unknown"}`,
        );
      });
    },
    Math.max(0, Number(atraso) || 0),
  );
}

async function sincronizarHistoricoGapWpp() {
  if (
    encerrando ||
    historicoGapWppExecutado ||
    historicoGapWppEmAndamento ||
    !wppFullReady ||
    !archiveWorker ||
    !whatsappWorker
  ) {
    return;
  }

  if (!Array.isArray(conversasBase) || conversasBase.length === 0) {
    console.log("[HISTORICO GAP] ADIADO | cache local ainda sem conversas.");
    return;
  }

  historicoGapWppEmAndamento = true;

  try {
    const baselineInicial = Array.isArray(conversasBaseHistoricoInicial)
      ? conversasBaseHistoricoInicial
      : [];

    const bases = baselineInicial.length
      ? baselineInicial.map((item) => ({ ...item }))
      : conversasBase
          .filter((conversa) => conversa?.id)
          .map((conversa) => ({
            id: conversa.id,
            timestamp: timestampMaisRecenteConversaLocal(conversa),
          }));

    const indiceBase = new Map(
      bases
        .filter((item) => item?.id)
        .map((item) => [String(item.id).trim().toLowerCase(), item]),
    );

    let importadas = 0;
    let atualizadas = 0;
    let duplicadas = 0;
    let ignoradas = 0;
    let conversasAlteradas = 0;
    let rodadas = 0;
    let restantes = 0;

    console.log(
      `[HISTORICO GAP] INICIO_RAPIDO | conversasLocais=${bases.length}`,
    );

    while (!encerrando && rodadas < 12) {
      rodadas++;

      const limiteCandidatos = rodadas === 1 ? 8 : 14;

      const resultadoWpp = await solicitarAoWorker(
        "wpp",
        "buscar-historico-gap",
        {
          conversas: bases,
          limiteCandidatos,
        },
        60000,
      );

      if (!resultadoWpp?.ok) {
        throw new Error(
          resultadoWpp?.erro || "WPPConnect nao retornou o historico pendente.",
        );
      }

      const mensagens = Array.isArray(resultadoWpp?.mensagens)
        ? resultadoWpp.mensagens
        : [];
      const processados = Array.isArray(resultadoWpp?.processados)
        ? resultadoWpp.processados
        : [];

      restantes = Math.max(
        0,
        Number(resultadoWpp?.resumo?.restantes || 0) || 0,
      );

      // Avanca a baseline dos chats ja consultados, mesmo quando o WPP nao
      // devolveu mensagem nova. Isso evita reconsultar o mesmo chat em todas
      // as rodadas e permite que os chats recentes aparecam primeiro.
      for (const item of processados) {
        const id = String(item?.id || "").trim();
        const timestampWpp = Math.max(0, Number(item?.timestampWpp || 0) || 0);

        if (!id || !timestampWpp) {
          continue;
        }

        const chave = id.toLowerCase();
        const base = indiceBase.get(chave);

        if (base) {
          base.timestamp = Math.max(
            Number(base.timestamp || 0) || 0,
            timestampWpp,
          );
        } else {
          const novo = { id, timestamp: timestampWpp };
          bases.push(novo);
          indiceBase.set(chave, novo);
        }
      }

      console.log(
        `[HISTORICO GAP] LOTE | rodada=${rodadas} | mensagens=${mensagens.length} | ` +
          `processados=${processados.length} | restantes=${restantes} | ` +
          `falhas=${Number(resultadoWpp?.resumo?.falhas || 0) || 0}`,
      );

      if (mensagens.length) {
        const tamanhoLote = 250;

        for (let i = 0; i < mensagens.length; i += tamanhoLote) {
          const lote = mensagens.slice(i, i + tamanhoLote);
          const resultadoBaileys = await solicitarAoWorker(
            "baileys",
            "importar-historico-wpp",
            { mensagens: lote },
            45000,
          );

          if (!resultadoBaileys?.ok) {
            throw new Error(
              resultadoBaileys?.erro ||
                "Baileys nao conseguiu importar historico.",
            );
          }

          importadas += Number(resultadoBaileys?.importadas || 0) || 0;
          atualizadas += Number(resultadoBaileys?.atualizadas || 0) || 0;
          duplicadas += Number(resultadoBaileys?.duplicadas || 0) || 0;
          ignoradas += Number(resultadoBaileys?.ignoradas || 0) || 0;
          conversasAlteradas +=
            Number(resultadoBaileys?.conversasAlteradas || 0) || 0;
        }
      }

      if (restantes <= 0) {
        break;
      }

      // Pequena folga entre lotes para nao disputar a interface com o usuario.
      await new Promise((resolve) => setTimeout(resolve, 220));
    }

    // Uma execucao cobre ate 162 chats alterados, muito acima do volume
    // normal entre duas aberturas. Encerramos o ciclo para nao repetir carga
    // pesada durante a mesma sessao.
    historicoGapWppExecutado = true;

    console.log(
      `[HISTORICO GAP] CONCLUIDO | rodadas=${rodadas} | importadas=${importadas} | ` +
        `atualizadas=${atualizadas} | duplicadas=${duplicadas} | ` +
        `ignoradas=${ignoradas} | conversas=${conversasAlteradas} | ` +
        `restantes=${restantes}`,
    );

    finalizarSincronizacaoMensagensSilenciosa("historico-gap-concluido");
  } catch (erro) {
    console.warn(
      `[HISTORICO GAP] FALHOU | ${erro?.message || erro || "unknown"}`,
    );

    finalizarSincronizacaoMensagensSilenciosa("historico-gap-falhou");
  } finally {
    historicoGapWppEmAndamento = false;
  }
}

function arquivoChaveGroqSegura() {
  return path.join(app.getPath("userData"), "groq-api-key-v1.json");
}

function normalizarTipoChaveGroq(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase() === "teste"
    ? "teste"
    : "motor";
}

function fingerprintChaveGroq(apiKey) {
  const chave = String(apiKey || "").trim();

  if (!chave) {
    return "";
  }

  return crypto.createHash("sha256").update(chave).digest("hex").slice(0, 24);
}

function normalizarRegistroChaveGroq(valor) {
  if (!valor || typeof valor !== "object") {
    return null;
  }

  const criptografada = String(valor?.criptografada || "").trim();

  if (!criptografada) {
    return null;
  }

  return {
    criptografada,
    fingerprint: String(valor?.fingerprint || "").trim(),
    salvaEm: Number(valor?.salvaEm || 0) || null,
  };
}

function carregarRegistroChavesGroqSeguras() {
  try {
    const arquivo = arquivoChaveGroqSegura();

    if (!fs.existsSync(arquivo)) {
      return {
        versao: 2,
        motor: null,
        teste: null,
      };
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    if (Number(dados?.versao || 0) >= 2 || dados?.motor || dados?.teste) {
      return {
        versao: 2,
        motor: normalizarRegistroChaveGroq(dados?.motor),
        teste: normalizarRegistroChaveGroq(dados?.teste),
      };
    }

    // Migracao transparente da estrutura antiga: a unica chave existente
    // era a chave do motor. Nenhum consumo antigo e descartado.
    return {
      versao: 2,
      motor: normalizarRegistroChaveGroq(dados),
      teste: null,
    };
  } catch {
    return {
      versao: 2,
      motor: null,
      teste: null,
    };
  }
}

function salvarRegistroChavesGroqSeguras(registro) {
  const arquivo = arquivoChaveGroqSegura();
  const temporario = `${arquivo}.tmp`;

  fs.writeFileSync(
    temporario,
    JSON.stringify(
      {
        versao: 2,
        motor: normalizarRegistroChaveGroq(registro?.motor),
        teste: normalizarRegistroChaveGroq(registro?.teste),
        atualizadoEm: Date.now(),
      },
      null,
      2,
    ),
    "utf8",
  );

  fs.renameSync(temporario, arquivo);
}

function obterRegistroChaveGroqSegura(tipo = "motor") {
  const id = normalizarTipoChaveGroq(tipo);
  const registro = carregarRegistroChavesGroqSeguras();
  return normalizarRegistroChaveGroq(registro?.[id]);
}

function chaveGroqSeguraConfigurada(tipo = "motor") {
  return !!obterRegistroChaveGroqSegura(tipo);
}

function salvarChaveGroqSegura(apiKey, tipo = "motor") {
  const chave = String(apiKey || "").trim();
  const id = normalizarTipoChaveGroq(tipo);

  if (chave.length < 20) {
    return {
      ok: false,
      erro: "A chave informada parece inválida.",
    };
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      erro: "A proteção criptográfica do sistema não está disponível neste momento.",
    };
  }

  try {
    const criptografada = safeStorage.encryptString(chave);
    const registro = carregarRegistroChavesGroqSeguras();
    const fingerprint = fingerprintChaveGroq(chave);

    registro[id] = {
      criptografada: criptografada.toString("base64"),
      fingerprint,
      salvaEm: Date.now(),
    };

    salvarRegistroChavesGroqSeguras(registro);

    return {
      ok: true,
      tipo: id,
      fingerprint,
      fingerprintCurto: fingerprint.slice(0, 8),
    };
  } catch (erro) {
    return {
      ok: false,
      erro:
        erro?.message || "Não foi possível proteger e salvar a chave da Groq.",
    };
  }
}

function obterChaveGroqSegura(tipo = "motor") {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }

    const registro = obterRegistroChaveGroqSegura(tipo);
    const valor = String(registro?.criptografada || "").trim();

    if (!valor) {
      return null;
    }

    const buffer = Buffer.from(valor, "base64");
    const chave = safeStorage.decryptString(buffer).trim();

    return chave || null;
  } catch (erro) {
    console.warn("Groq secure key read failed:", erro?.message || erro);
    return null;
  }
}

function obterFingerprintChaveGroqConfigurada(tipo = "motor") {
  const registro = obterRegistroChaveGroqSegura(tipo);
  const salvo = String(registro?.fingerprint || "").trim();

  if (salvo) {
    return salvo;
  }

  const chave = obterChaveGroqSegura(tipo);
  return chave ? fingerprintChaveGroq(chave) : "";
}

function obterChaveGroqParaUso() {
  const contexto = contextoCobrancaGroqAtual();
  return obterChaveGroqSegura(contexto.canalApi);
}

function removerChaveGroqSegura(tipo = "motor") {
  const id = normalizarTipoChaveGroq(tipo);

  try {
    const arquivo = arquivoChaveGroqSegura();
    const registro = carregarRegistroChavesGroqSeguras();

    registro[id] = null;

    if (!registro.motor && !registro.teste) {
      if (fs.existsSync(arquivo)) {
        fs.unlinkSync(arquivo);
      }
    } else {
      salvarRegistroChavesGroqSeguras(registro);
    }

    return {
      ok: true,
      tipo: id,
    };
  } catch (erro) {
    return {
      ok: false,
      erro: erro?.message || "Não foi possível remover a chave salva.",
    };
  }
}

const GROQ_API_HOST = "api.groq.com";
const GROQ_API_PATH = "/openai/v1/chat/completions";
const GROQ_API_PATH_TRANSCRICAO = "/openai/v1/audio/transcriptions";
const GROQ_MODELO_PADRAO = "openai/gpt-oss-120b";
const GROQ_MODELO_WEB = "groq/compound-mini";
const GROQ_MODELO_VISAO = "qwen/qwen3.6-27b";
const GROQ_MODELO_TRANSCRICAO = "whisper-large-v3-turbo";
const GROQ_QWEN36_ENTRADA_USD_MILHAO = 0.6;
const GROQ_QWEN36_SAIDA_USD_MILHAO = 3.0;
const GROQ_WHISPER_TURBO_USD_HORA = 0.04;
const GROQ_VERSAO_COMPOUND_BENCHMARK = "2025-07-23";

const GROQ_MAX_ESPERA_RETRY_429_MS = 45000;
const GROQ_MAX_RETRIES_429 = 2;

function arquivoUsoGroq() {
  return path.join(app.getPath("userData"), "groq-uso-v1.json");
}

function chaveDiaLocal(timestamp = Date.now()) {
  const data = new Date(timestamp);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function carregarUsoGroqPersistido() {
  try {
    const arquivo = arquivoUsoGroq();

    if (!fs.existsSync(arquivo)) {
      return {
        versao: 4,
        dias: {},
        eventosDesde: null,
        billingDesde: null,
        avisosBilling: {},
      };
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    return {
      versao: 4,
      dias: dados?.dias && typeof dados.dias === "object" ? dados.dias : {},
      eventosDesde: Number(dados?.eventosDesde || 0) || null,
      billingDesde: Number(dados?.billingDesde || 0) || null,
      avisosBilling:
        dados?.avisosBilling && typeof dados.avisosBilling === "object"
          ? dados.avisosBilling
          : {},
    };
  } catch {
    return {
      versao: 4,
      dias: {},
      eventosDesde: null,
      billingDesde: null,
      avisosBilling: {},
    };
  }
}

function dataLocalInicioDia(timestamp = Date.now()) {
  const data = new Date(timestamp);
  data.setHours(0, 0, 0, 0);
  return data;
}

function dataLocalInicioSemana(timestamp = Date.now()) {
  const data = dataLocalInicioDia(timestamp);
  const diaSemana = data.getDay();
  const deslocamento = diaSemana === 0 ? -6 : 1 - diaSemana;
  data.setDate(data.getDate() + deslocamento);
  return data;
}

function dataLocalInicioMes(timestamp = Date.now()) {
  const data = dataLocalInicioDia(timestamp);
  data.setDate(1);
  return data;
}

function salvarUsoGroqPersistido(dados) {
  try {
    const agora = Date.now();
    const limiteEventos = agora - 36 * 60 * 60 * 1000;

    const dias = Object.entries(dados?.dias || {})
      .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
      .slice(0, 45)
      .map(([chave, valor]) => {
        const dia = valor && typeof valor === "object" ? { ...valor } : {};
        const eventos = Array.isArray(dia.eventos)
          ? dia.eventos.filter((item) => Number(item?.em || 0) >= limiteEventos)
          : [];

        if (eventos.length) {
          dia.eventos = eventos.slice(-2500);
        } else {
          delete dia.eventos;
        }

        return [chave, dia];
      });

    const avisosBilling = Object.fromEntries(
      Object.entries(
        dados?.avisosBilling && typeof dados.avisosBilling === "object"
          ? dados.avisosBilling
          : {},
      )
        .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
        .slice(0, 18),
    );

    fs.writeFileSync(
      arquivoUsoGroq(),
      JSON.stringify(
        {
          versao: 4,
          eventosDesde: Number(dados?.eventosDesde || 0) || null,
          billingDesde: Number(dados?.billingDesde || 0) || null,
          avisosBilling,
          dias: Object.fromEntries(dias),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (erro) {
    console.warn("Groq usage save failed:", erro?.message || erro);
  }
}

function arquivoUsoGroqPorChave() {
  return path.join(app.getPath("userData"), "groq-uso-por-chave-v1.json");
}

function criarDiaUsoGroqPorChaveVazio() {
  return {
    chamadas: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    pesquisasWeb: 0,
    custoUsdTotal: 0,
    custoBrlTotal: 0,
    custoUsdFaturavel: 0,
    custoBrlFaturavel: 0,
    chamadasFaturaveis: 0,
    pesquisasWebFaturaveis: 0,
    ultimaChamadaEm: null,
    ultimoStatus: null,
    ultimosTokens: 0,
  };
}

function normalizarDiaUsoGroqPorChave(valor = {}) {
  const base = criarDiaUsoGroqPorChaveVazio();

  for (const chave of [
    "chamadas",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "cachedTokens",
    "pesquisasWeb",
    "chamadasFaturaveis",
    "pesquisasWebFaturaveis",
  ]) {
    base[chave] = Math.max(0, Number(valor?.[chave] || 0) || 0);
  }

  for (const chave of [
    "custoUsdTotal",
    "custoBrlTotal",
    "custoUsdFaturavel",
    "custoBrlFaturavel",
  ]) {
    base[chave] = numeroFinanceiroBilling(valor?.[chave]);
  }

  base.ultimaChamadaEm = Number(valor?.ultimaChamadaEm || 0) || null;
  base.ultimoStatus = Number(valor?.ultimoStatus || 0) || null;
  base.ultimosTokens = Math.max(0, Number(valor?.ultimosTokens || 0) || 0);

  return base;
}

function carregarUsoGroqPorChavePersistido() {
  try {
    const arquivo = arquivoUsoGroqPorChave();

    if (!fs.existsSync(arquivo)) {
      return {
        versao: 1,
        chaves: {},
      };
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    return {
      versao: 1,
      chaves:
        dados?.chaves && typeof dados.chaves === "object" ? dados.chaves : {},
      legadoGlobalPreservadoEm:
        Number(dados?.legadoGlobalPreservadoEm || 0) || null,
    };
  } catch {
    return {
      versao: 1,
      chaves: {},
    };
  }
}

function salvarUsoGroqPorChavePersistido(dados) {
  try {
    const chavesEntrada =
      dados?.chaves && typeof dados.chaves === "object" ? dados.chaves : {};
    const chavesOrdenadas = Object.entries(chavesEntrada)
      .sort(
        (a, b) =>
          Number(b?.[1]?.ultimoUsoEm || 0) - Number(a?.[1]?.ultimoUsoEm || 0),
      )
      .slice(0, 32);

    const chaves = {};

    for (const [fingerprint, registroBruto] of chavesOrdenadas) {
      const registro =
        registroBruto && typeof registroBruto === "object" ? registroBruto : {};
      const diasBrutos =
        registro?.dias && typeof registro.dias === "object"
          ? registro.dias
          : {};
      const dias = Object.fromEntries(
        Object.entries(diasBrutos)
          .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
          .slice(0, 400),
      );

      chaves[fingerprint] = {
        primeiroUsoEm: Number(registro?.primeiroUsoEm || 0) || null,
        ultimoUsoEm: Number(registro?.ultimoUsoEm || 0) || null,
        dias,
      };
    }

    fs.writeFileSync(
      arquivoUsoGroqPorChave(),
      JSON.stringify(
        {
          versao: 1,
          legadoGlobalPreservadoEm:
            Number(dados?.legadoGlobalPreservadoEm || 0) || null,
          chaves,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (erro) {
    console.warn("Groq per-key usage save failed:", erro?.message || erro);
  }
}

function registrarUsoGroqPorChave({
  apiKey,
  contextoCobranca,
  status,
  promptTokens,
  completionTokens,
  totalTokens,
  custo,
}) {
  const fingerprint = fingerprintChaveGroq(apiKey);

  if (!fingerprint) {
    return;
  }

  try {
    const agora = Date.now();
    const dia = chaveDiaLocal(agora);
    const canal = contextoCobranca?.canalApi === "teste" ? "teste" : "motor";
    const dados = carregarUsoGroqPorChavePersistido();
    const registro =
      dados.chaves[fingerprint] && typeof dados.chaves[fingerprint] === "object"
        ? dados.chaves[fingerprint]
        : {
            primeiroUsoEm: agora,
            ultimoUsoEm: agora,
            dias: {},
          };

    if (!dados.legadoGlobalPreservadoEm && fs.existsSync(arquivoUsoGroq())) {
      // O historico anterior a esta versao permanece no arquivo antigo.
      // Nao o atribuímos a uma chave arbitraria, pois isso criaria billing falso.
      dados.legadoGlobalPreservadoEm = agora;
    }

    const registroDia =
      registro.dias?.[dia] && typeof registro.dias[dia] === "object"
        ? registro.dias[dia]
        : {};
    const anterior = normalizarDiaUsoGroqPorChave(registroDia?.[canal]);
    const faturavel = contextoCobranca?.faturavel !== false;
    const custoUsd = numeroFinanceiroBilling(custo?.custoUsd);
    const custoBrl = numeroFinanceiroBilling(custo?.custoBrl);
    const pesquisasWeb = Math.max(0, Number(custo?.pesquisasWeb || 0) || 0);

    registroDia[canal] = {
      chamadas: anterior.chamadas + 1,
      promptTokens:
        anterior.promptTokens + Math.max(0, Number(promptTokens || 0) || 0),
      completionTokens:
        anterior.completionTokens +
        Math.max(0, Number(completionTokens || 0) || 0),
      totalTokens:
        anterior.totalTokens + Math.max(0, Number(totalTokens || 0) || 0),
      cachedTokens:
        anterior.cachedTokens +
        Math.max(0, Number(custo?.cachedTokens || 0) || 0),
      pesquisasWeb: anterior.pesquisasWeb + pesquisasWeb,
      custoUsdTotal: arredondarFinanceiroBilling(
        anterior.custoUsdTotal + custoUsd,
      ),
      custoBrlTotal: arredondarFinanceiroBilling(
        anterior.custoBrlTotal + custoBrl,
      ),
      custoUsdFaturavel: arredondarFinanceiroBilling(
        anterior.custoUsdFaturavel + (faturavel ? custoUsd : 0),
      ),
      custoBrlFaturavel: arredondarFinanceiroBilling(
        anterior.custoBrlFaturavel + (faturavel ? custoBrl : 0),
      ),
      chamadasFaturaveis:
        anterior.chamadasFaturaveis + (faturavel && custoUsd > 0 ? 1 : 0),
      pesquisasWebFaturaveis:
        anterior.pesquisasWebFaturaveis + (faturavel ? pesquisasWeb : 0),
      ultimaChamadaEm: agora,
      ultimoStatus: Number(status || 0) || null,
      ultimosTokens: Math.max(0, Number(totalTokens || 0) || 0),
    };

    registro.dias = {
      ...(registro.dias && typeof registro.dias === "object"
        ? registro.dias
        : {}),
      [dia]: registroDia,
    };
    registro.primeiroUsoEm = Number(registro?.primeiroUsoEm || 0) || agora;
    registro.ultimoUsoEm = agora;
    dados.chaves[fingerprint] = registro;

    salvarUsoGroqPorChavePersistido(dados);
  } catch (erro) {
    console.warn("Groq per-key usage register failed:", erro?.message || erro);
  }
}

function somarDiaUsoGroqPorChave(acumulado, dia) {
  const atual = normalizarDiaUsoGroqPorChave(acumulado);
  const origem = normalizarDiaUsoGroqPorChave(dia);

  for (const chave of [
    "chamadas",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "cachedTokens",
    "pesquisasWeb",
    "chamadasFaturaveis",
    "pesquisasWebFaturaveis",
  ]) {
    atual[chave] += origem[chave];
  }

  for (const chave of [
    "custoUsdTotal",
    "custoBrlTotal",
    "custoUsdFaturavel",
    "custoBrlFaturavel",
  ]) {
    atual[chave] = arredondarFinanceiroBilling(atual[chave] + origem[chave]);
  }

  if (
    Number(origem.ultimaChamadaEm || 0) > Number(atual.ultimaChamadaEm || 0)
  ) {
    atual.ultimaChamadaEm = origem.ultimaChamadaEm;
    atual.ultimoStatus = origem.ultimoStatus;
    atual.ultimosTokens = origem.ultimosTokens;
  }

  return atual;
}

function obterResumoUsoGroqChave(tipo = "motor", mes = chaveMesLocalBilling()) {
  const canal = normalizarTipoChaveGroq(tipo);
  const fingerprint = obterFingerprintChaveGroqConfigurada(canal);
  const chaveConfigurada = chaveGroqSeguraConfigurada(canal);

  if (!fingerprint) {
    return {
      ...criarDiaUsoGroqPorChaveVazio(),
      canal,
      configurada: chaveConfigurada,
      fingerprint: "",
      fingerprintCurto: "",
      primeiroUsoEm: null,
      ultimoUsoEm: null,
      mes,
    };
  }

  const dados = carregarUsoGroqPorChavePersistido();
  const registro = dados?.chaves?.[fingerprint] || {};
  let acumulado = criarDiaUsoGroqPorChaveVazio();

  for (const [dia, registroDia] of Object.entries(registro?.dias || {})) {
    if (!String(dia).startsWith(`${mes}-`)) {
      continue;
    }

    acumulado = somarDiaUsoGroqPorChave(acumulado, registroDia?.[canal] || {});
  }

  return {
    ...acumulado,
    canal,
    configurada: chaveConfigurada,
    fingerprint,
    fingerprintCurto: fingerprint.slice(0, 8),
    primeiroUsoEm: Number(registro?.primeiroUsoEm || 0) || null,
    ultimoUsoEm: Number(registro?.ultimoUsoEm || 0) || null,
    mes,
  };
}

function numeroTokenGroq(valor) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) && numero > 0 ? Math.floor(numero) : 0;
}

function normalizarUsoModeloGroq(valor = {}) {
  return {
    chamadas: Math.max(0, Number(valor?.chamadas || 0) || 0),
    promptTokens: Math.max(0, Number(valor?.promptTokens || 0) || 0),
    completionTokens: Math.max(0, Number(valor?.completionTokens || 0) || 0),
    totalTokens: Math.max(0, Number(valor?.totalTokens || 0) || 0),
    ultimaChamadaEm: Number(valor?.ultimaChamadaEm || 0) || null,
    ultimoStatus: Number(valor?.ultimoStatus || 0) || null,
    ultimosTokens: Math.max(0, Number(valor?.ultimosTokens || 0) || 0),
  };
}

function somarUsoModeloGroq(destino = {}, origem = {}) {
  const a = normalizarUsoModeloGroq(destino);
  const b = normalizarUsoModeloGroq(origem);

  const bMaisRecente =
    Number(b.ultimaChamadaEm || 0) > Number(a.ultimaChamadaEm || 0);

  return {
    chamadas: a.chamadas + b.chamadas,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    ultimaChamadaEm: bMaisRecente ? b.ultimaChamadaEm : a.ultimaChamadaEm,
    ultimoStatus: bMaisRecente ? b.ultimoStatus : a.ultimoStatus,
    ultimosTokens: bMaisRecente ? b.ultimosTokens : a.ultimosTokens,
  };
}

function chaveModeloUsoGroq(modelo) {
  const id = String(modelo || "")
    .trim()
    .toLowerCase();

  if (id.includes("qwen/qwen3.6-27b")) {
    return "qwen36";
  }

  if (id.includes("qwen/qwen3.8-27b")) {
    return "qwen38";
  }

  if (id.includes("openai/gpt-oss-120b")) {
    return "gptOss120b";
  }

  if (id.includes("groq/compound-mini")) {
    return "compoundMini";
  }

  return "outros";
}

function modelosUsoGroqComMigracao(atual = {}) {
  const existentes =
    atual?.modelos && typeof atual.modelos === "object" ? atual.modelos : {};

  const modelos = {
    qwen36: normalizarUsoModeloGroq(existentes.qwen36),
    qwen38: normalizarUsoModeloGroq(existentes.qwen38),
    gptOss120b: normalizarUsoModeloGroq(existentes.gptOss120b),
    compoundMini: normalizarUsoModeloGroq(existentes.compoundMini),
    outros: normalizarUsoModeloGroq(existentes.outros),
    naoClassificado: normalizarUsoModeloGroq(existentes.naoClassificado),
  };

  const possuiSeparacao = Object.values(modelos).some(
    (item) => item.chamadas > 0 || item.totalTokens > 0,
  );

  // Uso registrado antes desta versao nao pode ser separado por modelo
  // com seguranca. Mantemos o total antigo em um bucket explicito para
  // nao perder historico nem inventar uma distribuicao.
  if (!possuiSeparacao) {
    const totalAntigo = Math.max(0, Number(atual?.totalTokens || 0) || 0);
    const chamadasAntigas = Math.max(0, Number(atual?.chamadas || 0) || 0);

    if (totalAntigo > 0 || chamadasAntigas > 0) {
      modelos.naoClassificado = normalizarUsoModeloGroq({
        chamadas: chamadasAntigas,
        promptTokens: atual?.promptTokens,
        completionTokens: atual?.completionTokens,
        totalTokens: totalAntigo,
        ultimaChamadaEm: atual?.ultimaChamadaEm,
        ultimoStatus: atual?.ultimoStatus,
        ultimosTokens: atual?.ultimosTokens,
      });
    }
  }

  return modelos;
}

function criarUsoGroqVazio() {
  return {
    chamadas: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    ultimaChamadaEm: null,
    ultimoStatus: null,
    ultimosTokens: 0,
    modelos: {
      qwen36: normalizarUsoModeloGroq(),
      qwen38: normalizarUsoModeloGroq(),
      gptOss120b: normalizarUsoModeloGroq(),
      compoundMini: normalizarUsoModeloGroq(),
      outros: normalizarUsoModeloGroq(),
      naoClassificado: normalizarUsoModeloGroq(),
    },
  };
}

function somarDiaNoUsoGroq(acumulado, dia = {}) {
  const resultado = acumulado || criarUsoGroqVazio();
  const ultimaDia = Number(dia?.ultimaChamadaEm || 0) || 0;
  const ultimaAtual = Number(resultado.ultimaChamadaEm || 0) || 0;

  resultado.chamadas += Math.max(0, Number(dia?.chamadas || 0) || 0);
  resultado.promptTokens += Math.max(0, Number(dia?.promptTokens || 0) || 0);
  resultado.completionTokens += Math.max(
    0,
    Number(dia?.completionTokens || 0) || 0,
  );
  resultado.totalTokens += Math.max(0, Number(dia?.totalTokens || 0) || 0);

  if (ultimaDia > ultimaAtual) {
    resultado.ultimaChamadaEm = ultimaDia;
    resultado.ultimoStatus = Number(dia?.ultimoStatus || 0) || null;
    resultado.ultimosTokens = Math.max(0, Number(dia?.ultimosTokens || 0) || 0);
  }

  const modelos = modelosUsoGroqComMigracao(dia);

  for (const chave of [
    "qwen36",
    "qwen38",
    "gptOss120b",
    "compoundMini",
    "outros",
    "naoClassificado",
  ]) {
    resultado.modelos[chave] = somarUsoModeloGroq(
      resultado.modelos[chave],
      modelos[chave],
    );
  }

  return resultado;
}

function somarEventoNoUsoGroq(acumulado, evento = {}) {
  const resultado = acumulado || criarUsoGroqVazio();
  const em = Number(evento?.em || 0) || 0;
  const status = Number(evento?.status || 0) || 0;
  const promptTokens = numeroTokenGroq(evento?.promptTokens);
  const completionTokens = numeroTokenGroq(evento?.completionTokens);
  const totalTokens = numeroTokenGroq(evento?.totalTokens);
  const chaveModelo = [
    "qwen36",
    "qwen38",
    "gptOss120b",
    "compoundMini",
    "outros",
  ].includes(String(evento?.modelo || ""))
    ? String(evento.modelo)
    : "outros";

  resultado.chamadas += 1;
  resultado.promptTokens += promptTokens;
  resultado.completionTokens += completionTokens;
  resultado.totalTokens += totalTokens;

  if (em > Number(resultado.ultimaChamadaEm || 0)) {
    resultado.ultimaChamadaEm = em;
    resultado.ultimoStatus = status || null;
    resultado.ultimosTokens = totalTokens;
  }

  resultado.modelos[chaveModelo] = somarUsoModeloGroq(
    resultado.modelos[chaveModelo],
    {
      chamadas: 1,
      promptTokens,
      completionTokens,
      totalTokens,
      ultimaChamadaEm: em,
      ultimoStatus: status,
      ultimosTokens: totalTokens,
    },
  );

  return resultado;
}

function limitesPeriodoUsoGroq(periodo = "dia", agora = Date.now()) {
  const id = ["hora", "dia", "semana", "mes"].includes(String(periodo))
    ? String(periodo)
    : "dia";

  let inicio = dataLocalInicioDia(agora).getTime();

  if (id === "hora") {
    inicio = agora - 60 * 60 * 1000;
  } else if (id === "semana") {
    inicio = dataLocalInicioSemana(agora).getTime();
  } else if (id === "mes") {
    inicio = dataLocalInicioMes(agora).getTime();
  }

  return {
    periodo: id,
    inicioEm: inicio,
    fimEm: agora,
  };
}

function obterUsoGroqPeriodo(periodo = "dia") {
  const agora = Date.now();
  const limites = limitesPeriodoUsoGroq(periodo, agora);
  const dados = carregarUsoGroqPersistido();
  let acumulado = criarUsoGroqVazio();

  if (limites.periodo === "hora") {
    for (const dia of Object.values(dados.dias || {})) {
      const eventos = Array.isArray(dia?.eventos) ? dia.eventos : [];

      for (const evento of eventos) {
        const em = Number(evento?.em || 0) || 0;

        if (em >= limites.inicioEm && em <= limites.fimEm) {
          acumulado = somarEventoNoUsoGroq(acumulado, evento);
        }
      }
    }
  } else {
    for (const [chave, dia] of Object.entries(dados.dias || {})) {
      const inicioDia = new Date(`${chave}T00:00:00`).getTime();

      if (!Number.isFinite(inicioDia)) {
        continue;
      }

      if (inicioDia >= limites.inicioEm && inicioDia <= limites.fimEm) {
        acumulado = somarDiaNoUsoGroq(acumulado, dia);
      }
    }
  }

  const eventosDesde = Number(dados?.eventosDesde || 0) || null;
  const horaCompleta =
    limites.periodo !== "hora" ||
    (!!eventosDesde && eventosDesde <= limites.inicioEm);

  // Os totais operacionais consideram os modelos ativos do motor:
  // GPT-OSS 120B + Compound Mini + Qwen 3.6 Vision.
  // O historico antigo do Qwen 3.8 continua preservado separadamente.
  const usoTextoWeb = somarUsoModeloGroq(
    acumulado.modelos?.gptOss120b,
    acumulado.modelos?.compoundMini,
  );
  const usoAtivo = somarUsoModeloGroq(usoTextoWeb, acumulado.modelos?.qwen36);

  return {
    ...acumulado,
    chamadas: usoAtivo.chamadas,
    promptTokens: usoAtivo.promptTokens,
    completionTokens: usoAtivo.completionTokens,
    totalTokens: usoAtivo.totalTokens,
    ultimaChamadaEm: usoAtivo.ultimaChamadaEm,
    ultimoStatus: usoAtivo.ultimoStatus,
    ultimosTokens: usoAtivo.ultimosTokens,
    periodo: limites.periodo,
    inicioEm: limites.inicioEm,
    fimEm: limites.fimEm,
    eventosDesde,
    horaCompleta,
    referenciasFree: {
      qwen36TokensDia: 200000,
      qwen36RequestsDia: 1000,
      qwen38TokensDia: 200000,
      qwen38RequestsDia: 1000,
      gptOss120bTokensDia: 200000,
      gptOss120bRequestsDia: 1000,
      compoundMiniRequestsDia: 250,
      compoundMiniTokensMinuto: 70000,
    },
  };
}

function obterUsoGroqHoje() {
  return obterUsoGroqPeriodo("dia");
}

function contarPesquisasWebCobraveisGroq(payload) {
  try {
    const ferramentas = payload?.choices?.[0]?.message?.executed_tools;

    if (!Array.isArray(ferramentas)) {
      return 0;
    }

    return ferramentas.filter((item) => {
      const tipo = String(
        item?.type || item?.tool_name || item?.name || "",
      ).toLowerCase();
      const resultados = item?.search_results?.results;

      return (
        tipo.includes("search") ||
        tipo.includes("web_search") ||
        (Array.isArray(resultados) && resultados.length > 0)
      );
    }).length;
  } catch {
    return 0;
  }
}

function numeroFinanceiroBilling(valor) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

function arredondarFinanceiroBilling(valor, casas = 10) {
  const numero = Number(valor || 0);

  if (!Number.isFinite(numero)) {
    return 0;
  }

  const fator = 10 ** Math.max(0, Math.min(12, Number(casas) || 0));
  return Math.round(numero * fator) / fator;
}

function extrairUsoCobravelGroq(payload = {}) {
  const detalhamento = Array.isArray(payload?.usage_breakdown?.models)
    ? payload.usage_breakdown.models
    : [];

  const usos = detalhamento.length
    ? detalhamento.map((item) => item?.usage || {})
    : [payload?.usage || {}];

  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;

  for (const uso of usos) {
    const prompt = numeroTokenGroq(uso?.prompt_tokens);
    const completion = numeroTokenGroq(uso?.completion_tokens);
    const cache = Math.min(
      prompt,
      numeroTokenGroq(uso?.prompt_tokens_details?.cached_tokens),
    );

    promptTokens += prompt;
    completionTokens += completion;
    cachedTokens += cache;
  }

  return {
    promptTokens,
    completionTokens,
    cachedTokens,
    promptNaoCacheados: Math.max(0, promptTokens - cachedTokens),
  };
}

function duracaoTranscricaoGroqSegundos(payload = {}) {
  const direta = Number(
    payload?._whatsiapp_audio_seconds ?? payload?.duration ?? 0,
  );

  if (Number.isFinite(direta) && direta > 0) {
    return direta;
  }

  const segmentos = Array.isArray(payload?.segments) ? payload.segments : [];
  let maiorFim = 0;

  for (const segmento of segmentos) {
    const fim = Number(segmento?.end || 0);

    if (Number.isFinite(fim) && fim > maiorFim) {
      maiorFim = fim;
    }
  }

  return maiorFim;
}

function calcularCustoGroq(payload = {}, modeloSolicitado = "") {
  const precificacao = obterPrecificacaoIAAdmin();
  const uso = extrairUsoCobravelGroq(payload);
  const modeloEfetivo =
    String(payload?.model || "").trim() ||
    String(modeloSolicitado || "").trim();
  const modeloMinusculo = modeloEfetivo.toLowerCase();
  const ehWhisperTurbo = modeloMinusculo.includes("whisper-large-v3-turbo");

  if (ehWhisperTurbo) {
    const duracaoSegundos = duracaoTranscricaoGroqSegundos(payload);
    const segundosCobrados =
      duracaoSegundos > 0 ? Math.max(10, duracaoSegundos) : 0;
    const custoUsd = (segundosCobrados / 3600) * GROQ_WHISPER_TURBO_USD_HORA;
    const custoBrl = custoUsd * precificacao.usdBrl;

    return {
      modelo: modeloEfetivo || GROQ_MODELO_TRANSCRICAO,
      pesquisasWeb: 0,
      cachedTokens: 0,
      custoTokensUsd: arredondarFinanceiroBilling(custoUsd),
      custoFerramentasUsd: 0,
      custoUsd: arredondarFinanceiroBilling(custoUsd),
      custoBrl: arredondarFinanceiroBilling(custoBrl),
      usdBrl: precificacao.usdBrl,
    };
  }

  const ehCompound = modeloMinusculo.includes("compound");
  const pesquisasWeb = ehCompound
    ? contarPesquisasWebCobraveisGroq(payload)
    : 0;

  const ehQwen36 = modeloEfetivo.toLowerCase().includes("qwen/qwen3.6-27b");
  const promptTotal = uso.promptNaoCacheados + uso.cachedTokens;
  const custoEntradaUsd = ehQwen36
    ? (promptTotal / 1_000_000) * GROQ_QWEN36_ENTRADA_USD_MILHAO
    : (uso.promptNaoCacheados / 1_000_000) *
      precificacao.gptOssEntradaUsdMilhao;
  const custoCacheUsd = ehQwen36
    ? 0
    : (uso.cachedTokens / 1_000_000) * precificacao.gptOssCacheUsdMilhao;
  const custoSaidaUsd = ehQwen36
    ? (uso.completionTokens / 1_000_000) * GROQ_QWEN36_SAIDA_USD_MILHAO
    : (uso.completionTokens / 1_000_000) * precificacao.gptOssSaidaUsdMilhao;
  const custoPesquisaUsd =
    (pesquisasWeb / 1000) * precificacao.webSearchBasicaUsdMil;

  const custoUsd =
    custoEntradaUsd + custoCacheUsd + custoSaidaUsd + custoPesquisaUsd;
  const custoBrl = custoUsd * precificacao.usdBrl;

  return {
    modelo: modeloEfetivo || GROQ_MODELO_PADRAO,
    pesquisasWeb,
    cachedTokens: uso.cachedTokens,
    custoTokensUsd: arredondarFinanceiroBilling(
      custoEntradaUsd + custoCacheUsd + custoSaidaUsd,
    ),
    custoFerramentasUsd: arredondarFinanceiroBilling(custoPesquisaUsd),
    custoUsd: arredondarFinanceiroBilling(custoUsd),
    custoBrl: arredondarFinanceiroBilling(custoBrl),
    usdBrl: precificacao.usdBrl,
  };
}

function registrarUsoGroq(
  statusCode,
  payload = null,
  modeloSolicitado = "",
  apiKeyUsada = "",
) {
  const status = Number(statusCode || 0) || 0;

  // So contamos respostas que efetivamente vieram da API.
  if (status <= 0) {
    return;
  }

  try {
    const agora = Date.now();
    const chave = chaveDiaLocal(agora);
    const dados = carregarUsoGroqPersistido();
    const anterior = dados.dias[chave] || {};
    const usage = payload?.usage || {};

    const promptTokens = numeroTokenGroq(usage.prompt_tokens);
    const completionTokens = numeroTokenGroq(usage.completion_tokens);
    const totalInformado = numeroTokenGroq(usage.total_tokens);
    const totalTokens =
      totalInformado || Math.max(0, promptTokens + completionTokens);
    const contextoCobranca = contextoCobrancaGroqAtual();
    const resumoBillingAntes = contextoCobranca.faturavel
      ? obterResumoBillingIAAtual()
      : null;
    const custo = calcularCustoGroq(payload || {}, modeloSolicitado);
    const custoUsdFaturavel = contextoCobranca.faturavel ? custo.custoUsd : 0;
    const custoBrlFaturavel = contextoCobranca.faturavel ? custo.custoBrl : 0;
    const pesquisasWebFaturaveis = contextoCobranca.faturavel
      ? custo.pesquisasWeb
      : 0;

    const modeloEfetivo =
      String(payload?.model || "").trim() ||
      String(modeloSolicitado || "").trim();
    const chaveModelo = chaveModeloUsoGroq(modeloEfetivo);
    const modelos = modelosUsoGroqComMigracao(anterior);
    const anteriorModelo = normalizarUsoModeloGroq(modelos[chaveModelo]);

    modelos[chaveModelo] = {
      chamadas: anteriorModelo.chamadas + 1,
      promptTokens: anteriorModelo.promptTokens + promptTokens,
      completionTokens: anteriorModelo.completionTokens + completionTokens,
      totalTokens: anteriorModelo.totalTokens + totalTokens,
      ultimaChamadaEm: agora,
      ultimoStatus: status,
      ultimosTokens: totalTokens,
    };

    const eventos = Array.isArray(anterior?.eventos)
      ? anterior.eventos.slice(-2499)
      : [];

    eventos.push({
      em: agora,
      modelo: chaveModelo,
      status,
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: custo.cachedTokens,
      pesquisasWeb: custo.pesquisasWeb,
      faturavel: contextoCobranca.faturavel,
      origemBilling: contextoCobranca.origem,
      custoUsd: custo.custoUsd,
      custoBrl: custo.custoBrl,
      custoUsdFaturavel,
      custoBrlFaturavel,
      usdBrl: custo.usdBrl,
    });

    dados.eventosDesde = Number(dados?.eventosDesde || 0) || agora;
    dados.billingDesde = Number(dados?.billingDesde || 0) || agora;

    dados.dias[chave] = {
      chamadas: Math.max(0, Number(anterior.chamadas || 0) || 0) + 1,
      promptTokens:
        Math.max(0, Number(anterior.promptTokens || 0) || 0) + promptTokens,
      completionTokens:
        Math.max(0, Number(anterior.completionTokens || 0) || 0) +
        completionTokens,
      totalTokens:
        Math.max(0, Number(anterior.totalTokens || 0) || 0) + totalTokens,
      custoUsdTotal:
        numeroFinanceiroBilling(anterior.custoUsdTotal) + custo.custoUsd,
      custoBrlTotal:
        numeroFinanceiroBilling(anterior.custoBrlTotal) + custo.custoBrl,
      custoUsdFaturavel:
        numeroFinanceiroBilling(anterior.custoUsdFaturavel) + custoUsdFaturavel,
      custoBrlFaturavel:
        numeroFinanceiroBilling(anterior.custoBrlFaturavel) + custoBrlFaturavel,
      pesquisasWebTotal:
        Math.max(0, Number(anterior.pesquisasWebTotal || 0) || 0) +
        custo.pesquisasWeb,
      pesquisasWebFaturaveis:
        Math.max(0, Number(anterior.pesquisasWebFaturaveis || 0) || 0) +
        pesquisasWebFaturaveis,
      chamadasFaturaveis:
        Math.max(0, Number(anterior.chamadasFaturaveis || 0) || 0) +
        (contextoCobranca.faturavel && custo.custoUsd > 0 ? 1 : 0),
      ultimaChamadaEm: agora,
      ultimoStatus: status,
      ultimosTokens: totalTokens,
      modelos,
      eventos,
    };

    if (
      resumoBillingAntes &&
      contextoCobranca.faturavel &&
      custoBrlFaturavel > 0
    ) {
      const consumidoDepois = arredondarFinanceiroBilling(
        resumoBillingAntes.consumidoBrl + custoBrlFaturavel,
      );
      const saldoDepois = Math.max(
        0,
        resumoBillingAntes.orcamentoBrl - consumidoDepois,
      );
      const percentualDepois =
        resumoBillingAntes.orcamentoBrl > 0
          ? Math.min(
              100,
              (consumidoDepois / resumoBillingAntes.orcamentoBrl) * 100,
            )
          : 100;
      const resumoBillingDepois = {
        ...resumoBillingAntes,
        consumidoBrl: consumidoDepois,
        saldoBrl: arredondarFinanceiroBilling(saldoDepois),
        percentual: arredondarFinanceiroBilling(percentualDepois, 4),
        atingido:
          resumoBillingAntes.orcamentoBrl <= 0 ||
          consumidoDepois >= resumoBillingAntes.orcamentoBrl,
      };

      processarAvisosBillingAposUso(resumoBillingDepois, dados, agora);
    }

    salvarUsoGroqPersistido(dados);

    registrarUsoGroqPorChave({
      apiKey: apiKeyUsada,
      contextoCobranca,
      status,
      promptTokens,
      completionTokens,
      totalTokens,
      custo,
    });

    console.log(
      `[BILLING IA] USO | origem=${contextoCobranca.origem} | canal=${contextoCobranca.canalApi} | faturavel=${contextoCobranca.faturavel} | modelo=${chaveModelo} | custoBRL=${custo.custoBrl.toFixed(6)} | pesquisas=${custo.pesquisasWeb}`,
    );

    enviarParaTela("uso-groq-atualizado", {
      atualizadoEm: agora,
    });
    enviarParaTela("billing-ia-atualizado", {
      atualizadoEm: agora,
    });
  } catch (erro) {
    console.warn("Groq usage register failed:", erro?.message || erro);
  }
}

function aguardarGroq(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
}

function parseDuracaoGroqMs(valor) {
  const texto = String(valor || "")
    .trim()
    .toLowerCase();

  if (!texto) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(texto)) {
    return Math.ceil(Number(texto) * 1000);
  }

  let total = 0;
  let encontrou = false;
  const regex = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
  let match = null;

  while ((match = regex.exec(texto))) {
    encontrou = true;
    const numero = Number(match[1]);
    const unidade = match[2];

    if (!Number.isFinite(numero)) {
      continue;
    }

    if (unidade === "ms") total += numero;
    else if (unidade === "h") total += numero * 60 * 60 * 1000;
    else if (unidade === "m") total += numero * 60 * 1000;
    else if (unidade === "s") total += numero * 1000;
  }

  return encontrou && total > 0 ? Math.ceil(total) : null;
}

function obterEsperaRetryAfterGroq(headers = {}, payload = null) {
  const retryAfter = headers?.["retry-after"];

  if (retryAfter !== undefined && retryAfter !== null) {
    const texto = String(retryAfter).trim();

    if (/^\d+(?:\.\d+)?$/.test(texto)) {
      const ms = Math.ceil(Number(texto) * 1000);
      if (ms > 0) return ms;
    }

    const data = Date.parse(texto);
    if (Number.isFinite(data)) {
      const ms = data - Date.now();
      if (ms > 0) return ms;
    }
  }

  const restantesTokens = Number(headers?.["x-ratelimit-remaining-tokens"]);
  const restantesRequests = Number(headers?.["x-ratelimit-remaining-requests"]);

  if (Number.isFinite(restantesTokens) && restantesTokens <= 0) {
    const ms = parseDuracaoGroqMs(headers?.["x-ratelimit-reset-tokens"]);
    if (ms) return ms;
  }

  if (Number.isFinite(restantesRequests) && restantesRequests <= 0) {
    const ms = parseDuracaoGroqMs(headers?.["x-ratelimit-reset-requests"]);
    if (ms) return ms;
  }

  for (const cabecalho of [
    "x-ratelimit-reset-tokens",
    "x-ratelimit-reset-requests",
  ]) {
    const ms = parseDuracaoGroqMs(headers?.[cabecalho]);
    if (ms && ms <= GROQ_MAX_ESPERA_RETRY_429_MS) {
      return ms;
    }
  }

  const mensagem = String(payload?.error?.message || "");
  const trecho = mensagem.match(
    /(?:try\s+again\s+in|retry\s+after)\s+([0-9.]+\s*(?:ms|h|m|s)(?:\s*[0-9.]+\s*(?:ms|h|m|s))?)/i,
  );

  if (trecho?.[1]) {
    const ms = parseDuracaoGroqMs(trecho[1]);
    if (ms) return ms;
  }

  return 5000;
}

function requisitarGroqUmaVez(corpo, apiKey, headersExtras = {}) {
  let modeloSolicitado = "";

  try {
    modeloSolicitado = String(JSON.parse(corpo)?.model || "").trim();
  } catch {}

  const contextoCobranca = contextoCobrancaGroqAtual();

  if (contextoCobranca.faturavel) {
    const limite = verificarOrcamentoBillingDisponivel();

    if (!limite.ok) {
      console.warn(
        `[BILLING IA] LIMITE_ATINGIDO | plano=${limite.plano} | consumido=${limite.consumidoBrl.toFixed(4)} | orcamento=${limite.orcamentoBrl.toFixed(2)}`,
      );

      garantirAvisoBloqueioBilling(limite);

      return Promise.resolve({
        statusCode: 0,
        headers: {},
        payload: null,
        bruto: "",
        billingBloqueado: true,
        erro:
          `O limite mensal de IA do plano ${limite.nomePlano} foi atingido. ` +
          `Orçamento: R$ ${limite.orcamentoBrl.toFixed(2).replace(".", ",")}.`,
      });
    }
  }

  return new Promise((resolve) => {
    let finalizado = false;

    const finalizar = (resultado) => {
      if (finalizado) return;
      finalizado = true;
      resolve(resultado);
    };

    const requisicao = https.request(
      {
        hostname: GROQ_API_HOST,
        path: GROQ_API_PATH,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(corpo),
          ...(headersExtras && typeof headersExtras === "object"
            ? headersExtras
            : {}),
        },
        timeout: 30000,
      },
      (resposta) => {
        let bruto = "";

        resposta.setEncoding("utf8");

        resposta.on("data", (parte) => {
          bruto += parte;

          if (bruto.length > 2_000_000) {
            requisicao.destroy(
              new Error("Resposta da Groq maior que o esperado."),
            );
          }
        });

        resposta.on("end", () => {
          let payload = null;

          try {
            payload = bruto ? JSON.parse(bruto) : null;
          } catch {}

          const statusCode = Number(resposta.statusCode || 0);

          registrarUsoGroq(statusCode, payload, modeloSolicitado, apiKey);

          finalizar({
            statusCode,
            headers: resposta.headers || {},
            payload,
            bruto,
          });
        });
      },
    );

    requisicao.on("timeout", () => {
      requisicao.destroy(new Error("A Groq demorou demais para responder."));
    });

    requisicao.on("error", (erro) => {
      finalizar({
        statusCode: 0,
        headers: {},
        payload: null,
        bruto: "",
        erro: erro?.message || "Não foi possível acessar a Groq.",
      });
    });

    requisicao.write(corpo);
    requisicao.end();
  });
}

async function requisitarGroqComRetry(
  corpo,
  apiKey,
  maxRetries = GROQ_MAX_RETRIES_429,
  headersExtras = {},
) {
  let tentativa = 0;

  while (true) {
    const resultado = await requisitarGroqUmaVez(corpo, apiKey, headersExtras);

    if (resultado.statusCode !== 429) {
      return {
        ...resultado,
        tentativas: tentativa + 1,
      };
    }

    const esperaBase = obterEsperaRetryAfterGroq(
      resultado.headers,
      resultado.payload,
    );

    const podeTentarNovamente =
      tentativa < maxRetries &&
      esperaBase > 0 &&
      esperaBase <= GROQ_MAX_ESPERA_RETRY_429_MS;

    if (!podeTentarNovamente) {
      return {
        ...resultado,
        tentativas: tentativa + 1,
        esperaSugeridaMs: esperaBase,
      };
    }

    tentativa += 1;

    // Pequena folga evita repetir exatamente no instante em que a janela vira.
    const esperaMs = Math.min(
      GROQ_MAX_ESPERA_RETRY_429_MS,
      Math.ceil(esperaBase + 350),
    );

    console.warn(
      `Groq 429. Retry ${tentativa}/${maxRetries} in ${esperaMs}ms.`,
    );

    await aguardarGroq(esperaMs);
  }
}

function limitarInteiroContextoGroq(valor, minimo, maximo, padrao) {
  const numero = Math.trunc(Number(valor));

  if (!Number.isFinite(numero)) {
    return padrao;
  }

  return Math.min(maximo, Math.max(minimo, numero));
}

function normalizarLimitesContextoGroq(dados = {}) {
  const limites = dados?.limitesContexto || {};
  const permissoesPlano = obterPermissoesPlanoAdmin();

  const limiteMensagens = Math.min(
    permissoesPlano.maxMensagens,
    limitarInteiroContextoGroq(limites?.limiteMensagens, 1, 200, 15),
  );
  const promptPersonalizadoMaximo = Math.min(
    permissoesPlano.maxPromptPersonalizado,
    limitarInteiroContextoGroq(
      limites?.promptPersonalizadoMaximo ?? limites?.promptMaximo,
      500,
      20000,
      3000,
    ),
  );
  const limiteTokensContexto = Math.min(
    permissoesPlano.maxTokensContexto,
    limitarInteiroContextoGroq(limites?.limiteTokensContexto, 512, 32000, 2000),
  );

  return {
    limiteMensagens,
    promptPersonalizadoMaximo,
    limiteTokensContexto,
  };
}

function montarPromptsSistemaGroq(
  dados = {},
  limitesContexto = {},
  fallback = "",
) {
  // O prompt interno e protegido: nunca e truncado pelo nivel de contexto.
  // O limite do plano vale apenas para o prompt personalizado do usuario.
  const promptInternoAdmin = obterMotorIAAdmin();
  const promptInterno = String(
    promptInternoAdmin || dados?.promptInterno || dados?.promptBase || "",
  ).trim();

  const promptPersonalizado = String(dados?.promptPersonalizado || "")
    .trim()
    .slice(0, limitesContexto.promptPersonalizadoMaximo || 3000);

  return {
    promptInterno: promptInterno || String(fallback || "").trim(),
    promptPersonalizado,
  };
}

function custoCaracteresMensagensGroq(mensagens = []) {
  return (Array.isArray(mensagens) ? mensagens : []).reduce(
    (total, item) => total + String(item?.content || "").length + 24,
    0,
  );
}

function cortarConteudoGroq(valor, maximo) {
  const texto = String(valor || "").trim();
  const limite = Math.max(0, Math.trunc(Number(maximo) || 0));

  if (!texto || texto.length <= limite) {
    return texto;
  }

  if (limite <= 3) {
    return texto.slice(0, limite);
  }

  return `${texto.slice(0, limite - 3).trimEnd()}...`;
}

function aplicarLimiteContextoGroq({
  systemContent,
  historico = [],
  mensagemAtual = null,
  limiteTokensContexto = 2000,
  protegerUltimaHistorico = false,
} = {}) {
  // Nao existe parametro de limite de tokens de entrada na API. O WhatsIAPP
  // aplica uma estimativa conservadora antes da chamada e o uso real continua
  // sendo registrado a partir do usage devolvido pela Groq.
  const limiteCaracteres = Math.max(1536, limiteTokensContexto * 3);
  // systemContent continua sendo recebido para manter a assinatura da funcao,
  // mas nao entra no orcamento de contexto da conversa.
  String(systemContent || "").trim();
  const historicoFinal = (Array.isArray(historico) ? historico : []).map(
    (item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content || "").trim(),
    }),
  );
  let mensagemAtualFinal =
    mensagemAtual === null || mensagemAtual === undefined
      ? null
      : String(mensagemAtual || "").trim();

  // O limite de contexto configurado pelo usuario vale para a conversa.
  // O Motor do WhatsIAPP e o Prompt Personalizado possuem regras/limites
  // proprios e nao podem expulsar mensagens antigas da janela de contexto.
  const custoAtual = () =>
    custoCaracteresMensagensGroq(historicoFinal) +
    (mensagemAtualFinal ? mensagemAtualFinal.length + 24 : 0);

  const minimoHistorico =
    protegerUltimaHistorico && historicoFinal.length ? 1 : 0;

  while (
    historicoFinal.length > minimoHistorico &&
    custoAtual() > limiteCaracteres
  ) {
    historicoFinal.shift();
  }

  if (custoAtual() > limiteCaracteres && mensagemAtualFinal) {
    const excesso = custoAtual() - limiteCaracteres;
    const novoLimite = Math.max(320, mensagemAtualFinal.length - excesso - 32);
    mensagemAtualFinal = cortarConteudoGroq(mensagemAtualFinal, novoLimite);
  }

  if (
    custoAtual() > limiteCaracteres &&
    protegerUltimaHistorico &&
    historicoFinal.length
  ) {
    const ultima = historicoFinal[historicoFinal.length - 1];
    const excesso = custoAtual() - limiteCaracteres;
    const novoLimite = Math.max(320, ultima.content.length - excesso - 32);

    ultima.content = cortarConteudoGroq(ultima.content, novoLimite);
  }

  return {
    historico: historicoFinal.filter((item) => item.content),
    mensagemAtual: mensagemAtualFinal,
  };
}

function normalizarMensagensGroq(lista, limiteMensagens = 30) {
  return (Array.isArray(lista) ? lista : [])
    .slice(-limiteMensagens)
    .map((item) => {
      const role =
        String(item?.role || "").trim() === "assistant" ? "assistant" : "user";
      const content = String(item?.content || "")
        .trim()
        .slice(0, 2200);

      return content
        ? {
            role,
            content,
          }
        : null;
    })
    .filter(Boolean);
}

function extrairObjetoSugestoesGroq(textoBruto) {
  let texto = String(textoBruto || "").trim();

  if (!texto) {
    return null;
  }

  texto = texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");

  if (inicio >= 0 && fim > inicio) {
    texto = texto.slice(inicio, fim + 1);
  }

  let objeto = null;

  try {
    objeto = JSON.parse(texto);
  } catch {
    return null;
  }

  const sugestoes = {
    positiva: String(objeto?.positiva || "").trim(),
    neutra: String(objeto?.neutra || "").trim(),
    negativa: String(objeto?.negativa || "").trim(),
  };

  if (!sugestoes.positiva || !sugestoes.neutra || !sugestoes.negativa) {
    return null;
  }

  return sugestoes;
}

function sugestaoGroqTemConteudoInterno(valor) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return true;
  }

  const padroesBloqueados = [
    /<\/?think>/i,
    /\bneed\s+final\b/i,
    /\buse\s+final\b/i,
    /\breasoning\b/i,
    /\banalysis\s*:/i,
    /\bassistant\s*:/i,
    /\bsystem\s*:/i,
    /\bdeveloper\s*:/i,
  ];

  return padroesBloqueados.some((padrao) => padrao.test(texto));
}

function sugestoesGroqSaoSeguras(sugestoes) {
  if (!sugestoes) {
    return false;
  }

  return [sugestoes.positiva, sugestoes.neutra, sugestoes.negativa].every(
    (texto) => !sugestaoGroqTemConteudoInterno(texto),
  );
}

function extrairMensagemAtualCatalogoIA(dados = {}) {
  const explicita = String(dados?.mensagemAtual || "").trim();

  if (explicita) {
    return explicita.slice(0, 4000);
  }

  const listas = [dados?.mensagens, dados?.mensagensAnteriores];

  for (const lista of listas) {
    if (!Array.isArray(lista)) {
      continue;
    }

    for (let i = lista.length - 1; i >= 0; i -= 1) {
      const item = lista[i];
      const role = String(item?.role || "")
        .trim()
        .toLowerCase();
      const content = String(item?.content || "").trim();

      if (role === "user" && content) {
        return content.slice(0, 4000);
      }
    }
  }

  return "";
}

function termoRaroNoCatalogoIA(termo, indice) {
  const token = canonizarTokenCatalogo(termo);

  if (!token || !Array.isArray(indice?.blocos) || !indice.blocos.length) {
    return false;
  }

  const totalBlocos = indice.blocos.length;
  let documentos = 0;

  for (const bloco of indice.blocos) {
    const tokens = new Set(tokenizarBuscaCatalogo(bloco?.texto));

    if (tokens.has(token)) {
      documentos += 1;
    }
  }

  const limiteRaro = Math.max(3, Math.ceil(totalBlocos * 0.25));

  return documentos > 0 && documentos <= limiteRaro;
}

const ancorasCatalogoIAPorConversa = new Map();

function chaveConversaCatalogoIA(dados = {}) {
  return String(dados?.conversaId || "")
    .trim()
    .slice(0, 320);
}

function limparAncorasCatalogoIA() {
  ancorasCatalogoIAPorConversa.clear();
}

function ehContinuacaoReferencialCatalogoIA(valor) {
  const texto = normalizarRespostaSemWebGroq(valor);

  if (!texto || texto.length > 280) {
    return false;
  }

  const palavras = texto.split(/\s+/).filter(Boolean);

  // Referencia explicita ao assunto anterior.
  if (
    /\b(ele|ela|eles|elas|esse|essa|esses|essas|isso|isto|aquele|aquela|aqueles|aquelas|dele|dela|deles|delas|desse|dessa|desses|dessas|deste|desta|destes|destas|daquele|daquela|daqueles|daquelas|nele|nela|neles|nelas|nesse|nessa|nesses|nessas|neste|nesta|nestes|nestas|naquele|naquela|naqueles|naquelas|mesmo|mesma|mesmos|mesmas)\b/.test(
      texto,
    )
  ) {
    return true;
  }

  // "este/esta" e ambiguo depois da normalizacao, porque "esta" tambem
  // representa o verbo "esta". So tratamos como referencia de catalogo
  // quando acompanha um substantivo tipico de produto. Isso evita falsos
  // follow-ups como "esta noite".
  if (
    /\b(?:este|esta|estes|estas)\s+(?:produto|produtos|item|itens|modelo|modelos|peca|pecas|bolsa|bolsas|vestido|vestidos|blusa|blusas|calca|calcas|camisa|camisas|sapato|sapatos|tenis|sandalia|sandalias|acessorio|acessorios|cor|cores|opcao|opcoes)\b/.test(
      texto,
    )
  ) {
    return true;
  }

  // Pedidos naturalmente dependentes do que acabou de ser mencionado.
  if (
    /\b(mais informacoes|mais detalhes|me fala mais|fala mais|pode falar mais|pode explicar mais|o que mais|tem mais|quais tem no catalogo|qual tem no catalogo|o que tem no catalogo|quais estao no catalogo)\b/.test(
      texto,
    )
  ) {
    return true;
  }

  // Atributos curtos de produto tambem sao continuacao mesmo sem pronome.
  // Isso fica restrito ao motor de catalogo. Nao altera web, factual ou clima.
  if (palavras.length <= 12) {
    const atributoProduto =
      /^(?:(?:qual|quais|quanto|quantos|quantas)\b.*\b(?:tamanho|tamanhos|numeracao|numeracoes|numero|numeros|cor|cores|material|tecido|preco|valor|estoque|disponibilidade)|(?:tem|possui|esta|esta disponivel|disponivel|vende|vem)\b.*\b(?:tamanho|tamanhos|numeracao|numeracoes|numero|numeros|cor|cores|material|tecido|estoque|disponivel|disponibilidade)|(?:qual|quais)\b.*\b(?:disponivel|disponiveis)|(?:tem|possui)\s+(?:do|da|no|na)?\s*\d{1,3}\b)/.test(
        texto,
      );

    if (atributoProduto) {
      return true;
    }
  }

  // Conectores curtos continuam funcionando como antes.
  if (palavras.length <= 9) {
    return /^(e |mas |entao |e ai |nesse caso |nesse item )(?:(?:tem|qual|quais|quanto|quantos|quantas|como|onde|quando)\b|(?:o|a|os|as)\b)/.test(
      texto,
    );
  }

  return false;
}

function mensagensHistoricasCatalogoIA(dados = {}, mensagemAtual = "") {
  const lista = Array.isArray(dados?.mensagensAnteriores)
    ? dados.mensagensAnteriores
    : Array.isArray(dados?.mensagens)
      ? dados.mensagens
      : [];
  const atualNormalizada = normalizarRespostaSemWebGroq(mensagemAtual);
  const historico = [];

  for (let i = lista.length - 1; i >= 0 && historico.length < 4; i -= 1) {
    const item = lista[i];
    const role = String(item?.role || "")
      .trim()
      .toLowerCase();
    const content = String(item?.content || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!content || !["user", "assistant"].includes(role)) {
      continue;
    }

    if (
      historico.length === 0 &&
      atualNormalizada &&
      normalizarRespostaSemWebGroq(content) === atualNormalizada
    ) {
      continue;
    }

    historico.push({ role, content: content.slice(0, 900) });
  }

  return historico.reverse();
}

function montarConsultaHistoricaCatalogoIA(dados = {}, mensagemAtual = "") {
  const historico = mensagensHistoricasCatalogoIA(dados, mensagemAtual);

  if (!historico.length) {
    return "";
  }

  const partes = historico
    .slice(-3)
    .map((item) => item.content)
    .filter(Boolean);

  if (mensagemAtual) {
    partes.push(String(mensagemAtual).trim());
  }

  return partes.join(" ").replace(/\s+/g, " ").trim().slice(-1800);
}

function avaliarBuscaCatalogoParaIA(busca) {
  const resultados = Array.isArray(busca?.resultados) ? busca.resultados : [];
  const melhor = resultados[0] || null;

  if (!busca?.ok || !melhor) {
    return {
      relevante: false,
      resultados: [],
      melhor: null,
      coberturaFactual: 0,
      pontuacao: 0,
    };
  }

  const indice = lerIndiceCatalogoCliente();
  const termosFatuais = Array.isArray(melhor?.termosFatuais)
    ? melhor.termosFatuais
    : [];
  const possuiTermoEspecial = termosFatuais.some(tokenEhCodigoOuNumeroCatalogo);
  const possuiTermoRaro = termosFatuais.some((termo) =>
    termoRaroNoCatalogoIA(termo, indice),
  );
  const coberturaFactual = Number(melhor?.coberturaFactual || 0) || 0;
  const pontuacao = Number(melhor?.pontuacao || 0) || 0;

  const relevante =
    termosFatuais.length > 0 &&
    (possuiTermoEspecial ||
      possuiTermoRaro ||
      (coberturaFactual >= 0.6 && pontuacao >= 10));

  return {
    relevante,
    resultados: relevante ? resultados : [],
    melhor,
    coberturaFactual,
    pontuacao,
  };
}

function avaliarBuscaHistoricaCatalogoParaIA(busca) {
  const base = avaliarBuscaCatalogoParaIA(busca);
  const coberturaFactual = Number(base?.coberturaFactual || 0) || 0;
  const pontuacao = Number(base?.pontuacao || 0) || 0;

  // Follow-up historico precisa ter aderencia real ao assunto anterior.
  // Um termo raro isolado do PDF nao pode sequestrar web ou conversa normal.
  const relevante =
    !!base?.relevante && coberturaFactual >= 0.3 && pontuacao >= 20;

  if (base?.relevante && !relevante) {
    console.log(
      `[CATALOGO IA] FOLLOWUP_REJECT | source=history | coverage=${coberturaFactual.toFixed(2)} | score=${pontuacao.toFixed(2)} | reason=weak_history_match`,
    );
  }

  return {
    ...base,
    relevante,
    resultados: relevante ? base.resultados : [],
  };
}

function criarSetTermosCatalogoComCanonicos(valores = []) {
  const termos = new Set();

  for (const valor of valores) {
    const original = String(valor || "").trim();
    const canonico = canonizarTokenCatalogo(original);

    if (original) {
      termos.add(original);
    }

    if (canonico) {
      termos.add(canonico);
    }
  }

  return termos;
}

function rotuloCategoriaProdutoCatalogoIA(termo) {
  const canonico = canonizarTokenCatalogo(termo);

  if (!canonico) {
    return String(termo || "").trim();
  }

  for (const candidato of TERMOS_CATEGORIA_PRODUTO_CATALOGO_IA) {
    if (canonizarTokenCatalogo(candidato) === canonico) {
      return candidato;
    }
  }

  return String(termo || "").trim();
}

const TERMOS_CATEGORIA_PRODUTO_CATALOGO_IA = criarSetTermosCatalogoComCanonicos(
  [
    "bolsa",
    "mochila",
    "vestido",
    "blusa",
    "calca",
    "camisa",
    "camiseta",
    "short",
    "saia",
    "casaco",
    "jaqueta",
    "tenis",
    "sapato",
    "sandalia",
    "chinelo",
    "bota",
    "acessorio",
    "brinco",
    "colar",
    "pulseira",
    "anel",
    "cosmetico",
    "gloss",
    "batom",
    "lip",
    "perfume",
    "produto",
    "item",
    "modelo",
  ],
);

const TERMOS_INTENCAO_CONSULTA_CATALOGO_IA = criarSetTermosCatalogoComCanonicos(
  [
    "preco",
    "precos",
    "valor",
    "valores",
    "quanto",
    "custa",
    "custam",
    "custar",
    "hoje",
    "agora",
    "atual",
    "atualmente",
    "mais",
    "menos",
    "barato",
    "barata",
    "baratos",
    "baratas",
    "caro",
    "cara",
    "caros",
    "caras",
    "melhor",
    "melhores",
    "pior",
    "piores",
    "maior",
    "menor",
    "informacao",
    "informacoes",
    "detalhe",
    "detalhes",
    "modelo",
    "modelos",
    "produto",
    "produtos",
    "item",
    "itens",
    "sobre",
    "queria",
    "gostaria",
    "saber",
    "diz",
    "fala",
    "fale",
  ],
);

const TERMOS_DISPONIBILIDADE_CATALOGO_IA = criarSetTermosCatalogoComCanonicos([
  "tem",
  "temos",
  "vende",
  "vendem",
  "vender",
  "disponivel",
  "disponiveis",
  "estoque",
  "possui",
  "possuem",
  "trabalha",
  "trabalham",
]);

function consultaTemIntencaoDisponibilidadeCatalogoIA(consulta) {
  const tokens = tokenizarBuscaCatalogo(consulta);

  return tokens.some((termo) => TERMOS_DISPONIBILIDADE_CATALOGO_IA.has(termo));
}

function existeFraseIdentidadeCatalogoIA(consulta, melhor, indice) {
  const termos = termosBuscaCatalogo(consulta).termos.filter(Boolean);
  const textoCatalogo = normalizarBuscaCatalogo(melhor?.texto || "");

  if (!termos.length || !textoCatalogo) {
    return false;
  }

  for (let tamanho = Math.min(5, termos.length); tamanho >= 2; tamanho -= 1) {
    for (let inicio = 0; inicio + tamanho <= termos.length; inicio += 1) {
      const grupo = termos.slice(inicio, inicio + tamanho);

      if (
        grupo.every((termo) => TERMOS_INTENCAO_CONSULTA_CATALOGO_IA.has(termo))
      ) {
        continue;
      }

      if (!grupo.some((termo) => termoRaroNoCatalogoIA(termo, indice))) {
        continue;
      }

      const frase = grupo.join(" ");

      if (frase.length >= 5 && textoCatalogo.includes(frase)) {
        return true;
      }
    }
  }

  return false;
}

function avaliarBuscaDiretaCatalogoParaRoteamentoIA(busca, consulta) {
  const base = avaliarBuscaCatalogoParaIA(busca);
  const melhor = base.melhor;

  if (!busca?.ok || !melhor) {
    return {
      ...base,
      relevante: false,
      coberturaIdentidade: 0,
      termosIdentidade: [],
      termosIdentidadeEncontrados: [],
    };
  }

  const consultaInfo = termosBuscaCatalogo(consulta);
  let termosIdentidade = consultaInfo.termos.filter(
    (termo) => !TERMOS_INTENCAO_CONSULTA_CATALOGO_IA.has(termo),
  );

  if (!termosIdentidade.length) {
    termosIdentidade = consultaInfo.termos.slice();
  }

  const encontradosFatuais = new Set(
    Array.isArray(melhor?.termosFatuais) ? melhor.termosFatuais : [],
  );
  const termosIdentidadeEncontrados = termosIdentidade.filter((termo) =>
    encontradosFatuais.has(termo),
  );
  const coberturaIdentidade =
    termosIdentidadeEncontrados.length / Math.max(1, termosIdentidade.length);

  const indice = lerIndiceCatalogoCliente();
  const possuiIdentidadeEspecial = termosIdentidadeEncontrados.some(
    tokenEhCodigoOuNumeroCatalogo,
  );
  const possuiIdentidadeRara = termosIdentidadeEncontrados.some((termo) =>
    termoRaroNoCatalogoIA(termo, indice),
  );

  // Para decidir a FONTE, somos mais conservadores do que a busca usada para
  // exibir resultados. Uma palavra generica isolada do PDF nao pode sequestrar
  // uma pergunta sobre outro assunto e impedir a pesquisa web.
  const fraseIdentidadeExata = existeFraseIdentidadeCatalogoIA(
    consulta,
    melhor,
    indice,
  );

  const termosCategoriaConsulta = termosIdentidade.filter((termo) =>
    TERMOS_CATEGORIA_PRODUTO_CATALOGO_IA.has(termo),
  );
  const termosCategoriaEncontrados = termosCategoriaConsulta.filter((termo) =>
    encontradosFatuais.has(termo),
  );
  const termosNomeEncontrados = termosIdentidadeEncontrados.filter(
    (termo) => !TERMOS_CATEGORIA_PRODUTO_CATALOGO_IA.has(termo),
  );
  const possuiNomeRaroEncontrado = termosNomeEncontrados.some((termo) =>
    termoRaroNoCatalogoIA(termo, indice),
  );
  const intencaoDisponibilidade =
    consultaTemIntencaoDisponibilidadeCatalogoIA(consulta);

  // Perguntas como "essa e a bolsa Luna?" possuem uma categoria generica
  // (bolsa) e um nome especifico (Luna). O nome raro encontrado no catalogo
  // deve ser suficiente para escolher o catalogo como fonte, mesmo quando a
  // cobertura total cai por causa da categoria ou de outras palavras da frase.
  // Isso nao faz uma foto generica de bolsa cair no catalogo: e obrigatorio
  // existir, no texto do usuario, um termo nominal especifico encontrado.
  const pontuacaoDireta = Number(base?.pontuacao || 0) || 0;
  const mencaoNominalProduto =
    termosCategoriaConsulta.length > 0 &&
    termosNomeEncontrados.length > 0 &&
    possuiNomeRaroEncontrado &&
    pontuacaoDireta >= 35;

  // Consultas comerciais explicitas por categoria, como
  // "tem brinco pra vender?", devem usar o catalogo quando a propria
  // categoria aparece nos resultados. A intencao explicita e obrigatoria,
  // evitando que uma simples conversa sobre brincos/bolsas sequestre a rota.
  const mencaoCategoriaDisponibilidade =
    intencaoDisponibilidade &&
    termosCategoriaEncontrados.length > 0 &&
    pontuacaoDireta >= 30;

  const identidadeSuficiente =
    termosIdentidadeEncontrados.length > 0 &&
    (coberturaIdentidade >= 0.75 ||
      fraseIdentidadeExata ||
      mencaoNominalProduto ||
      mencaoCategoriaDisponibilidade ||
      (termosIdentidade.length === 1 &&
        (possuiIdentidadeEspecial || possuiIdentidadeRara)));

  return {
    ...base,
    relevante: !!identidadeSuficiente,
    resultados: identidadeSuficiente ? base.resultados : [],
    coberturaIdentidade,
    termosIdentidade,
    termosIdentidadeEncontrados,
    fraseIdentidadeExata,
    mencaoNominalProduto,
    mencaoCategoriaDisponibilidade,
  };
}

function salvarAncoraCatalogoIA(dados, contexto) {
  const conversaId = chaveConversaCatalogoIA(dados);

  if (!conversaId || !contexto?.relevante || !contexto?.contexto) {
    return;
  }

  ancorasCatalogoIAPorConversa.set(conversaId, {
    contexto: String(contexto.contexto || "").slice(0, 4200),
    resultados: Array.isArray(contexto.resultados)
      ? contexto.resultados.slice(0, 4)
      : [],
    consulta: String(contexto.consulta || "").slice(0, 1800),
    atualizadoEm: Date.now(),
  });

  if (ancorasCatalogoIAPorConversa.size > 250) {
    const ordenadas = Array.from(ancorasCatalogoIAPorConversa.entries()).sort(
      (a, b) =>
        Number(a[1]?.atualizadoEm || 0) - Number(b[1]?.atualizadoEm || 0),
    );

    for (const [chave] of ordenadas.slice(
      0,
      ancorasCatalogoIAPorConversa.size - 250,
    )) {
      ancorasCatalogoIAPorConversa.delete(chave);
    }
  }
}

function obterAncoraCatalogoIA(dados = {}) {
  const conversaId = chaveConversaCatalogoIA(dados);

  if (!conversaId) {
    return null;
  }

  const ancora = ancorasCatalogoIAPorConversa.get(conversaId);

  if (!ancora) {
    return null;
  }

  const ttl = 2 * 60 * 60 * 1000;

  if (Date.now() - Number(ancora.atualizadoEm || 0) > ttl) {
    ancorasCatalogoIAPorConversa.delete(conversaId);
    return null;
  }

  return ancora;
}

function ehReferenciaNominalCurtaDaAncoraCatalogoIA(consulta, ancora) {
  const texto = normalizarRespostaSemWebGroq(consulta);

  if (!texto || texto.length > 220 || !ancora?.contexto) {
    return false;
  }

  const palavras = texto.split(/\s+/).filter(Boolean);

  if (palavras.length > 14) {
    return false;
  }

  // So amplia o follow-up quando existe uma pergunta fechada de atributo.
  // A referencia nominal precisa compartilhar termos reais com a ancora
  // anterior do catalogo, evitando transformar frases comuns em catalogo.
  const perguntaFechadaDeAtributo =
    /\b(?:e|eh|sao)\s+(?:feito|feita|feitos|feitas|fabricado|fabricada|fabricados|fabricadas|confeccionado|confeccionada|de|em|com)\b|\b(?:tem|possui|contem|inclui|acompanha|vem\s+com)\b/.test(
      texto,
    );

  if (!perguntaFechadaDeAtributo) {
    return false;
  }

  const termosConsulta = tokenizarBuscaCatalogo(texto, {
    removerStopwords: true,
  }).filter((termo) => termo.length >= 3);

  if (!termosConsulta.length) {
    return false;
  }

  const textoAncora = `${String(ancora.consulta || "")} ${String(
    ancora.contexto || "",
  )}`;
  const termosAncora = new Set(
    tokenizarBuscaCatalogo(textoAncora, { removerStopwords: true }),
  );
  const sobreposicao = termosConsulta.filter((termo) =>
    termosAncora.has(termo),
  );

  if (sobreposicao.length >= 2) {
    return true;
  }

  const indice = lerIndiceCatalogoCliente();

  return sobreposicao.some((termo) => termoRaroNoCatalogoIA(termo, indice));
}

function montarContextoResultadosCatalogoIA(resultados = [], limite = 4) {
  const partes = [];
  let caracteres = 0;
  const maxCaracteres = 4200;

  for (const item of resultados.slice(0, Math.min(4, Math.max(1, limite)))) {
    const texto = String(item?.texto || "").trim();

    if (!texto) {
      continue;
    }

    const cabecalho = `[Pagina ${Math.max(1, Number(item?.pagina || 1) || 1)}]`;
    const trecho = `${cabecalho}\n${texto}`;

    if (partes.length && caracteres + trecho.length > maxCaracteres) {
      break;
    }

    const restante = Math.max(0, maxCaracteres - caracteres);
    const final = trecho.slice(0, restante);

    if (!final) {
      break;
    }

    partes.push(final);
    caracteres += final.length;

    if (caracteres >= maxCaracteres) {
      break;
    }
  }

  return partes.join("\n\n").trim();
}

function prepararContextoCatalogoIA(dados = {}, limite = 4) {
  // O renderer e a fonte de verdade da rota final. Quando ele trava a fonte
  // como nao-catalogo, o index nao pode redescobrir uma ancora antiga e
  // reintroduzir catalogo por conta propria. Isso evita cruzamentos entre
  // catalogo, web, factual e conversa normal.
  if (dados?.usarCatalogo === false) {
    return {
      relevante: false,
      contexto: "",
      resultados: [],
      consulta: extrairMensagemAtualCatalogoIA(dados),
      modo: "bloqueado_pela_rota",
    };
  }

  const consulta = extrairMensagemAtualCatalogoIA(dados);

  if (!consulta) {
    return {
      relevante: false,
      contexto: "",
      resultados: [],
      consulta: "",
      modo: "sem_consulta",
    };
  }

  const forcarContinuacao = dados?.catalogoEhContinuacao === true;
  let buscaDireta = null;

  try {
    buscaDireta = buscarNoIndiceCatalogo(consulta, limite);
  } catch (erro) {
    console.warn(
      `[CATALOGO IA] SEARCH_ERROR | ${String(erro?.message || erro || "erro")
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 180)}`,
    );
  }

  const avaliacaoDireta = avaliarBuscaDiretaCatalogoParaRoteamentoIA(
    buscaDireta,
    consulta,
  );

  if (!forcarContinuacao && avaliacaoDireta.relevante) {
    const contexto = montarContextoResultadosCatalogoIA(
      avaliacaoDireta.resultados,
      limite,
    );
    const retorno = {
      relevante: !!contexto,
      contexto,
      resultados: avaliacaoDireta.resultados,
      consulta,
      modo: "direto",
    };

    console.log(
      `[CATALOGO IA] MATCH | mode=direct | results=${avaliacaoDireta.resultados.length} | used=${Math.min(avaliacaoDireta.resultados.length, Math.min(4, Math.max(1, limite)))} | chars=${contexto.length} | coverage=${avaliacaoDireta.coberturaFactual.toFixed(2)} | identity=${avaliacaoDireta.coberturaIdentidade.toFixed(2)} | score=${avaliacaoDireta.pontuacao.toFixed(2)}`,
    );

    salvarAncoraCatalogoIA(dados, retorno);
    return retorno;
  }

  let ehContinuacao =
    forcarContinuacao || ehContinuacaoReferencialCatalogoIA(consulta);

  if (!ehContinuacao) {
    const ancoraAtual = obterAncoraCatalogoIA(dados);

    if (ehReferenciaNominalCurtaDaAncoraCatalogoIA(consulta, ancoraAtual)) {
      ehContinuacao = true;

      console.log(
        "[CATALOGO IA] FOLLOWUP_REFERENCE | source=anchor_terms | matched=true",
      );
    }
  }

  if (ehContinuacao) {
    const consultaHistorica = montarConsultaHistoricaCatalogoIA(
      dados,
      consulta,
    );

    if (consultaHistorica) {
      try {
        const buscaHistorica = buscarNoIndiceCatalogo(
          consultaHistorica,
          limite,
        );
        const avaliacaoHistorica =
          avaliarBuscaHistoricaCatalogoParaIA(buscaHistorica);

        if (avaliacaoHistorica.relevante) {
          const contexto = montarContextoResultadosCatalogoIA(
            avaliacaoHistorica.resultados,
            limite,
          );
          const retorno = {
            relevante: !!contexto,
            contexto,
            resultados: avaliacaoHistorica.resultados,
            consulta,
            consultaResolvida: consultaHistorica,
            modo: "continuacao_historico",
          };

          console.log(
            `[CATALOGO IA] FOLLOWUP_MATCH | source=history | results=${avaliacaoHistorica.resultados.length} | chars=${contexto.length} | coverage=${avaliacaoHistorica.coberturaFactual.toFixed(2)} | score=${avaliacaoHistorica.pontuacao.toFixed(2)}`,
          );

          salvarAncoraCatalogoIA(dados, retorno);
          return retorno;
        }
      } catch (erro) {
        console.warn(
          `[CATALOGO IA] FOLLOWUP_SEARCH_ERROR | ${String(
            erro?.message || erro || "erro",
          )
            .replace(/[^\x20-\x7E]/g, "")
            .slice(0, 180)}`,
        );
      }
    }

    const ancora = obterAncoraCatalogoIA(dados);

    if (ancora?.contexto) {
      console.log(
        `[CATALOGO IA] FOLLOWUP_MATCH | source=anchor | results=${Array.isArray(ancora.resultados) ? ancora.resultados.length : 0} | chars=${String(ancora.contexto || "").length}`,
      );

      return {
        relevante: true,
        contexto: String(ancora.contexto || ""),
        resultados: Array.isArray(ancora.resultados) ? ancora.resultados : [],
        consulta,
        consultaResolvida: ancora.consulta || "",
        modo: "continuacao_ancora",
      };
    }
  } else {
    const conversaId = chaveConversaCatalogoIA(dados);

    if (conversaId) {
      ancorasCatalogoIAPorConversa.delete(conversaId);
    }
  }

  console.log(
    `[CATALOGO IA] NO_MATCH | results=${Array.isArray(buscaDireta?.resultados) ? buscaDireta.resultados.length : 0} | coverage=${avaliacaoDireta.coberturaFactual.toFixed(2)} | score=${avaliacaoDireta.pontuacao.toFixed(2)} | followup=${ehContinuacao}`,
  );

  return {
    relevante: false,
    contexto: "",
    resultados: [],
    consulta,
    modo: ehContinuacao ? "continuacao_sem_ancora" : "sem_match",
  };
}

function blocoInstrucoesCatalogoIA(contextoCatalogo) {
  const contexto = String(contextoCatalogo || "").trim();

  if (!contexto) {
    return "";
  }

  return [
    "LOCAL CATALOG CONTEXT - STRICT CLOSED-WORLD MODE.",
    "The text below was retrieved from the company's active local PDF catalog because it matched the customer's current message or a clear follow-up to the previous catalog subject.",
    "CATALOG GROUNDING OVERRIDE: for every factual statement about the catalog, item, service, model or option, the CATALOG EXCERPTS below are the ONLY allowed source of truth. This rule overrides conversational helpfulness, personalization, sales language and general world knowledge.",
    "Treat the excerpts as a CLOSED WORLD: if a detail is not explicitly written there, it is unknown. Never infer, complete, assume, generalize or invent material, composition, dimensions, size, features, compatibility, colors, variants, stock, availability, prices, guarantees, specifications, category-typical properties or any other catalog detail.",
    "Do not turn the product name or category into attributes. For example, knowing that something is a ring, shoe, bag, service or accessory does not authorize you to infer material, size, finish, stock, use, compatibility or construction.",
    "Earlier user or assistant messages are conversation context only, never evidence for catalog facts. If an earlier assistant claim is not explicitly supported by the current excerpts, ignore it and do not repeat it.",
    "For follow-up requests such as 'tell me more', 'more information', 'what else', 'and about it?', answer only with additional facts explicitly present in the excerpts. If there are no additional supported facts, say naturally that the catalog does not provide further details about that item.",
    "If multiple excerpts match and the customer asks for a comparison, compare only facts explicitly supplied in those excerpts.",
    "Before returning the answer, silently verify every catalog-specific noun phrase, adjective, number and availability/specification claim against the excerpts. Remove anything that cannot be directly supported.",
    "Use only excerpts relevant to the current question. Do not mention retrieval, indexing, internal chunks or the PDF unless the conversation naturally requires it.",
    `CATALOG EXCERPTS\n${contexto}`,
  ].join("\n\n");
}

function respostaCatalogoDeterministicaFatoAusenteIA(
  mensagemAtual,
  contextoCatalogo,
  resultadosCatalogo = [],
) {
  const pergunta = normalizarBuscaCatalogo(mensagemAtual);
  const contexto = normalizarBuscaCatalogo(contextoCatalogo);
  const contextoAtributo = normalizarBuscaCatalogo(
    Array.isArray(resultadosCatalogo) && resultadosCatalogo[0]?.texto
      ? resultadosCatalogo[0].texto
      : contextoCatalogo,
  );

  if (!pergunta || !contexto) {
    return null;
  }

  // Perguntas comerciais de existencia por categoria, como
  // "tem brinco pra vender?", nao sao perguntas de atributo. Se a categoria
  // aparece no trecho recuperado, a existencia no catalogo esta sustentada.
  // Ja em "esse vestido tem forro?", a categoria vem antes do verbo de posse:
  // isso e uma pergunta sobre atributo e deve seguir para ATTRIBUTE_CHECK.
  const matchVerboPosse = pergunta.match(
    /\b(?:tem|possui|contem|inclui|acompanha)\b/,
  );
  const trechoAntesVerboPosse = matchVerboPosse
    ? pergunta.slice(0, matchVerboPosse.index)
    : "";
  const categoriaAntesDoVerboPosse = tokenizarBuscaCatalogo(
    trechoAntesVerboPosse,
  ).some((termo) => TERMOS_CATEGORIA_PRODUTO_CATALOGO_IA.has(termo));

  if (
    consultaTemIntencaoDisponibilidadeCatalogoIA(pergunta) &&
    !categoriaAntesDoVerboPosse
  ) {
    const tokensConsulta = tokenizarBuscaCatalogo(pergunta);
    const categorias = tokensConsulta.filter((termo) =>
      TERMOS_CATEGORIA_PRODUTO_CATALOGO_IA.has(termo),
    );
    const categoriaEncontrada = categorias.find((termo) =>
      contexto.includes(termo),
    );
    const termosNeutros = new Set([
      "pra",
      "para",
      "venda",
      "vendas",
      "catalogo",
    ]);
    const extras = tokensConsulta.filter(
      (termo) =>
        !STOPWORDS_BUSCA_CATALOGO.has(termo) &&
        !TERMOS_DISPONIBILIDADE_CATALOGO_IA.has(termo) &&
        !TERMOS_CATEGORIA_PRODUTO_CATALOGO_IA.has(termo) &&
        !termosNeutros.has(termo),
    );

    if (categoriaEncontrada && extras.length === 0) {
      const rotuloCategoria =
        rotuloCategoriaProdutoCatalogoIA(categoriaEncontrada);
      return `Sim, tem ${rotuloCategoria} no catálogo.`;
    }

    return null;
  }

  // Esta trava e SOMENTE para afirmacoes fechadas de sim/nao,
  // como "ele e de couro?" ou "ela e impermeavel?".
  // Perguntas abertas de atributo, como "quais tamanhos tem?",
  // "quais numeracoes estao disponiveis?" ou "qual o material?",
  // devem seguir para o catalogo normal e nunca cair nesta trava.
  if (
    /^(qual|quais|quanto|quantos|quantas|onde|quando|como|quem)\b/.test(
      pergunta,
    )
  ) {
    return null;
  }

  // Se houver estrutura interrogativa aberta ou verbo de preco/tempo,
  // nao e uma afirmacao fechada de atributo.
  if (
    /\b(qual|quais|quanto|quantos|quantas|quando|onde|quem|custa|custam|custava|custavam|custou|custaram|valia|valiam|preco|valor|lancamento)\b/.test(
      pergunta,
    )
  ) {
    return null;
  }

  // "E no..." e "E em..." sao conectores de continuidade, nao o verbo "e".
  if (
    /^e\s+(?:no|na|nos|nas|em|quando|quanto|qual|quais|onde|como|quem)\b/.test(
      pergunta,
    )
  ) {
    return null;
  }

  let atributo = "";

  const matchCopula = pergunta.match(
    /^(?:(?:ele|ela|eles|elas|isso|isto|esse|essa|esses|essas|este|estes)\s+)?(?:e|eh|sao)\s+(.+)$/,
  );

  if (matchCopula?.[1]) {
    atributo = String(matchCopula[1] || "");
  } else {
    const matchCopulaComSujeito = pergunta.match(
      /^.{1,120}\s+(?:e|eh|sao)\s+(.+)$/,
    );

    if (matchCopulaComSujeito?.[1]) {
      atributo = String(matchCopulaComSujeito[1] || "");
    }
  }

  if (!atributo) {
    const matchPosse = pergunta.match(
      /\b(?:tem|possui|contem|inclui|acompanha)\s+(?:algum(?:a)?\s+)?(?:tipo\s+de\s+)?(.+)$/,
    );

    if (matchPosse?.[1]) {
      atributo = String(matchPosse[1] || "");
    } else {
      const matchVemComOuEm = pergunta.match(
        /\bvem\s+(?:com|em)\s+(?:algum(?:a)?\s+)?(.+)$/,
      );

      if (matchVemComOuEm?.[1]) {
        atributo = String(matchVemComOuEm[1] || "");
      }
    }
  }

  atributo = atributo
    .replace(/^(?:feito|feita|feitos|feitas)\s+/, "")
    .replace(/^de\s+/, "")
    .replace(/^(?:um|uma|algum|alguma)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!atributo) {
    return null;
  }

  const atributoNormalizado = normalizarBuscaCatalogo(atributo);

  if (!atributoNormalizado) {
    return null;
  }

  // Para perguntas atributivas de sim/nao, nao deixamos o LLM completar.
  // O atributo precisa aparecer literalmente no trecho recuperado.
  // Se nao aparecer, o catalogo nao sustenta a afirmacao.
  const sustentado = contextoAtributo.includes(atributoNormalizado);

  console.log(
    `[CATALOGO IA] ATTRIBUTE_CHECK | attr=${atributoNormalizado.slice(0, 80)} | supported=${sustentado} | groq=false`,
  );

  if (!sustentado) {
    return "O catálogo não informa esse detalhe.";
  }

  return "Sim, essa informação consta no catálogo.";
}

function pedidoExplicitoPesquisaWebNoIndex(dados = {}) {
  const texto = normalizarRespostaSemWebGroq(
    extrairMensagemAtualCatalogoIA(dados),
  );

  if (!texto) {
    return false;
  }

  return /\b(pesquisa|pesquisar|pesquise|procura|procurar|procure|busca|buscar|busque|consulta|consultar|consulte|internet|manda o link|me manda o link|tem link|qual o link)\b/.test(
    texto,
  );
}

function mimeImagemInterpretacaoIA(mediaPath = "", mimeInformado = "") {
  const mime = String(mimeInformado || "")
    .trim()
    .toLowerCase();
  if (mime.startsWith("image/")) {
    return mime;
  }

  const ext = path
    .extname(String(mediaPath || ""))
    .toLowerCase()
    .replace(".", "");
  const mapa = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
  };

  return mapa[ext] || "image/jpeg";
}

function extrairObjetoInterpretacaoImagemGroq(textoBruto) {
  let texto = String(textoBruto || "").trim();

  if (!texto) {
    return null;
  }

  texto = texto
    .replace(/^```(?:json)?\r?\n?/i, "")
    .replace(/\r?\n?```$/i, "")
    .trim();

  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");

  if (inicio >= 0 && fim > inicio) {
    texto = texto.slice(inicio, fim + 1);
  }

  try {
    const objeto = JSON.parse(texto);
    return {
      resumo: String(objeto?.resumo || "")
        .replace(/\s+/g, " ")
        .trim(),
      textoVisivel: String(objeto?.textoVisivel || "")
        .replace(/\s+/g, " ")
        .trim(),
      identificacao: String(objeto?.identificacao || "")
        .replace(/\s+/g, " ")
        .trim(),
      observacoes: String(objeto?.observacoes || "")
        .replace(/\s+/g, " ")
        .trim(),
    };
  } catch {
    return null;
  }
}

async function interpretarImagemGroq(dados = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "GROQ_CHAVE_AUSENTE",
      erro: "Chave da Groq não configurada. Abra as Configurações do WhatsIAPP e salve sua API Key.",
    };
  }

  const mediaPath = String(dados?.mediaPath || "").trim();

  if (!mediaPath) {
    return {
      ok: false,
      erro: "A imagem não informou o caminho local para análise.",
    };
  }

  if (!fs.existsSync(mediaPath)) {
    return {
      ok: false,
      erro: "A imagem não foi encontrada no disco para análise.",
    };
  }

  let bufferImagem;

  try {
    bufferImagem = fs.readFileSync(mediaPath);
  } catch (erro) {
    return {
      ok: false,
      erro: erro?.message || "Não foi possível ler a imagem para análise.",
    };
  }

  if (!bufferImagem?.length) {
    return {
      ok: false,
      erro: "A imagem está vazia ou indisponível para análise.",
    };
  }

  if (bufferImagem.length > 12 * 1024 * 1024) {
    return {
      ok: false,
      erro: "A imagem é grande demais para a análise automática atual.",
    };
  }

  const mime = mimeImagemInterpretacaoIA(mediaPath, dados?.mime);
  const dataUrl = `data:${mime};base64,${bufferImagem.toString("base64")}`;
  const textoMensagem = String(dados?.textoMensagem || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const fileName = String(dados?.fileName || path.basename(mediaPath) || "")
    .trim()
    .slice(0, 160);

  const instrucoes = [
    "Você interpreta imagens recebidas no WhatsIAPP.",
    "Analise a imagem e responda somente com JSON.",
    "Descreva de forma útil o que aparece, identifique objetos, veículos, produtos, locais ou marcas quando isso for visualmente provável.",
    "Se houver texto legível na imagem, extraia-o em textoVisivel.",
    "Quando a identificação não puder ser cravada, deixe isso claro em observacoes em vez de inventar.",
    textoMensagem ? `Texto que veio junto com a imagem: ${textoMensagem}` : "",
    fileName ? `Nome do arquivo: ${fileName}` : "",
    'Retorne JSON no formato {"resumo":"","textoVisivel":"","identificacao":"","observacoes":""}.',
  ]
    .filter(Boolean)
    .join("\n");

  const corpo = JSON.stringify({
    model: GROQ_MODELO_VISAO,
    messages: [
      {
        role: "system",
        content:
          "You are a visual interpreter for a WhatsApp assistant. Return compact Brazilian Portuguese JSON only. Never invent certainty when the image is ambiguous.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: instrucoes,
          },
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
            },
          },
        ],
      },
    ],
    temperature: 0.7,
    top_p: 0.8,
    max_completion_tokens: 700,
    reasoning_effort: "none",
    include_reasoning: false,
    response_format: {
      type: "json_object",
    },
  });

  console.log(
    `[VISAO IA] INICIO | modelo=${GROQ_MODELO_VISAO} | bytes=${bufferImagem.length} | mime=${mime}`,
  );

  let respostaHttp = await requisitarGroqComRetry(corpo, apiKey, 2);

  // Erros SSL/rede podem acontecer em uma chamada isolada. Para visao,
  // fazemos uma unica nova tentativa curta antes de desistir, sem alterar
  // a politica geral de retry das demais rotas da IA.
  if (respostaHttp.erro && !respostaHttp.statusCode) {
    console.warn(
      `[VISAO IA] RETRY_REDE | tentativa=2 | erro=${String(
        respostaHttp.erro || "erro",
      )
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 180)}`,
    );
    await aguardarGroq(700);
    respostaHttp = await requisitarGroqComRetry(corpo, apiKey, 2);
  }

  if (respostaHttp.erro && !respostaHttp.statusCode) {
    console.warn(
      `[VISAO IA] ERRO_REDE | ${String(respostaHttp.erro || "erro")
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 220)}`,
    );
    return {
      ok: false,
      erro: respostaHttp.erro,
    };
  }

  const payload = respostaHttp.payload;

  if (respostaHttp.statusCode < 200 || respostaHttp.statusCode >= 300) {
    console.warn(
      `[VISAO IA] HTTP_ERRO | status=${Number(respostaHttp.statusCode || 0)}`,
    );
    let erro =
      String(payload?.error?.message || "").trim() ||
      `Groq respondeu com HTTP ${respostaHttp.statusCode}.`;

    if (respostaHttp.statusCode === 401) {
      erro =
        "A chave da Groq foi recusada. Abra as Configurações e confira a API Key salva.";
    } else if (respostaHttp.statusCode === 429) {
      const segundos = Math.ceil(
        Number(respostaHttp.esperaSugeridaMs || 0) / 1000,
      );
      erro =
        segundos > 0 && segundos <= 60
          ? `A Groq continua temporariamente limitada. Tente novamente em cerca de ${segundos}s.`
          : "O limite de uso da Groq foi atingido. O WhatsIAPP tentou novamente automaticamente, mas a cota ainda não foi liberada.";
    }

    return {
      ok: false,
      erro,
      status: respostaHttp.statusCode,
    };
  }

  const texto = String(payload?.choices?.[0]?.message?.content || "").trim();
  const interpretacao = extrairObjetoInterpretacaoImagemGroq(texto);

  if (!interpretacao) {
    return {
      ok: false,
      erro: "A Groq respondeu, mas não retornou a interpretação da imagem no formato esperado.",
    };
  }

  console.log(
    `[VISAO IA] FIM | ok=true | modelo=${String(payload?.model || GROQ_MODELO_VISAO).replace(/[^\x20-\x7E]/g, "")} | resumo=${interpretacao.resumo.length} | texto=${interpretacao.textoVisivel.length}`,
  );

  return {
    ok: true,
    ...interpretacao,
    modelo: payload?.model || GROQ_MODELO_VISAO,
    uso: payload?.usage || null,
  };
}

function extrairTextoDocumentoImagemGroq(textoBruto) {
  let texto = String(textoBruto || "").trim();

  if (!texto) {
    return "";
  }

  texto = texto
    .replace(/^```(?:json)?\r?\n?/i, "")
    .replace(/\r?\n?```$/i, "")
    .trim();

  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");

  if (inicio >= 0 && fim > inicio) {
    texto = texto.slice(inicio, fim + 1);
  }

  try {
    const objeto = JSON.parse(texto);
    return String(objeto?.texto || "").trim();
  } catch {
    return "";
  }
}

async function interpretarDocumentoImagemGroq(dados = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "GROQ_CHAVE_AUSENTE",
      erro: "Chave da Groq nao configurada para leitura visual do PDF.",
    };
  }

  const paginas = (Array.isArray(dados?.paginas) ? dados.paginas : [])
    .map((item) => ({
      pagina: Math.max(1, Number(item?.pagina || 0) || 1),
      dataUrl: String(item?.dataUrl || "").trim(),
    }))
    .filter(
      (item) =>
        item.dataUrl &&
        /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(item.dataUrl),
    )
    .slice(0, 5);

  if (!paginas.length) {
    return {
      ok: false,
      erro: "Nenhuma pagina valida foi enviada para leitura visual do PDF.",
    };
  }

  const muitoGrande = paginas.some(
    (item) => Buffer.byteLength(item.dataUrl, "utf8") > 8 * 1024 * 1024,
  );

  if (muitoGrande) {
    return {
      ok: false,
      erro: "Uma das paginas do PDF ficou grande demais para leitura visual.",
    };
  }

  const fileName = String(dados?.fileName || "documento.pdf")
    .trim()
    .slice(0, 160);
  const conteudo = [
    {
      type: "text",
      text: [
        "Extraia fielmente o texto visivel destas paginas de um PDF escaneado.",
        "Isto e OCR para alimentar outro assistente, nao responda perguntas e nao resuma o documento.",
        "Preserve numeros, valores monetarios, datas, codigos, nomes, descricoes de itens e sinais importantes.",
        "Mantenha cada pagina identificada como [Pagina N].",
        "Se algum trecho estiver ilegivel, marque [ilegivel] em vez de inventar.",
        fileName ? `Nome do arquivo: ${fileName}` : "",
        'Retorne somente JSON no formato {"texto":"..."}.',
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  for (const item of paginas) {
    conteudo.push({
      type: "text",
      text: `Pagina ${item.pagina}`,
    });
    conteudo.push({
      type: "image_url",
      image_url: {
        url: item.dataUrl,
      },
    });
  }

  const corpo = JSON.stringify({
    model: GROQ_MODELO_VISAO,
    messages: [
      {
        role: "system",
        content:
          "You are an OCR engine for scanned documents. Return faithful Brazilian Portuguese JSON only. Never fabricate unreadable text.",
      },
      {
        role: "user",
        content: conteudo,
      },
    ],
    temperature: 0.1,
    top_p: 0.9,
    max_completion_tokens: 900,
    reasoning_effort: "none",
    include_reasoning: false,
    response_format: {
      type: "json_object",
    },
  });

  console.log(
    `[DOCUMENTO IA] OCR_INICIO | file=${fileName
      .replace(/[^\x20-\x7E]/g, "")
      .slice(0, 160)} | pages=${paginas.length} | modelo=${GROQ_MODELO_VISAO}`,
  );

  let respostaHttp = await requisitarGroqComRetry(corpo, apiKey, 2);

  if (respostaHttp.erro && !respostaHttp.statusCode) {
    await aguardarGroq(700);
    respostaHttp = await requisitarGroqComRetry(corpo, apiKey, 2);
  }

  if (respostaHttp.erro && !respostaHttp.statusCode) {
    return {
      ok: false,
      erro: respostaHttp.erro,
    };
  }

  const payload = respostaHttp.payload;

  if (respostaHttp.statusCode < 200 || respostaHttp.statusCode >= 300) {
    const erro =
      String(payload?.error?.message || "").trim() ||
      `Groq respondeu com HTTP ${respostaHttp.statusCode} na leitura visual do PDF.`;

    console.warn(
      `[DOCUMENTO IA] OCR_HTTP_ERRO | status=${Number(
        respostaHttp.statusCode || 0,
      )} | erro=${erro.replace(/[^\x20-\x7E]/g, "").slice(0, 180)}`,
    );

    return {
      ok: false,
      erro,
      status: respostaHttp.statusCode,
    };
  }

  const textoBruto = String(
    payload?.choices?.[0]?.message?.content || "",
  ).trim();
  const texto = extrairTextoDocumentoImagemGroq(textoBruto);

  if (!texto) {
    return {
      ok: false,
      erro: "A leitura visual respondeu, mas nao retornou texto extraido do PDF.",
    };
  }

  console.log(
    `[DOCUMENTO IA] OCR_FIM | ok=true | pages=${paginas.length} | chars=${texto.length} | modelo=${String(
      payload?.model || GROQ_MODELO_VISAO,
    )
      .replace(/[^\x20-\x7E]/g, "")
      .slice(0, 100)}`,
  );

  return {
    ok: true,
    texto,
    modelo: payload?.model || GROQ_MODELO_VISAO,
    uso: payload?.usage || null,
  };
}

function mimeAudioTranscricaoIA(mediaPath, mimeInformado = "") {
  const informado = String(mimeInformado || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  const mimesAceitos = new Set([
    "audio/flac",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "video/mp4",
    "video/webm",
  ]);

  if (mimesAceitos.has(informado)) {
    return informado;
  }

  const ext = path
    .extname(String(mediaPath || ""))
    .toLowerCase()
    .replace(".", "");

  const mapa = {
    flac: "audio/flac",
    mp3: "audio/mpeg",
    mp4: "audio/mp4",
    m4a: "audio/mp4",
    mpeg: "audio/mpeg",
    mpga: "audio/mpeg",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    webm: "audio/webm",
  };

  return mapa[ext] || "audio/ogg";
}

function extensaoAudioTranscricaoIA(mediaPath, mime) {
  const existente = path.extname(String(mediaPath || "")).toLowerCase();

  if (existente) {
    return existente;
  }

  const m = String(mime || "").toLowerCase();

  if (m.includes("flac")) return ".flac";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("mp4") || m.includes("m4a")) return ".m4a";
  if (m.includes("wav")) return ".wav";
  if (m.includes("webm")) return ".webm";
  return ".ogg";
}

function montarMultipartTranscricaoGroq({
  bufferAudio,
  mediaPath,
  mime,
  fileName,
}) {
  const boundary = `----whatsiapp-${crypto.randomBytes(12).toString("hex")}`;
  const partes = [];

  const adicionarCampo = (nome, valor) => {
    partes.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${nome}"\r\n\r\n` +
          `${String(valor)}\r\n`,
        "utf8",
      ),
    );
  };

  adicionarCampo("model", GROQ_MODELO_TRANSCRICAO);
  adicionarCampo("response_format", "verbose_json");
  adicionarCampo("temperature", "0");

  const extensao = extensaoAudioTranscricaoIA(mediaPath, mime);
  const nomeBase = String(fileName || path.basename(mediaPath) || "audio")
    .replace(/[\r\n"]/g, "_")
    .trim();
  const nomeFinal = path.extname(nomeBase)
    ? nomeBase
    : `${nomeBase || "audio"}${extensao}`;

  partes.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${nomeFinal}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
      "utf8",
    ),
  );
  partes.push(bufferAudio);
  partes.push(Buffer.from("\r\n", "utf8"));
  partes.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));

  return {
    boundary,
    corpo: Buffer.concat(partes),
  };
}

function requisitarTranscricaoGroqUmaVez(corpo, boundary, apiKey) {
  const contextoCobranca = contextoCobrancaGroqAtual();

  if (contextoCobranca.faturavel) {
    const limite = verificarOrcamentoBillingDisponivel();

    if (!limite.ok) {
      console.warn(
        `[BILLING IA] LIMITE_ATINGIDO | plano=${limite.plano} | consumido=${limite.consumidoBrl.toFixed(4)} | orcamento=${limite.orcamentoBrl.toFixed(2)}`,
      );

      garantirAvisoBloqueioBilling(limite);

      return Promise.resolve({
        statusCode: 0,
        headers: {},
        payload: null,
        bruto: "",
        billingBloqueado: true,
        erro:
          `O limite mensal de IA do plano ${limite.nomePlano} foi atingido. ` +
          `Orçamento: R$ ${limite.orcamentoBrl.toFixed(2).replace(".", ",")}.`,
      });
    }
  }

  return new Promise((resolve) => {
    let finalizado = false;

    const finalizar = (resultado) => {
      if (finalizado) return;
      finalizado = true;
      resolve(resultado);
    };

    const requisicao = https.request(
      {
        hostname: GROQ_API_HOST,
        path: GROQ_API_PATH_TRANSCRICAO,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": corpo.length,
        },
        timeout: 45000,
      },
      (resposta) => {
        let bruto = "";

        resposta.setEncoding("utf8");

        resposta.on("data", (parte) => {
          bruto += parte;

          if (bruto.length > 5_000_000) {
            requisicao.destroy(
              new Error("Resposta de transcricao maior que o esperado."),
            );
          }
        });

        resposta.on("end", () => {
          let payload = null;

          try {
            payload = bruto ? JSON.parse(bruto) : null;
          } catch {}

          const statusCode = Number(resposta.statusCode || 0);
          const payloadRegistro =
            payload && typeof payload === "object"
              ? {
                  ...payload,
                  model: payload?.model || GROQ_MODELO_TRANSCRICAO,
                }
              : payload;

          registrarUsoGroq(
            statusCode,
            payloadRegistro,
            GROQ_MODELO_TRANSCRICAO,
            apiKey,
          );

          finalizar({
            statusCode,
            headers: resposta.headers || {},
            payload: payloadRegistro,
            bruto,
          });
        });
      },
    );

    requisicao.on("timeout", () => {
      requisicao.destroy(
        new Error("A transcricao demorou demais para responder."),
      );
    });

    requisicao.on("error", (erro) => {
      finalizar({
        statusCode: 0,
        headers: {},
        payload: null,
        bruto: "",
        erro:
          erro?.message || "Nao foi possivel acessar a transcricao da Groq.",
      });
    });

    requisicao.end(corpo);
  });
}

async function requisitarTranscricaoGroqComRetry(
  corpo,
  boundary,
  apiKey,
  maxRetries = 2,
) {
  let tentativa = 0;

  while (true) {
    const resultado = await requisitarTranscricaoGroqUmaVez(
      corpo,
      boundary,
      apiKey,
    );

    if (resultado.statusCode !== 429 || tentativa >= maxRetries) {
      return resultado;
    }

    const espera = obterEsperaRetryAfterGroq(
      resultado.headers || {},
      resultado.payload,
    );

    if (!espera || espera > GROQ_MAX_ESPERA_RETRY_429_MS) {
      return {
        ...resultado,
        esperaSugeridaMs: espera || null,
      };
    }

    tentativa += 1;

    console.warn(
      `[TRANSCRICAO IA] RATE_LIMIT_RETRY | tentativa=${tentativa + 1} | esperaMs=${espera}`,
    );

    await aguardarGroq(espera);
  }
}

async function transcreverAudioGroq(dados = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "GROQ_CHAVE_AUSENTE",
      erro: "Chave da Groq não configurada. Abra as Configurações do WhatsIAPP e salve sua API Key.",
    };
  }

  let mediaPath = String(dados?.mediaPath || "").trim();
  let mimeInformado = String(dados?.mime || "").trim();
  let fileNameInformado = String(dados?.fileName || "").trim();

  const conversaId = String(dados?.conversaId || "").trim();
  const idMensagem = String(dados?.idMensagem || "").trim();

  const tamanhoArquivoSeguro = (caminho) => {
    try {
      if (!caminho || !fs.existsSync(caminho)) return 0;
      return Number(fs.statSync(caminho).size || 0);
    } catch {
      return 0;
    }
  };

  let tamanhoLocal = tamanhoArquivoSeguro(mediaPath);

  // Um audio real do WhatsApp nao deve chegar com poucas dezenas de bytes.
  // Quando isso acontece, o caminho veio da recepcao WPP antes de a midia
  // estar utilizavel. Recuperamos a mesma mensagem pelo Baileys, que guarda
  // a mensagem bruta e ja e a fonte oficial do IPC carregar-midia.
  if ((!mediaPath || tamanhoLocal < 512) && conversaId && idMensagem) {
    console.warn(
      `[TRANSCRICAO IA] MIDIA_LOCAL_INVALIDA | bytes=${tamanhoLocal} | fallback=baileys`,
    );

    const recuperada = await solicitarAoWorker(
      "baileys",
      "carregar-midia",
      { conversaId, idMensagem },
      30000,
    );

    const caminhoRecuperado = String(recuperada?.mediaPath || "").trim();
    const tamanhoRecuperado = tamanhoArquivoSeguro(caminhoRecuperado);

    if (recuperada?.ok && caminhoRecuperado && tamanhoRecuperado >= 512) {
      mediaPath = caminhoRecuperado;
      tamanhoLocal = tamanhoRecuperado;
      mimeInformado = String(recuperada?.mime || mimeInformado || "").trim();
      fileNameInformado = String(
        recuperada?.fileName || fileNameInformado || "",
      ).trim();

      console.log(
        `[TRANSCRICAO IA] MIDIA_RECUPERADA_BAILEYS | bytes=${tamanhoLocal}`,
      );
    }
  }

  if (!mediaPath) {
    return {
      ok: false,
      erro: "O áudio não informou o caminho local para transcrição.",
    };
  }

  if (!fs.existsSync(mediaPath)) {
    return {
      ok: false,
      erro: "O áudio não foi encontrado no disco para transcrição.",
    };
  }

  let bufferAudio;

  try {
    bufferAudio = fs.readFileSync(mediaPath);
  } catch (erro) {
    return {
      ok: false,
      erro: erro?.message || "Não foi possível ler o áudio para transcrição.",
    };
  }

  if (!bufferAudio?.length) {
    return {
      ok: false,
      erro: "O áudio está vazio ou indisponível para transcrição.",
    };
  }

  if (bufferAudio.length > 24 * 1024 * 1024) {
    return {
      ok: false,
      erro: "O áudio é grande demais para a transcrição automática atual.",
    };
  }

  const mime = mimeAudioTranscricaoIA(mediaPath, mimeInformado);
  const multipart = montarMultipartTranscricaoGroq({
    bufferAudio,
    mediaPath,
    mime,
    fileName: fileNameInformado,
  });

  console.log(
    `[TRANSCRICAO IA] INICIO | modelo=${GROQ_MODELO_TRANSCRICAO} | bytes=${bufferAudio.length} | mime=${mime}`,
  );

  let respostaHttp = await requisitarTranscricaoGroqComRetry(
    multipart.corpo,
    multipart.boundary,
    apiKey,
    2,
  );

  if (respostaHttp.erro && !respostaHttp.statusCode) {
    console.warn(
      `[TRANSCRICAO IA] RETRY_REDE | tentativa=2 | erro=${String(
        respostaHttp.erro || "erro",
      )
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 180)}`,
    );

    await aguardarGroq(700);

    respostaHttp = await requisitarTranscricaoGroqComRetry(
      multipart.corpo,
      multipart.boundary,
      apiKey,
      1,
    );
  }

  if (respostaHttp.erro && !respostaHttp.statusCode) {
    console.warn(
      `[TRANSCRICAO IA] ERRO_REDE | ${String(respostaHttp.erro || "erro")
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 220)}`,
    );

    return {
      ok: false,
      erro: respostaHttp.erro,
    };
  }

  const payload = respostaHttp.payload;

  if (respostaHttp.statusCode < 200 || respostaHttp.statusCode >= 300) {
    const detalheHttp = String(
      payload?.error?.message || respostaHttp.bruto || "sem-detalhe",
    )
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);

    console.warn(
      `[TRANSCRICAO IA] HTTP_ERRO | status=${Number(respostaHttp.statusCode || 0)} | detalhe=${detalheHttp}`,
    );

    let erro =
      String(payload?.error?.message || "").trim() ||
      `Groq respondeu com HTTP ${respostaHttp.statusCode}.`;

    if (respostaHttp.statusCode === 401) {
      erro =
        "A chave da Groq foi recusada. Abra as Configurações e confira a API Key salva.";
    } else if (respostaHttp.statusCode === 413) {
      erro = "O áudio é grande demais para ser transcrito pela Groq.";
    } else if (respostaHttp.statusCode === 429) {
      const segundos = Math.ceil(
        Number(respostaHttp.esperaSugeridaMs || 0) / 1000,
      );
      erro =
        segundos > 0 && segundos <= 60
          ? `A Groq continua temporariamente limitada. Tente novamente em cerca de ${segundos}s.`
          : "O limite de uso da transcrição foi atingido. Tente novamente em instantes.";
    }

    return {
      ok: false,
      erro,
      status: respostaHttp.statusCode,
    };
  }

  const transcricao = String(payload?.text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16000);

  if (!transcricao) {
    return {
      ok: false,
      erro: "Não foi possível identificar fala nesse áudio.",
    };
  }

  const duracaoSegundos = duracaoTranscricaoGroqSegundos(payload);
  const idioma = String(payload?.language || "").trim() || null;

  console.log(
    `[TRANSCRICAO IA] FIM | ok=true | modelo=${GROQ_MODELO_TRANSCRICAO} | chars=${transcricao.length} | duracao=${duracaoSegundos.toFixed(2)}s | idioma=${idioma || "auto"}`,
  );

  return {
    ok: true,
    transcricao,
    modelo: GROQ_MODELO_TRANSCRICAO,
    idioma,
    duracaoSegundos: duracaoSegundos || null,
  };
}

async function gerarSugestaoGroq(dados = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "GROQ_CHAVE_AUSENTE",
      erro: "Chave da Groq não configurada. Abra as Configurações do WhatsIAPP e salve sua API Key.",
    };
  }

  const limitesContexto = normalizarLimitesContextoGroq(dados);
  const historico = normalizarMensagensGroq(
    dados?.mensagens,
    limitesContexto.limiteMensagens,
  );

  if (!historico.length) {
    return {
      ok: false,
      erro: "Não há mensagens de texto suficientes para gerar sugestões.",
    };
  }

  const nomeContato = String(dados?.nomeContato || "").trim() || "o contato";
  const catalogoIA = prepararContextoCatalogoIA(dados, 4);
  const instrucoesCatalogo = blocoInstrucoesCatalogoIA(catalogoIA.contexto);
  const prompts = montarPromptsSistemaGroq(
    dados,
    limitesContexto,
    "Write natural, human WhatsApp replies using only the current conversation. Never invent missing information.",
  );

  const instrucoes = [
    prompts.promptInterno,
    prompts.promptPersonalizado
      ? `USER PERSONALIZATION\n${prompts.promptPersonalizado}`
      : "",
    `ASSISTED MODE for ${nomeContato}. Roles: user = contact; assistant = WhatsIAPP owner.`,
    "This route has NO web access. Never claim you searched online or verified current prices, availability, links, news or recent facts.",
    instrucoesCatalogo,
    "Generate three genuinely different ready-to-send replies to the latest contact message: positive, neutral and negative. Stance must not override facts or context.",
    'Return JSON only: {"positiva":"mensagem","neutra":"mensagem","negativa":"mensagem"}',
  ]
    .filter(Boolean)
    .join("\n");

  const contextoLimitado = aplicarLimiteContextoGroq({
    systemContent: instrucoes,
    historico,
    limiteTokensContexto: limitesContexto.limiteTokensContexto,
    protegerUltimaHistorico: true,
  });

  const corpo = JSON.stringify({
    model: GROQ_MODELO_PADRAO,
    messages: [
      {
        role: "system",
        content: instrucoes,
      },
      ...contextoLimitado.historico,
    ],
    temperature: catalogoIA.relevante ? 0 : 0.68,
    top_p: 0.8,
    max_completion_tokens: 1400,
    reasoning_effort: "low",
    include_reasoning: false,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "whatsiapp_tres_sugestoes",
        strict: true,
        schema: {
          type: "object",
          properties: {
            positiva: { type: "string", minLength: 1 },
            neutra: { type: "string", minLength: 1 },
            negativa: { type: "string", minLength: 1 },
          },
          required: ["positiva", "neutra", "negativa"],
          additionalProperties: false,
        },
      },
    },
  });

  const resposta = await requisitarGroqComRetry(corpo, apiKey, 2);

  if (resposta.erro && !resposta.statusCode) {
    return {
      ok: false,
      erro: resposta.erro,
    };
  }

  const payload = resposta.payload;

  if (resposta.statusCode < 200 || resposta.statusCode >= 300) {
    let erro =
      String(payload?.error?.message || "").trim() ||
      `Groq respondeu com HTTP ${resposta.statusCode}.`;

    if (resposta.statusCode === 401) {
      erro =
        "A chave da Groq foi recusada. Abra as Configurações e confira a API Key salva.";
    } else if (resposta.statusCode === 429) {
      const segundos = Math.ceil(Number(resposta.esperaSugeridaMs || 0) / 1000);
      erro =
        segundos > 0 && segundos <= 60
          ? `A Groq continua temporariamente limitada. Tente novamente em cerca de ${segundos}s.`
          : "O limite de uso da Groq foi atingido. O WhatsIAPP tentou novamente automaticamente, mas a cota ainda não foi liberada.";
    }

    return {
      ok: false,
      erro,
      status: resposta.statusCode,
    };
  }

  const texto = String(payload?.choices?.[0]?.message?.content || "").trim();

  if (!texto) {
    return {
      ok: false,
      erro: "A Groq respondeu, mas não retornou sugestões de texto.",
    };
  }

  const sugestoes = extrairObjetoSugestoesGroq(texto);

  if (sugestoes) {
    sugestoes.positiva = aplicarTravaPesquisaSemWebGroq(
      sugestoes.positiva,
      "assistido_positiva",
    );
    sugestoes.neutra = aplicarTravaPesquisaSemWebGroq(
      sugestoes.neutra,
      "assistido_neutra",
    );
    sugestoes.negativa = aplicarTravaPesquisaSemWebGroq(
      sugestoes.negativa,
      "assistido_negativa",
    );
  }

  if (!sugestoes) {
    return {
      ok: false,
      erro: "A Groq respondeu, mas não retornou as três opções no formato esperado.",
    };
  }

  if (!sugestoesGroqSaoSeguras(sugestoes)) {
    return {
      ok: false,
      erro: "A IA retornou conteúdo interno em uma sugestão e o WhatsIAPP bloqueou a resposta para não enviar texto indevido.",
    };
  }

  return {
    ok: true,
    sugestoes,
    modelo: payload?.model || GROQ_MODELO_PADRAO,
    uso: payload?.usage || null,
    tentativas: resposta.tentativas || 1,
  };
}

function normalizarMensagensAutomaticasGroq(lista, limiteMensagens = 15) {
  return (Array.isArray(lista) ? lista : [])
    .slice(-limiteMensagens)
    .map((item) => {
      const role =
        String(item?.role || "").trim() === "assistant" ? "assistant" : "user";
      const content = String(item?.content || "")
        .trim()
        .slice(0, 2400);

      return content
        ? {
            role,
            content,
          }
        : null;
    })
    .filter(Boolean);
}

function normalizarRespostaSemWebGroq(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function respostaAlegaPesquisaSemWebGroq(valor) {
  const texto = normalizarRespostaSemWebGroq(valor);

  if (!texto) {
    return false;
  }

  return (
    /\b(pesquisei|procurei|busquei|consultei|verifiquei)\b/.test(texto) ||
    /\b(olhei|dei uma olhada)\b.{0,60}\b(site|internet|loja|fonte|preco|valor)\b/.test(
      texto,
    ) ||
    /\b(nao achei|nao encontrei)\b.{0,90}\b(site|internet|fonte|lugar|loja|resultado|informacao|dado)\b/.test(
      texto,
    ) ||
    /\b(em|num|no|na)\s+(site|internet|fonte confiavel|loja online)\b/.test(
      texto,
    ) ||
    /\b(segundo|conforme)\s+(o|a|um|uma)?\s*(site|loja|fonte)\b/.test(texto)
  );
}

function aplicarTravaPesquisaSemWebGroq(valor, rota = "sem_web") {
  const resposta = String(valor || "").trim();

  if (!resposta || !respostaAlegaPesquisaSemWebGroq(resposta)) {
    return resposta;
  }

  console.log(
    `[IA SEM WEB] ALEGACAO_BLOQUEADA | rota=${String(rota || "sem_web").replace(/[^\x20-\x7E]/g, "")}`,
  );

  return "Não tenho esse dado com segurança e não consigo confirmar pela internet agora.";
}

function extrairRespostaAutomaticaGroq(textoBruto) {
  let texto = String(textoBruto || "").trim();

  if (!texto) {
    return null;
  }

  texto = texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");

  if (inicio >= 0 && fim > inicio) {
    texto = texto.slice(inicio, fim + 1);
  }

  try {
    const objeto = JSON.parse(texto);
    const resposta = String(objeto?.resposta || "").trim();
    return resposta || null;
  } catch {
    return null;
  }
}

function limparCitacoesRespostaWebGroq(valor) {
  return String(valor || "")
    .replace(/cite[^]+/g, "")
    .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function contarFontesPesquisaWebGroq(payload) {
  try {
    const ferramentas = payload?.choices?.[0]?.message?.executed_tools;

    if (!Array.isArray(ferramentas)) {
      return 0;
    }

    const urls = new Set();

    for (const ferramenta of ferramentas) {
      const resultados = ferramenta?.search_results?.results;

      if (!Array.isArray(resultados)) {
        continue;
      }

      for (const item of resultados) {
        const url = String(item?.url || "").trim();

        if (url) {
          urls.add(url);
        }
      }
    }

    return urls.size;
  } catch {
    return 0;
  }
}

function pesquisaWebFoiExecutadaGroq(payload) {
  try {
    const ferramentas = payload?.choices?.[0]?.message?.executed_tools;

    return (
      Array.isArray(ferramentas) &&
      ferramentas.some((item) => {
        const tipo = String(
          item?.type || item?.tool_name || item?.name || "",
        ).toLowerCase();

        const resultados = item?.search_results?.results;

        return (
          tipo.includes("search") ||
          (Array.isArray(resultados) && resultados.length > 0)
        );
      })
    );
  } catch {
    return false;
  }
}

function limparTrechoConsultaWebGroq(valor, maximo = 90) {
  return String(valor || "")
    .replace(/\s+/g, " ")
    .replace(/[<>[\]{}]/g, " ")
    .trim()
    .slice(0, Math.max(1, Number(maximo) || 90));
}

function contextoCurtoParaPesquisaWebGroq(lista = []) {
  const mensagens = normalizarMensagensAutomaticasGroq(lista, 2)
    .slice(-2)
    .map((item) => limparTrechoConsultaWebGroq(item?.content, 80))
    .filter(Boolean);

  return mensagens.join(" | ").slice(0, 170);
}

function contextoUsuarioParaRetryPesquisaWebGroq(lista = []) {
  const mensagens = normalizarMensagensAutomaticasGroq(lista, 4)
    .filter((item) => item?.role === "user")
    .slice(-2)
    .map((item) => limparTrechoConsultaWebGroq(item?.content, 120))
    .filter(Boolean);

  return mensagens.join(" | ").slice(0, 220);
}

function montarConsultaRetryPesquisaWebGroq(
  mensagensAnteriores = [],
  mensagemAtual = "",
) {
  const contextoUsuario =
    contextoUsuarioParaRetryPesquisaWebGroq(mensagensAnteriores);
  const atual = limparTrechoConsultaWebGroq(mensagemAtual, 140);

  return [
    "Execute web_search agora. Nao responda apenas por memoria ou pelo contexto.",
    contextoUsuario ? `Assunto anterior do contato: ${contextoUsuario}` : "",
    atual ? `Pergunta atual do contato: ${atual}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 420);
}

function montarConsultaCompactaPesquisaWebGroq(
  mensagensAnteriores = [],
  mensagemAtual = "",
) {
  const contexto = contextoCurtoParaPesquisaWebGroq(mensagensAnteriores);
  const atual = limparTrechoConsultaWebGroq(mensagemAtual, 110);

  const partes = [
    "Pesquise na web no Brasil. Nao chute valores.",
    contexto ? `Contexto: ${contexto}` : "",
    atual ? `Mensagem recebida do contato: ${atual}` : "",
  ].filter(Boolean);

  // Tavily recomenda consultas curtas, abaixo de 400 caracteres.
  // Mantemos folga para o Compound montar a busca sem estourar o provedor.
  return partes.join(" ").slice(0, 360);
}

function extrairResumoPesquisaWebGroq(payload) {
  const conteudo = String(payload?.choices?.[0]?.message?.content || "").trim();

  if (!conteudo) {
    return "";
  }

  return conteudo
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .slice(0, 2600);
}

function contarCitacoesBrowserSearchGroq(valor) {
  const texto = String(valor || "");
  const encontrados = new Set();

  for (const match of texto.matchAll(/〖(\d+)†L\d+(?:-L?\d+)?〗/g)) {
    encontrados.add(match[1]);
  }

  return encontrados.size;
}

function limparResumoBrowserSearchGroq(valor) {
  return String(valor || "")
    .replace(/〖\d+†L\d+(?:-L?\d+)?〗/g, "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6500);
}

function respostaClimaPrecisaCelsiusGroq(valor) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return false;
  }

  if (/\bfahrenheit\b|°\s*f\b/i.test(texto)) {
    return true;
  }

  // Uma temperatura com simbolo de grau sem unidade explicita e
  // ambigua. Em respostas de clima do Brasil, exigimos Celsius.
  return /-?\d{1,3}(?:[.,]\d+)?\s*°(?!\s*c\b)/i.test(texto);
}

function normalizarTextoTemporalClimaGroq(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatarDataBrClimaGroq(data) {
  const d = data instanceof Date ? data : new Date(data);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = d.getFullYear();

  return `${dia}/${mes}/${ano}`;
}

function criarDataLocalClimaGroq(base = new Date(), deslocamentoDias = 0) {
  const data = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    12,
    0,
    0,
    0,
  );

  data.setDate(data.getDate() + Number(deslocamentoDias || 0));
  return data;
}

function numeroTemporalPtClimaGroq(valor) {
  const texto = normalizarTextoTemporalClimaGroq(valor);

  if (/^\d{1,2}$/.test(texto)) {
    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : null;
  }

  const mapa = {
    zero: 0,
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,
    quatorze: 14,
    quinze: 15,
  };

  return Object.prototype.hasOwnProperty.call(mapa, texto) ? mapa[texto] : null;
}

function extrairDeslocamentoTemporalClimaGroq(valor) {
  const texto = normalizarTextoTemporalClimaGroq(valor);

  if (!texto) {
    return null;
  }

  if (/\bdepois de amanha\b/.test(texto)) {
    return 2;
  }

  if (/\bamanha\b/.test(texto)) {
    return 1;
  }

  const relativo = texto.match(
    /\b(?:daqui a|em)\s+(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze)\s+dias?\b/,
  );

  if (relativo) {
    return numeroTemporalPtClimaGroq(relativo[1]);
  }

  if (/\bhoje\b/.test(texto)) {
    return 0;
  }

  return null;
}

function obterContextoTemporalClimaGroq(mensagemAtual) {
  const hoje = criarDataLocalClimaGroq(new Date(), 0);
  const deslocamento = extrairDeslocamentoTemporalClimaGroq(mensagemAtual);
  const alvo =
    deslocamento === null ? null : criarDataLocalClimaGroq(hoje, deslocamento);

  return {
    hoje,
    alvo,
    deslocamento,
    hojeBr: formatarDataBrClimaGroq(hoje),
    alvoBr: alvo ? formatarDataBrClimaGroq(alvo) : "",
  };
}

function montarRegraTemporalClimaGroq(mensagemAtual, reforcada = false) {
  const contexto = obterContextoTemporalClimaGroq(mensagemAtual);
  const partes = [
    `DATA ATUAL REAL: ${contexto.hojeBr}.`,
    contexto.alvoBr
      ? `A data exata correspondente ao periodo relativo da pergunta e ${contexto.alvoBr}.`
      : "",
    "Interprete hoje, amanha, depois de amanha e daqui a N dias usando essa data atual real.",
    "Nao use uma previsao antiga como se fosse atual.",
    "Se a fonte mostrar datas passadas, descarte esses dados e procure uma previsao compativel com a data pedida.",
  ];

  if (reforcada) {
    partes.push(
      "CONFIRA explicitamente a data da previsao antes de responder. Se nao houver dado atual para a data pedida, diga que nao foi possivel confirmar em vez de usar uma data errada.",
    );
  }

  return partes.filter(Boolean).join(" ");
}

function mesPtNumeroClimaGroq(valor) {
  const mapa = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
  };

  return mapa[normalizarTextoTemporalClimaGroq(valor)] || null;
}

function mesmaDataClimaGroq(data, esperada) {
  return (
    data instanceof Date &&
    esperada instanceof Date &&
    data.getFullYear() === esperada.getFullYear() &&
    data.getMonth() === esperada.getMonth() &&
    data.getDate() === esperada.getDate()
  );
}

function extrairDatasExplicitasClimaGroq(valor, anoPadrao) {
  const original = String(valor || "");
  const normalizado = normalizarTextoTemporalClimaGroq(original);
  const resultados = [];

  const adicionar = (indice, dia, mes, ano, origem) => {
    const d = Number(dia);
    const m = Number(mes);
    const a = Number(ano || anoPadrao);

    if (
      !Number.isInteger(d) ||
      !Number.isInteger(m) ||
      !Number.isInteger(a) ||
      d < 1 ||
      d > 31 ||
      m < 1 ||
      m > 12
    ) {
      return;
    }

    const data = new Date(a, m - 1, d, 12, 0, 0, 0);

    if (
      data.getFullYear() !== a ||
      data.getMonth() !== m - 1 ||
      data.getDate() !== d
    ) {
      return;
    }

    resultados.push({
      indice,
      data,
      origem,
      contextoAntes: normalizado.slice(Math.max(0, indice - 90), indice),
    });
  };

  for (const match of normalizado.matchAll(
    /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/g,
  )) {
    let ano = match[3] ? Number(match[3]) : anoPadrao;
    if (ano < 100) {
      ano += 2000;
    }

    adicionar(match.index || 0, match[1], match[2], ano, match[0]);
  }

  for (const match of normalizado.matchAll(
    /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/g,
  )) {
    adicionar(
      match.index || 0,
      match[1],
      mesPtNumeroClimaGroq(match[2]),
      match[3] || anoPadrao,
      match[0],
    );
  }

  return resultados.sort((a, b) => a.indice - b.indice);
}

function deslocamentoDoContextoAntesClimaGroq(contextoAntes) {
  const texto = normalizarTextoTemporalClimaGroq(contextoAntes);

  const relativo = texto.match(
    /(?:daqui a|em)\s+(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze)\s+dias?[^.?!]{0,45}$/,
  );

  if (relativo) {
    return numeroTemporalPtClimaGroq(relativo[1]);
  }

  if (/\bdepois de amanha\b[^.?!]{0,45}$/.test(texto)) {
    return 2;
  }

  if (/\bamanha\b[^.?!]{0,45}$/.test(texto)) {
    return 1;
  }

  if (/\bhoje\b[^.?!]{0,45}$/.test(texto)) {
    return 0;
  }

  return null;
}

function respostaClimaComInconsistenciaTemporalGroq(valor, mensagemAtual) {
  const resposta = String(valor || "").trim();

  if (!resposta) {
    return {
      inconsistente: false,
      motivo: "",
    };
  }

  const contexto = obterContextoTemporalClimaGroq(mensagemAtual);
  const datas = extrairDatasExplicitasClimaGroq(
    resposta,
    contexto.hoje.getFullYear(),
  );

  for (const item of datas) {
    const deslocamentoRotulo = deslocamentoDoContextoAntesClimaGroq(
      item.contextoAntes,
    );

    if (deslocamentoRotulo === null) {
      continue;
    }

    const esperada = criarDataLocalClimaGroq(contexto.hoje, deslocamentoRotulo);

    if (!mesmaDataClimaGroq(item.data, esperada)) {
      return {
        inconsistente: true,
        motivo: `rotulo_relativo=${deslocamentoRotulo}|data=${formatarDataBrClimaGroq(item.data)}|esperada=${formatarDataBrClimaGroq(esperada)}`,
      };
    }
  }

  if (contexto.alvo && datas.length === 1) {
    const unico = datas[0];
    const rotulo = deslocamentoDoContextoAntesClimaGroq(unico.contextoAntes);

    if (rotulo === null && !mesmaDataClimaGroq(unico.data, contexto.alvo)) {
      return {
        inconsistente: true,
        motivo: `data_unica=${formatarDataBrClimaGroq(unico.data)}|alvo=${contexto.alvoBr}`,
      };
    }
  }

  return {
    inconsistente: false,
    motivo: "",
  };
}

async function executarPesquisaWebGroq(dados = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "GROQ_CHAVE_AUSENTE",
      erro: "Chave da Groq não configurada.",
      pesquisou: false,
      fontes: 0,
      tokensPesquisa: 0,
    };
  }

  const mensagemAtual = String(dados?.mensagemAtual || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!mensagemAtual) {
    return {
      ok: false,
      erro: "A mensagem atual não possui texto para pesquisa.",
      pesquisou: false,
      fontes: 0,
      tokensPesquisa: 0,
    };
  }

  const tentativaForcadaPesquisaWeb = !!dados?.__tentativaForcadaPesquisaWeb;
  const tentativaTemporalClima = !!dados?.__tentativaTemporalClima;

  const consultaBase = tentativaForcadaPesquisaWeb
    ? montarConsultaRetryPesquisaWebGroq(
        dados?.mensagensAnteriores,
        mensagemAtual,
      )
    : montarConsultaCompactaPesquisaWebGroq(
        dados?.mensagensAnteriores,
        mensagemAtual,
      );

  const consulta = dados?.consultaClima
    ? [
        consultaBase,
        montarRegraTemporalClimaGroq(mensagemAtual, tentativaTemporalClima),
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 620)
    : consultaBase;

  // Benchmark controlado:
  // Compound Mini + versao 2025-07-23 = Basic Web Search.
  // A documentacao da Groq indica que essa versao usa a busca basica,
  // enquanto versoes posteriores usam Advanced Web Search.
  // Mantemos somente web_search habilitado para evitar qualquer outra tool.
  const promptPersonalizadoWeb = String(dados?.promptPersonalizado || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const regraCelsiusClima = dados?.consultaClima
    ? "Para previsao do tempo, use graus Celsius (°C), nunca Fahrenheit. Se a fonte estiver em °F, converta para °C antes de responder."
    : "";
  const regraTemporalClima = dados?.consultaClima
    ? montarRegraTemporalClimaGroq(mensagemAtual, tentativaTemporalClima)
    : "";

  const corpo = JSON.stringify({
    model: GROQ_MODELO_WEB,
    messages: [
      {
        role: "user",
        content: [
          tentativaForcadaPesquisaWeb
            ? "OBRIGATORIO: execute web_search antes de responder. Nao use apenas memoria interna nem trate o contexto anterior como fonte. O contexto serve somente para identificar o assunto pesquisado."
            : "Use web_search uma unica vez para obter a resposta factual e atualizada.",
          "A mensagem pesquisada foi RECEBIDA de um contato no WhatsApp. Sua tarefa e RESPONDER esse contato em nome do usuario, nao repetir a pergunta, nao transformar a pergunta em uma mensagem do usuario e nao perguntar de volta se o contato sabe a resposta.",
          "Entregue somente a resposta final pronta para envio. Comece diretamente pela informacao encontrada, sem saudacao desnecessaria, sem explicar que pesquisou e nunca fale como IA ou assistente.",
          "Use portugues brasileiro, seja natural e objetivo.",
          regraCelsiusClima,
          regraTemporalClima,
          "Use somente fatos confirmados pela pesquisa. Nao invente preco, disponibilidade, link, data ou fato atual.",
          "Se algo nao puder ser confirmado, diga isso claramente. Nao inclua citacoes tecnicas; link somente se o contato pedir.",
          promptPersonalizadoWeb
            ? `Preferencias do usuario: ${promptPersonalizadoWeb}`
            : "",
          consulta,
        ]
          .filter(Boolean)
          .join(" "),
      },
    ],
    search_settings: {
      country: "brazil",
    },
    compound_custom: {
      tools: {
        enabled_tools: ["web_search"],
      },
    },
  });

  console.log(
    `[WEB IA] COMPOUND_MINI_INICIO | modelo=${GROQ_MODELO_WEB} | versao=${GROQ_VERSAO_COMPOUND_BENCHMARK} | tentativa=${tentativaTemporalClima ? "temporal" : tentativaForcadaPesquisaWeb ? 2 : 1} | consulta=${consulta.length} | corpoBytes=${Buffer.byteLength(corpo)}`,
  );

  const respostaHttp = await requisitarGroqComRetry(corpo, apiKey, 1, {
    "Groq-Model-Version": GROQ_VERSAO_COMPOUND_BENCHMARK,
  });

  const payload = respostaHttp?.payload;

  if (respostaHttp?.erro && !respostaHttp?.statusCode) {
    const erro = String(respostaHttp.erro || "Falha de rede.");

    console.log(
      `[WEB IA] COMPOUND_MINI_ERRO | ${erro.replace(/[^\x20-\x7E]/g, "").slice(0, 220)}`,
    );

    return {
      ok: false,
      erro,
      pesquisou: false,
      fontes: 0,
      tokensPesquisa: 0,
    };
  }

  if (respostaHttp?.statusCode < 200 || respostaHttp?.statusCode >= 300) {
    const erroOriginal = String(payload?.error?.message || "").trim();

    let erro =
      erroOriginal ||
      `Groq respondeu com HTTP ${respostaHttp?.statusCode || 0}.`;

    if (respostaHttp?.statusCode === 401) {
      erro =
        "A chave da Groq foi recusada. Abra as Configurações e confira a API Key salva.";
    } else if (respostaHttp?.statusCode === 429) {
      erro =
        "A pesquisa na internet está temporariamente limitada pela Groq. Tente novamente em instantes.";
    } else if (respostaHttp?.statusCode === 413) {
      erro = "O Compound Mini recusou a pesquisa com HTTP 413 neste benchmark.";
    }

    console.log(
      `[WEB IA] COMPOUND_MINI_HTTP | status=${Number(respostaHttp?.statusCode || 0)} | erro=${erroOriginal.replace(/[^\x20-\x7E]/g, "").slice(0, 260) || "sem_detalhe"}`,
    );

    return {
      ok: false,
      erro,
      status: Number(respostaHttp?.statusCode || 0) || 0,
      pesquisou: false,
      fontes: 0,
      tokensPesquisa: 0,
    };
  }

  const bruto = String(payload?.choices?.[0]?.message?.content || "").trim();

  const pesquisou = pesquisaWebFoiExecutadaGroq(payload);
  const fontes = contarFontesPesquisaWebGroq(payload);
  const resumo = extrairResumoPesquisaWebGroq(payload);
  const respostaDireta = limparCitacoesRespostaWebGroq(
    limparResumoBrowserSearchGroq(resumo),
  );

  const uso = payload?.usage || null;
  const promptTokens = Number(uso?.prompt_tokens || 0) || 0;
  const completionTokens = Number(uso?.completion_tokens || 0) || 0;
  const totalTokens = Number(uso?.total_tokens || 0) || 0;

  console.log(
    `[WEB IA] COMPOUND_MINI_FIM | pesquisou=${pesquisou} | fontes=${fontes} | resumo=${resumo.length} | promptTokens=${promptTokens} | completionTokens=${completionTokens} | tokens=${totalTokens}`,
  );

  if (!pesquisou) {
    if (dados?.forcarPesquisaWeb && !tentativaForcadaPesquisaWeb) {
      console.log(
        `[WEB IA] COMPOUND_MINI_RETRY_WEB_SEARCH | motivo=sem_web_search | tokensPrimeira=${totalTokens}`,
      );

      const retry = await executarPesquisaWebGroq({
        ...dados,
        __tentativaForcadaPesquisaWeb: true,
      });

      return {
        ...retry,
        tokensPesquisa:
          totalTokens +
          (Number(retry?.tokensPesquisa || retry?.uso?.total_tokens || 0) || 0),
      };
    }

    return {
      ok: false,
      erro: "O Compound Mini respondeu sem executar web_search mesmo apos a tentativa forcada. O WhatsIAPP nao vai tratar isso como pesquisa real.",
      pesquisou: false,
      fontes: 0,
      tokensPesquisa: totalTokens,
      uso,
    };
  }

  if (!resumo || !respostaDireta) {
    return {
      ok: false,
      erro: "O Compound Mini pesquisou, mas não retornou conteúdo utilizável.",
      pesquisou: true,
      fontes,
      tokensPesquisa: totalTokens,
      uso,
    };
  }

  if (sugestaoGroqTemConteudoInterno(respostaDireta)) {
    return {
      ok: false,
      erro: "A pesquisa retornou conteúdo interno e o WhatsIAPP bloqueou a resposta.",
      pesquisou: true,
      fontes,
      tokensPesquisa: totalTokens,
      uso,
    };
  }

  return {
    ok: true,
    resumo,
    resposta: respostaDireta,
    pesquisou: true,
    fontes,
    tokensPesquisa: totalTokens,
    uso,
    modeloPesquisa: GROQ_MODELO_WEB,
    versaoPesquisa: GROQ_VERSAO_COMPOUND_BENCHMARK,
  };
}

async function formularRespostaComPesquisaGroq(dados = {}, pesquisa = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "GROQ_CHAVE_AUSENTE",
      erro: "Chave da Groq não configurada.",
    };
  }

  const limitesContexto = normalizarLimitesContextoGroq(dados);

  const historico = normalizarMensagensAutomaticasGroq(
    dados?.mensagensAnteriores,
    Math.min(limitesContexto.limiteMensagens, 2),
  );

  const mensagemAtual = String(dados?.mensagemAtual || "")
    .trim()
    .slice(0, 2200);

  const prompts = montarPromptsSistemaGroq(
    dados,
    limitesContexto,
    "Write one natural, human WhatsApp reply using the verified web research supplied below. Never invent information that is not supported by that research.",
  );

  const resumoPesquisa = String(pesquisa?.resumo || "")
    .trim()
    .slice(0, 2800);

  const instrucoes = [
    prompts.promptInterno,
    prompts.promptPersonalizado
      ? `USER PERSONALIZATION\n${prompts.promptPersonalizado}`
      : "",
    "WEB-GROUNDED MODE.",
    "A pesquisa web real já foi executada pelo WhatsIAPP.",
    "Use o bloco WEB RESEARCH como base para qualquer preço, disponibilidade, link, data ou fato atual.",
    "Não diga que pesquisou algo diferente do que está no bloco.",
    "Se o bloco não confirmar uma informação, diga que não foi possível confirmar em vez de chutar.",
    "Responda naturalmente em português brasileiro, como uma mensagem pronta de WhatsApp.",
    dados?.consultaClima
      ? "Para clima/previsao do tempo, apresente temperaturas em graus Celsius (°C), nunca Fahrenheit. Converta qualquer valor em °F antes de responder."
      : "",
    dados?.consultaClima
      ? montarRegraTemporalClimaGroq(mensagemAtual, true)
      : "",
    'Retorne JSON somente: {"resposta":"mensagem pronta para enviar"}',
    `WEB RESEARCH\n${resumoPesquisa}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const contextoLimitado = aplicarLimiteContextoGroq({
    systemContent: instrucoes,
    historico,
    mensagemAtual,
    limiteTokensContexto: limitesContexto.limiteTokensContexto,
  });

  const corpo = JSON.stringify({
    model: GROQ_MODELO_PADRAO,
    messages: [
      {
        role: "system",
        content: instrucoes,
      },
      ...contextoLimitado.historico,
      {
        role: "user",
        content: contextoLimitado.mensagemAtual || mensagemAtual,
      },
    ],
    temperature: 0.4,
    top_p: 0.8,
    max_completion_tokens: 450,
    reasoning_effort: "low",
    include_reasoning: false,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "whatsiapp_resposta_web",
        strict: true,
        schema: {
          type: "object",
          properties: {
            resposta: { type: "string", minLength: 1 },
          },
          required: ["resposta"],
          additionalProperties: false,
        },
      },
    },
  });

  console.log(
    `[WEB IA] FORMULACAO_INICIO | historico=${contextoLimitado.historico.length} | pesquisa=${resumoPesquisa.length}`,
  );

  const respostaHttp = await requisitarGroqComRetry(corpo, apiKey, 1);
  const payload = respostaHttp.payload;

  if (respostaHttp.erro && !respostaHttp.statusCode) {
    return {
      ok: false,
      erro: respostaHttp.erro,
    };
  }

  if (respostaHttp.statusCode < 200 || respostaHttp.statusCode >= 300) {
    let erro =
      String(payload?.error?.message || "").trim() ||
      `Groq respondeu com HTTP ${respostaHttp.statusCode}.`;

    if (respostaHttp.statusCode === 401) {
      erro =
        "A chave da Groq foi recusada. Abra as Configurações e confira a API Key salva.";
    } else if (respostaHttp.statusCode === 429) {
      erro =
        "A Groq está temporariamente limitada. Tente novamente em instantes.";
    }

    return {
      ok: false,
      erro,
      status: respostaHttp.statusCode,
    };
  }

  const bruto = String(payload?.choices?.[0]?.message?.content || "").trim();

  const respostaFinal = extrairRespostaAutomaticaGroq(bruto);

  console.log(
    `[WEB IA] FORMULACAO_FIM | ok=${!!respostaFinal} | tokens=${Number(payload?.usage?.total_tokens || 0) || 0}`,
  );

  if (!respostaFinal) {
    return {
      ok: false,
      erro: "A pesquisa foi concluída, mas a IA não retornou a mensagem final no formato esperado.",
    };
  }

  if (sugestaoGroqTemConteudoInterno(respostaFinal)) {
    return {
      ok: false,
      erro: "A IA retornou conteúdo interno e o WhatsIAPP bloqueou a resposta da pesquisa.",
    };
  }

  return {
    ok: true,
    resposta: limparCitacoesRespostaWebGroq(respostaFinal),
    modelo: payload?.model || GROQ_MODELO_PADRAO,
    uso: payload?.usage || null,
  };
}

async function gerarRespostaWebGroq(dados = {}) {
  const catalogoIA = prepararContextoCatalogoIA(dados, 4);

  const forcarPesquisaWeb = !!dados?.forcarPesquisaWeb;

  if (
    catalogoIA.relevante &&
    !forcarPesquisaWeb &&
    !pedidoExplicitoPesquisaWebNoIndex(dados)
  ) {
    console.log(
      `[CATALOGO IA] WEB_BYPASS | results=${catalogoIA.resultados.length} | compound=false`,
    );

    const respostaCatalogo = await gerarRespostaAutomaticaGroq(dados);

    return {
      ...respostaCatalogo,
      pesquisou: false,
      fontes: 0,
      catalogoUsado: !!respostaCatalogo?.ok,
    };
  }

  const permissoesPlano = obterPermissoesPlanoAdmin();

  if (!permissoesPlano.pesquisaWebPermitida) {
    console.log(
      `[WEB IA] BLOQUEADA_PLANO | plano=${permissoesPlano.plano} | groqChamada=false`,
    );

    return {
      ok: false,
      erro: "A pesquisa na internet não está disponível no plano atual.",
      pesquisou: false,
      fontes: 0,
      bloqueadaPorPlano: true,
    };
  }

  console.log("[WEB IA] FLUXO_INICIO | Compound Mini Basic Web Search direto");

  let pesquisa = await executarPesquisaWebGroq(dados);

  if (!pesquisa?.ok) {
    console.log(
      `[WEB IA] FLUXO_FALHOU_PESQUISA | erro=${String(
        pesquisa?.erro || "erro desconhecido",
      )
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 220)}`,
    );

    return {
      ok: false,
      erro:
        pesquisa?.erro || "Não foi possível concluir a pesquisa na internet.",
      pesquisou: !!pesquisa?.pesquisou,
      fontes: Number(pesquisa?.fontes || 0) || 0,
    };
  }

  let tokensPesquisa =
    Number(pesquisa?.tokensPesquisa || pesquisa?.uso?.total_tokens || 0) || 0;

  let verificacaoTemporalClima =
    dados?.consultaClima && pesquisa?.resposta
      ? respostaClimaComInconsistenciaTemporalGroq(
          pesquisa.resposta,
          dados?.mensagemAtual,
        )
      : { inconsistente: false, motivo: "" };

  let houveRetryTemporalClima = false;

  if (verificacaoTemporalClima.inconsistente) {
    houveRetryTemporalClima = true;

    console.log(
      `[WEB IA] CLIMA_RETRY_TEMPORAL | motivo=${String(
        verificacaoTemporalClima.motivo || "data_inconsistente",
      )
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 180)}`,
    );

    const retryTemporal = await executarPesquisaWebGroq({
      ...dados,
      __tentativaTemporalClima: true,
    });

    tokensPesquisa +=
      Number(
        retryTemporal?.tokensPesquisa || retryTemporal?.uso?.total_tokens || 0,
      ) || 0;

    if (retryTemporal?.ok) {
      pesquisa = retryTemporal;
      verificacaoTemporalClima = pesquisa?.resposta
        ? respostaClimaComInconsistenciaTemporalGroq(
            pesquisa.resposta,
            dados?.mensagemAtual,
          )
        : { inconsistente: false, motivo: "" };

      console.log(
        `[WEB IA] CLIMA_RETRY_TEMPORAL_FIM | ok=true | consistente=${!verificacaoTemporalClima.inconsistente}`,
      );
    } else {
      console.log(
        `[WEB IA] CLIMA_RETRY_TEMPORAL_FIM | ok=false | erro=${String(
          retryTemporal?.erro || "erro_desconhecido",
        )
          .replace(/[^\x20-\x7E]/g, "")
          .slice(0, 180)}`,
      );
    }
  }

  const climaPrecisaReformularCelsius =
    !!dados?.consultaClima &&
    !!pesquisa?.resposta &&
    respostaClimaPrecisaCelsiusGroq(pesquisa.resposta);

  const climaPrecisaReformularTemporal =
    !!dados?.consultaClima &&
    !!pesquisa?.resposta &&
    !!verificacaoTemporalClima.inconsistente;

  if (climaPrecisaReformularCelsius) {
    console.log(
      "[WEB IA] CLIMA_REFORMULAR_CELSIUS | motivo=unidade_ambigua_ou_fahrenheit",
    );
  }

  if (climaPrecisaReformularTemporal) {
    console.log(
      `[WEB IA] CLIMA_REFORMULAR_TEMPORAL | motivo=${String(
        verificacaoTemporalClima.motivo || "data_inconsistente",
      )
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 180)}`,
    );
  }

  if (
    pesquisa?.resposta &&
    !climaPrecisaReformularCelsius &&
    !climaPrecisaReformularTemporal
  ) {
    console.log(
      `[WEB IA] BENCHMARK_COMPOUND_MINI | pesquisa=${tokensPesquisa} | formulacao=0 | total=${tokensPesquisa} | fontes=${Number(pesquisa?.fontes || 0) || 0} | direto=true | ok=true | retryTemporal=${houveRetryTemporalClima}`,
    );

    console.log(
      `[WEB IA] FLUXO_FIM | ok=true | pesquisou=true | fontes=${Number(pesquisa?.fontes || 0) || 0} | direto=true`,
    );

    return {
      ok: true,
      resposta: pesquisa.resposta,
      pesquisou: true,
      fontes: Number(pesquisa?.fontes || 0) || 0,
      modelo: pesquisa?.modeloPesquisa || GROQ_MODELO_WEB,
      uso: pesquisa?.uso || null,
    };
  }

  // Fallback de seguranca: usa a segunda formulacao se o Compound
  // nao entregar mensagem direta utilizavel, se clima vier fora de Celsius
  // ou se uma data explicita contradizer o periodo temporal pedido.
  const resposta = await formularRespostaComPesquisaGroq(dados, pesquisa);
  const tokensFormulacao = Number(resposta?.uso?.total_tokens || 0) || 0;
  const tokensTotalBenchmark = tokensPesquisa + tokensFormulacao;

  if (
    dados?.consultaClima &&
    resposta?.ok &&
    respostaClimaPrecisaCelsiusGroq(resposta?.resposta)
  ) {
    console.log(
      "[WEB IA] CLIMA_BLOQUEADO_UNIDADE | motivo=nao_converteu_para_celsius",
    );

    return {
      ok: false,
      erro: "A pesquisa retornou a previsão em uma unidade de temperatura diferente de Celsius e a conversão segura não pôde ser confirmada.",
      pesquisou: true,
      fontes: Number(pesquisa?.fontes || 0) || 0,
    };
  }

  if (dados?.consultaClima && resposta?.ok) {
    const temporalFinal = respostaClimaComInconsistenciaTemporalGroq(
      resposta?.resposta,
      dados?.mensagemAtual,
    );

    if (temporalFinal.inconsistente) {
      console.log(
        `[WEB IA] CLIMA_BLOQUEADO_TEMPORAL | motivo=${String(
          temporalFinal.motivo || "data_inconsistente",
        )
          .replace(/[^\x20-\x7E]/g, "")
          .slice(0, 180)}`,
      );

      return {
        ok: false,
        erro: "A pesquisa encontrou uma previsão com data incompatível com o período pedido e o WhatsIAPP preferiu não enviar uma informação temporal incorreta.",
        pesquisou: true,
        fontes: Number(pesquisa?.fontes || 0) || 0,
      };
    }
  }

  console.log(
    `[WEB IA] BENCHMARK_COMPOUND_MINI | pesquisa=${tokensPesquisa} | formulacao=${tokensFormulacao} | total=${tokensTotalBenchmark} | fontes=${Number(pesquisa?.fontes || 0) || 0} | direto=false | ok=${!!resposta?.ok} | retryTemporal=${houveRetryTemporalClima}`,
  );

  console.log(
    `[WEB IA] FLUXO_FIM | ok=${!!resposta?.ok} | pesquisou=true | fontes=${Number(pesquisa?.fontes || 0) || 0} | direto=false`,
  );

  return {
    ...resposta,
    pesquisou: true,
    fontes: Number(pesquisa?.fontes || 0) || 0,
  };
}

async function gerarRespostaAutomaticaGroq(dados = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "GROQ_CHAVE_AUSENTE",
      erro: "Chave da Groq não configurada. Abra as Configurações do WhatsIAPP e salve sua API Key.",
    };
  }

  const limitesContexto = normalizarLimitesContextoGroq(dados);
  const historico = normalizarMensagensAutomaticasGroq(
    dados?.mensagensAnteriores,
    limitesContexto.limiteMensagens,
  );
  // Inclui ate 16 mil caracteres extraidos do PDF, alem da pergunta.
  const mensagemAtual = String(dados?.mensagemAtual || "")
    .trim()
    .slice(0, 24000);

  if (!mensagemAtual) {
    return {
      ok: false,
      erro: "A mensagem atual não possui texto para a IA responder.",
    };
  }

  const nomeContato = String(dados?.nomeContato || "").trim() || "o contato";
  const catalogoIA = prepararContextoCatalogoIA(dados, 4);

  if (catalogoIA.relevante) {
    const respostaDeterministica = respostaCatalogoDeterministicaFatoAusenteIA(
      mensagemAtual,
      catalogoIA.contexto,
      catalogoIA.resultados,
    );

    if (respostaDeterministica) {
      return {
        ok: true,
        resposta: respostaDeterministica,
        modelo: "catalogo-local",
        uso: null,
        catalogoUsado: true,
        deterministica: true,
      };
    }
  }

  const instrucoesCatalogo = blocoInstrucoesCatalogoIA(catalogoIA.contexto);
  const prompts = montarPromptsSistemaGroq(
    dados,
    limitesContexto,
    "Write one natural, human WhatsApp reply using only the current conversation. Never invent missing information; ask briefly when essential context is missing.",
  );

  const instrucoes = [
    prompts.promptInterno,
    prompts.promptPersonalizado
      ? `USER PERSONALIZATION\n${prompts.promptPersonalizado}`
      : "",
    `AUTOMATIC MODE for ${nomeContato}. Roles: user = contact; assistant = WhatsIAPP owner.`,
    `The final user message is the CURRENT MESSAGE and has highest priority. Use up to ${limitesContexto.limiteMensagens} previous messages only when relevant. If required context is missing, ask a short natural question instead of guessing.`,
    "This route has NO web access. Never say you searched, looked something up online, found a current price, checked a website or verified a current fact. Never invent current prices, availability, links or recent information.",
    instrucoesCatalogo,
    "If the CURRENT MESSAGE asks whether you remember something, inspect the provided previous messages before saying you do not remember. If the information is present there, use it.",
    'Return JSON only: {"resposta":"mensagem pronta para enviar"}',
  ]
    .filter(Boolean)
    .join("\n");

  const contextoLimitado = aplicarLimiteContextoGroq({
    systemContent: instrucoes,
    historico,
    mensagemAtual,
    limiteTokensContexto: limitesContexto.limiteTokensContexto,
  });

  const corpo = JSON.stringify({
    model: GROQ_MODELO_PADRAO,
    messages: [
      {
        role: "system",
        content: instrucoes,
      },
      ...contextoLimitado.historico,
      {
        role: "user",
        content: contextoLimitado.mensagemAtual || mensagemAtual,
      },
    ],
    temperature: catalogoIA.relevante ? 0 : 0.62,
    top_p: 0.82,
    max_completion_tokens: 1000,
    reasoning_effort: "low",
    include_reasoning: false,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "whatsiapp_resposta_automatica",
        strict: true,
        schema: {
          type: "object",
          properties: {
            resposta: { type: "string", minLength: 1 },
          },
          required: ["resposta"],
          additionalProperties: false,
        },
      },
    },
  });

  const respostaHttp = await requisitarGroqComRetry(corpo, apiKey, 2);

  if (respostaHttp.erro && !respostaHttp.statusCode) {
    return {
      ok: false,
      erro: respostaHttp.erro,
    };
  }

  const payload = respostaHttp.payload;

  if (respostaHttp.statusCode < 200 || respostaHttp.statusCode >= 300) {
    let erro =
      String(payload?.error?.message || "").trim() ||
      `Groq respondeu com HTTP ${respostaHttp.statusCode}.`;

    if (respostaHttp.statusCode === 401) {
      erro =
        "A chave da Groq foi recusada. Abra as Configurações e confira a API Key salva.";
    } else if (respostaHttp.statusCode === 429) {
      const segundos = Math.ceil(
        Number(respostaHttp.esperaSugeridaMs || 0) / 1000,
      );
      erro =
        segundos > 0 && segundos <= 60
          ? `A Groq continua temporariamente limitada. Tente novamente em cerca de ${segundos}s.`
          : "O limite de uso da Groq foi atingido. O WhatsIAPP tentou novamente automaticamente, mas a cota ainda não foi liberada.";
    }

    return {
      ok: false,
      erro,
      status: respostaHttp.statusCode,
    };
  }

  const texto = String(payload?.choices?.[0]?.message?.content || "").trim();

  const respostaExtraida = extrairRespostaAutomaticaGroq(texto);
  const respostaFinal = aplicarTravaPesquisaSemWebGroq(
    respostaExtraida,
    "automatico",
  );

  if (!respostaFinal) {
    return {
      ok: false,
      erro: "A Groq respondeu, mas não retornou a resposta automática no formato esperado.",
    };
  }

  if (sugestaoGroqTemConteudoInterno(respostaFinal)) {
    return {
      ok: false,
      erro: "A IA retornou conteúdo interno e o WhatsIAPP bloqueou o envio automático.",
    };
  }

  return {
    ok: true,
    resposta: respostaFinal,
    modelo: payload?.model || GROQ_MODELO_PADRAO,
    uso: payload?.usage || null,
    tentativas: respostaHttp.tentativas || 1,
  };
}

function normalizarContextoFactualGroq(lista, limiteMensagens = 15) {
  return (Array.isArray(lista) ? lista : [])
    .slice(-limiteMensagens)
    .map((item) => {
      const role =
        String(item?.role || "").trim() === "assistant" ? "assistant" : "user";
      const content = String(item?.content || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 700);

      return content ? { role, content } : null;
    })
    .filter(Boolean);
}

async function gerarRespostaFactualGroq(dados = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "GROQ_CHAVE_AUSENTE",
      erro: "Chave da Groq não configurada. Abra as Configurações do WhatsIAPP e salve sua API Key.",
    };
  }

  const limitesContexto = normalizarLimitesContextoGroq(dados);

  const mensagemAtual = String(dados?.mensagemAtual || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);

  if (!mensagemAtual) {
    return {
      ok: false,
      erro: "A pergunta não possui texto para a IA responder.",
    };
  }

  const historico = normalizarContextoFactualGroq(
    dados?.mensagensAnteriores,
    limitesContexto.limiteMensagens,
  );

  // A rota factual continua com um motor interno curto para preservar o baixo
  // consumo. Se o usuario configurou personalizacao, ela e adicionada aqui e
  // respeita o limite do nivel escolhido.
  const promptPersonalizado = String(dados?.promptPersonalizado || "")
    .trim()
    .slice(0, limitesContexto.promptPersonalizadoMaximo || 3000);
  const catalogoIA = prepararContextoCatalogoIA(dados, 4);
  const instrucoesCatalogo = blocoInstrucoesCatalogoIA(catalogoIA.contexto);
  const motorInternoCatalogo = catalogoIA.relevante
    ? String(obterMotorIAAdmin() || "").trim()
    : "";

  const instrucoes = [
    motorInternoCatalogo,
    "Answer the factual/general-knowledge question as one natural WhatsApp message.",
    "Use Brazilian Portuguese unless the question is clearly in another language.",
    "Be direct but include enough explanation to answer well. Do not invent facts. If genuinely unsure, say so briefly instead of guessing.",
    "This route has NO web access. Never claim you searched, checked a website or found a current price. If current information is required and not provided in context, say you cannot confirm it here instead of inventing.",
    "Previous messages, when provided, exist only to resolve references in the current question. Do not bring unrelated conversation into the answer.",
    instrucoesCatalogo,
    promptPersonalizado ? `USER PERSONALIZATION\n${promptPersonalizado}` : "",
    'Return JSON only: {"resposta":"mensagem"}',
  ]
    .filter(Boolean)
    .join("\n");

  const contextoLimitado = aplicarLimiteContextoGroq({
    systemContent: instrucoes,
    historico,
    mensagemAtual,
    limiteTokensContexto: limitesContexto.limiteTokensContexto,
  });

  const corpo = JSON.stringify({
    model: GROQ_MODELO_PADRAO,
    messages: [
      {
        role: "system",
        content: instrucoes,
      },
      ...contextoLimitado.historico,
      {
        role: "user",
        content: contextoLimitado.mensagemAtual || mensagemAtual,
      },
    ],
    temperature: catalogoIA.relevante ? 0 : 0.32,
    top_p: 0.82,
    max_completion_tokens: 500,
    reasoning_effort: "low",
    include_reasoning: false,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "whatsiapp_resposta_factual",
        strict: true,
        schema: {
          type: "object",
          properties: {
            resposta: { type: "string", minLength: 1 },
          },
          required: ["resposta"],
          additionalProperties: false,
        },
      },
    },
  });

  const respostaHttp = await requisitarGroqComRetry(corpo, apiKey, 2);

  if (respostaHttp.erro && !respostaHttp.statusCode) {
    return {
      ok: false,
      erro: respostaHttp.erro,
    };
  }

  const payload = respostaHttp.payload;

  if (respostaHttp.statusCode < 200 || respostaHttp.statusCode >= 300) {
    let erro =
      String(payload?.error?.message || "").trim() ||
      `Groq respondeu com HTTP ${respostaHttp.statusCode}.`;

    if (respostaHttp.statusCode === 401) {
      erro =
        "A chave da Groq foi recusada. Abra as Configurações e confira a API Key salva.";
    } else if (respostaHttp.statusCode === 429) {
      const segundos = Math.ceil(
        Number(respostaHttp.esperaSugeridaMs || 0) / 1000,
      );
      erro =
        segundos > 0 && segundos <= 60
          ? `A Groq continua temporariamente limitada. Tente novamente em cerca de ${segundos}s.`
          : "O limite de uso da Groq foi atingido. O WhatsIAPP tentou novamente automaticamente, mas a cota ainda não foi liberada.";
    }

    return {
      ok: false,
      erro,
      status: respostaHttp.statusCode,
    };
  }

  const texto = String(payload?.choices?.[0]?.message?.content || "").trim();
  const respostaExtraida = extrairRespostaAutomaticaGroq(texto);
  const respostaFinal = aplicarTravaPesquisaSemWebGroq(
    respostaExtraida,
    "factual",
  );

  if (!respostaFinal) {
    return {
      ok: false,
      erro: "A Groq respondeu, mas não retornou a resposta no formato esperado.",
    };
  }

  if (sugestaoGroqTemConteudoInterno(respostaFinal)) {
    return {
      ok: false,
      erro: "A IA retornou conteúdo interno e o WhatsIAPP bloqueou a resposta.",
    };
  }

  return {
    ok: true,
    resposta: respostaFinal,
    modelo: payload?.model || GROQ_MODELO_PADRAO,
    uso: payload?.usage || null,
    tentativas: respostaHttp.tentativas || 1,
  };
}

function criarJanela() {
  const caminhoIconeApp =
    process.platform === "win32" ? garantirIconeWindows() : caminhoLogoPng();

  janela = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: "#0b0e11",
    title: "WhatsIAPP",
    icon: caminhoIconeApp,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  janela.setMenuBarVisibility(false);

  try {
    const iconeApp = nativeImage.createFromPath(caminhoIconeApp);

    if (!iconeApp.isEmpty()) {
      janela.setIcon(iconeApp);
    }
  } catch (erro) {
    console.warn("Window icon setup failed:", erro?.message || erro);
  }

  iniciarDiagnosticoInicializacao();
  registrarMarcoInicializacao("app", "janela-criada");

  criarWorkerWhatsApp();
  criarWorkerArquivadas();

  registrarMarcoInicializacao("renderer", "load-file");
  janela.loadFile(path.join(__dirname, "app.html"));

  janela.webContents.once("did-finish-load", () => {
    registrarMarcoInicializacao("renderer", "did-finish-load");
    liberarEventosTelaPendentes();
  });
}

function enviarEstadoAtualizacao(dados = {}) {
  if (!janela || janela.isDestroyed()) {
    return;
  }

  try {
    janela.webContents.send("atualizacao-app", dados);
  } catch {}
}

function configurarAtualizacaoAutomatica() {
  if (!app.isPackaged || atualizadorConfigurado) {
    return;
  }

  atualizadorConfigurado = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    enviarEstadoAtualizacao({ etapa: "verificando" });
  });

  autoUpdater.on("update-available", (info) => {
    enviarEstadoAtualizacao({
      etapa: "disponivel",
      versao: info?.version || null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    enviarEstadoAtualizacao({ etapa: "atualizado" });
  });

  autoUpdater.on("download-progress", (progresso) => {
    enviarEstadoAtualizacao({
      etapa: "baixando",
      percentual: Number(progresso?.percent || 0) || 0,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    enviarEstadoAtualizacao({
      etapa: "baixado",
      versao: info?.version || null,
    });
  });

  autoUpdater.on("error", (erro) => {
    console.warn("Atualizacao automatica indisponivel:", erro?.message || erro);
    enviarEstadoAtualizacao({
      etapa: "erro",
      erro: erro?.message || String(erro),
    });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((erro) => {
      console.warn("Falha ao verificar atualizacoes:", erro?.message || erro);
    });
  }, 12000);
}

ipcMain.on("diagnostico-web-ia", (_evento, dados) => {
  try {
    const etapa = String(dados?.etapa || "SEM_ETAPA")
      .replace(/[^\x20-\x7E]/g, "")
      .trim();

    const partes = Object.entries(dados || {})
      .filter(([chave]) => chave !== "etapa")
      .map(([chave, valor]) => {
        let final = valor;

        if (typeof final === "string") {
          final = final.replace(/[^\x20-\x7E]/g, "").slice(0, 220);
        } else if (final && typeof final === "object") {
          try {
            final = JSON.stringify(final).slice(0, 220);
          } catch {
            final = "[object]";
          }
        }

        return `${chave}=${String(final)}`;
      });

    console.log(
      `[WEB IA] ${etapa}${partes.length ? ` | ${partes.join(" | ")}` : ""}`,
    );
  } catch (erro) {
    console.log(
      `[WEB IA] LOG_ERROR | ${String(erro?.message || erro || "unknown")}`,
    );
  }
});

ipcMain.on("diagnostico-bg-ia", (_evento, dados) => {
  try {
    const etapa = String(dados?.etapa || "SEM_ETAPA")
      .replace(/[^\x20-\x7E]/g, "")
      .trim();

    const partes = Object.entries(dados || {})
      .filter(([chave]) => chave !== "etapa")
      .map(([chave, valor]) => {
        let final = valor;

        if (typeof final === "string") {
          final = final.replace(/[^\x20-\x7E]/g, "").slice(0, 220);
        } else if (final && typeof final === "object") {
          try {
            final = JSON.stringify(final).slice(0, 220);
          } catch {
            final = "[object]";
          }
        }

        return `${chave}=${String(final)}`;
      });

    console.log(
      `[BG IA] ${etapa}${partes.length ? ` | ${partes.join(" | ")}` : ""}`,
    );
  } catch (erro) {
    console.log(
      `[BG IA] LOG_ERROR | ${String(erro?.message || erro || "unknown")}`,
    );
  }
});

ipcMain.handle("obter-sincronizacao-inicial-atual", async () => {
  if (fullReadyInicialLiberado) {
    return {
      etapa: "full-ready",
      origem: "bootstrap",
      detalhe:
        "Baileys + cache local + conversas principais + fotos principais.",
    };
  }

  if (baileysProntoInicial && !fotosPrincipaisProntas) {
    return {
      etapa: "fotos-principais",
      origem: "renderer",
      detalhe: "Preparando fotos das conversas principais.",
    };
  }

  if (ultimaEtapaSincronizacaoInicial) {
    return { ...ultimaEtapaSincronizacaoInicial };
  }

  return null;
});

// =========================================================
// TESTADOR MESTRE - ponte diagnostica do processo principal
// Somente leitura e sondas sinteticas isoladas.
// =========================================================
try {
  const { registrarMainTestadorMestre } = require("./testador-mestre/main.js");

  registrarMainTestadorMestre({
    ipcMain,
    app,
    fs,
    path,
    obterSnapshot: () => ({
      processo: {
        encerrando: !!encerrando,
        telaPronta: !!telaPronta,
        eventosTelaPendentes: eventosTelaPendentes.length,
        solicitacoesPendentes: solicitacoesPendentes.size,
      },
      workers: {
        baileys: {
          ativo: !!whatsappWorker,
          threadId: Number(whatsappWorker?.threadId || 0) || null,
        },
        wpp: {
          ativo: !!archiveWorker,
          threadId: Number(archiveWorker?.threadId || 0) || null,
        },
      },
      sincronizacao: {
        wppFullReady: !!wppFullReady,
        wppRecepcaoAoVivoPronta: !!wppRecepcaoAoVivoPronta,
        ultimaEtapa: ultimaEtapaSincronizacaoInicial
          ? { ...ultimaEtapaSincronizacaoInicial }
          : null,
        diagnosticoConcluido: !!diagnosticoInicializacaoConcluido,
        marcos: diagnosticoMarcosInicializacao.map((item) => ({ ...item })),
      },
      estado: {
        conversasBase: Array.isArray(conversasBase) ? conversasBase.length : 0,
        arquivamentos: estadoArquivamento.size,
        trancamentos: estadoTrancamento.size,
        privacidadePronta: !!estadoPrivacidadePronto,
        privacidadeCompleta: !!estadoPrivacidadeCompleto,
        privacidadeConhecida: estadoPrivacidadeConhecido.size,
        cachePrivacidadeCarregado: !!cachePrivacidadeCarregado,
        mensagensPendentesPrivacidade: mensagensPendentesPrivacidade.length,
      },
      tempoReal: {
        mensagensRecentes: mensagensRecentesTempoReal.size,
        fallbacksBaileys: mensagensBaileysAguardandoWpp.size,
        sonsRecentes: sonsMensagemImediatosRecentes.size,
      },
      notificacoes: {
        ativas: notificacoesAtivas.size,
        fotosCacheadas: fotosNotificacaoContato.size,
        fotosEmCarga: carregamentosFotoNotificacaoContato.size,
      },
      presenca: {
        prioridadeBaileysMs: JANELA_PRIORIDADE_PRESENCA_BAILEYS_MS,
        assinaturaAtiva: !!presencaAtiva,
        fallbackWppAgendado: !!timerAssinaturaFallbackWpp,
      },
    }),
    sondarCorrelacaoWorkers: async () => {
      const [grupos, contatos] = await Promise.all([
        solicitarAoWorker("baileys", "listar-grupos", {}, 10000),
        solicitarAoWorker("baileys", "listar-contatos-salvos", {}, 10000),
      ]);

      const okGrupos = !!grupos?.ok && Array.isArray(grupos?.grupos);
      const okContatos = !!contatos?.ok && Array.isArray(contatos?.contatos);

      return {
        ok: okGrupos && okContatos,
        grupos: okGrupos ? grupos.grupos.length : null,
        contatos: okContatos ? contatos.contatos.length : null,
        pendentesDepois: solicitacoesPendentes.size,
      };
    },
    sondarAcaoDesconhecida: async () => {
      const resposta = await solicitarAoWorker(
        "baileys",
        "__testador_mestre_acao_inexistente__",
        {},
        5000,
      );

      const depois = await solicitarAoWorker(
        "baileys",
        "listar-grupos",
        {},
        10000,
      );

      return {
        ok:
          resposta?.ok === false &&
          /desconhecida/i.test(String(resposta?.erro || "")) &&
          !!depois?.ok,
        erroControlado: resposta?.erro || null,
        workerContinuaRespondendo: !!depois?.ok,
      };
    },
    testarDeduplicacaoTempoReal: () => {
      const id = `tm-dedup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const dados = {
        idMensagem: id,
        conversaId: "testador-mestre-local@s.whatsapp.net",
        id: "testador-mestre-local@s.whatsapp.net",
        timestamp: Math.floor(Date.now() / 1000),
        texto: "tm",
      };

      const antes = mensagemTempoRealJaEncaminhada(dados);
      marcarMensagemTempoRealEncaminhada(dados);
      const depois = mensagemTempoRealJaEncaminhada(dados);
      const chave = idMensagemTempoReal(dados);

      if (chave) {
        mensagensRecentesTempoReal.delete(chave);
      }

      return {
        ok: antes === false && depois === true,
        antes,
        depois,
        limpo: chave ? !mensagensRecentesTempoReal.has(chave) : true,
      };
    },
  });

  console.log("[TESTADOR MESTRE MAIN] diagnostico registrado");
} catch (erro) {
  console.error(
    "[TESTADOR MESTRE MAIN] init failed:",
    erro?.stack || erro?.message || erro,
  );
}

let caminhoSomNotificacaoCustom = null;

function gerarWavSomNotificacaoCustom() {
  const sampleRate = 44100;
  const duracao = 0.23;
  const totalSamples = Math.max(1, Math.floor(sampleRate * duracao));
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  let fase = 0;

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const progressoSweep = Math.min(1, t / 0.16);
    const frequencia = 880 * Math.pow(660 / 880, progressoSweep);
    fase += (2 * Math.PI * frequencia) / sampleRate;

    let ganho = 0.0001;

    if (t <= 0.015) {
      ganho = 0.0001 * Math.pow(0.12 / 0.0001, t / 0.015);
    } else if (t <= 0.22) {
      ganho = 0.12 * Math.pow(0.0001 / 0.12, (t - 0.015) / 0.205);
    }

    const amostra = Math.max(
      -32767,
      Math.min(32767, Math.round(Math.sin(fase) * ganho * 32767)),
    );

    buffer.writeInt16LE(amostra, 44 + i * 2);
  }

  return buffer;
}

function garantirSomNotificacaoCustom() {
  if (
    caminhoSomNotificacaoCustom &&
    fs.existsSync(caminhoSomNotificacaoCustom)
  ) {
    return caminhoSomNotificacaoCustom;
  }

  const destino = path.join(
    app.getPath("userData"),
    "whatsiapp-notificacao-v2.wav",
  );

  try {
    if (!fs.existsSync(destino) || fs.statSync(destino).size < 1000) {
      fs.writeFileSync(destino, gerarWavSomNotificacaoCustom());
    }

    caminhoSomNotificacaoCustom = destino;
    return destino;
  } catch (erro) {
    console.warn(
      `[NOTIFICACOES] CUSTOM_SOUND_PREP_ERROR | ${String(
        erro?.message || erro || "unknown",
      )
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 180)}`,
    );
    return null;
  }
}

function tocarSomNotificacaoCustomWindows() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ ok: false, erro: "unsupported_platform" });
      return;
    }

    const arquivo = garantirSomNotificacaoCustom();

    if (!arquivo) {
      resolve({ ok: false, erro: "sound_file_unavailable" });
      return;
    }

    const caminhoPowerShell = String(arquivo).replace(/'/g, "''");
    const comando =
      `$player = New-Object System.Media.SoundPlayer '${caminhoPowerShell}'; ` +
      "$player.PlaySync();";

    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        comando,
      ],
      { windowsHide: true, timeout: 5000 },
      (erro) => {
        if (erro) {
          console.warn(
            `[NOTIFICACOES] CUSTOM_SOUND_ERROR | ${String(
              erro?.message || erro || "unknown",
            )
              .replace(/[^\x20-\x7E]/g, "")
              .slice(0, 180)}`,
          );
          resolve({ ok: false, erro: erro?.message || String(erro) });
          return;
        }

        console.log("[NOTIFICACOES] CUSTOM_SOUND_OK");
        resolve({ ok: true });
      },
    );
  });
}

async function tocarSomNotificacaoSistema() {
  if (process.platform === "win32") {
    return tocarSomNotificacaoCustomWindows();
  }

  try {
    shell.beep();
    return { ok: true };
  } catch (erro) {
    return {
      ok: false,
      erro: erro?.message || String(erro || "unknown error"),
    };
  }
}

ipcMain.handle("tocar-som-notificacao", async () => {
  return tocarSomNotificacaoSistema();
});

function pastaCacheFotosPerfilPersistente() {
  return path.join(app.getPath("userData"), "fotos-perfil-cache-v1");
}

function arquivoIndiceFotosPerfilPersistente() {
  return path.join(
    pastaCacheFotosPerfilPersistente(),
    "indice-fotos-perfil-v1.json",
  );
}

function nomeArquivoFotoPerfilPersistente(conversaId) {
  const id = String(conversaId || "").trim();

  if (!id) {
    return "";
  }

  return `${crypto.createHash("sha256").update(id).digest("hex")}.png`;
}

function carregarIndiceFotosPerfilPersistente() {
  if (cacheFotosPerfilPersistentesCarregado) {
    return;
  }

  cacheFotosPerfilPersistentesCarregado = true;
  indiceFotosPerfilPersistentes.clear();

  try {
    const arquivo = arquivoIndiceFotosPerfilPersistente();

    if (!fs.existsSync(arquivo)) {
      return;
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    const itens =
      dados?.itens && typeof dados.itens === "object" ? dados.itens : {};

    for (const [conversaId, item] of Object.entries(itens)) {
      const arquivoFoto = String(item?.arquivo || "").trim();

      if (!conversaId || !arquivoFoto) {
        continue;
      }

      const caminhoFoto = path.join(
        pastaCacheFotosPerfilPersistente(),
        arquivoFoto,
      );

      if (!fs.existsSync(caminhoFoto)) {
        continue;
      }

      indiceFotosPerfilPersistentes.set(conversaId, {
        arquivo: arquivoFoto,
        atualizadoEm: Number(item?.atualizadoEm || 0) || 0,
      });
    }

    console.log(
      `[FOTOS PERFIL CACHE] carregado | total=${indiceFotosPerfilPersistentes.size}.`,
    );
  } catch (erro) {
    console.warn(
      `[FOTOS PERFIL CACHE] falha ao carregar indice | erro=${String(
        erro?.message || erro || "unknown",
      )}`,
    );
  }
}

function salvarIndiceFotosPerfilPersistenteAgora() {
  try {
    const pasta = pastaCacheFotosPerfilPersistente();
    fs.mkdirSync(pasta, { recursive: true });

    const itens = {};

    for (const [conversaId, item] of indiceFotosPerfilPersistentes.entries()) {
      if (!conversaId || !item?.arquivo) {
        continue;
      }

      itens[conversaId] = {
        arquivo: item.arquivo,
        atualizadoEm: Number(item.atualizadoEm || 0) || Date.now(),
      };
    }

    const arquivo = arquivoIndiceFotosPerfilPersistente();
    const temporario = `${arquivo}.tmp`;

    fs.writeFileSync(
      temporario,
      JSON.stringify(
        {
          versao: 1,
          atualizadoEm: Date.now(),
          itens,
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.renameSync(temporario, arquivo);
  } catch (erro) {
    console.warn(
      `[FOTOS PERFIL CACHE] falha ao salvar indice | erro=${String(
        erro?.message || erro || "unknown",
      )}`,
    );
  }
}

function agendarSalvarIndiceFotosPerfilPersistente() {
  indiceFotosPerfilPersistenteSujo = true;

  if (timerSalvarIndiceFotosPerfilPersistente) {
    return;
  }

  timerSalvarIndiceFotosPerfilPersistente = setTimeout(() => {
    timerSalvarIndiceFotosPerfilPersistente = null;

    if (!indiceFotosPerfilPersistenteSujo) {
      return;
    }

    indiceFotosPerfilPersistenteSujo = false;
    salvarIndiceFotosPerfilPersistenteAgora();
  }, 800);
}

function registrarLogFotoPerfilCacheada() {
  fotosPerfilCacheadasDesdeUltimoLog += 1;

  if (timerLogFotosPerfilCacheadas) {
    return;
  }

  timerLogFotosPerfilCacheadas = setTimeout(() => {
    timerLogFotosPerfilCacheadas = null;

    const total = fotosPerfilCacheadasDesdeUltimoLog;
    fotosPerfilCacheadasDesdeUltimoLog = 0;

    if (total > 0) {
      console.log(`[FOTOS PERFIL CACHE] lote salvo | total=${total}.`);
    }
  }, 1200);
}

function urlFotoPerfilPersistente(conversaId) {
  carregarIndiceFotosPerfilPersistente();

  const id = String(conversaId || "").trim();
  const item = indiceFotosPerfilPersistentes.get(id);

  if (!id || !item?.arquivo) {
    return null;
  }

  const caminhoFoto = path.join(
    pastaCacheFotosPerfilPersistente(),
    item.arquivo,
  );

  if (!fs.existsSync(caminhoFoto)) {
    indiceFotosPerfilPersistentes.delete(id);
    return null;
  }

  try {
    return pathToFileURL(caminhoFoto).href;
  } catch {
    return null;
  }
}

function persistirFotoPerfilLocal(conversaId, imagem) {
  const id = String(conversaId || "").trim();

  if (!id || !imagem || imagem.isEmpty()) {
    return null;
  }

  try {
    carregarIndiceFotosPerfilPersistente();

    const pasta = pastaCacheFotosPerfilPersistente();
    fs.mkdirSync(pasta, { recursive: true });

    const tamanho = imagem.getSize();
    let imagemPersistente = imagem;

    if (tamanho.width > 320 || tamanho.height > 320) {
      imagemPersistente = imagem.resize({
        width: 256,
        height: 256,
        quality: "best",
      });
    }

    const nomeArquivo = nomeArquivoFotoPerfilPersistente(id);
    const caminhoFoto = path.join(pasta, nomeArquivo);
    const temporario = `${caminhoFoto}.tmp`;
    const png = imagemPersistente.toPNG();

    if (!png?.length) {
      return null;
    }

    fs.writeFileSync(temporario, png);
    fs.renameSync(temporario, caminhoFoto);

    indiceFotosPerfilPersistentes.set(id, {
      arquivo: nomeArquivo,
      atualizadoEm: Date.now(),
    });
    agendarSalvarIndiceFotosPerfilPersistente();

    return pathToFileURL(caminhoFoto).href;
  } catch (erro) {
    console.warn(
      `[FOTOS PERFIL CACHE] falha ao persistir | conversa=${id} | erro=${String(
        erro?.message || erro || "unknown",
      )}`,
    );
    return null;
  }
}

function mapaFotosPerfilPersistentes() {
  carregarIndiceFotosPerfilPersistente();

  const fotos = {};

  for (const conversaId of indiceFotosPerfilPersistentes.keys()) {
    const url = urlFotoPerfilPersistente(conversaId);

    if (url) {
      fotos[conversaId] = url;
    }
  }

  return fotos;
}

function obterFotoNotificacaoPersistente(conversaId) {
  const id = String(conversaId || "").trim();

  if (!id) {
    return null;
  }

  const emMemoria = fotosNotificacaoContato.get(id);

  if (emMemoria && !emMemoria.isEmpty()) {
    return emMemoria;
  }

  carregarIndiceFotosPerfilPersistente();

  const item = indiceFotosPerfilPersistentes.get(id);
  const caminhoFoto = item?.arquivo
    ? path.join(pastaCacheFotosPerfilPersistente(), item.arquivo)
    : "";

  if (!caminhoFoto || !fs.existsSync(caminhoFoto)) {
    return null;
  }

  try {
    let imagem = nativeImage.createFromPath(caminhoFoto);

    if (!imagem || imagem.isEmpty()) {
      return null;
    }

    const tamanho = imagem.getSize();

    if (tamanho.width > 128 || tamanho.height > 128) {
      imagem = imagem.resize({
        width: 96,
        height: 96,
        quality: "good",
      });
    }

    fotosNotificacaoContato.set(id, imagem);
    return imagem;
  } catch {
    return null;
  }
}

function carregarFotosPerfilPersistentesParaNotificacoes() {
  carregarIndiceFotosPerfilPersistente();

  let carregadas = 0;

  for (const conversaId of indiceFotosPerfilPersistentes.keys()) {
    const item = indiceFotosPerfilPersistentes.get(conversaId);
    const caminhoFoto = item?.arquivo
      ? path.join(pastaCacheFotosPerfilPersistente(), item.arquivo)
      : "";

    if (!caminhoFoto || !fs.existsSync(caminhoFoto)) {
      continue;
    }

    try {
      let imagem = nativeImage.createFromPath(caminhoFoto);

      if (!imagem || imagem.isEmpty()) {
        continue;
      }

      const tamanho = imagem.getSize();

      if (tamanho.width > 128 || tamanho.height > 128) {
        imagem = imagem.resize({
          width: 96,
          height: 96,
          quality: "good",
        });
      }

      fotosNotificacaoContato.set(conversaId, imagem);
      carregadas += 1;
    } catch {}
  }

  if (carregadas) {
    console.log(
      `[FOTOS PERFIL CACHE] memoria preparada | total=${carregadas}.`,
    );
  }
}

ipcMain.handle("obter-cache-fotos-perfil", async () => {
  const fotos = mapaFotosPerfilPersistentes();

  return {
    ok: true,
    fotos,
    total: Object.keys(fotos).length,
  };
});

async function cachearFotoNotificacaoContato(conversaId, fotoPerfilUrl) {
  const id = String(conversaId || "").trim();
  const origem = String(fotoPerfilUrl || "").trim();

  if (!id || !origem) {
    return false;
  }

  if (carregamentosFotoNotificacaoContato.has(id)) {
    return carregamentosFotoNotificacaoContato.get(id);
  }

  const carregamento = (async () => {
    try {
      let imagem = null;

      if (origem.startsWith("data:image/")) {
        imagem = nativeImage.createFromDataURL(origem);
      } else if (/^https?:\/\//i.test(origem)) {
        const resposta = await session.defaultSession.fetch(origem);

        if (!resposta.ok) {
          throw new Error(`HTTP ${resposta.status}`);
        }

        const tamanhoDeclarado = Number(
          resposta.headers.get("content-length") || 0,
        );

        if (tamanhoDeclarado > 5 * 1024 * 1024) {
          throw new Error("imagem acima do limite de 5 MB");
        }

        const buffer = Buffer.from(await resposta.arrayBuffer());

        if (buffer.length > 5 * 1024 * 1024) {
          throw new Error("imagem acima do limite de 5 MB");
        }

        imagem = nativeImage.createFromBuffer(buffer);
      } else if (origem.startsWith("file:")) {
        try {
          imagem = nativeImage.createFromPath(new URL(origem).pathname);
        } catch {}
      } else if (path.isAbsolute(origem) && fs.existsSync(origem)) {
        imagem = nativeImage.createFromPath(origem);
      }

      if (!imagem || imagem.isEmpty()) {
        return false;
      }

      // A foto de perfil e persistida em disco antes de ser reduzida para
      // notificacao. Assim a interface pode reutiliza-la no proximo boot.
      persistirFotoPerfilLocal(id, imagem);

      let imagemNotificacao = imagem;
      const tamanho = imagemNotificacao.getSize();

      if (tamanho.width > 128 || tamanho.height > 128) {
        imagemNotificacao = imagemNotificacao.resize({
          width: 96,
          height: 96,
          quality: "good",
        });
      }

      fotosNotificacaoContato.set(id, imagemNotificacao);

      registrarLogFotoPerfilCacheada();

      return true;
    } catch (erro) {
      console.log(
        `[NOTIFICACOES EXTERNAS] foto indisponivel | conversa=${id} | erro=${String(
          erro?.message || erro || "unknown",
        )}`,
      );

      return false;
    } finally {
      carregamentosFotoNotificacaoContato.delete(id);
    }
  })();

  carregamentosFotoNotificacaoContato.set(id, carregamento);

  return carregamento;
}

ipcMain.handle("cachear-foto-notificacao", async (_, dados = {}) => {
  const conversaId = String(dados?.conversaId || "").trim();
  const ok = await cachearFotoNotificacaoContato(
    conversaId,
    dados?.fotoPerfilUrl,
  );

  return {
    ok,
    url: ok ? urlFotoPerfilPersistente(conversaId) : null,
  };
});

ipcMain.handle("mostrar-notificacao", async (_, dados) => {
  if (!Notification.isSupported()) {
    return {
      ok: false,
      erro: "Notificacoes do sistema nao sao suportadas.",
    };
  }

  const titulo = String(dados?.titulo || "WhatsIAPP").trim() || "WhatsIAPP";
  const corpo =
    String(dados?.corpo || "Nova mensagem").trim() || "Nova mensagem";

  const notificacao = new Notification({
    title: titulo,
    body: corpo,
    icon:
      process.platform === "win32" ? garantirIconeWindows() : caminhoLogoPng(),
    silent: true,
  });

  notificacoesAtivas.add(notificacao);

  const limpar = () => {
    notificacoesAtivas.delete(notificacao);
  };

  notificacao.once("close", limpar);
  notificacao.once("failed", (_evento, erro) => {
    console.warn("Native notification failed:", erro || "unknown error");
    limpar();
  });

  notificacao.once("click", () => {
    limpar();

    if (!janela || janela.isDestroyed()) {
      return;
    }

    if (janela.isMinimized()) {
      janela.restore();
    }

    janela.show();
    janela.focus();
  });

  notificacao.show();

  return {
    ok: true,
  };
});

ipcMain.handle("mostrar-notificacao-mensagem", async (_, dados = {}) => {
  const conversaId = String(dados?.conversaId || "").trim();
  const titulo = String(dados?.titulo || "WhatsIAPP").trim() || "WhatsIAPP";
  const corpo =
    String(dados?.corpo || "Nova mensagem").trim() || "Nova mensagem";
  const fotoPerfilUrl = String(dados?.fotoPerfilUrl || "").trim();

  if (conversaId && fotoPerfilUrl && !fotosNotificacaoContato.has(conversaId)) {
    cachearFotoNotificacaoContato(conversaId, fotoPerfilUrl).catch(() => {});
  }

  const estadoJanela = {
    existe: !!janela && !janela.isDestroyed(),
    focada: !!janela && !janela.isDestroyed() ? janela.isFocused() : false,
    minimizada:
      !!janela && !janela.isDestroyed() ? janela.isMinimized() : false,
    visivel: !!janela && !janela.isDestroyed() ? janela.isVisible() : false,
  };

  console.log(
    `[NOTIFICACOES EXTERNAS] solicitada | conversa=${conversaId || "desconhecida"} ` +
      `| focada=${estadoJanela.focada} | minimizada=${estadoJanela.minimizada} ` +
      `| visivel=${estadoJanela.visivel}`,
  );

  // A decisao de mostrar fora do app precisa ser do processo principal.
  // document.hasFocus() no renderer nao e confiavel quando a janela e minimizada.
  if (estadoJanela.existe && estadoJanela.focada && !estadoJanela.minimizada) {
    console.log(
      `[NOTIFICACOES EXTERNAS] suprimida porque a janela esta em foco | conversa=${conversaId || "desconhecida"}.`,
    );

    return {
      ok: true,
      exibida: false,
      motivo: "janela-em-foco",
    };
  }

  if (!Notification.isSupported()) {
    console.warn(
      "[NOTIFICACOES EXTERNAS] Notification.isSupported() retornou false.",
    );
    return {
      ok: false,
      exibida: false,
      erro: "Notificacoes do sistema nao sao suportadas.",
    };
  }

  try {
    const notificacao = new Notification({
      title: titulo,
      body: corpo,
      icon:
        fotosNotificacaoContato.get(conversaId) ||
        obterFotoNotificacaoPersistente(conversaId) ||
        (process.platform === "win32"
          ? garantirIconeWindows()
          : caminhoLogoPng()),
      silent: true,
      timeoutType: "default",
    });

    notificacoesAtivas.add(notificacao);

    const limpar = () => {
      notificacoesAtivas.delete(notificacao);
    };

    notificacao.once("show", () => {
      const fotoContato = fotosNotificacaoContato.has(conversaId);

      console.log(
        `[NOTIFICACOES EXTERNAS] exibida pelo Windows | conversa=${conversaId || "desconhecida"} | fotoContato=${fotoContato}.`,
      );
    });

    notificacao.once("close", limpar);

    notificacao.once("failed", (_evento, erro) => {
      console.warn(
        `[NOTIFICACOES EXTERNAS] falhou no Windows | conversa=${conversaId || "desconhecida"} | erro=${String(erro || "unknown")}`,
      );
      limpar();
    });

    notificacao.once("click", () => {
      limpar();

      if (!janela || janela.isDestroyed()) {
        return;
      }

      if (janela.isMinimized()) {
        janela.restore();
      }

      janela.show();
      janela.focus();

      if (conversaId) {
        janela.webContents.send("abrir-conversa-notificacao", { conversaId });
      }
    });

    notificacao.show();

    return {
      ok: true,
      exibida: true,
    };
  } catch (erro) {
    console.warn(
      `[NOTIFICACOES EXTERNAS] excecao ao criar notificacao | conversa=${conversaId || "desconhecida"} | erro=${erro?.message || erro || "unknown"}`,
    );

    return {
      ok: false,
      exibida: false,
      erro: erro?.message || String(erro || "unknown"),
    };
  }
});

ipcMain.handle("carregar-midia", async (_, dados = {}) => {
  const payloadOriginal = dados && typeof dados === "object" ? dados : {};

  const resultadoBaileys = await solicitarAoWorker(
    "baileys",
    "carregar-midia",
    payloadOriginal,
    45000,
  );

  if (resultadoBaileys?.ok) {
    return resultadoBaileys;
  }

  const erroBaileys = String(resultadoBaileys?.erro || "");
  const tipoConhecido = String(
    payloadOriginal?.tipo || resultadoBaileys?.tipo || "",
  ).trim();

  const ehMidiaConhecida = [
    "imagem",
    "video",
    "audio",
    "documento",
    "sticker",
  ].includes(tipoConhecido);

  const payloadWpp = {
    ...payloadOriginal,
    idMensagemWpp:
      String(
        payloadOriginal?.idMensagemWpp ||
          resultadoBaileys?.idMensagemWpp ||
          "",
      ).trim() || null,
    tipo: tipoConhecido || null,
    mime: payloadOriginal?.mime || resultadoBaileys?.mime || null,
    fileName:
      payloadOriginal?.fileName || resultadoBaileys?.fileName || null,
    timestamp:
      Number(
        payloadOriginal?.timestamp || resultadoBaileys?.timestamp || 0,
      ) || null,
  };

  const possuiIdHistoricoWpp = !!payloadWpp.idMensagemWpp;
  const erroSemMetadados =
    erroBaileys ===
    "Mídia histórica sem os metadados necessários para download.";

  // Only use the heavier WPP path for an item known to be media,
  // an item with the exact WPP ID, or the known historical metadata case.
  if (!ehMidiaConhecida && !possuiIdHistoricoWpp && !erroSemMetadados) {
    return resultadoBaileys;
  }

  console.log(
    `[MIDIA HISTORICA] FALLBACK_WPP | conversa=${String(
      payloadWpp?.conversaId || "",
    )} | id=${String(payloadWpp?.idMensagem || "")} | ` +
      `id_wpp=${possuiIdHistoricoWpp ? "sim" : "nao"} | tipo=${tipoConhecido || "-"}`,
  );

  const resultadoWpp = await solicitarAoWorker(
    "wpp",
    "recuperar-midia-historica",
    payloadWpp,
    90000,
  );

  if (resultadoWpp?.ok) {
    const persistida = await solicitarAoWorker(
      "baileys",
      "registrar-midia-recuperada",
      {
        conversaId: payloadWpp.conversaId,
        idMensagem: payloadWpp.idMensagem,
        idMensagemWpp:
          resultadoWpp.idMensagemWpp || payloadWpp.idMensagemWpp || null,
        mediaPath: resultadoWpp.mediaPath,
        mime: resultadoWpp.mime || payloadWpp.mime || null,
        fileName: resultadoWpp.fileName || payloadWpp.fileName || null,
      },
      8000,
    );

    if (!persistida?.ok) {
      console.warn(
        `[MIDIA HISTORICA] CACHE_LOCAL_FALHOU | conversa=${String(
          payloadWpp?.conversaId || "",
        )} | id=${String(payloadWpp?.idMensagem || "")} | ` +
          `erro=${String(persistida?.erro || "unknown")}`,
      );
    }

    return resultadoWpp;
  }

  return {
    ...resultadoBaileys,
    erro:
      resultadoWpp?.erro ||
      resultadoBaileys?.erro ||
      "Mídia histórica indisponível.",
  };
});

ipcMain.handle("listar-midia-links-docs-conversa", async (_, dados) => {
  return solicitarAoWorker(
    "wpp",
    "listar-midia-links-docs",
    dados || {},
    25000,
  );
});

ipcMain.handle("marcar-conversa-lida", async (_, dados) => {
  const [resultadoBaileys, resultadoWpp] = await Promise.all([
    solicitarAoWorker("baileys", "marcar-conversa-lida", dados, 30000),
    solicitarAoWorker("wpp", "marcar-conversa-lida", dados, 8000),
  ]);

  if (!resultadoWpp?.ok) {
    console.warn(
      `[LEITURA] WPP_FALHOU | conversa=${String(
        dados?.conversaId || "",
      )} | erro=${String(resultadoWpp?.erro || "unknown")}`,
    );
  }

  if (!resultadoBaileys?.ok && !resultadoWpp?.ok) {
    return {
      ok: false,
      erro:
        resultadoWpp?.erro ||
        resultadoBaileys?.erro ||
        "Nao foi possivel marcar a conversa como lida.",
    };
  }

  console.log(
    `[LEITURA] PROPAGADA | conversa=${String(
      dados?.conversaId || "",
    )} | baileys=${!!resultadoBaileys?.ok} | wpp=${!!resultadoWpp?.ok}`,
  );

  return {
    ...(resultadoBaileys?.ok ? resultadoBaileys : {}),
    ok: true,
    leituraBaileys: !!resultadoBaileys?.ok,
    leituraWpp: !!resultadoWpp?.ok,
  };
});

ipcMain.handle("enviar-mensagem-texto", async (_, dados) => {
  const conversaId = String(dados?.conversaId || "").trim();
  const sessaoTeste = testeIntegridadeIAAtivo;

  if (sessaoTeste && conversaId && conversaId === sessaoTeste.conversaTesteId) {
    const texto = String(dados?.texto || "");
    const etapa = sessaoTeste.etapaAtual;

    if (etapa) {
      etapa.resposta = texto;
    }

    consoleTesteIAOriginal.log(
      `[TEST IA] RESPONSE_CAPTURED | n=${Number(etapa?.numero || 0)} | chars=${texto.length}`,
    );

    const timestamp = Date.now();

    setTimeout(() => {
      if (!janela || janela.isDestroyed()) {
        return;
      }

      janela.webContents.send("mensagem", {
        id: sessaoTeste.conversaTesteId,
        nome: `[Teste IA] ${sessaoTeste.conversaOriginalNome}`,
        arquivada: false,
        trancada: false,
        idMensagem: `test-ia-out-${timestamp}-${Math.random()
          .toString(16)
          .slice(2)}`,
        idMensagemWpp: null,
        resposta: null,
        texto,
        tipo: "texto",
        mime: null,
        fileName: null,
        viewOnceKind: null,
        horario: new Date(timestamp).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        timestamp,
        minha: true,
        mediaPath: null,
        mediaUrl: null,
        rawBase64: null,
        statusEntrega: "lida",
        editada: false,
        reacoes: [],
        testeIntegridadeIA: true,
      });
    }, 50);

    setTimeout(() => {
      if (!janela || janela.isDestroyed()) {
        return;
      }

      janela.webContents.send("admin-teste-ia-resposta-capturada", {
        conversaTesteId: sessaoTeste.conversaTesteId,
        numero: Number(etapa?.numero || 0),
        resposta: texto,
      });
    }, 1300);

    return {
      ok: true,
      testeIntegridadeIA: true,
      idMensagem: `test-ia-out-${timestamp}`,
    };
  }

  return solicitarAoWorker("wpp", "enviar-texto", dados, 30000);
});

ipcMain.handle("status-uso-groq", async (_, periodo = "dia") => {
  return {
    ok: true,
    uso: obterUsoGroqPeriodo(periodo),
  };
});

ipcMain.handle("status-chave-groq", async () => {
  const segura = chaveGroqSeguraConfigurada() && !!obterChaveGroqSegura();

  return {
    ok: true,
    configurada: segura,
    armazenamentoSeguro: segura,
    criptografiaDisponivel: safeStorage.isEncryptionAvailable(),
  };
});

ipcMain.handle("salvar-chave-groq", async () => {
  return {
    ok: false,
    erro: "A chave da Groq só pode ser alterada pela área administrativa.",
  };
});

ipcMain.handle("remover-chave-groq", async () => {
  return {
    ok: false,
    erro: "A chave da Groq só pode ser alterada pela área administrativa.",
  };
});

ipcMain.handle("gerar-resposta-factual-ia", async (_, dados) => {
  return executarComContextoCobrancaGroq(dados, "factual", () =>
    gerarRespostaFactualGroq(dados),
  );
});

ipcMain.handle("gerar-resposta-web-ia", async (_, dados) => {
  return executarComContextoCobrancaGroq(dados, "web", () =>
    gerarRespostaWebGroq(dados),
  );
});

ipcMain.handle("gerar-sugestao-ia", async (_, dados) => {
  return executarComContextoCobrancaGroq(dados, "assistido", () =>
    gerarSugestaoGroq(dados),
  );
});

ipcMain.handle("gerar-resposta-automatica-ia", async (_, dados) => {
  return executarComContextoCobrancaGroq(dados, "automatico", () =>
    gerarRespostaAutomaticaGroq(dados),
  );
});

ipcMain.handle("interpretar-imagem-ia", async (_, dados) => {
  return executarComContextoCobrancaGroq(dados, "visao", () =>
    interpretarImagemGroq(dados),
  );
});

ipcMain.handle("interpretar-documento-imagem-ia", async (_, dados) => {
  return executarComContextoCobrancaGroq(dados, "documento-ocr", () =>
    interpretarDocumentoImagemGroq(dados),
  );
});

ipcMain.handle("transcrever-audio-ia", async (_, dados) => {
  return executarComContextoCobrancaGroq(dados, "transcricao", () =>
    transcreverAudioGroq(dados),
  );
});

ipcMain.handle("ler-documento-ia", async (_evento, dados = {}) => {
  const mediaPath = String(dados?.mediaPath || "").trim();
  const mime = String(dados?.mime || "")
    .trim()
    .toLowerCase();
  const fileName = String(dados?.fileName || "").trim();
  const ehPdf =
    mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

  if (!mediaPath || !ehPdf) {
    return {
      ok: false,
      erro: "Documento PDF invalido para leitura.",
    };
  }

  try {
    if (!fs.existsSync(mediaPath)) {
      return {
        ok: false,
        erro: "O arquivo do documento nao foi encontrado.",
      };
    }

    const stats = fs.statSync(mediaPath);

    if (!stats.isFile() || stats.size <= 0) {
      return {
        ok: false,
        erro: "O arquivo do documento esta vazio ou indisponivel.",
      };
    }

    const extraido = await extrairPaginasTextoCatalogo(mediaPath);
    const paginasComTexto = (extraido.paginas || []).filter((item) =>
      String(item?.texto || "").trim(),
    );
    const textoCompleto = normalizarTextoExtraidoCatalogo(
      paginasComTexto
        .map(
          (item) =>
            `[Pagina ${Math.max(1, Number(item?.pagina || 0) || 1)}]\n${String(
              item?.texto || "",
            ).trim()}`,
        )
        .join("\n\n"),
    );
    const caracteresExtraidos = textoCompleto.length;

    if (!caracteresExtraidos) {
      console.log(
        `[DOCUMENTO IA] PDF_SEM_TEXTO | file=${path
          .basename(fileName || mediaPath)
          .replace(/[^\x20-\x7E]/g, "")}`,
      );

      return {
        ok: false,
        ocrNecessario: true,
        erro: "Nao foi encontrado texto pesquisavel neste PDF. Ele pode ser um documento escaneado.",
        totalPaginas: Math.max(0, Number(extraido?.totalPaginas || 0) || 0),
      };
    }

    const LIMITE_TEXTO_DOCUMENTO_IA = 16000;
    const texto = textoCompleto.slice(0, LIMITE_TEXTO_DOCUMENTO_IA);
    const truncado = textoCompleto.length > LIMITE_TEXTO_DOCUMENTO_IA;

    console.log(
      `[DOCUMENTO IA] PDF_LIDO | file=${path
        .basename(fileName || mediaPath)
        .replace(/[^\x20-\x7E]/g, "")} | pages=${Math.max(
        0,
        Number(extraido?.totalPaginas || 0) || 0,
      )} | text_pages=${paginasComTexto.length} | chars=${caracteresExtraidos} | truncado=${truncado}`,
    );

    return {
      ok: true,
      texto,
      fileName: fileName || path.basename(mediaPath),
      totalPaginas: Math.max(0, Number(extraido?.totalPaginas || 0) || 0),
      paginasComTexto: paginasComTexto.length,
      caracteresExtraidos,
      truncado,
      ocrNecessario: false,
    };
  } catch (erro) {
    const detalhe = String(erro?.message || erro || "");
    const detalheNormalizado = detalhe.toLowerCase();

    console.warn(
      `[DOCUMENTO IA] PDF_ERRO | ${detalhe
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 220)}`,
    );

    if (
      detalheNormalizado.includes("password") ||
      detalheNormalizado.includes("encrypted") ||
      detalheNormalizado.includes("protegido")
    ) {
      return {
        ok: false,
        erro: "O PDF esta protegido por senha e nao pode ser lido.",
      };
    }

    return {
      ok: false,
      erro: "Nao foi possivel extrair o texto deste PDF.",
    };
  }
});

ipcMain.handle("listar-status-whatsapp", async () => {
  return solicitarAoWorker("wpp", "listar-status", {}, 25000);
});

ipcMain.handle("carregar-midia-status-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "carregar-midia-status", dados || {}, 40000);
});

ipcMain.handle("marcar-status-visto-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "marcar-status-visto", dados || {}, 20000);
});

ipcMain.handle("reagir-status-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "reagir-status", dados || {}, 22000);
});

ipcMain.handle("responder-status-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "responder-status", dados || {}, 22000);
});

ipcMain.handle("publicar-status-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "publicar-status", dados || {}, 120000);
});

ipcMain.handle("listar-visualizadores-status-whatsapp", async (_, dados) => {
  return solicitarAoWorker(
    "wpp",
    "listar-visualizadores-status",
    dados || {},
    30000,
  );
});

ipcMain.handle("apagar-status-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "apagar-status", dados || {}, 30000);
});

ipcMain.handle("salvar-midia-status-whatsapp", async (_, dados) => {
  const resultado = await solicitarAoWorker(
    "wpp",
    "carregar-midia-status",
    dados || {},
    40000,
  );

  if (!resultado?.ok || !resultado?.mediaPath) {
    return resultado?.ok === false
      ? resultado
      : {
          ok: false,
          erro: "Nao foi possivel preparar a midia deste Status.",
        };
  }

  const origem = String(resultado.mediaPath || "").trim();

  if (!origem || !fs.existsSync(origem)) {
    return {
      ok: false,
      erro: "Arquivo temporario do Status nao encontrado.",
    };
  }

  const extensao = path.extname(origem) || ".bin";
  const salvo = await dialog.showSaveDialog(janela, {
    title: "Salvar status",
    defaultPath: path.join(
      app.getPath("downloads"),
      `status-${Date.now()}${extensao}`,
    ),
  });

  if (salvo.canceled || !salvo.filePath) {
    return {
      ok: false,
      cancelado: true,
    };
  }

  try {
    fs.copyFileSync(origem, salvo.filePath);

    return {
      ok: true,
      caminho: salvo.filePath,
    };
  } catch (erro) {
    return {
      ok: false,
      erro: erro?.message || "Nao foi possivel salvar o Status.",
    };
  }
});

ipcMain.handle("listar-contatos-salvos-whatsapp", async () => {
  const [resultadoWpp, resultadoBaileys] = await Promise.all([
    solicitarAoWorker("wpp", "listar-contatos-salvos", {}, 25000),
    solicitarAoWorker("baileys", "listar-contatos-salvos", {}, 20000),
  ]);

  const contatosWpp = Array.isArray(resultadoWpp?.contatos)
    ? resultadoWpp.contatos
    : [];

  // WPPConnect e a autoridade para saber se o contato esta realmente
  // salvo na agenda do WhatsApp. Nome de chat/pushName nao conta.
  if (resultadoWpp?.ok && contatosWpp.length) {
    return {
      ok: true,
      contatos: contatosWpp,
      fonte: "wpp-salvos",
    };
  }

  const contatosBaileys = Array.isArray(resultadoBaileys?.contatos)
    ? resultadoBaileys.contatos
    : [];

  if (resultadoBaileys?.ok && contatosBaileys.length) {
    return {
      ok: true,
      contatos: contatosBaileys,
      fonte: "baileys-fallback",
      aviso: resultadoWpp?.erro || null,
    };
  }

  return {
    ok: !!resultadoWpp?.ok || !!resultadoBaileys?.ok,
    contatos: [],
    fonte: resultadoWpp?.ok ? "wpp-vazio" : "baileys-vazio",
    erro: resultadoWpp?.erro || resultadoBaileys?.erro || null,
  };
});

ipcMain.handle("listar-grupos-whatsapp", async () => {
  const [resultadoBaileys, resultadoWpp] = await Promise.all([
    solicitarAoWorker("baileys", "listar-grupos", {}, 20000),
    solicitarAoWorker("wpp", "listar-grupos-atuais", {}, 25000),
  ]);

  const gruposBaileys = Array.isArray(resultadoBaileys?.grupos)
    ? resultadoBaileys.grupos
    : [];

  const gruposWpp = Array.isArray(resultadoWpp?.grupos)
    ? resultadoWpp.grupos
    : [];

  if (resultadoWpp?.ok && gruposWpp.length > 0) {
    const porChave = new Map();

    for (const grupo of gruposBaileys) {
      const chave = chaveCanonica(grupo?.id);

      if (chave) {
        porChave.set(chave, grupo);
      }
    }

    const grupos = gruposWpp.map((grupoWpp) => {
      const candidatos = [
        grupoWpp?.id,
        ...(Array.isArray(grupoWpp?.aliases) ? grupoWpp.aliases : []),
      ];

      let grupoBaileys = null;

      for (const candidato of candidatos) {
        const chave = chaveCanonica(candidato);

        if (chave && porChave.has(chave)) {
          grupoBaileys = porChave.get(chave);
          break;
        }
      }

      return {
        ...(grupoBaileys || {}),
        id: grupoBaileys?.id || grupoWpp?.id,
        nome: grupoWpp?.nome || grupoBaileys?.nome || grupoWpp?.id,
        arquivada: !!grupoWpp?.arquivada,
        trancada: !!grupoWpp?.trancada,
        grupo: true,
        mensagens: Array.isArray(grupoBaileys?.mensagens)
          ? grupoBaileys.mensagens
          : [],
      };
    });

    console.log(
      `[GRUPOS ATUAIS] wpp=${gruposWpp.length} | baileys=${gruposBaileys.length} | usados=${grupos.length} | fonte=wpp+baileys.`,
    );

    return {
      ok: true,
      grupos,
      fonte: "wpp+baileys",
    };
  }

  if (resultadoBaileys?.ok && gruposBaileys.length > 0) {
    const grupos = gruposBaileys.map((grupo) => ({
      ...grupo,
      grupo: true,
    }));

    console.log(
      `[GRUPOS ATUAIS] wpp=${gruposWpp.length} | baileys=${gruposBaileys.length} | usados=${grupos.length} | fonte=baileys-fallback.`,
    );

    return {
      ok: true,
      grupos,
      fonte: "baileys-fallback",
      aviso: resultadoWpp?.ok
        ? "WPPConnect retornou lista vazia; Baileys usado como fallback."
        : resultadoWpp?.erro || null,
    };
  }

  console.log(
    `[GRUPOS ATUAIS] wpp=${gruposWpp.length} | baileys=${gruposBaileys.length} | usados=0 | fonte=vazio.`,
  );

  return {
    ok: !!resultadoWpp?.ok || !!resultadoBaileys?.ok,
    grupos: [],
    fonte: resultadoWpp?.ok ? "wpp-vazio" : "baileys-vazio",
    erro:
      !resultadoWpp?.ok && !resultadoBaileys?.ok
        ? resultadoBaileys?.erro ||
          resultadoWpp?.erro ||
          "Falha ao listar grupos."
        : null,
  };
});

ipcMain.handle("listar-grupos-em-comum", async (_, dados) => {
  const conversaId = String(dados?.conversaId || "").trim();

  if (!conversaId) {
    return {
      ok: false,
      grupos: [],
      erro: "Conversa invalida para grupos em comum.",
    };
  }

  const payload = {
    conversaId,
    numeroWhatsapp: dados?.numeroWhatsapp || null,
  };

  const [resultadoWpp, resultadoBaileys] = await Promise.all([
    solicitarAoWorker("wpp", "listar-grupos-em-comum", payload, 25000),
    solicitarAoWorker("baileys", "listar-grupos-em-comum", payload, 25000),
  ]);

  const gruposWpp = Array.isArray(resultadoWpp?.grupos)
    ? resultadoWpp.grupos
    : [];
  const gruposBaileys = Array.isArray(resultadoBaileys?.grupos)
    ? resultadoBaileys.grupos
    : [];

  const porGrupo = new Map();

  const adicionarGrupo = (grupo, origem) => {
    const id = String(grupo?.id || "").trim();
    const chave = chaveCanonica(id);

    if (!id || !chave) {
      return;
    }

    const existente = porGrupo.get(chave) || null;

    if (!existente) {
      porGrupo.set(chave, {
        ...grupo,
        id,
        grupo: true,
        __origens: new Set([origem]),
      });
      return;
    }

    existente.__origens.add(origem);

    if (origem === "wpp") {
      existente.nome = grupo?.nome || existente.nome;
      existente.arquivada =
        typeof grupo?.arquivada === "boolean"
          ? !!grupo.arquivada
          : existente.arquivada;
      existente.trancada =
        typeof grupo?.trancada === "boolean"
          ? !!grupo.trancada
          : existente.trancada;
    } else if (!existente.nome && grupo?.nome) {
      existente.nome = grupo.nome;
    }

    existente.totalParticipantes = Math.max(
      Number(existente.totalParticipantes || 0) || 0,
      Number(grupo?.totalParticipantes || 0) || 0,
    );
  };

  for (const grupo of gruposWpp) {
    adicionarGrupo(grupo, "wpp");
  }

  for (const grupo of gruposBaileys) {
    adicionarGrupo(grupo, "baileys");
  }

  const grupos = Array.from(porGrupo.values())
    .map((grupo) => {
      const { __origens, ...limpo } = grupo;
      return limpo;
    })
    .sort((a, b) =>
      String(a?.nome || a?.id || "").localeCompare(
        String(b?.nome || b?.id || ""),
        "pt-BR",
        { sensitivity: "base" },
      ),
    );

  const wppTem = gruposWpp.length > 0;
  const baileysTem = gruposBaileys.length > 0;

  let fonte = "wpp+baileys-vazio";

  if (wppTem && baileysTem) {
    fonte = "wpp+baileys";
  } else if (wppTem) {
    fonte = "wpp";
  } else if (baileysTem) {
    fonte = "baileys-fallback";
  } else if (resultadoWpp?.ok && !resultadoBaileys?.ok) {
    fonte = "wpp-vazio";
  } else if (!resultadoWpp?.ok && resultadoBaileys?.ok) {
    fonte = "baileys-vazio";
  }

  console.log(
    `[GRUPOS EM COMUM] contato=${conversaId} | wpp=${gruposWpp.length} | ` +
      `baileys=${gruposBaileys.length} | merged=${grupos.length} | fonte=${fonte}.`,
  );

  return {
    ok: !!resultadoWpp?.ok || !!resultadoBaileys?.ok,
    grupos,
    fonte,
    erro:
      !resultadoWpp?.ok && !resultadoBaileys?.ok
        ? resultadoWpp?.erro ||
          resultadoBaileys?.erro ||
          "Falha ao consultar grupos em comum."
        : null,
  };
});

ipcMain.handle("listar-participantes-grupo", async (_, dados) => {
  const conversaId = String(dados?.conversaId || "").trim();

  if (!conversaId || !conversaId.endsWith("@g.us")) {
    return {
      ok: false,
      participantes: [],
      euNoGrupo: false,
      total: 0,
      erro: "Grupo invalido para listar participantes.",
    };
  }

  const chaveGrupo = chaveCanonica(conversaId);
  const conversaGrupo = (
    Array.isArray(conversasBase) ? conversasBase : []
  ).find((item) => chaveCanonica(item?.id) === chaveGrupo);

  const mensagensAlvoGrupo = (
    Array.isArray(conversaGrupo?.mensagens) ? conversaGrupo.mensagens : []
  )
    .filter((msg) => !msg?.minha && msg?.idMensagem)
    .slice(-180)
    .map((msg) => ({
      idMensagem: String(msg.idMensagem || "").trim(),
      timestamp: Number(msg.timestamp || 0) || 0,
      texto: String(msg.texto || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200),
      tipo: String(msg.tipo || "texto")
        .trim()
        .toLowerCase(),
      fileName: String(msg.fileName || "")
        .trim()
        .slice(0, 260),
    }))
    .filter((msg) => msg.idMensagem);

  const idsMensagensGrupo = mensagensAlvoGrupo.map((msg) => msg.idMensagem);

  const [resultadoWpp, resultadoBaileys] = await Promise.all([
    solicitarAoWorker(
      "wpp",
      "listar-participantes-grupo",
      {
        conversaId,
        idsMensagens: idsMensagensGrupo,
        mensagensAlvo: mensagensAlvoGrupo,
      },
      30000,
    ),
    solicitarAoWorker("baileys", "listar-autores-grupo", { conversaId }, 20000),
  ]);

  const autoresPorMensagem = new Map();

  // WPP fica como fallback para mensagens que ele conseguiu resolver.
  for (const item of Array.isArray(resultadoWpp?.autoresMensagens)
    ? resultadoWpp.autoresMensagens
    : []) {
    const idMensagem = String(item?.idMensagem || "").trim();
    if (idMensagem) autoresPorMensagem.set(idMensagem, item);
  }

  // Baileys e a fonte principal da autoria historica, pois o cache local
  // preserva key.participant de cada mensagem do grupo.
  for (const item of Array.isArray(resultadoBaileys?.autoresMensagens)
    ? resultadoBaileys.autoresMensagens
    : []) {
    const idMensagem = String(item?.idMensagem || "").trim();
    if (idMensagem) autoresPorMensagem.set(idMensagem, item);
  }

  const autoresMensagens = Array.from(autoresPorMensagem.values());

  console.log(
    `[GRUPO AUTORES] wpp=${Array.isArray(resultadoWpp?.autoresMensagens) ? resultadoWpp.autoresMensagens.length : 0} ` +
      `| baileys=${Array.isArray(resultadoBaileys?.autoresMensagens) ? resultadoBaileys.autoresMensagens.length : 0} ` +
      `| merged=${autoresMensagens.length} | requested=${idsMensagensGrupo.length} ` +
      `| group=${conversaId}.`,
  );

  return {
    ok: !!resultadoWpp?.ok || !!resultadoBaileys?.ok,
    participantes: Array.isArray(resultadoWpp?.participantes)
      ? resultadoWpp.participantes
      : [],
    autoresMensagens,
    euNoGrupo: resultadoWpp?.euNoGrupo !== false,
    total: Number(resultadoWpp?.total || 0) || 0,
    fonte: "wpp+baileys",
    erro: resultadoWpp?.erro || resultadoBaileys?.erro || null,
  };
});

ipcMain.handle("sair-grupo", async (_, dados) => {
  const conversaId = String(dados?.conversaId || "").trim();

  if (!conversaId || !conversaId.endsWith("@g.us")) {
    return { ok: false, erro: "Grupo invalido." };
  }

  const resultado = await solicitarAoWorker(
    "wpp",
    "sair-grupo",
    { conversaId },
    25000,
  );

  return {
    ok: !!resultado?.ok,
    conversaId,
    fonte: "wpp",
    erro: resultado?.erro || null,
  };
});

ipcMain.handle("carregar-foto-perfil", async (_, dados) => {
  const prioridadeInicial = dados?.prioridadeInicial === true;

  return solicitarAoWorker(
    "baileys",
    "carregar-foto-perfil",
    dados,
    prioridadeInicial ? 3000 : 14000,
  );
});

ipcMain.handle("carregar-minha-foto", async () => {
  return solicitarAoWorker("baileys", "carregar-minha-foto", {}, 20000);
});

ipcMain.handle("tocar-som-notificacao-nativo", async () => {
  return tocarSomNotificacaoSistema();
});

ipcMain.handle("assinar-presenca-contato", async (_, dados) => {
  const conversaIdOriginal = String(dados?.conversaId || "").trim();

  if (!conversaIdOriginal) {
    return {
      ok: false,
      erro: "Conversa invalida para presenca.",
    };
  }

  const token = ++sequenciaAssinaturaPresenca;
  const chavesAceitas = new Set();

  const chaveOriginal = chavePresenca(conversaIdOriginal);

  if (chaveOriginal) {
    chavesAceitas.add(chaveOriginal);
  }

  presencaAtiva = {
    token,
    conversaIdOriginal,
    chavesAceitas,
    ultimaAtualizacaoBaileysEm: 0,
    baileysAssinadoEm: 0,
    baileysDisponivel: false,
    cronometroIniciadoEm: Date.now(),
    primeiroEventoRealEm: 0,
    primeiroEventoBaileysEm: 0,
    primeiroEventoWppEm: 0,
  };

  iniciarCronometroPresenca(token);
  limparFallbackPresencaWpp();

  // Inicia o WPPConnect praticamente em paralelo. Ele fica como fonte de
  // aquecimento/fallback enquanto o Baileys continua sendo a prioridade.
  // Assim nenhum dos dois precisa esperar o outro para comecar a assinar.
  agendarAssinaturaFallbackWpp(token, dados);

  const resultadoBaileys = await solicitarAoWorker(
    "baileys",
    "assinar-presenca",
    dados,
    6000,
  );

  if (!presencaAtiva || presencaAtiva.token !== token) {
    return {
      ok: false,
      cancelado: true,
      erro: "A conversa ativa mudou durante a assinatura de presenca.",
    };
  }

  if (resultadoBaileys?.conversaId) {
    const chaveBaileys = chavePresenca(resultadoBaileys.conversaId);

    if (chaveBaileys) {
      presencaAtiva.chavesAceitas.add(chaveBaileys);
    }
  }

  for (const aliasBaileys of Array.isArray(resultadoBaileys?.aliases)
    ? resultadoBaileys.aliases
    : []) {
    const chaveAlias = chavePresenca(aliasBaileys);

    if (chaveAlias) {
      presencaAtiva.chavesAceitas.add(chaveAlias);
    }
  }

  if (resultadoBaileys?.ok && resultadoBaileys?.disponivel !== false) {
    presencaAtiva.baileysAssinadoEm = Date.now();
    presencaAtiva.baileysDisponivel = true;

    console.log(
      `[PRESENCA] Baileys ativo para ${conversaIdOriginal}. ` +
        `aliases=${presencaAtiva.chavesAceitas.size}. ` +
        `WPPConnect mantido como fallback.`,
    );

    return {
      ...resultadoBaileys,
      conversaId: conversaIdOriginal,
      fonte: "baileys",
      fallback: "wpp",
    };
  }

  console.warn(
    `[PRESENCA] Baileys indisponivel para ${conversaIdOriginal}: ` +
      `${resultadoBaileys?.erro || "sem resposta valida"}. ` +
      `Tentando WPPConnect.`,
  );

  // Se o disparo paralelo ainda nao executou, evita duas assinaturas iguais.
  limparFallbackPresencaWpp();

  const resultadoWpp = await solicitarAoWorker(
    "wpp",
    "assinar-presenca",
    dados,
    6000,
  );

  if (!presencaAtiva || presencaAtiva.token !== token) {
    return {
      ok: false,
      cancelado: true,
      erro: "A conversa ativa mudou durante o fallback de presenca.",
    };
  }

  if (resultadoWpp?.conversaId) {
    const chaveWpp = chavePresenca(resultadoWpp.conversaId);

    if (chaveWpp) {
      presencaAtiva.chavesAceitas.add(chaveWpp);
    }
  }

  return {
    ...resultadoWpp,
    conversaId: conversaIdOriginal,
    fonte: "wpp-fallback",
    erroBaileys: resultadoBaileys?.erro || null,
  };
});

ipcMain.handle("selecionar-anexo", async (_, dados) => {
  const tipo = String(dados?.tipo || "arquivo");

  const extensoesDocumentos = [
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "txt",
    "rtf",
    "csv",
    "odt",
    "ods",
    "odp",
  ];

  const extensoesImagens = ["jpg", "jpeg", "png", "webp", "gif"];
  const extensoesVideos = ["mp4", "mov", "mkv", "webm"];
  const extensoesAudios = ["mp3", "wav", "ogg", "opus", "m4a", "aac", "flac"];

  let filters = [
    {
      name: "Documentos",
      extensions: extensoesDocumentos,
    },
  ];

  if (tipo === "midia") {
    filters = [
      {
        name: "Fotos e videos",
        extensions: [...extensoesImagens, ...extensoesVideos],
      },
    ];
  } else if (tipo === "audio") {
    filters = [
      {
        name: "Audios",
        extensions: extensoesAudios,
      },
    ];
  }

  const resultado = await dialog.showOpenDialog(janela, {
    title:
      tipo === "midia"
        ? "Selecionar foto ou video"
        : tipo === "audio"
          ? "Selecionar audio"
          : "Selecionar documento",
    properties: ["openFile"],
    filters,
  });

  if (resultado.canceled || !resultado.filePaths?.length) {
    return {
      ok: false,
      cancelado: true,
    };
  }

  const caminho = resultado.filePaths[0];
  const ext = path.extname(caminho).toLowerCase().replace(/^\./, "");

  const imagens = new Set(extensoesImagens);
  const videos = new Set(extensoesVideos);
  const audios = new Set(extensoesAudios);
  const documentos = new Set(extensoesDocumentos);

  let tipoArquivo = null;

  if (tipo === "audio") {
    if (!audios.has(ext)) {
      return {
        ok: false,
        cancelado: false,
        erro: "Selecione apenas um arquivo de audio.",
      };
    }

    tipoArquivo = "audio";
  } else if (tipo === "midia") {
    if (imagens.has(ext)) {
      tipoArquivo = "imagem";
    } else if (videos.has(ext)) {
      tipoArquivo = "video";
    } else {
      return {
        ok: false,
        cancelado: false,
        erro: "Selecione apenas uma imagem ou video.",
      };
    }
  } else {
    if (!documentos.has(ext)) {
      return {
        ok: false,
        cancelado: false,
        erro: "Selecione apenas um documento.",
      };
    }

    tipoArquivo = "documento";
  }

  return {
    ok: true,
    caminho,
    fileName: path.basename(caminho),
    tipo: tipoArquivo,
  };
});

ipcMain.handle("enviar-anexo", async (_, dados) => {
  const tipo = String(dados?.tipo || "")
    .trim()
    .toLowerCase();

  // Video segue direto pelo Baileys. O WPPConnect mostrou instabilidade
  // recorrente em sendFile (Promise was collected / erro "t").
  // Para os demais anexos, preservamos a rota atual do WPPConnect.
  if (tipo === "video") {
    console.log("Video send: direct Baileys route.");

    return await solicitarAoWorker(
      "baileys",
      "enviar-anexo",
      {
        ...(dados || {}),
        tipo: "video",
      },
      120000,
    );
  }

  return await solicitarAoWorker("wpp", "enviar-anexo", dados, 120000);
});

ipcMain.handle("listar-figurinhas-whatsapp", async () => {
  return solicitarAoWorker("wpp", "listar-figurinhas", {}, 45000);
});

ipcMain.handle("enviar-figurinha-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "enviar-figurinha", dados, 60000);
});

ipcMain.handle("enviar-contato-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "enviar-contato", dados, 30000);
});

ipcMain.handle("verificar-numero-whatsapp", async (_, dados) => {
  return solicitarAoWorker("wpp", "verificar-numero-whatsapp", dados, 30000);
});

ipcMain.handle("enviar-audio-gravado", async (_, dados) => {
  // Audio gravado volta para o Baileys. O WPPConnect consegue criar a
  // mensagem, mas em alguns casos o app movel nao consegue recuperar a
  // midia e exibe "Este audio nao esta mais disponivel". O worker Baileys
  // normaliza o PTT para OGG/Opus antes do upload e e a rota mais confiavel
  // entre WhatsIAPP, WhatsApp Web e celular.
  return solicitarAoWorker("baileys", "enviar-audio-gravado", dados, 120000);
});

ipcMain.handle("consultar-bloqueio-contato", async (_, dados) => {
  return solicitarAoWorker("baileys", "consultar-bloqueio", dados, 20000);
});

ipcMain.handle("alterar-bloqueio-contato", async (_, dados) => {
  return solicitarAoWorker("baileys", "alterar-bloqueio", dados, 30000);
});

ipcMain.handle("arquivar-conversa", async (_, dados) => {
  const resultado = await solicitarAoWorker("wpp", "arquivar", dados, 30000);

  if (resultado?.ok && resultado?.estado) {
    atualizarEstadoArquivamento(resultado.estado);
  }

  return resultado;
});

ipcMain.handle("abrir-arquivo", async (_, caminho) => {
  if (!caminho || !fs.existsSync(caminho)) {
    return {
      ok: false,
      erro: "Arquivo não encontrado.",
    };
  }

  const erro = await shell.openPath(caminho);

  return erro ? { ok: false, erro } : { ok: true };
});

// =========================================================
// CATALOGO DO CLIENTE
// Um PDF ativo por instalacao. O arquivo e validado no processo principal
// de acordo com o plano comercial antes de substituir o catalogo atual.
// =========================================================

function pastaCatalogoCliente() {
  return path.join(app.getPath("userData"), "catalogo");
}

function arquivoCatalogoCliente() {
  return path.join(pastaCatalogoCliente(), "catalogo-ativo.pdf");
}

function arquivoMetadadosCatalogoCliente() {
  return path.join(pastaCatalogoCliente(), "catalogo-ativo.json");
}

function arquivoIndiceCatalogoCliente() {
  return path.join(pastaCatalogoCliente(), "catalogo-indice-v1.json");
}

function garantirPastaCatalogoCliente() {
  fs.mkdirSync(pastaCatalogoCliente(), { recursive: true });
}

function limitesCatalogoPlanoAtual() {
  const permissoes = obterPermissoesPlanoAdmin();

  return {
    plano: permissoes.plano,
    nomePlano: permissoes.nomePlano,
    maxPaginas: Math.max(1, Number(permissoes.catalogoMaxPaginas || 0) || 1),
    maxBytes: Math.max(1, Number(permissoes.catalogoMaxBytes || 0) || 1),
  };
}

function formatarMbCatalogo(bytes) {
  return Number(
    (Math.max(0, Number(bytes || 0) || 0) / (1024 * 1024)).toFixed(1),
  );
}

function lerMetadadosCatalogoClienteBrutos() {
  try {
    const arquivoPdf = arquivoCatalogoCliente();
    const arquivoMeta = arquivoMetadadosCatalogoCliente();

    if (!fs.existsSync(arquivoPdf) || !fs.existsSync(arquivoMeta)) {
      return null;
    }

    const dados = JSON.parse(fs.readFileSync(arquivoMeta, "utf8"));
    const stats = fs.statSync(arquivoPdf);

    if (!stats.isFile() || stats.size <= 0) {
      return null;
    }

    return {
      ativo: true,
      nomeOriginal: String(dados?.nomeOriginal || "").trim() || "catalogo.pdf",
      tamanhoBytes: Math.max(0, Number(stats.size || 0) || 0),
      paginas: Math.max(0, Number(dados?.paginas || 0) || 0) || null,
      salvoEm: Number(dados?.salvoEm || 0) || null,
      status:
        String(dados?.status || "aguardando_processamento").trim() ||
        "aguardando_processamento",
      processadoEm: Number(dados?.processadoEm || 0) || null,
      blocosIndexados: Math.max(0, Number(dados?.blocosIndexados || 0) || 0),
      caracteresExtraidos: Math.max(
        0,
        Number(dados?.caracteresExtraidos || 0) || 0,
      ),
      hashPdf: String(dados?.hashPdf || "").trim() || null,
      indiceVersao: Math.max(0, Number(dados?.indiceVersao || 0) || 0) || null,
      erroProcessamento: String(dados?.erroProcessamento || "").trim() || null,
    };
  } catch (erro) {
    console.warn("Catalog metadata read failed:", erro?.message || erro);
    return null;
  }
}

function salvarMetadadosCatalogoCliente(metadados = {}) {
  garantirPastaCatalogoCliente();

  const arquivoMeta = arquivoMetadadosCatalogoCliente();
  const temporarioMeta = `${arquivoMeta}.tmp`;

  fs.writeFileSync(temporarioMeta, JSON.stringify(metadados, null, 2), "utf8");

  fs.rmSync(arquivoMeta, { force: true });
  fs.renameSync(temporarioMeta, arquivoMeta);
}

async function contarPaginasPdf(caminho) {
  try {
    const bytes = fs.readFileSync(caminho);
    const documento = await PDFDocument.load(bytes, {
      updateMetadata: false,
    });
    const paginas = documento.getPageCount();

    if (!Number.isFinite(paginas) || paginas <= 0) {
      throw new Error("O PDF não possui páginas válidas.");
    }

    return paginas;
  } catch (erro) {
    const detalhe = String(erro?.message || erro || "").toLowerCase();

    if (detalhe.includes("encrypted")) {
      throw new Error(
        "O PDF está protegido por senha. Use um arquivo sem proteção para cadastrar o catálogo.",
      );
    }

    throw new Error("Não foi possível ler a quantidade de páginas deste PDF.");
  }
}

let processamentoCatalogoEmAndamento = null;
let hashCatalogoEmProcessamento = null;

function hashArquivoCatalogo(caminho) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(caminho));
  return hash.digest("hex");
}

function normalizarTextoExtraidoCatalogo(valor) {
  return String(valor || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

function normalizarBuscaCatalogo(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function montarTextoPaginaPdfCatalogo(conteudo) {
  const itens = Array.isArray(conteudo?.items) ? conteudo.items : [];
  const linhasBrutas = [];
  let linhaAtual = [];
  let yLinhaAtual = null;
  let yAnterior = null;

  const concluirLinha = () => {
    const texto = linhaAtual
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (texto) {
      linhasBrutas.push({
        texto,
        y: Number.isFinite(yLinhaAtual) ? yLinhaAtual : null,
      });
    }

    linhaAtual = [];
    yLinhaAtual = null;
  };

  for (const item of itens) {
    const texto = String(item?.str || "").trim();

    if (!texto) {
      continue;
    }

    const transform = Array.isArray(item?.transform) ? item.transform : [];
    const y = Number(transform[5]);

    if (
      yAnterior !== null &&
      Number.isFinite(y) &&
      Number.isFinite(yAnterior) &&
      Math.abs(y - yAnterior) > 2.2
    ) {
      concluirLinha();
    }

    if (yLinhaAtual === null && Number.isFinite(y)) {
      yLinhaAtual = y;
    }

    linhaAtual.push(texto);

    if (Number.isFinite(y)) {
      yAnterior = y;
    }
  }

  concluirLinha();

  if (!linhasBrutas.length) {
    return "";
  }

  const intervalos = [];

  for (let i = 1; i < linhasBrutas.length; i += 1) {
    const y1 = linhasBrutas[i - 1]?.y;
    const y2 = linhasBrutas[i]?.y;

    if (!Number.isFinite(y1) || !Number.isFinite(y2)) {
      continue;
    }

    const delta = Math.abs(y1 - y2);

    if (delta > 2.2 && delta < 120) {
      intervalos.push(delta);
    }
  }

  const ordenados = intervalos.slice().sort((a, b) => a - b);
  const mediana = ordenados.length
    ? ordenados[Math.floor(ordenados.length / 2)]
    : 12;
  const limiteQuebra = Math.max(10, mediana * 1.85);
  const linhas = [];

  for (let i = 0; i < linhasBrutas.length; i += 1) {
    const atual = linhasBrutas[i];
    const anterior = i > 0 ? linhasBrutas[i - 1] : null;

    if (
      anterior &&
      Number.isFinite(anterior.y) &&
      Number.isFinite(atual.y) &&
      Math.abs(anterior.y - atual.y) > limiteQuebra
    ) {
      linhas.push("");
    }

    linhas.push(atual.texto);
  }

  return normalizarTextoExtraidoCatalogo(linhas.join("\n"));
}

async function extrairPaginasTextoCatalogo(caminho) {
  const buffer = fs.readFileSync(caminho);
  const paginas = [];
  let numeroPagina = 0;

  const renderizarPagina = async (paginaPdf) => {
    const conteudo = await paginaPdf.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });

    numeroPagina += 1;

    const texto = montarTextoPaginaPdfCatalogo(conteudo);

    paginas.push({
      pagina: numeroPagina,
      texto,
    });

    return texto;
  };

  let resultado = null;

  try {
    resultado = await pdfParse(buffer, {
      pagerender: renderizarPagina,
      max: 0,
    });
  } catch (erro) {
    const detalhe = String(erro?.message || erro || "").toLowerCase();

    if (detalhe.includes("password") || detalhe.includes("encrypted")) {
      throw new Error(
        "O PDF está protegido por senha. Use um arquivo sem proteção para processar o catálogo.",
      );
    }

    throw erro;
  }

  const totalPaginas = Math.max(
    0,
    Number(resultado?.numpages || paginas.length || 0) || 0,
  );

  if (!paginas.length && String(resultado?.text || "").trim()) {
    paginas.push({
      pagina: 1,
      texto: normalizarTextoExtraidoCatalogo(resultado.text),
    });
  }

  return {
    paginas,
    totalPaginas: totalPaginas || paginas.length,
  };
}

function linhasCatalogoParaBlocos(textoPagina) {
  const linhas = String(textoPagina || "")
    .split("\n")
    .map((linha) => linha.trim());
  const grupos = [];
  let atual = [];

  const fechar = () => {
    const limpas = atual.filter(Boolean);

    if (limpas.length) {
      grupos.push(limpas);
    }

    atual = [];
  };

  for (const linha of linhas) {
    if (!linha) {
      fechar();
      continue;
    }

    atual.push(linha);
  }

  fechar();

  if (grupos.length > 1) {
    return grupos;
  }

  const compactas = linhas.filter(Boolean);

  if (!compactas.length) {
    return [];
  }

  const JANELA_LINHAS = 7;
  const SOBREPOSICAO = 2;
  const fallback = [];

  for (let i = 0; i < compactas.length; i += JANELA_LINHAS - SOBREPOSICAO) {
    const fatia = compactas.slice(i, i + JANELA_LINHAS);

    if (fatia.length) {
      fallback.push(fatia);
    }

    if (i + JANELA_LINHAS >= compactas.length) {
      break;
    }
  }

  return fallback;
}

function dividirGrupoCatalogo(linhas = [], maxCaracteres = 760) {
  const partes = [];
  let atual = [];
  let tamanho = 0;

  const fechar = () => {
    const texto = normalizarTextoExtraidoCatalogo(atual.join("\n"));

    if (texto) {
      partes.push(texto);
    }

    atual = [];
    tamanho = 0;
  };

  for (const linhaOriginal of linhas) {
    let linha = String(linhaOriginal || "").trim();

    if (!linha) {
      continue;
    }

    while (linha.length > maxCaracteres) {
      if (atual.length) {
        fechar();
      }

      partes.push(linha.slice(0, maxCaracteres).trim());
      linha = linha.slice(maxCaracteres).trim();
    }

    const custo = linha.length + (atual.length ? 1 : 0);

    if (atual.length && tamanho + custo > maxCaracteres) {
      fechar();
    }

    atual.push(linha);
    tamanho += custo;
  }

  fechar();

  return partes;
}

function criarBlocosIndiceCatalogo(paginas = []) {
  const blocos = [];

  for (const paginaInfo of Array.isArray(paginas) ? paginas : []) {
    const pagina = Math.max(1, Number(paginaInfo?.pagina || 1) || 1);
    const textoPagina = normalizarTextoExtraidoCatalogo(paginaInfo?.texto);

    if (!textoPagina) {
      continue;
    }

    const grupos = linhasCatalogoParaBlocos(textoPagina);

    for (const grupo of grupos) {
      const partes = dividirGrupoCatalogo(grupo, 760);

      for (const texto of partes) {
        if (!texto) {
          continue;
        }

        blocos.push({
          id: `p${pagina}-b${blocos.length + 1}`,
          pagina,
          texto,
          textoBusca: normalizarBuscaCatalogo(texto),
        });
      }
    }
  }

  return blocos.map((bloco, indice) => ({
    ...bloco,
    id: `p${bloco.pagina}-b${indice + 1}`,
  }));
}

function lerIndiceCatalogoCliente() {
  try {
    const arquivo = arquivoIndiceCatalogoCliente();

    if (!fs.existsSync(arquivo)) {
      return null;
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    if (
      Number(dados?.versao || 0) !== 2 ||
      !String(dados?.hashPdf || "").trim() ||
      !Array.isArray(dados?.blocos)
    ) {
      return null;
    }

    return dados;
  } catch (erro) {
    console.warn("Catalog index read failed:", erro?.message || erro);
    return null;
  }
}

function linhaPareceCodigoProdutoTesteIA(valor) {
  const texto = String(valor || "").trim();

  if (!texto || texto.length > 40) {
    return false;
  }

  return /^[A-Z0-9]{1,12}(?:[-/.][A-Z0-9]{1,18})+$/i.test(texto);
}

function linhaPareceAtributoCatalogoTesteIA(valor) {
  const texto = normalizarBuscaCatalogo(String(valor || ""));

  return /^(?:cor|cores|tamanho|tamanhos|numeracao|numeracoes|estoque|disponibilidade|material|materiais|composicao|tecido|tecidos|medida|medidas|comprimento|largura|altura|descricao|detalhes|caracteristicas)\b/.test(
    texto,
  );
}

function extrairTrechoProdutoCatalogoTesteIA(textoBruto, nomeProduto) {
  const linhas = String(textoBruto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  if (!linhas.length) {
    return "";
  }

  const nomeNormalizado = normalizarBuscaCatalogo(nomeProduto);
  let inicio = linhas.findIndex((linha) => {
    const atual = normalizarBuscaCatalogo(linha);

    return (
      atual === nomeNormalizado ||
      atual.includes(nomeNormalizado) ||
      nomeNormalizado.includes(atual)
    );
  });

  if (inicio < 0) {
    inicio = 0;
  }

  let indicePreco = -1;

  for (let i = inicio; i < linhas.length; i += 1) {
    if (/R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/i.test(linhas[i])) {
      indicePreco = i;
      break;
    }
  }

  if (indicePreco < 0) {
    return linhas
      .slice(inicio, Math.min(linhas.length, inicio + 10))
      .join("\n");
  }

  let fim = linhas.length;

  for (let i = indicePreco + 1; i < linhas.length; i += 1) {
    const linha = linhas[i];

    if (
      !linha ||
      /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/i.test(linha) ||
      linhaPareceAtributoCatalogoTesteIA(linha)
    ) {
      continue;
    }

    const proximas = linhas.slice(i + 1, Math.min(linhas.length, i + 4));
    const temPrecoLogoDepois = proximas.some((valor) =>
      /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/i.test(valor),
    );
    const temCodigoLogoDepois = proximas
      .slice(0, 2)
      .some((valor) => linhaPareceCodigoProdutoTesteIA(valor));

    const linhaNormalizada = normalizarBuscaCatalogo(linha);
    const pareceTitulo =
      linha.length >= 3 &&
      linha.length <= 110 &&
      !/^(?:compacto|compacta|unico|unica|disponivel|disponiveis)\b/.test(
        linhaNormalizada,
      );

    if (temPrecoLogoDepois && (temCodigoLogoDepois || pareceTitulo)) {
      fim = i;
      break;
    }
  }

  return linhas.slice(inicio, fim).join("\n");
}

function detectarAtributosProdutoCatalogoTesteIA(trechoProduto) {
  const linhas = String(trechoProduto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const linhasNormalizadas = linhas.map((linha) =>
    normalizarBuscaCatalogo(linha),
  );

  const linhaTamanho =
    linhasNormalizadas.find((linha) =>
      /^(?:tamanho|tamanhos|numeracao|numeracoes)\b/.test(linha),
    ) || "";

  const tamanhoUnico =
    !!linhaTamanho && /\b(?:unico|unica)\b/.test(linhaTamanho);

  const temTamanhosMultiplos = !!linhaTamanho && !tamanhoUnico;

  const temCores = linhasNormalizadas.some((linha) =>
    /^(?:cor|cores)\b/.test(linha),
  );

  const temMaterial = linhasNormalizadas.some((linha) =>
    /^(?:material|materiais|composicao|tecido|tecidos)\b/.test(linha),
  );

  const temEstoque = linhasNormalizadas.some((linha) =>
    /^(?:estoque|disponibilidade)\b/.test(linha),
  );

  const temMedidas = linhasNormalizadas.some((linha) =>
    /^(?:medida|medidas|comprimento|largura|altura)\b/.test(linha),
  );

  let followupCatalogoTipo = "geral";

  if (temTamanhosMultiplos) {
    followupCatalogoTipo = "tamanhos";
  } else if (tamanhoUnico) {
    followupCatalogoTipo = "tamanho-unico";
  } else if (temCores) {
    followupCatalogoTipo = "cores";
  } else if (temMaterial) {
    followupCatalogoTipo = "material";
  } else if (temMedidas) {
    followupCatalogoTipo = "medidas";
  } else if (temEstoque) {
    followupCatalogoTipo = "estoque";
  }

  return {
    temTamanhos: temTamanhosMultiplos,
    tamanhoUnico,
    temCores,
    temMaterial,
    temEstoque,
    temMedidas,
    followupCatalogoTipo,
  };
}

function linhaNomeCatalogoValidaTesteIntegridadeIA(valor) {
  const linha = String(valor || "")
    .replace(/^\s*(?:(?:[•·▪◦*\-])|(?:\d{1,3}[.)\-]))\s*/u, "")
    .replace(/^(?:produto|nome|item)\s*[:\-]\s*/i, "")
    .replace(/R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?.*$/i, "")
    .trim();

  if (!linha || linha.length < 3 || linha.length > 110) {
    return "";
  }

  // O indice pode agrupar cabecalhos/instrucoes junto do produto.
  // Esses textos nao podem virar "nome de produto" no planejador de teste.
  if (
    /^(?:preco|preço|valor|tamanho|tamanhos|numeracao|numeração|cores?|estoque|pagina|página|material|materiais|composicao|composição|medidas?|descricao|descrição|categoria|perguntas?|dicas?|observacoes?|observações?|informacoes?|informações?|exemplos?|testes?|como testar)\b/i.test(
      linha,
    )
  ) {
    return "";
  }

  if (
    /[?!]$/.test(linha) ||
    /^(?:perguntas uteis|perguntas úteis)\b/i.test(linha)
  ) {
    return "";
  }

  // Linhas de pergunta do proprio PDF podem conter preco. Depois que o
  // preco e removido, o ponto de interrogacao tambem pode desaparecer.
  if (
    /^(?:qual|quais|quanto|quantos|quantas|como|onde|quando|quem|por que|porque)\b/i.test(
      linha,
    )
  ) {
    return "";
  }

  return linha;
}

function extrairCandidatosCatalogoTesteIntegridadeIA(limite = 12) {
  const indice = lerIndiceCatalogoCliente();
  const blocos = Array.isArray(indice?.blocos) ? indice.blocos : [];
  const candidatos = [];
  const nomesVistos = new Set();

  for (const bloco of blocos) {
    const texto = String(bloco?.texto || "").trim();

    if (!texto) {
      continue;
    }

    const precoMatch = texto.match(/R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/i);

    if (!precoMatch) {
      continue;
    }

    const linhas = texto
      .split(/\r?\n/)
      .map((linha) => linha.trim())
      .filter(Boolean);

    let nome = "";

    // Prefere o texto imediatamente associado ao preco, em vez da primeira
    // linha do bloco. Isso evita capturar titulos como "Perguntas uteis..."
    // quando o indexador agrupou cabecalho e produto no mesmo trecho.
    const indiceLinhaPreco = linhas.findIndex((linha) =>
      /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/i.test(linha),
    );

    if (indiceLinhaPreco >= 0) {
      nome = linhaNomeCatalogoValidaTesteIntegridadeIA(
        linhas[indiceLinhaPreco],
      );

      if (!nome) {
        for (
          let i = indiceLinhaPreco - 1;
          i >= Math.max(0, indiceLinhaPreco - 8);
          i -= 1
        ) {
          nome = linhaNomeCatalogoValidaTesteIntegridadeIA(linhas[i]);

          if (nome) {
            break;
          }
        }
      }
    }

    if (!nome) {
      const antesPreco = texto
        .slice(0, Math.max(0, texto.indexOf(precoMatch[0])))
        .split(/[|•;]+/)
        .map((parte) => linhaNomeCatalogoValidaTesteIntegridadeIA(parte))
        .filter(Boolean)
        .pop();

      nome = String(antesPreco || "").trim();
    }

    if (!nome || nome.length < 3 || nome.length > 110) {
      continue;
    }

    const chaveNome = normalizarBuscaCatalogo(nome);

    if (!chaveNome || nomesVistos.has(chaveNome)) {
      continue;
    }

    nomesVistos.add(chaveNome);

    const trechoProduto = extrairTrechoProdutoCatalogoTesteIA(texto, nome);

    candidatos.push({
      nome,
      preco: String(precoMatch[0] || "").trim(),
      pagina: Math.max(1, Number(bloco?.pagina || 1) || 1),
      resumo: trechoProduto.slice(0, 1600),
    });

    if (candidatos.length >= Math.max(1, Number(limite) || 12)) {
      break;
    }
  }

  return candidatos;
}

function indiceCatalogoCompativel(catalogo) {
  if (!catalogo?.ativo || catalogo.status !== "processado") {
    return false;
  }

  const indice = lerIndiceCatalogoCliente();

  if (!indice) {
    return false;
  }

  const hashMeta = String(catalogo.hashPdf || "").trim();
  const hashIndice = String(indice.hashPdf || "").trim();

  return !!hashMeta && hashMeta === hashIndice;
}

const STOPWORDS_BUSCA_CATALOGO = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "entre",
  "essa",
  "esse",
  "esta",
  "este",
  "eu",
  "ha",
  "isso",
  "me",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "por",
  "qual",
  "que",
  "se",
  "sem",
  "ser",
  "tem",
  "ter",
  "um",
  "uma",
  "uns",
  "umas",
  "voce",
  "voces",
  "existe",
  "existem",
  "quero",
  "preciso",
  "gostaria",
]);

function canonizarTokenCatalogo(valor) {
  let token = normalizarBuscaCatalogo(valor).replace(/\s+/g, "");

  if (!token) {
    return "";
  }

  if (/^[a-z]+s$/.test(token) && token.length >= 5) {
    token = token.slice(0, -1);
  }

  return token;
}

function tokenizarBuscaCatalogo(valor, { removerStopwords = false } = {}) {
  const normalizado = normalizarBuscaCatalogo(valor);
  const tokens = normalizado
    .split(" ")
    .map(canonizarTokenCatalogo)
    .filter(Boolean)
    .filter(
      (token) => !removerStopwords || !STOPWORDS_BUSCA_CATALOGO.has(token),
    );

  return Array.from(new Set(tokens));
}

function termosBuscaCatalogo(valor) {
  const normalizado = normalizarBuscaCatalogo(valor).slice(0, 400);

  if (!normalizado) {
    return {
      normalizado: "",
      termos: [],
      bigramas: [],
    };
  }

  let termos = tokenizarBuscaCatalogo(normalizado, { removerStopwords: true });

  if (!termos.length) {
    termos = tokenizarBuscaCatalogo(normalizado);
  }

  termos = termos.slice(0, 30);

  const partes = normalizado
    .split(" ")
    .map(canonizarTokenCatalogo)
    .filter(Boolean);
  const bigramas = [];

  for (let i = 0; i < partes.length - 1; i += 1) {
    if (
      STOPWORDS_BUSCA_CATALOGO.has(partes[i]) ||
      STOPWORDS_BUSCA_CATALOGO.has(partes[i + 1])
    ) {
      continue;
    }

    bigramas.push(`${partes[i]} ${partes[i + 1]}`);
  }

  return {
    normalizado,
    termos,
    bigramas: Array.from(new Set(bigramas)).slice(0, 20),
  };
}

function separarEvidenciaCatalogo(texto) {
  const linhas = String(texto || "")
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
  const factuais = [];
  const perguntas = [];

  for (const linha of linhas) {
    const parecePergunta = /\?\s*$/.test(linha);

    if (parecePergunta) {
      perguntas.push(linha);
    } else {
      factuais.push(linha);
    }
  }

  return {
    factual: normalizarBuscaCatalogo(factuais.join(" ")),
    perguntas: normalizarBuscaCatalogo(perguntas.join(" ")),
  };
}

function frequenciaTokensCatalogo(texto) {
  const frequencias = new Map();

  for (const token of normalizarBuscaCatalogo(texto)
    .split(" ")
    .map(canonizarTokenCatalogo)
    .filter(Boolean)) {
    frequencias.set(token, (frequencias.get(token) || 0) + 1);
  }

  return frequencias;
}

function estatisticasCorpusCatalogo(blocos = []) {
  const df = new Map();
  const total = Math.max(1, blocos.length);

  for (const bloco of blocos) {
    const evidencia = separarEvidenciaCatalogo(bloco?.texto);
    const tokens = new Set([
      ...tokenizarBuscaCatalogo(evidencia.factual),
      ...tokenizarBuscaCatalogo(evidencia.perguntas),
    ]);

    for (const token of tokens) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  return { total, df };
}

function idfTokenCatalogo(token, corpus) {
  const df = Math.max(0, Number(corpus?.df?.get(token) || 0) || 0);
  const total = Math.max(1, Number(corpus?.total || 1) || 1);

  return Math.log(1 + (total - df + 0.5) / (df + 0.5)) + 0.8;
}

function tokenEhCodigoOuNumeroCatalogo(token) {
  const texto = String(token || "");
  return /\d/.test(texto) || /^[a-z]{1,5}\d{2,}$/i.test(texto);
}

function pontuarBlocoCatalogo(bloco, consultaInfo, corpus) {
  const evidencia = separarEvidenciaCatalogo(bloco?.texto);
  const freqFactual = frequenciaTokensCatalogo(evidencia.factual);
  const freqPerguntas = frequenciaTokensCatalogo(evidencia.perguntas);
  const encontrados = [];
  const encontradosFatuais = [];
  let pontuacao = 0;

  const consultaCanonica = consultaInfo.termos.join(" ");
  const factualCanonico = normalizarBuscaCatalogo(evidencia.factual)
    .split(" ")
    .map(canonizarTokenCatalogo)
    .filter(Boolean)
    .join(" ");
  const perguntasCanonicas = normalizarBuscaCatalogo(evidencia.perguntas)
    .split(" ")
    .map(canonizarTokenCatalogo)
    .filter(Boolean)
    .join(" ");

  if (
    consultaCanonica &&
    consultaInfo.termos.length > 1 &&
    factualCanonico.includes(consultaCanonica)
  ) {
    pontuacao += 34;
  } else if (
    consultaCanonica &&
    consultaInfo.termos.length > 1 &&
    perguntasCanonicas.includes(consultaCanonica)
  ) {
    pontuacao += 3;
  }

  for (const termo of consultaInfo.termos) {
    const tfFactual = Number(freqFactual.get(termo) || 0) || 0;
    const tfPergunta = Number(freqPerguntas.get(termo) || 0) || 0;

    if (!tfFactual && !tfPergunta) {
      continue;
    }

    encontrados.push(termo);

    const idf = idfTokenCatalogo(termo, corpus);
    const bonusEspecial = tokenEhCodigoOuNumeroCatalogo(termo) ? 1.75 : 1;

    if (tfFactual) {
      encontradosFatuais.push(termo);
      pontuacao += idf * bonusEspecial * (9 + Math.log1p(tfFactual) * 3.5);
    } else {
      pontuacao += idf * bonusEspecial * 1.35;
    }
  }

  let bigramasEncontrados = 0;

  for (const bigrama of consultaInfo.bigramas) {
    if (factualCanonico.includes(bigrama)) {
      bigramasEncontrados += 1;
      pontuacao += 10;
    } else if (perguntasCanonicas.includes(bigrama)) {
      pontuacao += 1;
    }
  }

  if (!encontrados.length || !encontradosFatuais.length) {
    return null;
  }

  const cobertura =
    encontrados.length / Math.max(1, consultaInfo.termos.length);
  const coberturaFactual =
    encontradosFatuais.length / Math.max(1, consultaInfo.termos.length);

  pontuacao += cobertura * 11;
  pontuacao += coberturaFactual * 16;

  if (encontradosFatuais.length === consultaInfo.termos.length) {
    pontuacao += 14;
  }

  const comprimento = Math.max(1, String(bloco?.texto || "").length);
  const fatorComprimento = Math.max(0.72, Math.min(1.08, 520 / comprimento));
  pontuacao *= fatorComprimento;

  return {
    pontuacao,
    cobertura,
    coberturaFactual,
    encontrados,
    encontradosFatuais,
    bigramasEncontrados,
  };
}

function similaridadeBlocosCatalogo(a, b) {
  const tokensA = new Set(tokenizarBuscaCatalogo(a?.texto));
  const tokensB = new Set(tokenizarBuscaCatalogo(b?.texto));

  if (!tokensA.size || !tokensB.size) {
    return 0;
  }

  let intersecao = 0;

  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersecao += 1;
    }
  }

  const uniao = tokensA.size + tokensB.size - intersecao;
  return uniao > 0 ? intersecao / uniao : 0;
}

function buscarNoIndiceCatalogo(consulta, limite = 5) {
  const catalogo = lerMetadadosCatalogoClienteBrutos();
  const limites = limitesCatalogoPlanoAtual();

  if (!catalogo?.ativo) {
    return {
      ok: false,
      erro: "Nenhum catálogo ativo.",
    };
  }

  const avaliado = avaliarCatalogoNoPlano(catalogo, limites);

  if (avaliado?.disponivelPlano === false) {
    return {
      ok: false,
      bloqueadoPlano: true,
      erro: "O catálogo atual está fora dos limites do plano.",
    };
  }

  if (!indiceCatalogoCompativel(catalogo)) {
    return {
      ok: false,
      erro: "O catálogo ainda não possui um índice local válido.",
    };
  }

  const consultaInfo = termosBuscaCatalogo(consulta);

  if (!consultaInfo.normalizado || !consultaInfo.termos.length) {
    return {
      ok: false,
      erro: "Digite algo para pesquisar no catálogo.",
    };
  }

  const indice = lerIndiceCatalogoCliente();
  const blocos = Array.isArray(indice?.blocos) ? indice.blocos : [];
  const corpus = estatisticasCorpusCatalogo(blocos);
  const maxResultados = Math.min(
    8,
    Math.max(1, Math.trunc(Number(limite) || 5)),
  );
  const candidatos = [];

  for (const bloco of blocos) {
    const score = pontuarBlocoCatalogo(bloco, consultaInfo, corpus);

    if (!score) {
      continue;
    }

    candidatos.push({
      id: String(bloco?.id || ""),
      pagina: Math.max(1, Number(bloco?.pagina || 1) || 1),
      texto: String(bloco?.texto || "").trim(),
      pontuacao: Number(score.pontuacao.toFixed(3)),
      cobertura: Number(score.cobertura.toFixed(4)),
      coberturaFactual: Number(score.coberturaFactual.toFixed(4)),
      termosEncontrados: score.encontrados,
      termosFatuais: score.encontradosFatuais,
      totalTermosConsulta: consultaInfo.termos.length,
    });
  }

  candidatos.sort((a, b) => {
    if (b.pontuacao !== a.pontuacao) {
      return b.pontuacao - a.pontuacao;
    }

    if (b.coberturaFactual !== a.coberturaFactual) {
      return b.coberturaFactual - a.coberturaFactual;
    }

    if (b.cobertura !== a.cobertura) {
      return b.cobertura - a.cobertura;
    }

    return a.pagina - b.pagina;
  });

  const melhorPontuacao = Number(candidatos[0]?.pontuacao || 0) || 0;
  const minimoRelativo = melhorPontuacao > 0 ? melhorPontuacao * 0.48 : 0;
  const filtrados = candidatos.filter((item) => {
    if (item.pontuacao < Math.max(5, minimoRelativo)) {
      return false;
    }

    return item.coberturaFactual > 0;
  });

  const resultados = [];

  for (const candidato of filtrados) {
    const muitoParecido = resultados.some(
      (existente) =>
        existente.pagina === candidato.pagina &&
        similaridadeBlocosCatalogo(existente, candidato) >= 0.78,
    );

    if (muitoParecido) {
      continue;
    }

    resultados.push(candidato);

    if (resultados.length >= maxResultados) {
      break;
    }
  }

  console.log(
    `[CATALOGO] SEARCH | terms=${consultaInfo.termos.length} | candidates=${candidatos.length} | filtered=${filtrados.length} | results=${resultados.length} | best=${melhorPontuacao.toFixed(2)}`,
  );

  return {
    ok: true,
    consulta: String(consulta || "").trim(),
    totalResultados: resultados.length,
    resultados,
  };
}

async function executarProcessamentoCatalogo(hashPdf) {
  const inicio = Date.now();
  const caminhoPdf = arquivoCatalogoCliente();
  const catalogoInicial = lerMetadadosCatalogoClienteBrutos();

  if (!catalogoInicial?.ativo || !fs.existsSync(caminhoPdf)) {
    return {
      ok: false,
      erro: "Catálogo não encontrado para processamento.",
    };
  }

  const metadadosProcessando = {
    versao: 3,
    nomeOriginal: catalogoInicial.nomeOriginal,
    tamanhoBytes: catalogoInicial.tamanhoBytes,
    paginas: catalogoInicial.paginas,
    salvoEm: catalogoInicial.salvoEm,
    status: "processando",
    processadoEm: null,
    blocosIndexados: 0,
    caracteresExtraidos: 0,
    hashPdf,
    indiceVersao: 2,
    erroProcessamento: null,
  };

  salvarMetadadosCatalogoCliente(metadadosProcessando);

  console.log(
    `[CATALOGO] PROCESS_START | file=${String(catalogoInicial.nomeOriginal || "catalogo.pdf").replace(/[^\x20-\x7E]/g, "")} | pages=${Number(catalogoInicial.paginas || 0) || 0} | index_v=2`,
  );

  try {
    const extraido = await extrairPaginasTextoCatalogo(caminhoPdf);
    const paginasComTexto = extraido.paginas.filter((item) =>
      String(item?.texto || "").trim(),
    );
    const caracteresExtraidos = paginasComTexto.reduce(
      (total, item) => total + String(item.texto || "").length,
      0,
    );

    if (!caracteresExtraidos) {
      throw new Error(
        "Não foi encontrado texto pesquisável neste PDF. Se o catálogo for composto apenas por imagens, será necessário OCR.",
      );
    }

    const blocos = criarBlocosIndiceCatalogo(extraido.paginas);

    if (!blocos.length) {
      throw new Error(
        "O texto foi extraído, mas não foi possível criar o índice local.",
      );
    }

    const hashAtual = hashArquivoCatalogo(caminhoPdf);

    if (hashAtual !== hashPdf) {
      throw new Error(
        "O catálogo foi substituído durante o processamento. Tente novamente.",
      );
    }

    const indice = {
      versao: 2,
      criadoEm: Date.now(),
      hashPdf,
      nomeOriginal: catalogoInicial.nomeOriginal,
      paginas: Math.max(
        Number(catalogoInicial.paginas || 0) || 0,
        Number(extraido.totalPaginas || 0) || 0,
      ),
      paginasComTexto: paginasComTexto.length,
      caracteresExtraidos,
      totalBlocos: blocos.length,
      blocos,
    };

    garantirPastaCatalogoCliente();

    const arquivoIndice = arquivoIndiceCatalogoCliente();
    const temporarioIndice = `${arquivoIndice}.tmp`;

    fs.writeFileSync(temporarioIndice, JSON.stringify(indice, null, 2), "utf8");
    fs.rmSync(arquivoIndice, { force: true });
    fs.renameSync(temporarioIndice, arquivoIndice);

    const processadoEm = Date.now();

    salvarMetadadosCatalogoCliente({
      ...metadadosProcessando,
      paginas: indice.paginas,
      status: "processado",
      processadoEm,
      blocosIndexados: blocos.length,
      caracteresExtraidos,
      erroProcessamento: null,
    });

    console.log(
      `[CATALOGO] PROCESS_OK | pages=${indice.paginas} | text_pages=${paginasComTexto.length} | chunks=${blocos.length} | chars=${caracteresExtraidos} | index_v=2 | ms=${Date.now() - inicio}`,
    );

    return {
      ok: true,
      indice: {
        paginas: indice.paginas,
        paginasComTexto: paginasComTexto.length,
        blocosIndexados: blocos.length,
        caracteresExtraidos,
        processadoEm,
      },
    };
  } catch (erro) {
    const mensagem =
      erro?.message || "Não foi possível processar o catálogo em PDF.";

    try {
      salvarMetadadosCatalogoCliente({
        ...metadadosProcessando,
        status: "erro",
        processadoEm: null,
        erroProcessamento: mensagem,
      });
    } catch {}

    console.warn(
      `[CATALOGO] PROCESS_ERROR | ${String(mensagem).replace(/[^\x20-\x7E]/g, "")}`,
    );

    return {
      ok: false,
      erro: mensagem,
    };
  }
}

async function processarCatalogoCliente({ forcar = false } = {}) {
  const catalogo = lerMetadadosCatalogoClienteBrutos();
  const caminhoPdf = arquivoCatalogoCliente();

  if (!catalogo?.ativo || !fs.existsSync(caminhoPdf)) {
    return {
      ok: false,
      erro: "Catálogo não encontrado para processamento.",
    };
  }

  const limites = limitesCatalogoPlanoAtual();
  const avaliado = avaliarCatalogoNoPlano(catalogo, limites);

  if (avaliado?.disponivelPlano === false) {
    return {
      ok: false,
      bloqueadoPlano: true,
      erro: "O catálogo atual excede os limites do plano e não pode ser processado.",
    };
  }

  let hashPdf = null;

  try {
    hashPdf = hashArquivoCatalogo(caminhoPdf);
  } catch (erro) {
    return {
      ok: false,
      erro:
        erro?.message || "Não foi possível ler o catálogo para processamento.",
    };
  }

  if (!forcar && indiceCatalogoCompativel(catalogo)) {
    return {
      ok: true,
      jaProcessado: true,
    };
  }

  if (processamentoCatalogoEmAndamento) {
    if (hashCatalogoEmProcessamento === hashPdf) {
      return processamentoCatalogoEmAndamento;
    }

    try {
      await processamentoCatalogoEmAndamento;
    } catch {}

    return processarCatalogoCliente({ forcar });
  }

  hashCatalogoEmProcessamento = hashPdf;
  processamentoCatalogoEmAndamento = executarProcessamentoCatalogo(hashPdf);

  try {
    return await processamentoCatalogoEmAndamento;
  } finally {
    processamentoCatalogoEmAndamento = null;
    hashCatalogoEmProcessamento = null;
  }
}

function avaliarCatalogoNoPlano(catalogo, limites) {
  if (!catalogo?.ativo) {
    return catalogo;
  }

  const tamanhoExcedido =
    Number(catalogo.tamanhoBytes || 0) > Number(limites.maxBytes || 0);
  const paginasExcedidas =
    Number(catalogo.paginas || 0) > Number(limites.maxPaginas || 0);
  const disponivelPlano = !tamanhoExcedido && !paginasExcedidas;

  let motivoBloqueioPlano = null;

  if (!disponivelPlano) {
    const motivos = [];

    if (paginasExcedidas) {
      motivos.push(
        `${catalogo.paginas} páginas para um limite de ${limites.maxPaginas}`,
      );
    }

    if (tamanhoExcedido) {
      motivos.push(
        `${formatarMbCatalogo(catalogo.tamanhoBytes)} MB para um limite de ${formatarMbCatalogo(limites.maxBytes)} MB`,
      );
    }

    motivoBloqueioPlano = motivos.join(" e ");
  }

  return {
    ...catalogo,
    statusProcessamento: catalogo.status,
    status: disponivelPlano ? catalogo.status : "fora_limite_plano",
    disponivelPlano,
    motivoBloqueioPlano,
  };
}

async function lerMetadadosCatalogoCliente() {
  const catalogo = lerMetadadosCatalogoClienteBrutos();
  const limites = limitesCatalogoPlanoAtual();

  if (!catalogo) {
    return null;
  }

  if (!catalogo.paginas) {
    try {
      catalogo.paginas = await contarPaginasPdf(arquivoCatalogoCliente());

      salvarMetadadosCatalogoCliente({
        versao: 3,
        nomeOriginal: catalogo.nomeOriginal,
        tamanhoBytes: catalogo.tamanhoBytes,
        paginas: catalogo.paginas,
        salvoEm: catalogo.salvoEm,
        status: catalogo.status,
        processadoEm: catalogo.processadoEm,
        blocosIndexados: catalogo.blocosIndexados,
        caracteresExtraidos: catalogo.caracteresExtraidos,
        hashPdf: catalogo.hashPdf,
        indiceVersao: catalogo.indiceVersao,
        erroProcessamento: catalogo.erroProcessamento,
      });
    } catch (erro) {
      console.warn("Catalog page count failed:", erro?.message || erro);
    }
  }

  return avaliarCatalogoNoPlano(catalogo, limites);
}

function removerCatalogoClientePersistido() {
  try {
    fs.rmSync(arquivoCatalogoCliente(), { force: true });
    fs.rmSync(arquivoMetadadosCatalogoCliente(), { force: true });
    fs.rmSync(arquivoIndiceCatalogoCliente(), { force: true });
    fs.rmSync(`${arquivoIndiceCatalogoCliente()}.tmp`, { force: true });
    limparAncorasCatalogoIA();

    return { ok: true };
  } catch (erro) {
    return {
      ok: false,
      erro: erro?.message || "Nao foi possivel remover o catalogo.",
    };
  }
}

function arquivoParecePdf(caminho) {
  try {
    const descritor = fs.openSync(caminho, "r");
    const cabecalho = Buffer.alloc(5);
    const lidos = fs.readSync(descritor, cabecalho, 0, cabecalho.length, 0);
    fs.closeSync(descritor);

    return lidos === 5 && cabecalho.toString("ascii") === "%PDF-";
  } catch {
    return false;
  }
}

ipcMain.handle("catalogo-status", async () => {
  const limites = limitesCatalogoPlanoAtual();
  let catalogo = await lerMetadadosCatalogoCliente();

  if (
    catalogo?.ativo &&
    catalogo.disponivelPlano !== false &&
    !indiceCatalogoCompativel(catalogo)
  ) {
    await processarCatalogoCliente();
    catalogo = await lerMetadadosCatalogoCliente();
  }

  return {
    ok: true,
    limites,
    catalogo,
  };
});

ipcMain.handle("catalogo-selecionar-pdf", async () => {
  const limites = limitesCatalogoPlanoAtual();

  const resultado = await dialog.showOpenDialog(janela, {
    title: "Selecionar catálogo em PDF",
    properties: ["openFile"],
    filters: [
      {
        name: "Documento PDF",
        extensions: ["pdf"],
      },
    ],
  });

  if (resultado.canceled || !resultado.filePaths?.length) {
    return {
      ok: false,
      cancelado: true,
      limites,
    };
  }

  const origem = resultado.filePaths[0];

  try {
    if (!origem || !fs.existsSync(origem)) {
      throw new Error("O arquivo selecionado não foi encontrado.");
    }

    if (
      path.extname(origem).toLowerCase() !== ".pdf" ||
      !arquivoParecePdf(origem)
    ) {
      throw new Error("Selecione um arquivo PDF válido.");
    }

    const stats = fs.statSync(origem);

    if (!stats.isFile() || stats.size <= 0) {
      throw new Error("O PDF selecionado está vazio.");
    }

    if (stats.size > limites.maxBytes) {
      throw new Error(
        `O plano ${limites.nomePlano} aceita catálogos de até ${formatarMbCatalogo(limites.maxBytes)} MB. Este arquivo possui ${formatarMbCatalogo(stats.size)} MB.`,
      );
    }

    const paginas = await contarPaginasPdf(origem);

    if (paginas > limites.maxPaginas) {
      throw new Error(
        `O plano ${limites.nomePlano} aceita catálogos de até ${limites.maxPaginas} páginas. Este PDF possui ${paginas} páginas.`,
      );
    }

    garantirPastaCatalogoCliente();

    const destino = arquivoCatalogoCliente();
    const temporarioPdf = `${destino}.tmp`;
    const arquivoMeta = arquivoMetadadosCatalogoCliente();
    const temporarioMeta = `${arquivoMeta}.tmp`;
    const salvoEm = Date.now();

    fs.copyFileSync(origem, temporarioPdf);

    const metadados = {
      versao: 3,
      nomeOriginal: path.basename(origem),
      tamanhoBytes: stats.size,
      paginas,
      salvoEm,
      status: "aguardando_processamento",
      processadoEm: null,
      blocosIndexados: 0,
      caracteresExtraidos: 0,
      hashPdf: null,
      indiceVersao: 2,
      erroProcessamento: null,
    };

    fs.writeFileSync(
      temporarioMeta,
      JSON.stringify(metadados, null, 2),
      "utf8",
    );

    fs.rmSync(destino, { force: true });
    fs.renameSync(temporarioPdf, destino);
    fs.rmSync(arquivoMeta, { force: true });
    fs.renameSync(temporarioMeta, arquivoMeta);
    fs.rmSync(arquivoIndiceCatalogoCliente(), { force: true });
    fs.rmSync(`${arquivoIndiceCatalogoCliente()}.tmp`, { force: true });
    limparAncorasCatalogoIA();

    console.log(
      `Catalog PDF saved: ${path.basename(origem)} | ${paginas} pages | ${stats.size} bytes | plan=${limites.plano}.`,
    );

    const processamento = await processarCatalogoCliente({ forcar: true });

    return {
      ok: true,
      processamento,
      limites,
      catalogo: await lerMetadadosCatalogoCliente(),
    };
  } catch (erro) {
    try {
      fs.rmSync(`${arquivoCatalogoCliente()}.tmp`, { force: true });
      fs.rmSync(`${arquivoMetadadosCatalogoCliente()}.tmp`, { force: true });
      fs.rmSync(`${arquivoIndiceCatalogoCliente()}.tmp`, { force: true });
    } catch {}

    return {
      ok: false,
      limites,
      erro: erro?.message || "Não foi possível salvar o catálogo.",
    };
  }
});

ipcMain.handle(
  "catalogo-verificar-relevancia-ia",
  async (_evento, dados = {}) => {
    try {
      const contexto = prepararContextoCatalogoIA(
        {
          conversaId: dados?.conversaId,
          mensagemAtual: dados?.consulta,
          mensagensAnteriores: dados?.mensagensAnteriores,
        },
        2,
      );

      return {
        ok: true,
        relevante: !!contexto.relevante,
        totalResultados: contexto.resultados.length,
      };
    } catch (erro) {
      console.warn(
        `[CATALOGO IA] CHECK_ERROR | ${String(erro?.message || erro || "erro")
          .replace(/[^\x20-\x7E]/g, "")
          .slice(0, 180)}`,
      );

      return {
        ok: false,
        relevante: false,
      };
    }
  },
);

ipcMain.handle(
  "catalogo-verificar-match-direto-ia",
  async (_evento, dados = {}) => {
    try {
      const consulta = String(dados?.consulta || "")
        .trim()
        .slice(0, 4000);

      if (!consulta) {
        return {
          ok: true,
          relevante: false,
          totalResultados: 0,
        };
      }

      const busca = buscarNoIndiceCatalogo(consulta, 2);
      const avaliacao = avaliarBuscaDiretaCatalogoParaRoteamentoIA(
        busca,
        consulta,
      );

      console.log(
        `[CATALOGO IA] DIRECT_CHECK | results=${avaliacao.resultados.length} | relevant=${avaliacao.relevante} | coverage=${avaliacao.coberturaFactual.toFixed(2)} | identity=${avaliacao.coberturaIdentidade.toFixed(2)} | phrase=${!!avaliacao.fraseIdentidadeExata} | named=${!!avaliacao.mencaoNominalProduto} | availability=${!!avaliacao.mencaoCategoriaDisponibilidade} | score=${avaliacao.pontuacao.toFixed(2)}`,
      );

      return {
        ok: true,
        relevante: !!avaliacao.relevante,
        totalResultados: avaliacao.resultados.length,
        coberturaFactual: avaliacao.coberturaFactual,
        coberturaIdentidade: avaliacao.coberturaIdentidade,
        mencaoNominalProduto: !!avaliacao.mencaoNominalProduto,
        mencaoCategoriaDisponibilidade:
          !!avaliacao.mencaoCategoriaDisponibilidade,
        pontuacao: avaliacao.pontuacao,
      };
    } catch (erro) {
      console.warn(
        `[CATALOGO IA] DIRECT_CHECK_ERROR | ${String(
          erro?.message || erro || "erro",
        )
          .replace(/[^\x20-\x7E]/g, "")
          .slice(0, 180)}`,
      );

      return {
        ok: false,
        relevante: false,
        totalResultados: 0,
      };
    }
  },
);

ipcMain.handle("catalogo-buscar-local", async (_evento, dados = {}) => {
  try {
    return buscarNoIndiceCatalogo(dados?.consulta, dados?.limite);
  } catch (erro) {
    console.warn(
      `[CATALOGO] SEARCH_ERROR | ${String(erro?.message || erro || "erro").replace(/[^\x20-\x7E]/g, "")}`,
    );

    return {
      ok: false,
      erro: erro?.message || "Não foi possível pesquisar no catálogo.",
    };
  }
});

ipcMain.handle("catalogo-remover", async () => {
  const resultado = removerCatalogoClientePersistido();

  if (resultado.ok) {
    console.log("Catalog PDF removed.");
  }

  return resultado;
});

// =========================================================
// AREA ADMINISTRATIVA LOCAL
// Acesso oculto no renderer. Credenciais ficam somente no userData.
// Senha nunca e salva em texto puro: PBKDF2 + salt aleatorio.
// =========================================================

const ADMIN_PBKDF2_ITERACOES = 210000;
const ADMIN_SESSAO_DURACAO_MS = 30 * 60 * 1000;
const ADMIN_MAX_FALHAS_LOGIN = 5;
const ADMIN_BLOQUEIO_LOGIN_MS = 30 * 1000;

const sessoesAdmin = new Map();
let falhasLoginAdmin = 0;
let bloqueadoAteAdmin = 0;

function arquivoAcessoAdmin() {
  return path.join(app.getPath("userData"), "admin-acesso-v1.json");
}

function normalizarUsuarioAdmin(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase();
}

function carregarAcessoAdmin() {
  try {
    const arquivo = arquivoAcessoAdmin();

    if (!fs.existsSync(arquivo)) {
      return null;
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));

    if (
      Number(dados?.versao) !== 1 ||
      !String(dados?.usuario || "").trim() ||
      !String(dados?.usuarioNormalizado || "").trim() ||
      !String(dados?.salt || "").trim() ||
      !String(dados?.hash || "").trim()
    ) {
      return null;
    }

    return dados;
  } catch (erro) {
    console.warn("Admin access read failed:", erro?.message || erro);
    return null;
  }
}

function derivarHashSenhaAdmin(
  senha,
  saltHex,
  iteracoes = ADMIN_PBKDF2_ITERACOES,
) {
  return crypto
    .pbkdf2Sync(
      String(senha || ""),
      Buffer.from(String(saltHex || ""), "hex"),
      Math.max(
        100000,
        Number(iteracoes || ADMIN_PBKDF2_ITERACOES) || ADMIN_PBKDF2_ITERACOES,
      ),
      32,
      "sha256",
    )
    .toString("hex");
}

function validarSenhaAdmin(senha, registro) {
  try {
    if (!registro?.salt || !registro?.hash) {
      return false;
    }

    const calculado = Buffer.from(
      derivarHashSenhaAdmin(senha, registro.salt, registro.iteracoes),
      "hex",
    );
    const esperado = Buffer.from(String(registro.hash), "hex");

    return (
      calculado.length === esperado.length &&
      calculado.length > 0 &&
      crypto.timingSafeEqual(calculado, esperado)
    );
  } catch {
    return false;
  }
}

function salvarPrimeiroAcessoAdmin(usuario, senha) {
  const usuarioFinal = String(usuario || "").trim();
  const usuarioNormalizado = normalizarUsuarioAdmin(usuarioFinal);
  const senhaFinal = String(senha || "");

  if (usuarioFinal.length < 3) {
    return {
      ok: false,
      erro: "O login administrativo precisa ter pelo menos 3 caracteres.",
    };
  }

  if (senhaFinal.length < 8) {
    return {
      ok: false,
      erro: "A senha administrativa precisa ter pelo menos 8 caracteres.",
    };
  }

  if (carregarAcessoAdmin()) {
    return {
      ok: false,
      erro: "O acesso administrativo já foi configurado.",
    };
  }

  try {
    const salt = crypto.randomBytes(24).toString("hex");
    const hash = derivarHashSenhaAdmin(
      senhaFinal,
      salt,
      ADMIN_PBKDF2_ITERACOES,
    );

    const arquivo = arquivoAcessoAdmin();
    const temporario = `${arquivo}.tmp`;

    fs.writeFileSync(
      temporario,
      JSON.stringify(
        {
          versao: 1,
          usuario: usuarioFinal,
          usuarioNormalizado,
          salt,
          hash,
          iteracoes: ADMIN_PBKDF2_ITERACOES,
          criadoEm: Date.now(),
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.renameSync(temporario, arquivo);

    console.log("[ADMIN] PRIMEIRO_ACESSO_CONFIGURADO");

    return {
      ok: true,
      usuario: usuarioFinal,
    };
  } catch (erro) {
    console.warn("[ADMIN] CONFIG_ERROR", erro?.message || erro);

    return {
      ok: false,
      erro: "Não foi possível salvar o acesso administrativo.",
    };
  }
}

function limparSessoesAdminExpiradas() {
  const agora = Date.now();

  for (const [token, sessao] of sessoesAdmin.entries()) {
    if (!sessao || Number(sessao.expiraEm || 0) <= agora) {
      sessoesAdmin.delete(token);
    }
  }
}

function criarSessaoAdmin(usuario) {
  limparSessoesAdminExpiradas();

  const token = crypto.randomBytes(32).toString("hex");
  const agora = Date.now();

  sessoesAdmin.set(token, {
    usuario: String(usuario || "").trim(),
    criadaEm: agora,
    expiraEm: agora + ADMIN_SESSAO_DURACAO_MS,
  });

  return token;
}

function validarSessaoAdmin(token) {
  limparSessoesAdminExpiradas();

  const chave = String(token || "").trim();
  const sessao = chave ? sessoesAdmin.get(chave) : null;

  if (!sessao) {
    return null;
  }

  sessao.expiraEm = Date.now() + ADMIN_SESSAO_DURACAO_MS;
  return sessao;
}

function segundosBloqueioAdminRestantes() {
  return Math.max(0, Math.ceil((bloqueadoAteAdmin - Date.now()) / 1000));
}

// =========================================================
// CONFIGURACAO COMERCIAL LOCAL
// Gravada no processo principal e alterada somente com sessao admin valida.
// =========================================================

const PLANOS_ADMIN = {
  basico: {
    id: "basico",
    nome: "Básico",
    niveis: ["minimo", "baixo"],
    pesquisaWeb: false,
    maxMensagens: 25,
    maxPromptPersonalizado: 5000,
    maxTokensContexto: 4000,
    catalogoMaxPaginas: 20,
    catalogoMaxBytes: 10 * 1024 * 1024,
  },
  intermediario: {
    id: "intermediario",
    nome: "Intermediário",
    niveis: ["minimo", "baixo", "medio", "alto"],
    pesquisaWeb: true,
    maxMensagens: 100,
    maxPromptPersonalizado: 12000,
    maxTokensContexto: 16000,
    catalogoMaxPaginas: 60,
    catalogoMaxBytes: 25 * 1024 * 1024,
  },
  premium: {
    id: "premium",
    nome: "Premium",
    niveis: ["minimo", "baixo", "medio", "alto", "muito_alto", "maximo"],
    pesquisaWeb: true,
    maxMensagens: 200,
    maxPromptPersonalizado: 20000,
    maxTokensContexto: 32000,
    catalogoMaxPaginas: 150,
    catalogoMaxBytes: 50 * 1024 * 1024,
  },
};

const BILLING_ADMIN_PADRAO = {
  basico: {
    mensalidade: 149.99,
    orcamentoIA: 35,
  },
  intermediario: {
    mensalidade: 199.99,
    orcamentoIA: 50,
  },
  premium: {
    mensalidade: 259.99,
    orcamentoIA: 75,
  },
  precificacao: {
    // Fallback local usado apenas quando ainda nao existe uma tabela valida
    // salva e a atualizacao online nao esta disponivel. Em operacao normal,
    // estes valores sao atualizados automaticamente a partir das fontes.
    usdBrl: 5.13,
    gptOssEntradaUsdMilhao: 0.15,
    gptOssCacheUsdMilhao: 0.075,
    gptOssSaidaUsdMilhao: 0.6,
    webSearchBasicaUsdMil: 5,
  },
  precificacaoMeta: {
    atualizadaEm: null,
    groqAtualizadaEm: null,
    cambioAtualizadoEm: null,
    ultimaTentativaEm: null,
    fonteGroq: "GroqDocs",
    fonteCambio: "Frankfurter",
    erroUltimaAtualizacao: null,
  },
  avisos: [
    { id: "aviso1", ativo: true, percentual: 50 },
    { id: "aviso2", ativo: true, percentual: 75 },
    { id: "aviso3", ativo: true, percentual: 80 },
    { id: "aviso4", ativo: true, percentual: 90 },
    { id: "aviso5", ativo: true, percentual: 95 },
  ],
};

function normalizarValorMonetarioAdmin(valor, padrao = 0) {
  const texto = String(valor ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const numero = Number(texto);

  if (!Number.isFinite(numero) || numero < 0) {
    return Number(padrao) || 0;
  }

  return Math.round(numero * 100) / 100;
}

function normalizarValorDecimalAdmin(valor, padrao = 0, casas = 6) {
  const texto = String(valor ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const numero = Number(texto);

  if (!Number.isFinite(numero) || numero < 0) {
    return Number(padrao) || 0;
  }

  const fator = 10 ** Math.max(0, Math.min(8, Number(casas) || 0));
  return Math.round(numero * fator) / fator;
}

function normalizarValorDecimalPositivoAdmin(valor, padrao = 0, casas = 6) {
  const numero = normalizarValorDecimalAdmin(valor, padrao, casas);

  if (!Number.isFinite(numero) || numero <= 0) {
    return normalizarValorDecimalAdmin(padrao, 0, casas);
  }

  return numero;
}

function normalizarPercentualAvisoBillingAdmin(valor, padrao = 50) {
  const numero = Math.round(Number(valor));
  const fallback = Math.max(1, Math.min(99, Math.round(Number(padrao) || 50)));

  if (!Number.isFinite(numero)) {
    return fallback;
  }

  return Math.max(1, Math.min(99, numero));
}

function normalizarAvisosBillingAdmin(valor = []) {
  const recebidos = Array.isArray(valor) ? valor : [];

  return BILLING_ADMIN_PADRAO.avisos.map((padrao, indice) => {
    const porId = recebidos.find(
      (item) => String(item?.id || "") === String(padrao.id),
    );
    const recebido = porId || recebidos[indice] || {};

    return {
      id: padrao.id,
      ativo: recebido?.ativo === undefined ? !!padrao.ativo : !!recebido.ativo,
      percentual: normalizarPercentualAvisoBillingAdmin(
        recebido?.percentual,
        padrao.percentual,
      ),
    };
  });
}

function normalizarBillingAdmin(valor = {}) {
  const resultado = {};

  for (const planoId of Object.keys(PLANOS_ADMIN)) {
    const padrao = BILLING_ADMIN_PADRAO[planoId];
    const recebido = valor?.[planoId] || {};

    resultado[planoId] = {
      mensalidade: normalizarValorMonetarioAdmin(
        recebido?.mensalidade,
        padrao.mensalidade,
      ),
      orcamentoIA: normalizarValorMonetarioAdmin(
        recebido?.orcamentoIA,
        padrao.orcamentoIA,
      ),
    };
  }

  const precificacaoPadrao = BILLING_ADMIN_PADRAO.precificacao;
  const precificacaoRecebida = valor?.precificacao || {};

  resultado.precificacao = {
    usdBrl: normalizarValorDecimalPositivoAdmin(
      precificacaoRecebida?.usdBrl,
      precificacaoPadrao.usdBrl,
      6,
    ),
    gptOssEntradaUsdMilhao: normalizarValorDecimalPositivoAdmin(
      precificacaoRecebida?.gptOssEntradaUsdMilhao,
      precificacaoPadrao.gptOssEntradaUsdMilhao,
      6,
    ),
    gptOssCacheUsdMilhao: normalizarValorDecimalPositivoAdmin(
      precificacaoRecebida?.gptOssCacheUsdMilhao,
      precificacaoPadrao.gptOssCacheUsdMilhao,
      6,
    ),
    gptOssSaidaUsdMilhao: normalizarValorDecimalPositivoAdmin(
      precificacaoRecebida?.gptOssSaidaUsdMilhao,
      precificacaoPadrao.gptOssSaidaUsdMilhao,
      6,
    ),
    webSearchBasicaUsdMil: normalizarValorDecimalPositivoAdmin(
      precificacaoRecebida?.webSearchBasicaUsdMil,
      precificacaoPadrao.webSearchBasicaUsdMil,
      6,
    ),
  };

  const metaPadrao = BILLING_ADMIN_PADRAO.precificacaoMeta;
  const metaRecebida = valor?.precificacaoMeta || {};
  resultado.precificacaoMeta = {
    atualizadaEm: Number(metaRecebida?.atualizadaEm || 0) || null,
    groqAtualizadaEm: Number(metaRecebida?.groqAtualizadaEm || 0) || null,
    cambioAtualizadoEm: Number(metaRecebida?.cambioAtualizadoEm || 0) || null,
    ultimaTentativaEm: Number(metaRecebida?.ultimaTentativaEm || 0) || null,
    fonteGroq: String(metaRecebida?.fonteGroq || metaPadrao.fonteGroq),
    fonteCambio: String(metaRecebida?.fonteCambio || metaPadrao.fonteCambio),
    erroUltimaAtualizacao:
      metaRecebida?.erroUltimaAtualizacao === null ||
      metaRecebida?.erroUltimaAtualizacao === undefined
        ? null
        : String(metaRecebida.erroUltimaAtualizacao).slice(0, 500),
  };

  resultado.avisos = normalizarAvisosBillingAdmin(valor?.avisos);

  return resultado;
}

const BILLING_PRECIFICACAO_TTL_MS = 6 * 60 * 60 * 1000;
const BILLING_PRECIFICACAO_RETRY_MS = 30 * 60 * 1000;
const BILLING_GROQ_MODELO_URL =
  "https://console.groq.com/docs/model/openai/gpt-oss-120b";
const BILLING_GROQ_COMPOUND_URL =
  "https://console.groq.com/docs/compound/systems/compound-mini";
const BILLING_CAMBIO_URL = "https://api.frankfurter.app/latest?from=USD&to=BRL";
let atualizacaoPrecificacaoBillingEmAndamento = null;
let timerPrecificacaoBilling = null;

function requisicaoHttpsTextoBilling(
  url,
  timeoutMs = 15000,
  redirecionamentos = 0,
) {
  return new Promise((resolve, reject) => {
    let destino = null;

    try {
      destino = new URL(String(url || ""));
    } catch {
      reject(new Error("URL de precificacao invalida."));
      return;
    }

    const req = https.get(
      destino,
      {
        headers: {
          "User-Agent": "WhatsIAPP/1.0 BillingSync",
          Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        },
      },
      (res) => {
        const status = Number(res.statusCode || 0);
        const localizacao = String(res.headers.location || "").trim();

        if (
          status >= 300 &&
          status < 400 &&
          localizacao &&
          redirecionamentos < 4
        ) {
          res.resume();
          const proxima = new URL(localizacao, destino).toString();
          requisicaoHttpsTextoBilling(
            proxima,
            timeoutMs,
            redirecionamentos + 1,
          ).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status || "?"} em ${destino.hostname}.`));
          return;
        }

        const partes = [];
        let total = 0;
        const maximo = 5 * 1024 * 1024;

        res.on("data", (chunk) => {
          total += chunk.length;
          if (total <= maximo) {
            partes.push(chunk);
          }
        });

        res.on("end", () => {
          if (total > maximo) {
            reject(
              new Error("Fonte de precificacao excedeu o tamanho seguro."),
            );
            return;
          }

          resolve(Buffer.concat(partes).toString("utf8"));
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Tempo limite ao atualizar precificacao."));
    });

    req.on("error", reject);
  });
}

function textoPesquisaPrecificacaoBilling(valor) {
  return String(valor || "")
    .replace(/\\u0024/gi, "$")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/&dollar;|&#36;|&#x24;/gi, "$")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\n|\\r|\\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairPrecoRotuloBilling(texto, rotulo, distancia = 180) {
  const fonte = String(texto || "");
  const padrao = new RegExp(
    `${rotulo}[\\s\\S]{0,${distancia}}?\\$\\s*([0-9]+(?:\\.[0-9]+)?)`,
    "i",
  );
  const match = fonte.match(padrao);
  const numero = Number(match?.[1]);

  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function extrairPrecosGroqBilling(htmlModelo, htmlCompound) {
  const modeloCompleto = textoPesquisaPrecificacaoBilling(htmlModelo);
  const compoundCompleto = textoPesquisaPrecificacaoBilling(htmlCompound);
  const inicioModelo = modeloCompleto.toUpperCase().indexOf("PRICING");
  const inicioCompound = compoundCompleto.toUpperCase().indexOf("PRICING");
  const modelo =
    inicioModelo >= 0
      ? modeloCompleto.slice(inicioModelo, inicioModelo + 1800)
      : modeloCompleto;
  const compound =
    inicioCompound >= 0
      ? compoundCompleto.slice(inicioCompound, inicioCompound + 2600)
      : compoundCompleto;

  const entrada = extrairPrecoRotuloBilling(modelo, "(?:^|\\b)Input\\b", 140);
  const cache = extrairPrecoRotuloBilling(modelo, "Cached\\s+Input", 140);
  const saida = extrairPrecoRotuloBilling(modelo, "(?:^|\\b)Output\\b", 140);
  const web = extrairPrecoRotuloBilling(
    compound,
    "Basic\\s+Web\\s+Search",
    180,
  );

  if (![entrada, cache, saida, web].every((item) => item > 0)) {
    throw new Error(
      "Nao foi possivel validar todos os precos publicados pela Groq.",
    );
  }

  return {
    gptOssEntradaUsdMilhao: entrada,
    gptOssCacheUsdMilhao: cache,
    gptOssSaidaUsdMilhao: saida,
    webSearchBasicaUsdMil: web,
  };
}

async function obterCambioUsdBrlBilling() {
  const resposta = await requisicaoHttpsTextoBilling(BILLING_CAMBIO_URL, 12000);
  const json = JSON.parse(resposta);
  const taxa = Number(json?.rates?.BRL);

  if (!Number.isFinite(taxa) || taxa <= 0) {
    throw new Error("Cotacao USD/BRL invalida na fonte de cambio.");
  }

  return taxa;
}

function precisaAtualizarPrecificacaoBilling(billing, forcar = false) {
  if (forcar) {
    return true;
  }

  const meta = billing?.precificacaoMeta || {};
  const ultima = Number(meta.atualizadaEm || 0) || 0;
  const tentativa = Number(meta.ultimaTentativaEm || 0) || 0;
  const agora = Date.now();

  if (!ultima) {
    return agora - tentativa >= BILLING_PRECIFICACAO_RETRY_MS;
  }

  if (billing?.precificacaoMeta?.erroUltimaAtualizacao) {
    return agora - tentativa >= BILLING_PRECIFICACAO_RETRY_MS;
  }

  return agora - ultima >= BILLING_PRECIFICACAO_TTL_MS;
}

async function atualizarPrecificacaoBillingAutomatica({ forcar = false } = {}) {
  if (atualizacaoPrecificacaoBillingEmAndamento) {
    return atualizacaoPrecificacaoBillingEmAndamento;
  }

  const atual = carregarConfiguracaoComercialAdmin();
  const billingAtual = normalizarBillingAdmin(atual.billing);

  if (!precisaAtualizarPrecificacaoBilling(billingAtual, forcar)) {
    return {
      ok: true,
      atualizada: false,
      billing: billingAtual,
      motivo: "cache-valido",
    };
  }

  atualizacaoPrecificacaoBillingEmAndamento = (async () => {
    const agora = Date.now();
    const proximo = normalizarBillingAdmin(billingAtual);
    proximo.precificacaoMeta.ultimaTentativaEm = agora;
    let groqOk = false;
    let cambioOk = false;
    const erros = [];

    try {
      const [htmlModelo, htmlCompound] = await Promise.all([
        requisicaoHttpsTextoBilling(BILLING_GROQ_MODELO_URL),
        requisicaoHttpsTextoBilling(BILLING_GROQ_COMPOUND_URL),
      ]);
      const precos = extrairPrecosGroqBilling(htmlModelo, htmlCompound);

      proximo.precificacao = {
        ...proximo.precificacao,
        ...precos,
      };
      proximo.precificacaoMeta.groqAtualizadaEm = agora;
      proximo.precificacaoMeta.fonteGroq = "GroqDocs";
      groqOk = true;
    } catch (erro) {
      erros.push(`Groq: ${erro?.message || erro}`);
    }

    try {
      const usdBrl = await obterCambioUsdBrlBilling();
      proximo.precificacao.usdBrl = normalizarValorDecimalPositivoAdmin(
        usdBrl,
        proximo.precificacao.usdBrl,
        6,
      );
      proximo.precificacaoMeta.cambioAtualizadoEm = agora;
      proximo.precificacaoMeta.fonteCambio = "Frankfurter";
      cambioOk = true;
    } catch (erro) {
      erros.push(`Cambio: ${erro?.message || erro}`);
    }

    if (groqOk || cambioOk) {
      proximo.precificacaoMeta.atualizadaEm = agora;
    }

    proximo.precificacaoMeta.erroUltimaAtualizacao = erros.length
      ? erros.join(" | ").slice(0, 500)
      : null;

    // Recarrega antes de persistir para nao sobrescrever uma alteracao
    // administrativa feita enquanto a consulta online estava em andamento.
    const maisRecente = carregarConfiguracaoComercialAdmin();
    const billingMaisRecente = normalizarBillingAdmin(maisRecente.billing);
    const billingParaSalvar = normalizarBillingAdmin({
      ...billingMaisRecente,
      precificacao: proximo.precificacao,
      precificacaoMeta: proximo.precificacaoMeta,
    });
    const salvo = salvarConfiguracaoComercialAdmin({
      billing: billingParaSalvar,
    });

    if (!salvo.ok) {
      throw new Error(salvo.erro || "Falha ao persistir precificacao.");
    }

    if (groqOk && cambioOk) {
      console.log(
        `[BILLING IA] PRICING_UPDATE_OK | input=${proximo.precificacao.gptOssEntradaUsdMilhao} | cache=${proximo.precificacao.gptOssCacheUsdMilhao} | output=${proximo.precificacao.gptOssSaidaUsdMilhao} | web=${proximo.precificacao.webSearchBasicaUsdMil} | usdBrl=${proximo.precificacao.usdBrl}`,
      );
    } else {
      console.warn(
        `[BILLING IA] PRICING_UPDATE_PARTIAL | groq=${groqOk} | cambio=${cambioOk} | erro=${proximo.precificacaoMeta.erroUltimaAtualizacao || "-"}`,
      );
    }

    enviarParaTela("billing-precificacao-atualizada", {
      billing: normalizarBillingAdmin(salvo.configuracao.billing),
      resumo: obterResumoBillingIAAtual(),
    });

    return {
      ok: groqOk && cambioOk,
      parcial: groqOk || cambioOk,
      atualizada: groqOk || cambioOk,
      billing: normalizarBillingAdmin(salvo.configuracao.billing),
      erro: erros.length ? erros.join(" | ") : null,
    };
  })();

  try {
    return await atualizacaoPrecificacaoBillingEmAndamento;
  } finally {
    atualizacaoPrecificacaoBillingEmAndamento = null;
  }
}

function iniciarAtualizacaoPeriodicaPrecificacaoBilling() {
  clearInterval(timerPrecificacaoBilling);

  setTimeout(() => {
    atualizarPrecificacaoBillingAutomatica().catch((erro) => {
      console.warn("[BILLING IA] PRICING_UPDATE_FAIL", erro?.message || erro);
    });
  }, 1800);

  timerPrecificacaoBilling = setInterval(() => {
    atualizarPrecificacaoBillingAutomatica().catch((erro) => {
      console.warn("[BILLING IA] PRICING_UPDATE_FAIL", erro?.message || erro);
    });
  }, BILLING_PRECIFICACAO_RETRY_MS);
}

function obterPrecificacaoIAAdmin() {
  const configuracao = carregarConfiguracaoComercialAdmin();
  return normalizarBillingAdmin(configuracao.billing).precificacao;
}

function chaveMesLocalBilling(timestamp = Date.now()) {
  const data = new Date(timestamp);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

function obterAvisosBillingAtivos(billing = null) {
  const configuracao =
    billing ||
    normalizarBillingAdmin(carregarConfiguracaoComercialAdmin().billing);
  const vistos = new Set();

  return (Array.isArray(configuracao?.avisos) ? configuracao.avisos : [])
    .filter((item) => !!item?.ativo)
    .map((item) => ({
      id: String(item?.id || "").trim(),
      percentual: normalizarPercentualAvisoBillingAdmin(item?.percentual, 50),
    }))
    .filter((item) => {
      if (vistos.has(item.percentual)) {
        return false;
      }

      vistos.add(item.percentual);
      return true;
    })
    .sort((a, b) => a.percentual - b.percentual);
}

function registroAvisosBillingMes(dados, mes, criar = false) {
  if (!dados || !mes) {
    return null;
  }

  if (!dados.avisosBilling || typeof dados.avisosBilling !== "object") {
    if (!criar) {
      return null;
    }

    dados.avisosBilling = {};
  }

  const atual = dados.avisosBilling[mes];

  if (atual && typeof atual === "object" && !Array.isArray(atual)) {
    return atual;
  }

  if (!criar) {
    return null;
  }

  dados.avisosBilling[mes] = {};
  return dados.avisosBilling[mes];
}

function emitirAvisoBillingIA(tipo, resumo, percentual) {
  const percentualFinal = Math.max(
    0,
    Math.min(100, Math.round(Number(percentual) || 0)),
  );

  enviarParaTela("billing-ia-aviso", {
    tipo: tipo === "bloqueio" ? "bloqueio" : "aviso",
    plano: resumo?.plano || null,
    nomePlano: resumo?.nomePlano || "",
    percentual: percentualFinal,
    orcamentoBrl: numeroFinanceiroBilling(resumo?.orcamentoBrl),
    consumidoBrl: numeroFinanceiroBilling(resumo?.consumidoBrl),
    saldoBrl: numeroFinanceiroBilling(resumo?.saldoBrl),
    mes: resumo?.mes || chaveMesLocalBilling(),
    emitidoEm: Date.now(),
  });
}

function processarAvisosBillingAposUso(resumoDepois, dados, agora) {
  if (!resumoDepois || !dados || !resumoDepois.mes) {
    return false;
  }

  const registro = registroAvisosBillingMes(
    dados,
    resumoDepois.chaveAvisos || resumoDepois.mes,
    true,
  );
  const percentualAtual = Math.max(
    0,
    Number(resumoDepois.percentual || 0) || 0,
  );
  let alterou = false;

  // Se a propria chamada levou o cliente a 100%, mostramos apenas o aviso
  // de bloqueio. Isso evita empilhar, por exemplo, 95% e 100% juntos.
  if (!resumoDepois.atingido) {
    const avisos = obterAvisosBillingAtivos();
    const novos = avisos.filter((aviso) => {
      const chave = String(aviso.percentual);
      return percentualAtual >= aviso.percentual && !registro[chave];
    });

    if (novos.length) {
      for (const aviso of novos) {
        registro[String(aviso.percentual)] = {
          emitidoEm: agora,
          percentual: aviso.percentual,
          tipo: "aviso",
        };
        alterou = true;
      }

      const maisAlto = novos.at(-1);

      console.log(
        `[BILLING IA] AVISO | plano=${resumoDepois.plano} | percentual=${maisAlto.percentual} | consumido=${resumoDepois.consumidoBrl.toFixed(4)} | orcamento=${resumoDepois.orcamentoBrl.toFixed(2)}`,
      );

      emitirAvisoBillingIA("aviso", resumoDepois, maisAlto.percentual);
    }
  }

  if (resumoDepois.atingido && !registro["100"]) {
    registro["100"] = {
      emitidoEm: agora,
      percentual: 100,
      tipo: "bloqueio",
    };
    alterou = true;

    console.warn(
      `[BILLING IA] BLOQUEIO | plano=${resumoDepois.plano} | consumido=${resumoDepois.consumidoBrl.toFixed(4)} | orcamento=${resumoDepois.orcamentoBrl.toFixed(2)}`,
    );

    emitirAvisoBillingIA("bloqueio", resumoDepois, 100);
  }

  return alterou;
}

function garantirAvisoBloqueioBilling(resumo) {
  if (!resumo?.atingido || !resumo?.mes) {
    return;
  }

  try {
    const dados = carregarUsoGroqPersistido();
    const registro = registroAvisosBillingMes(
      dados,
      resumo.chaveAvisos || resumo.mes,
      true,
    );

    if (registro["100"]) {
      return;
    }

    registro["100"] = {
      emitidoEm: Date.now(),
      percentual: 100,
      tipo: "bloqueio",
    };

    salvarUsoGroqPersistido(dados);
    emitirAvisoBillingIA("bloqueio", resumo, 100);
  } catch (erro) {
    console.warn("Billing block warning failed:", erro?.message || erro);
  }
}

function obterResumoBillingIAAtual() {
  const configuracao = carregarConfiguracaoComercialAdmin();
  const plano = normalizarPlanoAdmin(configuracao.plano);
  const nomePlano = PLANOS_ADMIN[plano]?.nome || "Premium";
  const billing = normalizarBillingAdmin(configuracao.billing);
  const orcamentoBrl = numeroFinanceiroBilling(billing?.[plano]?.orcamentoIA);
  const mensalidadeBrl = numeroFinanceiroBilling(billing?.[plano]?.mensalidade);
  const dados = carregarUsoGroqPersistido();
  const mesAtual = chaveMesLocalBilling();
  const motor = obterResumoUsoGroqChave("motor", mesAtual);
  const teste = obterResumoUsoGroqChave("teste", mesAtual);

  const consumidoBrl = arredondarFinanceiroBilling(
    numeroFinanceiroBilling(motor.custoBrlFaturavel),
  );
  const consumidoUsd = arredondarFinanceiroBilling(
    numeroFinanceiroBilling(motor.custoUsdFaturavel),
  );
  const custoTotalBrl = arredondarFinanceiroBilling(
    numeroFinanceiroBilling(motor.custoBrlTotal),
  );
  const saldoBrl = Math.max(0, orcamentoBrl - consumidoBrl);
  const percentual =
    orcamentoBrl > 0 ? Math.min(100, (consumidoBrl / orcamentoBrl) * 100) : 100;
  const atingido = orcamentoBrl <= 0 || consumidoBrl >= orcamentoBrl;
  const chaveAvisos = `${mesAtual}:${motor.fingerprint || "sem-chave"}`;
  const registroAvisos =
    registroAvisosBillingMes(dados, chaveAvisos, false) || {};
  const avisosEmitidos = Object.keys(registroAvisos)
    .map((valor) => Number(valor))
    .filter((valor) => Number.isFinite(valor) && valor >= 1 && valor <= 100)
    .sort((a, b) => a - b);

  return {
    plano,
    nomePlano,
    mensalidadeBrl,
    orcamentoBrl,
    consumidoBrl,
    consumidoUsd,
    saldoBrl: arredondarFinanceiroBilling(saldoBrl),
    percentual: arredondarFinanceiroBilling(percentual, 4),
    atingido,
    chamadasFaturaveis: motor.chamadasFaturaveis,
    pesquisasWebFaturaveis: motor.pesquisasWebFaturaveis,
    custoTotalBrl,
    custoAdministrativoBrl: arredondarFinanceiroBilling(
      Math.max(0, custoTotalBrl - consumidoBrl),
    ),
    custoSistemaBrl: arredondarFinanceiroBilling(
      numeroFinanceiroBilling(motor.custoBrlTotal) +
        numeroFinanceiroBilling(teste.custoBrlTotal),
    ),
    motor,
    teste,
    mes: mesAtual,
    billingDesde: motor.primeiroUsoEm,
    chaveAvisos,
    precificacao: billing.precificacao,
    precificacaoMeta: billing.precificacaoMeta,
    avisos: billing.avisos,
    avisosEmitidos,
  };
}

function verificarOrcamentoBillingDisponivel() {
  const resumo = obterResumoBillingIAAtual();

  return {
    ok: !resumo.atingido,
    ...resumo,
  };
}

function arquivoConfiguracaoComercialAdmin() {
  return path.join(app.getPath("userData"), "admin-config-comercial-v1.json");
}

function normalizarPlanoAdmin(valor) {
  const id = String(valor || "")
    .trim()
    .toLowerCase();
  return PLANOS_ADMIN[id] ? id : "premium";
}

function configuracaoComercialAdminPadrao() {
  // Premium preserva o comportamento da base atual ate o administrador
  // escolher explicitamente o plano do cliente.
  return {
    versao: 5,
    nomeCliente: "",
    plano: "premium",
    motorIA: "",
    billing: normalizarBillingAdmin(BILLING_ADMIN_PADRAO),
    atualizadoEm: null,
  };
}

function carregarConfiguracaoComercialAdmin() {
  const padrao = configuracaoComercialAdminPadrao();

  try {
    const arquivo = arquivoConfiguracaoComercialAdmin();

    if (!fs.existsSync(arquivo)) {
      return padrao;
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    const versaoArquivo = Math.max(1, Number(dados?.versao || 1) || 1);
    let billingRecebido =
      dados?.billing && typeof dados.billing === "object"
        ? JSON.parse(JSON.stringify(dados.billing))
        : {};

    // A primeira versao do Billing podia persistir zeros antes de os valores
    // padrao estarem efetivamente conectados ao resumo. Na migracao para v5,
    // apenas configuracoes antigas com zero/missing recebem os defaults.
    // Depois de migrado, zero continua podendo ser uma escolha explicita.
    if (versaoArquivo < 5) {
      for (const planoId of ["basico", "intermediario", "premium"]) {
        const padraoPlano = BILLING_ADMIN_PADRAO[planoId];
        const recebidoPlano = billingRecebido?.[planoId] || {};
        const mensalidade = Number(recebidoPlano?.mensalidade);
        const orcamento = Number(recebidoPlano?.orcamentoIA);

        billingRecebido[planoId] = {
          ...recebidoPlano,
          mensalidade:
            Number.isFinite(mensalidade) && mensalidade > 0
              ? mensalidade
              : padraoPlano.mensalidade,
          orcamentoIA:
            Number.isFinite(orcamento) && orcamento > 0
              ? orcamento
              : padraoPlano.orcamentoIA,
        };
      }
    }

    return {
      versao: 5,
      nomeCliente: String(dados?.nomeCliente || "")
        .trim()
        .slice(0, 120),
      plano: normalizarPlanoAdmin(dados?.plano),
      motorIA: String(dados?.motorIA || "").trim(),
      billing: normalizarBillingAdmin(billingRecebido),
      atualizadoEm: Number(dados?.atualizadoEm || 0) || null,
    };
  } catch (erro) {
    console.warn("Admin commercial config read failed:", erro?.message || erro);
    return padrao;
  }
}

function salvarConfiguracaoComercialAdmin(parcial = {}) {
  try {
    const atual = carregarConfiguracaoComercialAdmin();
    const proxima = {
      versao: 5,
      nomeCliente:
        parcial.nomeCliente === undefined
          ? atual.nomeCliente
          : String(parcial.nomeCliente || "")
              .trim()
              .slice(0, 120),
      plano:
        parcial.plano === undefined
          ? atual.plano
          : normalizarPlanoAdmin(parcial.plano),
      motorIA:
        parcial.motorIA === undefined
          ? atual.motorIA
          : String(parcial.motorIA || "").trim(),
      billing:
        parcial.billing === undefined
          ? normalizarBillingAdmin(atual.billing)
          : normalizarBillingAdmin(parcial.billing),
      atualizadoEm: Date.now(),
    };

    const arquivo = arquivoConfiguracaoComercialAdmin();
    const temporario = `${arquivo}.tmp`;

    fs.writeFileSync(temporario, JSON.stringify(proxima, null, 2), "utf8");
    fs.renameSync(temporario, arquivo);

    return { ok: true, configuracao: proxima };
  } catch (erro) {
    console.warn("[ADMIN] CONFIG_COMERCIAL_ERRO", erro?.message || erro);
    return {
      ok: false,
      erro: "Não foi possível salvar a configuração administrativa.",
    };
  }
}

function obterPermissoesPlanoAdmin(planoId = null) {
  const configuracao = carregarConfiguracaoComercialAdmin();
  const plano =
    PLANOS_ADMIN[normalizarPlanoAdmin(planoId || configuracao.plano)];

  return {
    plano: plano.id,
    nomePlano: plano.nome,
    niveisPermitidos: [...plano.niveis],
    pesquisaWebPermitida: !!plano.pesquisaWeb,
    maxMensagens: plano.maxMensagens,
    maxPromptPersonalizado: plano.maxPromptPersonalizado,
    maxTokensContexto: plano.maxTokensContexto,
    catalogoMaxPaginas: plano.catalogoMaxPaginas,
    catalogoMaxBytes: plano.catalogoMaxBytes,
  };
}

function obterConfiguracaoClientePublica() {
  const configuracao = carregarConfiguracaoComercialAdmin();
  const permissoes = obterPermissoesPlanoAdmin(configuracao.plano);

  return {
    nomeCliente: configuracao.nomeCliente,
    plano: permissoes.plano,
    nomePlano: permissoes.nomePlano,
    niveisPermitidos: permissoes.niveisPermitidos,
    pesquisaWebPermitida: permissoes.pesquisaWebPermitida,
    catalogoMaxPaginas: permissoes.catalogoMaxPaginas,
    catalogoMaxBytes: permissoes.catalogoMaxBytes,
  };
}

function obterMotorIAAdmin() {
  return String(carregarConfiguracaoComercialAdmin().motorIA || "").trim();
}

function exigirSessaoAdmin(token) {
  const sessao = validarSessaoAdmin(token);

  if (!sessao) {
    return {
      ok: false,
      erro: "Sessão administrativa expirada. Entre novamente.",
    };
  }

  return { ok: true, sessao };
}

function normalizarValidacaoPlanoTesteIA(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokensEstruturaisTesteIA(valor) {
  return normalizarValidacaoPlanoTesteIA(valor)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ehFollowupReferencialGeradoTesteIA(valor) {
  const texto = normalizarValidacaoPlanoTesteIA(valor);

  if (!texto) {
    return false;
  }

  return /^(?:e\b|mas\b|entao\b|nesse\b|nessa\b|nesse caso\b|nessa situacao\b|nisso\b|isso\b|ele\b|ela\b|esse\b|essa\b|desse\b|dessa\b|quanto a isso\b|considerando isso\b|considerando esse\b|considerando essa\b|com base nisso\b|a partir disso\b|diante disso\b|e se\b)|\b(?:ele|ela|isso|nisso|desse|dessa|esse|essa|essa cotacao|esse valor|esse preco|essa informacao)\b/.test(
    texto,
  );
}

function sobreposicaoAssuntoTesteIA(direta, followup) {
  const stop = new Set([
    "a",
    "o",
    "as",
    "os",
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "em",
    "no",
    "na",
    "nos",
    "nas",
    "um",
    "uma",
    "para",
    "por",
    "com",
    "qual",
    "quais",
    "quanto",
    "quantos",
    "quantas",
    "hoje",
    "agora",
    "atual",
    "atualmente",
    "preco",
    "valor",
    "custa",
    "custando",
    "brasil",
  ]);

  const a = new Set(
    tokensEstruturaisTesteIA(direta).filter(
      (token) => token.length >= 3 && !stop.has(token),
    ),
  );

  const b = new Set(
    tokensEstruturaisTesteIA(followup).filter(
      (token) => token.length >= 3 && !stop.has(token),
    ),
  );

  let comum = 0;

  for (const token of a) {
    if (b.has(token)) {
      comum += 1;
    }
  }

  return comum;
}

function validarPlanoDinamicoTesteIA(plano, produto) {
  const erros = [];
  const contexto = normalizarValidacaoPlanoTesteIA(produto?.resumo);
  const nome = normalizarValidacaoPlanoTesteIA(produto?.nome);

  const obrigatorios = [
    ["catalogoDireto", "prompt"],
    ["catalogoDireto", "expectedContains"],
    ["catalogoFollowup", "prompt"],
    ["catalogoGrounding", "prompt"],
    ["catalogoGrounding", "attribute"],
    ["factual", "prompt"],
    ["factual", "expectedContains"],
    ["webDireta", "prompt"],
    ["webFollowup", "prompt"],
    ["normalDireta", "prompt"],
    ["normalFollowup", "prompt"],
    ["climaSemLocal", "prompt"],
  ];

  for (const [grupo, campo] of obrigatorios) {
    if (!String(plano?.[grupo]?.[campo] || "").trim()) {
      erros.push(`${grupo}.${campo}`);
    }
  }

  const promptDireto = normalizarValidacaoPlanoTesteIA(
    plano?.catalogoDireto?.prompt,
  );
  const promptFollowup = normalizarValidacaoPlanoTesteIA(
    plano?.catalogoFollowup?.prompt,
  );
  const promptGrounding = normalizarValidacaoPlanoTesteIA(
    plano?.catalogoGrounding?.prompt,
  );

  if (nome && !promptDireto.includes(nome)) {
    erros.push("catalogoDireto.produto");
  }

  if (nome && promptFollowup.includes(nome)) {
    erros.push("catalogoFollowup.repeteProduto");
  }

  if (nome && promptGrounding.includes(nome)) {
    erros.push("catalogoGrounding.repeteProduto");
  }

  for (const [grupo, campo] of [
    ["catalogoDireto", "expectedContains"],
    ["catalogoFollowup", "expectedContains"],
  ]) {
    const esperado = normalizarValidacaoPlanoTesteIA(plano?.[grupo]?.[campo]);

    if (esperado && contexto && !contexto.includes(esperado)) {
      erros.push(`${grupo}.expectedForaDoCatalogo`);
    }
  }

  const ausente = normalizarValidacaoPlanoTesteIA(
    plano?.catalogoGrounding?.attribute,
  );

  if (ausente && contexto.includes(ausente)) {
    erros.push("catalogoGrounding.atributoPresente");
  }

  const webDiretaPrompt = String(plano?.webDireta?.prompt || "").trim();
  const webFollowupPrompt = String(plano?.webFollowup?.prompt || "").trim();
  const webDiretaNormalizado = normalizarValidacaoPlanoTesteIA(webDiretaPrompt);
  const webFollowupNormalizado =
    normalizarValidacaoPlanoTesteIA(webFollowupPrompt);

  const ehClimaReservadoPlanoTeste = (texto) =>
    /\b(clima|previsao do tempo|temperatura|temperaturas|chuva|chover|graus c|graus f)\b/.test(
      texto,
    ) || /\btempo\s+(?:em|para|amanha|hoje|nos proximos|daqui a)\b/.test(texto);

  if (
    ehClimaReservadoPlanoTeste(webDiretaNormalizado) ||
    ehClimaReservadoPlanoTeste(webFollowupNormalizado)
  ) {
    erros.push("webDireta.reservaClima");
  }

  const assuntoWebVerificavel =
    /\b(dolar|euro|cambio|bitcoin|ethereum|ibovespa|selic|ipca|petrobras|petr4|vale|vale3|apple|aapl|iphone|macbook|microsoft|msft|windows|tesla|tsla|amazon|amzn|meta|google|alphabet|android|samsung|galaxy|nvidia|amd|playstation|xbox|nintendo|steam|openai|chatgpt|acao|acoes|bolsa|cotacao|placar|campeonato|brasileirao|libertadores|champions|formula 1|f1|nba|ufc|atp|wta|copa|presidente|governador|ministro|copom)\b/.test(
      webDiretaNormalizado,
    );

  if (!assuntoWebVerificavel) {
    erros.push("webDireta.assuntoNaoVerificavel");
  }

  if (!ehFollowupReferencialGeradoTesteIA(webFollowupPrompt)) {
    erros.push("webFollowup.naoReferencial");
  }

  if (sobreposicaoAssuntoTesteIA(webDiretaPrompt, webFollowupPrompt) >= 2) {
    erros.push("webFollowup.repeteAssunto");
  }

  const normalDiretaPrompt = String(plano?.normalDireta?.prompt || "").trim();
  const normalFollowupPrompt = String(
    plano?.normalFollowup?.prompt || "",
  ).trim();

  // Para conversa normal, a continuidade e semantica.
  // Nao exigir um conjunto fixo de pronomes/conectores, pois isso
  // fazia o planejador rejeitar baterias validas repetidamente.
  if (
    normalDiretaPrompt &&
    normalFollowupPrompt &&
    normalizarValidacaoPlanoTesteIA(normalDiretaPrompt) ===
      normalizarValidacaoPlanoTesteIA(normalFollowupPrompt)
  ) {
    erros.push("normalFollowup.duplicado");
  }

  const termosProdutoIgnorados = new Set([
    "produto",
    "produtos",
    "modelo",
    "modelos",
    "item",
    "itens",
    "pergunta",
    "perguntas",
    "uteis",
    "util",
    "testar",
    "teste",
    "testes",
    "depois",
  ]);

  const termosProduto = nome
    .split(/\s+/)
    .map((termo) => termo.trim())
    .filter(
      (termo) =>
        termo.length >= 4 &&
        !STOPWORDS_BUSCA_CATALOGO.has(termo) &&
        !termosProdutoIgnorados.has(termo),
    );

  for (const grupo of [
    "webDireta",
    "webFollowup",
    "normalDireta",
    "normalFollowup",
  ]) {
    const prompt = normalizarValidacaoPlanoTesteIA(plano?.[grupo]?.prompt);

    if (
      termosProduto.some((termo) =>
        new RegExp(`\\b${termo}\\b`, "i").test(prompt),
      )
    ) {
      erros.push(`${grupo}.contaminaCatalogo`);
    }
  }

  return {
    ok: erros.length === 0,
    erros,
  };
}

function feedbackValidacaoPlanoTesteIA(erros = [], produto = {}) {
  const nomeProduto = String(produto?.nome || "").trim();
  const linhas = [];

  for (const erro of Array.isArray(erros) ? erros : []) {
    if (erro === "catalogoDireto.produto") {
      linhas.push(
        `catalogoDireto.produto: catalogoDireto.prompt MUST contain the exact product name: "${nomeProduto}".`,
      );
      continue;
    }

    if (erro.endsWith(".expectedForaDoCatalogo")) {
      linhas.push(
        `${erro}: expectedContains MUST be copied literally from LIVE PRODUCT EXCERPT, with no paraphrase.`,
      );
      continue;
    }

    if (erro.endsWith(".contaminaCatalogo")) {
      linhas.push(
        `${erro}: rewrite this prompt on a completely unrelated subject and do not reuse words from the live product name/category.`,
      );
      continue;
    }

    if (erro === "webFollowup.naoReferencial") {
      linhas.push(
        "webFollowup.naoReferencial: make webFollowup impossible to understand without webDireta, using a clear reference such as 'considerando isso' or 'com base nisso'.",
      );
      continue;
    }

    if (erro === "webFollowup.repeteAssunto") {
      linhas.push(
        "webFollowup.repeteAssunto: keep the same context, but do not repeat the named subject/entity from webDireta.",
      );
      continue;
    }

    if (erro === "webDireta.reservaClima") {
      linhas.push(
        "webDireta.reservaClima: rewrite the web pair on a fresh non-weather subject. Weather, climate, forecast and temperature are reserved for the dedicated WEATHER test.",
      );
      continue;
    }

    if (erro === "webDireta.assuntoNaoVerificavel") {
      linhas.push(
        "webDireta.assuntoNaoVerificavel: use a clearly real and publicly verifiable current subject. Prefer USD/BRL or EUR/BRL exchange rate, Bitcoin/Ethereum, Ibovespa, Selic/IPCA, PETR4/VALE3/AAPL/MSFT/TSLA/AMZN, Apple/iPhone, Microsoft, Samsung/Galaxy, NVIDIA/AMD, PlayStation/Xbox/Nintendo, OpenAI/ChatGPT, a real sports result, or a current public officeholder. Never invent company, ticker, person, product or event names.",
      );
      continue;
    }

    if (erro === "catalogoFollowup.repeteProduto") {
      linhas.push(
        `catalogoFollowup.repeteProduto: refer to "${nomeProduto}" indirectly, without repeating the exact product name.`,
      );
      continue;
    }

    if (erro === "catalogoGrounding.repeteProduto") {
      linhas.push(
        `catalogoGrounding.repeteProduto: refer to "${nomeProduto}" indirectly, without repeating the exact product name.`,
      );
      continue;
    }

    if (erro === "catalogoGrounding.atributoPresente") {
      linhas.push(
        "catalogoGrounding.atributoPresente: choose a concrete yes/no attribute that is absent from LIVE PRODUCT EXCERPT.",
      );
      continue;
    }

    linhas.push(
      `${erro}: fix this validation error without changing unrelated fields.`,
    );
  }

  return linhas.join("\n");
}

async function gerarPlanoDinamicoTesteIntegridadeIA(dados = {}) {
  const apiKey = obterChaveGroqParaUso();

  if (!apiKey) {
    return {
      ok: false,
      erro: "Chave de testes da Groq não configurada. Cadastre a API de testes na área administrativa.",
    };
  }

  const produto = {
    nome: String(dados?.produto?.nome || "").trim(),
    preco: String(dados?.produto?.preco || "").trim(),
    pagina: Math.max(1, Number(dados?.produto?.pagina || 1) || 1),
    resumo: String(dados?.produto?.resumo || "")
      .trim()
      .slice(0, 1600),
  };

  if (!produto.nome || !produto.resumo) {
    return {
      ok: false,
      erro: "Selecione um produto valido do catalogo.",
    };
  }

  const estilo =
    String(dados?.estilo || "").trim() === "padrao" ? "padrao" : "aleatorio";
  const idBateria = String(dados?.semente || "")
    .trim()
    .slice(0, 100);

  const instrucoes = [
    "Create test inputs for a WhatsApp AI routing system.",
    "Return JSON only.",
    "All prompts must be natural Brazilian Portuguese.",
    "Do not reuse any example, product, attribute, fact, web subject or conversation subject from these instructions.",
    "CATALOG DIRECT: ask one factual question whose answer exists in the supplied live catalog excerpt. The exact product name must appear in the prompt. expectedContains must be a short literal value copied from the excerpt.",
    "CATALOG FOLLOWUP: create a natural referential continuation about the same product. Do NOT repeat the exact product name. Prefer a different fact that truly exists in the excerpt. If there is no useful second fact, ask naturally for more information and return expectedContains as an empty string.",
    "CATALOG GROUNDING: create a yes/no referential question about one concrete attribute that is not stated or implied by the live excerpt. Never repeat the exact product name. Refer to the item naturally using a generic reference to the previous catalog turn. attribute must name only that absent attribute.",
    "FACTUAL: ask one stable timeless fact that does not need web search and return a short canonical answer in expectedContains.",
    "WEB: create a direct question that genuinely needs fresh/current web information. Use only a clearly real and publicly verifiable subject. Prefer USD/BRL or EUR/BRL exchange rate, Bitcoin/Ethereum, Ibovespa, Selic/IPCA, PETR4/VALE3/AAPL/MSFT/TSLA/AMZN, Apple/iPhone, Microsoft, Samsung/Galaxy, NVIDIA/AMD, PlayStation/Xbox/Nintendo, OpenAI/ChatGPT, a real sports result, or a current public officeholder. NEVER invent a company, ticker, person, product or event name. Do NOT use weather, climate, forecast, temperature or a city weather query here because weather has a dedicated test later. The follow-up MUST be context-dependent and clearly refer back to that exact result using a connector, pronoun or demonstrative such as an equivalent of 'e isso', 'nesse caso', 'considerando isso' or 'com base nisso'. Do not repeat the named entity/subject from the direct question. A person reading only the follow-up must need the previous message to understand the subject. Do not introduce the live catalog product or its product category.",
    "NORMAL: create a conversational message that does not need current web information and a natural context-dependent follow-up to it. The follow-up must refer naturally to the previous message instead of starting a new standalone topic. Both messages must stay completely unrelated to the live catalog product and to the web pair.",
    "WEATHER: create a future-weather question without any location so the tested system must ask for the city.",
    estilo === "padrao"
      ? "Use conservative, simple and unambiguous formulations."
      : "Use varied, exploratory and natural formulations while staying unambiguous.",
    idBateria
      ? `Variation ID: ${idBateria}. Use it only to diversify choices. Never include it in the prompts.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const contexto = [
    `LIVE PRODUCT NAME: ${produto.nome}`,
    `LIVE PRODUCT PAGE: ${produto.pagina}`,
    `LIVE PRODUCT EXCERPT:\n${produto.resumo}`,
  ].join("\n\n");

  const itemPrompt = {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 2 },
    },
    required: ["prompt"],
    additionalProperties: false,
  };

  const schema = {
    type: "object",
    properties: {
      catalogoDireto: {
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 2 },
          expectedContains: { type: "string", minLength: 1 },
        },
        required: ["prompt", "expectedContains"],
        additionalProperties: false,
      },
      catalogoFollowup: {
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 2 },
          expectedContains: { type: "string" },
        },
        required: ["prompt", "expectedContains"],
        additionalProperties: false,
      },
      catalogoGrounding: {
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 2 },
          attribute: { type: "string", minLength: 2 },
        },
        required: ["prompt", "attribute"],
        additionalProperties: false,
      },
      factual: {
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 2 },
          expectedContains: { type: "string", minLength: 1 },
        },
        required: ["prompt", "expectedContains"],
        additionalProperties: false,
      },
      webDireta: itemPrompt,
      webFollowup: itemPrompt,
      normalDireta: itemPrompt,
      normalFollowup: itemPrompt,
      climaSemLocal: itemPrompt,
    },
    required: [
      "catalogoDireto",
      "catalogoFollowup",
      "catalogoGrounding",
      "factual",
      "webDireta",
      "webFollowup",
      "normalDireta",
      "normalFollowup",
      "climaSemLocal",
    ],
    additionalProperties: false,
  };

  let ultimoErro = "";
  let feedbackTentativa = "";

  for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
    const contextoTentativa = feedbackTentativa
      ? `${contexto}\n\nPREVIOUS PLAN WAS REJECTED. FIX ALL OF THESE VALIDATION ERRORS:\n${feedbackTentativa}`
      : contexto;

    const corpo = JSON.stringify({
      model: GROQ_MODELO_PADRAO,
      messages: [
        {
          role: "system",
          content: instrucoes,
        },
        {
          role: "user",
          content: contextoTentativa,
        },
      ],
      temperature: estilo === "padrao" ? 0.05 : 0.72,
      top_p: estilo === "padrao" ? 0.25 : 0.9,
      max_completion_tokens: 1800,
      reasoning_effort: "low",
      include_reasoning: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "whatsiapp_plano_teste_dinamico",
          strict: true,
          schema,
        },
      },
    });

    const resposta = await requisitarGroqComRetry(corpo, apiKey, 2);

    if (
      resposta.erro ||
      resposta.statusCode < 200 ||
      resposta.statusCode >= 300
    ) {
      ultimoErro = String(
        resposta?.payload?.error?.message ||
          resposta?.erro ||
          `HTTP ${resposta?.statusCode || 0}`,
      ).trim();
      continue;
    }

    const payload = resposta.payload;
    const texto = String(payload?.choices?.[0]?.message?.content || "").trim();

    let plano = null;

    try {
      plano = JSON.parse(texto);
    } catch {
      ultimoErro = "Plano fora do JSON esperado.";
      feedbackTentativa = ultimoErro;
      continue;
    }

    const validacao = validarPlanoDinamicoTesteIA(plano, produto);

    if (!validacao.ok) {
      ultimoErro = `Plano rejeitado: ${validacao.erros.join(", ")}`;
      feedbackTentativa = feedbackValidacaoPlanoTesteIA(
        validacao.erros,
        produto,
      );

      console.warn(
        `[TEST IA] PLAN_REJECT | tentativa=${tentativa} | erros=${validacao.erros.join(";")}`,
      );
      continue;
    }

    console.log(
      `[TEST IA] PLAN_OK | estilo=${estilo} | tentativa=${tentativa} | tokens=${
        Number(payload?.usage?.total_tokens || 0) || 0
      }`,
    );

    return {
      ok: true,
      estilo,
      semente: idBateria,
      plano,
      uso: payload?.usage || null,
      modelo: payload?.model || GROQ_MODELO_PADRAO,
      tentativas: tentativa,
    };
  }

  return {
    ok: false,
    erro: ultimoErro || "Nao foi possivel gerar uma bateria dinamica valida.",
  };
}

ipcMain.handle("admin-teste-ia-gerar-plano", async (_evento, dados = {}) => {
  const admin = validarTesteIntegridadeIAAdmin(dados?.token);

  if (!admin.ok) {
    return admin;
  }

  try {
    return await executarGroqNaoFaturavel(
      "admin-planejador-teste",
      () => gerarPlanoDinamicoTesteIntegridadeIA(dados),
      "teste",
    );
  } catch (erro) {
    return {
      ok: false,
      erro: erro?.message || "Falha ao gerar a bateria dinamica.",
    };
  }
});

ipcMain.handle(
  "admin-teste-ia-catalogo-sugestoes",
  async (_evento, dados = {}) => {
    const admin = validarTesteIntegridadeIAAdmin(dados?.token);

    if (!admin.ok) {
      return admin;
    }

    try {
      const catalogo = lerMetadadosCatalogoClienteBrutos();
      const candidatos = extrairCandidatosCatalogoTesteIntegridadeIA(16);

      return {
        ok: true,
        catalogoAtivo: !!catalogo?.ativo,
        candidatos,
      };
    } catch (erro) {
      return {
        ok: false,
        erro:
          erro?.message ||
          "Nao foi possivel preparar as perguntas do catalogo.",
      };
    }
  },
);

ipcMain.handle("admin-teste-ia-iniciar", async (_evento, dados = {}) => {
  const admin = validarTesteIntegridadeIAAdmin(dados?.token);

  if (!admin.ok) {
    return admin;
  }

  if (testeIntegridadeIAAtivo) {
    return {
      ok: false,
      erro: "Ja existe um teste de integridade em andamento.",
    };
  }

  const conversaOriginalId = String(dados?.conversaOriginalId || "").trim();
  const conversaTesteId = String(dados?.conversaTesteId || "").trim();

  if (!conversaOriginalId || !conversaTesteId) {
    return {
      ok: false,
      erro: "Conversa de teste invalida.",
    };
  }

  testeIntegridadeIAAtivo = {
    iniciadoEm: Date.now(),
    conversaOriginalId,
    conversaOriginalNome: String(
      dados?.conversaOriginalNome || conversaOriginalId,
    ).trim(),
    conversaTesteId,
    etapaAtual: null,
  };

  consoleTesteIAOriginal.log(
    `[TEST IA] SUITE_START | origem=${conversaOriginalId} | sombra=${conversaTesteId}`,
  );

  return {
    ok: true,
  };
});

ipcMain.handle("admin-teste-ia-etapa-iniciar", async (_evento, dados = {}) => {
  const admin = validarTesteIntegridadeIAAdmin(dados?.token);

  if (!admin.ok) {
    return admin;
  }

  const sessao = testeIntegridadeIAAtivo;

  if (!sessao) {
    return {
      ok: false,
      erro: "Nenhum teste de integridade esta ativo.",
    };
  }

  if (sessao.etapaAtual && !sessao.etapaAtual.finalizada) {
    return {
      ok: false,
      erro: "A etapa anterior ainda nao terminou.",
    };
  }

  sessao.etapaAtual = {
    numero: Number(dados?.numero || 0) || 0,
    nome: String(dados?.nome || "").trim(),
    prompt: String(dados?.prompt || "").trim(),
    resposta: "",
    logs: [],
    iniciadaEm: Date.now(),
    finalizada: false,
  };

  consoleTesteIAOriginal.log(
    `[TEST IA] TEST_START | n=${sessao.etapaAtual.numero} | nome=${sessao.etapaAtual.nome}`,
  );

  return {
    ok: true,
  };
});

ipcMain.on("admin-teste-ia-falha-resposta", (_evento, dados = {}) => {
  const sessao = testeIntegridadeIAAtivo;
  const conversaTesteId = String(dados?.conversaTesteId || "").trim();

  if (
    !sessao ||
    !sessao.etapaAtual ||
    sessao.etapaAtual.finalizada ||
    conversaTesteId !== sessao.conversaTesteId
  ) {
    return;
  }

  const erro = String(dados?.erro || "Falha ao gerar a resposta da etapa.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  consoleTesteIAOriginal.warn(
    `[TEST IA] RESPONSE_FAILED | n=${sessao.etapaAtual.numero} | erro=${erro}`,
  );

  if (!janela || janela.isDestroyed()) {
    return;
  }

  janela.webContents.send("admin-teste-ia-resposta-capturada", {
    conversaTesteId: sessao.conversaTesteId,
    numero: sessao.etapaAtual.numero,
    resposta: "",
    motivo: "erro_ia",
    erro,
  });
});

ipcMain.handle(
  "admin-teste-ia-etapa-finalizar",
  async (_evento, dados = {}) => {
    const admin = validarTesteIntegridadeIAAdmin(dados?.token);

    if (!admin.ok) {
      return admin;
    }

    const etapa = testeIntegridadeIAAtivo?.etapaAtual;

    if (!etapa) {
      return {
        ok: false,
        erro: "Nenhuma etapa de teste esta ativa.",
      };
    }

    etapa.finalizada = true;

    const retorno = {
      ok: true,
      numero: etapa.numero,
      nome: etapa.nome,
      prompt: etapa.prompt,
      resposta: String(dados?.resposta || etapa.resposta || ""),
      logs: [...etapa.logs],
      iniciadaEm: etapa.iniciadaEm,
      finalizadaEm: Date.now(),
      motivo: String(dados?.motivo || "resposta"),
      erro: String(dados?.erro || "").trim(),
    };

    consoleTesteIAOriginal.log(
      `[TEST IA] TEST_END | n=${etapa.numero} | motivo=${retorno.motivo}`,
    );

    testeIntegridadeIAAtivo.etapaAtual = null;

    return retorno;
  },
);

ipcMain.handle(
  "admin-teste-ia-salvar-relatorio",
  async (_evento, dados = {}) => {
    const admin = validarTesteIntegridadeIAAdmin(dados?.token);

    if (!admin.ok) {
      return admin;
    }

    try {
      const pasta = path.join(
        app.getPath("documents"),
        "WhatsIAPP",
        "Diagnosticos",
      );

      fs.mkdirSync(pasta, { recursive: true });

      const arquivo = path.join(
        pasta,
        `relatorio-regressao-ia-${nomeArquivoTesteIntegridadeIA()}.txt`,
      );

      fs.writeFileSync(arquivo, String(dados?.conteudo || ""), "utf8");

      consoleTesteIAOriginal.log(`[TEST IA] REPORT_SAVED | arquivo=${arquivo}`);

      return {
        ok: true,
        arquivo,
      };
    } catch (erro) {
      return {
        ok: false,
        erro: erro?.message || "Nao foi possivel salvar o relatorio do teste.",
      };
    }
  },
);

ipcMain.handle(
  "admin-teste-ia-abrir-relatorio",
  async (_evento, dados = {}) => {
    const admin = validarTesteIntegridadeIAAdmin(dados?.token);

    if (!admin.ok) {
      return admin;
    }

    const arquivo = String(dados?.arquivo || "").trim();

    if (!arquivo || !fs.existsSync(arquivo)) {
      return {
        ok: false,
        erro: "Relatorio nao encontrado.",
      };
    }

    shell.showItemInFolder(arquivo);

    return {
      ok: true,
    };
  },
);

ipcMain.handle("admin-teste-ia-encerrar", async (_evento, dados = {}) => {
  const admin = validarTesteIntegridadeIAAdmin(dados?.token);

  if (!admin.ok) {
    return admin;
  }

  consoleTesteIAOriginal.log("[TEST IA] SUITE_END");

  limparTesteIntegridadeIAAtivo();

  return {
    ok: true,
  };
});

ipcMain.handle("admin-status", async () => {
  const registro = carregarAcessoAdmin();

  return {
    ok: true,
    configurado: !!registro,
    bloqueadoPorTentativas: segundosBloqueioAdminRestantes() > 0,
    aguardeSegundos: segundosBloqueioAdminRestantes(),
  };
});

ipcMain.handle("admin-config-publica", async () => {
  return {
    ok: true,
    configuracao: obterConfiguracaoClientePublica(),
  };
});

ipcMain.handle("admin-obter-configuracao", async (_evento, dados) => {
  const acesso = exigirSessaoAdmin(dados?.token);

  if (!acesso.ok) {
    return acesso;
  }

  const configuracao = carregarConfiguracaoComercialAdmin();
  const permissoes = obterPermissoesPlanoAdmin(configuracao.plano);
  const seguraMotor =
    chaveGroqSeguraConfigurada("motor") && !!obterChaveGroqSegura("motor");
  const seguraTeste =
    chaveGroqSeguraConfigurada("teste") && !!obterChaveGroqSegura("teste");

  return {
    ok: true,
    configuracao: {
      nomeCliente: configuracao.nomeCliente,
      plano: permissoes.plano,
      nomePlano: permissoes.nomePlano,
      niveisPermitidos: permissoes.niveisPermitidos,
      pesquisaWebPermitida: permissoes.pesquisaWebPermitida,
      motorIA: configuracao.motorIA,
      billing: normalizarBillingAdmin(configuracao.billing),
      groqConfigurada: seguraMotor,
      groqMotorConfigurada: seguraMotor,
      groqTesteConfigurada: seguraTeste,
      groqMotorFingerprint: obterFingerprintChaveGroqConfigurada("motor"),
      groqTesteFingerprint: obterFingerprintChaveGroqConfigurada("teste"),
      criptografiaDisponivel: safeStorage.isEncryptionAvailable(),
    },
  };
});

ipcMain.handle("admin-status-billing", async (_evento, dados) => {
  const acesso = exigirSessaoAdmin(dados?.token);

  if (!acesso.ok) {
    return acesso;
  }

  return {
    ok: true,
    resumo: obterResumoBillingIAAtual(),
  };
});

ipcMain.handle(
  "admin-atualizar-precificacao-billing",
  async (_evento, dados) => {
    const acesso = exigirSessaoAdmin(dados?.token);

    if (!acesso.ok) {
      return acesso;
    }

    const atualizado = await atualizarPrecificacaoBillingAutomatica({
      forcar: true,
    });

    return {
      ok: !!atualizado?.ok,
      parcial: !!atualizado?.parcial,
      erro: atualizado?.erro || null,
      billing:
        atualizado?.billing ||
        normalizarBillingAdmin(carregarConfiguracaoComercialAdmin().billing),
      resumo: obterResumoBillingIAAtual(),
    };
  },
);

ipcMain.handle("admin-salvar-cliente-plano", async (_evento, dados) => {
  const acesso = exigirSessaoAdmin(dados?.token);

  if (!acesso.ok) {
    return acesso;
  }

  const resultado = salvarConfiguracaoComercialAdmin({
    nomeCliente: dados?.nomeCliente,
    plano: dados?.plano,
  });

  if (!resultado.ok) {
    return resultado;
  }

  const publica = obterConfiguracaoClientePublica();

  console.log(
    `[ADMIN] PLANO_SALVO | plano=${publica.plano} | pesquisaWeb=${publica.pesquisaWebPermitida}`,
  );

  return { ok: true, configuracao: publica };
});

ipcMain.handle("admin-salvar-billing", async (_evento, dados) => {
  const acesso = exigirSessaoAdmin(dados?.token);

  if (!acesso.ok) {
    return acesso;
  }

  const configuracaoAtual = carregarConfiguracaoComercialAdmin();
  const billingAtual = normalizarBillingAdmin(configuracaoAtual.billing);
  const recebido =
    dados?.billing && typeof dados.billing === "object" ? dados.billing : {};
  const billing = normalizarBillingAdmin({
    ...recebido,
    precificacao: billingAtual.precificacao,
    precificacaoMeta: billingAtual.precificacaoMeta,
  });
  const resultado = salvarConfiguracaoComercialAdmin({ billing });

  if (!resultado.ok) {
    return resultado;
  }

  console.log(
    `[ADMIN] BILLING_SALVO | basico=${billing.basico.orcamentoIA.toFixed(2)} | ` +
      `intermediario=${billing.intermediario.orcamentoIA.toFixed(2)} | ` +
      `premium=${billing.premium.orcamentoIA.toFixed(2)} | ` +
      `avisos=${billing.avisos
        .filter((item) => item.ativo)
        .map((item) => item.percentual)
        .join(",")}`,
  );

  return {
    ok: true,
    billing: normalizarBillingAdmin(resultado.configuracao.billing),
  };
});

ipcMain.handle("admin-salvar-motor-ia", async (_evento, dados) => {
  const acesso = exigirSessaoAdmin(dados?.token);

  if (!acesso.ok) {
    return acesso;
  }

  const motorIA = String(dados?.motorIA || "").trim();

  if (motorIA.length < 20) {
    return {
      ok: false,
      erro: "O Motor da IA precisa ter pelo menos 20 caracteres.",
    };
  }

  const resultado = salvarConfiguracaoComercialAdmin({ motorIA });

  if (resultado.ok) {
    console.log(`[ADMIN] MOTOR_IA_SALVO | caracteres=${motorIA.length}`);
  }

  return resultado.ok
    ? { ok: true, motorIA: resultado.configuracao.motorIA }
    : resultado;
});

ipcMain.handle("admin-status-chave-groq", async (_evento, dados) => {
  const acesso = exigirSessaoAdmin(dados?.token);

  if (!acesso.ok) {
    return acesso;
  }

  const tipo = normalizarTipoChaveGroq(dados?.tipo);
  const segura =
    chaveGroqSeguraConfigurada(tipo) && !!obterChaveGroqSegura(tipo);
  const fingerprint = obterFingerprintChaveGroqConfigurada(tipo);

  return {
    ok: true,
    tipo,
    configurada: segura,
    armazenamentoSeguro: segura,
    fingerprint,
    fingerprintCurto: fingerprint.slice(0, 8),
    criptografiaDisponivel: safeStorage.isEncryptionAvailable(),
  };
});

ipcMain.handle("admin-salvar-chave-groq", async (_evento, dados) => {
  const acesso = exigirSessaoAdmin(dados?.token);

  if (!acesso.ok) {
    return acesso;
  }

  const tipo = normalizarTipoChaveGroq(dados?.tipo);
  const resultado = salvarChaveGroqSegura(dados?.apiKey, tipo);

  if (resultado.ok) {
    console.log(
      `[ADMIN] GROQ_KEY_SALVA | tipo=${tipo} | id=${resultado.fingerprintCurto || "-"}`,
    );
  }

  return resultado;
});

ipcMain.handle("admin-remover-chave-groq", async (_evento, dados) => {
  const acesso = exigirSessaoAdmin(dados?.token);

  if (!acesso.ok) {
    return acesso;
  }

  const tipo = normalizarTipoChaveGroq(dados?.tipo);
  const resultado = removerChaveGroqSegura(tipo);

  if (resultado.ok) {
    console.log(`[ADMIN] GROQ_KEY_REMOVIDA | tipo=${tipo}`);
  }

  return resultado;
});

ipcMain.handle("admin-configurar-primeiro-acesso", async (_evento, dados) => {
  const resultado = salvarPrimeiroAcessoAdmin(dados?.usuario, dados?.senha);

  if (!resultado?.ok) {
    return resultado;
  }

  const token = criarSessaoAdmin(resultado.usuario);

  return {
    ok: true,
    usuario: resultado.usuario,
    token,
  };
});

ipcMain.handle("admin-login", async (_evento, dados) => {
  const registro = carregarAcessoAdmin();

  if (!registro) {
    return {
      ok: false,
      naoConfigurado: true,
      erro: "O acesso administrativo ainda não foi configurado.",
    };
  }

  const restante = segundosBloqueioAdminRestantes();

  if (restante > 0) {
    return {
      ok: false,
      bloqueadoPorTentativas: true,
      aguardeSegundos: restante,
      erro: `Muitas tentativas incorretas. Aguarde ${restante}s.`,
    };
  }

  const usuario = normalizarUsuarioAdmin(dados?.usuario);
  const senhaValida = validarSenhaAdmin(dados?.senha, registro);
  const usuarioValido = usuario === String(registro.usuarioNormalizado || "");

  if (!usuarioValido || !senhaValida) {
    falhasLoginAdmin += 1;

    if (falhasLoginAdmin >= ADMIN_MAX_FALHAS_LOGIN) {
      falhasLoginAdmin = 0;
      bloqueadoAteAdmin = Date.now() + ADMIN_BLOQUEIO_LOGIN_MS;

      console.log("[ADMIN] LOGIN_BLOQUEADO_TEMPORARIAMENTE");

      return {
        ok: false,
        bloqueadoPorTentativas: true,
        aguardeSegundos: Math.ceil(ADMIN_BLOQUEIO_LOGIN_MS / 1000),
        erro: "Muitas tentativas incorretas. Aguarde 30s.",
      };
    }

    console.log(`[ADMIN] LOGIN_FALHOU | tentativa=${falhasLoginAdmin}`);

    return {
      ok: false,
      erro: "Login ou senha incorretos.",
    };
  }

  falhasLoginAdmin = 0;
  bloqueadoAteAdmin = 0;

  const token = criarSessaoAdmin(registro.usuario);

  console.log("[ADMIN] LOGIN_OK");

  return {
    ok: true,
    usuario: registro.usuario,
    token,
  };
});

ipcMain.handle("admin-validar-sessao", async (_evento, dados) => {
  const sessao = validarSessaoAdmin(dados?.token);

  return sessao
    ? {
        ok: true,
        usuario: sessao.usuario,
      }
    : {
        ok: false,
        erro: "Sessão administrativa expirada.",
      };
});

ipcMain.handle("admin-logout", async (_evento, dados) => {
  const token = String(dados?.token || "").trim();

  if (token) {
    sessoesAdmin.delete(token);
  }

  console.log("[ADMIN] LOGOUT");

  return {
    ok: true,
  };
});

app.whenReady().then(() => {
  configurarIconeMacOS();
  configurarNotificacoesWindowsDev();
  carregarCachePrivacidade();
  agendarFallbackPrivacidadeInicial();

  // Fotos persistidas sao carregadas sob demanda. Evita decodificar centenas
  // de imagens no caminho critico da inicializacao.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (
        permission === "media" &&
        (!details?.mediaTypes?.length || details.mediaTypes.includes("audio"))
      ) {
        callback(true);
        return;
      }

      callback(false);
    },
  );

  criarJanela();
  configurarAtualizacaoAutomatica();
  iniciarAtualizacaoPeriodicaPrecificacaoBilling();
});

async function encerrarAplicacaoGraciosa() {
  if (encerramentoAppIniciado) {
    return;
  }

  encerramentoAppIniciado = true;
  encerrando = true;

  if (timerSalvarIndiceFotosPerfilPersistente) {
    clearTimeout(timerSalvarIndiceFotosPerfilPersistente);
    timerSalvarIndiceFotosPerfilPersistente = null;
  }

  if (indiceFotosPerfilPersistenteSujo) {
    indiceFotosPerfilPersistenteSujo = false;
    salvarIndiceFotosPerfilPersistenteAgora();
  }

  const workers = [whatsappWorker, archiveWorker].filter(Boolean);
  const encerramentos = workers.map(
    (worker) =>
      new Promise((resolve) => {
        worker.once("exit", resolve);
        try {
          worker.postMessage({ tipo: "encerrar" });
        } catch {
          resolve();
        }
      }),
  );

  // O WPPConnect precisa de tempo para fechar o Chromium e liberar o
  // SingletonLock. Sair em 3s deixava o perfil preso e a próxima abertura
  // parava no estágio de 50%.
  await Promise.race([
    Promise.allSettled(encerramentos),
    new Promise((resolve) => setTimeout(resolve, 15000)),
  ]);

  encerramentoAppConcluido = true;
  app.exit(0);
}

app.on("before-quit", (evento) => {
  if (encerramentoAppConcluido) {
    return;
  }

  evento.preventDefault();
  encerrarAplicacaoGraciosa().catch((erro) => {
    console.error("Falha no encerramento gracioso:", erro?.message || erro);
    encerramentoAppConcluido = true;
    app.exit(0);
  });
});

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    if (encerramentoAppConcluido) {
      return;
    }

    encerrarAplicacaoGraciosa().catch((erro) => {
      console.error(
        `Falha no encerramento por ${sinal}:`,
        erro?.message || erro,
      );
      encerramentoAppConcluido = true;
      app.exit(0);
    });
  });
}

app.on("window-all-closed", () => {
  app.quit();
});
