# deposer-couverture

Fonction Edge Supabase. Télécharge une couverture hébergée chez un tiers
et la dépose dans le bucket `couvertures`.

## Pourquoi

Le navigateur ne peut pas lire les octets d'une image servie par un autre
domaine — c'est exactement ce que la politique d'origine interdit.
L'application enregistrait donc l'URL distante telle quelle, et la fiche
restait suspendue à un serveur sur lequel on n'a aucune prise. Constaté à
l'usage : **100 % des livres ajoutés** avec une couverture trouvée en
ligne repartaient avec une URL externe.

Côté serveur, cette restriction n'existe pas.

## Déploiement

**Par le tableau de bord** — le plus simple :

1. https://supabase.com/dashboard/project/zfflvlwmjlykdjgjjrur/functions
2. *Deploy a new function* → *Via Editor*
3. Nom : `deposer-couverture`
4. Coller le contenu de `index.ts`, puis déployer

**Ou par le CLI**, depuis le dossier `Programme/` :

```
supabase functions deploy deposer-couverture --project-ref zfflvlwmjlykdjgjjrur
```

Aucune variable à configurer : `SUPABASE_URL` et
`SUPABASE_SERVICE_ROLE_KEY` sont injectées automatiquement.

## Garde-fous

**Liste d'hôtes autorisés.** Sans elle, la fonction serait un proxy
ouvert : un membre pourrait lui faire récupérer une adresse interne du
réseau Supabase, ou masquer l'origine de requêtes vers des tiers. Seules
les sources réellement utilisées par l'application sont acceptées, et
uniquement en HTTPS.

**Appartenance vérifiée.** Être authentifié ne suffit pas : la fonction
consulte la table `membres`, comme le reste de l'application. Le jeton du
visiteur sert uniquement à l'identifier ; les écritures passent par la
clé de service.

**Taille plafonnée** à 3 Mo, et le type MIME doit commencer par `image/`.

## Comportement en cas d'échec

`rapatrierCoverDistante` dans `src/db.js` **n'échoue jamais** : si la
fonction est absente, refuse l'hôte ou tombe en panne, l'URL distante est
conservée et le livre s'enregistre normalement. La fiche reste dans
l'état d'avant, et `Claude/migration/etat-couvertures.mjs --rapatrier`
la reprendra plus tard.

C'est délibéré : une couverture est un confort, pas une donnée dont la
perte justifierait de bloquer un enregistrement.

## Ordre à respecter

Déployer la fonction **avant** de mettre en ligne la version de
l'application qui l'appelle. Dans l'autre sens rien ne casse — l'appel
échoue et on retombe sur l'URL distante — mais chaque ajout de livre
inscrirait un avertissement dans la console pour rien.
