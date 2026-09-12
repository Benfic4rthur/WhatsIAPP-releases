function criarModuloFeedbackEnvio({
  ipcRenderer,
  document,
  chatPrincipal,
} = {}) {
  if (!ipcRenderer || typeof ipcRenderer.invoke !== "function" || !document) {
    return {
      ativo: false,
    };
  }

  if (ipcRenderer.__whatsiappFeedbackEnvioInstalado) {
    return ipcRenderer.__whatsiappFeedbackEnvioInstalado;
  }

  const chat = chatPrincipal || document.querySelector(".chat");

  if (!chat) {
    return {
      ativo: false,
    };
  }

  if (!document.getElementById("whatsiappFeedbackEnvioStyle")) {
    const style = document.createElement("style");
    style.id = "whatsiappFeedbackEnvioStyle";
    style.textContent = `
      .whatsiapp-feedback-envio {
        position: absolute;
        left: 50%;
        bottom: 78px;
        z-index: 190000;
        min-width: 280px;
        max-width: min(460px, calc(100% - 40px));
        transform: translate(-50%, 14px) scale(.98);
        opacity: 0;
        pointer-events: none;
        transition: opacity 160ms ease, transform 180ms cubic-bezier(.2,.85,.25,1);
      }

      .whatsiapp-feedback-envio.visivel {
        opacity: 1;
        transform: translate(-50%, 0) scale(1);
      }

      .whatsiapp-feedback-envio-card {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 56px;
        padding: 11px 16px 12px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 14px;
        background: rgba(16, 24, 28, .97);
        box-shadow: 0 16px 42px rgba(0,0,0,.46);
        backdrop-filter: blur(10px);
      }

      .whatsiapp-feedback-envio-icone {
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgba(37,211,102,.13);
        color: #63df91;
        font-size: 15px;
        font-weight: 800;
      }

      .whatsiapp-feedback-envio.enviando .whatsiapp-feedback-envio-icone {
        border: 2px solid rgba(99,223,145,.24);
        border-top-color: #63df91;
        background: transparent;
        font-size: 0;
        animation: whatsiapp-feedback-girar .72s linear infinite;
      }

      .whatsiapp-feedback-envio.falhou .whatsiapp-feedback-envio-icone {
        background: rgba(239,83,80,.14);
        color: #ff7875;
      }

      .whatsiapp-feedback-envio-conteudo {
        min-width: 0;
        flex: 1;
      }

      .whatsiapp-feedback-envio-titulo {
        color: #e9edef;
        font-size: 13px;
        font-weight: 750;
        line-height: 1.25;
      }

      .whatsiapp-feedback-envio-subtitulo {
        margin-top: 3px;
        color: #8da0aa;
        font-size: 11px;
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .whatsiapp-feedback-envio-barra {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 2px;
        overflow: hidden;
        background: rgba(255,255,255,.045);
      }

      .whatsiapp-feedback-envio-barra::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        width: 42%;
        background: #25d366;
        transform: translateX(-120%);
      }

      .whatsiapp-feedback-envio.enviando .whatsiapp-feedback-envio-barra::after {
        animation: whatsiapp-feedback-barra 1.05s ease-in-out infinite;
      }

      .whatsiapp-feedback-envio.sucesso .whatsiapp-feedback-envio-barra::after {
        width: 100%;
        transform: translateX(0);
      }

      .whatsiapp-feedback-envio.falhou .whatsiapp-feedback-envio-barra::after {
        width: 100%;
        transform: translateX(0);
        background: #ef5350;
      }

      @keyframes whatsiapp-feedback-girar {
        to { transform: rotate(360deg); }
      }

      @keyframes whatsiapp-feedback-barra {
        0% { transform: translateX(-120%); }
        55% { transform: translateX(110%); }
        100% { transform: translateX(240%); }
      }
    `;
    document.head.appendChild(style);
  }

  if (getComputedStyle(chat).position === "static") {
    chat.style.position = "relative";
  }

  const raiz = document.createElement("div");
  raiz.className = "whatsiapp-feedback-envio";
  raiz.setAttribute("aria-live", "polite");

  const card = document.createElement("div");
  card.className = "whatsiapp-feedback-envio-card";

  const icone = document.createElement("div");
  icone.className = "whatsiapp-feedback-envio-icone";

  const conteudo = document.createElement("div");
  conteudo.className = "whatsiapp-feedback-envio-conteudo";

  const titulo = document.createElement("div");
  titulo.className = "whatsiapp-feedback-envio-titulo";

  const subtitulo = document.createElement("div");
  subtitulo.className = "whatsiapp-feedback-envio-subtitulo";

  const barra = document.createElement("div");
  barra.className = "whatsiapp-feedback-envio-barra";

  conteudo.appendChild(titulo);
  conteudo.appendChild(subtitulo);
  card.appendChild(icone);
  card.appendChild(conteudo);
  card.appendChild(barra);
  raiz.appendChild(card);
  chat.appendChild(raiz);

  const invokeOriginal = ipcRenderer.invoke.bind(ipcRenderer);
  let enviosAtivos = 0;
  let timerOcultar = null;
  let ultimaDescricao = "Enviando...";

  function descricaoEnvio(canal, args = []) {
    if (canal === "enviar-anexo") {
      const tipo = String(args?.[0]?.tipo || "arquivo").toLowerCase();

      if (tipo === "imagem") return "Enviando foto...";
      if (tipo === "video") return "Enviando vídeo...";
      if (tipo === "audio") return "Enviando áudio...";
      return "Enviando arquivo...";
    }

    if (canal === "enviar-figurinha-whatsapp") return "Enviando figurinha...";
    if (canal === "enviar-contato-whatsapp") return "Compartilhando contato...";

    return null;
  }

  function exibirEnviando(descricao) {
    clearTimeout(timerOcultar);
    ultimaDescricao = descricao || "Enviando...";
    raiz.className = "whatsiapp-feedback-envio enviando visivel";
    icone.textContent = "";
    titulo.textContent = ultimaDescricao;
    subtitulo.textContent = "Aguarde a confirmação do WhatsApp.";
  }

  function exibirResultado(ok, detalhe = "") {
    clearTimeout(timerOcultar);

    raiz.className = `whatsiapp-feedback-envio ${ok ? "sucesso" : "falhou"} visivel`;
    icone.textContent = ok ? "✓" : "!";
    titulo.textContent = ok ? "Enviado" : "Falha no envio";
    subtitulo.textContent = ok
      ? "O WhatsApp confirmou o envio."
      : String(detalhe || "Não foi possível concluir o envio.")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);

    timerOcultar = setTimeout(
      () => {
        if (enviosAtivos > 0) {
          exibirEnviando(ultimaDescricao);
          return;
        }

        raiz.classList.remove("visivel");
      },
      ok ? 700 : 2200,
    );
  }

  ipcRenderer.invoke = async function invokeComFeedbackEnvio(canal, ...args) {
    const descricao = descricaoEnvio(canal, args);

    if (!descricao) {
      return invokeOriginal(canal, ...args);
    }

    enviosAtivos += 1;
    exibirEnviando(descricao);

    try {
      const resultado = await invokeOriginal(canal, ...args);
      enviosAtivos = Math.max(0, enviosAtivos - 1);

      if (resultado?.ok === false) {
        exibirResultado(false, resultado?.erro);
      } else if (enviosAtivos > 0) {
        exibirEnviando(ultimaDescricao);
      } else {
        exibirResultado(true);
      }

      return resultado;
    } catch (erro) {
      enviosAtivos = Math.max(0, enviosAtivos - 1);
      exibirResultado(false, erro?.message || erro);
      throw erro;
    }
  };

  const api = {
    ativo: true,
    elemento: raiz,
  };

  Object.defineProperty(ipcRenderer, "__whatsiappFeedbackEnvioInstalado", {
    value: api,
    configurable: true,
  });

  return api;
}

module.exports = {
  criarModuloFeedbackEnvio,
};
