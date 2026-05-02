// ============================================================
// TYPES D'OBJETS DE LA BIBLIOTHÈQUE
// ============================================================
// Centralise les définitions des différents types : libellés, icônes,
// préfixes de codes-barres, champs spécifiques.

export const ITEM_TYPES = {
  livre: {
    id: "livre",
    label: "Livre",
    pluralLabel: "Livres",
    emoji: "📖",
    color: "#6b3410", // brun cuir
  },
  revue: {
    id: "revue",
    label: "Revue / Magazine",
    pluralLabel: "Revues",
    emoji: "📰",
    color: "#4a8a8a", // bleu canard
  },
  "jeu-societe": {
    id: "jeu-societe",
    label: "Jeu de société",
    pluralLabel: "Jeux de société",
    emoji: "🎲",
    color: "#a04030", // rouge brique
  },
  "jeu-switch": {
    id: "jeu-switch",
    label: "Jeu Switch",
    pluralLabel: "Jeux Switch",
    emoji: "🎮",
    color: "#c43c3c", // rouge Nintendo
  },
};

// Liste ordonnée pour l'affichage dans les sélecteurs
export const ITEM_TYPES_LIST = [
  ITEM_TYPES.livre,
  ITEM_TYPES.revue,
  ITEM_TYPES["jeu-societe"],
  ITEM_TYPES["jeu-switch"],
];

// ============================================================
// REVUES FRANCOPHONES PRÉCHARGÉES
// ============================================================
// Permet de reconnaître automatiquement le titre lors d'un scan.
// Les préfixes ISSN sont fournis quand on les connaît, sinon recognition par
// le préfixe code-barres (les revues ont souvent un préfixe stable + numéro).
//
// Le scan d'une revue donne un EAN-13 dont les 7-9 premiers chiffres sont stables
// pour une même publication.

export const KNOWN_MAGAZINES = [
  // ----- Jeunesse - Bayard / Milan / Fleurus -----
  { title: "Pomme d'Api", publisher: "Bayard Jeunesse", ageRange: "3-7 ans", issnPrefix: "0244-3805" },
  { title: "Toupie", publisher: "Milan Presse", ageRange: "3-6 ans" },
  { title: "Toboggan", publisher: "Milan Presse", ageRange: "6-9 ans" },
  { title: "Histoires Vraies", publisher: "Fleurus Presse", ageRange: "8-13 ans" },
  { title: "Image Doc", publisher: "Bayard Jeunesse", ageRange: "8-12 ans" },
  { title: "J'aime lire", publisher: "Bayard Jeunesse", ageRange: "7-11 ans" },
  { title: "J'aime lire Max", publisher: "Bayard Jeunesse", ageRange: "9-13 ans" },
  { title: "Astrapi", publisher: "Bayard Jeunesse", ageRange: "7-11 ans" },
  { title: "Wapiti", publisher: "Milan Presse", ageRange: "7-13 ans" },
  { title: "Okapi", publisher: "Bayard Jeunesse", ageRange: "10-15 ans" },
  { title: "Picoti", publisher: "Milan Presse", ageRange: "9 mois - 3 ans" },
  { title: "Mickey Magazine", publisher: "Disney/Hachette" },
  { title: "Picsou Magazine", publisher: "Disney/Hachette" },
  { title: "Le Journal de Mickey", publisher: "Disney/Hachette" },

  // ----- Adultes - Histoire / Sciences / Géographie -----
  { title: "Historia", publisher: "Sophia Publications" },
  { title: "Sciences et Avenir", publisher: "Sciences et Avenir" },
  { title: "Sciences & Vie", publisher: "Reworld Media" },
  { title: "Géo", publisher: "Prisma Media" },
  { title: "National Geographic", publisher: "National Geographic" },

  // ----- Adultes - Société / Actu -----
  { title: "Que Choisir", publisher: "UFC-Que Choisir" },
  { title: "Causette", publisher: "Causette" },
  { title: "Le Point", publisher: "Le Point" },
  { title: "L'Obs", publisher: "L'Obs" },
  { title: "Le Monde Diplomatique", publisher: "Le Monde Diplomatique" },
];

// ============================================================
// DÉTECTION AUTOMATIQUE DU TYPE À PARTIR D'UN CODE-BARRES
// ============================================================
// On essaie de deviner intelligemment le type d'objet selon la nature du code.
// Ça ne remplace pas le choix de l'utilisateur, juste une suggestion par défaut.

