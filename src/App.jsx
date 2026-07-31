import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { Search, Camera, BookOpen, Plus, X, Edit2, Trash2, MapPin, BookMarked, Library, ScanLine, Loader2, Check, ChevronRight, Zap, Layers, Save, Settings, Cloud, CloudOff, Sparkles } from "lucide-react";
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
  dbToBook,
} from "./db";
import AuthScreen from "./AuthScreen";
import { ITEM_TYPES, ITEM_TYPES_LIST, guessTypeFromBarcode, recognizeMagazine } from "./itemTypes";
import { termesDeRecherche, correspondAlaRecherche } from "./recherche";
import { DetailRow, FilterChip, NavButton, ChoiceCard } from "./ui";
import { GENRE_COLORS } from "./genres";
import { BibliothequeView } from "./bibliothequeVirtuelle";
import { SmartCover, CoverScanner } from "./images";
import { LibraryView } from "./LibraryView";
import { SettingsModal } from "./SettingsModal";
// L'import installe aussi window.storage, utilisé dans tout ce fichier.
import { STORAGE_KEY, LAYOUT_KEY, STRUCTURE_KEY } from "./stockageLocal";
import { findFirstFreePosition } from "./placement";
import { findCoverFor, lookupAnyBarcode, lookupISBN } from "./rechercheMetadonnees";
import { BookForm } from "./BookForm";
import { BarcodeScanner } from "./BarcodeScanner";
import { BatchSetup } from "./BatchSetup";
import { BatchScanner } from "./BatchScanner";




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




// ============================================================
// Module unifié de scan code-barres (ZXing + fallback natif)
// ZXing fonctionne dans Safari iOS, contrairement à BarcodeDetector.
// ============================================================
// CHARGEMENT DIFFÉRÉ — et pourquoi c'est acceptable aujourd'hui.
//
// ZXing pèse à lui seul une bonne part du bundle. Importé statiquement,
// il était téléchargé par tout le monde, y compris par qui consulte sa
// bibliothèque sans jamais scanner.
//
// Une version antérieure le chargeait depuis un CDN, ce qui avait été
// abandonné : un bloqueur ou un VPN suffisait à empêcher le scan. Un
// `import()` dynamique est différent — le morceau est servi par notre
// propre domaine, comme le reste de l'application, et le service worker
// le met en cache dès le premier usage. Il n'est donc téléchargé qu'une
// fois, puis disponible même hors ligne.
//
// Le module est mémorisé après le premier chargement : les scans
// suivants n'attendent rien.
let _zxing = null;



