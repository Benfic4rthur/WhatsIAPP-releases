function criarRecursosVisuaisPerfilContato(deps = {}) {
  const {
    ipcRenderer,
    document,
    conversas,
    listaConversas,
    imagemPerfilApp,
    fallbackPerfilApp,
    obterConversaAtual,
  } = deps;

  const filaFotosPerfil = [];
  const fotosPerfilEnfileiradas = new Set();
  const cargaFotoPerfilEmAndamento = new Set();
  const MAX_FOTOS_PERFIL_SIMULTANEAS_PRIORIDADE = 6;
  const MAX_FOTOS_PERFIL_SIMULTANEAS_SEGUNDO_PLANO = 2;
  const INTERVALO_MONITOR_FOTOS_PERFIL_MS = 5000;
  const ATRASO_SEGUNDO_PLANO_FOTOS_PERFIL_MS = 1500;

  let fotosPerfilAtivas = 0;
  let baileysProntoParaFotos = false;
  let timerRenderConversasFotos = null;
  let observadorAvatares = null;
  let cabecalhoContato = null;
  let avatarCabecalho = null;
  let infoCabecalho = null;
  let minhaFotoCarregada = false;
  let cargaMinhaFotoEmAndamento = false;
  let tentativasMinhaFoto = 0;
  let cacheFotosPerfilInicialCarregado = false;
  let promiseCacheFotosPerfilInicial = null;
  let timerMonitorFotosPerfil = null;
  let timerLiberarFotosSecundarias = null;
  let sistemaLiberadoParaFotosSecundarias = false;
  let solicitacaoReadyFotosPrincipaisRecebida = false;
  let fotosPrincipaisReadySinalizado = false;
  const cacheFotosPerfilLocal = new Map();

  const integracoes = {
    renderConversas: null,
    aplicarAparenciaConversa: null,
    atualizarStatusCabecalho: null,
    abrirPerfilContato: null,
    obterBotaoPersonalizarConversa: null,
  };

  function configurarIntegracoes(novas = {}) {
    for (const chave of Object.keys(integracoes)) {
      if (typeof novas[chave] === "function") {
        integracoes[chave] = novas[chave];
      }
    }
  }

  function inicialDoContato(conversa) {
    const texto = String(conversa?.nome || conversa?.id || "?").trim();
    return texto.charAt(0).toUpperCase() || "?";
  }

  function criarAvatarContato(conversa, tamanho = 38) {
    const avatar = document.createElement("div");
    avatar.classList.add("avatar-contato");
    if (conversa?.bloqueada) {
      avatar.classList.add("avatar-contato-bloqueado");
    }
    Object.assign(avatar.style, {
      width: `${tamanho}px`,
      height: `${tamanho}px`,
      minWidth: `${tamanho}px`,
      borderRadius: "50%",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#24313a",
      color: "#c7d3d9",
      fontSize: `${Math.max(12, Math.round(tamanho * 0.38))}px`,
      fontWeight: "700",
      userSelect: "none",
    });
    avatar.textContent = inicialDoContato(conversa);
    if (conversa?.fotoPerfilUrl) {
      const img = document.createElement("img");
      img.src = conversa.fotoPerfilUrl;
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = conversa.nome || "Foto do contato";
      Object.assign(img.style, {
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
      });
      img.addEventListener(
        "error",
        () => {
          img.remove();
        },
        {
          once: true,
        },
      );
      avatar.textContent = "";
      avatar.appendChild(img);
    }
    return avatar;
  }

  function formatarNumeroWhatsapp(valor) {
    const digitos = String(valor || "").replace(/\D/g, "");
    if (!digitos) {
      return "Número indisponível";
    }
    if (digitos.startsWith("55") && digitos.length >= 12) {
      const ddd = digitos.slice(2, 4);
      const numero = digitos.slice(4);
      if (numero.length === 9) {
        return `+55 (${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
      }
      if (numero.length === 8) {
        return `+55 (${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
      }
    }
    return `+${digitos}`;
  }

  function agendarRenderConversasPorFotos() {
    clearTimeout(timerRenderConversasFotos);
    timerRenderConversasFotos = setTimeout(() => {
      timerRenderConversasFotos = null;
      integracoes.renderConversas?.();
      const conversaAtual = obterConversaAtual?.();
      if (conversaAtual && conversas[conversaAtual]) {
        atualizarCabecalhoConversa();
      }
    }, 180);
  }

  function aplicarCacheFotoPerfilNaConversa(conversa) {
    if (!conversa?.id || conversa.fotoPerfilUrl) {
      return false;
    }

    const url = cacheFotosPerfilLocal.get(String(conversa.id));

    if (!url) {
      return false;
    }

    conversa.fotoPerfilUrl = url;
    conversa.fotoPerfilTentada = false;
    conversa.fotoPerfilFalhas = 0;
    conversa.fotoPerfilOrigem = "cache-local";
    conversa.proximaTentativaFotoEm = 0;
    conversa.fotoPerfilPrimeiraTentativaConcluida = true;
    return true;
  }

  function aplicarCacheFotosPerfilNasConversas() {
    let aplicadas = 0;

    for (const conversa of Object.values(conversas || {})) {
      if (aplicarCacheFotoPerfilNaConversa(conversa)) {
        aplicadas += 1;
      }
    }

    if (aplicadas) {
      console.log(`[FOTOS PERFIL] CACHE_APLICADO | total=${aplicadas}`);
      agendarRenderConversasPorFotos();
    }

    return aplicadas;
  }

  async function carregarCacheFotosPerfilInicial() {
    if (cacheFotosPerfilInicialCarregado) {
      aplicarCacheFotosPerfilNasConversas();
      return;
    }

    if (promiseCacheFotosPerfilInicial) {
      return promiseCacheFotosPerfilInicial;
    }

    promiseCacheFotosPerfilInicial = (async () => {
      try {
        const resultado = await ipcRenderer.invoke("obter-cache-fotos-perfil");
        const fotos =
          resultado?.fotos && typeof resultado.fotos === "object"
            ? resultado.fotos
            : {};

        cacheFotosPerfilLocal.clear();

        for (const [conversaId, url] of Object.entries(fotos)) {
          const id = String(conversaId || "").trim();
          const origem = String(url || "").trim();

          if (id && origem) {
            cacheFotosPerfilLocal.set(id, origem);
          }
        }

        cacheFotosPerfilInicialCarregado = true;
        aplicarCacheFotosPerfilNasConversas();

        console.log(
          `[FOTOS PERFIL] CACHE_LOCAL_PRONTO | total=${cacheFotosPerfilLocal.size}`,
        );
      } catch (erro) {
        cacheFotosPerfilInicialCarregado = true;
        console.warn(
          `[FOTOS PERFIL] CACHE_LOCAL_FALHOU | erro=${erro?.message || erro || "unknown"}`,
        );
      } finally {
        promiseCacheFotosPerfilInicial = null;
      }
    })();

    return promiseCacheFotosPerfilInicial;
  }

  function ehConversaPrincipalParaFotos(conversa) {
    return !!conversa?.id && !conversa.arquivada && !conversa.trancada;
  }

  function resumoFotosPrincipais() {
    const principais = Object.values(conversas || {}).filter(
      ehConversaPrincipalParaFotos,
    );
    const comFoto = principais.filter((conversa) => !!conversa.fotoPerfilUrl);
    const resolvidas = principais.filter(
      (conversa) =>
        !!conversa.fotoPerfilUrl ||
        !!conversa.fotoPerfilPrimeiraTentativaConcluida,
    );

    return {
      total: principais.length,
      comFoto: comFoto.length,
      semFoto: Math.max(0, principais.length - comFoto.length),
      resolvidas: resolvidas.length,
      pendentes: Math.max(0, principais.length - resolvidas.length),
    };
  }

  function tentarSinalizarFotosPrincipaisProntas() {
    if (
      !solicitacaoReadyFotosPrincipaisRecebida ||
      fotosPrincipaisReadySinalizado ||
      !baileysProntoParaFotos ||
      !cacheFotosPerfilInicialCarregado
    ) {
      return false;
    }

    const resumo = resumoFotosPrincipais();

    if (resumo.pendentes > 0) {
      return false;
    }

    // Se todas as conversas Principais ja possuem foto/cache ou concluiram
    // a PRIMEIRA tentativa, o boot pode seguir. Retentativas posteriores
    // nunca podem segurar o READY.
    fotosPrincipaisReadySinalizado = true;

    console.log(
      `[FOTOS PERFIL] PRINCIPAIS_READY | total=${resumo.total} | com_foto=${resumo.comFoto} | sem_foto=${resumo.semFoto}`,
    );

    ipcRenderer.invoke("fotos-principais-ready", resumo).catch((erro) => {
      fotosPrincipaisReadySinalizado = false;
      console.warn(
        `[FOTOS PERFIL] PRINCIPAIS_READY_FALHOU | erro=${erro?.message || erro || "unknown"}`,
      );
    });

    return true;
  }

  function prepararFotosPrincipaisParaReady() {
    solicitacaoReadyFotosPrincipaisRecebida = true;
    fotosPrincipaisReadySinalizado = false;

    if (!cacheFotosPerfilInicialCarregado) {
      void carregarCacheFotosPerfilInicial().finally(() => {
        prepararFotosPrincipaisParaReady();
      });
      return;
    }

    let enfileiradas = 0;

    for (const conversa of Object.values(conversas || {})) {
      if (!ehConversaPrincipalParaFotos(conversa)) {
        continue;
      }

      if (aplicarCacheFotoPerfilNaConversa(conversa)) {
        continue;
      }

      if (conversa.fotoPerfilUrl) {
        conversa.fotoPerfilPrimeiraTentativaConcluida = true;
        continue;
      }

      if (conversa.fotoPerfilPrimeiraTentativaConcluida) {
        continue;
      }

      conversa.fotoPerfilTentada = false;
      conversa.proximaTentativaFotoEm = 0;

      const antes = fotosPerfilEnfileiradas.size;
      enfileirarFotoPerfil(conversa, true);

      if (fotosPerfilEnfileiradas.size > antes) {
        enfileiradas += 1;
      }
    }

    console.log(
      `[FOTOS PERFIL] READY_SOLICITADO | enfileiradas=${enfileiradas}`,
    );

    processarFilaFotosPerfil();
    tentarSinalizarFotosPrincipaisProntas();
  }

  function limiteConcorrenciaFotosPerfil() {
    if (!sistemaLiberadoParaFotosSecundarias) {
      return MAX_FOTOS_PERFIL_SIMULTANEAS_PRIORIDADE;
    }

    const temPrincipalNaFila = filaFotosPerfil.some((conversa) =>
      ehConversaPrincipalParaFotos(conversa),
    );

    return temPrincipalNaFila
      ? MAX_FOTOS_PERFIL_SIMULTANEAS_PRIORIDADE
      : MAX_FOTOS_PERFIL_SIMULTANEAS_SEGUNDO_PLANO;
  }

  function liberarFotosSecundarias() {
    if (sistemaLiberadoParaFotosSecundarias) {
      return;
    }

    sistemaLiberadoParaFotosSecundarias = true;

    clearTimeout(timerLiberarFotosSecundarias);
    timerLiberarFotosSecundarias = setTimeout(() => {
      timerLiberarFotosSecundarias = null;

      for (const conversa of Object.values(conversas || {})) {
        if (conversa?.fotoPerfilAguardandoSegundoPlano) {
          conversa.fotoPerfilAguardandoSegundoPlano = false;
          conversa.fotoPerfilTentada = false;
          conversa.proximaTentativaFotoEm = 0;
        }
      }

      enfileirarTodasFotosPerfilAusentes();
      processarFilaFotosPerfil();

      console.log(
        "[FOTOS PERFIL] SEGUNDO_PLANO_LIBERADO | arquivadas_e_trancadas=true",
      );
    }, ATRASO_SEGUNDO_PLANO_FOTOS_PERFIL_MS);
  }

  function esperaNovaTentativaFoto(falhas) {
    const total = Math.max(0, Number(falhas || 0) || 0);

    if (total <= 4) return 5000;
    if (total <= 8) return 15000;
    return 60000;
  }

  function enfileirarTodasFotosPerfilAusentes() {
    if (!baileysProntoParaFotos || !cacheFotosPerfilInicialCarregado) {
      return;
    }

    const agora = Date.now();
    let enfileiradasPrincipais = 0;
    let enfileiradasSecundarias = 0;

    for (const conversa of Object.values(conversas || {})) {
      if (!conversa?.id) {
        continue;
      }

      if (aplicarCacheFotoPerfilNaConversa(conversa)) {
        continue;
      }

      if (conversa.fotoPerfilUrl) {
        continue;
      }

      const principal = ehConversaPrincipalParaFotos(conversa);

      // Durante o boot, nenhuma conversa arquivada ou trancada disputa
      // rede/CPU com as conversas que o usuario realmente vera ao abrir.
      if (!principal && !sistemaLiberadoParaFotosSecundarias) {
        continue;
      }

      const proximaTentativa =
        Number(conversa.proximaTentativaFotoEm || 0) || 0;

      if (proximaTentativa > agora) {
        continue;
      }

      conversa.fotoPerfilTentada = false;
      const antes = fotosPerfilEnfileiradas.size;

      enfileirarFotoPerfil(
        conversa,
        principal || obterConversaAtual?.() === conversa.id,
      );

      if (fotosPerfilEnfileiradas.size > antes) {
        if (principal) {
          enfileiradasPrincipais += 1;
        } else {
          enfileiradasSecundarias += 1;
        }
      }
    }

    if (enfileiradasPrincipais || enfileiradasSecundarias) {
      console.log(
        `[FOTOS PERFIL] VARREDURA | principais=${enfileiradasPrincipais} | segundo_plano=${enfileiradasSecundarias}`,
      );
    }
  }

  function iniciarMonitorFotosPerfil() {
    if (timerMonitorFotosPerfil) {
      return;
    }

    timerMonitorFotosPerfil = setInterval(() => {
      if (!baileysProntoParaFotos) {
        return;
      }

      aplicarCacheFotosPerfilNasConversas();
      enfileirarTodasFotosPerfilAusentes();
      processarFilaFotosPerfil();
    }, INTERVALO_MONITOR_FOTOS_PERFIL_MS);
  }

  async function carregarFotoPerfil(conversa, rerender = true) {
    if (
      !conversa ||
      !baileysProntoParaFotos ||
      conversa.fotoPerfilTentada ||
      cargaFotoPerfilEmAndamento.has(conversa.id)
    ) {
      return;
    }

    conversa.fotoPerfilTentada = true;
    cargaFotoPerfilEmAndamento.add(conversa.id);

    try {
      const resultado = await ipcRenderer.invoke("carregar-foto-perfil", {
        conversaId: conversa.id,
        prioridadeInicial:
          !sistemaLiberadoParaFotosSecundarias &&
          ehConversaPrincipalParaFotos(conversa),
      });

      if (resultado?.ok) {
        if (resultado.url) {
          conversa.fotoPerfilUrl = resultado.url;
          conversa.fotoPerfilFalhas = 0;
          conversa.fotoPerfilOrigem = "whatsapp";
          conversa.proximaTentativaFotoEm = 0;

          ipcRenderer
            .invoke("cachear-foto-notificacao", {
              conversaId: conversa.id,
              fotoPerfilUrl: resultado.url,
            })
            .then((cache) => {
              const urlLocal = String(cache?.url || "").trim();

              if (urlLocal) {
                cacheFotosPerfilLocal.set(String(conversa.id), urlLocal);
              }
            })
            .catch(() => {});
        } else if (!conversa.fotoPerfilUrl) {
          conversa.fotoPerfilFalhas =
            Number(conversa.fotoPerfilFalhas || 0) + 1;
        }

        if (resultado.numero) {
          conversa.numeroWhatsapp = resultado.numero;
        }
      } else if (!conversa.fotoPerfilUrl) {
        conversa.fotoPerfilFalhas = Number(conversa.fotoPerfilFalhas || 0) + 1;
      }
    } catch {
      if (!conversa.fotoPerfilUrl) {
        conversa.fotoPerfilFalhas = Number(conversa.fotoPerfilFalhas || 0) + 1;
      }
    } finally {
      conversa.fotoPerfilPrimeiraTentativaConcluida = true;
      cargaFotoPerfilEmAndamento.delete(conversa.id);
    }

    if (!conversa.fotoPerfilUrl) {
      if (
        !sistemaLiberadoParaFotosSecundarias &&
        ehConversaPrincipalParaFotos(conversa)
      ) {
        // Uma conversa sem foto ou com foto temporariamente indisponivel nao
        // pode transformar o boot em uma sequencia de retries de 14 segundos.
        // Ela fica resolvida para o READY e volta a tentar em segundo plano.
        conversa.fotoPerfilTentada = true;
        conversa.fotoPerfilAguardandoSegundoPlano = true;
        conversa.proximaTentativaFotoEm = Number.POSITIVE_INFINITY;
      } else {
        const espera = esperaNovaTentativaFoto(conversa.fotoPerfilFalhas);
        conversa.fotoPerfilTentada = false;
        conversa.proximaTentativaFotoEm = Date.now() + espera;
      }
    }

    if (rerender && conversa.fotoPerfilUrl) {
      agendarRenderConversasPorFotos();
    }

    tentarSinalizarFotosPrincipaisProntas();
  }

  function processarFilaFotosPerfil() {
    if (!baileysProntoParaFotos || !cacheFotosPerfilInicialCarregado) {
      return;
    }
    while (
      fotosPerfilAtivas < limiteConcorrenciaFotosPerfil() &&
      filaFotosPerfil.length
    ) {
      const conversa = filaFotosPerfil.shift();
      if (!conversa?.id) {
        continue;
      }
      fotosPerfilEnfileiradas.delete(conversa.id);
      if (
        conversa.fotoPerfilUrl ||
        conversa.fotoPerfilTentada ||
        cargaFotoPerfilEmAndamento.has(conversa.id)
      ) {
        continue;
      }
      fotosPerfilAtivas += 1;
      carregarFotoPerfil(conversa, false)
        .then(() => {
          if (conversa.fotoPerfilUrl) {
            agendarRenderConversasPorFotos();
          }
        })
        .finally(() => {
          fotosPerfilAtivas = Math.max(0, fotosPerfilAtivas - 1);
          processarFilaFotosPerfil();
          tentarSinalizarFotosPrincipaisProntas();
        });
    }

    tentarSinalizarFotosPrincipaisProntas();
  }

  function enfileirarFotoPerfil(conversa, prioridade = false) {
    if (
      !conversa?.id ||
      conversa.fotoPerfilUrl ||
      conversa.fotoPerfilTentada ||
      cargaFotoPerfilEmAndamento.has(conversa.id) ||
      fotosPerfilEnfileiradas.has(conversa.id)
    ) {
      return;
    }

    if (
      !sistemaLiberadoParaFotosSecundarias &&
      !ehConversaPrincipalParaFotos(conversa)
    ) {
      return;
    }
    fotosPerfilEnfileiradas.add(conversa.id);
    if (prioridade) {
      filaFotosPerfil.unshift(conversa);
    } else {
      filaFotosPerfil.push(conversa);
    }
    processarFilaFotosPerfil();
  }

  function definirBaileysProntoParaFotos(valor) {
    baileysProntoParaFotos = !!valor;

    if (!baileysProntoParaFotos) {
      return;
    }

    iniciarMonitorFotosPerfil();

    void carregarCacheFotosPerfilInicial().finally(() => {
      enfileirarTodasFotosPerfilAusentes();
      processarFilaFotosPerfil();
    });
  }

  ipcRenderer.on("preparar-fotos-principais", () => {
    prepararFotosPrincipaisParaReady();
  });

  ipcRenderer.on("liberar-fotos-secundarias", () => {
    liberarFotosSecundarias();
  });

  function obterObservadorAvatares() {
    if (observadorAvatares) {
      return observadorAvatares;
    }
    observadorAvatares = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) {
            continue;
          }
          const id = entrada.target?.dataset?.conversaId;
          const conversa = conversas[id];
          if (conversa) {
            enfileirarFotoPerfil(conversa, true);
          }
          observadorAvatares.unobserve(entrada.target);
        }
      },
      {
        root: listaConversas,
        rootMargin: "120px",
      },
    );
    return observadorAvatares;
  }

  function ehGrupoConversa(conversa) {
    return String(conversa?.id || "").endsWith("@g.us");
  }

  function prepararCabecalhoContato() {
    if (cabecalhoContato) {
      return;
    }
    const topo = document.querySelector(".chat-topo");
    if (!topo) {
      return;
    }
    const blocoOriginal = topo.firstElementChild;
    if (!blocoOriginal) {
      return;
    }
    cabecalhoContato = document.createElement("div");
    Object.assign(cabecalhoContato.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      minWidth: "0",
    });
    avatarCabecalho = document.createElement("div");
    infoCabecalho = document.createElement("div");
    while (blocoOriginal.firstChild) {
      infoCabecalho.appendChild(blocoOriginal.firstChild);
    }
    cabecalhoContato.appendChild(avatarCabecalho);
    cabecalhoContato.appendChild(infoCabecalho);
    cabecalhoContato.title = "Ver perfil";
    cabecalhoContato.style.cursor = "pointer";
    cabecalhoContato.addEventListener("click", () => {
      const conversa = conversas[obterConversaAtual?.()];
      if (conversa) {
        integracoes.abrirPerfilContato?.(conversa);
      }
    });
    blocoOriginal.replaceWith(cabecalhoContato);
  }

  function atualizarCabecalhoConversa() {
    prepararCabecalhoContato();
    const conversaAtual = obterConversaAtual?.();
    const temConversaAtiva = Boolean(String(conversaAtual || "").trim());
    const botaoPersonalizarConversa =
      integracoes.obterBotaoPersonalizarConversa?.();
    if (botaoPersonalizarConversa) {
      botaoPersonalizarConversa.disabled = !temConversaAtiva;
      botaoPersonalizarConversa.dataset.temConversa = temConversaAtiva
        ? "1"
        : "0";
      botaoPersonalizarConversa.style.opacity = temConversaAtiva ? "1" : ".22";
      botaoPersonalizarConversa.style.cursor = temConversaAtiva
        ? "pointer"
        : "default";
    }
    if (!avatarCabecalho) {
      return;
    }
    avatarCabecalho.innerHTML = "";
    const conversa = conversas[conversaAtual];
    if (!conversa) {
      avatarCabecalho.style.display = "none";
      integracoes.aplicarAparenciaConversa?.(null);
      return;
    }
    avatarCabecalho.style.display = "";
    avatarCabecalho.appendChild(criarAvatarContato(conversa, 42));
    integracoes.aplicarAparenciaConversa?.(conversa.id);
    integracoes.atualizarStatusCabecalho?.();
  }

  async function carregarMinhaFotoPerfil() {
    if (minhaFotoCarregada || cargaMinhaFotoEmAndamento) {
      return;
    }
    cargaMinhaFotoEmAndamento = true;
    let deveTentarNovamente = false;
    try {
      const resultado = await ipcRenderer.invoke("carregar-minha-foto");
      if (resultado?.ok) {
        const nome = String(resultado.nome || "").trim();
        if (nome && fallbackPerfilApp) {
          fallbackPerfilApp.textContent = nome.charAt(0).toUpperCase();
        }
        if (resultado.url && imagemPerfilApp && fallbackPerfilApp) {
          imagemPerfilApp.src = resultado.url;
          imagemPerfilApp.style.display = "block";
          fallbackPerfilApp.style.display = "none";
          minhaFotoCarregada = true;
          tentativasMinhaFoto = 0;
          return;
        }
      }
      tentativasMinhaFoto += 1;
      deveTentarNovamente = tentativasMinhaFoto < 5;
    } catch {
      tentativasMinhaFoto += 1;
      deveTentarNovamente = tentativasMinhaFoto < 5;
    } finally {
      cargaMinhaFotoEmAndamento = false;
    }
    if (deveTentarNovamente) {
      setTimeout(() => {
        carregarMinhaFotoPerfil();
      }, 5000);
    }
  }

  return {
    configurarIntegracoes,
    inicialDoContato,
    criarAvatarContato,
    formatarNumeroWhatsapp,
    carregarFotoPerfil,
    processarFilaFotosPerfil,
    enfileirarFotoPerfil,
    definirBaileysProntoParaFotos,
    obterObservadorAvatares,
    ehGrupoConversa,
    prepararCabecalhoContato,
    atualizarCabecalhoConversa,
    carregarMinhaFotoPerfil,
  };
}

