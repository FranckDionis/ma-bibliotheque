import { supabase } from "./supabase";

// ============================================================
// Couche d'accès aux données Supabase
// ============================================================
// Toutes les fonctions de lecture/écriture vers la base partagée passent ici.
// Cela permet de garder App.jsx propre et de pouvoir basculer entre mode
// local et mode cloud en changeant uniquement l'appelant.

// === BOOKS ===

// Nom du bucket de stockage des couvertures (voir le schéma SQL).
const BUCKET_COUVERTURES = "couvertures";

// Toutes les colonnes, couverture comprise.
//
// Historiquement, `cover` contenait l'image entière encodée en base64 —
// jusqu'à plusieurs centaines de Ko par livre. La charger pour 3 000
// fiches représentait des centaines de Mo, d'où un chargement séparé par
// lots, un cache IndexedDB et une machinerie de synchronisation.
//
// Depuis la migration vers le Storage, `cover` ne contient plus qu'une
// URL d'une centaine d'octets. Tout tient donc dans la requête normale :
// plus de second aller-retour, plus de cache à tenir à jour, et les
// couvertures s'affichent dès le premier rendu.
const LIGHT_COLUMNS = [
  "id", "type", "isbn", "title", "subtitle", "author",
  "cover", "cover_path",
  "bibliotheque", "etagere", "position",
  "notes", "pages", "language", "description", "categories",
  "rating", "ratings_count", "info_link",
  "format", "dimensions", "weight", "publisher", "year",
  "issue_number", "issue_date",
  "players_min", "players_max", "duration_min", "age_min", "platform",
  "genre",
  "created_at", "updated_at",
].join(",");

// Lit tous les livres de la base, couvertures comprises — ce ne sont
// plus que des URL.
//
// IMPORTANT : Supabase plafonne par défaut chaque requête à 1000 lignes.
// On boucle donc avec .range(from, to) pour récupérer toute la table,
// même au-delà de 1000 livres.
export async function fetchBooks() {
  if (!supabase) return [];
  const PAGE_SIZE = 1000;
  let allRows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("books")
      .select(LIGHT_COLUMNS)
      .order("created_at", { ascending: false })
      // Second critère INDISPENSABLE : `created_at` seul ne suffit pas à
      // départager les livres insérés dans la même transaction (import en
      // masse, migration), qui partagent la même valeur à la microseconde.
      // Postgres est alors libre de renvoyer les ex æquo dans un ordre
      // différent d'une requête à l'autre — donc d'une PAGE à l'autre : un
      // même livre peut apparaître deux fois, et un autre être sauté sans
      // aucune erreur. Trier aussi sur l'id (unique) fige l'ordre.
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break; // dernière page
    from += PAGE_SIZE;
  }
  // Convertit les colonnes snake_case en camelCase pour rester cohérent avec le reste de l'app
  return allRows.map(dbToBook);
}

// ============================================================
// COUVERTURES : ENVOI VERS LE STORAGE
// ============================================================
// La base ne doit plus JAMAIS recevoir d'image encodée en base64 : c'est
// ce qui l'avait amenée à 84 % de la limite du plan gratuit, et à un
// premier projet mis en défaut pour dépassement de quota.
//
// Ce garde-fou est volontairement placé ici, dans la couche d'accès aux
// données, et non dans les composants : tout enregistrement de livre
// passe par insertBook, updateBook ou insertBooksBulk. Une image
// arrivant par un chemin nouveau — scan, recadrage, photo de secours,
// enrichissement — sera donc déposée dans le Storage sans que le code
// appelant ait à s'en préoccuper, ni à y penser.

// Convertit une data URL en Blob, sans passer par fetch() : plus direct
// et surtout synchrone.
function dataUrlToBlob(dataUrl) {
  const virgule = dataUrl.indexOf(",");
  const entete = dataUrl.slice(0, virgule);
  const type = entete.match(/data:([^;]+)/)?.[1] || "image/jpeg";
  const binaire = atob(dataUrl.slice(virgule + 1));
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets], { type });
}

