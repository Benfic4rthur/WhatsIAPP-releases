# WhatsIAPP

Aplicativo desktop Electron. Nao precisa de servidor web ou banco de dados separado.

## Executar no macOS

Ambiente verificado: macOS Apple Silicon, Node 24.21.0 e npm 11.19.0.

```sh
cd /Users/arthurbenfica/Projetos/WhatsIAPP
npm ci
npm run doctor
npm start
```

`npm ci` e necessario na primeira instalacao ou ao trocar de sistema/arquitetura.
Ele instala Electron, FFmpeg e o navegador usado pelo Puppeteer e aplica os patches
locais de compatibilidade. Precisa de internet. Nao copie `node_modules` do Windows.
Nas proximas execucoes, basta `npm start`.

## Painel administrativo

No macOS, abra o painel com `Command + Option + A` (ou `Control + Option + A`).
No Windows/Linux, o atalho continua `Control + Shift + Alt + A`.

## Sessoes e configuracao

- O Baileys (conexao principal) e o WPPConnect (arquivadas e recursos Web) usam sessoes separadas. Escaneie cada QR Code solicitado em WhatsApp > Aparelhos conectados.
- No Mac, os dados de usuario ficam em `~/Library/Application Support/whatsiapp/`. Copiar apenas a pasta do projeto nao transfere os dados que estavam em `%APPDATA%/whatsiapp` no Windows.
- O perfil do navegador WPPConnect existente fica em `tokens/whatsiapp-arquivo` na raiz do projeto. Preserve essa pasta para manter a sessao atual e execute os comandos na raiz do projeto.
- Configure a chave da Groq pela interface para usar os recursos de IA. Ela nao e necessaria para abrir o aplicativo e conectar o WhatsApp.
- Para gravar audio, permita o acesso ao microfone quando o macOS solicitar.

## Verificacao

`npm run doctor` verifica dependencias, execucao do Electron e FFmpeg e a presenca
do navegador Puppeteer. Nao envia mensagens e nao valida o vinculo com o celular.
O script `npm test` original ainda e um placeholder; o testador integrado inclui
operacoes sobre WhatsApp e nao deve ser executado indiscriminadamente.

O `build` atual descreve somente o instalador Windows; `npm start` funciona no Mac
sem empacotamento. A distribuicao como aplicativo macOS ainda exige configurar
empacotamento, assinatura e permissoes do pacote.

Se o terminal que iniciou o aplicativo for fechado, o processo principal trata
`EPIPE` em stdout/stderr para que a escrita dos workers nao abra um alerta fatal.
Para guardar os logs de uma execucao, use `npm start > /tmp/whatsiapp.log 2>&1`.
Os logs podem conter dados de conversas; mantenha-os locais.
