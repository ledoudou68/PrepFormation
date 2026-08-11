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
 * Caches ciblés du tableau de bord. Seules des structures dérivées, petites
 * et relativement stables sont conservées dans CacheService. Les générations
 * opaques sont les seules informations persistées dans Script Properties ;
 * Google Sheets reste systématiquement la source d'autorité.
 */
const CONFIG_CACHES_CIBLES_ACCUEIL_ = Object.freeze({
  cleGenerations: 'PREPFORMATION_ACCUEIL_CACHES_GENERATIONS',
  versionGenerations: 1,
  versionContenu: 1,
  expirationSecondes: 21600,
  tailleMaxJson: 80000,
  familles: Object.freeze({
    FORMATEURS: Object.freeze({
      cleCache: 'PF_ACCUEIL_FORMATEURS_V1',
      feuilles: Object.freeze(['FORMATEURS']),
      lecturesSheets: 1
    }),
    REFERENTIEL: Object.freeze({
      cleCache: 'PF_ACCUEIL_REFERENTIEL_V1',
      feuilles: Object.freeze(['CATEGORIES', 'REFERENTIEL']),
      lecturesSheets: 2
    })
  })
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
 * Retourne l'index compact réellement utilisé par l'Accueil : identifiant du
 * formateur vers son nom complet. La feuille complète n'est jamais stockée.
 */
function obtenirIndexFormateursCacheAccueil_(
  classeur,
  diagnostic
) {
  const resultat = obtenirValeurCacheCibleAccueil_(
    'FORMATEURS',
    diagnostic,
    function () {
      const debutLecture = Date.now();
      const table = lireTableAccueil_(
        classeur,
        'FORMATEURS',
        diagnostic
      );
      return {
        donnees: lireFormateursAccueil_(table),
        dureeLectureSheetsMs: Date.now() - debutLecture
      };
    }
  );

  return clonerIndexFormateursCacheAccueil_(resultat);
}


/**
 * Retourne la structure active nécessaire aux progressions. Dans le cache,
 * les ensembles sont sérialisés sous forme de tableaux d'identifiants ; ils
 * sont recréés en mémoire avant tout calcul métier.
 */
function obtenirReferentielActifCacheAccueil_(
  classeur,
  diagnostic
) {
  const resultat = obtenirValeurCacheCibleAccueil_(
    'REFERENTIEL',
    diagnostic,
    function () {
      const debutLecture = Date.now();
      const categories = lireTableAccueil_(
        classeur,
        'CATEGORIES',
        diagnostic
      );
      const items = lireTableAccueil_(
        classeur,
        'REFERENTIEL',
        diagnostic
      );
      const ensembles = lireItemsActifsParFormationAccueil_(
        categories,
        items
      );
      const serialisable = {};

      Object.keys(ensembles).forEach(function (formation) {
        serialisable[formation] = Array.from(ensembles[formation]);
      });

      return {
        donnees: serialisable,
        dureeLectureSheetsMs: Date.now() - debutLecture
      };
    }
  );
  const ensembles = {};

  Object.keys(resultat || {}).forEach(function (formation) {
    ensembles[formation] = new Set(resultat[formation]);
  });

  return ensembles;
}


function obtenirValeurCacheCibleAccueil_(
  famille,
  diagnostic,
  construireDepuisSheets
) {
  const configuration = obtenirConfigurationCacheCibleAccueil_(famille);
  const debutCache = Date.now();
  const restaurationActive =
    typeof restaurationBloqueEcritures_ === 'function' &&
    restaurationBloqueEcritures_();
  const generationsInitiales = lireGenerationsCachesCiblesAccueil_();
  const generationInitiale = generationsInitiales[famille];

  if (restaurationActive || generationsInitiales.__etatValide !== true) {
    const construction = construireDepuisSheets();
    renseignerDiagnosticCacheCibleAccueil_(diagnostic, {
      cache: famille,
      statut: 'MISS',
      origine: restaurationActive
        ? 'RESTAURATION'
        : 'GENERATIONS_INDISPONIBLES',
      generationCache: '',
      generationSource: generationInitiale,
      dureeCacheMs: Date.now() - debutCache,
      dureeLectureSheetsEviteeMs: 0,
      lecturesSheetsEvitees: 0
    });
    return construction.donnees;
  }

  const lectureInitiale = lireEntreeCacheCibleAccueil_(
    configuration,
    famille,
    generationInitiale
  );
  if (lectureInitiale.valide) {
    renseignerDiagnosticCacheCibleAccueil_(diagnostic, {
      cache: famille,
      statut: 'HIT',
      origine: 'HIT',
      generationCache: lectureInitiale.generationCache,
      generationSource: generationInitiale,
      dureeCacheMs: Date.now() - debutCache,
      dureeLectureSheetsEviteeMs:
        lectureInitiale.dureeLectureSheetsMs,
      lecturesSheetsEvitees: configuration.lecturesSheets
    });
    return lectureInitiale.donnees;
  }

  const verrou = LockService.getDocumentLock();
  const verrouDejaDetenu = typeof verrou.hasLock === 'function' &&
    verrou.hasLock();
  const verrouObtenu = verrouDejaDetenu || verrou.tryLock(15000);

  if (!verrouObtenu) {
    const constructionSansPublication = construireDepuisSheets();
    renseignerDiagnosticCacheCibleAccueil_(diagnostic, {
      cache: famille,
      statut: 'MISS',
      origine: 'VERROU_INDISPONIBLE',
      generationCache: lectureInitiale.generationCache,
      generationSource: generationInitiale,
      dureeCacheMs: Date.now() - debutCache,
      dureeLectureSheetsEviteeMs: 0,
      lecturesSheetsEvitees: 0
    });
    return constructionSansPublication.donnees;
  }

  try {
    // Un autre appel a pu reconstruire le cache pendant l'attente du verrou.
    const generationsVerrouillees =
      lireGenerationsCachesCiblesAccueil_();
    const generationVerrouillee = generationsVerrouillees[famille];
    const lectureApresVerrou =
      generationsVerrouillees.__etatValide === true
        ? lireEntreeCacheCibleAccueil_(
          configuration,
          famille,
          generationVerrouillee
        )
        : creerLectureCacheInvalideAccueil_(
          'GENERATIONS_INDISPONIBLES',
          ''
        );
    const origineReconstruction =
      lectureApresVerrou.origine === 'MISS' &&
      lectureInitiale.origine !== 'MISS'
        ? lectureInitiale.origine
        : lectureApresVerrou.origine;

    if (lectureApresVerrou.valide) {
      renseignerDiagnosticCacheCibleAccueil_(diagnostic, {
        cache: famille,
        statut: 'HIT',
        origine: 'RECONSTRUCTION_CONCURRENTE',
        generationCache: lectureApresVerrou.generationCache,
        generationSource: generationVerrouillee,
        dureeCacheMs: Date.now() - debutCache,
        dureeLectureSheetsEviteeMs:
          lectureApresVerrou.dureeLectureSheetsMs,
        lecturesSheetsEvitees: configuration.lecturesSheets
      });
      return lectureApresVerrou.donnees;
    }

    const construction = construireDepuisSheets();
    const generationsApresConstruction =
      lireGenerationsCachesCiblesAccueil_();
    const generationApres = generationsApresConstruction[famille];
    let publie = false;

    if (
      generationsVerrouillees.__etatValide === true &&
      generationsApresConstruction.__etatValide === true &&
      generationApres === generationVerrouillee
    ) {
      publie = publierEntreeCacheCibleAccueil_(
        configuration,
        famille,
        generationVerrouillee,
        construction
      );
    }

    renseignerDiagnosticCacheCibleAccueil_(diagnostic, {
      cache: famille,
      statut: publie ? 'RECONSTRUIT' : 'MISS',
      origine: generationsApresConstruction.__etatValide !== true ||
        generationsVerrouillees.__etatValide !== true
        ? 'GENERATIONS_INDISPONIBLES'
        : generationApres !== generationVerrouillee
        ? 'GENERATION_MODIFIEE_PENDANT_CONSTRUCTION'
        : origineReconstruction,
      generationCache: publie ? generationVerrouillee : '',
      generationSource: generationApres,
      dureeCacheMs: Date.now() - debutCache,
      dureeLectureSheetsEviteeMs: 0,
      lecturesSheetsEvitees: 0
    });
    return construction.donnees;
  } finally {
    if (!verrouDejaDetenu) {
      verrou.releaseLock();
    }
  }
}


function lireEntreeCacheCibleAccueil_(
  configuration,
  famille,
  generationSource
) {
  let contenu = '';
  try {
    contenu = CacheService
      .getScriptCache()
      .get(configuration.cleCache) || '';
  } catch (erreurLecture) {
    return creerLectureCacheInvalideAccueil_(
      'CACHE_INDISPONIBLE',
      ''
    );
  }

  if (!contenu) {
    return creerLectureCacheInvalideAccueil_('MISS', '');
  }

  let entree;
  try {
    entree = JSON.parse(contenu);
  } catch (erreurJson) {
    supprimerEntreeCacheCibleAccueilSansBloquer_(configuration);
    return creerLectureCacheInvalideAccueil_('CORROMPU', '');
  }

  const generationCache = String(entree && entree.generation || '');
  if (
    !entree ||
    Number(entree.version) !==
      CONFIG_CACHES_CIBLES_ACCUEIL_.versionContenu ||
    String(entree.famille || '') !== famille ||
    !validerDonneesCacheCibleAccueil_(famille, entree.donnees)
  ) {
    supprimerEntreeCacheCibleAccueilSansBloquer_(configuration);
    return creerLectureCacheInvalideAccueil_(
      'CORROMPU',
      generationCache
    );
  }

  if (generationCache !== generationSource) {
    supprimerEntreeCacheCibleAccueilSansBloquer_(configuration);
    return creerLectureCacheInvalideAccueil_(
      'GENERATION_DIFFERENTE',
      generationCache
    );
  }

  return {
    valide: true,
    origine: 'HIT',
    generationCache: generationCache,
    donnees: entree.donnees,
    dureeLectureSheetsMs: Math.max(
      0,
      Number(entree.dureeLectureSheetsMs || 0)
    )
  };
}


function creerLectureCacheInvalideAccueil_(origine, generationCache) {
  return {
    valide: false,
    origine: String(origine || 'MISS'),
    generationCache: String(generationCache || ''),
    donnees: null,
    dureeLectureSheetsMs: 0
  };
}


function publierEntreeCacheCibleAccueil_(
  configuration,
  famille,
  generation,
  construction
) {
  const entree = {
    version: CONFIG_CACHES_CIBLES_ACCUEIL_.versionContenu,
    famille: famille,
    generation: generation,
    dureeLectureSheetsMs: Math.max(
      0,
      Number(construction.dureeLectureSheetsMs || 0)
    ),
    donnees: construction.donnees
  };
  let contenu;

  try {
    contenu = JSON.stringify(entree);
  } catch (erreurSerialisation) {
    return false;
  }

  if (
    !contenu ||
    contenu.length > CONFIG_CACHES_CIBLES_ACCUEIL_.tailleMaxJson
  ) {
    return false;
  }

  try {
    CacheService.getScriptCache().put(
      configuration.cleCache,
      contenu,
      CONFIG_CACHES_CIBLES_ACCUEIL_.expirationSecondes
    );
    return true;
  } catch (erreurPublication) {
    return false;
  }
}


function validerDonneesCacheCibleAccueil_(famille, donnees) {
  if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) {
    return false;
  }

  return Object.keys(donnees).every(function (cle) {
    if (!cle || cle.length > 500) return false;
    if (famille === 'FORMATEURS') {
      return typeof donnees[cle] === 'string';
    }
    return famille === 'REFERENTIEL' &&
      Array.isArray(donnees[cle]) &&
      donnees[cle].every(function (idItem) {
        return typeof idItem === 'string';
      });
  });
}


function clonerIndexFormateursCacheAccueil_(valeur) {
  const resultat = {};
  Object.keys(valeur || {}).forEach(function (idFormateur) {
    resultat[idFormateur] = String(valeur[idFormateur] || '');
  });
  return resultat;
}


function obtenirConfigurationCacheCibleAccueil_(famille) {
  const configuration =
    CONFIG_CACHES_CIBLES_ACCUEIL_.familles[String(famille || '')];
  if (!configuration) {
    throw new Error('Famille de cache Accueil inconnue.');
  }
  return configuration;
}


function lireGenerationsCachesCiblesAccueil_() {
  let contenu = '';
  let valeur = null;
  try {
    contenu = PropertiesService
      .getScriptProperties()
      .getProperty(CONFIG_CACHES_CIBLES_ACCUEIL_.cleGenerations) || '';
    valeur = contenu ? JSON.parse(contenu) : null;
  } catch (erreurLecture) {
    contenu = '__LECTURE_EN_ECHEC__';
    valeur = null;
  }
  const conforme = !contenu || Boolean(valeur &&
    Number(valeur.version) ===
      CONFIG_CACHES_CIBLES_ACCUEIL_.versionGenerations);
  const resultat = { __etatValide: conforme };

  Object.keys(CONFIG_CACHES_CIBLES_ACCUEIL_.familles).forEach(
    function (famille) {
      resultat[famille] = conforme && valeur &&
        typeof valeur[famille] === 'string' &&
        valeur[famille]
        ? valeur[famille]
        : 'GENERATION_INITIALE';
    }
  );
  return resultat;
}


/**
 * Invalidation ciblée après mutation réussie. La génération rend toute
 * ancienne entrée inutilisable, même si CacheService refuse sa suppression.
 */
function invaliderCachesCiblesAccueil_(familles, motif) {
  const demandees = Array.isArray(familles) ? familles : [familles];
  const cibles = Array.from(new Set(demandees.map(function (famille) {
    return String(famille || '').trim().toUpperCase();
  }).filter(function (famille) {
    return Object.prototype.hasOwnProperty.call(
      CONFIG_CACHES_CIBLES_ACCUEIL_.familles,
      famille
    );
  })));

  if (!cibles.length) return {};

  const verrou = LockService.getScriptLock();
  const verrouDejaDetenu = typeof verrou.hasLock === 'function' &&
    verrou.hasLock();
  if (!verrouDejaDetenu && !verrou.tryLock(10000)) {
    throw new Error('Les caches Accueil sont momentanément indisponibles.');
  }

  const nouvellesGenerations = {};
  try {
    const proprietes = PropertiesService.getScriptProperties();
    const generations = lireGenerationsCachesCiblesAccueil_();
    const famillesAActualiser = generations.__etatValide === true
      ? cibles
      : Object.keys(CONFIG_CACHES_CIBLES_ACCUEIL_.familles);
    famillesAActualiser.forEach(function (famille) {
      const generation = 'GEN_' + Utilities.getUuid();
      generations[famille] = generation;
      nouvellesGenerations[famille] = generation;
    });
    proprietes.setProperty(
      CONFIG_CACHES_CIBLES_ACCUEIL_.cleGenerations,
      JSON.stringify({
        version: CONFIG_CACHES_CIBLES_ACCUEIL_.versionGenerations,
        FORMATEURS: generations.FORMATEURS,
        REFERENTIEL: generations.REFERENTIEL
      })
    );
  } finally {
    if (!verrouDejaDetenu) {
      verrou.releaseLock();
    }
  }

  Object.keys(nouvellesGenerations).forEach(function (famille) {
    supprimerEntreeCacheCibleAccueilSansBloquer_(
      CONFIG_CACHES_CIBLES_ACCUEIL_.familles[famille]
    );
  });

  return nouvellesGenerations;
}


function invaliderCacheFormateursAccueil_(motif) {
  return invaliderCachesCiblesAccueil_('FORMATEURS', motif);
}


function invaliderCacheReferentielAccueil_(motif) {
  return invaliderCachesCiblesAccueil_('REFERENTIEL', motif);
}


function invaliderTousCachesCiblesAccueil_(motif) {
  return invaliderCachesCiblesAccueil_(
    ['FORMATEURS', 'REFERENTIEL'],
    motif
  );
}


function supprimerEntreeCacheCibleAccueilSansBloquer_(configuration) {
  try {
    CacheService.getScriptCache().remove(configuration.cleCache);
  } catch (erreurSuppression) {
    // La génération persistante suffit à refuser une ancienne entrée.
  }
}


function renseignerDiagnosticCacheCibleAccueil_(diagnostic, mesure) {
  if (!diagnostic) return;
  if (!Array.isArray(diagnostic.cachesCibles)) {
    diagnostic.cachesCibles = [];
  }
  diagnostic.cachesCibles.push({
    cache: String(mesure.cache || ''),
    statut: String(mesure.statut || 'MISS'),
    origine: String(mesure.origine || 'MISS'),
    generationCache: String(mesure.generationCache || ''),
    generationSource: String(mesure.generationSource || ''),
    dureeCacheMs: Math.max(0, Number(mesure.dureeCacheMs || 0)),
    dureeLectureSheetsEviteeMs: Math.max(
      0,
      Number(mesure.dureeLectureSheetsEviteeMs || 0)
    ),
    lecturesSheetsEvitees: Math.max(
      0,
      Number(mesure.lecturesSheetsEvitees || 0)
    )
  });
  diagnostic.nombreLecturesSheetsEviteesCaches = Number(
    diagnostic.nombreLecturesSheetsEviteesCaches || 0
  ) + Math.max(0, Number(mesure.lecturesSheetsEvitees || 0));
}


/**
 * Les éditions humaines dans les feuilles sources n'empruntent pas les
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
    let invalide = false;
    if (
      CONFIG_FRAICHEUR_STATUTS_ACCUEIL_.feuillesSources.includes(nom)
    ) {
      invaliderGenerationSourcesStatuts_(
        nom,
        'EDITION_DIRECTE_SHEETS'
      );
      invalide = true;
    }
    if (nom === 'FORMATEURS') {
      invaliderCacheFormateursAccueil_('EDITION_DIRECTE_SHEETS');
      invalide = true;
    }
    if (['CATEGORIES', 'REFERENTIEL'].includes(nom)) {
      invaliderCacheReferentielAccueil_('EDITION_DIRECTE_SHEETS');
      invalide = true;
    }
    return invalide;
  } catch (erreur) {
    // Un simple trigger ne doit jamais empêcher l'édition de la cellule.
    return false;
  }
}