function criarModuloPerfilContato(deps = {}) {
  const {
    ipcRenderer,
    shell,
    document,
    window,
    conversas,
    statusChat,
    carregarFotoPerfil,
    criarAvatarContato,
    formatarNumeroWhatsapp,
    privacidadeConversa,
    renderConversas,
    atualizarCabecalhoConversa,
    normalizarTextoBusca,
    descricaoCurtaMensagemResposta,
    mensagemEstaFavoritada,
    cancelarFixacaoFimConversa,
    destacarMensagemRespondida,
    abrirConversa,
    carregarUmaMidia,
    abrirModalMidia,
  } = deps;

  const DURACAO_TRANSICAO_PERFIL = 180;

  function esperarTransicao(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  let painelAtual = null;
  let removerListenerEscape = null;

  const filaMidiasHistoricasPerfil = [];
  const midiasHistoricasPerfilEnfileiradas = new Set();
  let midiasHistoricasPerfilAtivas = 0;
  const MAX_MIDIAS_HISTORICAS_PERFIL_SIMULTANEAS = 3;

  function chaveCargaMidiaHistoricaPerfil(conversa, msg) {
    return `${String(conversa?.id || "")}|${String(msg?.idMensagem || "")}`;
  }

  function processarFilaMidiasHistoricasPerfil() {
    while (
      midiasHistoricasPerfilAtivas <
        MAX_MIDIAS_HISTORICAS_PERFIL_SIMULTANEAS &&
      filaMidiasHistoricasPerfil.length
    ) {
      const itemFila = filaMidiasHistoricasPerfil.shift();
      const chave = itemFila?.chave;

      if (!itemFila?.item?.isConnected || itemFila?.msg?.mediaUrl) {
        if (chave) {
          midiasHistoricasPerfilEnfileiradas.delete(chave);
        }
        continue;
      }

      midiasHistoricasPerfilAtivas += 1;

      void carregarMidiaHistoricaPerfil(itemFila.conversa, itemFila.msg)
        .then((ok) => {
          if (ok && itemFila.item.isConnected) {
            preencherMiniaturaMidia(itemFila.item, itemFila.msg);
          }
        })
        .finally(() => {
          if (chave) {
            midiasHistoricasPerfilEnfileiradas.delete(chave);
          }

          midiasHistoricasPerfilAtivas = Math.max(
            0,
            midiasHistoricasPerfilAtivas - 1,
          );

          processarFilaMidiasHistoricasPerfil();
        });
    }
  }

  function enfileirarMidiaHistoricaPerfil(conversa, msg, item) {
    const chave = chaveCargaMidiaHistoricaPerfil(conversa, msg);

    if (
      !chave ||
      msg?.mediaUrl ||
      midiasHistoricasPerfilEnfileiradas.has(chave)
    ) {
      return;
    }

    midiasHistoricasPerfilEnfileiradas.add(chave);
    filaMidiasHistoricasPerfil.push({
      chave,
      conversa,
      msg,
      item,
    });

    processarFilaMidiasHistoricasPerfil();
  }

  function iconeSvg(nome) {
    const icones = {
      fechar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      voltar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
      pesquisar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
      midia:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M4 17l5-5 4 4 2-2 5 4"/></svg>',
      favorito:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3z"/></svg>',
      sino: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
      grupo:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-4 2.7-6 6-6s6 2 6 6M14 15c3.4-.7 7 1 7 5"/></svg>',
      arquivar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4zM3 3h18v4H3z"/><path d="M9 11h6"/></svg>',
      bloquear:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
      trancar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>',
      sair: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5a2 2 0 00-2 2v12a2 2 0 002 2h5"/><path d="M14 8l4 4-4 4M8 12h10"/></svg>',
      limpar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3.5l6 6"/><path d="M13 5l6 6"/><path d="M4 20l8.5-8.5 4 4L8 24"/><path d="M6.5 17.5l4 4"/></svg>',
      apagar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14"/></svg>',
      documento:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></svg>',
      link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/></svg>',
      seta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    };

    return icones[nome] || "";
  }

  function criarBotaoIcone(nome, titulo, classeExtra = "") {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = `perfil-contato-icone-btn ${classeExtra}`.trim();
    botao.title = titulo;
    botao.setAttribute("aria-label", titulo);
    botao.innerHTML = iconeSvg(nome);
    return botao;
  }

  function textoMensagem(msg) {
    if (!msg) return "Mensagem";

    if (typeof descricaoCurtaMensagemResposta === "function") {
      const descricao = descricaoCurtaMensagemResposta(msg);
      if (descricao) return descricao;
    }

    const texto = String(msg.texto || "")
      .replace(/\s+/g, " ")
      .trim();
    if (texto) return texto;

    if (msg.tipo === "imagem") return "Foto";
    if (msg.tipo === "video") return "Vídeo";
    if (msg.tipo === "audio") return "Áudio";
    if (msg.tipo === "documento") return msg.fileName || "Documento";
    if (msg.tipo === "sticker") return "Figurinha";

    return "Mensagem";
  }

  function horarioMensagem(msg) {
    if (msg?.horario) return String(msg.horario);

    const timestamp = Number(msg?.timestamp || 0) || 0;
    if (!timestamp) return "";

    try {
      return new Date(timestamp * 1000).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function extrairLinksDaConversa(conversa) {
    const encontrados = [];
    const vistos = new Set();
    const regex = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

    for (const msg of Array.isArray(conversa?.mensagens)
      ? conversa.mensagens
      : []) {
      const texto = String(msg?.texto || "");
      const links = texto.match(regex) || [];

      for (const bruto of links) {
        const limpo = bruto.replace(/[),.;!?]+$/g, "");
        const url = /^www\./i.test(limpo) ? `https://${limpo}` : limpo;

        if (!url || vistos.has(url)) continue;
        vistos.add(url);
        encontrados.push({ url, msg });
      }
    }

    return encontrados.reverse();
  }

  function mensagensValidas(conversa) {
    return (
      Array.isArray(conversa?.mensagens) ? conversa.mensagens : []
    ).filter((msg) => msg && !msg.apagadaParaTodos && msg.tipo !== "apagada");
  }

  function midiasDaConversa(conversa) {
    return mensagensValidas(conversa)
      .filter((msg) => ["imagem", "video"].includes(String(msg.tipo || "")))
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  }

  function documentosDaConversa(conversa) {
    return mensagensValidas(conversa)
      .filter((msg) => String(msg.tipo || "") === "documento")
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  }

  function favoritosDaConversa(conversa) {
    return mensagensValidas(conversa)
      .filter(
        (msg) =>
          msg?.idMensagem &&
          typeof mensagemEstaFavoritada === "function" &&
          mensagemEstaFavoritada(conversa.id, msg.idMensagem),
      )
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  }

  async function consultarBloqueioDaConversa(conversa) {
    if (!conversa) return;

    try {
      const resultado = await ipcRenderer.invoke("consultar-bloqueio-contato", {
        conversaId: conversa.id,
      });

      if (resultado?.ok) {
        conversa.bloqueada = !!resultado.bloqueada;
        conversa.podeBloquear = resultado.podeBloquear !== false;
      }
    } catch {
      conversa.podeBloquear = false;
    }
  }

  function fecharPerfilContato(imediato = false) {
    const estrutura = painelAtual;
    if (!estrutura) return;

    painelAtual = null;

    if (typeof removerListenerEscape === "function") {
      removerListenerEscape();
      removerListenerEscape = null;
    }

    const remover = () => {
      if (estrutura.overlay?.isConnected) estrutura.overlay.remove();
    };

    if (imediato) {
      remover();
      return;
    }

    estrutura.overlay.classList.add("perfil-contato-saindo");
    setTimeout(remover, Math.max(180, Number(DURACAO_TRANSICAO_PERFIL || 220)));
  }

  function criarCabecalhoPainel(titulo, voltar = null) {
    const topo = document.createElement("div");
    topo.className = "perfil-contato-topo";

    const botao = criarBotaoIcone(
      voltar ? "voltar" : "fechar",
      voltar ? "Voltar" : "Fechar",
    );
    botao.addEventListener("click", voltar || (() => fecharPerfilContato()));

    const texto = document.createElement("div");
    texto.className = "perfil-contato-topo-titulo";
    texto.textContent = titulo;

    topo.appendChild(botao);
    topo.appendChild(texto);
    return topo;
  }

  function criarLinhaMenu({
    icone,
    titulo,
    subtitulo = "",
    perigo = false,
    seta = true,
  }) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = `perfil-contato-menu-item${perigo ? " perigo" : ""}`;

    const areaIcone = document.createElement("span");
    areaIcone.className = "perfil-contato-menu-icone";
    areaIcone.innerHTML = iconeSvg(icone);

    const areaTexto = document.createElement("span");
    areaTexto.className = "perfil-contato-menu-textos";

    const tituloEl = document.createElement("span");
    tituloEl.className = "perfil-contato-menu-titulo";
    tituloEl.textContent = titulo;
    areaTexto.appendChild(tituloEl);

    if (subtitulo) {
      const subtituloEl = document.createElement("span");
      subtituloEl.className = "perfil-contato-menu-subtitulo";
      subtituloEl.textContent = subtitulo;
      areaTexto.appendChild(subtituloEl);
    }

    botao.appendChild(areaIcone);
    botao.appendChild(areaTexto);

    if (seta) {
      const setaEl = document.createElement("span");
      setaEl.className = "perfil-contato-menu-seta";
      setaEl.innerHTML = iconeSvg("seta");
      botao.appendChild(setaEl);
    }

    return botao;
  }

  function navegarAteMensagem(msg) {
    if (!msg?.idMensagem) return;

    if (typeof cancelarFixacaoFimConversa === "function") {
      cancelarFixacaoFimConversa();
    }

    const id = msg.idMensagem;
    fecharPerfilContato();

    setTimeout(
      () => {
        destacarMensagemRespondida?.(id);
      },
      Math.max(190, Number(DURACAO_TRANSICAO_PERFIL || 220)),
    );
  }

  async function carregarMidiaHistoricaPerfil(conversa, msg) {
    if (
      !conversa?.id ||
      !msg?.idMensagem ||
      msg.mediaUrl ||
      msg.__midiaHistoricaCarregando
    ) {
      return !!msg?.mediaUrl;
    }

    msg.__midiaHistoricaCarregando = true;

    try {
      const resultado = await ipcRenderer.invoke("carregar-midia", {
        conversaId: conversa.id,
        idMensagem: msg.idMensagem,
        idMensagemWpp: msg.idMensagemWpp || null,
      });

      if (!resultado?.ok || !resultado?.mediaUrl) {
        msg.erroMidia = true;
        return false;
      }

      msg.mediaPath = resultado.mediaPath || null;
      msg.mediaUrl = resultado.mediaUrl || null;
      msg.mime = resultado.mime || msg.mime || null;
      msg.fileName = resultado.fileName || msg.fileName || null;
      msg.erroMidia = false;

      return true;
    } catch {
      msg.erroMidia = true;
      return false;
    } finally {
      msg.__midiaHistoricaCarregando = false;
    }
  }

  async function abrirMidiaDaMensagem(conversa, msg) {
    if (!msg) return;

    if (!msg.mediaUrl && msg.__historicoPerfil) {
      await carregarMidiaHistoricaPerfil(conversa, msg);
    } else if (!msg.mediaUrl && typeof carregarUmaMidia === "function") {
      try {
        await carregarUmaMidia(conversa, msg);
      } catch {}
    }

    if (["imagem", "video"].includes(msg.tipo) && msg.mediaUrl) {
      fecharPerfilContato();
      setTimeout(
        () => abrirModalMidia?.(msg),
        Math.max(190, Number(DURACAO_TRANSICAO_PERFIL || 220)),
      );
      return;
    }

    if (msg.tipo === "documento" && msg.mediaPath) {
      try {
        await ipcRenderer.invoke("abrir-arquivo", msg.mediaPath);
      } catch {}
    }
  }

  function preencherMiniaturaMidia(item, msg) {
    item.innerHTML = "";

    if (msg.tipo === "imagem" && msg.mediaUrl) {
      const img = document.createElement("img");
      img.src = msg.mediaUrl;
      img.alt = "Foto da conversa";
      img.loading = "lazy";
      item.appendChild(img);
      return;
    }

    if (msg.tipo === "video" && msg.mediaUrl) {
      const video = document.createElement("video");
      video.src = msg.mediaUrl;
      video.preload = "metadata";
      video.muted = true;
      item.appendChild(video);

      const play = document.createElement("span");
      play.className = "perfil-contato-midia-play";
      play.textContent = "▶";
      item.appendChild(play);
      return;
    }

    if (msg.tipo === "documento") {
      item.classList.add("documento");
      item.innerHTML = `${iconeSvg("documento")}<span>${String(msg.fileName || "Documento").slice(0, 18)}</span>`;
      return;
    }

    const vazio = document.createElement("span");
    vazio.className = "perfil-contato-midia-carregando";
    vazio.textContent = msg.erroMidia
      ? "Indisponível"
      : msg.tipo === "video"
        ? "Vídeo"
        : "Mídia";
    item.appendChild(vazio);
  }

  function observarImagemHistoricaPerfil(conversa, msg, item) {
    if (
      !msg?.__historicoPerfil ||
      msg.tipo !== "imagem" ||
      msg.mediaUrl ||
      !window?.IntersectionObserver
    ) {
      return;
    }

    const observador = new window.IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) {
            continue;
          }

          observador.disconnect();
          enfileirarMidiaHistoricaPerfil(conversa, msg, item);
          break;
        }
      },
      {
        rootMargin: "180px",
      },
    );

    observador.observe(item);
  }

  function criarMiniaturaMidia(conversa, msg) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `perfil-contato-midia-miniatura ${msg.tipo || ""}`;
    item.title = textoMensagem(msg);

    preencherMiniaturaMidia(item, msg);
    observarImagemHistoricaPerfil(conversa, msg, item);

    item.addEventListener("click", () => abrirMidiaDaMensagem(conversa, msg));
    return item;
  }

  function criarResultadoMensagem(msg, aoClicar) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "perfil-contato-resultado-item";

    const texto = document.createElement("div");
    texto.className = "perfil-contato-resultado-texto";
    texto.textContent = textoMensagem(msg);

    const meta = document.createElement("div");
    meta.className = "perfil-contato-resultado-meta";
    meta.textContent = `${msg.minha ? "Você" : "Contato"}${horarioMensagem(msg) ? ` • ${horarioMensagem(msg)}` : ""}`;

    item.appendChild(texto);
    item.appendChild(meta);
    item.addEventListener("click", aoClicar);
    return item;
  }

  function mostrarSubtela(estrutura, titulo, renderizar) {
    const { card } = estrutura;
    estrutura.tela = "subtela";
    card.innerHTML = "";

    const voltar = () => renderizarPrincipal(estrutura);
    card.appendChild(criarCabecalhoPainel(titulo, voltar));

    const corpo = document.createElement("div");
    corpo.className = "perfil-contato-subtela-corpo";
    card.appendChild(corpo);
    renderizar(corpo, voltar);
  }

  function mostrarPesquisa(estrutura) {
    const conversa = estrutura.conversa;

    mostrarSubtela(estrutura, "Pesquisar mensagens", (corpo) => {
      const buscaWrap = document.createElement("div");
      buscaWrap.className = "perfil-contato-pesquisa-wrap";
      buscaWrap.innerHTML = iconeSvg("pesquisar");

      const input = document.createElement("input");
      input.type = "text";
      input.className = "perfil-contato-pesquisa-input";
      input.placeholder = "Pesquisar nesta conversa";
      buscaWrap.appendChild(input);

      const resumo = document.createElement("div");
      resumo.className = "perfil-contato-subtela-resumo";

      const lista = document.createElement("div");
      lista.className = "perfil-contato-resultados";

      corpo.appendChild(buscaWrap);
      corpo.appendChild(resumo);
      corpo.appendChild(lista);

      const render = () => {
        lista.innerHTML = "";
        const filtro =
          typeof normalizarTextoBusca === "function"
            ? normalizarTextoBusca(input.value)
            : String(input.value || "")
                .toLowerCase()
                .trim();

        if (!filtro) {
          resumo.textContent =
            "Digite um termo para pesquisar apenas nesta conversa.";
          return;
        }

        const resultados = mensagensValidas(conversa)
          .filter((msg) => {
            const alvo = [msg.texto, msg.fileName, textoMensagem(msg)]
              .filter(Boolean)
              .join(" ");
            const normalizado =
              typeof normalizarTextoBusca === "function"
                ? normalizarTextoBusca(alvo)
                : alvo.toLowerCase();
            return normalizado.includes(filtro);
          })
          .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

        resumo.textContent = resultados.length
          ? `${resultados.length} resultado${resultados.length === 1 ? "" : "s"}`
          : "Nenhuma mensagem encontrada.";

        for (const msg of resultados.slice(0, 200)) {
          lista.appendChild(
            criarResultadoMensagem(msg, () => navegarAteMensagem(msg)),
          );
        }
      };

      input.addEventListener("input", render);
      setTimeout(() => input.focus(), 30);
    });
  }

  function mostrarFavoritos(estrutura) {
    const conversa = estrutura.conversa;

    mostrarSubtela(estrutura, "Mensagens favoritas", (corpo) => {
      const favoritos = favoritosDaConversa(conversa);
      const resumo = document.createElement("div");
      resumo.className = "perfil-contato-subtela-resumo";
      resumo.textContent = favoritos.length
        ? `${favoritos.length} ${favoritos.length === 1 ? "mensagem favorita" : "mensagens favoritas"}`
        : "Nenhuma mensagem favorita nesta conversa.";
      corpo.appendChild(resumo);

      const lista = document.createElement("div");
      lista.className = "perfil-contato-resultados";
      corpo.appendChild(lista);

      for (const msg of favoritos) {
        lista.appendChild(
          criarResultadoMensagem(msg, () => navegarAteMensagem(msg)),
        );
      }
    });
  }

  function estadoHistoricoPerfil(estrutura, aba) {
    if (!estrutura.historicoMidiasPerfil) {
      estrutura.historicoMidiasPerfil = {};
    }

    if (!estrutura.historicoMidiasPerfil[aba]) {
      estrutura.historicoMidiasPerfil[aba] = {
        itens: [],
        cursor: null,
        temMais: true,
        carregando: false,
        carregado: false,
        paginas: 0,
        erro: null,
      };
    }

    return estrutura.historicoMidiasPerfil[aba];
  }

  function chaveMensagemHistoricoPerfil(msg) {
    const id = String(msg?.idMensagem || "").trim();

    if (id) {
      return `id:${id}`;
    }

    const remoto = String(msg?.idMensagemWpp || "").trim();

    if (remoto) {
      return `wpp:${remoto}`;
    }

    return `tmp:${Number(msg?.timestamp || 0)}:${String(msg?.tipo || "")}:${String(
      msg?.texto || "",
    ).slice(0, 80)}`;
  }

  function mesclarMensagensHistoricoPerfil(locais, remotas) {
    const mapa = new Map();

    for (const msg of Array.isArray(remotas) ? remotas : []) {
      if (!msg) continue;

      msg.__historicoPerfil = true;
      mapa.set(chaveMensagemHistoricoPerfil(msg), msg);
    }

    for (const msg of Array.isArray(locais) ? locais : []) {
      if (!msg) continue;

      const chave = chaveMensagemHistoricoPerfil(msg);
      const remota = mapa.get(chave);

      mapa.set(chave, {
        ...(remota || {}),
        ...msg,
        __historicoPerfil: false,
      });
    }

    return Array.from(mapa.values()).sort(
      (a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0),
    );
  }

  function mensagensLocaisAbaHistoricoPerfil(conversa, aba) {
    if (aba === "midias") {
      return midiasDaConversa(conversa);
    }

    if (aba === "docs") {
      return documentosDaConversa(conversa);
    }

    return mensagensValidas(conversa).filter((msg) => {
      const texto = String(msg?.texto || "");
      return /\b(?:https?:\/\/|www\.)[^\s<>"']+/i.test(texto);
    });
  }

  function mostrarMidiasLinksDocs(estrutura, abaInicial = "midias") {
    const conversa = estrutura.conversa;

    mostrarSubtela(estrutura, "Mídia, links e docs", (corpo) => {
      const tabs = document.createElement("div");
      tabs.className = "perfil-contato-tabs";

      const conteudo = document.createElement("div");
      conteudo.className = "perfil-contato-midia-lista";

      const abas = [
        ["midias", "Mídia"],
        ["links", "Links"],
        ["docs", "Docs"],
      ];

      let aba = abaInicial;
      let observadorMais = null;

      const desconectarObservadorMais = () => {
        try {
          observadorMais?.disconnect?.();
        } catch {}

        observadorMais = null;
      };

      const itensCombinados = (abaAtual) => {
        const estado = estadoHistoricoPerfil(estrutura, abaAtual);
        const locais = mensagensLocaisAbaHistoricoPerfil(
          conversa,
          abaAtual,
        );

        return mesclarMensagensHistoricoPerfil(locais, estado.itens);
      };

      const carregarAba = async (abaAtual) => {
        const estado = estadoHistoricoPerfil(estrutura, abaAtual);

        if (
          estado.carregando ||
          (!estado.temMais && estado.carregado)
        ) {
          return;
        }

        estado.carregando = true;
        estado.erro = null;

        try {
          const resultado = await ipcRenderer.invoke(
            "listar-midia-links-docs-conversa",
            {
              conversaId: conversa.id,
              aba: abaAtual,
              limite: 100,
              cursor: estado.cursor || null,
            },
          );

          if (!resultado?.ok) {
            throw new Error(
              resultado?.erro || "Não foi possível carregar o histórico.",
            );
          }

          const novos = Array.isArray(resultado?.itens)
            ? resultado.itens
            : [];
          const mapa = new Map(
            estado.itens.map((msg) => [
              chaveMensagemHistoricoPerfil(msg),
              msg,
            ]),
          );

          for (const msg of novos) {
            if (!msg) continue;

            mapa.set(chaveMensagemHistoricoPerfil(msg), {
              ...msg,
              __historicoPerfil: true,
            });
          }

          const cursorAnterior = estado.cursor;
          const proximoCursor =
            String(resultado?.proximoCursor || "").trim() || null;

          estado.itens = Array.from(mapa.values());
          estado.cursor = proximoCursor;
          estado.temMais =
            !!resultado?.temMais &&
            !!proximoCursor &&
            proximoCursor !== cursorAnterior;
          estado.carregado = true;
          estado.paginas += 1;
        } catch (erro) {
          estado.erro =
            erro?.message || "Não foi possível carregar o histórico.";
          estado.temMais = false;
          estado.carregado = true;
        } finally {
          estado.carregando = false;
        }

        if (aba === abaAtual && conteudo.isConnected) {
          render();
        }
      };

      const observarCarregarMais = (alvo, abaAtual) => {
        desconectarObservadorMais();

        if (!window?.IntersectionObserver) {
          alvo.addEventListener(
            "click",
            () => {
              void carregarAba(abaAtual);
            },
            { once: true },
          );
          return;
        }

        observadorMais = new window.IntersectionObserver(
          (entradas) => {
            if (!entradas.some((entrada) => entrada.isIntersecting)) {
              return;
            }

            desconectarObservadorMais();
            void carregarAba(abaAtual);
          },
          {
            rootMargin: "240px",
          },
        );

        observadorMais.observe(alvo);
      };

      const render = () => {
        desconectarObservadorMais();
        conteudo.innerHTML = "";

        tabs.querySelectorAll("button").forEach((botao) => {
          botao.classList.toggle("ativa", botao.dataset.aba === aba);
        });

        const estado = estadoHistoricoPerfil(estrutura, aba);
        const mensagens = itensCombinados(aba);

        if (aba === "midias") {
          const itens = midiasDaConversa({ mensagens });

          if (!itens.length && !estado.carregando && estado.carregado) {
            conteudo.innerHTML =
              '<div class="perfil-contato-vazio">Nenhuma mídia nesta conversa.</div>';
          } else if (itens.length) {
            const grade = document.createElement("div");
            grade.className = "perfil-contato-midia-grade completa";

            for (const msg of itens) {
              grade.appendChild(criarMiniaturaMidia(conversa, msg));
            }

            conteudo.appendChild(grade);
          }
        } else if (aba === "docs") {
          const docs = documentosDaConversa({ mensagens });

          if (!docs.length && !estado.carregando && estado.carregado) {
            conteudo.innerHTML =
              '<div class="perfil-contato-vazio">Nenhum documento nesta conversa.</div>';
          } else {
            for (const msg of docs) {
              const item = criarLinhaMenu({
                icone: "documento",
                titulo: msg.fileName || "Documento",
                subtitulo: horarioMensagem(msg),
                seta: false,
              });

              item.addEventListener("click", () =>
                abrirMidiaDaMensagem(conversa, msg),
              );
              conteudo.appendChild(item);
            }
          }
        } else {
          const links = extrairLinksDaConversa({ mensagens });

          if (!links.length && !estado.carregando && estado.carregado) {
            conteudo.innerHTML =
              '<div class="perfil-contato-vazio">Nenhum link nesta conversa.</div>';
          } else {
            for (const itemLink of links) {
              const item = criarLinhaMenu({
                icone: "link",
                titulo: itemLink.url,
                subtitulo: horarioMensagem(itemLink.msg),
                seta: false,
              });

              item.addEventListener("click", async () => {
                try {
                  await shell?.openExternal?.(itemLink.url);
                } catch {}
              });

              conteudo.appendChild(item);
            }
          }
        }

        if (estado.erro) {
          const erro = document.createElement("div");
          erro.className = "perfil-contato-vazio";
          erro.textContent =
            "Não foi possível consultar mensagens mais antigas agora.";
          conteudo.appendChild(erro);
          return;
        }

        if (estado.carregando) {
          const carregando = document.createElement("div");
          carregando.className = "perfil-contato-vazio";
          carregando.textContent = "Carregando histórico...";
          conteudo.appendChild(carregando);
          return;
        }

        if (!estado.carregado || estado.temMais) {
          const mais = document.createElement("button");
          mais.type = "button";
          mais.className = "perfil-contato-menu-item";
          mais.textContent = estado.carregado
            ? "Carregando mais itens..."
            : "Carregando histórico...";
          conteudo.appendChild(mais);
          observarCarregarMais(mais, aba);
        }
      };

      for (const [id, texto] of abas) {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.dataset.aba = id;
        botao.textContent = texto;
        botao.addEventListener("click", () => {
          aba = id;
          render();

          const estado = estadoHistoricoPerfil(estrutura, aba);

          if (!estado.carregado && !estado.carregando) {
            void carregarAba(aba);
          }
        });
        tabs.appendChild(botao);
      }

      corpo.appendChild(tabs);
      corpo.appendChild(conteudo);

      render();
      void carregarAba(aba);
    });
  }

  async function obterGruposEmComum(estrutura) {
    if (Array.isArray(estrutura.gruposComunsCache)) {
      return estrutura.gruposComunsCache;
    }

    if (estrutura.gruposComunsPromise) {
      return estrutura.gruposComunsPromise;
    }

    const conversa = estrutura.conversa;

    estrutura.gruposComunsPromise = ipcRenderer
      .invoke("listar-grupos-em-comum", {
        conversaId: conversa.id,
        numeroWhatsapp: conversa.numeroWhatsapp || null,
      })
      .then((resultado) => {
        const grupos = Array.isArray(resultado?.grupos) ? resultado.grupos : [];
        estrutura.gruposComunsCache = grupos;
        return grupos;
      })
      .catch((erro) => {
        console.log(
          `[PERFIL] grupos em comum falhou | contato=${conversa.id} | erro=${erro?.message || erro}`,
        );
        estrutura.gruposComunsCache = [];
        return [];
      })
      .finally(() => {
        estrutura.gruposComunsPromise = null;
      });

    return estrutura.gruposComunsPromise;
  }

  async function carregarGruposEmComum(estrutura, container, resumo) {
    const conversa = estrutura.conversa;

    if (String(conversa.id || "").endsWith("@g.us")) {
      container.innerHTML = "";
      resumo.textContent = "";
      return;
    }

    resumo.textContent = "Carregando grupos em comum...";

    const grupos = await obterGruposEmComum(estrutura);

    if (painelAtual !== estrutura || !container.isConnected) return;

    container.innerHTML = "";
    resumo.textContent = grupos.length
      ? `${grupos.length} grupo${grupos.length === 1 ? "" : "s"} em comum`
      : "Nenhum grupo em comum";

    for (const grupo of grupos.slice(0, 12)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "perfil-contato-grupo-item";

      const conversaGrupo = conversas?.[grupo.id] || {
        id: grupo.id,
        nome: grupo.nome || grupo.id,
        grupo: true,
      };

      const avatar = criarAvatarContato(conversaGrupo, 40);
      avatar.classList.add("perfil-contato-grupo-avatar");

      const info = document.createElement("span");
      info.className = "perfil-contato-grupo-info";

      const nome = document.createElement("span");
      nome.className = "perfil-contato-grupo-nome";
      nome.textContent = grupo.nome || conversaGrupo.nome || "Grupo";

      const membros = document.createElement("span");
      membros.className = "perfil-contato-grupo-meta";
      membros.textContent =
        Number(grupo.totalParticipantes || 0) > 0
          ? `${grupo.totalParticipantes} participantes`
          : "Grupo do WhatsApp";

      info.appendChild(nome);
      info.appendChild(membros);
      item.appendChild(avatar);
      item.appendChild(info);

      if (conversas?.[grupo.id]) {
        item.addEventListener("click", () => {
          fecharPerfilContato();
          setTimeout(
            () =>
              abrirConversa?.(grupo.id, {
                origemPerfilContatoId: conversa.id,
              }),
            Math.max(190, Number(DURACAO_TRANSICAO_PERFIL || 220)),
          );
        });
      } else {
        item.disabled = true;
      }

      container.appendChild(item);
    }
  }

  function ehGrupo(conversa) {
    return !!conversa?.grupo || String(conversa?.id || "").endsWith("@g.us");
  }

  function normalizarNumeroParticipante(valor) {
    return String(valor || "").replace(/\D/g, "");
  }

  function conversaParaParticipante(participante) {
    if (!participante) return null;

    if (conversas?.[participante.id]) return conversas[participante.id];

    const numero = normalizarNumeroParticipante(
      participante.numeroWhatsapp || participante.id,
    );

    if (numero) {
      for (const conversa of Object.values(conversas || {})) {
        const numeroConversa = normalizarNumeroParticipante(
          conversa?.numeroWhatsapp || conversa?.id,
        );
        if (numeroConversa && numeroConversa === numero) return conversa;
      }
    }

    return {
      id: participante.id,
      numeroWhatsapp: participante.numeroWhatsapp || participante.id,
      nome: participante.nome || participante.numeroWhatsapp || participante.id,
      grupo: false,
    };
  }

  async function obterParticipantesGrupo(estrutura) {
    if (!ehGrupo(estrutura?.conversa)) {
      return { participantes: [], euNoGrupo: false, total: 0 };
    }

    if (estrutura.participantesCache) return estrutura.participantesCache;
    if (estrutura.participantesPromise) return estrutura.participantesPromise;

    estrutura.participantesPromise = ipcRenderer
      .invoke("listar-participantes-grupo", {
        conversaId: estrutura.conversa.id,
      })
      .then((resultado) => {
        const dados = {
          participantes: Array.isArray(resultado?.participantes)
            ? resultado.participantes
            : [],
          euNoGrupo: resultado?.euNoGrupo !== false,
          total:
            Number(resultado?.total || 0) ||
            (Array.isArray(resultado?.participantes)
              ? resultado.participantes.length
              : 0),
        };

        estrutura.participantesCache = dados;
        estrutura.euNoGrupo = dados.euNoGrupo;
        estrutura.conversa.euNoGrupo = dados.euNoGrupo;
        estrutura.conversa.saiuGrupo = !dados.euNoGrupo;
        return dados;
      })
      .catch((erro) => {
        console.warn(
          `[PERFIL] participantes do grupo falhou | grupo=${estrutura.conversa.id} | erro=${erro?.message || erro}`,
        );
        const dados = { participantes: [], euNoGrupo: null, total: 0 };
        estrutura.participantesCache = dados;
        return dados;
      })
      .finally(() => {
        estrutura.participantesPromise = null;
      });

    return estrutura.participantesPromise;
  }

  function sincronizarControlesGrupo(estrutura) {
    if (!estrutura || !ehGrupo(estrutura.conversa)) return;

    const saiu =
      estrutura.euNoGrupo === false || estrutura.conversa.saiuGrupo === true;

    if (estrutura.botaoSairGrupo) {
      estrutura.botaoSairGrupo.disabled = saiu;
      const titulo = estrutura.botaoSairGrupo.querySelector(
        ".perfil-contato-menu-titulo",
      );
      const subtitulo = estrutura.botaoSairGrupo.querySelector(
        ".perfil-contato-menu-subtitulo",
      );
      if (titulo)
        titulo.textContent = saiu ? "Você saiu deste grupo" : "Sair do grupo";
      if (subtitulo) {
        subtitulo.textContent = saiu
          ? "Você não receberá novas mensagens deste grupo"
          : "Você deixará de receber novas mensagens";
      }
    }

    if (estrutura.botaoApagarGrupo) {
      estrutura.botaoApagarGrupo.disabled = !saiu;
      const subtitulo = estrutura.botaoApagarGrupo.querySelector(
        ".perfil-contato-menu-subtitulo",
      );
      if (subtitulo) {
        subtitulo.textContent = saiu
          ? "Remove a conversa da lista"
          : "Saia do grupo antes de apagar a conversa";
      }
    }
  }

  function criarItemParticipante(participante) {
    const item = document.createElement("div");
    item.className = "perfil-grupo-participante-item";

    const conversaParticipante = conversaParaParticipante(participante);
    const avatar = criarAvatarContato(conversaParticipante, 42);
    avatar.classList.add("perfil-grupo-participante-avatar");

    const info = document.createElement("div");
    info.className = "perfil-grupo-participante-info";

    const linhaNome = document.createElement("div");
    linhaNome.className = "perfil-grupo-participante-linha-nome";

    const nome = document.createElement("span");
    nome.className = "perfil-grupo-participante-nome";
    nome.textContent = participante.ehVoce
      ? "Você"
      : participante.nome ||
        formatarNumeroWhatsapp(participante.numeroWhatsapp || participante.id);
    linhaNome.appendChild(nome);

    if (participante.admin || participante.superAdmin) {
      const badge = document.createElement("span");
      badge.className = "perfil-grupo-participante-admin";
      badge.textContent = "Admin";
      linhaNome.appendChild(badge);
    }

    const numero = document.createElement("div");
    numero.className = "perfil-grupo-participante-numero";
    numero.textContent = participante.ehVoce
      ? formatarNumeroWhatsapp(participante.numeroWhatsapp || participante.id)
      : formatarNumeroWhatsapp(participante.numeroWhatsapp || participante.id);

    info.appendChild(linhaNome);
    info.appendChild(numero);
    item.appendChild(avatar);
    item.appendChild(info);
    return item;
  }

  async function carregarParticipantesGrupo(
    estrutura,
    lista,
    resumo,
    descricaoHero,
  ) {
    resumo.textContent = "Carregando participantes...";
    lista.innerHTML = "";

    const dados = await obterParticipantesGrupo(estrutura);
    if (painelAtual !== estrutura) return;

    lista.innerHTML = "";
    const participantes = dados.participantes || [];

    resumo.textContent = dados.total
      ? `${dados.total} participante${dados.total === 1 ? "" : "s"}`
      : "Nenhum participante disponível";

    if (descricaoHero && dados.total) {
      descricaoHero.textContent = `${dados.total} participante${dados.total === 1 ? "" : "s"}`;
    }

    if (!participantes.length) {
      const vazio = document.createElement("div");
      vazio.className = "perfil-contato-preview-vazio";
      vazio.textContent = "Não foi possível carregar os participantes.";
      lista.appendChild(vazio);
    } else {
      for (const participante of participantes) {
        lista.appendChild(criarItemParticipante(participante));
      }
    }

    sincronizarControlesGrupo(estrutura);
  }

  function renderizarPrincipal(estrutura) {
    const { card, conversa } = estrutura;
    const grupo = ehGrupo(conversa);

    estrutura.tela = "principal";
    card.innerHTML = "";
    card.appendChild(
      criarCabecalhoPainel(grupo ? "Dados do grupo" : "Dados do contato"),
    );

    const corpo = document.createElement("div");
    corpo.className = "perfil-contato-corpo";
    card.appendChild(corpo);

    const hero = document.createElement("section");
    hero.className = "perfil-contato-hero";

    const avatarGrande = criarAvatarContato(conversa, 112);
    avatarGrande.classList.add(
      "avatar-perfil-contato",
      "perfil-contato-avatar-grande",
    );
    if (!grupo && conversa.bloqueada)
      avatarGrande.classList.add("avatar-contato-bloqueado");

    const nome = document.createElement("div");
    nome.className = "perfil-contato-nome";
    nome.textContent = conversa.nome || conversa.id;

    const numero = document.createElement("div");
    numero.className = "perfil-contato-numero";
    numero.textContent = grupo
      ? "Grupo do WhatsApp"
      : formatarNumeroWhatsapp(conversa.numeroWhatsapp || conversa.id);

    const acoes = document.createElement("div");
    acoes.className = "perfil-contato-acoes-rapidas";

    const pesquisar = document.createElement("button");
    pesquisar.type = "button";
    pesquisar.className = "perfil-contato-acao-rapida";
    pesquisar.innerHTML = `${iconeSvg("pesquisar")}<span>Pesquisar</span>`;
    pesquisar.addEventListener("click", () => mostrarPesquisa(estrutura));

    acoes.appendChild(pesquisar);
    hero.appendChild(avatarGrande);
    hero.appendChild(nome);
    hero.appendChild(numero);
    hero.appendChild(acoes);
    corpo.appendChild(hero);

    const midias = midiasDaConversa(conversa);
    const docs = documentosDaConversa(conversa);
    const links = extrairLinksDaConversa(conversa);

    const secaoMidia = document.createElement("section");
    secaoMidia.className = "perfil-contato-secao";

    const cabMidia = document.createElement("button");
    cabMidia.type = "button";
    cabMidia.className = "perfil-contato-secao-cabecalho";
    cabMidia.innerHTML = `<span class="perfil-contato-secao-cab-icone">${iconeSvg("midia")}</span><span>Mídia, links e docs</span><span class="perfil-contato-secao-contagem">${midias.length + docs.length + links.length}</span><span class="perfil-contato-menu-seta">${iconeSvg("seta")}</span>`;
    cabMidia.addEventListener("click", () => mostrarMidiasLinksDocs(estrutura));
    secaoMidia.appendChild(cabMidia);

    const gradePreview = document.createElement("div");
    gradePreview.className = "perfil-contato-midia-grade preview";
    const preview = [...midias.slice(0, 4)];
    if (!preview.length && docs.length) preview.push(...docs.slice(0, 4));

    if (preview.length) {
      for (const msg of preview)
        gradePreview.appendChild(criarMiniaturaMidia(conversa, msg));
    } else {
      const vazio = document.createElement("div");
      vazio.className = "perfil-contato-preview-vazio";
      vazio.textContent = "Nenhuma mídia recente";
      gradePreview.appendChild(vazio);
    }

    secaoMidia.appendChild(gradePreview);
    corpo.appendChild(secaoMidia);

    const favoritos = favoritosDaConversa(conversa);
    const menus = document.createElement("section");
    menus.className = "perfil-contato-secao perfil-contato-menu-lista";

    const favoritosBtn = criarLinhaMenu({
      icone: "favorito",
      titulo: "Mensagens favoritas",
      subtitulo: favoritos.length
        ? `${favoritos.length} nesta conversa`
        : "Nenhuma favorita",
    });
    favoritosBtn.addEventListener("click", () => mostrarFavoritos(estrutura));
    menus.appendChild(favoritosBtn);

    const silenciada =
      !!privacidadeConversa?.notificacoesSilenciadas?.(conversa);
    const notificacoesLinha = criarLinhaMenu({
      icone: "sino",
      titulo: "Silenciar notificações",
      seta: false,
    });

    const switchWrap = document.createElement("span");
    switchWrap.className = `perfil-contato-switch${silenciada ? " ativo" : ""}`;
    switchWrap.innerHTML =
      '<span class="perfil-contato-switch-bolinha"></span>';
    notificacoesLinha.appendChild(switchWrap);
    notificacoesLinha.addEventListener("click", () => {
      const passouASilenciar =
        privacidadeConversa?.alternarNotificacoes?.(conversa);
      switchWrap.classList.toggle("ativo", !!passouASilenciar);
    });
    menus.appendChild(notificacoesLinha);
    corpo.appendChild(menus);

    if (grupo) {
      const participantesSecao = document.createElement("section");
      participantesSecao.className =
        "perfil-contato-secao perfil-grupo-participantes-secao";

      const participantesTitulo = document.createElement("div");
      participantesTitulo.className = "perfil-contato-secao-titulo";
      participantesTitulo.innerHTML = `<span class="perfil-contato-secao-cab-icone">${iconeSvg("grupo")}</span><span>Participantes</span>`;

      const participantesResumo = document.createElement("div");
      participantesResumo.className = "perfil-contato-grupos-resumo";

      const participantesLista = document.createElement("div");
      participantesLista.className = "perfil-grupo-participantes-lista";

      participantesSecao.appendChild(participantesTitulo);
      participantesSecao.appendChild(participantesResumo);
      participantesSecao.appendChild(participantesLista);
      corpo.appendChild(participantesSecao);

      void carregarParticipantesGrupo(
        estrutura,
        participantesLista,
        participantesResumo,
        numero,
      );
    } else {
      const gruposSecao = document.createElement("section");
      gruposSecao.className = "perfil-contato-secao";

      const gruposTitulo = document.createElement("div");
      gruposTitulo.className = "perfil-contato-secao-titulo";
      gruposTitulo.innerHTML = `<span class="perfil-contato-secao-cab-icone">${iconeSvg("grupo")}</span><span>Grupos em comum</span>`;

      const gruposResumo = document.createElement("div");
      gruposResumo.className = "perfil-contato-grupos-resumo";

      const gruposLista = document.createElement("div");
      gruposLista.className = "perfil-contato-grupos-lista";

      gruposSecao.appendChild(gruposTitulo);
      gruposSecao.appendChild(gruposResumo);
      gruposSecao.appendChild(gruposLista);
      corpo.appendChild(gruposSecao);
      void carregarGruposEmComum(estrutura, gruposLista, gruposResumo);
    }

    const gerenciamento = document.createElement("section");
    gerenciamento.className = "perfil-contato-secao perfil-contato-menu-lista";

    const arquivar = criarLinhaMenu({
      icone: "arquivar",
      titulo: conversa.arquivada ? "Desarquivar conversa" : "Arquivar conversa",
      seta: false,
    });
    arquivar.addEventListener("click", async () => {
      arquivar.disabled = true;
      const ok = await privacidadeConversa?.alterarArquivamento?.(conversa, {
        aoConfirmar: () => fecharPerfilContato(),
      });
      if (!ok && painelAtual === estrutura) arquivar.disabled = false;
    });
    gerenciamento.appendChild(arquivar);

    const trancar = criarLinhaMenu({
      icone: "trancar",
      titulo: conversa.trancada ? "Destrancar conversa" : "Trancar conversa",
      seta: false,
    });
    trancar.addEventListener("click", async () => {
      trancar.disabled = true;
      const ok = await privacidadeConversa?.alterarTrancamento?.(conversa, {
        aoConfirmar: () => fecharPerfilContato(),
      });
      if (!ok && painelAtual === estrutura) trancar.disabled = false;
    });
    gerenciamento.appendChild(trancar);

    if (!grupo) {
      const bloquear = criarLinhaMenu({
        icone: "bloquear",
        titulo: conversa.bloqueada ? "Desbloquear contato" : "Bloquear contato",
        perigo: !conversa.bloqueada,
        seta: false,
      });

      if (conversa.podeBloquear === false) {
        bloquear.disabled = true;
        bloquear.querySelector(".perfil-contato-menu-titulo").textContent =
          "Bloqueio indisponível";
      }

      bloquear.addEventListener("click", async () => {
        if (conversa.podeBloquear === false) return;
        bloquear.disabled = true;

        const resultado = await privacidadeConversa?.alterarBloqueio?.(
          conversa,
          {
            antes: async (vaiBloquear) => {
              avatarGrande.classList.add(
                vaiBloquear ? "efeito-bloqueando" : "efeito-desbloqueando",
              );
            },
            depois: async (bloqueada) => {
              await esperarTransicao(220);
              avatarGrande.classList.toggle(
                "avatar-contato-bloqueado",
                bloqueada,
              );
              avatarGrande.classList.remove(
                "efeito-bloqueando",
                "efeito-desbloqueando",
              );
            },
          },
        );

        if (resultado?.ok) {
          renderizarPrincipal(estrutura);
        } else {
          bloquear.disabled = false;
          avatarGrande.classList.remove(
            "efeito-bloqueando",
            "efeito-desbloqueando",
          );
        }
      });
      gerenciamento.appendChild(bloquear);
    } else {
      const sair = criarLinhaMenu({
        icone: "sair",
        titulo: "Sair do grupo",
        subtitulo: "Você deixará de receber novas mensagens",
        perigo: true,
        seta: false,
      });
      estrutura.botaoSairGrupo = sair;
      sair.addEventListener("click", async () => {
        sair.disabled = true;
        const resultado = await privacidadeConversa?.sairDoGrupo?.(conversa, {
          depois: async () => {
            estrutura.euNoGrupo = false;
            estrutura.participantesCache = null;
            sincronizarControlesGrupo(estrutura);
          },
        });
        if (!resultado?.ok && !resultado?.cancelado) sair.disabled = false;
        if (resultado?.cancelado) sincronizarControlesGrupo(estrutura);
      });
      gerenciamento.appendChild(sair);
    }

    const limpar = criarLinhaMenu({
      icone: "limpar",
      titulo: "Limpar conversa",
      perigo: true,
      seta: false,
    });
    limpar.addEventListener("click", () => {
      fecharPerfilContato();
      setTimeout(
        () => privacidadeConversa?.abrirGerenciamento?.(conversa, "limpar"),
        Math.max(190, Number(DURACAO_TRANSICAO_PERFIL || 220)),
      );
    });
    gerenciamento.appendChild(limpar);

    const apagar = criarLinhaMenu({
      icone: "apagar",
      titulo: "Apagar conversa",
      subtitulo: grupo
        ? "Saia do grupo antes de apagar a conversa"
        : "Remove a conversa da lista",
      perigo: true,
      seta: false,
    });
    if (grupo) estrutura.botaoApagarGrupo = apagar;
    apagar.addEventListener("click", () => {
      if (apagar.disabled) return;
      fecharPerfilContato();
      setTimeout(
        () => privacidadeConversa?.abrirGerenciamento?.(conversa, "apagar"),
        Math.max(190, Number(DURACAO_TRANSICAO_PERFIL || 220)),
      );
    });
    gerenciamento.appendChild(apagar);

    corpo.appendChild(gerenciamento);

    if (grupo) sincronizarControlesGrupo(estrutura);
  }

  async function abrirPerfilContato(conversa) {
    if (!conversa) return;

    fecharPerfilContato(true);

    const overlay = document.createElement("div");
    overlay.className = "perfil-contato-overlay";

    const card = document.createElement("aside");
    card.className = "perfil-contato-card";
    card.setAttribute(
      "aria-label",
      ehGrupo(conversa) ? "Dados do grupo" : "Dados do contato",
    );

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const estrutura = {
      overlay,
      card,
      conversa,
      gruposComunsCache: null,
      gruposComunsPromise: null,
      participantesCache: null,
      participantesPromise: null,
      euNoGrupo: conversa.euNoGrupo ?? null,
      botaoSairGrupo: null,
      botaoApagarGrupo: null,
      tela: "principal",
    };
    painelAtual = estrutura;

    const onKeyDown = (evento) => {
      if (evento.key === "Escape" && painelAtual === estrutura) {
        fecharPerfilContato();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    removerListenerEscape = () =>
      document.removeEventListener("keydown", onKeyDown);

    renderizarPrincipal(estrutura);

    const abrirAnimacao = () => overlay.classList.add("perfil-contato-aberto");
    if (typeof window?.requestAnimationFrame === "function") {
      window.requestAnimationFrame(abrirAnimacao);
    } else {
      setTimeout(abrirAnimacao, 0);
    }

    if (
      !conversa.fotoPerfilTentada ||
      (!conversa.numeroWhatsapp && !String(conversa.id || "").endsWith("@g.us"))
    ) {
      conversa.fotoPerfilTentada = false;
      void carregarFotoPerfil(conversa, false)
        .then(() => {
          if (painelAtual === estrutura && estrutura.tela === "principal") {
            renderizarPrincipal(estrutura);
          }
        })
        .catch(() => {});
    }

    if (!String(conversa.id || "").endsWith("@g.us")) {
      void consultarBloqueioDaConversa(conversa).then(() => {
        if (painelAtual === estrutura && estrutura.tela === "principal") {
          renderizarPrincipal(estrutura);
        }
      });
    }
  }

  const EVENTO_ABRIR_PERFIL_ORIGEM_GRUPO =
    "whatsiapp:abrir-perfil-origem-grupo";

  const aoSolicitarPerfilOrigemGrupo = (evento) => {
    const conversaId = String(evento?.detail?.conversaId || "").trim();
    const conversa = conversaId ? conversas?.[conversaId] : null;

    if (!conversa || ehGrupo(conversa)) {
      return;
    }

    void abrirPerfilContato(conversa);
  };

  window?.addEventListener?.(
    EVENTO_ABRIR_PERFIL_ORIGEM_GRUPO,
    aoSolicitarPerfilOrigemGrupo,
  );

  return {
    abrirPerfilContato,
    fecharPerfilContato,
  };
}

module.exports = {
  criarRecursosVisuaisPerfilContato,
  criarModuloPerfilContato,
};
