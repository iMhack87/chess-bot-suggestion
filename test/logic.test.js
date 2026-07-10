// Test hors navigateur des briques critiques du content script :
// nettoyage SAN (mêmes regex que content.js), reconstruction FEN via chess.js,
// conversion UCI → SAN et coordonnées de flèche.
// Lancer : node test/logic.test.js

const { Chess } = require("../vendor/chess.js");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) {
    console.log(`  attendu : ${JSON.stringify(expected)}`);
    console.log(`  obtenu  : ${JSON.stringify(actual)}`);
    failures++;
  }
}

// --- Nettoyage SAN (copie exacte des regex de content.js) ---
function cleanSan(raw) {
  let san = raw;
  san = san.replace(/0-0-0/g, "O-O-O").replace(/0-0/g, "O-O");
  san = san.replace(/[^a-hNBRQKO1-8x=+#-]/g, "");
  return san;
}

check("SAN simple", cleanSan(" e4 "), "e4");
check("SAN figurine résidus", cleanSan(" Nf3!?"), "Nf3");
check("petit roque 0-0", cleanSan("0-0"), "O-O");
check("grand roque O-O-O+ (le + est conservé, accepté par chess.js)", cleanSan("O-O-O+"), "O-O-O+");
check("prise avec échec", cleanSan("Qxf7#"), "Qxf7#");
check("promotion", cleanSan("e8=Q+"), "e8=Q+");

// --- Reconstruction FEN depuis une liste SAN ---
function fenFromMoves(moves) {
  const game = new Chess();
  for (const san of moves) {
    if (!game.move(san, { sloppy: true })) return null;
  }
  return game.fen();
}

check(
  "FEN après 1.e4 e5 2.Nf3",
  fenFromMoves(["e4", "e5", "Nf3"]),
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"
);

check(
  "FEN avec roque et prises",
  fenFromMoves(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6"]),
  "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 6 5"
);

check("coup illégal détecté", fenFromMoves(["e4", "e4"]), null);

// Partie complète avec promotion (SAN nettoyés comme dans le DOM)
const promoGame = ["e4", "d5", "exd5", "c6", "dxc6", "Qd7", "cxb7", "Qc6", "bxa8=Q"];
const promoFen = fenFromMoves(promoGame);
check("promotion en dame acceptée", promoFen !== null, true);

// --- UCI → SAN (copie de la logique de content.js) ---
function uciToSan(fen, uci) {
  const g = new Chess(fen);
  const mv = g.move(
    { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] },
    { sloppy: true }
  );
  return mv ? mv.san : uci;
}

check("uciToSan e2e4", uciToSan(new Chess().fen(), "e2e4"), "e4");
check(
  "uciToSan roque",
  uciToSan("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5", "e1g1"),
  "O-O"
);
check(
  "uciToSan promotion",
  uciToSan("8/P7/8/8/8/8/8/K3k3 w - - 0 1", "a7a8q"),
  "a8=Q"
);

// --- Coordonnées de flèche (copie de squareCenter de content.js) ---
function squareCenter(square, flipped) {
  const fileIdx = square.charCodeAt(0) - 97;
  const rankIdx = Number(square[1]) - 1;
  const x = flipped ? 7 - fileIdx : fileIdx;
  const y = flipped ? rankIdx : 7 - rankIdx;
  return { x: (x + 0.5) * 12.5, y: (y + 0.5) * 12.5 };
}

check("a1 vue blancs (coin bas-gauche)", squareCenter("a1", false), { x: 6.25, y: 93.75 });
check("h8 vue blancs (coin haut-droit)", squareCenter("h8", false), { x: 93.75, y: 6.25 });
check("a1 vue noirs (coin haut-droit)", squareCenter("a1", true), { x: 93.75, y: 6.25 });
check("e4 vue blancs", squareCenter("e4", false), { x: 56.25, y: 56.25 });

// --- Évaluation formatée (copie de formatEval de content.js) ---
function formatEval(fen, cp, mate) {
  const whiteToMove = fen.split(" ")[1] === "w";
  if (mate != null) {
    const m = whiteToMove ? mate : -mate;
    const n = Math.abs(mate);
    return m > 0 ? `mat en ${n} (Blancs)` : `mat en ${n} (Noirs)`;
  }
  if (cp == null) return "";
  const v = (whiteToMove ? cp : -cp) / 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} (Blancs)`;
}

check("éval +50cp trait blancs", formatEval("8/8/8/8/8/8/8/8 w - - 0 1", 50, null), "+0.50 (Blancs)");
check("éval +50cp trait noirs → -0.50", formatEval("8/8/8/8/8/8/8/8 b - - 0 1", 50, null), "-0.50 (Blancs)");
check("mat en 2 trait noirs", formatEval("8/8/8/8/8/8/8/8 b - - 0 1", null, 2), "mat en 2 (Noirs)");

process.exit(failures ? 1 : 0);
