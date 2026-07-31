import React, { useState, useEffect, useRef } from "react";
import { AlertTriangle, ArrowRight, BookOpen, Camera, Check, Edit2, Loader2 } from "lucide-react";
import { Field } from "./ui";
import { SmartImg, compressImageDataUrl } from "./images";
import { findFirstFreePosition } from "./placement";
import { lookupAnyBarcode } from "./rechercheMetadonnees";
import { guessTypeFromBarcode, recognizeMagazine, recognizeGame, recognizePressPublisher } from "./itemTypes";
import { createBarcodeReader } from "./lecteurCodeBarres";

// ============================================================
// SCAN EN SERIE
// ============================================================
// Extrait d'App.jsx. Le composant le plus intrique du projet : il tient
// la camera, enchaine les codes sans repasser par un formulaire, et cree
// les fiches a la volee.
//
// Deux precautions y sont structurantes, a ne pas defaire :
//   - les mises a jour d etat passent par setBooks(prev => ...) et par des
//     refs, pour que deux scans rapproches ne travaillent pas sur une
//     valeur perimee capturee dans une closure ;
//   - les positions attribuees pendant la session sont reservees a part,
//     les fiches creees n etant pas encore refletees dans `books`.
//
// Les trois modales qui suivent lui sont propres : repli photo quand un
// code ne donne rien, edition rapide du titre, signalement de doublon.

// === SCANNER EN SÉRIE ===
export function BatchScanner({ books, structure, setup, onAddBook, onEnrichBook, onEnrichBookById, onChangeShelf, onFinish, showToast }) {
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
