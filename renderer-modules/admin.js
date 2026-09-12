// Modulo da area administrativa do WhatsIAPP.
// Extraido do renderer sem alterar o comportamento funcional.

function textoSeguroAdmin(valor) {
  return String(valor || "");
}

function escaparHtmlAdmin(valor) {
  return textoSeguroAdmin(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function numeroDecimalAdminRenderer(valor, padrao = 0, casas = 6) {
  const numero = Number(
    String(valor ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(",", "."),
  );

  if (!Number.isFinite(numero) || numero < 0) {
    return Number(padrao) || 0;
  }

  const fator = 10 ** Math.max(0, Math.min(8, Number(casas) || 0));
  return Math.round(numero * fator) / fator;
}

function formatarMoedaAdmin(valor) {
  const numero = Number(valor);
  const final = Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0;

  return final.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarMoedaAdminPrecisa(valor) {
  const numero = Math.max(0, Number(valor || 0) || 0);
  const casas = numero > 0 && numero < 0.01 ? 4 : 2;

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function criarModuloAdmin(dependencias = {}) {
  const {
    ipcRenderer,
    crypto,
    os,
    conversas,
    conversasSombraTesteIA,
    mensagens,
    botaoPerfilApp,
    aplicarConfiguracaoComercialCliente,
    atualizarResumoConfiguracoesIA,
    abrirEditorPromptIA,
    campoPromptBaseIA,
    cancelarRespostaAutomaticaIAEmAndamento,
    ehConversaTecnica,
    entradasCurtasIAPorConversa,
    fecharPromptBaseIAConfig,
    limparEntradaCurtaIA,
    limparPendenciaClimaIA,
    limparRespostaAutomaticaPendente,
    locaisClimaIAPorConversa,
    nivelContextoPermitidoPeloPlano,
    nivelFallbackPermitidoPeloPlano,
    obterNivelContextoIA,
    obterPromptInternoIA,
    overlayPromptBaseIA,
    pendenciasClimaIAPorConversa,
    pesquisaWebPermitidaPeloPlano,
    respostasAutomaticasEmGeracao,
    respostasAutomaticasPendentes,
    respostasAutomaticasProcessadas,
    salvarModoIAConversa,
    salvarNivelContextoIA,
    salvarPesquisaWebAtivaIA,
    salvarSegundoPlanoIAConversa,
    timersRespostaAutomaticaIA,
    ultimaRotaRespostaIAPorConversa,
    obterConfiguracaoComercialCliente,
    obterConversaAtual,
    obterTipoPromptIAEmEdicao,
  } = dependencias;

  const adminOcultoOverlay = document.createElement("div");
  adminOcultoOverlay.id = "adminOcultoOverlay";
  adminOcultoOverlay.setAttribute("aria-hidden", "true");
  adminOcultoOverlay.innerHTML = `
  <section id="adminOcultoCard" role="dialog" aria-modal="true" aria-label="Administração do WhatsIAPP">
    <div class="admin-oculto-topo">
      <div>
        <div class="admin-oculto-marca">WhatsIAPP</div>
        <div id="adminOcultoTitulo" class="admin-oculto-titulo">Administração</div>
      </div>
      <button id="adminOcultoFechar" class="admin-oculto-fechar" type="button" aria-label="Fechar">×</button>
    </div>
    <div id="adminOcultoConteudo" class="admin-oculto-conteudo"></div>
  </section>
`;
  document.body.appendChild(adminOcultoOverlay);

  const adminOcultoConteudo = adminOcultoOverlay.querySelector(
    "#adminOcultoConteudo",
  );
  const adminOcultoTitulo =
    adminOcultoOverlay.querySelector("#adminOcultoTitulo");
  const adminOcultoFechar =
    adminOcultoOverlay.querySelector("#adminOcultoFechar");

  let tokenSessaoAdminOculto = null;
  let motorIAAdminAtual = "";
  let adminOcultoAbrindo = false;
  let adminEstadoEdicao = null;
  let adminConfirmacaoRollbackAberta = false;

  function textoSeguroAdmin(valor) {
    return String(valor || "");
  }

  function escaparHtmlAdmin(valor) {
    return textoSeguroAdmin(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const adminRollbackOverlay = document.createElement("div");
  adminRollbackOverlay.id = "adminRollbackOverlay";
  adminRollbackOverlay.setAttribute("aria-hidden", "true");
  adminRollbackOverlay.innerHTML = `
  <section class="admin-rollback-card" role="alertdialog" aria-modal="true" aria-label="Alterações não salvas">
    <div class="admin-rollback-icone">!</div>
    <div class="admin-rollback-titulo">Alterações não salvas</div>
    <div class="admin-rollback-desc">
      Existem mudanças administrativas que ainda não foram salvas.
    </div>
    <div id="adminRollbackLista" class="admin-rollback-lista"></div>
    <div class="admin-rollback-pergunta">
      Deseja descartar essas alterações e restaurar a última configuração salva?
    </div>
    <div class="admin-rollback-acoes">
      <button id="adminRollbackContinuar" class="admin-rollback-btn secundario" type="button">Voltar e revisar</button>
      <button id="adminRollbackDescartar" class="admin-rollback-btn perigo" type="button">Descartar alterações</button>
    </div>
  </section>
`;
  document.body.appendChild(adminRollbackOverlay);

  function nomePlanoAdmin(plano) {
    const nomes = {
      basico: "Básico",
      intermediario: "Intermediário",
      premium: "Premium",
    };

    return nomes[String(plano || "").trim()] || "Premium";
  }

  function valorVisivelAdmin(valor, vazio = "Não informado") {
    const texto = String(valor || "").trim();
    return texto || vazio;
  }

  function numeroMonetarioAdminRenderer(valor, padrao = 0) {
    const numero = Number(
      String(valor ?? "")
        .trim()
        .replace(/\s/g, "")
        .replace(",", "."),
    );

    if (!Number.isFinite(numero) || numero < 0) {
      return Number(padrao) || 0;
    }

    return Math.round(numero * 100) / 100;
  }

  function numeroDecimalAdminRenderer(valor, padrao = 0, casas = 6) {
    const numero = Number(
      String(valor ?? "")
        .trim()
        .replace(/\s/g, "")
        .replace(",", "."),
    );

    if (!Number.isFinite(numero) || numero < 0) {
      return Number(padrao) || 0;
    }

    const fator = 10 ** Math.max(0, Math.min(8, Number(casas) || 0));
    return Math.round(numero * fator) / fator;
  }

  function formatarMoedaAdmin(valor) {
    const numero = Number(valor);
    const final = Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0;

    return final.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatarMoedaAdminPrecisa(valor) {
    const numero = Math.max(0, Number(valor || 0) || 0);
    const casas = numero > 0 && numero < 0.01 ? 4 : 2;

    return numero.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
  }

  function coletarAlteracoesPendentesAdmin() {
    const alteracoes = [];
    const estado = adminEstadoEdicao;

    if (estado?.elementos) {
      const nomeAtual = String(
        estado.elementos.nomeCliente?.value || "",
      ).trim();
      const planoAtual = String(
        estado.elementos.planoCliente?.value || "premium",
      );
      const chaveDigitada = String(
        estado.elementos.campoGroq?.value || "",
      ).trim();
      const chaveTesteDigitada = String(
        estado.elementos.campoGroqTeste?.value || "",
      ).trim();

      if (nomeAtual !== String(estado.original?.nomeCliente || "").trim()) {
        alteracoes.push({
          tipo: "cliente",
          titulo: "Cliente",
          detalhe: `${valorVisivelAdmin(estado.original?.nomeCliente)} → ${valorVisivelAdmin(nomeAtual)}`,
        });
      }

      if (planoAtual !== String(estado.original?.plano || "premium")) {
        alteracoes.push({
          tipo: "plano",
          titulo: "Plano",
          detalhe: `${nomePlanoAdmin(estado.original?.plano)} → ${nomePlanoAdmin(planoAtual)}`,
        });
      }

      if (chaveDigitada) {
        alteracoes.push({
          tipo: "groq",
          titulo: "Chave Groq, Motor",
          detalhe:
            "Uma nova chave do motor foi digitada, mas ainda não foi salva.",
        });
      }

      if (chaveTesteDigitada) {
        alteracoes.push({
          tipo: "groq",
          titulo: "Chave Groq, Testes",
          detalhe:
            "Uma nova chave de testes foi digitada, mas ainda não foi salva.",
        });
      }

      const billingInputs = estado.elementos.billingInputs || {};
      const billingOriginal = estado.original?.billing || {};
      const nomesPlanos = {
        basico: "Básico",
        intermediario: "Intermediário",
        premium: "Premium",
      };

      for (const planoId of ["basico", "intermediario", "premium"]) {
        const campos = billingInputs[planoId];

        if (!campos) {
          continue;
        }

        const mensalidadeAtual = numeroMonetarioAdminRenderer(
          campos.mensalidade?.value,
        );
        const orcamentoAtual = numeroMonetarioAdminRenderer(
          campos.orcamentoIA?.value,
        );
        const mensalidadeOriginal = numeroMonetarioAdminRenderer(
          billingOriginal?.[planoId]?.mensalidade,
        );
        const orcamentoOriginal = numeroMonetarioAdminRenderer(
          billingOriginal?.[planoId]?.orcamentoIA,
        );

        if (
          mensalidadeAtual !== mensalidadeOriginal ||
          orcamentoAtual !== orcamentoOriginal
        ) {
          alteracoes.push({
            tipo: "billing",
            titulo: `Billing ${nomesPlanos[planoId]}`,
            detalhe:
              `${formatarMoedaAdmin(mensalidadeOriginal)} / ${formatarMoedaAdmin(orcamentoOriginal)} IA → ` +
              `${formatarMoedaAdmin(mensalidadeAtual)} / ${formatarMoedaAdmin(orcamentoAtual)} IA`,
          });
        }
      }

      const avisosInputs = Array.isArray(estado.elementos.billingAvisosInputs)
        ? estado.elementos.billingAvisosInputs
        : [];
      const avisosOriginais = Array.isArray(billingOriginal?.avisos)
        ? billingOriginal.avisos
        : [];
      const avisosAlterados = avisosInputs.some((campos, indice) => {
        const original = avisosOriginais[indice] || {};
        const ativoAtual = !!campos?.ativo?.checked;
        const percentualAtual = Math.max(
          1,
          Math.min(99, Math.round(Number(campos?.percentual?.value || 0) || 1)),
        );
        const ativoOriginal = original?.ativo !== false;
        const percentualOriginal = Math.max(
          1,
          Math.min(99, Math.round(Number(original?.percentual || 0) || 1)),
        );

        return (
          ativoAtual !== ativoOriginal || percentualAtual !== percentualOriginal
        );
      });

      if (avisosAlterados) {
        alteracoes.push({
          tipo: "billing",
          titulo: "Avisos de consumo",
          detalhe: "Os percentuais ou estados dos avisos foram alterados.",
        });
      }
    }

    if (
      obterTipoPromptIAEmEdicao() === "interno" &&
      overlayPromptBaseIA.classList.contains("aberto")
    ) {
      const motorDigitado = String(campoPromptBaseIA.value || "").trim();

      if (motorDigitado !== String(motorIAAdminAtual || "").trim()) {
        alteracoes.push({
          tipo: "motor",
          titulo: "Motor da IA",
          detalhe:
            "O conteúdo do Motor da IA foi alterado e ainda não foi salvo.",
        });
      }
    }

    return alteracoes;
  }

  function atualizarEstadoAlteracoesAdmin() {
    const estado = adminEstadoEdicao;

    if (!estado?.elementos) {
      return;
    }

    const alteracoes = coletarAlteracoesPendentesAdmin();
    const alteracoesPlano = alteracoes.filter((item) =>
      ["cliente", "plano"].includes(item.tipo),
    );
    const alteracoesBilling = alteracoes.filter(
      (item) => item.tipo === "billing",
    );

    const aviso = estado.elementos.avisoAlteracoes;
    const textoAviso = estado.elementos.textoAlteracoes;
    const salvarPlano = estado.elementos.salvarPlano;
    const salvarBilling = estado.elementos.salvarBilling;

    if (salvarPlano) {
      salvarPlano.disabled = alteracoesPlano.length === 0;
      salvarPlano.classList.toggle(
        "tem-alteracoes",
        alteracoesPlano.length > 0,
      );
    }

    if (salvarBilling) {
      salvarBilling.disabled = alteracoesBilling.length === 0;
      salvarBilling.classList.toggle(
        "tem-alteracoes",
        alteracoesBilling.length > 0,
      );
    }

    if (aviso && textoAviso) {
      if (alteracoes.length) {
        aviso.classList.add("visivel");
        textoAviso.textContent = `${alteracoes.length} ${alteracoes.length === 1 ? "alteração pendente" : "alterações pendentes"}`;
      } else {
        aviso.classList.remove("visivel");
        textoAviso.textContent = "Tudo salvo";
      }
    }
  }

  function confirmarRollbackAdmin(alteracoes = []) {
    if (adminConfirmacaoRollbackAberta) {
      return Promise.resolve(false);
    }

    const lista = Array.isArray(alteracoes) ? alteracoes : [];

    if (!lista.length) {
      return Promise.resolve(true);
    }

    adminConfirmacaoRollbackAberta = true;

    const listaEl = adminRollbackOverlay.querySelector("#adminRollbackLista");
    const continuar = adminRollbackOverlay.querySelector(
      "#adminRollbackContinuar",
    );
    const descartar = adminRollbackOverlay.querySelector(
      "#adminRollbackDescartar",
    );

    listaEl.innerHTML = lista
      .map(
        (item) => `
        <div class="admin-rollback-item">
          <strong>${escaparHtmlAdmin(item.titulo)}</strong>
          <span>${escaparHtmlAdmin(item.detalhe)}</span>
        </div>
      `,
      )
      .join("");

    adminRollbackOverlay.classList.add("aberto");
    adminRollbackOverlay.setAttribute("aria-hidden", "false");

    return new Promise((resolve) => {
      const finalizar = (descartarMudancas) => {
        adminRollbackOverlay.classList.remove("aberto");
        adminRollbackOverlay.setAttribute("aria-hidden", "true");
        adminConfirmacaoRollbackAberta = false;
        continuar.onclick = null;
        descartar.onclick = null;
        resolve(!!descartarMudancas);
      };

      continuar.onclick = () => finalizar(false);
      descartar.onclick = () => finalizar(true);

      setTimeout(() => continuar.focus(), 30);
    });
  }

  async function solicitarFechamentoEditorPromptIA() {
    if (
      obterTipoPromptIAEmEdicao() === "interno" &&
      overlayPromptBaseIA.classList.contains("aberto")
    ) {
      const motorDigitado = String(campoPromptBaseIA.value || "").trim();
      const motorSalvo = String(motorIAAdminAtual || "").trim();

      if (motorDigitado !== motorSalvo) {
        const descartar = await confirmarRollbackAdmin([
          {
            tipo: "motor",
            titulo: "Motor da IA",
            detalhe: "O conteúdo foi alterado e ainda não foi salvo.",
          },
        ]);

        if (!descartar) {
          return false;
        }
      }
    }

    fecharPromptBaseIAConfig();
    atualizarEstadoAlteracoesAdmin();
    return true;
  }

  function mostrarErroAdminOculto(mensagem) {
    const elemento = adminOcultoConteudo.querySelector("#adminOcultoErro");

    if (elemento) {
      elemento.textContent = textoSeguroAdmin(mensagem);
    }
  }

  function focarPrimeiroCampoAdmin() {
    setTimeout(() => {
      adminOcultoConteudo.querySelector("input")?.focus();
    }, 30);
  }

  function renderizarSetupAdminOculto() {
    tokenSessaoAdminOculto = null;
    adminOcultoTitulo.textContent = "Primeiro acesso administrativo";

    adminOcultoConteudo.innerHTML = `
    <p class="admin-oculto-desc">
      Crie o login local que protegerá a área administrativa deste WhatsIAPP.
    </p>

    <label class="admin-oculto-label" for="adminSetupUsuario">Login</label>
    <input id="adminSetupUsuario" class="admin-oculto-input" type="text" autocomplete="username" maxlength="80" placeholder="Digite o login administrativo">

    <label class="admin-oculto-label" for="adminSetupSenha">Senha</label>
    <input id="adminSetupSenha" class="admin-oculto-input" type="password" autocomplete="new-password" maxlength="200" placeholder="Mínimo de 8 caracteres">

    <label class="admin-oculto-label" for="adminSetupConfirmar">Confirmar senha</label>
    <input id="adminSetupConfirmar" class="admin-oculto-input" type="password" autocomplete="new-password" maxlength="200" placeholder="Repita a senha">

    <div id="adminOcultoErro" class="admin-oculto-erro"></div>

    <button id="adminSetupSalvar" class="admin-oculto-acao primario" type="button">
      Criar acesso administrativo
    </button>
  `;

    const usuario = adminOcultoConteudo.querySelector("#adminSetupUsuario");
    const senha = adminOcultoConteudo.querySelector("#adminSetupSenha");
    const confirmar = adminOcultoConteudo.querySelector("#adminSetupConfirmar");
    const salvar = adminOcultoConteudo.querySelector("#adminSetupSalvar");

    const executar = async () => {
      mostrarErroAdminOculto("");

      const login = usuario.value.trim();
      const senhaFinal = senha.value;

      if (login.length < 3) {
        mostrarErroAdminOculto("Use pelo menos 3 caracteres no login.");
        usuario.focus();
        return;
      }

      if (senhaFinal.length < 8) {
        mostrarErroAdminOculto("Use pelo menos 8 caracteres na senha.");
        senha.focus();
        return;
      }

      if (senhaFinal !== confirmar.value) {
        mostrarErroAdminOculto("As senhas não coincidem.");
        confirmar.select();
        return;
      }

      salvar.disabled = true;
      salvar.textContent = "Salvando...";

      try {
        const resultado = await ipcRenderer.invoke(
          "admin-configurar-primeiro-acesso",
          {
            usuario: login,
            senha: senhaFinal,
          },
        );

        if (!resultado?.ok || !resultado?.token) {
          mostrarErroAdminOculto(
            resultado?.erro ||
              "Não foi possível criar o acesso administrativo.",
          );
          salvar.disabled = false;
          salvar.textContent = "Criar acesso administrativo";
          return;
        }

        tokenSessaoAdminOculto = resultado.token;
        renderizarPainelAdminOculto(resultado.usuario);
      } catch (erro) {
        mostrarErroAdminOculto(
          erro?.message || "Não foi possível criar o acesso administrativo.",
        );
        salvar.disabled = false;
        salvar.textContent = "Criar acesso administrativo";
      }
    };

    salvar.addEventListener("click", executar);

    for (const campo of [usuario, senha, confirmar]) {
      campo.addEventListener("keydown", (evento) => {
        if (evento.key === "Enter") {
          executar();
        }
      });
    }

    focarPrimeiroCampoAdmin();
  }

  function renderizarLoginAdminOculto(status = {}) {
    tokenSessaoAdminOculto = null;
    adminOcultoTitulo.textContent = "Acesso administrativo";

    adminOcultoConteudo.innerHTML = `
    <p class="admin-oculto-desc">
      Esta área é restrita à administração interna do WhatsIAPP.
    </p>

    <label class="admin-oculto-label" for="adminLoginUsuario">Login</label>
    <input id="adminLoginUsuario" class="admin-oculto-input" type="text" autocomplete="username" maxlength="80" placeholder="Login administrativo">

    <label class="admin-oculto-label" for="adminLoginSenha">Senha</label>
    <input id="adminLoginSenha" class="admin-oculto-input" type="password" autocomplete="current-password" maxlength="200" placeholder="Senha administrativa">

    <div id="adminOcultoErro" class="admin-oculto-erro">${
      status?.bloqueadoPorTentativas && status?.aguardeSegundos
        ? `Aguarde ${Number(status.aguardeSegundos) || 0}s antes de tentar novamente.`
        : ""
    }</div>

    <button id="adminLoginEntrar" class="admin-oculto-acao primario" type="button">
      Entrar
    </button>
  `;

    const usuario = adminOcultoConteudo.querySelector("#adminLoginUsuario");
    const senha = adminOcultoConteudo.querySelector("#adminLoginSenha");
    const entrar = adminOcultoConteudo.querySelector("#adminLoginEntrar");

    const executar = async () => {
      mostrarErroAdminOculto("");

      if (!usuario.value.trim() || !senha.value) {
        mostrarErroAdminOculto("Informe o login e a senha.");
        return;
      }

      entrar.disabled = true;
      entrar.textContent = "Entrando...";

      try {
        const resultado = await ipcRenderer.invoke("admin-login", {
          usuario: usuario.value.trim(),
          senha: senha.value,
        });

        if (resultado?.naoConfigurado) {
          renderizarSetupAdminOculto();
          return;
        }

        if (!resultado?.ok || !resultado?.token) {
          mostrarErroAdminOculto(
            resultado?.erro || "Login ou senha incorretos.",
          );
          senha.value = "";
          senha.focus();
          entrar.disabled = false;
          entrar.textContent = "Entrar";
          return;
        }

        tokenSessaoAdminOculto = resultado.token;
        renderizarPainelAdminOculto(resultado.usuario);
      } catch (erro) {
        mostrarErroAdminOculto(
          erro?.message || "Não foi possível validar o acesso administrativo.",
        );
        entrar.disabled = false;
        entrar.textContent = "Entrar";
      }
    };

    entrar.addEventListener("click", executar);
    usuario.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") executar();
    });
    senha.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") executar();
    });

    focarPrimeiroCampoAdmin();
  }

  async function renderizarPainelAdminOculto(usuario) {
    adminOcultoTitulo.textContent = "Administração";
    adminOcultoConteudo.innerHTML = `
    <div class="admin-oculto-carregando">Carregando configurações administrativas...</div>
  `;

    let resultado = null;

    try {
      resultado = await ipcRenderer.invoke("admin-obter-configuracao", {
        token: tokenSessaoAdminOculto,
      });
    } catch (erro) {
      resultado = {
        ok: false,
        erro: erro?.message || "Não foi possível carregar a Administração.",
      };
    }

    if (!resultado?.ok) {
      tokenSessaoAdminOculto = null;
      renderizarLoginAdminOculto({});
      mostrarErroAdminOculto(
        resultado?.erro || "Sessão administrativa expirada.",
      );
      return;
    }

    const config = resultado.configuracao || {};
    const motorLegado = obterPromptInternoIA().trim();

    if (!String(config.motorIA || "").trim() && motorLegado) {
      try {
        const migracao = await ipcRenderer.invoke("admin-salvar-motor-ia", {
          token: tokenSessaoAdminOculto,
          motorIA: motorLegado,
        });

        if (migracao?.ok) {
          config.motorIA = migracao.motorIA || motorLegado;
        }
      } catch {}
    }

    motorIAAdminAtual = String(config.motorIA || motorLegado || "").trim();

    const planoSalvo = ["basico", "intermediario", "premium"].includes(
      config.plano,
    )
      ? config.plano
      : "premium";

    const billingSalvo = {
      basico: {
        mensalidade: numeroMonetarioAdminRenderer(
          config?.billing?.basico?.mensalidade,
          0,
        ),
        orcamentoIA: numeroMonetarioAdminRenderer(
          config?.billing?.basico?.orcamentoIA,
          0,
        ),
      },
      intermediario: {
        mensalidade: numeroMonetarioAdminRenderer(
          config?.billing?.intermediario?.mensalidade,
          0,
        ),
        orcamentoIA: numeroMonetarioAdminRenderer(
          config?.billing?.intermediario?.orcamentoIA,
          0,
        ),
      },
      premium: {
        mensalidade: numeroMonetarioAdminRenderer(
          config?.billing?.premium?.mensalidade,
          0,
        ),
        orcamentoIA: numeroMonetarioAdminRenderer(
          config?.billing?.premium?.orcamentoIA,
          0,
        ),
      },
      precificacao: {
        usdBrl: numeroDecimalAdminRenderer(
          config?.billing?.precificacao?.usdBrl,
          5.13,
        ),
        gptOssEntradaUsdMilhao: numeroDecimalAdminRenderer(
          config?.billing?.precificacao?.gptOssEntradaUsdMilhao,
          0.15,
        ),
        gptOssCacheUsdMilhao: numeroDecimalAdminRenderer(
          config?.billing?.precificacao?.gptOssCacheUsdMilhao,
          0.075,
        ),
        gptOssSaidaUsdMilhao: numeroDecimalAdminRenderer(
          config?.billing?.precificacao?.gptOssSaidaUsdMilhao,
          0.6,
        ),
        webSearchBasicaUsdMil: numeroDecimalAdminRenderer(
          config?.billing?.precificacao?.webSearchBasicaUsdMil,
          5,
        ),
      },
      precificacaoMeta: {
        atualizadaEm:
          Number(config?.billing?.precificacaoMeta?.atualizadaEm || 0) || null,
        groqAtualizadaEm:
          Number(config?.billing?.precificacaoMeta?.groqAtualizadaEm || 0) ||
          null,
        cambioAtualizadoEm:
          Number(config?.billing?.precificacaoMeta?.cambioAtualizadoEm || 0) ||
          null,
        fonteGroq: String(
          config?.billing?.precificacaoMeta?.fonteGroq || "GroqDocs",
        ),
        fonteCambio: String(
          config?.billing?.precificacaoMeta?.fonteCambio || "Frankfurter",
        ),
        erroUltimaAtualizacao:
          config?.billing?.precificacaoMeta?.erroUltimaAtualizacao || null,
      },
      avisos: (Array.isArray(config?.billing?.avisos)
        ? config.billing.avisos
        : [
            { id: "aviso1", ativo: true, percentual: 50 },
            { id: "aviso2", ativo: true, percentual: 75 },
            { id: "aviso3", ativo: true, percentual: 80 },
            { id: "aviso4", ativo: true, percentual: 90 },
            { id: "aviso5", ativo: true, percentual: 95 },
          ]
      ).map((item, indice) => ({
        id: String(item?.id || `aviso${indice + 1}`),
        ativo: item?.ativo !== false,
        percentual: Math.max(
          1,
          Math.min(99, Math.round(Number(item?.percentual || 50) || 50)),
        ),
      })),
    };

    const regrasPlano = {
      basico: {
        nome: "Básico",
        preco: `${formatarMoedaAdmin(billingSalvo.basico.mensalidade)}/mês`,
        contexto: "Mínimo e Baixo",
        niveis: "2 de 6 níveis",
        web: "Bloqueada",
        webDetalhe: "Pesquisa web não disponível",
        webClasse: "bloqueado",
      },
      intermediario: {
        nome: "Intermediário",
        preco: `${formatarMoedaAdmin(billingSalvo.intermediario.mensalidade)}/mês`,
        contexto: "Mínimo até Alto",
        niveis: "4 de 6 níveis",
        web: "Liberada",
        webDetalhe: "Cliente pode ligar ou desligar",
        webClasse: "liberado",
      },
      premium: {
        nome: "Premium",
        preco: `${formatarMoedaAdmin(billingSalvo.premium.mensalidade)}/mês`,
        contexto: "Todos os níveis",
        niveis: "6 de 6 níveis",
        web: "Liberada",
        webDetalhe: "Cliente pode ligar ou desligar",
        webClasse: "liberado",
      },
    };

    const regraSalva = regrasPlano[planoSalvo] || regrasPlano.premium;
    const nomeSalvo = String(config.nomeCliente || "").trim();

    adminOcultoConteudo.innerHTML = `
    <div class="admin-painel-cabecalho">
      <div class="admin-oculto-sessao-ok">
        <span class="admin-oculto-sessao-bolinha"></span>
        Autenticado como ${escaparHtmlAdmin(usuario || "Administrador")}
      </div>
      <div id="adminAlteracoesAviso" class="admin-alteracoes-aviso">
        <span class="admin-alteracoes-ponto"></span>
        <span id="adminAlteracoesTexto">Tudo salvo</span>
      </div>
    </div>


    <nav class="admin-abas" role="tablist" aria-label="Seções administrativas">
      <button class="admin-aba-btn ativa" type="button" role="tab" aria-selected="true" data-admin-aba="cliente">Cliente e plano</button>
      <button class="admin-aba-btn" type="button" role="tab" aria-selected="false" data-admin-aba="ia">IA e API</button>
      <button class="admin-aba-btn" type="button" role="tab" aria-selected="false" data-admin-aba="testes">Testes</button>
      <button class="admin-aba-btn" type="button" role="tab" aria-selected="false" data-admin-aba="billing">Billing e consumo</button>
    </nav>

    <div class="admin-aba-painel ativa" data-admin-painel="cliente">
    <div class="admin-resumo-ativo">
      <div class="admin-resumo-item">
        <span>Cliente ativo</span>
        <strong id="adminResumoClienteAtivo">${escaparHtmlAdmin(valorVisivelAdmin(nomeSalvo))}</strong>
      </div>
      <div class="admin-resumo-item">
        <span>Plano atual</span>
        <strong id="adminResumoPlanoAtivo">${regraSalva.nome}</strong>
      </div>
      <div class="admin-resumo-item">
        <span>Contexto liberado</span>
        <strong id="adminResumoContextoAtivo">${regraSalva.niveis}</strong>
      </div>
      <div class="admin-resumo-item">
        <span>Pesquisa web</span>
        <strong id="adminResumoWebAtivo" class="${regraSalva.webClasse}">${regraSalva.web}</strong>
      </div>
    </div>

    <section class="admin-config-secao admin-config-principal">
      <div class="admin-config-secao-topo">
        <div>
          <div class="admin-config-titulo">Cliente e plano</div>
          <div class="admin-config-desc">Defina a identificação do cliente e quais recursos comerciais ficam disponíveis.</div>
        </div>
        <span class="admin-config-badge">Configuração comercial</span>
      </div>

      <div class="admin-config-grid-dois">
        <div>
          <label class="admin-oculto-label" for="adminNomeCliente">Cliente</label>
          <input id="adminNomeCliente" class="admin-oculto-input admin-input-sem-margem" type="text" maxlength="120" placeholder="Nome do cliente">
        </div>
        <div>
          <label class="admin-oculto-label" for="adminPlanoCliente">Plano</label>
          <select id="adminPlanoCliente" class="admin-oculto-input admin-input-sem-margem">
            <option value="basico">Básico</option>
            <option value="intermediario">Intermediário</option>
            <option value="premium">Premium</option>
          </select>
        </div>
      </div>

      <div id="adminResumoPlano" class="admin-plano-detalhes"></div>

      <div class="admin-config-rodape">
        <div id="adminStatusPlano" class="admin-config-status"></div>
        <button id="adminSalvarPlano" class="admin-oculto-acao primario admin-salvar-compacto" type="button" disabled>
          Salvar alterações
        </button>
      </div>
    </section>
    </div>

    <div class="admin-aba-painel" data-admin-painel="ia" hidden>
    <div class="admin-tecnico-grid">
      <section class="admin-config-secao admin-config-tecnico">
        <div class="admin-config-secao-topo admin-tecnico-topo">
          <div>
            <div class="admin-config-titulo">Motor da IA</div>
            <div class="admin-config-desc">Prompt interno obrigatório e invisível para o cliente.</div>
          </div>
          <span class="admin-status-pill ${motorIAAdminAtual ? "ok" : "alerta"}">${motorIAAdminAtual ? "Configurado" : "Pendente"}</span>
        </div>
        <div class="admin-tecnico-info">
          <span>Tamanho atual</span>
          <strong id="adminMotorTamanho">${motorIAAdminAtual.length.toLocaleString("pt-BR")} caracteres</strong>
        </div>
        <div id="adminMotorStatus" class="admin-config-status ${motorIAAdminAtual ? "ok" : "alerta"}">
          ${motorIAAdminAtual ? "Motor protegido na área administrativa." : "Motor ainda não configurado."}
        </div>
        <button id="adminEditarMotorIA" class="admin-oculto-acao secundario admin-acao-compacta" type="button">Editar Motor da IA</button>
      </section>

      <section class="admin-config-secao admin-config-tecnico">
        <div class="admin-config-secao-topo admin-tecnico-topo">
          <div>
            <div class="admin-config-titulo">API Groq, Motor</div>
            <div class="admin-config-desc">Usada no Assistido, Automático, catálogo, web e clima do cliente.</div>
          </div>
          <span id="adminGroqBadge" class="admin-status-pill neutro">Verificando</span>
        </div>
        <input id="adminChaveGroq" class="admin-oculto-input admin-groq-input" type="password" autocomplete="off" spellcheck="false" placeholder="Cole uma nova chave para substituir">
        <div class="admin-config-acoes-linha admin-acoes-compactas">
          <button id="adminSalvarGroq" class="admin-oculto-acao primario" type="button">Salvar chave do motor</button>
          <button id="adminRemoverGroq" class="admin-oculto-acao secundario" type="button">Remover</button>
        </div>
        <div id="adminStatusGroq" class="admin-config-status"></div>
      </section>
    </div>
    </div>

    <div class="admin-aba-painel" data-admin-painel="testes" hidden>
    <section class="admin-config-secao admin-config-tecnico">
      <div class="admin-config-secao-topo admin-tecnico-topo">
        <div>
          <div class="admin-config-titulo">API Groq, Testes</div>
          <div class="admin-config-desc">Usada somente pelo planejador e pela bateria de integridade. Nunca consome a chave do motor.</div>
        </div>
        <span id="adminGroqTesteBadge" class="admin-status-pill neutro">Verificando</span>
      </div>
      <input id="adminChaveGroqTeste" class="admin-oculto-input admin-groq-input" type="password" autocomplete="off" spellcheck="false" placeholder="Cole a chave exclusiva de testes">
      <div class="admin-config-acoes-linha admin-acoes-compactas">
        <button id="adminSalvarGroqTeste" class="admin-oculto-acao primario" type="button">Salvar chave de testes</button>
        <button id="adminRemoverGroqTeste" class="admin-oculto-acao secundario" type="button">Remover</button>
      </div>
      <div id="adminStatusGroqTeste" class="admin-config-status"></div>
    </section>

    <section class="admin-config-secao admin-teste-ia-secao">
      <div class="admin-config-secao-topo">
        <div>
          <div class="admin-config-titulo">Teste de integridade da IA</div>
          <div class="admin-config-desc">
            Simula mensagens recebidas em uma conversa sombra, executa o mesmo motor de resposta e captura rota, contexto, catálogo, web, tokens e resposta. As perguntas são geradas dinamicamente por IA a partir do catálogo e das regras de cobertura. As continuações são geradas junto com a pergunta anterior. Nenhum produto, preço, atributo, fato ou assunto fica fixado na bateria. Nenhuma mensagem é enviada ao contato real.
          </div>
        </div>
        <span id="adminTesteIABadge" class="admin-status-pill neutro">Pronto</span>
      </div>

      <div class="admin-teste-ia-grid">
        <div>
          <label class="admin-oculto-label" for="adminTesteIAConversa">Conversa usada como referência</label>
          <select id="adminTesteIAConversa" class="admin-oculto-input admin-input-sem-margem"></select>
        </div>

        <div>
          <label class="admin-oculto-label" for="adminTesteIAProduto">Produto do catálogo</label>
          <select id="adminTesteIAProduto" class="admin-oculto-input admin-input-sem-margem">
            <option value="">Carregando catálogo...</option>
          </select>
        </div>

        <div>
          <label class="admin-oculto-label" for="adminTesteIAModo">Modo da bateria</label>
          <select id="adminTesteIAModo" class="admin-oculto-input admin-input-sem-margem">
            <option value="padrao">Padrão, geração conservadora</option>
            <option value="aleatorio" selected>Aleatório, geração exploratória</option>
            <option value="completo">Completo, conservador + exploratório</option>
          </select>
        </div>

        <div>
          <label class="admin-oculto-label" for="adminTesteIASemente">ID da bateria dinâmica</label>
          <input id="adminTesteIASemente" class="admin-oculto-input admin-input-sem-margem" type="text" maxlength="80" placeholder="Gerada automaticamente">
        </div>

        <div>
          <label class="admin-oculto-label" for="adminTesteIALocalClima">Cidade para teste de clima</label>
          <input id="adminTesteIALocalClima" class="admin-oculto-input admin-input-sem-margem" type="text" maxlength="100" value="" placeholder="Cidade, UF">
        </div>

        <div>
          <label class="admin-oculto-label" for="adminTesteIAIntervalo">Intervalo entre testes</label>
          <select id="adminTesteIAIntervalo" class="admin-oculto-input admin-input-sem-margem">
            <option value="1000">1 segundo</option>
            <option value="3000">3 segundos</option>
            <option value="5000" selected>5 segundos</option>
            <option value="15000">15 segundos</option>
            <option value="30000">30 segundos</option>
            <option value="60000">1 minuto</option>
            <option value="90000">1 minuto e 30 segundos</option>
            <option value="120000">2 minutos</option>
          </select>
        </div>
      </div>

      <label class="admin-teste-ia-check">
        <input id="adminTesteIAUsarContexto" type="checkbox">
        <span>Copiar as 15 mensagens recentes da conversa selecionada para o ambiente de teste</span>
      </label>

      <div id="adminTesteIAPerguntas" class="admin-teste-ia-perguntas"></div>

      <div class="admin-config-acoes-linha admin-teste-ia-acoes">
        <button id="adminTesteIASortear" class="admin-oculto-acao secundario" type="button">
          Sortear novas perguntas
        </button>
        <button id="adminTesteIAIniciar" class="admin-oculto-acao primario" type="button">
          Iniciar teste
        </button>
        <button id="adminTesteIAAbrirRelatorio" class="admin-oculto-acao secundario" type="button" hidden>
          Abrir último relatório
        </button>
      </div>
    </section>
    </div>

    <div class="admin-aba-painel" data-admin-painel="billing" hidden>
      <section class="admin-config-secao admin-billing-secao">
        <div class="admin-config-secao-topo">
          <div>
            <div class="admin-config-titulo">Billing e consumo</div>
            <div class="admin-config-desc">Defina a mensalidade e o orçamento mensal máximo de IA de cada plano. Estes valores ficam salvos e podem ser alterados sem mexer no código.</div>
          </div>
          <span class="admin-config-badge">Configuração mensal</span>
        </div>

        <div class="admin-billing-consumo-card">
          <div class="admin-billing-consumo-topo">
            <div>
              <span>API do motor, consumo faturável do mês</span>
              <strong id="adminBillingConsumoTitulo">Carregando...</strong>
            </div>
            <span id="adminBillingConsumoBadge" class="admin-status-pill">-</span>
          </div>

          <div class="admin-billing-consumo-metricas">
            <div><span>Orçamento</span><strong id="adminBillingConsumoOrcamento">-</strong></div>
            <div><span>Consumido</span><strong id="adminBillingConsumoConsumido">-</strong></div>
            <div><span>Saldo</span><strong id="adminBillingConsumoSaldo">-</strong></div>
            <div><span>Uso</span><strong id="adminBillingConsumoPercentual">-</strong></div>
          </div>

          <div class="admin-billing-consumo-barra"><span id="adminBillingConsumoBarra"></span></div>
          <div id="adminBillingConsumoMeta" class="admin-billing-consumo-meta">Aguardando dados de consumo.</div>
        </div>

        <div class="admin-billing-consumo-card">
          <div class="admin-billing-consumo-topo">
            <div>
              <span>API de testes, consumo separado</span>
              <strong id="adminBillingTesteTitulo">Carregando...</strong>
            </div>
            <span id="adminBillingTesteBadge" class="admin-status-pill">-</span>
          </div>

          <div class="admin-billing-consumo-metricas">
            <div><span>Custo estimado</span><strong id="adminBillingTesteCusto">-</strong></div>
            <div><span>Chamadas</span><strong id="adminBillingTesteChamadas">-</strong></div>
            <div><span>Tokens</span><strong id="adminBillingTesteTokens">-</strong></div>
            <div><span>Pesquisas web</span><strong id="adminBillingTestePesquisas">-</strong></div>
          </div>

          <div id="adminBillingTesteMeta" class="admin-billing-consumo-meta">Aguardando dados da chave de testes.</div>
        </div>

        <div class="admin-billing-grid">
          <div class="admin-billing-plano">
            <div class="admin-billing-plano-topo">
              <strong>Básico</strong>
              <span>2 níveis de contexto</span>
            </div>
            <label class="admin-oculto-label" for="adminBillingBasicoMensalidade">Mensalidade</label>
            <div class="admin-billing-campo">
              <span>R$</span>
              <input id="adminBillingBasicoMensalidade" class="admin-oculto-input admin-input-sem-margem" type="number" min="0" step="0.01" value="${billingSalvo.basico.mensalidade.toFixed(2)}">
            </div>
            <label class="admin-oculto-label admin-billing-label-secundaria" for="adminBillingBasicoIA">Orçamento mensal de IA</label>
            <div class="admin-billing-campo">
              <span>R$</span>
              <input id="adminBillingBasicoIA" class="admin-oculto-input admin-input-sem-margem" type="number" min="0" step="0.01" value="${billingSalvo.basico.orcamentoIA.toFixed(2)}">
            </div>
            <div class="admin-billing-sobra">Sobra antes de outros custos <strong id="adminBillingBasicoSobra"></strong></div>
          </div>

          <div class="admin-billing-plano">
            <div class="admin-billing-plano-topo">
              <strong>Intermediário</strong>
              <span>4 níveis de contexto</span>
            </div>
            <label class="admin-oculto-label" for="adminBillingIntermediarioMensalidade">Mensalidade</label>
            <div class="admin-billing-campo">
              <span>R$</span>
              <input id="adminBillingIntermediarioMensalidade" class="admin-oculto-input admin-input-sem-margem" type="number" min="0" step="0.01" value="${billingSalvo.intermediario.mensalidade.toFixed(2)}">
            </div>
            <label class="admin-oculto-label admin-billing-label-secundaria" for="adminBillingIntermediarioIA">Orçamento mensal de IA</label>
            <div class="admin-billing-campo">
              <span>R$</span>
              <input id="adminBillingIntermediarioIA" class="admin-oculto-input admin-input-sem-margem" type="number" min="0" step="0.01" value="${billingSalvo.intermediario.orcamentoIA.toFixed(2)}">
            </div>
            <div class="admin-billing-sobra">Sobra antes de outros custos <strong id="adminBillingIntermediarioSobra"></strong></div>
          </div>

          <div class="admin-billing-plano">
            <div class="admin-billing-plano-topo">
              <strong>Premium</strong>
              <span>6 níveis de contexto</span>
            </div>
            <label class="admin-oculto-label" for="adminBillingPremiumMensalidade">Mensalidade</label>
            <div class="admin-billing-campo">
              <span>R$</span>
              <input id="adminBillingPremiumMensalidade" class="admin-oculto-input admin-input-sem-margem" type="number" min="0" step="0.01" value="${billingSalvo.premium.mensalidade.toFixed(2)}">
            </div>
            <label class="admin-oculto-label admin-billing-label-secundaria" for="adminBillingPremiumIA">Orçamento mensal de IA</label>
            <div class="admin-billing-campo">
              <span>R$</span>
              <input id="adminBillingPremiumIA" class="admin-oculto-input admin-input-sem-margem" type="number" min="0" step="0.01" value="${billingSalvo.premium.orcamentoIA.toFixed(2)}">
            </div>
            <div class="admin-billing-sobra">Sobra antes de outros custos <strong id="adminBillingPremiumSobra"></strong></div>
          </div>
        </div>

        <div class="admin-billing-avisos">
          <div class="admin-billing-avisos-topo">
            <div>
              <strong>Avisos de consumo</strong>
              <span>Ative, desative ou altere cada percentual. Cada aviso é enviado uma única vez por mês quando o consumo alcança o nível configurado.</span>
            </div>
            <span class="admin-status-pill aviso">100% bloqueia</span>
          </div>

          <div class="admin-billing-avisos-grid">
            ${billingSalvo.avisos
              .map(
                (aviso, indice) => `
                  <div class="admin-billing-aviso-item">
                    <label class="admin-billing-aviso-toggle" for="adminBillingAvisoAtivo${indice}">
                      <input id="adminBillingAvisoAtivo${indice}" type="checkbox" ${aviso.ativo ? "checked" : ""}>
                      <span>Aviso ${indice + 1}</span>
                    </label>
                    <div class="admin-billing-aviso-percentual">
                      <input id="adminBillingAvisoPercentual${indice}" class="admin-oculto-input admin-input-sem-margem" type="number" min="1" max="99" step="1" value="${aviso.percentual}">
                      <span>%</span>
                    </div>
                  </div>
                `,
              )
              .join("")}
          </div>

          <div class="admin-billing-avisos-rodape">
            O bloqueio em 100% é obrigatório e não pode ser desativado. Se uma chamada ultrapassar vários níveis de uma vez, o WhatsIAPP registra todos e mostra apenas o aviso mais alto, evitando vários alertas simultâneos.
          </div>
        </div>

        <div class="admin-billing-precificacao">
          <div class="admin-billing-precificacao-topo">
            <div>
              <strong>Precificação automática</strong>
              <span>Os preços da Groq e a cotação USD/BRL são atualizados automaticamente. A última tabela válida fica salva para uso offline.</span>
            </div>
            <button id="adminAtualizarPrecificacaoBilling" class="admin-billing-atualizar-precos" type="button">Atualizar agora</button>
          </div>

          <div class="admin-billing-precificacao-grid">
            <label>
              <span>USD para BRL</span>
              <input id="adminBillingUsdBrl" class="admin-oculto-input admin-input-sem-margem admin-billing-campo-auto" type="number" value="${billingSalvo.precificacao.usdBrl}" readonly>
            </label>
            <label>
              <span>GPT-OSS entrada, US$/1M</span>
              <input id="adminBillingGptEntrada" class="admin-oculto-input admin-input-sem-margem admin-billing-campo-auto" type="number" value="${billingSalvo.precificacao.gptOssEntradaUsdMilhao}" readonly>
            </label>
            <label>
              <span>GPT-OSS cache, US$/1M</span>
              <input id="adminBillingGptCache" class="admin-oculto-input admin-input-sem-margem admin-billing-campo-auto" type="number" value="${billingSalvo.precificacao.gptOssCacheUsdMilhao}" readonly>
            </label>
            <label>
              <span>GPT-OSS saída, US$/1M</span>
              <input id="adminBillingGptSaida" class="admin-oculto-input admin-input-sem-margem admin-billing-campo-auto" type="number" value="${billingSalvo.precificacao.gptOssSaidaUsdMilhao}" readonly>
            </label>
            <label>
              <span>Basic Web Search, US$/1.000</span>
              <input id="adminBillingWebSearch" class="admin-oculto-input admin-input-sem-margem admin-billing-campo-auto" type="number" value="${billingSalvo.precificacao.webSearchBasicaUsdMil}" readonly>
            </label>
          </div>

          <div id="adminBillingPrecificacaoStatus" class="admin-billing-precificacao-status">Aguardando atualização automática.</div>
        </div>

        <div class="admin-billing-nota">O consumo é calculado a cada chamada real da Groq e separado pela chave usada. A API do motor controla a franquia do cliente. A API de testes possui contador e custo próprios e nunca usa fallback para a chave do motor. Ao trocar uma chave, o histórico anterior permanece associado ao ID criptográfico dela e reaparece se a mesma chave for cadastrada novamente.</div>

        <div class="admin-config-rodape">
          <div id="adminStatusBilling" class="admin-config-status"></div>
          <button id="adminSalvarBilling" class="admin-oculto-acao primario admin-salvar-compacto" type="button" disabled>Salvar billing</button>
        </div>
      </section>
    </div>

    <div id="adminTesteIAExecucaoModal" class="admin-teste-ia-relatorio-modal" hidden>
      <div class="admin-teste-ia-relatorio-card" style="max-width: 820px;">
        <div class="admin-teste-ia-relatorio-topo">
          <div>
            <div class="admin-config-titulo">Teste de integridade em execução</div>
            <div class="admin-config-desc">
              A bateria roda em uma conversa sombra. Os retornos aparecem aqui sem aumentar o tamanho da tela de Administração.
            </div>
          </div>

          <button id="adminTesteIAExecucaoFecharTopo" class="admin-teste-ia-relatorio-fechar" type="button" aria-label="Fechar execução do teste" disabled>
            ×
          </button>
        </div>

        <div class="admin-teste-ia-progresso" id="adminTesteIAProgresso">
          <div class="admin-teste-ia-progresso-topo">
            <strong id="adminTesteIAEtapa">Preparando teste...</strong>
            <span id="adminTesteIAContagem">0/10</span>
          </div>
          <div class="admin-teste-ia-barra">
            <span id="adminTesteIABarra"></span>
          </div>
          <div id="adminTesteIAStatus" class="admin-config-status"></div>
          <div id="adminTesteIAResultados" class="admin-teste-ia-resultados" style="max-height: 48vh; overflow-y: auto; padding-right: 4px;"></div>
        </div>

        <div class="admin-config-acoes-linha admin-teste-ia-relatorio-acoes">
          <button id="adminTesteIACancelar" class="admin-oculto-acao secundario" type="button">
            Interromper teste
          </button>
          <button id="adminTesteIAExecucaoAbrirRelatorio" class="admin-oculto-acao secundario" type="button" hidden>
            Ver relatório completo
          </button>
          <button id="adminTesteIAExecucaoFechar" class="admin-oculto-acao primario" type="button" hidden>
            Fechar
          </button>
        </div>
      </div>
    </div>

    <div id="adminTesteIARelatorioModal" class="admin-teste-ia-relatorio-modal" hidden>
      <div class="admin-teste-ia-relatorio-card">
        <div class="admin-teste-ia-relatorio-topo">
          <div>
            <div class="admin-config-titulo">Relatório do teste de integridade</div>
            <div class="admin-config-desc">
              Resultado completo da bateria, com respostas e logs relevantes. O arquivo também continua salvo em Documentos > WhatsIAPP > Diagnosticos.
            </div>
          </div>

          <button id="adminTesteIARelatorioFechar" class="admin-teste-ia-relatorio-fechar" type="button" aria-label="Fechar relatório">
            ×
          </button>
        </div>

        <pre id="adminTesteIARelatorioTexto" class="admin-teste-ia-relatorio-texto"></pre>

        <div class="admin-config-acoes-linha admin-teste-ia-relatorio-acoes">
          <button id="adminTesteIARelatorioCopiar" class="admin-oculto-acao secundario" type="button">
            Copiar relatório
          </button>
          <button id="adminTesteIARelatorioAbrirArquivo" class="admin-oculto-acao secundario" type="button">
            Abrir arquivo salvo
          </button>
          <button id="adminTesteIARelatorioFecharRodape" class="admin-oculto-acao primario" type="button">
            Fechar
          </button>
        </div>
      </div>
    </div>

    <div class="admin-painel-rodape">
      <span>Alterações salvas são aplicadas imediatamente ao WhatsIAPP.</span>
      <button id="adminOcultoSair" class="admin-oculto-acao secundario admin-logout" type="button">
        Encerrar sessão administrativa
      </button>
    </div>
  `;

    const nomeCliente = adminOcultoConteudo.querySelector("#adminNomeCliente");
    const planoCliente =
      adminOcultoConteudo.querySelector("#adminPlanoCliente");
    const resumoPlano = adminOcultoConteudo.querySelector("#adminResumoPlano");
    const statusPlano = adminOcultoConteudo.querySelector("#adminStatusPlano");
    const salvarPlano = adminOcultoConteudo.querySelector("#adminSalvarPlano");
    const editarMotor = adminOcultoConteudo.querySelector(
      "#adminEditarMotorIA",
    );
    const campoGroq = adminOcultoConteudo.querySelector("#adminChaveGroq");
    const salvarGroq = adminOcultoConteudo.querySelector("#adminSalvarGroq");
    const removerGroq = adminOcultoConteudo.querySelector("#adminRemoverGroq");
    const statusGroq = adminOcultoConteudo.querySelector("#adminStatusGroq");
    const groqBadge = adminOcultoConteudo.querySelector("#adminGroqBadge");
    const campoGroqTeste = adminOcultoConteudo.querySelector(
      "#adminChaveGroqTeste",
    );
    const salvarGroqTeste = adminOcultoConteudo.querySelector(
      "#adminSalvarGroqTeste",
    );
    const removerGroqTeste = adminOcultoConteudo.querySelector(
      "#adminRemoverGroqTeste",
    );
    const statusGroqTeste = adminOcultoConteudo.querySelector(
      "#adminStatusGroqTeste",
    );
    const groqTesteBadge = adminOcultoConteudo.querySelector(
      "#adminGroqTesteBadge",
    );
    const avisoAlteracoes = adminOcultoConteudo.querySelector(
      "#adminAlteracoesAviso",
    );
    const textoAlteracoes = adminOcultoConteudo.querySelector(
      "#adminAlteracoesTexto",
    );
    const resumoClienteAtivo = adminOcultoConteudo.querySelector(
      "#adminResumoClienteAtivo",
    );
    const resumoPlanoAtivo = adminOcultoConteudo.querySelector(
      "#adminResumoPlanoAtivo",
    );
    const resumoContextoAtivo = adminOcultoConteudo.querySelector(
      "#adminResumoContextoAtivo",
    );
    const resumoWebAtivo = adminOcultoConteudo.querySelector(
      "#adminResumoWebAtivo",
    );
    const adminAbas = Array.from(
      adminOcultoConteudo.querySelectorAll("[data-admin-aba]"),
    );
    const adminPaineis = Array.from(
      adminOcultoConteudo.querySelectorAll("[data-admin-painel]"),
    );
    const billingInputs = {
      basico: {
        mensalidade: adminOcultoConteudo.querySelector(
          "#adminBillingBasicoMensalidade",
        ),
        orcamentoIA: adminOcultoConteudo.querySelector("#adminBillingBasicoIA"),
        sobra: adminOcultoConteudo.querySelector("#adminBillingBasicoSobra"),
      },
      intermediario: {
        mensalidade: adminOcultoConteudo.querySelector(
          "#adminBillingIntermediarioMensalidade",
        ),
        orcamentoIA: adminOcultoConteudo.querySelector(
          "#adminBillingIntermediarioIA",
        ),
        sobra: adminOcultoConteudo.querySelector(
          "#adminBillingIntermediarioSobra",
        ),
      },
      premium: {
        mensalidade: adminOcultoConteudo.querySelector(
          "#adminBillingPremiumMensalidade",
        ),
        orcamentoIA: adminOcultoConteudo.querySelector(
          "#adminBillingPremiumIA",
        ),
        sobra: adminOcultoConteudo.querySelector("#adminBillingPremiumSobra"),
      },
    };
    const billingPrecificacaoInputs = {
      usdBrl: adminOcultoConteudo.querySelector("#adminBillingUsdBrl"),
      gptOssEntradaUsdMilhao: adminOcultoConteudo.querySelector(
        "#adminBillingGptEntrada",
      ),
      gptOssCacheUsdMilhao: adminOcultoConteudo.querySelector(
        "#adminBillingGptCache",
      ),
      gptOssSaidaUsdMilhao: adminOcultoConteudo.querySelector(
        "#adminBillingGptSaida",
      ),
      webSearchBasicaUsdMil: adminOcultoConteudo.querySelector(
        "#adminBillingWebSearch",
      ),
    };
    const billingAvisosInputs = billingSalvo.avisos.map((aviso, indice) => ({
      id: aviso.id,
      ativo: adminOcultoConteudo.querySelector(
        `#adminBillingAvisoAtivo${indice}`,
      ),
      percentual: adminOcultoConteudo.querySelector(
        `#adminBillingAvisoPercentual${indice}`,
      ),
    }));
    const billingConsumoElementos = {
      titulo: adminOcultoConteudo.querySelector("#adminBillingConsumoTitulo"),
      badge: adminOcultoConteudo.querySelector("#adminBillingConsumoBadge"),
      orcamento: adminOcultoConteudo.querySelector(
        "#adminBillingConsumoOrcamento",
      ),
      consumido: adminOcultoConteudo.querySelector(
        "#adminBillingConsumoConsumido",
      ),
      saldo: adminOcultoConteudo.querySelector("#adminBillingConsumoSaldo"),
      percentual: adminOcultoConteudo.querySelector(
        "#adminBillingConsumoPercentual",
      ),
      barra: adminOcultoConteudo.querySelector("#adminBillingConsumoBarra"),
      meta: adminOcultoConteudo.querySelector("#adminBillingConsumoMeta"),
    };
    const billingTesteElementos = {
      titulo: adminOcultoConteudo.querySelector("#adminBillingTesteTitulo"),
      badge: adminOcultoConteudo.querySelector("#adminBillingTesteBadge"),
      custo: adminOcultoConteudo.querySelector("#adminBillingTesteCusto"),
      chamadas: adminOcultoConteudo.querySelector("#adminBillingTesteChamadas"),
      tokens: adminOcultoConteudo.querySelector("#adminBillingTesteTokens"),
      pesquisas: adminOcultoConteudo.querySelector(
        "#adminBillingTestePesquisas",
      ),
      meta: adminOcultoConteudo.querySelector("#adminBillingTesteMeta"),
    };
    const salvarBilling = adminOcultoConteudo.querySelector(
      "#adminSalvarBilling",
    );
    const statusBilling = adminOcultoConteudo.querySelector(
      "#adminStatusBilling",
    );
    const atualizarPrecificacaoBilling = adminOcultoConteudo.querySelector(
      "#adminAtualizarPrecificacaoBilling",
    );
    const statusPrecificacaoBilling = adminOcultoConteudo.querySelector(
      "#adminBillingPrecificacaoStatus",
    );

    const testeIAConversa = adminOcultoConteudo.querySelector(
      "#adminTesteIAConversa",
    );
    const testeIAProduto = adminOcultoConteudo.querySelector(
      "#adminTesteIAProduto",
    );
    const testeIAModo = adminOcultoConteudo.querySelector("#adminTesteIAModo");
    const testeIASemente = adminOcultoConteudo.querySelector(
      "#adminTesteIASemente",
    );
    const testeIALocalClima = adminOcultoConteudo.querySelector(
      "#adminTesteIALocalClima",
    );
    const testeIAIntervalo = adminOcultoConteudo.querySelector(
      "#adminTesteIAIntervalo",
    );
    const testeIAUsarContexto = adminOcultoConteudo.querySelector(
      "#adminTesteIAUsarContexto",
    );
    const testeIAPerguntas = adminOcultoConteudo.querySelector(
      "#adminTesteIAPerguntas",
    );
    const testeIAProgresso = adminOcultoConteudo.querySelector(
      "#adminTesteIAProgresso",
    );
    const testeIAEtapa =
      adminOcultoConteudo.querySelector("#adminTesteIAEtapa");
    const testeIAContagem = adminOcultoConteudo.querySelector(
      "#adminTesteIAContagem",
    );
    const testeIABarra =
      adminOcultoConteudo.querySelector("#adminTesteIABarra");
    const testeIAStatus = adminOcultoConteudo.querySelector(
      "#adminTesteIAStatus",
    );
    const testeIAResultados = adminOcultoConteudo.querySelector(
      "#adminTesteIAResultados",
    );
    const testeIASortear = adminOcultoConteudo.querySelector(
      "#adminTesteIASortear",
    );
    const testeIAIniciar = adminOcultoConteudo.querySelector(
      "#adminTesteIAIniciar",
    );
    const testeIAAbrirRelatorio = adminOcultoConteudo.querySelector(
      "#adminTesteIAAbrirRelatorio",
    );
    const testeIABadge =
      adminOcultoConteudo.querySelector("#adminTesteIABadge");
    const testeIAExecucaoModal = adminOcultoConteudo.querySelector(
      "#adminTesteIAExecucaoModal",
    );
    const testeIAExecucaoFecharTopo = adminOcultoConteudo.querySelector(
      "#adminTesteIAExecucaoFecharTopo",
    );
    const testeIACancelar = adminOcultoConteudo.querySelector(
      "#adminTesteIACancelar",
    );
    const testeIAExecucaoAbrirRelatorio = adminOcultoConteudo.querySelector(
      "#adminTesteIAExecucaoAbrirRelatorio",
    );
    const testeIAExecucaoFechar = adminOcultoConteudo.querySelector(
      "#adminTesteIAExecucaoFechar",
    );
    const testeIARelatorioModal = adminOcultoConteudo.querySelector(
      "#adminTesteIARelatorioModal",
    );
    const testeIARelatorioTexto = adminOcultoConteudo.querySelector(
      "#adminTesteIARelatorioTexto",
    );
    const testeIARelatorioFechar = adminOcultoConteudo.querySelector(
      "#adminTesteIARelatorioFechar",
    );
    const testeIARelatorioFecharRodape = adminOcultoConteudo.querySelector(
      "#adminTesteIARelatorioFecharRodape",
    );
    const testeIARelatorioCopiar = adminOcultoConteudo.querySelector(
      "#adminTesteIARelatorioCopiar",
    );
    const testeIARelatorioAbrirArquivo = adminOcultoConteudo.querySelector(
      "#adminTesteIARelatorioAbrirArquivo",
    );

    nomeCliente.value = nomeSalvo;
    planoCliente.value = planoSalvo;

    adminEstadoEdicao = {
      original: {
        nomeCliente: nomeSalvo,
        plano: planoSalvo,
        billing: JSON.parse(JSON.stringify(billingSalvo)),
      },
      elementos: {
        nomeCliente,
        planoCliente,
        campoGroq,
        campoGroqTeste,
        salvarPlano,
        salvarBilling,
        billingInputs,
        billingPrecificacaoInputs,
        billingAvisosInputs,
        avisoAlteracoes,
        textoAlteracoes,
      },
    };

    const formatarDataHoraBillingAdmin = (timestamp) => {
      const valor = Number(timestamp || 0) || 0;

      if (!valor) {
        return "ainda não atualizada";
      }

      return new Date(valor).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    };

    const aplicarPrecificacaoBillingNaTela = (billingOuResumo = {}) => {
      const precificacao = billingOuResumo?.precificacao || {};
      const meta = billingOuResumo?.precificacaoMeta || {};

      for (const [chave, campo] of Object.entries(billingPrecificacaoInputs)) {
        if (!campo) {
          continue;
        }

        const valor = numeroDecimalAdminRenderer(
          precificacao?.[chave],
          numeroDecimalAdminRenderer(campo.value),
        );

        if (valor > 0) {
          campo.value = valor;
        }
      }

      if (statusPrecificacaoBilling) {
        const atualizadoEm = Number(meta?.atualizadaEm || 0) || 0;
        const erro = String(meta?.erroUltimaAtualizacao || "").trim();
        const base = atualizadoEm
          ? `Última atualização: ${formatarDataHoraBillingAdmin(atualizadoEm)}. Groq: ${meta?.fonteGroq || "GroqDocs"}. Câmbio: ${meta?.fonteCambio || "Frankfurter"}.`
          : "Usando a tabela local de segurança até concluir a primeira atualização online.";

        statusPrecificacaoBilling.textContent = erro
          ? `${base} Última tentativa teve falha parcial: ${erro}`
          : base;
        statusPrecificacaoBilling.classList.toggle("erro", !!erro);
      }
    };

    const carregarResumoBillingAdmin = async () => {
      const el = billingConsumoElementos;
      const elTeste = billingTesteElementos;

      try {
        const resultadoBilling = await ipcRenderer.invoke(
          "admin-status-billing",
          {
            token: tokenSessaoAdminOculto,
          },
        );

        if (!resultadoBilling?.ok) {
          throw new Error(
            resultadoBilling?.erro || "Não foi possível carregar o consumo.",
          );
        }

        const resumo = resultadoBilling.resumo || {};
        const motor = resumo.motor || {};
        const teste = resumo.teste || {};
        aplicarPrecificacaoBillingNaTela(resumo);
        const percentual = Math.max(
          0,
          Math.min(100, Number(resumo.percentual || 0) || 0),
        );

        const idMotor = String(motor.fingerprintCurto || "").trim();
        el.titulo.textContent =
          `Plano ${resumo.nomePlano || "-"} • ${resumo.mes || "mês atual"}` +
          (idMotor ? ` • chave ${idMotor}` : "");
        el.orcamento.textContent = formatarMoedaAdmin(resumo.orcamentoBrl);
        el.consumido.textContent = formatarMoedaAdminPrecisa(
          resumo.consumidoBrl,
        );
        el.saldo.textContent = formatarMoedaAdminPrecisa(resumo.saldoBrl);
        el.percentual.textContent = `${percentual.toLocaleString("pt-BR", {
          minimumFractionDigits: percentual > 0 && percentual < 1 ? 2 : 0,
          maximumFractionDigits: 2,
        })}%`;
        el.barra.style.width = `${percentual}%`;
        el.barra.classList.toggle("limite", !!resumo.atingido);
        el.badge.textContent = !motor.configurada
          ? "Sem chave"
          : resumo.atingido
            ? "Limite atingido"
            : "Disponível";
        el.badge.className = !motor.configurada
          ? "admin-status-pill alerta"
          : resumo.atingido
            ? "admin-status-pill erro"
            : "admin-status-pill ok";

        const chamadas = Math.max(
          0,
          Number(resumo.chamadasFaturaveis || 0) || 0,
        );
        const pesquisas = Math.max(
          0,
          Number(resumo.pesquisasWebFaturaveis || 0) || 0,
        );
        const inicio = Number(resumo.billingDesde || 0) || 0;
        const inicioTexto = inicio
          ? new Date(inicio).toLocaleDateString("pt-BR")
          : "primeiro uso desta chave";

        const avisosEmitidos = (
          Array.isArray(resumo.avisosEmitidos) ? resumo.avisosEmitidos : []
        )
          .map((valor) => Number(valor))
          .filter(
            (valor) => Number.isFinite(valor) && valor >= 1 && valor <= 100,
          )
          .sort((a, b) => a - b);
        const textoAvisos = avisosEmitidos.length
          ? ` • níveis registrados: ${avisosEmitidos.map((valor) => `${valor}%`).join(", ")}`
          : " • nenhum nível registrado neste mês";

        el.meta.textContent =
          `${chamadas.toLocaleString("pt-BR")} chamadas faturáveis • ` +
          `${pesquisas.toLocaleString("pt-BR")} pesquisas web • ` +
          `controle desta chave iniciado em ${inicioTexto}${textoAvisos}`;

        const idTeste = String(teste.fingerprintCurto || "").trim();
        elTeste.titulo.textContent =
          `${resumo.mes || "mês atual"}` +
          (idTeste ? ` • chave ${idTeste}` : "");
        elTeste.badge.textContent = teste.configurada
          ? "Separada"
          : "Sem chave";
        elTeste.badge.className = teste.configurada
          ? "admin-status-pill ok"
          : "admin-status-pill alerta";
        elTeste.custo.textContent = formatarMoedaAdminPrecisa(
          teste.custoBrlTotal,
        );
        elTeste.chamadas.textContent = Math.max(
          0,
          Number(teste.chamadas || 0) || 0,
        ).toLocaleString("pt-BR");
        elTeste.tokens.textContent = Math.max(
          0,
          Number(teste.totalTokens || 0) || 0,
        ).toLocaleString("pt-BR");
        elTeste.pesquisas.textContent = Math.max(
          0,
          Number(teste.pesquisasWeb || 0) || 0,
        ).toLocaleString("pt-BR");

        if (!teste.configurada) {
          elTeste.meta.textContent =
            "Cadastre a API de testes na aba Testes. A bateria não usa fallback para a chave do motor.";
        } else if (!Number(teste.chamadas || 0)) {
          elTeste.meta.textContent =
            "Chave de testes pronta. O contador desta chave começa no primeiro uso e volta ao histórico correto se ela for cadastrada novamente.";
        } else {
          const ultimoUso = Number(teste.ultimaChamadaEm || 0) || 0;
          elTeste.meta.textContent =
            `Uso exclusivo de testes administrativos • último uso ` +
            `${
              ultimoUso
                ? new Date(ultimoUso).toLocaleString("pt-BR")
                : "ainda não registrado"
            }`;
        }
      } catch (erro) {
        el.titulo.textContent = "Consumo indisponível";
        el.badge.textContent = "Erro";
        el.badge.className = "admin-status-pill erro";
        el.meta.textContent = erro?.message || "Erro ao carregar o consumo.";

        elTeste.titulo.textContent = "Consumo indisponível";
        elTeste.badge.textContent = "Erro";
        elTeste.badge.className = "admin-status-pill erro";
        elTeste.meta.textContent =
          erro?.message || "Erro ao carregar o consumo.";
      }
    };

    const ativarAbaAdmin = (abaId) => {
      const alvo = String(abaId || "cliente");

      for (const botao of adminAbas) {
        const ativa = botao.dataset.adminAba === alvo;
        botao.classList.toggle("ativa", ativa);
        botao.setAttribute("aria-selected", ativa ? "true" : "false");
      }

      for (const painel of adminPaineis) {
        const ativo = painel.dataset.adminPainel === alvo;
        painel.hidden = !ativo;
        painel.classList.toggle("ativa", ativo);
      }

      adminOcultoConteudo.scrollTop = 0;

      if (alvo === "billing") {
        carregarResumoBillingAdmin();
      }
    };

    for (const botao of adminAbas) {
      botao.addEventListener("click", () => {
        ativarAbaAdmin(botao.dataset.adminAba);
      });
    }

    const atualizarResumoBilling = () => {
      for (const planoId of ["basico", "intermediario", "premium"]) {
        const campos = billingInputs[planoId];

        if (!campos) {
          continue;
        }

        const mensalidade = numeroMonetarioAdminRenderer(
          campos.mensalidade?.value,
        );
        const orcamentoIA = numeroMonetarioAdminRenderer(
          campos.orcamentoIA?.value,
        );
        const sobra = mensalidade - orcamentoIA;

        if (campos.sobra) {
          campos.sobra.textContent = formatarMoedaAdmin(sobra);
          campos.sobra.classList.toggle("negativa", sobra < 0);
        }
      }
    };

    const atualizarResumoPlano = () => {
      const regra = regrasPlano[planoCliente.value] || regrasPlano.premium;

      resumoPlano.innerHTML = `
      <div class="admin-plano-detalhe">
        <span>Plano selecionado</span>
        <strong>${regra.nome}</strong>
        <small>${regra.preco}</small>
      </div>
      <div class="admin-plano-detalhe">
        <span>Contexto disponível</span>
        <strong>${regra.contexto}</strong>
        <small>${regra.niveis}</small>
      </div>
      <div class="admin-plano-detalhe">
        <span>Pesquisa web</span>
        <strong class="${regra.webClasse}">${regra.web}</strong>
        <small>${regra.webDetalhe}</small>
      </div>
    `;
    };

    const marcarEdicao = () => {
      statusPlano.textContent = "";
      statusPlano.className = "admin-config-status";
      atualizarResumoPlano();
      atualizarEstadoAlteracoesAdmin();
    };

    nomeCliente.addEventListener("input", marcarEdicao);
    planoCliente.addEventListener("change", marcarEdicao);
    campoGroq.addEventListener("input", atualizarEstadoAlteracoesAdmin);
    campoGroqTeste?.addEventListener("input", atualizarEstadoAlteracoesAdmin);

    for (const campos of Object.values(billingInputs)) {
      campos.mensalidade?.addEventListener("input", () => {
        statusBilling.textContent = "";
        statusBilling.className = "admin-config-status";
        atualizarResumoBilling();
        atualizarEstadoAlteracoesAdmin();
      });
      campos.orcamentoIA?.addEventListener("input", () => {
        statusBilling.textContent = "";
        statusBilling.className = "admin-config-status";
        atualizarResumoBilling();
        atualizarEstadoAlteracoesAdmin();
      });
    }

    for (const campos of billingAvisosInputs) {
      campos.ativo?.addEventListener("change", () => {
        statusBilling.textContent = "";
        statusBilling.className = "admin-config-status";
        atualizarEstadoAlteracoesAdmin();
      });
      campos.percentual?.addEventListener("input", () => {
        statusBilling.textContent = "";
        statusBilling.className = "admin-config-status";
        atualizarEstadoAlteracoesAdmin();
      });
    }

    atualizarResumoBilling();

    salvarPlano.addEventListener("click", async () => {
      salvarPlano.disabled = true;
      statusPlano.textContent = "Salvando alterações...";
      statusPlano.className = "admin-config-status";

      try {
        const salvo = await ipcRenderer.invoke("admin-salvar-cliente-plano", {
          token: tokenSessaoAdminOculto,
          nomeCliente: nomeCliente.value.trim(),
          plano: planoCliente.value,
        });

        if (!salvo?.ok) {
          throw new Error(salvo?.erro || "Não foi possível salvar o plano.");
        }

        aplicarConfiguracaoComercialCliente(salvo.configuracao || {});

        const nivelAtual = obterNivelContextoIA();
        if (!nivelContextoPermitidoPeloPlano(nivelAtual)) {
          salvarNivelContextoIA(nivelFallbackPermitidoPeloPlano());
        }

        if (!pesquisaWebPermitidaPeloPlano()) {
          salvarPesquisaWebAtivaIA(false);
        }

        adminEstadoEdicao.original = {
          ...adminEstadoEdicao.original,
          nomeCliente: nomeCliente.value.trim(),
          plano: planoCliente.value,
        };

        const regraAtiva =
          regrasPlano[planoCliente.value] || regrasPlano.premium;
        resumoClienteAtivo.textContent = valorVisivelAdmin(
          nomeCliente.value.trim(),
        );
        resumoPlanoAtivo.textContent = regraAtiva.nome;
        resumoContextoAtivo.textContent = regraAtiva.niveis;
        resumoWebAtivo.textContent = regraAtiva.web;
        resumoWebAtivo.className = regraAtiva.webClasse;

        atualizarResumoConfiguracoesIA();
        statusPlano.textContent = `Plano ${obterConfiguracaoComercialCliente().nomePlano} salvo e permissões aplicadas.`;
        statusPlano.className = "admin-config-status ok";
      } catch (erro) {
        statusPlano.textContent = erro?.message || "Erro ao salvar o plano.";
        statusPlano.className = "admin-config-status erro";
      } finally {
        atualizarEstadoAlteracoesAdmin();
      }
    });

    atualizarPrecificacaoBilling?.addEventListener("click", async () => {
      atualizarPrecificacaoBilling.disabled = true;

      if (statusPrecificacaoBilling) {
        statusPrecificacaoBilling.textContent =
          "Consultando preços oficiais e cotação atual...";
        statusPrecificacaoBilling.classList.remove("erro");
      }

      try {
        const resultado = await ipcRenderer.invoke(
          "admin-atualizar-precificacao-billing",
          { token: tokenSessaoAdminOculto },
        );

        if (!resultado?.ok && !resultado?.parcial) {
          throw new Error(
            resultado?.erro || "Não foi possível atualizar a precificação.",
          );
        }

        const billingAtualizado = resultado?.billing || {};
        aplicarPrecificacaoBillingNaTela(billingAtualizado);

        adminEstadoEdicao.original = {
          ...adminEstadoEdicao.original,
          billing: {
            ...adminEstadoEdicao.original.billing,
            precificacao: billingAtualizado.precificacao,
            precificacaoMeta: billingAtualizado.precificacaoMeta,
          },
        };

        await carregarResumoBillingAdmin();
      } catch (erro) {
        if (statusPrecificacaoBilling) {
          statusPrecificacaoBilling.textContent =
            erro?.message || "Erro ao atualizar a precificação.";
          statusPrecificacaoBilling.classList.add("erro");
        }
      } finally {
        atualizarPrecificacaoBilling.disabled = false;
      }
    });

    salvarBilling.addEventListener("click", async () => {
      salvarBilling.disabled = true;
      statusBilling.textContent = "Salvando billing...";
      statusBilling.className = "admin-config-status";

      const billingAtual = {};

      for (const planoId of ["basico", "intermediario", "premium"]) {
        const campos = billingInputs[planoId];
        billingAtual[planoId] = {
          mensalidade: numeroMonetarioAdminRenderer(campos.mensalidade?.value),
          orcamentoIA: numeroMonetarioAdminRenderer(campos.orcamentoIA?.value),
        };
      }

      billingAtual.avisos = billingAvisosInputs.map((campos, indice) => ({
        id: campos.id || `aviso${indice + 1}`,
        ativo: !!campos.ativo?.checked,
        percentual: Math.max(
          1,
          Math.min(99, Math.round(Number(campos.percentual?.value || 0) || 1)),
        ),
      }));

      try {
        const salvo = await ipcRenderer.invoke("admin-salvar-billing", {
          token: tokenSessaoAdminOculto,
          billing: billingAtual,
        });

        if (!salvo?.ok) {
          throw new Error(salvo?.erro || "Não foi possível salvar o billing.");
        }

        const billingConfirmado = salvo.billing || billingAtual;
        adminEstadoEdicao.original = {
          ...adminEstadoEdicao.original,
          billing: JSON.parse(JSON.stringify(billingConfirmado)),
        };

        for (const planoId of ["basico", "intermediario", "premium"]) {
          const campos = billingInputs[planoId];
          const valores = billingConfirmado[planoId] || billingAtual[planoId];
          campos.mensalidade.value = numeroMonetarioAdminRenderer(
            valores.mensalidade,
          ).toFixed(2);
          campos.orcamentoIA.value = numeroMonetarioAdminRenderer(
            valores.orcamentoIA,
          ).toFixed(2);
          regrasPlano[planoId].preco =
            `${formatarMoedaAdmin(valores.mensalidade)}/mês`;
        }

        const avisosConfirmados = Array.isArray(billingConfirmado.avisos)
          ? billingConfirmado.avisos
          : billingAtual.avisos;
        for (const [indice, campos] of billingAvisosInputs.entries()) {
          const aviso =
            avisosConfirmados[indice] || billingAtual.avisos[indice];

          if (campos.ativo) {
            campos.ativo.checked = aviso?.ativo !== false;
          }

          if (campos.percentual) {
            campos.percentual.value = Math.max(
              1,
              Math.min(99, Math.round(Number(aviso?.percentual || 1) || 1)),
            );
          }
        }

        aplicarPrecificacaoBillingNaTela(billingConfirmado);

        atualizarResumoBilling();
        atualizarResumoPlano();
        await carregarResumoBillingAdmin();
        statusBilling.textContent =
          "Billing salvo. Novos valores já estão persistidos.";
        statusBilling.className = "admin-config-status ok";
      } catch (erro) {
        statusBilling.textContent =
          erro?.message || "Erro ao salvar o billing.";
        statusBilling.className = "admin-config-status erro";
      } finally {
        atualizarEstadoAlteracoesAdmin();
      }
    });

    editarMotor.addEventListener("click", () => abrirEditorPromptIA("interno"));

    const carregarStatusGroqAdmin = async (tipo = "motor", elementos = {}) => {
      const campo = elementos.campo;
      const status = elementos.status;
      const badge = elementos.badge;
      const remover = elementos.remover;
      const nome = tipo === "teste" ? "testes" : "motor";

      try {
        const chave = await ipcRenderer.invoke("admin-status-chave-groq", {
          token: tokenSessaoAdminOculto,
          tipo,
        });

        if (!chave?.ok) {
          throw new Error(chave?.erro || "Não foi possível verificar a chave.");
        }

        if (chave.configurada) {
          campo.value = "";
          campo.placeholder = "••••••••••••••••  chave protegida e salva";
          status.textContent =
            `Chave de ${nome} configurada e protegida pelo Windows` +
            (chave.fingerprintCurto ? ` • ID ${chave.fingerprintCurto}` : "") +
            ".";
          status.className = "admin-config-status ok";
          badge.textContent = "Configurada";
          badge.className = "admin-status-pill ok";
          remover.disabled = false;
        } else {
          campo.value = "";
          campo.placeholder =
            tipo === "teste"
              ? "Cole a chave exclusiva de testes"
              : "Cole sua chave da Groq";
          status.textContent =
            tipo === "teste"
              ? "Nenhuma chave de testes configurada."
              : "Nenhuma chave do motor configurada.";
          status.className = "admin-config-status alerta";
          badge.textContent = "Não configurada";
          badge.className = "admin-status-pill alerta";
          remover.disabled = true;
        }

        atualizarEstadoAlteracoesAdmin();
      } catch (erro) {
        status.textContent = erro?.message || "Erro ao verificar a chave.";
        status.className = "admin-config-status erro";
        badge.textContent = "Erro";
        badge.className = "admin-status-pill erro";
      }
    };

    const elementosGroqMotor = {
      campo: campoGroq,
      salvar: salvarGroq,
      remover: removerGroq,
      status: statusGroq,
      badge: groqBadge,
    };
    const elementosGroqTeste = {
      campo: campoGroqTeste,
      salvar: salvarGroqTeste,
      remover: removerGroqTeste,
      status: statusGroqTeste,
      badge: groqTesteBadge,
    };

    const configurarEventosChaveGroqAdmin = (tipo, elementos) => {
      const { campo, salvar, remover, status } = elementos;

      salvar.addEventListener("click", async () => {
        const apiKey = String(campo.value || "").trim();

        if (!apiKey) {
          status.textContent = "Cole uma chave antes de salvar.";
          status.className = "admin-config-status erro";
          campo.focus();
          return;
        }

        salvar.disabled = true;
        status.textContent = "Protegendo e salvando a chave...";
        status.className = "admin-config-status";

        try {
          const salvo = await ipcRenderer.invoke("admin-salvar-chave-groq", {
            token: tokenSessaoAdminOculto,
            tipo,
            apiKey,
          });

          if (!salvo?.ok) {
            throw new Error(salvo?.erro || "Não foi possível salvar a chave.");
          }

          campo.value = "";
          await carregarStatusGroqAdmin(tipo, elementos);
          await carregarResumoBillingAdmin();
        } catch (erro) {
          status.textContent = erro?.message || "Erro ao salvar a chave.";
          status.className = "admin-config-status erro";
        } finally {
          salvar.disabled = false;
          atualizarEstadoAlteracoesAdmin();
        }
      });

      remover.addEventListener("click", async () => {
        remover.disabled = true;

        try {
          const removida = await ipcRenderer.invoke(
            "admin-remover-chave-groq",
            {
              token: tokenSessaoAdminOculto,
              tipo,
            },
          );

          if (!removida?.ok) {
            throw new Error(
              removida?.erro || "Não foi possível remover a chave.",
            );
          }

          campo.value = "";
          await carregarStatusGroqAdmin(tipo, elementos);
          await carregarResumoBillingAdmin();
        } catch (erro) {
          status.textContent = erro?.message || "Erro ao remover a chave.";
          status.className = "admin-config-status erro";
        }
      });

      campo.addEventListener("keydown", (evento) => {
        if (evento.key === "Enter") {
          evento.preventDefault();
          salvar.click();
        }
      });
    };

    configurarEventosChaveGroqAdmin("motor", elementosGroqMotor);
    configurarEventosChaveGroqAdmin("teste", elementosGroqTeste);

    // ---------------------------------------------------------
    // TESTE DE INTEGRIDADE DA IA
    // ---------------------------------------------------------

    let testeIACandidatosCatalogo = [];
    let testeIAExecutando = false;
    let testeIACancelarSolicitado = false;
    let testeIAConversaTesteAtiva = "";
    let testeIAUltimoRelatorio = "";
    let testeIAUltimoRelatorioTexto = "";
    let testeIAEncerrarEsperaAtual = null;

    const abrirModalExecucaoTesteIA = () => {
      testeIACancelarSolicitado = false;
      testeIAExecucaoModal.hidden = false;
      testeIAExecucaoFecharTopo.disabled = true;
      testeIACancelar.hidden = false;
      testeIACancelar.disabled = false;
      testeIAExecucaoAbrirRelatorio.hidden = true;
      testeIAExecucaoFechar.hidden = true;
      testeIAResultados.scrollTop = 0;
    };

    const concluirModalExecucaoTesteIA = () => {
      testeIAExecucaoFecharTopo.disabled = false;
      testeIACancelar.hidden = true;
      testeIACancelar.disabled = true;
      testeIAExecucaoFechar.hidden = false;
      testeIAExecucaoAbrirRelatorio.hidden = !testeIAUltimoRelatorioTexto;
    };

    const fecharModalExecucaoTesteIA = () => {
      if (testeIAExecutando && !testeIACancelarSolicitado) {
        return;
      }

      testeIAExecucaoModal.hidden = true;
    };

    const abrirRelatorioTesteIANaTela = (conteudo) => {
      testeIAUltimoRelatorioTexto = String(conteudo || "");
      testeIARelatorioTexto.textContent = testeIAUltimoRelatorioTexto;
      testeIARelatorioModal.hidden = false;
      testeIARelatorioTexto.scrollTop = 0;
    };

    const fecharRelatorioTesteIANaTela = () => {
      testeIARelatorioModal.hidden = true;
    };

    const normalizarTesteIA = (valor) =>
      String(valor || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/[\u00a0\u202f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const normalizarRespostaComparavelTesteIA = (valor) => {
      let texto = normalizarTesteIA(valor);
      const numeros = {
        zero: "0",
        dois: "2",
        duas: "2",
        tres: "3",
        quatro: "4",
        cinco: "5",
        seis: "6",
        sete: "7",
        oito: "8",
        nove: "9",
        dez: "10",
        onze: "11",
        doze: "12",
        treze: "13",
        quatorze: "14",
        catorze: "14",
        quinze: "15",
        dezesseis: "16",
        dezassete: "17",
        dezessete: "17",
        dezoito: "18",
        dezenove: "19",
        vinte: "20",
      };

      for (const [palavra, numero] of Object.entries(numeros)) {
        texto = texto.replace(new RegExp(`\\b${palavra}\\b`, "g"), numero);
      }

      return texto.replace(/\s+/g, " ").trim();
    };

    const numeroVisivelConversaTesteIA = (conversa) => {
      const numero = String(
        conversa?.numeroWhatsapp || conversa?.id || "",
      ).trim();

      return numero.replace(/@.+$/, "") || "sem número";
    };

    const carregarConversasTesteIA = () => {
      const lista = Object.values(conversas)
        .filter(
          (conversa) =>
            conversa?.id &&
            !conversa?.testeIntegridadeIA &&
            !ehConversaTecnica(conversa),
        )
        .sort((a, b) =>
          String(a?.nome || a?.id || "").localeCompare(
            String(b?.nome || b?.id || ""),
            "pt-BR",
          ),
        );

      testeIAConversa.textContent = "";

      const vazio = document.createElement("option");
      vazio.value = "";
      vazio.textContent = "Selecione uma conversa";
      testeIAConversa.appendChild(vazio);

      for (const conversa of lista) {
        const option = document.createElement("option");
        option.value = conversa.id;
        option.textContent = `${conversa.nome || conversa.id} • ${numeroVisivelConversaTesteIA(
          conversa,
        )}`;
        testeIAConversa.appendChild(option);
      }

      const conversaAtualAdmin = obterConversaAtual();
      if (
        conversaAtualAdmin &&
        lista.some((item) => item.id === conversaAtualAdmin)
      ) {
        testeIAConversa.value = conversaAtualAdmin;
      }
    };

    const carregarCatalogoTesteIA = async () => {
      testeIAProduto.innerHTML =
        '<option value="">Carregando catálogo...</option>';

      try {
        const resultado = await ipcRenderer.invoke(
          "admin-teste-ia-catalogo-sugestoes",
          {
            token: tokenSessaoAdminOculto,
          },
        );

        if (!resultado?.ok) {
          throw new Error(
            resultado?.erro || "Não foi possível ler o catálogo.",
          );
        }

        testeIACandidatosCatalogo = Array.isArray(resultado.candidatos)
          ? resultado.candidatos
          : [];

        testeIAProduto.textContent = "";

        if (!testeIACandidatosCatalogo.length) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = resultado.catalogoAtivo
            ? "Nenhum produto reconhecido automaticamente"
            : "Nenhum catálogo ativo";
          testeIAProduto.appendChild(option);
          testeIAProduto.disabled = true;
          return;
        }

        testeIAProduto.disabled = false;

        testeIACandidatosCatalogo.forEach((item, indice) => {
          const option = document.createElement("option");
          option.value = String(indice);
          option.textContent = `${item.nome} • ${item.preco || "preço detectado"}`;
          testeIAProduto.appendChild(option);
        });
      } catch (erro) {
        testeIACandidatosCatalogo = [];
        testeIAProduto.innerHTML = `<option value="">${escaparHtmlAdmin(
          erro?.message || "Catálogo indisponível",
        )}</option>`;
        testeIAProduto.disabled = true;
      }
    };

    const gerarSementeTesteIA = () =>
      `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`.toUpperCase();

    const LOCAIS_CLIMA_ALEATORIOS_TESTE_IA = [
      "Rio Branco, AC",
      "Maceió, AL",
      "Macapá, AP",
      "Manaus, AM",
      "Salvador, BA",
      "Fortaleza, CE",
      "Brasília, DF",
      "Vitória, ES",
      "Goiânia, GO",
      "São Luís, MA",
      "Cuiabá, MT",
      "Campo Grande, MS",
      "Belo Horizonte, MG",
      "Belém, PA",
      "João Pessoa, PB",
      "Curitiba, PR",
      "Recife, PE",
      "Teresina, PI",
      "Rio de Janeiro, RJ",
      "Natal, RN",
      "Porto Alegre, RS",
      "Porto Velho, RO",
      "Boa Vista, RR",
      "Florianópolis, SC",
      "São Paulo, SP",
      "Aracaju, SE",
      "Palmas, TO",
      "Campinas, SP",
      "Santos, SP",
      "Ribeirão Preto, SP",
      "São José dos Campos, SP",
      "Sorocaba, SP",
      "Niterói, RJ",
      "Petrópolis, RJ",
      "Volta Redonda, RJ",
      "Uberlândia, MG",
      "Juiz de Fora, MG",
      "Montes Claros, MG",
      "Londrina, PR",
      "Maringá, PR",
      "Foz do Iguaçu, PR",
      "Joinville, SC",
      "Blumenau, SC",
      "Chapecó, SC",
      "Caxias do Sul, RS",
      "Pelotas, RS",
      "Santa Maria, RS",
      "São Leopoldo, RS",
      "Feira de Santana, BA",
      "Ilhéus, BA",
      "Caruaru, PE",
      "Campina Grande, PB",
      "Mossoró, RN",
      "Juazeiro do Norte, CE",
      "Anápolis, GO",
      "Dourados, MS",
      "Santarém, PA",
    ];

    let testeIALocalClimaManual = false;

    const gerarLocalClimaAleatorioTesteIA = (semente = "") => {
      const base = String(semente || gerarSementeTesteIA()).trim();
      const digest = crypto.createHash("sha256").update(base).digest();
      const indice =
        digest.readUInt32BE(0) % LOCAIS_CLIMA_ALEATORIOS_TESTE_IA.length;

      return LOCAIS_CLIMA_ALEATORIOS_TESTE_IA[indice];
    };

    const resolverLocalClimaTesteIA = (modo, idBateria) => {
      const atual = String(testeIALocalClima.value || "").trim();
      const geraAutomaticamente = modo === "aleatorio" || modo === "completo";

      if (!geraAutomaticamente) {
        return atual;
      }

      if (testeIALocalClimaManual && atual) {
        return atual;
      }

      const gerado = gerarLocalClimaAleatorioTesteIA(idBateria);
      testeIALocalClima.value = gerado;
      testeIALocalClimaManual = false;

      return gerado;
    };

    let testeIAPlanoAtual = [];
    let testeIAPlanoChave = "";
    let testeIAPlanejamentoUso = [];

    const obterProdutoSelecionadoTesteIA = () => {
      const indice = Number(testeIAProduto.value);

      return Number.isFinite(indice)
        ? testeIACandidatosCatalogo[indice] || null
        : null;
    };

    const chaveConfigPlanoTesteIA = () =>
      [
        String(testeIAModo.value || "aleatorio"),
        String(testeIASemente.value || ""),
        String(testeIAProduto.value || ""),
        String(testeIALocalClima.value || "").trim(),
      ].join("|");

    const invalidarPlanoTesteIA = (mensagem = "") => {
      testeIAPlanoAtual = [];
      testeIAPlanoChave = "";
      testeIAPlanejamentoUso = [];

      testeIAPerguntas.innerHTML = `
      <div class="admin-teste-ia-pergunta">
        <span>?</span>
        <div>
          <strong>Bateria ainda não gerada</strong>
          <small>${escaparHtmlAdmin(
            mensagem ||
              "Clique em Sortear novas perguntas ou em Iniciar teste.",
          )}</small>
        </div>
      </div>
    `;
    };

    const montarTestesDePlanoDinamicoIA = (
      plano,
      origem,
      produto,
      localClima,
    ) => {
      const grupo = origem === "padrao" ? "padrao" : "aleatorio";
      const prefixo = origem === "padrao" ? "Padrão" : "Aleatório";

      const esperadoDireto = String(
        plano?.catalogoDireto?.expectedContains || "",
      ).trim();
      const esperadoFollowup = String(
        plano?.catalogoFollowup?.expectedContains || "",
      ).trim();
      const esperadoFactual = String(
        plano?.factual?.expectedContains || "",
      ).trim();

      return [
        {
          id: `${grupo}-catalogo-direto`,
          nome: `${prefixo} • Catálogo direto`,
          prompt: String(plano?.catalogoDireto?.prompt || "").trim(),
          grupo,
          variante: "gerada-do-catalogo",
          sequencia: `catalogo:${produto.nome}`,
          requireLogs: [
            "catalogo=true",
            "web=false",
            "rota=catalogo-direto",
            "historico=0",
          ],
          warnIfMissingLogs: ["catalogoDireto=true"],
          forbidLogs: ["rota=web"],
          requireResponse: esperadoDireto
            ? [normalizarTesteIA(esperadoDireto)]
            : [],
        },
        {
          id: `${grupo}-catalogo-followup`,
          nome: `${prefixo} • Continuação de catálogo`,
          prompt: String(plano?.catalogoFollowup?.prompt || "").trim(),
          grupo,
          variante: "gerada-do-contexto-do-produto",
          sequencia: `catalogo:${produto.nome}`,
          requireLogs: [
            "catalogo=true",
            "web=false",
            ...(esperadoFollowup ? [] : ["rota=catalogo-followup"]),
          ],
          requireAnyLogs: esperadoFollowup
            ? [["rota=catalogo-followup", "rota=catalogo-direto"]]
            : [],
          forbidLogs: ["rota=web"],
          requireResponse: esperadoFollowup
            ? [normalizarTesteIA(esperadoFollowup)]
            : [],
        },
        {
          id: `${grupo}-catalogo-grounding`,
          nome: `${prefixo} • Catálogo sem invenção`,
          prompt: String(plano?.catalogoGrounding?.prompt || "").trim(),
          grupo,
          variante: `atributo-ausente:${String(
            plano?.catalogoGrounding?.attribute || "",
          ).trim()}`,
          sequencia: `catalogo:${produto.nome}`,
          requireLogs: [
            "web=false",
            "rota=catalogo-followup",
            "ATTRIBUTE_CHECK",
            "supported=false",
            "groq=false",
          ],
        },
        {
          id: `${grupo}-factual`,
          nome: `${prefixo} • Fato estático`,
          prompt: String(plano?.factual?.prompt || "").trim(),
          grupo,
          variante: "gerada-dinamicamente",
          sequencia: "factual",
          requireLogs: [
            "factualEstavel=true",
            "web=false",
            "rota=factual",
            "historico=0",
          ],
          forbidLogs: ["COMPOUND_MINI_INICIO"],
          requireResponse: esperadoFactual
            ? [normalizarTesteIA(esperadoFactual)]
            : [],
        },
        {
          id: `${grupo}-web-direta`,
          nome: `${prefixo} • Web direta`,
          prompt: String(plano?.webDireta?.prompt || "").trim(),
          grupo,
          variante: "gerada-dinamicamente",
          sequencia: `web:${grupo}`,
          requireLogs: [
            "web=true",
            "rota=web",
            "historico=0",
            "COMPOUND_MINI_INICIO",
            "pesquisou=true",
          ],
          warnIfMissingLogs: ["webContinuacao=false"],
        },
        {
          id: `${grupo}-web-followup`,
          nome: `${prefixo} • Continuação de web`,
          prompt: String(plano?.webFollowup?.prompt || "").trim(),
          grupo,
          variante: "continua-a-web-anterior",
          sequencia: `web:${grupo}`,
          requireLogs: ["web=true", "rota=web", "historico=2"],
          warnIfMissingLogs: ["webContinuacao=true", "webContextoForcado=true"],
          allowContextArithmeticWarning: true,
          forbidLogs: ["rota=catalogo-followup"],
        },
        {
          id: `${grupo}-normal`,
          nome: `${prefixo} • Conversa normal`,
          prompt: String(plano?.normalDireta?.prompt || "").trim(),
          grupo,
          variante: "gerada-dinamicamente",
          sequencia: `normal:${grupo}`,
          requireLogs: ["catalogo=false", "web=false", "rota=automatica"],
          forbidLogs: ["rota=catalogo-followup", "rota=web"],
        },
        {
          id: `${grupo}-normal-followup`,
          nome: `${prefixo} • Continuação normal`,
          prompt: String(plano?.normalFollowup?.prompt || "").trim(),
          grupo,
          variante: "continua-a-normal-anterior",
          sequencia: `normal:${grupo}`,
          requireLogs: ["catalogo=false", "web=false", "rota=automatica"],
          forbidLogs: ["rota=catalogo-followup", "rota=web"],
        },
        {
          id: `${grupo}-clima-sem-local`,
          nome: `${prefixo} • Clima sem localização`,
          prompt: String(plano?.climaSemLocal?.prompt || "").trim(),
          grupo,
          variante: "gerada-dinamicamente",
          sequencia: `clima:${grupo}`,
          requireLogs: [
            "CLIMA_AGUARDANDO_LOCAL",
            "CLIMA_PEDIU_LOCAL_AUTOMATICO",
            "semGroq=true",
          ],
          forbidLogs: ["COMPOUND_MINI_INICIO"],
        },
        {
          id: `${grupo}-clima-local`,
          nome: `${prefixo} • Clima com localização`,
          prompt: localClima,
          perguntaClimaOriginal: String(
            plano?.climaSemLocal?.prompt || "",
          ).trim(),
          grupo,
          variante: "local-configurado",
          sequencia: `clima:${grupo}`,
          requireLogs: [
            "climaPendente=true",
            "localClima=true",
            "web=true",
            "rota=web",
            "pesquisou=true",
          ],
          validarCelsius: true,
          validarTemporalClima: true,
        },
      ];
    };

    const gerarUmaSuiteDinamicaTesteIA = async (
      estilo,
      produto,
      localClima,
      idBateria,
    ) => {
      const resultado = await ipcRenderer.invoke("admin-teste-ia-gerar-plano", {
        token: tokenSessaoAdminOculto,
        estilo,
        semente: idBateria,
        produto: {
          nome: produto.nome,
          preco: produto.preco,
          pagina: produto.pagina,
          resumo: produto.resumo,
        },
      });

      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível gerar as perguntas dinâmicas.",
        );
      }

      testeIAPlanejamentoUso.push({
        estilo,
        modelo: resultado.modelo || "",
        uso: resultado.uso || null,
        tentativas: resultado.tentativas || 1,
      });

      return montarTestesDePlanoDinamicoIA(
        resultado.plano,
        estilo,
        produto,
        localClima,
      );
    };

    const gerarPlanoCompletoTesteIA = async (forcarNovo = false) => {
      const produto = obterProdutoSelecionadoTesteIA();

      if (!produto?.nome || !produto?.resumo) {
        throw new Error("Selecione um produto válido do catálogo.");
      }

      const modo = String(testeIAModo.value || "aleatorio").trim();

      if (!String(testeIASemente.value || "").trim() || forcarNovo) {
        testeIASemente.value = gerarSementeTesteIA();
      }

      const idBateria = String(testeIASemente.value || "").trim();
      const localClima = resolverLocalClimaTesteIA(modo, idBateria);

      if (!localClima) {
        throw new Error("Informe uma cidade para os testes de clima.");
      }

      const chave = chaveConfigPlanoTesteIA();

      if (
        !forcarNovo &&
        testeIAPlanoAtual.length &&
        testeIAPlanoChave === chave
      ) {
        return testeIAPlanoAtual;
      }

      testeIAStatus.textContent =
        "Gerando perguntas a partir do catálogo e do contexto atual. Se uma geração vier inválida, o sistema tenta novamente sozinho...";
      testeIAStatus.className = "admin-config-status";
      testeIASortear.disabled = true;
      testeIAIniciar.disabled = true;
      testeIAPlanejamentoUso = [];

      const suites = [];

      try {
        if (modo === "padrao" || modo === "completo") {
          suites.push(
            ...(await gerarUmaSuiteDinamicaTesteIA(
              "padrao",
              produto,
              localClima,
              idBateria,
            )),
          );
        }

        if (modo === "aleatorio" || modo === "completo") {
          suites.push(
            ...(await gerarUmaSuiteDinamicaTesteIA(
              "aleatorio",
              produto,
              localClima,
              idBateria,
            )),
          );
        }

        testeIAPlanoAtual = suites;
        testeIAPlanoChave = chaveConfigPlanoTesteIA();

        testeIAStatus.textContent =
          "Perguntas geradas dos dados atuais. Nenhum produto, preço, atributo, fato ou assunto foi fixado na bateria.";
        testeIAStatus.className = "admin-config-status ok";

        return suites;
      } finally {
        if (!testeIAExecutando) {
          testeIASortear.disabled = false;
          testeIAIniciar.disabled = false;
        }
      }
    };

    const montarTestesIntegridadeIA = () =>
      Array.isArray(testeIAPlanoAtual) ? testeIAPlanoAtual : [];

    const atualizarEstadoModoTesteIA = () => {
      const modo = String(testeIAModo.value || "aleatorio");

      testeIASemente.disabled = false;
      testeIASortear.disabled = false;

      testeIAIniciar.textContent =
        modo === "completo"
          ? "Iniciar teste completo"
          : modo === "padrao"
            ? "Iniciar regressão padrão"
            : "Iniciar teste aleatório";
    };

    const atualizarPreviewTesteIA = () => {
      const testes = montarTestesIntegridadeIA();

      if (!testeIAExecutando) {
        testeIAContagem.textContent = `0/${testes.length || 0}`;
      }

      if (!testes.length) {
        invalidarPlanoTesteIA();
        return;
      }

      testeIAPerguntas.innerHTML = testes
        .map(
          (teste, indice) => `
          <div class="admin-teste-ia-pergunta">
            <span>${indice + 1}</span>
            <div>
              <strong>${escaparHtmlAdmin(teste.nome)}</strong>
              <small>${escaparHtmlAdmin(teste.prompt)}</small>
            </div>
          </div>
        `,
        )
        .join("");
    };

    const respostaClimaComUnidadeInadequadaTesteIA = (valor) => {
      const texto = String(valor || "").trim();

      if (!texto) {
        return false;
      }

      if (/\bfahrenheit\b|°\s*f\b/i.test(texto)) {
        return true;
      }

      return /-?\d{1,3}(?:[.,]\d+)?\s*°(?!\s*c\b)/i.test(texto);
    };

    const numeroTemporalClimaTesteIA = (valor) => {
      const texto = normalizarTesteIA(valor);

      if (/^\d{1,2}$/.test(texto)) {
        const numero = Number(texto);
        return Number.isFinite(numero) ? numero : null;
      }

      const mapa = {
        zero: 0,
        um: 1,
        uma: 1,
        dois: 2,
        duas: 2,
        tres: 3,
        quatro: 4,
        cinco: 5,
        seis: 6,
        sete: 7,
        oito: 8,
        nove: 9,
        dez: 10,
        onze: 11,
        doze: 12,
        treze: 13,
        quatorze: 14,
        quinze: 15,
      };

      return Object.prototype.hasOwnProperty.call(mapa, texto)
        ? mapa[texto]
        : null;
    };

    const criarDataLocalClimaTesteIA = (
      base = new Date(),
      deslocamento = 0,
    ) => {
      const data = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        12,
        0,
        0,
        0,
      );

      data.setDate(data.getDate() + Number(deslocamento || 0));
      return data;
    };

    const formatarDataBrClimaTesteIA = (data) => {
      const dia = String(data.getDate()).padStart(2, "0");
      const mes = String(data.getMonth() + 1).padStart(2, "0");
      return `${dia}/${mes}/${data.getFullYear()}`;
    };

    const extrairDeslocamentoTemporalClimaTesteIA = (valor) => {
      const texto = normalizarTesteIA(valor);

      if (!texto) {
        return null;
      }

      if (/\bdepois de amanha\b/.test(texto)) {
        return 2;
      }

      if (/\bamanha\b/.test(texto)) {
        return 1;
      }

      const relativo = texto.match(
        /\b(?:daqui a|em)\s+(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze)\s+dias?\b/,
      );

      if (relativo) {
        return numeroTemporalClimaTesteIA(relativo[1]);
      }

      if (/\bhoje\b/.test(texto)) {
        return 0;
      }

      return null;
    };

    const mesPtNumeroClimaTesteIA = (valor) => {
      const mapa = {
        janeiro: 1,
        fevereiro: 2,
        marco: 3,
        abril: 4,
        maio: 5,
        junho: 6,
        julho: 7,
        agosto: 8,
        setembro: 9,
        outubro: 10,
        novembro: 11,
        dezembro: 12,
      };

      return mapa[normalizarTesteIA(valor)] || null;
    };

    const mesmaDataClimaTesteIA = (data, esperada) =>
      data instanceof Date &&
      esperada instanceof Date &&
      data.getFullYear() === esperada.getFullYear() &&
      data.getMonth() === esperada.getMonth() &&
      data.getDate() === esperada.getDate();

    const extrairDatasExplicitasClimaTesteIA = (valor, anoPadrao) => {
      const texto = normalizarTesteIA(valor);
      const resultados = [];

      const adicionar = (indice, dia, mes, ano, origem) => {
        const d = Number(dia);
        const m = Number(mes);
        const a = Number(ano || anoPadrao);

        if (
          !Number.isInteger(d) ||
          !Number.isInteger(m) ||
          !Number.isInteger(a) ||
          d < 1 ||
          d > 31 ||
          m < 1 ||
          m > 12
        ) {
          return;
        }

        const data = new Date(a, m - 1, d, 12, 0, 0, 0);

        if (
          data.getFullYear() !== a ||
          data.getMonth() !== m - 1 ||
          data.getDate() !== d
        ) {
          return;
        }

        resultados.push({
          indice,
          data,
          origem,
          contextoAntes: texto.slice(Math.max(0, indice - 90), indice),
        });
      };

      for (const match of texto.matchAll(
        /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/g,
      )) {
        let ano = match[3] ? Number(match[3]) : anoPadrao;

        if (ano < 100) {
          ano += 2000;
        }

        adicionar(match.index || 0, match[1], match[2], ano, match[0]);
      }

      for (const match of texto.matchAll(
        /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/g,
      )) {
        adicionar(
          match.index || 0,
          match[1],
          mesPtNumeroClimaTesteIA(match[2]),
          match[3] || anoPadrao,
          match[0],
        );
      }

      return resultados.sort((a, b) => a.indice - b.indice);
    };

    const deslocamentoDoContextoAntesClimaTesteIA = (contextoAntes) => {
      const texto = normalizarTesteIA(contextoAntes);

      const relativo = texto.match(
        /(?:daqui a|em)\s+(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze)\s+dias?[^.?!]{0,45}$/,
      );

      if (relativo) {
        return numeroTemporalClimaTesteIA(relativo[1]);
      }

      if (/\bdepois de amanha\b[^.?!]{0,45}$/.test(texto)) {
        return 2;
      }

      if (/\bamanha\b[^.?!]{0,45}$/.test(texto)) {
        return 1;
      }

      if (/\bhoje\b[^.?!]{0,45}$/.test(texto)) {
        return 0;
      }

      return null;
    };

    const respostaClimaComInconsistenciaTemporalTesteIA = (
      valor,
      perguntaOriginal,
    ) => {
      const resposta = String(valor || "").trim();

      if (!resposta) {
        return {
          inconsistente: false,
          motivo: "",
        };
      }

      const hoje = criarDataLocalClimaTesteIA(new Date(), 0);
      const deslocamentoPergunta =
        extrairDeslocamentoTemporalClimaTesteIA(perguntaOriginal);
      const alvo =
        deslocamentoPergunta === null
          ? null
          : criarDataLocalClimaTesteIA(hoje, deslocamentoPergunta);

      const datas = extrairDatasExplicitasClimaTesteIA(
        resposta,
        hoje.getFullYear(),
      );

      for (const item of datas) {
        const deslocamentoRotulo = deslocamentoDoContextoAntesClimaTesteIA(
          item.contextoAntes,
        );

        if (deslocamentoRotulo === null) {
          continue;
        }

        const esperada = criarDataLocalClimaTesteIA(hoje, deslocamentoRotulo);

        if (!mesmaDataClimaTesteIA(item.data, esperada)) {
          return {
            inconsistente: true,
            motivo: `${item.origem} deveria corresponder a ${formatarDataBrClimaTesteIA(
              esperada,
            )}`,
          };
        }
      }

      if (alvo && datas.length === 1) {
        const unico = datas[0];
        const rotulo = deslocamentoDoContextoAntesClimaTesteIA(
          unico.contextoAntes,
        );

        if (rotulo === null && !mesmaDataClimaTesteIA(unico.data, alvo)) {
          return {
            inconsistente: true,
            motivo: `${unico.origem} nao corresponde a ${formatarDataBrClimaTesteIA(
              alvo,
            )}`,
          };
        }
      }

      return {
        inconsistente: false,
        motivo: "",
      };
    };

    const compararRespostaEsperadaTesteIA = (
      respostaOriginal,
      esperadoOriginal,
    ) => {
      const respostaBase = normalizarTesteIA(respostaOriginal);
      const esperadoBase = normalizarTesteIA(esperadoOriginal);
      const resposta = normalizarRespostaComparavelTesteIA(respostaOriginal);
      const esperado = normalizarRespostaComparavelTesteIA(esperadoOriginal);

      if (!esperado) {
        return { ok: true, equivalente: false };
      }

      if (respostaBase.includes(esperadoBase)) {
        return { ok: true, equivalente: false };
      }

      // Numero por extenso x algarismo, por exemplo "oito" x "8".
      if (resposta.includes(esperado)) {
        return { ok: true, equivalente: true };
      }

      // Listas equivalentes com conectores ou pontuacao diferentes,
      // por exemplo "P, M, G" e "P, M e G".
      const itens = esperado
        .split(/\s*(?:,|;|\/|\be\b)\s*/g)
        .map((item) => item.trim())
        .filter(Boolean);

      if (itens.length < 2 || itens.some((item) => item.length > 40)) {
        return { ok: false, equivalente: false };
      }

      const listaEquivalente = itens.every((item) => {
        const escapado = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${escapado}([^a-z0-9]|$)`, "i").test(
          resposta,
        );
      });

      return {
        ok: listaEquivalente,
        equivalente: listaEquivalente,
      };
    };

    const numeroMonetarioTesteIA = (valorOriginal) => {
      const valor = String(valorOriginal || "")
        .replace(/\s+/g, "")
        .trim();

      if (!valor) {
        return null;
      }

      let normalizado = valor.replace(/[^\d.,-]/g, "");

      if (!normalizado || !/\d/.test(normalizado)) {
        return null;
      }

      const ultimaVirgula = normalizado.lastIndexOf(",");
      const ultimoPonto = normalizado.lastIndexOf(".");

      if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
        if (ultimaVirgula > ultimoPonto) {
          normalizado = normalizado.replace(/\./g, "").replace(",", ".");
        } else {
          normalizado = normalizado.replace(/,/g, "");
        }
      } else if (ultimaVirgula >= 0) {
        normalizado = normalizado.replace(/\./g, "").replace(",", ".");
      } else if ((normalizado.match(/\./g) || []).length > 1) {
        normalizado = normalizado.replace(/\./g, "");
      }

      const numero = Number(normalizado);
      return Number.isFinite(numero) ? numero : null;
    };

    const extrairValoresMoedaTesteIA = (textoOriginal, moeda) => {
      const texto = String(textoOriginal || "")
        .replace(/[\u00a0\u202f]/g, " ")
        .replace(/\s+/g, " ");

      const padroes =
        moeda === "brl"
          ? [
              /R\$\s*([0-9](?:[0-9.,]*[0-9])?)/gi,
              /([0-9](?:[0-9.,]*[0-9])?)\s*(?:reais|real)\b/gi,
            ]
          : [
              /US\$\s*([0-9](?:[0-9.,]*[0-9])?)/gi,
              /([0-9](?:[0-9.,]*[0-9])?)\s*(?:d[oó]lares?|usd)\b/gi,
            ];

      const valores = [];

      for (const padrao of padroes) {
        let match = null;

        while ((match = padrao.exec(texto))) {
          const numero = numeroMonetarioTesteIA(match[1]);

          if (numero !== null && numero >= 0) {
            valores.push(numero);
          }
        }
      }

      return valores;
    };

    const obterUltimoValorMoedaTesteIA = (texto, moeda) => {
      const valores = extrairValoresMoedaTesteIA(texto, moeda);
      return valores.length ? valores[valores.length - 1] : null;
    };

    const historicoNaoZeroNosLogsTesteIA = (logs) => {
      const matches = Array.from(
        String(logs || "").matchAll(/\bhistorico=(\d+)\b/g),
      );

      return matches.some((match) => Number(match?.[1] || 0) > 0);
    };

    const localizarWebDiretaAnteriorTesteIA = (
      teste,
      resultadosAnteriores = [],
    ) =>
      [...resultadosAnteriores].reverse().find((item) => {
        if (!item?.teste || item.teste.sequencia !== teste?.sequencia) {
          return false;
        }

        if (!String(item.teste.id || "").endsWith("-web-direta")) {
          return false;
        }

        const logsAnteriores = Array.isArray(item?.retorno?.logs)
          ? item.retorno.logs.join("\n")
          : "";

        return (
          ["pass", "warning"].includes(item?.avaliacao?.status) &&
          logsAnteriores.includes("rota=web") &&
          logsAnteriores.includes("pesquisou=true") &&
          !!String(item?.retorno?.resposta || "").trim()
        );
      });

    const validarCalculoMonetarioWebTesteIA = (
      teste,
      retorno,
      resultadosAnteriores = [],
    ) => {
      if (!String(teste?.id || "").endsWith("-web-followup")) {
        return { aplicavel: false, ok: true, motivo: "" };
      }

      const prompt = String(teste?.prompt || "");
      const promptNormalizado = normalizarTesteIA(prompt);
      const resposta = String(retorno?.resposta || "").trim();
      const usdPrompt = obterUltimoValorMoedaTesteIA(prompt, "usd");
      const brlPrompt = obterUltimoValorMoedaTesteIA(prompt, "brl");

      if (
        !resposta ||
        (usdPrompt === null && brlPrompt === null) ||
        !/\b(quanto|custaria|ficaria|daria|converter|conversao|equivale|equivalem|representa|em reais|em dolares|comprar|pagaria|vale|custa)\b/.test(
          promptNormalizado,
        )
      ) {
        return { aplicavel: false, ok: true, motivo: "" };
      }

      const anterior = localizarWebDiretaAnteriorTesteIA(
        teste,
        resultadosAnteriores,
      );

      if (!anterior) {
        return { aplicavel: false, ok: true, motivo: "" };
      }

      const promptAnteriorNormalizado = normalizarTesteIA(
        anterior?.teste?.prompt || "",
      );

      if (
        !/\b(dolar|dolares|usd)\b/.test(promptAnteriorNormalizado) ||
        !/\b(real|reais|brl|cotacao|cambio)\b/.test(promptAnteriorNormalizado)
      ) {
        return { aplicavel: false, ok: true, motivo: "" };
      }

      const taxaBrlPorUsd = obterUltimoValorMoedaTesteIA(
        anterior.retorno.resposta,
        "brl",
      );

      if (!(taxaBrlPorUsd > 0 && taxaBrlPorUsd < 100)) {
        return { aplicavel: false, ok: true, motivo: "" };
      }

      const usdResposta = obterUltimoValorMoedaTesteIA(resposta, "usd");
      const brlResposta = obterUltimoValorMoedaTesteIA(resposta, "brl");

      let esperado = null;
      let recebido = null;
      let descricao = "";

      if (usdPrompt !== null && brlPrompt === null && brlResposta !== null) {
        esperado = usdPrompt * taxaBrlPorUsd;
        recebido = brlResposta;
        descricao = "USD para BRL";
      } else if (
        brlPrompt !== null &&
        usdPrompt === null &&
        usdResposta !== null
      ) {
        esperado = brlPrompt / taxaBrlPorUsd;
        recebido = usdResposta;
        descricao = "BRL para USD";
      } else {
        return { aplicavel: false, ok: true, motivo: "" };
      }

      if (!(esperado !== null && recebido !== null && esperado > 0)) {
        return { aplicavel: false, ok: true, motivo: "" };
      }

      const tolerancia = Math.max(0.06, Math.abs(esperado) * 0.02);
      const diferenca = Math.abs(recebido - esperado);
      const ok = diferenca <= tolerancia;
      const esperadoFormatado = esperado.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const recebidoFormatado = recebido.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      return {
        aplicavel: true,
        ok,
        descricao,
        esperado,
        recebido,
        motivo: ok
          ? `cálculo monetário conferido (${descricao})`
          : `cálculo monetário incorreto (${descricao}): esperado aproximadamente ${esperadoFormatado}, recebido ${recebidoFormatado}`,
      };
    };

    const validarCalculoContextualWebTesteIA = (
      teste,
      retorno,
      resultadosAnteriores = [],
    ) => {
      if (!teste?.allowContextArithmeticWarning) {
        return { ok: false, motivo: "" };
      }

      const prompt = String(teste?.prompt || "");
      const promptNormalizado = normalizarTesteIA(prompt);
      const resposta = String(retorno?.resposta || "").trim();
      const logs = Array.isArray(retorno?.logs) ? retorno.logs.join("\n") : "";

      if (
        !resposta ||
        !/\b(considerando|com base|a partir|usando|essa taxa|esta taxa|essa cotacao|esta cotacao|isso)\b/.test(
          promptNormalizado,
        ) ||
        !/\b(quanto|custaria|ficaria|daria|converter|conversao|em reais|em dolares|comprar|pagaria|representa)\b/.test(
          promptNormalizado,
        ) ||
        !logs.includes("rota=automatica") ||
        !logs.includes("web=false") ||
        !historicoNaoZeroNosLogsTesteIA(logs) ||
        logs.includes("rota=catalogo-followup") ||
        logs.includes("ATTRIBUTE_CHECK")
      ) {
        return { ok: false, motivo: "" };
      }

      const calculo = validarCalculoMonetarioWebTesteIA(
        teste,
        retorno,
        resultadosAnteriores,
      );

      if (!calculo.aplicavel || !calculo.ok) {
        return { ok: false, motivo: "" };
      }

      return {
        ok: true,
        motivo: `continuação web resolvida corretamente pelo contexto, sem nova pesquisa (${calculo.descricao})`,
      };
    };

    const avaliarEtapaTesteIA = (teste, retorno, resultadosAnteriores = []) => {
      const logs = Array.isArray(retorno?.logs) ? retorno.logs.join("\n") : "";
      const resposta = normalizarRespostaComparavelTesteIA(
        retorno?.resposta || "",
      );

      const faltando = (teste.requireLogs || []).filter(
        (trecho) => !logs.includes(trecho),
      );
      const gruposAlternativosFaltando = (teste.requireAnyLogs || [])
        .filter(
          (grupo) =>
            Array.isArray(grupo) &&
            grupo.length > 0 &&
            !grupo.some((trecho) => logs.includes(trecho)),
        )
        .map((grupo) => `(${grupo.join(" OU ")})`);

      faltando.push(...gruposAlternativosFaltando);

      const avisos = (teste.warnIfMissingLogs || [])
        .filter((trecho) => !logs.includes(trecho))
        .map((trecho) => `diagnostico secundario ausente: ${trecho}`);

      const proibidos = (teste.forbidLogs || []).filter((trecho) =>
        logs.includes(trecho),
      );

      const respostaFaltando = [];
      for (const trecho of teste.requireResponse || []) {
        const comparacao = compararRespostaEsperadaTesteIA(
          retorno?.resposta || "",
          trecho,
        );

        if (!comparacao.ok) {
          respostaFaltando.push(trecho);
        } else if (comparacao.equivalente) {
          avisos.push(`resposta equivalente ao esperado: ${trecho}`);
        }
      }

      const respostaProibida = (teste.forbidResponse || []).filter((trecho) =>
        resposta.includes(normalizarRespostaComparavelTesteIA(trecho)),
      );

      if (
        teste.validarCelsius &&
        respostaClimaComUnidadeInadequadaTesteIA(retorno?.resposta)
      ) {
        respostaProibida.push("temperatura fora de Celsius");
      }

      if (teste.validarTemporalClima) {
        const temporal = respostaClimaComInconsistenciaTemporalTesteIA(
          retorno?.resposta,
          teste.perguntaClimaOriginal || "",
        );

        if (temporal.inconsistente) {
          respostaProibida.push(
            `data de clima incompatível com o período pedido: ${temporal.motivo}`,
          );
        }
      }

      const calculoMonetarioWeb = validarCalculoMonetarioWebTesteIA(
        teste,
        retorno,
        resultadosAnteriores,
      );

      if (calculoMonetarioWeb.aplicavel && !calculoMonetarioWeb.ok) {
        respostaProibida.push(calculoMonetarioWeb.motivo);
      }

      const falhaBasica =
        retorno?.motivo === "timeout" ||
        !String(retorno?.resposta || "").trim() ||
        proibidos.length > 0 ||
        respostaFaltando.length > 0 ||
        respostaProibida.length > 0;

      if (!falhaBasica && faltando.length > 0) {
        const faltasPermitidasWebContextual = new Set([
          "web=true",
          "rota=web",
          "historico=2",
        ]);
        const faltasSomenteExecucaoWeb = faltando.every((trecho) =>
          faltasPermitidasWebContextual.has(trecho),
        );

        if (faltasSomenteExecucaoWeb) {
          const calculoContextual = validarCalculoContextualWebTesteIA(
            teste,
            retorno,
            resultadosAnteriores,
          );

          if (calculoContextual.ok) {
            for (const trecho of faltando.splice(0, faltando.length)) {
              avisos.push(`execucao interna diferente do esperado: ${trecho}`);
            }

            if (calculoContextual.motivo) {
              avisos.push(calculoContextual.motivo);
            }
          }
        }
      }

      const falhou = falhaBasica || faltando.length > 0;
      const status = falhou ? "fail" : avisos.length ? "warning" : "pass";

      return {
        ok: !falhou,
        status,
        warning: status === "warning",
        faltando,
        proibidos,
        respostaFaltando,
        respostaProibida,
        avisos,
      };
    };

    const esperarRespostaTesteIA = (
      numero,
      timeoutMs = 75000,
      aoAguardar = null,
    ) =>
      new Promise((resolve) => {
        let finalizado = false;
        let cancelarEstaEspera = null;
        const iniciadaEm = Date.now();

        const encerrar = (dados) => {
          if (finalizado) {
            return;
          }

          finalizado = true;
          clearTimeout(timer);
          clearInterval(intervaloStatus);
          ipcRenderer.removeListener(
            "admin-teste-ia-resposta-capturada",
            ouvinte,
          );

          if (testeIAEncerrarEsperaAtual === cancelarEstaEspera) {
            testeIAEncerrarEsperaAtual = null;
          }

          resolve(dados || null);
        };

        cancelarEstaEspera = (
          erro = "Teste interrompido pelo administrador.",
        ) => {
          encerrar({
            numero,
            resposta: "",
            motivo: "interrompido",
            erro: String(erro || "Teste interrompido pelo administrador."),
          });
        };

        testeIAEncerrarEsperaAtual = cancelarEstaEspera;

        const ouvinte = (_evento, dados) => {
          if (Number(dados?.numero || 0) === numero) {
            encerrar(dados);
          }
        };

        ipcRenderer.on("admin-teste-ia-resposta-capturada", ouvinte);

        const intervaloStatus = setInterval(() => {
          const decorridoMs = Date.now() - iniciadaEm;
          const restanteMs = Math.max(0, timeoutMs - decorridoMs);

          if (typeof aoAguardar === "function") {
            aoAguardar({
              decorridoSegundos: Math.floor(decorridoMs / 1000),
              restanteSegundos: Math.ceil(restanteMs / 1000),
            });
          }
        }, 1000);

        const timer = setTimeout(() => {
          encerrar({
            numero,
            resposta: "",
            motivo: "timeout",
            erro: `Nenhuma resposta foi capturada em ${Math.round(
              timeoutMs / 1000,
            )} segundos.`,
          });
        }, timeoutMs);
      });

    const mensagemSinteticaTesteIA = (conversaTesteId, nome, texto, numero) => {
      const timestamp = Date.now();

      return {
        id: conversaTesteId,
        nome: `[Teste IA] ${nome}`,
        arquivada: false,
        trancada: false,
        idMensagem: `test-ia-in-${numero}-${timestamp}-${Math.random()
          .toString(16)
          .slice(2)}`,
        idMensagemWpp: null,
        resposta: null,
        texto,
        tipo: "texto",
        mime: null,
        fileName: null,
        viewOnceKind: null,
        horario: new Date(timestamp).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        timestamp,
        minha: false,
        mediaPath: null,
        mediaUrl: null,
        rawBase64: null,
        statusEntrega: null,
        editada: false,
        reacoes: [],
        testeIntegridadeIA: true,
      };
    };

    const limparConversaSombraTesteIA = (id) => {
      if (!id) {
        return;
      }

      try {
        limparRespostaAutomaticaPendente(id);
        cancelarRespostaAutomaticaIAEmAndamento(id, true);
        limparEntradaCurtaIA(id);
        limparPendenciaClimaIA(id);
      } catch {}

      respostasAutomaticasProcessadas.forEach((_valor, chave) => {
        if (String(chave || "").startsWith(`${id}|`)) {
          respostasAutomaticasProcessadas.delete(chave);
        }
      });

      respostasAutomaticasPendentes.delete(id);
      respostasAutomaticasEmGeracao.delete(id);
      timersRespostaAutomaticaIA.delete(id);
      entradasCurtasIAPorConversa.delete(id);
      pendenciasClimaIAPorConversa.delete(id);
      ultimaRotaRespostaIAPorConversa.delete(id);
      locaisClimaIAPorConversa.delete(id);

      salvarModoIAConversa(id, "manual");
      salvarSegundoPlanoIAConversa(id, false);

      conversasSombraTesteIA.delete(id);
      delete conversas[id];
    };

    const textoRelatorioTesteIA = (
      conversaOrigem,
      testes,
      resultados,
      intervalo,
      usarContexto,
      modoTeste,
      sementeTeste,
    ) => {
      const passou = resultados.filter(
        (item) => item.avaliacao.status === "pass",
      ).length;
      const avisos = resultados.filter(
        (item) => item.avaliacao.status === "warning",
      ).length;
      const falhou = resultados.filter(
        (item) => item.avaliacao.status === "fail",
      ).length;
      const semFalha = passou + avisos;

      const linhas = [
        "WHATSIAPP - TESTE DE INTEGRIDADE DA IA",
        `RESULTADO: ${semFalha}/${resultados.length} sem falha | PASS=${passou} | WARNING=${avisos} | FAIL=${falhou}`,
        `CONVERSA DE REFERENCIA: ${conversaOrigem.nome || conversaOrigem.id}`,
        `ID: ${conversaOrigem.id}`,
        `CONTEXTO RECENTE COPIADO: ${usarContexto ? "SIM" : "NAO"}`,
        `MODO DA BATERIA: ${String(modoTeste || "padrao").toUpperCase()}`,
        `GERACAO DE PERGUNTAS: DINAMICA POR IA`,
        `ID DA BATERIA: ${sementeTeste || "(sem id)"}`,
        `PLANEJAMENTO: ${
          testeIAPlanejamentoUso
            .map((item) => {
              const total = Number(item?.uso?.total_tokens || 0) || 0;
              return `${String(item?.estilo || "").toUpperCase()}=${total} tokens`;
            })
            .join(" | ") || "sem dados"
        }`,
        `INTERVALO ENTRE TESTES: ${Math.round(intervalo / 1000)}s`,
        `GERADO EM: ${new Date().toLocaleString("pt-BR")}`,
        "",
      ];

      resultados.forEach((item, indice) => {
        const retorno = item.retorno;
        const avaliacao = item.avaliacao;

        const rotuloStatus =
          avaliacao.status === "warning"
            ? "WARNING"
            : avaliacao.status === "fail"
              ? "FAIL"
              : "PASS";

        linhas.push(`[${rotuloStatus}] ${indice + 1}. ${item.teste.nome}`);
        linhas.push(
          `GRUPO: ${String(item.teste.grupo || "padrao").toUpperCase()}`,
        );
        linhas.push(`VARIANTE: ${item.teste.variante || "fixa"}`);
        linhas.push(`SEQUENCIA: ${item.teste.sequencia || "isolada"}`);

        if (item.teste.atributoCatalogo) {
          linhas.push(`ATRIBUTO CATALOGO: ${item.teste.atributoCatalogo}`);
        }

        linhas.push(`PROMPT: ${item.teste.prompt}`);
        linhas.push(`RESPOSTA: ${retorno?.resposta || "(sem resposta)"}`);
        linhas.push(`MOTIVO: ${retorno?.motivo || "desconhecido"}`);

        if (retorno?.erro) {
          linhas.push(`ERRO DA ETAPA: ${retorno.erro}`);
        }

        if (avaliacao.faltando.length) {
          linhas.push(`FALTOU LOG: ${avaliacao.faltando.join(" | ")}`);
        }

        if (avaliacao.proibidos.length) {
          linhas.push(`LOG INDEVIDO: ${avaliacao.proibidos.join(" | ")}`);
        }

        if (avaliacao.respostaFaltando.length) {
          linhas.push(
            `FALTOU NA RESPOSTA: ${avaliacao.respostaFaltando.join(" | ")}`,
          );
        }

        if (avaliacao.respostaProibida.length) {
          linhas.push(
            `RESPOSTA INDEVIDA: ${avaliacao.respostaProibida.join(" | ")}`,
          );
        }

        if (avaliacao.avisos.length) {
          linhas.push(`AVISO: ${avaliacao.avisos.join(" | ")}`);
        }

        linhas.push("LOGS RELEVANTES:");

        const logs = Array.isArray(retorno?.logs)
          ? retorno.logs.filter((linha) =>
              /\[(BG IA|WEB IA|CATALOGO IA|CATALOGO|TEST IA)\]/.test(linha),
            )
          : [];

        for (const linha of logs) {
          linhas.push(`  ${linha}`);
        }

        linhas.push("");
      });

      return linhas.join("\n");
    };

    const executarTesteIntegridadeIA = async () => {
      if (testeIAExecutando) {
        return;
      }

      const conversaId = String(testeIAConversa.value || "").trim();
      const conversaOrigem = conversas[conversaId];

      if (!conversaOrigem) {
        testeIAStatus.textContent =
          "Selecione uma conversa válida para iniciar o teste.";
        testeIAStatus.className = "admin-config-status erro";
        testeIAConversa.focus();
        return;
      }

      const modoTeste = String(testeIAModo.value || "aleatorio").trim();

      if (
        modoTeste !== "padrao" &&
        !String(testeIASemente.value || "").trim()
      ) {
        testeIASemente.value = gerarSementeTesteIA();
      }

      const sementeTeste =
        modoTeste === "padrao" ? "" : String(testeIASemente.value || "").trim();

      let testes = montarTestesIntegridadeIA();

      if (!testes.length || testeIAPlanoChave !== chaveConfigPlanoTesteIA()) {
        try {
          testes = await gerarPlanoCompletoTesteIA(false);
          atualizarPreviewTesteIA();
        } catch (erro) {
          testeIAStatus.textContent =
            erro?.message || "Não foi possível gerar a bateria dinâmica.";
          testeIAStatus.className = "admin-config-status erro";
          return;
        }
      }

      if (!testes.length) {
        testeIAStatus.textContent = "Nenhum teste pôde ser preparado.";
        testeIAStatus.className = "admin-config-status erro";
        return;
      }

      const intervalo = Math.max(
        1000,
        Number(testeIAIntervalo.value || 5000) || 5000,
      );
      const usarContexto = !!testeIAUsarContexto.checked;
      const conversaTesteId = `teste-integridade-${Date.now()}@s.whatsapp.net`;

      testeIAExecutando = true;
      testeIACancelarSolicitado = false;
      testeIAConversaTesteAtiva = conversaTesteId;
      testeIAUltimoRelatorio = "";
      testeIAUltimoRelatorioTexto = "";
      testeIARelatorioModal.hidden = true;
      abrirModalExecucaoTesteIA();
      testeIAIniciar.disabled = true;
      testeIASortear.disabled = true;
      testeIAConversa.disabled = true;
      testeIAProduto.disabled = true;
      testeIAModo.disabled = true;
      testeIASemente.disabled = true;
      testeIALocalClima.disabled = true;
      testeIAIntervalo.disabled = true;
      testeIAUsarContexto.disabled = true;
      testeIAAbrirRelatorio.hidden = true;
      testeIAResultados.textContent = "";
      testeIABadge.textContent = "Executando";
      testeIABadge.className = "admin-status-pill alerta";
      testeIAStatus.textContent =
        "Criando ambiente isolado. Nenhuma mensagem será enviada ao contato.";
      testeIAStatus.className = "admin-config-status";

      // Se o renderer foi fechado/recarregado durante uma bateria, o processo
      // principal pode continuar com uma sessão de teste antiga em memória.
      // Como localmente não há teste em execução neste ponto, encerramos apenas
      // essa sessão órfã antes de criar uma nova bateria.
      try {
        await ipcRenderer.invoke("admin-teste-ia-encerrar", {
          token: tokenSessaoAdminOculto,
        });
      } catch {}

      const historicoBase = usarContexto
        ? conversaOrigem.mensagens
            .filter(
              (msg) =>
                String(msg?.texto || "").trim() &&
                ["texto", "chat"].includes(String(msg?.tipo || "texto")),
            )
            .slice(-15)
            .map((msg) => ({
              ...msg,
              reacoes: Array.isArray(msg?.reacoes) ? [...msg.reacoes] : [],
            }))
        : [];

      conversas[conversaTesteId] = {
        ...conversaOrigem,
        id: conversaTesteId,
        nome: `[Teste IA] ${conversaOrigem.nome || conversaOrigem.id}`,
        arquivada: false,
        trancadaWhatsapp: false,
        trancada: false,
        naoLidasLocal: 0,
        mensagens: historicoBase,
        testeIntegridadeIA: true,
      };
      conversasSombraTesteIA.set(conversaTesteId, conversas[conversaTesteId]);

      salvarModoIAConversa(conversaTesteId, "automatico");
      salvarSegundoPlanoIAConversa(conversaTesteId, true);

      const inicio = await ipcRenderer.invoke("admin-teste-ia-iniciar", {
        token: tokenSessaoAdminOculto,
        conversaOriginalId: conversaOrigem.id,
        conversaOriginalNome: conversaOrigem.nome || conversaOrigem.id,
        conversaTesteId,
      });

      if (!inicio?.ok) {
        limparConversaSombraTesteIA(conversaTesteId);
        testeIAExecutando = false;
        testeIAIniciar.disabled = false;
        testeIAConversa.disabled = false;
        testeIAProduto.disabled = false;
        testeIAModo.disabled = false;
        testeIASemente.disabled = false;
        testeIASortear.disabled = false;
        testeIALocalClima.disabled = false;
        testeIAIntervalo.disabled = false;
        testeIAUsarContexto.disabled = false;
        testeIAStatus.textContent =
          inicio?.erro || "Não foi possível iniciar o teste.";
        testeIAStatus.className = "admin-config-status erro";
        testeIABadge.textContent = "Erro";
        testeIABadge.className = "admin-status-pill erro";
        testeIAConversaTesteAtiva = "";
        concluirModalExecucaoTesteIA();
        return;
      }

      const resultados = [];

      try {
        for (let indice = 0; indice < testes.length; indice += 1) {
          if (testeIACancelarSolicitado) {
            throw new Error("Teste interrompido pelo administrador.");
          }

          const teste = testes[indice];
          const numero = indice + 1;

          // Defesa adicional contra qualquer atualizacao concorrente da lista real.
          // A conversa sombra nunca pode desaparecer no meio da bateria.
          if (!conversas[conversaTesteId]) {
            const sombraPreservada =
              conversasSombraTesteIA.get(conversaTesteId);

            if (sombraPreservada) {
              conversas[conversaTesteId] = sombraPreservada;
            }
          }

          if (!conversas[conversaTesteId]) {
            throw new Error(
              "A conversa sombra do teste foi perdida antes da etapa. A bateria foi interrompida para evitar resultado falso.",
            );
          }

          if (String(teste.id || "").endsWith("clima-sem-local")) {
            // O teste de clima sem local precisa começar sem cidade herdada de
            // etapas anteriores. Isso isola a regra testada sem apagar o restante
            // do contexto da conversa sombra.
            locaisClimaIAPorConversa.delete(conversaTesteId);
            pendenciasClimaIAPorConversa.delete(conversaTesteId);
          }

          testeIAContagem.textContent = `${numero}/${testes.length}`;
          testeIAEtapa.textContent = teste.nome;
          testeIABarra.style.width = `${Math.round((indice / testes.length) * 100)}%`;
          testeIAStatus.textContent = `Simulando recebimento: “${teste.prompt}”`;
          testeIAStatus.className = "admin-config-status";

          const etapaInicio = await ipcRenderer.invoke(
            "admin-teste-ia-etapa-iniciar",
            {
              token: tokenSessaoAdminOculto,
              numero,
              nome: teste.nome,
              prompt: teste.prompt,
            },
          );

          if (!etapaInicio?.ok) {
            throw new Error(
              etapaInicio?.erro ||
                `Não foi possível iniciar o teste ${numero}.`,
            );
          }

          const esperaResposta = esperarRespostaTesteIA(
            numero,
            75000,
            ({ decorridoSegundos, restanteSegundos }) => {
              testeIAStatus.textContent =
                `Aguardando resposta da etapa ${numero}. ` +
                `${decorridoSegundos}s decorridos, limite em ${restanteSegundos}s.`;
            },
          );

          ipcRenderer.emit(
            "mensagem",
            {},
            mensagemSinteticaTesteIA(
              conversaTesteId,
              conversaOrigem.nome || conversaOrigem.id,
              teste.prompt,
              numero,
            ),
          );

          const capturada = await esperaResposta;

          if (testeIACancelarSolicitado) {
            throw new Error("Teste interrompido pelo administrador.");
          }

          if (capturada?.motivo === "timeout") {
            cancelarRespostaAutomaticaIAEmAndamento(conversaTesteId, true);
            limparRespostaAutomaticaPendente(conversaTesteId);
            respostasAutomaticasProcessadas.forEach((_valor, chave) => {
              if (String(chave || "").startsWith(`${conversaTesteId}|`)) {
                respostasAutomaticasProcessadas.delete(chave);
              }
            });
          }

          const retorno = await ipcRenderer.invoke(
            "admin-teste-ia-etapa-finalizar",
            {
              token: tokenSessaoAdminOculto,
              resposta: capturada?.resposta || "",
              motivo: capturada?.motivo || (capturada ? "resposta" : "timeout"),
              erro: capturada?.erro || "",
            },
          );

          const avaliacao = avaliarEtapaTesteIA(teste, retorno, resultados);

          resultados.push({
            teste,
            retorno,
            avaliacao,
          });

          const linha = document.createElement("div");
          const statusVisual =
            avaliacao.status || (avaliacao.ok ? "pass" : "fail");
          linha.className =
            statusVisual === "fail"
              ? "admin-teste-ia-resultado erro"
              : statusVisual === "warning"
                ? "admin-teste-ia-resultado warning"
                : "admin-teste-ia-resultado ok";
          linha.innerHTML = `
          <span>${statusVisual === "pass" ? "✓" : statusVisual === "warning" ? "⚠" : "!"}</span>
          <div>
            <strong>${escaparHtmlAdmin(teste.nome)}</strong>
            <small>${statusVisual === "pass" ? "Passou" : statusVisual === "warning" ? "Aviso, resposta válida" : "Falhou"} • ${escaparHtmlAdmin(
              retorno?.resposta ||
                retorno?.erro ||
                (retorno?.motivo === "timeout"
                  ? "Tempo limite excedido"
                  : "Sem resposta"),
            )}</small>
          </div>
        `;
          testeIAResultados.appendChild(linha);
          testeIAResultados.scrollTop = testeIAResultados.scrollHeight;

          testeIABarra.style.width = `${Math.round((numero / testes.length) * 100)}%`;

          if (indice < testes.length - 1) {
            const fimEspera = Date.now() + intervalo;

            while (Date.now() < fimEspera) {
              if (testeIACancelarSolicitado) {
                throw new Error("Teste interrompido pelo administrador.");
              }

              const restante = Math.max(
                0,
                Math.ceil((fimEspera - Date.now()) / 1000),
              );

              testeIAStatus.textContent = `Aguardando ${restante}s antes do próximo teste...`;

              await new Promise((resolve) =>
                setTimeout(resolve, Math.min(1000, fimEspera - Date.now())),
              );
            }
          }
        }

        const relatorio = textoRelatorioTesteIA(
          conversaOrigem,
          testes,
          resultados,
          intervalo,
          usarContexto,
          modoTeste,
          sementeTeste,
        );

        const salvo = await ipcRenderer.invoke(
          "admin-teste-ia-salvar-relatorio",
          {
            token: tokenSessaoAdminOculto,
            conteudo: relatorio,
          },
        );

        if (salvo?.ok && salvo?.arquivo) {
          testeIAUltimoRelatorio = salvo.arquivo;
          testeIAAbrirRelatorio.hidden = false;
        }

        testeIAUltimoRelatorioTexto = relatorio;

        const totalPassou = resultados.filter(
          (item) => item.avaliacao.status === "pass",
        ).length;
        const totalAvisos = resultados.filter(
          (item) => item.avaliacao.status === "warning",
        ).length;
        const totalFalhou = resultados.filter(
          (item) => item.avaliacao.status === "fail",
        ).length;
        const totalSemFalha = totalPassou + totalAvisos;

        testeIAEtapa.textContent = "Teste concluído";
        testeIAContagem.textContent =
          totalAvisos > 0
            ? `${totalSemFalha}/${resultados.length} sem falha, ${totalAvisos} aviso${totalAvisos === 1 ? "" : "s"}`
            : `${totalPassou}/${resultados.length} passaram`;
        testeIABarra.style.width = "100%";
        testeIAStatus.textContent = salvo?.ok
          ? `Relatório salvo em: ${salvo.arquivo}`
          : "Teste concluído, mas o relatório não pôde ser salvo.";
        testeIAStatus.className =
          totalFalhou > 0
            ? "admin-config-status erro"
            : totalAvisos > 0
              ? "admin-config-status alerta"
              : "admin-config-status ok";
        testeIABadge.textContent =
          totalFalhou > 0
            ? "Há falhas"
            : totalAvisos > 0
              ? "Tudo certo, com avisos"
              : "Tudo certo";
        testeIABadge.className =
          totalFalhou > 0
            ? "admin-status-pill erro"
            : totalAvisos > 0
              ? "admin-status-pill alerta"
              : "admin-status-pill ok";
      } catch (erro) {
        testeIAStatus.textContent =
          erro?.message || "O teste foi interrompido por um erro.";
        testeIAStatus.className = "admin-config-status erro";
        testeIABadge.textContent = testeIACancelarSolicitado
          ? "Interrompido"
          : "Erro";
        testeIABadge.className = "admin-status-pill erro";
      } finally {
        limparConversaSombraTesteIA(conversaTesteId);

        try {
          await ipcRenderer.invoke("admin-teste-ia-encerrar", {
            token: tokenSessaoAdminOculto,
          });
        } catch {}

        testeIAExecutando = false;
        testeIAIniciar.disabled = false;
        testeIAConversa.disabled = false;
        testeIAProduto.disabled = testeIACandidatosCatalogo.length === 0;
        testeIAModo.disabled = false;
        testeIASemente.disabled = false;
        testeIASortear.disabled = false;
        testeIALocalClima.disabled = false;
        testeIAIntervalo.disabled = false;
        testeIAUsarContexto.disabled = false;
        testeIAConversaTesteAtiva = "";
        testeIAEncerrarEsperaAtual = null;
        concluirModalExecucaoTesteIA();
      }
    };

    testeIAIniciar.addEventListener("click", executarTesteIntegridadeIA);

    testeIACancelar.addEventListener("click", () => {
      if (!testeIAExecutando || testeIACancelarSolicitado) {
        return;
      }

      testeIACancelarSolicitado = true;
      testeIACancelar.disabled = true;
      testeIAExecucaoFecharTopo.disabled = false;
      testeIAExecucaoFechar.hidden = false;
      testeIAStatus.textContent =
        "Teste interrompido. Encerrando a etapa atual e limpando o ambiente...";
      testeIAStatus.className = "admin-config-status alerta";

      if (typeof testeIAEncerrarEsperaAtual === "function") {
        testeIAEncerrarEsperaAtual(
          "Teste interrompido manualmente pelo administrador.",
        );
      }

      if (testeIAConversaTesteAtiva) {
        cancelarRespostaAutomaticaIAEmAndamento(
          testeIAConversaTesteAtiva,
          true,
        );
        limparRespostaAutomaticaPendente(testeIAConversaTesteAtiva);
      }
    });

    testeIAExecucaoFecharTopo.addEventListener(
      "click",
      fecharModalExecucaoTesteIA,
    );
    testeIAExecucaoFechar.addEventListener("click", fecharModalExecucaoTesteIA);

    testeIAExecucaoAbrirRelatorio.addEventListener("click", () => {
      if (!testeIAUltimoRelatorioTexto) {
        return;
      }

      testeIAExecucaoModal.hidden = true;
      abrirRelatorioTesteIANaTela(testeIAUltimoRelatorioTexto);
    });

    testeIARelatorioFechar.addEventListener(
      "click",
      fecharRelatorioTesteIANaTela,
    );

    testeIARelatorioFecharRodape.addEventListener(
      "click",
      fecharRelatorioTesteIANaTela,
    );

    testeIARelatorioCopiar.addEventListener("click", async () => {
      if (!testeIAUltimoRelatorioTexto) {
        return;
      }

      try {
        await navigator.clipboard.writeText(testeIAUltimoRelatorioTexto);
        testeIARelatorioCopiar.textContent = "Copiado";
        setTimeout(() => {
          testeIARelatorioCopiar.textContent = "Copiar relatório";
        }, 1600);
      } catch {
        const area = document.createElement("textarea");
        area.value = testeIAUltimoRelatorioTexto;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();

        testeIARelatorioCopiar.textContent = "Copiado";
        setTimeout(() => {
          testeIARelatorioCopiar.textContent = "Copiar relatório";
        }, 1600);
      }
    });

    testeIARelatorioAbrirArquivo.addEventListener("click", async () => {
      if (!testeIAUltimoRelatorio) {
        testeIAStatus.textContent = "O relatório ainda não foi salvo em disco.";
        testeIAStatus.className = "admin-config-status alerta";
        return;
      }

      const aberto = await ipcRenderer.invoke(
        "admin-teste-ia-abrir-relatorio",
        {
          token: tokenSessaoAdminOculto,
          arquivo: testeIAUltimoRelatorio,
        },
      );

      if (!aberto?.ok) {
        testeIAStatus.textContent =
          aberto?.erro || "Não foi possível abrir o relatório.";
        testeIAStatus.className = "admin-config-status erro";
      }
    });

    testeIAAbrirRelatorio.addEventListener("click", async () => {
      if (!testeIAUltimoRelatorio) {
        return;
      }

      const aberto = await ipcRenderer.invoke(
        "admin-teste-ia-abrir-relatorio",
        {
          token: tokenSessaoAdminOculto,
          arquivo: testeIAUltimoRelatorio,
        },
      );

      if (!aberto?.ok) {
        testeIAStatus.textContent =
          aberto?.erro || "Não foi possível abrir o relatório.";
        testeIAStatus.className = "admin-config-status erro";
      }
    });

    testeIAProduto.addEventListener("change", () => {
      invalidarPlanoTesteIA(
        "O produto mudou. Gere uma nova bateria para usar o catálogo atualizado.",
      );
    });

    testeIAModo.addEventListener("change", () => {
      atualizarEstadoModoTesteIA();

      const modo = String(testeIAModo.value || "aleatorio").trim();

      if (
        (modo === "aleatorio" || modo === "completo") &&
        !testeIALocalClimaManual
      ) {
        if (!String(testeIASemente.value || "").trim()) {
          testeIASemente.value = gerarSementeTesteIA();
        }

        resolverLocalClimaTesteIA(
          modo,
          String(testeIASemente.value || "").trim(),
        );
      }

      invalidarPlanoTesteIA("O modo mudou. Gere a bateria novamente.");
    });

    testeIASemente.addEventListener("change", () => {
      const modo = String(testeIAModo.value || "aleatorio").trim();

      if (
        (modo === "aleatorio" || modo === "completo") &&
        !testeIALocalClimaManual &&
        String(testeIASemente.value || "").trim()
      ) {
        resolverLocalClimaTesteIA(
          modo,
          String(testeIASemente.value || "").trim(),
        );
      }

      invalidarPlanoTesteIA(
        "O ID da bateria mudou. Gere as perguntas novamente.",
      );
    });

    testeIASortear.addEventListener("click", async () => {
      if (testeIAExecutando) {
        return;
      }

      testeIASemente.value = gerarSementeTesteIA();
      invalidarPlanoTesteIA(
        "Gerando novas perguntas a partir dos dados atuais...",
      );

      try {
        await gerarPlanoCompletoTesteIA(true);
        atualizarPreviewTesteIA();
      } catch (erro) {
        testeIAStatus.textContent =
          erro?.message || "Não foi possível gerar novas perguntas.";
        testeIAStatus.className = "admin-config-status erro";
      }
    });

    testeIALocalClima.addEventListener("input", () => {
      testeIALocalClimaManual = !!String(testeIALocalClima.value || "").trim();
      invalidarPlanoTesteIA("A cidade mudou. Gere a bateria novamente.");
    });

    carregarConversasTesteIA();
    await carregarCatalogoTesteIA();

    if (!String(testeIASemente.value || "").trim()) {
      testeIASemente.value = gerarSementeTesteIA();
    }

    const modoInicialTesteIA = String(testeIAModo.value || "aleatorio").trim();

    if (
      modoInicialTesteIA === "aleatorio" ||
      modoInicialTesteIA === "completo"
    ) {
      resolverLocalClimaTesteIA(
        modoInicialTesteIA,
        String(testeIASemente.value || "").trim(),
      );
    }

    atualizarEstadoModoTesteIA();
    invalidarPlanoTesteIA(
      "Clique em Sortear novas perguntas. Se iniciar sem sortear antes, o sistema gera automaticamente.",
    );

    atualizarResumoPlano();
    atualizarEstadoAlteracoesAdmin();
    await carregarStatusGroqAdmin("motor", elementosGroqMotor);
    await carregarStatusGroqAdmin("teste", elementosGroqTeste);
    await carregarResumoBillingAdmin();

    adminOcultoConteudo
      .querySelector("#adminOcultoSair")
      ?.addEventListener("click", () => fecharAdminOculto());
  }

  async function fecharAdminOculto(forcar = false) {
    const token = tokenSessaoAdminOculto;

    if (!forcar && token) {
      const alteracoes = coletarAlteracoesPendentesAdmin();

      if (alteracoes.length) {
        const descartar = await confirmarRollbackAdmin(alteracoes);

        if (!descartar) {
          return false;
        }
      }
    }

    if (
      obterTipoPromptIAEmEdicao() === "interno" &&
      overlayPromptBaseIA.classList.contains("aberto")
    ) {
      fecharPromptBaseIAConfig();
    }

    tokenSessaoAdminOculto = null;
    motorIAAdminAtual = "";
    adminEstadoEdicao = null;

    adminOcultoOverlay.classList.remove("aberto");
    adminOcultoOverlay.setAttribute("aria-hidden", "true");

    if (token) {
      try {
        await ipcRenderer.invoke("admin-logout", { token });
      } catch {}
    }

    return true;
  }

  async function abrirAdminOculto() {
    if (adminOcultoAbrindo || adminOcultoOverlay.classList.contains("aberto")) {
      return;
    }

    adminOcultoAbrindo = true;
    tokenSessaoAdminOculto = null;

    adminOcultoOverlay.classList.add("aberto");
    adminOcultoOverlay.setAttribute("aria-hidden", "false");
    adminOcultoTitulo.textContent = "Acesso administrativo";
    adminOcultoConteudo.innerHTML = `
    <div class="admin-oculto-carregando">Verificando acesso...</div>
  `;

    try {
      const status = await ipcRenderer.invoke("admin-status");

      if (status?.configurado) {
        renderizarLoginAdminOculto(status);
      } else {
        renderizarSetupAdminOculto();
      }
    } catch (erro) {
      adminOcultoConteudo.innerHTML = `
      <div id="adminOcultoErro" class="admin-oculto-erro visivel">
        ${escaparHtmlAdmin(erro?.message || "Não foi possível abrir a área administrativa.")}
      </div>
    `;
    } finally {
      adminOcultoAbrindo = false;
    }
  }

  adminOcultoFechar.addEventListener("click", fecharAdminOculto);

  adminOcultoOverlay.addEventListener("click", (evento) => {
    if (evento.target === adminOcultoOverlay) {
      fecharAdminOculto();
    }
  });

  adminRollbackOverlay.addEventListener("click", (evento) => {
    if (evento.target === adminRollbackOverlay) {
      adminRollbackOverlay.querySelector("#adminRollbackContinuar")?.click();
    }
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.defaultPrevented) {
      return;
    }

    // Em teclados macOS, Option+A pode produzir "å" em `event.key`.
    // `event.code` permanece estável e identifica a tecla física A.
    const teclaA =
      evento.code === "KeyA" ||
      ["a", "å"].includes(String(evento.key || "").toLowerCase());
    const macos = typeof process !== "undefined" && process.platform === "darwin";

    // macOS: Command + Option + A (alternativa: Control + Option + A).
    // Windows/Linux preservam o atalho legado Control + Shift + Alt + A.
    const atalhoAdminMac =
      macos &&
      evento.altKey &&
      teclaA &&
      (evento.metaKey || evento.ctrlKey);
    const atalhoAdminWindows =
      !macos &&
      evento.ctrlKey &&
      evento.shiftKey &&
      evento.altKey &&
      teclaA;
    const atalhoAdmin = atalhoAdminMac || atalhoAdminWindows;

    if (atalhoAdmin) {
      evento.preventDefault();
      evento.stopPropagation();
      abrirAdminOculto();
      return;
    }

    if (
      evento.key === "Escape" &&
      adminOcultoOverlay.classList.contains("aberto")
    ) {
      evento.preventDefault();
      fecharAdminOculto();
    }
  });

  function definirMotorIAAdmin(valor) {
    motorIAAdminAtual = String(valor || "").trim();

    const statusAdmin = adminOcultoConteudo.querySelector("#adminMotorStatus");
    const tamanhoAdmin =
      adminOcultoConteudo.querySelector("#adminMotorTamanho");

    if (statusAdmin) {
      statusAdmin.textContent = "Motor protegido na área administrativa.";
      statusAdmin.className = "admin-config-status ok";
    }

    if (tamanhoAdmin) {
      tamanhoAdmin.textContent = `${motorIAAdminAtual.length.toLocaleString("pt-BR")} caracteres`;
    }

    atualizarEstadoAlteracoesAdmin();
    return motorIAAdminAtual;
  }

  function aplicarPrecificacaoAtualizada(dados = {}) {
    const estado = adminEstadoEdicao;
    const inputs = estado?.elementos?.billingPrecificacaoInputs || {};
    const billing = dados?.billing || {};
    const precificacao = billing?.precificacao || {};

    for (const [chave, campo] of Object.entries(inputs)) {
      if (!campo) {
        continue;
      }

      const valor = numeroDecimalAdminRenderer(precificacao?.[chave], 0);

      if (valor > 0) {
        campo.value = valor;
      }
    }
  }

  return {
    abrir: abrirAdminOculto,
    obterTokenSessao: () => tokenSessaoAdminOculto,
    obterMotorIA: () => motorIAAdminAtual,
    definirMotorIA: definirMotorIAAdmin,
    atualizarEstadoAlteracoes: atualizarEstadoAlteracoesAdmin,
    solicitarFechamentoEditorPromptIA,
    aplicarPrecificacaoAtualizada,
  };
}

module.exports = {
  criarModuloAdmin,
  escaparHtmlAdmin,
  numeroDecimalAdminRenderer,
  formatarMoedaAdmin,
  formatarMoedaAdminPrecisa,
};
