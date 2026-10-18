# CutLab
Editor de vídeo 100% gratuito com funcionalidades profissionais para fins de estudo e comerciais. Feito para lutar contra preços abusivos das grandes empresas e práticas predatórias. 

**Use agora:** https://lukadsgr.github.io/CutLab/ (roda direto no navegador, sem instalar nada)

## Licença

Copyright (C) 2026 LUKADSGR

Este programa é software livre: você pode usá-lo — inclusive comercialmente —, estudá-lo, redistribuí-lo e modificá-lo sob os termos da **GNU General Public License versão 3** (GPL v3), publicada pela Free Software Foundation.

Em resumo: quem distribuir o CutLab ou uma versão modificada dele (inclusive publicando como site) precisa manter a mesma licença e disponibilizar o código-fonte. Assim o editor continua livre para todos.

O texto completo está em [LICENSE](LICENSE).

## Programa para Windows (.exe)

A pasta `desktop/` empacota o mesmo editor como programa de Windows com Electron. Ele traz React e o gerador de MP4 embutidos (abre sem internet; legendas automáticas, stickers e algumas fontes ainda baixam da internet) e avisa quando há versão nova: aparece o botão **Atualização disponível** na barra superior, e o usuário clica para baixar e depois para reiniciar e instalar. Também dá para procurar em **Menu › Procurar atualizações…**.

```bash
cd desktop
npm install
npm start        # abre o programa sem instalar
npm run dist     # gera desktop/dist/CutLab-Setup-<versão>.exe
```

**Lançar uma versão:** aumente `version` em `desktop/package.json`, faça o commit e envie uma tag igual (ex.: `v0.2.0`). O workflow *Lançar versão desktop* gera o instalador e publica no GitHub Releases; os programas já instalados encontram a atualização sozinhos. O instalador não é assinado digitalmente, então o Windows mostra o aviso do SmartScreen na primeira instalação (Mais informações › Executar assim mesmo).
