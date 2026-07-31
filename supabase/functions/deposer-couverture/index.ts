// ============================================================
// deposer-couverture — fonction Edge Supabase
// ============================================================
// Télécharge une couverture hébergée chez un tiers et la dépose dans le
// bucket `couvertures`, puis renvoie son URL publique.
//
// POURQUOI CÔTÉ SERVEUR
//
// Le navigateur ne peut pas lire les octets d'une image servie par un
// autre domaine : c'est exactement ce que la politique d'origine
// interdit. L'application enregistrait donc l'URL distante telle quelle,
// et la fiche restait suspendue à un serveur sur lequel on n'a aucune
// prise. Ici, la restriction n'existe pas.
//
// APPEL
//   POST { bookId: "uuid", url: "https://…" }
//   → 200 { url: "https://…/couvertures/uuid.jpg?v=…", chemin, octets }
//   → 4xx { erreur: "…" }
//
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "couvertures";

// Taille maximale acceptée. Au-delà, ce n'est pas une couverture de
// livre — et on ne veut pas remplir le quota avec une image géante.
const TAILLE_MAX = 3 * 1024 * 1024;

// ------------------------------------------------------------
// Hôtes autorisés
// ------------------------------------------------------------
// SANS CETTE LISTE, la fonction serait un proxy ouvert : n'importe quel
// membre pourrait lui faire récupérer une adresse interne du réseau
// Supabase, ou s'en servir pour masquer l'origine de requêtes vers des
// tiers. On n'accepte donc que les sources de couvertures réellement
// utilisées par l'application.
const HOTES_AUTORISES = [
  "books.google.com",
  "books.googleusercontent.com",
  "covers.openlibrary.org",
  "images-na.ssl-images-amazon.com",
  "m.media-amazon.com",
  "images.amazon.com",
  "cf.geekdo-images.com",          // BoardGameGeek
  "images.igdb.com",
  "world.openfoodfacts.org",
  "images.openfoodfacts.org",
  "static.openfoodfacts.org",
  "catalogue.bnf.fr",
];

function hoteAutorise(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  return HOTES_AUTORISES.some(
    (h) => url.hostname === h || url.hostname.endsWith("." + h),
  );
}

const enTetes = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const repondre = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: enTetes });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: enTetes });
  }
  if (req.method !== "POST") {
    return repondre({ erreur: "methode-non-autorisee" }, 405);
  }

  const urlProjet = Deno.env.get("SUPABASE_URL")!;
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ----------------------------------------------------------
  // 1. Qui appelle ?
  // ----------------------------------------------------------
  // Le jeton du visiteur sert UNIQUEMENT à l'identifier. Toutes les
  // écritures se font ensuite avec la clé de service : sans quoi il
  // faudrait ouvrir le bucket en écriture plus largement.
  const autorisation = req.headers.get("Authorization") ?? "";
  if (!autorisation.startsWith("Bearer ")) {
    return repondre({ erreur: "authentification-requise" }, 401);
  }

  const admin = createClient(urlProjet, cleService, {
    auth: { persistSession: false },
  });

  const { data: auth, error: erreurAuth } = await admin.auth.getUser(
    autorisation.replace("Bearer ", ""),
  );
  if (erreurAuth || !auth?.user) {
    return repondre({ erreur: "jeton-invalide" }, 401);
  }

  // Être authentifié ne suffit pas : il faut être membre, comme partout
  // ailleurs dans cette application.
  const { data: membre } = await admin
    .from("membres")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!membre) {
    return repondre({ erreur: "acces-refuse" }, 403);
  }

  // ----------------------------------------------------------
  // 2. Ce qu'on nous demande
  // ----------------------------------------------------------
  let corps: { bookId?: string; url?: string };
  try {
    corps = await req.json();
  } catch {
    return repondre({ erreur: "corps-illisible" }, 400);
  }

  const bookId = (corps.bookId ?? "").trim();
  const source = (corps.url ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(bookId)) {
    return repondre({ erreur: "identifiant-invalide" }, 400);
  }

  let cible: URL;
  try {
    cible = new URL(source);
  } catch {
    return repondre({ erreur: "url-invalide" }, 400);
  }
  if (!hoteAutorise(cible)) {
    return repondre({ erreur: "hote-non-autorise", hote: cible.hostname }, 400);
  }

  // ----------------------------------------------------------
  // 3. Téléchargement
  // ----------------------------------------------------------
  let octets: Uint8Array;
  let typeMime = "image/jpeg";
  try {
    const reponse = await fetch(cible.toString(), {
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (!reponse.ok) {
      return repondre({ erreur: "telechargement-echoue", statut: reponse.status }, 502);
    }
    const type = reponse.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return repondre({ erreur: "pas-une-image", type }, 415);
    }
    typeMime = type.split(";")[0];

    const tampon = await reponse.arrayBuffer();
    if (tampon.byteLength === 0) {
      return repondre({ erreur: "image-vide" }, 502);
    }
    if (tampon.byteLength > TAILLE_MAX) {
      return repondre({ erreur: "image-trop-lourde", octets: tampon.byteLength }, 413);
    }
    octets = new Uint8Array(tampon);
  } catch (e) {
    return repondre({ erreur: "telechargement-impossible", detail: String(e) }, 502);
  }

  // ----------------------------------------------------------
  // 4. Dépôt
  // ----------------------------------------------------------
  // Le nom de fichier reprend l'identifiant du livre : une couverture
  // remplacée écrase la précédente, sans laisser d'orphelin.
  const chemin = `${bookId}.jpg`;
  const { error: erreurEnvoi } = await admin.storage
    .from(BUCKET)
    .upload(chemin, octets, {
      contentType: typeMime,
      cacheControl: "31536000",
      upsert: true,
    });
  if (erreurEnvoi) {
    return repondre({ erreur: "envoi-echoue", detail: erreurEnvoi.message }, 500);
  }

  const { data: publique } = admin.storage.from(BUCKET).getPublicUrl(chemin);

  // Le suffixe de version force le CDN et les navigateurs à reprendre
  // l'image : le chemin, lui, ne change jamais.
  return repondre({
    url: `${publique.publicUrl}?v=${Date.now()}`,
    chemin,
    octets: octets.byteLength,
  });
});
