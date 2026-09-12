"use strict";

const { MATRIZ_TESTADOR_MESTRE_V1 } = require("./matriz-v1.js");
const { criarSegurancaTestador } = require("./seguranca.js");

function pass(detalhe, observado = null) {
  return { status: "PASS", detalhe, observado };
}

function warning(detalhe, observado = null) {
  return { status: "WARNING", detalhe, observado };
}

function fail(detalhe, observado = null) {
  return { status: "FAIL", detalhe, observado };
}

function skip(detalhe, observado = null) {
  return { status: "SKIP", detalhe, observado };
}

function numeroTexto(elemento) {
  if (!elemento) return null;
  const texto = String(elemento.textContent || "").replace(/\D/g, "");
  if (!texto) return 0;
  return Number(texto) || 0;
}

function jsonStorageValido(localStorage, chave) {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return { valido: true, vazio: true };
    const valor = JSON.parse(bruto);
    return {
      valido: !!valor && typeof valor === "object" && !Array.isArray(valor),
      vazio: false,
    };
  } catch {
    return { valido: false, vazio: false };
  }
}

function criarCatalogoTestes(deps = {}) {
  const {
    bridge,
    seguranca,
    executor,
    relatorio,
    document,
    window,
    localStorage,
    fs,
    path,
    obterAlvoTeste,
    hooksRenderer = {},
  } = deps;

  const implementacoes = new Map();
  const grupo = new Map();

  function implementar(id, grupoExecucao, executar, timeoutMs = undefined) {
    implementacoes.set(id, { executar, timeoutMs });
    grupo.set(id, grupoExecucao);
  }

  function esperar(ms) {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Number(ms || 0) || 0)),
    );
  }

  function lerJsonStorage(chave, fallback = {}) {
    try {
      const bruto = localStorage.getItem(chave);
      if (!bruto) return fallback;
      const valor = JSON.parse(bruto);
      return valor && typeof valor === "object" ? valor : fallback;
    } catch {
      return fallback;
    }
  }

  function backupStorage(chaves = []) {
    return Object.fromEntries(
      chaves.map((chave) => [chave, localStorage.getItem(chave)]),
    );
  }

  function restaurarStorage(backup = {}) {
    for (const [chave, valor] of Object.entries(backup)) {
      try {
        if (valor === null || valor === undefined) {
          localStorage.removeItem(chave);
        } else {
          localStorage.setItem(chave, valor);
        }
      } catch {}
    }
  }

  function conversaDiretaElegivel() {
    return (
      bridge
        .listarConversasSanitizadas()
        .find((item) => !item.tecnica && !item.trancada && !item.grupo) || null
    );
  }

  function grupoElegivel() {
    return (
      bridge
        .listarConversasSanitizadas()
        .find((item) => !item.tecnica && !item.trancada && item.grupo) || null
    );
  }

  function idSintetico(prefixo) {
    return `testador-mestre-${String(prefixo || "local")}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}@s.whatsapp.net`;
  }

  async function diagnosticoMain(acao = "snapshot") {
    return bridge.invokeLeitura("testador-mestre-diagnostico-main", { acao });
  }

  let promessaCicloStatusTeste = null;
  let resultadoCicloStatusTeste = null;

  function candidatosIdStatus(valor) {
    const texto = String(valor || "").trim();
    const saida = new Set();

    if (!texto) return saida;
    saida.add(texto);

    const partes = texto.split("_").filter(Boolean);
    const indiceBroadcast = partes.findIndex((parte) =>
      String(parte).toLowerCase().includes("status@broadcast"),
    );

    if (indiceBroadcast >= 0 && partes[indiceBroadcast + 1]) {
      saida.add(String(partes[indiceBroadcast + 1]).trim());
    }

    if (["out", "in"].includes(String(partes.at(-1) || "").toLowerCase())) {
      partes.pop();
    }

    const ultimo = String(partes.at(-1) || "").trim();
    if (ultimo && !ultimo.includes("@")) saida.add(ultimo);

    return new Set(Array.from(saida).filter(Boolean));
  }

  function statusMeuContemId(resultado, ids = []) {
    const mensagens = Array.isArray(resultado?.meuStatus?.mensagens)
      ? resultado.meuStatus.mensagens
      : [];
    const alvos = new Set();

    for (const id of ids) {
      for (const candidato of candidatosIdStatus(id)) alvos.add(candidato);
    }

    if (!alvos.size) return false;

    return mensagens.some((msg) => {
      const candidatos = new Set([
        ...candidatosIdStatus(msg?.idMensagem),
        ...candidatosIdStatus(msg?.idMensagemRaw),
      ]);
      return Array.from(candidatos).some((id) => alvos.has(id));
    });
  }

  async function listarStatusAte(condicao, tentativas = 6, intervaloMs = 900) {
    let ultimo = null;

    for (let i = 0; i < tentativas; i += 1) {
      ultimo = await bridge.invokeLeitura("listar-status-whatsapp");
      if (condicao(ultimo)) return ultimo;
      if (i < tentativas - 1) await esperar(intervaloMs);
    }

    return ultimo;
  }

  async function executarCicloStatusTeste() {
    if (resultadoCicloStatusTeste) return resultadoCicloStatusTeste;
    if (promessaCicloStatusTeste) return promessaCicloStatusTeste;

    promessaCicloStatusTeste = (async () => {
      const agora = new Date();
      const selo = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const textoTeste = `TESTADOR MESTRE\nStatus de texto automatico\n${agora.toLocaleString("pt-BR")}`;
      const legendaImagem = `Testador Mestre • imagem de teste • ${selo}`;
      const caminhoImagem = path.join(__dirname, "assets", "status-teste.png");
      const estado = {
        selo,
        texto: {
          publicado: false,
          nativo: false,
          verificado: false,
          verificadoImediato: false,
          removido: false,
          retorno: null,
          erro: null,
        },
        imagem: {
          publicado: false,
          verificado: false,
          verificadoImediato: false,
          removido: false,
          retorno: null,
          erro: null,
        },
        video: {
          indisponivel: true,
          publicado: false,
          verificado: false,
          verificadoImediato: false,
          removido: false,
          retorno: null,
          erro: "Recurso temporariamente indisponivel.",
        },
        limpeza: { ok: false, verificada: false, erros: [] },
        antes: null,
        depoisPublicacao: null,
        depoisLimpeza: null,
      };

      if (
        !fs.existsSync(caminhoImagem) ||
        fs.statSync(caminhoImagem).size <= 0
      ) {
        throw new Error(
          `Imagem fixa do Testador Mestre nao encontrada: ${caminhoImagem}`,
        );
      }


      const antes = await bridge.invokeLeitura("listar-status-whatsapp");
      estado.antes = {
        totalMeuStatus: Array.isArray(antes?.meuStatus?.mensagens)
          ? antes.meuStatus.mensagens.length
          : 0,
      };

      try {
        try {
          const retornoTexto = await bridge.invokeStatusTeste(
            "publicar-status-whatsapp",
            {
              tipo: "texto",
              texto: textoTeste,
              corFundo: "#005c4b",
            },
          );
          estado.texto.retorno = retornoTexto || null;
          estado.texto.publicado =
            !!retornoTexto?.ok &&
            !!(retornoTexto?.idMensagem || retornoTexto?.idMensagemRaw);
          estado.texto.nativo =
            retornoTexto?.via === "wppconnect-status-texto-nativo";
          if (!estado.texto.publicado) {
            estado.texto.erro =
              retornoTexto?.erro ||
              "Publicacao de texto nao retornou identificador.";
          }
        } catch (erro) {
          estado.texto.erro = erro?.message || String(erro);
        }

        try {
          const retornoImagem = await bridge.invokeStatusTeste(
            "publicar-status-whatsapp",
            {
              tipo: "imagem",
              caminho: caminhoImagem,
              legenda: legendaImagem,
            },
          );
          estado.imagem.retorno = retornoImagem || null;
          estado.imagem.publicado =
            !!retornoImagem?.ok &&
            !!(retornoImagem?.idMensagem || retornoImagem?.idMensagemRaw);
          if (!estado.imagem.publicado) {
            estado.imagem.erro =
              retornoImagem?.erro ||
              "Publicacao de imagem nao retornou identificador.";
          }
        } catch (erro) {
          estado.imagem.erro = erro?.message || String(erro);
        }


        if (estado.texto.publicado || estado.imagem.publicado) {
          const idsTexto = [
            estado.texto.retorno?.idMensagem,
            estado.texto.retorno?.idMensagemRaw,
          ].filter(Boolean);
          const idsImagem = [
            estado.imagem.retorno?.idMensagem,
            estado.imagem.retorno?.idMensagemRaw,
          ].filter(Boolean);

          const imediato = await bridge.invokeLeitura("listar-status-whatsapp");
          estado.texto.verificadoImediato =
            estado.texto.publicado && statusMeuContemId(imediato, idsTexto);
          estado.imagem.verificadoImediato =
            estado.imagem.publicado && statusMeuContemId(imediato, idsImagem);

          const todosImediatos =
            (!estado.texto.publicado || estado.texto.verificadoImediato) &&
            (!estado.imagem.publicado || estado.imagem.verificadoImediato);

          const depois = todosImediatos
            ? imediato
            : await listarStatusAte((resultado) => {
                const textoOk =
                  !estado.texto.publicado ||
                  statusMeuContemId(resultado, idsTexto);
                const imagemOk =
                  !estado.imagem.publicado ||
                  statusMeuContemId(resultado, idsImagem);
                return textoOk && imagemOk;
              });

          estado.depoisPublicacao = {
            totalMeuStatus: Array.isArray(depois?.meuStatus?.mensagens)
              ? depois.meuStatus.mensagens.length
              : 0,
            textoImediato: estado.texto.verificadoImediato,
            imagemImediata: estado.imagem.verificadoImediato,
          };
          estado.texto.verificado =
            estado.texto.publicado && statusMeuContemId(depois, idsTexto);
          estado.imagem.verificado =
            estado.imagem.publicado && statusMeuContemId(depois, idsImagem);
        }
      } finally {
        const apagar = async (chave) => {
          const item = estado[chave];
          const idMensagem = item?.retorno?.idMensagem || null;
          const idMensagemRaw = item?.retorno?.idMensagemRaw || null;

          if (!item?.publicado || (!idMensagem && !idMensagemRaw)) return;

          try {
            const retorno = await bridge.invokeStatusTeste(
              "apagar-status-whatsapp",
              {
                idMensagem,
                idMensagemRaw,
              },
            );
            item.removido = !!retorno?.ok;
            if (!item.removido) {
              estado.limpeza.erros.push(
                `${chave}: ${retorno?.erro || "remocao nao confirmada"}`,
              );
            }
          } catch (erro) {
            estado.limpeza.erros.push(`${chave}: ${erro?.message || erro}`);
          }
        };

        // A limpeza usa exclusivamente os IDs devolvidos pelas duas publicacoes acima.
        // Nunca procura nem apaga outro Status do usuario.
        await apagar("imagem");
        await apagar("texto");

        const idsTexto = [
          estado.texto.retorno?.idMensagem,
          estado.texto.retorno?.idMensagemRaw,
        ].filter(Boolean);
        const idsImagem = [
          estado.imagem.retorno?.idMensagem,
          estado.imagem.retorno?.idMensagemRaw,
        ].filter(Boolean);

        try {
          const depoisLimpeza = await listarStatusAte(
            (resultado) => {
              const textoSumiu =
                !estado.texto.publicado ||
                !statusMeuContemId(resultado, idsTexto);
              const imagemSumiu =
                !estado.imagem.publicado ||
                !statusMeuContemId(resultado, idsImagem);
              return textoSumiu && imagemSumiu;
            },
            6,
            800,
          );

          estado.depoisLimpeza = {
            totalMeuStatus: Array.isArray(depoisLimpeza?.meuStatus?.mensagens)
              ? depoisLimpeza.meuStatus.mensagens.length
              : 0,
          };
          estado.limpeza.verificada =
            (!estado.texto.publicado ||
              !statusMeuContemId(depoisLimpeza, idsTexto)) &&
            (!estado.imagem.publicado ||
              !statusMeuContemId(depoisLimpeza, idsImagem));
        } catch (erro) {
          estado.limpeza.erros.push(`verificacao: ${erro?.message || erro}`);
        }

        estado.limpeza.ok =
          (!estado.texto.publicado || estado.texto.removido) &&
          (!estado.imagem.publicado || estado.imagem.removido) &&
          estado.limpeza.verificada &&
          estado.limpeza.erros.length === 0;
      }

      resultadoCicloStatusTeste = estado;
      return estado;
    })().finally(() => {
      promessaCicloStatusTeste = null;
    });

    return promessaCicloStatusTeste;
  }

  implementar("TM-A001", "rapido", async () => {
    const singleton = window.__whatsiappTestadorMestre;
    return singleton?.instancias === 1
      ? pass(
          "Modulo carregado em instancia unica e separado do renderer-modules.",
          {
            versao: singleton.versao,
            instancias: singleton.instancias,
          },
        )
      : fail(
          "O singleton do Testador Mestre nao esta em estado unico.",
          singleton || null,
        );
  });

  implementar("TM-A002", "rapido", async () => {
    const refs = bridge.verificarReferenciasGlobais();
    return refs.ipcInvoke
      ? pass("ipcRenderer.invoke permaneceu com a referencia original.")
      : fail("A referencia de ipcRenderer.invoke foi alterada.", refs);
  });

  implementar("TM-A003", "rapido", async () => {
    const refs = bridge.verificarReferenciasGlobais();
    const chaves = [
      "consoleLog",
      "consoleWarn",
      "consoleError",
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
      "addEventListener",
      "removeEventListener",
    ];
    const alteradas = chaves.filter((chave) => refs[chave] === false);
    return alteradas.length
      ? fail("Uma ou mais APIs globais foram substituidas.", alteradas)
      : pass("Console, timers e EventTarget permanecem intactos.");
  });

  implementar("TM-A004", "rapido", async () => {
    const dom = bridge.snapshotDom();
    const instancias = Number(
      window.__whatsiappTestadorMestre?.instancias || 0,
    );
    return instancias === 1 && dom.testadorRoots <= 1
      ? pass("Nao ha segunda instancia visual ou logica do Testador Mestre.", {
          instancias,
          roots: dom.testadorRoots,
        })
      : fail("Foi detectada duplicacao do Testador Mestre.", {
          instancias,
          roots: dom.testadorRoots,
        });
  });

  implementar("TM-A005", "rapido", async () => {
    const chaves = bridge.listarChavesStorage("whatsiapp.testador.");
    const invalidas = chaves.filter(
      (chave) => !chave.startsWith("whatsiapp.testador."),
    );
    return invalidas.length
      ? fail(
          "Foi encontrada persistencia fora do namespace do testador.",
          invalidas,
        )
      : pass("Persistencias do testador usam namespace proprio.", chaves);
  });

  implementar("TM-A006", "rapido", async () => {
    const dir = relatorio.diretorioRelatorios();
    return /testador-mestre/i.test(String(dir || ""))
      ? pass("Relatorios usam diretorio temporario exclusivo do testador.", dir)
      : fail("Diretorio de relatorios nao esta isolado.", dir);
  });

  implementar("TM-A007", "rapido", async () =>
    executor.serial === true
      ? pass("Executor configurado em fila serial.")
      : fail("Executor nao esta marcado como serial."),
  );

  implementar("TM-A008", "rapido", async () =>
    Number(executor.timeoutPadraoMs || 0) > 0
      ? pass("Timeout individual esta ativo.", executor.timeoutPadraoMs)
      : fail("Timeout individual nao foi configurado."),
  );

  implementar("TM-A009", "rapido", async () =>
    typeof executor.cancelar === "function"
      ? pass("Cancelamento controlado da fila esta disponivel.")
      : fail("Executor nao expoe cancelamento controlado."),
  );

  implementar("TM-A010", "rapido", async () => {
    const possuiEscrita = Object.keys(bridge).some((chave) =>
      /escrita|corrigir|alterar|salvarCodigo|patch/i.test(chave),
    );
    return !possuiEscrita
      ? pass(
          "Bridge do Testador Mestre nao expoe mecanismo de correcao automatica.",
        )
      : fail("Bridge possui capacidade de escrita/correcao nao prevista.");
  });

  implementar("TM-A011", "rapido", async () => {
    const validacao = seguranca.validarExecucao(
      { id: "SELF-R3", tipo: "AUTO", risco: "R3" },
      "real",
    );
    return !validacao.permitido && validacao.codigo === "TM_R3_BLOCKED"
      ? pass("Barreira R3 recusou acao irreversivel automaticamente.")
      : fail("Barreira R3 nao bloqueou como esperado.", validacao);
  });

  implementar("TM-A012", "rapido", async () => {
    const guardSemAlvo = criarSegurancaTestador({ obterAlvoTeste: () => "" });
    const validacao = guardSemAlvo.validarExecucao(
      { id: "SELF-R2", tipo: "SEMI", risco: "R2" },
      "real",
    );
    return !validacao.permitido && validacao.codigo === "TM_TARGET_REQUIRED"
      ? pass("Barreira R2 exige conversa de teste configurada.")
      : fail("Barreira R2 nao exigiu alvo de teste.", validacao);
  });

  implementar(
    "TM-B001",
    "rapido",
    async () => {
      const inicio = Date.now();
      const estado = await bridge.invokeLeitura(
        "obter-sincronizacao-inicial-atual",
      );
      return pass("Processo principal respondeu ao IPC de leitura.", {
        duracaoMs: Date.now() - inicio,
        estado: estado || null,
      });
    },
    5000,
  );

  implementar("TM-B002", "rapido", async () => {
    const dom = bridge.snapshotDom();
    return dom.body && dom.listaConversas && dom.mensagens
      ? pass("Renderer, DOM base e ponte IPC estao disponiveis.", dom)
      : fail("Estrutura base do renderer esta incompleta.", dom);
  });

  implementar("TM-B005", "rapido", async () => {
    const conversas = bridge.listarConversasSanitizadas();
    const invalidas = conversas.filter(
      (item) => !item.id || !Array.isArray([]),
    );
    return !invalidas.length
      ? pass("Snapshot local de conversas possui estrutura valida.", {
          total: conversas.length,
          tecnicas: conversas.filter((item) => item.tecnica).length,
        })
      : fail(
          "Snapshot local possui conversas invalidas.",
          invalidas.slice(0, 5),
        );
  });

  implementar(
    "TM-B008",
    "rapido",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const fullReadyWpp = diag?.sincronizacao?.wppFullReady === true;
      return fullReadyWpp
        ? pass("WPPConnect FULL_READY real ja foi atingido.", {
            wppFullReady: true,
            ultimaEtapa: diag?.sincronizacao?.ultimaEtapa || null,
          })
        : warning(
            "WPPConnect ainda nao atingiu o FULL_READY real nesta execucao.",
            diag?.sincronizacao || null,
          );
    },
    5000,
  );

  implementar("TM-B012", "rapido", async () => {
    const estado = bridge.copiarEstadoRenderer();
    const dom = bridge.snapshotDom();
    if (estado.sincronizacaoConcluida) {
      return dom.overlaySincronizacao
        ? warning(
            "READY rapido concluiu, mas o overlay ainda esta em transicao de saida.",
            dom,
          )
        : pass("Overlay saiu apos o READY rapido, sem depender do FULL_READY completo do WPPConnect.");
    }
    return dom.overlaySincronizacao
      ? pass("READY rapido ainda nao concluiu e o overlay permanece presente.")
      : warning(
          "READY rapido nao consta como concluido, mas o overlay nao esta presente.",
          {
            estado,
            dom,
          },
        );
  });

  implementar(
    "TM-C001",
    "rapido",
    async () => {
      const inicio = Date.now();
      await bridge.invokeLeitura("obter-sincronizacao-inicial-atual");
      return pass("Ponte renderer-main respondeu sem erro.", {
        duracaoMs: Date.now() - inicio,
      });
    },
    5000,
  );

  implementar("TM-D001", "rapido", async () => {
    const dom = bridge.snapshotDom();
    const conversas = bridge.listarConversasSanitizadas();
    return dom.listaConversas
      ? pass("Lista principal existe e o estado de conversas pode ser lido.", {
          total: conversas.length,
          visiveisElegiveis: conversas.filter((item) => !item.tecnica).length,
        })
      : fail("Elemento da lista principal nao foi encontrado.");
  });

  implementar("TM-D003", "rapido", async () => {
    const conversas = bridge.listarConversasSanitizadas();
    const esperado = conversas
      .filter((item) => !item.tecnica && !item.trancada)
      .reduce((soma, item) => soma + item.naoLidasLocal, 0);
    const elemento = document.getElementById("contadorNaoLidas");
    const exibidoTexto = String(elemento?.textContent || "").trim();
    const exibido = numeroTexto(elemento);
    if (!elemento) return fail("Contador de nao lidas nao existe no DOM.");
    const coerente =
      esperado > 99 ? exibidoTexto === "99+" : exibido === esperado;
    return coerente
      ? pass("Contador de nao lidas coincide com o estado local.", {
          esperado,
          exibido: exibidoTexto || "0",
        })
      : warning("Contador visual e estado local diferem neste instante.", {
          esperado,
          exibido: exibidoTexto || "0",
        });
  });

  implementar("TM-D007", "rapido", async () => {
    const aba = document.getElementById("abaArquivadas");
    const contador = document.getElementById("contadorArquivadas");
    const total = bridge
      .listarConversasSanitizadas()
      .filter(
        (item) => !item.tecnica && item.arquivada && !item.trancada,
      ).length;
    return aba && contador
      ? pass("Aba Arquivadas e seu ponto de contador estao estruturados.", {
          totalArquivadasNoEstado: total,
        })
      : fail("Estrutura da aba Arquivadas esta incompleta.", {
          aba: !!aba,
          contador: !!contador,
        });
  });

  implementar("TM-D008", "rapido", async () => {
    const estado = bridge.copiarEstadoRenderer();
    const dom = bridge.snapshotDom();
    if (estado.trancadasLiberadas) {
      return skip(
        "Conversas trancadas estao liberadas nesta sessao, teste de ocultacao padrao nao se aplica.",
      );
    }
    return dom.trancadasHidden === true
      ? pass("Aba Trancadas esta oculta enquanto nao liberada.")
      : fail("Aba Trancadas esta visivel sem liberacao.", dom);
  });

  implementar("TM-D012", "rapido", async () => {
    const estado = bridge.copiarEstadoRenderer();
    const dom = bridge.snapshotDom();
    if (estado.conversaAtual) {
      return skip(
        "Ha uma conversa aberta, estado vazio nao se aplica agora.",
        estado.conversaAtual,
      );
    }
    return dom.compositorDisplay === "none"
      ? pass("Sem conversa ativa, o compositor esta oculto.")
      : warning(
          "Sem conversa ativa, mas o compositor nao esta explicitamente oculto.",
          dom,
        );
  });

  implementar("TM-K001", "rapido", async () => {
    const dom = bridge.snapshotDom();
    return dom.adminOverlay && dom.adminConteudo
      ? pass("Area de Configuracoes/Admin possui estrutura carregada.")
      : fail("Estrutura da area administrativa nao foi encontrada.", dom);
  });

  implementar("TM-K002", "rapido", async () => {
    const overlay = document.getElementById("adminOcultoOverlay");
    return overlay
      ? pass("Area administrativa esta inicializada e acessivel ao modulo.", {
          aberto: overlay.classList.contains("aberto"),
        })
      : fail("Overlay administrativo nao foi inicializado.");
  });

  implementar("TM-N001", "rapido", async () => {
    const dom = bridge.snapshotDom();
    return dom.respostaIA
      ? pass(
          "Painel de IA esta carregado, sem executar nenhuma chamada de modelo.",
        )
      : warning("Painel de IA nao foi localizado no DOM atual.");
  });

  implementar("TM-N002", "rapido", async () => {
    const validacao = jsonStorageValido(
      localStorage,
      "whatsiapp.ia.modosPorConversa.v1",
    );
    return validacao.valido
      ? pass(
          "Persistencia de modos da IA pode ser lida sem acionar IA.",
          validacao,
        )
      : fail("Persistencia de modos da IA esta com JSON invalido.");
  });

  implementar("TM-N003", "rapido", async () => {
    const validacao = jsonStorageValido(
      localStorage,
      "whatsiapp.ia.segundoPlanoPorConversa.v1",
    );
    return validacao.valido
      ? pass(
          "Persistencia de segundo plano pode ser lida sem acionar IA.",
          validacao,
        )
      : fail("Persistencia de segundo plano esta com JSON invalido.");
  });

  implementar("TM-N004", "rapido", async () => {
    const canaisLeituraSegurosIA = new Set(["status-uso-groq"]);
    const proibidos = bridge.canaisLeitura.filter(
      (canal) =>
        !canaisLeituraSegurosIA.has(String(canal || "")) &&
        /(groq|responder-ia|gerar|catalogo-buscar|web|clima|ocr|visao|transcrever|interpretar)/i.test(
          canal,
        ),
    );
    return proibidos.length
      ? fail(
          "Whitelist do Testador Mestre contem canal capaz de disparar IA.",
          proibidos,
        )
      : pass(
          "Whitelist do Testador Mestre nao possui canais de modelo, web, OCR ou visao.",
          bridge.canaisLeitura,
        );
  });

  implementar(
    "TM-B003",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("listar-grupos-whatsapp");
      const fonte = String(resultado?.fonte || "");
      if (!resultado?.ok)
        return fail(
          "Leitura de grupos nao confirmou disponibilidade do Baileys.",
          resultado,
        );
      return /baileys/i.test(fonte)
        ? pass("Baileys respondeu na leitura combinada de grupos.", {
            fonte,
            total: resultado.grupos?.length || 0,
          })
        : warning(
            "Leitura de grupos respondeu, mas a fonte nao identifica Baileys.",
            resultado,
          );
    },
    30000,
  );

  implementar(
    "TM-B004",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("listar-status-whatsapp");
      return resultado?.ok
        ? pass("WPPConnect respondeu a leitura de Status.", {
            feeds: Array.isArray(resultado.feeds)
              ? resultado.feeds.length
              : null,
          })
        : fail(
            "WPPConnect nao respondeu corretamente a leitura de Status.",
            resultado,
          );
    },
    30000,
  );

  implementar(
    "TM-C002",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("listar-grupos-whatsapp");
      return resultado && typeof resultado === "object"
        ? pass(
            "Ponte main-Baileys retornou resposta estruturada pela leitura combinada.",
            {
              ok: !!resultado.ok,
              fonte: resultado.fonte || null,
            },
          )
        : fail(
            "Resposta da ponte main-Baileys nao possui estrutura valida.",
            resultado,
          );
    },
    30000,
  );

  implementar(
    "TM-C003",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("listar-status-whatsapp");
      return resultado && typeof resultado === "object"
        ? pass("Ponte main-WPP retornou resposta estruturada.", {
            ok: !!resultado.ok,
          })
        : fail(
            "Resposta da ponte main-WPP nao possui estrutura valida.",
            resultado,
          );
    },
    30000,
  );

  implementar(
    "TM-G001",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura(
        "listar-contatos-salvos-whatsapp",
      );
      return resultado?.ok && Array.isArray(resultado.contatos)
        ? pass("Lista de contatos salvos retornou estrutura valida.", {
            total: resultado.contatos.length,
            fonte: resultado.fonte || null,
          })
        : fail("Nao foi possivel validar contatos salvos.", resultado);
    },
    30000,
  );

  implementar(
    "TM-G005",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("listar-grupos-whatsapp");
      return resultado?.ok && Array.isArray(resultado.grupos)
        ? pass("Lista de grupos atuais retornou estrutura valida.", {
            total: resultado.grupos.length,
            fonte: resultado.fonte || null,
          })
        : fail("Nao foi possivel validar grupos atuais.", resultado);
    },
    30000,
  );

  implementar(
    "TM-J001",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("listar-status-whatsapp");
      return resultado?.ok
        ? pass("Listagem de Status retornou estrutura valida.", {
            feeds: Array.isArray(resultado.feeds)
              ? resultado.feeds.length
              : null,
            meuStatus: !!resultado.meuStatus,
          })
        : fail("Nao foi possivel validar a listagem de Status.", resultado);
    },
    30000,
  );

  implementar(
    "TM-B006",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const marcos = Array.isArray(diag?.sincronizacao?.marcos)
        ? diag.sincronizacao.marcos
        : [];
      const conectado = marcos.some(
        (item) =>
          item?.origem === "baileys" && item?.etapa === "baileys-conectado",
      );
      return diag?.workers?.baileys?.ativo && conectado
        ? pass("Baileys esta ativo e o marco de conexao foi registrado.", {
            ativo: true,
            threadId: diag.workers.baileys.threadId,
          })
        : fail("Nao foi possivel confirmar a sessao ativa do Baileys.", {
            worker: diag?.workers?.baileys || null,
            conectado,
          });
    },
    5000,
  );

  implementar(
    "TM-B007",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const marcos = Array.isArray(diag?.sincronizacao?.marcos)
        ? diag.sincronizacao.marcos
        : [];
      const criouCliente = marcos.some(
        (item) =>
          item?.origem === "wpp" &&
          ["wpp-client", "wpp-ready"].includes(item?.etapa),
      );
      return diag?.workers?.wpp?.ativo && criouCliente
        ? pass("WPPConnect possui worker ativo e cliente inicializado.", {
            ativo: true,
            threadId: diag.workers.wpp.threadId,
          })
        : fail("Cliente WPPConnect nao foi confirmado.", {
            worker: diag?.workers?.wpp || null,
            criouCliente,
          });
    },
    5000,
  );

  implementar(
    "TM-B009",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      return diag?.sincronizacao?.wppRecepcaoAoVivoPronta === true
        ? pass("Recepcao ao vivo do WPPConnect esta ativa.")
        : fail(
            "WPPConnect nao consta como pronto para receber mensagens ao vivo.",
            diag?.sincronizacao || null,
          );
    },
    5000,
  );

  implementar(
    "TM-B010",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const marcos = Array.isArray(diag?.sincronizacao?.marcos)
        ? diag.sincronizacao.marcos
        : [];
      const chats = marcos.findIndex(
        (item) => item?.origem === "wpp" && item?.etapa === "wpp-chats-prontos",
      );
      const full = marcos.findIndex(
        (item) => item?.origem === "wpp" && item?.etapa === "full-ready",
      );
      const aliases = Number(diag?.estado?.privacidadeConhecida || 0) || 0;
      const ordemOk = chats >= 0 && full >= 0 && chats < full;
      return ordemOk && aliases > 0
        ? pass("Chats/aliases foram preparados antes da liberacao final.", {
            aliasesConhecidos: aliases,
            ordemOk,
          })
        : fail("A ordem de preparacao de aliases/chats nao foi confirmada.", {
            chats,
            full,
            aliases,
          });
    },
    5000,
  );

  implementar(
    "TM-B011",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const estado = diag?.estado || {};
      return estado.privacidadePronta && estado.privacidadeCompleta
        ? pass(
            "Estado de privacidade foi preparado antes da operacao normal.",
            {
              aliasesConhecidos: estado.privacidadeConhecida,
              arquivamentos: estado.arquivamentos,
              trancamentos: estado.trancamentos,
            },
          )
        : fail("Estado de privacidade ainda nao esta completo.", estado);
    },
    5000,
  );

  implementar(
    "TM-B013",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const proc = diag?.processo || {};
      return proc.telaPronta && Number(proc.eventosTelaPendentes || 0) === 0
        ? pass("Fila de eventos pre-render foi liberada completamente.", proc)
        : warning(
            "Ainda existem eventos de tela pendentes ou a tela nao consta como pronta.",
            proc,
          );
    },
    5000,
  );

  implementar(
    "TM-B014",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const marcos = Array.isArray(diag?.sincronizacao?.marcos)
        ? diag.sincronizacao.marcos
        : [];
      const obrigatorios = [
        "inicio",
        "worker-create",
        "worker-online",
        "conversas-iniciais",
        "baileys-conectado",
        "wpp-client",
        "wpp-full-ready-detectado",
        "wpp-chats-prontos",
        "full-ready",
      ];
      const presentes = new Set(
        marcos.map((item) => String(item?.etapa || "")),
      );
      const faltantes = obrigatorios.filter((item) => !presentes.has(item));
      const temposValidos = marcos.every(
        (item) =>
          Number.isFinite(Number(item?.emMs)) && Number(item?.emMs) >= 0,
      );
      return !faltantes.length && temposValidos
        ? pass(
            "Diagnostico de inicializacao possui os marcos obrigatorios e tempos validos.",
            {
              marcos: marcos.length,
              ultimoMs: Number(marcos.at(-1)?.emMs || 0) || 0,
            },
          )
        : fail("Diagnostico de inicializacao esta incompleto.", {
            faltantes,
            temposValidos,
          });
    },
    5000,
  );

  implementar(
    "TM-C004",
    "seguro",
    async () => {
      const resultado = await diagnosticoMain("correlacao-workers");
      const correlacaoOk =
        resultado?.ok === true &&
        Number.isFinite(Number(resultado?.grupos)) &&
        Number.isFinite(Number(resultado?.contatos));

      return correlacaoOk
        ? pass(
            "Duas solicitacoes concorrentes ao Baileys retornaram ao request correto.",
            {
              grupos: resultado.grupos,
              contatos: resultado.contatos,
              pendentesGlobaisDepois: Number(resultado?.pendentesDepois || 0),
            },
          )
        : fail(
            "A sonda de correlacao de requests nao fechou corretamente.",
            resultado,
          );
    },
    15000,
  );

  implementar(
    "TM-C005",
    "seguro",
    async () => {
      const resultado = await diagnosticoMain("acao-desconhecida");
      return resultado?.ok
        ? pass(
            "Acao desconhecida retornou erro controlado e o worker continuou respondendo.",
            {
              workerContinuaRespondendo: resultado.workerContinuaRespondendo,
            },
          )
        : fail(
            "Acao desconhecida nao foi tratada de forma controlada.",
            resultado,
          );
    },
    15000,
  );

  implementar(
    "TM-C007",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const worker = diag?.workers?.baileys || {};
      return worker.ativo && Number(worker.threadId || 0) > 0
        ? pass("Existe uma unica referencia funcional para o worker Baileys.", {
            threadId: worker.threadId,
          })
        : fail("Worker Baileys nao possui referencia funcional unica.", worker);
    },
    5000,
  );

  implementar(
    "TM-C008",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const wpp = diag?.workers?.wpp || {};
      const baileys = diag?.workers?.baileys || {};
      const distintos =
        Number(wpp.threadId || 0) > 0 &&
        Number(baileys.threadId || 0) > 0 &&
        Number(wpp.threadId) !== Number(baileys.threadId);
      return wpp.ativo && distintos
        ? pass(
            "WPPConnect possui uma unica referencia funcional e thread propria.",
            {
              threadId: wpp.threadId,
            },
          )
        : fail("Referencia do worker WPPConnect nao esta consistente.", {
            wpp,
            baileys,
            distintos,
          });
    },
    5000,
  );

  implementar("TM-D002", "seguro", async () => {
    const estado = new Map(
      bridge.listarConversasSanitizadas().map((item) => [item.id, item]),
    );
    const itensDom = Array.from(
      document.querySelectorAll?.("#listaConversas [data-conversa-id]") || [],
    );
    if (itensDom.length < 2) {
      return skip(
        "Lista visivel possui menos de duas conversas para validar a ordenacao real.",
      );
    }
    const tempos = itensDom
      .map((item) => estado.get(String(item?.dataset?.conversaId || "")))
      .filter(Boolean)
      .map(
        (item) =>
          Number(item?.ultimaMensagem?.timestamp || item?.timestamp || 0) || 0,
      );
    const monotona = tempos.every(
      (tempo, indice) => indice === 0 || tempos[indice - 1] >= tempo,
    );
    return monotona
      ? pass(
          "A ordem atualmente renderizada na lista segue atividade decrescente.",
          {
            itensVerificados: tempos.length,
          },
        )
      : fail(
          "A lista renderizada possui conversa fora da ordem de atividade.",
          {
            itensVerificados: tempos.length,
          },
        );
  });

  implementar("TM-D004", "seguro", async () => {
    const lista = bridge.listarConversasSanitizadas();
    const elegiveis = lista.filter(
      (item) =>
        !item.tecnica && !item.trancada && Number(item.naoLidasLocal || 0) > 0,
    );
    const invalidas = elegiveis.filter(
      (item) =>
        item.tecnica || item.trancada || Number(item.naoLidasLocal || 0) <= 0,
    );
    return !invalidas.length
      ? pass(
          "Conjunto elegivel da aba Nao lidas respeita privacidade e contador.",
          {
            totalElegiveis: elegiveis.length,
          },
        )
      : fail(
          "A selecao de Nao lidas incluiu conversa inelegivel.",
          invalidas.slice(0, 5),
        );
  });

  implementar("TM-D005", "seguro", async () => {
    const conversas = new Map(
      bridge.listarConversasSanitizadas().map((item) => [item.id, item]),
    );
    const favoritos = lerJsonStorage("whatsiapp.favoritosMensagens.v1", {});
    const esperado = Object.values(favoritos).filter((fav) => {
      const conversa = conversas.get(String(fav?.conversaId || ""));
      return !!(conversa && !conversa.tecnica && !conversa.trancada);
    }).length;
    let calculado = null;
    try {
      calculado = Number(hooksRenderer?.totalFavoritosVisiveis?.());
    } catch {}
    return Number.isFinite(calculado) && calculado === esperado
      ? pass("Favoritos visiveis excluem conversas tecnicas e trancadas.", {
          esperado,
          calculado,
        })
      : warning(
          "Nao foi possivel confirmar integralmente o filtro de Favoritos.",
          {
            esperado,
            calculado,
          },
        );
  });

  implementar(
    "TM-D006",
    "seguro",
    async () => {
      const [estado, remoto] = await Promise.all([
        Promise.resolve(bridge.listarConversasSanitizadas()),
        bridge.invokeLeitura("listar-grupos-whatsapp"),
      ]);
      if (!remoto?.ok || !Array.isArray(remoto.grupos)) {
        return fail("Nao foi possivel obter a lista real de grupos.", remoto);
      }
      const idsAtuais = new Set(
        remoto.grupos.map((item) => String(item?.id || "")).filter(Boolean),
      );
      const locaisGrupos = estado.filter((item) => item.grupo && !item.tecnica);
      const presentes = locaisGrupos.filter((item) =>
        idsAtuais.has(item.id),
      ).length;
      return pass(
        "A selecao de grupos usa somente conversas marcadas como grupo e pode ser cruzada com o WhatsApp.",
        {
          gruposRemotos: idsAtuais.size,
          gruposLocais: locaisGrupos.length,
          cruzados: presentes,
        },
      );
    },
    30000,
  );

  implementar(
    "TM-D009",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura(
        "listar-contatos-salvos-whatsapp",
      );
      const contato = Array.isArray(resultado?.contatos)
        ? resultado.contatos.find(
            (item) => String(item?.nome || "").trim().length >= 4,
          )
        : null;
      if (!contato)
        return skip(
          "Nenhum contato adequado disponivel para validar busca por nome.",
        );
      const nome = bridge.normalizarBusca(contato.nome);
      const consulta = bridge.normalizarBusca(
        String(contato.nome).slice(
          0,
          Math.max(2, Math.floor(String(contato.nome).length / 2)),
        ),
      );
      return nome.includes(consulta)
        ? pass(
            "Normalizacao usada pela busca encontra contato independentemente de caixa/acento.",
            {
              contatoTestado: true,
            },
          )
        : fail(
            "Normalizacao de busca por nome nao encontrou o proprio contato.",
          );
    },
    30000,
  );

  implementar("TM-D010", "seguro", async () => {
    const mensagens = bridge
      .listarMensagensSanitizadas(3000)
      .filter(
        (item) =>
          !item.tecnica &&
          !item.trancada &&
          String(item.texto || "").trim().length >= 6,
      );
    const origem = mensagens.find((item) => {
      const palavras = bridge
        .normalizarBusca(item.texto)
        .split(/\s+/)
        .filter((p) => p.length >= 4);
      return palavras.length > 0;
    });
    if (!origem)
      return skip(
        "Nenhuma mensagem textual adequada foi encontrada para a busca segura.",
      );
    const termo = bridge
      .normalizarBusca(origem.texto)
      .split(/\s+/)
      .find((p) => p.length >= 4);
    const encontrados = mensagens.filter((item) =>
      bridge
        .normalizarBusca(`${item.texto || ""} ${item.fileName || ""}`)
        .includes(termo),
    );
    const contemOrigem = encontrados.some(
      (item) =>
        item.conversaId === origem.conversaId &&
        item.idMensagem === origem.idMensagem,
    );
    return contemOrigem
      ? pass(
          "Busca textual sobre mensagens carregadas reencontra a mensagem de origem.",
          {
            resultados: encontrados.length,
          },
        )
      : fail("Busca textual nao reencontrou a mensagem usada como amostra.");
  });

  implementar(
    "TM-G002",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura(
        "listar-contatos-salvos-whatsapp",
      );
      const contatos = Array.isArray(resultado?.contatos)
        ? resultado.contatos
        : [];
      if (!resultado?.ok || !contatos.length) {
        return skip(
          "Lista de contatos vazia, busca de contato nao se aplica agora.",
        );
      }
      const alvo =
        contatos.find((item) => String(item?.nome || "").trim().length >= 3) ||
        contatos[0];
      const termo = bridge.normalizarBusca(
        String(alvo?.nome || "").slice(0, 3),
      );
      const encontrados = contatos.filter((item) =>
        bridge
          .normalizarBusca(
            `${item?.nome || ""} ${item?.numeroWhatsapp || item?.id || ""}`,
          )
          .includes(termo),
      );
      return encontrados.some(
        (item) => String(item?.id || "") === String(alvo?.id || ""),
      )
        ? pass(
            "Busca sobre contatos salvos reencontra o contato usado como amostra.",
            {
              totalResultados: encontrados.length,
            },
          )
        : fail("Busca de contatos nao reencontrou o contato de referencia.");
    },
    30000,
  );

  implementar(
    "TM-G006",
    "seguro",
    async () => {
      const grupos = await bridge.invokeLeitura("listar-grupos-whatsapp");
      const grupo = Array.isArray(grupos?.grupos)
        ? grupos.grupos.find((item) => item?.id)
        : null;
      if (!grupo)
        return skip(
          "Nenhum grupo atual disponivel para validar participantes.",
        );
      const resultado = await bridge.invokeLeitura(
        "listar-participantes-grupo",
        {
          conversaId: String(grupo.id),
        },
      );
      return resultado?.ok &&
        Array.isArray(resultado.participantes) &&
        Number.isFinite(Number(resultado.total))
        ? pass("Participantes de grupo retornaram estrutura coerente.", {
            total: Number(resultado.total || 0),
            participantes: resultado.participantes.length,
            euNoGrupo: resultado.euNoGrupo !== false,
          })
        : fail(
            "Listagem de participantes do grupo retornou estrutura invalida.",
            resultado,
          );
    },
    35000,
  );

  implementar(
    "TM-G007",
    "seguro",
    async () => {
      const grupos = await bridge.invokeLeitura("listar-grupos-whatsapp");
      const grupo = Array.isArray(grupos?.grupos)
        ? grupos.grupos.find((item) => item?.id)
        : null;
      if (!grupo)
        return skip("Nenhum grupo atual disponivel para validar autores.");
      const resultado = await bridge.invokeLeitura(
        "listar-participantes-grupo",
        {
          conversaId: String(grupo.id),
        },
      );
      if (!resultado?.ok)
        return fail("Nao foi possivel consultar autores do grupo.", resultado);
      const autores = Array.isArray(resultado.autoresMensagens)
        ? resultado.autoresMensagens
        : [];
      const invalidos = autores.filter(
        (item) => !String(item?.idMensagem || "").trim(),
      );
      return !invalidos.length
        ? pass(
            "Metadados de autoria historica do grupo possuem IDs de mensagem validos.",
            {
              autoresResolvidos: autores.length,
              fonte: resultado.fonte || null,
            },
          )
        : fail(
            "Foram encontrados registros de autoria sem mensagem associada.",
            invalidos.slice(0, 5),
          );
    },
    35000,
  );

  implementar(
    "TM-G008",
    "seguro",
    async () => {
      const conversa = conversaDiretaElegivel();
      if (!conversa)
        return skip(
          "Nenhuma conversa direta elegivel para consultar grupos em comum.",
        );
      const resultado = await bridge.invokeLeitura("listar-grupos-em-comum", {
        conversaId: conversa.id,
        numeroWhatsapp: conversa.numeroWhatsapp || null,
      });
      return resultado?.ok && Array.isArray(resultado.grupos)
        ? pass("Consulta de grupos em comum respondeu com estrutura valida.", {
            total: resultado.grupos.length,
            fonte: resultado.fonte || null,
          })
        : warning(
            "A consulta de grupos em comum nao ficou disponivel para a conversa amostrada.",
            {
              ok: !!resultado?.ok,
              erro: resultado?.erro || null,
            },
          );
    },
    30000,
  );

  implementar("TM-H009", "seguro", async () => {
    if (
      typeof hooksRenderer?.definirNotificacoesConversa !== "function" ||
      typeof hooksRenderer?.notificacoesAtivasConversa !== "function"
    ) {
      return fail("Hooks de notificacao do renderer nao estao disponiveis.");
    }
    const chave = "whatsiapp.notificacoes.desativadas.v1";
    const backup = backupStorage([chave]);
    const conversa = { id: idSintetico("silencio"), trancada: false };
    try {
      hooksRenderer.definirNotificacoesConversa(conversa, false);
      const ativa = hooksRenderer.notificacoesAtivasConversa(conversa);
      const persistido = lerJsonStorage(chave, {});
      return ativa === false && persistido[conversa.id] === true
        ? pass(
            "Silenciamento local foi aplicado e persistido usando o fluxo real do renderer.",
          )
        : fail("Silenciamento nao foi refletido corretamente.", {
            ativa,
            persistido: persistido[conversa.id],
          });
    } finally {
      try {
        hooksRenderer.definirNotificacoesConversa(conversa, true);
      } catch {}
      restaurarStorage(backup);
    }
  });

  implementar("TM-H010", "seguro", async () => {
    if (
      typeof hooksRenderer?.definirNotificacoesConversa !== "function" ||
      typeof hooksRenderer?.notificacoesAtivasConversa !== "function"
    ) {
      return fail("Hooks de notificacao do renderer nao estao disponiveis.");
    }
    const chave = "whatsiapp.notificacoes.desativadas.v1";
    const backup = backupStorage([chave]);
    const conversa = { id: idSintetico("reativar"), trancada: false };
    try {
      hooksRenderer.definirNotificacoesConversa(conversa, false);
      hooksRenderer.definirNotificacoesConversa(conversa, true);
      const ativa = hooksRenderer.notificacoesAtivasConversa(conversa);
      const persistido = lerJsonStorage(chave, {});
      return ativa === true && !persistido[conversa.id]
        ? pass(
            "Reativacao de notificacoes removeu o bloqueio local e restaurou o estado ativo.",
          )
        : fail("Reativacao de notificacoes nao limpou o estado de silencio.", {
            ativa,
            persistido: persistido[conversa.id],
          });
    } finally {
      try {
        hooksRenderer.definirNotificacoesConversa(conversa, true);
      } catch {}
      restaurarStorage(backup);
    }
  });

  implementar("TM-I001", "seguro", async () => {
    if (typeof hooksRenderer?.mostrarToastInternoNovaMensagem !== "function") {
      return fail("Hook do toast interno nao esta disponivel.");
    }
    const container =
      document.getElementById("toastInternoContainer") ||
      document.querySelector(".toast-interno-container");
    if (!container)
      return skip(
        "Container de toast interno nao esta presente nesta interface.",
      );
    const antes = container.querySelectorAll(".toast-interno").length;
    if (antes >= 4) {
      return skip(
        "Ha quatro toasts reais ativos; o teste nao vai remover uma notificacao do usuario para abrir espaco.",
      );
    }
    const conversa = {
      id: idSintetico("toast"),
      nome: "Teste local",
      trancada: false,
      fotoPerfilUrl: null,
    };
    const dados = {
      idMensagem: `tm-toast-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      tipo: "texto",
      texto: "Mensagem sintetica do testador",
      timestamp: Math.floor(Date.now() / 1000),
    };
    hooksRenderer.mostrarToastInternoNovaMensagem(conversa, dados);
    hooksRenderer.mostrarToastInternoNovaMensagem(conversa, dados);
    await esperar(40);
    const depois = container.querySelectorAll(".toast-interno").length;
    const candidatos = Array.from(
      container.querySelectorAll(".toast-interno"),
    ).filter((item) => String(item.textContent || "").includes("Teste local"));
    const criadosDoTeste = candidatos.length;
    for (const item of candidatos) item.remove();
    return criadosDoTeste === 1
      ? pass("Mesmo ID de mensagem gerou apenas um toast interno.", {
          criadosDoTeste,
        })
      : fail(
          "Deduplicacao do toast interno nao produziu exatamente uma notificacao.",
          { antes, depois, criadosDoTeste },
        );
  });

  implementar(
    "TM-I010",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const total = Number(diag?.notificacoes?.fotosCacheadas || 0) || 0;
      return total > 0
        ? pass("Cache de fotos para notificacoes possui entradas carregadas.", {
            fotosCacheadas: total,
          })
        : warning(
            "Nenhuma foto esta cacheada para notificacoes neste momento.",
            diag?.notificacoes || null,
          );
    },
    5000,
  );

  implementar(
    "TM-J002",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("listar-status-whatsapp");
      if (!resultado?.ok || !Array.isArray(resultado.feeds)) {
        return fail(
          "Nao foi possivel obter feeds para validar Recentes/Vistos.",
          resultado,
        );
      }
      const recentes = resultado.feeds.filter(
        (feed) => Number(feed?.unreadCount || 0) > 0,
      );
      const vistos = resultado.feeds.filter(
        (feed) => Number(feed?.unreadCount || 0) <= 0,
      );
      return recentes.length + vistos.length === resultado.feeds.length
        ? pass(
            "Feeds de Status podem ser particionados exatamente entre Recentes e Vistos.",
            {
              recentes: recentes.length,
              vistos: vistos.length,
            },
          )
        : fail("Particao Recentes/Vistos perdeu ou duplicou feeds.");
    },
    30000,
  );

  implementar(
    "TM-J010",
    "seguro",
    async () => {
      const parecePayload = (valor) => {
        const texto = String(valor || "").trim();
        if (texto.length < 96) return false;
        return (
          /^data:[^;,]+;base64,/i.test(texto) ||
          /^(?:\/9j\/|iVBORw0KGgo|UklGR|AAAA[A-Za-z0-9+/]{8,})/.test(texto) ||
          (texto.length > 180 && /^[A-Za-z0-9+/=\r\n]+$/.test(texto))
        );
      };

      const previewsReais = Array.from(
        document.querySelectorAll(".mensagem-citacao-preview"),
      ).map((el) => String(el?.textContent || "").trim());
      const expostosReais = previewsReais.filter(parecePayload);

      if (expostosReais.length) {
        return fail(
          "Uma citacao real no chat esta expondo payload Base64/data URL.",
          {
            total: expostosReais.length,
            amostra: expostosReais[0].slice(0, 120),
          },
        );
      }

      const arquivoRenderer = path.join(
        __dirname,
        "..",
        "renderer-modules",
        "renderizacao-mensagens.js",
      );

      let criarModuloRenderizacaoMensagens = null;

      try {
        ({ criarModuloRenderizacaoMensagens } = require(arquivoRenderer));
      } catch (erro) {
        return fail(
          "Nao foi possivel carregar o renderer real para validar a citacao de Status.",
          {
            erro: erro?.message || String(erro),
          },
        );
      }

      if (typeof criarModuloRenderizacaoMensagens !== "function") {
        return fail(
          "O modulo real de renderizacao nao expoe a fabrica esperada para o teste J010.",
        );
      }

      const conversaId = `tm-j010-${Date.now()}@s.whatsapp.net`;
      const idStatus = `TMSTATUS${Date.now()}`;
      const payloadSintetico = `data:image/jpeg;base64,${"A".repeat(320)}`;
      const mensagensTeste = document.createElement("div");
      const conversasTeste = {
        [conversaId]: {
          id: conversaId,
          nome: "Teste J010",
          mensagens: [
            {
              idMensagem: `tm-j010-msg-${Date.now()}`,
              texto: "Resposta sintetica ao Status",
              tipo: "texto",
              minha: true,
              horario: "00:00",
              timestamp: Math.floor(Date.now() / 1000),
              resposta: {
                idMensagem: idStatus,
                idMensagemWpp: `true_status@broadcast_${idStatus}_teste`,
                tipo: "imagem",
                texto: payloadSintetico,
                minha: false,
              },
            },
          ],
        },
      };

      let alvoStatusAberto = null;
      const capturarAberturaStatus = (evento) => {
        alvoStatusAberto = evento?.detail || null;
      };

      document.addEventListener(
        "whatsiapp:abrir-status-citado",
        capturarAberturaStatus,
      );

      try {
        const modulo = criarModuloRenderizacaoMensagens({
          ipcRenderer: { invoke: async () => ({ ok: false }) },
          shell: { openExternal: async () => {} },
          document,
          console,
          mensagens: mensagensTeste,
          conversas: conversasTeste,
          cargaMidiaEmAndamento: new Set(),
          obterConversaAtual: () => conversaId,
          proximaOcorrenciaLinkOuTelefone: () => null,
          criarLinkTelefoneMensagem: (valor) =>
            document.createTextNode(String(valor || "")),
          criarConteudoMidia: () => null,
          resolverNomeParticipanteGrupo: () => null,
          descricaoCurtaMensagemResposta: (item) =>
            String(item?.texto || item?.tipo || "Mensagem"),
          destacarMensagemRespondida: () => {},
          abrirMenuContextoMensagem: () => {},
          criarLinhaReacoes: () => null,
          mensagemEstaFavoritada: () => false,
        });

        modulo.renderMensagens();

        const citacao = mensagensTeste.querySelector(".mensagem-citacao");
        const preview = String(
          citacao?.querySelector(".mensagem-citacao-preview")?.textContent ||
            "",
        ).trim();

        if (!citacao || !preview) {
          return fail(
            "O renderer real nao produziu a citacao sintetica de Status.",
            {
              citacao: !!citacao,
              preview,
            },
          );
        }

        if (parecePayload(preview) || preview.includes(payloadSintetico)) {
          return fail(
            "O renderer real expos o payload Base64 na citacao sintetica de Status.",
            {
              preview: preview.slice(0, 120),
            },
          );
        }

        citacao.dispatchEvent(
          new window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          }),
        );

        const referenciaPreservada =
          String(alvoStatusAberto?.idMensagem || "") === idStatus;

        if (!referenciaPreservada) {
          return fail(
            "A citacao foi sanitizada, mas a referencia do Status nao foi preservada no clique.",
            {
              esperado: idStatus,
              observado: alvoStatusAberto || null,
            },
          );
        }

        return pass(
          "O renderer real sanitizou a citacao sintetica de Status e preservou a referencia original.",
          {
            preview,
            referenciaPreservada: true,
            citacoesReaisInspecionadas: previewsReais.length,
          },
        );
      } catch (erro) {
        return fail(
          "O teste comportamental da citacao de Status falhou durante a renderizacao sintetica.",
          {
            erro: erro?.message || String(erro),
          },
        );
      } finally {
        document.removeEventListener(
          "whatsiapp:abrir-status-citado",
          capturarAberturaStatus,
        );
      }
    },
    5000,
  );

  implementar(
    "TM-J012",
    "real",
    async () => {
      const ciclo = await executarCicloStatusTeste();
      return ciclo?.texto?.publicado &&
        ciclo?.texto?.verificado &&
        ciclo?.texto?.verificadoImediato
        ? pass(
            "Status de texto foi publicado e apareceu em Meu status sem reiniciar o WhatsIAPP.",
            {
              idMensagem: ciclo.texto.retorno?.idMensagem || null,
              idMensagemRaw: ciclo.texto.retorno?.idMensagemRaw || null,
              ack: ciclo.texto.retorno?.ack ?? null,
              via: ciclo.texto.retorno?.via || null,
            },
          )
        : fail(
            "O ciclo real nao conseguiu publicar e confirmar o Status de texto.",
            {
              publicado: !!ciclo?.texto?.publicado,
              verificado: !!ciclo?.texto?.verificado,
              verificadoImediato: !!ciclo?.texto?.verificadoImediato,
              erro: ciclo?.texto?.erro || null,
            },
          );
    },
    120000,
  );

  implementar(
    "TM-J013",
    "real",
    async () => {
      const ciclo = await executarCicloStatusTeste();
      return ciclo?.imagem?.publicado &&
        ciclo?.imagem?.verificado &&
        ciclo?.imagem?.verificadoImediato
        ? pass(
            "Imagem fixa foi publicada e apareceu em Meu status sem reiniciar o WhatsIAPP.",
            {
              idMensagem: ciclo.imagem.retorno?.idMensagem || null,
              idMensagemRaw: ciclo.imagem.retorno?.idMensagemRaw || null,
              ack: ciclo.imagem.retorno?.ack ?? null,
              fixture: "testador-mestre/assets/status-teste.png",
            },
          )
        : fail(
            "O ciclo real nao conseguiu publicar e confirmar o Status de imagem.",
            {
              publicado: !!ciclo?.imagem?.publicado,
              verificado: !!ciclo?.imagem?.verificado,
              verificadoImediato: !!ciclo?.imagem?.verificadoImediato,
              erro: ciclo?.imagem?.erro || null,
            },
          );
    },
    120000,
  );

  implementar(
    "TM-J014",
    "real",
    async () =>
      skip(
        "Publicacao de video em Status esta temporariamente indisponivel no stack atual WPPConnect/WA-JS.",
        {
          recurso: "status-video",
          temporariamenteIndisponivel: true,
        },
      ),
    5000,
  );

  implementar(
    "TM-J015",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("listar-status-whatsapp");
      const meu = resultado?.meuStatus;
      const mensagem = Array.isArray(meu?.mensagens)
        ? meu.mensagens.find((item) => item?.idMensagem)
        : null;
      if (!resultado?.ok || !meu || !mensagem) {
        return skip(
          "Nao ha Status proprio ativo para consultar visualizadores com seguranca.",
        );
      }
      const visualizadores = await bridge.invokeLeitura(
        "listar-visualizadores-status-whatsapp",
        {
          contatoId: meu.id,
          idFeed: meu.idFeed || null,
          idMensagem: mensagem.idMensagem,
          idMensagemRaw: mensagem.idMensagemRaw || null,
        },
      );
      return visualizadores?.ok && Array.isArray(visualizadores.visualizadores)
        ? pass(
            "Visualizadores do proprio Status retornaram estrutura valida.",
            {
              total: visualizadores.visualizadores.length,
            },
          )
        : warning(
            "Nao foi possivel obter visualizadores do Status proprio atual.",
            {
              ok: !!visualizadores?.ok,
              erro: visualizadores?.erro || null,
            },
          );
    },
    35000,
  );

  implementar(
    "TM-J016",
    "real",
    async () => {
      const ciclo = await executarCicloStatusTeste();
      return ciclo?.limpeza?.ok
        ? pass(
            "Os dois Status criados pela execucao foram apagados e a ausencia foi confirmada.",
            {
              textoRemovido: !!ciclo?.texto?.removido,
              imagemRemovida: !!ciclo?.imagem?.removido,
              verificada: !!ciclo?.limpeza?.verificada,
              antes: ciclo?.antes || null,
              depoisPublicacao: ciclo?.depoisPublicacao || null,
              depoisLimpeza: ciclo?.depoisLimpeza || null,
            },
          )
        : fail(
            "A limpeza automatica dos Status de teste nao ficou integralmente confirmada.",
            {
              textoPublicado: !!ciclo?.texto?.publicado,
              textoRemovido: !!ciclo?.texto?.removido,
              imagemPublicada: !!ciclo?.imagem?.publicado,
              imagemRemovida: !!ciclo?.imagem?.removido,
              verificada: !!ciclo?.limpeza?.verificada,
              erros: ciclo?.limpeza?.erros || [],
            },
          );
    },
    120000,
  );

  implementar(
    "TM-K003",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("admin-config-publica");
      const cfg = resultado?.configuracao;
      return resultado?.ok &&
        cfg &&
        typeof cfg === "object" &&
        !!String(cfg.plano || "")
        ? pass(
            "Configuracao comercial publica possui plano e permissoes estruturadas.",
            {
              plano: cfg.plano,
              nomePlano: cfg.nomePlano || null,
            },
          )
        : fail("Configuracao comercial publica esta incompleta.", resultado);
    },
    10000,
  );

  implementar(
    "TM-K004",
    "seguro",
    async () => {
      const [resultado, infoRenderer] = await Promise.all([
        bridge.invokeLeitura("admin-config-publica"),
        Promise.resolve(bridge.obterInfoPlanoRenderer()),
      ]);
      const permitidos = Array.isArray(
        resultado?.configuracao?.niveisPermitidos,
      )
        ? resultado.configuracao.niveisPermitidos.map(String)
        : [];
      const conhecidos = new Set(
        (infoRenderer?.niveisContextoIA || []).map(String),
      );
      const desconhecidos = permitidos.filter((item) => !conhecidos.has(item));
      return resultado?.ok && permitidos.length > 0 && !desconhecidos.length
        ? pass(
            "Todos os niveis liberados pelo plano existem na configuracao do renderer.",
            {
              permitidos,
            },
          )
        : fail(
            "Plano possui nivel de contexto ausente ou invalido no renderer.",
            {
              permitidos,
              desconhecidos,
              conhecidos: Array.from(conhecidos),
            },
          );
    },
    10000,
  );

  implementar(
    "TM-K005",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("admin-config-publica");
      const infoRenderer = bridge.obterInfoPlanoRenderer();
      const esperado = !!resultado?.configuracao?.pesquisaWebPermitida;
      const observado = infoRenderer?.pesquisaWebPermitida;
      return resultado?.ok &&
        typeof observado === "boolean" &&
        observado === esperado
        ? pass(
            "Permissao de pesquisa web do renderer coincide com o plano comercial.",
            { permitido: esperado },
          )
        : fail("Permissao de pesquisa web diverge entre main e renderer.", {
            esperado,
            observado,
          });
    },
    10000,
  );

  implementar(
    "TM-K006",
    "seguro",
    async () => {
      const resultado = await bridge.invokeLeitura("status-uso-groq", "dia");
      return resultado?.ok && resultado.uso && typeof resultado.uso === "object"
        ? pass("Resumo de consumo de IA pode ser lido sem disparar modelo.", {
            possuiDados: true,
          })
        : fail(
            "Resumo de consumo de IA nao retornou estrutura valida.",
            resultado,
          );
    },
    10000,
  );

  implementar(
    "TM-K007",
    "seguro",
    async () => {
      const periodos = ["hora", "dia", "semana", "mes"];
      const resultados = [];
      for (const periodo of periodos) {
        const item = await bridge.invokeLeitura("status-uso-groq", periodo);
        resultados.push({ periodo, ok: !!item?.ok && !!item?.uso });
      }
      const falhas = resultados.filter((item) => !item.ok);
      return !falhas.length
        ? pass(
            "Consumo de IA responde nos quatro periodos da interface.",
            resultados,
          )
        : fail("Um ou mais periodos de consumo falharam.", falhas);
    },
    20000,
  );

  implementar("TM-K011", "seguro", async () => {
    const funcoesOk =
      typeof hooksRenderer?.registrarFavoritoLocalmente === "function" &&
      typeof hooksRenderer?.removerFavoritoLocalmente === "function" &&
      typeof hooksRenderer?.mensagemEstaFavoritada === "function";
    if (!funcoesOk)
      return fail("Hooks locais de Favoritos nao estao disponiveis.");
    const chaveStorage = "whatsiapp.favoritosMensagens.v1";
    const backup = backupStorage([chaveStorage]);
    const conversa = { id: idSintetico("fav"), nome: "Teste Mestre" };
    const msg = {
      idMensagem: `tm-fav-${Date.now()}`,
      texto: "favorito sintetico",
      tipo: "texto",
      timestamp: Math.floor(Date.now() / 1000),
      minha: true,
    };
    try {
      hooksRenderer.registrarFavoritoLocalmente(conversa, msg);
      const memoria = hooksRenderer.mensagemEstaFavoritada(
        conversa.id,
        msg.idMensagem,
      );
      const persistido = lerJsonStorage(chaveStorage, {});
      const chave = `${conversa.id.toLowerCase()}|${msg.idMensagem}`;
      return memoria && !!persistido[chave]
        ? pass(
            "Favorito sintetico foi persistido pelo modulo real e pode ser reidratado do storage.",
          )
        : fail(
            "Persistencia de Favoritos nao confirmou o registro sintetico.",
            { memoria, persistido: !!persistido[chave] },
          );
    } finally {
      try {
        hooksRenderer.removerFavoritoLocalmente(conversa.id, msg.idMensagem);
      } catch {}
      restaurarStorage(backup);
    }
  });

  implementar("TM-K012", "seguro", async () => {
    const funcoesOk =
      typeof hooksRenderer?.registrarReacoesLocalmente === "function" &&
      typeof hooksRenderer?.removerRegistroReacoes === "function" &&
      typeof hooksRenderer?.aplicarEstadoReacoesPersistidas === "function";
    if (!funcoesOk)
      return fail("Hooks locais de Reacoes nao estao disponiveis.");
    const chaveStorage = "whatsiapp.reacoesMensagens.v1";
    const backup = backupStorage([chaveStorage]);
    const conversaId = idSintetico("reacao");
    const idMensagem = `tm-react-${Date.now()}`;
    try {
      hooksRenderer.registrarReacoesLocalmente(conversaId, idMensagem, [
        { emoji: "👍", total: 1, minha: true },
      ]);
      const reidratada = hooksRenderer.aplicarEstadoReacoesPersistidas(
        conversaId,
        {
          idMensagem,
          tipo: "texto",
          texto: "x",
        },
      );
      const ok =
        Array.isArray(reidratada?.reacoes) &&
        reidratada.reacoes.some((item) => item.emoji === "👍" && item.minha);
      return ok
        ? pass("Reacao sintetica foi persistida e reidratada pelo modulo real.")
        : fail(
            "Persistencia de Reacoes nao reidratou o estado esperado.",
            reidratada?.reacoes || null,
          );
    } finally {
      try {
        hooksRenderer.removerRegistroReacoes(conversaId, idMensagem);
      } catch {}
      restaurarStorage(backup);
    }
  });

  implementar("TM-K013", "seguro", async () => {
    const chaves = [
      "whatsiapp.mensagensApagadas.v1",
      "whatsiapp.mensagensEditadas.v1",
      "whatsiapp.favoritosMensagens.v1",
      "whatsiapp.reacoesMensagens.v1",
    ];
    const backup = backupStorage(chaves);
    const conversaId = idSintetico("estado-msg");
    const idEditada = `tm-edit-${Date.now()}`;
    const idApagada = `tm-del-${Date.now()}`;
    try {
      hooksRenderer.registrarMensagemEditadaLocalmente?.(
        conversaId,
        idEditada,
        "texto editado pelo teste",
      );
      const editada = hooksRenderer.aplicarEstadoMensagemEditadaPersistida?.(
        conversaId,
        {
          idMensagem: idEditada,
          tipo: "texto",
          texto: "original",
        },
      );
      hooksRenderer.registrarMensagemApagadaLocalmente?.(
        conversaId,
        idApagada,
        {
          paraTodos: true,
          mensagem: {
            idMensagem: idApagada,
            tipo: "texto",
            texto: "apagar",
            minha: true,
            timestamp: Math.floor(Date.now() / 1000),
          },
        },
      );
      const apagada = hooksRenderer.aplicarEstadoMensagemApagadaPersistida?.(
        conversaId,
        {
          idMensagem: idApagada,
          tipo: "texto",
          texto: "apagar",
          minha: true,
        },
      );
      const okEdit =
        editada?.editada === true &&
        editada?.texto === "texto editado pelo teste";
      const okDel =
        apagada?.apagadaParaTodos === true && apagada?.tipo === "apagada";
      return okEdit && okDel
        ? pass(
            "Edicoes e tombstones sinteticos foram persistidos e reaplicados corretamente.",
          )
        : fail("Persistencia de mensagens editadas/apagadas divergiu.", {
            okEdit,
            okDel,
          });
    } finally {
      try {
        hooksRenderer.limparPersistenciasMensagensDaConversa?.(conversaId);
      } catch {}
      restaurarStorage(backup);
    }
  });

  implementar(
    "TM-L001",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const arquivo = diag?.caches?.conversas || {};
      return arquivo.existe && Number(arquivo.bytes || 0) > 2
        ? pass(
            "Cache de conversas existe e possui conteudo antes de depender da rede.",
            arquivo,
          )
        : warning(
            "Cache de conversas nao foi encontrado ou esta vazio.",
            arquivo,
          );
    },
    5000,
  );

  implementar(
    "TM-L002",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const arquivo = diag?.caches?.aliases || {};
      return arquivo.existe &&
        Number(arquivo.bytes || 0) > 2 &&
        Number(diag?.estado?.privacidadeConhecida || 0) > 0
        ? pass(
            "Cache de aliases existe e os aliases estao carregados em memoria.",
            {
              bytes: arquivo.bytes,
              aliasesConhecidos: diag.estado.privacidadeConhecida,
            },
          )
        : warning("Cache de aliases nao esta plenamente disponivel.", {
            arquivo,
            aliases: diag?.estado?.privacidadeConhecida || 0,
          });
    },
    5000,
  );

  implementar(
    "TM-L003",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const arquivo = diag?.caches?.arquivamento || {};
      const privacidade = diag?.caches?.privacidade || {};
      const estados = Number(diag?.estado?.arquivamentos || 0) || 0;
      const cacheLegadoDisponivel = arquivo.existe && Number(arquivo.bytes || 0) > 2;
      const cacheAtualDisponivel = privacidade.existe && Number(privacidade.bytes || 0) > 2;

      return (cacheLegadoDisponivel || cacheAtualDisponivel) && estados > 0
        ? pass("Estado de arquivamento possui cache persistido e esta carregado em memoria.", {
            arquivoArquivamento: arquivo,
            arquivoPrivacidade: privacidade,
            estados,
            fonteAtual: cacheAtualDisponivel ? "privacidade" : "arquivamento",
          })
        : warning("Cache de arquivamento nao foi confirmado em memoria e disco.", {
            arquivo,
            privacidade,
            estados,
          });
    },
    5000,
  );

  implementar(
    "TM-L004",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const arquivo = diag?.caches?.privacidade || {};
      return diag?.estado?.cachePrivacidadeCarregado &&
        arquivo.existe &&
        Number(arquivo.bytes || 0) > 2
        ? pass("Cache de privacidade foi carregado e esta presente em disco.", {
            bytes: arquivo.bytes,
            completo: diag.estado.privacidadeCompleta,
          })
        : warning(
            "Cache de privacidade nao foi confirmado em memoria e disco.",
            { arquivo, carregado: diag?.estado?.cachePrivacidadeCarregado },
          );
    },
    5000,
  );

  implementar(
    "TM-L005",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const estado = diag?.estado || {};
      const sync = diag?.sincronizacao || {};
      return sync.wppFullReady &&
        Number(estado.conversasBase || 0) > 0 &&
        estado.privacidadeCompleta
        ? pass(
            "Snapshot autoritativo esta ativo depois do FULL_READY e possui estado completo.",
            {
              conversasBase: estado.conversasBase,
              aliases: estado.privacidadeConhecida,
            },
          )
        : fail("Snapshot autoritativo nao esta em estado completo.", {
            estado,
            sync,
          });
    },
    5000,
  );

  implementar(
    "TM-L007",
    "seguro",
    async () => {
      const resultado = await diagnosticoMain("dedup-tempo-real");
      return resultado?.ok && resultado?.limpo
        ? pass(
            "Deduplicador real marcou a mensagem sintetica uma vez, detectou repeticao e limpou o teste.",
            {
              primeiraConsulta: resultado.antes,
              segundaConsulta: resultado.depois,
              limpo: resultado.limpo,
            },
          )
        : fail(
            "Deduplicacao WPP/Baileys nao apresentou o comportamento esperado.",
            resultado,
          );
    },
    5000,
  );

  implementar(
    "TM-L008",
    "seguro",
    async () => {
      const diag = await diagnosticoMain("snapshot");
      const prioridade = Number(diag?.presenca?.prioridadeBaileysMs || 0) || 0;
      return prioridade === 15000
        ? pass(
            "Janela de prioridade do Baileys sobre WPPConnect esta ativa em 15 segundos.",
            {
              prioridadeBaileysMs: prioridade,
            },
          )
        : warning(
            "Janela de prioridade de presenca diverge do valor esperado.",
            {
              prioridadeBaileysMs: prioridade,
            },
          );
    },
    5000,
  );

  implementar("TM-M007", "seguro", async () => {
    const chaves = ["whatsiapp.favoritosMensagens.v1"];
    const backup = backupStorage(chaves);
    const conversa = { id: idSintetico("fav-edit"), nome: "Teste Mestre" };
    const msg = {
      idMensagem: `tm-fav-edit-${Date.now()}`,
      texto: "antes",
      tipo: "texto",
      timestamp: Math.floor(Date.now() / 1000),
      minha: true,
    };
    try {
      hooksRenderer.registrarFavoritoLocalmente?.(conversa, msg);
      hooksRenderer.atualizarFavoritoEditadoLocalmente?.(
        conversa.id,
        msg.idMensagem,
        "depois",
      );
      const dados = lerJsonStorage(chaves[0], {});
      const chave = `${conversa.id.toLowerCase()}|${msg.idMensagem}`;
      return dados?.[chave]?.texto === "depois"
        ? pass("Edicao de mensagem atualizou o registro favorito associado.")
        : fail(
            "Favorito nao acompanhou a edicao sintetica.",
            dados?.[chave] || null,
          );
    } finally {
      try {
        hooksRenderer.removerFavoritoLocalmente?.(conversa.id, msg.idMensagem);
      } catch {}
      restaurarStorage(backup);
    }
  });

  implementar("TM-M009", "seguro", async () => {
    const chaves = [
      "whatsiapp.favoritosMensagens.v1",
      "whatsiapp.reacoesMensagens.v1",
      "whatsiapp.mensagensApagadas.v1",
      "whatsiapp.mensagensEditadas.v1",
    ];
    const backup = backupStorage(chaves);
    const conversa = { id: idSintetico("cleanup"), nome: "Teste Mestre" };
    const msg = {
      idMensagem: `tm-clean-${Date.now()}`,
      texto: "limpeza",
      tipo: "texto",
      timestamp: Math.floor(Date.now() / 1000),
      minha: true,
    };
    try {
      hooksRenderer.registrarFavoritoLocalmente?.(conversa, msg);
      hooksRenderer.registrarReacoesLocalmente?.(conversa.id, msg.idMensagem, [
        { emoji: "👍", total: 1, minha: true },
      ]);
      hooksRenderer.registrarMensagemEditadaLocalmente?.(
        conversa.id,
        msg.idMensagem,
        "editada",
      );
      hooksRenderer.limparPersistenciasMensagensDaConversa?.(conversa.id);
      const fav = lerJsonStorage(chaves[0], {});
      const react = lerJsonStorage(chaves[1], {});
      const edits = lerJsonStorage(chaves[3], {});
      const prefixo = `${conversa.id.toLowerCase()}|`;
      const sobrou = [fav, react, edits].some((obj) =>
        Object.keys(obj || {}).some((chave) => chave.startsWith(prefixo)),
      );
      return !sobrou
        ? pass(
            "Limpeza de persistencias removeu favorito, reacao e edicao associados ao alvo sintetico.",
          )
        : fail("Persistencias associadas sobreviveram a limpeza sintetica.");
    } finally {
      try {
        hooksRenderer.limparPersistenciasMensagensDaConversa?.(conversa.id);
      } catch {}
      restaurarStorage(backup);
    }
  });

  const { registrarTestesExpandidos } = require("./testes-expandidos.js");

  registrarTestesExpandidos({
    implementar,
    pass,
    warning,
    fail,
    skip,
    bridge,
    document,
    window,
    localStorage,
    fs,
    path,
    hooksRenderer,
    backupStorage,
    restaurarStorage,
    idSintetico,
    diagnosticoMain,
  });

  const todos = MATRIZ_TESTADOR_MESTRE_V1.map((item) => {
    const impl = implementacoes.get(item.id);
    return Object.freeze({
      ...item,
      implementado: !!impl,
      grupoExecucao: grupo.get(item.id) || null,
      executar: impl?.executar,
      timeoutMs: impl?.timeoutMs,
    });
  });

  function testesParaPerfil(perfil = "rapido") {
    const id = String(perfil || "rapido");

    if (id === "rapido") {
      return todos.filter(
        (teste) => teste.implementado && teste.grupoExecucao === "rapido",
      );
    }

    if (id === "seguro") {
      return todos.filter(
        (teste) =>
          teste.implementado &&
          ["rapido", "seguro"].includes(teste.grupoExecucao),
      );
    }

    if (id === "real") {
      return todos.filter(
        (teste) =>
          teste.implementado &&
          ["rapido", "seguro", "real"].includes(teste.grupoExecucao),
      );
    }

    return todos.filter(
      (teste) => teste.implementado && teste.grupoExecucao === "rapido",
    );
  }

  function resumoCatalogo() {
    return {
      matrizTotal: todos.length,
      implementados: todos.filter((item) => item.implementado).length,
      rapido: testesParaPerfil("rapido").length,
      seguro: testesParaPerfil("seguro").length,
      real: testesParaPerfil("real").length,
      alvoTeste: String(obterAlvoTeste?.() || "").trim() || null,
    };
  }

  return Object.freeze({
    todos,
    testesParaPerfil,
    resumoCatalogo,
  });
}

module.exports = {
  criarCatalogoTestes,
};
