import React, { useState } from "react";
import { Edit2, Library, Plus, ScanLine } from "lucide-react";
import { Breadcrumb, EmptyState, LevelHeader } from "./ui";
import {
  PieceFormModal, BibFormModal, ShelfFormModal, ConfirmDeleteModal,
} from "./modalesStructure";
import { DraggableCanvas } from "./DraggableCanvas";
import { SmartImg } from "./images";

// ============================================================
// VUE PLAN : pieces -> bibliotheques -> etageres
// ============================================================
// Extraite d'App.jsx. Elle gere la structure physique du logement et
// la disposition visuelle, mais n ecrit jamais elle-meme : elle remonte
// les changements par saveStructure et saveLayout, fournis par App.
//
// genId l accompagne : il ne servait qu ici, a la creation des pieces,
// bibliotheques et etageres.

// Génère un ID unique
const genId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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

// === VUE BIBLIOTHÈQUES — 3 NIVEAUX ===
// === VUE BIBLIOTHÈQUES — 3 NIVEAUX AVEC CRUD ===
export function LibraryView({ books, structure, saveStructure, saveBooks, layout, saveLayout, showToast, onSelectBook, onFilterBib, onQuickScanShelf }) {
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
