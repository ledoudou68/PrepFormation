'use strict';

/**
 * Contrat de fraîcheur des statuts utilisés par l'Accueil.
 *
 * Il ne s'agit pas d'un cache de données : seules une génération opaque et
 * la preuve de la dernière synchronisation réussie sont conservées. Les
 * matrices métier restent lues dans Google Sheets par les services existants.
 */
const CONFIG_FRAICHEUR_STATUTS_ACCUEIL_ = Object.freeze({
  feuillesSources: Object.freeze([
    'STAGIAIRES',
    'SESSIONS',
    'PRESENCES_STAGIAIRES'
  ]),
  cleEtat: 'PREPFORMATION_STATUTS_ACCUEIL_ETAT',
  versionEtat: 1,
  versionMarqueur: 1
});


/**
 * Point d'entrée privé réservé au chargement de l'Accueil. Deux appels
 * concurrents relisent le marqueur sous DocumentLock : un seul effectue la
 * synchronisation, l'autre réutilise ensuite sa preuve de fraîcheur.
 */
function synchroniserStatutsStagiairesAccueilSiNecessaire_(diagnostic) {
  const etatInitial = lireEtatFraicheurStatutsAccueil_();
  const decisionInitiale = determinerSynchronisationStatutsAccueil_(
    etatInitial
  );

  if (decisionInitiale.motif === 'FRAICHE') {
    renseignerDiagnosticFraicheurStatutsAccueil_(
      diagnostic,
      'SAUTEE',
      decisionInitiale,
      etatInitial,
      0
    );
    return construireResultatSynchronisationSauteeAccueil_();
  }

  // Pendant une restauration, la synchronisation historique sait déjà se
  // suspendre sans tenter d'écriture. Ne pas attendre le verrou détenu par le
  // moteur de restauration préserve ce contrat et évite un blocage de 30 s.
  if (decisionInitiale.restaurationActive) {
    const debutSuspendu = Date.now();
    const resultatSuspendu = synchroniserStatutsStagiaires_(
      diagnostic,
      true
    );
    renseignerDiagnosticFraicheurStatutsAccueil_(
      diagnostic,
      'EXECUTEE',
      decisionInitiale,
      etatInitial,
      Date.now() - debutSuspendu
    );
    return resultatSuspendu;
  }

  const verrou = LockService.getDocumentLock();
  const verrouDejaDetenu = verrou.hasLock();

  if (!verrouDejaDetenu && !verrou.tryLock(30000)) {
    throw new Error(
      'Une autre opération est en cours. Réessaie dans quelques instants.'
    );
  }

  try {
    const etatVerrouille = lireEtatFraicheurStatutsAccueil_();
    const decisionVerrouillee = determinerSynchronisationStatutsAccueil_(
      etatVerrouille
    );

    if (decisionVerrouillee.motif === 'FRAICHE') {
      renseignerDiagnosticFraicheurStatutsAccueil_(
        diagnostic,
        'SAUTEE',
        decisionVerrouillee,
        etatVerrouille,
        0
      );
      return construireResultatSynchronisationSauteeAccueil_();
    }

    const debutSynchronisation = Date.now();
    let resultat;

    try {
      resultat = synchroniserStatutsStagiaires_(diagnostic, true);
    } catch (erreur) {
      enregistrerEchecSynchronisationStatutsAccueil_(etatVerrouille);
      renseignerDiagnosticFraicheurStatutsAccueil_(
        diagnostic,
        'EXECUTEE',
        decisionVerrouillee,
        lireEtatFraicheurStatutsAccueil_(),
        Date.now() - debutSynchronisation
      );
      throw erreur;
    }

    const dureeReelle = Date.now() - debutSynchronisation;

    if (
      resultat &&
      resultat.suspenduPendantRestauration === true
    ) {
      renseignerDiagnosticFraicheurStatutsAccueil_(
        diagnostic,
        'EXECUTEE',
        {
          motif: 'RESTAURATION',
          restaurationActive: true
        },
        lireEtatFraicheurStatutsAccueil_(),
        dureeReelle
      );
      return resultat;
    }

    const etatApres = lireEtatFraicheurStatutsAccueil_();
    if (
      etatApres.generationCourante ===
      etatVerrouille.generationCourante
    ) {
      enregistrerSuccesSynchronisationStatutsAccueil_(
        etatApres.generationCourante,
        etatApres.jourCourant
      );
    } else {
      // Une édition directe a invalidé les sources pendant la lecture. Le
      // résultat courant reste utilisable, mais il ne devient pas une preuve
      // de fraîcheur pour le prochain chargement.
      enregistrerEchecSynchronisationStatutsAccueil_(etatVerrouille);
    }

    renseignerDiagnosticFraicheurStatutsAccueil_(
      diagnostic,
      'EXECUTEE',
      decisionVerrouillee,
      lireEtatFraicheurStatutsAccueil_(),
      dureeReelle
    );
    return resultat;
  } finally {
    if (!verrouDejaDetenu) {
      verrou.releaseLock();
    }
  }
}


