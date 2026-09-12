const fs = require("fs");
const path = require("path");

const MODULOS_WPP = [
  "01-nucleo-sincronizacao.js",
  "02-mensagens-operacoes.js",
  "03-midia-recebimento.js",
  "04-arquivamento-presenca.js",
  "05-inicializacao-wpp.js",
  "06-contatos-grupos.js",
  "07-figurinhas-contatos.js",
  "08-status-base-listagem.js",
  "09-status-operacoes.js",
  "historico-gap.js",
  "10-dispatcher-encerramento.js",
];

const diretorioModulos = path.join(__dirname, "wpp-worker-modules");

const codigoWpp = MODULOS_WPP.map((arquivo) =>
  fs.readFileSync(path.join(diretorioModulos, arquivo), "utf8"),
).join("");

const executarWpp = new Function(
  "exports",
  "require",
  "module",
  "__filename",
  "__dirname",
  codigoWpp,
);

executarWpp(module.exports, require, module, __filename, __dirname);
