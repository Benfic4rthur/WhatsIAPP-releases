const sharp = require("sharp");

(async () => {
  const [entrada, saida] = process.argv.slice(2);
  if (!entrada || !saida) {
    throw new Error("Uso: node preparar-icone-macos.js entrada.png saida.png");
  }

  const { data, info } = await sharp(entrada)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += info.channels) {
    const preto = data[i] < 18 && data[i + 1] < 18 && data[i + 2] < 18;
    if (preto) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }

  await sharp(data, { raw: info }).png().toFile(saida);
  console.log(`Ícone macOS transparente criado em ${saida}`);
})();
