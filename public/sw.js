// ============================================================
// SERVICE WORKER — Ma Bibliothèque
// ============================================================
// Sans lui, l'application retélécharge son code à chaque ouverture, et
// le manifeste PWA promettait une installation que rien ne soutenait.
//
// TROIS STRATÉGIES, selon ce qui est demandé :
//
//   1. La coquille de l'application (index.html) — RÉSEAU D'ABORD.
//      Une mise en cache agressive de l'index figerait la version
//      installée : le déploiement suivant resterait invisible, et il
//      faudrait désinstaller l'icône pour en sortir. On tente donc le
//      réseau, et le cache ne sert que hors ligne.
//
//   2. Le code et les styles (/assets/…) — CACHE D'ABORD.
//      Vite y appose une empreinte dans le nom de fichier : un contenu
//      modifié change de nom. Ces fichiers sont donc immuables, et les
//      servir depuis le cache est à la fois sûr et instantané.
//
//   3. Tout le reste — passe directement au réseau.
//      Ni les images du bucket, ni les appels Supabase, ni les
//      recherches de métadonnées n'ont à transiter par ici : le CDN et
//      le cache HTTP du navigateur s'en chargent déjà, et intercepter
//      des requêtes authentifiées ne ferait qu'ajouter des pièges.
//
// La version est reprise du nom du cache : la changer purge l'ancien.
// ============================================================

const VERSION = "biblio-v1";
const COQUILLE = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(COQUILLE))
      // Un fichier manquant ne doit pas empêcher l'installation : mieux
      // vaut un service worker partiellement utile que pas de service
      // worker du tout.
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms.filter((n) => n !== VERSION).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);

  // Uniquement notre propre origine. Supabase, le bucket d'images et les
  // sources de métadonnées passent au travers sans interception.
  if (url.origin !== self.location.origin) return;

  // 2. Fichiers versionnés par Vite : immuables, donc cache d'abord.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(requete).then((enCache) => {
        if (enCache) return enCache;
        return fetch(requete).then((reponse) => {
          if (reponse.ok) {
            const copie = reponse.clone();
            caches.open(VERSION).then((c) => c.put(requete, copie));
          }
          return reponse;
        });
      })
    );
    return;
  }

  // 1. Navigation : réseau d'abord, cache en secours hors ligne.
  if (requete.mode === "navigate") {
    event.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((c) => c.put("/index.html", copie));
          return reponse;
        })
        .catch(() => caches.match("/index.html").then((r) => r || Response.error()))
    );
    return;
  }

  // 3. Le reste : réseau, sans interception.
});
