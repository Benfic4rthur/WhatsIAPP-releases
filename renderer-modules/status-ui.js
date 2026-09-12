(() => {
  const { ipcRenderer } = require("electron");
  const { pathToFileURL } = require("url");

  const documentRef = document;
  const body = documentRef.body;
  const railTopo = documentRef.querySelector(".wa-nav-rail-topo");
  const lateralCorpo = documentRef.querySelector(".lateral-corpo");
  const chat = documentRef.querySelector(".chat");

  if (!body || !railTopo || !lateralCorpo || !chat) {
    console.warn("[STATUS UI] estrutura principal nao encontrada");
    return;
  }

  if (documentRef.getElementById("btnRailStatus")) {
    return;
  }

  let feedsStatus = [];
  let meuStatus = null;
  let feedAtual = null;
  let indiceStatusAtual = 0;
  let carregandoLista = false;
  let recarregarListaPendente = false;
  let timerAvanco = null;
  let timerAtualizacao = null;
  let tokenVisualizador = 0;
  let publicandoStatus = false;
  let midiaPublicacao = null;
  let corFundoPublicacao = "#005c4b";
  let resolverModalStatus = null;
  let statusAbertoPorCitacao = false;
  const fotosEmCarga = new Set();
  const CHAVE_RESPOSTAS_STATUS = "whatsiapp-status-respostas-contexto-v1";

  function candidatosIdMensagemStatus(valor) {
    const texto = String(valor || "").trim();
    const candidatos = new Set();

    if (!texto) {
      return candidatos;
    }

    candidatos.add(texto);

    const partes = texto.split("_").filter(Boolean);
    const indiceBroadcast = partes.findIndex((parte) =>
      String(parte).toLowerCase().includes("status@broadcast"),
    );

    if (indiceBroadcast >= 0 && partes[indiceBroadcast + 1]) {
      candidatos.add(String(partes[indiceBroadcast + 1]).trim());
    }

    // IDs serializados do WPP podem terminar em _out/_in.
    // O historico do chat normalmente usa apenas o ID cru da mensagem.
    const partesMensagem = [...partes];
    if (
      ["out", "in"].includes(String(partesMensagem.at(-1) || "").toLowerCase())
    ) {
      partesMensagem.pop();
    }

    const ultimo = String(partesMensagem.at(-1) || "").trim();
    if (ultimo && !ultimo.includes("@")) {
      candidatos.add(ultimo);
    }

    return new Set(Array.from(candidatos).filter(Boolean));
  }

  function carregarRespostasStatusPersistidas() {
    try {
      const dados = JSON.parse(
        window.localStorage.getItem(CHAVE_RESPOSTAS_STATUS) || "{}",
      );

      if (!dados || typeof dados !== "object") {
        return {};
      }

      const limite = Date.now() - 30 * 60 * 60 * 1000;
      const validas = {};

      for (const [chave, registro] of Object.entries(dados)) {
        if (Number(registro?.salvoEm || 0) >= limite) {
          validas[chave] = registro;
        }
      }

      return validas;
    } catch {
      return {};
    }
  }

  function registrarContextoRespostaStatus(resultado, feed, mensagem) {
    const idsEnviados = [
      resultado?.idMensagemEnviada,
      resultado?.idMensagemEnviadaRaw,
    ]
      .map((valor) => String(valor || "").trim())
      .filter(Boolean);

    if (!idsEnviados.length || !mensagem?.idMensagem) {
      return;
    }

    const mapa = carregarRespostasStatusPersistidas();
    const registro = {
      idMensagem: String(mensagem.idMensagem || "").trim(),
      idMensagemWpp: String(
        mensagem.idMensagem || mensagem.idMensagemRaw || "",
      ).trim(),
      idMensagemRaw: String(mensagem.idMensagemRaw || "").trim() || null,
      contatoId: String(feed?.id || "").trim() || null,
      idFeed: String(feed?.idFeed || "").trim() || null,
      preferirMeuStatus: false,
      salvoEm: Date.now(),
    };

    for (const idEnviado of idsEnviados) {
      for (const candidato of candidatosIdMensagemStatus(idEnviado)) {
        mapa[candidato] = registro;
      }
    }

    try {
      window.localStorage.setItem(CHAVE_RESPOSTAS_STATUS, JSON.stringify(mapa));

      console.log(
        `[STATUS UI] CONTEXTO_RESPOSTA_SALVO | envio=${idsEnviados.join(",")} | ` +
          `status=${registro.idMensagemRaw || registro.idMensagem}`,
      );
    } catch (erro) {
      console.warn(
        "[STATUS UI] falha ao persistir contexto da resposta:",
        erro?.message || erro || "erro desconhecido",
      );
    }
  }
  function escaparHtml(valor) {
    return String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function iniciais(nome) {
    const partes = String(nome || "?")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!partes.length) {
      return "?";
    }

    if (partes.length === 1) {
      return partes[0].slice(0, 2).toUpperCase();
    }

    return `${partes[0][0] || ""}${partes.at(-1)?.[0] || ""}`.toUpperCase();
  }

  function jidParaBaileys(valor) {
    const id = String(valor || "").trim();

    if (id.endsWith("@c.us")) {
      return id.replace("@c.us", "@s.whatsapp.net");
    }

    return id;
  }

  function formatarHorarioStatus(timestamp) {
    const numero = Number(timestamp || 0);

    if (!numero) {
      return "";
    }

    const data = new Date(numero * 1000);
    const agora = new Date();
    const mesmoDia =
      data.getFullYear() === agora.getFullYear() &&
      data.getMonth() === agora.getMonth() &&
      data.getDate() === agora.getDate();

    if (mesmoDia) {
      return `Hoje às ${data.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    const ontem = new Date(agora);
    ontem.setDate(ontem.getDate() - 1);

    const foiOntem =
      data.getFullYear() === ontem.getFullYear() &&
      data.getMonth() === ontem.getMonth() &&
      data.getDate() === ontem.getDate();

    if (foiOntem) {
      return `Ontem às ${data.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    return data.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function corStatusTexto(valor) {
    if (typeof valor === "string") {
      const texto = valor.trim();

      if (/^#[0-9a-f]{6}$/i.test(texto)) {
        return texto;
      }

      if (/^#[0-9a-f]{8}$/i.test(texto)) {
        return texto.slice(0, 7);
      }

      if (/^rgb/i.test(texto)) {
        return texto;
      }
    }

    const numero = Number(valor);

    if (Number.isFinite(numero)) {
      const rgb = numero & 0xffffff;
      return `#${rgb.toString(16).padStart(6, "0")}`;
    }

    return "#005c4b";
  }

  function avatarMarkup(feed, classeExtra = "") {
    const nome = feed?.nome || "Contato";
    const foto = String(feed?.fotoUrl || "").trim();

    return `
      <span class="status-whatsiapp-avatar ${classeExtra}">
        ${
          foto
            ? `<img src="${escaparHtml(foto)}" alt="">`
            : `<span class="status-whatsiapp-avatar-placeholder">${escaparHtml(iniciais(nome))}</span>`
        }
      </span>
    `;
  }

  const btnStatus = documentRef.createElement("button");
  btnStatus.id = "btnRailStatus";
  btnStatus.className = "wa-rail-btn wa-rail-status";
  btnStatus.type = "button";
  btnStatus.title = "Status";
  btnStatus.setAttribute("aria-label", "Status");
  btnStatus.setAttribute("aria-pressed", "false");
  btnStatus.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.1 4.8A8 8 0 0 1 17.7 5"></path>
      <path d="M19.2 7.1A8 8 0 0 1 19 17.4"></path>
      <path d="M16.9 19.2A8 8 0 0 1 6.4 19"></path>
      <path d="M4.8 16.9A8 8 0 0 1 5 6.4"></path>
      <circle cx="12" cy="12" r="2.6"></circle>
    </svg>
  `;

  const btnFavoritos = documentRef.getElementById("btnRailFavoritos");

  if (btnFavoritos?.nextSibling) {
    railTopo.insertBefore(btnStatus, btnFavoritos.nextSibling);
  } else {
    railTopo.appendChild(btnStatus);
  }

  const painelLateral = documentRef.createElement("section");
  painelLateral.id = "painelStatusWhatsIAPP";
  painelLateral.className = "status-whatsiapp-lateral";
  painelLateral.setAttribute("aria-label", "Status do WhatsApp");
  painelLateral.innerHTML = `
    <div class="status-whatsiapp-topo">
      <h1>Status</h1>
      <button
        id="btnAtualizarStatusWhatsIAPP"
        class="status-whatsiapp-atualizar"
        type="button"
        title="Atualizar status"
        aria-label="Atualizar status"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6v5h-5"></path>
          <path d="M4 18v-5h5"></path>
          <path d="M18.2 9A7 7 0 0 0 6.5 6.5L4 9"></path>
          <path d="M5.8 15A7 7 0 0 0 17.5 17.5L20 15"></path>
        </svg>
      </button>
    </div>

    <div id="statusWhatsIAPPLista" class="status-whatsiapp-lista">
      <div class="status-whatsiapp-carregando">
        <span class="status-whatsiapp-spinner"></span>
        <span>Carregando status...</span>
      </div>
    </div>
  `;
  lateralCorpo.appendChild(painelLateral);

  const painelPrincipal = documentRef.createElement("section");
  painelPrincipal.id = "visualizadorStatusWhatsIAPP";
  painelPrincipal.className = "status-whatsiapp-principal";
  painelPrincipal.innerHTML = `
    <div id="statusWhatsIAPPVazio" class="status-whatsiapp-centro">
      <div class="status-whatsiapp-vazio-icone" aria-hidden="true">
        <svg viewBox="0 0 64 64" focusable="false">
          <circle class="status-whatsiapp-vazio-anel" cx="32" cy="32" r="22"></circle>
          <circle class="status-whatsiapp-vazio-ponto" cx="32" cy="32" r="5"></circle>
        </svg>
      </div>
      <h2>Atualizações de status</h2>
      <p>Selecione um contato para visualizar os status publicados nas últimas 24 horas.</p>
    </div>

    <div id="statusWhatsIAPPViewer" class="status-whatsiapp-viewer" hidden>
      <div id="statusWhatsIAPPProgresso" class="status-whatsiapp-progresso"></div>

      <div class="status-whatsiapp-viewer-topo">
        <div class="status-whatsiapp-viewer-contato">
          <span id="statusWhatsIAPPViewerAvatar" class="status-whatsiapp-viewer-avatar"></span>
          <span class="status-whatsiapp-viewer-identidade">
            <strong id="statusWhatsIAPPViewerNome">Contato</strong>
            <small id="statusWhatsIAPPViewerHorario"></small>
          </span>
        </div>

        <div class="status-whatsiapp-viewer-acoes">
          <button
            id="statusWhatsIAPPMenuMeuStatus"
            class="status-whatsiapp-viewer-menu"
            type="button"
            aria-label="Opções do meu status"
            title="Opções"
            hidden
          >⋮</button>
          <button
            id="statusWhatsIAPPFecharViewer"
            class="status-whatsiapp-viewer-fechar"
            type="button"
            aria-label="Fechar status"
            title="Fechar"
          >×</button>
          <div id="statusWhatsIAPPMenuMeuStatusPainel" class="status-whatsiapp-menu-meu" hidden>
            <button id="statusWhatsIAPPBaixarMeuStatus" type="button">Baixar</button>
            <button id="statusWhatsIAPPNovoMeuStatus" type="button">Novo status</button>
            <button id="statusWhatsIAPPApagarMeuStatus" class="perigo" type="button">Apagar</button>
          </div>
        </div>
      </div>

      <button
        id="statusWhatsIAPPAnterior"
        class="status-whatsiapp-nav status-whatsiapp-nav-anterior"
        type="button"
        aria-label="Status anterior"
        title="Anterior"
      >‹</button>

      <div id="statusWhatsIAPPConteudo" class="status-whatsiapp-conteudo"></div>

      <button
        id="statusWhatsIAPPProximo"
        class="status-whatsiapp-nav status-whatsiapp-nav-proximo"
        type="button"
        aria-label="Próximo status"
        title="Próximo"
      >›</button>

      <div id="statusWhatsIAPPReacoes" class="status-whatsiapp-reacoes">
        <div class="status-whatsiapp-resposta">
          <input
            id="statusWhatsIAPPRespostaTexto"
            class="status-whatsiapp-resposta-input"
            type="text"
            maxlength="4096"
            autocomplete="off"
            placeholder="Digite uma resposta..."
            aria-label="Responder ao status"
          >
          <button
            id="statusWhatsIAPPEnviarResposta"
            class="status-whatsiapp-resposta-enviar"
            type="button"
            aria-label="Enviar resposta"
            title="Enviar resposta"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m4 4 16 8-16 8 3-8-3-8Z"></path>
              <path d="M7 12h13"></path>
            </svg>
          </button>
        </div>
        <span class="status-whatsiapp-reacoes-separador" aria-hidden="true"></span>
        <div class="status-whatsiapp-reacoes-botoes">
          <button type="button" data-reacao="❤️" aria-label="Reagir com coração">❤️</button>
          <button type="button" data-reacao="😂" aria-label="Reagir com risada">😂</button>
          <button type="button" data-reacao="😮" aria-label="Reagir com surpresa">😮</button>
          <button type="button" data-reacao="😢" aria-label="Reagir com tristeza">😢</button>
          <button type="button" data-reacao="🙏" aria-label="Reagir com agradecimento">🙏</button>
          <button type="button" data-reacao="👍" aria-label="Reagir com positivo">👍</button>
        </div>
        <span id="statusWhatsIAPPReacaoFeedback" class="status-whatsiapp-reacao-feedback"></span>
      </div>

      <div id="statusWhatsIAPPMeuControles" class="status-whatsiapp-meu-controles" hidden>
        <button id="statusWhatsIAPPVisualizadores" type="button" title="Ver visualizações">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12s3.4-5 9.5-5 9.5 5 9.5 5-3.4 5-9.5 5-9.5-5-9.5-5Z"></path>
            <circle cx="12" cy="12" r="2.3"></circle>
          </svg>
          <span id="statusWhatsIAPPVisualizacoesTotal">...</span>
        </button>
      </div>

      <aside id="statusWhatsIAPPVisualizadoresPainel" class="status-whatsiapp-visualizadores" hidden>
        <div class="status-whatsiapp-visualizadores-topo">
          <div>
            <strong>Visualizações</strong>
            <small id="statusWhatsIAPPVisualizadoresResumo">Carregando...</small>
          </div>
          <button id="statusWhatsIAPPFecharVisualizadores" type="button" aria-label="Fechar">×</button>
        </div>
        <div id="statusWhatsIAPPVisualizadoresLista" class="status-whatsiapp-visualizadores-lista"></div>
      </aside>
    </div>

    <div id="statusWhatsIAPPPublicador" class="status-whatsiapp-publicador" hidden>
      <div class="status-whatsiapp-publicador-card">
        <div class="status-whatsiapp-publicador-topo">
          <strong>Novo status</strong>
          <button id="statusWhatsIAPPFecharPublicador" type="button" aria-label="Fechar">×</button>
        </div>

        <div id="statusWhatsIAPPPublicadorEscolha" class="status-whatsiapp-publicador-escolha">
          <button id="statusWhatsIAPPPublicarTextoEscolha" type="button">
            <span class="status-whatsiapp-publicador-icone">T</span>
            <span><strong>Texto</strong><small>Escreva uma atualização</small></span>
          </button>
          <button id="statusWhatsIAPPPublicarMidiaEscolha" type="button">
            <span class="status-whatsiapp-publicador-icone">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                <circle cx="9" cy="9" r="1.6"></circle>
                <path d="m5.5 17 4.2-4 3 2.6 2.3-2.1 3.5 3.5"></path>
              </svg>
            </span>
            <span><strong>Foto</strong><small>Selecione uma imagem</small></span>
          </button>
        </div>

        <div id="statusWhatsIAPPPublicadorTexto" class="status-whatsiapp-publicador-texto" hidden>
          <div id="statusWhatsIAPPTextoPreview" class="status-whatsiapp-publicador-texto-preview">
            <textarea id="statusWhatsIAPPTextoStatus" maxlength="700" placeholder="Digite seu status"></textarea>
          </div>
          <div class="status-whatsiapp-publicador-cores" aria-label="Cor de fundo">
            <button type="button" data-status-cor="#005c4b" class="selecionada" aria-label="Verde"></button>
            <button type="button" data-status-cor="#1f6feb" aria-label="Azul"></button>
            <button type="button" data-status-cor="#7c3aed" aria-label="Roxo"></button>
            <button type="button" data-status-cor="#b42318" aria-label="Vermelho"></button>
            <button type="button" data-status-cor="#9a6700" aria-label="Amarelo escuro"></button>
            <button type="button" data-status-cor="#374151" aria-label="Cinza"></button>
          </div>
          <button id="statusWhatsIAPPEnviarTextoStatus" class="status-whatsiapp-publicador-enviar" type="button">Publicar</button>
        </div>

        <div id="statusWhatsIAPPPublicadorMidia" class="status-whatsiapp-publicador-midia" hidden>
          <div id="statusWhatsIAPPMidiaPreview" class="status-whatsiapp-publicador-midia-preview"></div>
          <input id="statusWhatsIAPPLegendaStatus" type="text" maxlength="700" placeholder="Adicionar legenda">
          <div class="status-whatsiapp-publicador-midia-acoes">
            <button id="statusWhatsIAPPTrocarMidiaStatus" type="button">Trocar arquivo</button>
            <button id="statusWhatsIAPPEnviarMidiaStatus" class="status-whatsiapp-publicador-enviar" type="button">Publicar</button>
          </div>
        </div>

        <div id="statusWhatsIAPPPublicadorFeedback" class="status-whatsiapp-publicador-feedback"></div>
      </div>
    </div>

    <div id="statusWhatsIAPPModal" class="status-whatsiapp-modal" hidden>
      <div class="status-whatsiapp-modal-card" role="dialog" aria-modal="true" aria-labelledby="statusWhatsIAPPModalTitulo">
        <div class="status-whatsiapp-modal-icone" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 8v5"></path>
            <circle cx="12" cy="16.5" r=".8"></circle>
            <path d="M10.3 3.8 2.9 17a2 2 0 0 0 1.8 3h14.6a2 2 0 0 0 1.8-3L13.7 3.8a2 2 0 0 0-3.4 0Z"></path>
          </svg>
        </div>
        <div class="status-whatsiapp-modal-conteudo">
          <strong id="statusWhatsIAPPModalTitulo">Confirmação</strong>
          <span id="statusWhatsIAPPModalTexto"></span>
        </div>
        <div class="status-whatsiapp-modal-acoes">
          <button id="statusWhatsIAPPModalCancelar" type="button">Cancelar</button>
          <button id="statusWhatsIAPPModalConfirmar" class="primario" type="button">Confirmar</button>
        </div>
      </div>
    </div>
  `;
  chat.appendChild(painelPrincipal);

  const listaEl = documentRef.getElementById("statusWhatsIAPPLista");
  const vazioEl = documentRef.getElementById("statusWhatsIAPPVazio");
  const viewerEl = documentRef.getElementById("statusWhatsIAPPViewer");
  const conteudoEl = documentRef.getElementById("statusWhatsIAPPConteudo");
  const progressoEl = documentRef.getElementById("statusWhatsIAPPProgresso");
  const nomeViewerEl = documentRef.getElementById("statusWhatsIAPPViewerNome");
  const horarioViewerEl = documentRef.getElementById(
    "statusWhatsIAPPViewerHorario",
  );
  const avatarViewerEl = documentRef.getElementById(
    "statusWhatsIAPPViewerAvatar",
  );
  const reacoesEl = documentRef.getElementById("statusWhatsIAPPReacoes");
  const feedbackReacaoEl = documentRef.getElementById(
    "statusWhatsIAPPReacaoFeedback",
  );
  const respostaStatusEl = documentRef.getElementById(
    "statusWhatsIAPPRespostaTexto",
  );
  const enviarRespostaStatusBtn = documentRef.getElementById(
    "statusWhatsIAPPEnviarResposta",
  );
  const badgeStatusEl = documentRef.getElementById("badgeStatusWhatsIAPP");
  const meuControlesEl = documentRef.getElementById(
    "statusWhatsIAPPMeuControles",
  );
  const visualizacoesTotalEl = documentRef.getElementById(
    "statusWhatsIAPPVisualizacoesTotal",
  );
  const visualizadoresPainelEl = documentRef.getElementById(
    "statusWhatsIAPPVisualizadoresPainel",
  );
  const visualizadoresResumoEl = documentRef.getElementById(
    "statusWhatsIAPPVisualizadoresResumo",
  );
  const visualizadoresListaEl = documentRef.getElementById(
    "statusWhatsIAPPVisualizadoresLista",
  );
  const menuMeuStatusBtn = documentRef.getElementById(
    "statusWhatsIAPPMenuMeuStatus",
  );
  const menuMeuStatusPainel = documentRef.getElementById(
    "statusWhatsIAPPMenuMeuStatusPainel",
  );
  const baixarMeuStatusBtn = documentRef.getElementById(
    "statusWhatsIAPPBaixarMeuStatus",
  );
  const publicadorEl = documentRef.getElementById("statusWhatsIAPPPublicador");
  const publicadorEscolhaEl = documentRef.getElementById(
    "statusWhatsIAPPPublicadorEscolha",
  );
  const publicadorTextoEl = documentRef.getElementById(
    "statusWhatsIAPPPublicadorTexto",
  );
  const publicadorMidiaEl = documentRef.getElementById(
    "statusWhatsIAPPPublicadorMidia",
  );
  const textoStatusEl = documentRef.getElementById(
    "statusWhatsIAPPTextoStatus",
  );
  const textoPreviewEl = documentRef.getElementById(
    "statusWhatsIAPPTextoPreview",
  );
  const midiaPreviewEl = documentRef.getElementById(
    "statusWhatsIAPPMidiaPreview",
  );
  const legendaStatusEl = documentRef.getElementById(
    "statusWhatsIAPPLegendaStatus",
  );
  const publicadorFeedbackEl = documentRef.getElementById(
    "statusWhatsIAPPPublicadorFeedback",
  );
  const modalStatusEl = documentRef.getElementById("statusWhatsIAPPModal");
  const modalStatusTituloEl = documentRef.getElementById(
    "statusWhatsIAPPModalTitulo",
  );
  const modalStatusTextoEl = documentRef.getElementById(
    "statusWhatsIAPPModalTexto",
  );
  const modalStatusCancelarBtn = documentRef.getElementById(
    "statusWhatsIAPPModalCancelar",
  );
  const modalStatusConfirmarBtn = documentRef.getElementById(
    "statusWhatsIAPPModalConfirmar",
  );

  const botoesRailExistentes = Array.from(
    railTopo.querySelectorAll(".wa-rail-btn:not(#btnRailStatus)"),
  );

  function limparTimerAvanco() {
    if (timerAvanco) {
      clearTimeout(timerAvanco);
      timerAvanco = null;
    }
  }

  function totalStatusNaoVistos() {
    return feedsStatus.reduce(
      (total, feed) => total + Math.max(0, Number(feed?.unreadCount || 0) || 0),
      0,
    );
  }

  function atualizarBadgeStatus() {
    const total = totalStatusNaoVistos();

    if (!badgeStatusEl) {
      return;
    }

    badgeStatusEl.textContent = total > 99 ? "99+" : String(total || "");
    badgeStatusEl.hidden = total <= 0;
  }

  function renderEstadoVazioLista(texto, detalhe = "") {
    listaEl.innerHTML = `
      <div class="status-whatsiapp-lista-vazia">
        <div class="status-whatsiapp-lista-vazia-icone">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="7"></circle>
            <path d="M12 8v4l2.5 1.5"></path>
          </svg>
        </div>
        <strong>${escaparHtml(texto)}</strong>
        ${detalhe ? `<span>${escaparHtml(detalhe)}</span>` : ""}
      </div>
    `;
  }

  function itemFeedMarkup(feed, indice) {
    const naoVistos = Math.max(0, Number(feed?.unreadCount || 0) || 0);
    const total = Math.max(
      0,
      Number(feed?.totalCount || feed?.mensagens?.length || 0) || 0,
    );
    const classeAnel =
      naoVistos > 0
        ? "status-whatsiapp-avatar-nao-visto"
        : "status-whatsiapp-avatar-visto";

    return `
      <button
        class="status-whatsiapp-item"
        type="button"
        data-status-feed="${indice}"
      >
        ${avatarMarkup(feed, classeAnel)}
        <span class="status-whatsiapp-item-texto">
          <strong>${escaparHtml(feed?.nome || "Contato")}</strong>
          <small>${escaparHtml(formatarHorarioStatus(feed?.ultimaAtualizacao))}</small>
        </span>
        ${
          total > 1
            ? `<span class="status-whatsiapp-item-total">${total}</span>`
            : ""
        }
      </button>
    `;
  }

  function meuStatusMarkup() {
    const quantidade = Math.max(
      0,
      Number(meuStatus?.totalCount || meuStatus?.mensagens?.length || 0) || 0,
    );

    const subtitulo = quantidade
      ? `${quantidade} ${quantidade === 1 ? "atualização" : "atualizações"} publicada${quantidade === 1 ? "" : "s"}`
      : "Compartilhe uma atualização";

    return `
      <div class="status-whatsiapp-meu-linha">
        <button
          id="statusWhatsIAPPMeuStatus"
          class="status-whatsiapp-meu"
          type="button"
        >
          ${avatarMarkup(
            {
              ...(meuStatus || {}),
              nome: "Meu status",
            },
            quantidade
              ? "status-whatsiapp-avatar-visto"
              : "status-whatsiapp-avatar-meu",
          )}
          <span class="status-whatsiapp-meu-texto">
            <strong>Meu status</strong>
            <small>${escaparHtml(subtitulo)}</small>
          </span>
        </button>
        <button
          id="statusWhatsIAPPAdicionarMeuStatus"
          class="status-whatsiapp-meu-adicionar"
          type="button"
          aria-label="Adicionar status"
          title="Adicionar status"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
        </button>
      </div>
    `;
  }

  function renderListaStatus() {
    const recentes = [];
    const vistos = [];

    feedsStatus.forEach((feed, indice) => {
      if (Number(feed?.unreadCount || 0) > 0) {
        recentes.push({ feed, indice });
      } else {
        vistos.push({ feed, indice });
      }
    });

    let html = meuStatusMarkup();

    if (recentes.length) {
      html += `<div class="status-whatsiapp-secao-titulo">RECENTES</div>`;
      html += recentes
        .map(({ feed, indice }) => itemFeedMarkup(feed, indice))
        .join("");
    }

    if (vistos.length) {
      html += `<div class="status-whatsiapp-secao-titulo">VISTOS</div>`;
      html += vistos
        .map(({ feed, indice }) => itemFeedMarkup(feed, indice))
        .join("");
    }

    if (!recentes.length && !vistos.length) {
      html += `
        <div class="status-whatsiapp-lista-vazia">
          <div class="status-whatsiapp-lista-vazia-icone">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="7"></circle>
              <path d="M12 8v4l2.5 1.5"></path>
            </svg>
          </div>
          <strong>Nenhum status disponível</strong>
          <span>Quando seus contatos publicarem uma atualização, ela aparecerá aqui.</span>
        </div>
      `;
    }

    listaEl.innerHTML = html;

    listaEl.querySelectorAll("[data-status-feed]").forEach((botao) => {
      botao.addEventListener("click", () => {
        const indice = Number(botao.dataset.statusFeed);
        const feed = feedsStatus[indice];

        if (feed) {
          abrirFeed(feed);
        }
      });
    });

    const btnMeuStatus = documentRef.getElementById("statusWhatsIAPPMeuStatus");

    btnMeuStatus?.addEventListener("click", () => {
      if (meuStatus?.mensagens?.length) {
        abrirFeed(meuStatus, 0);
      } else {
        abrirPublicador();
      }
    });

    documentRef
      .getElementById("statusWhatsIAPPAdicionarMeuStatus")
      ?.addEventListener("click", (evento) => {
        evento.preventDefault();
        evento.stopPropagation();
        abrirPublicador();
      });

    atualizarBadgeStatus();
    void hidratarFotosFaltantes();
  }

  function atualizarFotoNaTela(feed) {
    if (!feed?.fotoUrl) {
      return;
    }

    const id = String(feed.id || "");
    const seletores = listaEl.querySelectorAll("[data-status-feed]");

    seletores.forEach((botao) => {
      const indice = Number(botao.dataset.statusFeed);
      const item = feedsStatus[indice];

      if (String(item?.id || "") !== id) {
        return;
      }

      const avatar = botao.querySelector(".status-whatsiapp-avatar");

      if (avatar) {
        avatar.innerHTML = `<img src="${escaparHtml(feed.fotoUrl)}" alt="">`;
      }
    });

    if (feedAtual && String(feedAtual.id || "") === id) {
      renderAvatarViewer(feedAtual);
    }
  }

  async function carregarFotoFeed(feed, minha = false) {
    const chave = minha ? "__meu_status__" : String(feed?.id || "");

    if (!feed || feed.fotoUrl || !chave || fotosEmCarga.has(chave)) {
      return;
    }

    fotosEmCarga.add(chave);

    try {
      const resultado = minha
        ? await ipcRenderer.invoke("carregar-minha-foto")
        : await ipcRenderer.invoke("carregar-foto-perfil", {
            conversaId: jidParaBaileys(feed.id),
          });

      if (resultado?.ok && resultado?.url) {
        feed.fotoUrl = resultado.url;
        atualizarFotoNaTela(feed);

        if (minha) {
          const avatar = documentRef.querySelector(
            "#statusWhatsIAPPMeuStatus .status-whatsiapp-avatar",
          );

          if (avatar) {
            avatar.innerHTML = `<img src="${escaparHtml(feed.fotoUrl)}" alt="">`;
          }

          if (feedAtual?.meu) {
            renderAvatarViewer(feedAtual);
          }
        }
      }
    } catch {
    } finally {
      fotosEmCarga.delete(chave);
    }
  }

  async function hidratarFotosFaltantes() {
    if (meuStatus) {
      void carregarFotoFeed(meuStatus, true);
    }

    const pendentes = feedsStatus.filter((feed) => !feed?.fotoUrl).slice(0, 30);
    const tamanhoLote = 4;

    for (let i = 0; i < pendentes.length; i += tamanhoLote) {
      if (!body.classList.contains("whatsiapp-status-aberto")) {
        return;
      }

      const lote = pendentes.slice(i, i + tamanhoLote);

      await Promise.allSettled(
        lote.map((feed) => carregarFotoFeed(feed, false)),
      );
    }
  }

  async function carregarStatus({ silencioso = false } = {}) {
    if (carregandoLista) {
      recarregarListaPendente = true;
      return;
    }

    carregandoLista = true;

    if (!silencioso) {
      listaEl.innerHTML = `
        <div class="status-whatsiapp-carregando">
          <span class="status-whatsiapp-spinner"></span>
          <span>Carregando status...</span>
        </div>
      `;
    }

    try {
      const resultado = await ipcRenderer.invoke("listar-status-whatsapp");

      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível carregar os status.",
        );
      }

      feedsStatus = Array.isArray(resultado.feeds) ? resultado.feeds : [];
      meuStatus = resultado.meuStatus || {
        id: "meu-status",
        idFeed: "meu-status",
        nome: "Meu status",
        fotoUrl: null,
        meu: true,
        unreadCount: 0,
        totalCount: 0,
        ultimaAtualizacao: 0,
        mensagens: [],
      };

      renderListaStatus();

      console.log(
        `[STATUS UI] carregados=${feedsStatus.length} | nao_vistos=${totalStatusNaoVistos()}`,
      );
    } catch (erro) {
      if (!silencioso || !feedsStatus.length) {
        renderEstadoVazioLista(
          "Não foi possível carregar os status",
          erro?.message || "Tente atualizar em instantes.",
        );
      }

      console.warn(
        "[STATUS UI] falha ao carregar:",
        erro?.message || erro || "erro desconhecido",
      );
    } finally {
      carregandoLista = false;

      if (recarregarListaPendente) {
        recarregarListaPendente = false;
        setTimeout(() => {
          void carregarStatus({ silencioso: true });
        }, 120);
      }
    }
  }

  function renderAvatarViewer(feed) {
    if (!avatarViewerEl) {
      return;
    }

    if (feed?.fotoUrl) {
      avatarViewerEl.innerHTML = `<img src="${escaparHtml(feed.fotoUrl)}" alt="">`;
    } else {
      avatarViewerEl.textContent = iniciais(feed?.nome || "Contato");
    }
  }

  function renderProgresso(feed, indice) {
    const total = Math.max(1, feed?.mensagens?.length || 0);

    progressoEl.innerHTML = Array.from({ length: total }, (_, i) => {
      const classe = i < indice ? "concluido" : i === indice ? "ativo" : "";

      return `
        <span class="status-whatsiapp-progresso-item ${classe}">
          <span></span>
        </span>
      `;
    }).join("");
  }

  function fecharVisualizador() {
    tokenVisualizador += 1;
    limparTimerAvanco();
    feedAtual = null;
    indiceStatusAtual = 0;
    conteudoEl.innerHTML = "";
    progressoEl.innerHTML = "";
    feedbackReacaoEl.textContent = "";
    if (respostaStatusEl) {
      respostaStatusEl.value = "";
    }
    meuControlesEl.hidden = true;
    menuMeuStatusBtn.hidden = true;
    menuMeuStatusPainel.hidden = true;
    visualizadoresPainelEl.hidden = true;
    viewerEl.hidden = true;
    vazioEl.hidden = false;
  }

  function feedIndiceGlobal(feed) {
    return feedsStatus.findIndex(
      (item) => String(item?.id || "") === String(feed?.id || ""),
    );
  }

  function proximoStatus() {
    if (!feedAtual) {
      return;
    }

    if (indiceStatusAtual < feedAtual.mensagens.length - 1) {
      indiceStatusAtual += 1;
      void mostrarStatusAtual();
      return;
    }

    if (feedAtual.meu) {
      fecharVisualizador();
      return;
    }

    const indiceFeed = feedIndiceGlobal(feedAtual);

    if (indiceFeed >= 0 && indiceFeed < feedsStatus.length - 1) {
      abrirFeed(feedsStatus[indiceFeed + 1]);
      return;
    }

    fecharVisualizador();
  }

  function statusAnterior() {
    if (!feedAtual) {
      return;
    }

    if (indiceStatusAtual > 0) {
      indiceStatusAtual -= 1;
      void mostrarStatusAtual();
      return;
    }

    if (feedAtual.meu) {
      return;
    }

    const indiceFeed = feedIndiceGlobal(feedAtual);

    if (indiceFeed > 0) {
      const anterior = feedsStatus[indiceFeed - 1];
      abrirFeed(anterior, Math.max(0, anterior.mensagens.length - 1));
    }
  }

  async function marcarComoVisto(feed, mensagem) {
    if (!feed || feed.meu || !mensagem?.naoVista) {
      return;
    }

    mensagem.naoVista = false;
    feed.unreadCount = Math.max(0, (Number(feed.unreadCount || 0) || 0) - 1);

    renderListaStatus();

    try {
      const resultado = await ipcRenderer.invoke(
        "marcar-status-visto-whatsapp",
        {
          contatoId: feed.id,
          idFeed: feed.idFeed || null,
          idMensagem: mensagem.idMensagem,
          idMensagemRaw: mensagem.idMensagemRaw || null,
        },
      );

      if (!resultado?.ok) {
        console.warn(
          "[STATUS UI] falha ao marcar visto:",
          resultado?.erro || "sem detalhe",
        );
      }
    } catch (erro) {
      console.warn(
        "[STATUS UI] falha ao marcar visto:",
        erro?.message || erro || "erro desconhecido",
      );
    }
  }

  function mostrarErroConteudo(texto) {
    conteudoEl.innerHTML = `
      <div class="status-whatsiapp-conteudo-erro">
        <strong>Não foi possível abrir este status</strong>
        <span>${escaparHtml(texto || "Mídia indisponível.")}</span>
      </div>
    `;
  }

  async function carregarMidiaStatus(feed, mensagem, token) {
    if (mensagem.mediaUrl) {
      return mensagem.mediaUrl;
    }

    const resultado = await ipcRenderer.invoke(
      "carregar-midia-status-whatsapp",
      {
        contatoId: feed?.id || null,
        idFeed: feed?.idFeed || null,
        idMensagem: mensagem.idMensagem,
        idMensagemRaw: mensagem.idMensagemRaw || null,
        tipo: mensagem.tipo,
        mime: mensagem.mime,
      },
    );

    if (token !== tokenVisualizador) {
      return null;
    }

    if (!resultado?.ok || !resultado?.mediaUrl) {
      throw new Error(
        resultado?.erro || "O WhatsApp não disponibilizou esta mídia.",
      );
    }

    mensagem.mediaUrl = resultado.mediaUrl;
    mensagem.mediaPath = resultado.mediaPath || null;
    mensagem.mime = resultado.mime || mensagem.mime || null;

    return mensagem.mediaUrl;
  }

  function agendarAvanco(ms) {
    limparTimerAvanco();

    timerAvanco = setTimeout(
      () => {
        timerAvanco = null;
        proximoStatus();
      },
      Math.max(1500, Number(ms || 0) || 6000),
    );
  }

  function statusAtualSelecionado() {
    return {
      feed: feedAtual,
      mensagem: feedAtual?.mensagens?.[indiceStatusAtual] || null,
    };
  }

  function fecharVisualizadores() {
    visualizadoresPainelEl.hidden = true;
    visualizadoresListaEl.innerHTML = "";
    visualizadoresResumoEl.textContent = "";
  }

  function formatarHorarioVisualizacao(timestamp) {
    const numero = Number(timestamp || 0);
    if (!numero) return "";
    const ms = numero > 1000000000000 ? numero : numero * 1000;
    return new Date(ms).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function carregarVisualizadoresStatus({ abrirPainel = false } = {}) {
    const { feed, mensagem } = statusAtualSelecionado();

    if (!feed?.meu || !mensagem?.idMensagem) {
      return;
    }

    if (abrirPainel) {
      limparTimerAvanco();
      visualizadoresPainelEl.hidden = false;
      visualizadoresResumoEl.textContent = "Carregando...";
      visualizadoresListaEl.innerHTML = `
        <div class="status-whatsiapp-visualizadores-carregando">
          <span class="status-whatsiapp-spinner"></span>
        </div>
      `;
    }

    try {
      const resultado = await ipcRenderer.invoke(
        "listar-visualizadores-status-whatsapp",
        {
          contatoId: feed.id,
          idFeed: feed.idFeed || null,
          idMensagem: mensagem.idMensagem,
          idMensagemRaw: mensagem.idMensagemRaw || null,
        },
      );

      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível consultar as visualizações.",
        );
      }

      const visualizadores = Array.isArray(resultado.visualizadores)
        ? resultado.visualizadores
        : [];

      mensagem.visualizadores = visualizadores;
      mensagem.totalVisualizacoes = visualizadores.length;
      visualizacoesTotalEl.textContent = String(visualizadores.length);

      if (!abrirPainel) {
        return;
      }

      visualizadoresResumoEl.textContent =
        visualizadores.length === 1
          ? "1 pessoa visualizou"
          : `${visualizadores.length} pessoas visualizaram`;

      if (!visualizadores.length) {
        visualizadoresListaEl.innerHTML = `
          <div class="status-whatsiapp-visualizadores-vazio">
            Ainda não há visualizações para este status.
          </div>
        `;
        return;
      }

      visualizadoresListaEl.innerHTML = visualizadores
        .map(
          (item) => `
            <div class="status-whatsiapp-visualizador-item">
              <span class="status-whatsiapp-visualizador-avatar">${escaparHtml(
                iniciais(item?.nome || item?.id || "?"),
              )}</span>
              <span class="status-whatsiapp-visualizador-texto">
                <strong>${escaparHtml(item?.nome || "Contato")}</strong>
                <small>${escaparHtml(
                  formatarHorarioVisualizacao(item?.visualizadoEm),
                )}</small>
              </span>
            </div>
          `,
        )
        .join("");
    } catch (erro) {
      if (abrirPainel) {
        visualizadoresResumoEl.textContent = "Não foi possível carregar";
        visualizadoresListaEl.innerHTML = `
          <div class="status-whatsiapp-visualizadores-vazio">
            ${escaparHtml(
              erro?.message || "Falha ao consultar as visualizações.",
            )}
          </div>
        `;
      }
    }
  }

  function resetarPublicador() {
    midiaPublicacao = null;
    corFundoPublicacao = "#005c4b";
    publicandoStatus = false;
    publicadorEscolhaEl.hidden = false;
    publicadorTextoEl.hidden = true;
    publicadorMidiaEl.hidden = true;
    publicadorFeedbackEl.textContent = "";
    textoStatusEl.value = "";
    legendaStatusEl.value = "";
    textoPreviewEl.style.background = corFundoPublicacao;
    midiaPreviewEl.innerHTML = "";
    publicadorEl
      .querySelectorAll("[data-status-cor]")
      .forEach((botao) =>
        botao.classList.toggle(
          "selecionada",
          botao.dataset.statusCor === corFundoPublicacao,
        ),
      );
  }

  function abrirPublicador() {
    limparTimerAvanco();
    menuMeuStatusPainel.hidden = true;
    fecharVisualizadores();
    resetarPublicador();
    publicadorEl.hidden = false;
  }

  function fecharPublicador() {
    if (publicandoStatus) {
      return;
    }

    publicadorEl.hidden = true;
    resetarPublicador();

    if (feedAtual) {
      void mostrarStatusAtual();
    }
  }

  function abrirCompositorTextoStatus() {
    publicadorEscolhaEl.hidden = true;
    publicadorMidiaEl.hidden = true;
    publicadorTextoEl.hidden = false;
    textoStatusEl.focus();
  }

  async function selecionarMidiaStatus() {
    try {
      publicadorFeedbackEl.textContent = "";

      const selecionado = await ipcRenderer.invoke("selecionar-anexo", {
        tipo: "midia",
      });

      if (!selecionado?.ok) {
        if (!selecionado?.cancelado) {
          publicadorFeedbackEl.textContent =
            selecionado?.erro || "Não foi possível selecionar o arquivo.";
        }
        return;
      }

      if (selecionado.tipo === "video") {
        midiaPublicacao = null;
        publicadorFeedbackEl.textContent =
          "Publicação de vídeo em Status está temporariamente indisponível.";
        return;
      }

      midiaPublicacao = selecionado;
      publicadorEscolhaEl.hidden = true;
      publicadorTextoEl.hidden = true;
      publicadorMidiaEl.hidden = false;
      midiaPreviewEl.innerHTML = "";

      const src = pathToFileURL(selecionado.caminho).href;
      const imagem = documentRef.createElement("img");
      imagem.src = src;
      imagem.alt = "Prévia do status";
      imagem.className = "status-whatsiapp-publicador-preview-midia";
      midiaPreviewEl.appendChild(imagem);
    } catch (erro) {
      publicadorFeedbackEl.textContent =
        erro?.message || "Não foi possível selecionar o arquivo.";
    }
  }

  async function finalizarPublicacaoStatus(dados) {
    if (publicandoStatus) {
      return;
    }

    publicandoStatus = true;
    publicadorFeedbackEl.textContent = "Publicando...";

    publicadorEl
      .querySelectorAll("button, textarea, input")
      .forEach((controle) => {
        controle.disabled = true;
      });

    try {
      const resultado = await ipcRenderer.invoke(
        "publicar-status-whatsapp",
        dados,
      );

      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "O WhatsApp não confirmou a publicação.",
        );
      }

      publicadorFeedbackEl.textContent = "Status publicado";

      await new Promise((resolve) => setTimeout(resolve, 350));
      publicadorEl.hidden = true;

      // O WhatsApp e a unica fonte de verdade. Nao criamos mais uma copia
      // local do Status, evitando duplicidade visual.
      void carregarStatus({ silencioso: true });

      setTimeout(() => {
        void carregarStatus({ silencioso: true });
      }, 1800);

      setTimeout(() => {
        void carregarStatus({ silencioso: true });
      }, 4500);
    } catch (erro) {
      publicadorFeedbackEl.textContent =
        erro?.message || "Não foi possível publicar o status.";
    } finally {
      publicandoStatus = false;
      publicadorEl
        .querySelectorAll("button, textarea, input")
        .forEach((controle) => {
          controle.disabled = false;
        });
    }
  }

  async function publicarTextoStatus() {
    const texto = String(textoStatusEl.value || "").trim();

    if (!texto) {
      publicadorFeedbackEl.textContent = "Digite um texto para publicar.";
      textoStatusEl.focus();
      return;
    }

    await finalizarPublicacaoStatus({
      tipo: "texto",
      texto,
      corFundo: corFundoPublicacao,
    });
  }

  async function publicarMidiaStatus() {
    if (!midiaPublicacao?.caminho || !midiaPublicacao?.tipo) {
      publicadorFeedbackEl.textContent = "Selecione uma foto.";
      return;
    }

    if (midiaPublicacao.tipo === "video") {
      publicadorFeedbackEl.textContent =
        "Publicação de vídeo em Status está temporariamente indisponível.";
      return;
    }

    await finalizarPublicacaoStatus({
      tipo: midiaPublicacao.tipo,
      caminho: midiaPublicacao.caminho,
      legenda: String(legendaStatusEl.value || "").trim(),
    });
  }

  function fecharModalStatus(resultado = false) {
    if (!modalStatusEl) {
      return;
    }

    modalStatusEl.hidden = true;
    const resolver = resolverModalStatus;
    resolverModalStatus = null;

    if (typeof resolver === "function") {
      resolver(!!resultado);
    }
  }

  function abrirModalStatus({
    titulo = "Aviso",
    texto = "",
    confirmar = "OK",
    mostrarCancelar = false,
    perigoso = false,
  } = {}) {
    if (!modalStatusEl) {
      return Promise.resolve(false);
    }

    if (resolverModalStatus) {
      fecharModalStatus(false);
    }

    modalStatusTituloEl.textContent = String(titulo || "Aviso");
    modalStatusTextoEl.textContent = String(texto || "");
    modalStatusConfirmarBtn.textContent = String(confirmar || "OK");
    modalStatusConfirmarBtn.classList.toggle("perigo", !!perigoso);
    modalStatusConfirmarBtn.classList.toggle("primario", !perigoso);
    modalStatusCancelarBtn.hidden = !mostrarCancelar;
    modalStatusEl.hidden = false;

    setTimeout(() => modalStatusConfirmarBtn?.focus(), 0);

    return new Promise((resolve) => {
      resolverModalStatus = resolve;
    });
  }

  async function mostrarAvisoStatus(titulo, texto) {
    await abrirModalStatus({
      titulo,
      texto,
      confirmar: "OK",
      mostrarCancelar: false,
    });
  }

  function confirmarExclusaoStatus() {
    return abrirModalStatus({
      titulo: "Apagar status?",
      texto:
        "Esta atualização será apagada para todos e não poderá ser recuperada.",
      confirmar: "Apagar",
      mostrarCancelar: true,
      perigoso: true,
    });
  }

  async function baixarMeuStatus() {
    const { feed, mensagem } = statusAtualSelecionado();

    if (!feed?.meu || !["imagem", "video"].includes(mensagem?.tipo)) {
      return;
    }

    menuMeuStatusPainel.hidden = true;

    const resultado = await ipcRenderer.invoke("salvar-midia-status-whatsapp", {
      contatoId: feed.id,
      idFeed: feed.idFeed || null,
      idMensagem: mensagem.idMensagem,
      idMensagemRaw: mensagem.idMensagemRaw || null,
      tipo: mensagem.tipo,
      mime: mensagem.mime,
    });

    if (resultado?.ok) {
      return;
    }

    if (!resultado?.cancelado) {
      await mostrarAvisoStatus(
        "Não foi possível salvar",
        resultado?.erro || "Não foi possível salvar este status.",
      );
    }
  }

  async function apagarMeuStatus() {
    const { feed, mensagem } = statusAtualSelecionado();

    if (!feed?.meu || !mensagem?.idMensagem) {
      return;
    }

    menuMeuStatusPainel.hidden = true;

    const confirmou = await confirmarExclusaoStatus();

    if (!confirmou) {
      return;
    }

    const resultado = await ipcRenderer.invoke("apagar-status-whatsapp", {
      contatoId: feed.id,
      idFeed: feed.idFeed || null,
      idMensagem: mensagem.idMensagem,
      idMensagemRaw: mensagem.idMensagemRaw || null,
    });

    if (!resultado?.ok) {
      await mostrarAvisoStatus(
        "Não foi possível apagar",
        resultado?.erro || "Não foi possível apagar este status.",
      );
      return;
    }

    fecharVisualizador();
    await carregarStatus({ silencioso: true });
  }

  async function mostrarStatusAtual() {
    limparTimerAvanco();

    const feed = feedAtual;
    const mensagem = feed?.mensagens?.[indiceStatusAtual];

    if (!feed || !mensagem) {
      fecharVisualizador();
      return;
    }

    const token = ++tokenVisualizador;

    vazioEl.hidden = true;
    viewerEl.hidden = false;
    nomeViewerEl.textContent = feed.nome || "Contato";
    horarioViewerEl.textContent = formatarHorarioStatus(mensagem.timestamp);
    feedbackReacaoEl.textContent = "";
    if (respostaStatusEl) {
      respostaStatusEl.value = "";
    }
    renderAvatarViewer(feed);
    renderProgresso(feed, indiceStatusAtual);

    reacoesEl.classList.toggle("status-whatsiapp-reacoes-ocultas", !!feed.meu);
    meuControlesEl.hidden = !feed.meu;
    menuMeuStatusBtn.hidden = !feed.meu;
    menuMeuStatusPainel.hidden = true;
    visualizadoresPainelEl.hidden = true;

    if (feed.meu) {
      const totalCache = Number(mensagem?.totalVisualizacoes);
      visualizacoesTotalEl.textContent = Number.isFinite(totalCache)
        ? String(totalCache)
        : "...";
      baixarMeuStatusBtn.hidden = !["imagem", "video"].includes(mensagem.tipo);

      void carregarVisualizadoresStatus({ abrirPainel: false });
    }

    void marcarComoVisto(feed, mensagem);

    if (mensagem.tipo === "texto") {
      const texto = String(mensagem.texto || "").trim() || "Status sem texto";

      conteudoEl.innerHTML = `
        <div
          class="status-whatsiapp-texto"
          style="background:${escaparHtml(corStatusTexto(mensagem.corFundo))}"
        >
          <div>${escaparHtml(texto)}</div>
        </div>
      `;

      agendarAvanco(6500);
      return;
    }

    if (mensagem.tipo !== "imagem" && mensagem.tipo !== "video") {
      mostrarErroConteudo("Formato de status ainda não suportado.");
      agendarAvanco(4500);
      return;
    }

    conteudoEl.innerHTML = `
      <div class="status-whatsiapp-midia-carregando">
        <span class="status-whatsiapp-spinner"></span>
        <span>Carregando mídia...</span>
      </div>
    `;

    try {
      const mediaUrl = await carregarMidiaStatus(feed, mensagem, token);

      if (!mediaUrl || token !== tokenVisualizador) {
        return;
      }

      conteudoEl.innerHTML = "";

      if (mensagem.tipo === "imagem") {
        const imagem = documentRef.createElement("img");
        imagem.className = "status-whatsiapp-midia status-whatsiapp-imagem";
        imagem.alt = mensagem.texto
          ? `Status: ${mensagem.texto}`
          : "Imagem do status";
        imagem.src = mediaUrl;

        imagem.addEventListener(
          "load",
          () => {
            if (token === tokenVisualizador) {
              agendarAvanco(7000);
            }
          },
          { once: true },
        );

        imagem.addEventListener(
          "error",
          () => {
            if (token === tokenVisualizador) {
              mostrarErroConteudo("A imagem não pôde ser exibida.");
            }
          },
          { once: true },
        );

        conteudoEl.appendChild(imagem);
      } else {
        const video = documentRef.createElement("video");
        video.className = "status-whatsiapp-midia status-whatsiapp-video";
        video.src = mediaUrl;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = "auto";

        video.addEventListener("ended", () => {
          if (token === tokenVisualizador) {
            proximoStatus();
          }
        });

        video.addEventListener("error", () => {
          if (token === tokenVisualizador) {
            mostrarErroConteudo("O vídeo não pôde ser reproduzido.");
          }
        });

        video.addEventListener("click", () => {
          if (video.paused) {
            void video.play().catch(() => {});
          } else {
            video.pause();
          }
        });

        conteudoEl.appendChild(video);

        void video.play().catch(() => {
          video.controls = true;
        });
      }

      if (mensagem.texto) {
        const legenda = documentRef.createElement("div");
        legenda.className = "status-whatsiapp-legenda";
        legenda.textContent = mensagem.texto;
        conteudoEl.appendChild(legenda);
      }
    } catch (erro) {
      if (token === tokenVisualizador) {
        mostrarErroConteudo(
          erro?.message || "Não foi possível carregar esta mídia.",
        );
      }
    }
  }

  function abrirFeed(feed, indiceForcado = null) {
    if (!feed?.mensagens?.length) {
      return;
    }

    feedAtual = feed;

    if (Number.isInteger(indiceForcado)) {
      indiceStatusAtual = Math.max(
        0,
        Math.min(feed.mensagens.length - 1, indiceForcado),
      );
    } else {
      const primeiraNaoVista = feed.mensagens.findIndex(
        (item) => item?.naoVista,
      );

      indiceStatusAtual = primeiraNaoVista >= 0 ? primeiraNaoVista : 0;
    }

    void mostrarStatusAtual();

    if (!feed.fotoUrl) {
      void carregarFotoFeed(feed, !!feed.meu);
    }
  }

  async function reagirStatus(emoji, botao) {
    const feed = feedAtual;
    const mensagem = feed?.mensagens?.[indiceStatusAtual];

    if (!feed || feed.meu || !mensagem?.idMensagem) {
      return;
    }

    const botoes = reacoesEl.querySelectorAll("[data-reacao]");

    botoes.forEach((item) => {
      item.disabled = true;
    });

    feedbackReacaoEl.textContent = "Enviando...";

    try {
      const resultado = await ipcRenderer.invoke("reagir-status-whatsapp", {
        contatoId: feed.id,
        idFeed: feed.idFeed || null,
        idMensagem: mensagem.idMensagem,
        idMensagemRaw: mensagem.idMensagemRaw || null,
        emoji,
      });

      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "O WhatsApp não confirmou a reação.",
        );
      }

      registrarContextoRespostaStatus(resultado, feed, mensagem);

      feedbackReacaoEl.textContent = `${emoji} Reação enviada`;
      botao?.classList.add("status-whatsiapp-reacao-enviada");

      setTimeout(() => {
        botao?.classList.remove("status-whatsiapp-reacao-enviada");

        if (feedbackReacaoEl.textContent.includes("Reação enviada")) {
          feedbackReacaoEl.textContent = "";
        }
      }, 1800);
    } catch (erro) {
      feedbackReacaoEl.textContent =
        erro?.message || "Não foi possível reagir ao status.";
    } finally {
      botoes.forEach((item) => {
        item.disabled = false;
      });
    }
  }

  async function responderStatusPorChat() {
    const feed = feedAtual;
    const mensagem = feed?.mensagens?.[indiceStatusAtual];
    const texto = String(respostaStatusEl?.value || "").trim();

    if (!feed || feed.meu || !mensagem?.idMensagem || !texto) {
      return;
    }

    const botoesReacao = reacoesEl.querySelectorAll("[data-reacao]");

    if (respostaStatusEl) {
      respostaStatusEl.disabled = true;
    }

    if (enviarRespostaStatusBtn) {
      enviarRespostaStatusBtn.disabled = true;
    }

    botoesReacao.forEach((item) => {
      item.disabled = true;
    });

    feedbackReacaoEl.textContent = "Enviando...";

    try {
      const resultado = await ipcRenderer.invoke("responder-status-whatsapp", {
        contatoId: feed.id,
        idFeed: feed.idFeed || null,
        idMensagem: mensagem.idMensagem,
        idMensagemRaw: mensagem.idMensagemRaw || null,
        texto,
      });

      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "O WhatsApp não confirmou a resposta.",
        );
      }

      registrarContextoRespostaStatus(resultado, feed, mensagem);

      if (respostaStatusEl) {
        respostaStatusEl.value = "";
      }

      feedbackReacaoEl.textContent = "Resposta enviada";

      setTimeout(() => {
        if (feedbackReacaoEl.textContent === "Resposta enviada") {
          feedbackReacaoEl.textContent = "";
        }
      }, 1800);
    } catch (erro) {
      feedbackReacaoEl.textContent =
        erro?.message || "Não foi possível responder ao status.";
    } finally {
      if (respostaStatusEl) {
        respostaStatusEl.disabled = false;
        respostaStatusEl.focus();
      }

      if (enviarRespostaStatusBtn) {
        enviarRespostaStatusBtn.disabled = false;
      }

      botoesReacao.forEach((item) => {
        item.disabled = false;
      });
    }
  }

  function iniciarAtualizacaoAutomatica() {
    clearInterval(timerAtualizacao);

    timerAtualizacao = setInterval(() => {
      if (body.classList.contains("whatsiapp-status-aberto") && !feedAtual) {
        void carregarStatus({ silencioso: true });
      }
    }, 20000);
  }

  function pararAtualizacaoAutomatica() {
    clearInterval(timerAtualizacao);
    timerAtualizacao = null;
  }

  function idRawStatus(valor) {
    const texto = String(valor || "").trim();

    if (!texto) {
      return "";
    }

    const partes = texto.split("_").filter(Boolean);
    const indiceBroadcast = partes.findIndex((parte) =>
      String(parte).toLowerCase().includes("status@broadcast"),
    );

    if (indiceBroadcast >= 0 && partes[indiceBroadcast + 1]) {
      return String(partes[indiceBroadcast + 1]).trim();
    }

    return texto;
  }

  function mensagemStatusCorresponde(mensagem, alvo = {}) {
    const candidatosAlvo = new Set(
      [
        alvo?.idMensagem,
        alvo?.idMensagemWpp,
        idRawStatus(alvo?.idMensagem),
        idRawStatus(alvo?.idMensagemWpp),
      ]
        .map((valor) => String(valor || "").trim())
        .filter(Boolean),
    );

    if (!candidatosAlvo.size || !mensagem) {
      return false;
    }

    const candidatosMensagem = new Set(
      [
        mensagem.idMensagem,
        mensagem.idMensagemRaw,
        idRawStatus(mensagem.idMensagem),
        idRawStatus(mensagem.idMensagemRaw),
      ]
        .map((valor) => String(valor || "").trim())
        .filter(Boolean),
    );

    for (const candidato of candidatosAlvo) {
      if (candidatosMensagem.has(candidato)) {
        return true;
      }
    }

    return false;
  }

  async function aguardarCargaStatusAtual() {
    const limite = Date.now() + 5000;

    while (carregandoLista && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function abrirStatusCitado(alvo = {}) {
    fecharPerfilContatoAntesDeAbrirStatus();
    statusAbertoPorCitacao = true;

    body.classList.add("whatsiapp-status-aberto");
    btnStatus.classList.add("ativa");
    btnStatus.setAttribute("aria-pressed", "true");

    for (const botao of botoesRailExistentes) {
      botao.classList.remove("ativa");
    }

    fecharVisualizador();
    iniciarAtualizacaoAutomatica();

    if (carregandoLista) {
      await aguardarCargaStatusAtual();
    }

    await carregarStatus();
    await aguardarCargaStatusAtual();

    const feeds = alvo?.preferirMeuStatus
      ? [meuStatus].filter(Boolean)
      : [meuStatus, ...feedsStatus].filter(Boolean);

    console.log(
      `[STATUS UI] PROCURANDO_STATUS_CITADO | id=${String(
        alvo?.idMensagem || alvo?.idMensagemWpp || "",
      )} | feeds=${feeds.length} | meu=${!!alvo?.preferirMeuStatus}`,
    );

    for (const feed of feeds) {
      const indice = (feed?.mensagens || []).findIndex((mensagem) =>
        mensagemStatusCorresponde(mensagem, alvo),
      );

      if (indice >= 0) {
        abrirFeed(feed, indice);
        console.log(
          `[STATUS UI] STATUS_CITADO_ABERTO | id=${String(
            alvo?.idMensagem || alvo?.idMensagemWpp || "",
          )}`,
        );
        return true;
      }
    }

    await mostrarAvisoStatus(
      "Status indisponível",
      "Este status não está mais disponível. Ele pode ter expirado ou sido apagado.",
    );

    console.log(
      `[STATUS UI] STATUS_CITADO_NAO_ENCONTRADO | id=${String(
        alvo?.idMensagem || alvo?.idMensagemWpp || "",
      )}`,
    );

    return false;
  }

  function abrirStatus() {
    statusAbertoPorCitacao = false;
    body.classList.add("whatsiapp-status-aberto");
    btnStatus.classList.add("ativa");
    btnStatus.setAttribute("aria-pressed", "true");

    for (const botao of botoesRailExistentes) {
      botao.classList.remove("ativa");
    }

    fecharVisualizador();
    void carregarStatus();
    iniciarAtualizacaoAutomatica();

    console.log("[STATUS UI] aberto");
  }

  function fecharStatus() {
    if (!body.classList.contains("whatsiapp-status-aberto")) {
      return;
    }

    statusAbertoPorCitacao = false;
    body.classList.remove("whatsiapp-status-aberto");
    btnStatus.classList.remove("ativa");
    btnStatus.setAttribute("aria-pressed", "false");
    fecharVisualizador();
    pararAtualizacaoAutomatica();

    console.log("[STATUS UI] fechado");
  }

  function fecharViewerOuVoltarConversa() {
    if (statusAbertoPorCitacao) {
      fecharStatus();
      return;
    }

    fecharVisualizador();
  }

  function fecharPerfilContatoAntesDeAbrirStatus() {
    if (!documentRef.querySelector(".perfil-contato-overlay")) {
      return;
    }

    try {
      documentRef.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    } catch (erro) {
      console.warn(
        "[STATUS UI] falha ao fechar perfil antes de abrir status:",
        erro?.message || erro || "erro desconhecido",
      );
    }
  }

  documentRef.addEventListener("whatsiapp:abrir-status-citado", (evento) => {
    void abrirStatusCitado(evento?.detail || {});
  });

  btnStatus.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    fecharPerfilContatoAntesDeAbrirStatus();
    abrirStatus();
  });

  for (const botao of botoesRailExistentes) {
    botao.addEventListener("click", fecharStatus);
  }

  const btnRailConfig = documentRef.getElementById("btnRailConfig");
  btnRailConfig?.addEventListener("click", fecharStatus);

  const botaoPerfilApp = documentRef.getElementById("botaoPerfilApp");
  botaoPerfilApp?.addEventListener("click", fecharStatus);

  documentRef
    .getElementById("btnAtualizarStatusWhatsIAPP")
    ?.addEventListener("click", () => {
      void carregarStatus();
    });

  documentRef
    .getElementById("statusWhatsIAPPFecharViewer")
    ?.addEventListener("click", fecharViewerOuVoltarConversa);

  documentRef
    .getElementById("statusWhatsIAPPAnterior")
    ?.addEventListener("click", statusAnterior);

  documentRef
    .getElementById("statusWhatsIAPPProximo")
    ?.addEventListener("click", proximoStatus);

  reacoesEl.querySelectorAll("[data-reacao]").forEach((botao) => {
    botao.addEventListener("click", () => {
      void reagirStatus(botao.dataset.reacao, botao);
    });
  });

  enviarRespostaStatusBtn?.addEventListener("click", () => {
    void responderStatusPorChat();
  });

  respostaStatusEl?.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" || evento.shiftKey) {
      return;
    }

    evento.preventDefault();
    void responderStatusPorChat();
  });

  respostaStatusEl?.addEventListener("focus", limparTimerAvanco);

  menuMeuStatusBtn?.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    menuMeuStatusPainel.hidden = !menuMeuStatusPainel.hidden;
  });

  documentRef
    .getElementById("statusWhatsIAPPVisualizadores")
    ?.addEventListener("click", () => {
      void carregarVisualizadoresStatus({ abrirPainel: true });
    });

  documentRef
    .getElementById("statusWhatsIAPPFecharVisualizadores")
    ?.addEventListener("click", fecharVisualizadores);

  baixarMeuStatusBtn?.addEventListener("click", () => {
    void baixarMeuStatus();
  });

  documentRef
    .getElementById("statusWhatsIAPPNovoMeuStatus")
    ?.addEventListener("click", abrirPublicador);

  documentRef
    .getElementById("statusWhatsIAPPApagarMeuStatus")
    ?.addEventListener("click", () => {
      void apagarMeuStatus();
    });

  modalStatusCancelarBtn?.addEventListener("click", () => {
    fecharModalStatus(false);
  });

  modalStatusConfirmarBtn?.addEventListener("click", () => {
    fecharModalStatus(true);
  });

  modalStatusEl?.addEventListener("click", (evento) => {
    if (evento.target === modalStatusEl) {
      fecharModalStatus(false);
    }
  });

  documentRef
    .getElementById("statusWhatsIAPPFecharPublicador")
    ?.addEventListener("click", fecharPublicador);

  documentRef
    .getElementById("statusWhatsIAPPPublicarTextoEscolha")
    ?.addEventListener("click", abrirCompositorTextoStatus);

  documentRef
    .getElementById("statusWhatsIAPPPublicarMidiaEscolha")
    ?.addEventListener("click", () => {
      void selecionarMidiaStatus();
    });

  documentRef
    .getElementById("statusWhatsIAPPTrocarMidiaStatus")
    ?.addEventListener("click", () => {
      void selecionarMidiaStatus();
    });

  documentRef
    .getElementById("statusWhatsIAPPEnviarTextoStatus")
    ?.addEventListener("click", () => {
      void publicarTextoStatus();
    });

  documentRef
    .getElementById("statusWhatsIAPPEnviarMidiaStatus")
    ?.addEventListener("click", () => {
      void publicarMidiaStatus();
    });

  textoStatusEl?.addEventListener("input", () => {
    textoPreviewEl.dataset.vazio = String(
      !String(textoStatusEl.value || "").trim(),
    );
  });

  publicadorEl?.querySelectorAll("[data-status-cor]").forEach((botao) => {
    botao.addEventListener("click", () => {
      corFundoPublicacao = botao.dataset.statusCor || "#005c4b";
      textoPreviewEl.style.background = corFundoPublicacao;
      publicadorEl
        .querySelectorAll("[data-status-cor]")
        .forEach((item) =>
          item.classList.toggle("selecionada", item === botao),
        );
    });
  });

  documentRef.addEventListener("click", (evento) => {
    if (
      !menuMeuStatusPainel.hidden &&
      !menuMeuStatusPainel.contains(evento.target) &&
      !menuMeuStatusBtn.contains(evento.target)
    ) {
      menuMeuStatusPainel.hidden = true;
    }
  });

  documentRef.addEventListener("keydown", (evento) => {
    if (modalStatusEl && !modalStatusEl.hidden && evento.key === "Escape") {
      evento.preventDefault();
      fecharModalStatus(false);
      return;
    }

    if (!body.classList.contains("whatsiapp-status-aberto") || !feedAtual) {
      return;
    }

    if (evento.key === "ArrowRight") {
      evento.preventDefault();
      proximoStatus();
    } else if (evento.key === "ArrowLeft") {
      evento.preventDefault();
      statusAnterior();
    } else if (evento.key === "Escape") {
      evento.preventDefault();

      if (!publicadorEl.hidden) {
        fecharPublicador();
      } else if (!visualizadoresPainelEl.hidden) {
        fecharVisualizadores();
      } else if (!menuMeuStatusPainel.hidden) {
        menuMeuStatusPainel.hidden = true;
      } else {
        fecharViewerOuVoltarConversa();
      }
    }
  });

  documentRef.addEventListener("visibilitychange", () => {
    if (documentRef.hidden) {
      limparTimerAvanco();
      return;
    }

    if (body.classList.contains("whatsiapp-status-aberto") && feedAtual) {
      void mostrarStatusAtual();
    }
  });

  console.log("[STATUS UI] inicializado");
})();
