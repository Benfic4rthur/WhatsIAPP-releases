"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const USER_DATA = String(process.env.WHATSIAPP_LOGOUT_USER_DATA || "");
const APP_PATH = String(process.env.WHATSIAPP_LOGOUT_APP_PATH || "");
const RESOURCES_PATH = String(process.env.WHATSIAPP_LOGOUT_RESOURCES_PATH || "");
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

function comTimeout(promessa, timeoutMs, mensagem) {
  return Promise.race([
    Promise.resolve(promessa),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(mensagem || "timeout")), timeoutMs),
    ),
  ]);
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
    await esperar(250);
  }
  if (processoExiste(PARENT_PID)) {
    throw new Error("app close timeout");
  }
  await esperar(700);
}

function removerDiretorioSeguro(diretorio) {
  if (!diretorio || !USER_DATA) return;
  const base = path.resolve(USER_DATA);
  const alvo = path.resolve(diretorio);
  if (!alvo.startsWith(`${base}${path.sep}`)) {
    throw new Error(`unsafe session path: ${alvo}`);
  }
  fs.rmSync(alvo, { recursive: true, force: true });
}

function erroNavegacaoWpp(erro) {
  const texto = String(erro?.message || erro || "").toLowerCase();
  return (
    texto.includes("execution context was destroyed") ||
    texto.includes("most likely because of a navigation") ||
    texto.includes("cannot find context with specified id") ||
    texto.includes("inspected target navigated or closed")
  );
}

function statusDesconexaoBaileys(erro) {
  return Number(
    erro?.output?.statusCode ??
      erro?.data?.statusCode ??
      erro?.statusCode ??
      erro?.status ??
      0,
  );
}