/**
 * Crée un lecteur unifié. Méthode A (préférée) : ZXing (universel).
 * Méthode B (fallback) : BarcodeDetector natif (Chrome Android).
 * Renvoie { startScanning(videoEl, onResult), stop() }.
 *
 * Important iOS : on gère nous-mêmes getUserMedia et l'attachement du stream
 * à la balise <video> avant de passer à ZXing. Cela évite l'écran noir en
 * mode standalone PWA sur iPhone.
 */


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

  // Détecte, au tout premier rendu, qu'on arrive depuis un lien de
  // récupération de mot de passe. Lu une seule fois : le jeton est ensuite
  // effacé de la barre d'adresse, et relire l'URL donnerait faux.
  const [recoveryMode, setRecoveryMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return /type=recovery|token_hash=/.test(
      (window.location.hash || "") + (window.location.search || "")
    );
  });

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

          // Les couvertures arrivent maintenant avec les livres : ce ne
          // sont plus que des URL, servies ensuite par le CDN. Tout le
          // dispositif qui se trouvait ici — lecture d'un cache IndexedDB,
          // détection des couvertures périmées par comparaison de dates,
          // retéléchargement par lots de 30, borne de synchronisation — n'a
          // plus d'objet. Il existait parce qu'une image en base64 dans la
          // base coûtait des centaines de Mo de bande passante à chaque
          // démarrage.

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
        } else if (eventType === "DELETE" && payload.old) {
          const deletedId = payload.old.id;
          setBooks((prev) => prev.filter((b) => b.id !== deletedId));
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
        // ⚠️ On applique la réponse du SERVEUR telle quelle, sans y
        // réinjecter `updates`. Quand la modification porte sur une
        // couverture, `updates.cover` contient l'image en data URL, que
        // la couche db.js vient de déposer dans le Storage : c'est donc
        // le serveur qui détient la bonne valeur, l'URL définitive.
        // Forcer `updates.cover` ici laisserait l'image lourde dans
        // l'état local, et masquerait le suffixe anti-cache.
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
        // Comme dans updateBook : on applique la réponse du serveur, qui
        // porte l'URL de la couverture déposée dans le Storage, et non
        // l'image en data URL qu'on vient d'envoyer.
        const updated = await updateBookRemote(id, updates);
        setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
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

  // Mots de la recherche, normalisés une fois par frappe (et non par livre).
  // Découper en mots permet « hugo miserables » : chaque mot doit être présent,
  // dans n'importe quel ordre et n'importe quel champ.
  const searchTerms = useMemo(() => termesDeRecherche(searchQuery), [searchQuery]);

  // Index bibliothèque → pièce, construit une fois par changement de structure.
  // Auparavant, un `.find()` sur toutes les bibliothèques était refait POUR
  // CHAQUE LIVRE à chaque frappe au clavier.
  const pieceOfBib = useMemo(() => {
    const m = new Map();
    for (const bib of structure.bibliotheques) m.set(bib.id, bib.pieceId);
    return m;
  }, [structure.bibliotheques]);

  const filteredBooks = useMemo(() => books.filter((b) => {
    // Tous les mots doivent être trouvés, sur titre / sous-titre / auteur /
    // notes / description / ISBN, accents ignorés des deux côtés.
    const matchSearch = correspondAlaRecherche(b, searchTerms);

    // Filtre PIÈCE : trouve la pièce de la bibliothèque du livre
    const matchPiece =
      filterPiece === "all" ||
      (!!b.bibliotheque && pieceOfBib.get(b.bibliotheque) === filterPiece);

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
  }), [books, searchTerms, pieceOfBib, filterPiece, filterBib, filterEtagere, filterType]);

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
      // ⚠️ L'import se comporte DIFFÉREMMENT selon le mode, et c'est voulu.
      //
      // En mode cloud, `saveBooks` ne fait qu'un setBooks : il n'écrit rien
      // dans Supabase. En revanche `saveStructure` et `saveLayout`, eux,
      // écrivent bel et bien en base. Enchaîner les trois comme avant
      // produisait le pire résultat possible : les livres n'étaient remplacés
      // qu'à l'écran (un rechargement les faisait revenir) pendant que la
      // structure et le plan étaient réellement écrasés en base, sans retour
      // arrière — alors que la confirmation annonçait un remplacement complet.
      //
      // On sépare donc franchement les deux cas.
      if (isCloudMode) {
        const msg =
          `Charger ${data.books.length} livre${data.books.length > 1 ? "s" : ""} depuis cette sauvegarde ?\n\n` +
          `⚠️ RIEN ne sera écrit dans la base partagée : les livres seront seulement affichés dans l'application, ` +
          `et la structure ainsi que le plan resteront inchangés.\n\n` +
          `Pour envoyer ensuite ces livres dans la base, utilisez « Migrer vers le cloud » : ` +
          `il ajoute les livres absents sans jamais supprimer ni modifier l'existant.\n\n` +
          `Un rechargement de la page annule ce chargement.`;
        if (!window.confirm(msg)) return;
        setBooks(data.books);
        showToast(`${data.books.length} livres chargés (pas encore enregistrés)`);
        setShowSettings(false);
        return;
      }

      // Mode local : là, le remplacement est réel et complet, puisque tout
      // est stocké sur l'appareil.
      const summary = `Importer ${data.books.length} livres et ${data.structure?.bibliotheques?.length || 0} bibliothèques ?\n\nCela REMPLACERA toutes les données stockées sur cet appareil.`;
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

  // Retour d'un lien « mot de passe oublié ». Ce cas passe AVANT le reste :
  // il doit s'imposer même si une session existe déjà sur l'appareil, sans
  // quoi la bibliothèque s'afficherait et le lien resterait sans effet.
  if (isSupabaseConfigured && recoveryMode) {
    return (
      <AuthScreen
        recovery
        onAuthSuccess={(session) => {
          setRecoveryMode(false);
          if (session) setAuthState({ session, user: session.user });
        }}
      />
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















