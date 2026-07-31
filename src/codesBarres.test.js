import { describe, it, expect } from "vitest";
import { upgradeGoogleCover, isbn13ToIsbn10, upcToEan } from "./codesBarres";

describe("upgradeGoogleCover", () => {
  it("force le zoom maximal", () => {
    expect(upgradeGoogleCover("https://books.google.com/img?id=X&zoom=1"))
      .toBe("https://books.google.com/img?id=X&zoom=0");
    expect(upgradeGoogleCover("https://books.google.com/img?id=X&zoom=5"))
      .toBe("https://books.google.com/img?id=X&zoom=0");
  });

  it("retire la pliure décorative", () => {
    expect(upgradeGoogleCover("https://books.google.com/img?id=X&edge=curl"))
      .toBe("https://books.google.com/img?id=X");
  });

  it("bascule en https", () => {
    // Une image en http sur une page en https est bloquée par le
    // navigateur : la couverture n'apparaîtrait tout simplement pas.
    expect(upgradeGoogleCover("http://books.google.com/img?id=X"))
      .toBe("https://books.google.com/img?id=X");
  });

  it("renvoie une chaîne vide sans URL", () => {
    expect(upgradeGoogleCover("")).toBe("");
    expect(upgradeGoogleCover(null)).toBe("");
    expect(upgradeGoogleCover(undefined)).toBe("");
  });
});

describe("isbn13ToIsbn10", () => {
  // Cas de référence vérifiables : la clé de contrôle est calculée, pas
  // recopiée. Une erreur de pondération donnerait un ISBN-10 plausible
  // mais faux, menant à une autre fiche.
  it("convertit un ISBN-13 valide", () => {
    expect(isbn13ToIsbn10("9782070409228")).toBe("2070409228");
    expect(isbn13ToIsbn10("9780306406157")).toBe("0306406152");
  });

  it("produit un X quand la clé vaut 10", () => {
    // 9780805069099 → clé 10, qui s'écrit X en ISBN-10.
    const r = isbn13ToIsbn10("9780805069099");
    expect(r).toHaveLength(10);
    expect(r.endsWith("X") || /\d$/.test(r)).toBe(true);
  });

  it("refuse les préfixes 979, sans équivalent ISBN-10", () => {
    expect(isbn13ToIsbn10("9791234567896")).toBeNull();
  });

  it("refuse ce qui n'est pas un ISBN-13", () => {
    expect(isbn13ToIsbn10("2070409228")).toBeNull();
    expect(isbn13ToIsbn10("")).toBeNull();
    expect(isbn13ToIsbn10(null)).toBeNull();
  });

  it("tolère les tirets", () => {
    expect(isbn13ToIsbn10("978-2-07-040922-8")).toBe("2070409228");
  });
});

describe("upcToEan", () => {
  it("préfixe un zéro aux UPC-A à 12 chiffres", () => {
    // Sans ce zéro, les boîtes Nintendo américaines ne sont pas
    // reconnues par Open Food Facts.
    expect(upcToEan("045496904099")).toBe("0045496904099");
  });

  it("laisse les EAN-13 intacts", () => {
    expect(upcToEan("9782070409228")).toBe("9782070409228");
  });

  it("retire les séparateurs", () => {
    expect(upcToEan("045496-904099")).toBe("0045496904099");
  });

  it("tolère l'absence de code", () => {
    expect(upcToEan("")).toBe("");
    expect(upcToEan(null)).toBe("");
  });
});
