import React, { useState, useRef, useEffect } from "react";
import { Camera } from "lucide-react";

// ============================================================
// IMAGES : affichage adaptatif, prise de vue, recadrage
// ============================================================
// Extraits d'App.jsx. Ces quatre composants ne dependent que de React
// et du canevas du navigateur : ni base de donnees, ni etat global.

// ============================================================
// COUVERTURE ADAPTATIVE (portrait livre / paysage jeu)
// ============================================================
// Les livres ont des jaquettes portrait ; les boîtes de jeux sont en paysage.
// Ce composant mesure le ratio réel de l'image une fois chargée et choisit :
//   • portrait / carré → object-cover  (remplit le cadre — comportement livre)
//   • paysage          → object-contain (affiche TOUTE la boîte, sans rogner)
// Si `adaptFrame` est vrai, le cadre lui-même bascule en paysage
// (classe `landscapeFrameClass`) pour donner toute sa place au visuel du jeu.
// Variante « image seule » : à utiliser dans les cadres/boutons existants qui
// ont déjà leur propre wrapper (ou une surimpression). Choisit object-contain
// pour un visuel paysage (pas de rognage) et object-cover sinon.
export function SmartImg({ src, alt = "", className = "", style }) {
  const [fit, setFit] = useState("object-cover");
  const onLoad = (e) => {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    if (w && h) setFit(w > h * 1.1 ? "object-contain" : "object-cover");
  };
  return (
    <img src={src} alt={alt} onLoad={onLoad} className={`${className} ${fit}`} style={style} />
  );
}

export function SmartCover({
  src,
  alt = "",
  frameClass = "",
  landscapeFrameClass = "",
  frameStyle,
  fallback = null,
  adaptFrame = false,
}) {
  const [orientation, setOrientation] = useState("unknown");
  const isLandscape = orientation === "landscape";
  const handleLoad = (e) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w && h) setOrientation(w > h * 1.1 ? "landscape" : "portrait");
  };
  // Cadre : on bascule en paysage seulement si demandé ET image paysage.
  const frame =
    adaptFrame && isLandscape && landscapeFrameClass
      ? landscapeFrameClass
      : frameClass;
  // object-contain en paysage pour ne rien rogner ; object-cover sinon.
  const fit = isLandscape ? "object-contain" : "object-cover";
  return (
    <div
      className={`overflow-hidden flex items-center justify-center ${frame}`}
      style={frameStyle}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          onLoad={handleLoad}
          className={`w-full h-full ${fit}`}
        />
      ) : (
        fallback
      )}
    </div>
  );
}