function construireResultatSynchronisationSauteeAccueil_() {
  return {
    migres: 0,
    automatiquesMisAJour: 0,
    synchronisationSautee: true,
    instantanesAccueil: {}
  };
}


function lireEtatFraicheurStatutsAccueil_() {
  const etatPersistant = normaliserEtatPersistantStatutsAccueil_(
    lireJsonFraicheurStatutsAccueil_(
      PropertiesService
        .getScriptProperties()
        .getProperty(CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.cleEtat)
    )
  );

  return {
    jourCourant: obtenirJourCourantStatutsAccueil_(),
    generationCourante: etatPersistant.generationCourante,
    derniereInvalidation: etatPersistant.derniereInvalidation,
    marqueur: etatPersistant.marqueur
  };
}


function determinerSynchronisationStatutsAccueil_(etat) {
  const restaurationActive = restaurationBloqueEcritures_();
  if (restaurationActive) {
    return {
      motif: 'RESTAURATION',
      restaurationActive: true
    };
  }

  if (!etat.marqueur) {
    return { motif: 'MARQUEUR_ABSENT', restaurationActive: false };
  }
  if (etat.marqueur.succesDerniereSynchronisation !== true) {
    return { motif: 'ECHEC_PRECEDENT', restaurationActive: false };
  }
  if (etat.marqueur.jourSynchronise !== etat.jourCourant) {
    return { motif: 'JOUR_CHANGE', restaurationActive: false };
  }
  if (
    etat.marqueur.generationSources !== etat.generationCourante
  ) {
    const motifInvalidation = String(
      etat.derniereInvalidation &&
      etat.derniereInvalidation.motif || ''
    );
    return {
      motif: [
        'RESTAURATION',
        'ROLLBACK_RESTAURATION'
      ].includes(motifInvalidation)
        ? 'RESTAURATION'
        : 'GENERATION_CHANGE',
      restaurationActive: false
    };
  }

  return { motif: 'FRAICHE', restaurationActive: false };
}


function enregistrerSuccesSynchronisationStatutsAccueil_(
  generation,
  jour
) {
  return modifierEtatPersistantStatutsAccueil_(function (etat) {
    if (etat.generationCourante !== String(generation || '')) {
      return false;
    }
    etat.marqueur = {
      version: CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.versionMarqueur,
      jourSynchronise: String(jour || ''),
      generationSources: String(generation || ''),
      succesDerniereSynchronisation: true,
      dateSynchronisation: new Date().toISOString()
    };
    return true;
  });
}


function enregistrerEchecSynchronisationStatutsAccueil_(etatAvant) {
  return modifierEtatPersistantStatutsAccueil_(function (etat) {
    const ancien = etat.marqueur ||
      etatAvant && etatAvant.marqueur || {};
    etat.marqueur = {
      version: CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.versionMarqueur,
      jourSynchronise: String(ancien.jourSynchronise || ''),
      generationSources: String(ancien.generationSources || ''),
      succesDerniereSynchronisation: false,
      dateDernierEchec: new Date().toISOString()
    };
    return true;
  });
}


/**
 * Invalide la preuve de fraîcheur après une mutation réussie d'au moins une
 * source. La nouvelle génération est opaque : aucun contenu métier n'est
 * stocké dans Script Properties.
 */
function invaliderGenerationSourcesStatuts_(sources, motif) {
  const liste = Array.isArray(sources) ? sources : [sources];
  const concerneStatuts = liste.some(function (source) {
    return CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.feuillesSources.includes(
      String(source || '').trim()
    );
  });

  if (!concerneStatuts) return '';

  const generation = 'GEN_' + Utilities.getUuid();
  modifierEtatPersistantStatutsAccueil_(function (etat) {
    etat.generationCourante = generation;
    etat.derniereInvalidation = {
      generation: generation,
      motif: normaliserMotifInvalidationStatutsAccueil_(motif),
      date: new Date().toISOString()
    };
    return true;
  });
  return generation;
}


