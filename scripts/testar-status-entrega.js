"use strict";

const assert = require("node:assert/strict");
const {
  normalizarStatus,
  mesclarStatus,
  criarRegistroStatus,
  criarIndicadorStatus,
} = require("./status-entrega.js");

assert.equal(normalizarStatus("desconhecido"), null);
assert.equal(mesclarStatus(null, "pendente"), "pendente");
assert.equal(mesclarStatus("enviada", "entregue"), "entregue");
assert.equal(mesclarStatus("lida", "entregue"), "lida");
assert.equal(mesclarStatus("erro", "pendente"), "erro");

const memoria = new Map();
const storage = {
  getItem: (chave) => memoria.get(chave) || null,
  setItem: (chave, valor) => memoria.set(chave, valor),
};
const registro = criarRegistroStatus(storage);
registro.mesclar("5511999999999@c.us", "status-teste", "enviada");
registro.mesclar("5511999999999@s.whatsapp.net", "status-teste", "lida");

const documento = {
  createElement: () => ({
    dataset: {},
    setAttribute() {},
    className: "",
    innerHTML: "",
  }),
};
const indicador = criarIndicadorStatus(documento, {
  minha: true,
  statusEntrega: "lida",
});
assert.equal(indicador.dataset.statusEntrega, "lida");
assert.equal(
  criarIndicadorStatus(documento, { minha: true, statusEntrega: "sem-status" }),
  null,
);

Promise.resolve().then(() => {
  const restaurado = criarRegistroStatus(storage).mesclar(
    "5511999999999@c.us",
    "status-teste",
  );
  assert.equal(restaurado, "lida");
  console.log("status-entrega: PASS");
});
