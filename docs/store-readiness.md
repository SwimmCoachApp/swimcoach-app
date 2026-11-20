# Préparation aux stores : ce qui reste

Référence : section 9 de la spec `docs/superpowers/specs/2026-11-19-swimcoach-multi-coach-design.md`.
Case cochée : fait dans le dépôt. Case vide : à la charge de Damien ou du club.

## Fait dans le dépôt

- [x] `capacitor.config.json` (identifiant **provisoire** `fr.toacnatation.swimcoach`, nom « SwimCoach App », `webDir` `dist`). Aucun paquet Capacitor installé, pas de dossiers `ios/` ni `android/`.
- [x] Icône source 1024 px : `public/icons/icon-1024.png` ; écran de démarrage : `public/splash.png`. Fabriqués par `node scripts/make-store-assets.mjs` à partir du nageur du thème Club (`src/app/scene.js`).
- [x] Suppression du compte depuis l'application (Réglages, Compte) et mot de passe oublié.
- [x] Page de confidentialité publique `public/privacy.html` (liée depuis la connexion et les Réglages), **version provisoire à valider par le club**.
- [x] Procédure du compte de démonstration : `docs/demo-account.md`.
- [x] Fonctionnement hors ligne : précache du service worker (fichiers de l'application seulement, jamais les réponses Supabase), données locales, file d'envoi (test `tests/e2e/offline.spec.js`).

## À faire par Damien ou le club

Comptes développeur
- [ ] Compte **Apple Developer** : 99 $ par an ; si le compte est au nom du club, numéro **D-U-N-S** à obtenir (délai de plusieurs jours).
- [ ] Compte **Google Play** : 25 $ une fois. Avec un compte Google **personnel**, test fermé obligatoire : **12 testeurs pendant 14 jours** avant la mise en production ; un compte organisation n'y est pas soumis.

Compilation
- [ ] **Build iOS** : demande un Mac (Xcode) ou un service de build dans le cloud ; impossible depuis l'environnement de développement actuel. Ajouter alors les paquets Capacitor et générer `ios/` et `android/` (non fait volontairement).
- [ ] Choix de l'**éditeur** (le club ou Damien) et de l'**identifiant d'application** (bundle id) : **définitif une fois publié**, à confirmer avant le premier envoi (valeur provisoire actuelle : `fr.toacnatation.swimcoach`).

Données et RGPD
- [ ] **Décision RGPD du club** : valider `privacy.html`, fixer la **durée de conservation** (aujourd'hui « à définir par le club ») et renseigner le **contact** (« à compléter par le club »). Les mentions s'appliquent à des données de mineurs.
- [ ] Passer Supabase à l'**offre payante** avant de saisir de vraies données de mineurs (le projet gratuit est réservé à la construction).
- [ ] Vérifier les contrats de sous-traitance (**DPA**) de Supabase et du prestataire SMTP, et les citer dans `privacy.html`.
- [ ] La boîte e-mail du compte de démonstration doit être lisible par le club (confirmation, réinitialisation).
- [ ] **SMTP** : service d'envoi (Brevo, Resend…) avec une adresse d'expéditeur au nom du club, pour les e-mails de confirmation et de réinitialisation.
- [ ] **Code du club** : choisir le code d'inscription initial.
- [ ] Laisser « **Confirm email** » activé dans Supabase (Authentication).

Mise en ligne
- [ ] Activer **GitHub Pages** (source : le workflow de déploiement) si le dépôt reste public.
- [ ] Renseigner dans Supabase (Authentication, URL Configuration) la **Site URL** et les **Redirect URLs** de l'adresse publique, pour les liens de confirmation et de réinitialisation.
- [ ] Créer le compte de démonstration (`docs/demo-account.md`) et le déclarer aux relecteurs.
- [ ] Fiches des stores : captures d'écran, description, URL de `privacy.html` publiée.
