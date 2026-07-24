import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Search, Camera, BookOpen, Plus, X, Edit2, Trash2, MapPin, BookMarked, Library, ScanLine, Loader2, Check, ChevronRight, Home, Zap, ArrowRight, Pause, Layers, Move, Save, RotateCcw, AlertTriangle, Settings, Download, Upload, LogOut, Cloud, CloudOff, Sparkles } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { supabase, isSupabaseConfigured } from "./supabase";
import {
  insertBooksBulk,
  saveStructureRemote,
  saveLayoutRemote,
  fetchBooks as fetchBooksRemote,
  fetchBookCovers as fetchBookCoversRemote,
  fetchStructure as fetchStructureRemote,
  fetchLayout as fetchLayoutRemote,
  insertBook as insertBookRemote,
  updateBook as updateBookRemote,
  deleteBook as deleteBookRemote,
  subscribeToBooks,
  subscribeToStructure,
  subscribeToLayout,
  dbToBook,
} from "./db";
import AuthScreen from "./AuthScreen";
import { ITEM_TYPES, ITEM_TYPES_LIST, guessTypeFromBarcode, FIELDS_BY_TYPE, recognizeMagazine, recognizeGame, recognizePressPublisher } from "./itemTypes";
import {
  getCachedCovers,
  setCachedCovers,
  deleteCachedCover,
  clearCoverCache,
  getCachedCoverIds,
} from "./coverCache";

// ============================================================
// COUVERTURE ADAPTATIVE (portrait livre / paysage jeu)
// ============================================================
// Les livres ont des jaquettes portrait ; les boîtes de jeux sont en paysage.
// Ce composant mesure le ratio réel de l'image une fois chargée et choisit :
//   • portrait / carré → object-cover  (remplit le cadre — comportement livre)
//   • paysage          → object-contain (affiche TOUTE la boîte, sans rogner)
// Si `adaptFrame` est vrai, le cadre lui-même bascule en paysage
// (classe `landscapeFrameClass`) pour donner toute sa place au visuel du jeu.
// Variante « image seule » : à utiliser dans les cadres/boutons existants qui
// ont déjà leur propre wrapper (ou une surimpression). Choisit object-contain
// pour un visuel paysage (pas de rognage) et object-cover sinon.
function SmartImg({ src, alt = "", className = "", style }) {
  const [fit, setFit] = useState("object-cover");
  const onLoad = (e) => {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    if (w && h) setFit(w > h * 1.1 ? "object-contain" : "object-cover");
  };
  return (
    <img src={src} alt={alt} onLoad={onLoad} className={`${className} ${fit}`} style={style} />
  );
}

function SmartCover({
  src,
  alt = "",
  frameClass = "",
  landscapeFrameClass = "",
  frameStyle,
  fallback = null,
  adaptFrame = false,
}) {
  const [orientation, setOrientation] = useState("unknown");
  const isLandscape = orientation === "landscape";
  const handleLoad = (e) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w && h) setOrientation(w > h * 1.1 ? "landscape" : "portrait");
  };
  // Cadre : on bascule en paysage seulement si demandé ET image paysage.
  const frame =
    adaptFrame && isLandscape && landscapeFrameClass
      ? landscapeFrameClass
      : frameClass;
  // object-contain en paysage pour ne rien rogner ; object-cover sinon.
  const fit = isLandscape ? "object-contain" : "object-cover";
  return (
    <div
      className={`overflow-hidden flex items-center justify-center ${frame}`}
      style={frameStyle}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          onLoad={handleLoad}
          className={`w-full h-full ${fit}`}
        />
      ) : (
        fallback
      )}
    </div>
  );
}

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

// === STRUCTURE INITIALE (utilisée seulement si rien dans le storage) ===
// Pièces, bibliothèques et étagères sont entièrement modifiables par l'utilisateur après le démarrage.

const INITIAL_PIECES = [
  { id: "salle-a-manger", nom: "Salle à manger", etage: "RDC", icon: "🍽️" },
  { id: "salon", nom: "Salon", etage: "RDC", icon: "🛋️" },
  { id: "1er-etage", nom: "1er étage", etage: "1er", icon: "🛏️" },
  { id: "2eme-etage", nom: "2ème étage", etage: "2ème", icon: "📚" },
];

const INITIAL_BIBLIOTHEQUES = [
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
const INITIAL_ETAGERES = INITIAL_BIBLIOTHEQUES.flatMap((b) =>
  [1, 2, 3, 4].map((n) => ({
    id: `${b.id}-e${n}`,
    bibId: b.id,
    num: n,
    nom: "",
  }))
);

const INITIAL_STRUCTURE = {
  pieces: INITIAL_PIECES,
  bibliotheques: INITIAL_BIBLIOTHEQUES,
  etageres: INITIAL_ETAGERES,
};

const STORAGE_KEY = "library-books-v1";
const LAYOUT_KEY = "library-layout-v1";
const STRUCTURE_KEY = "library-structure-v1";

// Disposition par défaut : grille mobile-friendly (2 colonnes), modifiable
const DEFAULT_LAYOUT = {
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

// Icônes proposées pour les pièces
const ICON_CHOICES = ["🍽️", "🛋️", "🛏️", "📚", "🚪", "🪑", "🍳", "🛁", "🧸", "🪟", "🏠", "✨", "🎨", "🎮", "🌿"];

// Génère un ID unique
const genId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
function findFirstFreePosition(books, bibId, etagere, extraReserved = []) {
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

// ============================================================
// COMPRESSION D'IMAGE (couvertures et photos d'objets)
// ============================================================
// Les photos prises au smartphone pèsent souvent 2 à 8 Mo en HD. Stocker ça
// brut dans Supabase coûte très cher en bande passante, en quota, et alourdit
// l'export JSON. On compresse à ~600 px de large + JPEG qualité 0.7
// ⇒ typiquement 50–100 Ko, suffisant pour afficher une couverture sans perte
// visible. Cohérent avec la taille des couvertures Open Library / Google Books.
//
// Renvoie une data URL JPEG compressée, ou la source originale si quoi que
// ce soit échoue (on ne bloque jamais l'utilisateur en cas d'erreur image).
async function compressImageDataUrl(srcDataUrl, opts = {}) {
  const maxWidth = opts.maxWidth || 600;
  const quality = opts.quality ?? 0.7;
  if (!srcDataUrl || typeof srcDataUrl !== "string") return srcDataUrl;
  // Si ce n'est pas une data URL ni un blob/objet local, on ne touche pas
  // (par ex. couverture distante https://covers.openlibrary.org…)
  if (!srcDataUrl.startsWith("data:") && !srcDataUrl.startsWith("blob:")) {
    return srcDataUrl;
  }
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = srcDataUrl;
    });
    // Calcule la taille cible en respectant le ratio ; ne jamais agrandir
    const ratio = img.width > 0 ? maxWidth / img.width : 1;
    const targetW = ratio < 1 ? maxWidth : img.width;
    const targetH = ratio < 1 ? Math.round(img.height * ratio) : img.height;
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return srcDataUrl;
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return canvas.toDataURL("image/jpeg", quality);
  } catch (e) {
    return srcDataUrl;
  }
}

// ============================================================
// Module unifié de scan code-barres (ZXing + fallback natif)
// Charge ZXing dynamiquement depuis CDN une seule fois.
// ZXing fonctionne dans Safari iOS, contrairement à BarcodeDetector.
// ============================================================
// ZXing est importé statiquement (bundle inclus dans l'app).
// Plus aucun chargement réseau, fonctionne avec bloqueurs/VPN.
// ============================================================
async function loadZXing() {
  return { BrowserMultiFormatReader };
}

// Crée un reader ZXing configuré pour les formats de codes-barres produit.
// On précise explicitement les formats pour que ZXing soit plus rapide et plus
// fiable sur iOS, notamment pour UPC-A (codes nord-américains 12 chiffres
// utilisés sur les boîtes Nintendo Switch).
function createConfiguredReader() {
  const hints = new Map();
  const formats = [
    BarcodeFormat.EAN_13,    // Livres (978/979), revues, jeux européens
    BarcodeFormat.EAN_8,     // Petits codes
    BarcodeFormat.UPC_A,     // Jeux Nintendo US, produits américains
    BarcodeFormat.UPC_E,     // Variante compacte UPC
    BarcodeFormat.CODE_128,  // Au cas où certaines boîtes en utilisent
    BarcodeFormat.CODE_39,
  ];
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  // TRY_HARDER : ZXing prend un peu plus de CPU mais lit mieux les codes mal cadrés
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints);
}

// ============================================================
// Recherche ISBN multi-source : Google Books → Open Library → BNF
// Retourne { title, author, cover, publisher, year, source, debug } ou null
// ============================================================

// Fetch avec timeout pour qu'une source lente ne bloque pas tout
async function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Améliore une URL de couverture Google Books
// Google renvoie souvent zoom=1 ; en passant à zoom=0 ou en supprimant edge=curl, on a plus grand
function upgradeGoogleCover(url) {
  if (!url) return "";
  return url
    .replace(/^http:/, "https:")
    .replace(/&edge=curl/, "")
    .replace(/zoom=\d/, "zoom=0");
}

// Google Books — excellent sur les livres français, gratuit, sans clé
async function lookupGoogleBooks(isbn) {
  // On essaie deux requêtes : isbn:NNNN (strict) puis NNNN simple (plus permissif)
  for (const q of [`isbn:${isbn}`, isbn]) {
    try {
      const res = await fetchWithTimeout(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1&langRestrict=fr`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const itemRoot = data.items?.[0];
      const item = itemRoot?.volumeInfo;
      if (!item || !item.title) continue;
      const cover = upgradeGoogleCover(
        item.imageLinks?.extraLarge ||
        item.imageLinks?.large ||
        item.imageLinks?.medium ||
        item.imageLinks?.thumbnail ||
        item.imageLinks?.smallThumbnail ||
        ""
      );
      // Mappe la langue Google vers un libellé lisible
      const langMap = { fr: "Français", en: "Anglais", es: "Espagnol", de: "Allemand", it: "Italien", pt: "Portugais", nl: "Néerlandais", ru: "Russe", ja: "Japonais", zh: "Chinois", ar: "Arabe" };
      return {
        title: item.title || "",
        subtitle: item.subtitle || "",
        author: (item.authors || []).join(", "),
        cover,
        publisher: item.publisher || "",
        year: item.publishedDate || "",
        // === NOUVEAUX CHAMPS ===
        pages: item.pageCount || 0,
        language: langMap[item.language] || item.language || "",
        description: item.description || "",
        categories: (item.categories || []).join(", "),
        rating: item.averageRating || 0,
        ratingsCount: item.ratingsCount || 0,
        infoLink: item.infoLink || itemRoot?.selfLink || "",
        // Format physique : Google Books ne le donne pas directement, on en déduit depuis le format si possible
        format: "",
        // Dimensions : Google ne les fournit pas dans volumeInfo standard
        dimensions: "",
        weight: "",
        source: "Google Books",
      };
    } catch (e) { /* essai suivant */ }
  }
  return null;
}

// Open Library — bonne pour livres anglo-saxons et anciens
// On utilise jscmd=data pour les métadonnées de base + jscmd=details pour le complément
async function lookupOpenLibrary(isbn) {
  try {
    // jscmd=data : info synthétisée (titre, auteur, etc.)
    // jscmd=details : record bibliographique brut (pagination, physical format, dimensions...)
    const [resData, resDetails] = await Promise.all([
      fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`),
      fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=details`),
    ]);
    const data = resData.ok ? await resData.json() : {};
    const detailsData = resDetails.ok ? await resDetails.json() : {};
    const book = data[`ISBN:${isbn}`];
    const details = detailsData[`ISBN:${isbn}`]?.details || {};
    if (!book && !details.title) return null;
    const main = book || {};

    // Description : peut être string ou {value: string} dans details
    let description = "";
    if (typeof details.description === "string") description = details.description;
    else if (details.description?.value) description = details.description.value;
    if (!description && main.notes) {
      description = typeof main.notes === "string" ? main.notes : (main.notes.value || "");
    }

    // Catégories / sujets
    const categories = (main.subjects || details.subjects || [])
      .slice(0, 6)
      .map((s) => typeof s === "string" ? s : s.name)
      .filter(Boolean)
      .join(", ");

    // Pages
    const pages = details.number_of_pages || main.number_of_pages || 0;

    // Format physique
    const format = details.physical_format || main.physical_format || "";

    // Dimensions
    const dimensions = details.physical_dimensions || "";
    const weight = details.weight || "";

    // Langue
    const langMap = { fre: "Français", fra: "Français", eng: "Anglais", spa: "Espagnol", ger: "Allemand", deu: "Allemand", ita: "Italien" };
    let language = "";
    if (Array.isArray(details.languages) && details.languages.length > 0) {
      const lkey = details.languages[0]?.key || "";
      const code = lkey.replace("/languages/", "");
      language = langMap[code] || code;
    }

    return {
      title: main.title || details.title || "",
      subtitle: main.subtitle || details.subtitle || "",
      author: (main.authors || []).map((a) => a.name).filter(Boolean).join(", "),
      cover: main.cover?.large || main.cover?.medium || main.cover?.small || "",
      publisher: main.publishers?.[0]?.name || (Array.isArray(details.publishers) ? details.publishers[0] : "") || "",
      year: main.publish_date || details.publish_date || "",
      // === NOUVEAUX CHAMPS ===
      pages,
      language,
      description,
      categories,
      rating: 0, // Open Library n'a pas de notes
      ratingsCount: 0,
      infoLink: main.url || (details.key ? `https://openlibrary.org${details.key}` : ""),
      format,
      dimensions,
      weight,
      source: "Open Library",
    };
  } catch (e) {
    return null;
  }
}

// Couverture Open Library directe (souvent dispo même quand metadata absente)
function openLibraryCoverUrl(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
}

// Convertit ISBN-13 (978...) en ISBN-10 (utile pour Amazon)
function isbn13ToIsbn10(isbn13) {
  const clean = isbn13.replace(/\D/g, "");
  if (clean.length !== 13 || !clean.startsWith("978")) return null;
  const core = clean.substring(3, 12); // 9 chiffres
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(core[i], 10) * (10 - i);
  }
  let check = (11 - (sum % 11)) % 11;
  const checkChar = check === 10 ? "X" : check.toString();
  return core + checkChar;
}

// Vérifie qu'une URL d'image se charge effectivement.
// Plus fiable qu'un fetch+blob car évite les soucis CORS sur les binaires.
function probeImageUrl(url, timeoutMs = 4000, minSize = 60) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const img = new Image();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    img.onload = () => {
      // Open Library renvoie une image 1x1 quand non trouvé sans ?default=false
      // Amazon renvoie une image ~43x60 quand "no image available"
      // On filtre selon une taille minimale raisonnable pour une vraie couverture
      if (img.naturalWidth >= minSize && img.naturalHeight >= minSize) finish(true);
      else finish(false);
    };
    img.onerror = () => finish(false);
    setTimeout(() => finish(false), timeoutMs);
    img.src = url;
  });
}

// Cherche une couverture pour un ISBN en essayant plusieurs sources EN PARALLÈLE.
// Renvoie la première URL qui charge une image valide (>= 60px), ou "" sinon.
async function findCoverFor(isbn) {
  const cleanIsbn = isbn.replace(/\D/g, "");
  const isbn10 = cleanIsbn.length === 13 ? isbn13ToIsbn10(cleanIsbn) : (cleanIsbn.length === 10 ? cleanIsbn : null);

  // SOURCES ORDONNÉES PAR FIABILITÉ (de la plus fiable à la moins).
  // On essaie en SÉQUENCE et on prend la première qui marche.
  // Justification : Google Books "vid:ISBN" renvoie souvent un placeholder gris OU
  // une image d'une autre édition portant des mots-clés similaires (couvertures
  // mélangées). On l'a donc retiré ici. Seul Google Books via l'API JSON
  // (lookupGoogleBooks) est conservé, car il identifie un volume précis.
  const sources = [];

  // 1) Open Library — fiable, l'image correspond strictement à l'ISBN
  sources.push({
    name: "Open Library",
    url: `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg?default=false`,
  });

  // 2) Amazon ISBN-10 — excellent sur le fonds FR, image strictement liée à l'ISBN
  if (isbn10) {
    sources.push({
      name: "Amazon (large)",
      url: `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01._SCLZZZZZZZ_.jpg`,
    });
    sources.push({
      name: "Amazon (default)",
      url: `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.jpg`,
    });
    sources.push({
      name: "Amazon (m.media)",
      url: `https://m.media-amazon.com/images/P/${isbn10}.jpg`,
    });
  }

  // 3) Open Library taille M (fallback si la L n'est pas dispo)
  sources.push({
    name: "Open Library (M)",
    url: `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-M.jpg?default=false`,
  });

  // Test séquentiel : on prend la première qui charge une vraie image
  for (const s of sources) {
    if (await probeImageUrl(s.url, 4000, 80)) {
      return s.url;
    }
  }
  return "";
}

// Ancienne fonction conservée pour compatibilité — utilise la nouvelle
async function probeOpenLibraryCover(isbn) {
  return findCoverFor(isbn);
}

// BNF SRU — la Bibliothèque nationale de France, exhaustive sur le fonds français
// ATTENTION : sujette à des problèmes CORS — peut échouer en navigateur
async function lookupBNF(isbn) {
  try {
    const url = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=bib.isbn%20adj%20%22${isbn}%22&recordSchema=unimarcxchange&maximumRecords=1`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const fields = doc.querySelectorAll("datafield");
    let title = "", author = "", publisher = "", year = "";
    fields.forEach((f) => {
      const tag = f.getAttribute("tag");
      const sub = (code) => f.querySelector(`subfield[code="${code}"]`)?.textContent || "";
      if (tag === "200" && !title) {
        title = sub("a");
        if (!author) author = sub("f");
      }
      if (tag === "210" && !publisher) {
        publisher = sub("c");
        year = sub("d");
      }
      if (tag === "700" && !author) {
        author = `${sub("b")} ${sub("a")}`.trim();
      }
    });
    if (!title) return null;
    return {
      title: title.trim().replace(/\s*:\s*$/, ""),
      author: author.trim(),
      cover: "",
      publisher: publisher.trim(),
      year: year.trim(),
      source: "BnF",
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// SOURCES POUR PRODUITS NON-LIVRES (jeux, autres EAN/UPC)
// ============================================================

// Open Food Facts gère un endpoint produit générique (pas que de l'alimentaire) :
// world.openfoodfacts.org couvre des dizaines de millions d'EAN/UPC, dont des
// boîtes de jeux et jeux Switch. Gratuit, sans clé, CORS ouvert.
// Les jaquettes y sont souvent disponibles en photo utilisateur.
async function lookupOpenFoodFacts(code) {
  try {
    const res = await fetchWithTimeout(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const title = p.product_name || p.product_name_fr || p.generic_name || "";
    if (!title) return null;
    // Photo : front_url > image_url > image_front_url
    const cover =
      p.image_front_url ||
      p.image_url ||
      p.selected_images?.front?.display?.fr ||
      p.selected_images?.front?.display?.en ||
      "";
    return {
      title,
      author: "",
      cover,
      publisher: p.brands || "",
      year: "",
      description: p.generic_name || "",
      source: "Open Food Facts",
    };
  } catch (e) {
    return null;
  }
}

// UPCitemdb — base communautaire couvrant des dizaines de millions d'UPC/EAN,
// avec une très bonne couverture des jeux de société (Ravensburger, Asmodee,
// Cocktail Games, Hasbro…) et des visuels marchands de bonne qualité, là où
// Open Food Facts ne remonte souvent rien pour une boîte de jeu.
// Endpoint « trial » : gratuit, sans clé, CORS ouvert. Limité à ~100 requêtes/
// jour par IP — suffisant pour un usage de scan ponctuel. En cas de dépassement
// l'API renvoie { code: "TOO_MANY_REQUESTS" | "TOO_FAST" } et on retombe sur null.
async function lookupUPCitemdb(code) {
  const clean = (code || "").replace(/\D/g, "");
  if (!clean) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${clean}`,
      6000
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "OK" || !Array.isArray(data.items) || !data.items.length) {
      return null;
    }
    const item = data.items[0];
    // Nettoyage du titre : les fiches UPCitemdb reprennent souvent le libellé
    // Amazon, verbeux et suffixé d'un ASIN entre parenthèses « (B07GVVCRFV) ».
    let title = String(item.title || "").trim();
    title = title.replace(/\s*\((?:ASIN[:\s]*)?B0[A-Z0-9]{8,9}\)\s*$/i, "").trim();
    if (!title) return null;
    // Première VRAIE image http(s) comme couverture (on force https et on
    // écarte les placeholders — « no_image.gif » d'Alibris, .tif de Macy's, etc.
    // qui salissaient les jaquettes récupérées).
    const cover = (item.images || [])
      .map((u) => (u || "").replace(/^http:\/\//i, "https://"))
      .find(
        (u) =>
          /^https:\/\//i.test(u) &&
          !/no[_-]?image|placeholder|spacer|blank|default/i.test(u) &&
          !/\.(tif|tiff|gif)(\?|$)/i.test(u)
      ) || "";
    return {
      title,
      author: "",
      cover,
      publisher: item.brand || "",
      year: "",
      description: item.description || "",
      category: item.category || "",
      source: "UPCitemdb",
    };
  } catch (e) {
    return null;
  }
}

// BoardGameGeek — référence absolue pour les jeux de société, et surtout LA
// meilleure source d'art de boîte (visuels paysage, haute qualité).
// L'API BGG (XML) ne fait pas de recherche par EAN : on cherche par NOM (le
// titre déjà obtenu via KNOWN_GAMES / Open Food Facts / UPCitemdb), on prend le
// 1er résultat « boardgame », puis on lit sa <image>.
//
// ⚠️ CORS : l'API BGG n'envoie pas d'en-tête Access-Control-Allow-Origin, donc
// un fetch direct depuis le navigateur est bloqué. On passe par un proxy CORS.
// Par défaut on utilise allorigins (public, gratuit) pour que ça marche tout de
// suite, mais en production il vaut MIEUX router via ton propre backend (celui
// qui sert déjà les livres) pour la fiabilité. Mets "" pour désactiver BGG.
const BGG_COVER_PROXY = "https://api.allorigins.win/raw?url=";

// Récupère une jaquette (art de boîte) sur BoardGameGeek à partir d'un titre.
// Ne s'applique qu'aux jeux. Renvoie une URL d'image ou "" en cas d'échec.
async function lookupBGGCover(title, type) {
  const name = (title || "").trim();
  if (!name) return "";
  if (type !== "jeu-societe" && type !== "jeu-switch") return "";
  if (!BGG_COVER_PROXY && typeof BGG_COVER_PROXY !== "string") return "";
  const wrap = (u) => (BGG_COVER_PROXY ? BGG_COVER_PROXY + encodeURIComponent(u) : u);
  try {
    // 1) Recherche par nom (type boardgame)
    const sRes = await fetchWithTimeout(
      wrap(`https://boardgamegeek.com/xmlapi2/search?type=boardgame&query=${encodeURIComponent(name)}`),
      7000
    );
    if (!sRes.ok) return "";
    const sXml = await sRes.text();
    const idMatch = sXml.match(/<item\b[^>]*\bid="(\d+)"/i);
    if (!idMatch) return "";
    const id = idMatch[1];
    // 2) Fiche détaillée → <image> (grande) ou <thumbnail> à défaut
    const tRes = await fetchWithTimeout(
      wrap(`https://boardgamegeek.com/xmlapi2/thing?id=${id}`),
      7000
    );
    if (!tRes.ok) return "";
    const tXml = await tRes.text();
    const imgMatch =
      tXml.match(/<image>([^<]+)<\/image>/i) ||
      tXml.match(/<thumbnail>([^<]+)<\/thumbnail>/i);
    let img = imgMatch ? imgMatch[1].trim() : "";
    if (img.startsWith("//")) img = "https:" + img;
    return /^https?:\/\//i.test(img) ? img : "";
  } catch (e) {
    return "";
  }
}

// Stratégie pour les jeux Switch en UPC-A (12 chiffres) :
// On préfixe d'un 0 pour obtenir un EAN-13 valide, ce qui maximise les chances
// de match dans Open Food Facts.
function upcToEan(code) {
  const clean = (code || "").replace(/\D/g, "");
  if (clean.length === 12) return "0" + clean;
  return clean;
}

// Wikidata SPARQL — recherche un objet par GTIN (P3962) puis par EAN-13/UPC
// dans les propriétés alternatives (P5749 = ISBN-13, etc.).
// Wikidata expose CORS ouvert et ne demande pas de clé. Le résultat n'est pas
// garanti (Wikidata indexe loin de tous les produits) mais c'est un excellent
// secours pour les jeux Switch et grosses sorties commerciales.
async function lookupWikidata(code) {
  const clean = (code || "").replace(/\D/g, "");
  if (!clean) return null;
  // Variantes du code à tester (EAN-13 et UPC-A-préfixé-d-un-0)
  const variants = new Set([clean]);
  if (clean.length === 12) variants.add("0" + clean);
  if (clean.length === 13 && clean.startsWith("0")) variants.add(clean.slice(1));

  // P3962 = GTIN (le plus courant pour les produits commerciaux)
  // On cherche aussi via le label en filtrant sur Q-items "video game" ou "board game"
  // Pour simplifier on fait une seule requête multi-variantes.
  const valuesClause = [...variants].map((v) => `"${v}"`).join(" ");
  const sparql = `
    SELECT ?item ?itemLabel ?image ?publisherLabel WHERE {
      VALUES ?gtin { ${valuesClause} }
      ?item wdt:P3962 ?gtin.
      OPTIONAL { ?item wdt:P18 ?image. }
      OPTIONAL { ?item wdt:P123 ?publisher. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    }
    LIMIT 1
  `;
  try {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return null;
    const data = await res.json();
    const row = data.results?.bindings?.[0];
    if (!row) return null;
    const title = row.itemLabel?.value || "";
    if (!title) return null;
    // Wikidata renvoie une URL Commons "Special:FilePath" — utilisable directement
    let cover = row.image?.value || "";
    // On force https et on demande une miniature de taille raisonnable via les
    // services Commons (le path Special:FilePath sait déjà servir un thumb si on
    // ajoute ?width=, sinon on récupère la taille d'origine).
    if (cover && !cover.includes("?")) cover += "?width=600";
    return {
      title,
      author: "",
      cover,
      publisher: row.publisherLabel?.value || "",
      year: "",
      description: "",
      source: "Wikidata",
    };
  } catch (e) {
    return null;
  }
}

// Recherche unifiée selon le type d'objet détecté.
// - livre / inconnu  → Google Books + Open Library + BnF (cascade existante)
// - revue            → reconnaissance par préfixe (déjà fait côté UI) + Open Food Facts en complément
// - jeu-switch       → KNOWN_GAMES → Open Food Facts → UPCitemdb → Wikidata (UPC normalisé)
// - jeu-societe      → KNOWN_GAMES → Open Food Facts → UPCitemdb → Wikidata
// Renvoie { title, author, cover, publisher, year, description, source, debug, _type? }
async function lookupAnyBarcode(code, type) {
  // ⚠️ On retire d'abord un éventuel suffixe `#N` (utilisé pour distinguer
  // plusieurs numéros de revues partageant le même code-barres EAN) AVANT
  // de nettoyer les non-chiffres. Sinon `replace(/\D/g, "")` transformerait
  // `3780263006908#2` en `37802630069082`, ce qui corromprait la lookup.
  const baseCode = String(code || "").split("#")[0];
  const clean = baseCode.replace(/\D/g, "");
  if (!clean) return null;

  // Pour les livres on garde la cascade riche existante
  if (type === "livre") {
    return lookupISBN(clean);
  }

  // === RECONNAISSANCE INTERNE (instantanée, sans réseau) ===
  // 1) Jeu connu dans KNOWN_GAMES ?
  const knownGame = recognizeGame(clean);
  // 2) Revue connue ?
  const knownMag = recognizeMagazine(clean);
  // 3) Préfixe éditeur de presse identifié ? (Bayard, Milan, Fleurus…)
  const pressPub = recognizePressPublisher(clean);

  // === LOOKUP RÉSEAU EN PARALLÈLE ===
  const eanForOFF = upcToEan(clean);
  const [off, google, wikidata, upc] = await Promise.all([
    lookupOpenFoodFacts(eanForOFF).catch(() => null),
    // Google Books peut parfois remonter une fiche pour un produit non-livre
    // (rare mais utile en secours pour le titre). On le met en parallèle.
    lookupGoogleBooks(clean).catch(() => null),
    // Wikidata couvre bien les jeux Switch et certains jeux de société
    lookupWikidata(clean).catch(() => null),
    // UPCitemdb : forte couverture des boîtes de jeux + visuels marchands.
    // On lui passe le code brut ; l'API accepte aussi bien l'UPC-A que l'EAN-13.
    lookupUPCitemdb(clean).catch(() => null),
  ]);

  const debug = {
    knownGame: knownGame ? `OK (${knownGame.title})` : "rien",
    knownMag: knownMag ? `OK (${knownMag.title})` : "rien",
    pressPub: pressPub ? `OK (${pressPub.publisher})` : "rien",
    openFoodFacts: off ? `OK (${off.title?.slice(0, 40)})` : "rien",
    upcitemdb: upc ? `OK (${upc.title?.slice(0, 40)})` : "rien",
    google: google ? `OK (${google.title?.slice(0, 40)})` : "rien",
    wikidata: wikidata ? `OK (${wikidata.title?.slice(0, 40)})` : "rien",
  };

  // === FUSION SOURCES ===
  // Priorité titre :
  //   1. KNOWN_GAMES / KNOWN_MAGAZINES — déterministe et fiable
  //   2. Open Food Facts — bon pour produits indexés
  //   3. UPCitemdb — forte couverture des boîtes de jeux
  //   4. Wikidata — bon pour jeux/œuvres notables
  //   5. Google Books — secours
  //   6. À défaut : "Revue Bayard…" si on a reconnu l'éditeur de presse
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

  const title =
    knownGame?.title ||
    knownMag?.title ||
    pick(off?.title, upc?.title, wikidata?.title, google?.title) ||
    (pressPub ? `Revue ${pressPub.publisher}` : "");

  const publisher =
    knownGame?.publisher ||
    knownMag?.publisher ||
    pressPub?.publisher ||
    pick(off?.publisher, upc?.publisher, wikidata?.publisher, google?.publisher);

  // Couverture : OFF > UPCitemdb > Wikidata > Google
  let cover = pick(off?.cover, upc?.cover, wikidata?.cover, google?.cover);

  // Source affichée
  let source = null;
  if (knownGame) source = "Base interne (jeux)";
  else if (knownMag) source = "Base interne (revues)";
  else if (off) source = "Open Food Facts";
  else if (upc) source = "UPCitemdb";
  else if (wikidata) source = "Wikidata";
  else if (google) source = "Google Books";
  else if (pressPub) source = "Préfixe éditeur";

  // Dernier recours JAQUETTE pour les jeux : si aucune source n'a fourni de
  // visuel mais qu'on a un titre, on tente l'art de boîte (paysage) de BGG.
  if (!cover && title && (type === "jeu-societe" || type === "jeu-switch")) {
    const bggCover = await lookupBGGCover(title, type).catch(() => "");
    if (bggCover) {
      cover = bggCover;
      debug.bgg = "OK (art de boîte)";
      if (!source || source === "Préfixe éditeur") source = "BoardGameGeek";
    } else {
      debug.bgg = "rien";
    }
  }

  if (!title && !cover) {
    return { title: "", author: "", cover: "", source: null, debug };
  }

  return {
    title,
    author: pick(google?.author, ""),
    cover,
    subtitle: "",
    publisher,
    year: pick(google?.year, wikidata?.year, ""),
    description: pick(off?.description, upc?.description, google?.description, ""),
    categories: "",
    pages: 0,
    language: "",
    rating: 0,
    ratingsCount: 0,
    infoLink: "",
    format: "",
    dimensions: "",
    weight: "",
    source,
    debug,
  };
}

// Cascade : essaye chaque source en parallèle, retourne le meilleur résultat
async function lookupISBN(isbn) {
  // Retire un éventuel suffixe `#N` (utilisé pour les numéros de revues qui
  // partagent un code-barres) avant tout appel réseau. Les bases en ligne ne
  // connaissent évidemment que le code EAN brut.
  const clean = String(isbn || "").split("#")[0];
  const [google, openLib, bnf, fallbackCover] = await Promise.all([
    lookupGoogleBooks(clean),
    lookupOpenLibrary(clean),
    lookupBNF(clean),
    findCoverFor(clean),
  ]);

  const debug = {
    google: google ? `OK (${google.title?.slice(0, 40)})` : "rien",
    openLibrary: openLib ? `OK (${openLib.title?.slice(0, 40)})` : "rien",
    bnf: bnf ? `OK (${bnf.title?.slice(0, 40)})` : "rien",
    coverFallback: fallbackCover ? `image trouvée (${fallbackCover.includes("amazon") ? "Amazon" : "Open Library"})` : "aucune",
  };

  // Choix du titre/auteur : Google > Open Library > BnF
  let chosen = google || openLib || bnf;

  // CHOIX DE LA COUVERTURE — stratégie révisée :
  // Les couvertures Google Books sont souvent incohérentes (image d'une autre
  // édition, ou placeholder gris). On privilégie donc les sources qui lient
  // strictement l'image à l'ISBN demandé (Open Library, Amazon).
  // Google Books n'est utilisé qu'en dernier recours.
  const reliableCover = fallbackCover; // Open Library ou Amazon, vérifié par probeImageUrl
  const googleCover = google?.cover || ""; // Google Books JSON (peut être incohérent)

  let bestCover = reliableCover || googleCover || openLib?.cover || "";

  if (!chosen) {
    // Aucune métadonnée mais peut-être une couverture
    if (bestCover) {
      return {
        title: "", author: "", cover: bestCover, publisher: "", year: "",
        source: reliableCover ? "Couverture seule" : "Couverture Google (à vérifier)",
        debug,
      };
    }
    return { title: "", author: "", cover: "", source: null, debug };
  }

  // FUSION DES CHAMPS ENRICHIS : prend la première valeur non vide entre Google et Open Library.
  // Google a souvent description et rating ; Open Library a souvent pages, format, dimensions.
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "" && v !== 0) ?? "";

  chosen.cover = bestCover;
  chosen.subtitle = pick(google?.subtitle, openLib?.subtitle, "");
  chosen.pages = pick(openLib?.pages, google?.pages, 0) || 0;
  chosen.language = pick(google?.language, openLib?.language, "");
  chosen.description = pick(google?.description, openLib?.description, "");
  chosen.categories = pick(google?.categories, openLib?.categories, "");
  chosen.rating = pick(google?.rating, 0) || 0;
  chosen.ratingsCount = pick(google?.ratingsCount, 0) || 0;
  chosen.infoLink = pick(google?.infoLink, openLib?.infoLink, "");
  chosen.format = pick(openLib?.format, google?.format, "");
  chosen.dimensions = pick(openLib?.dimensions, "");
  chosen.weight = pick(openLib?.weight, "");
  chosen.debug = debug;
  return chosen;
}

/**
 * Crée un lecteur unifié. Méthode A (préférée) : ZXing (universel).
 * Méthode B (fallback) : BarcodeDetector natif (Chrome Android).
 * Renvoie { startScanning(videoEl, onResult), stop() }.
 *
 * Important iOS : on gère nous-mêmes getUserMedia et l'attachement du stream
 * à la balise <video> avant de passer à ZXing. Cela évite l'écran noir en
 * mode standalone PWA sur iPhone.
 */
async function createBarcodeReader() {
  // Tentative ZXing en priorité (fonctionne sur Safari iOS)
  try {
    const ZX = await loadZXing();
    const reader = createConfiguredReader();
    let controls = null;
    let stream = null;
    return {
      type: "zxing",
      async startScanning(videoEl, onResult) {
        // 1) Demande l'accès caméra nous-mêmes (déclenchement par interaction utilisateur)
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        // 2) Attache le stream à la balise vidéo et attend qu'elle soit prête
        videoEl.srcObject = stream;
        videoEl.setAttribute("playsinline", "true");
        videoEl.setAttribute("muted", "true");
        videoEl.muted = true;

        await new Promise((resolve, reject) => {
          let settled = false;
          const onReady = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const onError = (err) => {
            if (settled) return;
            settled = true;
            reject(err);
          };
          videoEl.onloadedmetadata = onReady;
          videoEl.oncanplay = onReady;
          videoEl.onerror = onError;
          // Timeout de sécurité : si rien ne se passe en 4 sec, on abandonne
          setTimeout(() => onError(new Error("video-timeout")), 4000);
        });

        try {
          await videoEl.play();
        } catch (err) {
          // iOS peut bloquer play() ; on continue, ZXing essaiera quand même
        }

        // 3) Lance ZXing sur la balise vidéo déjà active
        controls = reader.decodeFromVideoElement(videoEl, (result) => {
          if (result) onResult(result.getText());
        });
      },
      stop() {
        if (controls) {
          try { controls.stop(); } catch (e) { /* ignore */ }
          controls = null;
        }
        if (stream) {
          try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
          stream = null;
        }
      },
    };
  } catch (e) {
    // Fallback BarcodeDetector si ZXing inaccessible
    if ("BarcodeDetector" in window) {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const isbnFormats = formats.filter((f) => ["ean_13", "ean_8", "upc_a", "upc_e"].includes(f));
      if (isbnFormats.length === 0) throw new Error("no-format");
      const detector = new window.BarcodeDetector({ formats: isbnFormats });
      let stream = null, intervalId = null;
      return {
        type: "native",
        async startScanning(videoEl, onResult) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }, audio: false,
          });
          videoEl.srcObject = stream;
          videoEl.setAttribute("playsinline", "true");
          videoEl.muted = true;
          await videoEl.play();
          intervalId = setInterval(async () => {
            try {
              const codes = await detector.detect(videoEl);
              if (codes.length > 0) onResult(codes[0].rawValue);
            } catch (err) { /* ignore */ }
          }, 400);
        },
        stop() {
          if (intervalId) { clearInterval(intervalId); intervalId = null; }
          if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
        },
      };
    }
    throw new Error("no-scanner");
  }
}


