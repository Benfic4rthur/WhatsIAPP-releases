"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const {
  MAC_APP_TARGET,
  compararVersoes,
  ehVersaoSuperior,
  validarUpdateWindows,
  selecionarAssetMacArm64,
  selecionarLatestMacYml,
  extrairMetadadosLatestMac,
  urlGitHubPermitida,
  validarCaminhoDmg,
  validarCaminhoAplicacaoMac,
  normalizarEstadoPendente,
  criarScriptQuarentenaTemporario,
} = require("./updater-core");

const GITHUB_OWNER = "Benfic4rthur";
const GITHUB_REPO = "WhatsIAPP-releases";
const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const ARQUIVO_ESTADO = "desktop-updater-state-v1.json";
const TEMPO_CHECK_INICIAL_MS = 5000;
const TEMPO_GATE_PENDENTE_MS = 25000;

function criarDesktopUpdater() {
  let ipcRegistrado = false;
  let listenersWindowsRegistrados = false;
  let fluxoNormalIniciado = false;
  let gatePendenteAtivo = false;
  let resolverGatePendente = null;
  let timerGatePendente = null;
  let ultimoDecilWindows = -1;
  let ultimoDecilMac = -1;
  let dmgMacAtual = null;
  let versaoMacAtual = null;
  let estado = {
    etapa: "sem-update",
    plataforma: process.platform,
    arquitetura: process.arch,
    versaoAtual: app.getVersion(),
  };

  function pastaLogs() {
    return path.join(app.getPath("userData"), "logs");
  }

  function arquivoLog() {
    return path.join(pastaLogs(), "desktop-updater.log");
  }

  function log(mensagem, nivel = "log") {
    const linha = `${new Date().toISOString()} ${String(mensagem || "")}`;
    try {
      fs.mkdirSync(pastaLogs(), { recursive: true });
      fs.appendFileSync(arquivoLog(), `${linha}\n`, "utf8");
    } catch {}
    const fn = console[nivel] || console.log;
    fn.call(console, mensagem);
  }

  function caminhoEstadoPersistente() {
    return path.join(app.getPath("userData"), ARQUIVO_ESTADO);
  }

  function carregarEstadoPersistente() {
    try {
      const arquivo = caminhoEstadoPersistente();
      if (!fs.existsSync(arquivo)) return { versao: 1 };
      const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
      return dados && typeof dados === "object" ? dados : { versao: 1 };
    } catch (erro) {
      log(`[UPDATER] STATE_READ_FAILED | error=${erro?.message || erro}`, "warn");
      return { versao: 1 };
    }
  }

  function salvarEstadoPersistente(alteracoes = {}) {
    try {
      const atual = carregarEstadoPersistente();
      const proximo = { ...atual, ...alteracoes, versao: 1, atualizadoEm: Date.now() };
      const arquivo = caminhoEstadoPersistente();
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      const tmp = `${arquivo}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(proximo, null, 2), "utf8");
      fs.renameSync(tmp, arquivo);
      return true;
    } catch (erro) {
      log(`[UPDATER] STATE_WRITE_FAILED | error=${erro?.message || erro}`, "warn");
      return false;
    }
  }

  function confirmarVersaoInstaladaSeNecessario() {
    const persistido = carregarEstadoPersistente();
    const atual = app.getVersion();
    const alteracoes = {};
    let mudou = false;

    const win = persistido.windowsPending;
    if (win?.versao && compararVersoes(atual, win.versao) !== -1) {
      log(`[UPDATER WIN] INSTALLED_CONFIRMED | version=${atual}`);
      alteracoes.windowsPending = null;
      mudou = true;
    }

    const mac = persistido.macPending;
    if (mac?.versao && compararVersoes(atual, mac.versao) !== -1) {
      log(`[UPDATER MAC] INSTALLED_CONFIRMED | version=${atual}`);
      alteracoes.macPending = null;
      mudou = true;
    }

    if (mudou) salvarEstadoPersistente(alteracoes);
  }

  function enviarEstado(parcial = {}) {
    estado = {
      ...estado,
      ...parcial,
      plataforma: process.platform,
      arquitetura: process.arch,
      versaoAtual: app.getVersion(),
    };
    for (const janela of BrowserWindow.getAllWindows()) {
      if (!janela.isDestroyed()) {
        try {
          janela.webContents.send("desktop-updater:estado", estado);
        } catch {}
      }
    }
    return estado;
  }

  function estadoPublico() {
    return { ...estado };
  }

  function registrarIpc() {
    if (ipcRegistrado) return;
    ipcRegistrado = true;

    ipcMain.handle("desktop-updater:estado", async () => estadoPublico());

    ipcMain.handle("desktop-updater:instalar-agora", async () => {
      if (process.platform !== "win32" || estado.etapa !== "pronto") {
        return { ok: false, erro: "Atualizacao do Windows ainda nao esta pronta." };
      }
      log(`[UPDATER WIN] INSTALL_START | version=${estado.versao || "unknown"}`);
      enviarEstado({ etapa: "instalando" });
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(true, true);
        } catch (erro) {
          log(`[UPDATER WIN] INSTALL_FAILED | error=${erro?.message || erro}`, "error");
          enviarEstado({ etapa: "erro", erro: "Nao foi possivel iniciar a instalacao." });
        }
      }, 250);
      return { ok: true };
    });

    ipcMain.handle("desktop-updater:adiar", async () => {
      if (process.platform !== "win32") return { ok: false };
      const persistido = carregarEstadoPersistente();
      if (persistido.windowsPending) {
        salvarEstadoPersistente({
          windowsPending: { ...persistido.windowsPending, adiado: true, adiadoEm: Date.now() },
        });
      }
      log(`[UPDATER WIN] DEFERRED | version=${estado.versao || "unknown"}`);
      enviarEstado({ etapa: "adiado" });
      return { ok: true };
    });

    ipcMain.handle("desktop-updater:mac-abrir-dmg", async () => abrirDmgMac());
    ipcMain.handle("desktop-updater:mac-fechar-continuar", async () => prepararFechamentoMac());
  }

  function configurarWindows() {
    if (process.platform !== "win32" || listenersWindowsRegistrados) return;
    listenersWindowsRegistrados = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on("checking-for-update", () => {
      log(`[UPDATER WIN] CHECK_START | current=${app.getVersion()}`);
      enviarEstado({ etapa: "verificando", erro: null });
    });

    autoUpdater.on("update-available", (info) => {
      const validacao = validarUpdateWindows(info, app.getVersion());
      if (!validacao.ok) {
        log(`[UPDATER WIN] UPDATE_REJECTED | reason=${validacao.motivo}`, "warn");
        enviarEstado({ etapa: "sem-update" });
        resolverGate(false);
        return;
      }
      log(`[UPDATER WIN] UPDATE_FOUND | version=${validacao.versao}`);
      enviarEstado({ etapa: "encontrado", versao: validacao.versao, percentual: 0 });
      log(`[UPDATER WIN] DOWNLOAD_START | version=${validacao.versao}`);
      autoUpdater.downloadUpdate().catch((erro) => {
        log(`[UPDATER WIN] DOWNLOAD_FAILED | error=${erro?.message || erro}`, "warn");
        enviarEstado({ etapa: "erro", erro: null });
        resolverGate(false);
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      const versao = String(info?.version || app.getVersion());
      log(`[UPDATER WIN] NO_UPDATE | latest=${versao}`);
      enviarEstado({ etapa: "sem-update", versao: null, percentual: null, erro: null });
      resolverGate(false);
    });

    autoUpdater.on("download-progress", (progresso) => {
      const percentual = Math.max(0, Math.min(100, Number(progresso?.percent || 0)));
      const decil = Math.floor(percentual / 10);
      if (decil !== ultimoDecilWindows) {
        ultimoDecilWindows = decil;
        log(`[UPDATER WIN] DOWNLOAD_PROGRESS | percent=${percentual.toFixed(1)}`);
      }
      enviarEstado({ etapa: "baixando", percentual });
    });

    autoUpdater.on("update-downloaded", (info) => {
      const versao = String(info?.version || "").replace(/^v/i, "");
      const arquivo = String(info?.downloadedFile || "");
      if (!ehVersaoSuperior(versao, app.getVersion())) {
        log(`[UPDATER WIN] DOWNLOADED_REJECTED | version=${versao || "invalid"}`, "warn");
        resolverGate(false);
        return;
      }
      salvarEstadoPersistente({
        windowsPending: {
          versao,
          arquivo,
          baixadoEm: Date.now(),
          adiado: false,
        },
      });
      log(`[UPDATER WIN] DOWNLOAD_DONE | version=${versao} | file=${path.basename(arquivo) || "cache"}`);
      log(`[UPDATER WIN] PENDING_SAVED | version=${versao}`);
      enviarEstado({ etapa: "pronto", versao, percentual: 100, erro: null });

      if (gatePendenteAtivo) {
        log(`[UPDATER WIN] PENDING_INSTALL_START | version=${versao}`);
        enviarEstado({ etapa: "instalando" });
        try {
          autoUpdater.quitAndInstall(true, true);
          resolverGate(true);
        } catch (erro) {
          log(`[UPDATER WIN] PENDING_INSTALL_FAILED | error=${erro?.message || erro}`, "error");
          resolverGate(false);
        }
      }
    });

    autoUpdater.on("error", (erro) => {
      log(`[UPDATER WIN] ERROR | error=${erro?.message || erro}`, "warn");
      enviarEstado({ etapa: "erro", erro: null });
      resolverGate(false);
    });
  }

  function resolverGate(instalando) {
    if (!resolverGatePendente) return;
    const resolver = resolverGatePendente;
    resolverGatePendente = null;
    gatePendenteAtivo = false;
    if (timerGatePendente) {
      clearTimeout(timerGatePendente);
      timerGatePendente = null;
    }
    resolver(!!instalando);
  }

  function deveInstalarPendenteAntesDeIniciar() {
    if (!app.isPackaged || process.platform !== "win32") return false;
    const persistido = carregarEstadoPersistente();
    const pendente = normalizarEstadoPendente(persistido.windowsPending, app.getVersion());
    return !!pendente;
  }

  async function instalarPendenteAntesDaInicializacao() {
    if (!deveInstalarPendenteAntesDeIniciar()) return false;
    configurarWindows();
    gatePendenteAtivo = true;
    log(`[UPDATER WIN] PENDING_DETECTED_AT_STARTUP | current=${app.getVersion()}`);

    return new Promise((resolve) => {
      resolverGatePendente = resolve;
      timerGatePendente = setTimeout(() => {
        log("[UPDATER WIN] PENDING_GATE_TIMEOUT | starting current version", "warn");
        resolverGate(false);
      }, TEMPO_GATE_PENDENTE_MS);

      app.whenReady().then(() => {
        autoUpdater.checkForUpdates().catch((erro) => {
          log(`[UPDATER WIN] PENDING_CHECK_FAILED | error=${erro?.message || erro}`, "warn");
          resolverGate(false);
        });
      });
    });
  }

  function requisicaoHttps(urlInicial, opcoes = {}, redirecionamentos = 0) {
    return new Promise((resolve, reject) => {
      if (!urlGitHubPermitida(urlInicial)) {
        reject(new Error("URL de update fora dos hosts permitidos."));
        return;
      }
      const url = new URL(urlInicial);
      const req = https.get(
        url,
        {
          headers: {
            "User-Agent": `WhatsIAPP/${app.getVersion()}`,
            Accept: opcoes.accept || "application/vnd.github+json",
          },
          timeout: opcoes.timeout || 15000,
        },
        (res) => {
          const status = Number(res.statusCode || 0);
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            if (redirecionamentos >= 6) {
              reject(new Error("Redirecionamentos demais durante o update."));
              return;
            }
            const destino = new URL(res.headers.location, url).toString();
            requisicaoHttps(destino, opcoes, redirecionamentos + 1).then(resolve, reject);
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            reject(new Error(`HTTP ${status} ao consultar update.`));
            return;
          }
          resolve(res);
        },
      );
      req.on("timeout", () => req.destroy(new Error("Timeout de rede do updater.")));
      req.on("error", reject);
    });
  }

  async function baixarBuffer(url, accept = "application/octet-stream") {
    const res = await requisicaoHttps(url, { accept });
    const partes = [];
    let total = 0;
    for await (const chunk of res) {
      total += chunk.length;
      if (total > 8 * 1024 * 1024) throw new Error("Resposta de metadados grande demais.");
      partes.push(chunk);
    }
    return Buffer.concat(partes);
  }

  async function validarDmgExistente(arquivo, metadados) {
    try {
      const stat = await fs.promises.stat(arquivo);
      if (!stat.isFile() || stat.size <= 0) return false;
      if (metadados.size && stat.size !== metadados.size) return false;
      const sha512 = crypto.createHash("sha512");
      const sha256 = crypto.createHash("sha256");
      for await (const chunk of fs.createReadStream(arquivo)) {
        sha512.update(chunk);
        sha256.update(chunk);
      }
      if (metadados.sha512 && sha512.digest("base64") !== metadados.sha512) return false;
      if (metadados.sha256 && sha256.digest("hex") !== metadados.sha256) return false;
      return true;
    } catch {
      return false;
    }
  }

  async function baixarDmgSeguro(url, destino, metadados) {
    const nome = path.basename(destino);
    const pasta = path.dirname(destino);
    if (!validarCaminhoDmg(destino, pasta, nome)) throw new Error("Caminho de DMG invalido.");
    await fs.promises.mkdir(pasta, { recursive: true });
    const parcial = `${destino}.part`;
    await fs.promises.rm(parcial, { force: true }).catch(() => {});

    const res = await requisicaoHttps(url, { accept: "application/x-apple-diskimage", timeout: 30000 });
    const totalCabecalho = Number(res.headers["content-length"] || 0) || 0;
    const sha512 = crypto.createHash("sha512");
    const sha256 = crypto.createHash("sha256");
    let transferido = 0;
    ultimoDecilMac = -1;

    const medidor = new Transform({
      transform(chunk, _enc, callback) {
        transferido += chunk.length;
        sha512.update(chunk);
        sha256.update(chunk);
        const total = metadados.size || totalCabecalho;
        const percentual = total > 0 ? Math.min(100, (transferido / total) * 100) : 0;
        const decil = Math.floor(percentual / 10);
        if (decil !== ultimoDecilMac) {
          ultimoDecilMac = decil;
          log(`[UPDATER MAC] DOWNLOAD_PROGRESS | percent=${percentual.toFixed(1)}`);
        }
        enviarEstado({ etapa: "baixando", percentual, versao: versaoMacAtual });
        callback(null, chunk);
      },
    });

    try {
      await pipeline(res, medidor, fs.createWriteStream(parcial, { flags: "w", mode: 0o600 }));
      const stat = await fs.promises.stat(parcial);
      if (metadados.size && stat.size !== metadados.size) throw new Error("Tamanho do DMG nao confere.");
      if (metadados.sha512 && sha512.digest("base64") !== metadados.sha512) {
        throw new Error("SHA512 do DMG nao confere.");
      }
      if (metadados.sha256 && sha256.digest("hex") !== metadados.sha256) {
        throw new Error("SHA256 do DMG nao confere.");
      }
      await fs.promises.rm(destino, { force: true }).catch(() => {});
      await fs.promises.rename(parcial, destino);
      return destino;
    } catch (erro) {
      await fs.promises.rm(parcial, { force: true }).catch(() => {});
      throw erro;
    }
  }

  async function verificarMac() {
    if (!app.isPackaged || process.platform !== "darwin" || process.arch !== "arm64") return;
    try {
      log(`[UPDATER MAC] CHECK_START | current=${app.getVersion()}`);
      enviarEstado({ etapa: "verificando", erro: null });
      const release = JSON.parse((await baixarBuffer(GITHUB_LATEST_API, "application/vnd.github+json")).toString("utf8"));
      if (release?.draft || release?.prerelease) {
        log("[UPDATER MAC] RELEASE_REJECTED | draft_or_prerelease=true", "warn");
        enviarEstado({ etapa: "sem-update" });
        return;
      }
      const versao = String(release?.tag_name || "").replace(/^v/i, "");
      if (!ehVersaoSuperior(versao, app.getVersion())) {
        log(`[UPDATER MAC] NO_UPDATE | latest=${versao || "unknown"}`);
        enviarEstado({ etapa: "sem-update", versao: null, erro: null });
        return;
      }
      const assets = Array.isArray(release?.assets) ? release.assets : [];
      const dmg = selecionarAssetMacArm64(assets, versao);
      const yml = selecionarLatestMacYml(assets);
      if (!dmg || !urlGitHubPermitida(dmg.browser_download_url)) {
        throw new Error("DMG ARM64 oficial nao encontrado na release.");
      }
      versaoMacAtual = versao;
      log(`[UPDATER MAC] UPDATE_FOUND | version=${versao} | asset=${dmg.name}`);
      enviarEstado({ etapa: "encontrado", versao, percentual: 0 });

      let metaYml = null;
      if (yml?.browser_download_url && urlGitHubPermitida(yml.browser_download_url)) {
        try {
          const textoYml = (await baixarBuffer(yml.browser_download_url, "text/yaml")).toString("utf8");
          metaYml = extrairMetadadosLatestMac(textoYml, dmg.name);
        } catch (erro) {
          log(`[UPDATER MAC] METADATA_YML_FAILED | error=${erro?.message || erro}`, "warn");
        }
      }
      const digest = String(dmg?.digest || "");
      const sha256 = digest.startsWith("sha256:") ? digest.slice(7).toLowerCase() : null;
      const metadados = {
        size: Number(metaYml?.size || dmg?.size || 0) || null,
        sha512: String(metaYml?.sha512 || "") || null,
        sha256,
      };
      const pasta = path.join(app.getPath("userData"), "updates", "macos");
      const destino = path.join(pasta, dmg.name);
      if (!validarCaminhoDmg(destino, pasta, dmg.name)) throw new Error("Destino do DMG rejeitado.");

      let valido = await validarDmgExistente(destino, metadados);
      if (!valido) {
        await fs.promises.rm(destino, { force: true }).catch(() => {});
        log(`[UPDATER MAC] DOWNLOAD_START | version=${versao}`);
        await baixarDmgSeguro(dmg.browser_download_url, destino, metadados);
        valido = await validarDmgExistente(destino, metadados);
      }
      if (!valido) throw new Error("DMG baixado nao passou pela validacao final.");

      dmgMacAtual = destino;
      salvarEstadoPersistente({
        macPending: { versao, dmg: destino, baixadoEm: Date.now() },
      });
      log(`[UPDATER MAC] DOWNLOAD_DONE | version=${versao} | asset=${dmg.name}`);
      enviarEstado({ etapa: "pronto", versao, percentual: 100, erro: null, dmgAberto: false });
    } catch (erro) {
      log(`[UPDATER MAC] ERROR | error=${erro?.message || erro}`, "warn");
      enviarEstado({ etapa: "sem-update", erro: null });
    }
  }

  async function abrirDmgMac() {
    if (process.platform !== "darwin" || estado.etapa !== "pronto" || !dmgMacAtual) {
      return { ok: false, erro: "A atualizacao ainda nao esta pronta." };
    }
    const pasta = path.dirname(dmgMacAtual);
    const nome = path.basename(dmgMacAtual);
    if (!validarCaminhoDmg(dmgMacAtual, pasta, nome) || !fs.existsSync(dmgMacAtual)) {
      log("[UPDATER MAC] DMG_OPEN_REJECTED | invalid_or_missing", "warn");
      return { ok: false, erro: "O instalador baixado nao foi encontrado. O download sera refeito na proxima verificacao." };
    }
    const erro = await shell.openPath(dmgMacAtual);
    if (erro) {
      log(`[UPDATER MAC] DMG_OPEN_FAILED | error=${erro}`, "warn");
      return { ok: false, erro: "Não foi possível abrir o instalador da atualização." };
    }
    log(`[UPDATER MAC] DMG_OPENED | file=${nome}`);
    enviarEstado({ dmgAberto: true });
    return { ok: true, versao: versaoMacAtual };
  }

  function criarHelperMacTemporario(versaoEsperada) {
    if (!validarCaminhoAplicacaoMac(MAC_APP_TARGET)) throw new Error("Destino da aplicacao Mac rejeitado.");
    const pasta = path.join(app.getPath("temp"), "whatsiapp-updater-helper");
    fs.mkdirSync(pasta, { recursive: true });
    const arquivo = path.join(pasta, `helper-${process.pid}-${Date.now()}.sh`);
    fs.writeFileSync(arquivo, criarScriptQuarentenaTemporario(), { encoding: "utf8", mode: 0o700 });
    const logHelper = path.join(pastaLogs(), "mac-updater-helper.log");
    fs.mkdirSync(path.dirname(logHelper), { recursive: true });
    return { arquivo, logHelper, versaoEsperada };
  }

  async function prepararFechamentoMac() {
    if (process.platform !== "darwin" || !estado.dmgAberto || !versaoMacAtual) {
      return { ok: false, erro: "Abra o instalador da atualização antes de fechar o WhatsIAPP." };
    }
    try {
      const helper = criarHelperMacTemporario(versaoMacAtual);
      const filho = spawn(
        "/bin/sh",
        [helper.arquivo, String(process.pid), helper.versaoEsperada, helper.logHelper],
        { detached: true, stdio: "ignore" },
      );
      filho.unref();
      log(`[UPDATER MAC] TEMP_QUARANTINE_HELPER_STARTED | pid=${filho.pid || 0} | target=${MAC_APP_TARGET}`);
      log(`[UPDATER MAC] CLOSE_FOR_REPLACEMENT | expected=${versaoMacAtual}`);
      enviarEstado({ etapa: "instalando" });
      setTimeout(() => app.quit(), 250);
      return { ok: true };
    } catch (erro) {
      log(`[UPDATER MAC] HELPER_START_FAILED | error=${erro?.message || erro}`, "error");
      return { ok: false, erro: "Não foi possível preparar a etapa final da atualização." };
    }
  }

  function iniciarFluxoNormal() {
    if (fluxoNormalIniciado) return;
    fluxoNormalIniciado = true;
    registrarIpc();
    confirmarVersaoInstaladaSeNecessario();
    log(`[UPDATER] APP_VERSION | version=${app.getVersion()} | platform=${process.platform} | arch=${process.arch}`);

    if (!app.isPackaged) {
      log("[UPDATER] SKIPPED | unpackaged=true");
      return;
    }

    app.whenReady().then(() => {
      setTimeout(() => {
        if (process.platform === "win32") {
          if (process.arch !== "x64") {
            log(`[UPDATER WIN] SKIPPED | unsupported_arch=${process.arch}`, "warn");
            return;
          }
          configurarWindows();
          autoUpdater.checkForUpdates().catch((erro) => {
            log(`[UPDATER WIN] CHECK_FAILED | error=${erro?.message || erro}`, "warn");
          });
          return;
        }
        if (process.platform === "darwin") {
          verificarMac();
        }
      }, TEMPO_CHECK_INICIAL_MS);
    });
  }

  return {
    registrarIpc,
    iniciarFluxoNormal,
    deveInstalarPendenteAntesDeIniciar,
    instalarPendenteAntesDaInicializacao,
  };
}

module.exports = { criarDesktopUpdater };
