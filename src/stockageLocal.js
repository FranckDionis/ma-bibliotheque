// ============================================================
// STOCKAGE LOCAL DE L'APPAREIL
// ============================================================
// Extrait d'App.jsx. Sert au mode « Continuer sans compte » et aux
// résidus d'une session locale antérieure : en mode connecté, tout vit
// dans Supabase.
//
// L'adaptateur est posé sur `window` plutôt qu'exporté, parce que c'est
// ainsi qu'il était déjà consommé dans tout le code (`window.storage`).
// Le changer en import aurait touché une trentaine d'appels sans rien
// apporter — ce sera pour un autre jour, si le besoin s'en fait sentir.

// === ADAPTATEUR DE STOCKAGE ===
// Utilise localStorage du navigateur (les données restent sur l'iPhone, dans le navigateur).
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const value = localStorage.getItem(key);
      return value === null ? null : { value };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { value };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { deleted: true };
    },
  };
}

// Les clés portent un suffixe de version. Le changer reviendrait à
// abandonner les données déjà stockées sur les appareils : à ne faire
// que délibérément, en prévoyant une reprise.
export const STORAGE_KEY = "library-books-v1";
export const LAYOUT_KEY = "library-layout-v1";
export const STRUCTURE_KEY = "library-structure-v1";
