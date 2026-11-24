# SwimCoach App — version multi-entraîneurs : conception

Date : 2026-11-19 · Statut : **validé par Damien le 19/11/2026, puis révisé le même jour (espaces d'équipe partagés, section 6 bis)** · Langue de l'app : français

## 1. Intention

Damien (entraîneur au TOAC Natation) a une app qui fonctionne bien, `SwimCoach App` (fichier HTML unique, Supabase, design « Club », version `v2026-11-05-club4`). Elle n'a **aucune connexion** : tous ceux qui l'ouvrent voient les mêmes nageurs.

Il veut une **nouvelle app, dans un dépôt et un projet Supabase séparés**, où :

- chaque entraîneur (ses collègues du club) crée son compte, avec un e-mail et un mot de passe ;
- les données (nageurs, séances, présences, perfs, planning) appartiennent à un **espace d'équipe**. Plusieurs entraîneurs s'occupent souvent du même groupe : chaque membre d'un espace voit et modifie les mêmes informations, et un entraîneur ne voit **que les espaces dont il est membre**. Un membre ajoute un collègue avec son adresse e-mail (section 6 bis) ;
- le code est **découpé en modules** plutôt qu'en un seul gros fichier, pour faciliter les mises à jour ;
- le montage est **prêt pour un éventuel passage sur Google Play et l'App Store**, plus tard.

Pourquoi : suivre son groupe avec les collègues qui l'encadrent aussi, sans voir (ni abîmer) les données des autres groupes, tout en gardant l'outil que Damien connaît. Un espace, c'est l'équivalent de l'ancienne app partagée, limité à ceux qui en sont membres.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Comptes par entraîneur et espaces d'équipe partagés, avec isolation entre espaces **garantie par la base de données**, pas seulement par l'interface.
- Toutes les fonctions de `club4` (liste en section 8), avec le design Club inchangé.
- Dépôt modulaire, avec tests automatiques et mise en ligne automatique à chaque `push`.
- Fondations « stores » : tout ce que les relecteurs Apple et Google exigent est déjà dans l'app (section 9).

**Non-objectifs (cette phase)**
- Reprise des données de l'ancienne app : on repart de zéro (l'import Excel existant reste disponible).
- Rôles différents dans un espace (tous les membres ont les mêmes droits), partage d'un seul nageur entre deux espaces, envoi automatique d'un e-mail d'invitation (le membre prévient son collègue lui-même).
- Rôle administrateur du club, tableau de bord du club, connexion Google ou Apple, notifications push.
- Nouveau design. Génération des projets natifs iOS/Android. Soumission aux stores.

**Anti-objectifs (un échec même si « ça marche »)**
- Un entraîneur qui voit, modifie ou supprime la moindre donnée d'un espace dont il n'est pas membre, y compris en appelant directement l'API, en partageant le même téléphone ou après avoir été retiré de l'espace.
- Une modification de l'ancienne app, de son dépôt (`ssephiroth31/Swimcoachpro`), de son Supabase ou de ses clés de stockage local.
- Une mise en place que Damien ne sait plus faire évoluer : le circuit doit rester « on pousse, c'est en ligne ».

## 3. Contraintes

