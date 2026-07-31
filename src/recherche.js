// ============================================================
// RECHERCHE : NORMALISATION ET INDEX
// ============================================================
// Extrait d'App.jsx pour être testable isolément : importer App.jsx dans
// un test entraînerait tout l'arbre React, les icônes et le client
// Supabase avec lui.

// Une bibliothèque française est pleine d'accents. Chercher « éco » sans
// trouver « Éco » — ou l'inverse — rend la recherche inutilisable. On retire
// donc les diacritiques avant de comparer : NFD décompose « é » en « e » +
// accent combinant, et la plage U+0300–U+036F élimine ces accents.
// Les échappements \u sont écrits explicitement : une plage de caractères
// combinants tapée littéralement serait invisible à la relecture et cassée
// par le moindre incident d'encodage.
export function normalizeForSearch(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Texte de recherche d'un livre : tous les champs interrogeables concaténés
// et normalisés une seule fois.
//
// Le cache est une WeakMap indexée par l'OBJET livre lui-même, et c'est ce
// qui rend l'opération gratuite en pratique. Les mises à jour d'état passent
// par `prev.map(b => condition ? {...b, champ} : b)` : les livres non modifiés
// conservent leur identité, donc leur entrée de cache. Seuls les objets
// réellement recréés sont renormalisés — typiquement 30 lors d'un lot de
// couvertures, pas les 3 000. Une WeakMap n'empêche pas la libération mémoire
// des livres supprimés.
const searchTextCache = new WeakMap();

export function bookSearchText(book) {
  let text = searchTextCache.get(book);
  if (text === undefined) {
    text = normalizeForSearch(
      [book.title, book.subtitle, book.author, book.notes, book.description, book.isbn]
        .filter(Boolean)
        .join(" ")
    );
    searchTextCache.set(book, text);
  }
  return text;
}

// Découpe la saisie en mots. Chacun devra être présent, dans n'importe
// quel ordre : « hugo miserables » doit trouver « Les Misérables » de
// Victor Hugo.
export function termesDeRecherche(requete) {
  return normalizeForSearch(requete).split(/\s+/).filter(Boolean);
}

// Un livre correspond si TOUS les termes sont présents quelque part.
// Une liste de termes vide laisse tout passer.
export function correspondAlaRecherche(book, termes) {
  if (!termes || termes.length === 0) return true;
  const texte = bookSearchText(book);
  return termes.every((t) => texte.includes(t));
}
