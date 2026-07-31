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

// Retire les commentaires — en PARCOURANT le texte, pas par expression
// régulière.
//
// Deux pièges ont fait échouer les versions naïves de cette fonction :
//
//   1. En expression régulière JavaScript, « . » ne franchit pas \r, qui
//      est un terminateur de ligne. Sur un fichier en CRLF, /\/\/.*$/
//      n'atteint jamais la fin de la ligne et ne retire donc rien.
//
//   2. Surtout : /\/\*[\s\S]*?\*\//g prend le « /* » de accept="image/*"
//      pour une ouverture de commentaire et avale tout jusqu'au « */ »
//      suivant. Sur App.jsx, un seul de ces faux blocs effaçait 4 874
//      caractères de code réel, et 25 % du fichier disparaissait avant
//      analyse — rendant des identifiants bel et bien utilisés
//      invisibles, donc « inutilisés ».
//
// D'où ce parcours caractère par caractère, qui sait qu'un « /* » entre
// guillemets n'est pas un commentaire.
export function sansCommentaires(source) {
  const t = source.replace(/\r\n?/g, "\n");
  let sortie = "";
  let i = 0;

  while (i < t.length) {
    const c = t[i];
    const suivant = t[i + 1];

    if (c === "/" && suivant === "/") {
      while (i < t.length && t[i] !== "\n") i++;
      continue;
    }

    if (c === "/" && suivant === "*") {
      i += 2;
      while (i < t.length && !(t[i] === "*" && t[i + 1] === "/")) i++;
      i += 2;
      sortie += " "; // sépare ce que le commentaire séparait
      continue;
    }

    // Chaînes et gabarits : recopiés tels quels, sans y chercher de
    // commentaire.
    if (c === '"' || c === "'" || c === "`") {
      sortie += c;
      i++;
      while (i < t.length) {
        if (t[i] === "\\") {
          sortie += t[i] + (t[i + 1] ?? "");
          i += 2;
          continue;
        }
        sortie += t[i];
        if (t[i] === c) { i++; break; }
        i++;
      }
      continue;
    }

    sortie += c;
    i++;
  }

  return sortie;
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

// ============================================================
// VOLET DÉCISIF : les identifiants libres
// ============================================================
// Les deux volets précédents ne surveillaient que ce qu'App.jsx DÉFINIT.
// Ils ont laissé passer une régression réelle : SettingsModal, extraite,
// utilisait ITEM_TYPES_LIST — un nom qu'App.jsx ne définit pas mais
// IMPORTE depuis itemTypes.js. Le module compilait, et la modale
// plantait à l'ouverture avec « can't find variable ».
//
// Ce volet-ci raisonne à l'envers : il part de tous les noms exportés
// par le projet ou importés de bibliothèques tierces, et vérifie qu'un
// module qui les emploie les a bien à sa disposition.
//
// Les chaînes sont retirées en plus des commentaires : sans cela, le mot
// « Library » d'une phrase comme « Open Library » passe pour un
// composant manquant.

function sansChainesNiCommentaires(source) {
  const t = sansCommentaires(source);
  let sortie = "", i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < t.length) {
        if (t[i] === "\\") { i += 2; continue; }
        if (t[i] === c) { i++; break; }
        i++;
      }
      sortie += '""';
      continue;
    }
    sortie += c;
    i++;
  }
  return sortie;
}

