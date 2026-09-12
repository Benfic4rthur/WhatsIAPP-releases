function criarModuloConfiguracoesApp(deps = {}) {
  const {
    ipcRenderer,
    document,
    window,
    localStorage,
    botaoPerfilApp,
    NIVEIS_CONTEXTO_IA,
    CHAVE_HASH_TRANCADAS,
    obterPromptInternoIA,
    salvarPromptInternoIA,
    obterPromptPersonalizadoIA,
    salvarPromptPersonalizadoIA,
    obterNivelContextoIA,
    salvarNivelContextoIA,
    obterConfiguracaoNivelContextoIA,
    carregarConfiguracaoComercialCliente,
    nivelContextoPermitidoPeloPlano,
    nivelFallbackPermitidoPeloPlano,
    pesquisaWebPermitidaPeloPlano,
    obterPesquisaWebAtivaIA,
    salvarPesquisaWebAtivaIA,
    senhaTrancadasConfigurada,
    hashSenhaTrancadas,
    bloquearTrancadas,
    atualizarContadores,
    renderConversas,
    obterModuloAdminOculto,
    obterConfiguracaoComercialCliente,
  } = deps;

  const overlayConfiguracoesApp = document.createElement("div");
  overlayConfiguracoesApp.id = "overlayConfiguracoesApp";
  overlayConfiguracoesApp.innerHTML = `
    <section
      id="painelConfiguracoesApp"
      role="dialog"
      aria-modal="true"
      aria-label="Configurações do WhatsIAPP"
    >
      <div class="config-app-topo">
        <div class="config-app-titulo">Configurações</div>

        <button
          id="fecharConfiguracoesApp"
          class="config-app-fechar"
          type="button"
          aria-label="Fechar"
        >×</button>
      </div>

      <div class="config-app-corpo config-app-corpo-compacto">
        <div class="config-app-secao-titulo">IA</div>

        <div class="config-app-lista-atalhos">
          <button
            id="abrirConfiguracoesIA"
            class="config-ia-atalho"
            type="button"
          >
            <span class="config-ia-atalho-texto">
              <span class="config-ia-atalho-titulo">Configurações de IA</span>
              <span id="resumoConfiguracoesIA">Contexto mínimo</span>
            </span>
            <span class="config-ia-atalho-seta">›</span>
          </button>

        <div class="config-uso-ia" id="usoIaConfig">
          <div class="config-uso-ia-topo">
            <span class="config-uso-ia-titulo">Consumo de IA</span>
            <span class="config-uso-ia-dia" id="dataUsoGroq">Hoje</span>
          </div>

          <div class="config-uso-periodo-contexto">
            <div class="config-uso-periodos" role="group" aria-label="Período do consumo de IA">
              <button class="config-uso-periodo-btn" type="button" data-periodo-uso="hora">Hora</button>
              <button class="config-uso-periodo-btn ativo" type="button" data-periodo-uso="dia">Dia</button>
              <button class="config-uso-periodo-btn" type="button" data-periodo-uso="semana">Semana</button>
              <button class="config-uso-periodo-btn" type="button" data-periodo-uso="mes">Mês</button>
            </div>
            <span class="config-uso-periodo-legenda" id="legendaPeriodoUsoGroq">Hoje, desde 00:00</span>
          </div>

          <div class="config-uso-ia-conteudo" id="conteudoUsoGroqAnimado">
            <div class="config-uso-ia-grid config-uso-ia-resumo-grid">
              <div class="config-uso-ia-item">
                <span class="config-uso-ia-label">Total WhatsIAPP</span>
                <span class="config-uso-ia-valor config-uso-numero-animando" id="usoGroqTotal">0</span>
              </div>

              <div class="config-uso-ia-item">
                <span class="config-uso-ia-label">Requisições totais</span>
                <span class="config-uso-ia-valor config-uso-numero-animando" id="usoGroqChamadas">0</span>
              </div>
            </div>

            <div class="config-uso-modelos">
              <div class="config-uso-modelo-card">
                <div class="config-uso-modelo-topo">
                  <div>
                    <strong>GPT-OSS 120B</strong>
                    <span>Respostas e formulação</span>
                  </div>
                  <span class="config-uso-modelo-badge" id="usoGroqGptOssBadge">Free: 200K/dia</span>
                </div>
                <div class="config-uso-modelo-valor">
                  <span class="config-uso-numero-animando" id="usoGroqGptOssTotal">0</span><span id="usoGroqGptOssReferencia"> / <span id="usoGroqGptOssLimite">200.000</span></span>
                </div>
                <div class="config-uso-modelo-barra" id="usoGroqGptOssBarraContainer">
                  <span id="usoGroqGptOssBarra"></span>
                </div>
                <div class="config-uso-modelo-meta" id="usoGroqGptOssMeta">
                  <span id="usoGroqGptOssPercentual">0%</span><span id="usoGroqGptOssMetaSeparador"> da referência diária • </span><span class="config-uso-numero-animando" id="usoGroqGptOssChamadas">0</span><span id="usoGroqGptOssMetaFinal"> requisições</span>
                </div>
              </div>

              <div class="config-uso-modelo-card">
                <div class="config-uso-modelo-topo">
                  <div>
                    <strong>Compound Mini</strong>
                    <span>Pesquisa web</span>
                  </div>
                  <span class="config-uso-modelo-badge" id="usoGroqCompoundBadge">Free: 250 req/dia</span>
                </div>
                <div class="config-uso-modelo-valor">
                  <span class="config-uso-numero-animando" id="usoGroqCompoundTotal">0</span> tokens
                </div>
                <div class="config-uso-modelo-barra" id="usoGroqCompoundBarraContainer">
                  <span id="usoGroqCompoundBarra"></span>
                </div>
                <div class="config-uso-modelo-meta" id="usoGroqCompoundMeta">
                  <span class="config-uso-numero-animando" id="usoGroqCompoundChamadas">0</span><span id="usoGroqCompoundMetaSufixo"> / <span id="usoGroqCompoundLimiteChamadas">250</span> requisições • referência diária</span>
                </div>
              </div>
            </div>

            <div class="config-uso-nao-classificado" id="usoGroqNaoClassificado" hidden>
              <strong>Uso anterior à separação por modelo</strong>
              <span id="usoGroqNaoClassificadoTexto"></span>
            </div>

            <div class="config-uso-periodo-aviso" id="usoGroqPeriodoAviso" hidden></div>

            <div class="config-uso-ia-detalhes">
              Entrada: <span class="config-uso-numero-animando" id="usoGroqEntrada">0</span> •
              Saída: <span class="config-uso-numero-animando" id="usoGroqSaida">0</span>
            </div>

            <div class="config-uso-ia-rodape">
              Última chamada no período: <span id="ultimaChamadaGroq">-</span><br>
              Os dados diários ficam preservados por até 45 dias. A visão Hora considera os últimos 60 minutos e passa a ser exata a partir desta atualização.
            </div>
          </div>
        </div>
        </div>

        <div class="config-app-divisor config-app-divisor-compacto"></div>

        <div class="config-app-secao-titulo">Catálogo</div>

        <div class="config-app-lista-atalhos">
          <button
            id="abrirCatalogoConfig"
            class="config-ia-atalho"
            type="button"
          >
            <span class="config-ia-atalho-texto">
              <span class="config-ia-atalho-titulo">Configurações do Catálogo</span>
              <span id="resumoCatalogoConfig">Carregando catálogo...</span>
            </span>
            <span class="config-ia-atalho-seta">›</span>
          </button>
        </div>

        <div class="config-app-divisor config-app-divisor-compacto"></div>

        <div class="config-app-secao-titulo">Privacidade</div>

        <p class="config-app-secao-desc config-app-secao-desc-compacta">
          Altere o código usado para acessar e gerenciar as conversas trancadas.
        </p>

        <div class="config-app-lista-atalhos">
          <button
            id="trocarSenhaTrancadasConfig"
            class="config-ia-atalho"
            type="button"
          >
            <span class="config-ia-atalho-texto">
              <span class="config-ia-atalho-titulo">🔐 Conversas trancadas</span>
              <span id="statusSenhaTrancadasConfig">Senha configurada</span>
            </span>
            <span class="config-ia-atalho-seta">›</span>
          </button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(overlayConfiguracoesApp);
  const overlayCatalogoConfig = document.createElement("div");
  overlayCatalogoConfig.id = "overlayCatalogoConfig";
  overlayCatalogoConfig.className = "overlay-config-secundaria";
  overlayCatalogoConfig.innerHTML = `
    <section
      id="painelCatalogoConfig"
      class="painel-config-secundaria painel-config-catalogo"
      role="dialog"
      aria-modal="true"
      aria-label="Configurações do Catálogo"
    >
      <div class="config-secundaria-topo">
        <div>
          <div class="config-secundaria-titulo">Configurações do Catálogo</div>
          <div class="config-secundaria-subtitulo">Gerencie o PDF usado como fonte local de informações da empresa.</div>
        </div>
        <button id="fecharCatalogoConfig" class="config-secundaria-fechar" type="button" aria-label="Fechar">×</button>
      </div>

      <div class="config-secundaria-corpo">
        <div class="config-catalogo-card" id="catalogoConfigCard">
          <div class="config-catalogo-limite" id="catalogoConfigLimite">
            <span id="catalogoConfigPlano">Plano</span>
            <strong id="catalogoConfigLimiteTexto">Carregando limites...</strong>
          </div>

          <div class="config-catalogo-vazio" id="catalogoConfigVazio">
            <div class="config-catalogo-vazio-icone" aria-hidden="true">PDF</div>
            <div class="config-catalogo-vazio-texto">
              <strong>Nenhum catálogo ativo</strong>
              <span>Selecione um arquivo PDF para começar.</span>
            </div>
          </div>

          <div class="config-catalogo-ativo" id="catalogoConfigAtivo" hidden>
            <div class="config-catalogo-arquivo">
              <div class="config-catalogo-arquivo-icone" aria-hidden="true">PDF</div>
              <div class="config-catalogo-arquivo-info">
                <strong id="catalogoConfigNome">Catálogo.pdf</strong>
                <span id="catalogoConfigMeta"></span>
              </div>
              <span class="config-catalogo-status" id="catalogoConfigStatus">Aguardando processamento</span>
            </div>
          </div>

          <div class="config-catalogo-acoes">
            <button id="selecionarCatalogoPdf" class="config-catalogo-btn primario" type="button">
              Adicionar PDF
            </button>
            <button id="removerCatalogoPdf" class="config-catalogo-btn perigo" type="button" hidden>
              Remover
            </button>
          </div>

          <div id="statusCatalogoConfig" class="config-catalogo-mensagem"></div>

          <div id="catalogoBuscaTeste" class="config-catalogo-busca" hidden>
            <div class="config-catalogo-busca-cabecalho">
              <strong>Testar busca local</strong>
              <span>Consulta somente o índice deste PDF, sem usar IA.</span>
            </div>

            <div class="config-catalogo-busca-linha">
              <input
                id="catalogoBuscaTesteInput"
                type="text"
                maxlength="300"
                autocomplete="off"
                placeholder="Digite qualquer termo, frase, código ou informação do PDF"
              >
              <button id="catalogoBuscaTesteBotao" class="config-catalogo-btn" type="button">
                Buscar
              </button>
            </div>

            <div id="catalogoBuscaTesteStatus" class="config-catalogo-busca-status"></div>
            <div id="catalogoBuscaTesteResultados" class="config-catalogo-busca-resultados" hidden></div>
          </div>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(overlayCatalogoConfig);
  const overlayConfiguracoesIA = document.createElement("div");
  overlayConfiguracoesIA.id = "overlayConfiguracoesIA";
  overlayConfiguracoesIA.innerHTML = `
    <section
      id="painelConfiguracoesIA"
      role="dialog"
      aria-modal="true"
      aria-label="Configurações de IA"
    >
      <div class="config-ia-modal-topo">
        <div>
          <div class="config-ia-modal-titulo">Configurações de IA</div>
          <div id="planoAtualConfiguracoesIA" class="config-ia-plano-atual">Plano Premium</div>
        </div>
        <button id="fecharConfiguracoesIA" type="button" aria-label="Fechar">×</button>
      </div>

      <div class="config-ia-modal-corpo">
        <div class="config-ia-modal-secao" id="secaoPesquisaWebIA">
          <div class="config-ia-modal-secao-titulo">Pesquisa na internet</div>
          <p class="config-ia-modal-secao-desc" id="descricaoPesquisaWebIA">
            Quando disponível no plano, você decide se o WhatsIAPP pode pesquisar informações atuais sob demanda.
          </p>

          <label class="config-web-toggle" id="togglePesquisaWebIA">
            <span class="config-web-toggle-texto">
              <strong>Permitir pesquisa sob demanda</strong>
              <span id="textoPesquisaWebIA">O WhatsIAPP só pesquisa quando a mensagem realmente precisar de informação atual.</span>
            </span>

            <input id="pesquisaWebAtivaIA" type="checkbox">
            <span class="config-web-toggle-switch" aria-hidden="true"></span>
          </label>
        </div>

        <div class="config-ia-modal-secao">
          <div class="config-ia-modal-secao-titulo">Nível de contexto</div>
          <p class="config-ia-modal-secao-desc" id="descricaoNivelContextoPlanoIA">
            Os seis níveis são exibidos abaixo. Os níveis não incluídos no seu plano ficam bloqueados.
          </p>

          <div class="config-contexto-grid" id="opcoesNivelContextoIA">
            ${Object.values(NIVEIS_CONTEXTO_IA)
              .map(
                (nivel) => `
                  <button
                    class="config-contexto-opcao"
                    type="button"
                    data-nivel-contexto="${nivel.id}"
                  >
                    <strong>${nivel.nome}</strong>
                    <span>até ${nivel.mensagens} mensagens</span>
                  </button>
                `,
              )
              .join("")}
          </div>

          <div class="config-contexto-detalhes">
            <div class="config-contexto-detalhes-topo">
              <span id="contextoNomeSelecionado">Mínimo</span>
              <span id="contextoConsumoSelecionado">Consumo muito baixo</span>
            </div>

            <p id="contextoDescricaoSelecionado"></p>

            <div class="config-contexto-metricas">
              <div class="config-contexto-metrica">
                <span>Histórico máximo</span>
                <strong id="contextoMensagensSelecionado">15 mensagens</strong>
              </div>

              <div class="config-contexto-metrica">
                <span>Personalização máxima</span>
                <strong id="contextoPromptSelecionado">3.000 caracteres</strong>
              </div>

              <div class="config-contexto-metrica">
                <span>Limite de contexto da IA</span>
                <strong id="contextoTokensSelecionado">2.000 tokens</strong>
              </div>
            </div>
          </div>
        </div>

        <div class="config-ia-modal-secao">
          <div class="config-ia-modal-secao-titulo">Personalização</div>
          <p class="config-ia-modal-secao-desc">
            Adicione personalidade, preferências, tom e regras próprias. Este texto é somado ao Motor interno do WhatsIAPP e respeita o limite do nível escolhido.
          </p>

          <button id="abrirPromptPersonalizadoIA" class="config-prompt-resumo" type="button">
            <span class="config-prompt-resumo-texto">
              <span class="config-prompt-resumo-titulo">Prompt personalizado</span>
              <span id="statusPromptPersonalizadoIA">Nenhuma personalização configurada</span>
            </span>
            <span class="config-prompt-resumo-acao">Editar</span>
          </button>
        </div>

        <!-- Compatibilidade interna: controles técnicos não são exibidos ao cliente. -->
        <div hidden aria-hidden="true">
          <input id="chaveApiGroq" type="password">
          <button id="salvarChaveGroq" type="button"></button>
          <button id="removerChaveGroq" type="button"></button>
          <div id="statusChaveGroq"></div>
          <button id="abrirPromptInternoIA" type="button"><span class="config-prompt-resumo-acao"></span></button>
          <span id="statusPromptInternoIA"></span>
        </div>

        <div id="statusSalvarConfiguracoesIA"></div>

        <div class="config-ia-modal-acoes">
          <button id="cancelarConfiguracoesIA" class="config-ia-modal-btn" type="button">Cancelar</button>
          <button id="salvarConfiguracoesIA" class="config-ia-modal-btn" type="button">Salvar configurações</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(overlayConfiguracoesIA);
  const overlayPromptBaseIA = document.createElement("div");
  overlayPromptBaseIA.id = "overlayPromptBaseIA";
  overlayPromptBaseIA.innerHTML = `
    <section
      id="painelPromptBaseIA"
      role="dialog"
      aria-modal="true"
      aria-label="Editar prompt da IA"
    >
      <div class="prompt-modal-topo">
        <div class="prompt-modal-titulo" id="tituloEditorPromptIA">Prompt da IA</div>
        <button id="fecharPromptBaseIA" type="button" aria-label="Fechar">×</button>
      </div>

      <div class="prompt-modal-corpo">
        <p class="prompt-modal-desc" id="descricaoEditorPromptIA">
          Edite o prompt da IA.
        </p>

        <textarea
          id="promptBaseIA"
          spellcheck="true"
          placeholder="Cole ou escreva o prompt..."
        ></textarea>

        <div class="config-app-meta">
          <span id="statusSalvarPrompt"></span>
          <span id="contadorPromptBase">0 caracteres</span>
        </div>

        <div class="prompt-modal-acoes">
          <button id="cancelarPromptBaseIA" class="prompt-modal-btn" type="button">Cancelar</button>
          <button id="salvarPromptBaseIA" class="prompt-modal-btn" type="button">Salvar prompt</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(overlayPromptBaseIA);
  const painelConfiguracoesApp = overlayConfiguracoesApp.querySelector(
    "#painelConfiguracoesApp",
  );
  const botaoAbrirConfiguracoesIA = overlayConfiguracoesApp.querySelector(
    "#abrirConfiguracoesIA",
  );
  const resumoConfiguracoesIA = overlayConfiguracoesApp.querySelector(
    "#resumoConfiguracoesIA",
  );
  const resumoConsumoIA =
    overlayConfiguracoesApp.querySelector("#resumoConsumoIA");
  const botaoAbrirCatalogoConfig = overlayConfiguracoesApp.querySelector(
    "#abrirCatalogoConfig",
  );
  const resumoCatalogoConfig = overlayConfiguracoesApp.querySelector(
    "#resumoCatalogoConfig",
  );
  const fecharCatalogoConfig = overlayCatalogoConfig.querySelector(
    "#fecharCatalogoConfig",
  );
  const campoChaveApiGroq =
    overlayConfiguracoesIA.querySelector("#chaveApiGroq");
  const botaoSalvarChaveGroq =
    overlayConfiguracoesIA.querySelector("#salvarChaveGroq");
  const botaoRemoverChaveGroq =
    overlayConfiguracoesIA.querySelector("#removerChaveGroq");
  const statusChaveGroq =
    overlayConfiguracoesIA.querySelector("#statusChaveGroq");
  const campoPesquisaWebAtivaIA = overlayConfiguracoesIA.querySelector(
    "#pesquisaWebAtivaIA",
  );
  const planoAtualConfiguracoesIA = overlayConfiguracoesIA.querySelector(
    "#planoAtualConfiguracoesIA",
  );
  const descricaoPesquisaWebIA = overlayConfiguracoesIA.querySelector(
    "#descricaoPesquisaWebIA",
  );
  const textoPesquisaWebIA = overlayConfiguracoesIA.querySelector(
    "#textoPesquisaWebIA",
  );
  const togglePesquisaWebIA = overlayConfiguracoesIA.querySelector(
    "#togglePesquisaWebIA",
  );
  const descricaoNivelContextoPlanoIA = overlayConfiguracoesIA.querySelector(
    "#descricaoNivelContextoPlanoIA",
  );
  const botaoAbrirPromptInternoIA = overlayConfiguracoesIA.querySelector(
    "#abrirPromptInternoIA",
  );
  const botaoAbrirPromptPersonalizadoIA = overlayConfiguracoesIA.querySelector(
    "#abrirPromptPersonalizadoIA",
  );
  const statusPromptInternoIA = overlayConfiguracoesIA.querySelector(
    "#statusPromptInternoIA",
  );
  const statusPromptPersonalizadoIA = overlayConfiguracoesIA.querySelector(
    "#statusPromptPersonalizadoIA",
  );
  const fecharConfiguracoesIA = overlayConfiguracoesIA.querySelector(
    "#fecharConfiguracoesIA",
  );
  const cancelarConfiguracoesIA = overlayConfiguracoesIA.querySelector(
    "#cancelarConfiguracoesIA",
  );
  const salvarConfiguracoesIA = overlayConfiguracoesIA.querySelector(
    "#salvarConfiguracoesIA",
  );
  const statusSalvarConfiguracoesIA = overlayConfiguracoesIA.querySelector(
    "#statusSalvarConfiguracoesIA",
  );
  const opcoesNivelContextoIA = Array.from(
    overlayConfiguracoesIA.querySelectorAll("[data-nivel-contexto]"),
  );
  const contextoNomeSelecionado = overlayConfiguracoesIA.querySelector(
    "#contextoNomeSelecionado",
  );
  const contextoConsumoSelecionado = overlayConfiguracoesIA.querySelector(
    "#contextoConsumoSelecionado",
  );
  const contextoDescricaoSelecionado = overlayConfiguracoesIA.querySelector(
    "#contextoDescricaoSelecionado",
  );
  const contextoMensagensSelecionado = overlayConfiguracoesIA.querySelector(
    "#contextoMensagensSelecionado",
  );
  const contextoPromptSelecionado = overlayConfiguracoesIA.querySelector(
    "#contextoPromptSelecionado",
  );
  const contextoTokensSelecionado = overlayConfiguracoesIA.querySelector(
    "#contextoTokensSelecionado",
  );
  const usoGroqChamadas =
    overlayConfiguracoesApp.querySelector("#usoGroqChamadas");
  const usoGroqEntrada =
    overlayConfiguracoesApp.querySelector("#usoGroqEntrada");
  const usoGroqSaida = overlayConfiguracoesApp.querySelector("#usoGroqSaida");
  const usoGroqTotal = overlayConfiguracoesApp.querySelector("#usoGroqTotal");
  const usoGroqGptOssTotal = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssTotal",
  );
  const usoGroqGptOssLimite = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssLimite",
  );
  const usoGroqGptOssReferencia = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssReferencia",
  );
  const usoGroqGptOssBadge = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssBadge",
  );
  const usoGroqGptOssChamadas = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssChamadas",
  );
  const usoGroqGptOssPercentual = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssPercentual",
  );
  const usoGroqGptOssMetaSeparador = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssMetaSeparador",
  );
  const usoGroqGptOssMetaFinal = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssMetaFinal",
  );
  const usoGroqGptOssBarra = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssBarra",
  );
  const usoGroqGptOssBarraContainer = overlayConfiguracoesApp.querySelector(
    "#usoGroqGptOssBarraContainer",
  );
  const usoGroqCompoundTotal = overlayConfiguracoesApp.querySelector(
    "#usoGroqCompoundTotal",
  );
  const usoGroqCompoundChamadas = overlayConfiguracoesApp.querySelector(
    "#usoGroqCompoundChamadas",
  );
  const usoGroqCompoundLimiteChamadas = overlayConfiguracoesApp.querySelector(
    "#usoGroqCompoundLimiteChamadas",
  );
  const usoGroqCompoundMetaSufixo = overlayConfiguracoesApp.querySelector(
    "#usoGroqCompoundMetaSufixo",
  );
  const usoGroqCompoundBadge = overlayConfiguracoesApp.querySelector(
    "#usoGroqCompoundBadge",
  );
  const usoGroqCompoundBarra = overlayConfiguracoesApp.querySelector(
    "#usoGroqCompoundBarra",
  );
  const usoGroqCompoundBarraContainer = overlayConfiguracoesApp.querySelector(
    "#usoGroqCompoundBarraContainer",
  );
  const usoGroqNaoClassificado = overlayConfiguracoesApp.querySelector(
    "#usoGroqNaoClassificado",
  );
  const usoGroqNaoClassificadoTexto = overlayConfiguracoesApp.querySelector(
    "#usoGroqNaoClassificadoTexto",
  );
  const usoGroqPeriodoAviso = overlayConfiguracoesApp.querySelector(
    "#usoGroqPeriodoAviso",
  );
  const conteudoUsoGroqAnimado = overlayConfiguracoesApp.querySelector(
    "#conteudoUsoGroqAnimado",
  );
  const legendaPeriodoUsoGroq = overlayConfiguracoesApp.querySelector(
    "#legendaPeriodoUsoGroq",
  );
  const botoesPeriodoUsoGroq = Array.from(
    overlayConfiguracoesApp.querySelectorAll("[data-periodo-uso]"),
  );
  const ultimaChamadaGroq =
    overlayConfiguracoesApp.querySelector("#ultimaChamadaGroq");
  const dataUsoGroq = overlayConfiguracoesApp.querySelector("#dataUsoGroq");
  const campoPromptBaseIA = overlayPromptBaseIA.querySelector("#promptBaseIA");
  const tituloEditorPromptIA = overlayPromptBaseIA.querySelector(
    "#tituloEditorPromptIA",
  );
  const descricaoEditorPromptIA = overlayPromptBaseIA.querySelector(
    "#descricaoEditorPromptIA",
  );
  const contadorPromptBase = overlayPromptBaseIA.querySelector(
    "#contadorPromptBase",
  );
  const statusSalvarPrompt = overlayPromptBaseIA.querySelector(
    "#statusSalvarPrompt",
  );
  const fecharPromptBaseIA = overlayPromptBaseIA.querySelector(
    "#fecharPromptBaseIA",
  );
  const cancelarPromptBaseIA = overlayPromptBaseIA.querySelector(
    "#cancelarPromptBaseIA",
  );
  const botaoSalvarPromptBaseIA = overlayPromptBaseIA.querySelector(
    "#salvarPromptBaseIA",
  );
  const fecharConfiguracoesApp = overlayConfiguracoesApp.querySelector(
    "#fecharConfiguracoesApp",
  );
  const botaoTrocarSenhaTrancadasConfig = overlayConfiguracoesApp.querySelector(
    "#trocarSenhaTrancadasConfig",
  );
  const statusSenhaTrancadasConfig = overlayConfiguracoesApp.querySelector(
    "#statusSenhaTrancadasConfig",
  );
  const catalogoConfigLimite = overlayCatalogoConfig.querySelector(
    "#catalogoConfigLimite",
  );
  const catalogoConfigPlano = overlayCatalogoConfig.querySelector(
    "#catalogoConfigPlano",
  );
  const catalogoConfigLimiteTexto = overlayCatalogoConfig.querySelector(
    "#catalogoConfigLimiteTexto",
  );
  const catalogoConfigVazio = overlayCatalogoConfig.querySelector(
    "#catalogoConfigVazio",
  );
  const catalogoConfigAtivo = overlayCatalogoConfig.querySelector(
    "#catalogoConfigAtivo",
  );
  const catalogoConfigNome = overlayCatalogoConfig.querySelector(
    "#catalogoConfigNome",
  );
  const catalogoConfigMeta = overlayCatalogoConfig.querySelector(
    "#catalogoConfigMeta",
  );
  const catalogoConfigStatus = overlayCatalogoConfig.querySelector(
    "#catalogoConfigStatus",
  );
  const botaoSelecionarCatalogoPdf = overlayCatalogoConfig.querySelector(
    "#selecionarCatalogoPdf",
  );
  const botaoRemoverCatalogoPdf = overlayCatalogoConfig.querySelector(
    "#removerCatalogoPdf",
  );
  const statusCatalogoConfig = overlayCatalogoConfig.querySelector(
    "#statusCatalogoConfig",
  );
  const catalogoBuscaTeste = overlayCatalogoConfig.querySelector(
    "#catalogoBuscaTeste",
  );
  const catalogoBuscaTesteInput = overlayCatalogoConfig.querySelector(
    "#catalogoBuscaTesteInput",
  );
  const catalogoBuscaTesteBotao = overlayCatalogoConfig.querySelector(
    "#catalogoBuscaTesteBotao",
  );
  const catalogoBuscaTesteStatus = overlayCatalogoConfig.querySelector(
    "#catalogoBuscaTesteStatus",
  );
  const catalogoBuscaTesteResultados = overlayCatalogoConfig.querySelector(
    "#catalogoBuscaTesteResultados",
  );
  function formatarTamanhoArquivoCatalogo(bytes) {
    const total = Math.max(0, Number(bytes || 0) || 0);
    if (total < 1024) {
      return `${total} B`;
    }
    if (total < 1024 * 1024) {
      return `${(total / 1024).toLocaleString("pt-BR", {
        maximumFractionDigits: 1,
      })} KB`;
    }
    return `${(total / (1024 * 1024)).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })} MB`;
  }
  function textoStatusCatalogo(status) {
    if (status === "processado") return "Catálogo pronto";
    if (status === "processando") return "Processando";
    if (status === "erro") return "Erro no processamento";
    if (status === "fora_limite_plano") return "Fora do limite do plano";
    return "Aguardando processamento";
  }
  function renderizarLimitesCatalogoConfig(limites = null) {
    const nomePlano = String(limites?.nomePlano || "Plano").trim() || "Plano";
    const maxPaginas = Math.max(0, Number(limites?.maxPaginas || 0) || 0);
    const maxBytes = Math.max(0, Number(limites?.maxBytes || 0) || 0);
    catalogoConfigPlano.textContent = `Plano ${nomePlano}`;
    if (!maxPaginas || !maxBytes) {
      catalogoConfigLimiteTexto.textContent = "Limites indisponíveis";
      return;
    }
    catalogoConfigLimiteTexto.textContent = `Até ${maxPaginas} páginas • ${formatarTamanhoArquivoCatalogo(maxBytes)}`;
  }
  function limparBuscaCatalogoTeste() {
    catalogoBuscaTesteStatus.textContent = "";
    catalogoBuscaTesteResultados.textContent = "";
    catalogoBuscaTesteResultados.hidden = true;
  }
  function renderizarCatalogoConfig(catalogo = null) {
    const ativo = !!catalogo?.ativo;
    const buscaDisponivel =
      ativo &&
      String(catalogo?.status || "") === "processado" &&
      catalogo?.disponivelPlano !== false;
    catalogoConfigVazio.hidden = ativo;
    catalogoConfigAtivo.hidden = !ativo;
    catalogoBuscaTeste.hidden = !buscaDisponivel;
    botaoRemoverCatalogoPdf.hidden = !ativo;
    if (!buscaDisponivel) {
      limparBuscaCatalogoTeste();
    }
    botaoSelecionarCatalogoPdf.textContent = ativo
      ? "Substituir PDF"
      : "Adicionar PDF";
    if (!ativo) {
      if (resumoCatalogoConfig) {
        resumoCatalogoConfig.textContent = "Nenhum catálogo ativo";
      }
      catalogoConfigNome.textContent = "";
      catalogoConfigMeta.textContent = "";
      catalogoConfigStatus.textContent = "Aguardando processamento";
      catalogoConfigStatus.className = "config-catalogo-status";
      return;
    }
    catalogoConfigNome.textContent = catalogo.nomeOriginal || "Catálogo.pdf";
    const partesMeta = [];
    if (Number(catalogo.paginas || 0) > 0) {
      partesMeta.push(
        `${Number(catalogo.paginas)} ${Number(catalogo.paginas) === 1 ? "página" : "páginas"}`,
      );
    }
    partesMeta.push(formatarTamanhoArquivoCatalogo(catalogo.tamanhoBytes));
    if (Number(catalogo.blocosIndexados || 0) > 0) {
      partesMeta.push(
        `${Number(catalogo.blocosIndexados)} ${Number(catalogo.blocosIndexados) === 1 ? "bloco indexado" : "blocos indexados"}`,
      );
    }
    const salvoEm = Number(catalogo.salvoEm || 0) || 0;
    if (salvoEm) {
      partesMeta.push(
        `adicionado em ${new Date(salvoEm).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}`,
      );
    }
    catalogoConfigMeta.textContent = partesMeta.join(" • ");
    const status = String(catalogo.status || "aguardando_processamento");
    catalogoConfigStatus.textContent = textoStatusCatalogo(status);
    catalogoConfigStatus.className = `config-catalogo-status status-${status}`;
    if (resumoCatalogoConfig) {
      const paginasResumo = Math.max(0, Number(catalogo.paginas || 0) || 0);
      const rotulosResumo = {
        processado: "Catálogo pronto",
        processando: "Processando catálogo",
        erro: "Catálogo com erro",
        fora_limite_plano: "Fora do limite do plano",
        aguardando_processamento: "Aguardando processamento",
      };
      const baseResumo = rotulosResumo[status] || "Catálogo ativo";
      resumoCatalogoConfig.textContent = paginasResumo
        ? `${baseResumo} • ${paginasResumo} ${paginasResumo === 1 ? "página" : "páginas"}`
        : baseResumo;
    }
  }
  async function carregarStatusCatalogoCliente() {
    statusCatalogoConfig.textContent = "";
    statusCatalogoConfig.className = "config-catalogo-mensagem";
    try {
      const resultado = await ipcRenderer.invoke("catalogo-status");
      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível consultar o catálogo.",
        );
      }
      renderizarLimitesCatalogoConfig(resultado.limites || null);
      renderizarCatalogoConfig(resultado.catalogo || null);
      if (resultado.catalogo?.disponivelPlano === false) {
        statusCatalogoConfig.textContent = `Este catálogo excede o plano atual: ${resultado.catalogo.motivoBloqueioPlano || "limite excedido"}. Substitua o PDF para voltar a utilizá-lo.`;
        statusCatalogoConfig.className = "config-catalogo-mensagem alerta";
      } else if (resultado.catalogo?.status === "erro") {
        statusCatalogoConfig.textContent =
          resultado.catalogo.erroProcessamento ||
          "Não foi possível processar este catálogo.";
        statusCatalogoConfig.className = "config-catalogo-mensagem erro";
      } else if (resultado.catalogo?.status === "processado") {
        const blocos = Math.max(
          0,
          Number(resultado.catalogo.blocosIndexados || 0) || 0,
        );
        statusCatalogoConfig.textContent =
          blocos > 0
            ? `Catálogo processado e indexado localmente em ${blocos} ${blocos === 1 ? "bloco" : "blocos"}.`
            : "Catálogo processado e pronto para consulta local.";
        statusCatalogoConfig.className = "config-catalogo-mensagem ok";
      }
    } catch (erro) {
      renderizarCatalogoConfig(null);
      statusCatalogoConfig.textContent =
        erro?.message || "Não foi possível consultar o catálogo.";
      statusCatalogoConfig.className = "config-catalogo-mensagem erro";
    }
  }
  async function selecionarCatalogoPdfCliente() {
    botaoSelecionarCatalogoPdf.disabled = true;
    botaoRemoverCatalogoPdf.disabled = true;
    statusCatalogoConfig.textContent = "Selecionando e processando catálogo...";
    statusCatalogoConfig.className = "config-catalogo-mensagem";
    try {
      const resultado = await ipcRenderer.invoke("catalogo-selecionar-pdf");
      if (resultado?.cancelado) {
        statusCatalogoConfig.textContent = "";
        return;
      }
      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível salvar o catálogo.",
        );
      }
      renderizarLimitesCatalogoConfig(resultado.limites || null);
      renderizarCatalogoConfig(resultado.catalogo || null);
      if (resultado.catalogo?.status === "erro") {
        statusCatalogoConfig.textContent =
          resultado.catalogo.erroProcessamento ||
          resultado.processamento?.erro ||
          "O PDF foi salvo, mas não foi possível processar o conteúdo.";
        statusCatalogoConfig.className = "config-catalogo-mensagem erro";
      } else {
        const blocos = Math.max(
          0,
          Number(resultado.catalogo?.blocosIndexados || 0) || 0,
        );
        statusCatalogoConfig.textContent =
          blocos > 0
            ? `PDF aceito, processado e indexado em ${blocos} ${blocos === 1 ? "bloco" : "blocos"}.`
            : "PDF aceito e processado.";
        statusCatalogoConfig.className = "config-catalogo-mensagem ok";
      }
    } catch (erro) {
      statusCatalogoConfig.textContent =
        erro?.message || "Não foi possível salvar o catálogo.";
      statusCatalogoConfig.className = "config-catalogo-mensagem erro";
    } finally {
      botaoSelecionarCatalogoPdf.disabled = false;
      botaoRemoverCatalogoPdf.disabled = false;
    }
  }
  function renderizarResultadosBuscaCatalogoTeste(resultado) {
    catalogoBuscaTesteResultados.textContent = "";
    const resultados = Array.isArray(resultado?.resultados)
      ? resultado.resultados
      : [];
    if (!resultados.length) {
      catalogoBuscaTesteResultados.hidden = true;
      catalogoBuscaTesteStatus.textContent =
        "Nenhum trecho do catálogo correspondeu à busca.";
      catalogoBuscaTesteStatus.className = "config-catalogo-busca-status vazio";
      return;
    }
    catalogoBuscaTesteStatus.textContent = `${resultados.length} ${resultados.length === 1 ? "trecho encontrado" : "trechos encontrados"} entre os mais relevantes.`;
    catalogoBuscaTesteStatus.className = "config-catalogo-busca-status ok";
    resultados.forEach((item, indice) => {
      const card = document.createElement("div");
      card.className = "config-catalogo-busca-resultado";
      const topo = document.createElement("div");
      topo.className = "config-catalogo-busca-resultado-topo";
      const posicao = document.createElement("strong");
      posicao.textContent = `Resultado ${indice + 1}`;
      const pagina = document.createElement("span");
      pagina.textContent = `Página ${Math.max(1, Number(item?.pagina || 1) || 1)}`;
      const texto = document.createElement("div");
      texto.className = "config-catalogo-busca-resultado-texto";
      texto.textContent = String(item?.texto || "").trim();
      topo.append(posicao, pagina);
      card.append(topo, texto);
      catalogoBuscaTesteResultados.appendChild(card);
    });
    catalogoBuscaTesteResultados.hidden = false;
  }
  async function executarBuscaCatalogoTeste() {
    const consulta = String(catalogoBuscaTesteInput.value || "").trim();
    if (!consulta) {
      catalogoBuscaTesteInput.focus();
      catalogoBuscaTesteStatus.textContent = "Digite algo para pesquisar.";
      catalogoBuscaTesteStatus.className = "config-catalogo-busca-status erro";
      catalogoBuscaTesteResultados.hidden = true;
      return;
    }
    catalogoBuscaTesteBotao.disabled = true;
    catalogoBuscaTesteInput.disabled = true;
    catalogoBuscaTesteStatus.textContent = "Pesquisando no índice local...";
    catalogoBuscaTesteStatus.className = "config-catalogo-busca-status";
    catalogoBuscaTesteResultados.hidden = true;
    try {
      const resultado = await ipcRenderer.invoke("catalogo-buscar-local", {
        consulta,
        limite: 3,
      });
      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível pesquisar no catálogo.",
        );
      }
      renderizarResultadosBuscaCatalogoTeste(resultado);
    } catch (erro) {
      catalogoBuscaTesteStatus.textContent =
        erro?.message || "Não foi possível pesquisar no catálogo.";
      catalogoBuscaTesteStatus.className = "config-catalogo-busca-status erro";
      catalogoBuscaTesteResultados.textContent = "";
      catalogoBuscaTesteResultados.hidden = true;
    } finally {
      catalogoBuscaTesteBotao.disabled = false;
      catalogoBuscaTesteInput.disabled = false;
    }
  }
  async function removerCatalogoPdfCliente() {
    botaoSelecionarCatalogoPdf.disabled = true;
    botaoRemoverCatalogoPdf.disabled = true;
    statusCatalogoConfig.textContent = "Removendo catálogo...";
    statusCatalogoConfig.className = "config-catalogo-mensagem";
    try {
      const resultado = await ipcRenderer.invoke("catalogo-remover");
      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível remover o catálogo.",
        );
      }
      renderizarCatalogoConfig(null);
      statusCatalogoConfig.textContent = "Catálogo removido.";
      statusCatalogoConfig.className = "config-catalogo-mensagem ok";
    } catch (erro) {
      statusCatalogoConfig.textContent =
        erro?.message || "Não foi possível remover o catálogo.";
      statusCatalogoConfig.className = "config-catalogo-mensagem erro";
    } finally {
      botaoSelecionarCatalogoPdf.disabled = false;
      botaoRemoverCatalogoPdf.disabled = false;
    }
  }
  async function carregarStatusChaveGroqConfig() {
    statusChaveGroq.textContent = "Verificando chave...";
    statusChaveGroq.className = "";
    campoChaveApiGroq.value = "";
    try {
      const resultado = await ipcRenderer.invoke("status-chave-groq");
      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível verificar a chave.",
        );
      }
      if (resultado.armazenamentoSeguro) {
        campoChaveApiGroq.placeholder =
          "••••••••••••••••  chave protegida e salva";
        statusChaveGroq.textContent =
          "Chave configurada e criptografada pelo Windows. Ela não é exibida novamente.";
        statusChaveGroq.className = "ok";
        botaoRemoverChaveGroq.disabled = false;
        return;
      }
      campoChaveApiGroq.placeholder = "Cole sua chave da Groq";
      statusChaveGroq.textContent = "Nenhuma chave da Groq configurada.";
      statusChaveGroq.className = "";
      botaoRemoverChaveGroq.disabled = true;
    } catch (erro) {
      statusChaveGroq.textContent =
        erro?.message || "Erro ao verificar a chave da Groq.";
      statusChaveGroq.className = "erro";
    }
  }
  async function salvarChaveGroqConfig() {
    const apiKey = String(campoChaveApiGroq.value || "").trim();
    if (!apiKey) {
      statusChaveGroq.textContent = "Cole uma chave antes de salvar.";
      statusChaveGroq.className = "erro";
      campoChaveApiGroq.focus();
      return;
    }
    botaoSalvarChaveGroq.disabled = true;
    statusChaveGroq.textContent = "Protegendo e salvando a chave...";
    statusChaveGroq.className = "";
    try {
      const resultado = await ipcRenderer.invoke("salvar-chave-groq", {
        apiKey,
      });
      if (!resultado?.ok) {
        throw new Error(resultado?.erro || "Não foi possível salvar a chave.");
      }
      campoChaveApiGroq.value = "";
      campoChaveApiGroq.placeholder =
        "••••••••••••••••  chave protegida e salva";
      statusChaveGroq.textContent =
        "Chave salva com proteção criptográfica do sistema.";
      statusChaveGroq.className = "ok";
      botaoRemoverChaveGroq.disabled = false;
    } catch (erro) {
      statusChaveGroq.textContent =
        erro?.message || "Erro ao salvar a chave da Groq.";
      statusChaveGroq.className = "erro";
    } finally {
      botaoSalvarChaveGroq.disabled = false;
    }
  }
  async function removerChaveGroqConfig() {
    botaoRemoverChaveGroq.disabled = true;
    try {
      const resultado = await ipcRenderer.invoke("remover-chave-groq");
      if (!resultado?.ok) {
        throw new Error(resultado?.erro || "Não foi possível remover a chave.");
      }
      campoChaveApiGroq.value = "";
      campoChaveApiGroq.placeholder = "Cole sua chave da Groq";
      statusChaveGroq.textContent = "Chave removida.";
      statusChaveGroq.className = "";
    } catch (erro) {
      statusChaveGroq.textContent =
        erro?.message || "Erro ao remover a chave da Groq.";
      statusChaveGroq.className = "erro";
    } finally {
      await carregarStatusChaveGroqConfig();
    }
  }
  function formatarNumeroUsoGroq(valor) {
    return Math.max(0, Number(valor || 0) || 0).toLocaleString("pt-BR");
  }
  let periodoUsoGroqSelecionado = "dia";
  let tokenTrocaPeriodoUsoGroq = 0;
  const animacoesNumerosUsoGroq = new WeakMap();
  function animacaoReduzidaUsoGroq() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }
  function animarNumeroUsoGroq(
    elemento,
    valorFinal,
    { reiniciar = false, duracao = 2000, atraso = 0 } = {},
  ) {
    if (!elemento) {
      return;
    }
    const alvo = Math.max(0, Number(valorFinal || 0) || 0);
    const animacaoAnterior = animacoesNumerosUsoGroq.get(elemento);
    if (animacaoAnterior?.frame) {
      cancelAnimationFrame(animacaoAnterior.frame);
    }
    if (animacaoAnterior?.timer) {
      clearTimeout(animacaoAnterior.timer);
    }
    const textoAtual = String(elemento.textContent || "")
      .replace(/\./g, "")
      .replace(/[^0-9-]/g, "");
    const valorVisualAtual = Number(textoAtual || 0) || 0;
    const anteriorSalvo = Number(elemento.dataset.valorNumerico || 0) || 0;
    const inicioValor = reiniciar
      ? 0
      : Number.isFinite(valorVisualAtual)
        ? valorVisualAtual
        : anteriorSalvo;
    elemento.dataset.valorNumerico = String(alvo);
    elemento.classList.remove("subindo", "descendo");
    if (reiniciar) {
      elemento.textContent = formatarNumeroUsoGroq(0);
    }
    if (duracao <= 0 || inicioValor === alvo) {
      elemento.textContent = formatarNumeroUsoGroq(alvo);
      animacoesNumerosUsoGroq.delete(elemento);
      return;
    }
    const iniciarAnimacao = () => {
      const inicioEm = performance.now();
      const classeDirecao = alvo >= inicioValor ? "subindo" : "descendo";
      elemento.classList.remove("subindo", "descendo");
      void elemento.offsetWidth;
      elemento.classList.add(classeDirecao);
      const passo = (agora) => {
        const progresso = Math.min(1, (agora - inicioEm) / duracao);
        const atual = Math.round(
          inicioValor + (alvo - inicioValor) * progresso,
        );
        elemento.textContent = formatarNumeroUsoGroq(atual);
        if (progresso < 1) {
          const frame = requestAnimationFrame(passo);
          animacoesNumerosUsoGroq.set(elemento, { frame, timer: null });
        } else {
          elemento.textContent = formatarNumeroUsoGroq(alvo);
          elemento.classList.remove("subindo", "descendo");
          animacoesNumerosUsoGroq.delete(elemento);
        }
      };
      const frame = requestAnimationFrame(passo);
      animacoesNumerosUsoGroq.set(elemento, { frame, timer: null });
    };
    if (atraso > 0) {
      const timer = setTimeout(iniciarAnimacao, atraso);
      animacoesNumerosUsoGroq.set(elemento, { frame: null, timer });
    } else {
      iniciarAnimacao();
    }
  }
  function percentualUsoGroq(valor, limite) {
    const usado = Math.max(0, Number(valor || 0) || 0);
    const maximo = Math.max(0, Number(limite || 0) || 0);
    if (!maximo) {
      return 0;
    }
    return (usado / maximo) * 100;
  }
  function atualizarBarraUsoGroq(elemento, percentual, excedido = false) {
    if (!elemento) {
      return;
    }
    const valor = Math.max(0, Number(percentual || 0) || 0);
    elemento.style.width = `${Math.min(100, valor)}%`;
    elemento.classList.toggle("excedido", !!excedido);
  }
  function rotuloPeriodoUsoGroq(periodo) {
    if (periodo === "hora") return "Últimos 60 min";
    if (periodo === "semana") return "Semana atual";
    if (periodo === "mes") return "Mês atual";
    return "Hoje";
  }
  function legendaPeriodoUsoGroqTexto(periodo, uso = {}) {
    if (periodo === "hora") {
      return "Últimos 60 minutos";
    }
    if (periodo === "semana") {
      return "De segunda-feira até agora";
    }
    if (periodo === "mes") {
      const inicio = Number(uso?.inicioEm || 0) || 0;
      const mes = inicio
        ? new Date(inicio).toLocaleDateString("pt-BR", {
            month: "2-digit",
            year: "numeric",
          })
        : "mês atual";
      return `Desde 01/${mes}`;
    }
    return "Hoje, desde 00:00";
  }
  function atualizarSelecaoPeriodoUsoGroq(periodo) {
    for (const botao of botoesPeriodoUsoGroq) {
      const ativo = botao.dataset.periodoUso === periodo;
      botao.classList.toggle("ativo", ativo);
      botao.setAttribute("aria-pressed", ativo ? "true" : "false");
    }
  }
  function atualizarUsoGroqConfig(
    uso = {},
    { reiniciarNumeros = false, atrasoNumeros = 0, duracaoNumeros = 2000 } = {},
  ) {
    const periodo = ["hora", "dia", "semana", "mes"].includes(
      String(uso?.periodo || ""),
    )
      ? String(uso.periodo)
      : periodoUsoGroqSelecionado;
    periodoUsoGroqSelecionado = periodo;
    atualizarSelecaoPeriodoUsoGroq(periodo);
    dataUsoGroq.textContent = rotuloPeriodoUsoGroq(periodo);
    legendaPeriodoUsoGroq.textContent = legendaPeriodoUsoGroqTexto(
      periodo,
      uso,
    );
    if (resumoConsumoIA) {
      resumoConsumoIA.textContent = `${rotuloPeriodoUsoGroq(periodo)} • ${formatarNumeroUsoGroq(uso.totalTokens)} tokens`;
    }
    animarNumeroUsoGroq(usoGroqChamadas, uso.chamadas, {
      reiniciar: reiniciarNumeros,
      atraso: atrasoNumeros,
      duracao: duracaoNumeros,
    });
    animarNumeroUsoGroq(usoGroqEntrada, uso.promptTokens, {
      reiniciar: reiniciarNumeros,
      atraso: atrasoNumeros,
      duracao: duracaoNumeros,
    });
    animarNumeroUsoGroq(usoGroqSaida, uso.completionTokens, {
      reiniciar: reiniciarNumeros,
      atraso: atrasoNumeros,
      duracao: duracaoNumeros,
    });
    animarNumeroUsoGroq(usoGroqTotal, uso.totalTokens, {
      reiniciar: reiniciarNumeros,
      atraso: atrasoNumeros,
      duracao: duracaoNumeros,
    });
    const modelos = uso?.modelos || {};
    const gptOss = modelos?.gptOss120b || {};
    const compound = modelos?.compoundMini || {};
    const naoClassificado = modelos?.naoClassificado || {};
    const referencias = uso?.referenciasFree || {};
    const mostrarReferenciaDiaria = periodo === "dia";
    const limiteGptOss = Math.max(
      1,
      Number(referencias.gptOss120bTokensDia || 200000) || 200000,
    );
    const limiteCompoundChamadas = Math.max(
      1,
      Number(referencias.compoundMiniRequestsDia || 250) || 250,
    );
    const totalGptOss = Math.max(0, Number(gptOss.totalTokens || 0) || 0);
    const chamadasGptOss = Math.max(0, Number(gptOss.chamadas || 0) || 0);
    const percentualGptOss = percentualUsoGroq(totalGptOss, limiteGptOss);
    animarNumeroUsoGroq(usoGroqGptOssTotal, totalGptOss, {
      reiniciar: reiniciarNumeros,
      atraso: atrasoNumeros,
      duracao: duracaoNumeros,
    });
    animarNumeroUsoGroq(usoGroqGptOssChamadas, chamadasGptOss, {
      reiniciar: reiniciarNumeros,
      atraso: atrasoNumeros,
      duracao: duracaoNumeros,
    });
    usoGroqGptOssLimite.textContent = formatarNumeroUsoGroq(limiteGptOss);
    usoGroqGptOssBadge.hidden = !mostrarReferenciaDiaria;
    usoGroqGptOssReferencia.hidden = !mostrarReferenciaDiaria;
    usoGroqGptOssBarraContainer.classList.toggle(
      "oculta",
      !mostrarReferenciaDiaria,
    );
    usoGroqGptOssPercentual.hidden = !mostrarReferenciaDiaria;
    usoGroqGptOssMetaSeparador.hidden = !mostrarReferenciaDiaria;
    usoGroqGptOssMetaFinal.textContent = mostrarReferenciaDiaria
      ? " requisições"
      : " requisições no período";
    usoGroqGptOssPercentual.textContent = `${percentualGptOss.toLocaleString(
      "pt-BR",
      {
        minimumFractionDigits:
          percentualGptOss > 0 && percentualGptOss < 1 ? 1 : 0,
        maximumFractionDigits: 1,
      },
    )}%`;
    atualizarBarraUsoGroq(
      usoGroqGptOssBarra,
      mostrarReferenciaDiaria ? percentualGptOss : 0,
      mostrarReferenciaDiaria && totalGptOss > limiteGptOss,
    );
    const totalCompound = Math.max(0, Number(compound.totalTokens || 0) || 0);
    const chamadasCompound = Math.max(0, Number(compound.chamadas || 0) || 0);
    const percentualCompound = percentualUsoGroq(
      chamadasCompound,
      limiteCompoundChamadas,
    );
    animarNumeroUsoGroq(usoGroqCompoundTotal, totalCompound, {
      reiniciar: reiniciarNumeros,
      atraso: atrasoNumeros,
      duracao: duracaoNumeros,
    });
    animarNumeroUsoGroq(usoGroqCompoundChamadas, chamadasCompound, {
      reiniciar: reiniciarNumeros,
      atraso: atrasoNumeros,
      duracao: duracaoNumeros,
    });
    usoGroqCompoundLimiteChamadas.textContent = formatarNumeroUsoGroq(
      limiteCompoundChamadas,
    );
    usoGroqCompoundBadge.hidden = !mostrarReferenciaDiaria;
    usoGroqCompoundBarraContainer.classList.toggle(
      "oculta",
      !mostrarReferenciaDiaria,
    );
    usoGroqCompoundMetaSufixo.innerHTML = mostrarReferenciaDiaria
      ? ` / <span id="usoGroqCompoundLimiteChamadas">${formatarNumeroUsoGroq(
          limiteCompoundChamadas,
        )}</span> requisições • referência diária`
      : " requisições no período";
    atualizarBarraUsoGroq(
      usoGroqCompoundBarra,
      mostrarReferenciaDiaria ? percentualCompound : 0,
      mostrarReferenciaDiaria && chamadasCompound > limiteCompoundChamadas,
    );
    // O uso legado continua preservado nos dados, mas nao e mais exibido
    // no painel principal para manter as Configuracoes compactas.
    usoGroqNaoClassificado.hidden = true;
    usoGroqNaoClassificadoTexto.textContent = "";
    if (periodo === "hora" && !uso?.horaCompleta) {
      usoGroqPeriodoAviso.hidden = false;
      const desde = Number(uso?.eventosDesde || 0) || 0;
      if (desde) {
        const horario = new Date(desde).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        });
        usoGroqPeriodoAviso.textContent =
          `O detalhamento por hora começou a ser registrado às ${horario}. ` +
          "Até completar 60 minutos, esta visão mostra somente o consumo feito depois da atualização.";
      } else {
        usoGroqPeriodoAviso.textContent =
          "O detalhamento por hora começa a ser registrado na próxima chamada da IA.";
      }
    } else {
      usoGroqPeriodoAviso.hidden = true;
      usoGroqPeriodoAviso.textContent = "";
    }
    const timestamp = Number(uso.ultimaChamadaEm || 0) || 0;
    const status = Number(uso.ultimoStatus || 0) || 0;
    const tokens = Math.max(0, Number(uso.ultimosTokens || 0) || 0);
    if (!timestamp) {
      ultimaChamadaGroq.textContent = "Nenhuma no período";
      return;
    }
    const dataUltima = new Date(timestamp);
    const horario = dataUltima.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const quando =
      periodo === "semana" || periodo === "mes"
        ? `${dataUltima.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
          })} ${horario}`
        : horario;
    if (status >= 200 && status < 300) {
      ultimaChamadaGroq.textContent = `${formatarNumeroUsoGroq(tokens)} tokens • ${quando}`;
    } else {
      ultimaChamadaGroq.textContent = `HTTP ${status || "?"} • ${quando}`;
    }
  }
  async function carregarUsoGroqConfig(
    periodo = periodoUsoGroqSelecionado,
    { reiniciarNumeros = false, atrasoNumeros = 0, duracaoNumeros = 2000 } = {},
  ) {
    try {
      const resultado = await ipcRenderer.invoke("status-uso-groq", periodo);
      if (resultado?.ok) {
        atualizarUsoGroqConfig(resultado.uso || {}, {
          reiniciarNumeros,
          atrasoNumeros,
          duracaoNumeros,
        });
        return true;
      }
    } catch {}
    return false;
  }
  function esperarTransicaoUsoGroq(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function elementosNumericosUsoGroq() {
    return [
      usoGroqTotal,
      usoGroqChamadas,
      usoGroqEntrada,
      usoGroqSaida,
      usoGroqGptOssTotal,
      usoGroqGptOssChamadas,
      usoGroqCompoundTotal,
      usoGroqCompoundChamadas,
    ].filter(Boolean);
  }
  function capturarTextosNumerosUsoGroq() {
    return new Map(
      elementosNumericosUsoGroq().map((elemento) => [
        elemento,
        String(elemento.textContent || "0"),
      ]),
    );
  }
  function cancelarAnimacaoNumeroUsoGroq(elemento) {
    const animacao = animacoesNumerosUsoGroq.get(elemento);
    if (animacao?.frame) {
      cancelAnimationFrame(animacao.frame);
    }
    if (animacao?.timer) {
      clearTimeout(animacao.timer);
    }
    animacoesNumerosUsoGroq.delete(elemento);
    elemento.classList.remove("subindo", "descendo");
  }
  function restaurarTextosNumerosUsoGroq(snapshot) {
    for (const [elemento, texto] of snapshot.entries()) {
      cancelarAnimacaoNumeroUsoGroq(elemento);
      elemento.textContent = texto;
    }
  }
  function animarNumerosUsoGroqAteAlvos(duracao = 2000) {
    for (const elemento of elementosNumericosUsoGroq()) {
      const alvo = Number(elemento.dataset.valorNumerico || 0) || 0;
      animarNumeroUsoGroq(elemento, alvo, {
        reiniciar: false,
        atraso: 0,
        duracao,
      });
    }
  }
  async function fecharConteudoUsoGroq(token) {
    if (!conteudoUsoGroqAnimado || animacaoReduzidaUsoGroq()) {
      return;
    }
    const alturaAtual = Math.max(
      conteudoUsoGroqAnimado.scrollHeight,
      conteudoUsoGroqAnimado.getBoundingClientRect().height,
    );
    conteudoUsoGroqAnimado.style.height = `${alturaAtual}px`;
    conteudoUsoGroqAnimado.style.opacity = "1";
    conteudoUsoGroqAnimado.style.transform = "translateY(0) scale(1)";
    conteudoUsoGroqAnimado.classList.remove("abrindo");
    conteudoUsoGroqAnimado.classList.add("fechando");
    void conteudoUsoGroqAnimado.offsetHeight;
    conteudoUsoGroqAnimado.style.height = "0px";
    conteudoUsoGroqAnimado.style.opacity = "0";
    conteudoUsoGroqAnimado.style.transform = "translateY(-10px) scale(.975)";
    await esperarTransicaoUsoGroq(340);
    if (token !== tokenTrocaPeriodoUsoGroq) {
      return;
    }
  }
  async function abrirConteudoUsoGroq(token) {
    if (!conteudoUsoGroqAnimado) {
      return;
    }
    if (animacaoReduzidaUsoGroq()) {
      conteudoUsoGroqAnimado.classList.remove("fechando", "abrindo");
      conteudoUsoGroqAnimado.style.height = "auto";
      conteudoUsoGroqAnimado.style.opacity = "1";
      conteudoUsoGroqAnimado.style.transform = "none";
      return;
    }
    conteudoUsoGroqAnimado.classList.remove("fechando");
    conteudoUsoGroqAnimado.classList.add("abrindo");
    conteudoUsoGroqAnimado.style.height = "0px";
    conteudoUsoGroqAnimado.style.opacity = "0";
    conteudoUsoGroqAnimado.style.transform = "translateY(-10px) scale(.975)";
    void conteudoUsoGroqAnimado.offsetHeight;
    const alturaDestino = conteudoUsoGroqAnimado.scrollHeight;
    requestAnimationFrame(() => {
      if (token !== tokenTrocaPeriodoUsoGroq) {
        return;
      }
      conteudoUsoGroqAnimado.style.height = `${alturaDestino}px`;
      conteudoUsoGroqAnimado.style.opacity = "1";
      conteudoUsoGroqAnimado.style.transform = "translateY(0) scale(1)";
    });
    await esperarTransicaoUsoGroq(460);
    if (token !== tokenTrocaPeriodoUsoGroq) {
      return;
    }
    conteudoUsoGroqAnimado.classList.remove("abrindo");
    conteudoUsoGroqAnimado.style.height = "auto";
    conteudoUsoGroqAnimado.style.opacity = "1";
    conteudoUsoGroqAnimado.style.transform = "none";
  }
  async function trocarPeriodoUsoGroq(novoPeriodo) {
    const periodo = String(novoPeriodo || "");
    if (
      !["hora", "dia", "semana", "mes"].includes(periodo) ||
      periodo === periodoUsoGroqSelecionado
    ) {
      return;
    }
    const token = ++tokenTrocaPeriodoUsoGroq;
    const numerosAntesDaTroca = capturarTextosNumerosUsoGroq();
    periodoUsoGroqSelecionado = periodo;
    atualizarSelecaoPeriodoUsoGroq(periodo);
    await fecharConteudoUsoGroq(token);
    if (token !== tokenTrocaPeriodoUsoGroq) {
      return;
    }
    // Carrega os novos totais enquanto o painel esta fechado, mas sem gastar
    // a animacao dos numeros escondida. Os novos alvos ficam no dataset.
    const carregou = await carregarUsoGroqConfig(periodo, {
      reiniciarNumeros: false,
      atrasoNumeros: 0,
      duracaoNumeros: 0,
    });
    if (token !== tokenTrocaPeriodoUsoGroq) {
      return;
    }
    if (!carregou) {
      periodoUsoGroqSelecionado = "dia";
      atualizarSelecaoPeriodoUsoGroq("dia");
    }
    // Volta visualmente aos numeros do periodo anterior. O dataset continua
    // contendo os novos alvos e permite contar para cima ou para baixo.
    restaurarTextosNumerosUsoGroq(numerosAntesDaTroca);
    const abertura = abrirConteudoUsoGroq(token);
    // A contagem comeca depois que o painel ja iniciou a abertura, para que
    // seja realmente visivel em vez de acontecer enquanto o bloco esta oculto.
    await esperarTransicaoUsoGroq(90);
    if (token !== tokenTrocaPeriodoUsoGroq) {
      return;
    }
    animarNumerosUsoGroqAteAlvos(2000);
    await abertura;
  }
  for (const botao of botoesPeriodoUsoGroq) {
    botao.addEventListener("click", () => {
      trocarPeriodoUsoGroq(botao.dataset.periodoUso);
    });
  }
  ipcRenderer.on("uso-groq-atualizado", () => {
    carregarUsoGroqConfig(periodoUsoGroqSelecionado, {
      reiniciarNumeros: false,
    });
  });
  function atualizarStatusPromptsIAConfig() {
    const interno = obterPromptInternoIA().trim();
    const personalizado = obterPromptPersonalizadoIA().trim();
    statusPromptInternoIA.textContent = interno
      ? "Configuração interna ativa"
      : "Motor interno não configurado";
    statusPromptInternoIA.className = interno ? "ok" : "erro";
    statusPromptPersonalizadoIA.textContent = personalizado
      ? "Personalização configurada"
      : "Nenhuma personalização configurada";
    statusPromptPersonalizadoIA.className = personalizado ? "ok" : "";
  }
  function atualizarPermissoesConfiguracoesIA() {
    const permitidos = new Set(
      obterConfiguracaoComercialCliente().niveisPermitidos,
    );
    const nomePlano =
      obterConfiguracaoComercialCliente().nomePlano || "Premium";
    if (planoAtualConfiguracoesIA) {
      planoAtualConfiguracoesIA.textContent = `Plano ${nomePlano}`;
    }
    if (descricaoNivelContextoPlanoIA) {
      descricaoNivelContextoPlanoIA.textContent = `Seu plano ${nomePlano} permite ${permitidos.size} de 6 níveis de contexto. Os demais continuam visíveis, mas bloqueados.`;
    }
    opcoesNivelContextoIA.forEach((botao) => {
      const permitido = permitidos.has(botao.dataset.nivelContexto);
      botao.disabled = !permitido;
      botao.classList.toggle("bloqueada-plano", !permitido);
      botao.title = permitido
        ? `Disponível no plano ${nomePlano}`
        : `Não disponível no plano ${nomePlano}`;
    });
    const webPermitida = pesquisaWebPermitidaPeloPlano();
    campoPesquisaWebAtivaIA.disabled = !webPermitida;
    togglePesquisaWebIA?.classList.toggle("bloqueada-plano", !webPermitida);
    if (!webPermitida) {
      pesquisaWebIAPendente = false;
      campoPesquisaWebAtivaIA.checked = false;
      descricaoPesquisaWebIA.textContent = `A pesquisa na internet não está incluída no plano ${nomePlano}.`;
      textoPesquisaWebIA.textContent =
        "Este recurso fica bloqueado e não gera chamadas de pesquisa.";
    } else {
      descricaoPesquisaWebIA.textContent = `A pesquisa na internet está disponível no plano ${nomePlano}. Você decide se deseja deixá-la ligada.`;
      textoPesquisaWebIA.textContent =
        "O WhatsIAPP só pesquisa quando a mensagem realmente precisar de informação atual.";
    }
  }
  let nivelContextoIAPendente = obterNivelContextoIA();
  let pesquisaWebIAPendente = obterPesquisaWebAtivaIA();
  function formatarNumeroConfigIA(valor) {
    return Math.max(0, Number(valor || 0) || 0).toLocaleString("pt-BR");
  }
  function atualizarResumoConfiguracoesIA() {
    const configuracao = obterConfiguracaoNivelContextoIA();
    resumoConfiguracoesIA.textContent = `Contexto ${configuracao.nome.toLowerCase()}`;
  }
  function renderizarNivelContextoIA(nivelId) {
    let idFinal = String(nivelId || "").trim();
    if (!nivelContextoPermitidoPeloPlano(idFinal)) {
      idFinal = nivelFallbackPermitidoPeloPlano();
    }
    const configuracao = obterConfiguracaoNivelContextoIA(idFinal);
    nivelContextoIAPendente = configuracao.id;
    opcoesNivelContextoIA.forEach((botao) => {
      botao.classList.toggle(
        "ativa",
        botao.dataset.nivelContexto === configuracao.id,
      );
    });
    contextoNomeSelecionado.textContent = configuracao.nome;
    contextoConsumoSelecionado.textContent = `Consumo ${configuracao.consumo.toLowerCase()}`;
    contextoDescricaoSelecionado.textContent = configuracao.descricao;
    contextoMensagensSelecionado.textContent = `${formatarNumeroConfigIA(configuracao.mensagens)} mensagens`;
    contextoPromptSelecionado.textContent = `${formatarNumeroConfigIA(configuracao.promptMaximo)} caracteres`;
    contextoTokensSelecionado.textContent = `${formatarNumeroConfigIA(configuracao.tokensContexto)} tokens`;
    if (overlayPromptBaseIA.classList.contains("aberto")) {
      atualizarContadorPromptBase();
    }
  }
  let tipoPromptIAEmEdicao = "personalizado";
  function atualizarContadorPromptBase() {
    const atual = campoPromptBaseIA.value.length;
    if (tipoPromptIAEmEdicao === "interno") {
      contadorPromptBase.textContent = `${formatarNumeroConfigIA(atual)} caracteres • sem limite do plano`;
      botaoSalvarPromptBaseIA.disabled = false;
      statusSalvarPrompt.textContent = "";
      statusSalvarPrompt.className = "";
      return;
    }
    const configuracao = obterConfiguracaoNivelContextoIA(
      nivelContextoIAPendente || obterNivelContextoIA(),
    );
    const excedeu = atual > configuracao.promptMaximo;
    contadorPromptBase.textContent = `${formatarNumeroConfigIA(atual)} / ${formatarNumeroConfigIA(configuracao.promptMaximo)} caracteres`;
    botaoSalvarPromptBaseIA.disabled = excedeu;
    if (excedeu) {
      statusSalvarPrompt.textContent = `O nível ${configuracao.nome} permite até ${formatarNumeroConfigIA(configuracao.promptMaximo)} caracteres de personalização.`;
      statusSalvarPrompt.className = "erro";
    } else if (statusSalvarPrompt.className === "erro") {
      statusSalvarPrompt.textContent = "";
      statusSalvarPrompt.className = "";
    }
  }
  async function abrirConfiguracoesIAConfig() {
    await carregarConfiguracaoComercialCliente();
    nivelContextoIAPendente = obterNivelContextoIA();
    if (!nivelContextoPermitidoPeloPlano(nivelContextoIAPendente)) {
      nivelContextoIAPendente = nivelFallbackPermitidoPeloPlano();
      salvarNivelContextoIA(nivelContextoIAPendente);
    }
    pesquisaWebIAPendente = obterPesquisaWebAtivaIA();
    campoPesquisaWebAtivaIA.checked = pesquisaWebIAPendente;
    statusSalvarConfiguracoesIA.textContent = "";
    statusSalvarConfiguracoesIA.className = "";
    atualizarPermissoesConfiguracoesIA();
    renderizarNivelContextoIA(nivelContextoIAPendente);
    atualizarStatusPromptsIAConfig();
    overlayConfiguracoesIA.classList.add("aberto");
  }
  function fecharConfiguracoesIAConfig() {
    overlayConfiguracoesIA.classList.remove("aberto");
    nivelContextoIAPendente = obterNivelContextoIA();
    pesquisaWebIAPendente = obterPesquisaWebAtivaIA();
    campoPesquisaWebAtivaIA.checked = pesquisaWebIAPendente;
    statusSalvarConfiguracoesIA.textContent = "";
    statusSalvarConfiguracoesIA.className = "";
  }
  function confirmarConfiguracoesIA() {
    const configuracao = obterConfiguracaoNivelContextoIA(
      nivelContextoIAPendente,
    );
    if (!nivelContextoPermitidoPeloPlano(configuracao.id)) {
      statusSalvarConfiguracoesIA.textContent = `O nível ${configuracao.nome} não está disponível no plano ${obterConfiguracaoComercialCliente().nomePlano}.`;
      statusSalvarConfiguracoesIA.className = "erro";
      return;
    }
    const tamanhoPersonalizado = obterPromptPersonalizadoIA().length;
    if (tamanhoPersonalizado > configuracao.promptMaximo) {
      statusSalvarConfiguracoesIA.textContent = `Seu prompt personalizado tem ${formatarNumeroConfigIA(tamanhoPersonalizado)} caracteres e o nível ${configuracao.nome} permite até ${formatarNumeroConfigIA(configuracao.promptMaximo)}. Reduza apenas a personalização antes de salvar.`;
      statusSalvarConfiguracoesIA.className = "erro";
      return;
    }
    salvarNivelContextoIA(configuracao.id);
    if (!pesquisaWebPermitidaPeloPlano()) {
      pesquisaWebIAPendente = false;
    }
    salvarPesquisaWebAtivaIA(pesquisaWebIAPendente);
    atualizarResumoConfiguracoesIA();
    statusSalvarConfiguracoesIA.textContent = pesquisaWebPermitidaPeloPlano()
      ? `Contexto ${configuracao.nome} salvo. Pesquisa web ${pesquisaWebIAPendente ? "ligada" : "desligada"}.`
      : `Contexto ${configuracao.nome} salvo. Pesquisa web indisponível no plano ${obterConfiguracaoComercialCliente().nomePlano}.`;
    statusSalvarConfiguracoesIA.className = "ok";
    setTimeout(() => {
      fecharConfiguracoesIAConfig();
    }, 220);
  }
  function abrirEditorPromptIA(tipo) {
    const interno = tipo === "interno";
    if (interno && !obterModuloAdminOculto()?.obterTokenSessao?.()) {
      return;
    }
    tipoPromptIAEmEdicao = interno ? "interno" : "personalizado";
    if (interno) {
      tituloEditorPromptIA.textContent = "Motor do WhatsIAPP";
      descricaoEditorPromptIA.textContent =
        "Prompt interno obrigatório usado pelo WhatsIAPP. Esta configuração é exclusiva da área administrativa.";
      campoPromptBaseIA.placeholder = "Prompt interno do WhatsIAPP...";
      campoPromptBaseIA.value =
        obterModuloAdminOculto()?.obterMotorIA?.() || obterPromptInternoIA();
      overlayPromptBaseIA.style.zIndex = "240000";
    } else {
      const configuracao = obterConfiguracaoNivelContextoIA(
        nivelContextoIAPendente || obterNivelContextoIA(),
      );
      tituloEditorPromptIA.textContent = "Prompt personalizado";
      descricaoEditorPromptIA.textContent = `Adicione personalidade, preferências, tom e regras próprias. Este texto é somado ao Motor do WhatsIAPP. O nível ${configuracao.nome} permite até ${formatarNumeroConfigIA(configuracao.promptMaximo)} caracteres.`;
      campoPromptBaseIA.placeholder =
        "Ex.: fale de forma direta, use poucas emojis, não aceite compromissos sem confirmar...";
      campoPromptBaseIA.value = obterPromptPersonalizadoIA();
    }
    statusSalvarPrompt.textContent = "";
    statusSalvarPrompt.className = "";
    atualizarContadorPromptBase();
    overlayPromptBaseIA.classList.add("aberto");
    setTimeout(() => {
      campoPromptBaseIA.focus();
    }, 30);
  }
  function abrirPromptInternoIAConfig() {
    abrirEditorPromptIA("interno");
  }
  function abrirPromptPersonalizadoIAConfig() {
    abrirEditorPromptIA("personalizado");
  }
  function fecharPromptBaseIAConfig() {
    overlayPromptBaseIA.classList.remove("aberto");
    overlayPromptBaseIA.style.zIndex = "";
    statusSalvarPrompt.textContent = "";
    statusSalvarPrompt.className = "";
  }
  function abrirConfiguracoesApp() {
    statusSenhaTrancadasConfig.textContent = senhaTrancadasConfigurada()
      ? "Senha configurada"
      : "Nenhuma senha configurada";
    atualizarResumoConfiguracoesIA();
    carregarStatusCatalogoCliente();
    // Primeiro torna o painel visivel. Depois recarrega o consumo reiniciando
    // os numeros em zero, para a contagem de 3s ser realmente percebida.
    overlayConfiguracoesApp.classList.add("aberto");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        carregarUsoGroqConfig(periodoUsoGroqSelecionado, {
          reiniciarNumeros: true,
          atrasoNumeros: 0,
          duracaoNumeros: 2000,
        });
      });
    });
  }
  function abrirCatalogoClienteConfig() {
    carregarStatusCatalogoCliente();
    overlayCatalogoConfig.classList.add("aberto");
  }
  function fecharCatalogoClienteConfig() {
    overlayCatalogoConfig.classList.remove("aberto");
  }
  function fecharPainelConfiguracoesApp() {
    if (overlayPromptBaseIA.classList.contains("aberto")) {
      fecharPromptBaseIAConfig();
    }
    if (overlayConfiguracoesIA.classList.contains("aberto")) {
      fecharConfiguracoesIAConfig();
    }
    if (overlayCatalogoConfig.classList.contains("aberto")) {
      fecharCatalogoClienteConfig();
    }
    overlayConfiguracoesApp.classList.remove("aberto");
  }
  async function confirmarPromptBaseIA() {
    if (tipoPromptIAEmEdicao === "interno") {
      if (!obterModuloAdminOculto()?.obterTokenSessao?.()) {
        statusSalvarPrompt.textContent = "Sessão administrativa expirada.";
        statusSalvarPrompt.className = "erro";
        return;
      }
      const motorIA = String(campoPromptBaseIA.value || "").trim();
      botaoSalvarPromptBaseIA.disabled = true;
      statusSalvarPrompt.textContent = "Salvando Motor da IA...";
      statusSalvarPrompt.className = "";
      try {
        const resultado = await ipcRenderer.invoke("admin-salvar-motor-ia", {
          token: obterModuloAdminOculto()?.obterTokenSessao?.(),
          motorIA,
        });
        if (!resultado?.ok) {
          throw new Error(
            resultado?.erro || "Não foi possível salvar o Motor da IA.",
          );
        }
        const motorIASalvo = String(resultado.motorIA || motorIA).trim();
        // Mantem a copia antiga apenas por compatibilidade com chamadas legadas.
        salvarPromptInternoIA(motorIASalvo);
        obterModuloAdminOculto()?.definirMotorIA?.(motorIASalvo);
        fecharPromptBaseIAConfig();
        obterModuloAdminOculto()?.atualizarEstadoAlteracoes?.();
        return;
      } catch (erro) {
        statusSalvarPrompt.textContent =
          erro?.message || "Não foi possível salvar o Motor da IA.";
        statusSalvarPrompt.className = "erro";
        botaoSalvarPromptBaseIA.disabled = false;
        return;
      }
    }
    const configuracao = obterConfiguracaoNivelContextoIA(
      nivelContextoIAPendente || obterNivelContextoIA(),
    );
    const tamanhoPrompt = campoPromptBaseIA.value.length;
    if (tamanhoPrompt > configuracao.promptMaximo) {
      statusSalvarPrompt.textContent = `O nível ${configuracao.nome} permite até ${formatarNumeroConfigIA(configuracao.promptMaximo)} caracteres de personalização.`;
      statusSalvarPrompt.className = "erro";
      atualizarContadorPromptBase();
      return;
    }
    salvarPromptPersonalizadoIA(campoPromptBaseIA.value);
    atualizarStatusPromptsIAConfig();
    fecharPromptBaseIAConfig();
  }
  campoPromptBaseIA.addEventListener("input", () => {
    statusSalvarPrompt.textContent = "";
    statusSalvarPrompt.className = "";
    atualizarContadorPromptBase();
    if (tipoPromptIAEmEdicao === "interno") {
      obterModuloAdminOculto()?.atualizarEstadoAlteracoes?.();
    }
  });
  campoPromptBaseIA.addEventListener("keydown", (evento) => {
    if (evento.ctrlKey && evento.key === "Enter") {
      evento.preventDefault();
      confirmarPromptBaseIA();
    }
  });
  botaoAbrirConfiguracoesIA.addEventListener(
    "click",
    abrirConfiguracoesIAConfig,
  );
  botaoAbrirCatalogoConfig.addEventListener(
    "click",
    abrirCatalogoClienteConfig,
  );
  fecharCatalogoConfig.addEventListener("click", fecharCatalogoClienteConfig);
  overlayCatalogoConfig.addEventListener("click", (evento) => {
    if (evento.target === overlayCatalogoConfig) {
      fecharCatalogoClienteConfig();
    }
  });
  campoPesquisaWebAtivaIA.addEventListener("change", () => {
    if (!pesquisaWebPermitidaPeloPlano()) {
      pesquisaWebIAPendente = false;
      campoPesquisaWebAtivaIA.checked = false;
      return;
    }
    pesquisaWebIAPendente = !!campoPesquisaWebAtivaIA.checked;
    statusSalvarConfiguracoesIA.textContent = "";
    statusSalvarConfiguracoesIA.className = "";
  });
  opcoesNivelContextoIA.forEach((botao) => {
    botao.addEventListener("click", () => {
      if (!nivelContextoPermitidoPeloPlano(botao.dataset.nivelContexto)) {
        return;
      }
      statusSalvarConfiguracoesIA.textContent = "";
      statusSalvarConfiguracoesIA.className = "";
      renderizarNivelContextoIA(botao.dataset.nivelContexto);
    });
  });
  fecharConfiguracoesIA.addEventListener("click", fecharConfiguracoesIAConfig);
  cancelarConfiguracoesIA.addEventListener(
    "click",
    fecharConfiguracoesIAConfig,
  );
  salvarConfiguracoesIA.addEventListener("click", confirmarConfiguracoesIA);
  overlayConfiguracoesIA.addEventListener("click", (evento) => {
    if (evento.target === overlayConfiguracoesIA) {
      fecharConfiguracoesIAConfig();
    }
  });
  botaoAbrirPromptPersonalizadoIA.addEventListener(
    "click",
    abrirPromptPersonalizadoIAConfig,
  );
  async function solicitarFechamentoEditorPromptIA() {
    const moduloAdminAtual = obterModuloAdminOculto?.();
    if (moduloAdminAtual?.solicitarFechamentoEditorPromptIA) {
      return moduloAdminAtual.solicitarFechamentoEditorPromptIA();
    }
    fecharPromptBaseIAConfig();
    return true;
  }
  fecharPromptBaseIA.addEventListener(
    "click",
    solicitarFechamentoEditorPromptIA,
  );
  cancelarPromptBaseIA.addEventListener(
    "click",
    solicitarFechamentoEditorPromptIA,
  );
  overlayPromptBaseIA.addEventListener("click", (evento) => {
    if (evento.target === overlayPromptBaseIA) {
      solicitarFechamentoEditorPromptIA();
    }
  });
  botaoSalvarChaveGroq.addEventListener("click", salvarChaveGroqConfig);
  botaoRemoverChaveGroq.addEventListener("click", removerChaveGroqConfig);
  campoChaveApiGroq.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      salvarChaveGroqConfig();
    }
  });
  botaoPerfilApp.addEventListener("click", (evento) => {
    evento.stopPropagation();
    abrirConfiguracoesApp();
  });
  botaoSalvarPromptBaseIA.addEventListener("click", confirmarPromptBaseIA);
  function abrirTrocaSenhaTrancadasConfig() {
    const hashAtual = localStorage.getItem(CHAVE_HASH_TRANCADAS);
    const jaTemSenha = !!hashAtual;
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "120100",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,.72)",
    });
    const caixa = document.createElement("div");
    Object.assign(caixa.style, {
      width: "380px",
      maxWidth: "calc(100vw - 40px)",
      padding: "22px",
      borderRadius: "14px",
      background: "#111a1f",
      border: "1px solid #26343c",
      boxShadow: "0 20px 60px rgba(0,0,0,.5)",
      color: "#e9edef",
      boxSizing: "border-box",
    });
    caixa.innerHTML = `
      <div style="font-size:18px;font-weight:800;margin-bottom:8px;">
        ${jaTemSenha ? "Trocar senha" : "Definir senha"}
      </div>

      <div style="font-size:13px;color:#93a4ae;line-height:1.45;margin-bottom:16px;">
        ${
          jaTemSenha
            ? "Confirme a senha atual e escolha uma nova senha para as conversas trancadas."
            : "Crie a senha usada para acessar as conversas trancadas."
        }
      </div>

      ${
        jaTemSenha
          ? `<input id="senhaTrancadasAtualConfig" type="password" autocomplete="current-password" placeholder="Senha atual" style="box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border-radius:8px;border:1px solid #30414a;background:#0c1317;color:#fff;outline:none;">`
          : ""
      }

      <input id="senhaTrancadasNovaConfig" type="password" autocomplete="new-password" placeholder="Nova senha" style="box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border-radius:8px;border:1px solid #30414a;background:#0c1317;color:#fff;outline:none;">

      <input id="senhaTrancadasConfirmarConfig" type="password" autocomplete="new-password" placeholder="Confirmar nova senha" style="box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:8px;border-radius:8px;border:1px solid #30414a;background:#0c1317;color:#fff;outline:none;">

      <div id="erroTrocaSenhaTrancadasConfig" style="min-height:18px;font-size:12px;color:#ff6b6b;margin-bottom:8px;"></div>

      <div style="display:flex;gap:8px;">
        <button id="cancelarTrocaSenhaTrancadasConfig" type="button" style="flex:1;padding:11px;border:1px solid #30414a;border-radius:8px;background:#182126;color:#fff;cursor:pointer;">Cancelar</button>
        <button id="salvarTrocaSenhaTrancadasConfig" type="button" style="flex:1;padding:11px;border:0;border-radius:8px;background:#20b35b;color:#fff;font-weight:800;cursor:pointer;">Salvar</button>
      </div>
    `;
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);
    const senhaAtual = caixa.querySelector("#senhaTrancadasAtualConfig");
    const senhaNova = caixa.querySelector("#senhaTrancadasNovaConfig");
    const confirmarSenha = caixa.querySelector(
      "#senhaTrancadasConfirmarConfig",
    );
    const erro = caixa.querySelector("#erroTrocaSenhaTrancadasConfig");
    const cancelar = caixa.querySelector("#cancelarTrocaSenhaTrancadasConfig");
    const salvar = caixa.querySelector("#salvarTrocaSenhaTrancadasConfig");
    const fechar = () => {
      overlay.remove();
    };
    const confirmar = () => {
      erro.textContent = "";
      if (
        jaTemSenha &&
        hashSenhaTrancadas(senhaAtual.value.trim()) !== hashAtual
      ) {
        erro.textContent = "Senha atual incorreta.";
        senhaAtual.select();
        return;
      }
      const nova = senhaNova.value.trim();
      const confirmacao = confirmarSenha.value.trim();
      if (nova.length < 4) {
        erro.textContent = "Use pelo menos 4 caracteres.";
        senhaNova.focus();
        return;
      }
      if (nova !== confirmacao) {
        erro.textContent = "As novas senhas não coincidem.";
        confirmarSenha.select();
        return;
      }
      if (jaTemSenha && hashSenhaTrancadas(nova) === hashAtual) {
        erro.textContent = "A nova senha deve ser diferente da atual.";
        senhaNova.select();
        return;
      }
      localStorage.setItem(CHAVE_HASH_TRANCADAS, hashSenhaTrancadas(nova));
      bloquearTrancadas();
      atualizarContadores();
      renderConversas();
      statusSenhaTrancadasConfig.textContent = jaTemSenha
        ? "Senha alterada com sucesso."
        : "Senha definida com sucesso.";
      fechar();
    };
    cancelar.addEventListener("click", fechar);
    salvar.addEventListener("click", confirmar);
    overlay.addEventListener("click", (evento) => {
      if (evento.target === overlay) {
        fechar();
      }
    });
    overlay.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape") {
        fechar();
        return;
      }
      if (evento.key === "Enter") {
        confirmar();
      }
    });
    setTimeout(() => {
      (senhaAtual || senhaNova).focus();
    }, 30);
  }
  botaoTrocarSenhaTrancadasConfig.addEventListener(
    "click",
    abrirTrocaSenhaTrancadasConfig,
  );
  botaoSelecionarCatalogoPdf.addEventListener(
    "click",
    selecionarCatalogoPdfCliente,
  );
  botaoRemoverCatalogoPdf.addEventListener("click", removerCatalogoPdfCliente);
  catalogoBuscaTesteBotao.addEventListener("click", executarBuscaCatalogoTeste);
  catalogoBuscaTesteInput.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      executarBuscaCatalogoTeste();
    }
  });
  fecharConfiguracoesApp.addEventListener(
    "click",
    fecharPainelConfiguracoesApp,
  );
  overlayConfiguracoesApp.addEventListener("click", (evento) => {
    if (evento.target === overlayConfiguracoesApp) {
      fecharPainelConfiguracoesApp();
    }
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") {
      return;
    }
    if (overlayPromptBaseIA.classList.contains("aberto")) {
      evento.preventDefault();
      solicitarFechamentoEditorPromptIA();
      return;
    }
    if (overlayConfiguracoesIA.classList.contains("aberto")) {
      fecharConfiguracoesIAConfig();
      return;
    }
    if (overlayCatalogoConfig.classList.contains("aberto")) {
      fecharCatalogoClienteConfig();
      return;
    }
    if (overlayConfiguracoesApp.classList.contains("aberto")) {
      fecharPainelConfiguracoesApp();
    }
  });

  return {
    overlayPromptBaseIA,
    campoPromptBaseIA,
    fecharConfiguracoesApp,
    atualizarResumoConfiguracoesIA,
    abrirEditorPromptIA,
    fecharPromptBaseIAConfig,
    obterTipoPromptIAEmEdicao: () => tipoPromptIAEmEdicao,
  };
}

module.exports = { criarModuloConfiguracoesApp };
