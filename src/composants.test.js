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

// ============================================================
// SECOND VOLET : les appels de fonctions
// ============================================================
// Le test ci-dessus ne voit que le JSX. Un module extrait qui appelle
// une fonction restée dans App.jsx — un utilitaire de compression, un
// helper de tri — compile tout aussi bien et échoue à l'exécution.
//
// Les commentaires sont retirés avant analyse : sans cela, une simple
// mention comme « recompressé via compressImageDataUrl (…) » ressemble
// à un appel et déclenche une fausse alerte. C'est arrivé.

function sansCommentaires(texte) {
  return texte
    // Normaliser les fins de ligne AVANT tout : en expression régulière
    // JavaScript, « . » ne franchit pas \r, qui est un terminateur de
    // ligne. Sur un fichier en CRLF, /\/\/.*$/ ne peut donc jamais
    // atteindre la fin de la ligne et ne retire rien. Le test croyait
    // nettoyer les commentaires et les analysait en réalité tels quels.
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
}

function declarationsDeHautNiveau(source) {
  return new Set(
    [...source.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let)\s+([a-zA-Z_][A-Za-z0-9_]*)/gm)]
      .map((m) => m[1])
  );
}

describe("Indépendance des modules extraits", () => {
  const appSource = sansCommentaires(readFileSync(join(ICI, "App.jsx"), "utf8"));
  const definisDansApp = declarationsDeHautNiveau(appSource);

  const modules = readdirSync(ICI).filter(
    (f) => (f.endsWith(".js") || f.endsWith(".jsx")) &&
           !f.endsWith(".test.js") && f !== "App.jsx" && f !== "main.jsx"
  );

  it("App.jsx expose bien des déclarations à surveiller", () => {
    expect(definisDansApp.size).toBeGreaterThan(10);
  });

  for (const fichier of modules) {
    it(`${fichier} n'appelle aucune fonction restée dans App.jsx`, () => {
      const brut = readFileSync(join(ICI, fichier), "utf8");
      const source = sansCommentaires(brut);
      const locales = declarationsDeHautNiveau(source);
      const importes = new Set(
        [...brut.matchAll(/import\s+\{([^}]*)\}/g)]
          .flatMap((m) => m[1].split(",").map((p) => p.split(" as ").pop().trim()))
      );

      const fuites = [...definisDansApp].filter(
        (nom) =>
          !locales.has(nom) &&
          !importes.has(nom) &&
          new RegExp(`\\b${nom}\\s*\\(`).test(source)
      );

      expect(fuites).toEqual([]);
    });
  }
});

describe("Nettoyage des commentaires", () => {
  // Sans ces cas, une fonction de nettoyage inopérante rendrait le test
  // d'indépendance ci-dessus complaisant : il analyserait les
  // commentaires comme du code et n'y verrait que du feu.
  it("retire un commentaire de fin de ligne", () => {
    expect(sansCommentaires("const a = 1; // appelle truc()")).not.toContain("truc");
  });

  it("le fait aussi sur des fins de ligne Windows", () => {
    expect(sansCommentaires("const a = 1;\r\n// appelle truc()\r\n")).not.toContain("truc");
  });

  it("retire un commentaire de bloc", () => {
    expect(sansCommentaires("/* appelle truc() */\nconst a = 1;")).not.toContain("truc");
  });

  it("préserve le code", () => {
    expect(sansCommentaires("const a = truc();")).toContain("truc()");
  });
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
