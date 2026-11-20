# Compte de démonstration pour les relecteurs des stores

Apple et Google demandent un compte utilisable sans intervention du club. Le compte de démonstration
est un compte ordinaire, créé dans l'application ; il vit dans son propre espace, rempli de données
fictives (aucun nageur réel, aucune donnée de mineur).

## Création

1. **Inscription** : sur l'écran de connexion, « Créer un compte » avec une adresse dédiée
   (par exemple `demo-stores@<domaine du club>`, boîte lue par le club) et un mot de passe d'au moins
   10 caractères, propre à ce compte. Confirmer l'adresse par le lien reçu par e-mail
   (« Confirm email » reste activé : le relecteur n'a rien à confirmer, le compte l'est déjà).
2. **Code du club** : à l'écran « Active ton compte », saisir le code d'inscription du club.
3. **Espace** : « Crée ton espace » avec le nom « Démo SwimCoach ». Les groupes par défaut sont créés.
4. **Jeu de données fictif** : ajouter à la main, ou par import (Nageurs, « Importer ») un fichier
   fictif (le modèle `tests/fixtures/nageurs.csv` convient : noms et e-mails en `example.org`) :
   - 5 à 8 nageurs fictifs répartis dans 2 groupes, sans photo ;
   - 3 séances sur la semaine en cours (une avec un texte, des kilomètres) ;
   - une feuille de présence pour l'une d'elles ;
   - un événement au planning et une performance fictive.
   Ne jamais saisir de nom, d'e-mail ou de photo de vrais nageurs.
5. **Fiche à remettre aux stores** (champ « notes pour le relecteur ») : l'adresse, le mot de passe,
   et la phrase « Le compte est déjà activé ; l'application fonctionne aussi sans réseau ».

## Suppression

À faire après la validation des stores, ou en cas de doute sur le mot de passe :

1. Se connecter avec le compte de démonstration.
2. Réglages, Compte, « Supprimer mon compte ». Le compte et l'espace « Démo SwimCoach » (dont il est
   le seul membre) disparaissent, avec leurs données et leurs photos.
3. Vérifier côté Supabase qu'il ne reste ni ligne `coaches` ni espace à ce nom.

Pour un nouveau tour de relecture, recréer le compte avec un nouveau mot de passe.