async function logoutBaileys() {
  const authDir = path.join(USER_DATA, "baileys-auth");
  if (!fs.existsSync(authDir)) {
    log("[SESSION LOGOUT] BAILEYS_NO_LOCAL_SESSION");
    return { ok: true, ausente: true };
  }

  let sock = null;
  try {
    const baileys = await import("@whiskeysockets/baileys");
    const pino = require("pino");
    const makeWASocket =
      typeof baileys.default === "function"
        ? baileys.default
        : baileys.makeWASocket || baileys.default?.default;
    const { useMultiFileAuthState, Browsers, DisconnectReason } = baileys;

    if (typeof makeWASocket !== "function") {
      throw new Error("makeWASocket unavailable");
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    if (!state?.creds?.registered) {
      removerDiretorioSeguro(authDir);
      log("[SESSION LOGOUT] BAILEYS_ALREADY_UNLINKED");
      return { ok: true, jaDesconectada: true };
    }

    const estado = await comTimeout(
      new Promise((resolve, reject) => {
        let finalizado = false;
        const concluir = (valor) => {
          if (finalizado) return;
          finalizado = true;
          resolve(valor);
        };
        try {
          sock = makeWASocket({
            auth: state,
            logger: pino({ level: "silent" }),
            browser: Browsers.ubuntu("Chrome"),
            syncFullHistory: false,
            fireInitQueries: false,
            markOnlineOnConnect: false,
          });
          sock.ev.on("creds.update", saveCreds);
          sock.ev.on("connection.update", (update) => {
            if (update?.connection === "open") return concluir({ tipo: "open" });
            if (update?.qr) return concluir({ tipo: "qr" });
            if (update?.connection === "close") {
              const status = statusDesconexaoBaileys(update?.lastDisconnect?.error);
              const loggedOut =
                status === 401 || status === Number(DisconnectReason?.loggedOut);
              concluir({ tipo: loggedOut ? "logged-out" : "close", status });
            }
          });
        } catch (erro) {
          reject(erro);
        }
      }),
      25000,
      "Baileys connection timeout",
    );

    if (estado?.tipo === "open") {
      await comTimeout(sock.logout(), 20000, "Baileys logout timeout");
      log("[SESSION LOGOUT] BAILEYS_REMOTE_LOGOUT_OK");
    } else if (["qr", "logged-out"].includes(estado?.tipo)) {
      log(`[SESSION LOGOUT] BAILEYS_ALREADY_UNLINKED | state=${estado.tipo}`);
    } else {
      throw new Error(`Baileys unavailable for logout (${estado?.status || 0})`);
    }

    try {
      sock?.end?.();
    } catch {}
    removerDiretorioSeguro(authDir);
    return { ok: true };
  } catch (erro) {
    try {
      sock?.end?.();
    } catch {}
    log(`[SESSION LOGOUT] BAILEYS_FAILED | error=${erro?.message || erro}`);
    return { ok: false, erro: `Baileys: ${erro?.message || erro || "logout failed"}` };
  }
}

function caminhoChromeEmpacotado() {
  if (!RESOURCES_PATH) return null;
  try {
    const recursos = require("./recursos-desktop");
    const caminho = recursos.caminhoChrome(RESOURCES_PATH);
    return caminho && fs.existsSync(caminho) ? caminho : null;
  } catch {
    return null;
  }
}

async function consultarAutenticacaoWpp(client, tentativas = 1) {
  let ultimoErro = null;
  for (let i = 0; i < tentativas; i++) {
    try {
      return { ok: true, autenticada: !!(await client.isAuthenticated()) };
    } catch (erro) {
      ultimoErro = erro;
      if (!erroNavegacaoWpp(erro)) throw erro;
      log(`[SESSION LOGOUT] WPPCONNECT_NAVIGATION_RETRY | step=auth | try=${i + 1}`);
      await esperar(800);
    }
  }
  return { ok: false, erro: ultimoErro };
}

async function confirmarLogoutWpp(client, estado) {
  for (let i = 0; i < 12; i++) {
    if (
      estado.qrGerado ||
      ["notlogged", "disconnectedmobile", "deletetoken"].includes(estado.status)
    ) {
      return true;
    }

    try {
      const autenticada = !!(await client.isAuthenticated());
      if (!autenticada) return true;
    } catch (erro) {
      if (!erroNavegacaoWpp(erro)) throw erro;
    }
    await esperar(750);
  }
  return false;
}

async function logoutWppConnect() {
  const tokensDir = path.join(USER_DATA, "wppconnect-tokens");
  const profileDir = path.join(USER_DATA, "wppconnect-profile");

  if (!fs.existsSync(tokensDir) && !fs.existsSync(profileDir)) {
    log("[SESSION LOGOUT] WPPCONNECT_NO_LOCAL_SESSION");
    return { ok: true, ausente: true };
  }

  let client = null;
  const estado = { qrGerado: false, status: "" };

  try {
    const wppconnect = require("@wppconnect-team/wppconnect");
    const tokenStore = new wppconnect.tokenStore.FileTokenStore({ path: tokensDir });
    const chrome = caminhoChromeEmpacotado();

    client = await comTimeout(
      wppconnect.create({
        session: "whatsiapp-arquivo",
        tokenStore,
        headless: true,
        logQR: false,
        autoClose: 60000,
        waitForLogin: false,
        deviceSyncTimeout: 0,
        useChrome: false,
        debug: false,
        devtools: false,
        updatesLog: false,
        disableWelcome: true,
        disableGoogleAnalytics: true,
        deviceName: "WhatsIAPP Arquivadas",
        puppeteerOptions: {
          userDataDir: profileDir,
          ...(chrome ? { executablePath: chrome } : {}),
        },
        browserArgs: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        catchQR: () => {
          estado.qrGerado = true;
        },
        statusFind: (status) => {
          estado.status = String(status || "").toLowerCase();
        },
      }),
      70000,
      "WPPConnect create timeout",
    );

    let autenticada = false;
    const inicio = Date.now();
    while (Date.now() - inicio < 45000) {
      if (
        estado.qrGerado ||
        ["notlogged", "disconnectedmobile", "deletetoken"].includes(estado.status)
      ) {
        break;
      }

      const consulta = await consultarAutenticacaoWpp(client, 1);
      if (consulta.ok && consulta.autenticada) {
        autenticada = true;
        break;
      }
      await esperar(700);
    }

    if (!autenticada) {
      const jaDesconectada =
        estado.qrGerado ||
        ["notlogged", "disconnectedmobile", "deletetoken"].includes(estado.status);
      if (!jaDesconectada) {
        throw new Error("WPPConnect authentication state timeout");
      }
      log(`[SESSION LOGOUT] WPPCONNECT_ALREADY_UNLINKED | status=${estado.status || "qr"}`);
    } else {
      // WPPConnect costuma navegar imediatamente depois do logout. Nessa troca
      // de pagina o Puppeteer pode destruir o execution context mesmo quando o
      // WhatsApp ja aceitou a revogacao. Por isso confirmamos o estado depois.
      await esperar(1000);
      let logoutConfirmado = false;
      let ultimoErro = null;

      for (let tentativa = 1; tentativa <= 3 && !logoutConfirmado; tentativa++) {
        try {
          await comTimeout(client.logout(), 20000, "WPPConnect logout timeout");
          logoutConfirmado = true;
          log(`[SESSION LOGOUT] WPPCONNECT_LOGOUT_CALL_OK | try=${tentativa}`);
        } catch (erro) {
          ultimoErro = erro;
          if (!erroNavegacaoWpp(erro)) throw erro;
          log(`[SESSION LOGOUT] WPPCONNECT_NAVIGATION_DURING_LOGOUT | try=${tentativa}`);
          await esperar(900);
          logoutConfirmado = await confirmarLogoutWpp(client, estado);
          if (!logoutConfirmado) await esperar(900);
        }
      }

      if (!logoutConfirmado) {
        throw ultimoErro || new Error("WPPConnect logout not confirmed");
      }

      // Mesmo se logout() resolveu normalmente, esperamos a navegacao concluir
      // para nao fechar o Chromium antes de o servidor registrar a sessao.
      await esperar(1200);
      log("[SESSION LOGOUT] WPPCONNECT_REMOTE_LOGOUT_OK");
    }

    try {
      await client.close();
    } catch {}

    removerDiretorioSeguro(tokensDir);
    removerDiretorioSeguro(profileDir);
    fs.mkdirSync(profileDir, { recursive: true });
    return { ok: true };
  } catch (erro) {
    try {
      await client?.close?.();
    } catch {}
    log(`[SESSION LOGOUT] WPPCONNECT_FAILED | error=${erro?.message || erro}`);
    return {
      ok: false,
      erro: `WPPConnect: ${erro?.message || erro || "logout failed"}`,
    };
  }
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
  delete env.WHATSIAPP_LOGOUT_RESOURCES_PATH;
  delete env.WHATSIAPP_LOGOUT_EXEC_PATH;
  delete env.WHATSIAPP_LOGOUT_PACKAGED;
  delete env.WHATSIAPP_LOGOUT_PARENT_PID;

  const args = PACKAGED ? [] : [APP_PATH];
  try {
    const filho = spawn(EXEC_PATH, args, {
      detached: true,
      stdio: "ignore",
      env,
      windowsHide: true,
    });
    filho.unref();
    log(`[SESSION LOGOUT] APP_RELAUNCH_OK | pid=${filho.pid || 0}`);
  } catch (erro) {
    log(`[SESSION LOGOUT] APP_RELAUNCH_FAILED | error=${erro?.message || erro}`);
  }
}

async function main() {
  if (!USER_DATA || !APP_PATH || !EXEC_PATH || !PARENT_PID) {
    log("[SESSION LOGOUT] INVALID_ENV");
    process.exitCode = 2;
    return;
  }

  log(`[SESSION LOGOUT] START_V2 | parent=${PARENT_PID}`);
  try {
    await aguardarAplicacaoFechar();
  } catch (erro) {
    const resultado = {
      ok: false,
      concluidoEm: new Date().toISOString(),
      erro: String(erro?.message || erro),
      baileys: { ok: false, erro: "Aplicativo anterior ainda esta aberto." },
      wpp: { ok: false, erro: "Aplicativo anterior ainda esta aberto." },
    };
    gravarResultado(resultado);
    relancarAplicacao();
    process.exitCode = 3;
    return;
  }

  const baileys = await logoutBaileys();
  const wpp = await logoutWppConnect();
  const resultado = {
    ok: !!baileys?.ok && !!wpp?.ok,
    concluidoEm: new Date().toISOString(),
    baileys,
    wpp,
  };

  gravarResultado(resultado);
  log(`[SESSION LOGOUT] FINISH_V2 | ok=${resultado.ok} | baileys=${!!baileys?.ok} | wpp=${!!wpp?.ok}`);
  await esperar(700);
  relancarAplicacao();
}

main().catch((erro) => {
  log(`[SESSION LOGOUT] FATAL_V2 | error=${erro?.stack || erro?.message || erro}`);
  gravarResultado({
    ok: false,
    concluidoEm: new Date().toISOString(),
    erro: String(erro?.message || erro || "fatal logout error"),
  });
  relancarAplicacao();
  process.exitCode = 1;
});
