import { describe, it, expect, vi, afterEach } from "vitest";
import { eanFromUpc, mergeResults, tropDAppels, ORIGINES_AUTORISEES } from "./isbn.js";

describe("tropDAppels", () => {
  afterEach(() => vi.useRealTimers());

  // Chaque test emploie une IP distincte : le compteur vit au niveau du
  // module, deux tests partageant une IP se contamineraient.
  it("laisse passer les appels sous le seuil", () => {
    for (let i = 0; i < 30; i++) {
      expect(tropDAppels("10.0.0.1")).toBe(false);
    }
  });

  it("bloque au-delà du seuil", () => {
    for (let i = 0; i < 30; i++) tropDAppels("10.0.0.2");
    expect(tropDAppels("10.0.0.2")).toBe(true);
    expect(tropDAppels("10.0.0.2")).toBe(true);
  });

  it("compte séparément chaque IP", () => {
    for (let i = 0; i < 31; i++) tropDAppels("10.0.0.3");
    expect(tropDAppels("10.0.0.3")).toBe(true);
    expect(tropDAppels("10.0.0.4")).toBe(false);
  });

  it("repart à zéro une fois la fenêtre écoulée", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 31; i++) tropDAppels("10.0.0.5");
    expect(tropDAppels("10.0.0.5")).toBe(true);
    vi.advanceTimersByTime(61 * 1000);
    expect(tropDAppels("10.0.0.5")).toBe(false);
  });

  it("laisse un scan en série passer sans être bridé", () => {
    // Un lot de 25 livres scannés d'affilée doit passer : c'est l'usage
    // le plus intensif prévu, et le brider serait pire que le mal.
    for (let i = 0; i < 25; i++) {
      expect(tropDAppels("10.0.0.6")).toBe(false);
    }
  });
});

describe("ORIGINES_AUTORISEES", () => {
  it("contient l'adresse de production", () => {
    expect(ORIGINES_AUTORISEES).toContain("https://ma-bibliotheque-dionis.vercel.app");
  });

  it("n'autorise aucune origine en clair hors développement local", () => {
    for (const o of ORIGINES_AUTORISEES) {
      if (o.startsWith("http://")) expect(o).toMatch(/^http:\/\/localhost/);
    }
  });
});

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
