import { describe, it, expect } from "vitest";
import {
  normalizeForSearch,
  bookSearchText,
  termesDeRecherche,
  correspondAlaRecherche,
} from "./recherche";

const trouve = (livre, requete) =>
  correspondAlaRecherche(livre, termesDeRecherche(requete));

describe("normalizeForSearch", () => {
  it("retire les accents", () => {
    expect(normalizeForSearch("Misérables")).toBe("miserables");
    expect(normalizeForSearch("Éco")).toBe("eco");
    expect(normalizeForSearch("Où çà ?")).toBe("ou ca ?");
  });

  it("passe en minuscules", () => {
    expect(normalizeForSearch("HUGO")).toBe("hugo");
  });

  it("tolère null, undefined et les nombres", () => {
    expect(normalizeForSearch(null)).toBe("");
    expect(normalizeForSearch(undefined)).toBe("");
    expect(normalizeForSearch(42)).toBe("42");
  });
});

describe("termesDeRecherche", () => {
  it("découpe en mots", () => {
    expect(termesDeRecherche("hugo miserables")).toEqual(["hugo", "miserables"]);
  });

  it("ignore les espaces superflus", () => {
    expect(termesDeRecherche("  hugo   les  ")).toEqual(["hugo", "les"]);
  });

  it("renvoie une liste vide pour une requête vide", () => {
    expect(termesDeRecherche("")).toEqual([]);
    expect(termesDeRecherche("   ")).toEqual([]);
  });
});

describe("bookSearchText", () => {
  it("concatène tous les champs interrogeables", () => {
    const texte = bookSearchText({
      title: "Zelda",
      subtitle: "Breath of the Wild",
      author: "Nintendo",
      notes: "Étagère du haut",
      description: "Jeu d'aventure",
      isbn: "045496904099",
    });
    for (const attendu of ["zelda", "breath", "nintendo", "etagere", "aventure", "045496904099"]) {
      expect(texte).toContain(attendu);
    }
  });

  it("ne casse pas sur les champs absents", () => {
    expect(() => bookSearchText({ title: "Seul" })).not.toThrow();
    expect(bookSearchText({})).toBe("");
  });

  it("réutilise le cache pour un même objet", () => {
    const livre = { title: "Dune" };
    expect(bookSearchText(livre)).toBe(bookSearchText(livre));
  });

  // Le cache est indexé par l'objet : un livre modifié est un objet
  // recréé, donc son texte est recalculé. Ce test protège contre le
  // remplacement de la WeakMap par un cache indexé sur l'id, qui
  // renverrait l'ancien titre après une modification.
  it("recalcule pour un objet recréé", () => {
    const avant = { title: "Dune" };
    const apres = { ...avant, title: "Dune Messiah" };
    expect(bookSearchText(avant)).toContain("dune");
    expect(bookSearchText(apres)).toContain("messiah");
  });
});

describe("correspondAlaRecherche", () => {
  const miserables = { title: "Les Misérables", author: "Victor Hugo", isbn: "9782070409228" };
  const ecologie = { title: "Traité d'écologie", author: "Odum", notes: "Étagère du haut" };
  const rose = { title: "Le Nom de la Rose", author: "Umberto Eco", description: "Abbaye bénédictine" };

  it("trouve malgré les accents, dans les deux sens", () => {
    expect(trouve(miserables, "miserables")).toBe(true);
    expect(trouve(miserables, "misérables")).toBe(true);
    expect(trouve(ecologie, "ecologie")).toBe(true);
  });

  it("ignore la casse", () => {
    expect(trouve(miserables, "HUGO")).toBe(true);
  });

  it("exige tous les mots, dans n'importe quel ordre", () => {
    expect(trouve(miserables, "hugo miserables")).toBe(true);
    expect(trouve(miserables, "miserables hugo")).toBe(true);
    expect(trouve(miserables, "hugo dumas")).toBe(false);
  });

  it("cherche aussi dans les notes et la description", () => {
    expect(trouve(ecologie, "etagere haut")).toBe(true);
    expect(trouve(rose, "benedictine")).toBe(true);
  });

  it("cherche dans l'ISBN, même partiellement", () => {
    expect(trouve(miserables, "9782070409228")).toBe(true);
    expect(trouve(miserables, "978207")).toBe(true);
  });

  it("laisse tout passer quand la requête est vide", () => {
    expect(trouve(rose, "")).toBe(true);
    expect(correspondAlaRecherche(rose, [])).toBe(true);
    expect(correspondAlaRecherche(rose, null)).toBe(true);
  });

  it("ne confond pas deux livres proches", () => {
    expect(trouve(rose, "ecologie")).toBe(false);
  });
});