- **Séparation totale** avec l'ancienne app : nouveau dépôt `SwimmCoachApp/swimcoach-app`, nouveau projet Supabase. Aucune requête vers l'ancien projet (URL `aijgczmszymfjkeegbjz`).
- **Stockage local** : l'ancienne et la nouvelle app peuvent partager la même origine `github.io`. Toutes les clés de la nouvelle app commencent par `swimcoach2_`. Elle ne lit, n'écrit et ne supprime jamais `swimcoach_v2`, `swimcoach_theme` ni `__app_version__`.
- **Données de mineurs** (noms, photos, téléphones, e-mails, parents) : hébergement dans l'UE, politique de confidentialité, suppression du compte et des données. Le club est responsable de traitement ; les entraîneurs sont utilisateurs.
- **E-mails d'authentification** : le serveur par défaut de Supabase n'envoie qu'aux membres de l'organisation Supabase (vérifié dans la documentation). Il faut un **SMTP personnalisé** avant d'inviter les collègues.
- **Offre gratuite Supabase** : pas de sauvegardes, pause après une semaine d'inactivité. Acceptable en test, à passer en offre payante avant de recevoir de vraies données de mineurs.
- **GitHub Pages** n'est gratuit que pour les dépôts publics. Le dépôt est privé aujourd'hui : décision en section 11.
- Échelle : une dizaine d'entraîneurs, quelques centaines de nageurs. Pas de contrainte de performance particulière.
- **Projets Supabase interdits** pour toute migration, test ou requête : l'ancien projet SwimCoach (`aijgczmszymfjkeegbjz`) et le projet « École de natation TOAC » (`vijexmmydvgfpkyzkgls`, une autre app de Damien). Ces deux références figurent sur la liste noire de la CI. Le travail de la phase de construction se fait uniquement sur le **nouveau** projet de Damien, `zuguceilohochmpnbzaz`.
- **Environnement de développement** (choix du rédacteur) : un seul projet Supabase hébergé pendant la construction, avec des comptes de test créés et supprimés par les scripts ; aucune vraie donnée avant l'offre payante et le SMTP. Les tests d'isolation tournent aussi en CI sur une pile Supabase locale (`supabase start`, Docker disponible sur les machines GitHub). Les migrations sont des fichiers du dépôt, donc le projet peut être recréé à l'identique.

## 4. Approches considérées

| | Approche | Avantages | Inconvénients |
|---|---|---|---|
| **A (retenue par Damien)** | Vite + JavaScript, modules par fonctionnalité, sans framework | Reprend la logique de `club4` morceau par morceau, peu de régressions, peu de dépendances, proche des habitudes de Damien | Les écrans restent construits en chaînes HTML, moins élégant qu'un framework |
| B | Vite + framework (Svelte) | Interface plus propre à long terme | Réécriture de tous les écrans, plus long, plus de risque de bugs |
| C | Monorepo à paquets séparés (core, ui, web, mobile) | Utile avec plusieurs apps | Surdimensionné pour une app et un développeur |

Damien a choisi **A**. « Package » est compris comme un module par fonctionnalité, pas comme un paquet npm distinct.

## 5. Architecture du dépôt

```
swimcoach-app/
  index.html
  package.json, vite.config.js, vitest.config.js
  capacitor.config.json            # préparation stores (section 9), sans dossiers natifs
  public/                          # icônes, manifest, privacy.html
  src/
    main.js                        # démarrage, garde de connexion
    app/                           # coque : navigation par écrans, barre du haut, thème, toasts, mise à jour
    core/                          # client Supabase, session, cache local par entraîneur, synchro, dates, config
    features/
      auth/                        # connexion, inscription + code, mot de passe oublié, suppression du compte
      teams/                       # espaces d'équipe : création, choix, membres, invitations
      contacts/                    # nageurs : liste, fiche, photo, groupes, archivage, import Excel
      calendar/                    # calendrier, panneau du jour, séances, photo de séance
      presence/                    # appel, jauge « N / M présents », appel compétition
      stats/                       # statistiques, graphique de progression
      planning/                    # semaines et événements
      perfs/                       # performances (liveffn)
      pdf/                         # PDF stats, planning, bilan individuel (derrière une interface unique)
      settings/                    # profil, thème, groupes
    styles/                        # tokens.css (thèmes clair/sombre), base.css, un fichier par fonctionnalité
  supabase/
    migrations/                    # schéma, RLS, fonctions, stockage
    functions/                     # liveffn-proxy, delete-account
    tests/                         # tests d'isolation (deux comptes)
  tests/                           # unitaires (Vitest) et de bout en bout (Playwright)
  docs/                            # ce document, plan, checklist des stores
  .github/workflows/               # CI (tests + build) et déploiement
```