// === RECADRAGE D'IMAGE (rectangle libre) ===
// Modale plein écran : l'image est affichée à l'échelle, avec un rectangle de
// sélection déplaçable (glisser le centre) et redimensionnable par 8 poignées
// (4 coins + 4 bords). Les poignées de bord haut/bas servent précisément à
// rogner le haut et le bas d'une photo portrait pour en faire une jaquette.
// Tout est piloté en pointer events → fonctionne au doigt sur iPhone.
// À la validation, on découpe à la résolution native de l'image puis on
// recompresse via compressImageDataUrl (même pipeline que le reste de l'appli).
export function ImageCropper({ src, onCancel, onCrop }) {
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState(null); // en px de l'image AFFICHÉE
  const [busy, setBusy] = useState(false);
  const MIN = 30;

  const initRect = () => {
    const el = imgRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setDisp({ w, h });
    // Sélection de départ : pleine largeur, 70 % de hauteur centrée
    // (invite naturellement à rogner le haut et le bas).
    const ch = Math.round(h * 0.7);
    setRect({ x: 0, y: Math.round((h - ch) / 2), w, h: ch });
  };

  // ⚠️ Correctif « couverture déjà présente » : une image en cache est souvent
  // déjà `complete` au montage, donc l'événement onLoad ne se déclenche jamais
  // et le cadre de recadrage n'était jamais initialisé (→ « Valider » sans
  // effet, on ne pouvait qu'annuler). On initialise donc aussi au montage si
  // l'image est déjà chargée. Un petit rAF laisse le layout se stabiliser.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth) {
      requestAnimationFrame(() => initRect());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const onResize = () => initRect();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const clampRect = (r) => {
    let { x, y, w, h } = r;
    w = Math.max(MIN, Math.min(w, disp.w));
    h = Math.max(MIN, Math.min(h, disp.h));
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > disp.w) x = disp.w - w;
    if (y + h > disp.h) y = disp.h - h;
    return { x, y, w, h };
  };

  const startDrag = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, orig: rect };
    try { wrapRef.current?.setPointerCapture?.(e.pointerId); } catch (err) {}
  };

  const onMove = (e) => {
    if (!dragRef.current) return;
    const { mode, sx, sy, orig } = dragRef.current;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    let r = { ...orig };
    if (mode === "move") { r.x = orig.x + dx; r.y = orig.y + dy; }
    if (mode.includes("e")) r.w = orig.w + dx;
    if (mode.includes("s")) r.h = orig.h + dy;
    if (mode.includes("w")) { r.x = orig.x + dx; r.w = orig.w - dx; }
    if (mode.includes("n")) { r.y = orig.y + dy; r.h = orig.h - dy; }
    setRect(clampRect(r));
  };

  const endDrag = () => { dragRef.current = null; };

  // Recadrage robuste : on GARANTIT que onCrop() est toujours appelé une fois
  // (donc que la fiche est marquée modifiée et que « Enregistrer » s'active),
  // même si le chargement de l'image échoue ou traîne. Pas de seconde étape de
  // compression asynchrone (source des blocages « ça marche 2 fois puis plus »):
  // le canvas produit directement un JPEG déjà redimensionné.
  const doCrop = async () => {
    if (busy) return;
    setBusy(true);
    // finish() est le SEUL chemin de sortie : setBusy(false) + onCrop() garantis.
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      setBusy(false);
      onCrop(val);
    };
    try {
      // Cadre courant (repli sur l'image entière s'il n'est pas encore prêt).
      const el = imgRef.current;
      let curDisp = disp.w && disp.h ? disp : (el ? { w: el.clientWidth, h: el.clientHeight } : null);
      let curRect = rect || (curDisp ? { x: 0, y: 0, w: curDisp.w, h: curDisp.h } : null);
      if (!curRect || !curDisp) { finish(src); return; }

      // Chargement de l'image avec timeout (8 s) pour ne JAMAIS rester bloqué.
      const image = await new Promise((res, rej) => {
        const im = new Image();
        if (/^https?:\/\//i.test(src)) im.crossOrigin = "anonymous";
        const t = setTimeout(() => rej(new Error("timeout")), 8000);
        im.onload = () => { clearTimeout(t); res(im); };
        im.onerror = () => { clearTimeout(t); rej(new Error("load")); };
        im.src = src;
      });

      const scaleX = image.naturalWidth / (curDisp.w || 1);
      const scaleY = image.naturalHeight / (curDisp.h || 1);
      const sx = Math.max(0, Math.round(curRect.x * scaleX));
      const sy = Math.max(0, Math.round(curRect.y * scaleY));
      const sw = Math.max(1, Math.round(curRect.w * scaleX));
      const sh = Math.max(1, Math.round(curRect.h * scaleY));

      // Redimensionnement direct dans le canvas (cap 1000 px de large) → un seul
      // encodage, pas de rechargement d'image supplémentaire.
      const MAXW = 1000;
      let outW = sw, outH = sh;
      if (outW > MAXW) { outH = Math.max(1, Math.round(outH * (MAXW / outW))); outW = MAXW; }

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      finish(dataUrl);
    } catch (err) {
      // CORS non autorisé, timeout, etc. : on renvoie l'image d'origine pour ne
      // pas bloquer le flux (le recadrage n'est alors pas appliqué, mais la
      // fiche reste enregistrable).
      finish(src);
    }
  };

  const handleDot = (mode, pos) => (
    <div
      onPointerDown={startDrag(mode)}
      style={{
        position: "absolute",
        width: 20,
        height: 20,
        marginLeft: -10,
        marginTop: -10,
        background: "var(--cream, #fff)",
        border: "2px solid var(--leather-dark, #5a3d2b)",
        borderRadius: 5,
        touchAction: "none",
        ...pos,
      }}
    />
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <p style={{ color: "#fff", marginBottom: 12, fontSize: "0.9rem", textAlign: "center", maxWidth: 340 }}>
        Ajuste le cadre pour rogner. Glisse les poignées du haut et du bas pour
        couper, ou le centre pour déplacer.
      </p>
      <div
        ref={wrapRef}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ position: "relative", touchAction: "none", lineHeight: 0, maxWidth: "100%", maxHeight: "68vh" }}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          onLoad={initRect}
          draggable={false}
          style={{ maxWidth: "100%", maxHeight: "68vh", display: "block", userSelect: "none" }}
        />
        {rect && (
          <>
            <div
              onPointerDown={startDrag("move")}
              style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.9)",
                cursor: "move",
                touchAction: "none",
              }}
            />
            {handleDot("nw", { left: rect.x, top: rect.y })}
            {handleDot("ne", { left: rect.x + rect.w, top: rect.y })}
            {handleDot("sw", { left: rect.x, top: rect.y + rect.h })}
            {handleDot("se", { left: rect.x + rect.w, top: rect.y + rect.h })}
            {handleDot("n", { left: rect.x + rect.w / 2, top: rect.y })}
            {handleDot("s", { left: rect.x + rect.w / 2, top: rect.y + rect.h })}
            {handleDot("w", { left: rect.x, top: rect.y + rect.h / 2 })}
            {handleDot("e", { left: rect.x + rect.w, top: rect.y + rect.h / 2 })}
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)" }}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => { const el = imgRef.current; if (el) setRect({ x: 0, y: 0, w: el.clientWidth, h: el.clientHeight }); }}
          disabled={busy}
          style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)" }}
        >
          Tout sélectionner
        </button>
        <button
          type="button"
          onClick={doCrop}
          disabled={busy}
          style={{ padding: "10px 18px", borderRadius: 10, background: "var(--leather-dark, #5a3d2b)", color: "var(--cream, #fff)", border: "1px solid var(--gold, #c9a24b)", fontWeight: 600 }}
        >
          {busy ? "…" : "Valider le recadrage"}
        </button>
      </div>
    </div>
  );
}

