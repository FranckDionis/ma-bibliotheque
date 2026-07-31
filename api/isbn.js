// Fonction serverless Vercel qui interroge plusieurs sources
// (livres + produits via Open Food Facts) et contourne les soucis CORS.
//
// Endpoint : /api/isbn?code=9782092784792
// Optionnel : /api/isbn?code=045496904099&type=jeu-switch
//
// Renvoie : { title, author, cover, publisher, year, source } ou { error: "not-found" }

// ============================================================
// GARDE-FOUS
// ============================================================
// Cet endpoint est public et interroge quatre services tiers à chaque
// appel. Sans limite, n'importe qui peut s'en servir comme passerelle
// gratuite, aux frais du quota Vercel du propriétaire.
//
// Ce qu'on peut faire, et ce qu'on ne peut pas :
//   - restreindre les origines coupe l'usage depuis un autre site web,
//     le navigateur refusant alors de livrer la réponse ;
//   - une limite par IP, gardée en mémoire, bride un script un peu
//     insistant.
// Une limite RÉELLE demanderait un compteur partagé (Vercel KV, Redis) :
// une fonction serverless est sans mémoire commune, et chaque instance
// froide repart de zéro. Pour une bibliothèque familiale, la dépense ne
// se justifie pas — mais il ne faut pas croire la protection étanche.

export const ORIGINES_AUTORISEES = [
  "https://ma-bibliotheque-dionis.vercel.app",
  "https://ma-bibliotheque-psi.vercel.app",
  "http://localhost:5173",
  "http://localhost:5180",
];

const FENETRE_MS = 60 * 1000;
const MAX_PAR_FENETRE = 30; // large : un scan en série enchaîne les appels

// Compteur par IP, valable pour la durée de vie de l'instance.
const compteurs = new Map();

export function tropDAppels(ip) {
  const maintenant = Date.now();
  const entree = compteurs.get(ip);
  if (!entree || maintenant > entree.finFenetre) {
    compteurs.set(ip, { nb: 1, finFenetre: maintenant + FENETRE_MS });
    // Purge opportuniste : sans elle, la Map grossirait indéfiniment sur
    // une instance qui reste chaude longtemps.
    if (compteurs.size > 500) {
      for (const [cle, val] of compteurs) {
        if (maintenant > val.finFenetre) compteurs.delete(cle);
      }
    }
    return false;
  }
  entree.nb += 1;
  return entree.nb > MAX_PAR_FENETRE;
}

export default async function handler(req, res) {
  const origine = req.headers.origin;

  // Une requête de même origine — le cas normal depuis l'application —
  // n'envoie pas d'en-tête Origin. On ne peut donc pas exiger sa présence
  // sans casser l'usage légitime ; on n'en refuse que les valeurs connues
  // comme étrangères.
  if (origine && !ORIGINES_AUTORISEES.includes(origine)) {
    return res.status(403).json({ error: "origin-not-allowed" });
  }
  if (origine) {
    res.setHeader("Access-Control-Allow-Origin", origine);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Requête de pré-vol : on répond sans rien interroger.
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "inconnu";
  if (tropDAppels(ip)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "too-many-requests" });
  }

  const code = (req.query.code || "").replace(/[^0-9X]/gi, "");
  const type = (req.query.type || "").toLowerCase();
  if (!code || code.length < 10) {
    return res.status(400).json({ error: "code-invalid" });
  }

  // Cache 30 jours — uniquement sur les réponses utiles, pas sur les erreurs.
  res.setHeader("Cache-Control", "public, max-age=2592000, s-maxage=2592000");

  // On lance toutes les sources en parallèle. Coût quasi nul, et la fusion
  // saura choisir la bonne réponse selon le type.
  const promises = [
    fetchGoogleBooks(code),
    fetchOpenLibrary(code),
    fetchBNF(code),
    fetchOpenFoodFacts(eanFromUpc(code)),
  ];

  const sources = await Promise.allSettled(promises);

  const results = sources
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean);

  if (results.length === 0) {
    return res.status(200).json({
      error: "not-found",
      isbn: code,
      coverFallback: `https://covers.openlibrary.org/b/isbn/${code}-L.jpg?default=false`,
    });
  }

  const merged = mergeResults(results, type);
  merged.isbn = code;
  return res.status(200).json(merged);
}

// === Sources livres ===

