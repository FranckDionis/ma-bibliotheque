import { upgradeGoogleCover, isbn13ToIsbn10, upcToEan } from "./codesBarres";
import { recognizeMagazine, recognizeGame, recognizePressPublisher } from "./itemTypes";

// ============================================================
// RECHERCHE DE METADONNEES PAR CODE-BARRES
// ============================================================
// Extrait d'App.jsx. Interroge en cascade Google Books, Open Library,
// la BnF, Open Food Facts, UPCitemdb, BoardGameGeek et Wikidata, puis
// fusionne ce qui revient.
//
// Tout se fait DEPUIS LE NAVIGATEUR, sans passerelle : chacune de ces
// sources autorise les appels d'une autre origine. Une fonction
// serverless faisait autrefois ce travail cote serveur ; elle avait ete
// abandonnee au profit des appels directs, mais etait restee deployee
// et sans usage jusqu'au 31/07/2026.
//
// Seules trois fonctions sortent d'ici : findCoverFor, lookupAnyBarcode
// et lookupISBN. Le reste est de la tuyauterie interne.

// ============================================================
// Recherche ISBN multi-source : Google Books → Open Library → BNF
// Retourne { title, author, cover, publisher, year, source, debug } ou null
// ============================================================

// Fetch avec timeout pour qu'une source lente ne bloque pas tout
async function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Google Books — excellent sur les livres français, gratuit, sans clé
async function lookupGoogleBooks(isbn) {
  // On essaie deux requêtes : isbn:NNNN (strict) puis NNNN simple (plus permissif)
  for (const q of [`isbn:${isbn}`, isbn]) {
    try {
      const res = await fetchWithTimeout(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1&langRestrict=fr`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const itemRoot = data.items?.[0];
      const item = itemRoot?.volumeInfo;
      if (!item || !item.title) continue;
      const cover = upgradeGoogleCover(
        item.imageLinks?.extraLarge ||
        item.imageLinks?.large ||
        item.imageLinks?.medium ||
        item.imageLinks?.thumbnail ||
        item.imageLinks?.smallThumbnail ||
        ""
      );
      // Mappe la langue Google vers un libellé lisible
      const langMap = { fr: "Français", en: "Anglais", es: "Espagnol", de: "Allemand", it: "Italien", pt: "Portugais", nl: "Néerlandais", ru: "Russe", ja: "Japonais", zh: "Chinois", ar: "Arabe" };
      return {
        title: item.title || "",
        subtitle: item.subtitle || "",
        author: (item.authors || []).join(", "),
        cover,
        publisher: item.publisher || "",
        year: item.publishedDate || "",
        // === NOUVEAUX CHAMPS ===
        pages: item.pageCount || 0,
        language: langMap[item.language] || item.language || "",
        description: item.description || "",
        categories: (item.categories || []).join(", "),
        rating: item.averageRating || 0,
        ratingsCount: item.ratingsCount || 0,
        infoLink: item.infoLink || itemRoot?.selfLink || "",
        // Format physique : Google Books ne le donne pas directement, on en déduit depuis le format si possible
        format: "",
        // Dimensions : Google ne les fournit pas dans volumeInfo standard
        dimensions: "",
        weight: "",
        source: "Google Books",
      };
    } catch (e) { /* essai suivant */ }
  }
  return null;
}

// Open Library — bonne pour livres anglo-saxons et anciens
// On utilise jscmd=data pour les métadonnées de base + jscmd=details pour le complément
async function lookupOpenLibrary(isbn) {
  try {
    // jscmd=data : info synthétisée (titre, auteur, etc.)
    // jscmd=details : record bibliographique brut (pagination, physical format, dimensions...)
    const [resData, resDetails] = await Promise.all([
      fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`),
      fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=details`),
    ]);
    const data = resData.ok ? await resData.json() : {};
    const detailsData = resDetails.ok ? await resDetails.json() : {};
    const book = data[`ISBN:${isbn}`];
    const details = detailsData[`ISBN:${isbn}`]?.details || {};
    if (!book && !details.title) return null;
    const main = book || {};

    // Description : peut être string ou {value: string} dans details
    let description = "";
    if (typeof details.description === "string") description = details.description;
    else if (details.description?.value) description = details.description.value;
    if (!description && main.notes) {
      description = typeof main.notes === "string" ? main.notes : (main.notes.value || "");
    }

    // Catégories / sujets
    const categories = (main.subjects || details.subjects || [])
      .slice(0, 6)
      .map((s) => typeof s === "string" ? s : s.name)
      .filter(Boolean)
      .join(", ");

    // Pages
    const pages = details.number_of_pages || main.number_of_pages || 0;

    // Format physique
    const format = details.physical_format || main.physical_format || "";

    // Dimensions
    const dimensions = details.physical_dimensions || "";
    const weight = details.weight || "";

    // Langue
    const langMap = { fre: "Français", fra: "Français", eng: "Anglais", spa: "Espagnol", ger: "Allemand", deu: "Allemand", ita: "Italien" };
    let language = "";
    if (Array.isArray(details.languages) && details.languages.length > 0) {
      const lkey = details.languages[0]?.key || "";
      const code = lkey.replace("/languages/", "");
      language = langMap[code] || code;
    }

    return {
      title: main.title || details.title || "",
      subtitle: main.subtitle || details.subtitle || "",
      author: (main.authors || []).map((a) => a.name).filter(Boolean).join(", "),
      cover: main.cover?.large || main.cover?.medium || main.cover?.small || "",
      publisher: main.publishers?.[0]?.name || (Array.isArray(details.publishers) ? details.publishers[0] : "") || "",
      year: main.publish_date || details.publish_date || "",
      // === NOUVEAUX CHAMPS ===
      pages,
      language,
      description,
      categories,
      rating: 0, // Open Library n'a pas de notes
      ratingsCount: 0,
      infoLink: main.url || (details.key ? `https://openlibrary.org${details.key}` : ""),
      format,
      dimensions,
      weight,
      source: "Open Library",
    };
  } catch (e) {
    return null;
  }
}

