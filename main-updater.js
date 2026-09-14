"use strict";

const { app } = require("electron");
const path = require("path");
const workerThreads = require("worker_threads");
const pacote = require("./package.json");
const { criarDesktopUpdater } = require("./desktop-updater");
const { registrarSessaoWhatsAppIpc } = require("./sessao-whatsapp");

// Roteia somente o worker Baileys por um wrapper pequeno que adiciona a acao
// de logout remoto usando o socket que ja esta autenticado e ativo. Isso evita
// recriar a sessao depois que o app fecha, quando as credenciais locais podem
// ja ter sido marcadas como desconectadas.
if (!global.__whatsiappWorkerRouteInstalled) {
  const WorkerOriginal = workerThreads.Worker;

  class WorkerRoteadoWhatsIAPP extends WorkerOriginal {
    constructor(filename, options) {
      const nome = path.basename(String(filename || ""));
      const ehBaileys = nome === "whatsapp-worker.js";
      const arquivoReal = ehBaileys
        ? path.join(__dirname, "whatsapp-worker-live-wrapper.js")
        : filename;

      super(arquivoReal, options);

      if (ehBaileys) {
        global.__whatsiappWorkers = global.__whatsiappWorkers || {};
        global.__whatsiappWorkers.baileys = this;

        this.once("exit", () => {
          if (global.__whatsiappWorkers?.baileys === this) {
            global.__whatsiappWorkers.baileys = null;
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