export default function App() {
  const [books, setBooks] = useState([]);
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [structure, setStructure] = useState(INITIAL_STRUCTURE);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("home"); // home, search, add, library, detail, edit, bibliotheque
  const [previousView, setPreviousView] = useState("home"); // pour le retour arrière contextuel
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBib, setFilterBib] = useState("all");
  const [filterType, setFilterType] = useState("all");
  // Nouveaux filtres hiérarchiques : pièce → bibliothèque → étagère
  // Le filtre `filterBib` existe déjà et est utilisé en cascade :
  // - filterPiece détermine quelles bibliothèques sont disponibles
  // - filterBib (au sein de la pièce) détermine quelles étagères sont visibles
  // - filterEtagere filtre la liste finale
  const [filterPiece, setFilterPiece] = useState("all");
  const [filterEtagere, setFilterEtagere] = useState("all");
  const [selectedBook, setSelectedBook] = useState(null);
  // Liste figée des IDs servant à la navigation Préc./Suiv. dans DetailView
  // et EditView. Capturée au moment d'ouvrir une fiche pour éviter qu'elle
  // ne change si le filtre est modifié en arrière-plan ou si l'enregistrement
  // d'une modification (titre, position) sort le livre du filtre actif.
  const [navigationIds, setNavigationIds] = useState([]);
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  // Quand l'utilisateur lance un scan rapide depuis le plan (bouton + sur une
  // étagère), on stocke ici l'étagère cible pour que AddView ouvre directement
  // BatchScanner sans repasser par la sélection d'étagère.
  // Format : { bibliotheque, etagere, position } ou null
  const [quickScanShelf, setQuickScanShelf] = useState(null);
  // État de progression de la re-recherche en arrière-plan
  // null = inactif, sinon { current, total, found }
  const [enrichProgress, setEnrichProgress] = useState(null);
  const enrichCancelRef = useRef(false);

  // === ÉTAT D'AUTHENTIFICATION ===
  // null = pas encore vérifié | { user, session } = connecté | "skipped" = mode local choisi
  const [authState, setAuthState] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Vérifie la session au démarrage
  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Pas de Supabase configuré → mode local direct
      setAuthState("skipped");
      setAuthChecked(true);
      return;
    }
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (session) {
        setAuthState({ session, user: session.user });
      }
      setAuthChecked(true);
    })();
    // Écoute les changements (déconnexion auto, refresh token...)
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session) {
        setAuthState({ session, user: session.user });
      } else if (event === "SIGNED_OUT") {
        setAuthState(null);
      }
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
    setAuthState(null);
    setShowSettings(false);
  };

  // Drapeau qui dit "je suis en train d'écrire structure ou layout, ignore les
  // événements realtime pendant ce temps". Évite que le realtime écrase notre
  // propre changement avec une version périmée.
  const writingStructureRef = useRef(false);
  const writingLayoutRef = useRef(false);

  // === MODE ACTIF ===
  // isCloudMode = true si l'utilisateur est connecté et que Supabase est disponible.
  // Toutes les fonctions de données vérifient ce booléen pour décider d'utiliser
  // Supabase (mode partagé) ou localStorage (mode local).
  const isCloudMode = isSupabaseConfigured && authState && authState !== "skipped";

  // Charge livres + layout + structure au démarrage.
  // Mode cloud : depuis Supabase. Mode local : depuis localStorage.
  // Le useEffect se relance quand on bascule auth (login/logout).
  useEffect(() => {
    if (!authChecked) return; // attend la vérif auth avant de charger
    let cancelled = false;
    setLoading(true);

    (async () => {
      if (isCloudMode) {
        // === MODE CLOUD ===
        try {
          const [remoteBooks, remoteStructure, remoteLayout] = await Promise.all([
            fetchBooksRemote(),
            fetchStructureRemote(),
            fetchLayoutRemote(),
          ]);
          if (cancelled) return;
          setBooks(remoteBooks);

          // === CHARGEMENT DES COUVERTURES AVEC CACHE LOCAL ===
          // fetchBooksRemote() ne charge pas la colonne `cover` (trop lourde
          // pour 800+ livres). Pour économiser massivement la bande passante
          // Supabase, on utilise un cache IndexedDB local :
          //   1. On lit d'abord toutes les couvertures déjà en cache (instant)
          //   2. On affiche immédiatement les livres avec leurs covers cachées
          //   3. On ne télécharge depuis Supabase QUE les ids non cachés
          //      (typiquement : zéro, sauf au tout premier démarrage ou
          //      quand de nouveaux livres ont été ajoutés depuis)
          //   4. On met le cache à jour avec les nouvelles couvertures
          (async () => {
            const ids = remoteBooks.map((b) => b.id).filter(Boolean);

            // 1. Lecture du cache local
            let cached = new Map();
            try {
              cached = await getCachedCovers(ids);
            } catch (e) {
              console.warn("Cache de couvertures non lisible:", e?.message);
            }
            if (cancelled) return;
            if (cached.size > 0) {
              setBooks((prev) => prev.map((b) =>
                cached.has(b.id) ? { ...b, cover: cached.get(b.id) } : b
              ));
            }

            // 2. Téléchargement des couvertures manquantes uniquement
            const missingIds = ids.filter((id) => !cached.has(id));
            if (missingIds.length === 0) return; // tout est en cache, rien à faire

            console.log(`Téléchargement de ${missingIds.length} couvertures manquantes (sur ${ids.length} livres)`);
            const COVER_BATCH = 30;
            for (let i = 0; i < missingIds.length; i += COVER_BATCH) {
              if (cancelled) return;
              const slice = missingIds.slice(i, i + COVER_BATCH);
              try {
                const covers = await fetchBookCoversRemote(slice);
                if (cancelled) return;
                if (covers.size > 0) {
                  // Met à jour le state ET le cache pour les prochains démarrages
                  setBooks((prev) => prev.map((b) =>
                    covers.has(b.id) ? { ...b, cover: covers.get(b.id) } : b
                  ));
                  // Persiste en arrière-plan (non bloquant pour l'UI)
                  setCachedCovers(covers).catch(() => {});
                }
              } catch (e) {
                console.warn("Lot de couvertures non chargé:", e?.message);
              }
              await new Promise((r) => setTimeout(r, 50));
            }
          })();
          if (remoteStructure && (remoteStructure.pieces?.length || 0) > 0) {
            setStructure({
              pieces: remoteStructure.pieces || INITIAL_PIECES,
              bibliotheques: remoteStructure.bibliotheques || INITIAL_BIBLIOTHEQUES,
              etageres: remoteStructure.etageres || INITIAL_ETAGERES,
            });
          } else {
            // Première utilisation cloud : initialiser la structure côté Supabase
            await saveStructureRemote(INITIAL_STRUCTURE);
          }
          if (remoteLayout) {
            setLayout({
              pieces: { ...DEFAULT_LAYOUT.pieces, ...(remoteLayout.pieces || {}) },
              bibliotheques: { ...DEFAULT_LAYOUT.bibliotheques, ...(remoteLayout.bibliotheques || {}) },
            });
          }

          // === NETTOYAGE AUTOMATIQUE DU STOCKAGE LOCAL ===
          // En mode cloud, le storage local ne devrait contenir que des livres
          // saisis pendant une éventuelle session "Continuer sans compte"
          // antérieure et pas encore migrés. Tout livre local dont l'ISBN
          // existe déjà en BDD distante est un résidu (typiquement laissé par
          // une migration antérieure qui ne nettoyait pas ou par une suppression
          // cloud qui ne propageait pas en local). On l'efface pour éviter que
          // le bouton "Migrer" se réaffiche en boucle.
          // Les livres locaux SANS ISBN, ou ceux dont l'ISBN n'existe pas côté
          // distant, sont préservés : ils sont peut-être en attente de migration.
          try {
            const localResult = await window.storage.get(STORAGE_KEY);
            if (localResult?.value) {
              const localBooks = JSON.parse(localResult.value);
              if (Array.isArray(localBooks) && localBooks.length > 0) {
                // Normalisation ISBN qui préserve le suffixe #N (utilisé pour
                // distinguer les numéros de revues à code-barres partagé).
                const normalizeIsbn = (b) => {
                  const raw = (b.isbn || "").trim();
                  if (!raw) return "";
                  const [base, suffix] = raw.split("#");
                  const cleanBase = base.replace(/\D/g, "");
                  if (cleanBase.length < 10) return "";
                  return suffix !== undefined ? `${cleanBase}#${suffix}` : cleanBase;
                };
                const remoteIsbns = new Set(
                  remoteBooks.map(normalizeIsbn).filter(Boolean)
                );
                const stillNeedingMigration = localBooks.filter((b) => {
                  const isbn = normalizeIsbn(b);
                  // Sans ISBN : on garde (ne peut pas vérifier si déjà migré)
                  if (!isbn) return true;
                  // Avec ISBN : on garde uniquement si pas déjà côté distant
                  return !remoteIsbns.has(isbn);
                });
                if (stillNeedingMigration.length === 0) {
                  // Plus rien à migrer → suppression complète de la clé
                  await window.storage.delete(STORAGE_KEY);
                } else if (stillNeedingMigration.length < localBooks.length) {
                  // Certains résidus à effacer, d'autres encore à migrer
                  await window.storage.set(STORAGE_KEY, JSON.stringify(stillNeedingMigration));
                }
                // Sinon : aucun nettoyage nécessaire
              }
            }
          } catch (e) { /* pas grave si le nettoyage échoue */ }
        } catch (e) {
          showToast(`Erreur de chargement : ${e.message}`, "error");
        }
      } else {
        // === MODE LOCAL ===
        try {
          const result = await window.storage.get(STORAGE_KEY);
          if (result?.value && !cancelled) setBooks(JSON.parse(result.value));
        } catch (e) { /* pas de données encore */ }
        try {
          const layoutResult = await window.storage.get(LAYOUT_KEY);
          if (layoutResult?.value && !cancelled) {
            const saved = JSON.parse(layoutResult.value);
            setLayout({
              pieces: { ...DEFAULT_LAYOUT.pieces, ...(saved.pieces || {}) },
              bibliotheques: { ...DEFAULT_LAYOUT.bibliotheques, ...(saved.bibliotheques || {}) },
            });
          }
        } catch (e) { /* pas de layout */ }
        try {
          const structResult = await window.storage.get(STRUCTURE_KEY);
          if (structResult?.value && !cancelled) {
            const saved = JSON.parse(structResult.value);
            setStructure({
              pieces: saved.pieces || INITIAL_PIECES,
              bibliotheques: saved.bibliotheques || INITIAL_BIBLIOTHEQUES,
              etageres: saved.etageres || INITIAL_ETAGERES,
            });
          }
        } catch (e) { /* pas de structure */ }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [authChecked, isCloudMode]);

  // === ABONNEMENTS TEMPS RÉEL (mode cloud uniquement) ===
  // Quand un autre membre de la famille modifie quelque chose, on reçoit
  // une notification et on rafraîchit la donnée concernée.
  useEffect(() => {
    if (!isCloudMode) return;

    // === SOUSCRIPTION REALTIME — APPLY DELTA ===
    // ⚠️ CHANGEMENT CRITIQUE pour la consommation de bande passante.
    // AVANT : à chaque INSERT/UPDATE/DELETE, on re-fetchait TOUTE la liste
    // des livres. Pour 700 scans avec covers, cela représentait des dizaines
    // de gigaoctets téléchargés (Σ N pour N de 1 à 700) — quota Supabase
    // gratuit (5 GB/mois) explosé en quelques heures.
    // MAINTENANT : on applique directement le delta envoyé par Supabase via
    // payload.new / payload.old. Aucun re-fetch n'est nécessaire — chaque
    // event ne coûte que la taille du livre concerné (~50 KB max).
    const booksSub = subscribeToBooks((payload) => {
      try {
        const eventType = payload.eventType || payload.type;
        if (eventType === "INSERT" && payload.new) {
          const newBook = dbToBook(payload.new);
          setBooks((prev) => {
            // Évite les doublons si l'event arrive après notre propre insertion
            // locale (cas typique : on vient d'ajouter le livre via insertBookRemote
            // qui le pousse déjà dans setBooks).
            if (prev.some((b) => b.id === newBook.id)) return prev;
            return [newBook, ...prev];
          });
          // Met en cache la couverture du nouveau livre pour les prochaines sessions
          if (newBook.cover && newBook.id) {
            setCachedCovers({ [newBook.id]: newBook.cover }).catch(() => {});
          }
        } else if (eventType === "UPDATE" && payload.new) {
          const updatedBook = dbToBook(payload.new);
          setBooks((prev) => prev.map((b) => {
            if (b.id !== updatedBook.id) return b;
            // Le payload realtime peut ne pas contenir genre (colonne absente de
            // la publication) — dans ce cas on conserve le genre local existant.
            const merged = { ...b, ...updatedBook };
            if ((!updatedBook.genre || updatedBook.genre.length === 0) && b.genre && b.genre.length > 0) {
              merged.genre = b.genre;
            }
            return merged;
          }));
          // Synchronise le cache : la couverture a peut-être changé
          if (updatedBook.id) {
            if (updatedBook.cover) {
              setCachedCovers({ [updatedBook.id]: updatedBook.cover }).catch(() => {});
            } else {
              deleteCachedCover(updatedBook.id).catch(() => {});
            }
          }
        } else if (eventType === "DELETE" && payload.old) {
          const deletedId = payload.old.id;
          setBooks((prev) => prev.filter((b) => b.id !== deletedId));
          // Nettoie le cache pour libérer de la place
          deleteCachedCover(deletedId).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    });

    const structSub = subscribeToStructure(async () => {
      if (writingStructureRef.current) return; // notre propre écriture, on ignore
      try {
        const fresh = await fetchStructureRemote();
        if (fresh) setStructure(fresh);
      } catch (e) { /* ignore */ }
    });

    const layoutSub = subscribeToLayout(async () => {
      if (writingLayoutRef.current) return; // notre propre écriture, on ignore
      try {
        const fresh = await fetchLayoutRemote();
        if (fresh) {
          setLayout({
            pieces: { ...DEFAULT_LAYOUT.pieces, ...(fresh.pieces || {}) },
            bibliotheques: { ...DEFAULT_LAYOUT.bibliotheques, ...(fresh.bibliotheques || {}) },
          });
        }
      } catch (e) { /* ignore */ }
    });

    return () => {
      booksSub.unsubscribe();
      structSub.unsubscribe();
      layoutSub.unsubscribe();
    };
  }, [isCloudMode]);

  const saveLayout = async (newLayout) => {
    setLayout(newLayout);
    if (isCloudMode) {
      writingLayoutRef.current = true;
      try {
        await saveLayoutRemote(newLayout);
      } catch (e) {
        showToast("Erreur de sauvegarde de la disposition", "error");
      } finally {
        // Petit délai pour laisser passer l'écho realtime de notre propre écriture
        setTimeout(() => { writingLayoutRef.current = false; }, 1500);
      }
    } else {
      try {
        await window.storage.set(LAYOUT_KEY, JSON.stringify(newLayout));
      } catch (e) {
        showToast("Erreur de sauvegarde de la disposition", "error");
      }
    }
  };

  const saveStructure = async (newStructure) => {
    setStructure(newStructure);
    if (isCloudMode) {
      writingStructureRef.current = true;
      try {
        await saveStructureRemote(newStructure);
      } catch (e) {
        showToast("Erreur de sauvegarde de la structure", "error");
      } finally {
        // Petit délai pour laisser passer l'écho realtime de notre propre écriture
        setTimeout(() => { writingStructureRef.current = false; }, 1500);
      }
    } else {
      try {
        await window.storage.set(STRUCTURE_KEY, JSON.stringify(newStructure));
      } catch (e) {
        showToast("Erreur de sauvegarde de la structure", "error");
      }
    }
  };

  // Sauvegarde de tout le tableau de livres (mode local uniquement — utilisé pour
  // les opérations massives type import/migration). En mode cloud, on passe par
  // les fonctions unitaires insertBookRemote / updateBookRemote / deleteBookRemote.
  const saveBooks = async (newBooks) => {
    setBooks(newBooks);
    if (!isCloudMode) {
      try {
        await window.storage.set(STORAGE_KEY, JSON.stringify(newBooks));
      } catch (e) {
        showToast("Erreur de sauvegarde", "error");
      }
    }
    // En mode cloud, les changements ont normalement déjà été poussés un par un
    // via insertBookRemote/updateBookRemote/deleteBookRemote.
  };

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  const addBook = async (book, options = {}) => {
    if (isCloudMode) {
      // Mode cloud : insert immédiat dans Supabase, qui renvoie l'objet complet (avec son UUID)
      try {
        const inserted = await insertBookRemote(book);
        // Préserve _placeholderId pour le suivi en mode batch
        if (book._placeholderId) inserted._placeholderId = book._placeholderId;
        // Optimistic update : on l'ajoute localement aussi tout de suite
        // (l'abonnement realtime fera la sync mais avec une petite latence)
        setBooks((prev) => {
          // évite le doublon si l'event realtime arrive en même temps
          if (prev.some((b) => b.id === inserted.id)) return prev;
          return [inserted, ...prev];
        });
        if (!options.silent) {
          showToast("Livre ajouté à votre bibliothèque");
          setView("home");
        }
        return inserted;
      } catch (e) {
        showToast(`Erreur d'ajout : ${e.message}`, "error");
        return null;
      }
    } else {
      // Mode local
      const newBook = {
        ...book,
        id: Date.now().toString() + "-" + Math.random().toString(36).slice(2, 6),
        addedAt: new Date().toISOString(),
      };
      setBooks((prev) => {
        const next = [newBook, ...prev];
        window.storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      if (!options.silent) {
        showToast("Livre ajouté à votre bibliothèque");
        setView("home");
      }
      return newBook;
    }
  };

  const updateBook = async (id, updates) => {
    if (isCloudMode) {
      try {
        const updated = await updateBookRemote(id, updates);
        setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
        showToast("Livre mis à jour");
      } catch (e) {
        showToast(`Erreur : ${e.message}`, "error");
      }
    } else {
      setBooks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, ...updates } : b));
        window.storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      showToast("Livre mis à jour");
    }
  };

  // Mise à jour en mode batch (pas de toast, par placeholder ID)
  // ⚠️ Cette fonction est moins robuste : la souscription realtime de Supabase
  // recharge la liste depuis la BDD (qui n'a pas la colonne _placeholderId), ce
  // qui peut effacer le _placeholderId localement avant que le lookup ait
  // terminé. Préférer enrichBookById ci-dessous quand on connaît l'ID DB.
  const enrichBookByPlaceholder = async (placeholderId, updates) => {
    if (isCloudMode) {
      // En mode cloud, on cherche le livre par son _placeholderId pour récupérer son UUID Supabase
      const target = books.find((b) => b._placeholderId === placeholderId);
      if (!target) return;
      try {
        const updated = await updateBookRemote(target.id, updates);
        setBooks((prev) => prev.map((b) =>
          b._placeholderId === placeholderId ? { ...b, ...updated } : b
        ));
      } catch (e) { /* ignore */ }
    } else {
      setBooks((prev) => {
        const next = prev.map((b) =>
          b._placeholderId === placeholderId ? { ...b, ...updates } : b
        );
        window.storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  };

  // Mise à jour en mode batch par ID DB direct (sans toast).
  // C'est l'API à privilégier pour le scan rapide : plus robuste car insensible
  // au realtime qui peut écraser le _placeholderId côté client.
  const enrichBookById = async (id, updates) => {
    if (!id) return;
    if (isCloudMode) {
      try {
        const updated = await updateBookRemote(id, updates);
        // L'event realtime arrivera et rafraîchira aussi la liste, mais on
        // applique tout de suite localement pour un feedback immédiat.
        setBooks((prev) => prev.map((b) =>
          b.id === id ? { ...b, ...updated } : b
        ));
      } catch (e) { /* ignore */ }
    } else {
      setBooks((prev) => {
        const next = prev.map((b) =>
          b.id === id ? { ...b, ...updates } : b
        );
        window.storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  };

  // Mise à jour silencieuse d'un livre par son ID — utilisée par les fonctions
  // de re-recherche / nettoyage couvertures qui itèrent sur des dizaines de livres.
  // Ne déclenche aucun toast.
  const persistBookUpdate = async (id, updates) => {
    if (isCloudMode) {
      try {
        await updateBookRemote(id, updates);
        setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)));
      } catch (e) { /* ignore */ }
    } else {
      setBooks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, ...updates } : b));
        window.storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  };

  const deleteBook = async (id) => {
    if (isCloudMode) {
      try {
        await deleteBookRemote(id);
        setBooks((prev) => prev.filter((b) => b.id !== id));
        showToast("Livre supprimé");
        setView("home");
      } catch (e) {
        showToast(`Erreur : ${e.message}`, "error");
      }
    } else {
      setBooks((prev) => {
        const next = prev.filter((b) => b.id !== id);
        window.storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      showToast("Livre supprimé");
      setView("home");
    }
  };

  const filteredBooks = books.filter((b) => {
    const matchSearch = !searchQuery ||
      b.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.author?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.isbn?.includes(searchQuery);

    // Filtre PIÈCE : trouve la pièce de la bibliothèque du livre
    let matchPiece = filterPiece === "all";
    if (!matchPiece && b.bibliotheque) {
      const bib = structure.bibliotheques.find((x) => x.id === b.bibliotheque);
      matchPiece = bib?.pieceId === filterPiece;
    }

    const matchBib = filterBib === "all" || b.bibliotheque === filterBib;
    const matchEtagere = filterEtagere === "all" || Number(b.etagere) === Number(filterEtagere);

    const itemType = b.type || "livre";
    // "no-title" est un pseudo-type pour filtrer les objets sans titre
    // (utile pour terminer la saisie des objets incomplets après un scan).
    const matchType =
      filterType === "all"
        ? true
        : filterType === "no-title"
          ? !b.title || !b.title.trim()
          : itemType === filterType;
    return matchSearch && matchPiece && matchBib && matchEtagere && matchType;
  });

  // === EXPORT / IMPORT ===
  const handleExport = () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      books,
      structure,
      layout,
      stats: {
        booksCount: books.length,
        booksWithTitle: books.filter((b) => b.title).length,
        booksWithCover: books.filter((b) => b.cover).length,
        piecesCount: structure.pieces.length,
        bibliothequesCount: structure.bibliotheques.length,
        etageresCount: structure.etageres.length,
      },
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `ma-bibliotheque-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Sauvegarde : ${books.length} livres exportés`);
  };

  const handleImport = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.books || !Array.isArray(data.books)) {
        showToast("Fichier invalide", "error");
        return;
      }
      // Confirmation simple via window.confirm
      const summary = `Importer ${data.books.length} livres et ${data.structure?.bibliotheques?.length || 0} bibliothèques ?\n\nCela REMPLACERA toutes les données actuelles.`;
      if (!window.confirm(summary)) return;

      await saveBooks(data.books);
      if (data.structure) await saveStructure(data.structure);
      if (data.layout) await saveLayout(data.layout);
      showToast(`${data.books.length} livres importés`);
      setShowSettings(false);
    } catch (e) {
      showToast(`Erreur : ${e.message}`, "error");
    }
  };

  // === MIGRATION VERS SUPABASE ===
  // Copie les livres locaux + structure + layout vers la base partagée.
  // Ne supprime PAS les données locales — c'est une copie de sécurité.
  const [migrating, setMigrating] = useState(null); // null | { current, total }

  const handleMigrateToCloud = async () => {
    if (!isSupabaseConfigured || !authState || authState === "skipped") {
      showToast("Connectez-vous d'abord pour migrer", "error");
      return;
    }

    // === LECTURE DES LIVRES À MIGRER ===
    // On considère TOUT ce qui est actuellement affiché dans l'app (state
    // `books`) comme à migrer. Cela couvre :
    //   - les livres venant du localStorage (mode "Continuer sans compte")
    //   - les livres importés via une sauvegarde JSON après connexion
    //   - les livres déjà côté cloud (qui seront filtrés par l'anti-doublons)
    // En complément, on lit aussi le localStorage au cas où des livres y seraient
    // restés et n'auraient pas été repris dans le state.
    let localBooks = [...(books || [])];
    try {
      const result = await window.storage.get(STORAGE_KEY);
      if (result?.value) {
        const parsed = JSON.parse(result.value);
        if (Array.isArray(parsed)) {
          // Fusionne sans doublons d'id
          const knownIds = new Set(localBooks.map((b) => b.id));
          for (const b of parsed) {
            if (!knownIds.has(b.id)) localBooks.push(b);
          }
        }
      }
    } catch (e) { /* pas de stockage → on garde juste le state */ }

    if (localBooks.length === 0) {
      showToast("Aucun livre à migrer", "error");
      return;
    }

    // Vérifier si la base contient déjà des livres pour éviter les doublons
    let existing = [];
    try {
      existing = await fetchBooksRemote();
    } catch (e) {
      showToast(`Erreur de lecture distante : ${e.message}`, "error");
      return;
    }

    // === FILTRAGE ANTI-DOUBLONS ===
    // Critère retenu (cf. choix utilisateur) : un livre local est considéré
    // comme déjà présent dans la base partagée si SON ISBN existe déjà côté
    // distant — peu importe son emplacement. Les livres sans ISBN sont
    // toujours migrés (impossible de comparer).
    // ⚠️ Pour gérer les ISBN suffixés (`#2`, `#3` — utilisés pour distinguer
    // les numéros de revues qui partagent un même code-barres), on compare
    // l'ISBN COMPLET (avec son éventuel suffixe), pas le code "pur". Deux
    // numéros différents d'Historia (`...#2` et `...#3`) sont alors bien
    // considérés comme des objets distincts à migrer.
    const normalizeIsbn = (b) => {
      const raw = (b.isbn || "").trim();
      if (!raw) return "";
      // Si l'ISBN contient un suffixe #N, on garde la partie chiffres + suffixe
      const [base, suffix] = raw.split("#");
      const cleanBase = base.replace(/\D/g, "");
      if (cleanBase.length < 10) return "";
      return suffix !== undefined ? `${cleanBase}#${suffix}` : cleanBase;
    };
    const existingIsbns = new Set(
      existing.map(normalizeIsbn).filter(Boolean)
    );
    const toMigrate = localBooks.filter((b) => {
      const isbn = normalizeIsbn(b);
      // Sans ISBN exploitable : on migre (pas de moyen de détecter le doublon).
      if (!isbn) return true;
      // Avec ISBN : on ne migre que s'il n'est PAS déjà côté distant.
      return !existingIsbns.has(isbn);
    });
    const skippedCount = localBooks.length - toMigrate.length;

    // Confirmation explicite avec le détail du tri
    let msg;
    if (toMigrate.length === 0) {
      // Tous les livres locaux sont déjà dans la base partagée → on en profite
      // pour purger le stockage local (devenu redondant et source de confusion).
      try {
        await window.storage.delete(STORAGE_KEY);
      } catch (e) { /* ignore */ }
      msg = `✅ Tous vos ${localBooks.length} livre${localBooks.length > 1 ? "s locaux étaient" : " local était"} déjà dans la base partagée. Le stockage local a été nettoyé.`;
      window.alert(msg);
      return;
    }
    msg = `Migrer ${toMigrate.length} livre${toMigrate.length > 1 ? "s" : ""} local${toMigrate.length > 1 ? "aux" : ""} vers la base partagée ?`;
    if (skippedCount > 0) {
      msg += `\n\n${skippedCount} livre${skippedCount > 1 ? "s" : ""} déjà présent${skippedCount > 1 ? "s" : ""} dans la base partagée (même ISBN) ${skippedCount > 1 ? "seront ignorés" : "sera ignoré"}.`;
    }
    msg += `\n\nLa structure (${structure.bibliotheques.length} bibliothèque${structure.bibliotheques.length > 1 ? "s" : ""}) sera également synchronisée.`;
    msg += `\n\n⚠️ Le stockage local sera ensuite vidé (les livres seront uniquement accessibles via la base partagée).`;
    if (!window.confirm(msg)) return;

    try {
      setMigrating({ current: 0, total: toMigrate.length });
      // 1. Pousse la structure (pièces, bibliothèques, étagères)
      await saveStructureRemote(structure);
      // 2. Pousse le layout
      await saveLayoutRemote(layout);
      // 3. Pousse uniquement les livres absents de la base, par lots avec progression
      await insertBooksBulk(toMigrate, (current, total) => {
        setMigrating({ current, total });
      });

      // 4. Vide le stockage local : les livres sont maintenant dans la base
      //    partagée, conserver une copie locale créerait de la confusion (le
      //    bouton "Migrer" reviendrait, des suppressions cloud laisseraient
      //    des fantômes locaux, etc.). Cette étape est cruciale pour que la
      //    migration soit "définitive" du point de vue de l'utilisateur.
      try {
        await window.storage.delete(STORAGE_KEY);
      } catch (e) { /* ignore — pas grave si le storage est déjà vide */ }

      setMigrating(null);
      const summary = skippedCount > 0
        ? `✅ ${toMigrate.length} livre${toMigrate.length > 1 ? "s" : ""} migré${toMigrate.length > 1 ? "s" : ""}, ${skippedCount} ignoré${skippedCount > 1 ? "s" : ""} (déjà présent${skippedCount > 1 ? "s" : ""}). Le stockage local a été nettoyé.`
        : `✅ ${toMigrate.length} livre${toMigrate.length > 1 ? "s" : ""} migré${toMigrate.length > 1 ? "s" : ""} vers la base partagée. Le stockage local a été nettoyé.`;
      showToast(summary);
    } catch (e) {
      setMigrating(null);
      showToast(`Erreur de migration : ${e.message}`, "error");
    }
  };

  // === RE-RECHERCHE DES LIVRES INCOMPLETS ===
  // Identifie les livres avec ISBN valide mais titre/auteur/couverture manquant,
  // et lance une lookup pour chacun. Met à jour au fil de l'eau.
  const isLikelyBookISBN = (isbn) => {
    if (!isbn || typeof isbn !== "string") return false;
    const clean = isbn.replace(/\D/g, "");
    // ISBN-13 valide commence par 978 ou 979
    if (clean.length === 13 && (clean.startsWith("978") || clean.startsWith("979"))) return true;
    // ISBN-10 (toléré) — 10 chiffres
    if (clean.length === 10) return true;
    return false;
  };

  // === DÉDUPLICATION SUR UNE MÊME ÉTAGÈRE ===
  // Cherche les groupes de livres ayant le MÊME code-barres ET le MÊME emplacement
  // (bibliothèque + étagère). Pour chaque groupe, on garde celui avec le plus
  // d'informations (titre + auteur + couverture + champs enrichis), et on
  // supprime les autres.
  // Renvoie { groups: [{ keep, removes }], duplicateCount }
  const findShelfDuplicates = (booksList) => {
    // Index par clé "code|bibliotheque|etagere"
    // ⚠️ On préserve le suffixe #N de l'ISBN (utilisé pour les revues à
    // code-barres partagé) : `3780263006908#2` et `3780263006908#3` sont
    // bien deux numéros différents d'Historia et NE doivent PAS être
    // considérés comme doublons d'étagère.
    const normalizeIsbn = (raw) => {
      if (!raw) return "";
      const [base, suffix] = String(raw).split("#");
      const cleanBase = base.replace(/\D/g, "");
      if (!cleanBase) return "";
      return suffix !== undefined ? `${cleanBase}#${suffix}` : cleanBase;
    };
    const groups = new Map();
    for (const b of booksList) {
      const code = normalizeIsbn(b.isbn);
      // Pas de code-barres ⇒ on ne peut pas détecter le doublon de manière fiable.
      if (!code) continue;
      const key = `${code}|${b.bibliotheque || ""}|${b.etagere || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    // Garder uniquement les groupes avec au moins 2 entrées
    const dupGroups = [];
    let totalDuplicates = 0;
    for (const [, list] of groups) {
      if (list.length < 2) continue;
      // Score de complétude : plus c'est gros, mieux c'est
      const score = (b) => {
        let s = 0;
        if (b.title) s += 4;
        if (b.cover) s += 4;
        if (b.author) s += 2;
        if (b.description) s += 1;
        if (b.pages) s += 1;
        if (b.publisher) s += 1;
        if (b.year) s += 1;
        if (b.categories) s += 1;
        return s;
      };
      const sorted = [...list].sort((a, b) => score(b) - score(a));
      const keep = sorted[0];
      const removes = sorted.slice(1);
      dupGroups.push({ keep, removes });
      totalDuplicates += removes.length;
    }
    return { groups: dupGroups, duplicateCount: totalDuplicates };
  };

  // Supprime les doublons d'étagère détectés (cf. findShelfDuplicates).
  // Renvoie le nombre supprimé.
  const removeShelfDuplicates = async () => {
    const { groups, duplicateCount } = findShelfDuplicates(books);
    if (duplicateCount === 0) return 0;
    const idsToRemove = [];
    for (const g of groups) {
      for (const r of g.removes) idsToRemove.push(r.id);
    }
    // En cloud : supprimer côté serveur d'abord
    if (isCloudMode) {
      for (const id of idsToRemove) {
        try { await deleteBookRemote(id); } catch (e) { /* ignore */ }
      }
    }
    // État local
    const idSet = new Set(idsToRemove);
    setBooks((prev) => {
      const next = prev.filter((b) => !idSet.has(b.id));
      if (!isCloudMode) {
        window.storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      }
      return next;
    });
    return duplicateCount;
  };

  // Détecte les objets vraiment incomplets : ceux dont il manque le TITRE
  // OU la COUVERTURE. Ce sont les seuls champs critiques pour l'affichage et
  // ce sont ceux qu'une lookup en ligne va pouvoir récupérer de manière
  // fiable. On ne flagge PAS les livres qui ont titre+cover mais où il manque
  // description/pages/catégories : ces champs ne sont pas toujours fournis
  // par les sources publiques, leur absence n'est pas un défaut.
  // Cette définition est volontairement alignée sur le filtre utilisé par
  // handleEnrichIncomplete pour que le compte affiché et le compte traité
  // soient identiques.
  const findIncompleteBooks = (booksList) => {
    return booksList.filter((b) => {
      // On accepte tous les codes-barres exploitables (10+ chiffres),
      // pas seulement les ISBN livres : revues, jeux, etc.
      const code = (b.isbn || "").replace(/\D/g, "");
      if (code.length < 10) return false;
      // Critère unifié : incomplet si manque titre OU couverture.
      return !b.title || !b.cover;
    });
  };

  // Détecte les livres dont la couverture vient de Google Books (fiabilité douteuse)
  // L'URL contient "books.google" ou "googleusercontent" en général.
  const findBooksWithGoogleCover = (booksList) => {
    return booksList.filter((b) => {
      if (!isLikelyBookISBN(b.isbn)) return false;
      const cov = b.cover || "";
      return cov.includes("books.google") || cov.includes("googleusercontent");
    });
  };

  const handleEnrichIncomplete = async () => {
    // === ÉTAPE 1 : DÉDUPLICATION D'ÉTAGÈRE ===
    // Avant tout enrichissement, on supprime les doublons sur la même étagère
    // (même code-barres + même emplacement). C'est utile en sortie de scan
    // rapide où le même livre a parfois été scanné plusieurs fois.
    const { groups: dupGroups, duplicateCount } = findShelfDuplicates(books);
    let dedupedCount = 0;
    if (duplicateCount > 0) {
      const groupCount = dupGroups.length;
      const ok = window.confirm(
        `${duplicateCount} doublon${duplicateCount > 1 ? "s détectés" : " détecté"} sur la même étagère ` +
        `(${groupCount} groupe${groupCount > 1 ? "s" : ""} de doublons — même code-barres + même emplacement).\n\n` +
        `Les supprimer avant de relancer la recherche ?\n` +
        `Pour chaque groupe, l'objet le plus complet (titre + couverture + détails) sera conservé.`
      );
      if (ok) {
        dedupedCount = await removeShelfDuplicates();
      }
    }

    // === ÉTAPE 2 : ENRICHISSEMENT ===
    // On relit l'état "à jour" via le state (qui a été nettoyé si dédupliqué)
    // pour ne pas lancer de lookup sur des livres qui viennent d'être supprimés.
    // Pour faire simple : on relit `books` depuis le state, qui est déjà mis à
    // jour par setBooks dans removeShelfDuplicates. Mais en pratique le rendu
    // n'a pas eu lieu. On reconstruit donc une liste "candidats" cohérente.
    let booksToScan = books;
    if (dedupedCount > 0) {
      // Reconstruit la liste en excluant les ids supprimés (même logique que
      // removeShelfDuplicates pour rester cohérent avec ce qui se passe sur
      // l'écran en arrière-plan).
      const { groups } = findShelfDuplicates(books);
      const removedIds = new Set();
      for (const g of groups) {
        for (const r of g.removes) removedIds.add(r.id);
      }
      booksToScan = books.filter((b) => !removedIds.has(b.id));
    }

    // Sont éligibles : tous les objets avec un code-barres exploitable
    // (livre via ISBN OU revue/jeu via EAN/UPC), incomplets sur titre/cover.
    // On élargit ainsi par rapport à findIncompleteBooks qui ne ciblait que
    // les ISBN-livres : maintenant les jeux et revues incomplets sont aussi
    // re-recherchés (via lookupAnyBarcode + recognizeMagazine + Wikidata).
    const candidates = booksToScan.filter((b) => {
      const code = (b.isbn || "").replace(/\D/g, "");
      if (code.length < 10) return false;
      // Incomplet si manque titre OU couverture (les 2 infos clés à afficher)
      return !b.title || !b.cover;
    });

    if (candidates.length === 0) {
      if (dedupedCount > 0) {
        showToast(`${dedupedCount} doublon${dedupedCount > 1 ? "s supprimé" + (dedupedCount > 1 ? "s" : "") : " supprimé"} — rien à compléter`);
      } else {
        showToast("Tous les objets avec code-barres valide sont déjà complets");
      }
      return;
    }

    enrichCancelRef.current = false;
    setEnrichProgress({ current: 0, total: candidates.length, found: 0, updated: 0, mode: "incomplete" });
    let found = 0;
    let updated = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (enrichCancelRef.current) break;
      const book = candidates[i];
      try {
        // Détection du type d'objet pour aiguillage (livre / revue / jeu / …)
        const detectedType = book.type || guessTypeFromBarcode(book.isbn);
        // Reconnaissance d'une revue connue via préfixe EAN/ISSN (rapide, sans réseau)
        let magazineMatch = null;
        if (detectedType === "revue") {
          magazineMatch = recognizeMagazine(book.isbn);
        }
        // Lookup en ligne adapté au type (Google/OL/BnF pour les livres,
        // Open Food Facts / Wikidata pour les autres types)
        const result = await lookupAnyBarcode(book.isbn, detectedType);

        // Fusion : on combine reconnaissance interne (revue) + résultat réseau
        const merged = {
          title: magazineMatch?.title || result?.title || "",
          publisher: magazineMatch?.publisher || result?.publisher || "",
          author: result?.author || "",
          cover: result?.cover || "",
          subtitle: result?.subtitle || "",
          pages: result?.pages || 0,
          language: result?.language || "",
          description: result?.description || "",
          categories: result?.categories || "",
          rating: result?.rating || 0,
          ratingsCount: result?.ratingsCount || 0,
          infoLink: result?.infoLink || "",
          format: result?.format || "",
          dimensions: result?.dimensions || "",
          weight: result?.weight || "",
          year: result?.year || "",
        };

        if (merged.title || merged.cover) {
          found++;
          const updates = {};
          // Ne remplace QUE les champs vides — préserve les éditions manuelles
          if (!book.title && merged.title) updates.title = merged.title;
          if (!book.author && merged.author) updates.author = merged.author;
          if (!book.cover && merged.cover) updates.cover = merged.cover;
          if (!book.subtitle && merged.subtitle) updates.subtitle = merged.subtitle;
          if (!book.pages && merged.pages) updates.pages = merged.pages;
          if (!book.language && merged.language) updates.language = merged.language;
          if (!book.description && merged.description) updates.description = merged.description;
          if (!book.categories && merged.categories) updates.categories = merged.categories;
          if (!book.rating && merged.rating) updates.rating = merged.rating;
          if (!book.ratingsCount && merged.ratingsCount) updates.ratingsCount = merged.ratingsCount;
          if (!book.infoLink && merged.infoLink) updates.infoLink = merged.infoLink;
          if (!book.format && merged.format) updates.format = merged.format;
          if (!book.dimensions && merged.dimensions) updates.dimensions = merged.dimensions;
          if (!book.weight && merged.weight) updates.weight = merged.weight;
          if (!book.publisher && merged.publisher) updates.publisher = merged.publisher;
          if (!book.year && merged.year) updates.year = merged.year;
          if (Object.keys(updates).length > 0) {
            updated++;
            await persistBookUpdate(book.id, updates);
          }
        }
      } catch (e) { /* ignore */ }
      setEnrichProgress({ current: i + 1, total: candidates.length, found, updated, mode: "incomplete" });
      await new Promise((r) => setTimeout(r, 200));
    }
    const wasCancelled = enrichCancelRef.current;
    setEnrichProgress(null);
    if (wasCancelled) {
      showToast(`Annulé — ${updated} objet${updated > 1 ? "s" : ""} mis à jour`);
    } else {
      const dedupMsg = dedupedCount > 0 ? ` (${dedupedCount} doublon${dedupedCount > 1 ? "s supprimés" : " supprimé"})` : "";
      showToast(`Terminé — ${updated} objet${updated > 1 ? "s" : ""} enrichi${updated > 1 ? "s" : ""} sur ${candidates.length}${dedupMsg}`);
    }
  };

  // Remplace les couvertures Google Books par des sources plus fiables
  // (Open Library, Amazon). Ne touche pas si aucune source fiable n'est trouvée.
  const handleReplaceGoogleCovers = async () => {
    const candidates = findBooksWithGoogleCover(books);
    if (candidates.length === 0) {
      showToast("Aucune couverture Google Books à remplacer");
      return;
    }
    enrichCancelRef.current = false;
    setEnrichProgress({ current: 0, total: candidates.length, found: 0, updated: 0, mode: "covers" });
    let updated = 0;
    let removed = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (enrichCancelRef.current) break;
      const book = candidates[i];
      try {
        // findCoverFor ne renvoie QUE Open Library ou Amazon (pas Google)
        const newCover = await findCoverFor(book.isbn);
        if (newCover) {
          updated++;
          await persistBookUpdate(book.id, { cover: newCover });
        }
      } catch (e) { /* ignore */ }
      setEnrichProgress({ current: i + 1, total: candidates.length, found: updated, updated, mode: "covers" });
      await new Promise((r) => setTimeout(r, 200));
    }
    const wasCancelled = enrichCancelRef.current;
    setEnrichProgress(null);
    if (wasCancelled) {
      showToast(`Annulé — ${updated} couverture${updated > 1 ? "s" : ""} remplacée${updated > 1 ? "s" : ""}`);
    } else {
      showToast(`Terminé — ${updated} couverture${updated > 1 ? "s" : ""} remplacée${updated > 1 ? "s" : ""} sur ${candidates.length}`);
    }
  };

  // Supprime les couvertures Google Books pour repartir de zéro
  const handleClearGoogleCovers = async () => {
    const candidates = findBooksWithGoogleCover(books);
    if (candidates.length === 0) {
      showToast("Aucune couverture Google Books à supprimer");
      return;
    }
    if (!window.confirm(`Supprimer les ${candidates.length} couverture${candidates.length > 1 ? "s" : ""} Google Books ?\n\nVous pourrez ensuite utiliser "Re-rechercher les livres incomplets" pour les remplacer par Open Library ou Amazon.`)) return;
    // Suppression : on parcourt et on met à jour chacun (cloud ou local selon le mode)
    for (const book of candidates) {
      await persistBookUpdate(book.id, { cover: "" });
    }
    showToast(`${candidates.length} couverture${candidates.length > 1 ? "s" : ""} supprimée${candidates.length > 1 ? "s" : ""}`);
  };

  const handleCancelEnrich = () => {
    enrichCancelRef.current = true;
  };

  // === NETTOYAGE DES LIVRES VIDES ===
  // Supprime les livres qui n'ont ni titre, ni ISBN valide, ni couverture.
  // Utile après un bug ou une migration ratée.
  const findEmptyBooks = (booksList) => {
    return booksList.filter((b) => {
      const hasTitle = !!(b.title && b.title.trim());
      const hasIsbn = !!(b.isbn && b.isbn.trim());
      const hasCover = !!(b.cover && b.cover.trim());
      return !hasTitle && !hasIsbn && !hasCover;
    });
  };

  const handleCleanEmptyBooks = async () => {
    const empties = findEmptyBooks(books);
    if (empties.length === 0) {
      showToast("Aucun livre vide à supprimer");
      return;
    }
    if (!window.confirm(
      `Supprimer ${empties.length} livre${empties.length > 1 ? "s" : ""} vide${empties.length > 1 ? "s" : ""} (sans titre, ni ISBN, ni couverture) ?\n\nCette action est définitive.`
    )) return;

    let deleted = 0;
    for (const book of empties) {
      try {
        if (isCloudMode) {
          await deleteBookRemote(book.id);
        }
        deleted++;
      } catch (e) { /* ignore */ }
    }
    // Met à jour l'état local en une seule passe
    const idsToRemove = new Set(empties.map((b) => b.id));
    setBooks((prev) => {
      const next = prev.filter((b) => !idsToRemove.has(b.id));
      if (!isCloudMode) {
        window.storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      }
      return next;
    });
    showToast(`${deleted} livre${deleted > 1 ? "s" : ""} vide${deleted > 1 ? "s" : ""} supprimé${deleted > 1 ? "s" : ""}`);
  };

  if (loading || !authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f4ecd8" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#6b3410" }} />
      </div>
    );
  }

  // Gate d'authentification : si Supabase est configuré et qu'aucune session
  // n'est active, on affiche l'écran de connexion. L'utilisateur peut aussi
  // choisir de "continuer sans compte" — ce qui le bascule en mode local.
  if (isSupabaseConfigured && authState === null) {
    return (
      <AuthScreen
        onAuthSuccess={(session) => setAuthState({ session, user: session.user })}
        onSkip={() => setAuthState("skipped")}
      />
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: "var(--cream)", fontFamily: "var(--font-body)" }}>
      <style>{`
        :root {
          --cream: #f4ecd8;
          --parchment: #e8dcc0;
          --leather: #6b3410;
          --leather-dark: #4a230a;
          --leather-light: #8b4a1a;
          --gold: #b8860b;
          --gold-light: #d4a72c;
          --ink: #2c1810;
          --ink-soft: #5a3a28;
          --accent: #8b2c2c;
          --shadow-warm: rgba(74, 35, 10, 0.15);
          --font-display: Georgia, 'Times New Roman', serif;
          --font-body: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .book-card {
          animation: slideUp 0.3s ease-out backwards;
        }
        .toast-enter {
          animation: slideUp 0.3s ease-out;
        }
        .scan-line {
          animation: scanMove 2s ease-in-out infinite;
        }
        @keyframes scanMove {
          0%, 100% { top: 10%; }
          50% { top: 90%; }
        }
        @keyframes flashFade {
          0% { opacity: 0; }
          30% { opacity: 1; }
          100% { opacity: 0; }
        }
        input, select, textarea {
          font-family: var(--font-body);
          -webkit-appearance: none;
          appearance: none;
        }
        button {
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-30 px-5 border-b" style={{
        background: "linear-gradient(180deg, var(--leather-dark) 0%, var(--leather) 100%)",
        borderColor: "var(--gold)",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)",
        paddingBottom: "1rem",
      }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookMarked className="w-6 h-6" style={{ color: "var(--gold-light)" }} />
            <h1 style={{
              fontFamily: "var(--font-display)",
              color: "var(--cream)",
              fontSize: "1.4rem",
              fontWeight: "bold",
              letterSpacing: "0.02em",
            }}>
              Ma Bibliothèque
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs flex items-center gap-1.5" style={{ color: "var(--gold-light)", fontFamily: "var(--font-display)" }}>
              {isSupabaseConfigured && authState && authState !== "skipped" ? (
                <Cloud className="w-3.5 h-3.5" title="Connecté à la base partagée" />
              ) : (
                <CloudOff className="w-3.5 h-3.5" title="Mode local" />
              )}
              <span>{books.length} {(() => {
                // Si tous les objets sont des livres → "livres", sinon "objets"
                const allLivres = books.every((b) => !b.type || b.type === "livre");
                if (allLivres) return books.length > 1 ? "livres" : "livre";
                return books.length > 1 ? "objets" : "objet";
              })()}</span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 rounded-lg"
              style={{ background: "rgba(212, 167, 44, 0.15)", color: "var(--gold-light)" }}
              aria-label="Paramètres"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Contenu principal */}
      <main className="px-4 pt-4">
        {view === "home" && (
          <HomeView
            books={books}
            structure={structure}
            filteredBooks={filteredBooks}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            filterPiece={filterPiece}
            setFilterPiece={setFilterPiece}
            filterBib={filterBib}
            setFilterBib={setFilterBib}
            filterEtagere={filterEtagere}
            setFilterEtagere={setFilterEtagere}
            filterType={filterType}
            setFilterType={setFilterType}
            onSelectBook={(b) => {
              // On ouvre la fiche en figeant la liste filtrée actuelle comme
              // base de navigation Préc./Suiv. — l'ordre reflète exactement
              // ce que l'utilisateur voyait à l'écran.
              setSelectedBook(b);
              setPreviousView("home");
              setNavigationIds(filteredBooks.map((x) => x.id));
              setView("detail");
            }}
            onAdd={() => setView("add")}
          />
        )}
        {view === "library" && (
          <LibraryView
            books={books}
            structure={structure}
            saveStructure={saveStructure}
            saveBooks={saveBooks}
            layout={layout}
            saveLayout={saveLayout}
            showToast={showToast}
            onSelectBook={(b) => {
              // Depuis le plan, on navigue parmi les livres de la même étagère,
              // dans l'ordre de leur position physique.
              setSelectedBook(b);
              setPreviousView("library");
              const sameShelf = books
                .filter((x) =>
                  x.bibliotheque === b.bibliotheque &&
                  Number(x.etagere) === Number(b.etagere)
                )
                .sort((a, c) => (Number(a.position) || 0) - (Number(c.position) || 0));
              setNavigationIds(sameShelf.map((x) => x.id));
              setView("detail");
            }}
            onFilterBib={(bibId) => {
              // Aligne aussi le filtre pièce sur celle de la bibliothèque
              // ciblée, pour que la cascade de chips reste cohérente quand
              // l'utilisateur arrive sur l'accueil.
              const bib = structure.bibliotheques.find((b) => b.id === bibId);
              if (bib?.pieceId) setFilterPiece(bib.pieceId);
              setFilterBib(bibId);
              setFilterEtagere("all");
              setView("home");
            }}
            onQuickScanShelf={(shelf) => {
              // Lance le scan rapide directement sur l'étagère ciblée :
              // on précalcule la première position libre et on bascule sur
              // la vue "Ajouter" qui ouvrira BatchScanner sans étape de setup.
              const startPos = findFirstFreePosition(books, shelf.bibliotheque, shelf.etagere);
              setQuickScanShelf({
                bibliotheque: shelf.bibliotheque,
                etagere: shelf.etagere,
                position: startPos,
              });
              setView("add");
            }}
          />
        )}
        {view === "bibliotheque" && (
          <BibliothequeView
            books={books}
            onSelectBook={(b) => {
              setSelectedBook(b);
              setPreviousView("bibliotheque");
              setNavigationIds(books.filter(x => (x.genre || []).some(g => (b.genre || []).some(bg => g === bg))).map(x => x.id));
              setView("detail");
            }}
          />
        )}
        {view === "add" && (
          <AddView
            books={books}
            structure={structure}
            quickScanShelf={quickScanShelf}
            onCancel={() => {
              // Si on est venu via le scan rapide depuis Pièces, on y retourne ;
              // sinon retour à l'accueil (comportement par défaut).
              const wasQuickScan = !!quickScanShelf;
              setQuickScanShelf(null);
              setView(wasQuickScan ? "library" : "home");
            }}
            onAdd={addBook}
            onEnrichBook={enrichBookByPlaceholder}
            onEnrichBookById={enrichBookById}
            showToast={showToast}
          />
        )}
        {view === "detail" && selectedBook && (
          <DetailView
            book={selectedBook}
            structure={structure}
            navigationIds={navigationIds}
            allBooks={books}
            onBack={() => setView(previousView || "home")}
            onEdit={() => setView("edit")}
            onDelete={() => deleteBook(selectedBook.id)}
            onSelectBook={setSelectedBook}
          />
        )}
        {view === "edit" && selectedBook && (
          <EditView
            books={books}
            book={selectedBook}
            structure={structure}
            navigationIds={navigationIds}
            allBooks={books}
            onCancel={() => setView("detail")}
            onSave={async (updates) => {
              await updateBook(selectedBook.id, updates);
              setSelectedBook({ ...selectedBook, ...updates });
              setView("detail");
            }}
            onSelectBook={setSelectedBook}
          />
        )}
      </main>

      {/* Modale Paramètres */}
      {showSettings && (
        <SettingsModal
          books={books}
          structure={structure}
          onExport={handleExport}
          onImport={handleImport}
          onEnrichIncomplete={handleEnrichIncomplete}
          onReplaceGoogleCovers={handleReplaceGoogleCovers}
          onClearGoogleCovers={handleClearGoogleCovers}
          onCancelEnrich={handleCancelEnrich}
          enrichProgress={enrichProgress}
          incompleteCount={findIncompleteBooks(books).length}
          googleCoverCount={findBooksWithGoogleCover(books).length}
          authState={authState}
          isSupabaseConfigured={isSupabaseConfigured}
          onSignOut={handleSignOut}
          onMigrateToCloud={handleMigrateToCloud}
          migrating={migrating}
          onCleanEmptyBooks={handleCleanEmptyBooks}
          emptyBooksCount={findEmptyBooks(books).length}
          showToast={showToast}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Mini barre flottante quand enrichissement tourne en arrière-plan */}
      {enrichProgress && !showSettings && (
        <button
          onClick={() => setShowSettings(true)}
          className="fixed left-3 right-3 z-40 rounded-full px-4 py-2 shadow-lg flex items-center gap-2 text-sm"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)",
            background: "var(--leather-dark)",
            color: "var(--cream)",
          }}
        >
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          <span className="flex-1 text-left">
            Recherche {enrichProgress.current}/{enrichProgress.total} · {enrichProgress.updated} maj
          </span>
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-3 rounded-full shadow-lg toast-enter z-50 flex items-center gap-2"
          style={{
            background: toast.type === "error" ? "var(--accent)" : "var(--leather-dark)",
            color: "var(--cream)",
            fontSize: "0.875rem",
          }}>
          <Check className="w-4 h-4" />
          {toast.message}
        </div>
      )}

      {/* Bottom nav */}
      {(view === "home" || view === "library" || view === "bibliotheque") && (
        <nav className="fixed bottom-0 left-0 right-0 z-20 border-t shadow-lg" style={{
          background: "var(--cream)",
          borderColor: "var(--parchment)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}>
          <div className="flex items-center justify-around py-3 px-2">
            <NavButton
              icon={<Library className="w-6 h-6" />}
              label="Tous"
              active={view === "home" && filterBib === "all" && filterPiece === "all" && filterEtagere === "all"}
              onClick={() => {
                setView("home");
                setFilterPiece("all");
                setFilterBib("all");
                setFilterEtagere("all");
              }}
            />
            <NavButton
              icon={<Layers className="w-6 h-6" />}
              label="Pièces"
              active={view === "library"}
              onClick={() => setView("library")}
            />
            <button
              onClick={() => setView("add")}
              className="flex flex-col items-center justify-center w-14 h-14 rounded-full shadow-lg -mt-6"
              style={{
                background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
                color: "var(--cream)",
                boxShadow: "0 4px 12px var(--shadow-warm)",
              }}
            >
              <Plus className="w-7 h-7" />
            </button>
            <NavButton
              icon={<Sparkles className="w-6 h-6" />}
              label="Biblio"
              active={view === "bibliotheque"}
              onClick={() => setView("bibliotheque")}
            />
            <NavButton
              icon={<Search className="w-6 h-6" />}
              label="Chercher"
              active={false}
              onClick={() => {
                setView("home");
                setTimeout(() => document.querySelector("input[type=search]")?.focus(), 100);
              }}
            />
          </div>
        </nav>
      )}
    </div>
  );
}

// === VUE PRINCIPALE ===
function HomeView({ books, structure, filteredBooks, searchQuery, setSearchQuery, filterPiece, setFilterPiece, filterBib, setFilterBib, filterEtagere, setFilterEtagere, filterType, setFilterType, onSelectBook, onAdd }) {
  // Compte des objets par type pour décider d'afficher ou non le filtre
  const typeCounts = {};
  for (const b of books) {
    const t = b.type || "livre";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  // Compte des objets sans titre — pour le filtre "Sans titre" qui aide
  // l'utilisateur à finir la saisie des objets incomplets après un scan.
  const noTitleCount = books.filter((b) => !b.title || !b.title.trim()).length;
  const hasMultipleTypes = Object.keys(typeCounts).length > 1;

  // === COMPTES POUR LES FILTRES HIÉRARCHIQUES ===
  // Le décompte est fait sur l'ensemble des livres (avant filtrage) pour que
  // les chips affichent le total disponible — l'utilisateur sait combien il
  // y a au max dans chaque pièce/bib/étagère.
  // Pour la cohérence du parcours en cascade, les sous-filtres se basent sur
  // les sélections amont : si une pièce est sélectionnée, on ne montre que
  // ses bibliothèques.
  const piecesCounts = {}; // { pieceId: count }
  for (const b of books) {
    const bib = structure.bibliotheques.find((x) => x.id === b.bibliotheque);
    if (bib?.pieceId) piecesCounts[bib.pieceId] = (piecesCounts[bib.pieceId] || 0) + 1;
  }
  // Liste des bibliothèques disponibles selon la pièce sélectionnée
  const availableBibs = filterPiece === "all"
    ? structure.bibliotheques
    : structure.bibliotheques.filter((b) => b.pieceId === filterPiece);
  const bibCounts = {};
  for (const b of books) {
    if (b.bibliotheque) bibCounts[b.bibliotheque] = (bibCounts[b.bibliotheque] || 0) + 1;
  }
  // Liste des étagères disponibles selon la bibliothèque sélectionnée
  const availableShelves = filterBib === "all"
    ? [] // pas de sélection bib → on n'affiche pas la ligne étagère
    : structure.etageres.filter((e) => e.bibId === filterBib).sort((a, b) => a.num - b.num);
  const etagereCounts = {};
  for (const b of books) {
    if (b.bibliotheque === filterBib && b.etagere !== undefined) {
      const k = String(b.etagere);
      etagereCounts[k] = (etagereCounts[k] || 0) + 1;
    }
  }

  // Helpers de reset cascade : changer une pièce reset la bib et l'étagère.
  const handlePiece = (pieceId) => {
    setFilterPiece(pieceId);
    setFilterBib("all");
    setFilterEtagere("all");
  };
  const handleBib = (bibId) => {
    setFilterBib(bibId);
    setFilterEtagere("all");
    // Si l'utilisateur sélectionne une bib, on aligne le filtre pièce sur
    // celle qui contient la bib (utile pour cohérence visuelle).
    if (bibId !== "all") {
      const bib = structure.bibliotheques.find((b) => b.id === bibId);
      if (bib?.pieceId) setFilterPiece(bib.pieceId);
    }
  };

  if (books.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center pt-20 px-6 text-center">
        <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
          style={{ background: "var(--parchment)" }}>
          <BookOpen className="w-12 h-12" style={{ color: "var(--leather)" }} />
        </div>
        <h2 style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.5rem",
          color: "var(--ink)",
          marginBottom: "0.5rem",
        }}>
          Votre bibliothèque est vide
        </h2>
        <p style={{ color: "var(--ink-soft)", marginBottom: "2rem" }}>
          Scannez ou ajoutez votre premier livre pour commencer.
        </p>
        <button
          onClick={onAdd}
          className="px-6 py-3 rounded-full shadow-md flex items-center gap-2 font-medium"
          style={{
            background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
            color: "var(--cream)",
          }}
        >
          <Plus className="w-5 h-5" /> Ajouter un livre
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: "var(--leather)" }} />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Titre, auteur, ISBN…"
          className="w-full pl-10 pr-4 py-3 rounded-xl border-2 outline-none"
          style={{
            background: "var(--cream)",
            borderColor: "var(--parchment)",
            color: "var(--ink)",
            fontSize: "1rem",
          }}
        />
      </div>

      {/* === LIGNE 1 : FILTRE PAR TYPE D'OBJET (+ "Sans titre") === */}
      {/* La chip "Sans titre" est utile pour finir la saisie d'objets ajoutés
          via scan rapide où la lookup en ligne n'a pas trouvé de titre. Elle
          n'apparaît que s'il y a au moins un objet incomplet à signaler. */}
      {(hasMultipleTypes || noTitleCount > 0) && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
          <FilterChip active={filterType === "all"} onClick={() => setFilterType("all")}>
            Tout ({books.length})
          </FilterChip>
          {ITEM_TYPES_LIST.map((t) => {
            const count = typeCounts[t.id] || 0;
            if (count === 0) return null;
            return (
              <FilterChip key={t.id} active={filterType === t.id} onClick={() => setFilterType(t.id)}>
                {t.emoji} {t.pluralLabel} ({count})
              </FilterChip>
            );
          })}
          {noTitleCount > 0 && (
            <FilterChip
              active={filterType === "no-title"}
              onClick={() => setFilterType("no-title")}
            >
              ⚠️ Sans titre ({noTitleCount})
            </FilterChip>
          )}
        </div>
      )}

      {/* === LIGNE 2 : FILTRE PAR PIÈCE === */}
      {/* On affiche les pièces qui contiennent au moins un objet. */}
      {structure.pieces.length > 1 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
          <FilterChip active={filterPiece === "all"} onClick={() => handlePiece("all")}>
            Toutes les pièces ({books.length})
          </FilterChip>
          {structure.pieces.map((p) => {
            const count = piecesCounts[p.id] || 0;
            if (count === 0) return null;
            return (
              <FilterChip key={p.id} active={filterPiece === p.id} onClick={() => handlePiece(p.id)}>
                {p.icon || "🏠"} {p.nom} ({count})
              </FilterChip>
            );
          })}
        </div>
      )}

      {/* === LIGNE 3 : FILTRE PAR BIBLIOTHÈQUE === */}
      {/* Les bibliothèques sont restreintes à la pièce sélectionnée s'il y en
          a une. Sinon, toutes les bibliothèques s'affichent. */}
      {availableBibs.length > 1 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
          <FilterChip active={filterBib === "all"} onClick={() => handleBib("all")}>
            Toutes les bibliothèques
          </FilterChip>
          {availableBibs.map((b) => {
            const count = bibCounts[b.id] || 0;
            if (count === 0) return null;
            return (
              <FilterChip key={b.id} active={filterBib === b.id} onClick={() => handleBib(b.id)}>
                📚 {b.nom} ({count})
              </FilterChip>
            );
          })}
        </div>
      )}

      {/* === LIGNE 4 : FILTRE PAR ÉTAGÈRE === */}
      {/* Visible uniquement quand une bibliothèque est sélectionnée. Liste les
          étagères de cette bibliothèque qui contiennent au moins un objet. */}
      {filterBib !== "all" && availableShelves.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
          <FilterChip active={filterEtagere === "all"} onClick={() => setFilterEtagere("all")}>
            Toutes les étagères
          </FilterChip>
          {availableShelves.map((e) => {
            const count = etagereCounts[String(e.num)] || 0;
            if (count === 0) return null;
            return (
              <FilterChip
                key={e.id}
                active={String(filterEtagere) === String(e.num)}
                onClick={() => setFilterEtagere(e.num)}
              >
                Ét. {e.num}{e.nom ? ` · ${e.nom}` : ""} ({count})
              </FilterChip>
            );
          })}
        </div>
      )}

      {/* Espacement avant la liste si aucun filtre étagère affiché */}
      {!(filterBib !== "all" && availableShelves.length > 0) && <div className="mb-2" />}

      {/* Liste */}
      {filteredBooks.length === 0 ? (
        <p className="text-center py-12" style={{ color: "var(--ink-soft)" }}>
          Aucun livre trouvé.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredBooks.map((book, i) => (
            <BookCard key={book.id} book={book} structure={structure} onClick={() => onSelectBook(book)} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all"
      style={{
        background: active ? "var(--leather-dark)" : "var(--parchment)",
        color: active ? "var(--cream)" : "var(--ink)",
        fontFamily: "var(--font-display)",
      }}
    >
      {children}
    </button>
  );
}

function BookCard({ book, structure, onClick, index }) {
  const bib = structure.bibliotheques.find((b) => b.id === book.bibliotheque);
  const piece = bib ? structure.pieces.find((p) => p.id === bib.pieceId) : null;
  const itemType = ITEM_TYPES[book.type || "livre"];

  // Champ "info principal" affiché juste sous le titre, dépendant du type :
  //   livre  → auteur
  //   revue  → éditeur (champ `publisher`)
  //   jeu    → plateforme (Switch) ou rien (jeu de société, déjà couvert
  //            plus bas par "X joueurs · Y min")
  let mainInfo = "";
  if (book.type === "revue") {
    mainInfo = book.publisher || "";
  } else if (book.type === "jeu-switch") {
    mainInfo = book.platform || "";
  } else if (book.type === "jeu-societe") {
    mainInfo = ""; // affiché autrement plus bas
  } else {
    // livre par défaut
    mainInfo = book.author || "";
  }

  return (
    <button
      onClick={onClick}
      className="book-card w-full text-left p-3 rounded-xl flex gap-3 shadow-sm border relative"
      style={{
        background: "white",
        borderColor: "var(--parchment)",
        animationDelay: `${Math.min(index * 50, 400)}ms`,
      }}
    >
      {/* Badge type — toujours affiché, en haut à droite. Pour les livres on
          utilise une couleur plus discrète pour ne pas saturer la vue. */}
      <div
        className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
        style={{
          background: itemType?.color || "var(--leather)",
          fontSize: "0.85rem",
        }}
        title={itemType?.label}
      >
        {itemType?.emoji}
      </div>
      <SmartCover
        src={book.cover}
        alt={book.title}
        frameClass="w-16 h-24 flex-shrink-0 rounded"
        frameStyle={{ background: "var(--parchment)" }}
        fallback={<span style={{ fontSize: "2rem" }}>{itemType?.emoji || "📖"}</span>}
      />
      <div className="flex-1 min-w-0 pr-6">
        <h3 className="font-semibold leading-tight mb-1 line-clamp-2"
          style={{ fontFamily: "var(--font-display)", color: "var(--ink)", fontSize: "1rem" }}>
          {book.title || "Sans titre"}
        </h3>
        {/* Pour les revues : N° et date */}
        {book.type === "revue" && (book.issueNumber || book.issueDate) && (
          <p className="text-sm mb-1" style={{ color: "var(--leather-dark)", fontWeight: 500 }}>
            {book.issueNumber && `N° ${book.issueNumber}`}
            {book.issueNumber && book.issueDate && " — "}
            {book.issueDate}
          </p>
        )}
        {/* Info principale selon le type : auteur (livre), éditeur (revue),
            plateforme (jeu Switch). */}
        {mainInfo && (
          <p className="text-sm mb-1 line-clamp-1" style={{ color: "var(--ink-soft)" }}>
            {mainInfo}
          </p>
        )}
        {/* Pour les jeux de société : joueurs / durée (info plus pertinente
            que l'éditeur pour cette catégorie). */}
        {book.type === "jeu-societe" && (book.playersMax > 0 || book.durationMin > 0) && (
          <p className="text-sm mb-1" style={{ color: "var(--ink-soft)" }}>
            {book.playersMax > 0 && (
              book.playersMin > 0 && book.playersMin !== book.playersMax
                ? `${book.playersMin}–${book.playersMax} joueurs`
                : `${book.playersMax} joueurs`
            )}
            {book.playersMax > 0 && book.durationMin > 0 && " · "}
            {book.durationMin > 0 && `${book.durationMin} min`}
          </p>
        )}
        {/* Localisation sur deux lignes :
              — pièce (avec son étage) sur la première
              — bibliothèque · étagère · position sur la seconde
            Si le livre n'est rattaché à rien, on affiche "Non placé". */}
        <div className="text-xs mt-1" style={{ color: "var(--leather)" }}>
          {piece ? (
            <div className="flex items-center gap-1">
              <span style={{ fontSize: "0.85rem" }}>{piece.icon || "🏠"}</span>
              <span className="truncate">
                {piece.nom}{piece.etage ? ` · ${piece.etage}` : ""}
              </span>
            </div>
          ) : (
            !bib && (
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span>Non placé</span>
              </div>
            )
          )}
          {bib && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">
                {bib.nom}
                {book.etagere && ` · Ét. ${book.etagere}`}
                {book.position && ` · #${book.position}`}
              </span>
            </div>
          )}
        </div>
      </div>
      <ChevronRight className="w-5 h-5 self-center flex-shrink-0" style={{ color: "var(--leather)" }} />
    </button>
  );
}

