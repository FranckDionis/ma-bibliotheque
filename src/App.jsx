import React, { useState, useEffect, useRef } from "react";
import { Search, Camera, BookOpen, Plus, X, Edit2, Trash2, MapPin, BookMarked, Library, ScanLine, Loader2, Check, ChevronRight, Home, Zap, ArrowRight, Pause, Layers, Move, Save, RotateCcw, AlertTriangle } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";

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
// Retourne { title, author, cover, publisher, year, source } ou null
// ============================================================

// Fetch avec timeout pour qu'une source lente ne bloque pas tout
async function fetchWithTimeout(url, ms = 4000) {
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

// Google Books — excellent sur les livres français, gratuit, sans clé
async function lookupGoogleBooks(isbn) {
  try {
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items?.[0]?.volumeInfo;
    if (!item) return null;
    // Préfère une couverture haute résolution si disponible
    const cover =
      item.imageLinks?.extraLarge ||
      item.imageLinks?.large ||
      item.imageLinks?.medium ||
      item.imageLinks?.thumbnail ||
      item.imageLinks?.smallThumbnail ||
      "";
    return {
      title: item.title || "",
      author: (item.authors || []).join(", "),
      cover: cover.replace(/^http:/, "https:"), // force HTTPS
      publisher: item.publisher || "",
      year: item.publishedDate || "",
      source: "Google Books",
    };
  } catch (e) {
    return null;
  }
}

// Open Library — bonne pour livres anglo-saxons et anciens
async function lookupOpenLibrary(isbn) {
  try {
    const res = await fetchWithTimeout(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const book = data[`ISBN:${isbn}`];
    if (!book) return null;
    return {
      title: book.title || "",
      author: (book.authors || []).map((a) => a.name).join(", "),
      cover: book.cover?.large || book.cover?.medium || book.cover?.small || "",
      publisher: book.publishers?.[0]?.name || "",
      year: book.publish_date || "",
      source: "Open Library",
    };
  } catch (e) {
    return null;
  }
}

// BNF SRU — la Bibliothèque nationale de France, exhaustive sur le fonds français
async function lookupBNF(isbn) {
  try {
    const url = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=bib.isbn%20adj%20%22${isbn}%22&recordSchema=unimarcxchange&maximumRecords=1`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const xml = await res.text();
    // Parse le XML UNIMARC pour extraire titre/auteur
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    // Champ 200 = titre, sous-champ a = titre principal, sous-champ f = auteur
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

// Cascade : essaye chaque source en parallèle, retourne la première qui répond
async function lookupISBN(isbn) {
  // En parallèle pour la rapidité, mais on prend Google d'abord s'il répond
  const [google, openLib, bnf] = await Promise.all([
    lookupGoogleBooks(isbn),
    lookupOpenLibrary(isbn),
    lookupBNF(isbn),
  ]);
  // Priorité : Google (le plus complet sur livres français), Open Library, BnF
  // Mais si Google n'a pas de couverture et qu'une autre en a une, on l'emprunte
  let chosen = google || openLib || bnf || null;
  if (chosen && !chosen.cover) {
    const altCover = (google?.cover || openLib?.cover || bnf?.cover);
    if (altCover) chosen.cover = altCover;
  }
  // Si Google n'a pas de titre mais qu'on a quand même un autre résultat
  if (!chosen?.title && (openLib?.title || bnf?.title)) {
    chosen = openLib || bnf;
  }
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

  // Charge livres + layout + structure depuis le storage persistant au démarrage
  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (result?.value) {
          setBooks(JSON.parse(result.value));
        }
      } catch (e) { /* pas de données encore */ }
      try {
        const layoutResult = await window.storage.get(LAYOUT_KEY);
        if (layoutResult?.value) {
          const saved = JSON.parse(layoutResult.value);
          setLayout({
            pieces: { ...DEFAULT_LAYOUT.pieces, ...(saved.pieces || {}) },
            bibliotheques: { ...DEFAULT_LAYOUT.bibliotheques, ...(saved.bibliotheques || {}) },
          });
        }
      } catch (e) { /* pas de layout encore */ }
      try {
        const structResult = await window.storage.get(STRUCTURE_KEY);
        if (structResult?.value) {
          const saved = JSON.parse(structResult.value);
          setStructure({
            pieces: saved.pieces || INITIAL_PIECES,
            bibliotheques: saved.bibliotheques || INITIAL_BIBLIOTHEQUES,
            etageres: saved.etageres || INITIAL_ETAGERES,
          });
        }
      } catch (e) { /* pas de structure encore — on garde l'initiale */ }
      setLoading(false);
    })();
  }, []);

  const saveLayout = async (newLayout) => {
    setLayout(newLayout);
    try {
      await window.storage.set(LAYOUT_KEY, JSON.stringify(newLayout));
    } catch (e) {
      showToast("Erreur de sauvegarde de la disposition", "error");
    }
  };

  const saveStructure = async (newStructure) => {
    setStructure(newStructure);
    try {
      await window.storage.set(STRUCTURE_KEY, JSON.stringify(newStructure));
    } catch (e) {
      showToast("Erreur de sauvegarde de la structure", "error");
    }
  };

  // Sauvegarde après chaque modification
  const saveBooks = async (newBooks) => {
    setBooks(newBooks);
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(newBooks));
    } catch (e) {
      showToast("Erreur de sauvegarde", "error");
    }
  };

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  const addBook = async (book) => {
    const newBook = {
      ...book,
      id: Date.now().toString(),
      addedAt: new Date().toISOString(),
    };
    await saveBooks([newBook, ...books]);
    showToast("Livre ajouté à votre bibliothèque");
    setView("home");
  };

  const updateBook = async (id, updates) => {
    await saveBooks(books.map((b) => (b.id === id ? { ...b, ...updates } : b)));
    showToast("Livre mis à jour");
  };

  const deleteBook = async (id) => {
    await saveBooks(books.filter((b) => b.id !== id));
    showToast("Livre supprimé");
    setView("home");
  };

  const filteredBooks = books.filter((b) => {
    const matchSearch = !searchQuery ||
      b.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.author?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.isbn?.includes(searchQuery);
    const matchBib = filterBib === "all" || b.bibliotheque === filterBib;
    return matchSearch && matchBib;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--cream)" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--leather)" }} />
      </div>
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
      <header className="sticky top-0 z-30 px-5 py-4 border-b" style={{
        background: "linear-gradient(180deg, var(--leather-dark) 0%, var(--leather) 100%)",
        borderColor: "var(--gold)",
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
          <div className="text-xs" style={{ color: "var(--gold-light)", fontFamily: "var(--font-display)" }}>
            {books.length} {books.length > 1 ? "livres" : "livre"}
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
function AddView({ structure, onCancel, onAdd, showToast }) {
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
      } else {
        showToast("Livre non trouvé en ligne, complétez à la main", "error");
        setScannedData({ isbn });
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
          onAddBook={onAdd}
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

  const handleCoverUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCover(ev.target.result);
    reader.readAsDataURL(file);
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
        <label className="flex-1 py-2 px-3 rounded-lg border-2 text-sm text-center cursor-pointer"
          style={{ borderColor: "var(--parchment)", color: "var(--leather)" }}>
          <Camera className="w-4 h-4 inline mr-1" /> {cover ? "Changer la couverture" : "Ajouter une photo"}
          <input type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
        </label>
      </div>

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
        {book.author && (
          <p className="text-base mt-1 italic" style={{ color: "var(--ink-soft)" }}>
            {book.author}
          </p>
        )}
      </div>

      <div className="space-y-3 p-4 rounded-xl" style={{ background: "white", border: "1px solid var(--parchment)" }}>
        <DetailRow label="Bibliothèque" value={bib?.nom} />
        <DetailRow label="Pièce" value={piece?.nom} />
        <DetailRow label="Étagère" value={book.etagere} suffix=" (du haut)" />
        <DetailRow label="Position" value={book.position} suffix=" (depuis la gauche)" />
        {book.isbn && <DetailRow label="ISBN" value={book.isbn} />}
        {book.notes && <DetailRow label="Notes" value={book.notes} />}
      </div>

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
function BatchScanner({ structure, setup, onAddBook, onChangeShelf, onFinish, showToast }) {
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
        if (!/^\d{10,13}$/.test(code)) return;
        if (phaseRef.current !== "scanning") return;
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

  // Stoppe le scanner pendant les phases hors scan, le redémarre au retour
  useEffect(() => {
    if (!cameraStarted) return;
    if (phase !== "scanning") {
      if (readerRef.current) {
        try { readerRef.current.stop(); } catch (e) { /* ignore */ }
        readerRef.current = null;
      }
      return;
    }
    // Retour en phase scan : redémarre le scanner (l'autorisation caméra est déjà accordée)
    let cancelled = false;
    (async () => {
      try {
        const reader = await createBarcodeReader();
        if (cancelled) return;
        readerRef.current = reader;
        if (!videoRef.current) return;
        await reader.startScanning(videoRef.current, (code) => {
          if (!/^\d{10,13}$/.test(code)) return;
          if (phaseRef.current !== "scanning") return;
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
    setPhase("processing");
    let bookData = { isbn };
    try {
      const found = await lookupISBN(isbn);
      if (found && found.title) {
        bookData = {
          isbn,
          title: found.title,
          author: found.author,
          cover: found.cover,
        };
      }
    } catch (e) { /* hors ligne — on garde juste l'ISBN */ }

    // Ajout immédiat avec l'emplacement courant
    const finalBook = {
      ...bookData,
      bibliotheque: currentSetup.bibliotheque,
      etagere: currentSetup.etagere,
      position: currentSetup.position,
      notes: "",
    };
    await onAddBook(finalBook);

    setLastBook(finalBook);
    setBatchHistory((h) => [finalBook, ...h]);
    // Incrémente la position pour le prochain livre
    setCurrentSetup((s) => ({ ...s, position: s.position + 1 }));
    // Retour au scan après un court délai pour laisser voir le feedback
    setTimeout(() => setPhase("scanning"), 800);
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

          {/* Overlay processing */}
          {phase === "processing" && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <Loader2 className="w-10 h-10 animate-spin" style={{ color: "var(--gold-light)" }} />
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
