import React, { useState, useMemo } from "react";
import { GENRE_COLORS, getGenreColor } from "./genres";

// ============================================================
// VUE « BIBLIOTHÈQUE VIRTUELLE »
// ============================================================
// Classement par genre plutôt que par emplacement physique : on y
// cherche « un policier » quand on ne sait pas où il est rangé.
//
// Extraite d'App.jsx. Le bloc était déjà autonome — il ne dépendait
// que de React et de la taxonomie des genres, désormais dans genres.js.
// Seule BibliothequeView est exportée : le reste lui est interne.

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
export function BibliothequeView({ books, onSelectBook }) {
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
