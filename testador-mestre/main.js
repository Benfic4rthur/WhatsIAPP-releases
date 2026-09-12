"use strict";

function registrarMainTestadorMestre(deps = {}) {
  const {
    ipcMain,
    app,
    fs,
    path,
    obterSnapshot,
    sondarCorrelacaoWorkers,
    sondarAcaoDesconhecida,
    testarDeduplicacaoTempoReal,
  } = deps;

  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error("ipcMain indisponivel para o diagnostico do Testador Mestre.");
  }

  const canal = "testador-mestre-diagnostico-main";

  try {
    ipcMain.removeHandler?.(canal);
  } catch {}

  function infoArquivo(nome) {
    try {
      const base = app?.getPath?.("userData");
      const arquivo = path?.join?.(base, nome);
      if (!arquivo || !fs?.existsSync?.(arquivo)) {
        return { existe: false, bytes: 0 };
      }
      const stat = fs.statSync(arquivo);
      return {
        existe: !!stat?.isFile?.(),
        bytes: Number(stat?.size || 0) || 0,
      };
    } catch {
      return { existe: false, bytes: 0 };
    }
  }

  ipcMain.handle(canal, async (_evento, dados = {}) => {
    const acao = String(dados?.acao || "snapshot").trim().toLowerCase();

    if (acao === "snapshot") {
      const base =
        typeof obterSnapshot === "function" ? obterSnapshot() || {} : {};

      return {
        ok: true,
        ...base,
        caches: {
          conversas: infoArquivo("conversas.json"),
          aliases: infoArquivo("mapeamentos.json"),
          arquivamento: infoArquivo("arquivadas.json"),
          retry: infoArquivo("mensagens-retry.json"),
          privacidade: infoArquivo("privacidade-conversas-cache-v2.json"),
        },
      };
    }

    if (acao === "correlacao-workers") {
      if (typeof sondarCorrelacaoWorkers !== "function") {
        return { ok: false, erro: "Sonda de correlacao indisponivel." };
      }
      return sondarCorrelacaoWorkers();
    }

    if (acao === "acao-desconhecida") {
      if (typeof sondarAcaoDesconhecida !== "function") {
        return { ok: false, erro: "Sonda de acao desconhecida indisponivel." };
      }
      return sondarAcaoDesconhecida();
    }

    if (acao === "dedup-tempo-real") {
      if (typeof testarDeduplicacaoTempoReal !== "function") {
        return { ok: false, erro: "Sonda de deduplicacao indisponivel." };
      }
      return testarDeduplicacaoTempoReal();
    }

    return {
      ok: false,
      erro: `Acao diagnostica desconhecida: ${acao || "vazia"}`,
    };
  });

  return Object.freeze({ canal });
}

module.exports = {
  registrarMainTestadorMestre,
};
