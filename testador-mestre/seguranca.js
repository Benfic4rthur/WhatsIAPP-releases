"use strict";

const PERFIS = Object.freeze({
  rapido: Object.freeze({
    id: "rapido",
    nome: "Rápido Seguro",
    riscos: new Set(["R0"]),
    tipos: new Set(["AUTO"]),
  }),
  seguro: Object.freeze({
    id: "seguro",
    nome: "Completo Seguro",
    riscos: new Set(["R0", "R1"]),
    tipos: new Set(["AUTO"]),
  }),
  real: Object.freeze({
    id: "real",
    nome: "Completo Real",
    riscos: new Set(["R0", "R1", "R2"]),
    tipos: new Set(["AUTO", "SEMI"]),
  }),
});

function criarSegurancaTestador(deps = {}) {
  const { obterAlvoTeste } = deps;

  function validarExecucao(teste, perfilId = "rapido") {
    const perfil = PERFIS[perfilId] || PERFIS.rapido;
    const risco = String(teste?.risco || "R0").toUpperCase();
    const tipo = String(teste?.tipo || "AUTO").toUpperCase();

    if (risco === "R3") {
      return {
        permitido: false,
        codigo: "TM_R3_BLOCKED",
        motivo: "Acoes R3 nao possuem executor automatico.",
      };
    }

    if (!perfil.riscos.has(risco) || !perfil.tipos.has(tipo)) {
      return {
        permitido: false,
        codigo: "TM_PROFILE_BLOCKED",
        motivo: `Teste ${tipo}/${risco} fora do perfil ${perfil.nome}.`,
      };
    }

    if (risco === "R2" && teste?.requerAlvoConversa !== false) {
      const alvo =
        typeof obterAlvoTeste === "function"
          ? String(obterAlvoTeste() || "").trim()
          : "";

      if (!alvo) {
        return {
          permitido: false,
          codigo: "TM_TARGET_REQUIRED",
          motivo: "Conversa de teste obrigatoria para qualquer acao R2.",
        };
      }
    }

    return { permitido: true, codigo: "TM_ALLOWED", motivo: "" };
  }

  function validarAlvoReal(alvoSolicitado) {
    const autorizado =
      typeof obterAlvoTeste === "function"
        ? String(obterAlvoTeste() || "").trim()
        : "";
    const solicitado = String(alvoSolicitado || "").trim();

    if (!autorizado || !solicitado || autorizado !== solicitado) {
      return {
        permitido: false,
        codigo: "TM_TARGET_BLOCKED",
        motivo: "O alvo solicitado nao corresponde a conversa autorizada.",
      };
    }

    return { permitido: true, codigo: "TM_TARGET_ALLOWED", motivo: "" };
  }

  return Object.freeze({
    perfis: PERFIS,
    validarExecucao,
    validarAlvoReal,
  });
}

module.exports = {
  criarSegurancaTestador,
  PERFIS,
};
