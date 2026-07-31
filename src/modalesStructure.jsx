import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Field, ModalShell, ModalActions } from "./ui";

// ============================================================
// MODALES DE LA STRUCTURE : pièces, bibliothèques, étagères
// ============================================================
// Extraites d'App.jsx. Elles ne touchent ni à la base ni à l'état
// global : elles collectent une saisie et la remettent à l'appelant par
// onSave. C'est LibraryView qui décide quoi en faire.
//
// Aucune ne génère d'identifiant : elles renvoient l'objet d'origine
// enrichi (`...(piece || {})`), ce qui préserve l'id en modification et
// laisse l'appelant en créer un à l'ajout.

// Choix d'icône d'une pièce. Volontairement court : une grille d'emoji
// trop fournie rend le choix pénible sur un écran de téléphone.
const ICON_CHOICES = ["🍽️", "🛋️", "🛏️", "📚", "🚪", "🪑", "🍳", "🛁", "🧸", "🪟", "🏠", "✨", "🎨", "🎮", "🌿"];

export function PieceFormModal({ piece, onCancel, onSave, onDelete }) {
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

export function BibFormModal({ bib, pieceId, structure, onCancel, onSave, onDelete }) {
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

export function ShelfFormModal({ shelf, bibId, existingNums, onCancel, onSave, onDelete }) {
  const nextNum = existingNums.length === 0 ? 1 : Math.max(...existingNums) + 1;
  const [num, setNum] = useState(shelf?.num?.toString() || nextNum.toString());
  const [nom, setNom] = useState(shelf?.nom || "");
  const isEditing = !!shelf;

  const numInt = parseInt(num) || 0;
  // En modification, l'étagère porte déjà son propre numéro : le
  // considérer comme un doublon interdirait de valider sans rien changer.
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

// Confirmation de suppression. N'utilise PAS ModalActions : les deux
// boutons n'ont pas la même valeur qu'ailleurs — celui de droite est
// destructeur, et il est coloré comme tel.
export function ConfirmDeleteModal({ info, onCancel, onConfirm }) {
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
