# Publicar Sede nas lojas (Google Play e App Store)

Levantamento do que falta para publicar o jogo como app, a partir do PWA
que já existe hoje. Nenhuma das duas lojas aceita simplesmente enviar a URL
— as duas exigem um pacote nativo (`.apk`/`.aab` ou `.ipa`), então o
caminho é sempre "empacotar o PWA".

## Google Play (Android) — caminho mais simples: TWA

O Android tem um caminho oficial e maduro pra isso: **Trusted Web
Activity** (TWA), que é essencialmente o Chrome renderizando seu site
dentro de um app nativo, sem barra de navegador. Ferramenta: **Bubblewrap**
(CLI oficial do Google) ou o site **PWABuilder.com** (mais visual, gera o
projeto pra você).

**O que falta hoje, tecnicamente:**
1. O manifest (`vite.config.ts`, seção PWA) já tem nome, ícones,
   `display`/`orientation` — isso já está pronto.
2. **Pontuação Lighthouse PWA ≥ 80** — não verificado ainda; vale rodar
   `npx lighthouse <url-de-produção> --view` antes de empacotar.
3. **`assetlinks.json`** — um arquivo que precisa ficar hospedado em
   `https://<seu-domínio>/.well-known/assetlinks.json`, provando que você é
   dono do domínio (contém a impressão digital SHA-256 da chave que assina
   o `.aab`). Sem isso o Android sempre mostra uma barra de navegador por
   cima do jogo.
4. **Uma conta de desenvolvedor Google Play** — taxa única de US$25,
   cadastro em https://play.google.com/console/signup (isso é algo que só
   você pode fazer, com seus próprios dados/cartão).
5. Rodar `bubblewrap init --manifest=https://<seu-domínio>/manifest.webmanifest`
   → gera o projeto Android → `bubblewrap build` → produz o `.aab` pra
   subir no Play Console.

Esse caminho eu consigo preparar quase todo sozinho (rodar o Lighthouse,
gerar o `assetlinks.json` assim que soubermos o domínio final, rodar o
Bubblewrap) — só a conta de desenvolvedor e o envio final no Play Console
dependem de você.

## Apple App Store (iOS) — mais restrito

A Apple **não tem** um equivalente ao TWA. O caminho é embrulhar o PWA
numa casca nativa real via **Capacitor**, e isso vem com uma pegadinha
importante:

- A Apple rejeita apps que são "só um site dentro de um WebView" (regra
  4.2 das App Store Review Guidelines). Pra passar na revisão, o app
  precisa demonstrar funcionalidade nativa além do que um site já faz —
  ex.: notificações push nativas, algum uso de recurso do aparelho, uma
  navegação que não pareça um browser disfarçado.
- Isso é bem menos mecânico que o Android: não é só rodar uma ferramenta,
  é um app real revisado por humanos, com julgamento subjetivo sobre "isso
  parece nativo o suficiente?".
- Também exige **conta Apple Developer Program** — US$99/ano (não é taxa
  única como o Google) — cadastro em https://developer.apple.com/programs/.
  E precisa de um Mac (ou um serviço de build na nuvem tipo Codemagic/
  Ionic Appflow) pra gerar e assinar o `.ipa`, já que o Xcode só roda em
  macOS.

**Recomendação:** publicar primeiro no Google Play (caminho mais rápido e
barato, sem revisão subjetiva de "é nativo o bastante?"), e usar isso como
validação antes de investir os US$99/ano + esforço extra de UX nativo que
a Apple exige.

## Resumo do que é seu vs. meu

| Item | Quem faz |
|---|---|
| Rodar Lighthouse e corrigir o que faltar pra PWA válido | Eu |
| Gerar `assetlinks.json` (assim que tivermos o domínio final) | Eu |
| Rodar Bubblewrap e gerar o `.aab` | Eu |
| Criar conta de desenvolvedor Google Play (US$25) | Você |
| Enviar o `.aab` no Play Console (ficha da loja, capturas de tela, classificação etária) | Você (eu ajudo a preparar os textos/imagens) |
| Criar conta Apple Developer Program (US$99/ano) | Você |
| Rodar Capacitor + ajustar UX pra passar na revisão da Apple | Eu, depois de você ter a conta |
| Build/assinatura do `.ipa` (precisa de Mac ou serviço de build cloud) | Depende — combinamos quando chegar nessa etapa |

Sources:
- [Can You Publish a PWA to the App Store and Google Play? What Works (And What Doesn't) in 2026 | MobiLoud](https://www.mobiloud.com/blog/publishing-pwa-app-store/)
- [Submitting a PWA to Google Play Store using Bubblewrap | Vaadin](https://vaadin.com/blog/submitting-a-pwa-to-google-play-store-using-bubblewrap)
- [Trusted Web Activities Quick Start Guide | Android Developers](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2)
- [Bubblewrap: How To Publish Your PWA In The Google Play Store | Thinktecture](https://www.thinktecture.com/en/pwa/twa-bubblewrap/)
- [App Store Review Guidelines: Will Your Webview App Be Rejected? | MobiLoud](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper/)
- [Transform Your PWA to a Native App with Capacitor](https://capgo.app/blog/transform-pwa-to-native-app-with-capacitor/)
