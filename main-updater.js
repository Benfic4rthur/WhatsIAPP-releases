"use strict";

const { app } = require("electron");
const path = require("path");
const workerThreads = require("worker_threads");
const pacote = require("./package.json");
const { criarDesktopUpdater } = require("./desktop-updater");
const { registrarSessaoWhatsAppIpc } = require("./sessao-whatsapp");

// Exibe a versao atual no titulo da janela principal sem hardcode.
// Mantem o titulo mesmo se o HTML tentar substitui-lo depois de carregar.
app.on("browser-window-created", (_evento, janela) => {
  try {
    if (janela.getTitle() !== "WhatsIAPP") return;

    const titulo = `WhatsIAPP • v${app.getVersion()}`;
    janela.setTitle(titulo);

    janela.webContents.on("page-title-updated", (evento) => {
      evento.preventDefault();
      if (!janela.isDestroyed()) janela.setTitle(titulo);
    });
  } catch (erro) {
    console.warn(
      `[WINDOW TITLE] UPDATE_FAILED | error=${erro?.message || erro}`,
    );
  }
});

// O bootstrap antigo liberava a interface assim que o Baileys ficava pronto,
// mesmo quando o WPPConnect ainda estava aguardando o segundo QR. Mantemos o
// evento de pronto do Baileys retido ate existir confirmacao real de login do
// WPPConnect. Assim, ao escanear um QR, o outro continua obrigatorio antes de
// o app entrar no estado conectado.
let wppAutenticadoInicial = false;
let baileysConectadoPendente = null;
let emitirWorkerOriginal = null;

function mensagemConfirmaWpp(mensagem) {
  if (!mensagem || mensagem.tipo !== "evento") return false;

  if (mensagem.evento === "wpp-qr-read") return true;

  if (
    mensagem.evento === "wpp-ready" &&
    mensagem.dados?.qrConfirmado === true
  ) {
    return true;
  }

  if (
    mensagem.evento === "sync-stage" &&
    ["wpp-autenticado", "full-ready"].includes(
      String(mensagem.dados?.etapa || ""),
    )
  ) {
    return true;
  }

  return false;
}

function mensagemDesautenticaWpp(mensagem) {
  if (!mensagem || mensagem.tipo !== "evento") return false;

  if (mensagem.evento === "wpp-qr") return true;

  if (mensagem.evento === "wpp-status") {
    const texto = String(mensagem.dados?.texto || "").toLowerCase();
    return [
      "notlogged",
      "disconnectedmobile",
      "qrreadfail",
      "qrreaderror",
      "deletetoken",
    ].includes(texto);
  }

  return false;
}

function ehBaileysConectado(mensagem) {
  return (
    mensagem?.tipo === "evento" &&
    mensagem?.evento === "status" &&
    String(mensagem?.dados?.tipo || "").toLowerCase() === "conectado"
  );
}

function liberarBaileysConectadoPendente() {
  const pendente = baileysConectadoPendente;
  baileysConectadoPendente = null;

  if (
    !pendente?.worker ||
    !pendente?.mensagem ||
    typeof emitirWorkerOriginal !== "function"
  ) {
    return;
  }

  console.log("[LOGIN GATE] BAILEYS_READY_RELEASED");
  emitirWorkerOriginal.call(
    pendente.worker,
    "message",
    pendente.mensagem,
  );
}

// Roteia os dois workers por wrappers pequenos que adicionam logout remoto
// usando as sessoes que ja estao autenticadas e ativas. Isso evita recriar
// sessoes depois que o app fecha, quando credenciais locais podem mudar de
// estado ou o Chromium pode restaurar uma sessao antiga.
if (!global.__whatsiappWorkerRouteInstalled) {
  const WorkerOriginal = workerThreads.Worker;
  emitirWorkerOriginal = WorkerOriginal.prototype.emit;

  class WorkerRoteadoWhatsIAPP extends WorkerOriginal {
    constructor(filename, options) {
      const nome = path.basename(String(filename || ""));
      const ehBaileys = nome === "whatsapp-worker.js";
      const ehWpp = nome === "wpp-worker.js";
      const arquivoReal = ehBaileys
        ? path.join(__dirname, "whatsapp-worker-live-wrapper.js")
        : ehWpp
          ? path.join(__dirname, "wpp-worker-live-wrapper.js")
          : filename;

      super(arquivoReal, options);

      this.__whatsiappTipoWorker = ehBaileys
        ? "baileys"
        : ehWpp
          ? "wpp"
          : null;

      if (ehWpp) {
        wppAutenticadoInicial = false;
      }

      if (ehBaileys || ehWpp) {
        const chave = ehBaileys ? "baileys" : "wpp";
        global.__whatsiappWorkers = global.__whatsiappWorkers || {};
        global.__whatsiappWorkers[chave] = this;

        this.once("exit", () => {
          if (global.__whatsiappWorkers?.[chave] === this) {
            global.__whatsiappWorkers[chave] = null;
          }
        });
      }
    }

    emit(evento, ...args) {
      if (evento !== "message" || !this.__whatsiappTipoWorker) {
        return super.emit(evento, ...args);
      }

      const mensagem = args[0];

      if (this.__whatsiappTipoWorker === "wpp") {
        if (mensagemDesautenticaWpp(mensagem)) {
          wppAutenticadoInicial = false;
        }

        const confirmou = mensagemConfirmaWpp(mensagem);
        if (confirmou) {
          wppAutenticadoInicial = true;
          console.log("[LOGIN GATE] WPP_AUTH_CONFIRMED");
        }

        const resultado = super.emit(evento, ...args);

        if (confirmou && baileysConectadoPendente) {
          setImmediate(liberarBaileysConectadoPendente);
        }

        return resultado;
      }

      if (
        this.__whatsiappTipoWorker === "baileys" &&
        ehBaileysConectado(mensagem) &&
        !wppAutenticadoInicial
      ) {
        baileysConectadoPendente = {
          worker: this,
          mensagem,
        };
        console.log("[LOGIN GATE] BAILEYS_READY_WAITING_WPP_AUTH");
        return true;
      }

      return super.emit(evento, ...args);
    }
  }

  workerThreads.Worker = WorkerRoteadoWhatsIAPP;
  global.__whatsiappWorkerRouteInstalled = true;
}

// Runtime-only compatibility switch. The legacy updater inside index.js checks
// this flag. It is intentionally mutated only in the main-process module cache,
// so the new updater can own the flow without rewriting the large index.js.
pacote.localTestBuild = true;

// Keep this switch available even when a pending Windows update delays loading
// index.js until after app.whenReady(). Calling it twice is harmless.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const updater = criarDesktopUpdater();
updater.registrarIpc();
registrarSessaoWhatsAppIpc();

let aplicacaoIniciada = false;

function iniciarAplicacaoNormal() {
  if (aplicacaoIniciada) return;
  aplicacaoIniciada = true;
  require("./index.js");
  updater.iniciarFluxoNormal();
}

if (updater.deveInstalarPendenteAntesDeIniciar()) {
  updater
    .instalarPendenteAntesDaInicializacao()
    .then((instalando) => {
      if (!instalando) iniciarAplicacaoNormal();
    })
    .catch((erro) => {
      console.warn(
        `[UPDATER WIN] STARTUP_GATE_FAILED | error=${erro?.message || erro}`,
      );
      iniciarAplicacaoNormal();
    });
} else {
  iniciarAplicacaoNormal();
}
