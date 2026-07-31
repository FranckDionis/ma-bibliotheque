import React, { useState } from "react";
import { X, Zap } from "lucide-react";
import { Breadcrumb } from "./ui";
import { findFirstFreePosition } from "./placement";

// Choix de l emplacement avant un scan en serie : piece, bibliotheque,
// puis etagere -- meme parcours a trois niveaux que la vue Plan.

// === SETUP DU SCAN EN SÉRIE ===
// Présentation à 3 niveaux comme la vue "Plan" : on choisit d'abord une pièce,
// puis une bibliothèque, puis une étagère. Plus naturel et plus rapide qu'un
// formulaire avec un select et des champs numériques, surtout sur mobile.
export function BatchSetup({ books, structure, onCancel, onStart }) {
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
