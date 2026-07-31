import { describe, it, expect } from "vitest";
import { eanFromUpc, mergeResults } from "./isbn.js";

describe("eanFromUpc", () => {
  it("préfixe un zéro aux codes UPC-A à 12 chiffres", () => {
    // Boîtes Nintendo américaines : sans ce zéro, Open Food Facts ne
    // reconnaît pas le produit.
    expect(eanFromUpc("045496904099")).toBe("0045496904099");
  });

  it("laisse les EAN-13 intacts", () => {
    expect(eanFromUpc("9782070409228")).toBe("9782070409228");
  });

  it("retire les séparateurs", () => {
    expect(eanFromUpc("978-2-07-040922-8")).toBe("9782070409228");
  });

  it("tolère l'absence de code", () => {
    expect(eanFromUpc("")).toBe("");
    expect(eanFromUpc(null)).toBe("");
  });
});

describe("mergeResults", () => {
  const livre = {
    title: "Les Misérables", author: "Victor Hugo", cover: "", publisher: "Gallimard",
    year: "1862", source: "Google Books", _kind: "book",
  };
  const livreCourt = {
    title: "Misérables", author: "", cover: "https://couv/ol.jpg", publisher: "",
    year: "", source: "Open Library", _kind: "book",
  };
  const produit = {
    title: "Zelda Breath of the Wild", author: "", cover: "https://couv/off.jpg",
    publisher: "Nintendo", year: "", source: "Open Food Facts", _kind: "product",
  };

  it("privilégie un livre quand le type n'est pas précisé", () => {
    const r = mergeResults([{ ...produit }, { ...livre }], "");
    expect(r.source).toBe("Google Books");
  });

  it("privilégie un produit pour un jeu", () => {
    const r = mergeResults([{ ...livre }, { ...produit }], "jeu-switch");
    expect(r.source).toBe("Open Food Facts");
  });

  it("retient le titre le plus long à famille égale", () => {
    const r = mergeResults([{ ...livreCourt }, { ...livre }], "livre");
    expect(r.title).toBe("Les Misérables");
  });

  it("complète la couverture depuis une autre source", () => {
    // Google Books donne le meilleur titre mais pas toujours d'image :
    // sans ce rattrapage, la fiche resterait sans couverture.
    const r = mergeResults([{ ...livre }, { ...livreCourt }], "livre");
    expect(r.title).toBe("Les Misérables");
    expect(r.cover).toBe("https://couv/ol.jpg");
  });

  it("complète l'auteur depuis une autre source", () => {
    const sansAuteur = { ...livre, author: "" };
    const avecAuteur = { ...livreCourt, author: "Hugo, Victor" };
    const r = mergeResults([sansAuteur, avecAuteur], "livre");
    expect(r.author).toBe("Hugo, Victor");
  });

  it("liste toutes les sources consultées", () => {
    const r = mergeResults([{ ...livre }, { ...livreCourt }], "livre");
    expect(r.allSources).toContain("Google Books");
    expect(r.allSources).toContain("Open Library");
  });

  it("fonctionne avec une seule source", () => {
    const r = mergeResults([{ ...livre }], "livre");
    expect(r.title).toBe("Les Misérables");
    expect(r.allSources).toBe("Google Books");
  });
});