// Dépose l'image dans le Storage et renvoie son URL publique.
// Laisse passer sans rien faire ce qui est déjà une URL, ou vide.
async function materialiserCover(bookId, cover) {
  if (!cover || typeof cover !== "string") return cover;
  if (!cover.startsWith("data:")) return cover; // déjà une URL
  if (!bookId) return cover;                     // sans id, pas de chemin stable

  const chemin = `${bookId}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET_COUVERTURES)
    .upload(chemin, dataUrlToBlob(cover), {
      contentType: "image/jpeg",
      cacheControl: "31536000", // un an : une couverture ne change quasiment jamais
      upsert: true,             // un recadrage remplace l'image en place
    });
  if (error) throw new Error(`Envoi de la couverture : ${error.message}`);

  const { data } = supabase.storage.from(BUCKET_COUVERTURES).getPublicUrl(chemin);
  // Le suffixe ?v= est INDISPENSABLE : le chemin ne changeant pas d'une
  // version à l'autre, et le CDN gardant l'image un an, un recadrage
  // resterait invisible sans lui — l'ancienne image serait resservie.
  return `${data.publicUrl}?v=${Date.now()}`;
}

// Supprime l'image d'un livre. Sans erreur si elle n'existe pas.
async function supprimerCover(bookId) {
  if (!supabase || !bookId) return;
  await supabase.storage.from(BUCKET_COUVERTURES).remove([`${bookId}.jpg`]);
}

// Insère un nouveau livre
export async function insertBook(book) {
  if (!supabase) throw new Error("Supabase non configuré");
  // L'id est engendré ici plutôt que par la base : le nom du fichier de
  // couverture en dépend, et il faut donc le connaître AVANT l'insertion
  // pour tout écrire en une seule requête.
  const id = crypto.randomUUID();
  const cover = await materialiserCover(id, book.cover);

  const dbRow = bookToDb({ ...book, cover });
  dbRow.id = id;
  if (cover && cover.includes(`/${id}.jpg`)) dbRow.cover_path = `${id}.jpg`;

  const { data, error } = await supabase
    .from("books")
    .insert(dbRow)
    .select()
    .single();
  if (error) {
    // L'image a peut-être déjà été déposée : ne pas laisser d'orphelin.
    await supprimerCover(id).catch(() => {});
    throw error;
  }
  return dbToBook(data);
}

// Met à jour un livre existant
export async function updateBook(id, updates) {
  if (!supabase) throw new Error("Supabase non configuré");

  const majuscules = { ...updates };
  if ("cover" in majuscules) {
    majuscules.cover = await materialiserCover(id, majuscules.cover);
    majuscules.coverPath = majuscules.cover ? `${id}.jpg` : null;
    // Couverture retirée : on libère aussi le fichier.
    if (!majuscules.cover) await supprimerCover(id).catch(() => {});
  }

  const dbUpdates = bookToDb(majuscules);
  delete dbUpdates.id;
  delete dbUpdates.created_at;
  delete dbUpdates.created_by;
  // updated_at est désormais posé par un déclencheur de la base, dont
  // l'horloge fait autorité — celle d'un téléphone peut dériver.
  const { data, error } = await supabase
    .from("books")
    .update(dbUpdates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return dbToBook(data);
}

// Supprime un livre, et sa couverture avec lui
export async function deleteBook(id) {
  if (!supabase) throw new Error("Supabase non configuré");
  const { error } = await supabase.from("books").delete().eq("id", id);
  if (error) throw error;
  // Après la suppression de la fiche : une image orpheline occuperait le
  // quota pour rien, mais son échec ne doit pas faire échouer l'opération.
  await supprimerCover(id).catch(() => {});
}

// Insertion en masse (migration depuis le mode local, restauration)
export async function insertBooksBulk(books, onProgress) {
  if (!supabase) throw new Error("Supabase non configuré");
  const BATCH_SIZE = 50;
  let inserted = 0;
  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const tranche = books.slice(i, i + BATCH_SIZE);

    // Les couvertures partent d'abord vers le Storage : une insertion en
    // masse d'images base64 remplirait la base aussi sûrement qu'avant.
    const batch = [];
    for (const b of tranche) {
      const id = crypto.randomUUID();
      let cover = b.cover;
      try {
        cover = await materialiserCover(id, b.cover);
      } catch (e) {
        // Une image qui échoue ne doit pas faire perdre la fiche.
        console.warn(`Couverture non transférée (${b.title || "sans titre"}) : ${e.message}`);
        cover = null;
      }
      const row = bookToDb({ ...b, cover });
      row.id = id;
      if (cover && cover.includes(`/${id}.jpg`)) row.cover_path = `${id}.jpg`;
      batch.push(row);
    }

    const { error } = await supabase.from("books").insert(batch);
    if (error) throw error;
    inserted += batch.length;
    if (typeof onProgress === "function") onProgress(inserted, books.length);
  }
  return inserted;
}

// === STRUCTURE (pièces, bibliothèques, étagères) ===

export async function fetchStructure() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("structure")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    pieces: data.pieces || [],
    bibliotheques: data.bibliotheques || [],
    etageres: data.etageres || [],
  };
}

export async function saveStructureRemote(structure) {
  if (!supabase) throw new Error("Supabase non configuré");
  const { error } = await supabase
    .from("structure")
    .upsert({
      id: 1,
      pieces: structure.pieces,
      bibliotheques: structure.bibliotheques,
      etageres: structure.etageres,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

// === LAYOUT (positions visuelles) ===

export async function fetchLayout() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("layout")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    pieces: data.pieces || {},
    bibliotheques: data.bibliotheques || {},
  };
}

export async function saveLayoutRemote(layout) {
  if (!supabase) throw new Error("Supabase non configuré");
  const { error } = await supabase
    .from("layout")
    .upsert({
      id: 1,
      pieces: layout.pieces,
      bibliotheques: layout.bibliotheques,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

// === ABONNEMENTS TEMPS RÉEL ===
// Renvoie un objet avec une méthode unsubscribe()

export function subscribeToBooks(onChange) {
  if (!supabase) return { unsubscribe: () => {} };
  const channel = supabase
    .channel("books-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "books" }, (payload) => {
      onChange(payload);
    })
    .subscribe();
  return { unsubscribe: () => supabase.removeChannel(channel) };
}

export function subscribeToStructure(onChange) {
  if (!supabase) return { unsubscribe: () => {} };
  const channel = supabase
    .channel("structure-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "structure" }, (payload) => {
      onChange(payload);
    })
    .subscribe();
  return { unsubscribe: () => supabase.removeChannel(channel) };
}

export function subscribeToLayout(onChange) {
  if (!supabase) return { unsubscribe: () => {} };
  const channel = supabase
    .channel("layout-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "layout" }, (payload) => {
      onChange(payload);
    })
    .subscribe();
  return { unsubscribe: () => supabase.removeChannel(channel) };
}

// ============================================================
// Conversion entre format DB (snake_case) et format app (camelCase)
// ============================================================

function dbToBook(row) {
  return {
    id: row.id,
    type: row.type || "livre",
    isbn: row.isbn || "",
    title: row.title || "",
    subtitle: row.subtitle || "",
    author: row.author || "",
    cover: row.cover || "",
    coverPath: row.cover_path || "",
    bibliotheque: row.bibliotheque || "",
    etagere: row.etagere || 1,
    position: row.position || 1,
    notes: row.notes || "",
    pages: row.pages || 0,
    language: row.language || "",
    description: row.description || "",
    categories: row.categories || "",
    rating: row.rating || 0,
    ratingsCount: row.ratings_count || 0,
    infoLink: row.info_link || "",
    format: row.format || "",
    dimensions: row.dimensions || "",
    weight: row.weight || "",
    publisher: row.publisher || "",
    year: row.year || "",
    addedAt: row.created_at,
    // Date de dernière modification (sert à invalider le cache local de
    // couvertures : si un livre a été modifié plus récemment que la dernière
    // synchro, on retélécharge sa couverture même si elle est déjà en cache).
    updatedAt: row.updated_at || null,
    // Champs spécifiques aux nouveaux types
    issueNumber: row.issue_number || "",     // n° de revue
    issueDate: row.issue_date || "",          // date de parution revue
    playersMin: row.players_min || 0,         // nb joueurs min (jeux)
    playersMax: row.players_max || 0,         // nb joueurs max (jeux)
    durationMin: row.duration_min || 0,       // durée en minutes (jeux)
    ageMin: row.age_min || 0,                 // âge minimum (jeux)
    platform: row.platform || "",             // ex: "Nintendo Switch" pour les jeux
    genre: row.genre || [],                   // catégories bibliothèque virtuelle (text[])
  };
}

// Export public pour permettre à App.jsx d'appliquer les payloads realtime
// (INSERT/UPDATE/DELETE) localement sans re-fetcher toute la liste.
export { dbToBook };

// Exportée pour être testable : c'est la fonction la plus piégeuse du
// fichier (voir le commentaire ci-dessous sur les mises à jour partielles).
export function bookToDb(book) {
  // IMPORTANT : on ne mappe QUE les champs présents dans l'objet d'entrée.
  // Si on faisait `isbn: book.isbn || null` pour un patch comme {cover: "..."},
  // tous les autres champs seraient mis à NULL et écraseraient la base.
  const out = {};
  // Mapping camelCase → snake_case + écriture seulement si la clé existe dans l'objet
  if ("isbn" in book) out.isbn = book.isbn || null;
  if ("title" in book) out.title = book.title || null;
  if ("subtitle" in book) out.subtitle = book.subtitle || null;
  if ("author" in book) out.author = book.author || null;
  if ("cover" in book) out.cover = book.cover || null;
  if ("coverPath" in book) out.cover_path = book.coverPath || null;
  if ("bibliotheque" in book) out.bibliotheque = book.bibliotheque || null;
  if ("etagere" in book) out.etagere = typeof book.etagere === "number" ? book.etagere : parseInt(book.etagere) || 1;
  if ("position" in book) out.position = typeof book.position === "number" ? book.position : parseInt(book.position) || 1;
  if ("notes" in book) out.notes = book.notes || null;
  if ("pages" in book) out.pages = book.pages ? parseInt(book.pages) : null;
  if ("language" in book) out.language = book.language || null;
  if ("description" in book) out.description = book.description || null;
  if ("categories" in book) out.categories = book.categories || null;
  if ("rating" in book) out.rating = book.rating ? parseFloat(book.rating) : null;
  if ("ratingsCount" in book) out.ratings_count = book.ratingsCount ? parseInt(book.ratingsCount) : null;
  if ("infoLink" in book) out.info_link = book.infoLink || null;
  if ("format" in book) out.format = book.format || null;
  if ("dimensions" in book) out.dimensions = book.dimensions || null;
  if ("weight" in book) out.weight = book.weight || null;
  if ("publisher" in book) out.publisher = book.publisher || null;
  if ("year" in book) out.year = book.year || null;
  // Champs spécifiques aux nouveaux types
  if ("type" in book) out.type = book.type || "livre";
  if ("issueNumber" in book) out.issue_number = book.issueNumber || null;
  if ("issueDate" in book) out.issue_date = book.issueDate || null;
  if ("playersMin" in book) out.players_min = book.playersMin ? parseInt(book.playersMin) : null;
  if ("playersMax" in book) out.players_max = book.playersMax ? parseInt(book.playersMax) : null;
  if ("durationMin" in book) out.duration_min = book.durationMin ? parseInt(book.durationMin) : null;
  if ("ageMin" in book) out.age_min = book.ageMin ? parseInt(book.ageMin) : null;
  if ("platform" in book) out.platform = book.platform || null;
  if ("genre" in book) out.genre = Array.isArray(book.genre) ? book.genre : [];
  // Si c'est une mise à jour partielle, on conserve l'id
  if (book.id && typeof book.id === "string" && book.id.includes("-")) {
    // UUID Supabase
    out.id = book.id;
  }
  return out;
}
