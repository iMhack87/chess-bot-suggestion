// Wrapper de worker autour du build Stockfish WASM : remonte au parent les
// échecs silencieux (CSP WASM, fetch du .wasm, import du script) sous forme
// de lignes préfixées WRAPPER-, puis charge le moteur dans ce même scope.

self.addEventListener("error", function (e) {
  postMessage("WRAPPER-ERROR: " + (e.message || e));
});
self.addEventListener("unhandledrejection", function (e) {
  var r = e.reason;
  postMessage("WRAPPER-ERROR: promesse rejetée: " + (r && r.message ? r.message : r));
});

try {
  // Module WASM minimal (magic + version) : vérifie que la CSP autorise la compilation.
  new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  postMessage("WRAPPER-INFO: compilation WASM autorisée");
} catch (e) {
  postMessage("WRAPPER-ERROR: WASM bloqué (CSP ?): " + e.message);
}

fetch("stockfish.wasm")
  .then(function (r) {
    postMessage("WRAPPER-INFO: fetch stockfish.wasm → HTTP " + r.status);
  })
  .catch(function (e) {
    postMessage("WRAPPER-ERROR: fetch stockfish.wasm: " + e.message);
  });

try {
  importScripts("stockfish.wasm.js");
  postMessage("WRAPPER-INFO: script moteur importé");
} catch (e) {
  postMessage("WRAPPER-ERROR: importScripts: " + e.message);
}
