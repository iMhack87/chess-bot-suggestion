# Coach Amical — extension Chrome chess.com

Extension MV3 : suggestions de coups Stockfish sur chess.com (parties
amicales, accord des deux joueurs — rappel affiché dans l'UI, à conserver).

## Commandes

- Tests logique : `node test/logic.test.js` (doit finir exit 0)
- Syntaxe : `node --check content.js engine-sw.js`
- E2E : partie vs bot sur chess.com/play/computer, vérifier panneau + flèche.
- Pas de build ni de déploiement : le dossier EST l'extension.

## Architecture

content.js (liste de coups → FEN via chess.js, flèche SVG + panneau)
↔ engine-sw.js (service worker : Stockfish asm.js chargé par importScripts,
UCI en direct, recherche synchrone bornée par movetime). `vendor/` committé :
stockfish.asm.js (10, build 2019 lichess, pur JS) et chess.js 0.13.4 patché.

## Pièges connus (tous vécus — ne pas re-découvrir)

- **`setoption name Threads value 1` PEND ce build Stockfish** (boucle infinie).
  Ne jamais envoyer de setoption Threads/Hash ; uci → isready → go suffit.
- **Recherche synchrone dans le SW** : toujours borner par `movetime` (≤ 4 s),
  sinon le SW bloque puis est tué par Chrome (~30 s) sans erreur visible.
- **Pas de moteur en Web Worker ni en document offscreen** : Chrome gèle
  timers/MessageChannel/tâches DOM de ces contextes de façon imprévisible.
  Seuls le SW (pendant un événement) et chrome.runtime sont fiables.
- **Sortie moteur = print synchrone pendant le ccall** : mettre en file et
  vider en microtâche, jamais rappeler le moteur depuis son propre print.
- **Rechargement d'une extension non empaquetée sans clic** (via
  quitter/relancer Chrome par AppleScript) : les fichiers ne sont relus au
  redémarrage QUE si le manifest a changé → bumper `version` à chaque
  itération. Le script du SW est encore plus têtu : le RENOMMER
  (+ manifest) à chaque modif. Sinon : clic ⟳ dans chrome://extensions.
- `setoption name Skill Level` est sûr (retour immédiat), contrairement à
  Threads/Hash. Niveaux Elo : voir LEVELS dans content.js (skill+depth).
- `vendor/chess.js` est PATCHÉ (builds cdnjs = modules ES → SyntaxError en
  content script) : `export const` → `var` + footer CJS pour les tests Node.
- chess.js 0.13.4 : API `game_over()`, `move(san, {sloppy:true})` (pas la 1.x).
- Sélecteurs DOM chess.com fragiles : voir `sanMovesFromDOM()` (content.js),
  gérer les figurines via `[data-figurine]`.
- Un seul onglet analysé à la fois (`lastTabId` dans le SW) ; le content
  script relance l'analyse si pas de réponse en 8 s (SW froid ou message perdu).
