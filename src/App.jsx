import React, { useState, useEffect, useRef } from "react";
import { Search, Camera, BookOpen, Plus, X, Edit2, Trash2, MapPin, BookMarked, Library, ScanLine, Loader2, Check, ChevronRight, Home, Zap, ArrowRight, Pause, Layers, Move, Save, RotateCcw, AlertTriangle, Settings, Download, Upload, LogOut, Cloud, CloudOff } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { supabase, isSupabaseConfigured } from "./supabase";
import {
  insertBooksBulk,
  saveStructureRemote,
  saveLayoutRemote,
  fetchBooks as fetchBooksRemote,
  fetchStructure as fetchStructureRemote,
  fetchLayout as fetchLayoutRemote,
  insertBook as insertBookRemote,
  updateBook as updateBookRemote,
  deleteBook as deleteBookRemote,
  subscribeToBooks,
  subscribeToStructure,
  subscribeToLayout,
} from "./db";
import AuthScreen from "./AuthScreen";

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

// Cascade : essaye chaque source en parallèle, retourne le meilleur résultat
async function lookupISBN(isbn) {
  const [google, openLib, bnf, fallbackCover] = await Promise.all([
    lookupGoogleBooks(isbn),
    lookupOpenLibrary(isbn),
    lookupBNF(isbn),
    findCoverFor(isbn),
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
    const reader = new ZX.BrowserMultiFormatReader();
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
  const [view, setView] = useState("home"); // home, search, add, library, detail, edit
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBib, setFilterBib] = useState("all");
  const [selectedBook, setSelectedBook] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
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

    const booksSub = subscribeToBooks(async (payload) => {
      // Stratégie simple et robuste : on recharge la liste complète à chaque changement.
      // Pour quelques centaines de livres, c'est acceptable.
      try {
        const fresh = await fetchBooksRemote();
        setBooks(fresh);
      } catch (e) { /* ignore */ }
    });

    const structSub = subscribeToStructure(async () => {
      try {
        const fresh = await fetchStructureRemote();
        if (fresh) setStructure(fresh);
      } catch (e) { /* ignore */ }
    });

    const layoutSub = subscribeToLayout(async () => {
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
      try {
        await saveLayoutRemote(newLayout);
      } catch (e) {
        showToast("Erreur de sauvegarde de la disposition", "error");
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
      try {
        await saveStructureRemote(newStructure);
      } catch (e) {
        showToast("Erreur de sauvegarde de la structure", "error");
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
    const matchBib = filterBib === "all" || b.bibliotheque === filterBib;
    return matchSearch && matchBib;
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
    if (books.length === 0) {
      showToast("Aucun livre local à migrer", "error");
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
    // Confirmation explicite
    let msg = `Migrer ${books.length} livre${books.length > 1 ? "s" : ""} et ${structure.bibliotheques.length} bibliothèque${structure.bibliotheques.length > 1 ? "s" : ""} vers la base partagée ?`;
    if (existing.length > 0) {
      msg += `\n\n⚠️ La base contient déjà ${existing.length} livre${existing.length > 1 ? "s" : ""}. Vos livres seront AJOUTÉS (risque de doublons).`;
    }
    msg += "\n\nVos livres locaux seront conservés.";
    if (!window.confirm(msg)) return;

    try {
      setMigrating({ current: 0, total: books.length });
      // 1. Pousse la structure (pièces, bibliothèques, étagères)
      await saveStructureRemote(structure);
      // 2. Pousse le layout
      await saveLayoutRemote(layout);
      // 3. Pousse les livres par lots avec progression
      await insertBooksBulk(books, (current, total) => {
        setMigrating({ current, total });
      });
      setMigrating(null);
      showToast(`✅ ${books.length} livres migrés vers la base partagée`);
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

  const findIncompleteBooks = (booksList) => {
    return booksList.filter((b) => {
      if (!isLikelyBookISBN(b.isbn)) return false;
      // Incomplet si manque un champ essentiel OU un champ enrichi
      // (description, pages, langue, catégories — les plus utiles à enrichir)
      return !b.title || !b.author || !b.cover ||
             !b.description || !b.pages || !b.language || !b.categories;
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
    const candidates = findIncompleteBooks(books);
    if (candidates.length === 0) {
      showToast("Tous les livres avec ISBN valide sont déjà complets");
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
        const result = await lookupISBN(book.isbn);
        if (result && (result.title || result.cover)) {
          found++;
          const updates = {};
          // Ne remplace QUE les champs vides — préserve les éditions manuelles
          if (!book.title && result.title) updates.title = result.title;
          if (!book.author && result.author) updates.author = result.author;
          if (!book.cover && result.cover) updates.cover = result.cover;
          if (!book.subtitle && result.subtitle) updates.subtitle = result.subtitle;
          if (!book.pages && result.pages) updates.pages = result.pages;
          if (!book.language && result.language) updates.language = result.language;
          if (!book.description && result.description) updates.description = result.description;
          if (!book.categories && result.categories) updates.categories = result.categories;
          if (!book.rating && result.rating) updates.rating = result.rating;
          if (!book.ratingsCount && result.ratingsCount) updates.ratingsCount = result.ratingsCount;
          if (!book.infoLink && result.infoLink) updates.infoLink = result.infoLink;
          if (!book.format && result.format) updates.format = result.format;
          if (!book.dimensions && result.dimensions) updates.dimensions = result.dimensions;
          if (!book.weight && result.weight) updates.weight = result.weight;
          if (!book.publisher && result.publisher) updates.publisher = result.publisher;
          if (!book.year && result.year) updates.year = result.year;
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
      showToast(`Annulé — ${updated} livre${updated > 1 ? "s" : ""} mis à jour`);
    } else {
      showToast(`Terminé — ${updated} livre${updated > 1 ? "s" : ""} enrichi${updated > 1 ? "s" : ""} sur ${candidates.length}`);
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
              <span>{books.length} {books.length > 1 ? "livres" : "livre"}</span>
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
            filterBib={filterBib}
            setFilterBib={setFilterBib}
            onSelectBook={(b) => { setSelectedBook(b); setView("detail"); }}
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
            onSelectBook={(b) => { setSelectedBook(b); setView("detail"); }}
            onFilterBib={(bibId) => { setFilterBib(bibId); setView("home"); }}
          />
        )}
        {view === "add" && (
          <AddView
            structure={structure}
            onCancel={() => setView("home")}
            onAdd={addBook}
            onEnrichBook={enrichBookByPlaceholder}
            showToast={showToast}
          />
        )}
        {view === "detail" && selectedBook && (
          <DetailView
            book={selectedBook}
            structure={structure}
            onBack={() => setView("home")}
            onEdit={() => setView("edit")}
            onDelete={() => deleteBook(selectedBook.id)}
          />
        )}
        {view === "edit" && selectedBook && (
          <EditView
            book={selectedBook}
            structure={structure}
            onCancel={() => setView("detail")}
            onSave={async (updates) => {
              await updateBook(selectedBook.id, updates);
              setSelectedBook({ ...selectedBook, ...updates });
              setView("detail");
            }}
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
      {(view === "home" || view === "library") && (
        <nav className="fixed bottom-0 left-0 right-0 z-20 border-t shadow-lg" style={{
          background: "var(--cream)",
          borderColor: "var(--parchment)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}>
          <div className="flex items-center justify-around py-3 px-2">
            <NavButton
              icon={<Library className="w-6 h-6" />}
              label="Tous"
              active={view === "home" && filterBib === "all"}
              onClick={() => { setView("home"); setFilterBib("all"); }}
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
function HomeView({ books, structure, filteredBooks, searchQuery, setSearchQuery, filterBib, setFilterBib, onSelectBook, onAdd }) {
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

      {/* Filtre bibliothèque */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
        <FilterChip active={filterBib === "all"} onClick={() => setFilterBib("all")}>
          Toutes ({books.length})
        </FilterChip>
        {structure.bibliotheques.map((b) => {
          const count = books.filter((bk) => bk.bibliotheque === b.id).length;
          if (count === 0) return null;
          return (
            <FilterChip key={b.id} active={filterBib === b.id} onClick={() => setFilterBib(b.id)}>
              {b.nom} ({count})
            </FilterChip>
          );
        })}
      </div>

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
  return (
    <button
      onClick={onClick}
      className="book-card w-full text-left p-3 rounded-xl flex gap-3 shadow-sm border"
      style={{
        background: "white",
        borderColor: "var(--parchment)",
        animationDelay: `${Math.min(index * 50, 400)}ms`,
      }}
    >
      <div className="w-16 h-24 flex-shrink-0 rounded overflow-hidden flex items-center justify-center"
        style={{ background: "var(--parchment)" }}>
        {book.cover ? (
          <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <BookOpen className="w-8 h-8" style={{ color: "var(--leather)" }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold leading-tight mb-1 line-clamp-2"
          style={{ fontFamily: "var(--font-display)", color: "var(--ink)", fontSize: "1rem" }}>
          {book.title || "Sans titre"}
        </h3>
        {book.author && (
          <p className="text-sm mb-2 line-clamp-1" style={{ color: "var(--ink-soft)" }}>
            {book.author}
          </p>
        )}
        <div className="flex items-center gap-1 text-xs" style={{ color: "var(--leather)" }}>
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">
            {bib ? bib.nom : "Non placé"}
            {book.etagere && ` · Ét. ${book.etagere}`}
            {book.position && ` · #${book.position}`}
          </span>
        </div>
      </div>
      <ChevronRight className="w-5 h-5 self-center flex-shrink-0" style={{ color: "var(--leather)" }} />
    </button>
  );
}

// === VUE AJOUT ===
function AddView({ structure, onCancel, onAdd, onEnrichBook, showToast }) {
  const [mode, setMode] = useState("choice"); // choice, barcode, cover, manual, form, batch-setup, batch-scan
  const [scannedData, setScannedData] = useState(null);
  const [searching, setSearching] = useState(false);
  const [batchSetup, setBatchSetup] = useState(null);

  const handleISBNFound = async (isbn) => {
    setSearching(true);
    showToast("Recherche du livre…");
    try {
      const found = await lookupISBN(isbn);
      if (found && found.title) {
        setScannedData({ ...found, isbn });
        showToast(`Trouvé via ${found.source}`);
        setMode("form");
      } else if (found && found.cover) {
        // On a au moins une couverture
        setScannedData({ isbn, cover: found.cover, _debug: found.debug });
        showToast("Couverture trouvée — complétez le titre", "error");
        setMode("form");
      } else {
        setScannedData({ isbn, _debug: found?.debug });
        showToast("Livre non trouvé, complétez à la main", "error");
        setMode("form");
      }
    } catch (e) {
      showToast("Connexion impossible, saisie manuelle", "error");
      setScannedData({ isbn });
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
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)", marginBottom: "1.5rem" }}>
            Ajouter un livre
          </h2>
          <ChoiceCard
            icon={<Zap className="w-6 h-6" />}
            title="Scan rapide en série"
            desc="Toute une étagère d'un coup, de gauche à droite"
            onClick={() => setMode("batch-setup")}
            highlight
          />
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
            onClick={() => { setScannedData({}); setMode("form"); }}
          />
        </div>
      )}

      {mode === "batch-setup" && (
        <BatchSetup
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
          structure={structure}
          setup={batchSetup}
          onAddBook={(book) => onAdd(book, { silent: true })}
          onEnrichBook={onEnrichBook}
          onChangeShelf={(newSetup) => setBatchSetup(newSetup)}
          onFinish={() => setMode("choice")}
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
        const reader = new ZX.BrowserMultiFormatReader();
        const controls = reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) {
            const code = result.getText();
            if (!/^(97[89]\d{10}|\d{10})$/.test(code)) return;
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

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onCapture(ev.target.result);
    reader.readAsDataURL(file);
  };

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

// === FORMULAIRE ===
function BookForm({ structure, initial, onCancel, onSubmit, submitLabel }) {
  const [title, setTitle] = useState(initial.title || "");
  const [author, setAuthor] = useState(initial.author || "");
  const [isbn, setIsbn] = useState(initial.isbn || "");
  const [cover, setCover] = useState(initial.cover || "");
  const [bibliotheque, setBibliotheque] = useState(initial.bibliotheque || structure.bibliotheques[0]?.id || "");
  const [etagere, setEtagere] = useState(initial.etagere || "1");
  const [position, setPosition] = useState(initial.position || "1");
  const [notes, setNotes] = useState(initial.notes || "");
  const [retrying, setRetrying] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState(initial._debug || null);
  // === NOUVEAUX CHAMPS ENRICHIS ===
  const [subtitle, setSubtitle] = useState(initial.subtitle || "");
  const [pages, setPages] = useState(initial.pages || "");
  const [language, setLanguage] = useState(initial.language || "");
  const [description, setDescription] = useState(initial.description || "");
  const [categories, setCategories] = useState(initial.categories || "");
  const [rating, setRating] = useState(initial.rating || 0);
  const [ratingsCount, setRatingsCount] = useState(initial.ratingsCount || 0);
  const [infoLink, setInfoLink] = useState(initial.infoLink || "");
  const [format, setFormat] = useState(initial.format || "");
  const [dimensions, setDimensions] = useState(initial.dimensions || "");
  const [weight, setWeight] = useState(initial.weight || "");
  const [publisher, setPublisher] = useState(initial.publisher || "");
  const [year, setYear] = useState(initial.year || "");
  const [showMore, setShowMore] = useState(false);

  const handleCoverUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCover(ev.target.result);
    reader.readAsDataURL(file);
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
    });
  };

  return (
    <div className="space-y-4">
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)" }}>
        Informations du livre
      </h2>

      {/* Couverture */}
      <div className="flex gap-3 items-start">
        <div className="w-20 h-28 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--parchment)" }}>
          {cover ? (
            <img src={cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <BookOpen className="w-8 h-8" style={{ color: "var(--leather)" }} />
          )}
        </div>
        <div className="flex-1 space-y-1.5">
          <label className="block py-2 px-3 rounded-lg border-2 text-sm text-center cursor-pointer"
            style={{ borderColor: "var(--parchment)", color: "var(--leather)" }}>
            <Camera className="w-4 h-4 inline mr-1" /> {cover ? "Changer la couverture" : "Ajouter une photo"}
            <input type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
          </label>
          {cover && (
            <button
              type="button"
              onClick={() => setCover("")}
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

      <Field label="Titre *">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Le titre du livre"
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>

      <Field label="Auteur">
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Prénom Nom"
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>

      <Field label="ISBN">
        <input
          value={isbn}
          onChange={(e) => setIsbn(e.target.value)}
          placeholder="978…"
          className="w-full p-3 rounded-lg border-2 outline-none"
          style={{ borderColor: "var(--parchment)" }}
        />
      </Field>

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
            onChange={(e) => setPosition(e.target.value)}
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
            <BookOpen className="w-4 h-4" /> Détails du livre
          </span>
          <ChevronRight className={`w-5 h-5 transition-transform ${showMore ? "rotate-90" : ""}`} />
        </button>
      </div>

      {showMore && (
        <div className="space-y-3 pl-1">
          <Field label="Sous-titre">
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Le sous-titre du livre"
              className="w-full p-3 rounded-lg border-2 outline-none"
              style={{ borderColor: "var(--parchment)" }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
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
            <Field label="Langue">
              <input
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="Français"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Éditeur">
              <input
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
                placeholder="Gallimard…"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
            <Field label="Année">
              <input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2020"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={{ borderColor: "var(--parchment)" }}
              />
            </Field>
          </div>

          <Field label="Format">
            <input
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder="Broché, Poche, Relié…"
              className="w-full p-3 rounded-lg border-2 outline-none"
              style={{ borderColor: "var(--parchment)" }}
            />
          </Field>

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

          <Field label="Catégorie / Genre">
            <input
              value={categories}
              onChange={(e) => setCategories(e.target.value)}
              placeholder="Roman, Science-fiction…"
              className="w-full p-3 rounded-lg border-2 outline-none"
              style={{ borderColor: "var(--parchment)" }}
            />
          </Field>

          <Field label="Résumé">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Quelques mots sur le contenu du livre…"
              rows={4}
              className="w-full p-3 rounded-lg border-2 outline-none resize-none"
              style={{ borderColor: "var(--parchment)" }}
            />
          </Field>

          {(rating > 0 || ratingsCount > 0) && (
            <div className="rounded-lg p-3" style={{ background: "var(--parchment)" }}>
              <div className="text-sm flex items-center justify-between" style={{ color: "var(--ink)" }}>
                <span>Note Google Books</span>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>
                  ⭐ {rating?.toFixed(1)} / 5 ({ratingsCount} avis)
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
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium mb-1 block" style={{ color: "var(--ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}

// === DETAIL ===
function DetailView({ book, structure, onBack, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bib = structure.bibliotheques.find((b) => b.id === book.bibliotheque);
  const piece = bib ? structure.pieces.find((p) => p.id === bib.pieceId) : null;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 mb-4" style={{ color: "var(--leather)" }}>
        <ChevronRight className="w-5 h-5 rotate-180" /> Retour
      </button>

      <div className="text-center mb-6">
        <div className="inline-block w-40 h-56 rounded-lg overflow-hidden shadow-lg mb-4"
          style={{ background: "var(--parchment)" }}>
          {book.cover ? (
            <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <BookOpen className="w-16 h-16" style={{ color: "var(--leather)" }} />
            </div>
          )}
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)", lineHeight: 1.2 }}>
          {book.title}
        </h2>
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
      </div>

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

      {/* Détails bibliographiques */}
      {(book.pages || book.language || book.format || book.publisher || book.year || book.dimensions || book.weight || book.isbn) && (
        <div className="space-y-3 p-4 rounded-xl mb-4" style={{ background: "white", border: "1px solid var(--parchment)" }}>
          <h3 className="text-sm font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--leather-dark)" }}>
            Détails
          </h3>
          {book.pages > 0 && <DetailRow label="Pages" value={book.pages} />}
          {book.language && <DetailRow label="Langue" value={book.language} />}
          {book.format && <DetailRow label="Format" value={book.format} />}
          {book.publisher && <DetailRow label="Éditeur" value={book.publisher} />}
          {book.year && <DetailRow label="Année" value={book.year} />}
          {book.dimensions && <DetailRow label="Dimensions" value={book.dimensions} />}
          {book.weight && <DetailRow label="Poids" value={book.weight} />}
          {book.isbn && <DetailRow label="ISBN" value={book.isbn} />}
        </div>
      )}

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

      <div className="flex gap-3 mt-6">
        <button
          onClick={onEdit}
          className="flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2"
          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
        >
          <Edit2 className="w-4 h-4" /> Modifier
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          className="px-4 py-3 rounded-xl border-2 flex items-center gap-2"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          <Trash2 className="w-4 h-4" />
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
function BatchSetup({ structure, onCancel, onStart }) {
  const [bibliotheque, setBibliotheque] = useState(structure.bibliotheques[0]?.id || "");
  const [etagere, setEtagere] = useState("1");
  const [position, setPosition] = useState("1");

  return (
    <div className="space-y-4">
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--ink)" }}>
        Scan rapide d'une étagère
      </h2>
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Choisissez l'emplacement de départ. Chaque livre scanné sera placé à la suite (gauche → droite), et la position s'incrémentera automatiquement.
      </p>

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
        <Field label="Position de départ">
          <input
            type="number"
            min="1"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="w-full p-3 rounded-lg border-2 outline-none"
            style={{ borderColor: "var(--parchment)" }}
          />
        </Field>
      </div>

      <button
        onClick={() => onStart({
          bibliotheque,
          etagere: parseInt(etagere) || 1,
          position: parseInt(position) || 1,
        })}
        className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 mt-4"
        style={{
          background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
          color: "var(--cream)",
        }}
      >
        <Zap className="w-5 h-5" /> Démarrer le scan
      </button>
    </div>
  );
}

// === SCANNER EN SÉRIE ===
function BatchScanner({ structure, setup, onAddBook, onEnrichBook, onChangeShelf, onFinish, showToast }) {
  const [currentSetup, setCurrentSetup] = useState(setup);
  const [phase, setPhase] = useState("scanning"); // scanning, processing, confirming, paused
  const [lastBook, setLastBook] = useState(null);
  const [batchHistory, setBatchHistory] = useState([]); // livres ajoutés dans cette session
  const [showShelfChange, setShowShelfChange] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [starting, setStarting] = useState(false);

  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const lastScannedRef = useRef({ code: null, time: 0 });
  const phaseRef = useRef("scanning"); // pour accès depuis le callback async
  const [error, setError] = useState(null);
  const [manualISBN, setManualISBN] = useState("");

  const currentBib = structure.bibliotheques.find((b) => b.id === currentSetup.bibliotheque);

  // Tient phaseRef à jour
  useEffect(() => { phaseRef.current = phase; }, [phase]);

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
        if (!/^(97[89]\d{10}|\d{10})$/.test(code)) return;
        if (phaseRef.current === "paused") return;
        const now = Date.now();
        if (lastScannedRef.current.code === code && now - lastScannedRef.current.time < 3000) {
          return;
        }
        lastScannedRef.current = { code, time: now };
        if (navigator.vibrate) navigator.vibrate(50);
        handleISBNScanned(code);
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

  // Stoppe le scanner SEULEMENT pour les phases vraiment bloquantes (modale, pause)
  useEffect(() => {
    if (!cameraStarted) return;
    if (phase === "paused") {
      if (readerRef.current) {
        try { readerRef.current.stop(); } catch (e) { /* ignore */ }
        readerRef.current = null;
      }
      return;
    }
    // Si on a déjà un reader actif, on le laisse tourner — pas de redémarrage inutile
    if (readerRef.current) return;
    // Sinon on redémarre (cas du retour depuis "paused")
    let cancelled = false;
    (async () => {
      try {
        const reader = await createBarcodeReader();
        if (cancelled) return;
        readerRef.current = reader;
        if (!videoRef.current) return;
        await reader.startScanning(videoRef.current, (code) => {
          if (!/^(97[89]\d{10}|\d{10})$/.test(code)) return;
          if (phaseRef.current === "paused") return;
          const now = Date.now();
          if (lastScannedRef.current.code === code && now - lastScannedRef.current.time < 3000) {
            return;
          }
          lastScannedRef.current = { code, time: now };
          if (navigator.vibrate) navigator.vibrate(50);
          handleISBNScanned(code);
        });
      } catch (e) {
        if (e?.name === "NotAllowedError") setError("permission");
        else setError(e?.message || "camera");
      }
    })();
    return () => {
      cancelled = true;
      if (readerRef.current) {
        try { readerRef.current.stop(); } catch (e) { /* ignore */ }
        readerRef.current = null;
      }
    };
  }, [phase, cameraStarted]);

  const handleISBNScanned = async (isbn) => {
    // Mode continu : on ajoute IMMÉDIATEMENT le livre avec l'ISBN seul,
    // puis on enrichit en arrière-plan. La caméra reste active.
    const placeholderId = Date.now().toString() + "-" + Math.random().toString(36).slice(2, 6);
    const placeholderPosition = currentSetup.position;
    const placeholderBib = currentSetup.bibliotheque;
    const placeholderEtagere = currentSetup.etagere;

    // Petit feedback flash brief sans bloquer
    setPhase("flash");
    setTimeout(() => {
      // Si on est encore en "flash" (pas un autre scan entretemps), retour à scanning
      setPhase((p) => (p === "flash" ? "scanning" : p));
    }, 300);

    // Ajout placeholder immédiat
    const placeholder = {
      _placeholderId: placeholderId,
      isbn,
      title: "",
      author: "",
      cover: "",
      bibliotheque: placeholderBib,
      etagere: placeholderEtagere,
      position: placeholderPosition,
      notes: "",
    };
    await onAddBook(placeholder);
    setLastBook(placeholder);
    setBatchHistory((h) => [placeholder, ...h]);
    setCurrentSetup((s) => ({ ...s, position: s.position + 1 }));

    // Lookup en arrière-plan — le livre sera mis à jour quand le résultat arrive
    (async () => {
      try {
        const found = await lookupISBN(isbn);
        if (found && (found.title || found.cover)) {
          const enrichedFields = {
            title: found.title || "",
            author: found.author || "",
            cover: found.cover || "",
            subtitle: found.subtitle || "",
            pages: found.pages || 0,
            language: found.language || "",
            description: found.description || "",
            categories: found.categories || "",
            rating: found.rating || 0,
            ratingsCount: found.ratingsCount || 0,
            infoLink: found.infoLink || "",
            format: found.format || "",
            dimensions: found.dimensions || "",
            weight: found.weight || "",
            publisher: found.publisher || "",
            year: found.year || "",
          };
          // Met à jour le placeholder via une fonction utilitaire injectée par le parent
          if (typeof onEnrichBook === "function") {
            onEnrichBook(placeholderId, enrichedFields);
          }
          // Met aussi à jour notre vue locale
          setLastBook((curr) =>
            curr?._placeholderId === placeholderId ? { ...curr, ...enrichedFields } : curr
          );
          setBatchHistory((h) =>
            h.map((b) => b._placeholderId === placeholderId ? { ...b, ...enrichedFields } : b)
          );
        }
      } catch (e) { /* ignore */ }
    })();
  };

  const handleManualISBN = () => {
    if (manualISBN.length >= 10) {
      handleISBNScanned(manualISBN);
      setManualISBN("");
    }
  };

  const undoLast = () => {
    if (batchHistory.length === 0) return;
    // Reculer la position
    setCurrentSetup((s) => ({ ...s, position: Math.max(1, s.position - 1) }));
    setBatchHistory((h) => h.slice(1));
    setLastBook(batchHistory[1] || null);
    showToast("Dernier livre conservé, position reculée");
  };

  const changeShelf = (newEtagere) => {
    setCurrentSetup((s) => ({ ...s, etagere: parseInt(newEtagere) || 1, position: 1 }));
    setShowShelfChange(false);
    showToast(`Étagère ${newEtagere} — position 1`);
    setPhase("scanning");
  };

  const changeBibliotheque = (newBib) => {
    setCurrentSetup({ bibliotheque: newBib, etagere: 1, position: 1 });
    setShowShelfChange(false);
    showToast("Nouvelle bibliothèque — étagère 1, position 1");
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
              Étagère <strong>{currentSetup.etagere}</strong> · Prochaine position <strong>{currentSetup.position}</strong>
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
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    onClick={() => changeShelf(n)}
                    className="w-12 h-12 rounded-lg font-semibold border-2"
                    style={{
                      background: n === currentSetup.etagere ? "var(--leather-dark)" : "white",
                      color: n === currentSetup.etagere ? "var(--cream)" : "var(--ink)",
                      borderColor: "var(--parchment)",
                    }}
                  >
                    {n}
                  </button>
                ))}
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
                {batchHistory.length} {batchHistory.length > 1 ? "livres scannés" : "livre scanné"}
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
          <div className="w-12 h-16 rounded overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{ background: "var(--parchment)" }}>
            {lastBook.cover ? (
              <img src={lastBook.cover} alt="" className="w-full h-full object-cover" />
            ) : (
              <BookOpen className="w-5 h-5" style={{ color: "var(--leather)" }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs" style={{ color: "var(--gold)" }}>
              ✓ Ajouté en position {lastBook.position}
            </div>
            <div className="font-medium text-sm truncate" style={{ color: "var(--ink)" }}>
              {lastBook.title || `ISBN ${lastBook.isbn}`}
            </div>
            {lastBook.author && (
              <div className="text-xs truncate" style={{ color: "var(--ink-soft)" }}>
                {lastBook.author}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Aide & Terminer */}
      <div className="space-y-2">
        <p className="text-center text-xs" style={{ color: "var(--ink-soft)" }}>
          Pointez la caméra vers chaque code-barres, de gauche à droite. Les livres sont ajoutés automatiquement.
        </p>
        <button
          onClick={onFinish}
          className="w-full py-3 rounded-xl font-medium border-2"
          style={{ borderColor: "var(--leather)", color: "var(--leather-dark)", background: "white" }}
        >
          Terminer le scan ({batchHistory.length} {batchHistory.length > 1 ? "livres" : "livre"})
        </button>
      </div>
    </div>
  );
}


function EditView({ book, structure, onCancel, onSave }) {
  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1 mb-4" style={{ color: "var(--leather)" }}>
        <X className="w-5 h-5" /> Annuler
      </button>
      <BookForm
        structure={structure}
        initial={book}
        onCancel={onCancel}
        onSubmit={onSave}
        submitLabel="Enregistrer"
      />
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
function LibraryView({ books, structure, saveStructure, saveBooks, layout, saveLayout, showToast, onSelectBook, onFilterBib }) {
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
  const savePiece = async (piece) => {
    let newPieces;
    if (piece.id) {
      // Modification
      newPieces = structure.pieces.map((p) => (p.id === piece.id ? piece : p));
    } else {
      // Création
      const newPiece = { ...piece, id: genId("piece") };
      newPieces = [...structure.pieces, newPiece];
    }
    await saveStructure({ ...structure, pieces: newPieces });
    setEditingPiece(null);
    showToast(piece.id ? "Pièce modifiée" : "Pièce ajoutée");
  };

  const deletePiece = async (pieceId) => {
    // Trouver les bibliothèques de cette pièce
    const bibsToRemove = structure.bibliotheques.filter((b) => b.pieceId === pieceId).map((b) => b.id);
    const newPieces = structure.pieces.filter((p) => p.id !== pieceId);
    const newBibs = structure.bibliotheques.filter((b) => b.pieceId !== pieceId);
    const newEtageres = structure.etageres.filter((e) => !bibsToRemove.includes(e.bibId));
    // Détacher les livres de ces bibliothèques (orphelins -> bibliotheque vide)
    const newBooks = books.map((bk) =>
      bibsToRemove.includes(bk.bibliotheque) ? { ...bk, bibliotheque: "" } : bk
    );
    await saveStructure({ pieces: newPieces, bibliotheques: newBibs, etageres: newEtageres });
    await saveBooks(newBooks);
    setConfirmDelete(null);
    showToast("Pièce supprimée");
  };

  const saveBib = async (bib) => {
    let newBibs, newEtageres = structure.etageres;
    if (bib.id) {
      newBibs = structure.bibliotheques.map((b) => (b.id === bib.id ? bib : b));
    } else {
      const newBib = { ...bib, id: genId("bib") };
      newBibs = [...structure.bibliotheques, newBib];
      // Créer 4 étagères par défaut
      const newEt = [1, 2, 3, 4].map((n) => ({
        id: `${newBib.id}-e${n}`,
        bibId: newBib.id,
        num: n,
        nom: "",
      }));
      newEtageres = [...structure.etageres, ...newEt];
    }
    await saveStructure({ ...structure, bibliotheques: newBibs, etageres: newEtageres });
    setEditingBib(null);
    showToast(bib.id ? "Bibliothèque modifiée" : "Bibliothèque ajoutée");
  };

  const deleteBib = async (bibId) => {
    const newBibs = structure.bibliotheques.filter((b) => b.id !== bibId);
    const newEtageres = structure.etageres.filter((e) => e.bibId !== bibId);
    const newBooks = books.map((bk) =>
      bk.bibliotheque === bibId ? { ...bk, bibliotheque: "" } : bk
    );
    await saveStructure({ ...structure, bibliotheques: newBibs, etageres: newEtageres });
    await saveBooks(newBooks);
    setConfirmDelete(null);
    showToast("Bibliothèque supprimée");
  };

  const saveShelf = async (shelf) => {
    let newEtageres;
    if (shelf.id) {
      newEtageres = structure.etageres.map((e) => (e.id === shelf.id ? shelf : e));
    } else {
      const newShelf = { ...shelf, id: genId("etag") };
      newEtageres = [...structure.etageres, newShelf];
    }
    await saveStructure({ ...structure, etageres: newEtageres });
    setEditingShelf(null);
    showToast(shelf.id ? "Étagère modifiée" : "Étagère ajoutée");
  };

  const deleteShelf = async (shelf) => {
    const newEtageres = structure.etageres.filter((e) => e.id !== shelf.id);
    // Détacher les livres de cette étagère
    const newBooks = books.map((bk) =>
      (bk.bibliotheque === shelf.bibId && bk.etagere === shelf.num) ? { ...bk, etagere: 0 } : bk
    );
    await saveStructure({ ...structure, etageres: newEtageres });
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
function ShelfRow({ shelfNum, shelfName, books, onSelectBook, onEdit }) {
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
                  <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
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
  onClose,
}) {
  const fileRef = useRef(null);
  const stats = {
    total: books.length,
    withTitle: books.filter((b) => b.title).length,
    withCover: books.filter((b) => b.cover).length,
    withoutTitle: books.filter((b) => !b.title).length,
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

                {/* Bouton de migration des livres locaux vers la base partagée */}
                {books.length > 0 && (
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
                          Vous avez <strong>{books.length} livre{books.length > 1 ? "s" : ""}</strong> stocké{books.length > 1 ? "s" : ""} sur cet appareil. Migrez-les vers la base partagée pour qu'ils soient accessibles à toute la famille.
                        </p>
                        <button
                          onClick={onMigrateToCloud}
                          className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
                          style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
                        >
                          <Upload className="w-4 h-4" /> Migrer mes livres vers la base partagée
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
              <span>Total de livres</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="flex justify-between">
              <span>Avec titre/auteur</span>
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
