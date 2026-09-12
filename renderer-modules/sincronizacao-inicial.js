function criarModuloSincronizacaoInicial(deps = {}) {
  const { document } = deps;

  let sincronizacaoInicialConcluida = false;
  let ultimaEtapaSincronizacao = "";
  const overlaySincronizacaoInicial = document.createElement("div");
  overlaySincronizacaoInicial.id = "sincronizacaoInicialOverlay";
  overlaySincronizacaoInicial.className = "sincronizacao-inicial-overlay";
  overlaySincronizacaoInicial.innerHTML = `
    <section class="sincronizacao-inicial-card" aria-live="polite">
      <div class="sincronizacao-inicial-logo-wrap">
        <img
          class="sincronizacao-inicial-logo"
          src="assets/logo.png"
          alt="WhatsIAPP"
        >
        <div class="sincronizacao-inicial-spinner" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <div class="sincronizacao-inicial-titulo">
        Sincronizando WhatsIAPP
      </div>

      <div
        id="sincronizacaoInicialMensagem"
        class="sincronizacao-inicial-mensagem"
      >
        Acordando os fofoqueiros...
      </div>

      <div class="sincronizacao-inicial-marcos">
        <div
          id="sincronizacaoMarcoConversas"
          class="sincronizacao-inicial-marco"
        >
          <span></span> Conversas
        </div>

        <div
          id="sincronizacaoMarcoSessao"
          class="sincronizacao-inicial-marco"
        >
          <span></span> Sessão
        </div>

        <div
          id="sincronizacaoMarcoRecursos"
          class="sincronizacao-inicial-marco"
        >
          <span></span> Recursos
        </div>
      </div>

      <div
        id="sincronizacaoInicialDetalhe"
        class="sincronizacao-inicial-detalhe"
      >
        Preparando tudo para você.
      </div>
    </section>
  `;
  document.body.appendChild(overlaySincronizacaoInicial);
  const sincronizacaoInicialMensagem =
    overlaySincronizacaoInicial.querySelector("#sincronizacaoInicialMensagem");
  const sincronizacaoInicialDetalhe = overlaySincronizacaoInicial.querySelector(
    "#sincronizacaoInicialDetalhe",
  );
  const sincronizacaoMarcoConversas = overlaySincronizacaoInicial.querySelector(
    "#sincronizacaoMarcoConversas",
  );
  const sincronizacaoMarcoSessao = overlaySincronizacaoInicial.querySelector(
    "#sincronizacaoMarcoSessao",
  );
  const sincronizacaoMarcoRecursos = overlaySincronizacaoInicial.querySelector(
    "#sincronizacaoMarcoRecursos",
  );
  const frasesSincronizacaoInicial = [
    "Acordando os fofoqueiros...",
    "Abrindo a gaveta das conversas...",
    "Organizando as fofocas antigas...",
    "Procurando quem mandou “oi, sumido”...",
    "Contando os “kkkk” acumulados...",
    "Separando conversa séria de puro caos...",
    "Desamassando os memes...",
    "Procurando aquela figurinha que sempre aparece na hora errada...",
    "Separando áudio importante de podcast particular...",
    "Conferindo quem respondeu só com figurinha...",
    "Tirando a poeira das conversas...",
    "Organizando os grupos que ninguém tem coragem de sair...",
    "Procurando a mensagem que começou com “rapidinho” e virou um textão...",
    "Descobrindo quem mandou áudio em vez de responder sim ou não...",
    "Conferindo se o grupo da família ainda está em paz...",
    "Guardando os prints comprometedores no lugar certo...",
    "Verificando quem visualizou e desapareceu misteriosamente...",
    "Revirando mensagens antigas sem julgar ninguém...",
    "Contando quantos “bom dia” chegaram nos grupos...",
    "Separando conversa importante de figurinha aleatória...",
    "Procurando aquele contato salvo como “Não atender”...",
    "Conferindo quem respondeu três dias depois como se nada tivesse acontecido...",
    "Organizando os contatos que ainda estão salvos só pelo número...",
    "Procurando mensagens que começaram com “não conta pra ninguém”...",
    "Colocando cada áudio interminável no seu devido lugar...",
    "Conferindo se os memes históricos ainda fazem sentido...",
    "Juntando as pontas das conversas que ficaram pela metade...",
    "Arquivando mentalmente o que era melhor ter esquecido...",
    "Conferindo se nenhum meme perdeu a legenda...",
    "Alinhando os áudios de dois minutos que têm oito minutos...",
    "Organizando as figurinhas por nível de deboche...",
    "Ligando a máquina da fofoca...",
    "Acendendo as luzes da central de mensagens...",
    "Preparando os bastidores...",
    "Puxando memes e figurinhas...",
    "Sincronizando o que importa e ignorando o drama...",
    "Arrumando conversas sem perder nenhuma fofoca...",
    "Alinhando mensagens, mídias e pequenas confusões...",
    "Sincronizando tudo sem acordar o grupo da família...",
    "Masterizando áudios...",
    "Afinando o microfone dos áudios de 8 minutos...",
    "Preparando o botão de mandar e se arrepender...",
    "Testando a esteira de memes...",
    "Dando uma polida nos encaminhamentos...",
    "Lubrificando o botão de responder...",
    "Preparando os anexos para a viagem...",
    "Conferindo quem está online sem parecer curioso...",
    "Arrumando o “digitando...” e o “gravando áudio...”...",
    "Colocando as arquivadas na gaveta certa...",
    "Conferindo os tiques antes de liberar os envios...",
    "Testando se a fofoca chega e volta sem se perder...",
    "Fazendo os últimos apertos de parafuso...",
    "Dando uma geral antes de liberar a bagunça...",
    "Ajeitando a bagunça antes de você chegar...",
    "Só mais uns detalhes e ninguém percebe que teve trabalho...",
    "Fazendo uma última ronda pelos memes...",
    "Conferindo se todos os áudios sobreviveram à viagem...",
    "Deixando cada conversa exatamente onde deveria estar...",
    "Revisando a central da fofoca pela última vez...",
  ];
  let timerFrasesSincronizacao = null;
  let indiceFraseSincronizacao = 0;
  function trocarTextoSincronizacao(elemento, texto) {
    if (!elemento || !texto || elemento.textContent === texto) {
      return;
    }
    elemento.classList.remove("trocando");
    void elemento.offsetWidth;
    elemento.classList.add("trocando");
    setTimeout(() => {
      elemento.textContent = texto;
      elemento.classList.remove("trocando");
    }, 90);
  }
  function pararRotacaoFrasesSincronizacao() {
    clearInterval(timerFrasesSincronizacao);
    timerFrasesSincronizacao = null;
  }
  function mostrarProximaFraseSincronizacao() {
    if (sincronizacaoInicialConcluida || !frasesSincronizacaoInicial.length) {
      return;
    }
    const frase =
      frasesSincronizacaoInicial[
        indiceFraseSincronizacao % frasesSincronizacaoInicial.length
      ];
    indiceFraseSincronizacao =
      (indiceFraseSincronizacao + 1) % frasesSincronizacaoInicial.length;
    trocarTextoSincronizacao(sincronizacaoInicialMensagem, frase);
  }
  function iniciarRotacaoFrasesSincronizacao() {
    pararRotacaoFrasesSincronizacao();
    indiceFraseSincronizacao = 0;
    mostrarProximaFraseSincronizacao();
    timerFrasesSincronizacao = setInterval(() => {
      if (sincronizacaoInicialConcluida) {
        pararRotacaoFrasesSincronizacao();
        return;
      }
      mostrarProximaFraseSincronizacao();
    }, 2350);
  }
  function atualizarMarcosSincronizacao(etapa) {
    if (
      ["baileys-conectado", "historico", "historico-pronto"].includes(etapa)
    ) {
      sincronizacaoMarcoConversas.classList.add("concluido");
    }
    if (
      [
        "wpp-autenticado",
        "wpp-sincronizando",
        "wpp-client",
        "wpp-interface",
        "full-ready",
      ].includes(etapa)
    ) {
      sincronizacaoMarcoSessao.classList.add("concluido");
    }
    if (["wpp-client", "wpp-interface", "full-ready"].includes(etapa)) {
      sincronizacaoMarcoRecursos.classList.add("concluido");
    }
    if (etapa === "full-ready") {
      sincronizacaoMarcoConversas.classList.add("concluido");
      sincronizacaoMarcoSessao.classList.add("concluido");
      sincronizacaoMarcoRecursos.classList.add("concluido");
    }
  }
  function aplicarEtapaSincronizacao(dados) {
    if (sincronizacaoInicialConcluida) {
      return;
    }
    const etapa = String(dados?.etapa || "").trim();
    if (!etapa || etapa === ultimaEtapaSincronizacao) {
      return;
    }
    ultimaEtapaSincronizacao = etapa;
    atualizarMarcosSincronizacao(etapa);
    overlaySincronizacaoInicial.classList.toggle("erro", etapa === "erro");
    if (etapa !== "full-ready") {
      return;
    }
    sincronizacaoInicialConcluida = true;
    pararRotacaoFrasesSincronizacao();
    sincronizacaoInicialMensagem.classList.remove("trocando");
    sincronizacaoInicialMensagem.textContent = "Tudo pronto. Pode fofocar.";
    sincronizacaoInicialDetalhe.classList.remove("trocando");
    sincronizacaoInicialDetalhe.textContent =
      "WhatsIAPP totalmente sincronizado.";
    overlaySincronizacaoInicial.classList.remove("erro");
    overlaySincronizacaoInicial.classList.add("pronto");
    setTimeout(() => {
      overlaySincronizacaoInicial.classList.add("saindo");
    }, 520);
    setTimeout(() => {
      overlaySincronizacaoInicial.remove();
    }, 980);
  }
  iniciarRotacaoFrasesSincronizacao();

  function obterSincronizacaoInicialConcluida() {
    return sincronizacaoInicialConcluida;
  }

  return {
    aplicarEtapaSincronizacao,
    obterSincronizacaoInicialConcluida,
  };
}

module.exports = {
  criarModuloSincronizacaoInicial,
};
