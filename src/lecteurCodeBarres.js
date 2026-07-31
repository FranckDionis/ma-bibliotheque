// ============================================================
// LECTEUR DE CODES-BARRES
// ============================================================
// Extrait d'App.jsx. Encapsule ZXing et le repli sur BarcodeDetector,
// et surtout le chargement differe du module de decodage.

export async function loadZXing() {
  if (!_zxing) {
    const [navigateur, bibliotheque] = await Promise.all([
      import("@zxing/browser"),
      import("@zxing/library"),
    ]);
    _zxing = {
      BrowserMultiFormatReader: navigateur.BrowserMultiFormatReader,
      BarcodeFormat: bibliotheque.BarcodeFormat,
      DecodeHintType: bibliotheque.DecodeHintType,
    };
  }
  return _zxing;
}

// Crée un reader ZXing configuré pour les formats de codes-barres produit.
// On précise explicitement les formats pour que ZXing soit plus rapide et plus
// fiable sur iOS, notamment pour UPC-A (codes nord-américains 12 chiffres
// utilisés sur les boîtes Nintendo Switch).
export async function createConfiguredReader() {
  const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await loadZXing();
  const hints = new Map();
  const formats = [
    BarcodeFormat.EAN_13,    // Livres (978/979), revues, jeux européens
    BarcodeFormat.EAN_8,     // Petits codes
    BarcodeFormat.UPC_A,     // Jeux Nintendo US, produits américains
    BarcodeFormat.UPC_E,     // Variante compacte UPC
    BarcodeFormat.CODE_128,  // Au cas où certaines boîtes en utilisent
    BarcodeFormat.CODE_39,
  ];
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  // TRY_HARDER : ZXing prend un peu plus de CPU mais lit mieux les codes mal cadrés
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints);
}

export async function createBarcodeReader() {
  // Tentative ZXing en priorité (fonctionne sur Safari iOS)
  try {
    // createConfiguredReader charge le module au premier appel : l'attente
    // est donc ici, avant toute demande d'accès à la caméra.
    const reader = await createConfiguredReader();
    let controls = null;
    let stream = null;
    return {
      type: "zxing",
      async startScanning(videoEl, onResult) {
        // 1) Demande l'accès caméra nous-mêmes (déclenchement par interaction utilisateur)
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        // 2) Attache le stream à la balise vidéo et attend qu'elle soit prête
        videoEl.srcObject = stream;
        videoEl.setAttribute("playsinline", "true");
        videoEl.setAttribute("muted", "true");
        videoEl.muted = true;

        await new Promise((resolve, reject) => {
          let settled = false;
          const onReady = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const onError = (err) => {
            if (settled) return;
            settled = true;
            reject(err);
          };
          videoEl.onloadedmetadata = onReady;
          videoEl.oncanplay = onReady;
          videoEl.onerror = onError;
          // Timeout de sécurité : si rien ne se passe en 4 sec, on abandonne
          setTimeout(() => onError(new Error("video-timeout")), 4000);
        });

        try {
          await videoEl.play();
        } catch (err) {
          // iOS peut bloquer play() ; on continue, ZXing essaiera quand même
        }

        // 3) Lance ZXing sur la balise vidéo déjà active
        controls = reader.decodeFromVideoElement(videoEl, (result) => {
          if (result) onResult(result.getText());
        });
      },
      stop() {
        if (controls) {
          try { controls.stop(); } catch (e) { /* ignore */ }
          controls = null;
        }
        if (stream) {
          try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
          stream = null;
        }
      },
    };
  } catch (e) {
    // Fallback BarcodeDetector si ZXing inaccessible
    if ("BarcodeDetector" in window) {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const isbnFormats = formats.filter((f) => ["ean_13", "ean_8", "upc_a", "upc_e"].includes(f));
      if (isbnFormats.length === 0) throw new Error("no-format");
      const detector = new window.BarcodeDetector({ formats: isbnFormats });
      let stream = null, intervalId = null;
      return {
        type: "native",
        async startScanning(videoEl, onResult) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }, audio: false,
          });
          videoEl.srcObject = stream;
          videoEl.setAttribute("playsinline", "true");
          videoEl.muted = true;
          await videoEl.play();
          intervalId = setInterval(async () => {
            try {
              const codes = await detector.detect(videoEl);
              if (codes.length > 0) onResult(codes[0].rawValue);
            } catch (err) { /* ignore */ }
          }, 400);
        },
        stop() {
          if (intervalId) { clearInterval(intervalId); intervalId = null; }
          if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
        },
      };
    }
    throw new Error("no-scanner");
  }
}

