"use strict";

const { criarBridgeRenderer } = require("./bridge-renderer.js");
const { criarSegurancaTestador } = require("./seguranca.js");
const { criarExecutorTestador } = require("./executor.js");
const { criarModuloRelatorio } = require("./relatorio.js");
const { criarCatalogoTestes } = require("./catalogo-testes.js");
const { criarUiTestadorMestre } = require("./ui.js");

const VERSAO_TESTADOR_MESTRE = "1.3.4-relatorio-interno";

function criarTestadorMestre(deps = {}) {
  const {
    ipcRenderer,
    document,
    window,
    localStorage,
    fs,
    os,
    path,
    shell,
    obterEstadoRenderer,
    obterConversas,
    ehConversaTecnica,
    hooksRenderer = {},
  } = deps;

  if (!window || !document) {
    throw new Error("Renderer indisponivel para iniciar o Testador Mestre.");
  }

  if (window.__whatsiappTestadorMestre?.api) {
    return window.__whatsiappTestadorMestre.api;
  }

  const marcador = {
    versao: VERSAO_TESTADOR_MESTRE,
    instancias: 1,
    iniciadoEm: Date.now(),
    api: null,
  };
  window.__whatsiappTestadorMestre = marcador;

  let ui = null;
  let alvoTesteAtual = "";

  const bridge = criarBridgeRenderer({
    ipcRenderer,
    document,
    window,
    localStorage,
    obterEstadoRenderer,
    obterConversas,
    ehConversaTecnica,
    hooksRenderer,
  });

  const relatorio = criarModuloRelatorio({
    fs,
    os,
    path,
    localStorage,
  });

  const obterAlvoTeste = () => {
    const uiAlvo = ui?.obterAlvoTeste?.();
    if (uiAlvo) alvoTesteAtual = String(uiAlvo).trim();
    return alvoTesteAtual;
  };

  const seguranca = criarSegurancaTestador({ obterAlvoTeste });

  const executor = criarExecutorTestador({
    seguranca,
    timeoutPadraoMs: 15000,
    onInicio: (dados) => ui?.onInicio?.(dados),
    onTesteInicio: (dados) => ui?.onTesteInicio?.(dados),
    onTesteFim: (dados) => ui?.onTesteFim?.(dados),
    onFim: (execucao) => {
      let salvo = null;
      try {
        salvo = relatorio.salvar(execucao, {
          versao: VERSAO_TESTADOR_MESTRE,
        });
      } catch (erro) {
        console.warn(
          `[TESTADOR MESTRE] REPORT_SAVE_ERROR | ${String(erro?.message || erro || "unknown").replace(/[^\x20-\x7E]/g, "").slice(0, 180)}`,
        );
      }
      ui?.onFim?.(execucao, salvo);
    },
  });

  const catalogo = criarCatalogoTestes({
    bridge,
    seguranca,
    executor,
    relatorio,
    document,
    window,
    localStorage,
    fs,
    path,
    obterAlvoTeste,
    hooksRenderer,
  });

  ui = criarUiTestadorMestre({
    document,
    window,
    localStorage,
    shell,
    executor,
    catalogo,
    bridge,
    versao: VERSAO_TESTADOR_MESTRE,
  });

  const api = Object.freeze({
    versao: VERSAO_TESTADOR_MESTRE,
    abrir: ui.abrir,
    fechar: ui.fechar,
    obterResumoCatalogo: catalogo.resumoCatalogo,
    estaExecutando: executor.estaExecutando,
    cancelar: executor.cancelar,
  });

  marcador.api = api;

  console.log(
    `[TESTADOR MESTRE] READY | version=${VERSAO_TESTADOR_MESTRE} | matrix=${catalogo.resumoCatalogo().matrizTotal} | implemented=${catalogo.resumoCatalogo().implementados}`,
  );

  return api;
}

module.exports = {
  criarTestadorMestre,
  VERSAO_TESTADOR_MESTRE,
};