// === VUE AJOUT ===
function AddView({ books, structure, quickScanShelf, onCancel, onAdd, onEnrichBook, onEnrichBookById, showToast }) {
  // Si quickScanShelf est défini (l'utilisateur a cliqué le bouton scan rapide
  // depuis une étagère du plan), on saute la sélection d'étagère et on bascule
  // directement sur le scanner avec le bon emplacement pré-rempli.
  const [mode, setMode] = useState(quickScanShelf ? "batch-scan" : "choice");
  const [scannedData, setScannedData] = useState(null);
  const [searching, setSearching] = useState(false);
  const [batchSetup, setBatchSetup] = useState(quickScanShelf || null);
  const [selectedType, setSelectedType] = useState("livre");

  const handleISBNFound = async (isbn) => {
    setSearching(true);
    showToast("Recherche…");
    // Devine le type d'objet d'après le format du code-barres
    const detectedType = guessTypeFromBarcode(isbn);

    // Si c'est une revue (préfixe 977), tente de la reconnaître
    let magazineMatch = null;
    if (detectedType === "revue") {
      magazineMatch = recognizeMagazine(isbn);
    }

    try {
      const found = await lookupISBN(isbn);
      const baseData = { isbn, type: detectedType };
      // Pré-remplit avec la revue reconnue (titre/éditeur) si applicable
      if (magazineMatch) {
        baseData.title = magazineMatch.title;
        baseData.publisher = magazineMatch.publisher;
        if (magazineMatch.ageRange) baseData.notes = magazineMatch.ageRange;
      }

      if (found && found.title) {
        setScannedData({ ...found, ...baseData });
        showToast(`Trouvé via ${found.source}`);
        setMode("form");
      } else if (found && found.cover) {
        setScannedData({ ...baseData, cover: found.cover, _debug: found.debug });
        showToast(magazineMatch ? `${magazineMatch.title} reconnu — saisissez le n°` : "Couverture trouvée — complétez le titre", "error");
        setMode("form");
      } else if (magazineMatch) {
        // Revue reconnue même sans Google Books
        setScannedData(baseData);
        showToast(`${magazineMatch.title} reconnu — saisissez le n°`);
        setMode("form");
      } else {
        setScannedData({ ...baseData, _debug: found?.debug });
        const typeLabel = ITEM_TYPES[detectedType]?.label || "Objet";
        showToast(`${typeLabel} non trouvé, complétez à la main`, "error");
        setMode("form");
      }
    } catch (e) {
      const baseData = { isbn, type: detectedType };
      if (magazineMatch) {
        baseData.title = magazineMatch.title;
        baseData.publisher = magazineMatch.publisher;
      }
      showToast("Connexion impossible, saisie manuelle", "error");
      setScannedData(baseData);
      setMode("form");
    }
    setSearching(false);
  };

  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1 mb-4" style={{ color: "var(--leather)" }}>
        <X className="w-5 h-5" /> Annuler
      </button>

      {mode === "choice" && (
        <div className="space-y-3 pt-4">
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)", marginBottom: "0.5rem" }}>
            Ajouter un objet
          </h2>

          {/* === SCAN RAPIDE UNIVERSEL === */}
          {/* Indépendant du type : la détection est automatique d'après le code-barres.
              Mis en tête car c'est le mode le plus efficace pour ranger une étagère. */}
          <ChoiceCard
            icon={<Zap className="w-6 h-6" />}
            title="Scan rapide en série"
            desc="Étagère entière — livres, revues, jeux : type détecté automatiquement"
            onClick={() => setMode("batch-setup")}
            highlight
          />

          <div className="text-xs uppercase tracking-wider mt-5 mb-2" style={{ color: "var(--ink-soft)" }}>
            Ou ajouter un objet à la fois
          </div>

          {/* Sélecteur de type — sert pour les modes individuels (scan simple, photo, manuel) */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {ITEM_TYPES_LIST.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedType(t.id)}
                className="p-3 rounded-xl border-2 flex items-center gap-2 text-left transition-all"
                style={{
                  background: selectedType === t.id ? t.color : "white",
                  borderColor: selectedType === t.id ? t.color : "var(--parchment)",
                  color: selectedType === t.id ? "var(--cream)" : "var(--ink)",
                }}
              >
                <span style={{ fontSize: "1.4rem" }}>{t.emoji}</span>
                <span className="text-sm font-medium leading-tight">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Options d'ajout individuel — varient selon le type sélectionné */}
          {selectedType === "livre" && (
            <>
              <ChoiceCard
                icon={<ScanLine className="w-6 h-6" />}
                title="Scanner le code-barres"
                desc="Un seul livre via son ISBN"
                onClick={() => setMode("barcode")}
              />
              <ChoiceCard
                icon={<Camera className="w-6 h-6" />}
                title="Photo de la couverture"
                desc="Prenez la couverture en photo"
                onClick={() => setMode("cover")}
              />
              <ChoiceCard
                icon={<Edit2 className="w-6 h-6" />}
                title="Saisie manuelle"
                desc="Entrez les informations à la main"
                onClick={() => { setScannedData({ type: "livre" }); setMode("form"); }}
              />
            </>
          )}

          {selectedType === "revue" && (
            <>
              <ChoiceCard
                icon={<ScanLine className="w-6 h-6" />}
                title="Scanner le code-barres"
                desc="L'app reconnaît la revue, vous saisissez le n°"
                onClick={() => setMode("barcode")}
              />
              <ChoiceCard
                icon={<Camera className="w-6 h-6" />}
                title="Photo de la couverture"
                desc="Photographiez la une"
                onClick={() => setMode("cover")}
              />
              <ChoiceCard
                icon={<Edit2 className="w-6 h-6" />}
                title="Saisie manuelle"
                desc="Tapez le titre, le numéro, la date"
                onClick={() => { setScannedData({ type: "revue" }); setMode("form"); }}
              />
            </>
          )}

          {(selectedType === "jeu-societe" || selectedType === "jeu-switch") && (
            <>
              <ChoiceCard
                icon={<ScanLine className="w-6 h-6" />}
                title="Scanner le code-barres"
                desc="Sur la boîte du jeu — souvent reconnu"
                onClick={() => setMode("barcode")}
              />
              <ChoiceCard
                icon={<Camera className="w-6 h-6" />}
                title="Photo de la boîte"
                desc="Prenez la couverture en photo"
                onClick={() => setMode("cover")}
              />
              <ChoiceCard
                icon={<Edit2 className="w-6 h-6" />}
                title="Saisie manuelle"
                desc="Nom du jeu, nombre de joueurs, durée…"
                onClick={() => {
                  const initial = { type: selectedType };
                  if (selectedType === "jeu-switch") initial.platform = "Nintendo Switch";
                  setScannedData(initial);
                  setMode("form");
                }}
              />
            </>
          )}
        </div>
      )}

      {mode === "batch-setup" && (
        <BatchSetup
          books={books}
          structure={structure}
          onCancel={() => setMode("choice")}
          onStart={(setup) => {
            setBatchSetup(setup);
            setMode("batch-scan");
          }}
        />
      )}

      {mode === "batch-scan" && batchSetup && (
        <BatchScanner
          books={books}
          structure={structure}
          setup={batchSetup}
          onAddBook={(book) => onAdd(book, { silent: true })}
          onEnrichBook={onEnrichBook}
          onEnrichBookById={onEnrichBookById}
          onChangeShelf={(newSetup) => setBatchSetup(newSetup)}
          onFinish={() => {
            // Si on est venu via le deep-link "scan rapide d'étagère" (depuis
            // le plan), on retourne directement à la vue parente plutôt qu'à
            // l'écran de choix d'ajout. Sinon, retour normal à l'écran choice.
            if (quickScanShelf) {
              onCancel();
            } else {
              setMode("choice");
            }
          }}
          showToast={showToast}
        />
      )}

      {mode === "barcode" && (
        <BarcodeScanner
          onCancel={() => setMode("choice")}
          onScan={handleISBNFound}
          searching={searching}
        />
      )}

      {mode === "cover" && (
        <CoverScanner
          onCancel={() => setMode("choice")}
          onCapture={(dataUrl) => {
            setScannedData({ cover: dataUrl });
            setMode("form");
          }}
        />
      )}

      {mode === "form" && (
        <BookForm
          books={books}
          structure={structure}
          initial={scannedData || {}}
          onCancel={() => setMode("choice")}
          onSubmit={onAdd}
          submitLabel="Ajouter à ma bibliothèque"
        />
      )}
    </div>
  );
}

