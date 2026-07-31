import { describe, it, expect } from "vitest";
import { findFirstFreePosition } from "./placement";

// Cette fonction décide où atterrit chaque livre scanné. Une erreur ne
// produit aucun message : elle empile silencieusement deux ouvrages à la
// même position, et le rangement physique ne correspond plus à la fiche.

const livre = (bib, etagere, position) => ({ bibliotheque: bib, etagere, position });

describe("findFirstFreePosition", () => {
  it("renvoie 1 sur une étagère vide", () => {
    expect(findFirstFreePosition([], "bib-1", 1)).toBe(1);
  });

  it("renvoie la position suivante quand le début est occupé", () => {
    const books = [livre("bib-1", 1, 1), livre("bib-1", 1, 2)];
    expect(findFirstFreePosition(books, "bib-1", 1)).toBe(3);
  });

  it("comble un trou plutôt que d'aller à la fin", () => {
    // Un livre retiré laisse un vide : le suivant doit le reprendre,
    // sinon les positions dérivent indéfiniment.
    const books = [livre("bib-1", 1, 1), livre("bib-1", 1, 3)];
    expect(findFirstFreePosition(books, "bib-1", 1)).toBe(2);
  });

  it("ne compte que l'étagère demandée", () => {
    const books = [livre("bib-1", 1, 1), livre("bib-1", 2, 1), livre("bib-1", 2, 2)];
    expect(findFirstFreePosition(books, "bib-1", 2)).toBe(3);
  });

  it("ne compte que la bibliothèque demandée", () => {
    const books = [livre("bib-1", 1, 1), livre("bib-2", 1, 1)];
    expect(findFirstFreePosition(books, "bib-2", 1)).toBe(2);
  });

  it("compare les étagères sans se soucier du type", () => {
    // Les numéros arrivent tantôt en nombre, tantôt en texte selon qu'ils
    // viennent d'un formulaire ou de la base.
    const books = [livre("bib-1", "1", 1)];
    expect(findFirstFreePosition(books, "bib-1", 1)).toBe(2);
    expect(findFirstFreePosition([livre("bib-1", 1, 1)], "bib-1", "1")).toBe(2);
  });

  it("tient compte des positions réservées du lot en cours", () => {
    // Pendant un scan en série, les livres déjà scannés ne sont pas encore
    // dans `books` : sans cette réservation, ils se marcheraient dessus.
    expect(findFirstFreePosition([], "bib-1", 1, [1, 2])).toBe(3);
  });

  it("combine l'existant et les réservations", () => {
    const books = [livre("bib-1", 1, 1)];
    expect(findFirstFreePosition(books, "bib-1", 1, [2, 3])).toBe(4);
  });

  it("ignore les positions absurdes", () => {
    const books = [
      livre("bib-1", 1, 0),
      livre("bib-1", 1, -5),
      livre("bib-1", 1, null),
      livre("bib-1", 1, "abc"),
    ];
    expect(findFirstFreePosition(books, "bib-1", 1)).toBe(1);
  });

  it("tolère une liste absente", () => {
    expect(findFirstFreePosition(null, "bib-1", 1)).toBe(1);
    expect(findFirstFreePosition(undefined, "bib-1", 1)).toBe(1);
  });

  it("reste correct sur une étagère bien remplie", () => {
    const books = Array.from({ length: 40 }, (_, i) => livre("bib-1", 1, i + 1));
    expect(findFirstFreePosition(books, "bib-1", 1)).toBe(41);
  });
});
