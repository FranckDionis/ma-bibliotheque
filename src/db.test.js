import { describe, it, expect } from "vitest";
import { bookToDb, dbToBook } from "./db";

// ============================================================
// bookToDb est la fonction la plus piégeuse du projet.
// ============================================================
// Elle sert AUSSI BIEN aux insertions complètes qu'aux mises à jour
// partielles. Si elle écrivait `isbn: book.isbn || null` sans vérifier
// la présence de la clé, alors enregistrer une simple couverture
// (`{cover: "..."}`) mettrait à NULL le titre, l'auteur, l'emplacement et
// tout le reste de la fiche en base. Ces tests verrouillent ce contrat.

describe("bookToDb — mises à jour partielles", () => {
  it("ne mappe que les clés réellement présentes", () => {
    const sortie = bookToDb({ cover: "https://exemple/couv.jpg" });
    expect(Object.keys(sortie)).toEqual(["cover"]);
    expect("title" in sortie).toBe(false);
    expect("isbn" in sortie).toBe(false);
    expect("bibliotheque" in sortie).toBe(false);
  });

  it("n'invente aucun champ sur un objet vide", () => {
    expect(bookToDb({})).toEqual({});
  });

  it("convertit une valeur vide en null, sans toucher aux absentes", () => {
    const sortie = bookToDb({ title: "", author: "Hugo" });
    expect(sortie.title).toBeNull();
    expect(sortie.author).toBe("Hugo");
    expect("notes" in sortie).toBe(false);
  });
});

describe("bookToDb — conversions", () => {
  it("passe le camelCase en snake_case", () => {
    const sortie = bookToDb({
      issueNumber: "42",
      playersMin: 2,
      ratingsCount: 17,
      infoLink: "https://exemple",
      coverPath: "abc.jpg",
    });
    expect(sortie.issue_number).toBe("42");
    expect(sortie.players_min).toBe(2);
    expect(sortie.ratings_count).toBe(17);
    expect(sortie.info_link).toBe("https://exemple");
    expect(sortie.cover_path).toBe("abc.jpg");
  });

  it("convertit les nombres transmis sous forme de texte", () => {
    const sortie = bookToDb({ pages: "320", etagere: "3", ageMin: "8" });
    expect(sortie.pages).toBe(320);
    expect(sortie.etagere).toBe(3);
    expect(sortie.age_min).toBe(8);
  });

  it("garantit un tableau pour genre, quoi qu'on lui donne", () => {
    expect(bookToDb({ genre: ["Roman", "Policier"] }).genre).toEqual(["Roman", "Policier"]);
    expect(bookToDb({ genre: null }).genre).toEqual([]);
    expect(bookToDb({ genre: "Roman" }).genre).toEqual([]);
  });

  it("ne conserve l'id que s'il ressemble à un UUID", () => {
    expect(bookToDb({ id: "550e8400-e29b-41d4-a716-446655440000" }).id)
      .toBe("550e8400-e29b-41d4-a716-446655440000");
    // Les ids du mode local sont un horodatage : ils ne doivent pas
    // partir en base, où l'id est un UUID.
    expect(bookToDb({ id: "1719830400000" }).id).toBeUndefined();
  });
});

describe("dbToBook", () => {
  it("applique les valeurs par défaut", () => {
    const livre = dbToBook({ id: "x" });
    expect(livre.type).toBe("livre");
    expect(livre.etagere).toBe(1);
    expect(livre.position).toBe(1);
    expect(livre.title).toBe("");
    expect(livre.genre).toEqual([]);
  });

  it("repasse le snake_case en camelCase", () => {
    const livre = dbToBook({
      id: "x",
      issue_number: "12",
      players_max: 6,
      ratings_count: 3,
      cover_path: "x.jpg",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-02-01T00:00:00Z",
    });
    expect(livre.issueNumber).toBe("12");
    expect(livre.playersMax).toBe(6);
    expect(livre.ratingsCount).toBe(3);
    expect(livre.coverPath).toBe("x.jpg");
    expect(livre.addedAt).toBe("2026-01-01T00:00:00Z");
    expect(livre.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("fait l'aller-retour sans perte sur les champs porteurs de sens", () => {
    const enBase = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Les Misérables",
      author: "Victor Hugo",
      isbn: "9782070409228",
      bibliotheque: "bib-1",
      etagere: 3,
      position: 7,
      genre: ["Roman"],
    };
    const retour = bookToDb(dbToBook(enBase));
    for (const champ of Object.keys(enBase)) {
      expect(retour[champ]).toEqual(enBase[champ]);
    }
  });
});
