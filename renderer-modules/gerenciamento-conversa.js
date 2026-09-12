function criarModuloGerenciamentoConversa(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    conversas,
    statusChat,
    naoLidasPersistidas,
    salvarNaoLidasPersistidas,
    registrarConversaLimpaLocalmente,
    registrarConversaApagadaLocalmente,
    limparPersistenciasMensagensDaConversa,
    obterMensagemRespondendo,
    limparRespostaMensagem,
    recalcularNaoLidasGlobal,
    atualizarContadores,
    renderConversas,
    obterConversaAtual,
    renderMensagens,
    atualizarStatusCabecalho,
    limparSelecaoConversa,
  } = dependencias;

  function abrirConfirmacaoGerenciamentoConversa(conversa, acao) {
    if (!conversa?.id || !["limpar", "apagar"].includes(acao)) {
      return;
    }

    const limpando = acao === "limpar";
    const overlay = document.createElement("div");

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "120250",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      boxSizing: "border-box",
      background: "rgba(0,0,0,.72)",
    });

    const caixa = document.createElement("section");
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-modal", "true");
    caixa.setAttribute(
      "aria-label",
      limpando ? "Limpar conversa" : "Apagar conversa",
    );

    Object.assign(caixa.style, {
      width: "440px",
      maxWidth: "100%",
      padding: "22px",
      borderRadius: "15px",
      border: "1px solid #2b3941",
      background: "#111a1f",
      boxShadow: "0 22px 65px rgba(0,0,0,.58)",
      color: "#e9edef",
      boxSizing: "border-box",
    });

    const titulo = document.createElement("div");
    titulo.textContent = limpando ? "Limpar conversa?" : "Apagar conversa?";

    Object.assign(titulo.style, {
      marginBottom: "8px",
      fontSize: "18px",
      fontWeight: "800",
    });

    const descricao = document.createElement("div");
    descricao.textContent = limpando
      ? "As mensagens serão removidas, mas a conversa continuará na sua lista."
      : "A conversa e as mensagens serão removidas da sua lista. Se uma nova mensagem chegar depois, a conversa poderá aparecer novamente.";

    Object.assign(descricao.style, {
      color: "#9fb0ba",
      fontSize: "13px",
      lineHeight: "1.5",
      marginBottom: "14px",
    });

    const nome = document.createElement("div");
    nome.textContent = conversa.nome || conversa.id;

    Object.assign(nome.style, {
      padding: "10px 12px",
      marginBottom: "14px",
      borderRadius: "9px",
      background: "#0c1317",
      color: "#dfe7eb",
      fontSize: "13px",
      fontWeight: "700",
      wordBreak: "break-word",
    });

    const statusAcao = document.createElement("div");

    Object.assign(statusAcao.style, {
      minHeight: "18px",
      marginBottom: "8px",
      color: "#ff8a8a",
      fontSize: "12px",
      lineHeight: "1.4",
    });

    const acoes = document.createElement("div");

    Object.assign(acoes.style, {
      display: "flex",
      gap: "8px",
    });

    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.textContent = "Cancelar";

    const confirmar = document.createElement("button");
    confirmar.type = "button";
    confirmar.textContent = limpando ? "Limpar conversa" : "Apagar conversa";

    for (const botao of [cancelar, confirmar]) {
      Object.assign(botao.style, {
        flex: "1",
        minHeight: "42px",
        padding: "10px 12px",
        borderRadius: "9px",
        cursor: "pointer",
        color: "#fff",
        font: "inherit",
        fontSize: "13px",
        fontWeight: "800",
      });
    }

    cancelar.style.border = "1px solid #30414a";
    cancelar.style.background = "#182329";
    confirmar.style.border = "0";
    confirmar.style.background = limpando ? "#9b6a1f" : "#b83b3b";

    acoes.appendChild(cancelar);
    acoes.appendChild(confirmar);
    caixa.appendChild(titulo);
    caixa.appendChild(descricao);
    caixa.appendChild(nome);
    caixa.appendChild(statusAcao);
    caixa.appendChild(acoes);
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    let executando = false;

    const fechar = () => {
      if (!executando) {
        overlay.remove();
      }
    };

    async function executar() {
      if (executando) {
        return;
      }

      executando = true;
      cancelar.disabled = true;
      confirmar.disabled = true;
      statusAcao.style.color = "#9fb0ba";
      statusAcao.textContent = limpando
        ? "Limpando conversa..."
        : "Apagando conversa...";

      try {
        const resultado = await ipcRenderer.invoke("enviar-mensagem-texto", {
          gerenciarConversa: {
            conversaId: conversa.id,
            acao,
          },
        });

        if (!resultado?.ok) {
          throw new Error(
            resultado?.erro ||
              (limpando
                ? "Não foi possível limpar a conversa."
                : "Não foi possível apagar a conversa."),
          );
        }

        if (limpando) {
          registrarConversaLimpaLocalmente(conversa);
          limparPersistenciasMensagensDaConversa(conversa.id);

          conversa.mensagens = [];
          conversa.naoLidasLocal = 0;
          delete naoLidasPersistidas[conversa.id];
          salvarNaoLidasPersistidas();

          if (obterMensagemRespondendo?.()?.conversaId === conversa.id) {
            limparRespostaMensagem(false);
          }

          recalcularNaoLidasGlobal();
          atualizarContadores();
          renderConversas();

          if (obterConversaAtual?.() === conversa.id) {
            renderMensagens();
            atualizarStatusCabecalho();
          }

          statusChat.textContent = "Conversa limpa";
        } else {
          registrarConversaApagadaLocalmente(conversa);
          limparPersistenciasMensagensDaConversa(conversa.id);

          delete naoLidasPersistidas[conversa.id];
          salvarNaoLidasPersistidas();

          const eraAtual = obterConversaAtual?.() === conversa.id;
          delete conversas[conversa.id];

          recalcularNaoLidasGlobal();
          atualizarContadores();
          renderConversas();

          if (eraAtual) {
            limparSelecaoConversa("Conversa apagada");
          }
        }

        overlay.remove();
      } catch (erro) {
        executando = false;
        cancelar.disabled = false;
        confirmar.disabled = false;
        statusAcao.style.color = "#ff8a8a";
        statusAcao.textContent =
          erro?.message ||
          (limpando
            ? "Erro ao limpar a conversa."
            : "Erro ao apagar a conversa.");
      }
    }

    cancelar.addEventListener("click", fechar);
    confirmar.addEventListener("click", executar);

    overlay.addEventListener("click", (evento) => {
      if (evento.target === overlay) {
        fechar();
      }
    });

    overlay.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape") {
        fechar();
      }

      if (evento.key === "Enter" && !executando) {
        executar();
      }
    });

    overlay.tabIndex = -1;
    overlay.focus();
  }

  return {
    abrirConfirmacaoGerenciamentoConversa,
  };
}

module.exports = {
  criarModuloGerenciamentoConversa,
};
