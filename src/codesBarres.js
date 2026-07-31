// ============================================================
// CODES-BARRES ET URL DE COUVERTURE — fonctions pures
// ============================================================
// Extraites d'App.jsx pour être testables. Ce sont les conversions
// silencieuses : elles ne lèvent jamais d'erreur, elles renvoient
// simplement un résultat faux si elles se trompent — et un ISBN mal
// converti donne une fiche attribuée au mauvais livre, sans que rien
// ne le signale.

// Améliore une URL de couverture Google Books.
// Google renvoie souvent `zoom=1` et une pliure décorative ; en passant à
// `zoom=0` et en retirant `edge=curl`, on obtient l'image la plus grande
// disponible, sans bord corné.
export function upgradeGoogleCover(url) {
  if (!url) return "";
  return url
    .replace(/^http:/, "https:")
    .replace(/&edge=curl/, "")
    .replace(/zoom=\d/, "zoom=0");
}

// Convertit un ISBN-13 commençant par 978 en ISBN-10.
// La clé de contrôle suit une somme pondérée modulo 11, où le reste 10
// s'écrit « X ». Renvoie null si la conversion n'a pas de sens : les
// préfixes 979 n'ont aucun équivalent ISBN-10.
export function isbn13ToIsbn10(isbn13) {
  const clean = (isbn13 || "").replace(/\D/g, "");
  if (clean.length !== 13 || !clean.startsWith("978")) return null;
  const core = clean.substring(3, 12); // 9 chiffres significatifs
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(core[i], 10) * (10 - i);
  }
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? "X" : check.toString());
}

// Jeux Switch et produits nord-américains : un UPC-A fait 12 chiffres.
// Le préfixer d'un 0 donne l'EAN-13 équivalent, ce qui maximise les
// chances de correspondance dans Open Food Facts.
export function upcToEan(code) {
  const clean = (code || "").replace(/\D/g, "");
  if (clean.length === 12) return "0" + clean;
  return clean;
}
