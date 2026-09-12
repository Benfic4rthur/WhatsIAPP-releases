"use strict";

const assert = require("node:assert/strict");
const {
  criarModuloRenderizacaoMensagens,
} = require("../renderer-modules/renderizacao-mensagens.js");

const conversaInicial = {
  id: "5511999999999@c.us",
  mensagens: [
    {
      idMensagem: "midia-teste-1",
      tipo: "imagem",
      mediaUrl: null,
      mediaPath: null,
    },
  ],
};
const conversas = { [conversaInicial.id]: conversaInicial };
const cargaMidiaEmAndamento = new Set();
let conversaAtual = conversaInicial.id;
let liberarDownload;

const modulo = criarModuloRenderizacaoMensagens({
  conversas,
  cargaMidiaEmAndamento,
  obterConversaAtual: () => conversaAtual,
  ipcRenderer: {
    invoke: () =>
      new Promise((resolve) => {
        liberarDownload = resolve;
      }),
  },
});

const promessa = modulo.carregarUmaMidia(
  conversaInicial,
  conversaInicial.mensagens[0],
);

Promise.resolve()
  .then(() => {
    conversas[conversaInicial.id] = {
      ...conversaInicial,
      mensagens: [{
        ...conversaInicial.mensagens[0],
        mediaUrl: null,
        mediaPath: null,
      }],
    };
    conversaAtual = null;
    liberarDownload({
      ok: true,
      mediaUrl: "file:///tmp/midia-teste.png",
      mediaPath: "/tmp/midia-teste.png",
      mime: "image/png",
    });
    return promessa;
  })
  .then(() => {
    const mensagemAtual = conversas[conversaInicial.id].mensagens[0];
    assert.equal(mensagemAtual.mediaUrl, "file:///tmp/midia-teste.png");
    assert.equal(mensagemAtual.mediaPath, "/tmp/midia-teste.png");
    assert.equal(mensagemAtual.mime, "image/png");
    assert.equal(cargaMidiaEmAndamento.size, 0);
    console.log("midias: PASS");
  });