// Vérifie qu'une URL d'image se charge effectivement.
// Plus fiable qu'un fetch+blob car évite les soucis CORS sur les binaires.
function probeImageUrl(url, timeoutMs = 4000, minSize = 60) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const img = new Image();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    img.onload = () => {
      // Open Library renvoie une image 1x1 quand non trouvé sans ?default=false
      // Amazon renvoie une image ~43x60 quand "no image available"
      // On filtre selon une taille minimale raisonnable pour une vraie couverture
      if (img.naturalWidth >= minSize && img.naturalHeight >= minSize) finish(true);
      else finish(false);
    };
    img.onerror = () => finish(false);
    setTimeout(() => finish(false), timeoutMs);
    img.src = url;
  });
}

// Cherche une couverture pour un ISBN en essayant plusieurs sources EN PARALLÈLE.
// Renvoie la première URL qui charge une image valide (>= 60px), ou "" sinon.
export async function findCoverFor(isbn) {
  const cleanIsbn = isbn.replace(/\D/g, "");
  const isbn10 = cleanIsbn.length === 13 ? isbn13ToIsbn10(cleanIsbn) : (cleanIsbn.length === 10 ? cleanIsbn : null);

  // SOURCES ORDONNÉES PAR FIABILITÉ (de la plus fiable à la moins).
  // On essaie en SÉQUENCE et on prend la première qui marche.
  // Justification : Google Books "vid:ISBN" renvoie souvent un placeholder gris OU
  // une image d'une autre édition portant des mots-clés similaires (couvertures
  // mélangées). On l'a donc retiré ici. Seul Google Books via l'API JSON
  // (lookupGoogleBooks) est conservé, car il identifie un volume précis.
  const sources = [];

  // 1) Open Library — fiable, l'image correspond strictement à l'ISBN
  sources.push({
    name: "Open Library",
    url: `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg?default=false`,
  });

  // 2) Amazon ISBN-10 — excellent sur le fonds FR, image strictement liée à l'ISBN
  if (isbn10) {
    sources.push({
      name: "Amazon (large)",
      url: `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01._SCLZZZZZZZ_.jpg`,
    });
    sources.push({
      name: "Amazon (default)",
      url: `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.jpg`,
    });
    sources.push({
      name: "Amazon (m.media)",
      url: `https://m.media-amazon.com/images/P/${isbn10}.jpg`,
    });
  }

  // 3) Open Library taille M (fallback si la L n'est pas dispo)
  sources.push({
    name: "Open Library (M)",
    url: `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-M.jpg?default=false`,
  });

  // Test séquentiel : on prend la première qui charge une vraie image
  for (const s of sources) {
    if (await probeImageUrl(s.url, 4000, 80)) {
      return s.url;
    }
  }
  return "";
}