// Noms rendus disponibles par une déstructuration : props d'un
// composant, ou `const { a, b } = ...`.
function nomsDestructures(source) {
  const noms = new Set();
  for (const m of source.matchAll(/(?:function\s+[A-Za-z0-9_]*\s*\(|=>\s*|=\s*)?\{([^{}]*)\}/g)) {
    for (const p of m[1].split(",")) {
      const n = p.split(":").pop().split("=")[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) noms.add(n);
    }
  }
  return noms;
}

describe("Identifiants libres", () => {
  const fichiers = readdirSync(ICI).filter(
    (f) => /\.jsx?$/.test(f) && !f.endsWith(".test.js")
  );

  // Tout ce que le projet exporte, plus ce qu'il importe de tiers.
  const nomsConnus = new Set();
  for (const f of fichiers) {
    const s = readFileSync(join(ICI, f), "utf8");
    for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      nomsConnus.add(m[1]);
    }
    for (const m of s.matchAll(/import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      if (m[2].startsWith(".")) continue;
      for (const p of m[1].split(",")) {
        const n = p.split(" as ").pop().trim();
        if (n) nomsConnus.add(n);
      }
    }
  }

  it("suit un nombre plausible de noms", () => {
    expect(nomsConnus.size).toBeGreaterThan(30);
  });

  for (const fichier of fichiers) {
    it(`${fichier} : aucun identifiant du projet employé sans être disponible`, () => {
      const brut = readFileSync(join(ICI, fichier), "utf8");
      // On retire les lignes d'import : un alias y fait apparaître le nom
      // d'origine (`fetchBooks as fetchBooksRemote`) sans qu'il soit utilisé.
      //
      // ⚠️ Le motif du chemin accepte une chaîne VIDE. Les chaînes ayant
      // déjà été neutralisées juste avant, `from "./db"` est devenu
      // `from ""` : exiger au moins un caractère entre les guillemets
      // faisait échouer le retrait, et les quatre noms aliasés du module
      // db ressortaient comme des identifiants libres.
      const source = sansChainesNiCommentaires(brut)
        .replace(/import\s+[^;]+?from\s+["'][^"']*["'];?/g, "");

      const disponibles = new Set([
        ...[...source.matchAll(/(?:^|\s)(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
        ...nomsDestructures(source),
        ...[...brut.matchAll(/import\s+([^;]+?)\s+from\s+["'][^"']+["']/g)].flatMap((m) => {
          const clause = m[1];
          const res = [];
          const nommes = clause.match(/\{([^}]*)\}/s);
          if (nommes) for (const p of nommes[1].split(",")) { const n = p.split(" as ").pop().trim(); if (n) res.push(n); }
          const parDefaut = clause.replace(/\{[^}]*\}/s, "").replace(/,/g, "").trim();
          if (parDefaut) res.push(parDefaut);
          return res;
        }),
      ]);

      const libres = [...nomsConnus].filter(
        (n) => !disponibles.has(n) && new RegExp(`\\b${n}\\b`).test(source)
      ).sort();

      expect(libres).toEqual([]);
    });
  }
});

// ============================================================
// TROISIÈME VOLET : les imports devenus inutiles
// ============================================================
// À chaque composant déplacé, les imports qu'il était seul à utiliser
// deviennent morts dans le fichier d'origine. Ils ne gênent pas
// l'exécution — le bundler les élimine — mais ils font croire à une
// dépendance qui n'existe plus, et brouillent l'analyse du découpage
// suivant.

describe("Imports effectivement utilisés", () => {
  const fichiers = readdirSync(ICI).filter(
    (f) => (f.endsWith(".js") || f.endsWith(".jsx")) && !f.endsWith(".test.js")
  );

  for (const fichier of fichiers) {
    it(`${fichier} n'a pas d'import inutilisé`, () => {
      const brut = readFileSync(join(ICI, fichier), "utf8");
      const source = sansCommentaires(brut);

      const inutilises = [];
      for (const m of brut.matchAll(/import\s+\{([^}]*)\}\s+from\s+["'][^"']+["']/g)) {
        for (const partie of m[1].split(",")) {
          const nom = partie.split(" as ").pop().trim();
          if (!nom) continue;
          // On compte les occurrences hors de la ligne d'import elle-même.
          const sansImports = source.replace(/import\s+[^;]+?from\s+["'][^"']+["'];?/g, "");
          if (!new RegExp(`\\b${nom}\\b`).test(sansImports)) inutilises.push(nom);
        }
      }

      expect(inutilises).toEqual([]);
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

  // Le piège qui a coûté 25 % d'App.jsx : le « /* » d'un type MIME.
  it("ne prend pas le /* d'un type MIME pour un commentaire", () => {
    const src = 'const a = <input accept="image/*" />;\nconst b = garder();\nconst c = "x*/y";';
    const net = sansCommentaires(src);
    expect(net).toContain("garder()");
    expect(net).toContain('accept="image/*"');
  });

  it("ne touche pas à un // situé dans une chaîne", () => {
    expect(sansCommentaires('const u = "https://exemple.fr"; const v = garder();'))
      .toContain("garder()");
  });

  it("ne supprime rien quand il n'y a aucun commentaire", () => {
    const src = 'const a = 1;\nconst b = "texte";\n';
    expect(sansCommentaires(src)).toBe(src);
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