function ChoiceCard({ icon, title, desc, onClick, highlight }) {
  return (
    <button
      onClick={onClick}
      className="w-full p-4 rounded-xl border-2 flex items-center gap-4 text-left"
      style={{
        background: highlight ? "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)" : "white",
        borderColor: highlight ? "var(--gold)" : "var(--parchment)",
      }}
    >
      <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: highlight ? "var(--gold-light)" : "var(--parchment)",
          color: highlight ? "var(--leather-dark)" : "var(--leather-dark)",
        }}>
        {icon}
      </div>
      <div>
        <div className="font-semibold" style={{
          fontFamily: "var(--font-display)",
          color: highlight ? "var(--cream)" : "var(--ink)",
        }}>
          {title}
        </div>
        <div className="text-sm" style={{
          color: highlight ? "var(--parchment)" : "var(--ink-soft)",
        }}>{desc}</div>
      </div>
    </button>
  );
}

// === SCANNER CODE-BARRES ===
function BarcodeScanner({ onCancel, onScan, searching }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [error, setError] = useState(null);
  const [manualISBN, setManualISBN] = useState("");
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [diagLogs, setDiagLogs] = useState([]);
  const fired = useRef(false);

  const log = (msg) => {
    console.log("[scan]", msg);
    setDiagLogs((logs) => [...logs, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  // Démarrage explicite par tap utilisateur (essentiel pour iOS standalone)
  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setDiagLogs([]);
    fired.current = false;
    log("Bouton tapé, démarrage…");
    try {
      // Test 1: API getUserMedia disponible ?
      if (!navigator.mediaDevices?.getUserMedia) {
        log("❌ navigator.mediaDevices.getUserMedia indisponible");
        setError("API caméra indisponible — utilisez Safari (pas une autre app)");
        setStarting(false);
        return;
      }
      log("✅ API getUserMedia disponible");

      // Test 2: HTTPS ?
      log(`Protocole: ${location.protocol} (${location.hostname})`);

      // Test 3: Tentative directe getUserMedia AVANT ZXing
      log("Demande accès caméra…");
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        log(`✅ Caméra obtenue, ${stream.getVideoTracks().length} pistes`);
        const track = stream.getVideoTracks()[0];
        if (track) log(`   Piste : ${track.label || "(sans label)"} — ${track.readyState}`);
      } catch (e) {
        log(`❌ getUserMedia échoue: ${e.name} — ${e.message}`);
        if (e.name === "NotAllowedError") setError("permission");
        else setError(`${e.name}: ${e.message}`);
        setStarting(false);
        return;
      }

      // Test 4: Attache à la balise vidéo
      if (!videoRef.current) {
        log("❌ <video> introuvable");
        stream.getTracks().forEach((t) => t.stop());
        setError("Élément vidéo manquant");
        setStarting(false);
        return;
      }
      videoRef.current.srcObject = stream;
      videoRef.current.setAttribute("playsinline", "true");
      videoRef.current.muted = true;
      log("Stream attaché à <video>");

      // Test 5: Lecture de la vidéo
      try {
        await videoRef.current.play();
        log(`✅ video.play() OK (${videoRef.current.videoWidth}x${videoRef.current.videoHeight})`);
      } catch (e) {
        log(`⚠️ video.play() : ${e.name} — ${e.message}`);
      }

      // À ce stade, si on voit la caméra c'est gagné. Maintenant ZXing.
      log("Initialisation de ZXing (intégré, hors-ligne)…");
      let ZX;
      try {
        ZX = await loadZXing();
        log("✅ ZXing prêt");
      } catch (e) {
        log(`❌ ZXing échoue: ${e.message}`);
        setError(`ZXing: ${e.message}`);
        setStarting(false);
        return;
      }

      // Test 6: Démarrer ZXing sur la vidéo déjà active
      try {
        const reader = createConfiguredReader();
        const controls = reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) {
            const code = result.getText();
            // Accepte tout EAN-13, EAN-12 (UPC-A), EAN-11 ou ISBN-10
            if (!/^\d{10,13}$/.test(code)) return;
            if (fired.current) return;
            fired.current = true;
            try { controls.stop(); } catch (e) {}
            try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
            onScan(code);
          }
        });
        readerRef.current = { stop: () => {
          try { controls.stop(); } catch (e) {}
          try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
        }};
        log("✅ ZXing en écoute");
        setScanning(true);
      } catch (e) {
        log(`❌ ZXing decodeFromVideoElement: ${e.message}`);
        setError(`Décodage: ${e.message}`);
      }
    } catch (e) {
      log(`❌ Erreur globale: ${e.message}`);
      setError(e?.message || "camera");
    }
    setStarting(false);
  };

  // Stop à la sortie
  useEffect(() => {
    return () => {
      if (readerRef.current) {
        try { readerRef.current.stop(); } catch (err) { /* ignore */ }
      }
    };
  }, []);

  if (error === "not-supported") {
    return (
      <div className="text-center pt-8">
        <p style={{ color: "var(--ink)", marginBottom: "1rem" }}>
          Le scan automatique n'est pas pris en charge par votre navigateur. Saisissez l'ISBN à la main (au dos du livre, 13 chiffres) :
        </p>
        <input
          type="tel"
          value={manualISBN}
          onChange={(e) => setManualISBN(e.target.value.replace(/\D/g, ""))}
          placeholder="978…"
          maxLength={13}
          className="w-full p-3 rounded-xl border-2 outline-none mb-3"
          style={{ borderColor: "var(--parchment)" }}
        />
        <button
          onClick={() => manualISBN.length >= 10 && onScan(manualISBN)}
          disabled={manualISBN.length < 10 || searching}
          className="w-full py-3 rounded-xl font-medium disabled:opacity-50"
          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
        >
          {searching ? "Recherche…" : "Rechercher ce livre"}
        </button>
      </div>
    );
  }

  if (error === "permission") {
    return (
      <div className="text-center pt-8 px-4">
        <p style={{ color: "var(--accent)", fontWeight: "600", marginBottom: "0.5rem" }}>
          Accès à la caméra refusé
        </p>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.875rem", marginBottom: "1rem" }}>
          Allez dans Réglages iOS → Safari → Caméra pour autoriser l'accès, puis fermez et rouvrez l'app.
        </p>
        <button
          onClick={handleStart}
          className="px-4 py-2 rounded-lg font-medium"
          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          autoPlay
          webkit-playsinline="true"
        />

        {/* Overlay tant que la caméra n'est pas démarrée */}
        {!scanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
            style={{ background: "rgba(74, 35, 10, 0.92)" }}>
            <Camera className="w-12 h-12 mb-3" style={{ color: "var(--gold-light)" }} />
            <p className="mb-4" style={{ color: "var(--cream)" }}>
              Touchez pour démarrer la caméra et scanner le code-barres
            </p>
            <button
              onClick={handleStart}
              disabled={starting}
              className="px-6 py-3 rounded-full font-medium disabled:opacity-50 flex items-center gap-2"
              style={{ background: "var(--gold-light)", color: "var(--leather-dark)" }}
            >
              {starting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Démarrage…</>
              ) : (
                <><Camera className="w-5 h-5" /> Démarrer la caméra</>
              )}
            </button>
            {error && error !== "permission" && error !== "not-supported" && (
              <p className="text-xs mt-3" style={{ color: "var(--gold-light)" }}>
                Erreur : {error}
              </p>
            )}
          </div>
        )}

        {/* Cadre de scan */}
        {scanning && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-4/5 h-1/3 border-2 rounded-lg" style={{ borderColor: "var(--gold-light)" }}>
              <div className="absolute left-0 right-0 h-0.5 scan-line" style={{ background: "var(--gold-light)" }} />
            </div>
          </div>
        )}
        {searching && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" style={{ color: "var(--gold-light)" }} />
              <p style={{ color: "var(--cream)" }}>Recherche du livre…</p>
            </div>
          </div>
        )}
      </div>
      <p className="text-center mt-4 text-sm" style={{ color: "var(--ink-soft)" }}>
        {scanning ? "Pointez la caméra vers le code-barres au dos du livre" : "Touchez le bouton pour démarrer"}
      </p>

      {/* Panneau de diagnostic — visible si erreur ou tant que ça démarre */}
      {diagLogs.length > 0 && (
        <div className="mt-4 p-3 rounded-lg" style={{ background: "#1a1a1a", color: "#9fdc9f" }}>
          <div className="text-xs mb-2 font-bold" style={{ color: "#fff" }}>Diagnostic :</div>
          <div className="text-xs font-mono space-y-1" style={{ fontSize: "0.7rem", lineHeight: 1.4 }}>
            {diagLogs.map((line, i) => (
              <div key={i} style={{ wordBreak: "break-word" }}>{line}</div>
            ))}
          </div>
          <button
            onClick={() => {
              const text = diagLogs.join("\n");
              if (navigator.clipboard) navigator.clipboard.writeText(text);
            }}
            className="mt-2 px-2 py-1 rounded text-xs"
            style={{ background: "#444", color: "#fff" }}
          >
            Copier les logs
          </button>
        </div>
      )}
    </div>
  );
}

// === SCANNER COUVERTURE ===
function CoverScanner({ onCancel, onCapture }) {
  const fileRef = useRef(null);
  // Image brute juste prise/importée, en attente de recadrage.
  const [rawImg, setRawImg] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    // On garde l'image pleine résolution pour la passer au recadreur ;
    // la compression a lieu APRÈS le recadrage.
    reader.onload = (ev) => setRawImg(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Étape de recadrage dès qu'une photo est disponible.
  if (rawImg) {
    return (
      <ImageCropper
        src={rawImg}
        onCancel={() => setRawImg(null)}
        onCrop={(dataUrl) => { setRawImg(null); onCapture(dataUrl); }}
      />
    );
  }

  return (
    <div className="text-center pt-4">
      <div className="w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-4"
        style={{ background: "var(--parchment)" }}>
        <Camera className="w-10 h-10" style={{ color: "var(--leather)" }} />
      </div>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", color: "var(--ink)", marginBottom: "0.5rem" }}>
        Photo de la couverture
      </h3>
      <p className="text-sm mb-6" style={{ color: "var(--ink-soft)" }}>
        Prenez la couverture en photo, vous compléterez les informations ensuite.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2"
        style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
      >
        <Camera className="w-5 h-5" /> Ouvrir l'appareil photo
      </button>
    </div>
  );
}

// === RECADRAGE D'IMAGE (rectangle libre) ===
// Modale plein écran : l'image est affichée à l'échelle, avec un rectangle de
// sélection déplaçable (glisser le centre) et redimensionnable par 8 poignées
// (4 coins + 4 bords). Les poignées de bord haut/bas servent précisément à
// rogner le haut et le bas d'une photo portrait pour en faire une jaquette.
// Tout est piloté en pointer events → fonctionne au doigt sur iPhone.
// À la validation, on découpe à la résolution native de l'image puis on
// recompresse via compressImageDataUrl (même pipeline que le reste de l'appli).
function ImageCropper({ src, onCancel, onCrop }) {
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState(null); // en px de l'image AFFICHÉE
  const [busy, setBusy] = useState(false);
  const MIN = 30;

  const initRect = () => {
    const el = imgRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setDisp({ w, h });
    // Sélection de départ : pleine largeur, 70 % de hauteur centrée
    // (invite naturellement à rogner le haut et le bas).
    const ch = Math.round(h * 0.7);
    setRect({ x: 0, y: Math.round((h - ch) / 2), w, h: ch });
  };

  // ⚠️ Correctif « couverture déjà présente » : une image en cache est souvent
  // déjà `complete` au montage, donc l'événement onLoad ne se déclenche jamais
  // et le cadre de recadrage n'était jamais initialisé (→ « Valider » sans
  // effet, on ne pouvait qu'annuler). On initialise donc aussi au montage si
  // l'image est déjà chargée. Un petit rAF laisse le layout se stabiliser.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth) {
      requestAnimationFrame(() => initRect());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const onResize = () => initRect();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const clampRect = (r) => {
    let { x, y, w, h } = r;
    w = Math.max(MIN, Math.min(w, disp.w));
    h = Math.max(MIN, Math.min(h, disp.h));
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > disp.w) x = disp.w - w;
    if (y + h > disp.h) y = disp.h - h;
    return { x, y, w, h };
  };

  const startDrag = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, orig: rect };
    try { wrapRef.current?.setPointerCapture?.(e.pointerId); } catch (err) {}
  };

  const onMove = (e) => {
    if (!dragRef.current) return;
    const { mode, sx, sy, orig } = dragRef.current;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    let r = { ...orig };
    if (mode === "move") { r.x = orig.x + dx; r.y = orig.y + dy; }
    if (mode.includes("e")) r.w = orig.w + dx;
    if (mode.includes("s")) r.h = orig.h + dy;
    if (mode.includes("w")) { r.x = orig.x + dx; r.w = orig.w - dx; }
    if (mode.includes("n")) { r.y = orig.y + dy; r.h = orig.h - dy; }
    setRect(clampRect(r));
  };

  const endDrag = () => { dragRef.current = null; };

  const doCrop = async () => {
    setBusy(true);
    try {
      // Si le cadre n'a pas encore été initialisé (image très vite en cache),
      // on se rabat sur l'image entière plutôt que de ne rien faire.
      const el = imgRef.current;
      let curDisp = disp.w && disp.h ? disp : null;
      if (!curDisp && el) curDisp = { w: el.clientWidth, h: el.clientHeight };
      let curRect = rect;
      if ((!curRect || !curDisp) && el) {
        curDisp = curDisp || { w: el.clientWidth, h: el.clientHeight };
        curRect = { x: 0, y: 0, w: curDisp.w, h: curDisp.h };
      }
      if (!curRect || !curDisp) { setBusy(false); return; }

      const image = await new Promise((res, rej) => {
        const im = new Image();
        // crossOrigin pour pouvoir lire les pixels d'une couverture distante
        // servie avec CORS (openlibrary, Google, Wikimedia…). Sans effet sur
        // les data URLs (photos prises dans l'appli).
        if (/^https?:\/\//i.test(src)) im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
      });
      const scaleX = image.naturalWidth / (curDisp.w || 1);
      const scaleY = image.naturalHeight / (curDisp.h || 1);
      const sx = Math.max(0, Math.round(curRect.x * scaleX));
      const sy = Math.max(0, Math.round(curRect.y * scaleY));
      const sw = Math.round(curRect.w * scaleX);
      const sh = Math.round(curRect.h * scaleY);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      const compressed = await compressImageDataUrl(dataUrl);
      onCrop(compressed);
    } catch (err) {
      // Repli : on renvoie l'image d'origine compressée
      const compressed = await compressImageDataUrl(src);
      onCrop(compressed);
    } finally {
      setBusy(false);
    }
  };

  const handleDot = (mode, pos) => (
    <div
      onPointerDown={startDrag(mode)}
      style={{
        position: "absolute",
        width: 20,
        height: 20,
        marginLeft: -10,
        marginTop: -10,
        background: "var(--cream, #fff)",
        border: "2px solid var(--leather-dark, #5a3d2b)",
        borderRadius: 5,
        touchAction: "none",
        ...pos,
      }}
    />
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <p style={{ color: "#fff", marginBottom: 12, fontSize: "0.9rem", textAlign: "center", maxWidth: 340 }}>
        Ajuste le cadre pour rogner. Glisse les poignées du haut et du bas pour
        couper, ou le centre pour déplacer.
      </p>
      <div
        ref={wrapRef}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ position: "relative", touchAction: "none", lineHeight: 0, maxWidth: "100%", maxHeight: "68vh" }}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          onLoad={initRect}
          draggable={false}
          style={{ maxWidth: "100%", maxHeight: "68vh", display: "block", userSelect: "none" }}
        />
        {rect && (
          <>
            <div
              onPointerDown={startDrag("move")}
              style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.9)",
                cursor: "move",
                touchAction: "none",
              }}
            />
            {handleDot("nw", { left: rect.x, top: rect.y })}
            {handleDot("ne", { left: rect.x + rect.w, top: rect.y })}
            {handleDot("sw", { left: rect.x, top: rect.y + rect.h })}
            {handleDot("se", { left: rect.x + rect.w, top: rect.y + rect.h })}
            {handleDot("n", { left: rect.x + rect.w / 2, top: rect.y })}
            {handleDot("s", { left: rect.x + rect.w / 2, top: rect.y + rect.h })}
            {handleDot("w", { left: rect.x, top: rect.y + rect.h / 2 })}
            {handleDot("e", { left: rect.x + rect.w, top: rect.y + rect.h / 2 })}
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)" }}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => { const el = imgRef.current; if (el) setRect({ x: 0, y: 0, w: el.clientWidth, h: el.clientHeight }); }}
          disabled={busy}
          style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)" }}
        >
          Tout sélectionner
        </button>
        <button
          type="button"
          onClick={doCrop}
          disabled={busy}
          style={{ padding: "10px 18px", borderRadius: 10, background: "var(--leather-dark, #5a3d2b)", color: "var(--cream, #fff)", border: "1px solid var(--gold, #c9a24b)", fontWeight: 600 }}
        >
          {busy ? "…" : "Valider le recadrage"}
        </button>
      </div>
    </div>
  );
}

