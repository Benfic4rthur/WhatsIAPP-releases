const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const raiz = path.join(__dirname, "..");
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), "utf8");
function trecho(arquivo, inicio, fim) {
  const texto = ler(arquivo);
  const a = texto.indexOf(inicio);
  const b = texto.indexOf(fim, a + inicio.length);
  assert.ok(a >= 0 && b > a, `Trecho de teste ausente em ${arquivo}`);
  return texto.slice(a, b);
}

async function testar() {
  const baileys = vm.createContext({});
  vm.runInContext(trecho("whatsapp-worker.js", "function desembrulharMensagem(", "function obterContextInfoMensagem("), baileys);
  const documento = { fileName: "manual.pdf", mimetype: "application/pdf", caption: "Detalhe este documento" };
  for (const message of [
    { documentMessage: documento },
    { documentWithCaptionMessage: { message: { documentMessage: documento } } },
  ]) {
    const recebido = baileys.interpretarMensagem(message);
    assert.equal(recebido.texto, documento.caption);
    assert.equal(recebido.fileName, documento.fileName);
  }
  assert.equal(baileys.interpretarMensagem({ documentMessage: { fileName: "manual.pdf" } }).texto, "");

  const wpp = vm.createContext({});
  vm.runInContext(trecho("wpp-worker-modules/03-midia-recebimento.js", "function textoParecePayloadMidiaWpp(", "function dadosBase64MidiaWpp("), wpp);
  assert.equal(wpp.textoMensagemRecebidaWpp({ filename: "manual.pdf", caption: documento.caption }, "documento"), documento.caption);
  assert.equal(wpp.textoMensagemRecebidaWpp({ filename: "manual.pdf", body: "Explique o anexo" }, "documento"), "Explique o anexo");
  assert.equal(wpp.textoMensagemRecebidaWpp({ filename: "manual.pdf" }, "documento"), "");

  const { criarModuloDocumentosIA } = require("../renderer-modules/documentos-ia");
  const textoPdf = "Conteudo de exemplo. ".repeat(300) + "FIM DO DOCUMENTO";
  const modulo = criarModuloDocumentosIA({
    localStorage: { getItem: () => null, setItem: () => {} },
    ipcRenderer: { invoke: async (canal) => {
      assert.equal(canal, "ler-documento-ia");
      return { ok: true, texto: textoPdf, totalPaginas: 13 };
    } },
  });
  const msg = { tipo: "documento", idMensagem: "teste", fileName: "manual.pdf", mediaPath: "/fixture/manual.pdf", texto: documento.caption };
  const conversa = { id: "teste", mensagens: [msg] };
  const leitura = await modulo.prepararContextoDocumentoRelacionadoIA(conversa, msg);
  assert.equal(leitura.ok, true);
  const prompt = modulo.montarTextoMensagemComContextoDocumentoIA(msg, msg.texto);
  assert.ok(prompt.includes(documento.caption));
  assert.ok(prompt.includes("FIM DO DOCUMENTO"));

  // Exercita a funcao real, interrompendo antes de qualquer chamada de rede.
  const main = vm.createContext({ obterChaveGroqParaUso: () => "" });
  vm.runInContext(trecho("index.js", "async function gerarRespostaAutomaticaGroq(", "function normalizarContextoFactualGroq("), main);
  assert.equal((await main.gerarRespostaAutomaticaGroq({ mensagemAtual: prompt })).codigo, "GROQ_CHAVE_AUSENTE");
  let promptRecebido;
  const parar = new Error("fim do teste sem rede");
  Object.assign(main, {
    obterChaveGroqParaUso: () => "chave-simulada",
    normalizarLimitesContextoGroq: () => ({ limiteMensagens: 15 }),
    normalizarMensagensAutomaticasGroq: () => [],
    prepararContextoCatalogoIA: () => ({ relevante: true }),
    respostaCatalogoDeterministicaFatoAusenteIA: (texto) => { promptRecebido = texto; throw parar; },
  });
  await assert.rejects(main.gerarRespostaAutomaticaGroq({ mensagemAtual: prompt }), (erro) => erro === parar);
  assert.ok(promptRecebido.includes("FIM DO DOCUMENTO"));

  const renderer = ler("renderer.js");
  const inicio = renderer.indexOf('    if (resultado?.codigo === "GROQ_CHAVE_AUSENTE")');
  const fim = renderer.indexOf("    if (geracaoFalhou(resultado))", inicio);
  assert.ok(inicio >= 0 && fim > inicio);
  let avisado = false;
  const pendentes = new Map([["mensagem", true]]);
  const contexto = vm.createContext({
    resultado: { codigo: "GROQ_CHAVE_AUSENTE", erro: "Configure a chave" },
    respostasAutomaticasProcessadas: pendentes, chaveProcessada: "mensagem", id: "teste",
    mostrarEstadoPainelIAConversa: () => { avisado = true; },
    diagnosticoSegundoPlanoIA: () => {}, sinalizarFalhaTesteIntegridadeIAGlobal: () => {},
  });
  vm.runInContext(`(function () { ${renderer.slice(inicio, fim)} throw new Error("Tentativa de continuar para retry/envio"); })()`, contexto);
  assert.equal(avisado, true);
  assert.equal(pendentes.has("mensagem"), false);
  console.log("OK: legenda Baileys/WPP, PDF e pergunta no contexto, texto alem de 4 mil caracteres e chave ausente sem retry/envio.");
}
testar().catch((erro) => { console.error(erro); process.exitCode = 1; });
