"use strict";

(() => {
  const { ipcRenderer } = require("electron");

  const CHAVE_APARENCIA_CONVERSAS = "whatsiapp.aparenciaConversas.v1";
  const FONTE_PADRAO = 14;
  const FONTE_MINIMA = 12;
  const FONTE_MAXIMA = 18;

  const mensagens = document.getElementById("mensagens");
  const listaConversas = document.getElementById("listaConversas");

  function limitarFonte(valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return FONTE_PADRAO;
    return Math.max(FONTE_MINIMA, Math.min(FONTE_MAXIMA, Math.round(numero)));
  }

  function carregarAparencias() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_APARENCIA_CONVERSAS) || "{}",
      );
      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  function salvarAparencias(dados) {
    try {
      localStorage.setItem(CHAVE_APARENCIA_CONVERSAS, JSON.stringify(dados));
      return true;
    } catch (erro) {
      console.warn(
        `[UI] CHAT_FONT_STORAGE_SAVE_ERROR | error=${erro?.message || erro}`,
      );
      return false;
    }
  }

  function obterConversaAtiva() {
    return (
      document.querySelector("#listaConversas .conversa.ativa")?.dataset
        ?.conversaId || null
    );
  }

  function obterFonteConversa(conversaId) {
    if (!conversaId) return FONTE_PADRAO;
    const aparencias = carregarAparencias();
    return limitarFonte(aparencias?.[conversaId]?.fonteTamanho);
  }

  function aplicarFonteConversa(conversaId = obterConversaAtiva()) {
    if (!mensagens) return;
    const tamanho = obterFonteConversa(conversaId);
    mensagens.style.setProperty("--conversa-fonte-tamanho", `${tamanho}px`);
  }

  function configurarFonteNaPersonalizacao() {
    const corpo = document.querySelector(
      ".personalizar-conversa-overlay .personalizar-conversa-corpo",
    );
    const preview = document.querySelector(
      ".personalizar-conversa-overlay .personalizar-conversa-preview",
    );
    const botaoAbrir = document.querySelector(".chat-personalizar-conversa");
    const botaoAplicar = document.querySelector(
      ".personalizar-conversa-overlay .personalizar-conversa-aplicar",
    );
    const botaoRestaurar = document.querySelector(
      ".personalizar-conversa-overlay .personalizar-conversa-restaurar",
    );

    if (!corpo || !preview || !botaoAbrir || !botaoAplicar || !botaoRestaurar) {
      console.warn("[UI] CHAT_FONT_PERSONALIZER_NOT_FOUND");
      return;
    }

    const secao = document.createElement("div");
    secao.className = "personalizar-conversa-secao personalizar-secao-fonte";
    secao.innerHTML = `
      <div class="personalizar-conversa-secao-titulo">Tamanho da fonte</div>
      <div class="personalizar-fonte-linha">
        <input
          class="personalizar-fonte-range"
          type="range"
          min="${FONTE_MINIMA}"
          max="${FONTE_MAXIMA}"
          step="1"
          value="${FONTE_PADRAO}"
          aria-label="Tamanho da fonte desta conversa"
        >
        <span class="personalizar-fonte-valor">${FONTE_PADRAO} px</span>
      </div>
    `;

    const secaoPapeis = corpo.querySelector(".personalizar-secao-papeis");
    if (secaoPapeis) {
      corpo.insertBefore(secao, secaoPapeis);
    } else {
      corpo.appendChild(secao);
    }

    const seletor = secao.querySelector(".personalizar-fonte-range");
    const valor = secao.querySelector(".personalizar-fonte-valor");
    let conversaEmEdicao = null;
    let fonteRascunho = FONTE_PADRAO;

    function atualizarPreview() {
      fonteRascunho = limitarFonte(seletor?.value);
      if (valor) valor.textContent = `${fonteRascunho} px`;
      for (const mensagem of preview.querySelectorAll(".personalizar-preview-msg")) {
        mensagem.style.fontSize = `${fonteRascunho}px`;
      }
    }

    function sincronizarComConversaAtiva() {
      conversaEmEdicao = obterConversaAtiva();
      fonteRascunho = obterFonteConversa(conversaEmEdicao);
      if (seletor) seletor.value = String(fonteRascunho);
      atualizarPreview();
    }

    botaoAbrir.addEventListener("click", () => {
      setTimeout(sincronizarComConversaAtiva, 0);
    });

    seletor?.addEventListener("input", atualizarPreview);

    botaoAplicar.addEventListener("click", () => {
      const conversaId = conversaEmEdicao || obterConversaAtiva();
      if (!conversaId) return;

      // O personalizador original salva primeiro o fundo. Como este listener
      // foi registrado depois, apenas acrescentamos o tamanho sem perder os
      // campos ja existentes da aparencia da conversa.
      const aparencias = carregarAparencias();
      aparencias[conversaId] = {
        ...(aparencias[conversaId] || {}),
        fonteTamanho: limitarFonte(fonteRascunho),
      };
      salvarAparencias(aparencias);
      aplicarFonteConversa(conversaId);

      console.log(
        `[UI] CHAT_FONT_APPLY | conversation=${conversaId} | size=${limitarFonte(fonteRascunho)}`,
      );
    });

    botaoRestaurar.addEventListener("click", () => {
      fonteRascunho = FONTE_PADRAO;
      if (seletor) seletor.value = String(FONTE_PADRAO);
      atualizarPreview();
      setTimeout(() => aplicarFonteConversa(obterConversaAtiva()), 0);
    });
  }

  function observarTrocaConversa() {
    if (!listaConversas || typeof MutationObserver !== "function") return;

    let timer = null;
    const aplicarDepois = () => {
      clearTimeout(timer);
      timer = setTimeout(() => aplicarFonteConversa(), 0);
    };

    const observer = new MutationObserver(aplicarDepois);
    observer.observe(listaConversas, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    document.addEventListener("click", (evento) => {
      if (evento.target?.closest?.("#listaConversas .conversa")) {
        aplicarDepois();
      }
    });
  }

  function configurarLogoutSessoes() {
    const corpo = document.querySelector(
      "#painelConfiguracoesApp .config-app-corpo",
    );
    if (!corpo) {
      console.warn("[UI] SESSION_LOGOUT_SETTINGS_NOT_FOUND");
      return;
    }

    const divisor = document.createElement("div");
    divisor.className = "config-app-divisor config-app-divisor-compacto";

    const titulo = document.createElement("div");
    titulo.className = "config-app-secao-titulo";
    titulo.textContent = "Conexão do WhatsApp";

    const card = document.createElement("div");
    card.className = "config-sessao-whatsapp";
    card.innerHTML = `
      <strong>Sessões conectadas pelos QR Codes</strong>
      <p>Desconecta as duas sessões usadas pelo WhatsIAPP e remove estes dispositivos da lista de aparelhos conectados do WhatsApp. Depois será necessário ler novos QR Codes.</p>
      <button class="config-sessao-whatsapp-btn" type="button">Desconectar sessões</button>
      <div class="config-sessao-whatsapp-status" aria-live="polite"></div>
    `;

    corpo.appendChild(divisor);
    corpo.appendChild(titulo);
    corpo.appendChild(card);

    const botao = card.querySelector(".config-sessao-whatsapp-btn");
    const status = card.querySelector(".config-sessao-whatsapp-status");

    botao?.addEventListener("click", async () => {
      const confirmou = window.confirm(
        "Desconectar as duas sessões do WhatsIAPP?\n\nOs dispositivos serão removidos do WhatsApp no celular e, ao abrir novamente, será necessário ler os QR Codes outra vez.",
      );
      if (!confirmou) return;

      botao.disabled = true;
      status.className = "config-sessao-whatsapp-status";
      status.textContent = "Preparando desconexão segura...";

      try {
        const resultado = await ipcRenderer.invoke("whatsiapp-logout-sessoes");
        if (!resultado?.ok) {
          throw new Error(
            resultado?.erro || "Não foi possível iniciar a desconexão.",
          );
        }

        status.className = "config-sessao-whatsapp-status sucesso";
        status.textContent =
          "Desconectando as sessões. O WhatsIAPP será fechado e aberto novamente.";
      } catch (erro) {
        botao.disabled = false;
        status.className = "config-sessao-whatsapp-status erro";
        status.textContent = erro?.message || "Falha ao desconectar as sessões.";
      }
    });

    ipcRenderer
      .invoke("whatsiapp-logout-resultado")
      .then((resultado) => {
        if (!resultado?.existe) return;

        if (resultado.ok) {
          status.className = "config-sessao-whatsapp-status sucesso";
          status.textContent =
            "As sessões anteriores foram desconectadas. Conecte novamente pelos QR Codes.";
          return;
        }

        const detalhes = [
          resultado?.baileys?.erro,
          resultado?.wpp?.erro,
        ]
          .filter(Boolean)
          .join(" | ");

        status.className = "config-sessao-whatsapp-status erro";
        status.textContent =
          "A desconexão foi parcial. Tente novamente antes de reconectar.";
        window.alert(
          `Não foi possível desconectar todas as sessões.${detalhes ? `\n\n${detalhes}` : ""}`,
        );
      })
      .catch(() => {});
  }

  aplicarFonteConversa();
  configurarFonteNaPersonalizacao();
  observarTrocaConversa();
  configurarLogoutSessoes();
})();
