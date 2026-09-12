function criarModuloDocumentosIA(deps = {}) {
  const { ipcRenderer, localStorage } = deps;

  const CHAVE_CACHE_DOCUMENTOS_IA = "whatsiapp.ia.documentos.cache.v1";
  const MAX_CACHE = 80;
  const MAX_TEXTO_CACHE = 16000;
  const leiturasEmAndamento = new Map();

  function carregarCache() {
    try {
      const dados = JSON.parse(
        localStorage?.getItem?.(CHAVE_CACHE_DOCUMENTOS_IA) || "{}",
      );

      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const cacheDocumentos = carregarCache();

  function salvarCache() {
    try {
      const entradas = Object.entries(cacheDocumentos)
        .filter(([, item]) => item && typeof item === "object")
        .sort(
          (a, b) =>
            Number(b?.[1]?.atualizadoEm || 0) -
            Number(a?.[1]?.atualizadoEm || 0),
        )
        .slice(0, MAX_CACHE);

      const reduzido = Object.fromEntries(entradas);

      for (const chave of Object.keys(cacheDocumentos)) {
        delete cacheDocumentos[chave];
      }

      Object.assign(cacheDocumentos, reduzido);

      localStorage?.setItem?.(
        CHAVE_CACHE_DOCUMENTOS_IA,
        JSON.stringify(cacheDocumentos),
      );
    } catch {}
  }

  function idMensagemDocumento(msg) {
    return String(msg?.idMensagem || "").trim();
  }

  function documentoEhPdf(msg) {
    const mime = String(msg?.mime || "")
      .trim()
      .toLowerCase();
    const nome = String(msg?.fileName || "")
      .trim()
      .toLowerCase();

    return mime === "application/pdf" || nome.endsWith(".pdf");
  }

  function mensagemSuportaLeituraDocumentoIA(msg) {
    return !!(
      msg &&
      !msg.apagadaParaTodos &&
      msg.tipo === "documento" &&
      !!idMensagemDocumento(msg) &&
      documentoEhPdf(msg)
    );
  }

  function obterRegistroCache(msg) {
    const id = idMensagemDocumento(msg);

    if (!id) {
      return null;
    }

    const item = cacheDocumentos[id];
    const texto = String(item?.texto || "").trim();

    if (!texto) {
      return null;
    }

    return {
      texto,
      fileName: String(item?.fileName || "").trim() || null,
      totalPaginas: Math.max(0, Number(item?.totalPaginas || 0) || 0),
      paginasComTexto: Math.max(0, Number(item?.paginasComTexto || 0) || 0),
      caracteresExtraidos: Math.max(
        0,
        Number(item?.caracteresExtraidos || 0) || 0,
      ),
      truncado: !!item?.truncado,
      atualizadoEm: Number(item?.atualizadoEm || 0) || null,
    };
  }

  function aplicarRegistroNaMensagem(msg, registro) {
    if (!msg || !registro?.texto) {
      return false;
    }

    msg.documentoIATexto = registro.texto;
    msg.documentoIAFileName = registro.fileName || msg.fileName || null;
    msg.documentoIATotalPaginas = registro.totalPaginas || null;
    msg.documentoIAPaginasComTexto = registro.paginasComTexto || null;
    msg.documentoIACaracteresExtraidos = registro.caracteresExtraidos || null;
    msg.documentoIATruncado = !!registro.truncado;
    msg.documentoIAErro = null;
    msg.documentoIAOcrNecessario = false;

    return true;
  }

  function hidratarDocumentoDoCache(msg) {
    if (!mensagemSuportaLeituraDocumentoIA(msg)) {
      return false;
    }

    const atual = String(msg?.documentoIATexto || "").trim();

    if (atual) {
      return true;
    }

    return aplicarRegistroNaMensagem(msg, obterRegistroCache(msg));
  }

  function persistirDocumento(msg, resultado = {}) {
    const id = idMensagemDocumento(msg);
    const texto = String(resultado?.texto || resultado?.textoExtraido || "")
      .trim()
      .slice(0, MAX_TEXTO_CACHE);

    if (!id || !texto) {
      return false;
    }

    const registro = {
      texto,
      fileName:
        String(resultado?.fileName || msg?.fileName || "").trim() || null,
      totalPaginas: Math.max(0, Number(resultado?.totalPaginas || 0) || 0),
      paginasComTexto: Math.max(
        0,
        Number(resultado?.paginasComTexto || 0) || 0,
      ),
      caracteresExtraidos: Math.max(
        0,
        Number(resultado?.caracteresExtraidos || 0) || 0,
      ),
      truncado: !!resultado?.truncado,
      atualizadoEm: Date.now(),
    };

    cacheDocumentos[id] = registro;
    salvarCache();
    aplicarRegistroNaMensagem(msg, registro);

    return true;
  }

  async function garantirArquivoDocumento(conversa, msg) {
    const caminhoExistente = String(msg?.mediaPath || "").trim();

    if (!conversa?.id || !msg?.idMensagem) {
      return !!caminhoExistente;
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
        msg.documentoIAErro =
          resultado?.erro || "Documento indisponivel para leitura.";
        return false;
      }

      msg.mediaPath = resultado.mediaPath;
      msg.mediaUrl = resultado.mediaUrl || msg.mediaUrl || null;
      msg.mime = resultado.mime || msg.mime || null;
      msg.fileName = resultado.fileName || msg.fileName || null;
      msg.erroMidia = null;

      return true;
    } catch (erro) {
      msg.documentoIAErro =
        erro?.message || "Documento indisponivel para leitura.";
      return false;
    }
  }

  let pdfJsDocumentoIA = null;

  function carregarPdfJsDocumentoIA() {
    if (pdfJsDocumentoIA) {
      return pdfJsDocumentoIA;
    }

    try {
      const fs = require("fs");
      const path = require("path");
      const raizPdfParse = path.dirname(require.resolve("pdf-parse"));
      const raizPdfJs = path.join(raizPdfParse, "lib", "pdf.js");
      const candidatos = [];

      if (fs.existsSync(raizPdfJs)) {
        const versoes = fs
          .readdirSync(raizPdfJs, { withFileTypes: true })
          .filter((item) => item?.isDirectory?.())
          .map((item) => item.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

        for (const versao of versoes) {
          candidatos.push(path.join(raizPdfJs, versao, "build", "pdf.js"));
        }
      }

      for (const candidato of candidatos) {
        if (!fs.existsSync(candidato)) {
          continue;
        }

        const modulo = require(candidato);

        if (modulo?.getDocument) {
          try {
            const workerPath = path.join(
              path.dirname(candidato),
              "pdf.worker.js",
            );

            if (modulo?.GlobalWorkerOptions && fs.existsSync(workerPath)) {
              modulo.GlobalWorkerOptions.workerSrc = workerPath;
            }

            if (Object.prototype.hasOwnProperty.call(modulo, "disableWorker")) {
              modulo.disableWorker = true;
            }
          } catch {}

          pdfJsDocumentoIA = modulo;
          return pdfJsDocumentoIA;
        }
      }
    } catch {}

    return null;
  }

  function viewportPaginaDocumentoIA(pagina, escala) {
    let viewport = null;

    try {
      viewport = pagina.getViewport({ scale: escala });

      const largura = Number(viewport?.width);
      const altura = Number(viewport?.height);

      if (
        Number.isFinite(largura) &&
        largura > 0 &&
        Number.isFinite(altura) &&
        altura > 0
      ) {
        return viewport;
      }
    } catch {}

    viewport = pagina.getViewport(escala);

    const largura = Number(viewport?.width);
    const altura = Number(viewport?.height);

    if (
      !Number.isFinite(largura) ||
      largura <= 0 ||
      !Number.isFinite(altura) ||
      altura <= 0
    ) {
      throw new Error("Nao foi possivel calcular o tamanho da pagina do PDF.");
    }

    return viewport;
  }

  async function renderizarPdfImagemParaDocumentoIA(mediaPath) {
    const fs = require("fs");
    const pdfjs = carregarPdfJsDocumentoIA();

    if (!pdfjs?.getDocument) {
      return {
        ok: false,
        erro: "O renderizador de PDF por imagem nao esta disponivel.",
      };
    }

    let documentoPdf = null;

    try {
      const buffer = fs.readFileSync(mediaPath);
      const dados = new Uint8Array(buffer);
      const carregamento = pdfjs.getDocument({
        data: dados,
        disableWorker: true,
      });
      documentoPdf = await (carregamento?.promise || carregamento);

      const totalPaginas = Math.max(
        0,
        Number(documentoPdf?.numPages || 0) || 0,
      );
      const MAX_PAGINAS_OCR = 15;
      const paginasParaLer = Math.min(totalPaginas, MAX_PAGINAS_OCR);
      const paginas = [];

      for (let numero = 1; numero <= paginasParaLer; numero += 1) {
        const pagina = await documentoPdf.getPage(numero);
        const viewportBase = viewportPaginaDocumentoIA(pagina, 1);
        const larguraBase = Math.max(1, Number(viewportBase?.width || 0) || 1);
        const escala = Math.max(1.2, Math.min(2.5, 1500 / larguraBase));
        const viewport = viewportPaginaDocumentoIA(pagina, escala);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const contexto = canvas.getContext("2d", { alpha: false });

        if (!contexto) {
          return {
            ok: false,
            erro: "Nao foi possivel preparar a pagina do PDF para leitura visual.",
          };
        }

        contexto.fillStyle = "#ffffff";
        contexto.fillRect(0, 0, canvas.width, canvas.height);

        const tarefa = pagina.render({
          canvasContext: contexto,
          viewport,
        });
        await (tarefa?.promise || tarefa);

        paginas.push({
          pagina: numero,
          dataUrl: canvas.toDataURL("image/jpeg", 0.9),
        });

        canvas.width = 1;
        canvas.height = 1;
        pagina?.cleanup?.();
      }

      console.log(
        `[DOCUMENTO IA] OCR_RENDER | pages=${paginas.length} | total=${totalPaginas} | truncado=${totalPaginas > paginas.length}`,
      );

      return {
        ok: paginas.length > 0,
        paginas,
        totalPaginas,
        truncado: totalPaginas > paginas.length,
        erro: paginas.length ? null : "O PDF nao possui paginas renderizaveis.",
      };
    } catch (erro) {
      return {
        ok: false,
        erro:
          erro?.message ||
          "Nao foi possivel renderizar o PDF para leitura visual.",
      };
    } finally {
      try {
        documentoPdf?.cleanup?.();
      } catch {}
      try {
        documentoPdf?.destroy?.();
      } catch {}
    }
  }

  async function lerPdfImagemComVisaoIA(conversa, msg) {
    const renderizado = await renderizarPdfImagemParaDocumentoIA(
      String(msg?.mediaPath || ""),
    );

    if (!renderizado?.ok || !renderizado.paginas?.length) {
      return {
        ok: false,
        ocrNecessario: true,
        erro:
          renderizado?.erro ||
          "Nao foi possivel preparar o PDF escaneado para leitura.",
      };
    }

    const textos = [];
    const paginas = renderizado.paginas;
    const MAX_IMAGENS_POR_CHAMADA = 5;

    for (
      let inicio = 0;
      inicio < paginas.length;
      inicio += MAX_IMAGENS_POR_CHAMADA
    ) {
      const lote = paginas.slice(inicio, inicio + MAX_IMAGENS_POR_CHAMADA);
      let resultado;

      try {
        resultado = await ipcRenderer.invoke(
          "interpretar-documento-imagem-ia",
          {
            conversaId: String(conversa?.id || ""),
            idMensagem: idMensagemDocumento(msg),
            fileName: String(msg?.fileName || "documento.pdf"),
            paginas: lote,
          },
        );
      } catch (erro) {
        return {
          ok: false,
          ocrNecessario: true,
          erro: erro?.message || "A leitura visual do PDF falhou.",
        };
      }

      const textoLote = String(resultado?.texto || "").trim();

      if (!resultado?.ok || !textoLote) {
        return {
          ok: false,
          ocrNecessario: true,
          erro:
            resultado?.erro ||
            "Nao foi possivel extrair o texto visual deste PDF.",
        };
      }

      textos.push(textoLote);
    }

    const textoCompleto = textos.join("\n\n").trim();
    const texto = textoCompleto.slice(0, MAX_TEXTO_CACHE);
    const truncado =
      !!renderizado.truncado || textoCompleto.length > MAX_TEXTO_CACHE;

    console.log(
      `[DOCUMENTO IA] OCR_OK | file=${String(msg?.fileName || "documento.pdf")
        .replace(/[^\x20-\x7E]/g, "")
        .slice(
          0,
          160,
        )} | pages=${paginas.length} | chars=${textoCompleto.length} | truncado=${truncado}`,
    );

    return {
      ok: true,
      texto,
      fileName: String(msg?.fileName || "documento.pdf"),
      totalPaginas: Math.max(
        0,
        Number(renderizado?.totalPaginas || paginas.length) || paginas.length,
      ),
      paginasComTexto: paginas.length,
      caracteresExtraidos: textoCompleto.length,
      truncado,
      ocr: true,
    };
  }

  async function lerMensagemDocumentoIA(conversa, msg) {
    if (!mensagemSuportaLeituraDocumentoIA(msg)) {
      return {
        ok: true,
        aplicavel: false,
        texto: "",
      };
    }

    if (hidratarDocumentoDoCache(msg)) {
      return {
        ok: true,
        aplicavel: true,
        cache: true,
        texto: String(msg.documentoIATexto || ""),
      };
    }

    const id = idMensagemDocumento(msg);

    if (leiturasEmAndamento.has(id)) {
      return leiturasEmAndamento.get(id);
    }

    const promessa = (async () => {
      if (!(await garantirArquivoDocumento(conversa, msg))) {
        return {
          ok: false,
          aplicavel: true,
          erro: msg.documentoIAErro || "Documento indisponivel para leitura.",
        };
      }

      try {
        let resultado = await ipcRenderer.invoke("ler-documento-ia", {
          conversaId: String(conversa?.id || ""),
          idMensagem: id,
          mediaPath: String(msg.mediaPath || ""),
          mime: String(msg.mime || ""),
          fileName: String(msg.fileName || ""),
        });

        let texto = String(
          resultado?.texto || resultado?.textoExtraido || "",
        ).trim();

        if ((!resultado?.ok || !texto) && resultado?.ocrNecessario) {
          resultado = await lerPdfImagemComVisaoIA(conversa, msg);
          texto = String(
            resultado?.texto || resultado?.textoExtraido || "",
          ).trim();
        }

        if (!resultado?.ok || !texto) {
          msg.documentoIAErro =
            resultado?.erro || "Nao foi possivel ler o documento.";
          msg.documentoIAOcrNecessario = !!resultado?.ocrNecessario;

          return {
            ok: false,
            aplicavel: true,
            ocrNecessario: !!resultado?.ocrNecessario,
            erro: msg.documentoIAErro,
          };
        }

        persistirDocumento(msg, resultado);

        return {
          ok: true,
          aplicavel: true,
          cache: false,
          texto: String(msg.documentoIATexto || texto),
          totalPaginas: resultado?.totalPaginas || null,
          paginasComTexto: resultado?.paginasComTexto || null,
          caracteresExtraidos: resultado?.caracteresExtraidos || null,
          truncado: !!resultado?.truncado,
        };
      } catch (erro) {
        msg.documentoIAErro =
          erro?.message || "Nao foi possivel ler o documento.";

        return {
          ok: false,
          aplicavel: true,
          erro: msg.documentoIAErro,
        };
      }
    })();

    leiturasEmAndamento.set(id, promessa);

    try {
      return await promessa;
    } finally {
      leiturasEmAndamento.delete(id);
    }
  }

  function timestampMensagemMs(msg) {
    const valor = Number(msg?.timestamp || 0) || 0;

    if (!valor) {
      return 0;
    }

    return valor < 1_000_000_000_000 ? valor * 1000 : valor;
  }

  function indiceMensagemNaConversa(conversa, mensagemAtual) {
    const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];

    if (!lista.length || !mensagemAtual) {
      return -1;
    }

    const idAtual = idMensagemDocumento(mensagemAtual);

    if (idAtual) {
      for (let i = lista.length - 1; i >= 0; i -= 1) {
        if (String(lista[i]?.idMensagem || "").trim() === idAtual) {
          return i;
        }
      }
    }

    return lista.lastIndexOf(mensagemAtual);
  }

  function localizarDocumentoRelacionadoIA(
    conversa,
    mensagemAtual,
    opcoes = {},
  ) {
    if (!conversa || !mensagemAtual) {
      return null;
    }

    if (mensagemSuportaLeituraDocumentoIA(mensagemAtual)) {
      return {
        documento: mensagemAtual,
        motivo: "documento-atual",
        documentoAtual: true,
      };
    }

    const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
    const indiceAtual = indiceMensagemNaConversa(conversa, mensagemAtual);

    if (indiceAtual <= 0) {
      return null;
    }

    const agoraMensagem = timestampMensagemMs(mensagemAtual) || Date.now();
    const JANELA_VINCULO_DIRETO_MS = 2 * 60 * 1000;
    const JANELA_CONTINUACAO_MS = 30 * 60 * 1000;
    const MAX_MENSAGENS_CONTINUACAO = 14;

    let anteriorRelevante = null;

    for (let i = indiceAtual - 1; i >= 0; i -= 1) {
      const item = lista[i];

      if (!item || item.apagadaParaTodos || item.tipo === "apagada") {
        continue;
      }

      anteriorRelevante = item;
      break;
    }

    if (
      anteriorRelevante &&
      mensagemSuportaLeituraDocumentoIA(anteriorRelevante)
    ) {
      const timestampDocumento = timestampMensagemMs(anteriorRelevante);
      const diferenca = timestampDocumento
        ? Math.max(0, agoraMensagem - timestampDocumento)
        : 0;

      if (!timestampDocumento || diferenca <= JANELA_VINCULO_DIRETO_MS) {
        return {
          documento: anteriorRelevante,
          motivo: "sequencia-direta",
          documentoAtual: false,
        };
      }
    }

    if (!opcoes?.permitirContinuacao) {
      return null;
    }

    let vistas = 0;

    for (
      let i = indiceAtual - 1;
      i >= 0 && vistas < MAX_MENSAGENS_CONTINUACAO;
      i -= 1
    ) {
      const item = lista[i];

      if (!item || item.apagadaParaTodos || item.tipo === "apagada") {
        continue;
      }

      vistas += 1;

      if (!mensagemSuportaLeituraDocumentoIA(item)) {
        continue;
      }

      const timestampDocumento = timestampMensagemMs(item);
      const diferenca = timestampDocumento
        ? Math.max(0, agoraMensagem - timestampDocumento)
        : 0;

      if (timestampDocumento && diferenca > JANELA_CONTINUACAO_MS) {
        return null;
      }

      return {
        documento: item,
        motivo: "continuacao",
        documentoAtual: false,
      };
    }

    return null;
  }

  function limitarTextoDocumentoComparacaoIA(texto, limite = 6000) {
    const valor = String(texto || "").trim();
    const maximo = Math.max(1200, Number(limite || 0) || 6000);

    if (!valor || valor.length <= maximo) {
      return valor;
    }

    const marcador =
      "\n[...trecho intermediario omitido para economizar contexto...]\n";
    const disponivel = Math.max(800, maximo - marcador.length);
    const inicio = Math.ceil(disponivel * 0.58);
    const fim = Math.max(400, disponivel - inicio);

    return `${valor.slice(0, inicio).trimEnd()}${marcador}${valor
      .slice(-fim)
      .trimStart()}`.trim();
  }

  function coletarDocumentosComparaveisIA(
    conversa,
    documentoPrincipal,
    opcoes = {},
  ) {
    if (!opcoes?.incluirComparaveis || !conversa || !documentoPrincipal) {
      return [];
    }

    const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
    const indicePrincipal = indiceMensagemNaConversa(
      conversa,
      documentoPrincipal,
    );

    if (indicePrincipal <= 0) {
      return [];
    }

    // O conjunto documental e definido pela estrutura da conversa, nao por
    // palavras-chave da pergunta. Mantemos somente documentos proximos do
    // principal para permitir comparacoes sem poluir todo o contexto antigo.
    const MAX_DOCUMENTOS_ANTERIORES = 3;
    const MAX_MENSAGENS_ENTRE_DOCUMENTOS = 10;
    const JANELA_DOCUMENTAL_MS = 45 * 60 * 1000;
    const timestampPrincipal =
      timestampMensagemMs(documentoPrincipal) || Date.now();
    const encontrados = [];
    let mensagensVistas = 0;

    for (
      let i = indicePrincipal - 1;
      i >= 0 &&
      mensagensVistas < MAX_MENSAGENS_ENTRE_DOCUMENTOS &&
      encontrados.length < MAX_DOCUMENTOS_ANTERIORES;
      i -= 1
    ) {
      const item = lista[i];

      if (!item || item.apagadaParaTodos || item.tipo === "apagada") {
        continue;
      }

      mensagensVistas += 1;

      if (!mensagemSuportaLeituraDocumentoIA(item)) {
        continue;
      }

      const timestampItem = timestampMensagemMs(item);
      const diferenca = timestampItem
        ? Math.max(0, timestampPrincipal - timestampItem)
        : 0;

      if (timestampItem && diferenca > JANELA_DOCUMENTAL_MS) {
        break;
      }

      hidratarDocumentoDoCache(item);

      const texto = String(item?.documentoIATexto || "").trim();

      // Documento anterior so entra no prompt se ele ja tiver sido lido e
      // estiver no cache. Nao disparamos downloads/leitura retroativa aqui.
      if (!texto) {
        continue;
      }

      encontrados.push({
        documento: item,
        documentoId: idMensagemDocumento(item),
        fileName: String(
          item?.documentoIAFileName || item?.fileName || "documento.pdf",
        ).trim(),
        texto: limitarTextoDocumentoComparacaoIA(texto, 6000),
        totalPaginas: Math.max(
          0,
          Number(item?.documentoIATotalPaginas || 0) || 0,
        ),
      });
    }

    return encontrados;
  }

  function montarContextoDocumentosComparaveisIA(resultado) {
    const anteriores = Array.isArray(resultado?.documentosComparaveis)
      ? resultado.documentosComparaveis
      : [];

    if (!anteriores.length) {
      return "";
    }

    return anteriores
      .map((item, indice) => {
        const nome = String(item?.fileName || "documento.pdf").trim();
        const paginas = Math.max(0, Number(item?.totalPaginas || 0) || 0);
        const cabecalho = paginas
          ? `[Documento anterior ${indice + 1} disponivel para comparacao: ${nome}, ${paginas} pagina${paginas === 1 ? "" : "s"}]`
          : `[Documento anterior ${indice + 1} disponivel para comparacao: ${nome}]`;
        const texto = String(item?.texto || "").trim();

        return texto ? `${cabecalho}\n${texto}`.trim() : cabecalho;
      })
      .join("\n\n");
  }

  async function prepararContextoDocumentoRelacionadoIA(
    conversa,
    mensagemAtual,
    opcoes = {},
  ) {
    const vinculo = localizarDocumentoRelacionadoIA(
      conversa,
      mensagemAtual,
      opcoes,
    );

    if (!vinculo?.documento) {
      return {
        ok: true,
        aplicavel: false,
      };
    }

    const leitura = await lerMensagemDocumentoIA(conversa, vinculo.documento);
    const documentosComparaveis = leitura?.ok
      ? coletarDocumentosComparaveisIA(conversa, vinculo.documento, opcoes)
      : [];

    return {
      ...(leitura || {}),
      aplicavel: !!leitura?.aplicavel,
      documento: vinculo.documento,
      documentoId: idMensagemDocumento(vinculo.documento),
      documentoAtual: !!vinculo.documentoAtual,
      motivo: vinculo.motivo,
      documentosComparaveis,
    };
  }

  function montarContextoDocumentoRelacionadoIA(resultado) {
    if (!resultado?.ok || !resultado?.aplicavel || !resultado?.documento) {
      return "";
    }

    const documento = resultado.documento;
    hidratarDocumentoDoCache(documento);

    return montarTextoMensagemComContextoDocumentoIA(documento, "");
  }

  function montarTextoMensagemComDocumentoRelacionadoIA(
    resultado,
    textoBase = "",
  ) {
    const base = String(textoBase || "").trim();
    const contextoPrincipal = montarContextoDocumentoRelacionadoIA(resultado);

    if (!contextoPrincipal) {
      return base;
    }

    const contextoComparaveis =
      montarContextoDocumentosComparaveisIA(resultado);
    const orientacao = contextoComparaveis
      ? "[Contexto documental: o primeiro documento abaixo e o documento principal da conversa atual. Os documentos anteriores ficam disponiveis somente para tarefas que realmente precisem cruzar, relacionar ou comparar informacoes entre documentos. Para uma pergunta sobre apenas o documento atual, priorize o principal e ignore os anteriores. Se a mensagem mudar de assunto, ignore todo o contexto documental.]"
      : "[Contexto documental recente: use o documento principal como fonte quando a mensagem atual se referir a ele. Se a mensagem atual tratar claramente de outro assunto, nao invente uma relacao com o documento.]";
    const blocoDocumental = contextoComparaveis
      ? `[DOCUMENTO PRINCIPAL]\n${contextoPrincipal}\n\n[DOCUMENTOS ANTERIORES DISPONIVEIS]\n${contextoComparaveis}`
      : `[DOCUMENTO PRINCIPAL]\n${contextoPrincipal}`;

    return base
      ? `${base}\n\n${orientacao}\n${blocoDocumental}`.trim()
      : `${orientacao}\n${blocoDocumental}`.trim();
  }

  async function prepararContextoDocumentoIA(conversa, mensagemAtual) {
    if (!conversa || !mensagemAtual) {
      return {
        ok: true,
        aplicavel: false,
      };
    }

    if (!mensagemSuportaLeituraDocumentoIA(mensagemAtual)) {
      return {
        ok: true,
        aplicavel: false,
      };
    }

    return lerMensagemDocumentoIA(conversa, mensagemAtual);
  }

  function montarTextoMensagemComContextoDocumentoIA(
    msg,
    textoBase = "",
    opcoes = {},
  ) {
    const base = String(textoBase || "").trim();

    if (!mensagemSuportaLeituraDocumentoIA(msg)) {
      return base;
    }

    hidratarDocumentoDoCache(msg);

    const textoDocumento = String(msg?.documentoIATexto || "").trim();

    if (!textoDocumento) {
      return base;
    }

    const nome = String(
      msg?.documentoIAFileName || msg?.fileName || "documento.pdf",
    ).trim();
    const paginas = Math.max(0, Number(msg?.documentoIATotalPaginas || 0) || 0);
    const cabecalho = paginas
      ? `[Documento PDF: ${nome}, ${paginas} pagina${paginas === 1 ? "" : "s"}]`
      : `[Documento PDF: ${nome}]`;
    const contexto = `${cabecalho}\n${textoDocumento}`.trim();

    if (base) {
      return `${base}\n${contexto}`.trim();
    }

    if (opcoes?.documentoAtualSemPergunta) {
      const orientacao =
        "[Orientacao interna: o contato enviou este documento sem uma " +
        "pergunta textual. Compreenda o conteudo, reconheca de forma breve " +
        "o que foi recebido sem inventar dados e pergunte o que ele gostaria " +
        "de saber sobre o documento.]";

      return `${orientacao}\n${contexto}`.trim();
    }

    return contexto;
  }

  return {
    prepararContextoDocumentoIA,
    prepararContextoDocumentoRelacionadoIA,
    montarTextoMensagemComContextoDocumentoIA,
    montarContextoDocumentoRelacionadoIA,
    montarTextoMensagemComDocumentoRelacionadoIA,
    mensagemSuportaLeituraDocumentoIA,
    hidratarDocumentoDoCache,
  };
}

module.exports = {
  criarModuloDocumentosIA,
};
