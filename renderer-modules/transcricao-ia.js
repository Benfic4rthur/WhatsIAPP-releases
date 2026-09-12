function criarModuloTranscricaoIA(deps = {}) {
  const { ipcRenderer, localStorage } = deps;

  const CHAVE_CACHE_TRANSCRICAO = "whatsiapp.ia.transcricoesAudio.v1";
  const MAX_CACHE = 300;
  const MAX_TEXTO_CACHE = 16000;
  const JANELA_AUDIO_ANTERIOR_MS = 60 * 60 * 1000;

  const transcricoesEmAndamento = new Map();

  function carregarCache() {
    try {
      const dados = JSON.parse(
        localStorage?.getItem?.(CHAVE_CACHE_TRANSCRICAO) || "{}",
      );

      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const cacheTranscricoes = carregarCache();

  function salvarCache() {
    try {
      const entradas = Object.entries(cacheTranscricoes)
        .filter(([, item]) => item && typeof item === "object")
        .sort(
          (a, b) =>
            Number(b?.[1]?.atualizadoEm || 0) -
            Number(a?.[1]?.atualizadoEm || 0),
        )
        .slice(0, MAX_CACHE);

      const reduzido = Object.fromEntries(entradas);

      for (const chave of Object.keys(cacheTranscricoes)) {
        delete cacheTranscricoes[chave];
      }

      Object.assign(cacheTranscricoes, reduzido);

      localStorage?.setItem?.(
        CHAVE_CACHE_TRANSCRICAO,
        JSON.stringify(cacheTranscricoes),
      );
    } catch {}
  }

  function idMensagemAudio(msg) {
    return String(msg?.idMensagem || "").trim();
  }

  function mensagemSuportaTranscricaoAudioIA(msg) {
    return !!msg && msg.tipo === "audio" && !!idMensagemAudio(msg);
  }

  function obterRegistroCache(msg) {
    const id = idMensagemAudio(msg);

    if (!id) {
      return null;
    }

    const item = cacheTranscricoes[id];
    const texto = String(item?.texto || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!texto) {
      return null;
    }

    return {
      texto,
      modelo: String(item?.modelo || "").trim() || null,
      idioma: String(item?.idioma || "").trim() || null,
      duracaoSegundos: Number(item?.duracaoSegundos || 0) || null,
      atualizadoEm: Number(item?.atualizadoEm || 0) || null,
    };
  }

  function aplicarRegistroNaMensagem(msg, registro) {
    if (!msg || !registro?.texto) {
      return false;
    }

    msg.transcricaoIA = registro.texto;
    msg.transcricaoIAModelo = registro.modelo || null;
    msg.transcricaoIAIdioma = registro.idioma || null;
    msg.transcricaoIADuracaoSegundos = registro.duracaoSegundos || null;
    msg.transcricaoIAErro = null;

    return true;
  }

  function hidratarTranscricaoDoCache(msg) {
    if (!mensagemSuportaTranscricaoAudioIA(msg)) {
      return false;
    }

    const atual = String(msg?.transcricaoIA || "")
      .replace(/\s+/g, " ")
      .trim();

    if (atual) {
      return true;
    }

    return aplicarRegistroNaMensagem(msg, obterRegistroCache(msg));
  }

  function persistirTranscricao(msg, resultado = {}) {
    const id = idMensagemAudio(msg);
    const texto = String(resultado?.transcricao || resultado?.texto || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXTO_CACHE);

    if (!id || !texto) {
      return false;
    }

    const registro = {
      texto,
      modelo: String(resultado?.modelo || "").trim() || null,
      idioma: String(resultado?.idioma || "").trim() || null,
      duracaoSegundos: Number(resultado?.duracaoSegundos || 0) || null,
      atualizadoEm: Date.now(),
    };

    cacheTranscricoes[id] = registro;
    salvarCache();
    aplicarRegistroNaMensagem(msg, registro);

    return true;
  }

  async function garantirArquivoAudio(conversa, msg) {
    const caminhoExistente = String(msg?.mediaPath || "").trim();

    if (!conversa?.id || !msg?.idMensagem) {
      return !!caminhoExistente;
    }

    // Para audio recebido, o WPPConnect pode entregar um caminho local antes
    // de o arquivo estar realmente utilizavel. O Baileys ja preserva a
    // mensagem bruta e e a fonte usada pelo carregar-midia do app.
    // Tentamos materializar a midia por ele antes de confiar no caminho WPP.
    if (!msg?.minha) {
      try {
        const resultado = await ipcRenderer.invoke("carregar-midia", {
          conversaId: conversa.id,
          idMensagem: msg.idMensagem,
        });

        if (resultado?.ok && resultado?.mediaPath) {
          msg.mediaPath = resultado.mediaPath;
          msg.mediaUrl = resultado.mediaUrl || msg.mediaUrl || null;
          msg.mime = resultado.mime || msg.mime || null;
          msg.fileName = resultado.fileName || msg.fileName || null;
          msg.erroMidia = null;
          msg.transcricaoIAErro = null;
          return true;
        }
      } catch {}
    }

    if (caminhoExistente) {
      return true;
    }

    try {
      const resultado = await ipcRenderer.invoke("carregar-midia", {
        conversaId: conversa.id,
        idMensagem: msg.idMensagem,
      });

      if (!resultado?.ok || !resultado?.mediaPath) {
        msg.transcricaoIAErro =
          resultado?.erro || "Audio indisponivel para transcricao.";
        return false;
      }

      msg.mediaPath = resultado.mediaPath;
      msg.mediaUrl = resultado.mediaUrl || msg.mediaUrl || null;
      msg.mime = resultado.mime || msg.mime || null;
      msg.fileName = resultado.fileName || msg.fileName || null;
      msg.erroMidia = null;

      return true;
    } catch (erro) {
      msg.transcricaoIAErro =
        erro?.message || "Audio indisponivel para transcricao.";
      return false;
    }
  }

  async function transcreverMensagemAudio(conversa, msg) {
    if (!mensagemSuportaTranscricaoAudioIA(msg)) {
      return {
        ok: true,
        aplicavel: false,
        transcricao: "",
      };
    }

    if (hidratarTranscricaoDoCache(msg)) {
      return {
        ok: true,
        aplicavel: true,
        cache: true,
        transcricao: String(msg.transcricaoIA || ""),
      };
    }

    const id = idMensagemAudio(msg);

    if (transcricoesEmAndamento.has(id)) {
      return transcricoesEmAndamento.get(id);
    }

    const promessa = (async () => {
      if (!(await garantirArquivoAudio(conversa, msg))) {
        return {
          ok: false,
          aplicavel: true,
          erro: msg.transcricaoIAErro || "Audio indisponivel para transcricao.",
        };
      }

      try {
        const resultado = await ipcRenderer.invoke("transcrever-audio-ia", {
          conversaId: String(conversa?.id || ""),
          idMensagem: id,
          mediaPath: String(msg.mediaPath || ""),
          mime: String(msg.mime || ""),
          fileName: String(msg.fileName || ""),
        });

        const transcricao = String(resultado?.transcricao || "")
          .replace(/\s+/g, " ")
          .trim();

        if (!resultado?.ok || !transcricao) {
          msg.transcricaoIAErro =
            resultado?.erro || "Nao foi possivel transcrever o audio.";

          return {
            ok: false,
            aplicavel: true,
            erro: msg.transcricaoIAErro,
          };
        }

        persistirTranscricao(msg, resultado);

        return {
          ok: true,
          aplicavel: true,
          cache: false,
          transcricao: String(msg.transcricaoIA || transcricao),
          modelo: resultado?.modelo || null,
          idioma: resultado?.idioma || null,
          duracaoSegundos: resultado?.duracaoSegundos || null,
        };
      } catch (erro) {
        msg.transcricaoIAErro =
          erro?.message || "Nao foi possivel transcrever o audio.";

        return {
          ok: false,
          aplicavel: true,
          erro: msg.transcricaoIAErro,
        };
      }
    })();

    transcricoesEmAndamento.set(id, promessa);

    try {
      return await promessa;
    } finally {
      transcricoesEmAndamento.delete(id);
    }
  }

  function indiceMensagemAtual(lista, mensagemAtual) {
    if (!Array.isArray(lista) || !mensagemAtual) {
      return -1;
    }

    const idAtual =
      idMensagemAudio(mensagemAtual) ||
      String(mensagemAtual?.idMensagem || "").trim();

    if (idAtual) {
      for (let i = lista.length - 1; i >= 0; i -= 1) {
        if (String(lista[i]?.idMensagem || "").trim() === idAtual) {
          return i;
        }
      }
    }

    return lista.lastIndexOf(mensagemAtual);
  }

  function audioAnteriorRelevante(conversa, mensagemAtual, limiteMensagens) {
    const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
    const indiceAtual = indiceMensagemAtual(lista, mensagemAtual);

    if (indiceAtual <= 0) {
      return null;
    }

    const limite = Math.max(1, Math.min(200, Number(limiteMensagens || 20)));
    let vistas = 0;
    const timestampAtual = Number(mensagemAtual?.timestamp || 0) || 0;

    for (let i = indiceAtual - 1; i >= 0 && vistas < limite; i -= 1) {
      const msg = lista[i];

      if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
        continue;
      }

      vistas += 1;

      if (!mensagemSuportaTranscricaoAudioIA(msg)) {
        continue;
      }

      const timestampAudio = Number(msg?.timestamp || 0) || 0;

      if (timestampAtual && timestampAudio) {
        const diferencaMs = Math.abs(timestampAtual - timestampAudio) * 1000;

        if (diferencaMs > JANELA_AUDIO_ANTERIOR_MS) {
          return null;
        }
      }

      return msg;
    }

    return null;
  }

  async function prepararContextoAudioIA(
    conversa,
    mensagemAtual,
    limiteMensagens = 20,
  ) {
    if (!conversa || !mensagemAtual) {
      return {
        ok: true,
        aplicavel: false,
      };
    }

    if (mensagemSuportaTranscricaoAudioIA(mensagemAtual)) {
      return transcreverMensagemAudio(conversa, mensagemAtual);
    }

    const anterior = audioAnteriorRelevante(
      conversa,
      mensagemAtual,
      limiteMensagens,
    );

    if (!anterior) {
      return {
        ok: true,
        aplicavel: false,
      };
    }

    return transcreverMensagemAudio(conversa, anterior);
  }

  function montarTextoMensagemComTranscricaoAudioIA(msg, textoBase = "") {
    const base = String(textoBase || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!mensagemSuportaTranscricaoAudioIA(msg)) {
      return base;
    }

    hidratarTranscricaoDoCache(msg);

    const transcricao = String(msg?.transcricaoIA || "")
      .replace(/\s+/g, " ")
      .trim();

    return transcricao || base;
  }

  return {
    prepararContextoAudioIA,
    montarTextoMensagemComTranscricaoAudioIA,
    mensagemSuportaTranscricaoAudioIA,
    hidratarTranscricaoDoCache,
  };
}

module.exports = {
  criarModuloTranscricaoIA,
};
