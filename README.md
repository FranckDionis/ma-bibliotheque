# Ma Bibliothèque

Application web pour cataloguer vos livres à la maison, avec scan de code-barres ISBN, gestion des emplacements (pièces / bibliothèques / étagères) et plan visuel personnalisable.

Conçue pour fonctionner comme une vraie app sur iPhone (ajout à l'écran d'accueil).

---

## 🚀 Déploiement sur Vercel — pas-à-pas

Vous n'avez **rien à installer** sur votre ordinateur. Tout se fait dans le navigateur.

### Étape 1 — Créer un compte GitHub (si vous n'en avez pas)

1. Allez sur **https://github.com/signup**
2. Choisissez un nom d'utilisateur, un email, un mot de passe
3. Validez votre email

### Étape 2 — Créer un dépôt et y mettre les fichiers

1. Connecté à GitHub, cliquez sur le **« + »** en haut à droite → **« New repository »**
2. Nom : `ma-bibliotheque` (ou ce que vous voulez)
3. Laissez en **Public** (Vercel gratuit nécessite un dépôt public, sauf comptes payants)
4. Cochez **« Add a README file »**
5. Cliquez **« Create repository »**

6. Sur la page du dépôt fraîchement créé, cliquez **« Add file » → « Upload files »**
7. Glissez-déposez **TOUS** les fichiers et dossiers de ce projet :
   - `package.json`
   - `vite.config.js`
   - `tailwind.config.js`
   - `postcss.config.js`
   - `index.html`
   - `.gitignore`
   - `README.md` (ce fichier)
   - le dossier `src/` entier
   - le dossier `public/` entier
   - **Ne pas uploader** `node_modules/` ni `dist/` (s'ils existent)
8. En bas, cliquez **« Commit changes »**

### Étape 3 — Créer un compte Vercel

1. Allez sur **https://vercel.com/signup**
2. Cliquez **« Continue with GitHub »** (le plus simple)
3. Autorisez Vercel à accéder à GitHub

### Étape 4 — Déployer

1. Sur le tableau de bord Vercel, cliquez **« Add New… » → « Project »**
2. Trouvez le dépôt `ma-bibliotheque` dans la liste, cliquez **« Import »**
3. Vercel détecte automatiquement Vite. **Ne touchez à rien**, cliquez juste **« Deploy »**
4. Attendez ~1 minute. Une URL apparaît, du type `ma-bibliotheque-xyz123.vercel.app`

### Étape 5 — Ouvrir sur iPhone et installer comme app

1. Sur votre iPhone, ouvrez **Safari** (pas Chrome ni autre, Safari obligatoire pour l'installation)
2. Allez sur l'URL Vercel obtenue à l'étape précédente
3. Touchez le bouton **Partage** (carré avec flèche en bas de l'écran)
4. Faites défiler et touchez **« Sur l'écran d'accueil »**
5. Donnez le nom que vous voulez et touchez **« Ajouter »**

L'app apparaît sur votre écran d'accueil avec son icône, et s'ouvre en plein écran sans la barre Safari, comme une vraie app.

### Étape 6 — Autoriser la caméra

Au premier scan, iOS demandera l'autorisation d'accéder à la caméra. Acceptez.

Si vous l'avez refusée par erreur :
- **Réglages iOS** → **Safari** → **Caméra** → choisissez **« Demander »** ou **« Autoriser »**
- Puis rechargez l'app

---

## 💾 Où sont stockées les données ?

Toutes vos données (livres, structure de bibliothèques, dispositions) sont stockées dans le **stockage local du navigateur** sur votre iPhone (`localStorage`). 

**Cela signifie :**
- ✅ Les données restent privées, rien n'est envoyé sur internet
- ✅ Fonctionne hors ligne (sauf le scan des couvertures via ISBN qui interroge Open Library)
- ⚠️ Les données sont liées à ce navigateur sur cet appareil. Si vous effacez les données Safari ou désinstallez l'app, vous perdez votre catalogue.
- ⚠️ Pas de synchronisation automatique entre plusieurs iPhones

> Une future version pourra ajouter export/import JSON pour sauvegarder votre catalogue.

---

## 🔄 Mettre à jour l'app plus tard

Si je vous fournis une version mise à jour du code :
1. Sur GitHub, ouvrez le dépôt
2. Pour chaque fichier modifié : ouvrez-le, cliquez le **crayon** ✏️, collez le nouveau contenu, **« Commit changes »**
3. Vercel redéploie automatiquement en ~1 minute
4. Sur votre iPhone, fermez et rouvrez l'app — la nouvelle version est chargée

---

## 🛠️ Tester en local (optionnel, nécessite Node.js)

Si jamais vous voulez bricoler le code sur votre ordinateur :

```bash
npm install
npm run dev
```

Ouvrez l'URL affichée dans le terminal (par défaut http://localhost:5173).

---

## 📦 Technologies utilisées

- **React 18** + **Vite** : framework et build
- **Tailwind CSS** : styles
- **Lucide React** : icônes
- **ZXing** (chargé via CDN) : scan de code-barres ISBN universel
- **Open Library API** : récupération automatique des métadonnées de livres
- **localStorage** : persistance des données sur l'appareil
