# Coach Amical — Suggestions Stockfish pour chess.com

Extension Chrome (Manifest V3) qui affiche le meilleur coup calculé par
Stockfish pendant une partie sur chess.com : flèche sur l'échiquier +
panneau flottant avec le coup en notation, l'évaluation et la profondeur.

> ⚠️ **Usage prévu : parties amicales (non classées) avec l'accord explicite
> des deux joueurs.** Même en partie amicale, les conditions d'utilisation de
> chess.com interdisent l'assistance d'un moteur contre d'autres joueurs et
> leur système anti-triche peut sanctionner un compte. À réserver strictement
> à vos parties entre vous, en connaissance de cause.

## Installation

1. Ouvrir Chrome → `chrome://extensions`
2. Activer le **Mode développeur** (interrupteur en haut à droite)
3. Cliquer **Charger l'extension non empaquetée** et choisir ce dossier
4. Ouvrir une partie sur chess.com : le panneau « ♞ Coach amical » apparaît
   en haut à droite

## Utilisation

- La flèche verte indique le meilleur coup pour le camp au trait ; le panneau
  affiche le coup en notation (ex. `Cf3`), l'évaluation côté Blancs et la
  profondeur atteinte.
- L'interrupteur du panneau active/désactive les suggestions (mémorisé).
- Le niveau est réglable : **Maximum** (pleine force, profondeur 15) ou
  bridé **~1600 / ~1300 / ~1000 Elo** (option UCI `Skill Level` + profondeur
  réduite — le moteur joue alors des coups imparfaits, comme un humain).
  Le choix est mémorisé.

## Fonctionnement

- `content.js` lit la liste des coups de la partie dans la page, reconstruit
  la position avec **chess.js** (FEN complet : trait, roques, en passant),
  et dessine la suggestion. Plan B si la liste des coups est introuvable :
  scan des pièces sur l'échiquier.
- `engine-sw.js` (service worker) héberge **Stockfish 10 (build asm.js, pur
  JavaScript)** chargé par `importScripts` et parle UCI en direct — recherche
  synchrone bornée dans le temps. Tout tourne en local, aucune donnée ne
  sort du navigateur. (Pourquoi pas de Web Worker ni de document offscreen :
  Chrome gèle leurs timers et files de tâches — voir CLAUDE.md.)

## Tests

```sh
node test/logic.test.js   # nettoyage SAN, FEN, UCI→SAN, coordonnées flèche
```

## Licence des dépendances

- [stockfish.js](https://github.com/niklasf/stockfish.js) — GPL-3.0
- [chess.js](https://github.com/jhlywa/chess.js) 0.13.4 — BSD-2-Clause (patché : voir CLAUDE.md)
