"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fonte = fs.readFileSync(path.join(__dirname, "..", "whatsapp-worker.js"), "utf8");

function funcao(nome) {
  const trecho = fonte.match(new RegExp(`^(?:async )?function ${nome}\\([^]*?^}`, "m"));
  assert(trecho, `Funcao ausente: ${nome}`);
  return trecho[0];
}

const contexto = vm.createContext({
  contatos: new Map(),
  contatosSalvos: new Map(),
  conversas: new Map(),
  lidParaPn: new Map(),
  pnParaLid: new Map(),
  sock: { user: { id: "555191640517@s.whatsapp.net", name: "Arthur Benfica" } },
  somenteDigitos: (valor) => String(valor || "").replace(/\D/g, ""),
  normalizarJid: (valor) => String(valor || "").trim().replace(/:\d+(?=@)/, ""),
  ehPn: (id) => String(id || "").endsWith("@s.whatsapp.net"),
  ehLid: (id) => String(id || "").endsWith("@lid"),
  ehGrupo: (id) => String(id || "").endsWith("@g.us"),
  mesmaIdentidadeJid: (a, b) => String(a || "") === String(b || ""),
});

for (const nome of [
  "nomePadrao",
  "pareceNomeUtil",
  "aliasesContato",
  "nomeContatoSalvo",
  "ehMinhaIdentidade",
  "nomePreferidoConversa",
  "aplicarNomesConhecidosNasConversas",
]) {
  vm.runInContext(funcao(nome), contexto);
}

const desconhecido = "555198562153@s.whatsapp.net";
contexto.conversas.set(desconhecido, {
  id: desconhecido,
  nome: "Arthur Benfica Graff",
  mensagens: [],
});

assert.equal(contexto.aplicarNomesConhecidosNasConversas(), 1);
assert.equal(contexto.conversas.get(desconhecido).nome, "+55 (51) 9856-2153");

const salvo = "5551999991234@s.whatsapp.net";
contexto.contatosSalvos.set(salvo, { id: salvo, nome: "Contato salvo" });
contexto.conversas.set(salvo, { id: salvo, nome: "Nome de perfil", mensagens: [] });
contexto.aplicarNomesConhecidosNasConversas();
assert.equal(contexto.conversas.get(salvo).nome, "Contato salvo");

const meuId = "555191640517@s.whatsapp.net";
contexto.conversas.set(meuId, { id: meuId, nome: "+555191640517", mensagens: [] });
contexto.aplicarNomesConhecidosNasConversas();
assert.equal(contexto.conversas.get(meuId).nome, "Arthur Benfica");

console.log("nomes-contatos: desconhecido, salvo e identidade propria PASS");
