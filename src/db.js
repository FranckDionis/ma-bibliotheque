import { supabase } from "./supabase";

// ============================================================
// Couche d'accès aux données Supabase
// ============================================================
// Toutes les fonctions de lecture/écriture vers la base partagée passent ici.
// Cela permet de garder App.jsx propre et de pouvoir basculer entre mode
// local et mode cloud en changeant uniquement l'appelant.

// === BOOKS ===

// Lit tous les livres de la base
export async function fetchBooks() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  // Convertit les colonnes snake_case en camelCase pour rester cohérent avec le reste de l'app
  return (data || []).map(dbToBook);
}

// Insère un nouveau livre
export async function insertBook(book) {
  if (!supabase) throw new Error("Supabase non configuré");
  const dbRow = bookToDb(book);
  // L'id est auto-généré côté Supabase ; on le retire si présent
  delete dbRow.id;
  const { data, error } = await supabase
    .from("books")
    .insert(dbRow)
    .select()
    .single();
  if (error) throw error;
  return dbToBook(data);
}

// Met à jour un livre existant
export async function updateBook(id, updates) {
  if (!supabase) throw new Error("Supabase non configuré");
  const dbUpdates = bookToDb(updates);
  delete dbUpdates.id;
  delete dbUpdates.created_at;
  delete dbUpdates.created_by;
  dbUpdates.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("books")
    .update(dbUpdates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return dbToBook(data);
}

// Supprime un livre
export async function deleteBook(id) {
  if (!supabase) throw new Error("Supabase non configuré");
  const { error } = await supabase.from("books").delete().eq("id", id);
  if (error) throw error;
}

// Insertion en masse (utile pour la migration depuis le local)
// Insère par lots pour respecter les limites du serveur
export async function insertBooksBulk(books, onProgress) {
  if (!supabase) throw new Error("Supabase non configuré");
  const BATCH_SIZE = 50;
  let inserted = 0;
  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE).map((b) => {
      const row = bookToDb(b);
      delete row.id; // laisser Supabase générer un nouvel UUID
      return row;
    });
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
    isbn: row.isbn || "",
    title: row.title || "",
    subtitle: row.subtitle || "",
    author: row.author || "",
    cover: row.cover || "",
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
  };
}

function bookToDb(book) {
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
  // Si c'est une mise à jour partielle, on conserve l'id
  if (book.id && typeof book.id === "string" && book.id.includes("-")) {
    // UUID Supabase
    out.id = book.id;
  }
  return out;
}
