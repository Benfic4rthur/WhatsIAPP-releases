function criarBootstrapInterface(deps = {}) {
  const { document, escaparHtmlAdmin } = deps;

  const statusAppTopo = document.getElementById("status");
  const perfilRailArea = document.getElementById("perfilRailArea");

  const botaoPerfilApp = document.createElement("button");
  botaoPerfilApp.id = "botaoPerfilApp";
  botaoPerfilApp.type = "button";
  botaoPerfilApp.title = "Configurações";
  botaoPerfilApp.setAttribute("aria-label", "Abrir configurações");
  botaoPerfilApp.classList.add("status-conectando");

  const imagemPerfilApp = document.createElement("img");
  imagemPerfilApp.alt = "Minha foto";

  const fallbackPerfilApp = document.createElement("span");
  fallbackPerfilApp.className = "perfil-app-fallback";
  fallbackPerfilApp.textContent = "U";

  botaoPerfilApp.appendChild(imagemPerfilApp);
  botaoPerfilApp.appendChild(fallbackPerfilApp);

  if (perfilRailArea) {
    perfilRailArea.appendChild(botaoPerfilApp);
  } else if (statusAppTopo?.parentElement) {
    statusAppTopo.parentElement.appendChild(botaoPerfilApp);
  }

  function obterMarkupEstadoInicialChat(texto = "Selecione uma conversa") {
    const tituloContexto = escaparHtmlAdmin(
      String(texto || "Selecione uma conversa"),
    );
    return `
      <div class="vazio vazio-chat-home">
        <div class="vazio-chat-card">
          <div class="vazio-chat-badge">✨ EM DESENVOLVIMENTO</div>
          <div class="vazio-chat-titulo">O WhatsIAPP vai ficar ainda mais inteligente</div>
          <div class="vazio-chat-texto">${tituloContexto}. Enquanto isso, olha o que já está no nosso radar:</div>
          <div class="vazio-chat-recursos">
            <div class="vazio-chat-recurso">
              <div class="vazio-chat-recurso-icone">🚚</div>
              <div class="vazio-chat-recurso-conteudo">
                <strong>Integração com plataformas de entregas</strong>
                <span>Conecte serviços de entrega para agilizar o despacho e o acompanhamento dos seus pedidos.</span>
              </div>
              <small>Em breve</small>
            </div>
            <div class="vazio-chat-recurso">
              <div class="vazio-chat-recurso-icone">📦</div>
              <div class="vazio-chat-recurso-conteudo">
                <strong>Integração com o seu ERP</strong>
                <span>Conecte a API do seu ERP ao WhatsIAPP para consultar e manter o controle de estoque integrado.</span>
              </div>
              <small>Em breve</small>
            </div>
            <div class="vazio-chat-recurso">
              <div class="vazio-chat-recurso-icone">💳</div>
              <div class="vazio-chat-recurso-conteudo">
                <strong>Pagamentos e PIX automático</strong>
                <span>Integração com meios de pagamento, incluindo geração automática do QR Code PIX em cada venda autônoma.</span>
              </div>
              <small>Em breve</small>
            </div>
          </div>
          <div class="vazio-chat-dica">💬 Selecione uma conversa para começar</div>
        </div>
      </div>
    `;
  }

  const listaConversas = document.getElementById("listaConversas");
  const mensagens = document.getElementById("mensagens");
  const nomeChat = document.getElementById("nomeChat");
  const statusChat = document.getElementById("statusChat");
  const busca = document.getElementById("busca");
  if (busca) {
    busca.placeholder = "Pesquisar conversas e mensagens";
  }

  const abaConversas = document.getElementById("abaConversas");
  const abaNaoLidas = document.getElementById("abaNaoLidas");
  const abaFavoritos = document.getElementById("abaFavoritos");
  const abaGrupos = document.getElementById("abaGrupos");
  const abaMais = document.getElementById("abaMais");
  const abaArquivadas = document.getElementById("abaArquivadas");
  const contadorArquivadas = document.getElementById("contadorArquivadas");
  const contadorNaoLidas = document.getElementById("contadorNaoLidas");
  const contadorFavoritos = document.getElementById("contadorFavoritos");
  const abasFiltros = document.getElementById("abasFiltros");
  const lateralTitulo = document.getElementById("lateralTitulo");
  const btnRailConversas = document.getElementById("btnRailConversas");
  const btnRailArquivadas = document.getElementById("btnRailArquivadas");
  const btnRailFavoritos = document.getElementById("btnRailFavoritos");
  const btnRailTrancadas = document.getElementById("btnRailTrancadas");
  const btnRailConfig = document.getElementById("btnRailConfig");
  const btnMenuConversas = document.getElementById("btnMenuConversas");
  const chatPrincipal = document.querySelector(".chat");

  // Elementos internos usados pelo modulo de privacidade.
  // Permanecem ocultos e precisam existir antes da inicializacao do modulo.
  const botaoArquivar = document.createElement("button");
  botaoArquivar.id = "botaoArquivar";
  botaoArquivar.className = "modo";
  botaoArquivar.type = "button";
  botaoArquivar.textContent = "Arquivar";
  botaoArquivar.style.display = "none";

  const botaoTrancar = document.createElement("button");
  botaoTrancar.id = "botaoTrancar";
  botaoTrancar.className = "modo";
  botaoTrancar.type = "button";
  botaoTrancar.textContent = "Trancar";
  botaoTrancar.style.display = "none";

  function finalizarInterface(integracoes = {}) {
    const {
      atualizarCompositor,
      ajustarAlturaCampoMensagem,
      prepararCabecalhoContato,
      atualizarCabecalhoConversa,
      carregarMinhaFotoPerfil,
      aplicarModoIA,
      fecharConfiguracoesApp,
    } = integracoes;

    atualizarCompositor?.();
    ajustarAlturaCampoMensagem?.();
    prepararCabecalhoContato?.();
    atualizarCabecalhoConversa?.();

    setTimeout(() => {
      carregarMinhaFotoPerfil?.();
    }, 3000);

    aplicarModoIA?.("manual", false);

    const tituloConfigFinal = document.querySelector(".config-app-titulo");
    if (tituloConfigFinal) {
      tituloConfigFinal.textContent = "Configurações";
    }

    const descricaoConfigFinal = document.querySelector(
      ".config-app-secao-desc",
    );
    if (descricaoConfigFinal) {
      descricaoConfigFinal.textContent =
        "Configure a conexão, acompanhe o consumo e ajuste o comportamento da IA.";
    }

    if (fecharConfiguracoesApp) {
      fecharConfiguracoesApp.textContent = "×";
      fecharConfiguracoesApp.setAttribute("aria-label", "Fechar configurações");
    }

    botaoPerfilApp.title = "Configurações";
    botaoPerfilApp.setAttribute("aria-label", "Abrir configurações");
  }

  return {
    botaoPerfilApp,
    imagemPerfilApp,
    fallbackPerfilApp,
    listaConversas,
    mensagens,
    nomeChat,
    statusChat,
    busca,
    abaConversas,
    abaNaoLidas,
    abaFavoritos,
    abaGrupos,
    abaMais,
    abaArquivadas,
    contadorArquivadas,
    contadorNaoLidas,
    contadorFavoritos,
    abasFiltros,
    lateralTitulo,
    btnRailConversas,
    btnRailArquivadas,
    btnRailFavoritos,
    btnRailTrancadas,
    btnRailConfig,
    btnMenuConversas,
    chatPrincipal,
    botaoArquivar,
    botaoTrancar,
    obterMarkupEstadoInicialChat,
    finalizarInterface,
  };
}

module.exports = {
  criarBootstrapInterface,
};
