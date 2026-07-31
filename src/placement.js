// ============================================================
// PLACEMENT DES OBJETS SUR UNE ETAGERE
// ============================================================
// Extrait d'App.jsx. Logique pure, sans etat ni acces reseau : c'est
// ce qui permet de la tester serieusement.

// ============================================================
// PLACEMENT INTELLIGENT DES OBJETS SUR UNE ÉTAGÈRE
// ============================================================
// Cherche la première position libre sur une étagère donnée, en regardant les
// livres déjà placés à cet emplacement (même bibliothèque + même numéro
// d'étagère). On commence à 1 et on monte tant que la position est occupée,
// en s'arrêtant à la première qui est libre — ça permet aussi de "boucher les
// trous" si un livre a été supprimé au milieu de l'étagère.
//
// Paramètres :
//   - books : liste complète des objets de la bibliothèque
//   - bibId : id de la bibliothèque
//   - etagere : numéro de l'étagère (1, 2, 3…)
//   - extraReserved : positions supplémentaires à considérer comme prises
//     (utilisé en mode batch pour tenir compte des livres scannés à l'instant
//     même qui n'ont pas encore été reflétés dans `books`).
//
// Renvoie : un entier ≥ 1.
export function findFirstFreePosition(books, bibId, etagere, extraReserved = []) {
  // Index des positions occupées sur cette étagère précise
  const taken = new Set(extraReserved);
  for (const b of books || []) {
    if (b.bibliotheque === bibId && Number(b.etagere) === Number(etagere)) {
      const p = Number(b.position);
      if (Number.isFinite(p) && p >= 1) taken.add(p);
    }
  }
  // Cherche le premier entier ≥ 1 absent du set
  let pos = 1;
  while (taken.has(pos)) pos++;
  return pos;
}
