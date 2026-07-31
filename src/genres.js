// ============================================================
// TAXONOMIE DES GENRES — la « bibliothèque virtuelle »
// ============================================================
// Partagée entre le formulaire d'édition, la fiche détail et la vue
// bibliothèque : c'est ce qui impose de la garder dans son propre
// module plutôt que dans celui de la vue.
//
// Les clés sont de la forme « Catégorie/Sous-catégorie ». Elles sont
// stockées telles quelles dans la colonne `genre` de la base : les
// renommer invaliderait les 2 900 fiches déjà classées.

export const GENRE_COLORS = {
  "Arts & Culture":                          { bg: "#7c5c8a", text: "#f0e6f6", light: "#f0e6f6" },
  "Littérature classique":                   { bg: "#4a230a", text: "#f4ecd8", light: "#f9f0e6" },
  "Littérature classique/Romans classiques": { bg: "#5a2d0c", text: "#f4ecd8", light: "#f9f0e6" },
  "Littérature classique/Théâtre & Poésie":  { bg: "#6b3410", text: "#f4ecd8", light: "#f9f0e6" },
  "Romans adultes":                          { bg: "#8b4a1a", text: "#f4ecd8", light: "#fdf0e6" },
  "Romans adultes/Contemporain français":    { bg: "#9b5a1a", text: "#fdf6e8", light: "#fdf0e6" },
  "Romans adultes/Étranger":                 { bg: "#7a3d10", text: "#fdf6e8", light: "#fdf0e6" },
  "Romans adultes/Policier & Thriller":      { bg: "#2c2c3a", text: "#e8e8f0", light: "#f0f0f8" },
  "BD/BD adulte":                            { bg: "#d4870a", text: "#1a0a00", light: "#fff8e0" },
  "BD/BD enfant":                            { bg: "#e8a020", text: "#1a0a00", light: "#fffae0" },
  "Albums petite enfance/0 – 3 ans":         { bg: "#e8c0d0", text: "#3a1020", light: "#fff0f6" },
  "Albums petite enfance/3 – 6 ans":         { bg: "#d4a8c0", text: "#2a0818", light: "#fff0f6" },
  "Romans jeunesse/6 – 10 ans":             { bg: "#2a7a3a", text: "#e8f8ec", light: "#edfff1" },
  "Romans jeunesse/10 – 14 ans":            { bg: "#1e5c2c", text: "#e8f8ec", light: "#edfff1" },
  "Lecture scolaire CP–CM2/Méthode de lecture": { bg: "#1a6080", text: "#e0f4ff", light: "#e8f8ff" },
  "Lecture scolaire CP–CM2/Romans faciles":     { bg: "#1e7890", text: "#e0f4ff", light: "#e8f8ff" },
  "Lecture scolaire CP–CM2/Maternelle & activités": { bg: "#2890a8", text: "#e0f4ff", light: "#e8f8ff" },
  "Scolaire collège & lycée/Manuels & cahiers":     { bg: "#1c3a6e", text: "#dce8ff", light: "#eaf0ff" },
  "Scolaire collège & lycée/Révisions & examens":   { bg: "#142e58", text: "#dce8ff", light: "#eaf0ff" },
  "Musique":                                 { bg: "#5c2d6e", text: "#f0e0ff", light: "#f8f0ff" },
  "Langues étrangères":                      { bg: "#2d5c6e", text: "#e0f4ff", light: "#e8f8ff" },
  "Langues étrangères/Anglais · Espagnol · Allemand…": { bg: "#1e4a5c", text: "#e0f4ff", light: "#e8f8ff" },
  "Langues étrangères/Russe · Hébreu · Japonais…":     { bg: "#2a3d5c", text: "#e0f4ff", light: "#e8f8ff" },
  "Cuisine & Nutrition/Recettes":            { bg: "#8b2020", text: "#ffe8e8", light: "#fff0f0" },
  "Cuisine & Nutrition/Minceur & nutrition": { bg: "#6e4a20", text: "#fff0e0", light: "#fff8f0" },
  "Sciences & Nature/Animaux & nature":      { bg: "#2a5a2a", text: "#e8ffe8", light: "#f0fff0" },
  "Sciences & Nature/Corps humain & biologie": { bg: "#1e4a3a", text: "#e0fff4", light: "#edfff8" },
  "Sciences & Nature/Espace & univers":      { bg: "#1a1a3a", text: "#e0e8ff", light: "#edf0ff" },
  "Histoire & Civilisations":                { bg: "#5a4a20", text: "#fff8e0", light: "#fffcf0" },
  "Judaïsme & Shoah":                        { bg: "#1a1a2a", text: "#e8e8ff", light: "#f0f0ff" },
  "Religion & Spiritualité":                 { bg: "#4a3a6e", text: "#f0ecff", light: "#f8f4ff" },
  "Développement perso/Autisme · DYS · TDA": { bg: "#2a5a6e", text: "#e0f4ff", light: "#e8f8ff" },
  "Développement perso/Psychologie & mémoire": { bg: "#3a4a6e", text: "#e0e8ff", light: "#edf0ff" },
  "Droit & Société":                         { bg: "#2a2a4a", text: "#e8e8ff", light: "#f0f0ff" },
  "Loisirs créatifs":                        { bg: "#c04a6e", text: "#fff0f4", light: "#fff4f8" },
  "Revues & magazines":                      { bg: "#666666", text: "#f8f8f8", light: "#f4f4f4" },
  "Jeux de société":                         { bg: "#d4670a", text: "#fff4e0", light: "#fff8f0" },
  "Jeux vidéo (Switch)":                     { bg: "#cc0000", text: "#ffffff", light: "#fff0f0" },
  "À classer":                               { bg: "#aaaaaa", text: "#222222", light: "#f4f4f4" },
};

export function getGenreColor(genre) {
  return GENRE_COLORS[genre] || { bg: "#6b3410", text: "#f4ecd8", light: "#fdf0e6" };
}
