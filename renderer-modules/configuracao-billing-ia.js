function criarModuloConfiguracaoBillingIA(deps = {}) {
  const {
    ipcRenderer,
    document,
    window,
    localStorage,
    requestAnimationFrame,
    formatarMoedaAdmin,
    formatarMoedaAdminPrecisa,
    obterModuloAdminOculto,
  } = deps;

  const CHAVE_PROMPT_BASE_IA = "whatsiapp.ia.promptBase.v1";
  const CHAVE_PROMPT_PERSONALIZADO_IA = "whatsiapp.ia.promptPersonalizado.v1";
  const CHAVE_NIVEL_CONTEXTO_IA = "whatsiapp.ia.nivelContexto.v1";

  // Por enquanto o nosso build trabalha em modo desenvolvedor.
  // No futuro este valor vira permissao entregue pelo backend/licenca.
  const MODO_APLICACAO_IA = "dev";

  function obterPromptInternoIA() {
    // Mantemos a chave antiga de proposito: o prompt que ja estava salvo passa a
    // ser o Motor interno do WhatsIAPP sem perder nenhum caractere.
    return localStorage.getItem(CHAVE_PROMPT_BASE_IA) || "";
  }

  function salvarPromptInternoIA(valor) {
    localStorage.setItem(CHAVE_PROMPT_BASE_IA, String(valor || "").trim());
  }

  function obterPromptPersonalizadoIA() {
    return localStorage.getItem(CHAVE_PROMPT_PERSONALIZADO_IA) || "";
  }

  function salvarPromptPersonalizadoIA(valor) {
    localStorage.setItem(
      CHAVE_PROMPT_PERSONALIZADO_IA,
      String(valor || "").trim(),
    );
  }

  // Alias de compatibilidade para qualquer integracao local que ainda consulte
  // o nome antigo. Agora ele representa o prompt interno obrigatorio.
  function obterPromptBaseIA() {
    return obterPromptInternoIA();
  }

  const NIVEIS_CONTEXTO_IA = {
    minimo: {
      id: "minimo",
      nome: "Mínimo",
      mensagens: 15,
      promptMaximo: 3000,
      tokensContexto: 2000,
      consumo: "Muito baixo",
      descricao:
        "Ideal para respostas rápidas e conversas simples. Mantém o consumo de IA no menor nível possível.",
    },
    baixo: {
      id: "baixo",
      nome: "Baixo",
      mensagens: 25,
      promptMaximo: 5000,
      tokensContexto: 4000,
      consumo: "Baixo",
      descricao:
        "Bom para conversas do dia a dia que precisam lembrar um pouco mais do histórico recente.",
    },
    medio: {
      id: "medio",
      nome: "Médio",
      mensagens: 50,
      promptMaximo: 8000,
      tokensContexto: 8000,
      consumo: "Moderado",
      descricao:
        "Equilíbrio entre memória da conversa, personalização e consumo de IA.",
    },
    alto: {
      id: "alto",
      nome: "Alto",
      mensagens: 100,
      promptMaximo: 12000,
      tokensContexto: 16000,
      consumo: "Alto",
      descricao:
        "Indicado para conversas longas e assuntos que dependem bastante do histórico anterior.",
    },
    muito_alto: {
      id: "muito_alto",
      nome: "Muito alto",
      mensagens: 150,
      promptMaximo: 16000,
      tokensContexto: 24000,
      consumo: "Muito alto",
      descricao:
        "Oferece memória extensa da conversa e permite personalizações bem mais detalhadas.",
    },
    maximo: {
      id: "maximo",
      nome: "Máximo",
      mensagens: 200,
      promptMaximo: 20000,
      tokensContexto: 32000,
      consumo: "Máximo",
      descricao:
        "Maior capacidade disponível. Feito para conversas extensas, personalização completa e uso avançado de contexto.",
    },
  };

  let configuracaoComercialCliente = {
    nomeCliente: "",
    plano: "premium",
    nomePlano: "Premium",
    niveisPermitidos: [
      "minimo",
      "baixo",
      "medio",
      "alto",
      "muito_alto",
      "maximo",
    ],
    pesquisaWebPermitida: true,
  };

  function obterConfiguracaoComercialCliente() {
    return configuracaoComercialCliente;
  }

  function aplicarConfiguracaoComercialCliente(configuracao = {}) {
    const niveis = Array.isArray(configuracao?.niveisPermitidos)
      ? configuracao.niveisPermitidos.filter((id) => NIVEIS_CONTEXTO_IA[id])
      : [];
    configuracaoComercialCliente = {
      nomeCliente: String(configuracao?.nomeCliente || "").trim(),
      plano: String(configuracao?.plano || "premium").trim() || "premium",
      nomePlano:
        String(configuracao?.nomePlano || "Premium").trim() || "Premium",
      niveisPermitidos: niveis.length
        ? niveis
        : ["minimo", "baixo", "medio", "alto", "muito_alto", "maximo"],
      pesquisaWebPermitida: configuracao?.pesquisaWebPermitida !== false,
    };
    return configuracaoComercialCliente;
  }

  function nivelContextoPermitidoPeloPlano(nivelId) {
    return configuracaoComercialCliente.niveisPermitidos.includes(
      String(nivelId || "").trim(),
    );
  }

  function nivelFallbackPermitidoPeloPlano() {
    const permitidos = configuracaoComercialCliente.niveisPermitidos.filter(
      (id) => NIVEIS_CONTEXTO_IA[id],
    );
    return permitidos[permitidos.length - 1] || "minimo";
  }

  function pesquisaWebPermitidaPeloPlano() {
    return !!configuracaoComercialCliente.pesquisaWebPermitida;
  }

  async function carregarConfiguracaoComercialCliente() {
    try {
      const resultado = await ipcRenderer.invoke("admin-config-publica");
      if (resultado?.ok && resultado?.configuracao) {
        aplicarConfiguracaoComercialCliente(resultado.configuracao);
      }
    } catch {}

    const nivelAtual = obterNivelContextoIA();
    if (!nivelContextoPermitidoPeloPlano(nivelAtual)) {
      salvarNivelContextoIA(nivelFallbackPermitidoPeloPlano());
    }
    if (!pesquisaWebPermitidaPeloPlano()) {
      try {
        localStorage.setItem("whatsiapp.ia.pesquisaWebAtiva.v1", "0");
      } catch {}
    }
    return configuracaoComercialCliente;
  }

  function obterNivelContextoIA() {
    const salvo = String(
      localStorage.getItem(CHAVE_NIVEL_CONTEXTO_IA) || "minimo",
    ).trim();
    return NIVEIS_CONTEXTO_IA[salvo] ? salvo : "minimo";
  }

  function salvarNivelContextoIA(nivelId) {
    const id = NIVEIS_CONTEXTO_IA[nivelId] ? nivelId : "minimo";
    localStorage.setItem(CHAVE_NIVEL_CONTEXTO_IA, id);
    return id;
  }

  function obterConfiguracaoNivelContextoIA(nivelId = obterNivelContextoIA()) {
    return NIVEIS_CONTEXTO_IA[nivelId] || NIVEIS_CONTEXTO_IA.minimo;
  }

  function obterLimitesContextoIAParaMotor() {
    const configuracao = obterConfiguracaoNivelContextoIA();
    return {
      nivel: configuracao.id,
      limiteMensagens: configuracao.mensagens,
      promptPersonalizadoMaximo: configuracao.promptMaximo,
      // Compatibilidade com o index anterior durante a transicao.
      promptMaximo: configuracao.promptMaximo,
      limiteTokensContexto: configuracao.tokensContexto,
    };
  }

  window.whatsiappIA = {
    obterPromptBase: obterPromptInternoIA,
    obterPromptInterno: obterPromptInternoIA,
    obterPromptPersonalizado: obterPromptPersonalizadoIA,
    obterNivelContexto: obterNivelContextoIA,
    obterConfiguracaoNivelContexto: obterConfiguracaoNivelContextoIA,
  };

  const toastInternoContainer = document.createElement("div");
  toastInternoContainer.id = "toastInternoContainer";
  document.body.appendChild(toastInternoContainer);

  function mostrarToastBillingIA(dados = {}) {
    const tipo = String(dados?.tipo || "aviso").toLowerCase();
    const bloqueio = tipo === "bloqueio";
    const percentual = Math.max(
      0,
      Math.min(100, Math.round(Number(dados?.percentual || 0) || 0)),
    );
    const nomePlano = String(dados?.nomePlano || "plano atual");
    const consumido = formatarMoedaAdminPrecisa(dados?.consumidoBrl);
    const orcamento = formatarMoedaAdmin(dados?.orcamentoBrl);
    const saldo = formatarMoedaAdminPrecisa(dados?.saldoBrl);
    const toast = document.createElement("div");
    toast.className = `toast-interno billing-toast ${bloqueio ? "billing-bloqueio" : "billing-aviso"}`;
    const avatar = document.createElement("div");
    avatar.className = "toast-interno-avatar billing-toast-avatar";
    avatar.textContent = bloqueio ? "!" : `${percentual}%`;
    const conteudo = document.createElement("div");
    conteudo.className = "toast-interno-conteudo";
    const titulo = document.createElement("div");
    titulo.className = "toast-interno-nome";
    titulo.textContent = bloqueio
      ? "Limite mensal de IA atingido"
      : `Uso de IA chegou a ${percentual}%`;
    const preview = document.createElement("div");
    preview.className = "toast-interno-preview billing-toast-preview";
    preview.textContent = bloqueio
      ? `${nomePlano}: ${consumido} de ${orcamento}. Novas chamadas de IA estão bloqueadas.`
      : `${nomePlano}: ${consumido} de ${orcamento}. Saldo disponível: ${saldo}.`;
    const fechar = document.createElement("button");
    fechar.type = "button";
    fechar.className = "toast-interno-fechar";
    fechar.textContent = "×";
    fechar.setAttribute("aria-label", "Fechar aviso de consumo");
    conteudo.appendChild(titulo);
    conteudo.appendChild(preview);
    toast.appendChild(avatar);
    toast.appendChild(conteudo);
    toast.appendChild(fechar);
    toastInternoContainer.prepend(toast);

    let removendo = false;
    let timerRemocao = null;
    const removerToast = () => {
      if (removendo) {
        return;
      }
      removendo = true;
      clearTimeout(timerRemocao);
      toast.classList.remove("visivel");
      toast.classList.add("saindo");
      setTimeout(() => toast.remove(), 190);
    };

    fechar.addEventListener("click", (evento) => {
      evento.stopPropagation();
      removerToast();
    });
    toast.addEventListener("click", removerToast);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add("visivel"));
    });
    timerRemocao = setTimeout(removerToast, bloqueio ? 14000 : 9000);

    while (toastInternoContainer.children.length > 4) {
      toastInternoContainer.lastElementChild?.remove();
    }

    ipcRenderer
      .invoke("mostrar-notificacao", {
        titulo: bloqueio
          ? "WhatsIAPP, limite de IA atingido"
          : `WhatsIAPP, uso de IA em ${percentual}%`,
        corpo: bloqueio
          ? `${nomePlano}: o orçamento mensal de IA foi atingido.`
          : `${nomePlano}: ${consumido} de ${orcamento}. Saldo ${saldo}.`,
      })
      .catch(() => {});
  }

  ipcRenderer.on("billing-ia-aviso", (_evento, dados) => {
    mostrarToastBillingIA(dados || {});
  });

  ipcRenderer.on("billing-precificacao-atualizada", (_evento, dados) => {
    try {
      obterModuloAdminOculto?.()?.aplicarPrecificacaoAtualizada?.(dados);
    } catch {}
  });

  return {
    MODO_APLICACAO_IA,
    NIVEIS_CONTEXTO_IA,
    toastInternoContainer,
    obterPromptInternoIA,
    salvarPromptInternoIA,
    obterPromptPersonalizadoIA,
    salvarPromptPersonalizadoIA,
    obterPromptBaseIA,
    obterConfiguracaoComercialCliente,
    aplicarConfiguracaoComercialCliente,
    nivelContextoPermitidoPeloPlano,
    nivelFallbackPermitidoPeloPlano,
    pesquisaWebPermitidaPeloPlano,
    carregarConfiguracaoComercialCliente,
    obterNivelContextoIA,
    salvarNivelContextoIA,
    obterConfiguracaoNivelContextoIA,
    obterLimitesContextoIAParaMotor,
    mostrarToastBillingIA,
  };
}

module.exports = {
  criarModuloConfiguracaoBillingIA,
};
