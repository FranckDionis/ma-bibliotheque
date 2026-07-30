# Ma Bibliothèque

Application web (PWA) pour cataloguer une bibliothèque familiale : livres,
revues, jeux de société et jeux Nintendo Switch. Scan de code-barres, recherche
de métadonnées multi-sources, gestion des emplacements physiques
(pièce → bibliothèque → étagère) et plan visuel personnalisable.

Conçue pour s'utiliser comme une vraie application sur iPhone, via l'ajout à
l'écran d'accueil.

---

## Comment ça marche

L'application est un client React déployé sur Vercel. Les données vivent dans
une base **Supabase** partagée : chaque membre du foyer se connecte avec son
compte et voit la même bibliothèque, synchronisée en temps réel.

```
Navigateur (React + Vite)
    │
    ├── Supabase ............ base de données, authentification, temps réel
    ├── /api/isbn ........... fonction serverless Vercel : interroge Google Books,
    │                         Open Library, la BnF et Open Food Facts
    └── IndexedDB ........... cache local des couvertures
```

Un **mode local** de secours existe : le bouton « Continuer sans compte » stocke
tout dans le navigateur, sans réseau. C'est un dépannage, pas le mode nominal —
les données restent sur l'appareil et ne sont pas synchronisées.

### Pourquoi un cache de couvertures

Les couvertures sont stockées en base64 dans la base. Les retélécharger à chaque
démarrage représente des centaines de Mo par jour et épuise le quota Supabase
gratuit — c'est déjà arrivé. Elles sont donc mises en cache dans IndexedDB, et
seules les couvertures absentes ou modifiées depuis la dernière synchro sont
récupérées. Pour la même raison, les abonnements temps réel appliquent le delta
reçu et ne rechargent jamais la liste complète.

---

## Installation

Pour installer sur des comptes neufs (GitHub + Supabase + Vercel), suivre le
guide détaillé : **`Claude/INSTALLATION-NOUVEAU-COMPTE.md`**. Il contient le SQL
de création des tables, les politiques de sécurité et la configuration pas-à-pas.

Deux variables d'environnement sont nécessaires côté Vercel :

| Variable | Valeur |
|---|---|
| `VITE_SUPABASE_URL` | l'URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | la clé `anon public` |

La clé `anon` est prévue pour figurer côté navigateur ; la sécurité repose sur
les politiques RLS de Supabase. La clé `service_role`, elle, ne doit jamais
apparaître dans ce dépôt ni dans les variables du client.

Sans ces variables, l'application démarre quand même, en mode local.

---

## Développement

```bash
npm install
npm run dev
```

Créer un fichier `.env.local` (ignoré par git) avec les deux variables ci-dessus.
Attention : il pointera vers la base **réellement utilisée** — travailler sur un
projet Supabase de test évite de modifier les vraies fiches par accident.

La fonction `api/isbn.js` est une fonction serverless Vercel : `vite` seul ne la
sert pas en local, la recherche par code-barres passe donc par la version
déployée.

---

## Installer sur iPhone

1. Ouvrir l'URL de l'application dans **Safari** (obligatoire pour l'installation)
2. Se connecter
3. Bouton **Partage** → **« Sur l'écran d'accueil »** → **Ajouter**

Au premier scan, iOS demande l'accès à la caméra. En cas de refus accidentel :
**Réglages → Safari → Caméra → « Demander »**, puis recharger.

---

## Sauvegarde

Le menu Paramètres permet d'exporter tout le catalogue en JSON.

⚠️ L'import ne se comporte pas de la même façon selon le mode :

- **Mode cloud** : l'import n'écrit **rien** dans la base. Il charge la
  sauvegarde à l'écran ; pour l'envoyer dans la base, utiliser ensuite
  « Migrer vers le cloud », qui ajoute les livres absents sans rien supprimer.
- **Mode local** : l'import remplace réellement et intégralement les données
  stockées sur l'appareil.

---

## Technologies

- **React 18** + **Vite** — framework et build
- **Tailwind CSS** — styles
- **Lucide React** — icônes
- **ZXing** — scan de code-barres, intégré au bundle (et non chargé depuis un
  CDN : il doit fonctionner hors ligne et malgré les bloqueurs)
- **Supabase** — base de données, authentification, temps réel
- **Google Books, Open Library, BnF, Open Food Facts** — métadonnées
