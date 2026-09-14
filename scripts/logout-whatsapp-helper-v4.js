"use strict";

const fs = require("fs");
const path = require("path");

const USER_DATA = String(process.env.WHATSIAPP_LOGOUT_USER_DATA || "");
const PARENT_PID = Number(process.env.WHATSIAPP_LOGOUT_PARENT_PID || 0);
const AUTH_DIR = path.join(USER_DATA, "baileys-auth");
const SNAPSHOT_DIR = path.join(USER_DATA, "baileys-auth-logout-snapshot");
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

function lerRegistered(diretorio) {
  try {
    const arquivo = path.join(diretorio, "creds.json");
    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    return dados?.registered === true;
  } catch {
    return false;
  }
}

async function criarSnapshotBaileys() {
  if (!fs.existsSync(AUTH_DIR)) {
    log("[SESSION LOGOUT] BAILEYS_SNAPSHOT_NO_AUTH_DIR");
    return false;
  }

  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    try {
      fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
      fs.cpSync(AUTH_DIR, SNAPSHOT_DIR, { recursive: true });

      const registered = lerRegistered(SNAPSHOT_DIR);
      log(
        `[SESSION LOGOUT] BAILEYS_SNAPSHOT | try=${tentativa} | registered=${registered}`,
      );

      if (registered) return true;
    } catch (erro) {
      log(
        `[SESSION LOGOUT] BAILEYS_SNAPSHOT_FAILED | try=${tentativa} | error=${erro?.message || erro}`,
      );
    }

    await esperar(250);
  }

  return fs.existsSync(SNAPSHOT_DIR);
}

async function aguardarAplicacaoFechar() {
  const inicio = Date.now();
  while (processoExiste(PARENT_PID) && Date.now() - inicio < 45000) {
    await esperar(150);
  }

  if (processoExiste(PARENT_PID)) {
    throw new Error("app close timeout before Baileys snapshot restore");
  }

  await esperar(400);
}

function restaurarSnapshotBaileys() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    log("[SESSION LOGOUT] BAILEYS_SNAPSHOT_NOT_AVAILABLE");
    return false;
  }

  try {
    const registered = lerRegistered(SNAPSHOT_DIR);
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.renameSync(SNAPSHOT_DIR, AUTH_DIR);
    log(
      `[SESSION LOGOUT] BAILEYS_SNAPSHOT_RESTORED | registered=${registered}`,
    );
    return true;
  } catch (erro) {
    log(
      `[SESSION LOGOUT] BAILEYS_SNAPSHOT_RESTORE_FAILED | error=${erro?.message || erro}`,
    );
    return false;
  }
}

async function main() {
  log(`[SESSION LOGOUT] START_V4_WRAPPER | parent=${PARENT_PID}`);

  await criarSnapshotBaileys();

  try {
    await aguardarAplicacaoFechar();
    restaurarSnapshotBaileys();
  } catch (erro) {
    log(`[SESSION LOGOUT] V4_WRAPPER_WAIT_FAILED | error=${erro?.message || erro}`);
  }

  require("./logout-whatsapp-helper-v2");
}

main().catch((erro) => {
  log(`[SESSION LOGOUT] V4_WRAPPER_FATAL | error=${erro?.stack || erro?.message || erro}`);
  require("./logout-whatsapp-helper-v2");
});