// === SCANNER COUVERTURE ===
export function CoverScanner({ onCancel, onCapture }) {
  const fileRef = useRef(null);
  // Image brute juste prise/importée, en attente de recadrage.
  const [rawImg, setRawImg] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    // On garde l'image pleine résolution pour la passer au recadreur ;
    // la compression a lieu APRÈS le recadrage.
    reader.onload = (ev) => setRawImg(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Étape de recadrage dès qu'une photo est disponible.
  if (rawImg) {
    return (
      <ImageCropper
        src={rawImg}
        onCancel={() => setRawImg(null)}
        onCrop={(dataUrl) => { setRawImg(null); onCapture(dataUrl); }}
      />
    );
  }

  return (
    <div className="text-center pt-4">
      <div className="w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-4"
        style={{ background: "var(--parchment)" }}>
        <Camera className="w-10 h-10" style={{ color: "var(--leather)" }} />
      </div>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", color: "var(--ink)", marginBottom: "0.5rem" }}>
        Photo de la couverture
      </h3>
      <p className="text-sm mb-6" style={{ color: "var(--ink-soft)" }}>
        Prenez la couverture en photo, vous compléterez les informations ensuite.
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
        className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2"
        style={{ background: "var(--leather-dark)", color: "var(--cream)" }}
      >
        <Camera className="w-5 h-5" /> Ouvrir l'appareil photo
      </button>
    </div>
  );
}

