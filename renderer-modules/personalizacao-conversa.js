function criarPersonalizacaoConversa(dependencias = {}) {
  const {
    document,
    console,
    localStorage,
    mensagens,
    conversas,
    obterConversaAtual,
  } = dependencias;

  const CHAVE_APARENCIA_CONVERSAS = "whatsiapp.aparenciaConversas.v1";

  const CORES_CONVERSA_PREDEFINIDAS = [
    { id: "grafite", nome: "Grafite", cor: "#0b141a" },
    { id: "petroleo", nome: "Petróleo", cor: "#102129" },
    { id: "verde", nome: "Verde profundo", cor: "#10231d" },
    { id: "azul", nome: "Azul noite", cor: "#111d2b" },
    { id: "roxo", nome: "Roxo escuro", cor: "#1c1726" },
    { id: "vinho", nome: "Vinho", cor: "#25171b" },
    { id: "marrom", nome: "Café", cor: "#241b17" },
    { id: "cinza", nome: "Cinza", cor: "#191d20" },
  ];

  function carregarAparenciasConversas() {
    try {
      const bruto = JSON.parse(
        localStorage.getItem(CHAVE_APARENCIA_CONVERSAS) || "{}",
      );

      return bruto && typeof bruto === "object" ? bruto : {};
    } catch (erro) {
      console.warn(
        `[UI] PERSONALIZER_STORAGE_LOAD_ERROR | erro=${erro?.message || erro}`,
      );
      return {};
    }
  }

  const aparenciasConversas = carregarAparenciasConversas();

  function salvarAparenciasConversas() {
    try {
      localStorage.setItem(
        CHAVE_APARENCIA_CONVERSAS,
        JSON.stringify(aparenciasConversas),
      );
    } catch (erro) {
      console.warn(
        `[UI] PERSONALIZER_STORAGE_SAVE_ERROR | erro=${erro?.message || erro}`,
      );
    }
  }
  const PAPEIS_CONVERSA = [
    { id: "doodles", nome: "Doodles", simbolo: "✨" },
    { id: "conversa", nome: "Conversa", simbolo: "💬" },
    { id: "mix", nome: "Mix", simbolo: "🫧" },
    { id: "estrelas", nome: "Estrelas", simbolo: "⭐" },
    { id: "carinhas", nome: "Carinhas", simbolo: "🙂" },
    { id: "coracoes", nome: "Corações", simbolo: "💚" },
    { id: "festa", nome: "Festa", simbolo: "🎉" },
    { id: "midia", nome: "Mídia", simbolo: "📷" },
    { id: "musica", nome: "Música", simbolo: "🎵" },
    { id: "pets", nome: "Pets", simbolo: "🐾" },
    { id: "comida", nome: "Comida", simbolo: "🍕" },
    { id: "cafe", nome: "Café", simbolo: "☕" },
    { id: "viagem", nome: "Viagem", simbolo: "✈️" },
    { id: "aventura", nome: "Aventura", simbolo: "🧭" },
    { id: "natureza", nome: "Natureza", simbolo: "🌿" },
    { id: "clima", nome: "Clima", simbolo: "🌙" },
    { id: "espaco", nome: "Espaço", simbolo: "🚀" },
    { id: "games", nome: "Games", simbolo: "🎮" },
    { id: "esportes", nome: "Esportes", simbolo: "⚽" },
    { id: "tecnologia", nome: "Tecnologia", simbolo: "💻" },
    { id: "trabalho", nome: "Trabalho", simbolo: "📎" },
    { id: "raios", nome: "Energia", simbolo: "⚡" },
  ];

  function svgPapelConversa(tipo, opacidade = 0.08) {
    const o = Math.max(0.025, Math.min(0.16, Number(opacidade) || 0.08));
    const stroke = "#c8d6dc";
    const comum = `fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"`;

    const icones = {
      chat: `<g ${comum}><path d="M10 13h27a7 7 0 0 1 7 7v8a7 7 0 0 1-7 7H24l-9 7v-7h-5a7 7 0 0 1-7-7v-8a7 7 0 0 1 7-7Z"/><path d="M14 22h19M14 28h13"/></g>`,
      smile: `<g ${comum}><circle cx="25" cy="25" r="18"/><circle cx="19" cy="21" r="1.7"/><circle cx="31" cy="21" r="1.7"/><path d="M17 29c5 5 11 5 16 0"/></g>`,
      heart: `<g ${comum}><path d="M25 42 9 27a10 10 0 0 1 14-14l2 2 2-2a10 10 0 0 1 14 14L25 42Z"/></g>`,
      star: `<g ${comum}><path d="m25 7 5.6 11.3 12.5 1.8-9 8.8 2.1 12.5L25 35.5l-11.2 5.9 2.2-12.5-9.1-8.8 12.5-1.8L25 7Z"/></g>`,
      camera: `<g ${comum}><rect x="6" y="13" width="39" height="29" rx="6"/><path d="m15 13 4-6h13l4 6"/><circle cx="25.5" cy="27.5" r="8"/><circle cx="38" cy="19" r="1.5"/></g>`,
      plane: `<g ${comum}><path d="M5 24h18L34 8l5 2-7 16 15 6-2 5-17-4-9 10-5-2 5-10H6l-5-4 4-3Z"/></g>`,
      paw: `<g ${comum}><circle cx="13" cy="15" r="4"/><circle cx="24" cy="10" r="4"/><circle cx="35" cy="14" r="4"/><circle cx="43" cy="23" r="4"/><path d="M14 34c4-10 20-11 26-2 5 8-2 16-11 14-9 4-19-3-15-12Z"/></g>`,
      food: `<g ${comum}><path d="M8 17 27 7l10 29H12L8 17Z"/><circle cx="21" cy="18" r="2"/><circle cx="29" cy="26" r="2"/><path d="M42 13h8v27M42 21h8"/></g>`,
      coffee: `<g ${comum}><path d="M8 19h28v17A11 11 0 0 1 25 47h-6A11 11 0 0 1 8 36V19Z"/><path d="M36 24h6a7 7 0 0 1 0 14h-6"/><path d="M15 7c-4 4 4 6 0 10M24 5c-4 4 4 7 0 11M33 7c-4 4 4 6 0 10"/></g>`,
      note: `<g ${comum}><path d="M18 10v27M18 13l22-5v26"/><circle cx="11" cy="40" r="6"/><circle cx="33" cy="37" r="6"/></g>`,
      mic: `<g ${comum}><rect x="18" y="6" width="14" height="27" rx="7"/><path d="M12 25a13 13 0 0 0 26 0M25 38v8M17 46h16"/></g>`,
      game: `<g ${comum}><path d="M11 18h29a9 9 0 0 1 9 10l-2 10a7 7 0 0 1-11 4l-6-5H21l-7 5A7 7 0 0 1 3 38L2 28a9 9 0 0 1 9-10Z"/><path d="M15 24v12M9 30h12"/><circle cx="36" cy="27" r="2"/><circle cx="42" cy="33" r="2"/></g>`,
      rocket: `<g ${comum}><path d="M19 37C16 24 24 11 39 5c5 15-1 28-13 36l-7-4Z"/><circle cx="32" cy="19" r="4"/><path d="m19 33-10 4 4-11M26 40l-2 10 10-7"/></g>`,
      leaf: `<g ${comum}><path d="M10 43C11 24 23 12 43 7c1 21-10 34-33 36Z"/><path d="M13 40c9-11 17-19 28-29"/></g>`,
      laptop: `<g ${comum}><rect x="7" y="8" width="37" height="27" rx="3"/><path d="M3 41h45M17 41l-3 6h23l-3-6"/></g>`,
      bolt: `<g ${comum}><path d="m28 4-15 24h12l-5 20 20-27H29l5-17h-6Z"/></g>`,
      gift: `<g ${comum}><rect x="6" y="20" width="39" height="27" rx="3"/><path d="M4 20h43v-8H4v8ZM25 12v35"/><path d="M25 12c-6-11-17-5-13 1 3 5 13 3 13-1ZM25 12c6-11 17-5 13 1-3 5-13 3-13-1Z"/></g>`,
      doc: `<g ${comum}><path d="M12 5h22l8 8v33H12V5Z"/><path d="M34 5v10h8M18 24h18M18 31h18M18 38h12"/></g>`,
      phone: `<g ${comum}><path d="M16 6h18a5 5 0 0 1 5 5v30a5 5 0 0 1-5 5H16a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5Z"/><path d="M20 11h10M23 41h4"/></g>`,
      globe: `<g ${comum}><circle cx="25" cy="25" r="19"/><path d="M6 25h38M25 6c7 6 10 12 10 19s-3 13-10 19M25 6c-7 6-10 12-10 19s3 13 10 19"/></g>`,
      ball: `<g ${comum}><circle cx="25" cy="25" r="19"/><path d="m25 13 7 5-3 8h-8l-3-8 7-5ZM10 18l8 0M40 18l-8 0M12 35l9-9M38 35l-9-9M25 44v-18"/></g>`,
      compass: `<g ${comum}><circle cx="25" cy="25" r="19"/><path d="m31 15-5 13-12 7 5-13 12-7Z"/><circle cx="25" cy="25" r="2"/></g>`,
      moon: `<g ${comum}><path d="M36 7c-13 3-20 18-13 30 6 10 18 12 27 5-14 1-23-15-14-35Z"/><path d="m11 11 2 4 4 .6-3 3 .8 4-3.8-2-3.8 2 .8-4-3-3 4-.6 2-4Z"/></g>`,
    };

    const temas = {
      doodles: [
        "chat",
        "smile",
        "heart",
        "star",
        "camera",
        "plane",
        "paw",
        "food",
        "note",
        "game",
        "rocket",
        "leaf",
        "coffee",
        "laptop",
        "bolt",
        "gift",
        "mic",
        "doc",
        "phone",
        "globe",
      ],
      mix: [
        "chat",
        "star",
        "heart",
        "camera",
        "plane",
        "paw",
        "food",
        "note",
        "game",
        "rocket",
        "leaf",
        "coffee",
        "smile",
        "laptop",
        "bolt",
        "gift",
        "mic",
        "globe",
      ],
      estrelas: [
        "star",
        "moon",
        "rocket",
        "globe",
        "heart",
        "smile",
        "chat",
        "camera",
      ],
      conversa: [
        "chat",
        "smile",
        "phone",
        "mic",
        "heart",
        "star",
        "doc",
        "camera",
        "coffee",
        "globe",
      ],
      carinhas: [
        "smile",
        "heart",
        "star",
        "chat",
        "gift",
        "coffee",
        "paw",
        "moon",
      ],
      coracoes: [
        "heart",
        "smile",
        "star",
        "gift",
        "chat",
        "paw",
        "moon",
        "note",
      ],
      festa: [
        "gift",
        "star",
        "heart",
        "note",
        "smile",
        "camera",
        "bolt",
        "chat",
      ],
      midia: [
        "camera",
        "note",
        "mic",
        "phone",
        "doc",
        "chat",
        "star",
        "laptop",
      ],
      musica: [
        "note",
        "mic",
        "heart",
        "star",
        "camera",
        "smile",
        "bolt",
        "chat",
      ],
      pets: ["paw", "heart", "smile", "leaf", "star", "chat", "gift", "camera"],
      comida: [
        "food",
        "coffee",
        "heart",
        "smile",
        "star",
        "gift",
        "chat",
        "camera",
      ],
      cafe: [
        "coffee",
        "food",
        "chat",
        "heart",
        "star",
        "smile",
        "doc",
        "laptop",
      ],
      viagem: [
        "plane",
        "globe",
        "compass",
        "camera",
        "star",
        "moon",
        "phone",
        "chat",
      ],
      aventura: [
        "compass",
        "plane",
        "globe",
        "leaf",
        "rocket",
        "camera",
        "star",
        "moon",
      ],
      natureza: [
        "leaf",
        "paw",
        "moon",
        "heart",
        "star",
        "globe",
        "camera",
        "coffee",
      ],
      clima: [
        "moon",
        "star",
        "leaf",
        "globe",
        "chat",
        "heart",
        "camera",
        "plane",
      ],
      espaco: [
        "rocket",
        "star",
        "moon",
        "globe",
        "bolt",
        "camera",
        "chat",
        "compass",
      ],
      games: [
        "game",
        "bolt",
        "laptop",
        "phone",
        "star",
        "smile",
        "chat",
        "heart",
      ],
      esportes: [
        "ball",
        "bolt",
        "smile",
        "star",
        "heart",
        "game",
        "chat",
        "globe",
      ],
      tecnologia: [
        "laptop",
        "phone",
        "camera",
        "doc",
        "game",
        "bolt",
        "chat",
        "globe",
      ],
      trabalho: [
        "doc",
        "laptop",
        "phone",
        "coffee",
        "chat",
        "camera",
        "globe",
        "star",
      ],
      raios: [
        "bolt",
        "star",
        "rocket",
        "game",
        "heart",
        "smile",
        "laptop",
        "note",
      ],
    };

    const posicoes = [
      [-18, -12, 0.72, -11],
      [38, -8, 0.46, 8],
      [91, 8, 0.6, -6],
      [151, -10, 0.43, 14],
      [205, 16, 0.68, -9],
      [274, -7, 0.48, 11],
      [10, 48, 0.51, 12],
      [60, 60, 0.77, -15],
      [127, 49, 0.42, 5],
      [181, 70, 0.58, 17],
      [246, 51, 0.5, -8],
      [302, 67, 0.63, 7],
      [-10, 108, 0.61, -5],
      [44, 122, 0.44, 18],
      [98, 103, 0.7, 7],
      [164, 126, 0.5, -14],
      [218, 109, 0.74, 4],
      [286, 126, 0.42, -12],
      [18, 175, 0.46, -18],
      [67, 160, 0.64, 10],
      [132, 184, 0.5, -8],
      [190, 165, 0.57, 15],
      [252, 187, 0.41, -12],
      [306, 168, 0.68, 6],
      [-14, 226, 0.69, 9],
      [42, 240, 0.48, -5],
      [97, 219, 0.57, 12],
      [154, 245, 0.72, -10],
      [220, 225, 0.46, 7],
      [278, 244, 0.62, -16],
      [326, 222, 0.41, 13],
    ];

    const chaves = temas[tipo] || temas.doodles;
    const grupos = posicoes
      .map((pos, indice) => {
        const [x, y, escala, rotacao] = pos;
        const chave = chaves[(indice * 3 + (indice % 5)) % chaves.length];
        const desenho = icones[chave] || icones.chat;
        return `<g transform="translate(${x} ${y}) scale(${escala})"><g transform="rotate(${rotacao} 25 25)">${desenho}</g></g>`;
      })
      .join("");

    const acentos = [
      [24, 28, "•", 16],
      [118, 31, "✦", 10],
      [258, 31, "•", 13],
      [323, 103, "✧", 10],
      [31, 152, "✦", 9],
      [147, 151, "•", 14],
      [235, 150, "✧", 9],
      [78, 210, "•", 13],
      [190, 211, "✦", 9],
      [317, 205, "•", 14],
      [17, 267, "✧", 9],
      [242, 271, "•", 12],
    ]
      .map(([x, y, tamanhoTexto, fonte]) => {
        const texto = String(tamanhoTexto);
        return `<text x="${x}" y="${y}" font-size="${fonte}" text-anchor="middle" dominant-baseline="middle" fill="${stroke}" opacity="${Math.min(o + 0.02, 0.18)}" font-family="Segoe UI Symbol, Arial Unicode MS, sans-serif">${texto}</text>`;
      })
      .join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="290" viewBox="0 0 340 290">${grupos}${acentos}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  function posicaoPapelConversa(conversaId) {
    const texto = String(conversaId || "");
    let hash = 0;
    for (let i = 0; i < texto.length; i += 1) {
      hash = ((hash << 5) - hash + texto.charCodeAt(i)) | 0;
    }
    const x = Math.abs(hash % 97);
    const y = Math.abs((hash >> 7) % 83);
    return `${-x}px ${-y}px`;
  }

  function obterAparenciaConversa(conversaId) {
    const salva = aparenciasConversas[String(conversaId || "")];

    if (!salva || typeof salva !== "object") {
      return {
        modo: "padrao",
        cor: "#0b141a",
        papel: "doodles",
        intensidade: 0.07,
      };
    }

    return {
      modo: ["padrao", "solida", "papel"].includes(salva.modo)
        ? salva.modo
        : "padrao",
      cor: /^#[0-9a-f]{6}$/i.test(String(salva.cor || ""))
        ? salva.cor
        : "#0b141a",
      papel: PAPEIS_CONVERSA.some((item) => item.id === salva.papel)
        ? salva.papel
        : "doodles",
      intensidade: Math.max(
        0.03,
        Math.min(0.15, Number(salva.intensidade) || 0.07),
      ),
    };
  }

  function aplicarAparenciaConversa(conversaId = obterConversaAtual?.()) {
    if (!mensagens) return;

    mensagens.classList.remove("conversa-fundo-personalizado");
    mensagens.style.removeProperty("--conversa-fundo-cor");
    mensagens.style.removeProperty("--conversa-fundo-papel");
    mensagens.style.removeProperty("background-color");
    mensagens.style.removeProperty("background-image");
    mensagens.style.removeProperty("background-size");
    mensagens.style.removeProperty("background-position");

    if (!conversaId || !conversas[conversaId]) {
      return;
    }

    const aparencia = obterAparenciaConversa(conversaId);

    if (aparencia.modo === "padrao") {
      return;
    }

    mensagens.classList.add("conversa-fundo-personalizado");
    mensagens.style.backgroundColor = aparencia.cor;

    if (aparencia.modo === "papel") {
      mensagens.style.backgroundImage = svgPapelConversa(
        aparencia.papel,
        aparencia.intensidade,
      );
      mensagens.style.backgroundSize = "340px 290px";
      mensagens.style.backgroundPosition = posicaoPapelConversa(conversaId);
    } else {
      mensagens.style.backgroundImage = "none";
    }
  }

  const topoChatPersonalizacao = document.querySelector(".chat-topo");
  const modosChatPersonalizacao =
    topoChatPersonalizacao?.querySelector(".modos") || null;

  const botaoPersonalizarConversa = document.createElement("button");
  botaoPersonalizarConversa.type = "button";
  botaoPersonalizarConversa.className = "chat-personalizar-conversa";
  botaoPersonalizarConversa.title = "Personalizar conversa";
  botaoPersonalizarConversa.setAttribute("aria-label", "Personalizar conversa");
  botaoPersonalizarConversa.disabled = false;
  botaoPersonalizarConversa.style.pointerEvents = "auto";
  botaoPersonalizarConversa.style.position = "relative";
  botaoPersonalizarConversa.style.zIndex = "30";
  botaoPersonalizarConversa.innerHTML = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 0 18h1.4a1.7 1.7 0 0 0 0-3.4H12a1.7 1.7 0 0 1 0-3.4h2.2A6.8 6.8 0 0 0 21 7.4 4.4 4.4 0 0 0 16.6 3H12Z"></path>
    <circle cx="7.5" cy="10" r="1"></circle>
    <circle cx="10" cy="6.7" r="1"></circle>
    <circle cx="14" cy="6.4" r="1"></circle>
  </svg>`;

  if (topoChatPersonalizacao) {
    if (modosChatPersonalizacao) {
      topoChatPersonalizacao.insertBefore(
        botaoPersonalizarConversa,
        modosChatPersonalizacao,
      );
    } else {
      topoChatPersonalizacao.appendChild(botaoPersonalizarConversa);
    }
  }

  const overlayPersonalizarConversa = document.createElement("div");
  overlayPersonalizarConversa.className = "personalizar-conversa-overlay";
  overlayPersonalizarConversa.hidden = true;
  overlayPersonalizarConversa.style.display = "none";
  overlayPersonalizarConversa.style.visibility = "hidden";
  overlayPersonalizarConversa.style.pointerEvents = "none";
  overlayPersonalizarConversa.innerHTML = `
  <section class="personalizar-conversa-card" role="dialog" aria-modal="true" aria-label="Aparência da conversa">
    <div class="personalizar-conversa-topo">
      <div>
        <strong>Aparência da conversa</strong>
        <span>Esta personalização vale somente para esta conversa.</span>
      </div>
      <button type="button" class="personalizar-conversa-fechar" aria-label="Fechar">×</button>
    </div>

    <div class="personalizar-conversa-corpo">
      <div class="personalizar-conversa-preview">
        <div class="personalizar-preview-msg recebida">Fica só entre a gente.</div>
        <div class="personalizar-preview-msg enviada">Do jeitinho que você escolher ✓✓</div>
      </div>

      <div class="personalizar-conversa-secao">
        <div class="personalizar-conversa-secao-titulo">Estilo</div>
        <div class="personalizar-modos">
          <button type="button" data-modo-aparencia="padrao">Padrão</button>
          <button type="button" data-modo-aparencia="solida">Cor sólida</button>
          <button type="button" data-modo-aparencia="papel">Papel de parede</button>
        </div>
      </div>

      <div class="personalizar-conversa-secao personalizar-secao-cores">
        <div class="personalizar-conversa-secao-titulo">Cor de fundo</div>
        <div class="personalizar-cores"></div>
        <label class="personalizar-cor-livre">
          <span>Cor personalizada</span>
          <input type="color" value="#0b141a" aria-label="Escolher cor personalizada">
        </label>
      </div>

      <div class="personalizar-conversa-secao personalizar-secao-papeis">
        <div class="personalizar-conversa-secao-titulo">Papel de parede</div>
        <div class="personalizar-papeis"></div>
        <label class="personalizar-intensidade">
          <span>Intensidade do desenho</span>
          <input type="range" min="3" max="15" step="1" value="7">
        </label>
      </div>
    </div>

    <div class="personalizar-conversa-rodape">
      <button type="button" class="personalizar-conversa-restaurar">Restaurar padrão</button>
      <button type="button" class="personalizar-conversa-aplicar">Aplicar</button>
    </div>
  </section>`;

  document.body.appendChild(overlayPersonalizarConversa);

  const fecharPersonalizacaoConversa =
    overlayPersonalizarConversa.querySelector(".personalizar-conversa-fechar");
  const aplicarPersonalizacaoConversa =
    overlayPersonalizarConversa.querySelector(".personalizar-conversa-aplicar");
  const restaurarPersonalizacaoConversa =
    overlayPersonalizarConversa.querySelector(
      ".personalizar-conversa-restaurar",
    );
  const modosPersonalizacao = Array.from(
    overlayPersonalizarConversa.querySelectorAll("[data-modo-aparencia]"),
  );
  const listaCoresPersonalizacao = overlayPersonalizarConversa.querySelector(
    ".personalizar-cores",
  );
  const listaPapeisPersonalizacao = overlayPersonalizarConversa.querySelector(
    ".personalizar-papeis",
  );
  const seletorCorPersonalizada = overlayPersonalizarConversa.querySelector(
    '.personalizar-cor-livre input[type="color"]',
  );
  const seletorIntensidadePapel = overlayPersonalizarConversa.querySelector(
    '.personalizar-intensidade input[type="range"]',
  );
  const previewPersonalizacao = overlayPersonalizarConversa.querySelector(
    ".personalizar-conversa-preview",
  );
  const secaoPapeisPersonalizacao = overlayPersonalizarConversa.querySelector(
    ".personalizar-secao-papeis",
  );

  let conversaPersonalizacaoAberta = null;
  let rascunhoAparenciaConversa = null;

  for (const item of CORES_CONVERSA_PREDEFINIDAS) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "personalizar-cor-opcao";
    botao.dataset.cor = item.cor;
    botao.title = item.nome;
    botao.setAttribute("aria-label", item.nome);
    botao.style.background = item.cor;
    listaCoresPersonalizacao?.appendChild(botao);
  }

  for (const item of PAPEIS_CONVERSA) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "personalizar-papel-opcao";
    botao.dataset.papel = item.id;
    botao.innerHTML = `<span class="personalizar-papel-amostra"></span><span>${item.simbolo} ${item.nome}</span>`;
    const amostra = botao.querySelector(".personalizar-papel-amostra");
    amostra.style.backgroundColor = "#0b141a";
    amostra.style.backgroundImage = svgPapelConversa(item.id, 0.1);
    amostra.style.backgroundSize = "170px 145px";
    amostra.style.backgroundPosition = "-22px -18px";
    listaPapeisPersonalizacao?.appendChild(botao);
  }

  function atualizarPreviewPersonalizacao() {
    if (!rascunhoAparenciaConversa || !previewPersonalizacao) return;

    const a = rascunhoAparenciaConversa;
    previewPersonalizacao.style.backgroundColor = a.cor;
    previewPersonalizacao.style.backgroundImage =
      a.modo === "papel" ? svgPapelConversa(a.papel, a.intensidade) : "none";
    previewPersonalizacao.style.backgroundSize = "250px 214px";
    previewPersonalizacao.style.backgroundPosition = "-35px -28px";

    for (const botao of modosPersonalizacao) {
      botao.classList.toggle("ativo", botao.dataset.modoAparencia === a.modo);
    }

    for (const botao of listaCoresPersonalizacao?.querySelectorAll(
      ".personalizar-cor-opcao",
    ) || []) {
      botao.classList.toggle(
        "ativo",
        String(botao.dataset.cor).toLowerCase() === String(a.cor).toLowerCase(),
      );
    }

    for (const botao of listaPapeisPersonalizacao?.querySelectorAll(
      ".personalizar-papel-opcao",
    ) || []) {
      botao.classList.toggle("ativo", botao.dataset.papel === a.papel);
    }

    if (seletorCorPersonalizada) seletorCorPersonalizada.value = a.cor;
    if (seletorIntensidadePapel)
      seletorIntensidadePapel.value = String(Math.round(a.intensidade * 100));

    secaoPapeisPersonalizacao?.classList.toggle(
      "desabilitada",
      a.modo !== "papel",
    );
  }

  function abrirPersonalizacaoConversa(evento = null) {
    evento?.preventDefault?.();
    evento?.stopPropagation?.();
    evento?.stopImmediatePropagation?.();

    const conversaIdAtiva = String(obterConversaAtual?.() || "").trim();
    const conversa = conversaIdAtiva
      ? conversas[conversaIdAtiva] || null
      : null;

    console.log(
      `[UI] PERSONALIZER_CLICK | conversaAtual=${conversaIdAtiva || "none"} | encontrada=${Boolean(conversa)}`,
    );

    if (!conversaIdAtiva) {
      console.log("[UI] PERSONALIZER_OPEN_SKIPPED | no_active_conversation");
      return;
    }

    conversaPersonalizacaoAberta = conversa?.id || conversaIdAtiva;
    rascunhoAparenciaConversa = {
      ...obterAparenciaConversa(conversaPersonalizacaoAberta),
    };

    // Estado de abertura totalmente explicito para nao depender de regras antigas.
    overlayPersonalizarConversa.hidden = false;
    overlayPersonalizarConversa.removeAttribute("hidden");
    overlayPersonalizarConversa.classList.add("aberto");
    overlayPersonalizarConversa.style.setProperty(
      "display",
      "flex",
      "important",
    );
    overlayPersonalizarConversa.style.setProperty(
      "visibility",
      "visible",
      "important",
    );
    overlayPersonalizarConversa.style.setProperty(
      "pointer-events",
      "auto",
      "important",
    );
    overlayPersonalizarConversa.style.setProperty("opacity", "1", "important");
    overlayPersonalizarConversa.style.setProperty(
      "z-index",
      "2147483000",
      "important",
    );

    atualizarPreviewPersonalizacao();

    console.log(
      `[UI] PERSONALIZER_OPEN | conversa=${conversaPersonalizacaoAberta} | modo=${rascunhoAparenciaConversa.modo} | papel=${rascunhoAparenciaConversa.papel}`,
    );
  }

  function fecharPersonalizacaoConversaPainel() {
    overlayPersonalizarConversa.classList.remove("aberto");
    overlayPersonalizarConversa.style.removeProperty("display");
    overlayPersonalizarConversa.style.removeProperty("visibility");
    overlayPersonalizarConversa.style.removeProperty("pointer-events");
    overlayPersonalizarConversa.style.removeProperty("opacity");
    overlayPersonalizarConversa.style.removeProperty("z-index");
    overlayPersonalizarConversa.hidden = true;
    overlayPersonalizarConversa.setAttribute("hidden", "");
    conversaPersonalizacaoAberta = null;
    rascunhoAparenciaConversa = null;
  }

  // Captura direta no proprio botao. O botao nunca fica disabled, pois um
  // elemento disabled nao dispara click no Chromium/Electron. Sem conversa,
  // a funcao apenas ignora o clique.
  botaoPersonalizarConversa.addEventListener(
    "click",
    abrirPersonalizacaoConversa,
    true,
  );

  // Fallback global em captura, caso algum elemento do cabecalho intercepte o clique.
  document.addEventListener(
    "click",
    (evento) => {
      const alvo = evento.target?.closest?.(".chat-personalizar-conversa");
      if (!alvo || alvo !== botaoPersonalizarConversa) return;
      abrirPersonalizacaoConversa(evento);
    },
    true,
  );
  fecharPersonalizacaoConversa?.addEventListener(
    "click",
    fecharPersonalizacaoConversaPainel,
  );
  overlayPersonalizarConversa.addEventListener("click", (evento) => {
    if (evento.target === overlayPersonalizarConversa)
      fecharPersonalizacaoConversaPainel();
  });

  for (const botao of modosPersonalizacao) {
    botao.addEventListener("click", () => {
      if (!rascunhoAparenciaConversa) return;
      rascunhoAparenciaConversa.modo = botao.dataset.modoAparencia;
      atualizarPreviewPersonalizacao();
    });
  }

  listaCoresPersonalizacao?.addEventListener("click", (evento) => {
    const botao = evento.target.closest(".personalizar-cor-opcao");
    if (!botao || !rascunhoAparenciaConversa) return;
    rascunhoAparenciaConversa.cor = botao.dataset.cor;
    if (rascunhoAparenciaConversa.modo === "padrao")
      rascunhoAparenciaConversa.modo = "solida";
    atualizarPreviewPersonalizacao();
  });

  seletorCorPersonalizada?.addEventListener("input", () => {
    if (!rascunhoAparenciaConversa) return;
    rascunhoAparenciaConversa.cor = seletorCorPersonalizada.value;
    if (rascunhoAparenciaConversa.modo === "padrao")
      rascunhoAparenciaConversa.modo = "solida";
    atualizarPreviewPersonalizacao();
  });

  listaPapeisPersonalizacao?.addEventListener("click", (evento) => {
    const botao = evento.target.closest(".personalizar-papel-opcao");
    if (!botao || !rascunhoAparenciaConversa) return;
    rascunhoAparenciaConversa.papel = botao.dataset.papel;
    rascunhoAparenciaConversa.modo = "papel";
    atualizarPreviewPersonalizacao();
  });

  seletorIntensidadePapel?.addEventListener("input", () => {
    if (!rascunhoAparenciaConversa) return;
    rascunhoAparenciaConversa.intensidade =
      Number(seletorIntensidadePapel.value) / 100;
    atualizarPreviewPersonalizacao();
  });

  aplicarPersonalizacaoConversa?.addEventListener("click", () => {
    if (!conversaPersonalizacaoAberta || !rascunhoAparenciaConversa) return;
    aparenciasConversas[conversaPersonalizacaoAberta] = {
      ...rascunhoAparenciaConversa,
    };
    salvarAparenciasConversas();
    aplicarAparenciaConversa(conversaPersonalizacaoAberta);
    console.log(
      `[UI] PERSONALIZER_APPLY | conversa=${conversaPersonalizacaoAberta} | modo=${rascunhoAparenciaConversa.modo} | papel=${rascunhoAparenciaConversa.papel}`,
    );
    fecharPersonalizacaoConversaPainel();
  });

  restaurarPersonalizacaoConversa?.addEventListener("click", () => {
    if (!conversaPersonalizacaoAberta) return;
    delete aparenciasConversas[conversaPersonalizacaoAberta];
    salvarAparenciasConversas();
    rascunhoAparenciaConversa = obterAparenciaConversa(
      conversaPersonalizacaoAberta,
    );
    aplicarAparenciaConversa(conversaPersonalizacaoAberta);
    atualizarPreviewPersonalizacao();
    console.log(
      `[UI] PERSONALIZER_RESET | conversa=${conversaPersonalizacaoAberta}`,
    );
  });

  return {
    botaoPersonalizarConversa,
    aplicarAparenciaConversa,
    obterAparenciaConversa,
  };
}

module.exports = { criarPersonalizacaoConversa };
