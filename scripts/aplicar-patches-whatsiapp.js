const fs = require("fs");
const path = require("path");

const raizProjeto = path.resolve(__dirname, "..");

function lerJson(caminho) {
  return JSON.parse(fs.readFileSync(caminho, "utf8"));
}

function contarOcorrencias(texto, trecho) {
  if (!trecho) {
    return 0;
  }

  return texto.split(trecho).length - 1;
}

function substituirUmaVez(texto, antigo, novo, nome) {
  const total = contarOcorrencias(texto, antigo);

  if (total !== 1) {
    throw new Error(
      `${nome}: esperado 1 trecho, encontrado ${total}.`,
    );
  }

  return texto.replace(antigo, novo);
}

function patchWppConnectBrowser() {
  const pastaPacote = path.join(
    raizProjeto,
    "node_modules",
    "@wppconnect-team",
    "wppconnect",
  );

  const packageJson = path.join(pastaPacote, "package.json");
  const alvo = path.join(
    pastaPacote,
    "dist",
    "controllers",
    "browser.js",
  );

  if (!fs.existsSync(packageJson) || !fs.existsSync(alvo)) {
    console.warn(
      "[WhatsIAPP patch] WPPConnect nao encontrado. Patch ignorado.",
    );
    return;
  }

  const versao = String(lerJson(packageJson).version || "");
  let texto = fs.readFileSync(alvo, "utf8");

  if (texto.includes("WPPConnect injectApi readiness:")) {
    console.log(
      `[WhatsIAPP patch] WPPConnect ${versao}: browser.js ja corrigido.`,
    );
    return;
  }

  if (versao !== "2.2.6") {
    console.warn(
      `[WhatsIAPP patch] WPPConnect ${versao}: versao diferente de 2.2.6. ` +
        "Patch automatico nao aplicado.",
    );
    return;
  }

  const antigo = `    // Make sure WAPI is initialized
    await page
        .waitForFunction(() => {
        return (typeof window.WAPI !== 'undefined' &&
            typeof window.Store !== 'undefined' &&
            window.WPP.isReady);
    })
        .catch(() => false);
`;

  const novo = `    // Make sure WAPI is initialized.
    // Puppeteer's waitForFunction was reaching its default 30s timeout
    // even when WA-JS had already marked WPP.isReady.
    // Keep the same 30s maximum wait, but poll the real page state directly.
    const readinessStartedAt = Date.now();
    let readinessOk = false;
    while (!readinessOk &&
        !page.isClosed() &&
        Date.now() - readinessStartedAt < 30000) {
        readinessOk = await page
            .evaluate(() => {
            return (typeof window.WAPI !== 'undefined' &&
                typeof window.WPP !== 'undefined' &&
                window.WPP.isReady === true);
        })
            .catch(() => false);
        if (!readinessOk) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    console.log(\`WPPConnect injectApi readiness: \${Date.now() - readinessStartedAt}ms, ok=\${readinessOk}\`);
`;

  texto = substituirUmaVez(
    texto,
    antigo,
    novo,
    "WPPConnect browser.js",
  );

  fs.writeFileSync(alvo, texto, "utf8");

  console.log(
    "[WhatsIAPP patch] WPPConnect 2.2.6: polling de readiness aplicado.",
  );
}

