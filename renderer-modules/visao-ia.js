function criarModuloVisaoIA(deps = {}) {
  const { ipcRenderer, localStorage } = deps;

  const CHAVE_CACHE_VISAO_IA = "whatsiapp.ia.visao.cache.v1";
  const LIMITE_CACHE_VISAO_IA = 400;
  const interpretacoesImagemPendentes = new Map();

  function carregarCacheVisaoIA() {
    try {
      const bruto = JSON.parse(
        localStorage.getItem(CHAVE_CACHE_VISAO_IA) || "{}",
      );
      return bruto && typeof bruto === "object" ? bruto : {};
    } catch {
      return {};
    }
  }

  const cacheVisaoIA = carregarCacheVisaoIA();

  function salvarCacheVisaoIA() {
    try {
      const entradas = Object.entries(cacheVisaoIA)
        .sort(
          (a, b) =>
            Number(b[1]?.atualizadoEm || 0) - Number(a[1]?.atualizadoEm || 0),
        )
        .slice(0, LIMITE_CACHE_VISAO_IA);
      localStorage.setItem(
        CHAVE_CACHE_VISAO_IA,
        JSON.stringify(Object.fromEntries(entradas)),
      );
    } catch {}
  }

  function chaveMensagemVisaoIA(mensagem) {
    const id = String(mensagem?.idMensagem || "").trim();
    if (id) {
      return id;
    }
    const timestamp = Number(mensagem?.timestamp || 0) || 0;
    const texto = String(mensagem?.texto || "").trim();
    return timestamp || texto ? `${timestamp}:${texto}` : "";
  }

  function mensagemSuportaInterpretacaoImagemIA(mensagem) {
    return !!(
      mensagem &&
      !mensagem.apagadaParaTodos &&
      (mensagem.tipo === "imagem" ||
        (mensagem.tipo === "view_once" && mensagem.viewOnceKind === "imagem"))
    );
  }

  function obterInterpretacaoImagemIA(mensagem) {
    const chave = chaveMensagemVisaoIA(mensagem);
    return chave ? cacheVisaoIA[chave] || null : null;
  }

  function persistirInterpretacaoImagemIA(mensagem, interpretacao = {}) {
    const chave = chaveMensagemVisaoIA(mensagem);
    if (!chave) {
      return null;
    }

    const salvo = {
      resumo: String(interpretacao?.resumo || "")
        .replace(/\s+/g, " ")
        .trim(),
      textoVisivel: String(interpretacao?.textoVisivel || "")
        .replace(/\s+/g, " ")
        .trim(),
      identificacao: String(interpretacao?.identificacao || "")
        .replace(/\s+/g, " ")
        .trim(),
      observacoes: String(interpretacao?.observacoes || "")
        .replace(/\s+/g, " ")
        .trim(),
      modelo: String(interpretacao?.modelo || "").trim(),
      atualizadoEm: Date.now(),
    };

    if (!salvo.resumo && !salvo.textoVisivel && !salvo.identificacao) {
      return null;
    }

    cacheVisaoIA[chave] = salvo;
    salvarCacheVisaoIA();
    return salvo;
  }

  function formatarInterpretacaoImagemParaContextoIA(interpretacao) {
    if (!interpretacao) {
      return "";
    }

    const partes = [];
    const resumo = String(interpretacao?.resumo || "").trim();
    const textoVisivel = String(interpretacao?.textoVisivel || "").trim();
    const identificacao = String(interpretacao?.identificacao || "").trim();
    const observacoes = String(interpretacao?.observacoes || "").trim();

    if (resumo) {
      partes.push(`Imagem: ${resumo}`);
    }
    if (textoVisivel) {
      partes.push(`Texto visível: ${textoVisivel}`);
    }
    if (identificacao) {
      partes.push(`Identificação provável: ${identificacao}`);
    }
    if (observacoes) {
      partes.push(`Observações: ${observacoes}`);
    }

    return partes.join(" ").trim();
  }

  function montarTextoMensagemComContextoVisualIA(mensagem, textoBase = "") {
    const texto = String(textoBase || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!mensagemSuportaInterpretacaoImagemIA(mensagem)) {
      return texto;
    }

    const interpretacao = obterInterpretacaoImagemIA(mensagem);
    const contextoVisual =
      formatarInterpretacaoImagemParaContextoIA(interpretacao);

    if (texto && contextoVisual) {
      return `${texto} ${contextoVisual}`.trim();
    }
    if (contextoVisual) {
      return contextoVisual;
    }
    return texto;
  }

  async function garantirImagemCarregadaParaIA(conversaId, mensagem) {
    if (!mensagemSuportaInterpretacaoImagemIA(mensagem)) {
      return null;
    }

    const mediaPathAtual = String(mensagem?.mediaPath || "").trim();
    if (mediaPathAtual) {
      return {
        mediaPath: mediaPathAtual,
        mime: mensagem?.mime || null,
        fileName: mensagem?.fileName || null,
      };
    }

    try {
      const resultado = await ipcRenderer.invoke("carregar-midia", {
        conversaId,
        idMensagem: mensagem.idMensagem,
      });

      if (!resultado?.ok || !resultado?.mediaPath) {
        return null;
      }

      mensagem.mediaPath = resultado.mediaPath;
      mensagem.mediaUrl = resultado.mediaUrl || mensagem.mediaUrl || null;
      mensagem.fileName = resultado.fileName || mensagem.fileName || null;
      mensagem.mime = resultado.mime || mensagem.mime || null;

      return {
        mediaPath: mensagem.mediaPath,
        mime: mensagem.mime || null,
        fileName: mensagem.fileName || null,
      };
    } catch {
      return null;
    }
  }

  async function garantirInterpretacaoImagemIA(conversaId, mensagem) {
    if (!mensagemSuportaInterpretacaoImagemIA(mensagem)) {
      return null;
    }

    const chave = chaveMensagemVisaoIA(mensagem);
    if (!chave) {
      return null;
    }

    const cache = obterInterpretacaoImagemIA(mensagem);
    if (cache) {
      return cache;
    }

    if (interpretacoesImagemPendentes.has(chave)) {
      return interpretacoesImagemPendentes.get(chave);
    }

    const promessa = (async () => {
      const midia = await garantirImagemCarregadaParaIA(conversaId, mensagem);
      if (!midia?.mediaPath) {
        return null;
      }

      try {
        const resultado = await ipcRenderer.invoke("interpretar-imagem-ia", {
          conversaId: String(conversaId || "").trim(),
          idMensagem: String(mensagem?.idMensagem || "").trim(),
          mediaPath: midia.mediaPath,
          mime: midia.mime || null,
          fileName: midia.fileName || null,
          textoMensagem: String(mensagem?.texto || "").slice(0, 600),
        });

        if (!resultado?.ok) {
          return null;
        }

        return persistirInterpretacaoImagemIA(mensagem, {
          resumo: resultado.resumo,
          textoVisivel: resultado.textoVisivel,
          identificacao: resultado.identificacao,
          observacoes: resultado.observacoes,
          modelo: resultado.modelo,
        });
      } catch {
        return null;
      }
    })().finally(() => {
      interpretacoesImagemPendentes.delete(chave);
    });

    interpretacoesImagemPendentes.set(chave, promessa);
    return promessa;
  }

  async function prepararContextoVisualIA(
    conversa,
    mensagemAtual,
    limiteMensagens = 20,
  ) {
    const conversaId = String(conversa?.id || "").trim();
    const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];

    if (!conversaId || !lista.length) {
      return;
    }

    let indiceAtual = lista.length - 1;
    if (mensagemAtual) {
      const chaveAtual = chaveMensagemVisaoIA(mensagemAtual);
      const encontrado = lista.findIndex(
        (item) => chaveMensagemVisaoIA(item) === chaveAtual,
      );
      if (encontrado >= 0) {
        indiceAtual = encontrado;
      }
    }

    // A mensagem atual sempre tem prioridade. Isso evita gastar uma chamada
    // analisando imagens antigas antes da foto que acabou de chegar e impede
    // que uma falha de rede em uma imagem anterior atrase a resposta atual.
    if (
      mensagemAtual &&
      mensagemSuportaInterpretacaoImagemIA(mensagemAtual) &&
      !obterInterpretacaoImagemIA(mensagemAtual)
    ) {
      await garantirInterpretacaoImagemIA(conversaId, mensagemAtual);
      return;
    }

    const inicio = Math.max(
      0,
      indiceAtual - Math.max(1, Number(limiteMensagens || 20)) + 1,
    );

    // Quando a mensagem atual e texto, analisamos somente a imagem mais
    // recente ainda sem cache. As demais imagens ja interpretadas continuam
    // disponiveis no contexto sem gerar custo/rede desnecessarios.
    for (let i = indiceAtual; i >= inicio; i -= 1) {
      const msg = lista[i];
      if (
        !mensagemSuportaInterpretacaoImagemIA(msg) ||
        obterInterpretacaoImagemIA(msg)
      ) {
        continue;
      }
      await garantirInterpretacaoImagemIA(conversaId, msg);
      break;
    }
  }

  return {
    mensagemSuportaInterpretacaoImagemIA,
    obterInterpretacaoImagemIA,
    montarTextoMensagemComContextoVisualIA,
    garantirInterpretacaoImagemIA,
    prepararContextoVisualIA,
  };
}

module.exports = {
  criarModuloVisaoIA,
};