// === FORMULAIRE ===
const BookForm = forwardRef(function BookForm(
  { books, structure, initial, onCancel, onSubmit, submitLabel, bareMode = false, onDirtyChange },
  externalRef
) {
  // Type d'objet (livre/revue/jeu-societe/jeu-switch)
  const [type, setType] = useState(initial.type || "livre");
  const fields = FIELDS_BY_TYPE[type] || FIELDS_BY_TYPE.livre;

  // Marque "création" : si initial.id est absent, on est sur un nouveau livre.
  // Dans ce cas la position sera auto-calculée. En édition, on respecte la
  // position d'origine sauf si l'utilisateur la change manuellement.
  const isCreation = !initial.id;

  const [title, setTitle] = useState(initial.title || "");
  const [author, setAuthor] = useState(initial.author || "");
  const [isbn, setIsbn] = useState(initial.isbn || "");
  const [cover, setCover] = useState(initial.cover || "");
  // Image en cours de recadrage (import d'un fichier OU « Recadrer » sur la
  // couverture existante). Null = pas de recadrage en cours.
  const [cropSrc, setCropSrc] = useState(null);
  // Marqueur explicite : toute action sur la couverture (recadrage, import,
  // suppression) doit compter comme une modification, même si la comparaison
  // de chaînes ne « voit » pas la différence. Évite de perdre un recadrage
  // seul faute d'avoir déclenché l'état « modifié ».
  const [coverTouched, setCoverTouched] = useState(false);
  const initialBib = initial.bibliotheque || structure.bibliotheques[0]?.id || "";
  const initialEtagere = initial.etagere || "1";
  const [bibliotheque, setBibliotheque] = useState(initialBib);
  const [etagere, setEtagere] = useState(initialEtagere);
  // Position : en création, on cherche la première position libre sur la
  // bib+étagère retenues ; en édition, on garde la position du livre.
  const [position, setPosition] = useState(() => {
    if (initial.position) return String(initial.position);
    if (isCreation && books) {
      return String(findFirstFreePosition(books, initialBib, parseInt(initialEtagere) || 1));
    }
    return "1";
  });
  // Drapeau : l'utilisateur a-t-il modifié la position à la main ? Si oui on
  // arrête de la recalculer automatiquement quand bib/étagère changent.
  const positionTouchedRef = useRef(!!initial.position);
  // Recalcule la position quand bib/étagère changent en mode création, sauf
  // si l'utilisateur a déjà touché à la position manuellement.
  useEffect(() => {
    if (!isCreation || positionTouchedRef.current || !books) return;
    const free = findFirstFreePosition(books, bibliotheque, parseInt(etagere) || 1);
    setPosition(String(free));
  }, [bibliotheque, etagere, isCreation, books]);

  const [notes, setNotes] = useState(initial.notes || "");
  const [retrying, setRetrying] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState(initial._debug || null);
  // === CHAMPS ENRICHIS ===
  const [subtitle, setSubtitle] = useState(initial.subtitle || "");
  const [pages, setPages] = useState(initial.pages || "");
  const [language, setLanguage] = useState(initial.language || "");
  const [description, setDescription] = useState(initial.description || "");
  const [categories, setCategories] = useState(initial.categories || "");
  const [genre, setGenre] = useState(initial.genre || []);
  const [rating, setRating] = useState(initial.rating || 0);
  const [ratingsCount, setRatingsCount] = useState(initial.ratingsCount || 0);
  const [infoLink, setInfoLink] = useState(initial.infoLink || "");
  const [format, setFormat] = useState(initial.format || "");
  const [dimensions, setDimensions] = useState(initial.dimensions || "");
  const [weight, setWeight] = useState(initial.weight || "");
  const [publisher, setPublisher] = useState(initial.publisher || "");
  const [year, setYear] = useState(initial.year || "");
  // === CHAMPS SPÉCIFIQUES ===
  const [issueNumber, setIssueNumber] = useState(initial.issueNumber || "");
  const [issueDate, setIssueDate] = useState(initial.issueDate || "");
  const [playersMin, setPlayersMin] = useState(initial.playersMin || "");
  const [playersMax, setPlayersMax] = useState(initial.playersMax || "");
  const [durationMin, setDurationMin] = useState(initial.durationMin || "");
  const [ageMin, setAgeMin] = useState(initial.ageMin || "");
  const [platform, setPlatform] = useState(initial.platform || (type === "jeu-switch" ? "Nintendo Switch" : ""));
  const [showMore, setShowMore] = useState(false);

  const handleCoverUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    // On ouvre le recadreur avec l'image pleine résolution ; la compression
    // se fait à la validation du recadrage.
    reader.onload = (ev) => setCropSrc(ev.target.result);
    reader.readAsDataURL(file);
    // Permet de re-sélectionner le même fichier plus tard.
    e.target.value = "";
  };

  const handleRetryLookup = async () => {
    if (!isbn.trim()) return;
    setRetrying(true);
    try {
      const found = await lookupISBN(isbn.trim());
      setDebugInfo(found?.debug || null);
      // Ne remplace que si vide localement
      if (found?.title && !title) setTitle(found.title);
      if (found?.author && !author) setAuthor(found.author);
      if (found?.cover && !cover) setCover(found.cover);
      if (found?.subtitle && !subtitle) setSubtitle(found.subtitle);
      if (found?.pages && !pages) setPages(found.pages);
      if (found?.language && !language) setLanguage(found.language);
      if (found?.description && !description) setDescription(found.description);
      if (found?.categories && !categories) setCategories(found.categories);
      if (found?.rating && !rating) setRating(found.rating);
      if (found?.ratingsCount && !ratingsCount) setRatingsCount(found.ratingsCount);
      if (found?.infoLink && !infoLink) setInfoLink(found.infoLink);
      if (found?.format && !format) setFormat(found.format);
      if (found?.dimensions && !dimensions) setDimensions(found.dimensions);
      if (found?.weight && !weight) setWeight(found.weight);
      if (found?.publisher && !publisher) setPublisher(found.publisher);
      if (found?.year && !year) setYear(found.year);
    } catch (e) { /* ignore */ }
    setRetrying(false);
  };

  const submit = () => {
    if (!title.trim()) return;
    onSubmit({
      type,
      title: title.trim(),
      author: author.trim(),
      isbn: isbn.trim(),
      cover,
      bibliotheque,
      etagere: parseInt(etagere) || 1,
      position: parseInt(position) || 1,
      notes: notes.trim(),
      // Champs enrichis (préservés)
      subtitle: subtitle.trim(),
      pages: parseInt(pages) || 0,
      language: language.trim(),
      description: description.trim(),
      categories: categories.trim(),
      rating: parseFloat(rating) || 0,
      ratingsCount: parseInt(ratingsCount) || 0,
      infoLink: infoLink.trim(),
      format: format.trim(),
      dimensions: dimensions.trim(),
      weight: weight.trim(),
      publisher: publisher.trim(),
      year: year.trim(),
      // Champs spécifiques aux nouveaux types
      issueNumber: issueNumber.trim(),
      issueDate: issueDate.trim(),
      playersMin: parseInt(playersMin) || 0,
      playersMax: parseInt(playersMax) || 0,
      durationMin: parseInt(durationMin) || 0,
      ageMin: parseInt(ageMin) || 0,
      platform: platform.trim(),
      genre: genre,
    });
  };

  // === DETECTION DES MODIFICATIONS ===
  // On compare l'état courant aux valeurs initiales pour savoir si quelque
  // chose a changé. Permet à EditView de demander une confirmation avant
  // de quitter (bouton retour, précédent, suivant) sans avoir enregistré.
  const isDirty = (
    coverTouched ||
    type !== (initial.type || "livre") ||
    title !== (initial.title || "") ||
    author !== (initial.author || "") ||
    isbn !== (initial.isbn || "") ||
    cover !== (initial.cover || "") ||
    bibliotheque !== (initial.bibliotheque || structure.bibliotheques[0]?.id || "") ||
    String(etagere) !== String(initial.etagere || "1") ||
    String(position) !== String(initial.position || "") ||
    notes !== (initial.notes || "") ||
    subtitle !== (initial.subtitle || "") ||
    String(pages) !== String(initial.pages || "") ||
    language !== (initial.language || "") ||
    description !== (initial.description || "") ||
    categories !== (initial.categories || "") ||
    parseFloat(rating || 0) !== parseFloat(initial.rating || 0) ||
    publisher !== (initial.publisher || "") ||
    year !== (initial.year || "") ||
    issueNumber !== (initial.issueNumber || "") ||
    issueDate !== (initial.issueDate || "") ||
    String(playersMin) !== String(initial.playersMin || "") ||
    String(playersMax) !== String(initial.playersMax || "") ||
    String(durationMin) !== String(initial.durationMin || "") ||
    String(ageMin) !== String(initial.ageMin || "") ||
    platform !== (initial.platform || "")
  );

  useEffect(() => {
    if (typeof onDirtyChange === "function") onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Expose submit() et isDirty au parent (utilisé par EditView pour piloter
  // le bouton "Enregistrer" placé en haut, et la modale de confirmation).
  useImperativeHandle(externalRef, () => ({
    submit,
    isDirty: () => isDirty,
    canSubmit: () => !!title.trim(),
  }), [submit, isDirty, title]);

  return (
    <div className="space-y-4">
      {/* Recadrage (import d'un fichier ou « Recadrer » sur la couverture). */}
      {cropSrc && (
        <ImageCropper
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onCrop={(dataUrl) => { setCover(dataUrl); setCoverTouched(true); setCropSrc(null); }}
        />
      )}
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)" }}>
        Informations du livre
      </h2>

      {/* Couverture — agrandie en mode édition pour faciliter la vérification visuelle */}
      <div className="flex gap-3 items-start">
        <SmartCover
          src={cover}
          alt=""
          adaptFrame
          frameClass="w-32 h-44 rounded-lg flex-shrink-0 shadow-md"
          landscapeFrameClass="w-52 h-36 rounded-lg flex-shrink-0 shadow-md"
          frameStyle={{ background: "var(--parchment)" }}
          fallback={<BookOpen className="w-10 h-10" style={{ color: "var(--leather)" }} />}
        />
        <div className="flex-1 space-y-1.5">
          <label className="block py-2 px-3 rounded-lg border-2 text-sm text-center cursor-pointer"
            style={{ borderColor: "var(--parchment)", color: "var(--leather)" }}>
            <Camera className="w-4 h-4 inline mr-1" /> {cover ? "Changer la couverture" : "Ajouter une photo"}
            <input type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
          </label>
          {cover && (
            <button
              type="button"
              onClick={() => setCropSrc(cover)}
              className="w-full py-2 px-3 rounded-lg border-2 text-xs text-center"
              style={{ borderColor: "var(--gold)", color: "var(--leather-dark)" }}
            >
              <Edit2 className="w-3.5 h-3.5 inline mr-1" /> Recadrer la couverture
            </button>
          )}
          {cover && (
            <button
              type="button"
              onClick={() => { setCover(""); setCoverTouched(true); }}
              className="w-full py-2 px-3 rounded-lg border-2 text-xs text-center"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Supprimer la couverture
            </button>
          )}
          {(title || isbn) && (
            <a
              href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
                title ? `${title} ${author || ""} couverture livre` : `ISBN ${isbn} couverture`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block py-2 px-3 rounded-lg text-xs text-center"
              style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
            >
              <Search className="w-3.5 h-3.5 inline mr-1" /> Chercher l'image sur Google
            </a>
          )}
        </div>
      </div>

      {/* Aide quand le titre n'a pas été trouvé automatiquement */}
      {isbn && !title && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--parchment)" }}>
          <p className="text-sm" style={{ color: "var(--ink)" }}>
            Livre non trouvé automatiquement pour l'ISBN <strong>{isbn}</strong>.
          </p>
          <div className="flex gap-2 flex-wrap">
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(isbn)}+livre`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5"
              style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
            >
              <Search className="w-4 h-4" /> Chercher sur Google
            </a>
            <button
              onClick={handleRetryLookup}
              disabled={retrying}
              className="px-3 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "var(--leather)", color: "var(--cream)" }}
            >
              {retrying ? <><Loader2 className="w-4 h-4 animate-spin" /> Recherche…</> : <><RotateCcw className="w-4 h-4" /> Réessayer</>}
            </button>
            {debugInfo && (
              <button
                onClick={() => setShowDebug((v) => !v)}
                className="px-3 py-2 rounded-lg text-sm font-medium border"
                style={{ borderColor: "var(--leather)", color: "var(--leather-dark)" }}
              >
                {showDebug ? "Masquer détails" : "Détails sources"}
              </button>
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            Conseil : copiez le titre/auteur de la fiche Google et collez-les dans les champs ci-dessous.
          </p>
          {showDebug && debugInfo && (
            <div className="text-xs font-mono p-2 rounded" style={{ background: "#1a1a1a", color: "#9fdc9f" }}>
              <div>Google Books: {debugInfo.google}</div>
              <div>Open Library: {debugInfo.openLibrary}</div>
              <div>BnF: {debugInfo.bnf}</div>
              <div>Couverture (toutes sources): {debugInfo.coverFallback}</div>
            </div>
          )}
        </div>
      )}

      {/* Sélecteur de type — modifiable à tout moment */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
          Type d'objet
        </label>
        <div className="grid grid-cols-2 gap-2">
          {ITEM_TYPES_LIST.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setType(t.id);
                // Pré-remplit la plateforme pour les jeux Switch
                if (t.id === "jeu-switch" && !platform) setPlatform("Nintendo Switch");
              }}
              className="p-2 rounded-lg border-2 flex items-center gap-2 text-left transition-all"
              style={{
                background: type === t.id ? t.color : "white",
                borderColor: type === t.id ? t.color : "var(--parchment)",
                color: type === t.id ? "var(--cream)" : "var(--ink)",
              }}
            >
              <span style={{ fontSize: "1.1rem" }}>{t.emoji}</span>
              <span className="text-xs font-medium leading-tight">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <Field label={`${fields.titleLabel} *`}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            type === "revue" ? "Pomme d'Api, Historia…" :
            type === "jeu-societe" ? "Cluedo, Catan…" :
            type === "jeu-switch" ? "Mario Kart 8, Zelda…" :
            "Le titre du livre"
          }
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>

      {/* Sous-titre — uniquement pour livres */}
      {fields.showSubtitle && type === "livre" && subtitle && (
        <Field label="Sous-titre">
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            className="w-full p-3 rounded-lg border-2 outline-none"
            style={{ borderColor: "var(--parchment)" }}
          />
        </Field>
      )}

      {/* Numéro et date — uniquement pour les revues */}
      {fields.showIssue && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="N° du numéro">
            <input
              value={issueNumber}
              onChange={(e) => setIssueNumber(e.target.value)}
              placeholder="ex: 920"
              className="w-full p-3 rounded-lg border-2 outline-none"
              style={{ borderColor: "var(--parchment)" }}
            />
          </Field>
          <Field label="Date">
            <input
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              placeholder="Janvier 2024"
              className="w-full p-3 rounded-lg border-2 outline-none"
              style={{ borderColor: "var(--parchment)" }}
            />
          </Field>
        </div>
      )}

      {/* Auteur — uniquement pour livres */}
      {fields.showAuthor && (
        <Field label="Auteur">
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Prénom Nom"
            className="w-full p-3 rounded-lg border-2 outline-none"
            style={{ borderColor: "var(--parchment)" }}
          />
        </Field>
      )}

      {/* Plateforme — uniquement pour jeux Switch */}
      {fields.showPlatform && (
        <Field label="Plateforme">
          <input
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder="Nintendo Switch"
            className="w-full p-3 rounded-lg border-2 outline-none"
            style={{ borderColor: "var(--parchment)" }}
          />
        </Field>
      )}

      {/* Infos jeu — joueurs / durée / âge */}
      {fields.showGameInfo && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Joueurs min">
              <input
                type="number"
                value={playersMin}
                onChange={(e) => setPlayersMin(e.target.value)}
                placeholder="2"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
            <Field label="Joueurs max">
              <input
                type="number"
                value={playersMax}
                onChange={(e) => setPlayersMax(e.target.value)}
                placeholder="6"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Durée (min)">
              <input
                type="number"
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                placeholder="45"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
            <Field label="Âge minimum">
              <input
                type="number"
                value={ageMin}
                onChange={(e) => setAgeMin(e.target.value)}
                placeholder="8"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
          </div>
        </>
      )}

      {/* ISBN — uniquement pour les livres */}
      {fields.showIsbn && (
        <Field label="ISBN">
          <input
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            placeholder="978…"
            className="w-full p-3 rounded-lg border-2 outline-none"
            style={{ borderColor: "var(--parchment)" }}
          />
        </Field>
      )}

      {/* Code-barres — pour les autres types, on garde quand même un champ ISBN/EAN */}
      {!fields.showIsbn && isbn && (
        <Field label="Code-barres">
          <input
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            placeholder="EAN-13"
            className="w-full p-3 rounded-lg border-2 outline-none"
            style={{ borderColor: "var(--parchment)" }}
          />
        </Field>
      )}

      <div className="pt-2 pb-1">
        <h3 className="font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--leather-dark)" }}>
          <MapPin className="w-4 h-4" /> Emplacement
        </h3>
      </div>

      <Field label="Bibliothèque">
        <select
          value={bibliotheque}
          onChange={(e) => setBibliotheque(e.target.value)}
          className="w-full p-3 rounded-lg border-2 outline-none bg-white"
          style={{ borderColor: "var(--parchment)" }}
        >
          {structure.pieces.map((piece) => {
            const bibs = structure.bibliotheques.filter((b) => b.pieceId === piece.id);
            if (bibs.length === 0) return null;
            return (
              <optgroup key={piece.id} label={piece.nom}>
                {bibs.map((b) => (
                  <option key={b.id} value={b.id}>{b.nom}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Étagère (haut → bas)">
          <input
            type="number"
            min="1"
            value={etagere}
            onChange={(e) => setEtagere(e.target.value)}
            className="w-full p-3 rounded-lg border-2 outline-none"
            style={{ borderColor: "var(--parchment)" }}
          />
        </Field>
        <Field label="Position (gauche → droite)">
          <input
            type="number"
            min="1"
            value={position}
            onChange={(e) => {
              positionTouchedRef.current = true;
              setPosition(e.target.value);
            }}
            className="w-full p-3 rounded-lg border-2 outline-none"
            style={{ borderColor: "var(--parchment)" }}
          />
        </Field>
      </div>

      {/* === SECTION DÉTAILS DÉPLIABLE === */}
      <div className="border-t pt-3" style={{ borderColor: "var(--parchment)" }}>
        <button
          type="button"
          onClick={() => setShowMore(!showMore)}
          className="flex items-center justify-between w-full text-left"
          style={{ color: "var(--leather-dark)" }}
        >
          <span className="font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
            <BookOpen className="w-4 h-4" /> Détails
          </span>
          <ChevronRight className={`w-5 h-5 transition-transform ${showMore ? "rotate-90" : ""}`} />
        </button>
      </div>

      {showMore && (
        <div className="space-y-3 pl-1">
          {/* Sous-titre — uniquement livres */}
          {fields.showSubtitle && (
            <Field label="Sous-titre">
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Le sous-titre"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
          )}

          {/* Pages + Langue (livres) */}
          {(fields.showPages || fields.showLanguage) && (
            <div className="grid grid-cols-2 gap-3">
              {fields.showPages && (
                <Field label="Pages">
                  <input
                    type="number"
                    value={pages}
                    onChange={(e) => setPages(e.target.value)}
                    placeholder="320"
                    className="w-full p-3 rounded-lg border-2 outline-none"
                    style={{ borderColor: "var(--parchment)" }}
                  />
                </Field>
              )}
              {fields.showLanguage && (
                <Field label="Langue">
                  <input
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    placeholder="Français"
                    className="w-full p-3 rounded-lg border-2 outline-none"
                    style={{ borderColor: "var(--parchment)" }}
                  />
                </Field>
              )}
            </div>
          )}

          {/* Éditeur + Année */}
          {(fields.showPublisher || fields.showYear) && (
            <div className="grid grid-cols-2 gap-3">
              {fields.showPublisher && (
                <Field label={type === "revue" ? "Éditeur" : type === "jeu-societe" || type === "jeu-switch" ? "Éditeur du jeu" : "Éditeur"}>
                  <input
                    value={publisher}
                    onChange={(e) => setPublisher(e.target.value)}
                    placeholder={
                      type === "revue" ? "Bayard, Milan…" :
                      type === "jeu-societe" ? "Asmodée, Hasbro…" :
                      type === "jeu-switch" ? "Nintendo, EA…" :
                      "Gallimard…"
                    }
                    className="w-full p-3 rounded-lg border-2 outline-none"
                    style={{ borderColor: "var(--parchment)" }}
                  />
                </Field>
              )}
              {fields.showYear && (
                <Field label="Année">
                  <input
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="2020"
                    className="w-full p-3 rounded-lg border-2 outline-none"
                    style={{ borderColor: "var(--parchment)" }}
                  />
                </Field>
              )}
            </div>
          )}

          {/* Format / Dimensions / Poids — livres uniquement */}
          {fields.showFormat && (
            <Field label="Format">
              <input
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                placeholder="Broché, Poche, Relié…"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
          )}

          {fields.showDimensions && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Dimensions">
                <input
                  value={dimensions}
                  onChange={(e) => setDimensions(e.target.value)}
                  placeholder="20 x 13 cm"
                  className="w-full p-3 rounded-lg border-2 outline-none"
                  style={{ borderColor: "var(--parchment)" }}
                />
              </Field>
              <Field label="Poids">
                <input
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="350 g"
                  className="w-full p-3 rounded-lg border-2 outline-none"
                  style={{ borderColor: "var(--parchment)" }}
                />
              </Field>
            </div>
          )}

          {/* Catégorie / Genre */}
          {fields.showCategories && (
            <Field label={type === "jeu-societe" || type === "jeu-switch" ? "Genre" : "Catégorie / Genre"}>
              <input
                value={categories}
                onChange={(e) => setCategories(e.target.value)}
                placeholder={
                  type === "jeu-societe" ? "Stratégie, Famille, Réflexion…" :
                  type === "jeu-switch" ? "Aventure, Course, Sport…" :
                  "Roman, Science-fiction…"
                }
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
          )}

          {/* Genres bibliothèque virtuelle */}
          <Field label="📚 Bibliothèque virtuelle">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
              {genre.length > 0 ? genre.map((g, i) => {
                const colors = GENRE_COLORS[g] || { bg: "#6b3410", text: "#f4ecd8" };
                const label = g.includes("/") ? g.split("/")[1] : g;
                return (
                  <span key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: "4px",
                    padding: "3px 8px", borderRadius: "12px", fontSize: "11px",
                    fontWeight: "600", background: colors.bg, color: colors.text,
                  }}>
                    {label}
                    <button
                      onClick={() => setGenre(genre.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer",
                        color: colors.text, fontSize: "13px", padding: "0", lineHeight: 1 }}
                    >×</button>
                  </span>
                );
              }) : (
                <span style={{ fontSize: "12px", color: "var(--ink-soft)", fontStyle: "italic" }}>Aucune catégorie</span>
              )}
            </div>
            <select
              value=""
              onChange={e => {
                const val = e.target.value;
                if (val && !genre.includes(val)) setGenre([...genre, val]);
                e.target.value = "";
              }}
              style={{
                width: "100%", padding: "10px", borderRadius: "8px",
                border: "2px solid var(--parchment)", background: "white",
                color: "var(--ink)", fontSize: "13px",
              }}
            >
              <option value="">+ Ajouter une catégorie…</option>
              {Object.keys(GENRE_COLORS).filter(g => !genre.includes(g) && g !== "À classer").map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </Field>

          {/* Résumé */}
          {fields.showDescription && (
            <Field label={type === "revue" ? "Dossier / Sujet du n°" : type === "jeu-societe" || type === "jeu-switch" ? "Description" : "Résumé"}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  type === "revue" ? "Le sujet du dossier principal de ce numéro…" :
                  type === "jeu-societe" || type === "jeu-switch" ? "Le pitch du jeu…" :
                  "Quelques mots sur le contenu…"
                }
                rows={4}
                className="w-full p-3 rounded-lg border-2 outline-none resize-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
          )}

          {fields.showRating && (rating > 0 || ratingsCount > 0) && (
            <div className="rounded-lg p-3" style={{ background: "var(--parchment)" }}>
              <div className="text-sm flex items-center justify-between" style={{ color: "var(--ink)" }}>
                <span>Note</span>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>
                  ⭐ {rating?.toFixed(1)} / 5 {ratingsCount > 0 && `(${ratingsCount} avis)`}
                </span>
              </div>
            </div>
          )}

          {infoLink && (
            <a
              href={infoLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block py-2 px-3 rounded-lg text-sm text-center"
              style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
            >
              📖 Voir la fiche complète en ligne
            </a>
          )}
        </div>
      )}

      <Field label="Notes (optionnel)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Édition, état, prêté à…"
          rows={3}
          className="w-full p-3 rounded-lg border-2 outline-none resize-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>

      {!bareMode && (
        <button
          onClick={submit}
          disabled={!title.trim()}
          className="w-full py-3 rounded-xl font-medium disabled:opacity-50 mt-4"
          style={{
            background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
            color: "var(--cream)",
          }}
        >
          {submitLabel}
        </button>
      )}
    </div>
  );
});

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium mb-1 block" style={{ color: "var(--ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}

// === DETAIL ===
function DetailView({ book, structure, navigationIds, allBooks, onBack, onEdit, onDelete, onSelectBook }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bib = structure.bibliotheques.find((b) => b.id === book.bibliotheque);
  const piece = bib ? structure.pieces.find((p) => p.id === bib.pieceId) : null;
  const itemType = ITEM_TYPES[book.type || "livre"];

  // === NAVIGATION PRÉCÉDENT / SUIVANT ===
  // navigationIds = liste des IDs figée au moment d'ouvrir la première fiche
  // de cette session de navigation. Stable même si le filtre change ou si on
  // modifie le livre courant. allBooks sert juste à retrouver l'objet à partir
  // de son ID quand on saute à côté.
  const currentIndex = navigationIds ? navigationIds.indexOf(book.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < (navigationIds?.length || 0) - 1;
  const goPrev = () => {
    if (!hasPrev) return;
    const target = allBooks.find((b) => b.id === navigationIds[currentIndex - 1]);
    if (target) onSelectBook(target);
  };
  const goNext = () => {
    if (!hasNext) return;
    const target = allBooks.find((b) => b.id === navigationIds[currentIndex + 1]);
    if (target) onSelectBook(target);
  };

  return (
    <div>
      {/* Barre du haut sur deux niveaux : Retour à gauche, puis Préc/Modifier/Suiv
          centrés sous une ligne propre, pour ne pas comprimer sur mobile. */}
      <div className="mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 mb-3"
          style={{ color: "var(--leather)" }}
        >
          <ChevronRight className="w-5 h-5 rotate-180" /> Retour
        </button>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={goPrev}
            disabled={!hasPrev}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1 text-sm disabled:opacity-30"
            style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
            aria-label="Livre précédent"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            <span>Préc.</span>
          </button>
          <button
            onClick={onEdit}
            className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-1 text-sm"
            style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
          >
            <Edit2 className="w-4 h-4" /> Modifier
          </button>
          <button
            onClick={goNext}
            disabled={!hasNext}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1 text-sm disabled:opacity-30"
            style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
            aria-label="Livre suivant"
          >
            <span>Suiv.</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="text-center mb-6">
        <SmartCover
          src={book.cover}
          alt={book.title}
          adaptFrame
          frameClass="inline-flex w-40 h-56 rounded-lg shadow-lg mb-4"
          landscapeFrameClass="inline-flex w-64 h-44 rounded-lg shadow-lg mb-4"
          frameStyle={{ background: "var(--parchment)" }}
          fallback={<span style={{ fontSize: "3rem" }}>{itemType?.emoji || "📖"}</span>}
        />

        {/* Badge type pour les non-livres */}
        {book.type && book.type !== "livre" && (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs mb-2"
            style={{ background: itemType?.color || "var(--leather)", color: "var(--cream)" }}>
            <span>{itemType?.emoji}</span>
            <span>{itemType?.label}</span>
          </div>
        )}

        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)", lineHeight: 1.2 }}>
          {book.title}
        </h2>

        {/* N° et date pour les revues */}
        {book.type === "revue" && (book.issueNumber || book.issueDate) && (
          <p className="text-sm mt-1" style={{ color: "var(--leather-dark)", fontWeight: 600 }}>
            {book.issueNumber && `N° ${book.issueNumber}`}
            {book.issueNumber && book.issueDate && " — "}
            {book.issueDate}
          </p>
        )}

        {book.subtitle && (
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            {book.subtitle}
          </p>
        )}
        {book.author && (
          <p className="text-base mt-1 italic" style={{ color: "var(--ink-soft)" }}>
            {book.author}
          </p>
        )}
        {book.rating > 0 && (
          <div className="text-sm mt-2 inline-flex items-center gap-1 px-3 py-1 rounded-full"
            style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}>
            ⭐ {book.rating.toFixed(1)} / 5
            {book.ratingsCount > 0 && <span style={{ opacity: 0.7 }}>({book.ratingsCount} avis)</span>}
          </div>
        )}
        {book.categories && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {book.categories.split(/[,/]/).map((c, i) => c.trim() && (
              <span key={i} className="px-2 py-0.5 rounded-full text-xs" style={{ background: "var(--parchment)", color: "var(--ink-soft)" }}>
                {c.trim()}
              </span>
            ))}
          </div>
        )}
        {/* Genres bibliothèque virtuelle */}
        {book.genre && book.genre.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {book.genre.map((g, i) => {
              const colors = GENRE_COLORS[g] || { bg: "#6b3410", text: "#f4ecd8" };
              const label = g.includes("/") ? g.split("/")[1] : g;
              return (
                <span key={i} style={{
                  padding: "2px 10px", borderRadius: "12px", fontSize: "11px",
                  fontWeight: "600", background: colors.bg, color: colors.text,
                }}>
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Infos jeu (joueurs, durée, âge) */}
      {(book.type === "jeu-societe" || book.type === "jeu-switch") &&
        (book.playersMin || book.playersMax || book.durationMin || book.ageMin || book.platform) && (
        <div className="rounded-xl p-4 mb-4 grid grid-cols-2 gap-3 text-sm" style={{ background: "white", border: "1px solid var(--parchment)" }}>
          {(book.playersMin > 0 || book.playersMax > 0) && (
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>Joueurs</div>
              <div className="font-semibold" style={{ color: "var(--ink)" }}>
                {book.playersMin > 0 && book.playersMax > 0 && book.playersMin !== book.playersMax
                  ? `${book.playersMin} – ${book.playersMax}`
                  : (book.playersMax || book.playersMin)}
              </div>
            </div>
          )}
          {book.durationMin > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>Durée</div>
              <div className="font-semibold" style={{ color: "var(--ink)" }}>{book.durationMin} min</div>
            </div>
          )}
          {book.ageMin > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>Dès</div>
              <div className="font-semibold" style={{ color: "var(--ink)" }}>{book.ageMin} ans</div>
            </div>
          )}
          {book.platform && (
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>Plateforme</div>
              <div className="font-semibold" style={{ color: "var(--ink)" }}>{book.platform}</div>
            </div>
          )}
        </div>
      )}

      {/* Résumé */}
      {book.description && (
        <div className="rounded-xl p-4 mb-4" style={{ background: "white", border: "1px solid var(--parchment)" }}>
          <h3 className="text-sm font-bold mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--leather-dark)" }}>
            Résumé
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "var(--ink)", whiteSpace: "pre-wrap" }}>
            {book.description}
          </p>
        </div>
      )}

      {/* Emplacement */}
      <div className="space-y-3 p-4 rounded-xl mb-4" style={{ background: "white", border: "1px solid var(--parchment)" }}>
        <h3 className="text-sm font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--leather-dark)" }}>
          Emplacement
        </h3>
        <DetailRow label="Bibliothèque" value={bib?.nom} />
        <DetailRow label="Pièce" value={piece?.nom} />
        <DetailRow label="Étagère" value={book.etagere} suffix=" (du haut)" />
        <DetailRow label="Position" value={book.position} suffix=" (depuis la gauche)" />
      </div>

      {/* Détails bibliographiques — adaptés au type */}
      {(() => {
        const isLivre = !book.type || book.type === "livre";
        const showPages = isLivre && book.pages > 0;
        const showLanguage = isLivre && book.language;
        const showFormat = isLivre && book.format;
        const showDimensions = isLivre && (book.dimensions || book.weight);
        const showIsbn = isLivre && book.isbn;
        const showCodebar = !isLivre && book.isbn;
        const hasAnything = showPages || showLanguage || showFormat || showDimensions || showIsbn || showCodebar || book.publisher || book.year;
        if (!hasAnything) return null;
        return (
          <div className="space-y-3 p-4 rounded-xl mb-4" style={{ background: "white", border: "1px solid var(--parchment)" }}>
            <h3 className="text-sm font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--leather-dark)" }}>
              Détails
            </h3>
            {showPages && <DetailRow label="Pages" value={book.pages} />}
            {showLanguage && <DetailRow label="Langue" value={book.language} />}
            {showFormat && <DetailRow label="Format" value={book.format} />}
            {book.publisher && <DetailRow label="Éditeur" value={book.publisher} />}
            {book.year && <DetailRow label="Année" value={book.year} />}
            {book.dimensions && isLivre && <DetailRow label="Dimensions" value={book.dimensions} />}
            {book.weight && isLivre && <DetailRow label="Poids" value={book.weight} />}
            {showIsbn && <DetailRow label="ISBN" value={String(book.isbn).split("#")[0]} />}
            {showCodebar && <DetailRow label="Code-barres" value={String(book.isbn).split("#")[0]} />}
          </div>
        );
      })()}

      {book.notes && (
        <div className="space-y-3 p-4 rounded-xl mb-4" style={{ background: "white", border: "1px solid var(--parchment)" }}>
          <h3 className="text-sm font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--leather-dark)" }}>
            Notes personnelles
          </h3>
          <p className="text-sm" style={{ color: "var(--ink)", whiteSpace: "pre-wrap" }}>{book.notes}</p>
        </div>
      )}

      {/* Lien externe */}
      {book.infoLink && (
        <a
          href={book.infoLink}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full py-3 rounded-xl text-center font-medium mb-4"
          style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
        >
          📖 Voir la fiche complète en ligne
        </a>
      )}

      {/* Bouton supprimer en bas (le bouton Modifier a été déplacé en haut). */}
      <div className="flex justify-end mt-6">
        <button
          onClick={() => setConfirmDelete(true)}
          className="px-4 py-3 rounded-xl border-2 flex items-center gap-2"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          <Trash2 className="w-4 h-4" /> Supprimer
        </button>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "var(--cream)" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", color: "var(--ink)", marginBottom: "0.5rem" }}>
              Supprimer ce livre ?
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
              Cette action est définitive.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-3 rounded-xl border-2 font-medium"
                style={{ borderColor: "var(--parchment)", color: "var(--ink)" }}
              >
                Annuler
              </button>
              <button
                onClick={onDelete}
                className="flex-1 py-3 rounded-xl font-medium"
                style={{ background: "var(--accent)", color: "var(--cream)" }}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, suffix = "" }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-start gap-3 py-1 border-b last:border-0"
      style={{ borderColor: "var(--parchment)" }}>
      <span className="text-sm" style={{ color: "var(--ink-soft)" }}>{label}</span>
      <span className="text-sm font-medium text-right" style={{ color: "var(--ink)" }}>
        {value}{suffix}
      </span>
    </div>
  );
}

// === SETUP DU SCAN EN SÉRIE ===
// Présentation à 3 niveaux comme la vue "Plan" : on choisit d'abord une pièce,
// puis une bibliothèque, puis une étagère. Plus naturel et plus rapide qu'un
// formulaire avec un select et des champs numériques, surtout sur mobile.
function BatchSetup({ books, structure, onCancel, onStart }) {
  const [level, setLevel] = useState("pieces"); // pieces → bibliotheques → etageres
  const [selectedPieceId, setSelectedPieceId] = useState(null);
  const [selectedBibId, setSelectedBibId] = useState(null);

  // Comptes utiles à l'affichage (livres par pièce / bib / étagère)
  const countByBib = books.reduce((acc, b) => {
    if (b.bibliotheque) acc[b.bibliotheque] = (acc[b.bibliotheque] || 0) + 1;
    return acc;
  }, {});
  const countByPiece = structure.bibliotheques.reduce((acc, b) => {
    const c = countByBib[b.id] || 0;
    acc[b.pieceId] = (acc[b.pieceId] || 0) + c;
    return acc;
  }, {});

  const selectedPiece = selectedPieceId
    ? structure.pieces.find((p) => p.id === selectedPieceId)
    : null;
  const selectedBib = selectedBibId
    ? structure.bibliotheques.find((b) => b.id === selectedBibId)
    : null;

  // Lance le scan une fois l'étagère choisie. La position de départ est
  // calculée automatiquement (première place libre sur cette étagère).
  const startScanOnShelf = (shelfNum) => {
    const startPos = findFirstFreePosition(books, selectedBibId, shelfNum);
    onStart({
      bibliotheque: selectedBibId,
      etagere: shelfNum,
      position: startPos,
    });
  };

  // === NIVEAU 1 : choix de la pièce ===
  if (level === "pieces") {
    return (
      <div>
        <button onClick={onCancel} className="flex items-center gap-1 mb-3" style={{ color: "var(--leather)" }}>
          <X className="w-5 h-5" /> Annuler
        </button>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)" }}>
          Scan rapide
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
          Sélectionnez la pièce où se trouve l'étagère à scanner.
        </p>
        {structure.pieces.length === 0 ? (
          <div className="text-center py-8" style={{ color: "var(--ink-soft)" }}>
            Aucune pièce définie.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {structure.pieces.map((piece) => {
              const bibsCount = structure.bibliotheques.filter((b) => b.pieceId === piece.id).length;
              const booksCount = countByPiece[piece.id] || 0;
              return (
                <button
                  key={piece.id}
                  onClick={() => {
                    setSelectedPieceId(piece.id);
                    setLevel("bibliotheques");
                  }}
                  className="p-4 rounded-xl border-2 text-left transition-all active:scale-95"
                  style={{
                    background: "var(--cream)",
                    borderColor: "var(--parchment)",
                    color: "var(--ink)",
                  }}
                >
                  <div style={{ fontSize: "2.2rem", marginBottom: "0.4rem" }}>{piece.icon || "🏠"}</div>
                  <div className="font-medium leading-tight" style={{ fontFamily: "var(--font-display)" }}>
                    {piece.nom}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
                    {bibsCount} {bibsCount > 1 ? "bibliothèques" : "bibliothèque"} · {booksCount} {booksCount > 1 ? "livres" : "livre"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // === NIVEAU 2 : choix de la bibliothèque dans la pièce ===
  if (level === "bibliotheques" && selectedPiece) {
    const bibsInPiece = structure.bibliotheques.filter((b) => b.pieceId === selectedPiece.id);
    return (
      <div>
        <Breadcrumb
          items={[
            { label: "Pièces", onClick: () => { setLevel("pieces"); setSelectedPieceId(null); } },
            { label: selectedPiece.nom },
          ]}
        />
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)" }}>
          {selectedPiece.nom}
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
          Choisissez la bibliothèque à scanner.
        </p>
        {bibsInPiece.length === 0 ? (
          <div className="text-center py-8" style={{ color: "var(--ink-soft)" }}>
            Aucune bibliothèque dans cette pièce.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {bibsInPiece.map((b) => {
              const booksCount = countByBib[b.id] || 0;
              const shelvesCount = structure.etageres.filter((e) => e.bibId === b.id).length;
              return (
                <button
                  key={b.id}
                  onClick={() => {
                    setSelectedBibId(b.id);
                    setLevel("etageres");
                  }}
                  className="p-4 rounded-xl border-2 text-left transition-all active:scale-95"
                  style={{
                    background: "var(--cream)",
                    borderColor: "var(--parchment)",
                    color: "var(--ink)",
                  }}
                >
                  <div style={{ fontSize: "2.2rem", marginBottom: "0.4rem" }}>📚</div>
                  <div className="font-medium leading-tight" style={{ fontFamily: "var(--font-display)" }}>
                    {b.nom}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
                    {shelvesCount} {shelvesCount > 1 ? "étagères" : "étagère"} · {booksCount} {booksCount > 1 ? "livres" : "livre"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // === NIVEAU 3 : choix de l'étagère dans la bibliothèque ===
  if (level === "etageres" && selectedBib) {
    const piece = structure.pieces.find((p) => p.id === selectedBib.pieceId);
    const shelvesDef = structure.etageres
      .filter((e) => e.bibId === selectedBib.id)
      .sort((a, b) => a.num - b.num);
    // Pour chaque étagère : nombre de livres + prochaine position libre
    const booksInBib = books.filter((b) => b.bibliotheque === selectedBib.id);
    const shelfStats = {};
    shelvesDef.forEach((s) => {
      const onShelf = booksInBib.filter((b) => Number(b.etagere) === Number(s.num));
      shelfStats[s.num] = {
        count: onShelf.length,
        nextPos: findFirstFreePosition(books, selectedBib.id, s.num),
      };
    });
    return (
      <div>
        <Breadcrumb
          items={[
            { label: "Pièces", onClick: () => { setLevel("pieces"); setSelectedPieceId(null); setSelectedBibId(null); } },
            { label: piece?.nom || "Pièce", onClick: () => { setLevel("bibliotheques"); setSelectedBibId(null); } },
            { label: selectedBib.nom },
          ]}
        />
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)" }}>
          {selectedBib.nom}
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
          Touchez l'étagère pour démarrer le scan. La première position libre est sélectionnée automatiquement.
        </p>
        {shelvesDef.length === 0 ? (
          <div className="text-center py-8" style={{ color: "var(--ink-soft)" }}>
            Aucune étagère dans cette bibliothèque.
          </div>
        ) : (
          <div className="space-y-2">
            {shelvesDef.map((s) => {
              const stats = shelfStats[s.num];
              return (
                <button
                  key={s.id}
                  onClick={() => startScanOnShelf(s.num)}
                  className="w-full p-4 rounded-xl border-2 flex items-center gap-3 transition-all active:scale-[0.98]"
                  style={{
                    background: "var(--cream)",
                    borderColor: "var(--parchment)",
                    color: "var(--ink)",
                  }}
                >
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
                      color: "var(--cream)",
                      fontFamily: "var(--font-display)",
                      fontSize: "1.4rem",
                    }}
                  >
                    {s.num}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-medium" style={{ fontFamily: "var(--font-display)" }}>
                      Étagère {s.num}{s.nom ? ` — ${s.nom}` : ""}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--ink-soft)" }}>
                      {stats.count} {stats.count > 1 ? "livres" : "livre"}
                      {" · "}
                      <strong>Démarrer en position {stats.nextPos}</strong>
                    </div>
                  </div>
                  <Zap className="w-5 h-5 flex-shrink-0" style={{ color: "var(--leather)" }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Fallback : retour au niveau 1 si état incohérent
  return (
    <div className="text-center py-8" style={{ color: "var(--ink-soft)" }}>
      <button onClick={() => { setLevel("pieces"); setSelectedPieceId(null); setSelectedBibId(null); }}>
        Retour aux pièces
      </button>
    </div>
  );
}

// === SCANNER EN SÉRIE ===
function BatchScanner({ books, structure, setup, onAddBook, onEnrichBook, onEnrichBookById, onChangeShelf, onFinish, showToast }) {
  const [currentSetup, setCurrentSetup] = useState(setup);
  // Machine à états du scan séquentiel :
  //   - scanning      : la caméra lit les codes-barres (état par défaut)
  //   - searching     : un code vient d'être lu, on attend la fin de la lookup
  //                     → overlay "Recherche…" semi-transparent, caméra ne lit plus
  //   - duplicate     : doublon détecté (même ISBN déjà en base) → modale de choix
  //   - photoFallback : pas de jaquette trouvée → modale demande de photographier
  //   - paused        : pause manuelle (changement d'étagère, etc.)
  //   - flash         : feedback visuel bref après ajout réussi
  const [phase, setPhase] = useState("scanning");
  const [lastBook, setLastBook] = useState(null);
  // États pour la modification du dernier livre depuis le bandeau d'aperçu :
  //   - editingCoverFor : livre dont on souhaite remplacer la couverture
  //                       par une nouvelle photo (réutilise PhotoFallbackModal)
  //   - editingTitleFor : livre dont on souhaite corriger le titre au clavier
  const [editingCoverFor, setEditingCoverFor] = useState(null);
  const [editingTitleFor, setEditingTitleFor] = useState(null);
  // === SESSION DE SCAN — STRUCTURE LÉGÈRE EN REF ===
  // Avant : `batchHistory` était un useState contenant les objets complets
  // (avec covers base64). Après 20 scans avec quelques photos, ça représentait
  // plusieurs Mo en mémoire React, recopiés à chaque render → ralentissement
  // visible et risque de plantage sur mobile.
  // Maintenant : on stocke uniquement ce dont on a vraiment besoin :
  //   - sessionScansRef : Set d'ISBNs (sans suffixe) pour la détection de
  //     doublon en O(1)
  //   - sessionScansListRef : liste légère { id, isbn, title } pour l'usage
  //     "Ajouter comme nouveau" qui doit compter les entrées du même code
  //   - sessionCount : juste le compteur affiché en UI (state, pour re-render)
  // PAS de cover, PAS d'auteur, PAS de description en mémoire de session.
  const sessionScansRef = useRef(new Set());     // ISBNs de base (sans #N)
  const sessionScansListRef = useRef([]);        // [{id, isbn, title}]
  const [sessionCount, setSessionCount] = useState(0);
  const [showShelfChange, setShowShelfChange] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  // Positions déjà attribuées dans cette session de scan, par étagère.
  // Clé : `${bibId}|${etagere}` — Valeur : Set de positions occupées.
  const sessionTakenRef = useRef(new Map());

  // === DONNÉES DU SCAN EN COURS ===
  // En mode séquentiel, on ne traite qu'un livre à la fois. `pendingScan`
  // contient toutes les infos liées au scan actuel pendant les phases
  // searching / duplicate / photoFallback. À la fin (livre ajouté ou ignoré),
  // pendingScan repasse à null et on revient à scanning.
  const [pendingScan, setPendingScan] = useState(null);

  // Ref miroir de "phase non-scanning" : mise à jour synchrone pour que le
  // callback ZXing voie immédiatement qu'il ne doit plus accepter de codes,
  // sans attendre le re-render React.
  const busyRef = useRef(false);

  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const lastScannedRef = useRef({ code: null, time: 0 });
  const phaseRef = useRef("scanning"); // pour accès depuis le callback async
  // Ref vers la fonction handleISBNScanned actuelle. Le callback ZXing est
  // créé une fois au démarrage de la caméra, mais handleISBNScanned est
  // re-créé à chaque render et ferme sur des valeurs (books, batchHistory…)
  // qui peuvent devenir périmées. Cette ref garantit que le callback ZXing
  // appelle toujours la version la plus récente, qui voit l'état le plus à
  // jour de batchHistory (essentiel pour la détection de doublon juste après
  // l'ajout d'un livre).
  const handleScanRef = useRef(null);
  const [error, setError] = useState(null);
  const [manualISBN, setManualISBN] = useState("");

  const currentBib = structure.bibliotheques.find((b) => b.id === currentSetup.bibliotheque);

  // Tient phaseRef + busyRef à jour de manière synchrone
  useEffect(() => {
    phaseRef.current = phase;
    busyRef.current = phase !== "scanning" && phase !== "flash";
  }, [phase]);

  // Démarrage explicite de la caméra par tap utilisateur (essentiel pour iOS)
  const startCamera = async () => {
    setStarting(true);
    setError(null);
    try {
      const reader = await createBarcodeReader();
      readerRef.current = reader;
      if (!videoRef.current) {
        setStarting(false);
        return;
      }
      await reader.startScanning(videoRef.current, (code) => {
        // Accepte tout EAN-13, UPC-A (12 chiffres), ou ISBN-10
        if (!/^\d{10,13}$/.test(code)) return;
        if (phaseRef.current === "paused") return;
        const now = Date.now();
        if (lastScannedRef.current.code === code && now - lastScannedRef.current.time < 3000) {
          return;
        }
        lastScannedRef.current = { code, time: now };
        if (navigator.vibrate) navigator.vibrate(50);
        if (handleScanRef.current) handleScanRef.current(code);
      });
      setCameraStarted(true);
    } catch (e) {
      if (e?.name === "NotAllowedError") setError("permission");
      else if (e?.message === "no-scanner") setError("not-supported");
      else setError(e?.message || "camera");
    }
    setStarting(false);
  };

  // Filtre dans le callback : on accepte les scans en phase "scanning" OU "flash"
  // (flash = juste un feedback visuel court, pas un blocage)
  // Mais on ne tient pas compte de ça dans cet effet : la caméra reste allumée
  // dans tous ces états.

  // === GESTION CAMÉRA OPTIMISÉE ===
  // La caméra (MediaStream + worker ZXing) est une ressource coûteuse. Avant,
  // on appelait `stop()` puis `startScanning()` à chaque transition de phase,
  // ce qui déclenchait un cycle complet getUserMedia → décodeur → arrêt à
  // chaque scan. Sur 20 scans, ça représentait 20 allocations/libérations qui
  // accumulaient des fuites mémoire et faisaient ralentir l'app.
  //
  // Maintenant : on démarre la caméra UNE SEULE FOIS quand `cameraStarted`
  // passe à true. On la laisse tourner pendant toutes les phases (searching,
  // photoFallback, etc.) et on filtre les codes-barres dans le callback via
  // `busyRef`. La caméra n'est arrêtée qu'au démontage du composant.
  useEffect(() => {
    if (!cameraStarted) return;
    if (readerRef.current) return; // déjà démarrée
    let cancelled = false;
    (async () => {
      try {
        const reader = await createBarcodeReader();
        if (cancelled) return;
        readerRef.current = reader;
        if (!videoRef.current) return;
        await reader.startScanning(videoRef.current, (code) => {
          // Accepte tout EAN-13, UPC-A (12 chiffres), ou ISBN-10
          if (!/^\d{10,13}$/.test(code)) return;
          // Verrou synchrone : si une phase bloquante est active, on rejette
          // immédiatement. C'est ce qui remplace l'ancien stop()/start() entre
          // chaque scan.
          if (busyRef.current) return;
          if (phaseRef.current === "paused") return;
          const now = Date.now();
          if (lastScannedRef.current.code === code && now - lastScannedRef.current.time < 3000) {
            return;
          }
          lastScannedRef.current = { code, time: now };
          // Vibreur court (50 ms) à chaque code lu — confirmation tactile
          if (navigator.vibrate) navigator.vibrate(50);
          // Appel via ref pour bénéficier de la version la plus à jour de
          // handleISBNScanned (qui ferme sur books / sessionScansRef à jour).
          if (handleScanRef.current) handleScanRef.current(code);
        });
      } catch (e) {
        if (e?.name === "NotAllowedError") setError("permission");
        else setError(e?.message || "camera");
      }
    })();
    return () => {
      cancelled = true;
      // Cleanup au démontage du useEffect (changement de cameraStarted ou
      // démontage du composant).
      if (readerRef.current) {
        try { readerRef.current.stop(); } catch (e) { /* ignore */ }
        readerRef.current = null;
      }
      if (videoRef.current && videoRef.current.srcObject) {
        try {
          const stream = videoRef.current.srcObject;
          if (stream.getTracks) stream.getTracks().forEach((t) => t.stop());
          videoRef.current.srcObject = null;
        } catch (e) { /* ignore */ }
      }
    };
  }, [cameraStarted]);

  // === LIBÉRATION TEMPORAIRE DE LA CAMÉRA POUR LA PHOTO ===
  // Quand on entre en phase "photoFallback", la caméra système (input file
  // capture=environment) doit pouvoir s'ouvrir. Sur certains navigateurs
  // mobiles, elle est en conflit avec ZXing qui a déjà la caméra → la
  // modale photo n'arrive pas à démarrer. On stoppe donc explicitement le
  // reader pendant cette phase, et on le relance au retour à scanning.
  useEffect(() => {
    if (!cameraStarted) return;
    if (phase === "photoFallback") {
      if (readerRef.current) {
        try { readerRef.current.stop(); } catch (e) { /* ignore */ }
        readerRef.current = null;
      }
      if (videoRef.current && videoRef.current.srcObject) {
        try {
          const stream = videoRef.current.srcObject;
          if (stream.getTracks) stream.getTracks().forEach((t) => t.stop());
          videoRef.current.srcObject = null;
        } catch (e) { /* ignore */ }
      }
    } else if (phase === "scanning" && !readerRef.current) {
      // Au retour vers scanning, si le reader a été arrêté (sortie de
      // photoFallback), on le redémarre.
      let cancelled = false;
      (async () => {
        try {
          const reader = await createBarcodeReader();
          if (cancelled) return;
          readerRef.current = reader;
          if (!videoRef.current) return;
          await reader.startScanning(videoRef.current, (code) => {
            if (!/^\d{10,13}$/.test(code)) return;
            if (busyRef.current) return;
            if (phaseRef.current === "paused") return;
            const now = Date.now();
            if (lastScannedRef.current.code === code && now - lastScannedRef.current.time < 3000) {
              return;
            }
            lastScannedRef.current = { code, time: now };
            if (navigator.vibrate) navigator.vibrate(50);
            if (handleScanRef.current) handleScanRef.current(code);
          });
        } catch (e) {
          if (e?.name === "NotAllowedError") setError("permission");
          else setError(e?.message || "camera");
        }
      })();
      return () => { cancelled = true; };
    }
  }, [phase, cameraStarted]);

  // === CLEANUP AU DÉMONTAGE DU COMPOSANT ===
  // Sécurité supplémentaire : si l'utilisateur quitte BatchScanner brusquement
  // (changement de vue, fermeture d'app), on s'assure que la caméra est bien
  // libérée — la batterie remerciera. useEffect avec deps [] tourne uniquement
  // au montage et démontage.
  useEffect(() => {
    return () => {
      if (readerRef.current) {
        try { readerRef.current.stop(); } catch (e) { /* ignore */ }
        readerRef.current = null;
      }
      if (videoRef.current && videoRef.current.srcObject) {
        try {
          const stream = videoRef.current.srcObject;
          if (stream.getTracks) stream.getTracks().forEach((t) => t.stop());
          videoRef.current.srcObject = null;
        } catch (e) { /* ignore */ }
      }
    };
  }, []);

  // Helper : passe à la phase scanning + vibration longue de fin de traitement.
  // ⚠️ On NE RESET PAS lastScannedRef — au contraire on actualise son timestamp
  // pour que la protection 3 secondes contre les re-scans du même code joue
  // pleinement après le retour. Sans ça, juste après une prise de photo, la
  // caméra ZXing peut revoir le code-barres encore dans son champ et déclencher
  // un nouveau scan (qui tomberait alors sur la modale doublon → mauvaise UX).
  const finishAndResume = () => {
    setPendingScan(null);
    if (lastScannedRef.current.code) {
      lastScannedRef.current = { ...lastScannedRef.current, time: Date.now() };
    }
    // Vibreur long (200 ms) pour signaler "prêt à scanner le suivant"
    if (navigator.vibrate) navigator.vibrate(200);
    setPhase("scanning");
  };

  const handleISBNScanned = async (code) => {
    // Verrou synchrone : si on est déjà en train de traiter un livre, on
    // refuse tout nouveau scan. Le busyRef est mis à jour par useEffect dès
    // que phase change ; le test ici est une dernière protection contre les
    // appels concurrents.
    if (busyRef.current) return;
    busyRef.current = true;

    // === DÉTECTION DE DOUBLON (synchrone, depuis books) ===
    // Critère : même ISBN/code-barres, peu importe l'emplacement.
    // Un objet déjà scanné dans la session courante (présent dans batchHistory)
    // compte aussi comme doublon — utile si l'utilisateur scanne deux fois le
    // même livre sans s'en rendre compte.
    // ⚠️ On compare sur le code BASE (sans suffixe #N) : un objet stocké avec
    // l'ISBN `3780263006908#2` (revue déjà ajoutée comme nouveau) doit aussi
    // être détecté comme doublon de `3780263006908`.
    const cleanCode = code.replace(/\D/g, "");
    const baseIsbn = (raw) => (raw || "").split("#")[0].replace(/\D/g, "");
    // Recherche dans `books` (BDD distante / locale) avec linear scan : c'est
    // O(n) mais inévitable car la liste est grande et changeante.
    const findExistingByIsbn = (list) =>
      list.find((b) => baseIsbn(b.isbn) === cleanCode);
    const dupInBase = findExistingByIsbn(books);
    // Recherche en session via Set (O(1)) — on a la liste légère stockée en
    // ref (id + isbn + title), ce qui suffit pour afficher la modale doublon.
    let dupInSession = null;
    if (sessionScansRef.current.has(cleanCode)) {
      dupInSession = sessionScansListRef.current.find(
        (b) => baseIsbn(b.isbn) === cleanCode
      );
    }
    const duplicateOf = dupInBase || dupInSession;

    // === DÉTECTION DU TYPE + RECONNAISSANCE INTERNE ===
    const detectedType = guessTypeFromBarcode(code);
    let magazineMatch = null;
    if (detectedType === "revue") magazineMatch = recognizeMagazine(code);
    let gameMatch = null;
    if (detectedType === "jeu-switch" || detectedType === "jeu-societe") {
      gameMatch = recognizeGame(code);
    }
    let pressMatch = null;
    if (detectedType === "revue" && !magazineMatch) {
      pressMatch = recognizePressPublisher(code);
    }

    // === CALCUL DE LA POSITION ===
    const placeholderBib = currentSetup.bibliotheque;
    const placeholderEtagere = currentSetup.etagere;
    const shelfKey = `${placeholderBib}|${placeholderEtagere}`;
    const sessionSet = sessionTakenRef.current.get(shelfKey) || new Set();
    const extraReserved = Array.from(sessionSet);
    const autoFree = findFirstFreePosition(books, placeholderBib, placeholderEtagere, extraReserved);
    const placeholderPosition = Math.max(autoFree, currentSetup.position || 1);

    // Stocke toutes les infos du scan en cours pour les phases suivantes
    const scanContext = {
      code,
      detectedType,
      magazineMatch,
      gameMatch,
      pressMatch,
      placeholderBib,
      placeholderEtagere,
      placeholderPosition,
      duplicateOf,
    };

    // === BRANCHE 1 : DOUBLON ===
    // On bloque la caméra et on demande à l'utilisateur ce qu'il veut faire.
    if (duplicateOf) {
      setPendingScan(scanContext);
      setPhase("duplicate");
      return; // Le reste du flux dépend de la décision de l'utilisateur
              // (ajouter quand même → continueAfterDuplicate / ignorer → finishAndResume)
    }

    // === BRANCHE 2 : NOUVEAU LIVRE ===
    // Phase "searching" : overlay "Recherche…" semi-transparent, caméra ne lit plus
    setPendingScan(scanContext);
    setPhase("searching");
    await processNewScan(scanContext);
  };

  // Traite un scan déjà validé comme non-doublon : lance la lookup, puis ajoute
  // le livre. Si la lookup ne renvoie pas de jaquette, déclenche la modale photo.
  // Cette fonction est aussi appelée si l'utilisateur a choisi "Ajouter comme
  // nouveau" sur un doublon (avec ctx.forceAddAsNew = true).
  const processNewScan = async (ctx) => {
    const {
      code, detectedType, magazineMatch, gameMatch, pressMatch,
      placeholderBib, placeholderEtagere, placeholderPosition,
      forceAddAsNew,
    } = ctx;

    // === SUFFIXAGE DE L'ISBN POUR "AJOUTER COMME NOUVEAU" ===
    // Quand l'utilisateur force l'ajout malgré un doublon (typiquement pour
    // les revues : tous les numéros d'Historia partagent le même EAN), on
    // suffixe l'ISBN stocké en base avec "#2", "#3", etc. pour qu'il soit
    // unique. Le caractère "#" n'est pas valide dans un EAN-13, donc aucun
    // risque de confusion avec un vrai code-barres.
    // Le code utilisé pour la lookup en ligne reste le code original (sans
    // suffixe) — le suffixe est juste un marqueur interne d'unicité.
    let storedIsbn = code;
    if (forceAddAsNew) {
      // Compte combien d'objets ont déjà ce code (avec ou sans suffixe).
      // On itère séparément sur books et la liste de session sans copier
      // (pas de [...books, ...session] qui dupliquerait toute la mémoire).
      const baseCode = code; // déjà nettoyé en amont
      const isMatch = (raw) => {
        const stripped = (raw || "").split("#")[0].replace(/\D/g, "");
        return stripped === baseCode;
      };
      let count = 0;
      for (const b of books || []) if (isMatch(b.isbn)) count++;
      for (const b of sessionScansListRef.current) if (isMatch(b.isbn)) count++;
      // count est le nombre d'occurrences déjà présentes :
      // - s'il y en a 1 (le doublon original), on crée le #2
      // - s'il y en a 2 (#1 et #2), on crée le #3
      const nextIndex = count + 1;
      storedIsbn = `${baseCode}#${nextIndex}`;
    }

    // Lookup en ligne (peut prendre plusieurs secondes) — on utilise toujours
    // le code original (sans suffixe) car les bases en ligne ne connaissent
    // évidemment que le vrai code EAN.
    let found = null;
    try {
      found = await lookupAnyBarcode(code, detectedType);
    } catch (e) { /* ignore */ }

    // Construit l'objet à insérer en BDD avec toutes les infos disponibles.
    // On combine reconnaissance interne (revue / jeu / éditeur de presse) +
    // résultat de la lookup en ligne.
    const placeholderId = Date.now().toString() + "-" + Math.random().toString(36).slice(2, 6);
    const placeholder = {
      _placeholderId: placeholderId,
      type: detectedType,
      isbn: storedIsbn,
      title: magazineMatch?.title || gameMatch?.title || found?.title || "",
      author: found?.author || "",
      cover: found?.cover || "",
      publisher: magazineMatch?.publisher || gameMatch?.publisher || found?.publisher || pressMatch?.publisher || "",
      bibliotheque: placeholderBib,
      etagere: placeholderEtagere,
      position: placeholderPosition,
      notes: magazineMatch?.ageRange || "",
      // Champs enrichis si la lookup a renvoyé quelque chose
      subtitle: found?.subtitle || "",
      pages: found?.pages || 0,
      language: found?.language || "",
      description: found?.description || "",
      categories: found?.categories || "",
      rating: found?.rating || 0,
      ratingsCount: found?.ratingsCount || 0,
      infoLink: found?.infoLink || "",
      format: found?.format || "",
      dimensions: found?.dimensions || "",
      weight: found?.weight || "",
      year: found?.year || "",
    };
    if (detectedType === "jeu-switch") {
      placeholder.platform = gameMatch?.platform || "Nintendo Switch";
    }

    // Insère en BDD et récupère l'ID retourné
    const inserted = await onAddBook(placeholder);
    const dbId = inserted?.id || null;
    const trackedBook = { ...placeholder, id: dbId };
    setLastBook(trackedBook);
    // Mise à jour LÉGÈRE de la session : juste id + isbn + title (pas de
    // cover lourde). On indexe aussi dans le Set pour la détection O(1).
    sessionScansListRef.current.unshift({
      id: dbId,
      isbn: storedIsbn,
      title: trackedBook.title || "",
    });
    sessionScansRef.current.add(code.replace(/\D/g, ""));
    setSessionCount((c) => c + 1);

    // Marque la position comme prise dans la session
    const shelfKey = `${placeholderBib}|${placeholderEtagere}`;
    const sessionSet = sessionTakenRef.current.get(shelfKey) || new Set();
    sessionSet.add(placeholderPosition);
    sessionTakenRef.current.set(shelfKey, sessionSet);
    setCurrentSetup((s) => ({ ...s, position: placeholderPosition + 1 }));

    // === PAS DE JAQUETTE → MODALE PHOTO ===
    if (!placeholder.cover && dbId) {
      // On garde pendingScan, on enrichit avec bookId pour la photo
      setPendingScan({ ...ctx, bookId: dbId, trackedBook });
      setPhase("photoFallback");
      return;
    }

    // === SUCCÈS COMPLET → FLASH + RETOUR SCANNING ===
    setPhase("flash");
    setTimeout(() => {
      setPhase((p) => (p === "flash" ? "scanning" : p));
      finishAndResume();
    }, 350);
  };

  // L'utilisateur a choisi "Ignorer" sur la modale doublon.
  const handleDuplicateIgnore = () => {
    finishAndResume();
  };
  // L'utilisateur a choisi "Déplacer ici" sur la modale doublon.
  // Au lieu de créer un nouvel objet, on met à jour le livre existant pour
  // qu'il pointe vers le nouvel emplacement. Cas d'usage : l'utilisateur
  // range physiquement un livre à un endroit différent de celui enregistré
  // dans l'app.
  const handleDuplicateMove = async () => {
    if (!pendingScan?.duplicateOf) return;
    const { duplicateOf, placeholderBib, placeholderEtagere, placeholderPosition } = pendingScan;
    // Libère l'ancienne position dans le sessionTaken si elle y était
    // (cas rare : doublon de session). Pas critique, mais propre.
    if (duplicateOf.bibliotheque && duplicateOf.etagere && duplicateOf.position) {
      const oldKey = `${duplicateOf.bibliotheque}|${duplicateOf.etagere}`;
      const oldSet = sessionTakenRef.current.get(oldKey);
      if (oldSet) oldSet.delete(Number(duplicateOf.position));
    }
    // Met à jour le livre côté BDD/local via onEnrichBookById qui sait
    // appliquer n'importe quels champs en une seule passe.
    if (typeof onEnrichBookById === "function") {
      await onEnrichBookById(duplicateOf.id, {
        bibliotheque: placeholderBib,
        etagere: placeholderEtagere,
        position: placeholderPosition,
      });
    }
    // Marque la nouvelle position comme prise dans la session pour que les
    // prochains scans ne s'y placent pas.
    const newKey = `${placeholderBib}|${placeholderEtagere}`;
    const newSet = sessionTakenRef.current.get(newKey) || new Set();
    newSet.add(placeholderPosition);
    sessionTakenRef.current.set(newKey, newSet);
    // Avance l'UI sur la prochaine position pressentie
    setCurrentSetup((s) => ({ ...s, position: placeholderPosition + 1 }));
    // Met à jour le panneau "dernier livre". Le déplacement n'est PAS un
    // nouveau scan en session (on ne réajoute pas dans sessionScansListRef
    // car le livre est déjà dans `books` côté distant). On incrémente quand
    // même le compteur affiché pour refléter l'action.
    const movedBook = {
      ...duplicateOf,
      bibliotheque: placeholderBib,
      etagere: placeholderEtagere,
      position: placeholderPosition,
    };
    setLastBook(movedBook);
    setSessionCount((c) => c + 1);
    showToast(`Déplacé : ${duplicateOf.title || "(sans titre)"}`);
    finishAndResume();
  };
  // L'utilisateur a choisi "Ajouter comme nouveau" sur la modale doublon.
  // Cas d'usage typique : revue ou collection où le code-barres EAN est le
  // même pour tous les numéros (Historia, Pomme d'Api, etc.) — l'utilisateur
  // veut bien créer un nouvel objet, pas remplacer l'ancien. On va suffixer
  // l'ISBN avec #2, #3, etc. pour le rendre unique dans la base.
  const handleDuplicateAddAnyway = async () => {
    if (!pendingScan) return;
    setPhase("searching");
    await processNewScan({ ...pendingScan, forceAddAsNew: true });
  };

  // L'utilisateur a pris une photo dans la modale fallback.
  const handlePhotoFallbackCapture = async (dataUrl) => {
    if (!pendingScan) return;
    const { bookId } = pendingScan;
    const compressed = await compressImageDataUrl(dataUrl);
    if (typeof onEnrichBookById === "function" && bookId) {
      onEnrichBookById(bookId, { cover: compressed });
    }
    setLastBook((curr) => curr?.id === bookId ? { ...curr, cover: compressed } : curr);
    // Note : on ne stocke pas la cover dans sessionScansListRef (volontairement,
    // pour limiter la mémoire). Le livre est déjà à jour côté `books` via
    // onEnrichBookById, c'est suffisant.
    finishAndResume();
  };
  // L'utilisateur a passé la modale photo (livre déjà ajouté sans jaquette).
  const handlePhotoFallbackSkip = () => {
    finishAndResume();
  };

  // Met à jour la ref à chaque render pour que le callback ZXing (créé une
  // seule fois au démarrage de la caméra) ait toujours accès à la version
  // courante de handleISBNScanned, qui ferme sur batchHistory à jour.
  // Sans cette indirection, la fonction capturée par ZXing au démarrage
  // ne voit pas les livres ajoutés en cours de session → ne détecte pas les
  // doublons immédiatement après un scan + photoFallback.
  handleScanRef.current = handleISBNScanned;

  const handleManualISBN = () => {
    if (manualISBN.length >= 10) {
      handleISBNScanned(manualISBN);
      setManualISBN("");
    }
  };

  // === AJOUT D'UN LIVRE SANS ISBN ===
  // Pour les livres anciens, livres jeunesse, manuscrits, etc. qui n'ont pas
  // de code-barres exploitable. On crée immédiatement un placeholder typé
  // "livre" à l'emplacement courant, puis on déclenche la modale photo pour
  // que l'utilisateur cadre la jaquette. Pas de lookup en ligne (pas d'ISBN
  // sur lequel chercher), pas de détection de doublon (chaque livre sans
  // ISBN est unique du point de vue de l'app — on ne peut pas le comparer
  // à autre chose).
  const handleAddWithoutISBN = async () => {
    if (busyRef.current) return;
    busyRef.current = true;

    const placeholderBib = currentSetup.bibliotheque;
    const placeholderEtagere = currentSetup.etagere;
    const shelfKey = `${placeholderBib}|${placeholderEtagere}`;
    const sessionSet = sessionTakenRef.current.get(shelfKey) || new Set();
    const extraReserved = Array.from(sessionSet);
    const autoFree = findFirstFreePosition(books, placeholderBib, placeholderEtagere, extraReserved);
    const placeholderPosition = Math.max(autoFree, currentSetup.position || 1);

    const placeholderId = Date.now().toString() + "-" + Math.random().toString(36).slice(2, 6);
    const placeholder = {
      _placeholderId: placeholderId,
      type: "livre",
      isbn: "", // ← pas d'ISBN, l'utilisateur le complétera plus tard si besoin
      title: "", // ← l'utilisateur saisira le titre depuis la fiche détail
      author: "",
      cover: "",
      bibliotheque: placeholderBib,
      etagere: placeholderEtagere,
      position: placeholderPosition,
      notes: "",
    };

    const inserted = await onAddBook(placeholder);
    const dbId = inserted?.id || null;
    const trackedBook = { ...placeholder, id: dbId };
    setLastBook(trackedBook);
    // Compteur affiché — pas d'entrée dans sessionScansListRef car ce livre
    // n'a pas de code-barres et ne peut donc être déduit en doublon de futurs
    // scans (la détection se fait par ISBN).
    setSessionCount((c) => c + 1);

    // Marque la position comme prise dans la session
    sessionSet.add(placeholderPosition);
    sessionTakenRef.current.set(shelfKey, sessionSet);
    setCurrentSetup((s) => ({ ...s, position: placeholderPosition + 1 }));

    if (!dbId) {
      // Insertion échouée — on revient à scanning sans modale photo
      busyRef.current = false;
      finishAndResume();
      return;
    }

    // Stocke un pendingScan synthétique pour que la modale photo s'affiche
    // proprement (avec un libellé adapté "livre sans code-barres").
    setPendingScan({
      code: "",
      detectedType: "livre",
      magazineMatch: null,
      gameMatch: null,
      pressMatch: null,
      placeholderBib,
      placeholderEtagere,
      placeholderPosition,
      bookId: dbId,
      trackedBook,
      noIsbn: true, // drapeau pour adapter le texte de la modale
    });
    setPhase("photoFallback");
  };

  const undoLast = () => {
    // On utilise lastBook (le dernier ajout en mémoire) plutôt qu'une liste
    // complète. Si l'utilisateur veut annuler plusieurs scans, il devra
    // utiliser la suppression manuelle depuis la fiche détail — c'est rare
    // en pratique, et garder une liste de N derniers livres en mémoire ne
    // vaut pas le coût.
    if (!lastBook) return;
    // Libère la position prise dans la session de scan en cours pour que les
    // prochains scans puissent la réutiliser. Ne touche pas aux positions des
    // livres déjà persistés en BDD (qui restent bien à leur place).
    if (lastBook.bibliotheque && lastBook.etagere && lastBook.position) {
      const shelfKey = `${lastBook.bibliotheque}|${lastBook.etagere}`;
      const sessionSet = sessionTakenRef.current.get(shelfKey);
      if (sessionSet) sessionSet.delete(Number(lastBook.position));
    }
    // Retire aussi l'entrée de la liste légère de session (utile pour la
    // détection de doublon : si on annule, le scan de ce code à nouveau ne
    // doit plus déclencher la modale doublon).
    if (lastBook.isbn) {
      const baseCode = (lastBook.isbn || "").split("#")[0].replace(/\D/g, "");
      sessionScansRef.current.delete(baseCode);
      sessionScansListRef.current = sessionScansListRef.current.filter(
        (b) => b.id !== lastBook.id
      );
    }
    // Recule la "prochaine position pressentie" de 1, sans descendre sous 1.
    // Le calcul réel via findFirstFreePosition prendra la main au prochain scan.
    setCurrentSetup((s) => ({ ...s, position: Math.max(1, s.position - 1) }));
    setSessionCount((c) => Math.max(0, c - 1));
    setLastBook(null);
    showToast("Position reculée — la place est libérée");
  };

  const changeShelf = (newEtagere) => {
    const etagereNum = parseInt(newEtagere) || 1;
    // Calcule la première position libre sur la nouvelle étagère
    const free = findFirstFreePosition(books, currentSetup.bibliotheque, etagereNum);
    setCurrentSetup((s) => ({ ...s, etagere: etagereNum, position: free }));
    setShowShelfChange(false);
    showToast(`Étagère ${newEtagere} — démarrage en position ${free}`);
    setPhase("scanning");
  };

  const changeBibliotheque = (newBib) => {
    // Calcule la première position libre sur l'étagère 1 de la nouvelle bib
    const free = findFirstFreePosition(books, newBib, 1);
    setCurrentSetup({ bibliotheque: newBib, etagere: 1, position: free });
    setShowShelfChange(false);
    showToast(`Nouvelle bibliothèque — étagère 1, position ${free}`);
    setPhase("scanning");
  };

  return (
    <div>
      {/* Bandeau d'emplacement */}
      <div className="rounded-xl p-4 mb-4 border-2" style={{
        background: "var(--leather-dark)",
        borderColor: "var(--gold)",
      }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--gold-light)" }}>
              Emplacement actuel
            </div>
            <div className="font-semibold truncate" style={{
              fontFamily: "var(--font-display)",
              color: "var(--cream)",
              fontSize: "1.05rem",
            }}>
              {currentBib?.nom}
            </div>
            <div className="text-sm mt-1" style={{ color: "var(--parchment)" }}>
              Étagère <strong>{currentSetup.etagere}</strong> · Prochaine position <strong>{(() => {
                // Calcul en live de la VRAIE prochaine position libre, en
                // tenant compte de `books` ET des positions prises dans la
                // session de scan en cours.
                const shelfKey = `${currentSetup.bibliotheque}|${currentSetup.etagere}`;
                const sessionSet = sessionTakenRef.current.get(shelfKey) || new Set();
                const auto = findFirstFreePosition(books, currentSetup.bibliotheque, currentSetup.etagere, Array.from(sessionSet));
                return Math.max(auto, currentSetup.position || 1);
              })()}</strong>
            </div>
          </div>
          <button
            onClick={() => { setPhase("paused"); setShowShelfChange(true); }}
            className="px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0"
            style={{ background: "var(--gold-light)", color: "var(--leather-dark)" }}
          >
            Changer
          </button>
        </div>
      </div>

      {/* Modale changement étagère / bibliothèque */}
      {showShelfChange && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: "var(--cream)" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", color: "var(--ink)", marginBottom: "1rem" }}>
              Changer d'emplacement
            </h3>

            <Field label="Bibliothèque">
              <select
                defaultValue={currentSetup.bibliotheque}
                onChange={(e) => changeBibliotheque(e.target.value)}
                className="w-full p-3 rounded-lg border-2 outline-none bg-white"
                style={{ borderColor: "var(--parchment)" }}
              >
                {structure.pieces.map((piece) => {
                  const bibs = structure.bibliotheques.filter((b) => b.pieceId === piece.id);
                  if (bibs.length === 0) return null;
                  return (
                    <optgroup key={piece.id} label={piece.nom}>
                      {bibs.map((b) => (
                        <option key={b.id} value={b.id}>{b.nom}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </Field>

            <div className="mt-3">
              <div className="text-sm font-medium mb-2" style={{ color: "var(--ink-soft)" }}>
                Ou simplement changer d'étagère (même bibliothèque)
              </div>
              <div className="flex gap-2 flex-wrap">
                {(() => {
                  // Liste les vraies étagères définies dans la bibliothèque
                  // courante, triées par numéro. Tomber sur une plage 1-6
                  // arbitraire ne reflétait pas la structure réelle de
                  // l'utilisateur.
                  const shelvesHere = structure.etageres
                    .filter((e) => e.bibId === currentSetup.bibliotheque)
                    .sort((a, b) => a.num - b.num);
                  if (shelvesHere.length === 0) {
                    return (
                      <div className="text-xs italic" style={{ color: "var(--ink-soft)" }}>
                        Aucune étagère définie pour cette bibliothèque.
                      </div>
                    );
                  }
                  return shelvesHere.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => changeShelf(s.num)}
                      className="px-3 h-12 rounded-lg font-semibold border-2 flex flex-col items-center justify-center"
                      style={{
                        background: s.num === currentSetup.etagere ? "var(--leather-dark)" : "white",
                        color: s.num === currentSetup.etagere ? "var(--cream)" : "var(--ink)",
                        borderColor: "var(--parchment)",
                        minWidth: "3rem",
                      }}
                    >
                      <span style={{ fontSize: "0.95rem", lineHeight: 1 }}>{s.num}</span>
                      {s.nom && (
                        <span style={{
                          fontSize: "0.6rem",
                          lineHeight: 1,
                          marginTop: "2px",
                          opacity: 0.85,
                          maxWidth: "80px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>{s.nom}</span>
                      )}
                    </button>
                  ));
                })()}
              </div>
            </div>

            <button
              onClick={() => { setShowShelfChange(false); setPhase("scanning"); }}
              className="w-full py-3 rounded-xl border-2 font-medium mt-4"
              style={{ borderColor: "var(--parchment)", color: "var(--ink)" }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Caméra */}
      {error === "not-supported" ? (
        <div className="text-center py-6 px-2">
          <p style={{ color: "var(--ink)", marginBottom: "1rem" }}>
            Scan automatique non disponible. Saisissez les ISBN un par un :
          </p>
          <div className="flex gap-2 mb-4">
            <input
              type="tel"
              value={manualISBN}
              onChange={(e) => setManualISBN(e.target.value.replace(/\D/g, ""))}
              placeholder="978…"
              maxLength={13}
              className="flex-1 p-3 rounded-xl border-2 outline-none"
              style={{ borderColor: "var(--parchment)" }}
            />
            <button
              onClick={handleManualISBN}
              disabled={manualISBN.length < 10 || phase === "processing"}
              className="px-4 rounded-xl font-medium disabled:opacity-50"
              style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : error === "permission" ? (
        <p className="text-center py-8 px-4" style={{ color: "var(--accent)" }}>
          Caméra refusée. Réglages iOS → Safari → Caméra, puis fermez et rouvrez l'app.
        </p>
      ) : (
        <div className="relative aspect-[4/5] rounded-xl overflow-hidden bg-black mb-4">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            autoPlay
            webkit-playsinline="true"
          />

          {/* Overlay tant que la caméra n'est pas démarrée */}
          {!cameraStarted && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
              style={{ background: "rgba(74, 35, 10, 0.92)" }}>
              <Camera className="w-12 h-12 mb-3" style={{ color: "var(--gold-light)" }} />
              <p className="mb-4" style={{ color: "var(--cream)" }}>
                Touchez pour démarrer la caméra et scanner toute l'étagère
              </p>
              <button
                onClick={startCamera}
                disabled={starting}
                className="px-6 py-3 rounded-full font-medium disabled:opacity-50 flex items-center gap-2"
                style={{ background: "var(--gold-light)", color: "var(--leather-dark)" }}
              >
                {starting ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Démarrage…</>
                ) : (
                  <><Camera className="w-5 h-5" /> Démarrer la caméra</>
                )}
              </button>
              {error && error !== "permission" && error !== "not-supported" && (
                <p className="text-xs mt-3" style={{ color: "var(--gold-light)" }}>
                  Erreur : {error}
                </p>
              )}
            </div>
          )}

          {cameraStarted && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-4/5 h-1/3 border-2 rounded-lg" style={{ borderColor: "var(--gold-light)" }}>
                <div className="absolute left-0 right-0 h-0.5 scan-line" style={{ background: "var(--gold-light)" }} />
              </div>
            </div>
          )}

          {/* Flash de confirmation après chaque scan — court, ne bloque pas la vue */}
          {phase === "flash" && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center"
              style={{
                background: "rgba(180, 220, 100, 0.25)",
                animation: "flashFade 300ms ease-out",
              }}>
              <div className="rounded-full p-4" style={{ background: "rgba(74, 35, 10, 0.85)" }}>
                <Check className="w-10 h-10" style={{ color: "var(--gold-light)" }} />
              </div>
            </div>
          )}

          {/* Compteur en bas */}
          {cameraStarted && (
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <div className="px-3 py-1.5 rounded-full text-sm font-medium" style={{
                background: "rgba(0,0,0,0.6)",
                color: "var(--cream)",
                backdropFilter: "blur(8px)",
              }}>
                {sessionCount} {sessionCount > 1 ? "livres scannés" : "livre scanné"}
              </div>
              {lastBook && (
                <button
                  onClick={undoLast}
                  className="px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{ background: "rgba(0,0,0,0.6)", color: "var(--cream)" }}
                >
                  Annuler dernier
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dernier livre ajouté */}
      {lastBook && (
        <div className="rounded-xl p-3 mb-4 border flex gap-3 items-center" style={{
          background: "white",
          borderColor: "var(--gold-light)",
        }}>
          {/* Vignette de la jaquette — cliquable pour reprendre la photo
              si la couverture trouvée ne correspond pas au livre réel. */}
          <button
            type="button"
            onClick={() => setEditingCoverFor(lastBook)}
            aria-label="Modifier la couverture (reprendre la photo)"
            className="w-20 h-28 rounded overflow-hidden flex-shrink-0 flex items-center justify-center relative group"
            style={{ background: "var(--parchment)", border: "1px solid var(--gold-light)" }}
          >
            {lastBook.cover ? (
              <SmartImg src={lastBook.cover} alt="" className="w-full h-full" />
            ) : (
              <BookOpen className="w-6 h-6" style={{ color: "var(--leather)" }} />
            )}
            {/* Petit badge appareil photo en surimpression pour indiquer
                que la vignette est tappable. */}
            <span
              className="absolute bottom-1 right-1 rounded-full p-1 flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.65)" }}
            >
              <Camera className="w-3 h-3" style={{ color: "var(--cream)" }} />
            </span>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-xs" style={{ color: "var(--gold)" }}>
              ✓ Ajouté en position {lastBook.position}
            </div>
            {/* Titre cliquable — ouvre une modale de saisie pour corriger
                le titre si la lookup en ligne s'est trompée. */}
            <button
              type="button"
              onClick={() => setEditingTitleFor(lastBook)}
              className="text-left w-full font-medium text-sm truncate underline decoration-dotted"
              style={{ color: "var(--ink)", textUnderlineOffset: "3px" }}
              aria-label="Modifier le titre"
            >
              {lastBook.title || `ISBN ${lastBook.isbn}`}
            </button>
            {lastBook.author && (
              <div className="text-xs truncate" style={{ color: "var(--ink-soft)" }}>
                {lastBook.author}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Aide & Actions */}
      <div className="space-y-2">
        <p className="text-center text-xs" style={{ color: "var(--ink-soft)" }}>
          Pointez la caméra vers chaque code-barres. La caméra se met en pause pendant la recherche, puis reprend automatiquement.
        </p>
        {/* Bouton "Pas de code-barres" : utile pour les livres anciens, livres
            jeunesse, manuscrits, etc. qui n'ont pas d'ISBN. Crée un placeholder
            sans code et déclenche immédiatement la modale photo. */}
        <button
          onClick={handleAddWithoutISBN}
          disabled={busyRef.current || phase !== "scanning"}
          className="w-full py-3 rounded-xl font-medium border-2 flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ borderColor: "var(--parchment)", color: "var(--ink-soft)", background: "white" }}
        >
          <Camera className="w-4 h-4" /> Livre sans code-barres (photo seule)
        </button>
        <button
          onClick={onFinish}
          className="w-full py-3 rounded-xl font-medium border-2"
          style={{ borderColor: "var(--leather)", color: "var(--leather-dark)", background: "white" }}
        >
          Terminer le scan ({sessionCount} {sessionCount > 1 ? "livres" : "livre"})
        </button>
      </div>

      {/* === OVERLAY "RECHERCHE…" === */}
      {/* Affiché pendant la phase searching : la caméra reste visible derrière
          mais ne lit plus de codes-barres. L'utilisateur voit clairement que
          l'app travaille. */}
      {phase === "searching" && pendingScan && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
          style={{ background: "rgba(0,0,0,0.55)" }}
        >
          <div
            className="rounded-2xl px-6 py-5 flex items-center gap-3 shadow-lg pointer-events-auto"
            style={{ background: "var(--cream)" }}
          >
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--leather-dark)" }} />
            <div>
              <div className="font-medium" style={{ color: "var(--ink)" }}>
                Recherche en cours…
              </div>
              <div className="text-xs" style={{ color: "var(--ink-soft)" }}>
                Code <span className="font-mono">{pendingScan.code}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === MODALE DOUBLON === */}
      {/* Le code-barres scanné existe déjà dans la base ou dans la session
          courante. On bloque la caméra et on demande à l'utilisateur s'il
          veut quand même ajouter ce livre (cas d'un vrai doublon physique :
          deux exemplaires d'un même titre) ou ignorer. */}
      {phase === "duplicate" && pendingScan?.duplicateOf && (
        <DuplicateModal
          duplicateOf={pendingScan.duplicateOf}
          structure={structure}
          newLocation={{
            bibliotheque: pendingScan.placeholderBib,
            etagere: pendingScan.placeholderEtagere,
            position: pendingScan.placeholderPosition,
          }}
          onIgnore={handleDuplicateIgnore}
          onAddAnyway={handleDuplicateAddAnyway}
          onMove={handleDuplicateMove}
        />
      )}

      {/* === MODALE PHOTO FALLBACK === */}
      {/* Le livre vient d'être ajouté mais la lookup en ligne n'a pas trouvé
          de jaquette. On propose de prendre une photo de l'objet pour avoir
          au moins un visuel. */}
      {phase === "photoFallback" && pendingScan?.bookId && (
        <PhotoFallbackModal
          info={{
            bookId: pendingScan.bookId,
            isbn: pendingScan.code,
            type: pendingScan.detectedType,
            noIsbn: pendingScan.noIsbn,
            title:
              pendingScan.magazineMatch?.title ||
              pendingScan.gameMatch?.title ||
              pendingScan.trackedBook?.title ||
              pendingScan.pressMatch?.publisher || "",
          }}
          onSkip={handlePhotoFallbackSkip}
          onCapture={handlePhotoFallbackCapture}
        />
      )}

      {/* Modale de re-capture de couverture pour le dernier livre scanné.
          Réutilise PhotoFallbackModal qui sait ouvrir l'appareil photo. */}
      {editingCoverFor && (
        <PhotoFallbackModal
          info={{
            bookId: editingCoverFor.id,
            isbn: editingCoverFor.isbn,
            type: editingCoverFor.type,
            noIsbn: !editingCoverFor.isbn,
            title: editingCoverFor.title || "",
          }}
          onSkip={() => setEditingCoverFor(null)}
          onCapture={async (dataUrl) => {
            const target = editingCoverFor;
            setEditingCoverFor(null);
            const compressed = await compressImageDataUrl(dataUrl);
            if (typeof onEnrichBookById === "function" && target?.id) {
              onEnrichBookById(target.id, { cover: compressed });
            }
            // Met à jour la vignette du bandeau immédiatement
            setLastBook((curr) => curr?.id === target.id ? { ...curr, cover: compressed } : curr);
            showToast?.("Couverture mise à jour");
          }}
        />
      )}

      {/* Modale de saisie du titre au clavier pour le dernier livre scanné. */}
      {editingTitleFor && (
        <TitleEditModal
          initialTitle={editingTitleFor.title || ""}
          onCancel={() => setEditingTitleFor(null)}
          onSave={(newTitle) => {
            const target = editingTitleFor;
            setEditingTitleFor(null);
            const trimmed = (newTitle || "").trim();
            if (typeof onEnrichBookById === "function" && target?.id) {
              onEnrichBookById(target.id, { title: trimmed });
            }
            setLastBook((curr) => curr?.id === target.id ? { ...curr, title: trimmed } : curr);
            showToast?.("Titre mis à jour");
          }}
        />
      )}
    </div>
  );
}

// === MODALE FALLBACK PHOTO ===
// Affichée quand un scan rapide n'a pas réussi à récupérer de jaquette en
// ligne. Ouvre automatiquement l'appareil photo (input capture=environment) au
// montage pour que l'utilisateur puisse prendre une photo de l'objet.
// Sur iOS et Android, l'input file avec capture déclenche la caméra système,
// qui inclut nativement les guides de cadrage / mode document si l'utilisateur
// l'active dans son appli appareil photo.
function PhotoFallbackModal({ info, onSkip, onCapture }) {
  const fileRef = useRef(null);
  const [opened, setOpened] = useState(false);
  // Garde anti-double-capture : une fois qu'un fichier est choisi et que
  // onCapture commence à tourner, on bloque toute nouvelle invocation.
  const capturingRef = useRef(false);

  // Au montage : déclenche automatiquement l'ouverture de la caméra système.
  // On laisse un petit délai pour que la modale ait le temps de s'afficher,
  // sinon iOS peut bloquer l'ouverture de l'input (perception de geste manquant).
  useEffect(() => {
    const t = setTimeout(() => {
      fileRef.current?.click();
      setOpened(true);
    }, 150);
    return () => clearTimeout(t);
  }, []);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      // L'utilisateur a annulé la prise de photo — on garde la modale ouverte
      // au cas où il veut réessayer, mais on permet aussi de passer.
      return;
    }
    // Évite tout double traitement (ex. iOS qui rappelle onChange ou
    // double-tap utilisateur en cours d'upload).
    if (capturingRef.current) return;
    capturingRef.current = true;
    const reader = new FileReader();
    reader.onload = (ev) => onCapture(ev.target.result);
    reader.readAsDataURL(file);
  };

  const typeLabel =
    info.type === "jeu-switch" ? "le jeu Switch" :
    info.type === "jeu-societe" ? "la boîte du jeu" :
    info.type === "revue" ? "la couverture de la revue" :
    "la couverture";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: "var(--cream)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Camera className="w-6 h-6" style={{ color: "var(--leather-dark)" }} />
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", color: "var(--ink)" }}>
            {info.noIsbn ? "Livre sans code-barres" : "Pas de jaquette trouvée"}
          </h3>
        </div>
        <p className="text-sm mb-3" style={{ color: "var(--ink)" }}>
          {info.noIsbn
            ? <>Photographiez la jaquette du livre. Vous pourrez compléter le titre, l'auteur et les autres infos depuis la fiche détail après la session de scan.</>
            : info.title
              ? <><strong>{info.title}</strong> n'a pas de jaquette en ligne.</>
              : <>L'objet scanné (code <strong>{info.isbn}</strong>) n'a pas de jaquette en ligne.</>}
        </p>
        <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
          {info.noIsbn
            ? <>Cadrez bien la couverture, l'image sera automatiquement réduite avant l'enregistrement.</>
            : <>Prenez {typeLabel} en photo pour avoir un visuel. Cadrez bien l'objet, l'image sera automatiquement réduite avant l'enregistrement.</>}
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          className="hidden"
        />

        <button
          onClick={() => fileRef.current?.click()}
          className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 mb-2"
          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
        >
          <Camera className="w-5 h-5" /> {opened ? "Prendre la photo de la jaquette" : "Ouvrir l'appareil photo"}
        </button>

        <button
          onClick={onSkip}
          className="w-full py-3 rounded-xl font-medium border-2"
          style={{ borderColor: "var(--parchment)", color: "var(--ink-soft)", background: "white" }}
        >
          Passer (continuer le scan)
        </button>
      </div>
    </div>
  );
}

// === MODALE D'ÉDITION RAPIDE DU TITRE ===
// Permet de corriger au clavier le titre du dernier livre scanné directement
// depuis le bandeau d'aperçu, sans interrompre la session de scan.
// Le focus est mis automatiquement sur le champ et le texte présélectionné,
// pour que l'utilisateur puisse taper directement par-dessus.
function TitleEditModal({ initialTitle, onCancel, onSave }) {
  const [value, setValue] = useState(initialTitle || "");
  const inputRef = useRef(null);

  useEffect(() => {
    // Focus automatique au montage + sélection du texte existant
    const t = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSave(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: "var(--cream)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Edit2 className="w-5 h-5" style={{ color: "var(--leather-dark)" }} />
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", color: "var(--ink)" }}>
            Corriger le titre
          </h3>
        </div>
        <p className="text-sm mb-3" style={{ color: "var(--ink-soft)" }}>
          Saisissez le bon titre du dernier objet ajouté.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Titre du livre"
          className="w-full px-3 py-3 rounded-lg border-2 text-base mb-4"
          style={{
            borderColor: "var(--gold-light)",
            background: "white",
            color: "var(--ink)",
            fontFamily: "var(--font-display)",
          }}
        />
        <button
          onClick={() => onSave(value)}
          className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 mb-2"
          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
        >
          <Check className="w-5 h-5" /> Enregistrer
        </button>
        <button
          onClick={onCancel}
          className="w-full py-3 rounded-xl font-medium border-2"
          style={{ borderColor: "var(--parchment)", color: "var(--ink-soft)", background: "white" }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// === MODALE DOUBLON ===
// Affichée quand un code-barres scanné correspond à un livre déjà présent
// dans la bibliothèque (même ISBN, peu importe l'emplacement). Bloque la
// caméra et demande à l'utilisateur s'il veut quand même ajouter (cas d'un
// vrai second exemplaire physique) ou ignorer.
function DuplicateModal({ duplicateOf, structure, newLocation, onIgnore, onAddAnyway, onMove }) {
  // Trouve le nom de la bibliothèque où se trouve déjà l'objet
  const bib = structure?.bibliotheques?.find((b) => b.id === duplicateOf.bibliotheque);
  // Pour le bouton "Déplacer", afficher la cible
  const newBib = newLocation
    ? structure?.bibliotheques?.find((b) => b.id === newLocation.bibliotheque)
    : null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: "var(--cream)" }}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-6 h-6" style={{ color: "var(--leather-dark)" }} />
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", color: "var(--ink)" }}>
            Déjà dans votre bibliothèque
          </h3>
        </div>

        {/* Aperçu du livre déjà existant */}
        <div className="flex gap-3 mb-4 p-2 rounded-lg" style={{ background: "var(--parchment)" }}>
          {duplicateOf.cover ? (
            <SmartImg
              src={duplicateOf.cover}
              alt=""
              className="w-12 h-16 rounded"
              style={{ background: "var(--cream)" }}
            />
          ) : (
            <div
              className="w-12 h-16 rounded flex items-center justify-center"
              style={{ background: "var(--cream)" }}
            >
              <BookOpen className="w-5 h-5" style={{ color: "var(--ink-soft)" }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate" style={{ color: "var(--ink)" }}>
              {duplicateOf.title || <em>(sans titre)</em>}
            </div>
            {duplicateOf.author && (
              <div className="text-xs truncate" style={{ color: "var(--ink-soft)" }}>
                {duplicateOf.author}
              </div>
            )}
            <div className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
              {bib?.nom || "?"} · étagère {duplicateOf.etagere} · pos. {duplicateOf.position}
            </div>
          </div>
        </div>

        <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
          Ce code-barres est déjà utilisé. Trois choix :
          <br />• <strong>Ignorer</strong> si c'est vraiment le même livre déjà saisi.
          <br />• <strong>Déplacer ici</strong> si vous rangez ce livre à un nouvel emplacement.
          <br />• <strong>Ajouter comme nouveau</strong> pour les revues (Historia, Pomme d'Api…) où chaque numéro partage le même code-barres.
        </p>

        <div className="space-y-2">
          <button
            onClick={onIgnore}
            className="w-full py-3 rounded-xl font-medium"
            style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
          >
            Ignorer (passer au suivant)
          </button>
          {onMove && newLocation && (
            <button
              onClick={onMove}
              className="w-full py-3 rounded-xl font-medium border-2"
              style={{ borderColor: "var(--leather)", color: "var(--leather-dark)", background: "white" }}
            >
              Déplacer ici{newBib ? ` (${newBib.nom} · ét. ${newLocation.etagere} · pos. ${newLocation.position})` : ""}
            </button>
          )}
          <button
            onClick={onAddAnyway}
            className="w-full py-3 rounded-xl font-medium border-2"
            style={{ borderColor: "var(--leather)", color: "var(--leather-dark)", background: "white" }}
          >
            Ajouter comme nouveau
          </button>
        </div>
      </div>
    </div>
  );
}


function EditView({ books, book, structure, navigationIds, allBooks, onCancel, onSave, onSelectBook }) {
  const formRef = useRef(null);
  const [isDirty, setIsDirty] = useState(false);
  // Action en attente quand l'utilisateur tente de quitter avec des
  // modifications non enregistrées : "back" | "prev" | "next" | null
  const [pendingNav, setPendingNav] = useState(null);

  const currentIndex = navigationIds ? navigationIds.indexOf(book.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < (navigationIds?.length || 0) - 1;

  // Effectue l'action de navigation demandée (sans confirmation supplémentaire).
  const performNav = (action) => {
    if (action === "back") onCancel();
    else if (action === "prev" && hasPrev) {
      const target = allBooks.find((b) => b.id === navigationIds[currentIndex - 1]);
      if (target) onSelectBook(target);
    }
    else if (action === "next" && hasNext) {
      const target = allBooks.find((b) => b.id === navigationIds[currentIndex + 1]);
      if (target) onSelectBook(target);
    }
  };

  // Tentative de navigation : si modifié, on ouvre la modale de confirmation,
  // sinon on part directement.
  const tryNav = (action) => {
    if (isDirty) setPendingNav(action);
    else performNav(action);
  };

  const handleSaveTop = () => {
    if (formRef.current?.canSubmit()) formRef.current.submit();
  };

  // Réponses possibles à la modale "modifications non enregistrées" :
  //   - Enregistrer : on déclenche le submit, qui appellera onSave puis
  //     fera revenir à la vue détail (réinitialisant la nav). On annule
  //     pendingNav pour ne pas re-naviguer ensuite.
  //   - Annuler les modifs : on quitte l'édition selon l'action demandée
  //     sans sauvegarder (les changements en mémoire sont perdus).
  //   - Continuer à modifier : on ferme juste la modale.
  const confirmSaveAndNav = () => {
    setPendingNav(null);
    if (formRef.current?.canSubmit()) formRef.current.submit();
  };
  const confirmDiscardAndNav = () => {
    const action = pendingNav;
    setPendingNav(null);
    performNav(action);
  };

  return (
    <div>
      {/* Barre du haut sur deux niveaux : Retour à gauche, puis Préc/Enregistrer/Suiv
          centrés sous une ligne propre, pour ne pas comprimer sur mobile. */}
      <div className="mb-4">
        <button
          onClick={() => tryNav("back")}
          className="flex items-center gap-1 mb-3"
          style={{ color: "var(--leather)" }}
        >
          <ChevronRight className="w-5 h-5 rotate-180" /> Retour
        </button>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => tryNav("prev")}
            disabled={!hasPrev}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1 text-sm disabled:opacity-30"
            style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
            aria-label="Livre précédent"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            <span>Préc.</span>
          </button>
          <button
            onClick={handleSaveTop}
            className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-1 text-sm"
            style={{
              background: isDirty
                ? "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)"
                : "var(--parchment)",
              color: isDirty ? "var(--cream)" : "var(--ink-soft)",
            }}
          >
            <Save className="w-4 h-4" /> Enregistrer
          </button>
          <button
            onClick={() => tryNav("next")}
            disabled={!hasNext}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1 text-sm disabled:opacity-30"
            style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
            aria-label="Livre suivant"
          >
            <span>Suiv.</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <BookForm
        key={book.id}
        ref={formRef}
        books={books}
        structure={structure}
        initial={book}
        onCancel={onCancel}
        onSubmit={onSave}
        submitLabel="Enregistrer"
        bareMode={true}
        onDirtyChange={setIsDirty}
      />

      {/* Modale de confirmation : modifications non enregistrées */}
      {pendingNav && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "var(--cream)" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", color: "var(--ink)", marginBottom: "0.5rem" }}>
              Modifications non enregistrées
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
              Voulez-vous enregistrer ou annuler les modifications avant de quitter cette fiche ?
            </p>
            <div className="space-y-2">
              <button
                onClick={confirmSaveAndNav}
                disabled={!formRef.current?.canSubmit()}
                className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
                  color: "var(--cream)",
                }}
              >
                <Save className="w-4 h-4" /> Enregistrer
              </button>
              <button
                onClick={confirmDiscardAndNav}
                className="w-full py-3 rounded-xl font-medium border-2"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                Annuler les modifications
              </button>
              <button
                onClick={() => setPendingNav(null)}
                className="w-full py-3 rounded-xl font-medium border-2"
                style={{ borderColor: "var(--parchment)", color: "var(--ink)" }}
              >
                Continuer à modifier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// === BOUTON DE NAVIGATION DU BAS ===
function NavButton({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-4 py-1 transition-opacity"
      style={{
        color: "var(--leather-dark)",
        opacity: active ? 1 : 0.55,
      }}
    >
      {icon}
      <span className="text-xs" style={{ fontFamily: "var(--font-display)" }}>{label}</span>
    </button>
  );
}

// === VUE BIBLIOTHÈQUES — 3 NIVEAUX ===
// === VUE BIBLIOTHÈQUES — 3 NIVEAUX AVEC CRUD ===
function LibraryView({ books, structure, saveStructure, saveBooks, layout, saveLayout, showToast, onSelectBook, onFilterBib, onQuickScanShelf }) {
  const [level, setLevel] = useState("pieces"); // pieces | bibliotheques | etageres
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [selectedBib, setSelectedBib] = useState(null);
  const [editMode, setEditMode] = useState(false);
  // États pour les modales CRUD
  const [editingPiece, setEditingPiece] = useState(null); // null | "new" | piece object
  const [editingBib, setEditingBib] = useState(null);
  const [editingShelf, setEditingShelf] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { type, item, bookCount }

  // Comptes
  const countByBib = books.reduce((acc, b) => {
    if (b.bibliotheque) acc[b.bibliotheque] = (acc[b.bibliotheque] || 0) + 1;
    return acc;
  }, {});
  const countByPiece = structure.bibliotheques.reduce((acc, b) => {
    const c = countByBib[b.id] || 0;
    acc[b.pieceId] = (acc[b.pieceId] || 0) + c;
    return acc;
  }, {});

  // === ACTIONS CRUD ===
  // On utilise un "mutator" qui prend l'état actuel et retourne le nouvel état.
  // Cela garantit qu'on travaille toujours sur la version la plus récente,
  // même si plusieurs opérations s'enchaînent rapidement.
  const mutateStructure = (mutator) => {
    // Calcule le nouvel état à partir de la dernière prop reçue.
    // Note : structure est la prop, donc à jour à chaque render.
    return saveStructure(mutator(structure));
  };

  const savePiece = async (piece) => {
    await mutateStructure((curr) => {
      let newPieces;
      if (piece.id) {
        newPieces = curr.pieces.map((p) => (p.id === piece.id ? piece : p));
      } else {
        const newPiece = { ...piece, id: genId("piece") };
        newPieces = [...curr.pieces, newPiece];
      }
      return { ...curr, pieces: newPieces };
    });
    setEditingPiece(null);
    showToast(piece.id ? "Pièce modifiée" : "Pièce ajoutée");
  };

  const deletePiece = async (pieceId) => {
    const bibsToRemove = structure.bibliotheques.filter((b) => b.pieceId === pieceId).map((b) => b.id);
    await mutateStructure((curr) => ({
      pieces: curr.pieces.filter((p) => p.id !== pieceId),
      bibliotheques: curr.bibliotheques.filter((b) => b.pieceId !== pieceId),
      etageres: curr.etageres.filter((e) => !bibsToRemove.includes(e.bibId)),
    }));
    // Détacher les livres de ces bibliothèques
    const newBooks = books.map((bk) =>
      bibsToRemove.includes(bk.bibliotheque) ? { ...bk, bibliotheque: "" } : bk
    );
    await saveBooks(newBooks);
    setConfirmDelete(null);
    showToast("Pièce supprimée");
  };

  const saveBib = async (bib) => {
    let newId = null;
    await mutateStructure((curr) => {
      let newBibs, newEtageres = curr.etageres;
      if (bib.id) {
        newBibs = curr.bibliotheques.map((b) => (b.id === bib.id ? bib : b));
      } else {
        const newBib = { ...bib, id: genId("bib") };
        newId = newBib.id;
        newBibs = [...curr.bibliotheques, newBib];
        const newEt = [1, 2, 3, 4].map((n) => ({
          id: `${newBib.id}-e${n}`,
          bibId: newBib.id,
          num: n,
          nom: "",
        }));
        newEtageres = [...curr.etageres, ...newEt];
      }
      return { ...curr, bibliotheques: newBibs, etageres: newEtageres };
    });
    setEditingBib(null);
    showToast(bib.id ? "Bibliothèque modifiée" : "Bibliothèque ajoutée");
  };

  const deleteBib = async (bibId) => {
    await mutateStructure((curr) => ({
      ...curr,
      bibliotheques: curr.bibliotheques.filter((b) => b.id !== bibId),
      etageres: curr.etageres.filter((e) => e.bibId !== bibId),
    }));
    const newBooks = books.map((bk) =>
      bk.bibliotheque === bibId ? { ...bk, bibliotheque: "" } : bk
    );
    await saveBooks(newBooks);
    setConfirmDelete(null);
    showToast("Bibliothèque supprimée");
  };

  const saveShelf = async (shelf) => {
    await mutateStructure((curr) => {
      let newEtageres;
      if (shelf.id) {
        newEtageres = curr.etageres.map((e) => (e.id === shelf.id ? shelf : e));
      } else {
        const newShelf = { ...shelf, id: genId("etag") };
        newEtageres = [...curr.etageres, newShelf];
      }
      return { ...curr, etageres: newEtageres };
    });
    setEditingShelf(null);
    showToast(shelf.id ? "Étagère modifiée" : "Étagère ajoutée");
  };

  const deleteShelf = async (shelf) => {
    await mutateStructure((curr) => ({
      ...curr,
      etageres: curr.etageres.filter((e) => e.id !== shelf.id),
    }));
    const newBooks = books.map((bk) =>
      (bk.bibliotheque === shelf.bibId && bk.etagere === shelf.num) ? { ...bk, etagere: 0 } : bk
    );
    await saveBooks(newBooks);
    setConfirmDelete(null);
    showToast("Étagère supprimée");
  };

  // === MODALES PARTAGÉES ===
  const modals = (
    <>
      {editingPiece && (
        <PieceFormModal
          piece={editingPiece === "new" ? null : editingPiece}
          onCancel={() => setEditingPiece(null)}
          onSave={savePiece}
          onDelete={editingPiece !== "new" ? () => {
            const count = countByPiece[editingPiece.id] || 0;
            setConfirmDelete({ type: "piece", item: editingPiece, bookCount: count });
            setEditingPiece(null);
          } : null}
        />
      )}
      {editingBib && (
        <BibFormModal
          bib={editingBib === "new" ? null : editingBib}
          pieceId={selectedPiece}
          structure={structure}
          onCancel={() => setEditingBib(null)}
          onSave={saveBib}
          onDelete={editingBib !== "new" ? () => {
            const count = countByBib[editingBib.id] || 0;
            setConfirmDelete({ type: "bib", item: editingBib, bookCount: count });
            setEditingBib(null);
          } : null}
        />
      )}
      {editingShelf && (
        <ShelfFormModal
          shelf={editingShelf === "new" ? null : editingShelf}
          bibId={selectedBib}
          existingNums={structure.etageres.filter((e) => e.bibId === selectedBib).map((e) => e.num)}
          onCancel={() => setEditingShelf(null)}
          onSave={saveShelf}
          onDelete={editingShelf !== "new" ? () => {
            const count = books.filter((b) => b.bibliotheque === selectedBib && b.etagere === editingShelf.num).length;
            setConfirmDelete({ type: "shelf", item: editingShelf, bookCount: count });
            setEditingShelf(null);
          } : null}
        />
      )}
      {confirmDelete && (
        <ConfirmDeleteModal
          info={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (confirmDelete.type === "piece") deletePiece(confirmDelete.item.id);
            else if (confirmDelete.type === "bib") deleteBib(confirmDelete.item.id);
            else if (confirmDelete.type === "shelf") deleteShelf(confirmDelete.item);
          }}
        />
      )}
    </>
  );

  // === NIVEAU 1 : pièces ===
  if (level === "pieces") {
    return (
      <div>
        <LevelHeader
          title="Plan de la maison"
          subtitle="Disposez vos pièces"
          editMode={editMode}
          onToggleEdit={() => setEditMode(!editMode)}
          onAdd={() => setEditingPiece("new")}
          addLabel="Pièce"
        />
        <DraggableCanvas
          editMode={editMode}
          items={structure.pieces.map((p) => ({
            id: p.id,
            label: p.nom,
            sublabel: `${countByPiece[p.id] || 0} livres · ${p.etage || ""}`,
            icon: p.icon || "🏠",
            position: layout.pieces[p.id] || { x: 20, y: 20 },
          }))}
          onMove={(id, pos) => {
            saveLayout({ ...layout, pieces: { ...layout.pieces, [id]: pos } });
          }}
          onTap={(id) => {
            if (!editMode) {
              setSelectedPiece(id);
              setLevel("bibliotheques");
            }
          }}
          onLongPress={(id) => {
            const p = structure.pieces.find((x) => x.id === id);
            if (p) setEditingPiece(p);
          }}
          onSave={() => {
            setEditMode(false);
            showToast("Disposition enregistrée");
          }}
          onReset={() => {
            saveLayout({ ...layout, pieces: { ...DEFAULT_LAYOUT.pieces } });
            showToast("Disposition réinitialisée");
          }}
        />
        {modals}
      </div>
    );
  }

  // === NIVEAU 2 : bibliothèques d'une pièce ===
  if (level === "bibliotheques" && selectedPiece) {
    const piece = structure.pieces.find((p) => p.id === selectedPiece);
    if (!piece) {
      // Pièce supprimée — retour au niveau 1
      setLevel("pieces");
      setSelectedPiece(null);
      return null;
    }
    const bibsInPiece = structure.bibliotheques.filter((b) => b.pieceId === selectedPiece);

    return (
      <div>
        <Breadcrumb
          items={[
            { label: "Plan", onClick: () => { setLevel("pieces"); setEditMode(false); } },
            { label: piece.nom },
          ]}
        />
        <LevelHeader
          title={piece.nom}
          subtitle="Disposez vos bibliothèques"
          editMode={editMode}
          onToggleEdit={() => setEditMode(!editMode)}
          onAdd={() => setEditingBib("new")}
          addLabel="Bibliothèque"
        />
        {bibsInPiece.length === 0 ? (
          <EmptyState
            icon="📚"
            text="Aucune bibliothèque dans cette pièce."
            actionLabel="Ajouter une bibliothèque"
            onAction={() => setEditingBib("new")}
          />
        ) : (
          <DraggableCanvas
            editMode={editMode}
            items={bibsInPiece.map((b) => ({
              id: b.id,
              label: b.nom,
              sublabel: `${countByBib[b.id] || 0} livres`,
              icon: "📚",
              position: layout.bibliotheques[b.id] || { x: 20, y: 20 },
            }))}
            onMove={(id, pos) => {
              saveLayout({ ...layout, bibliotheques: { ...layout.bibliotheques, [id]: pos } });
            }}
            onTap={(id) => {
              if (!editMode) {
                setSelectedBib(id);
                setLevel("etageres");
              }
            }}
            onLongPress={(id) => {
              const b = structure.bibliotheques.find((x) => x.id === id);
              if (b) setEditingBib(b);
            }}
            onSave={() => {
              setEditMode(false);
              showToast("Disposition enregistrée");
            }}
            onReset={() => {
              const reset = { ...layout.bibliotheques };
              bibsInPiece.forEach((b) => {
                reset[b.id] = DEFAULT_LAYOUT.bibliotheques[b.id] || { x: 20, y: 20 };
              });
              saveLayout({ ...layout, bibliotheques: reset });
              showToast("Disposition réinitialisée");
            }}
          />
        )}
        {modals}
      </div>
    );
  }

  // === NIVEAU 3 : étagères d'une bibliothèque ===
  if (level === "etageres" && selectedBib) {
    const bib = structure.bibliotheques.find((b) => b.id === selectedBib);
    if (!bib) {
      setLevel("pieces");
      setSelectedBib(null);
      setSelectedPiece(null);
      return null;
    }
    const piece = structure.pieces.find((p) => p.id === bib.pieceId);
    const booksInBib = books.filter((b) => b.bibliotheque === selectedBib);
    const shelvesDef = structure.etageres
      .filter((e) => e.bibId === selectedBib)
      .sort((a, b) => a.num - b.num);

    // Regroupe les livres par num d'étagère
    const byShelf = booksInBib.reduce((acc, b) => {
      const shelf = b.etagere || 0;
      acc[shelf] = acc[shelf] || [];
      acc[shelf].push(b);
      return acc;
    }, {});
    Object.keys(byShelf).forEach((s) => {
      byShelf[s].sort((a, b) => (a.position || 0) - (b.position || 0));
    });

    return (
      <div>
        <Breadcrumb
          items={[
            { label: "Plan", onClick: () => setLevel("pieces") },
            { label: piece?.nom || "Pièce", onClick: () => setLevel("bibliotheques") },
            { label: bib.nom },
          ]}
        />
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 style={{
              fontFamily: "var(--font-display)",
              fontSize: "1.4rem",
              color: "var(--ink)",
              marginBottom: "0.15rem",
              lineHeight: 1.2,
            }}>
              {bib.nom}
            </h2>
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              {booksInBib.length} {booksInBib.length > 1 ? "livres" : "livre"}
              {shelvesDef.length > 0 && ` · ${shelvesDef.length} ${shelvesDef.length > 1 ? "étagères" : "étagère"}`}
            </p>
          </div>
          <button
            onClick={() => setEditingBib(bib)}
            className="px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0 flex items-center gap-1"
            style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
          >
            <Edit2 className="w-4 h-4" /> Modifier
          </button>
        </div>

        {shelvesDef.length === 0 ? (
          <EmptyState
            icon="📖"
            text="Aucune étagère définie. Ajoutez la première."
            actionLabel="Ajouter une étagère"
            onAction={() => setEditingShelf("new")}
          />
        ) : (
          <div className="space-y-5">
            {shelvesDef.map((shelfDef) => (
              <ShelfRow
                key={shelfDef.id}
                shelfNum={shelfDef.num}
                shelfName={shelfDef.nom}
                books={byShelf[shelfDef.num] || []}
                onSelectBook={onSelectBook}
                onEdit={() => setEditingShelf(shelfDef)}
                onQuickScan={onQuickScanShelf ? () => onQuickScanShelf({
                  bibliotheque: selectedBib,
                  etagere: shelfDef.num,
                }) : undefined}
              />
            ))}
          </div>
        )}

        <button
          onClick={() => setEditingShelf("new")}
          className="w-full mt-4 py-3 rounded-xl font-medium border-2 border-dashed flex items-center justify-center gap-2"
          style={{ borderColor: "var(--leather)", color: "var(--leather)", background: "transparent" }}
        >
          <Plus className="w-4 h-4" /> Ajouter une étagère
        </button>

        <button
          onClick={() => onFilterBib(selectedBib)}
          className="w-full mt-3 py-3 rounded-xl font-medium border-2 flex items-center justify-center gap-2"
          style={{ borderColor: "var(--leather)", color: "var(--leather-dark)", background: "white" }}
        >
          <Library className="w-4 h-4" /> Voir les livres en liste
        </button>

        {modals}
      </div>
    );
  }

  return null;
}

// === ÉTAT VIDE ===
function EmptyState({ icon, text, actionLabel, onAction }) {
  return (
    <div className="text-center py-10 px-4 rounded-xl border-2 border-dashed" style={{
      borderColor: "var(--parchment)",
      background: "white",
    }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>{icon}</div>
      <p className="mb-4" style={{ color: "var(--ink-soft)" }}>{text}</p>
      <button
        onClick={onAction}
        className="px-4 py-2 rounded-lg font-medium inline-flex items-center gap-1.5"
        style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
      >
        <Plus className="w-4 h-4" /> {actionLabel}
      </button>
    </div>
  );
}

// === MODALE FORMULAIRE PIÈCE ===
function PieceFormModal({ piece, onCancel, onSave, onDelete }) {
  const [nom, setNom] = useState(piece?.nom || "");
  const [etage, setEtage] = useState(piece?.etage || "RDC");
  const [icon, setIcon] = useState(piece?.icon || "🏠");
  const isEditing = !!piece;

  return (
    <ModalShell title={isEditing ? "Modifier la pièce" : "Ajouter une pièce"} onCancel={onCancel}>
      <Field label="Nom *">
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          autoFocus
          placeholder="Cuisine, Bureau, Chambre…"
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>
      <Field label="Étage">
        <input
          value={etage}
          onChange={(e) => setEtage(e.target.value)}
          placeholder="RDC, 1er, 2ème…"
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>
      <Field label="Icône">
        <div className="grid grid-cols-8 gap-1.5">
          {ICON_CHOICES.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setIcon(emoji)}
              className="aspect-square rounded-lg text-xl flex items-center justify-center"
              style={{
                background: icon === emoji ? "var(--gold-light)" : "var(--parchment)",
                border: icon === emoji ? "2px solid var(--leather)" : "2px solid transparent",
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </Field>
      <ModalActions
        onCancel={onCancel}
        onSave={() => nom.trim() && onSave({
          ...(piece || {}),
          nom: nom.trim(),
          etage: etage.trim(),
          icon,
        })}
        onDelete={onDelete}
        canSave={!!nom.trim()}
      />
    </ModalShell>
  );
}

// === MODALE FORMULAIRE BIBLIOTHÈQUE ===
function BibFormModal({ bib, pieceId, structure, onCancel, onSave, onDelete }) {
  const [nom, setNom] = useState(bib?.nom || "");
  const [pieceIdState, setPieceIdState] = useState(bib?.pieceId || pieceId || structure.pieces[0]?.id || "");
  const isEditing = !!bib;

  return (
    <ModalShell title={isEditing ? "Modifier la bibliothèque" : "Ajouter une bibliothèque"} onCancel={onCancel}>
      <Field label="Nom *">
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          autoFocus
          placeholder="Salon — Murale, Cuisine — Coin lecture…"
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>
      <Field label="Pièce">
        <select
          value={pieceIdState}
          onChange={(e) => setPieceIdState(e.target.value)}
          className="w-full p-3 rounded-lg border-2 outline-none bg-white"
          style={{ borderColor: "var(--parchment)" }}
        >
          {structure.pieces.map((p) => (
            <option key={p.id} value={p.id}>{p.nom}</option>
          ))}
        </select>
      </Field>
      <ModalActions
        onCancel={onCancel}
        onSave={() => nom.trim() && pieceIdState && onSave({
          ...(bib || {}),
          nom: nom.trim(),
          pieceId: pieceIdState,
        })}
        onDelete={onDelete}
        canSave={!!nom.trim() && !!pieceIdState}
      />
    </ModalShell>
  );
}

// === MODALE FORMULAIRE ÉTAGÈRE ===
function ShelfFormModal({ shelf, bibId, existingNums, onCancel, onSave, onDelete }) {
  const nextNum = existingNums.length === 0 ? 1 : Math.max(...existingNums) + 1;
  const [num, setNum] = useState(shelf?.num?.toString() || nextNum.toString());
  const [nom, setNom] = useState(shelf?.nom || "");
  const isEditing = !!shelf;

  const numInt = parseInt(num) || 0;
  const isDuplicate = !isEditing && existingNums.includes(numInt);

  return (
    <ModalShell title={isEditing ? `Étagère ${shelf.num}` : "Ajouter une étagère"} onCancel={onCancel}>
      <Field label="Numéro (ordre du haut vers le bas) *">
        <input
          type="number"
          min="1"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          autoFocus
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: isDuplicate ? "var(--accent)" : "var(--parchment)" }}
        />
        {isDuplicate && (
          <p className="text-xs mt-1" style={{ color: "var(--accent)" }}>
            Une étagère porte déjà ce numéro.
          </p>
        )}
      </Field>
      <Field label="Nom (optionnel)">
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="BD, Romans, Voyage…"
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>
      <ModalActions
        onCancel={onCancel}
        onSave={() => numInt > 0 && !isDuplicate && onSave({
          ...(shelf || {}),
          bibId,
          num: numInt,
          nom: nom.trim(),
        })}
        onDelete={onDelete}
        canSave={numInt > 0 && !isDuplicate}
      />
    </ModalShell>
  );
}

// === MODALE DE CONFIRMATION DE SUPPRESSION ===
function ConfirmDeleteModal({ info, onCancel, onConfirm }) {
  const labels = {
    piece: "cette pièce",
    bib: "cette bibliothèque",
    shelf: "cette étagère",
  };
  const target = labels[info.type] || "cet élément";
  const itemName = info.item.nom || (info.type === "shelf" ? `Étagère ${info.item.num}` : "Sans nom");

  return (
    <ModalShell title="Confirmer la suppression" onCancel={onCancel}>
      <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: "rgba(139, 44, 44, 0.08)" }}>
        <AlertTriangle className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
        <div>
          <p className="font-medium" style={{ color: "var(--ink)" }}>
            Supprimer {target} : {itemName} ?
          </p>
          {info.bookCount > 0 && (
            <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
              {info.bookCount} {info.bookCount > 1 ? "livres concernés seront détachés" : "livre concerné sera détaché"} de leur emplacement (vous pourrez les replacer ensuite). Les livres ne sont pas supprimés.
            </p>
          )}
          {info.type === "piece" && (
            <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
              Toutes les bibliothèques et étagères contenues seront aussi supprimées.
            </p>
          )}
          {info.type === "bib" && (
            <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
              Toutes les étagères de cette bibliothèque seront aussi supprimées.
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl border-2 font-medium"
          style={{ borderColor: "var(--parchment)", color: "var(--ink)" }}
        >
          Annuler
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-3 rounded-xl font-medium"
          style={{ background: "var(--accent)", color: "var(--cream)" }}
        >
          Supprimer
        </button>
      </div>
    </ModalShell>
  );
}

// === SHELL DE MODALE ===
function ModalShell({ title, onCancel, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-full max-w-sm rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--cream)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", color: "var(--ink)" }}>
            {title}
          </h3>
          <button onClick={onCancel} className="p-1" style={{ color: "var(--ink-soft)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          {children}
        </div>
      </div>
    </div>
  );
}

// === BOUTONS D'ACTION DE MODALE ===
function ModalActions({ onCancel, onSave, onDelete, canSave }) {
  return (
    <div className="space-y-2 mt-2">
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl border-2 font-medium"
          style={{ borderColor: "var(--parchment)", color: "var(--ink)" }}
        >
          Annuler
        </button>
        <button
          onClick={onSave}
          disabled={!canSave}
          className="flex-1 py-3 rounded-xl font-medium disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
            color: "var(--cream)",
          }}
        >
          Enregistrer
        </button>
      </div>
      {onDelete && (
        <button
          onClick={onDelete}
          className="w-full py-2.5 rounded-xl border-2 font-medium flex items-center justify-center gap-2 text-sm"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          <Trash2 className="w-4 h-4" /> Supprimer
        </button>
      )}
    </div>
  );
}


// === HEADER DE NIVEAU AVEC TOGGLE ÉDITION ET BOUTON D'AJOUT ===
function LevelHeader({ title, subtitle, editMode, onToggleEdit, onAdd, addLabel }) {
  return (
    <div className="flex items-start justify-between gap-2 mb-4">
      <div className="min-w-0 flex-1">
        <h2 style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.4rem",
          color: "var(--ink)",
          marginBottom: "0.15rem",
          lineHeight: 1.2,
        }}>
          {title}
        </h2>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>{subtitle}</p>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">
        {onAdd && !editMode && (
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
            title={`Ajouter ${addLabel || ""}`}
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onToggleEdit}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
          style={{
            background: editMode ? "var(--gold-light)" : "var(--parchment)",
            color: "var(--leather-dark)",
          }}
        >
          {editMode ? <><Check className="w-4 h-4" /> OK</> : <><Move className="w-4 h-4" /> Disposer</>}
        </button>
      </div>
    </div>
  );
}

// === FIL D'ARIANE ===
function Breadcrumb({ items }) {
  return (
    <div className="flex items-center gap-1 mb-3 text-sm flex-wrap">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight className="w-4 h-4" style={{ color: "var(--ink-soft)" }} />}
          {item.onClick ? (
            <button
              onClick={item.onClick}
              style={{ color: "var(--leather)", fontWeight: 500 }}
            >
              {item.label}
            </button>
          ) : (
            <span style={{ color: "var(--ink)", fontWeight: 600 }}>{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// === CANVAS DRAG-AND-DROP ===
function DraggableCanvas({ editMode, items, onMove, onTap, onLongPress, onSave, onReset }) {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(null); // { id, offsetX, offsetY }
  // Pour le tap-vs-drag : on retient si on a vraiment bougé
  const [dragMoved, setDragMoved] = useState(false);
  // Long-press : timer ref
  const longPressTimer = useRef(null);

  const ITEM_WIDTH = 110;
  const ITEM_HEIGHT = 110;

  // Calcule les bornes du canvas pour le sizing
  const maxX = Math.max(0, ...items.map((it) => it.position.x + ITEM_WIDTH));
  const maxY = Math.max(0, ...items.map((it) => it.position.y + ITEM_HEIGHT));
  // Hauteur min raisonnable
  const canvasHeight = Math.max(420, maxY + 30);

  const getEventPoint = (e) => {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  };

  const handleStart = (e, item) => {
    if (!editMode) return;
    const point = getEventPoint(e);
    const rect = canvasRef.current.getBoundingClientRect();
    setDragging({
      id: item.id,
      offsetX: point.x - rect.left - item.position.x,
      offsetY: point.y - rect.top - item.position.y,
    });
    setDragMoved(false);
  };

  const handleMove = (e) => {
    if (!dragging || !canvasRef.current) return;
    e.preventDefault();
    const point = getEventPoint(e);
    const rect = canvasRef.current.getBoundingClientRect();
    let x = point.x - rect.left - dragging.offsetX;
    let y = point.y - rect.top - dragging.offsetY;
    // Bornes
    x = Math.max(0, Math.min(rect.width - ITEM_WIDTH, x));
    y = Math.max(0, Math.min(canvasHeight - ITEM_HEIGHT, y));
    onMove(dragging.id, { x: Math.round(x), y: Math.round(y) });
    setDragMoved(true);
  };

  const handleEnd = () => {
    setDragging(null);
    setTimeout(() => setDragMoved(false), 50);
  };

  // Listeners globaux pendant le drag
  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e) => handleMove(e);
    const onTouchMove = (e) => handleMove(e);
    const onUp = () => handleEnd();
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onUp);
    };
  }, [dragging]);

  return (
    <div>
      <div
        ref={canvasRef}
        className="relative rounded-xl border-2 overflow-hidden"
        style={{
          background: editMode
            ? "repeating-linear-gradient(0deg, var(--parchment) 0 1px, transparent 1px 30px), repeating-linear-gradient(90deg, var(--parchment) 0 1px, transparent 1px 30px), var(--cream)"
            : "linear-gradient(135deg, var(--cream) 0%, var(--parchment) 100%)",
          borderColor: editMode ? "var(--gold-light)" : "var(--parchment)",
          height: `${canvasHeight}px`,
          touchAction: editMode ? "none" : "auto",
        }}
      >
        {items.map((item) => {
          const isDragging = dragging?.id === item.id;
          return (
            <div
              key={item.id}
              className="absolute"
              style={{
                left: `${item.position.x}px`,
                top: `${item.position.y}px`,
                width: `${ITEM_WIDTH}px`,
                height: `${ITEM_HEIGHT}px`,
              }}
            >
              <button
                onMouseDown={(e) => handleStart(e, item)}
                onTouchStart={(e) => handleStart(e, item)}
                onClick={(e) => {
                  if (dragMoved) {
                    e.preventDefault();
                    return;
                  }
                  if (!editMode) onTap(item.id);
                }}
                className="w-full h-full flex flex-col items-center justify-center text-center p-2 rounded-xl shadow-md transition-shadow"
                style={{
                  background: isDragging
                    ? "var(--gold-light)"
                    : editMode
                    ? "white"
                    : "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
                  color: isDragging ? "var(--leather-dark)" : editMode ? "var(--ink)" : "var(--cream)",
                  border: editMode ? "2px dashed var(--leather)" : "1px solid var(--gold)",
                  cursor: editMode ? "grab" : "pointer",
                  boxShadow: isDragging
                    ? "0 8px 20px rgba(74, 35, 10, 0.35)"
                    : "0 2px 6px var(--shadow-warm)",
                  transform: isDragging ? "scale(1.05)" : "scale(1)",
                  transition: isDragging ? "none" : "transform 0.15s, background 0.2s",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  touchAction: "none",
                }}
              >
                <div style={{ fontSize: "1.6rem", marginBottom: "0.15rem" }}>{item.icon}</div>
                <div style={{
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  fontFamily: "var(--font-display)",
                  lineHeight: 1.15,
                  marginBottom: "0.1rem",
                }}>
                  {item.label}
                </div>
                <div style={{
                  fontSize: "0.65rem",
                  opacity: 0.85,
                  lineHeight: 1.1,
                }}>
                  {item.sublabel}
                </div>
              </button>

              {/* Petit bouton crayon en haut à droite, visible hors mode édition */}
              {!editMode && onLongPress && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onLongPress(item.id);
                  }}
                  className="absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center shadow-md"
                  style={{
                    background: "var(--gold-light)",
                    color: "var(--leather-dark)",
                    border: "2px solid var(--cream)",
                  }}
                  aria-label="Modifier"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--ink-soft)" }}>
            Aucun élément à afficher
          </div>
        )}
      </div>

      {editMode && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={onReset}
            className="flex-1 py-2.5 rounded-lg border-2 text-sm font-medium flex items-center justify-center gap-1.5"
            style={{ borderColor: "var(--parchment)", color: "var(--ink-soft)" }}
          >
            <RotateCcw className="w-4 h-4" /> Réinitialiser
          </button>
          <button
            onClick={onSave}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
            style={{
              background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
              color: "var(--cream)",
            }}
          >
            <Save className="w-4 h-4" /> Enregistrer
          </button>
        </div>
      )}

      {!editMode && (
        <p className="text-xs text-center mt-3" style={{ color: "var(--ink-soft)" }}>
          Tap pour entrer · ✏️ pour modifier · « Disposer » pour réorganiser
        </p>
      )}
    </div>
  );
}

// === ÉTAGÈRE (vue niveau 3) ===
function ShelfRow({ shelfNum, shelfName, books, onSelectBook, onEdit, onQuickScan }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1" style={{
          background: "var(--leather-dark)",
          color: "var(--gold-light)",
          fontFamily: "var(--font-display)",
        }}>
          Étagère {shelfNum}
          {shelfName && <span style={{ opacity: 0.85 }}> · {shelfName}</span>}
        </div>
        <div className="flex-1 h-px" style={{ background: "var(--parchment)" }} />
        <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
          {books.length} {books.length > 1 ? "livres" : "livre"}
        </span>
        {onQuickScan && (
          <button
            onClick={onQuickScan}
            className="p-1.5 rounded-md flex-shrink-0 flex items-center gap-1"
            style={{
              background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
              color: "var(--cream)",
            }}
            aria-label="Scanner cette étagère"
            title="Scan rapide sur cette étagère"
          >
            <Plus className="w-3.5 h-3.5" />
            <ScanLine className="w-3.5 h-3.5" />
          </button>
        )}
        {onEdit && (
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md flex-shrink-0"
            style={{ background: "var(--parchment)", color: "var(--leather-dark)" }}
            aria-label="Modifier l'étagère"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Tranche d'étagère avec les livres alignés */}
      <div className="rounded-lg p-2 overflow-x-auto" style={{
        background: "linear-gradient(180deg, var(--parchment) 0%, var(--cream) 100%)",
        border: "1px solid var(--parchment)",
      }}>
        {books.length === 0 ? (
          <div className="flex items-center justify-center text-xs italic" style={{
            minHeight: "120px",
            color: "var(--ink-soft)",
          }}>
            Étagère vide
          </div>
        ) : (
          <div className="flex gap-1.5 items-end" style={{ minHeight: "120px" }}>
            {books.map((book) => (
              <button
                key={book.id}
                onClick={() => onSelectBook(book)}
                className="flex-shrink-0 rounded overflow-hidden shadow-sm relative group"
                style={{
                  width: "44px",
                  height: "110px",
                  background: book.cover ? "transparent" : `hsl(${(parseInt(book.id, 36) % 60) + 10}, 40%, 30%)`,
                }}
                title={`${book.title}${book.author ? ` — ${book.author}` : ""} (pos. ${book.position})`}
              >
                {book.cover ? (
                  <SmartImg src={book.cover} alt={book.title} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-end p-1 text-center"
                    style={{ color: "var(--cream)" }}>
                    <span style={{
                      fontSize: "0.55rem",
                      fontFamily: "var(--font-display)",
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxHeight: "100px",
                    }}>
                      {book.title}
                    </span>
                  </div>
                )}
                {/* Petit numéro de position en bas */}
                <div className="absolute bottom-0 left-0 right-0 text-center"
                  style={{
                    fontSize: "0.55rem",
                    background: "rgba(0,0,0,0.5)",
                    color: "var(--cream)",
                    padding: "1px 0",
                  }}>
                  {book.position}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// === MODALE PARAMÈTRES (export/import/enrichissement) ===
function SettingsModal({
  books,
  structure,
  onExport,
  onImport,
  onEnrichIncomplete,
  onReplaceGoogleCovers,
  onClearGoogleCovers,
  onCancelEnrich,
  enrichProgress,
  incompleteCount,
  googleCoverCount,
  authState,
  isSupabaseConfigured,
  onSignOut,
  onMigrateToCloud,
  migrating,
  onCleanEmptyBooks,
  emptyBooksCount,
  showToast,
  onClose,
}) {
  const fileRef = useRef(null);

  // === DÉTECTION DES LIVRES LOCAUX À MIGRER ===
  // Le bouton "Migrer mes livres vers la base partagée" n'est utile QUE si
  // l'utilisateur a des livres stockés dans window.storage (mode local) en
  // plus d'être connecté à un compte cloud. Sinon, c'est trompeur : l'app
  // synchronise déjà chaque ajout en live avec la BDD partagée.
  // Ce state détecte les livres locaux résiduels (typiquement laissés par une
  // session "Continuer sans compte" antérieure).
  const [localBooksCount, setLocalBooksCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (cancelled) return;
        if (result?.value) {
          const localBooks = JSON.parse(result.value);
          if (Array.isArray(localBooks)) {
            setLocalBooksCount(localBooks.length);
            return;
          }
        }
        setLocalBooksCount(0);
      } catch (e) {
        // Pas de stockage local accessible → rien à migrer
        setLocalBooksCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Statistiques par type d'objet
  const byType = {};
  for (const t of ITEM_TYPES_LIST) byType[t.id] = 0;
  for (const b of books) {
    const t = b.type || "livre";
    if (byType[t] !== undefined) byType[t]++;
    else byType.livre++;
  }
  const stats = {
    total: books.length,
    withTitle: books.filter((b) => b.title).length,
    withCover: books.filter((b) => b.cover).length,
    withoutTitle: books.filter((b) => !b.title).length,
    byType,
  };
  // Pendant l'enrichissement, on empêche la fermeture par clic extérieur
  const isRunning = !!enrichProgress;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && !isRunning && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--cream)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", color: "var(--ink)" }}>
            Paramètres
          </h3>
          <button onClick={onClose} className="p-1" style={{ color: "var(--ink-soft)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Compte / Connexion */}
        {isSupabaseConfigured && (
          <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(212, 167, 44, 0.12)", border: "1px solid var(--gold)" }}>
            <h4 className="text-sm font-bold mb-1.5 flex items-center gap-1.5" style={{ color: "var(--leather-dark)", fontFamily: "var(--font-display)" }}>
              {authState && authState !== "skipped" ? <Cloud className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
              Compte
            </h4>
            {authState && authState !== "skipped" ? (
              <>
                <p className="text-xs mb-2" style={{ color: "var(--ink)" }}>
                  Connecté à la base partagée en tant que <strong>{authState.user?.email}</strong>
                </p>
                <button
                  onClick={onSignOut}
                  className="w-full py-2 rounded-lg text-sm font-medium border-2 flex items-center justify-center gap-1.5 mb-2"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                >
                  <LogOut className="w-4 h-4" /> Se déconnecter
                </button>

                {/* Vidage du cache local des couvertures.
                    Le cache économise la bande passante Supabase en stockant
                    les images dans IndexedDB côté navigateur. Si jamais elles
                    apparaissent corrompues ou obsolètes, ce bouton force un
                    rechargement complet depuis la base au prochain démarrage. */}
                <button
                  onClick={async () => {
                    try {
                      await clearCoverCache();
                      showToast?.("Cache vidé — rechargez l'app pour retélécharger les couvertures");
                    } catch (e) {
                      showToast?.(`Erreur : ${e.message}`, "error");
                    }
                  }}
                  className="w-full py-2 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 mb-2"
                  style={{ borderColor: "var(--gold)", color: "var(--leather-dark)" }}
                >
                  Vider le cache local des couvertures
                </button>

                {/* Bouton de migration des livres locaux vers la base partagée.
                    Affiché si window.storage contient des livres, OU si le
                    state `books` contient des livres potentiellement non
                    synchronisés (cas d'un import JSON après connexion).
                    L'anti-doublons côté handleMigrateToCloud évitera de
                    réinsérer ce qui est déjà en base. */}
                {(localBooksCount > 0 || books.length > 0) && (
                  <div className="pt-2 border-t" style={{ borderColor: "var(--gold)" }}>
                    {migrating ? (
                      <div className="space-y-2">
                        <div className="text-xs flex justify-between" style={{ color: "var(--ink)" }}>
                          <span>Migration en cours…</span>
                          <span><strong>{migrating.current}</strong> / {migrating.total}</span>
                        </div>
                        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--parchment)" }}>
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${(migrating.current / migrating.total) * 100}%`,
                              background: "linear-gradient(90deg, var(--gold) 0%, var(--gold-light) 100%)",
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs mb-2" style={{ color: "var(--ink)" }}>
                          {localBooksCount > 0 ? (
                            <><strong>{localBooksCount} livre{localBooksCount > 1 ? "s" : ""}</strong> {localBooksCount > 1 ? "sont stockés" : "est stocké"} sur cet appareil (hors base partagée), probablement avant votre connexion. {localBooksCount > 1 ? "Migrez-les" : "Migrez-le"} pour {localBooksCount > 1 ? "les" : "le"} rendre accessible{localBooksCount > 1 ? "s" : ""} à toute la famille.</>
                          ) : (
                            <>Forcer l'envoi vers la base partagée des <strong>{books.length} objet{books.length > 1 ? "s" : ""}</strong> actuellement affiché{books.length > 1 ? "s" : ""} dans l'app. Utile après un import de sauvegarde JSON. Les doublons (même ISBN) déjà présents en base seront ignorés.</>
                          )}
                        </p>
                        <button
                          onClick={onMigrateToCloud}
                          className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
                          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
                        >
                          <Upload className="w-4 h-4" /> Migrer ces livres vers la base partagée
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs" style={{ color: "var(--ink)" }}>
                Mode local — vos données restent sur cet appareil. Pour partager avec la famille, déconnectez-vous puis créez un compte au prochain démarrage.
              </p>
            )}
          </div>
        )}

        {/* Statistiques */}
        <div className="rounded-lg p-3 mb-4" style={{ background: "var(--parchment)" }}>
          <h4 className="text-sm font-bold mb-2" style={{ color: "var(--leather-dark)", fontFamily: "var(--font-display)" }}>
            Statistiques
          </h4>
          <div className="text-sm space-y-1" style={{ color: "var(--ink)" }}>
            <div className="flex justify-between">
              <span>Total d'objets</span>
              <strong>{stats.total}</strong>
            </div>
            {/* Répartition par type — ne s'affiche que pour les types présents */}
            {ITEM_TYPES_LIST.map((t) => stats.byType[t.id] > 0 && (
              <div key={t.id} className="flex justify-between pl-3 text-xs" style={{ color: "var(--ink-soft)" }}>
                <span>{t.emoji} {t.pluralLabel}</span>
                <span>{stats.byType[t.id]}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1 mt-1 border-t" style={{ borderColor: "rgba(0,0,0,0.1)" }}>
              <span>Avec titre</span>
              <strong>{stats.withTitle} ({stats.total > 0 ? Math.round(stats.withTitle / stats.total * 100) : 0}%)</strong>
            </div>
            <div className="flex justify-between">
              <span>Avec couverture</span>
              <strong>{stats.withCover} ({stats.total > 0 ? Math.round(stats.withCover / stats.total * 100) : 0}%)</strong>
            </div>
            {stats.withoutTitle > 0 && (
              <div className="flex justify-between" style={{ color: "var(--accent)" }}>
                <span>Sans titre (à compléter)</span>
                <strong>{stats.withoutTitle}</strong>
              </div>
            )}
            <div className="flex justify-between pt-1 mt-1 border-t" style={{ borderColor: "rgba(0,0,0,0.1)" }}>
              <span>Pièces / Bibliothèques / Étagères</span>
              <strong>{structure.pieces.length} / {structure.bibliotheques.length} / {structure.etageres.length}</strong>
            </div>
          </div>
        </div>

        {/* Re-recherche des livres incomplets */}
        <div className="mb-4">
          <h4 className="text-sm font-bold mb-2" style={{ color: "var(--leather-dark)", fontFamily: "var(--font-display)" }}>
            Compléter les livres incomplets
          </h4>
          <p className="text-xs mb-2" style={{ color: "var(--ink-soft)" }}>
            Relance la recherche en ligne pour les livres qui ont un ISBN mais à qui il manque le titre, l'auteur ou la couverture. Utile après une mise à jour des sources de données.
          </p>

          {!enrichProgress && (
            <>
              <button
                onClick={onEnrichIncomplete}
                disabled={incompleteCount === 0}
                className="w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
              >
                <RotateCcw className="w-5 h-5" />
                {incompleteCount === 0
                  ? "Aucun livre à compléter"
                  : `Re-rechercher (${incompleteCount} livre${incompleteCount > 1 ? "s" : ""})`}
              </button>
              {incompleteCount > 0 && (
                <p className="text-xs mt-1.5" style={{ color: "var(--ink-soft)" }}>
                  Les champs déjà remplis seront préservés. Compter ~5 secondes par livre.
                </p>
              )}
            </>
          )}

          {enrichProgress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm" style={{ color: "var(--ink)" }}>
                <span>
                  {enrichProgress.current} / {enrichProgress.total}
                </span>
                <span style={{ color: "var(--leather-dark)", fontWeight: 600 }}>
                  {enrichProgress.updated} mis à jour
                </span>
              </div>
              {/* Barre de progression */}
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--parchment)" }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${(enrichProgress.current / enrichProgress.total) * 100}%`,
                    background: "linear-gradient(90deg, var(--gold) 0%, var(--gold-light) 100%)",
                  }}
                />
              </div>
              <button
                onClick={onCancelEnrich}
                className="w-full py-2 rounded-lg font-medium border-2 text-sm"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                Arrêter
              </button>
              <p className="text-xs text-center" style={{ color: "var(--ink-soft)" }}>
                Vous pouvez fermer cette fenêtre, le travail continue en arrière-plan.
              </p>
            </div>
          )}
        </div>

        {/* Section Couvertures Google Books douteuses */}
        {!enrichProgress && googleCoverCount > 0 && (
          <div className="mb-4 p-3 rounded-lg" style={{ background: "rgba(212, 167, 44, 0.15)", border: "1px solid var(--gold)" }}>
            <h4 className="text-sm font-bold mb-1" style={{ color: "var(--leather-dark)", fontFamily: "var(--font-display)" }}>
              ⚠️ Couvertures Google Books
            </h4>
            <p className="text-xs mb-3" style={{ color: "var(--ink)" }}>
              {googleCoverCount} livre{googleCoverCount > 1 ? "s ont" : " a"} une couverture provenant de Google Books. Ces images sont parfois incohérentes (édition différente, voire mauvais livre). Vous pouvez les remplacer par des sources plus fiables (Open Library, Amazon).
            </p>
            <div className="space-y-2">
              <button
                onClick={onReplaceGoogleCovers}
                className="w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-1.5"
                style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
              >
                <RotateCcw className="w-4 h-4" />
                Remplacer par sources fiables ({googleCoverCount})
              </button>
              <button
                onClick={onClearGoogleCovers}
                className="w-full py-2 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 border-2"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer toutes les couvertures Google
              </button>
            </div>
          </div>
        )}

        {/* Section Nettoyage des livres vides */}
        {!enrichProgress && emptyBooksCount > 0 && (
          <div className="mb-4 p-3 rounded-lg" style={{ background: "rgba(139, 44, 44, 0.1)", border: "1px solid var(--accent)" }}>
            <h4 className="text-sm font-bold mb-1" style={{ color: "var(--accent)", fontFamily: "var(--font-display)" }}>
              🧹 Livres vides
            </h4>
            <p className="text-xs mb-3" style={{ color: "var(--ink)" }}>
              {emptyBooksCount} livre{emptyBooksCount > 1 ? "s sont" : " est"} totalement vide{emptyBooksCount > 1 ? "s" : ""} (sans titre, ISBN, ni couverture). Vous pouvez les supprimer en un tap.
            </p>
            <button
              onClick={onCleanEmptyBooks}
              className="w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-1.5"
              style={{ background: "var(--accent)", color: "var(--cream)" }}
            >
              <Trash2 className="w-4 h-4" />
              Supprimer les livres vides ({emptyBooksCount})
            </button>
          </div>
        )}

        {/* Export */}
        <div className="mb-4">
          <h4 className="text-sm font-bold mb-2" style={{ color: "var(--leather-dark)", fontFamily: "var(--font-display)" }}>
            Sauvegarde
          </h4>
          <p className="text-xs mb-2" style={{ color: "var(--ink-soft)" }}>
            Télécharge un fichier JSON avec tous vos livres, bibliothèques et la disposition. À conserver dans iCloud Drive ou par email.
          </p>
          <button
            onClick={onExport}
            disabled={books.length === 0}
            className="w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
          >
            <Download className="w-5 h-5" /> Exporter ma bibliothèque
          </button>
        </div>

        {/* Import */}
        <div className="mb-4">
          <h4 className="text-sm font-bold mb-2" style={{ color: "var(--leather-dark)", fontFamily: "var(--font-display)" }}>
            Restaurer
          </h4>
          <p className="text-xs mb-2" style={{ color: "var(--ink-soft)" }}>
            Charge un fichier JSON précédemment exporté. <strong>Remplace</strong> les données actuelles.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              e.target.value = "";
            }}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full py-3 rounded-lg font-medium border-2 flex items-center justify-center gap-2"
            style={{ borderColor: "var(--leather)", color: "var(--leather-dark)" }}
          >
            <Upload className="w-5 h-5" /> Importer une sauvegarde
          </button>
        </div>

        {/* Astuce */}
        <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(212, 167, 44, 0.15)", color: "var(--ink)" }}>
          💡 <strong>Astuce</strong> : exportez régulièrement, surtout après une grande session de scan. Le fichier reste petit (typiquement 100-500 Ko pour quelques centaines de livres).
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// MA BIBLIOTHÈQUE VIRTUELLE
// Navigation : grille de catégories → rayonnage visuel (BookCard)
// ═══════════════════════════════════════════════════════════════

// Palette de couleurs par catégorie
const GENRE_COLORS = {
  "Arts & Culture":                          { bg: "#7c5c8a", text: "#f0e6f6", light: "#f0e6f6" },
  "Littérature classique":                   { bg: "#4a230a", text: "#f4ecd8", light: "#f9f0e6" },
  "Littérature classique/Romans classiques": { bg: "#5a2d0c", text: "#f4ecd8", light: "#f9f0e6" },
  "Littérature classique/Théâtre & Poésie":  { bg: "#6b3410", text: "#f4ecd8", light: "#f9f0e6" },
  "Romans adultes":                          { bg: "#8b4a1a", text: "#f4ecd8", light: "#fdf0e6" },
  "Romans adultes/Contemporain français":    { bg: "#9b5a1a", text: "#fdf6e8", light: "#fdf0e6" },
  "Romans adultes/Étranger":                 { bg: "#7a3d10", text: "#fdf6e8", light: "#fdf0e6" },
  "Romans adultes/Policier & Thriller":      { bg: "#2c2c3a", text: "#e8e8f0", light: "#f0f0f8" },
  "BD/BD adulte":                            { bg: "#d4870a", text: "#1a0a00", light: "#fff8e0" },
  "BD/BD enfant":                            { bg: "#e8a020", text: "#1a0a00", light: "#fffae0" },
  "Albums petite enfance/0 – 3 ans":         { bg: "#e8c0d0", text: "#3a1020", light: "#fff0f6" },
  "Albums petite enfance/3 – 6 ans":         { bg: "#d4a8c0", text: "#2a0818", light: "#fff0f6" },
  "Romans jeunesse/6 – 10 ans":             { bg: "#2a7a3a", text: "#e8f8ec", light: "#edfff1" },
  "Romans jeunesse/10 – 14 ans":            { bg: "#1e5c2c", text: "#e8f8ec", light: "#edfff1" },
  "Lecture scolaire CP–CM2/Méthode de lecture": { bg: "#1a6080", text: "#e0f4ff", light: "#e8f8ff" },
  "Lecture scolaire CP–CM2/Romans faciles":     { bg: "#1e7890", text: "#e0f4ff", light: "#e8f8ff" },
  "Lecture scolaire CP–CM2/Maternelle & activités": { bg: "#2890a8", text: "#e0f4ff", light: "#e8f8ff" },
  "Scolaire collège & lycée/Manuels & cahiers":     { bg: "#1c3a6e", text: "#dce8ff", light: "#eaf0ff" },
  "Scolaire collège & lycée/Révisions & examens":   { bg: "#142e58", text: "#dce8ff", light: "#eaf0ff" },
  "Musique":                                 { bg: "#5c2d6e", text: "#f0e0ff", light: "#f8f0ff" },
  "Langues étrangères":                      { bg: "#2d5c6e", text: "#e0f4ff", light: "#e8f8ff" },
  "Langues étrangères/Anglais · Espagnol · Allemand…": { bg: "#1e4a5c", text: "#e0f4ff", light: "#e8f8ff" },
  "Langues étrangères/Russe · Hébreu · Japonais…":     { bg: "#2a3d5c", text: "#e0f4ff", light: "#e8f8ff" },
  "Cuisine & Nutrition/Recettes":            { bg: "#8b2020", text: "#ffe8e8", light: "#fff0f0" },
  "Cuisine & Nutrition/Minceur & nutrition": { bg: "#6e4a20", text: "#fff0e0", light: "#fff8f0" },
  "Sciences & Nature/Animaux & nature":      { bg: "#2a5a2a", text: "#e8ffe8", light: "#f0fff0" },
  "Sciences & Nature/Corps humain & biologie": { bg: "#1e4a3a", text: "#e0fff4", light: "#edfff8" },
  "Sciences & Nature/Espace & univers":      { bg: "#1a1a3a", text: "#e0e8ff", light: "#edf0ff" },
  "Histoire & Civilisations":                { bg: "#5a4a20", text: "#fff8e0", light: "#fffcf0" },
  "Judaïsme & Shoah":                        { bg: "#1a1a2a", text: "#e8e8ff", light: "#f0f0ff" },
  "Religion & Spiritualité":                 { bg: "#4a3a6e", text: "#f0ecff", light: "#f8f4ff" },
  "Développement perso/Autisme · DYS · TDA": { bg: "#2a5a6e", text: "#e0f4ff", light: "#e8f8ff" },
  "Développement perso/Psychologie & mémoire": { bg: "#3a4a6e", text: "#e0e8ff", light: "#edf0ff" },
  "Droit & Société":                         { bg: "#2a2a4a", text: "#e8e8ff", light: "#f0f0ff" },
  "Loisirs créatifs":                        { bg: "#c04a6e", text: "#fff0f4", light: "#fff4f8" },
  "Revues & magazines":                      { bg: "#666666", text: "#f8f8f8", light: "#f4f4f4" },
  "Jeux de société":                         { bg: "#d4670a", text: "#fff4e0", light: "#fff8f0" },
  "Jeux vidéo (Switch)":                     { bg: "#cc0000", text: "#ffffff", light: "#fff0f0" },
  "À classer":                               { bg: "#aaaaaa", text: "#222222", light: "#f4f4f4" },
};

function getGenreColor(genre) {
  return GENRE_COLORS[genre] || { bg: "#6b3410", text: "#f4ecd8", light: "#fdf0e6" };
}

// Catégories principales
const MAIN_CATEGORIES = [
  { key: "Littérature classique", label: "Littérature classique", emoji: "📜", subs: ["Littérature classique/Romans classiques", "Littérature classique/Théâtre & Poésie"] },
  { key: "Romans adultes",        label: "Romans adultes",        emoji: "📖", subs: ["Romans adultes/Contemporain français", "Romans adultes/Étranger", "Romans adultes/Policier & Thriller"] },
  { key: "BD",                    label: "Bandes dessinées",      emoji: "💬", subs: ["BD/BD adulte", "BD/BD enfant"] },
  { key: "Albums petite enfance", label: "Petite enfance",        emoji: "🧸", subs: ["Albums petite enfance/0 – 3 ans", "Albums petite enfance/3 – 6 ans"] },
  { key: "Romans jeunesse",       label: "Romans jeunesse",       emoji: "🌱", subs: ["Romans jeunesse/6 – 10 ans", "Romans jeunesse/10 – 14 ans"] },
  { key: "Lecture scolaire CP–CM2", label: "Lecture scolaire",   emoji: "✏️", subs: ["Lecture scolaire CP–CM2/Méthode de lecture", "Lecture scolaire CP–CM2/Romans faciles", "Lecture scolaire CP–CM2/Maternelle & activités"] },
  { key: "Scolaire collège & lycée", label: "Collège & lycée",   emoji: "🎒", subs: ["Scolaire collège & lycée/Manuels & cahiers", "Scolaire collège & lycée/Révisions & examens"] },
  { key: "Arts & Culture",        label: "Arts & Culture",        emoji: "🎨", subs: [] },
  { key: "Musique",               label: "Musique",               emoji: "🎵", subs: [] },
  { key: "Langues étrangères",    label: "Langues étrangères",    emoji: "🌍", subs: ["Langues étrangères/Anglais · Espagnol · Allemand…", "Langues étrangères/Russe · Hébreu · Japonais…"] },
  { key: "Cuisine & Nutrition",   label: "Cuisine & Nutrition",   emoji: "🍳", subs: ["Cuisine & Nutrition/Recettes", "Cuisine & Nutrition/Minceur & nutrition"] },
  { key: "Sciences & Nature",     label: "Sciences & Nature",     emoji: "🔬", subs: ["Sciences & Nature/Animaux & nature", "Sciences & Nature/Corps humain & biologie", "Sciences & Nature/Espace & univers"] },
  { key: "Histoire & Civilisations", label: "Histoire",           emoji: "🏛️", subs: [] },
  { key: "Judaïsme & Shoah",      label: "Judaïsme & Shoah",      emoji: "✡️", subs: [] },
  { key: "Religion & Spiritualité", label: "Religion",            emoji: "🙏", subs: [] },
  { key: "Développement perso",   label: "Développement perso",   emoji: "🧠", subs: ["Développement perso/Autisme · DYS · TDA", "Développement perso/Psychologie & mémoire"] },
  { key: "Droit & Société",       label: "Droit & Société",       emoji: "⚖️", subs: [] },
  { key: "Loisirs créatifs",      label: "Loisirs créatifs",      emoji: "✂️", subs: [] },
  { key: "Revues & magazines",    label: "Revues",                emoji: "📰", subs: [] },
  { key: "Jeux de société",       label: "Jeux de société",       emoji: "🎲", subs: [] },
  { key: "Jeux vidéo (Switch)",   label: "Jeux Switch",           emoji: "🎮", subs: [] },
  { key: "À classer",             label: "À classer",             emoji: "📦", subs: [] },
];

// ── Détection de série ────────────────────────────────────────
// Extrait le préfixe de série d'un titre pour regrouper et trier
// ex: "Juliette fait du vélo" → "juliette"
//     "Ratus et ses amis" → "ratus"
//     "Le Club des cinq - tome 3" → "le club des cinq"
const KNOWN_SERIES = [
  "ratus","juliette","t'choupi","tchoupi","petit ours brun","jojo lapin",
  "martine","charlotte aux fraises","dora","tom-tom et nana","tom tom et nana",
  "oksa pollock","les petits vétérinaires","princesse academy","la cabane magique",
  "le club des cinq","astérix","lucky luke","les schtroumpfs","tintin",
  "boule et bill","gaston","iznogoud","spirou","les colombes du roi-soleil",
  "quatre soeurs","ribambelle","balthazar","super-mamie","ralette",
  "les aventures de loupio","j'aime lire","astrapi","les belles histoires",
  "popi","okapi","les petites filles modèles",
];

function getSerieKey(title) {
  if (!title) return "";
  const t = title.toLowerCase();
  for (const s of KNOWN_SERIES) {
    if (t.startsWith(s) || t.includes(s)) return s;
  }
  // Heuristique : si le titre contient un numéro (tome, n°, #, chiffre final)
  // on garde les mots avant le numéro comme clé de série
  const m = t.match(/^(.+?)\s+(?:tome|vol\.?|n°|#|\d)\s*\d/);
  if (m) return m[1].trim();
  return "";
}

function sortBySeriesThenTitle(books) {
  return [...books].sort((a, b) => {
    const sa = getSerieKey(a.title);
    const sb = getSerieKey(b.title);
    // Si même série → tri par titre complet
    if (sa && sb && sa === sb) return (a.title || "").localeCompare(b.title || "", "fr");
    // Si l'un a une série et pas l'autre → série d'abord
    if (sa && !sb) return -1;
    if (!sa && sb) return 1;
    // Deux séries différentes → tri alphabétique de la série
    if (sa && sb) return sa.localeCompare(sb, "fr");
    // Aucune série → tri alphabétique par titre
    return (a.title || "").localeCompare(b.title || "", "fr");
  });
}

// ── Helpers ───────────────────────────────────────────────────
function countForCategory(books, cat) {
  return books.filter(b => {
    const genres = b.genre || [];
    return genres.some(g => g === cat.key || g.startsWith(cat.key + "/"));
  }).length;
}

function booksForGenre(books, genre) {
  return books.filter(b => (b.genre || []).includes(genre));
}

function booksForCategory(books, cat) {
  const seen = new Set();
  const result = [];
  for (const b of books) {
    const genres = b.genre || [];
    if (genres.some(g => g === cat.key || g.startsWith(cat.key + "/"))) {
      if (!seen.has(b.id)) { seen.add(b.id); result.push(b); }
    }
  }
  return result;
}

// ── Carte livre style BookCard (même look que la vue Tous) ────
function BiblioBookCard({ book, onClick, index }) {
  const ITEM_TYPES_LOCAL = {
    "livre":      { emoji: "📚", color: "#6b3410" },
    "revue":      { emoji: "📰", color: "#2a5a6e" },
    "jeu-societe":{ emoji: "🎲", color: "#d4670a" },
    "jeu-switch": { emoji: "🎮", color: "#cc0000" },
  };
  const itemType = ITEM_TYPES_LOCAL[book.type || "livre"];
  const genre    = (book.genre || [])[0] || "À classer";
  const { bg, light } = getGenreColor(genre);
  const mainInfo = book.type === "revue" ? (book.publisher || "")
    : book.type === "jeu-switch" ? (book.platform || "")
    : (book.author || "");

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", padding: "10px 12px",
        borderRadius: "12px", display: "flex", gap: "10px",
        background: "white", border: "1px solid var(--parchment)",
        boxShadow: "0 1px 4px rgba(74,35,10,0.08)",
        cursor: "pointer", position: "relative",
        animationDelay: `${Math.min(index * 30, 300)}ms`,
      }}
    >
      {/* Badge type */}
      <div style={{
        position: "absolute", top: "6px", right: "6px",
        width: "22px", height: "22px", borderRadius: "50%",
        background: itemType?.color || "#6b3410",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "11px",
      }}>
        {itemType?.emoji}
      </div>

      {/* Couverture */}
      <div style={{
        width: "52px", minWidth: "52px", height: "72px",
        borderRadius: "4px", overflow: "hidden",
        background: light || "var(--parchment)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        boxShadow: "inset -1px 0 3px rgba(0,0,0,0.1)",
      }}>
        {book.cover
          ? <img src={book.cover} alt={book.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <span style={{ fontSize: "22px" }}>{itemType?.emoji || "📚"}</span>
        }
      </div>

      {/* Texte */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: "22px" }}>
        <div style={{
          fontFamily: "var(--font-display)", color: "var(--ink)",
          fontSize: "14px", fontWeight: "600", lineHeight: "1.3",
          marginBottom: "3px",
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {book.title || "Sans titre"}
        </div>
        {mainInfo && (
          <div style={{ fontSize: "12px", color: "var(--ink-soft)", marginBottom: "3px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {mainInfo}
          </div>
        )}
        {/* Badges genre */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginTop: "4px" }}>
          {(book.genre || []).slice(0, 2).map((g, i) => {
            const label = g.includes("/") ? g.split("/")[1] : g;
            const { bg: gbg, text: gtxt } = getGenreColor(g);
            return (
              <span key={i} style={{
                fontSize: "10px", padding: "1px 6px", borderRadius: "10px",
                background: gbg, color: gtxt, fontWeight: "500",
              }}>
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </button>
  );
}

// ── Composant principal ───────────────────────────────────────
// ── Vue étagère bois ─────────────────────────────────────────
function BookOnShelf({ book, height = 110, onClick }) {
  const genre = (book.genre || [])[0] || "À classer";
  const { bg, text } = getGenreColor(genre);

  if (book.cover) {
    const width = Math.round(height * 0.65);
    return (
      <div
        onClick={onClick}
        title={`${book.title || ""}${book.author ? " — " + book.author : ""}`}
        style={{
          width: `${width}px`, minWidth: `${width}px`, height: `${height}px`,
          borderRadius: "2px 4px 4px 2px", cursor: "pointer", overflow: "hidden",
          boxShadow: "inset -2px 0 4px rgba(0,0,0,0.2), 2px 0 5px rgba(0,0,0,0.25)",
          flexShrink: 0, transition: "transform 0.15s, box-shadow 0.15s",
          position: "relative",
        }}
        onTouchStart={e => { e.currentTarget.style.transform = "translateY(-6px)"; e.currentTarget.style.zIndex="10"; }}
        onTouchEnd={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.zIndex=""; }}
      >
        <img src={book.cover} alt={book.title}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          onError={e => { e.target.style.display = "none"; }}
        />
      </div>
    );
  }
  // Pas de couverture → dos coloré avec titre vertical
  const shortTitle = (book.title || "?").length > 22
    ? (book.title || "?").substring(0, 20) + "…"
    : (book.title || "?");
  return (
    <div
      onClick={onClick}
      title={`${book.title || ""}${book.author ? " — " + book.author : ""}`}
      style={{
        width: "28px", minWidth: "28px", height: `${height}px`,
        background: bg, borderRadius: "2px 4px 4px 2px",
        cursor: "pointer", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "4px 2px",
        boxShadow: "inset -2px 0 4px rgba(0,0,0,0.2), inset 2px 0 2px rgba(255,255,255,0.06), 2px 0 5px rgba(0,0,0,0.25)",
        position: "relative", overflow: "hidden", flexShrink: 0,
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onTouchStart={e => { e.currentTarget.style.transform = "translateY(-6px)"; e.currentTarget.style.zIndex="10"; }}
      onTouchEnd={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.zIndex=""; }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "3px",
        background: "rgba(255,255,255,0.1)", borderRadius: "2px 0 0 2px" }} />
      <div style={{
        writingMode: "vertical-rl", textOrientation: "mixed",
        transform: "rotate(180deg)", color: text,
        fontSize: "8px", fontFamily: "Georgia, serif", fontWeight: "600",
        lineHeight: 1.2, textAlign: "center",
        overflow: "hidden", maxHeight: `${height - 12}px`,
      }}>
        {shortTitle}
      </div>
    </div>
  );
}

function WoodShelf({ books, onSelectBook }) {
  const SHELF_H = 110;
  return (
    <div style={{ position: "relative", marginBottom: "14px" }}>
      {/* Ombre du dessus */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "5px",
        background: "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, transparent 100%)", zIndex: 1 }} />
      {/* Livres */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: "2px",
        padding: "6px 14px 0 14px",
        minHeight: `${SHELF_H + 6}px`,
        overflowX: "auto", overflowY: "visible",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}>
        {books.map(book => (
          <BookOnShelf key={book.id} book={book} height={SHELF_H} onClick={() => onSelectBook(book)} />
        ))}
        {books.length === 0 && (
          <div style={{ color: "var(--leather-light)", fontSize: "12px", fontStyle: "italic", padding: "8px 0" }}>
            Étagère vide
          </div>
        )}
      </div>
      {/* Planche bois */}
      <div style={{
        height: "13px", marginLeft: "6px", marginRight: "6px",
        background: "linear-gradient(180deg, #9b7520 0%, #7a5510 40%, #603d08 100%)",
        borderRadius: "0 0 2px 2px",
        boxShadow: "0 4px 8px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)",
      }} />
    </div>
  );
}

function ShelfView({ books, onSelectBook }) {
  const PER_SHELF = 16;
  const shelves = [];
  for (let i = 0; i < books.length; i += PER_SHELF) shelves.push(books.slice(i, i + PER_SHELF));
  return (
    <div style={{
      background: "linear-gradient(180deg, #ede0c4 0%, #e2d4b0 100%)",
      minHeight: "60vh", padding: "12px 0 4px", position: "relative",
    }}>
      {/* Montants latéraux */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "7px",
        background: "linear-gradient(90deg, #4a2e06 0%, #7a5510 100%)", zIndex: 2 }} />
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "7px",
        background: "linear-gradient(270deg, #4a2e06 0%, #7a5510 100%)", zIndex: 2 }} />
      {shelves.length > 0
        ? shelves.map((shelf, i) => <WoodShelf key={i} books={shelf} onSelectBook={onSelectBook} />)
        : <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--leather-light)", fontStyle: "italic" }}>
            Aucun ouvrage
          </div>
      }
      <div style={{ textAlign: "center", padding: "4px", color: "var(--leather-light)", fontSize: "11px" }}>
        {shelves.length} étagère{shelves.length > 1 ? "s" : ""} · {books.length} ouvrage{books.length > 1 ? "s" : ""}
      </div>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────
function BibliothequeView({ books, onSelectBook }) {
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedSub, setSelectedSub] = useState(null);
  const [viewMode, setViewMode] = useState("list"); // "list" | "shelves"

  const displayBooks = React.useMemo(() => {
    if (!selectedCat) return [];
    const raw = selectedSub
      ? booksForGenre(books, selectedSub)
      : booksForCategory(books, selectedCat);
    return sortBySeriesThenTitle(raw);
  }, [books, selectedCat, selectedSub]);

  // ── Grille des catégories ─────────────────────────────────
  if (!selectedCat) {
    const catsWithBooks = MAIN_CATEGORIES.filter(c => countForCategory(books, c) > 0);
    return (
      <div style={{ padding: "16px", paddingBottom: "100px" }}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", color: "var(--leather-dark)", fontSize: "20px", fontWeight: "600", margin: 0 }}>
            Ma Bibliothèque
          </h2>
          <p style={{ color: "var(--leather-light)", fontSize: "13px", margin: "4px 0 0" }}>
            {books.filter(b => b.genre && b.genre.length).length} ouvrages classifiés
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
          {catsWithBooks.map(cat => {
            const count = countForCategory(books, cat);
            const { bg, text } = getGenreColor(cat.key);
            return (
              <button key={cat.key}
                onClick={() => { setSelectedCat(cat); setSelectedSub(null); }}
                style={{
                  background: bg, color: text, border: "none", borderRadius: "10px",
                  padding: "14px 8px", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)", minHeight: "90px",
                  justifyContent: "center", textAlign: "center",
                }}
                onTouchStart={e => e.currentTarget.style.transform = "scale(0.95)"}
                onTouchEnd={e => e.currentTarget.style.transform = ""}
              >
                <span style={{ fontSize: "24px" }}>{cat.emoji}</span>
                <span style={{ fontSize: "11px", fontWeight: "600", lineHeight: "1.3", fontFamily: "var(--font-display)" }}>
                  {cat.label}
                </span>
                <span style={{ fontSize: "10px", opacity: 0.75 }}>
                  {count} {count > 1 ? "ouvrages" : "ouvrage"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Vue d'une catégorie ───────────────────────────────────
  const hasSubs    = selectedCat.subs && selectedCat.subs.length > 0;
  const activeSubs = hasSubs ? selectedCat.subs.filter(s => booksForGenre(books, s).length > 0) : [];
  const { bg: headerBg, text: headerText } = getGenreColor(selectedSub || selectedCat.key);

  return (
    <div style={{ paddingBottom: "100px" }}>
      {/* Header sticky */}
      <div style={{
        padding: "14px 16px 10px",
        background: `linear-gradient(135deg, ${headerBg} 0%, ${headerBg}dd 100%)`,
        borderBottom: "1px solid rgba(0,0,0,0.1)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Retour */}
          <button onClick={() => { setSelectedCat(null); setSelectedSub(null); }}
            style={{
              background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%",
              width: "34px", height: "34px", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: headerText, fontSize: "18px", flexShrink: 0,
            }}>←</button>

          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: "17px", fontWeight: "700",
              fontFamily: "var(--font-display)", color: headerText }}>
              {selectedCat.emoji} {selectedSub ? selectedSub.split("/")[1] : selectedCat.label}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: headerText, opacity: 0.75 }}>
              {displayBooks.length} ouvrage{displayBooks.length > 1 ? "s" : ""}
            </p>
          </div>

          {/* Toggle vue liste / étagères */}
          <div style={{ display: "flex", borderRadius: "20px", overflow: "hidden",
            background: "rgba(0,0,0,0.2)", padding: "2px", gap: "2px" }}>
            <button onClick={() => setViewMode("list")} style={{
              background: viewMode === "list" ? "rgba(255,255,255,0.9)" : "transparent",
              color: viewMode === "list" ? headerBg : headerText,
              border: "none", borderRadius: "16px", padding: "5px 10px",
              cursor: "pointer", fontSize: "15px", lineHeight: 1,
            }}>☰</button>
            <button onClick={() => setViewMode("shelves")} style={{
              background: viewMode === "shelves" ? "rgba(255,255,255,0.9)" : "transparent",
              color: viewMode === "shelves" ? headerBg : headerText,
              border: "none", borderRadius: "16px", padding: "5px 10px",
              cursor: "pointer", fontSize: "15px", lineHeight: 1,
            }}>📚</button>
          </div>
        </div>

        {/* Chips sous-catégories */}
        {activeSubs.length > 0 && (
          <div style={{ display: "flex", gap: "6px", marginTop: "10px",
            overflowX: "auto", paddingBottom: "2px" }}>
            <button onClick={() => setSelectedSub(null)} style={{
              background: !selectedSub ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
              color: !selectedSub ? headerBg : headerText,
              border: "none", borderRadius: "20px", padding: "5px 12px",
              fontSize: "11px", fontWeight: "600", cursor: "pointer",
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
              Tous ({booksForCategory(books, selectedCat).length})
            </button>
            {activeSubs.map(sub => {
              const subLabel = sub.includes("/") ? sub.split("/")[1] : sub;
              const subCount = booksForGenre(books, sub).length;
              const isActive = selectedSub === sub;
              return (
                <button key={sub} onClick={() => setSelectedSub(sub)} style={{
                  background: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
                  color: isActive ? getGenreColor(sub).bg : headerText,
                  border: "none", borderRadius: "20px", padding: "5px 12px",
                  fontSize: "11px", fontWeight: "600", cursor: "pointer",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {subLabel} ({subCount})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Contenu selon le mode */}
      {viewMode === "shelves" ? (
        <ShelfView books={displayBooks} onSelectBook={onSelectBook} />
      ) : (
        <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {displayBooks.length > 0 ? displayBooks.map((book, i) => (
            <BiblioBookCard key={book.id} book={book} index={i} onClick={() => onSelectBook(book)} />
          )) : (
            <div style={{ textAlign: "center", padding: "60px 20px",
              color: "var(--leather-light)", fontStyle: "italic" }}>
              Aucun ouvrage dans cette catégorie
            </div>
          )}
        </div>
      )}
    </div>
  );
}
