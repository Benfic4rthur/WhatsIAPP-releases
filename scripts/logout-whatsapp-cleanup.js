"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const USER_DATA = String(process.env.WHATSIAPP_LOGOUT_USER_DATA || "");
const APP_PATH = String(process.env.WHATSIAPP_LOGOUT_APP_PATH || "");
const EXEC_PATH = String(process.env.WHATSIAPP_LOGOUT_EXEC_PATH || process.execPath);
const PACKAGED = process.env.WHATSIAPP_LOGOUT_PACKAGED === "1";
const PARENT_PID = Number(process.env.WHATSIAPP_LOGOUT_PARENT_PID || 0);

const RESULT_FILE = path.join(USER_DATA, "logout-whatsapp-result.json");
const LOG_DIR = path.join(USER_DATA, "logs");
const LOG_FILE = path.join(LOG_DIR, "logout-whatsapp.log");

function log(texto) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(
      LOG_FILE,
      `${new Date().toISOString()} ${String(texto || "")}\n`,
      "utf8",
    );
  } catch {}
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processoExiste(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro?.code !== "ESRCH";
  }
}

async function aguardarAplicacaoFechar() {
  const inicio = Date.now();
  while (processoExiste(PARENT_PID) && Date.now() - inicio < 45000) {
    await esperar(200);
  }

  if (processoExiste(PARENT_PID)) {
    throw new Error("app close timeout");
  }

  // Da tempo para Chromium/WPPConnect e os workers liberarem os arquivos.
  await esperar(1800);
}

function caminhoSeguro(relativo) {
  const base = path.resolve(USER_DATA);
  const alvo = path.resolve(USER_DATA, relativo);
  if (!alvo.startsWith(`${base}${path.sep}`)) {
    throw new Error(`unsafe cleanup path: ${alvo}`);
  }
  return alvo;
}

async function removerComRetry(relativo) {
  const alvo = caminhoSeguro(relativo);
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= 10; tentativa++) {
    try {
      fs.rmSync(alvo, { recursive: true, force: true });
      log(
        `[SESSION LOGOUT] CLEANUP_REMOVED | target=${relativo} | try=${tentativa}`,
      );
      return true;
    } catch (erro) {
      ultimoErro = erro;
      log(
        `[SESSION LOGOUT] CLEANUP_RETRY | target=${relativo} | try=${tentativa} | error=${erro?.message || erro}`,
      );
      await esperar(500);
    }
  }

  throw ultimoErro || new Error(`cleanup failed: ${relativo}`);
}

function gravarResultado(resultado) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    const temporario = `${RESULT_FILE}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(resultado, null, 2), "utf8");
    fs.renameSync(temporario, RESULT_FILE);
  } catch (erro) {
    log(`[SESSION LOGOUT] RESULT_WRITE_FAILED | error=${erro?.message || erro}`);
  }
}

function relancarAplicacao() {
  if (!EXEC_PATH) return;

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WHATSIAPP_LOGOUT_USER_DATA;
  delete env.WHATSIAPP_LOGOUT_APP_PATH;
  delete env.WHATSIAPP_LOGOUT_EXEC_PATH;
  delete env.WHATSIAPP_LOGOUT_PACKAGED;
  delete env.WHATSIAPP_LOGOUT_PARENT_PID;

  const args = PACKAGED ? [] : [APP_PATH];

  try {
    const filho = spawn(EXEC_PATH, args, {
      detached: true,
      stdio: "ignore",
      env,
      // No Windows, windowsHide=true pode iniciar o Electron em estado oculto.
      // O helper continua sem console proprio, mas o app relancado precisa poder
      // criar e exibir a BrowserWindow normalmente.
      windowsHide: process.platform !== "win32",
    });
    filho.unref();
    log(
      `[SESSION LOGOUT] APP_RELAUNCH_OK | pid=${filho.pid || 0} | visible=${process.platform === "win32"}`,
    );
  } catch (erro) {
    log(`[SESSION LOGOUT] APP_RELAUNCH_FAILED | error=${erro?.message || erro}`);
  }
}

async function main() {
  if (!USER_DATA || !APP_PATH || !EXEC_PATH || !PARENT_PID) {
    throw new Error("invalid logout cleanup env");
  }

  log(`[SESSION LOGOUT] CLEANUP_V1_START | parent=${PARENT_PID}`);

  await aguardarAplicacaoFechar();

  await removerComRetry("baileys-auth");
  await removerComRetry("wppconnect-tokens");
  await removerComRetry("wppconnect-profile");

  const resultado = {
    ok: true,
    concluidoEm: new Date().toISOString(),
    baileys: { ok: true, live: true },
    wpp: { ok: true, live: true },
  };

  gravarResultado(resultado);
  log("[SESSION LOGOUT] CLEANUP_V1_FINISH | ok=true");
  await esperar(500);
  relancarAplicacao();
}

main().catch((erro) => {
  log(`[SESSION LOGOUT] CLEANUP_V1_FATAL | error=${erro?.stack || erro?.message || erro}`);
  gravarResultado({
    ok: false,
    concluidoEm: new Date().toISOString(),
    erro: String(erro?.message || erro || "logout cleanup failed"),
  });
  relancarAplicacao();
  process.exitCode = 1;
});
