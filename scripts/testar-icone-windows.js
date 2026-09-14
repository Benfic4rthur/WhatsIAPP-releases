"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { TAMANHOS } = require("./preparar-icone-windows");

(async () => {
  const raiz = path.join(__dirname, "..");
  const pacote = require(path.join(raiz, "package.json"));
  const caminho = path.join(raiz, pacote.build.win.icon);
  const ico = fs.readFileSync(caminho);

  assert.equal(pacote.build.win.icon, "assets/logo-taskbar.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), TAMANHOS.length);

  for (let indice = 0; indice < TAMANHOS.length; indice += 1) {
    const posicao = 6 + indice * 16;
    const tamanho = TAMANHOS[indice];
    const largura = ico.readUInt8(posicao) || 256;
    const altura = ico.readUInt8(posicao + 1) || 256;
    const bytes = ico.readUInt32LE(posicao + 8);
    const inicio = ico.readUInt32LE(posicao + 12);
    const png = ico.subarray(inicio, inicio + bytes);
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    assert.equal(largura, tamanho);
    assert.equal(altura, tamanho);
    assert.equal(info.width, tamanho);
    assert.equal(info.height, tamanho);
    assert.equal(data[3], 0, `canto do ícone ${tamanho} deve ser transparente`);
  }

  console.log("Ícone Windows: múltiplos tamanhos e transparência PASS");
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