function patchWaJsDiagnostico() {
  const pastaPacote = path.join(
    raizProjeto,
    "node_modules",
    "@wppconnect",
    "wa-js",
  );

  const packageJson = path.join(pastaPacote, "package.json");
  const alvo = path.join(
    pastaPacote,
    "dist",
    "wppconnect-wa.js",
  );

  if (!fs.existsSync(packageJson) || !fs.existsSync(alvo)) {
    console.warn(
      "[WhatsIAPP patch] WA-JS nao encontrado. Diagnostico ignorado.",
    );
    return;
  }

  const versao = String(lerJson(packageJson).version || "");
  let texto = fs.readFileSync(alvo, "utf8");

  if (texto.includes("__WHATSIAPP_WAJS_DIAG")) {
    console.log(
      `[WhatsIAPP patch] WA-JS ${versao}: diagnostico ja aplicado.`,
    );
    return;
  }

  if (versao !== "4.6.0") {
    console.warn(
      `[WhatsIAPP patch] WA-JS ${versao}: versao diferente de 4.6.0. ` +
        "Diagnostico automatico nao aplicado.",
    );
    return;
  }

  texto = substituirUmaVez(
    texto,
    'const c=i.internalEv.waitFor("conn.main_init"),l=i.internalEv.waitFor("conn.main_ready");',
    'const c=i.internalEv.waitFor("conn.main_init"),l=i.internalEv.waitFor("conn.main_ready");' +
      'globalThis.__WHATSIAPP_WAJS_DIAG=globalThis.__WHATSIAPP_WAJS_DIAG||{bootAt:performance.now()},' +
      'c.then(()=>{globalThis.__WHATSIAPP_WAJS_DIAG.mainInitEventAt=performance.now()}).catch(()=>{}),' +
      'l.then(()=>{globalThis.__WHATSIAPP_WAJS_DIAG.mainReadyEventAt=performance.now()}).catch(()=>{});',
    "WA-JS main_init/main_ready",
  );

  texto = substituirUmaVez(
    texto,
    'await async function({quiet:e=750,timeout:r=2e4,poll:n=100}={}){',
    'globalThis.__WHATSIAPP_WAJS_DIAG.settleStart=performance.now(),' +
      'await async function({quiet:e=750,timeout:r=2e4,poll:n=100}={}){',
    "WA-JS settle start",
  );

  texto = substituirUmaVez(
    texto,
    'else if(t>0&&Date.now()-s>=e)return void u(`meta modules settled at ${t} (quiet ${e}ms)`)}',
    'else if(t>0&&Date.now()-s>=e)return ' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.settleResult="quiet",' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.settleCount=t,' +
      'void u(`meta modules settled at ${t} (quiet ${e}ms)`)}',
    "WA-JS settle quiet",
  );

  texto = substituirUmaVez(
    texto,
    'u(`meta modules settle timed out after ${r}ms (count ${a})`)}(),t.isInjected=!0',
    'globalThis.__WHATSIAPP_WAJS_DIAG.settleResult="timeout",' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.settleCount=a,' +
      'u(`meta modules settle timed out after ${r}ms (count ${a})`)}(),' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.settleEnd=performance.now(),t.isInjected=!0',
    "WA-JS settle timeout/end",
  );

  texto = substituirUmaVez(
    texto,
    'await i.internalEv.emitAsync("loader.injected").catch(()=>null),await c;await async function(e,{timeout:t=3e4',
    'await i.internalEv.emitAsync("loader.injected").catch(()=>null),' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.injectedAt=performance.now(),' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.mainInitAwaitStart=performance.now(),' +
      'await c,' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.mainInitAwaitEnd=performance.now();' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.coreStart=performance.now();' +
      'await async function(e,{timeout:t=3e4',
    "WA-JS main_init/core",
  );

  texto = substituirUmaVez(
    texto,
    '})||u("meta loader: core module not resolvable within 5s, continuing");t.isReady=!0,u("ready to use")',
    '})||u("meta loader: core module not resolvable within 5s, continuing");' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.coreEnd=performance.now(),' +
      't.isReady=!0,' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.readyAt=performance.now(),' +
      'u("ready to use")',
    "WA-JS core/isReady",
  );

  texto = substituirUmaVez(
    texto,
    'window.wppForceMainLoad?(u("wppForceMainLoad is set, waiting 5 seconds"),await new Promise(e=>setTimeout(e,5e3))):(u("waiting main ready"),await l);t.isFullReady=!0,u("full ready to use")',
    'window.wppForceMainLoad?(u("wppForceMainLoad is set, waiting 5 seconds"),await new Promise(e=>setTimeout(e,5e3))):(u("waiting main ready"),await l);' +
      't.isFullReady=!0,' +
      'globalThis.__WHATSIAPP_WAJS_DIAG.fullReadyAt=performance.now(),' +
      'u("full ready to use")',
    "WA-JS fullReady",
  );

  fs.writeFileSync(alvo, texto, "utf8");

  console.log(
    "[WhatsIAPP patch] WA-JS 4.6.0: diagnostico aplicado.",
  );
}


function patchWaJsUploadMidiaMainThread() {
  const pastaPacote = path.join(
    raizProjeto,
    "node_modules",
    "@wppconnect",
    "wa-js",
  );

  const packageJson = path.join(pastaPacote, "package.json");
  const alvo = path.join(
    pastaPacote,
    "dist",
    "wppconnect-wa.js",
  );

  if (!fs.existsSync(packageJson) || !fs.existsSync(alvo)) {
    console.warn(
      "[WhatsIAPP patch] WA-JS nao encontrado. Patch de upload ignorado.",
    );
    return;
  }

  const versao = String(lerJson(packageJson).version || "");
  let texto = fs.readFileSync(alvo, "utf8");

  const antigo =
    'return"web_unwrap_message_for_stanza_attributes"!==r&&e(...t)';
  const novo =
    'return"web_media_encrypt_upload_in_worker_enabled"===r?!1:"web_unwrap_message_for_stanza_attributes"!==r&&e(...t)';

  if (texto.includes(novo)) {
    console.log(
      `[WhatsIAPP patch] WA-JS ${versao}: upload de midia main-thread ja corrigido.`,
    );
    return;
  }

  if (versao !== "4.6.0") {
    console.warn(
      `[WhatsIAPP patch] WA-JS ${versao}: versao diferente de 4.6.0. ` +
        "Backport de upload automatico nao aplicado.",
    );
    return;
  }

  texto = substituirUmaVez(
    texto,
    antigo,
    novo,
    "WA-JS media upload main-thread",
  );

  fs.writeFileSync(alvo, texto, "utf8");

  console.log(
    "[WhatsIAPP patch] WA-JS 4.6.0: backport oficial de upload main-thread aplicado (#3575 / 0beac7e).",
  );
}

let falhou = false;

try {
  patchWppConnectBrowser();
} catch (erro) {
  falhou = true;
  console.error(
    "[WhatsIAPP patch] Erro no patch do WPPConnect:",
    erro?.message || erro,
  );
}

try {
  patchWaJsUploadMidiaMainThread();
} catch (erro) {
  falhou = true;
  console.error(
    "[WhatsIAPP patch] Erro no patch de upload do WA-JS:",
    erro?.message || erro,
  );
}

try {
  patchWaJsDiagnostico();
} catch (erro) {
  falhou = true;
  console.error(
    "[WhatsIAPP patch] Erro no diagnostico do WA-JS:",
    erro?.message || erro,
  );
}

if (falhou) {
  process.exitCode = 1;
} else {
  console.log("[WhatsIAPP patch] Finalizado.");
}
