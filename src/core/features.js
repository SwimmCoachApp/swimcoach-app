/**
 * Fonctions de l'app activables. Une fonction désactivée garde son code et ses données
 * (tables, synchro, tests) : elle n'apparaît simplement plus à l'écran.
 */

/** Surcharge posée avant le chargement de la page, réservée aux tests e2e (fonctions masquées gardées testées). */
const override = /** @type {{groups?: boolean}} */ (globalThis.__SWIMCOACH_FEATURES__ ?? {});

export const FEATURES = {
  /**
   * Groupes de nageurs (club4) : étiquette sur le nageur, « Mail groupe », colonne Groupe de l'import,
   * groupes par défaut. Masqués : l'espace (« Mon groupe » à l'écran) fait déjà ce tri.
   * Passer à true pour les réafficher.
   */
  groups: override.groups ?? false,
};
