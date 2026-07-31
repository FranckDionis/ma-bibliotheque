import React, { useState, useEffect, useRef } from "react";
import { X, Download, Upload, Trash2, RotateCcw, LogOut, Cloud, CloudOff } from "lucide-react";
import { STORAGE_KEY } from "./stockageLocal";

// ============================================================
// MODALE PARAMETRES
// ============================================================
// Extraite d'App.jsx. Elle ne decide de rien : chaque action lui est
// fournie en prop par App, qui detient l etat et les acces aux donnees.
// C est ce qui a rendu ce deplacement anodin -- son interface etait
// deja explicite, avec ses vingt et une props nommees.

// === MODALE PARAMÈTRES (export/import/enrichissement) ===
export function SettingsModal({
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

                {/* Le bouton « Vider le cache local des couvertures » se
                    trouvait ici. Il n'a plus d'objet : les couvertures sont
                    servies par le CDN à partir d'URL, et c'est le navigateur
                    qui gère leur cache. Un remplacement d'image reste visible
                    immédiatement grâce au suffixe de version ajouté à l'URL
                    au moment de l'envoi (voir materialiserCover dans db.js). */}

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
