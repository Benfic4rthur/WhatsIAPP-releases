# Preparacao Windows — etapa 1

Versao preservada. Nenhum workflow, publicacao ou autoatualizador foi alterado.

Em uma maquina/runner Windows x64, com Node 22:

1. Obtenha o projeto sem copiar node_modules, sessoes ou pastas de dados de outra maquina.
2. Execute `npm ci` e `npx puppeteer browsers install chrome`.
3. Execute `npm test`, `node scripts/testar-sincronizacao-recente.js` e `npm run test:windows-packaging`.
4. Execute `npm run dist:win`.

Saida: `dist/windows/WhatsIAPP-Setup-<versao>-x64.exe` e arquivos auxiliares.
O comando nao publica e nao limpa os DMGs. O icone PNG existente e convertido pelo electron-builder.
Chrome inteiro (sem perfil) e copiado para `resources/wppconnect-chrome/chrome-win64`.
FFmpeg fica em `app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe`.
O build recusa host diferente de Windows x64 e executaveis de outra arquitetura.

Os testes no Mac usam fixtures; nao equivalem a executar o instalador Windows.
A etapa 2 devera chamar esse comando no runner Windows. Depois, validar em Windows real:
instalacao em caminho com espacos, dois QR codes, reabertura sem novo login, envio/recebimento
de imagem/audio/video, conversao pelo FFmpeg, recuperacao de midia, historico recente e
preservacao das sessoes ao reinstalar. Nenhum teste envia mensagens automaticamente.
