# Coach Amical — extension Chrome chess.com

Extension MV3 : suggestions de coups Stockfish sur chess.com (parties
amicales, accord des deux joueurs — rappel affiché dans l'UI, à conserver).

## Commandes

- Tests logique : `node test/logic.test.js` (doit finir exit 0)
- Syntaxe : `node --check content.js background.js offscreen.js`
- Test E2E : charger le dossier via `chrome://extensions` (mode développeur,
  « Charger l'extension non empaquetée »), ouvrir une partie chess.com.
- Pas de build ni de déploiement : le dossier EST l'extension.

## Architecture

content.js (lit les coups, dessine) → background.js (service worker, relais)
→ offscreen.html/js (Worker Stockfish, UCI). `vendor/` est committé :
stockfish.wasm.js + stockfish.wasm (build lichess 10.0.2, mono-thread) et
chess.js 0.13.4 (UMD).

## Pièges connus

- Les sélecteurs DOM chess.com changent régulièrement : la liste des coups
  est cherchée via plusieurs sélecteurs dans `sanMovesFromDOM()` (content.js).
  Si les suggestions ne suivent plus la partie, commencer par là.
- Le CSP `wasm-unsafe-eval` dans manifest.json est indispensable au WASM.
- Le build Stockfish s'utilise comme script de Worker (postMessage de chaînes
  UCI). Sous Node (smoke-test), lancer depuis `vendor/` et patcher
  `global.fetch`/`postMessage` — voir l'historique de test.
- chess.js 0.13.4 : API `game_over()`, `move(san, {sloppy:true})` (pas l'API 1.x).
- `vendor/chess.js` est PATCHÉ localement : les builds cdnjs 0.13.4 (min et non-min)
  sont des modules ES (`export`) → SyntaxError silencieuse en content script
  (`Chess is not defined`). Patch : `export const` → `var` + footer CJS pour les
  tests Node. Ne pas re-télécharger sans réappliquer.
- Après toute modif des fichiers, RECHARGER l'extension (chrome://extensions,
  flèche ⟳ sur la carte) avant de tester : Chrome sert l'ancienne version sinon.
- Un seul onglet analysé à la fois (background garde `lastTabId`).
