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

function solicitarLogoutBaileysVivo(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const worker = global.__whatsiappWorkers?.baileys;

    if (!worker || typeof worker.postMessage !== "function") {
      resolve({
        ok: false,
        erro: "Baileys ativo não foi encontrado. Feche e abra o WhatsIAPP e tente novamente.",
      });
      return;
    }

    const id = `logout-baileys-vivo-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    let finalizado = false;

    const limpar = () => {
      clearTimeout(timer);
      worker.removeListener("message", aoReceberMensagem);
      worker.removeListener("exit", aoEncerrarWorker);
      worker.removeListener("error", aoErroWorker);
    };

    const concluir = (resultado) => {
      if (finalizado) return;
      finalizado = true;
      limpar();
      resolve(resultado);
    };

    const aoReceberMensagem = (mensagem) => {
      if (
        mensagem?.tipo === "resposta" &&
        mensagem?.id === id
      ) {
        concluir(
          mensagem?.resultado && typeof mensagem.resultado === "object"
            ? mensagem.resultado
            : { ok: false, erro: "Resposta inválida do Baileys." },
        );
      }
    };

    const aoEncerrarWorker = () =>
      concluir({
        ok: false,
        erro: "O worker Baileys encerrou antes de confirmar o logout remoto.",
      });

    const aoErroWorker = (erro) =>
      concluir({
        ok: false,
        erro: `Baileys: ${erro?.message || erro || "worker error"}`,
      });

    const timer = setTimeout(() => {
      concluir({
        ok: false,
        erro: "Tempo esgotado ao desconectar a sessão Baileys do WhatsApp.",
      });
    }, timeoutMs);

    worker.on("message", aoReceberMensagem);
    worker.once("exit", aoEncerrarWorker);
    worker.once("error", aoErroWorker);

    try {
      worker.postMessage({
        tipo: "solicitacao",
        id,
        acao: "logout-sessao-viva",
        dados: {},
      });
    } catch (erro) {
      concluir({
        ok: false,
        erro: `Baileys: ${erro?.message || erro || "postMessage failed"}`,
      });
    }
  });
}

async function iniciarHelperLogout() {
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

  logoutEmAndamento = true;

  try {
    try {
      fs.rmSync(caminhoResultado(), { force: true });
    } catch {}

    console.log("[SESSION LOGOUT] BAILEYS_LIVE_REQUEST");
    const baileysVivo = await solicitarLogoutBaileysVivo();

    if (!baileysVivo?.ok) {
      logoutEmAndamento = false;
      console.warn(
        `[SESSION LOGOUT] BAILEYS_LIVE_ABORT | error=${baileysVivo?.erro || "unknown"}`,
      );
      return {
        ok: false,
        erro:
          baileysVivo?.erro ||
          "Não foi possível desconectar a sessão principal do WhatsApp.",
      };
    }

    console.log("[SESSION LOGOUT] BAILEYS_LIVE_CONFIRMED");

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

    console.log(
      `[SESSION LOGOUT] HELPER_STARTED | pid=${filho.pid || 0} | parent=${process.pid}`,
    );

    // O Baileys ja confirmou o logout remoto usando o socket vivo. Agora o app
    // pode fechar normalmente e o helper conclui a sessao WPPConnect.
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
