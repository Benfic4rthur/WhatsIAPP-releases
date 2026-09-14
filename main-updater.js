"use strict";

const { app } = require("electron");
const pacote = require("./package.json");
const { criarDesktopUpdater } = require("./desktop-updater");
const { registrarSessaoWhatsAppIpc } = require("./sessao-whatsapp");

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