export function guessTypeFromBarcode(barcode) {
  if (!barcode || typeof barcode !== "string") return "livre";
  const clean = barcode.replace(/\D/g, "");

  // ISBN-13 livre : 978 ou 979
  if (clean.length === 13 && (clean.startsWith("978") || clean.startsWith("979"))) {
    return "livre";
  }
  // ISBN-10 (livre)
  if (clean.length === 10) return "livre";

  // ISSN-13 : commence par 977 (revues / périodiques)
  if (clean.length === 13 && clean.startsWith("977")) {
    return "revue";
  }

  // EAN-13 jeu Nintendo Switch : préfixe Nintendo 0045496 ou similaire
  if (clean.length === 13 && (clean.startsWith("0045496") || clean.startsWith("4902370"))) {
    return "jeu-switch";
  }

  // EAN-13 (autre code produit) : par défaut on suggère "jeu de société",
  // car les boîtes de jeux ont des EAN génériques sans préfixe particulier.
  if (clean.length === 13) {
    return "jeu-societe";
  }

  return "livre";
}

// ============================================================
// RECONNAISSANCE DES REVUES PAR ISSN / PRÉFIXE EAN
// ============================================================
// Les revues françaises ont des codes-barres EAN-13 commençant par 977 (préfixe
// ISSN). Les 7 chiffres suivants forment l'ISSN. Les 3 derniers identifient le
// numéro spécifique. Pour les jeunesse souvent l'EAN garde un préfixe stable
// par publication, ce qui permet de reconnaître la revue.

// On extrait l'ISSN d'un code-barres ISSN
export function extractIssnFromBarcode(barcode) {
  const clean = (barcode || "").replace(/\D/g, "");
  if (clean.length !== 13 || !clean.startsWith("977")) return null;
  // Position 3-9 = 7 chiffres ISSN (sans la clé)
  return clean.substring(3, 10);
}

// Cherche dans la base des revues connues si on en reconnaît une via son ISSN
// ou une partie stable du code-barres. Renvoie l'objet magazine ou null.
export function recognizeMagazine(barcode) {
  const issn = extractIssnFromBarcode(barcode);
  if (!issn) return null;

  // Compare avec les ISSN connus (préfixes courts pour tolérance)
  for (const mag of KNOWN_MAGAZINES) {
    if (mag.issnPrefix) {
      // Format normalisé "0244-3805" → "02443805"
      const normalizedIssn = mag.issnPrefix.replace(/\D/g, "");
      if (normalizedIssn && issn.startsWith(normalizedIssn.substring(0, 7))) {
        return mag;
      }
    }
  }
  return null;
}
// Détermine quels champs afficher dans le formulaire et la fiche détail
// selon le type d'objet.

export const FIELDS_BY_TYPE = {
  livre: {
    titleLabel: "Titre",
    authorLabel: "Auteur",
    showPages: true,
    showAuthor: true,
    showLanguage: true,
    showDescription: true,
    showCategories: true,
    showRating: true,
    showSubtitle: true,
    showFormat: true,
    showDimensions: true,
    showPublisher: true,
    showYear: true,
    showIsbn: true,
  },
  revue: {
    titleLabel: "Titre de la revue",
    showAuthor: false,
    showSubtitle: false,
    showPages: false,
    showLanguage: false,
    showDescription: true,
    showCategories: false,
    showRating: false,
    showFormat: false,
    showDimensions: false,
    showPublisher: true,
    showYear: false,
    showIsbn: false,
    showIssue: true, // numéro et date
  },
  "jeu-societe": {
    titleLabel: "Nom du jeu",
    showAuthor: false,
    showSubtitle: false,
    showPages: false,
    showLanguage: false,
    showDescription: true,
    showCategories: true, // genre du jeu
    showRating: true,
    showFormat: false,
    showDimensions: false,
    showPublisher: true, // éditeur du jeu
    showYear: true,
    showIsbn: false,
    showGameInfo: true, // nb joueurs, durée, âge
  },
  "jeu-switch": {
    titleLabel: "Nom du jeu",
    showAuthor: false,
    showSubtitle: false,
    showPages: false,
    showLanguage: false,
    showDescription: true,
    showCategories: true,
    showRating: true,
    showFormat: false,
    showDimensions: false,
    showPublisher: true,
    showYear: true,
    showIsbn: false,
    showGameInfo: true,
    showPlatform: true,
    defaultPlatform: "Nintendo Switch",
  },
};
