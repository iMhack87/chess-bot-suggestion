// Table des niveaux de jeu, partagée entre le content script (panneau sur la
// page) et le popup de l'extension. Skill Level Stockfish (0-20) + profondeur
// réduite ; correspondances Elo approximatives.
// (Script classique volontairement — pas de module ES, voir CLAUDE.md.)

var SFA_LEVELS = {
  max: { skill: 20, depth: 15, label: "Maximum" },
  1800: { skill: 12, depth: 12, label: "~1800 Elo" },
  1600: { skill: 8, depth: 10, label: "~1600 Elo" },
  1400: { skill: 6, depth: 9, label: "~1400 Elo" },
  1300: { skill: 4, depth: 8, label: "~1300 Elo" },
  1200: { skill: 3, depth: 7, label: "~1200 Elo" },
  1000: { skill: 1, depth: 5, label: "~1000 Elo" },
};

// Ordre d'affichage (les clés numériques d'un objet JS sont triées d'office,
// d'où cette liste explicite).
var SFA_LEVEL_ORDER = ["max", "1800", "1600", "1400", "1300", "1200", "1000"];

// Normalise une valeur de storage (nombre, chaîne, absente…) en clé valide.
function sfaNormalizeLevel(v) {
  return String(v) in SFA_LEVELS ? String(v) : "max";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SFA_LEVELS, SFA_LEVEL_ORDER, sfaNormalizeLevel };
}
