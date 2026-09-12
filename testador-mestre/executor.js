"use strict";

function criarExecutorTestador(deps = {}) {
  const {
    seguranca,
    timeoutPadraoMs = 15000,
    onInicio,
    onTesteInicio,
    onTesteFim,
    onFim,
  } = deps;

  let executando = false;
  let cancelarSolicitado = false;
  let execucaoId = 0;

  async function executarComTimeout(teste, contexto, timeoutMs) {
    let timer = null;

    try {
      return await Promise.race([
        Promise.resolve().then(() => teste.executar(contexto)),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const erro = new Error(
              `Timeout apos ${Math.max(1, Number(timeoutMs || timeoutPadraoMs))} ms.`,
            );
            erro.codigo = "TM_TIMEOUT";
            reject(erro);
          }, Math.max(1, Number(timeoutMs || timeoutPadraoMs)));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizarResultado(teste, retorno, duracaoMs) {
    const base = retorno && typeof retorno === "object" ? retorno : {};
    const status = String(base.status || "PASS").toUpperCase();
    const permitidos = new Set([
      "PASS",
      "WARNING",
      "FAIL",
      "MANUAL",
      "SKIP",
      "BLOCKED",
    ]);

    return {
      id: teste.id,
      nome: teste.nome,
      secao: teste.secao,
      tipo: teste.tipo,
      risco: teste.risco,
      status: permitidos.has(status) ? status : "FAIL",
      detalhe: String(base.detalhe || ""),
      observado:
        base.observado === undefined || base.observado === null
          ? null
          : base.observado,
      esperado: teste.esperado,
      duracaoMs: Math.max(0, Number(duracaoMs || 0) || 0),
      erro: base.erro ? String(base.erro) : null,
      codigo: base.codigo ? String(base.codigo) : null,
    };
  }

  async function executar(testes = [], opcoes = {}) {
    if (executando) {
      throw new Error("O Testador Mestre ja esta executando uma bateria.");
    }

    executando = true;
    cancelarSolicitado = false;
    const idAtual = ++execucaoId;
    const inicio = Date.now();
    const perfil = String(opcoes.perfil || "rapido");
    const contexto = opcoes.contexto || {};
    const resultados = [];

    onInicio?.({ id: idAtual, total: testes.length, perfil, inicio });

    try {
      for (let indice = 0; indice < testes.length; indice += 1) {
        if (cancelarSolicitado) {
          break;
        }

        const teste = testes[indice];
        const validacao = seguranca.validarExecucao(teste, perfil);
        const testeInicio = Date.now();

        onTesteInicio?.({
          id: idAtual,
          teste,
          indice,
          total: testes.length,
        });

        let resultado = null;

        if (!validacao.permitido) {
          resultado = normalizarResultado(
            teste,
            {
              status:
                validacao.codigo === "TM_PROFILE_BLOCKED" ? "SKIP" : "BLOCKED",
              detalhe: validacao.motivo,
              codigo: validacao.codigo,
            },
            Date.now() - testeInicio,
          );
        } else if (typeof teste.executar !== "function") {
          resultado = normalizarResultado(
            teste,
            {
              status: teste.tipo === "MANUAL" ? "MANUAL" : "SKIP",
              detalhe: "Caso catalogado, executor ainda nao implementado.",
              codigo: "TM_NOT_IMPLEMENTED",
            },
            Date.now() - testeInicio,
          );
        } else {
          try {
            const retorno = await executarComTimeout(
              teste,
              contexto,
              teste.timeoutMs,
            );
            resultado = normalizarResultado(
              teste,
              retorno,
              Date.now() - testeInicio,
            );
          } catch (erro) {
            resultado = normalizarResultado(
              teste,
              {
                status: "FAIL",
                detalhe:
                  erro?.codigo === "TM_TIMEOUT"
                    ? "O teste excedeu o limite de tempo, a fila continuou normalmente."
                    : "O executor capturou uma falha sem interromper o WhatsIAPP.",
                erro: erro?.message || erro,
                codigo: erro?.codigo || "TM_TEST_ERROR",
              },
              Date.now() - testeInicio,
            );
          }
        }

        resultados.push(resultado);
        onTesteFim?.({
          id: idAtual,
          teste,
          resultado,
          indice,
          total: testes.length,
        });
      }
    } finally {
      const resumo = resumirResultados(resultados);
      executando = false;

      const final = {
        id: idAtual,
        perfil,
        cancelado: cancelarSolicitado,
        inicio,
        fim: Date.now(),
        duracaoMs: Date.now() - inicio,
        resultados,
        resumo,
      };

      onFim?.(final);
      cancelarSolicitado = false;
      return final;
    }
  }

  function cancelar() {
    if (!executando) return false;
    cancelarSolicitado = true;
    return true;
  }

  function resumirResultados(resultados = []) {
    const resumo = {
      total: resultados.length,
      PASS: 0,
      WARNING: 0,
      FAIL: 0,
      MANUAL: 0,
      SKIP: 0,
      BLOCKED: 0,
    };

    for (const item of resultados) {
      const status = String(item?.status || "FAIL").toUpperCase();
      if (Object.prototype.hasOwnProperty.call(resumo, status)) {
        resumo[status] += 1;
      }
    }

    return resumo;
  }

  return Object.freeze({
    executar,
    cancelar,
    resumirResultados,
    estaExecutando: () => executando,
    timeoutPadraoMs,
    serial: true,
  });
}

module.exports = {
  criarExecutorTestador,
};
