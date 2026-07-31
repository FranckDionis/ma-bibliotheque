import React, { useState, useRef, useEffect } from "react";
import { Edit2, RotateCcw, Save } from "lucide-react";

// ============================================================
// CANEVAS DE DISPOSITION (glisser-deposer du plan)
// ============================================================
// Extrait d'App.jsx. Positionne librement des elements sur une
// surface, en pourcentages plutot qu'en pixels pour rester correct
// quel que soit l'ecran.

// === CANVAS DRAG-AND-DROP ===
export function DraggableCanvas({ editMode, items, onMove, onTap, onLongPress, onSave, onReset }) {
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
