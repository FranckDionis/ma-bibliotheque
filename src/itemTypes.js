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
  // Le champ eanPrefix est utilisé pour reconnaître les revues à préfixe EAN
  // français (généralement 7 premiers chiffres stables). Plus précis que l'ISSN
  // pour ces titres car les revues françaises utilisent souvent EAN-13 standard.
  { title: "Pomme d'Api", publisher: "Bayard Jeunesse", ageRange: "3-7 ans", eanPrefix: "3780237" },
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
  { title: "Historia", publisher: "Sophia Publications", eanPrefix: "3780263" },
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
// PRÉFIXES ÉDITEURS PRESSE FRANÇAISE (fallback)
// ============================================================
// Les éditeurs de presse français disposent de plages d'EAN-13 attribuées par
// le GS1. À défaut de pouvoir nommer la revue exacte, on peut au moins
// reconnaître l'éditeur et le type "presse jeunesse / adulte". L'utilisateur
// n'aura plus qu'à compléter le titre.
//
// Format : { prefixStart, prefixEnd, publisher, kind } — un préfixe matche si
// les premiers chiffres du code-barres tombent dans l'intervalle [start, end].
export const PRESS_PUBLISHER_PREFIXES = [
  // Bayard Presse / Bayard Jeunesse — préfixes 37802xx, 37803xx, 37805xx
  { prefixStart: "3780200", prefixEnd: "3780299", publisher: "Bayard Jeunesse", kind: "presse-jeunesse" },
  { prefixStart: "3780300", prefixEnd: "3780399", publisher: "Bayard Presse", kind: "presse-adulte" },
  { prefixStart: "3780500", prefixEnd: "3780599", publisher: "Bayard / Milan", kind: "presse" },
  { prefixStart: "3780600", prefixEnd: "3780699", publisher: "Bayard Presse", kind: "presse" },
  // Milan Presse — préfixes 37811xx, 37812xx, 37813xx
  { prefixStart: "3781100", prefixEnd: "3781399", publisher: "Milan Presse", kind: "presse-jeunesse" },
  // Fleurus Presse / Édifa
  { prefixStart: "3780400", prefixEnd: "3780499", publisher: "Fleurus Presse", kind: "presse" },
  // Sophia Publications (Historia, La Recherche, …) déjà nommé via Historia
  // Mais d'autres titres peuvent partager le préfixe 37802xx
];

// Recherche un éditeur de presse à partir d'un code-barres (fallback quand
// recognizeMagazine ne trouve pas la revue exacte).
export function recognizePressPublisher(barcode) {
  const clean = (barcode || "").replace(/\D/g, "");
  if (clean.length < 13) return null;
  const seven = clean.substring(0, 7);
  // Conversion en nombre pour comparaison d'intervalle
  const n = parseInt(seven, 10);
  for (const p of PRESS_PUBLISHER_PREFIXES) {
    const a = parseInt(p.prefixStart, 10);
    const b = parseInt(p.prefixEnd, 10);
    if (n >= a && n <= b) {
      return { publisher: p.publisher, kind: p.kind };
    }
  }
  return null;
}

// ============================================================
// JEUX CONNUS PAR EAN/UPC (jeux Switch + jeux de société)
// ============================================================
// Ces codes-barres sont rarement indexés dans les bases libres (Open Food Facts
// inclus). Les rentrer en dur est plus rapide et plus fiable.
//
// La clé `code` est le code-barres exact (sans tirets ni espaces). On accepte
// indifféremment l'UPC-A 12 chiffres et l'EAN-13 (avec 0 préfixe).
export const KNOWN_GAMES = [
  // Aucune entrée pour l'instant — la base pourra être étoffée au fur et à
  // mesure des scans qui ne remontent rien et que l'utilisateur saisit à la
  // main. Le format est prêt :
  // { code: "045496904099", title: "The Legend of Zelda: Breath of the Wild", publisher: "Nintendo", platform: "Nintendo Switch", type: "jeu-switch" },
  // { code: "4010168202730", title: "Activity", publisher: "Piatnik", type: "jeu-societe" },
];

// Reconnaît un jeu via son code-barres dans la base interne KNOWN_GAMES.
// Renvoie l'objet { title, publisher, ... } ou null.
export function recognizeGame(barcode) {
  const clean = (barcode || "").replace(/\D/g, "");
  if (clean.length < 10) return null;
  // On compare en normalisant : on retire les éventuels 0 de tête pour matcher
  // un EAN-13 d'un côté avec un UPC-A 12 de l'autre.
  const normalized = clean.replace(/^0+/, "");
  for (const g of KNOWN_GAMES) {
    const gameClean = g.code.replace(/\D/g, "").replace(/^0+/, "");
    if (gameClean === normalized) return g;
  }
  return null;
}

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

  // ISSN-13 : commence par 977 (revues / périodiques internationaux)
  if (clean.length === 13 && clean.startsWith("977")) {
    return "revue";
  }
  // Presse française : préfixe GS1 attribué aux périodiques français.
  // Les revues françaises (Historia, Pomme d'Api, Image Doc...) ont souvent
  // des codes commençant par 378.
  if (clean.length === 13 && clean.startsWith("378")) {
    return "revue";
  }

  // Jeux Nintendo Switch en UPC-A (12 chiffres) — Mario Kart, Zelda, etc.
  if (clean.length === 12 && clean.startsWith("045496")) {
    return "jeu-switch";
  }
  // EAN-13 jeu Nintendo Switch : équivalent EAN-13 (avec un 0 de tête)
  if (clean.length === 13 && (clean.startsWith("0045496") || clean.startsWith("4902370"))) {
    return "jeu-switch";
  }

  // UPC-A (12 chiffres) hors Nintendo : produit américain — souvent jeu de société
  if (clean.length === 12) {
    return "jeu-societe";
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
// ou un préfixe EAN-13 français stable. Renvoie l'objet magazine ou null.
export function recognizeMagazine(barcode) {
  const clean = (barcode || "").replace(/\D/g, "");
  if (clean.length < 10) return null;

  // 1) Reconnaissance via préfixe EAN-13 français (Bayard, Milan, etc.)
  // C'est le cas le plus fréquent pour les revues françaises grand public.
  for (const mag of KNOWN_MAGAZINES) {
    if (mag.eanPrefix && clean.startsWith(mag.eanPrefix)) {
      return mag;
    }
  }

  // 2) Reconnaissance via ISSN (préfixe 977 international)
  const issn = extractIssnFromBarcode(clean);
  if (issn) {
    for (const mag of KNOWN_MAGAZINES) {
      if (mag.issnPrefix) {
        const normalizedIssn = mag.issnPrefix.replace(/\D/g, "");
        if (normalizedIssn && issn.startsWith(normalizedIssn.substring(0, 7))) {
          return mag;
        }
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
