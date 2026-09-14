"use strict";

const fs = require("node:fs");
const sharp = require("sharp");

const TAMANHOS = [16, 24, 32, 48, 64, 128, 256];

async function prepararIconeWindows(entrada, saida) {
  if (!entrada || !saida) {
    throw new Error(
      "Uso: node preparar-icone-windows.js entrada.png saida.ico",
    );
  }

  const imagens = await Promise.all(
    TAMANHOS.map(async (tamanho) => {
      const { data, info } = await sharp(entrada)
        .ensureAlpha()
        .resize(tamanho, tamanho, { fit: "contain" })
        .raw()
        .toBuffer({ resolveWithObject: true });

      for (let indice = 0; indice < data.length; indice += info.channels) {
        if (data[indice + 3] < 16) {
          data[indice] = 0;
          data[indice + 1] = 0;
          data[indice + 2] = 0;
          data[indice + 3] = 0;
        }
      }

      return sharp(data, { raw: info })
        .png()
        .toBuffer();
    }),
  );

  const cabecalho = Buffer.alloc(6 + imagens.length * 16);
  cabecalho.writeUInt16LE(0, 0);
  cabecalho.writeUInt16LE(1, 2);
  cabecalho.writeUInt16LE(imagens.length, 4);

  let deslocamento = cabecalho.length;

  imagens.forEach((imagem, indice) => {
    const tamanho = TAMANHOS[indice];
    const posicao = 6 + indice * 16;

    cabecalho.writeUInt8(tamanho === 256 ? 0 : tamanho, posicao);
    cabecalho.writeUInt8(tamanho === 256 ? 0 : tamanho, posicao + 1);
    cabecalho.writeUInt8(0, posicao + 2);
    cabecalho.writeUInt8(0, posicao + 3);
    cabecalho.writeUInt16LE(1, posicao + 4);
    cabecalho.writeUInt16LE(32, posicao + 6);
    cabecalho.writeUInt32LE(imagem.length, posicao + 8);
    cabecalho.writeUInt32LE(deslocamento, posicao + 12);
    deslocamento += imagem.length;
  });

  fs.writeFileSync(saida, Buffer.concat([cabecalho, ...imagens]));
  console.log(`Ícone Windows transparente criado em ${saida}`);
}

if (require.main === module) {
  prepararIconeWindows(...process.argv.slice(2)).catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
  });
}

module.exports = { prepararIconeWindows, TAMANHOS };