// BNF SRU — la Bibliothèque nationale de France, exhaustive sur le fonds français
// ATTENTION : sujette à des problèmes CORS — peut échouer en navigateur
async function lookupBNF(isbn) {
  try {
    const url = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=bib.isbn%20adj%20%22${isbn}%22&recordSchema=unimarcxchange&maximumRecords=1`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const fields = doc.querySelectorAll("datafield");
    let title = "", author = "", publisher = "", year = "";
    fields.forEach((f) => {
      const tag = f.getAttribute("tag");
      const sub = (code) => f.querySelector(`subfield[code="${code}"]`)?.textContent || "";
      if (tag === "200" && !title) {
        title = sub("a");
        if (!author) author = sub("f");
      }
      if (tag === "210" && !publisher) {
        publisher = sub("c");
        year = sub("d");
      }
      if (tag === "700" && !author) {
        author = `${sub("b")} ${sub("a")}`.trim();
      }
    });
    if (!title) return null;
    return {
      title: title.trim().replace(/\s*:\s*$/, ""),
      author: author.trim(),
      cover: "",
      publisher: publisher.trim(),
      year: year.trim(),
      source: "BnF",
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// SOURCES POUR PRODUITS NON-LIVRES (jeux, autres EAN/UPC)
// ============================================================

// Open Food Facts gère un endpoint produit générique (pas que de l'alimentaire) :
// world.openfoodfacts.org couvre des dizaines de millions d'EAN/UPC, dont des
// boîtes de jeux et jeux Switch. Gratuit, sans clé, CORS ouvert.
// Les jaquettes y sont souvent disponibles en photo utilisateur.
async function lookupOpenFoodFacts(code) {
  try {
    const res = await fetchWithTimeout(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const title = p.product_name || p.product_name_fr || p.generic_name || "";
    if (!title) return null;
    // Photo : front_url > image_url > image_front_url
    const cover =
      p.image_front_url ||
      p.image_url ||
      p.selected_images?.front?.display?.fr ||
      p.selected_images?.front?.display?.en ||
      "";
    return {
      title,
      author: "",
      cover,
      publisher: p.brands || "",
      year: "",
      description: p.generic_name || "",
      source: "Open Food Facts",
    };
  } catch (e) {
    return null;
  }
}

// UPCitemdb — base communautaire couvrant des dizaines de millions d'UPC/EAN,
// avec une très bonne couverture des jeux de société (Ravensburger, Asmodee,
// Cocktail Games, Hasbro…) et des visuels marchands de bonne qualité, là où
// Open Food Facts ne remonte souvent rien pour une boîte de jeu.
// Endpoint « trial » : gratuit, sans clé, CORS ouvert. Limité à ~100 requêtes/
// jour par IP — suffisant pour un usage de scan ponctuel. En cas de dépassement
// l'API renvoie { code: "TOO_MANY_REQUESTS" | "TOO_FAST" } et on retombe sur null.
async function lookupUPCitemdb(code) {
  const clean = (code || "").replace(/\D/g, "");
  if (!clean) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${clean}`,
      6000
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "OK" || !Array.isArray(data.items) || !data.items.length) {
      return null;
    }
    const item = data.items[0];
    // Nettoyage du titre : les fiches UPCitemdb reprennent souvent le libellé
    // Amazon, verbeux et suffixé d'un ASIN entre parenthèses « (B07GVVCRFV) ».
    let title = String(item.title || "").trim();
    title = title.replace(/\s*\((?:ASIN[:\s]*)?B0[A-Z0-9]{8,9}\)\s*$/i, "").trim();
    if (!title) return null;
    // Première VRAIE image http(s) comme couverture (on force https et on
    // écarte les placeholders — « no_image.gif » d'Alibris, .tif de Macy's, etc.
    // qui salissaient les jaquettes récupérées).
    const cover = (item.images || [])
      .map((u) => (u || "").replace(/^http:\/\//i, "https://"))
      .find(
        (u) =>
          /^https:\/\//i.test(u) &&
          !/no[_-]?image|placeholder|spacer|blank|default/i.test(u) &&
          !/\.(tif|tiff|gif)(\?|$)/i.test(u)
      ) || "";
    return {
      title,
      author: "",
      cover,
      publisher: item.brand || "",
      year: "",
      description: item.description || "",
      category: item.category || "",
      source: "UPCitemdb",
    };
  } catch (e) {
    return null;
  }
}

// BoardGameGeek — référence absolue pour les jeux de société, et surtout LA
// meilleure source d'art de boîte (visuels paysage, haute qualité).
// L'API BGG (XML) ne fait pas de recherche par EAN : on cherche par NOM (le
// titre déjà obtenu via KNOWN_GAMES / Open Food Facts / UPCitemdb), on prend le
// 1er résultat « boardgame », puis on lit sa <image>.
//
// ⚠️ CORS : l'API BGG n'envoie pas d'en-tête Access-Control-Allow-Origin, donc
// un fetch direct depuis le navigateur est bloqué. On passe par un proxy CORS.
// Par défaut on utilise allorigins (public, gratuit) pour que ça marche tout de
// suite, mais en production il vaut MIEUX router via ton propre backend (celui
// qui sert déjà les livres) pour la fiabilité. Mets "" pour désactiver BGG.
const BGG_COVER_PROXY = "https://api.allorigins.win/raw?url=";

// Récupère une jaquette (art de boîte) sur BoardGameGeek à partir d'un titre.
// Ne s'applique qu'aux jeux. Renvoie une URL d'image ou "" en cas d'échec.
async function lookupBGGCover(title, type) {
  const name = (title || "").trim();
  if (!name) return "";
  if (type !== "jeu-societe" && type !== "jeu-switch") return "";
  if (!BGG_COVER_PROXY && typeof BGG_COVER_PROXY !== "string") return "";
  const wrap = (u) => (BGG_COVER_PROXY ? BGG_COVER_PROXY + encodeURIComponent(u) : u);
  try {
    // 1) Recherche par nom (type boardgame)
    const sRes = await fetchWithTimeout(
      wrap(`https://boardgamegeek.com/xmlapi2/search?type=boardgame&query=${encodeURIComponent(name)}`),
      7000
    );
    if (!sRes.ok) return "";
    const sXml = await sRes.text();
    const idMatch = sXml.match(/<item\b[^>]*\bid="(\d+)"/i);
    if (!idMatch) return "";
    const id = idMatch[1];
    // 2) Fiche détaillée → <image> (grande) ou <thumbnail> à défaut
    const tRes = await fetchWithTimeout(
      wrap(`https://boardgamegeek.com/xmlapi2/thing?id=${id}`),
      7000
    );
    if (!tRes.ok) return "";
    const tXml = await tRes.text();
    const imgMatch =
      tXml.match(/<image>([^<]+)<\/image>/i) ||
      tXml.match(/<thumbnail>([^<]+)<\/thumbnail>/i);
    let img = imgMatch ? imgMatch[1].trim() : "";
    if (img.startsWith("//")) img = "https:" + img;
    return /^https?:\/\//i.test(img) ? img : "";
  } catch (e) {
    return "";
  }
}

// Wikidata SPARQL — recherche un objet par GTIN (P3962) puis par EAN-13/UPC
// dans les propriétés alternatives (P5749 = ISBN-13, etc.).
// Wikidata expose CORS ouvert et ne demande pas de clé. Le résultat n'est pas
// garanti (Wikidata indexe loin de tous les produits) mais c'est un excellent
// secours pour les jeux Switch et grosses sorties commerciales.
async function lookupWikidata(code) {
  const clean = (code || "").replace(/\D/g, "");
  if (!clean) return null;
  // Variantes du code à tester (EAN-13 et UPC-A-préfixé-d-un-0)
  const variants = new Set([clean]);
  if (clean.length === 12) variants.add("0" + clean);
  if (clean.length === 13 && clean.startsWith("0")) variants.add(clean.slice(1));

  // P3962 = GTIN (le plus courant pour les produits commerciaux)
  // On cherche aussi via le label en filtrant sur Q-items "video game" ou "board game"
  // Pour simplifier on fait une seule requête multi-variantes.
  const valuesClause = [...variants].map((v) => `"${v}"`).join(" ");
  const sparql = `
    SELECT ?item ?itemLabel ?image ?publisherLabel WHERE {
      VALUES ?gtin { ${valuesClause} }
      ?item wdt:P3962 ?gtin.
      OPTIONAL { ?item wdt:P18 ?image. }
      OPTIONAL { ?item wdt:P123 ?publisher. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    }
    LIMIT 1
  `;
  try {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return null;
    const data = await res.json();
    const row = data.results?.bindings?.[0];
    if (!row) return null;
    const title = row.itemLabel?.value || "";
    if (!title) return null;
    // Wikidata renvoie une URL Commons "Special:FilePath" — utilisable directement
    let cover = row.image?.value || "";
    // On force https et on demande une miniature de taille raisonnable via les
    // services Commons (le path Special:FilePath sait déjà servir un thumb si on
    // ajoute ?width=, sinon on récupère la taille d'origine).
    if (cover && !cover.includes("?")) cover += "?width=600";
    return {
      title,
      author: "",
      cover,
      publisher: row.publisherLabel?.value || "",
      year: "",
      description: "",
      source: "Wikidata",
    };
  } catch (e) {
    return null;
  }
}

// Recherche unifiée selon le type d'objet détecté.
// - livre / inconnu  → Google Books + Open Library + BnF (cascade existante)
// - revue            → reconnaissance par préfixe (déjà fait côté UI) + Open Food Facts en complément
// - jeu-switch       → KNOWN_GAMES → Open Food Facts → UPCitemdb → Wikidata (UPC normalisé)
// - jeu-societe      → KNOWN_GAMES → Open Food Facts → UPCitemdb → Wikidata
// Renvoie { title, author, cover, publisher, year, description, source, debug, _type? }
export async function lookupAnyBarcode(code, type) {
  // ⚠️ On retire d'abord un éventuel suffixe `#N` (utilisé pour distinguer
  // plusieurs numéros de revues partageant le même code-barres EAN) AVANT
  // de nettoyer les non-chiffres. Sinon `replace(/\D/g, "")` transformerait
  // `3780263006908#2` en `37802630069082`, ce qui corromprait la lookup.
  const baseCode = String(code || "").split("#")[0];
  const clean = baseCode.replace(/\D/g, "");
  if (!clean) return null;

  // Pour les livres on garde la cascade riche existante
  if (type === "livre") {
    return lookupISBN(clean);
  }

  // === RECONNAISSANCE INTERNE (instantanée, sans réseau) ===
  // 1) Jeu connu dans KNOWN_GAMES ?
  const knownGame = recognizeGame(clean);
  // 2) Revue connue ?
  const knownMag = recognizeMagazine(clean);
  // 3) Préfixe éditeur de presse identifié ? (Bayard, Milan, Fleurus…)
  const pressPub = recognizePressPublisher(clean);

  // === LOOKUP RÉSEAU EN PARALLÈLE ===
  const eanForOFF = upcToEan(clean);
  const [off, google, wikidata, upc] = await Promise.all([
    lookupOpenFoodFacts(eanForOFF).catch(() => null),
    // Google Books peut parfois remonter une fiche pour un produit non-livre
    // (rare mais utile en secours pour le titre). On le met en parallèle.
    lookupGoogleBooks(clean).catch(() => null),
    // Wikidata couvre bien les jeux Switch et certains jeux de société
    lookupWikidata(clean).catch(() => null),
    // UPCitemdb : forte couverture des boîtes de jeux + visuels marchands.
    // On lui passe le code brut ; l'API accepte aussi bien l'UPC-A que l'EAN-13.
    lookupUPCitemdb(clean).catch(() => null),
  ]);

  const debug = {
    knownGame: knownGame ? `OK (${knownGame.title})` : "rien",
    knownMag: knownMag ? `OK (${knownMag.title})` : "rien",
    pressPub: pressPub ? `OK (${pressPub.publisher})` : "rien",
    openFoodFacts: off ? `OK (${off.title?.slice(0, 40)})` : "rien",
    upcitemdb: upc ? `OK (${upc.title?.slice(0, 40)})` : "rien",
    google: google ? `OK (${google.title?.slice(0, 40)})` : "rien",
    wikidata: wikidata ? `OK (${wikidata.title?.slice(0, 40)})` : "rien",
  };

  // === FUSION SOURCES ===
  // Priorité titre :
  //   1. KNOWN_GAMES / KNOWN_MAGAZINES — déterministe et fiable
  //   2. Open Food Facts — bon pour produits indexés
  //   3. UPCitemdb — forte couverture des boîtes de jeux
  //   4. Wikidata — bon pour jeux/œuvres notables
  //   5. Google Books — secours
  //   6. À défaut : "Revue Bayard…" si on a reconnu l'éditeur de presse
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

  const title =
    knownGame?.title ||
    knownMag?.title ||
    pick(off?.title, upc?.title, wikidata?.title, google?.title) ||
    (pressPub ? `Revue ${pressPub.publisher}` : "");

  const publisher =
    knownGame?.publisher ||
    knownMag?.publisher ||
    pressPub?.publisher ||
    pick(off?.publisher, upc?.publisher, wikidata?.publisher, google?.publisher);

  // Couverture : OFF > UPCitemdb > Wikidata > Google
  let cover = pick(off?.cover, upc?.cover, wikidata?.cover, google?.cover);

  // Source affichée
  let source = null;
  if (knownGame) source = "Base interne (jeux)";
  else if (knownMag) source = "Base interne (revues)";
  else if (off) source = "Open Food Facts";
  else if (upc) source = "UPCitemdb";
  else if (wikidata) source = "Wikidata";
  else if (google) source = "Google Books";
  else if (pressPub) source = "Préfixe éditeur";

  // Dernier recours JAQUETTE pour les jeux : si aucune source n'a fourni de
  // visuel mais qu'on a un titre, on tente l'art de boîte (paysage) de BGG.
  if (!cover && title && (type === "jeu-societe" || type === "jeu-switch")) {
    const bggCover = await lookupBGGCover(title, type).catch(() => "");
    if (bggCover) {
      cover = bggCover;
      debug.bgg = "OK (art de boîte)";
      if (!source || source === "Préfixe éditeur") source = "BoardGameGeek";
    } else {
      debug.bgg = "rien";
    }
  }

  if (!title && !cover) {
    return { title: "", author: "", cover: "", source: null, debug };
  }

  return {
    title,
    author: pick(google?.author, ""),
    cover,
    subtitle: "",
    publisher,
    year: pick(google?.year, wikidata?.year, ""),
    description: pick(off?.description, upc?.description, google?.description, ""),
    categories: "",
    pages: 0,
    language: "",
    rating: 0,
    ratingsCount: 0,
    infoLink: "",
    format: "",
    dimensions: "",
    weight: "",
    source,
    debug,
  };
}

// Cascade : essaye chaque source en parallèle, retourne le meilleur résultat
export async function lookupISBN(isbn) {
  // Retire un éventuel suffixe `#N` (utilisé pour les numéros de revues qui
  // partagent un code-barres) avant tout appel réseau. Les bases en ligne ne
  // connaissent évidemment que le code EAN brut.
  const clean = String(isbn || "").split("#")[0];
  const [google, openLib, bnf, fallbackCover] = await Promise.all([
    lookupGoogleBooks(clean),
    lookupOpenLibrary(clean),
    lookupBNF(clean),
    findCoverFor(clean),
  ]);

  const debug = {
    google: google ? `OK (${google.title?.slice(0, 40)})` : "rien",
    openLibrary: openLib ? `OK (${openLib.title?.slice(0, 40)})` : "rien",
    bnf: bnf ? `OK (${bnf.title?.slice(0, 40)})` : "rien",
    coverFallback: fallbackCover ? `image trouvée (${fallbackCover.includes("amazon") ? "Amazon" : "Open Library"})` : "aucune",
  };

  // Choix du titre/auteur : Google > Open Library > BnF
  let chosen = google || openLib || bnf;

  // CHOIX DE LA COUVERTURE — stratégie révisée :
  // Les couvertures Google Books sont souvent incohérentes (image d'une autre
  // édition, ou placeholder gris). On privilégie donc les sources qui lient
  // strictement l'image à l'ISBN demandé (Open Library, Amazon).
  // Google Books n'est utilisé qu'en dernier recours.
  const reliableCover = fallbackCover; // Open Library ou Amazon, vérifié par probeImageUrl
  const googleCover = google?.cover || ""; // Google Books JSON (peut être incohérent)

  let bestCover = reliableCover || googleCover || openLib?.cover || "";

  if (!chosen) {
    // Aucune métadonnée mais peut-être une couverture
    if (bestCover) {
      return {
        title: "", author: "", cover: bestCover, publisher: "", year: "",
        source: reliableCover ? "Couverture seule" : "Couverture Google (à vérifier)",
        debug,
      };
    }
    return { title: "", author: "", cover: "", source: null, debug };
  }

  // FUSION DES CHAMPS ENRICHIS : prend la première valeur non vide entre Google et Open Library.
  // Google a souvent description et rating ; Open Library a souvent pages, format, dimensions.
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "" && v !== 0) ?? "";

  chosen.cover = bestCover;
  chosen.subtitle = pick(google?.subtitle, openLib?.subtitle, "");
  chosen.pages = pick(openLib?.pages, google?.pages, 0) || 0;
  chosen.language = pick(google?.language, openLib?.language, "");
  chosen.description = pick(google?.description, openLib?.description, "");
  chosen.categories = pick(google?.categories, openLib?.categories, "");
  chosen.rating = pick(google?.rating, 0) || 0;
  chosen.ratingsCount = pick(google?.ratingsCount, 0) || 0;
  chosen.infoLink = pick(google?.infoLink, openLib?.infoLink, "");
  chosen.format = pick(openLib?.format, google?.format, "");
  chosen.dimensions = pick(openLib?.dimensions, "");
  chosen.weight = pick(openLib?.weight, "");
  chosen.debug = debug;
  return chosen;
}

