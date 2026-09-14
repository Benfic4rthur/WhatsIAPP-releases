"use strict";

const { app, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const NOME_RESULTADO = "logout-whatsapp-result.json";
let logoutEmAndamento = false;
let ipcRegistrado = false;

function caminhoResultado() {
  return path.join(app.getPath("userData"), NOME_RESULTADO);
}

function lerResultadoLogout({ remover = true } = {}) {
  const arquivo = caminhoResultado();
  if (!fs.existsSync(arquivo)) {
    return { existe: false };
  }

  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    if (remover) {
      try {
        fs.rmSync(arquivo, { force: true });
      } catch {}
    }
    return {
      existe: true,
      ...(dados && typeof dados === "object" ? dados : {}),
    };
  } catch (erro) {
    return {
      existe: true,
      ok: false,
      erro: String(erro?.message || erro || "invalid logout result"),
    };
  }
}

function iniciarHelperLogout() {
  if (logoutEmAndamento) {
    return {
      ok: false,
      erro: "A desconexão das sessões já está em andamento.",
    };
  }

  const helper = path.join(
    app.getAppPath(),
    "scripts",
    "logout-whatsapp-helper-v2.js",
  );

  if (!fs.existsSync(helper)) {
    console.warn(`[SESSION LOGOUT] HELPER_NOT_FOUND | path=${helper}`);
    return {
      ok: false,
      erro: "O componente de desconexão não foi encontrado.",
    };
  }

  try {
    try {
      fs.rmSync(caminhoResultado(), { force: true });
    } catch {}

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      WHATSIAPP_LOGOUT_USER_DATA: app.getPath("userData"),
      WHATSIAPP_LOGOUT_APP_PATH: app.getAppPath(),
      WHATSIAPP_LOGOUT_RESOURCES_PATH: process.resourcesPath || "",
      WHATSIAPP_LOGOUT_EXEC_PATH: process.execPath,
      WHATSIAPP_LOGOUT_PACKAGED: app.isPackaged ? "1" : "0",
      WHATSIAPP_LOGOUT_PARENT_PID: String(process.pid),
    };

    const filho = spawn(process.execPath, [helper], {
      detached: true,
      stdio: "ignore",
      env,
      windowsHide: true,
    });

    filho.unref();
    logoutEmAndamento = true;

    console.log(
      `[SESSION LOGOUT] HELPER_STARTED | pid=${filho.pid || 0} | parent=${process.pid}`,
    );

    // O renderer precisa receber a confirmacao antes do fechamento. O fluxo
    // normal de before-quit do index.js encerra os workers de forma graciosa.
    setTimeout(() => {
      try {
        app.quit();
      } catch (erro) {
        console.warn(
          `[SESSION LOGOUT] APP_QUIT_FAILED | error=${erro?.message || erro}`,
        );
      }
    }, 450);

    return {
      ok: true,
      iniciado: true,
    };
  } catch (erro) {
    logoutEmAndamento = false;
    console.warn(
      `[SESSION LOGOUT] HELPER_START_FAILED | error=${erro?.message || erro}`,
    );
    return {
      ok: false,
      erro: "Não foi possível iniciar a desconexão das sessões.",
    };
  }
}

function registrarSessaoWhatsAppIpc() {
  if (ipcRegistrado) return;
  ipcRegistrado = true;

  ipcMain.handle("whatsiapp-logout-sessoes", async () => iniciarHelperLogout());
  ipcMain.handle("whatsiapp-logout-resultado", async () =>
    lerResultadoLogout({ remover: true }),
  );
}

module.exports = {
  registrarSessaoWhatsAppIpc,
  lerResultadoLogout,
};
