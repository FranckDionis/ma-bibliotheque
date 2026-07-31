import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// FILET DU DÉCOUPAGE
// ============================================================
// Déplacer un composant d'un fichier à un autre en oubliant son import
// ne casse PAS la compilation : la référence devient une variable
// libre, et l'erreur ne survient qu'au moment où l'écran concerné
// s'affiche. Sur une application de 8 500 lignes dont la plupart des
// écrans exigent une connexion, cela peut passer inaperçu longtemps.
//
// Ce test relit chaque fichier et vérifie que tout composant employé en
// JSX y est soit défini, soit importé.

const ICI = dirname(fileURLToPath(import.meta.url));

function analyser(source) {
  const employes = new Set(
    [...source.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)].map((m) => m[1])
  );

  const definis = new Set([
    ...[...source.matchAll(/^(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/gm)].map((m) => m[1]),
    ...[...source.matchAll(/^(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]),
    ...[...source.matchAll(/^(?:export\s+default\s+)?class\s+([A-Z][A-Za-z0-9_]*)/gm)].map((m) => m[1]),
  ]);

  const importes = new Set();
  for (const m of source.matchAll(/import\s+([^;]+?)\s+from\s+["'][^"']+["']/g)) {
    const clause = m[1];
    const nommes = clause.match(/\{([^}]*)\}/s);
    if (nommes) {
      for (const p of nommes[1].split(",")) {
        const nom = p.split(" as ").pop().trim();
        if (nom) importes.add(nom);
      }
    }
    const parDefaut = clause.replace(/\{[^}]*\}/s, "").replace(/,/g, "").trim();
    if (parDefaut && /^[A-Za-z_][A-Za-z0-9_]*$/.test(parDefaut)) importes.add(parDefaut);
  }

  // `React` couvre React.Fragment et consorts.
  const nonResolus = [...employes].filter(
    (n) => !definis.has(n) && !importes.has(n) && n !== "React"
  );

  return { employes, definis, importes, nonResolus: nonResolus.sort() };
}

const fichiersJsx = readdirSync(ICI).filter((f) => f.endsWith(".jsx"));

describe("Résolution des composants JSX", () => {
  it("trouve bien des fichiers à analyser", () => {
    expect(fichiersJsx.length).toBeGreaterThan(0);
  });

  for (const fichier of fichiersJsx) {
    it(`${fichier} : tout composant employé est défini ou importé`, () => {
      const { nonResolus } = analyser(readFileSync(join(ICI, fichier), "utf8"));
      expect(nonResolus).toEqual([]);
    });
  }
});

describe("Analyseur", () => {
  // Sans ces deux cas, un analyseur cassé déclarerait tout conforme.
  it("repère un composant non résolu", () => {
    const { nonResolus } = analyser(`export function A() { return <Inconnu />; }`);
    expect(nonResolus).toEqual(["Inconnu"]);
  });

  it("accepte un composant importé", () => {
    const src = `import { Connu } from "./x";\nexport function A() { return <Connu />; }`;
    expect(analyser(src).nonResolus).toEqual([]);
  });

  it("accepte un composant défini sur place", () => {
    const src = `function Connu() { return null; }\nexport function A() { return <Connu />; }`;
    expect(analyser(src).nonResolus).toEqual([]);
  });
});
