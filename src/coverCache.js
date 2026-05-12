// ============================================================
// CACHE LOCAL DES COUVERTURES (IndexedDB)
// ============================================================
// Les couvertures sont stockées dans Supabase en base64 (~80 Ko/livre).
// Les re-télécharger à chaque démarrage de l'app coûte des centaines de
// Mo par jour de bande passante Supabase. Comme une couverture ne change
// quasiment jamais après sa première récupération, on les met en cache
// dans IndexedDB côté navigateur :
//
//   - Premier démarrage  : on télécharge tout, on remplit le cache
//   - Démarrages suivants : on lit le cache, aucun download
//   - Nouveau livre ajouté : on télécharge juste sa couverture
//   - Couverture modifiée : on met à jour le cache
//
// IndexedDB est utilisé plutôt que localStorage car :
//   - localStorage plafonne à 5-10 Mo (insuffisant pour 60+ Mo de covers)
//   - IndexedDB supporte plusieurs Go selon les navigateurs
//   - IndexedDB est asynchrone (ne bloque pas le thread principal)
// ============================================================

const DB_NAME = "bibliotheque-covers";
const DB_VERSION = 1;
const STORE = "covers";

// Ouvre (ou crée) la base IndexedDB. Renvoie une promesse qui résout
// vers l'objet IDBDatabase. En cas d'erreur ou si IndexedDB n'est pas
// disponible (mode privé Safari très ancien, etc.), résout vers null —
// le code appelant continuera alors sans cache, sans crasher.
function openDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

// Récupère plusieurs couvertures depuis le cache en une transaction.
// Renvoie un Map<id, dataUrl> (les ids absents = pas en cache).
export async function getCachedCovers(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const db = await openDb();
  if (!db) return new Map();
  return new Promise((resolve) => {
    const map = new Map();
    let tx;
    try {
      tx = db.transaction(STORE, "readonly");
    } catch (e) {
      resolve(map);
      return;
    }
    const store = tx.objectStore(STORE);
    let pending = ids.length;
    if (pending === 0) {
      resolve(map);
      return;
    }
    for (const id of ids) {
      const r = store.get(id);
      r.onsuccess = () => {
        if (r.result) map.set(id, r.result);
        if (--pending === 0) resolve(map);
      };
      r.onerror = () => {
        if (--pending === 0) resolve(map);
      };
    }
    tx.onerror = () => resolve(map);
  });
}

// Enregistre plusieurs couvertures dans le cache en une transaction.
// On accepte aussi bien un Map<id, dataUrl> qu'un objet { id: dataUrl }.
export async function setCachedCovers(coversMapOrObj) {
  const entries = coversMapOrObj instanceof Map
    ? Array.from(coversMapOrObj.entries())
    : Object.entries(coversMapOrObj || {});
  if (entries.length === 0) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE, "readwrite");
    } catch (e) {
      resolve();
      return;
    }
    const store = tx.objectStore(STORE);
    for (const [id, cover] of entries) {
      if (id && cover) store.put(cover, id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

// Supprime une couverture du cache (utile quand un livre est supprimé,
// ou pour forcer un re-téléchargement).
export async function deleteCachedCover(id) {
  if (!id) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE, "readwrite");
    } catch (e) {
      resolve();
      return;
    }
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// Vide complètement le cache. À exposer dans les paramètres en cas de
// besoin (debug, problème de cache corrompu, libération d'espace).
export async function clearCoverCache() {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE, "readwrite");
    } catch (e) {
      resolve();
      return;
    }
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// Renvoie la liste des ids présents dans le cache. Sert au démarrage pour
// déterminer quels livres ont déjà leur couverture en local et lesquels
// il faut télécharger depuis Supabase.
export async function getCachedCoverIds() {
  const db = await openDb();
  if (!db) return new Set();
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE, "readonly");
    } catch (e) {
      resolve(new Set());
      return;
    }
    const r = tx.objectStore(STORE).getAllKeys();
    r.onsuccess = () => resolve(new Set(r.result || []));
    r.onerror = () => resolve(new Set());
  });
}