async function fetchGoogleBooks(isbn) {
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  if (!r.ok) throw new Error("google-http");
  const data = await r.json();
  const item = data.items?.[0]?.volumeInfo;
  if (!item) throw new Error("google-empty");
  const cover =
    item.imageLinks?.extraLarge ||
    item.imageLinks?.large ||
    item.imageLinks?.medium ||
    item.imageLinks?.thumbnail ||
    item.imageLinks?.smallThumbnail ||
    "";
  return {
    title: item.title || "",
    author: (item.authors || []).join(", "),
    cover: cover.replace(/^http:/, "https:"),
    publisher: item.publisher || "",
    year: item.publishedDate || "",
    source: "Google Books",
    _kind: "book",
  };
}

async function fetchOpenLibrary(isbn) {
  const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!r.ok) throw new Error("ol-http");
  const data = await r.json();
  const book = data[`ISBN:${isbn}`];
  if (!book) throw new Error("ol-empty");
  return {
    title: book.title || "",
    author: (book.authors || []).map((a) => a.name).join(", "),
    cover: book.cover?.large || book.cover?.medium || book.cover?.small || "",
    publisher: book.publishers?.[0]?.name || "",
    year: book.publish_date || "",
    source: "Open Library",
    _kind: "book",
  };
}

async function fetchBNF(isbn) {
  const url = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=bib.isbn%20adj%20%22${isbn}%22&recordSchema=unimarcxchange&maximumRecords=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("bnf-http");
  const xml = await r.text();
  const get = (tag, code) => {
    const re = new RegExp(
      `<datafield[^>]*tag="${tag}"[^>]*>[\\s\\S]*?<subfield[^>]*code="${code}"[^>]*>([^<]*)</subfield>`,
      "i"
    );
    const m = xml.match(re);
    return m ? m[1].trim() : "";
  };
  const title = get("200", "a");
  if (!title) throw new Error("bnf-empty");
  let author = "";
  const m700 = xml.match(/<datafield[^>]*tag="700"[^>]*>([\s\S]*?)<\/datafield>/i);
  if (m700) {
    const a = m700[1].match(/<subfield[^>]*code="a"[^>]*>([^<]*)</i)?.[1] || "";
    const b = m700[1].match(/<subfield[^>]*code="b"[^>]*>([^<]*)</i)?.[1] || "";
    author = `${b} ${a}`.trim();
  }
  if (!author) author = get("200", "f");
  return {
    title: title.replace(/\s*:\s*$/, ""),
    author,
    cover: "",
    publisher: get("210", "c"),
    year: get("210", "d"),
    source: "BnF",
    _kind: "book",
  };
}

// === Source produits (jeux Switch, jeux de société, etc.) ===

// UPC-A (12 chiffres) → EAN-13 (préfixé d'un 0) pour maximiser le match OFF
export function eanFromUpc(code) {
  const clean = (code || "").replace(/\D/g, "");
  if (clean.length === 12) return "0" + clean;
  return clean;
}

// Open Food Facts couvre énormément de produits non alimentaires
// (jeux, jouets, cosmétiques…). Sans clé d'API et CORS friendly.
async function fetchOpenFoodFacts(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
  if (!r.ok) throw new Error("off-http");
  const data = await r.json();
  if (data.status !== 1 || !data.product) throw new Error("off-empty");
  const p = data.product;
  const title = p.product_name_fr || p.product_name || p.generic_name || "";
  if (!title) throw new Error("off-no-title");
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
    source: "Open Food Facts",
    _kind: "product",
  };
}

export function mergeResults(results, type) {
  const wantsProduct = type && type !== "livre";

  // Tri principal : la bonne famille en tête, puis titre le plus long
  results.sort((a, b) => {
    const aProd = a._kind === "product" ? 1 : 0;
    const bProd = b._kind === "product" ? 1 : 0;
    if (wantsProduct && aProd !== bProd) return bProd - aProd;
    if (!wantsProduct && aProd !== bProd) return aProd - bProd;
    return (b.title?.length || 0) - (a.title?.length || 0);
  });

  const best = results[0];
  if (!best.cover) {
    const withCover = results.find((r) => r.cover);
    if (withCover) best.cover = withCover.cover;
  }
  if (!best.author) {
    const withAuthor = results.find((r) => r.author);
    if (withAuthor) best.author = withAuthor.author;
  }
  best.allSources = results.map((r) => r.source).join(", ");
  return best;
}
