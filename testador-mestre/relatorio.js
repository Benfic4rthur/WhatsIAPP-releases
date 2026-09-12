"use strict";

function criarModuloRelatorio(deps = {}) {
  const { fs, os, path, localStorage } = deps;
  const CHAVE_ULTIMO_RELATORIO = "whatsiapp.testador.ultimoRelatorio.v1";

  function diretorioRelatorios() {
    return path.join(os.tmpdir(), "WhatsIAPP", "testador-mestre", "relatorios");
  }

  function garantirDiretorio() {
    const dir = diretorioRelatorios();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function textoValor(valor) {
    if (valor === null || valor === undefined) return "-";
    if (typeof valor === "string") return valor;
    try {
      return JSON.stringify(valor);
    } catch {
      return String(valor);
    }
  }

  function formatarDuracao(ms) {
    const total = Math.max(0, Number(ms || 0) || 0);
    if (total < 1000) return `${total} ms`;
    return `${(total / 1000).toFixed(2)} s`;
  }

  function montarTexto(execucao = {}, metadados = {}) {
    const resumo = execucao.resumo || {};
    const linhas = [];

    linhas.push("TESTADOR MESTRE WHATSIAPP");
    linhas.push(`Versao do modulo: ${metadados.versao || "-"}`);
    linhas.push(`Perfil: ${execucao.perfil || "-"}`);
    linhas.push(`Inicio: ${new Date(execucao.inicio || Date.now()).toLocaleString("pt-BR")}`);
    linhas.push(`Duracao: ${formatarDuracao(execucao.duracaoMs)}`);
    linhas.push(`Cancelado: ${execucao.cancelado ? "sim" : "nao"}`);
    linhas.push("");
    linhas.push(
      `PASS ${resumo.PASS || 0} | WARNING ${resumo.WARNING || 0} | FAIL ${resumo.FAIL || 0} | MANUAL ${resumo.MANUAL || 0} | SKIP ${resumo.SKIP || 0} | BLOCKED ${resumo.BLOCKED || 0}`,
    );
    linhas.push("");

    for (const item of execucao.resultados || []) {
      linhas.push(`${item.id} | ${item.status} | ${item.nome}`);
      linhas.push(`Esperado: ${item.esperado || "-"}`);
      if (item.detalhe) linhas.push(`Detalhe: ${item.detalhe}`);
      if (item.observado !== null && item.observado !== undefined) {
        linhas.push(`Observado: ${textoValor(item.observado)}`);
      }
      if (item.codigo) linhas.push(`Codigo: ${item.codigo}`);
      if (item.erro) linhas.push(`Erro: ${item.erro}`);
      linhas.push(`Duracao: ${formatarDuracao(item.duracaoMs)}`);
      linhas.push("");
    }

    return linhas.join("\n");
  }

  function salvar(execucao, metadados = {}) {
    const texto = montarTexto(execucao, metadados);
    const dir = garantirDiretorio();
    const data = new Date();
    const carimbo = [
      data.getFullYear(),
      String(data.getMonth() + 1).padStart(2, "0"),
      String(data.getDate()).padStart(2, "0"),
      "-",
      String(data.getHours()).padStart(2, "0"),
      String(data.getMinutes()).padStart(2, "0"),
      String(data.getSeconds()).padStart(2, "0"),
    ].join("");
    const arquivo = path.join(dir, `testador-mestre-${carimbo}.txt`);

    fs.writeFileSync(arquivo, texto, "utf8");

    try {
      localStorage.setItem(
        CHAVE_ULTIMO_RELATORIO,
        JSON.stringify({ arquivo, salvoEm: Date.now(), texto }),
      );
    } catch {}

    return { arquivo, texto };
  }

  function obterUltimo() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_ULTIMO_RELATORIO) || "null");
      if (!salvo || typeof salvo !== "object") return null;
      return salvo;
    } catch {
      return null;
    }
  }

  return Object.freeze({
    diretorioRelatorios,
    montarTexto,
    salvar,
    obterUltimo,
    chaveStorage: CHAVE_ULTIMO_RELATORIO,
  });
}

module.exports = {
  criarModuloRelatorio,
};
