"use strict";

(() => {
  const pacote = require("./package.json");
  const { ipcRenderer } = require("electron");
  const marca = document.querySelector(".lateral-marca-texto");

  if (marca) {
    const versao = document.createElement("small");
    versao.className = "app-versao";
    versao.textContent = `v${pacote.version}`;
    versao.title = `Versão instalada${pacote.localTestBuild ? " — teste local" : ""}`;
    versao.setAttribute("aria-label", `${versao.title}: ${pacote.version}`);
    marca.appendChild(versao);
  }

  const banner = document.createElement("section");
  banner.className = "desktop-updater-banner";
  banner.hidden = true;
  banner.innerHTML = `
    <div class="desktop-updater-banner-conteudo">
      <strong class="desktop-updater-banner-titulo"></strong>
      <span class="desktop-updater-banner-texto"></span>
    </div>
    <div class="desktop-updater-banner-acoes"></div>
  `;
  document.body.appendChild(banner);

  const overlay = document.createElement("div");
  overlay.className = "desktop-updater-modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="desktop-updater-modal" role="dialog" aria-modal="true" aria-labelledby="desktopUpdaterTitulo">
      <button class="desktop-updater-modal-fechar" type="button" aria-label="Fechar">×</button>
      <div class="desktop-updater-modal-icone">↻</div>
      <h2 id="desktopUpdaterTitulo">Atualização do WhatsIAPP</h2>
      <div class="desktop-updater-modal-texto"></div>
      <div class="desktop-updater-modal-erro" hidden></div>
      <div class="desktop-updater-modal-acoes"></div>
    </section>
  `;
  document.body.appendChild(overlay);

  const tituloBanner = banner.querySelector(".desktop-updater-banner-titulo");
  const textoBanner = banner.querySelector(".desktop-updater-banner-texto");
  const acoesBanner = banner.querySelector(".desktop-updater-banner-acoes");
  const textoModal = overlay.querySelector(".desktop-updater-modal-texto");
  const erroModal = overlay.querySelector(".desktop-updater-modal-erro");
  const acoesModal = overlay.querySelector(".desktop-updater-modal-acoes");
  const fecharModal = overlay.querySelector(".desktop-updater-modal-fechar");

  function botao(texto, classe, aoClicar) {
    const elemento = document.createElement("button");
    elemento.type = "button";
    elemento.className = classe;
    elemento.textContent = texto;
    elemento.addEventListener("click", aoClicar);
    return elemento;
  }

  function limpar(elemento) {
    while (elemento.firstChild) elemento.firstChild.remove();
  }

  function ocultarBanner() {
    banner.hidden = true;
    limpar(acoesBanner);
  }

  function mostrarErroModal(mensagem) {
    erroModal.textContent = String(mensagem || "Não foi possível concluir esta etapa da atualização.");
    erroModal.hidden = false;
  }

  function limparErroModal() {
    erroModal.hidden = true;
    erroModal.textContent = "";
  }

  function fecharModalAtualizacao() {
    overlay.hidden = true;
    limparErroModal();
  }

  function abrirModalMac(estado) {
    limparErroModal();
    overlay.hidden = false;
    mostrarEtapaInicialMac(estado);
  }

  function mostrarEtapaInicialMac(estado) {
    textoModal.innerHTML = `
      <p>Uma nova versão do WhatsIAPP foi baixada.</p>
      <p>No macOS, a instalação automática exige que o aplicativo seja distribuído com uma assinatura de desenvolvedor da Apple. Como esta versão ainda não utiliza essa assinatura, a atualização precisa ser concluída manualmente.</p>
      <p>O WhatsIAPP abrirá o instalador e mostrará os passos necessários.</p>
      <p class="desktop-updater-versao">Versão disponível: <strong>${String(estado?.versao || "")}</strong></p>
    `;
    limpar(acoesModal);
    const instalar = botao(
      "Instalar nova atualização",
      "desktop-updater-btn desktop-updater-btn-principal",
      async () => {
        instalar.disabled = true;
        limparErroModal();
        try {
          const resultado = await ipcRenderer.invoke("desktop-updater:mac-abrir-dmg");
          if (!resultado?.ok) {
            mostrarErroModal(resultado?.erro);
            instalar.disabled = false;
            return;
          }
          mostrarEtapaSubstituicaoMac(estado);
        } catch (erro) {
          mostrarErroModal(erro?.message || erro);
          instalar.disabled = false;
        }
      },
    );
    acoesModal.appendChild(instalar);
  }

  function mostrarEtapaSubstituicaoMac(estado) {
    limparErroModal();
    textoModal.innerHTML = `
      <p>O instalador foi aberto no Finder.</p>
      <div class="desktop-updater-passos">
        <div><b>1.</b><span>Clique abaixo em <strong>Fechar WhatsIAPP e continuar</strong>.</span></div>
        <div><b>2.</b><span>Depois que o WhatsIAPP fechar, arraste <strong>WhatsIAPP.app</strong> para <strong>Aplicativos</strong>.</span></div>
        <div><b>3.</b><span>Quando o Finder perguntar, escolha <strong>Substituir</strong>.</span></div>
      </div>
      <p>Nesta versão de teste, um componente temporário aguardará a substituição, preparará o novo aplicativo e tentará abri-lo novamente automaticamente.</p>
      <p class="desktop-updater-versao">Nova versão: <strong>${String(estado?.versao || "")}</strong></p>
    `;
    limpar(acoesModal);
    const voltar = botao("Voltar", "desktop-updater-btn desktop-updater-btn-secundario", () => {
      mostrarEtapaInicialMac(estado);
    });
    const fechar = botao(
      "Fechar WhatsIAPP e continuar",
      "desktop-updater-btn desktop-updater-btn-principal",
      async () => {
        fechar.disabled = true;
        voltar.disabled = true;
        limparErroModal();
        try {
          const resultado = await ipcRenderer.invoke("desktop-updater:mac-fechar-continuar");
          if (!resultado?.ok) {
            mostrarErroModal(resultado?.erro);
            fechar.disabled = false;
            voltar.disabled = false;
          }
        } catch (erro) {
          mostrarErroModal(erro?.message || erro);
          fechar.disabled = false;
          voltar.disabled = false;
        }
      },
    );
    acoesModal.append(voltar, fechar);
  }

  function renderizarEstado(estado) {
    const etapa = String(estado?.etapa || "sem-update");

    if (etapa === "adiado" || etapa === "sem-update" || etapa === "verificando" || etapa === "encontrado" || etapa === "baixando") {
      ocultarBanner();
      return;
    }

    if (etapa === "instalando") {
      tituloBanner.textContent = "Instalando atualização";
      textoBanner.textContent = "O WhatsIAPP será reiniciado quando a instalação estiver pronta.";
      limpar(acoesBanner);
      banner.hidden = false;
      return;
    }

    if (etapa !== "pronto") {
      ocultarBanner();
      return;
    }

    limpar(acoesBanner);
    banner.hidden = false;

    if (estado?.plataforma === "win32") {
      tituloBanner.textContent = "Atualização pronta";
      textoBanner.textContent = estado?.versao
        ? `A versão ${estado.versao} já foi baixada.`
        : "Uma nova versão já foi baixada.";

      const reiniciar = botao(
        "Reiniciar para instalar",
        "desktop-updater-btn desktop-updater-btn-principal",
        async () => {
          reiniciar.disabled = true;
          adiar.disabled = true;
          try {
            const resultado = await ipcRenderer.invoke("desktop-updater:instalar-agora");
            if (!resultado?.ok) {
              reiniciar.disabled = false;
              adiar.disabled = false;
            }
          } catch {
            reiniciar.disabled = false;
            adiar.disabled = false;
          }
        },
      );
      const adiar = botao(
        "Agora não",
        "desktop-updater-btn desktop-updater-btn-secundario",
        async () => {
          try {
            await ipcRenderer.invoke("desktop-updater:adiar");
            ocultarBanner();
          } catch {}
        },
      );
      acoesBanner.append(reiniciar, adiar);
      return;
    }

    if (estado?.plataforma === "darwin") {
      tituloBanner.textContent = "Nova atualização disponível";
      textoBanner.textContent = estado?.versao
        ? `A versão ${estado.versao} já foi baixada.`
        : "Uma nova versão já foi baixada.";
      const abrir = botao(
        "Ver atualização",
        "desktop-updater-btn desktop-updater-btn-principal",
        () => abrirModalMac(estado),
      );
      acoesBanner.appendChild(abrir);
      return;
    }

    ocultarBanner();
  }

  fecharModal.addEventListener("click", fecharModalAtualizacao);
  overlay.addEventListener("click", (evento) => {
    if (evento.target === overlay) fecharModalAtualizacao();
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !overlay.hidden) fecharModalAtualizacao();
  });

  ipcRenderer.on("desktop-updater:estado", (_evento, estado) => renderizarEstado(estado));
  ipcRenderer
    .invoke("desktop-updater:estado")
    .then(renderizarEstado)
    .catch(() => {});
})();

require("./ajustes-conversa-sessao.js");
