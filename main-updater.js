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

// Roteia os dois workers por wrappers pequenos que adicionam logout remoto
// usando as sessoes que ja estao autenticadas e ativas. Isso evita recriar
// sessoes depois que o app fecha, quando credenciais locais podem mudar de
// estado ou o Chromium pode restaurar uma sessao antiga.
if (!global.__whatsiappWorkerRouteInstalled) {
  const WorkerOriginal = workerThreads.Worker;

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
