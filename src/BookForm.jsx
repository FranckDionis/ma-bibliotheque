import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { BookOpen, Camera, ChevronRight, Edit2, Loader2, MapPin, RotateCcw, Search, Trash2 } from "lucide-react";
import { Field } from "./ui";
import { SmartCover, ImageCropper } from "./images";
import { FIELDS_BY_TYPE, ITEM_TYPES_LIST } from "./itemTypes";
import { GENRE_COLORS } from "./genres";
import { findFirstFreePosition } from "./placement";
import { lookupISBN } from "./rechercheMetadonnees";

// ============================================================
// FORMULAIRE DE FICHE
// ============================================================
// Extrait d'App.jsx. Sert a la fois a l ajout et a la modification.
//
// Il expose une poignee par forwardRef : le parent declenche
// l enregistrement depuis son propre bouton, place en haut de l ecran,
// sans que le formulaire ait a remonter son etat. onDirtyChange le
// previent des modifications non sauvegardees, pour la confirmation
// avant de quitter.

// === FORMULAIRE ===
export const BookForm = forwardRef(function BookForm(
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
    // Un titre reste requis à la CRÉATION, mais pas pour ré-enregistrer une
    // fiche EXISTANTE (ex. jeu scanné sans titre reconnu dont on veut juste
    // sauver la couverture recadrée). Sinon l'enregistrement resterait bloqué.
    if (!title.trim() && isCreation) return;
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
    // Enregistrable si un titre est saisi, OU s'il s'agit d'une fiche déjà
    // existante (édition) — on n'exige un titre qu'à la création.
    canSubmit: () => !!title.trim() || !isCreation,
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

      {/* Bibliothèque virtuelle (classification) — placée juste sous le type
          d'objet, visible sans avoir à déplier « Plus de détails ». */}
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
