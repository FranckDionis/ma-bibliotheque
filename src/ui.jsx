import React from "react";
import { Plus, X, Trash2, Check, Move, ChevronRight } from "lucide-react";

// ============================================================
// COMPOSANTS DE PRÉSENTATION
// ============================================================
// Extraits d'App.jsx. Ils n'ont ni état, ni accès aux données, ni
// dépendance au reste de l'application : uniquement des props et le
// jeu de variables CSS défini une fois pour toutes dans App.
//
// C'est ce qui les rend déplaçables sans risque — et testables, le jour
// où on voudra couvrir l'affichage.

// Étiquette au-dessus d'un champ de formulaire.
export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium mb-1 block" style={{ color: "var(--ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}

// Ligne « libellé / valeur » d'une fiche. Ne s'affiche pas si la valeur
// est vide : c'est ce qui évite les fiches criblées de champs vides.
export function DetailRow({ label, value, suffix = "" }) {
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

// Pastille de filtre, en haut de la vue d'accueil.
export function FilterChip({ active, onClick, children }) {
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

// Bouton de la barre de navigation du bas.
export function NavButton({ icon, label, active, onClick }) {
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

// Grande carte de choix, utilisée à l'ajout d'un objet.
export function ChoiceCard({ icon, title, desc, onClick, highlight }) {
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

// Message affiché quand une pièce, une bibliothèque ou une étagère est vide.
export function EmptyState({ icon, text, actionLabel, onAction }) {
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

// Enveloppe commune à toutes les modales. Le clic sur le fond ferme,
// mais uniquement s'il vise le fond lui-même : sans cette vérification,
// un clic relâché à l'intérieur fermerait la fenêtre par surprise.
export function ModalShell({ title, onCancel, children }) {
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

// Pied de modale. Le bouton Supprimer n'apparaît que si un gestionnaire
// est fourni — une modale de création n'a rien à supprimer.
export function ModalActions({ onCancel, onSave, onDelete, canSave }) {
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

// En-tête d'un niveau de la vue Plan, avec bascule du mode édition.
export function LevelHeader({ title, subtitle, editMode, onToggleEdit, onAdd, addLabel }) {
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

// Fil d'Ariane de la vue Plan : pièce → bibliothèque → étagère.
export function Breadcrumb({ items }) {
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