Les noms de dossiers ci-dessus sont une proposition. Le constructeur peut les ajuster si la structure reste « un dossier par fonctionnalité ».

**Choix techniques (mes choix, à corriger si besoin)**
- JavaScript moderne (modules ES) avec JSDoc, pas TypeScript : rester proche du code actuel.
- `@supabase/supabase-js` installé via npm et embarqué par Vite (plus de CDN `unpkg` ni de code de relance du chargement).
- Chart.js et polices (Bricolage Grotesque, Inter) embarqués dans l'app, plus de CDN Google ou jsDelivr : fonctionnement hors ligne et pas d'appel tiers.
- Lecture de fichiers Excel : à charger à la demande uniquement. Le paquet npm `xlsx` est périmé et a des failles connues ; le constructeur choisit une alternative sûre (SheetJS depuis son propre site, ou autre).
- Le code actuel utilise **87 `onclick=` en ligne** et des fonctions globales. Dans des modules ES, il faut les remplacer par une délégation d'événements (`data-action`).
- `vite-plugin-pwa` pour le service worker et le manifest. L'ancien système `APP_VERSION` + rechargement forcé est remplacé par des fichiers à empreinte et un bandeau « Nouvelle version disponible — Recharger ».
- `base: './'` dans Vite, pour fonctionner sous un sous-chemin GitHub Pages et plus tard dans Capacitor.

## 6. Comptes et sécurité

