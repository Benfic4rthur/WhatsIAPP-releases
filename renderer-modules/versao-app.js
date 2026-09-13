"use strict";

// Le o pacote instalado: nao usa versao fixa nem a release mais recente da internet.
(() => {
  // Script carregado por app.html: require e relativo a raiz da pagina.
  const pacote = require('./package.json');
  const marca = document.querySelector('.lateral-marca-texto');
  if (!marca) return;
  const versao = document.createElement('small');
  versao.className = 'app-versao';
  versao.textContent = `v${pacote.version}`;
  versao.title = `Versão instalada${pacote.localTestBuild ? ' — teste local' : ''}`;
  versao.setAttribute('aria-label', `${versao.title}: ${pacote.version}`);
  marca.appendChild(versao);
})();
