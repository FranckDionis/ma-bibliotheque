// ============================================================
// DONNEES PAR DEFAUT
// ============================================================
// Structure initiale du logement et disposition de depart du plan.
// Utilisees au tout premier demarrage, puis entierement modifiables.
//
// DEFAULT_LAYOUT sert aussi de reference a la remise a zero de la
// disposition, dans la vue Plan : c est ce qui impose de la partager
// plutot que de la laisser dans App.

// === STRUCTURE INITIALE (utilisée seulement si rien dans le storage) ===
// Pièces, bibliothèques et étagères sont entièrement modifiables par l'utilisateur après le démarrage.

export const INITIAL_PIECES = [
  { id: "salle-a-manger", nom: "Salle à manger", etage: "RDC", icon: "🍽️" },
  { id: "salon", nom: "Salon", etage: "RDC", icon: "🛋️" },
  { id: "1er-etage", nom: "1er étage", etage: "1er", icon: "🛏️" },
  { id: "2eme-etage", nom: "2ème étage", etage: "2ème", icon: "📚" },
];

export const INITIAL_BIBLIOTHEQUES = [
  { id: "sam-1", nom: "Salle à manger #1", pieceId: "salle-a-manger" },
  { id: "sam-2", nom: "Salle à manger #2", pieceId: "salle-a-manger" },
  { id: "sam-3", nom: "Salle à manger #3", pieceId: "salle-a-manger" },
  { id: "salon-1", nom: "Salon #1", pieceId: "salon" },
  { id: "salon-2", nom: "Salon #2", pieceId: "salon" },
  { id: "et1-1", nom: "1er étage #1", pieceId: "1er-etage" },
  { id: "et1-2", nom: "1er étage #2", pieceId: "1er-etage" },
  { id: "et2-1", nom: "2ème étage #1", pieceId: "2eme-etage" },
  { id: "et2-2", nom: "2ème étage #2", pieceId: "2eme-etage" },
  { id: "et2-3", nom: "2ème étage #3", pieceId: "2eme-etage" },
];

// Étagères : { id, bibId, num, nom (optionnel) }
// Génère 4 étagères par défaut pour chaque bibliothèque
export const INITIAL_ETAGERES = INITIAL_BIBLIOTHEQUES.flatMap((b) =>
  [1, 2, 3, 4].map((n) => ({
    id: `${b.id}-e${n}`,
    bibId: b.id,
    num: n,
    nom: "",
  }))
);

export const INITIAL_STRUCTURE = {
  pieces: INITIAL_PIECES,
  bibliotheques: INITIAL_BIBLIOTHEQUES,
  etageres: INITIAL_ETAGERES,
};


// Disposition par défaut : grille mobile-friendly (2 colonnes), modifiable
export const DEFAULT_LAYOUT = {
  pieces: {
    "salle-a-manger": { x: 20, y: 20 },
    "salon": { x: 150, y: 20 },
    "1er-etage": { x: 20, y: 150 },
    "2eme-etage": { x: 150, y: 150 },
  },
  bibliotheques: {
    "sam-1": { x: 20, y: 20 },
    "sam-2": { x: 150, y: 20 },
    "sam-3": { x: 20, y: 150 },
    "salon-1": { x: 20, y: 20 },
    "salon-2": { x: 150, y: 20 },
    "et1-1": { x: 20, y: 20 },
    "et1-2": { x: 150, y: 20 },
    "et2-1": { x: 20, y: 20 },
    "et2-2": { x: 150, y: 20 },
    "et2-3": { x: 20, y: 150 },
  },
};
