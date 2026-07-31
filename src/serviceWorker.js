// Enregistrement du service worker.
//
// Volontairement en dehors de main.jsx : l'enregistrement doit attendre
// que la page soit chargée, sans quoi il entre en concurrence avec le
// téléchargement du code de l'application sur une connexion lente —
// exactement l'inverse du but recherché.
//
// En développement, on ne l'enregistre PAS : un service worker qui met
// en cache des modules servis par Vite masque les modifications en
// cours et donne l'impression que le code ne prend pas.
export function enregistrerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      // Un échec n'est pas grave : l'application fonctionne sans, elle
      // se contente de retélécharger son code à chaque ouverture.
      console.warn("Service worker non enregistré :", e?.message);
    });
  });
}