function modifierEtatPersistantStatutsAccueil_(modification) {
  const verrou = LockService.getScriptLock();
  const verrouDejaDetenu = typeof verrou.hasLock === 'function' &&
    verrou.hasLock();
  if (!verrouDejaDetenu && !verrou.tryLock(10000)) {
    throw new Error(
      'Le marqueur de fraîcheur est momentanément indisponible.'
    );
  }

  try {
    const proprietes = PropertiesService.getScriptProperties();
    const etat = normaliserEtatPersistantStatutsAccueil_(
      lireJsonFraicheurStatutsAccueil_(
        proprietes.getProperty(
          CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.cleEtat
        )
      )
    );
    const resultat = modification(etat);
    proprietes.setProperty(
      CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.cleEtat,
      JSON.stringify(etat)
    );
    return resultat;
  } finally {
    if (!verrouDejaDetenu) {
      verrou.releaseLock();
    }
  }
}


function normaliserEtatPersistantStatutsAccueil_(valeur) {
  const valide = valeur &&
    Number(valeur.version) ===
      CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.versionEtat;
  const generation = valide
    ? String(valeur.generationCourante || 'GENERATION_INITIALE')
    : 'GENERATION_INITIALE';
  const derniereInvalidation = valide &&
    valeur.derniereInvalidation &&
    typeof valeur.derniereInvalidation === 'object'
    ? {
      generation: String(
        valeur.derniereInvalidation.generation || ''
      ),
      motif: normaliserMotifInvalidationStatutsAccueil_(
        valeur.derniereInvalidation.motif
      ),
      date: String(valeur.derniereInvalidation.date || '')
    }
    : null;

  return {
    version: CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.versionEtat,
    generationCourante: generation,
    derniereInvalidation: derniereInvalidation,
    marqueur: valide
      ? normaliserMarqueurSynchronisationStatutsAccueil_(
        valeur.marqueur
      )
      : null
  };
}


function normaliserMotifInvalidationStatutsAccueil_(motif) {
  const valeur = String(motif || 'MUTATION_SOURCE')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 80);
  return valeur || 'MUTATION_SOURCE';
}


function normaliserMarqueurSynchronisationStatutsAccueil_(valeur) {
  if (
    !valeur ||
    Number(valeur.version) !==
      CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.versionMarqueur ||
    typeof valeur.jourSynchronise !== 'string' ||
    typeof valeur.generationSources !== 'string' ||
    typeof valeur.succesDerniereSynchronisation !== 'boolean'
  ) {
    return null;
  }
  return {
    version: CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.versionMarqueur,
    jourSynchronise: valeur.jourSynchronise,
    generationSources: valeur.generationSources,
    succesDerniereSynchronisation:
      valeur.succesDerniereSynchronisation
  };
}


function lireJsonFraicheurStatutsAccueil_(valeur) {
  if (!valeur) return null;
  try {
    return JSON.parse(valeur);
  } catch (erreur) {
    return null;
  }
}


function obtenirJourCourantStatutsAccueil_() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
}


function renseignerDiagnosticFraicheurStatutsAccueil_(
  diagnostic,
  statut,
  decision,
  etat,
  dureeReelle
) {
  if (!diagnostic) return;
  const marqueur = etat && etat.marqueur || null;
  diagnostic.statutSynchronisation = statut === 'SAUTEE'
    ? 'SAUTEE'
    : 'EXECUTEE';
  diagnostic.motifSynchronisation = String(
    decision && decision.motif || 'MARQUEUR_ABSENT'
  );
  diagnostic.generationCourante = String(
    etat && etat.generationCourante || ''
  );
  diagnostic.generationSynchronisee = String(
    marqueur && marqueur.generationSources || ''
  );
  diagnostic.jourCourant = String(
    etat && etat.jourCourant || obtenirJourCourantStatutsAccueil_()
  );
  diagnostic.jourSynchronise = String(
    marqueur && marqueur.jourSynchronise || ''
  );
  diagnostic.dureeSynchronisationReelleMs = Math.max(
    0,
    Number(dureeReelle || 0)
  );
}


/**
 * Les éditions humaines dans les trois feuilles sources n'empruntent pas les
 * services métier. Le simple trigger couvre ces éditions. Les écritures Apps
 * Script n'activent pas onEdit et conservent donc leurs invalidations
 * explicites dans les services concernés.
 */
function onEdit(e) {
  try {
    const plage = e && e.range;
    const feuille = plage && plage.getSheet
      ? plage.getSheet()
      : null;
    const nom = feuille && feuille.getName
      ? String(feuille.getName() || '')
      : '';
    if (
      !CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.feuillesSources.includes(nom)
    ) {
      return false;
    }
    invaliderGenerationSourcesStatuts_(nom, 'EDITION_DIRECTE_SHEETS');
    return true;
  } catch (erreur) {
    // Un simple trigger ne doit jamais empêcher l'édition de la cellule.
    return false;
  }
}