**Authentification** : Supabase Auth, e-mail + mot de passe, confirmation de l'e-mail activée, mot de passe d'au moins 10 caractères (et protection contre les mots de passe compromis si l'offre le permet). Mot de passe oublié par e-mail.

**Inscription réservée aux collègues** : n'importe qui peut créer un compte technique, mais il reste **inactif** (aucun accès aux données) tant qu'il n'a pas saisi le **code du club**. Cela évite que quelqu'un qui trouve l'adresse de l'app puisse s'en servir.
- Le code est choisi par Damien, stocké sous forme hachée, modifiable à tout moment. Il n'est jamais dans le code de l'app.
- Une fonction serveur `redeem_invite_code(code)` active le compte. Limitée à environ 5 essais par heure et par compte.
- Variante à évaluer par le constructeur : le « Before User Created hook » de Supabase. Le résultat doit être le même, et la règle doit tenir côté base.

**Isolation (règle centrale)**
- Chaque table métier a `team_id uuid not null references teams(id) on delete cascade` (l'espace auquel appartient la ligne).
- RLS activée sur **toutes** les tables, avec des politiques `select/insert/update/delete` limitées aux espaces dont l'appelant est membre (`team_id` présent dans ses lignes de `team_members`) **et** à un compte activé.
- Les lignes enfants (présences, performances) ne peuvent référencer que des lignes du même espace : clés étrangères composites `(team_id, id)`. Sinon, un membre pourrait rattacher une ligne à un nageur d'un autre espace.
- Fonctions `security definer` : uniquement celles qui sont voulues, avec `revoke execute` pour `anon` et pour tout le reste. Le contrôle de sécurité de l'École de natation montre déjà ce piège. Lancer les contrôles de sécurité Supabase après chaque migration.
- Aucune clé `service_role` dans l'app ni dans le dépôt. Dans l'app : l'URL et la clé publique uniquement (publiques par conception).

**Photos** : stockage Supabase dans un bucket **privé**, un dossier par espace d'équipe (`<team_id>/...`), avec politiques de stockage réservées aux membres de l'espace. Redimensionnement dans le navigateur avant envoi. L'ancienne app les stockait en base64 dans chaque ligne : plus lourd et peu sûr.

**Cache local** : le cache hors ligne est rangé sous `swimcoach2_<id entraîneur>_<id espace>_...`. À la déconnexion, tout `swimcoach2_*` lié à l'entraîneur est effacé. Deux entraîneurs sur le même téléphone ne voient jamais les données l'un de l'autre, même s'ils partagent un espace. Si un entraîneur est retiré d'un espace, le cache de cet espace est effacé à la synchro suivante.

**Hors ligne** : `club4` n'a pas de vraie file d'attente d'écritures. Il fonctionne en « local d'abord » : au démarrage, il fusionne le cloud et le local, puis renvoie les éléments présents seulement en local (nageurs, séances, planning), avec un marqueur « en attente » pour les présences. La nouvelle app garde ce comportement et le rend plus solide (choix du rédacteur) :
- file d'attente persistante pour les nageurs, séances, présences et planning, avec identifiants `uuid` créés côté app, colonne `updated_at` et écritures idempotentes (`upsert`) ;
- les photos exigent le réseau (pas de file d'attente pour elles) ;
- **déconnexion avec modifications non synchronisées** : l'app prévient (« N modifications ne sont pas encore envoyées »), propose d'attendre le réseau ou de se déconnecter quand même, et dans ce cas les efface avec le reste du cache.

**Temps réel** : conservé pour synchroniser les appareils de tous les membres de l'espace ouvert (filtre sur son `team_id`, RLS appliquée). C'est indispensable maintenant que plusieurs entraîneurs font l'appel du même groupe. Les présences restent envoyées nageur par nageur, pour que deux entraîneurs qui cochent en même temps ne s'écrasent pas.

**Suppression du compte** (exigée par Apple) : bouton dans l'app → fonction `delete-account`. Elle supprime les espaces dont l'utilisateur est le **seul** membre (avec leurs fichiers de stockage), puis l'utilisateur. Les espaces partagés restent intacts pour les autres membres.

## 6 bis. Espaces d'équipe

- Un **espace** (ex. « Pôle Formation 1 ») contient ses groupes, nageurs, séances, présences, planning et perfs. C'est l'équivalent d'une ancienne app partagée.
- Un entraîneur peut être membre de **plusieurs espaces**. Il en a toujours un ouvert, et il change d'espace depuis la barre du haut ou les réglages. L'app retient le dernier ouvert.
- Après activation par le code du club : si une invitation l'attend, il rejoint l'espace automatiquement ; sinon, l'app lui propose de **créer son espace** (nom libre).
- **Tous les membres ont les mêmes droits** (choix de Damien) : consulter et modifier toutes les données de l'espace, renommer l'espace, ajouter un entraîneur, retirer un invité, quitter l'espace. **Deux exceptions réservées au propriétaire** (le créateur de l'espace, `teams.created_by`, décision du 24 novembre 2026) : supprimer l'espace, et ne pouvoir être retiré que par lui-même. Sans propriétaire membre (il est parti, ou son compte a été supprimé), tout membre peut supprimer l'espace : il ne reste jamais bloqué. Migration `owner_only_delete_team`, erreur `not_owner`.
- **Ajouter un entraîneur** : un membre saisit l'adresse e-mail du collègue. Si un compte confirmé existe avec cette adresse, il devient membre tout de suite. Sinon, l'**invitation reste en attente** et il rejoint l'espace dès qu'il crée son compte avec cette adresse et que celle-ci est confirmée. Aucun e-mail n'est envoyé par l'app pour l'invitation dans cette phase : le membre prévient son collègue. Les invitations en attente sont visibles et annulables par les membres. Limite : environ 20 invitations par heure et par entraîneur.
- **Retirer un membre** ou **quitter** : l'entraîneur concerné perd l'accès immédiatement (la base le refuse), et son cache de l'espace est effacé à la synchro suivante, avec le message « Tu n'as plus accès à l'espace … ». Le dernier membre ne peut pas quitter l'espace : il doit le supprimer explicitement (« Supprimer l'espace et toutes ses données »).
- Liste des membres : nom affiché et adresse e-mail. Un entraîneur ne voit les adresses que des membres de ses propres espaces.
- Toutes ces règles sont appliquées par des fonctions côté base (`create_team`, `add_team_member`, `remove_team_member`, `cancel_invite`, `delete_team`, rattachement des invitations à la confirmation), jamais seulement par l'interface.

**Proxy liveffn** : le contrat se lit dans `club4` (le code de l'ancienne fonction n'est pas dans le dépôt). Le client appelle `GET <proxy>?competition=<id>&structure=39` (délai de 15 s) et reçoit le **texte de la page liveffn** ; toute l'analyse (épreuves, temps, rangs, points, fractionnés) et le rattachement aux nageurs se font **dans l'app** (`parse…` et `matchSwimmersToDB`). Le rattachement se fait par **nom + prénom normalisés** (essai aussi inversé), avec la logique de saison de `club4` (nageur actif ou présent dans la saison, archivés ignorés). Aucun numéro de licence n'est utilisé.
La nouvelle fonction `liveffn-proxy` ne fait que **relayer** la page : JWT obligatoire (l'ancienne était déployée sans vérification, donc ouverte à tous), liste blanche du seul domaine liveffn, id de structure 39 en configuration, en-têtes CORS pour l'appel avec jeton. Le code d'analyse de `club4` est repris tel quel dans `features/perfs/`.

## 7. Modèle de données

Tables de la nouvelle base, d'après l'usage de `club4` : `coaches` (profil, e-mail, `activated_at`), `teams`, `team_members`, `team_invites`, `groups`, `swimmers`, `sessions`, `presence`, `plan_weeks`, `plan_events`, `performances`, plus la table du code du club et un compteur d'essais.

- Identifiants `uuid` créés côté app, avec `updated_at` sur chaque table (voir « Hors ligne »). Les nageurs portent leur logique de saison de `club4` (saison d'arrivée, archivage). Les performances ne dépendent d'aucun numéro de licence : le rattachement se fait par nom. Présence en `upsert` sur `(session_id, swimmer_id)` (l'ancienne app envoyait des opérations par nageur pour éviter les écrasements : à conserver).
- Récupération paginée (limite de 1000 lignes de Supabase).
- Le détail des colonnes se déduit du code de `club4` (référence : `ssephiroth31/Swimcoachpro`, `index.html`, commit `8aaad5c`). Le constructeur propose le schéma exact dans les migrations.
- Aucune donnée n'est reprise de l'ancienne base.

## 8. Fonctions à reprendre (parité avec `club4`)

- Calendrier mensuel, panneau du jour, création/modification/suppression de séances, photo de séance.
- Présences par séance : fenêtre d'appel, jauge « N / M présents », appel de compétition.
- Contacts : liste, fiche (photo, téléphone, e-mail, parent, naissance), groupes, archivage, import Excel (les nageurs archivés sont exclus de l'import), fichier modèle.
- Statistiques et graphique de progression, PDF des statistiques (style Club, cartes arrondies, barres, pastille km).
- Planning hebdomadaire, événements, PDF du planning.
- Performances via liveffn, PDF du bilan individuel.
- Thèmes clair/sombre, design Club (nageur blanc sur bleu, barre de présence qui monte), nom « SwimCoach App ».
- Utilisation hors ligne avec cache local et synchronisation.

En cas de doute sur un comportement, **le code de `club4` fait foi**.

**PDF** : aujourd'hui, ils s'ouvrent dans une fenêtre HTML imprimable. Cela ne marchera pas tel quel dans une app iOS/Android emballée. Le module `pdf/` expose une seule fonction `exportPdf(html, nom)` : sur le web, comportement actuel ; la version native sera branchée plus tard sans toucher aux écrans.

## 9. Préparation aux stores (dans cette phase)

À faire maintenant :
- `capacitor.config.json` avec un identifiant d'app provisoire, icône source 1024 px et écran de démarrage. **Pas de dossiers `ios/` ni `android/`.**
- Suppression du compte, mot de passe oublié, page de confidentialité publique (`privacy.html`, texte en français à valider par le club), compte de démonstration pour les relecteurs et sa procédure de création.
- Fonctionnement hors ligne solide (Apple refuse les simples sites emballés, règle 4.2).
- `docs/store-readiness.md` : la liste de ce qui reste, avec les prérequis ci-dessous.

À la charge de Damien ou du club, plus tard :
- Compte Apple Developer (99 $/an, numéro D-U-N-S si c'est au nom du club) et compte Google Play (25 $ une fois). Un compte Google personnel impose un test fermé de 12 testeurs pendant 14 jours ; un compte organisation non.
- La compilation iOS demande un Mac ou un service de build dans le cloud : impossible depuis cet environnement.
- Choix de l'éditeur (club ou Damien) et de l'identifiant d'application, définitif une fois publié.
- Décision RGPD du club (mentions, durée de conservation).

## 10. Tests et critères d'acceptation

1. **Isolation (automatique)** : deux comptes activés A et B dans deux espaces différents. Avec le jeton de B, toute lecture, insertion, modification ou suppression sur les lignes de l'espace de A échoue, pour chaque table et chaque fichier de stockage, y compris en référençant des lignes de A depuis une ligne de B.
1 bis. **Partage (automatique)** : C est ajouté à l'espace de A. C lit et modifie les données de l'espace, A voit les modifications de C. Une fois C retiré, il ne lit plus rien. Une invitation en attente pour l'adresse de D est rattachée quand D confirme son adresse, et pas avant. Le dernier membre ne peut pas quitter son espace.
2. Un compte non activé ne voit rien et ne peut rien écrire.
3. L'inscription exige le code ; trop d'essais sont refusés.
4. **Même navigateur** : A se déconnecte, B se connecte, aucune trace des données de A (cache, photos, PDF).
5. L'app ne touche à aucune clé de stockage local sans le préfixe `swimcoach2_` et n'appelle jamais l'ancien projet Supabase (contrôle automatique dans la CI).
6. Parité : un test de bout en bout par écran (calendrier, contacts, présences, stats, planning, perfs) et un par PDF.
7. Suppression du compte : l'utilisateur disparaît, ainsi que les espaces dont il était le seul membre (lignes et fichiers). Les espaces partagés restent intacts pour les autres membres.
8. Hors ligne : en mode avion, les données déjà chargées restent consultables et les modifications se synchronisent au retour du réseau.
9. `npm run build` produit un dossier déployable ; la CI (tests unitaires + build) passe avant chaque mise en ligne.
10. Contrôles de sécurité Supabase : aucune alerte non justifiée par écrit.

## 11. Dépendances et décisions côté Damien

À régler avant la première mise en ligne (pas avant d'écrire le code) :
- **Dépôt public ou privé** : public (Pages gratuit, aucun secret dans le code) ou privé avec un autre hébergeur (Cloudflare Pages, Netlify).
- **Projet Supabase** : créé par Damien, `zuguceilohochmpnbzaz` (« SwimmCoachApp's Project », région UE `eu-west-1`, organisation distincte de celle du club). La session le voit et peut y appliquer les migrations et lancer les contrôles de sécurité. Reste à décider : l'offre (gratuite pendant la construction, payante avant de vraies données) et le SMTP.
- **SMTP** : service d'envoi (Brevo, Resend…) et adresse d'expéditeur, idéalement au nom du club.
- **Code d'inscription** initial.
- **Éditeur et identifiant d'application** pour les stores, avant publication seulement.

## 12. Laissé au constructeur

Nom exact des colonnes et index, schéma des politiques et fonctions, choix de la bibliothèque Excel, découpage fin des fichiers, forme du bandeau de mise à jour, remplacement ou non du temps réel, rédaction des textes de la page de confidentialité (à valider par le club), organisation des branches et de la CI.
