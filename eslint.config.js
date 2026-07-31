import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// ============================================================
// ANALYSE STATIQUE
// ============================================================
// Ajouté après qu'un découpage a laissé la déclaration `let _zxing = null;`
// derrière la fonction qui l'utilisait. Le module compilait, les 155 tests
// passaient, et le scan tombait en repli sur un lecteur absent d'iOS —
// « scan automatique non disponible ».
//
// Trois contrôles maison avaient déjà eu des trous : commentaires mal
// retirés, chaînes prises pour du code, et surveillance limitée aux seuls
// noms exportés. `no-undef` couvre toute cette famille de défauts, et il
// est éprouvé — ce que mes expressions régulières n'étaient pas.
//
// Le jeu de règles est volontairement étroit : on cherche les erreurs
// réelles, pas à imposer un style à 8 000 lignes existantes.

export default [
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    linterOptions: {
      // Les directives de désactivation visant exhaustive-deps sont
      // conservées bien que la règle soit inactive : elles documentent une
      // omission volontaire, et redeviendront utiles si on l'active un jour.
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      // Le cœur du sujet : un identifiant employé sans être déclaré.
      "no-undef": "error",

      // Un hook appelé conditionnellement casse l'ordre des hooks entre
      // deux rendus : React perd le fil et l'état se mélange. Erreur réelle,
      // jamais un détail de style.
      "react-hooks/rules-of-hooks": "error",

      // Laissée inactive : sur ce code, elle produirait des centaines
      // d'avertissements dont la plupart sont volontaires (des refs y
      // servent précisément à éviter les closures périmées). Le greffon est
      // installé pour que les directives de désactivation déjà présentes
      // dans le code soient reconnues.
      "react-hooks/exhaustive-deps": "off",

      // Sans cette règle, tout composant importé pour n'être utilisé qu'en
      // JSX passerait pour inutilisé.
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",

      // Utile au découpage : signale les imports devenus morts. En
      // avertissement, pour ne pas bloquer sur des variables de travail.
      "no-unused-vars": ["warn", {
        args: "none",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],

      // Bruit pur sur ce projet : on ne cherche pas à le discipliner.
      "no-empty": "off",
      "no-useless-escape": "off",
    },
  },
  {
    // Les fichiers de test tournent sous Node et Vitest.
    files: ["**/*.test.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
