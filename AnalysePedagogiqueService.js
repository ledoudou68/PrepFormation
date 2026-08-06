'use strict';

const DUREE_CACHE_ANALYSE_PEDAGOGIQUE_SECONDES_ = 3 * 60;
const PREFIXE_CACHE_ANALYSE_PEDAGOGIQUE_ =
  'PREPFORMATION_ANALYSE_PEDAGOGIQUE_V1_';
const SEUIL_OUBLI_ANALYSE_PEDAGOGIQUE_JOURS_ = 45;
const SEUIL_CONSOLIDATION_ANALYSE_PEDAGOGIQUE_JOURS_ = 60;
const SEUIL_POINT_FORT_ANALYSE_PEDAGOGIQUE_ = 70;
const NOMBRE_MAX_RECOMMANDATIONS_ANALYSE_PEDAGOGIQUE_ = 10;

const FEUILLES_ANALYSE_PEDAGOGIQUE_ = [
  {
    nom: 'STAGIAIRES',
    colonnes: ['UUID', 'FORMATION']
  },
  {
    nom: 'FORMATIONS',
    colonnes: ['ID_FORMATION', 'LIBELLE']
  },
  {
    nom: 'SESSIONS',
    colonnes: ['ID_SESSION', 'DATE_SESSION']
  },
  {
    nom: 'PRESENCES_STAGIAIRES',
    colonnes: ['ID_SESSION', 'ID_STAGIAIRE']
  },
  {
    nom: 'CATEGORIES',
    colonnes: [
      'ID_CATEGORIE', 'FORMATION', 'CATEGORIE',
      'ORDRE', 'ACTIF'
    ]
  },
  {
    nom: 'REFERENTIEL',
    colonnes: [
      'ID_ITEM', 'FORMATION', 'ID_CATEGORIE', 'ITEM',
      'ORDRE', 'ACTIF'
    ]
  },
  {
    nom: 'ITEMS_SESSIONS',
    colonnes: ['ID_SESSION', 'ID_ITEM']
  },
  {
    nom: 'EVALUATIONS',
    colonnes: ['ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM']
  }
];


/**
 * Point d'entrée public du moteur. Il ne crée ni ne modifie aucune feuille.
 * L'option forcerActualisation permet aux futurs consommateurs de contourner
 * le cache court immédiatement après une mutation réalisée par un autre
 * service.
 */
function getAnalysePedagogiqueStagiaire(uuidStagiaire, options) {
  const uuid = validerUuidAnalysePedagogique_(uuidStagiaire);
  const parametres = options || {};

  if (restaurationBloqueEcritures_()) {
    throw new Error(
      'L’analyse pédagogique est temporairement indisponible pendant la restauration.'
    );
  }

  const cache = CacheService.getScriptCache();
  const cleCache = construireCleCacheAnalysePedagogique_(uuid);

  if (!Boolean(parametres.forcerActualisation)) {
    const contenuCache = cache.get(cleCache);

    if (contenuCache) {
      try {
        const resultatCache = JSON.parse(contenuCache);
        resultatCache.meta.cacheUtilise = true;
        resultatCache.meta.ageCacheSecondes = Math.max(
          0,
          Math.round(
            (Date.now() - Number(resultatCache.meta.calculeAms || 0)) /
            1000
          )
        );
        return resultatCache;
      } catch (erreurCache) {
        cache.remove(cleCache);
      }
    }
  }

  const debutCalcul = Date.now();
  const avertissements = [];
  const tables = lireTablesAnalysePedagogique_(avertissements);
  const resultat = calculerAnalysePedagogiqueDepuisTables_(
    tables,
    uuid,
    new Date(),
    avertissements
  );
  const finCalcul = Date.now();

  resultat.meta = {
    versionFormat: 1,
    versionApplication: obtenirVersionApplication_(),
    calculeA: new Date(finCalcul).toISOString(),
    calculeAms: finCalcul,
    dureeCalculMs: finCalcul - debutCalcul,
    cacheUtilise: false,
    ageCacheSecondes: 0,
    donneesPartielles: resultat.avertissements.length > 0,
    avertissements: resultat.avertissements.slice()
  };

  if (restaurationBloqueEcritures_()) {
    throw new Error(
      'Une restauration a démarré pendant l’analyse. Aucun résultat n’a été conservé.'
    );
  }

  try {
    cache.put(
      cleCache,
      JSON.stringify(resultat),
      DUREE_CACHE_ANALYSE_PEDAGOGIQUE_SECONDES_
    );
  } catch (erreurCache) {
    resultat.meta.avertissements.push(
      'Le cache court n’a pas pu être alimenté ; l’analyse reste valide.'
    );
  }

  return resultat;
}


function construireCleCacheAnalysePedagogique_(uuid) {
  const contenu = JSON.stringify({
    uuid: uuid,
    version: obtenirVersionApplication_()
  });
  const empreinte = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    contenu,
    Utilities.Charset.UTF_8
  );

  return PREFIXE_CACHE_ANALYSE_PEDAGOGIQUE_ +
    Utilities.base64EncodeWebSafe(empreinte).replace(/=+$/g, '');
}


function lireTablesAnalysePedagogique_(avertissements) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tables = {};

  FEUILLES_ANALYSE_PEDAGOGIQUE_.forEach(function (configuration) {
    const feuille = classeur.getSheetByName(configuration.nom);

    if (!feuille || feuille.getLastRow() < 1 || feuille.getLastColumn() < 1) {
      throw new Error(
        'La feuille ' + configuration.nom +
        ' est absente ou non initialisée. Aucune migration automatique n’a été exécutée.'
      );
    }

    const valeurs = feuille.getDataRange().getValues();
    const entetes = valeurs[0] || [];
    const index = creerIndexAnalysePedagogique_(entetes);
    const colonnesManquantes = configuration.colonnes.filter(
      function (colonne) {
        return !Number.isInteger(index[colonne]);
      }
    );

    if (colonnesManquantes.length) {
      throw new Error(
        'La structure de ' + configuration.nom +
        ' est incomplète en lecture seule : ' +
        colonnesManquantes.join(', ') + '.'
      );
    }

    tables[configuration.nom] = {
      nom: configuration.nom,
      entetes: entetes.slice(),
      index: index,
      lignes: valeurs.slice(1)
    };
  });

  return tables;
}


/**
 * Coeur pur et déterministe du moteur. Les tables sont injectables afin que
 * les calculs puissent être testés sans SpreadsheetApp.
 */
function calculerAnalysePedagogiqueDepuisTables_(
  tables,
  uuidStagiaire,
  maintenant,
  avertissementsOptionnels
) {
  const avertissements = avertissementsOptionnels || [];
  const aujourdHui = normaliserDateAnalysePedagogique_(maintenant);

  if (!aujourdHui) {
    throw new Error('Date d’analyse pédagogique invalide.');
  }

  const formations = construireFormationsAnalysePedagogique_(
    tables.FORMATIONS,
    avertissements
  );
  const stagiaire = trouverStagiaireAnalysePedagogique_(
    tables.STAGIAIRES,
    uuidStagiaire,
    formations,
    avertissements
  );
  const sessions = construireSessionsAnalysePedagogique_(
    tables.SESSIONS,
    aujourdHui,
    avertissements
  );
  const idsSessionsStagiaire = construirePresencesAnalysePedagogique_(
    tables.PRESENCES_STAGIAIRES,
    uuidStagiaire,
    sessions.parId,
    avertissements
  );
  const sessionsStagiaire = Array.from(idsSessionsStagiaire)
    .map(function (idSession) {
      return sessions.parId[idSession];
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return comparerDatesAnalysePedagogique_(a.date, b.date) ||
        a.idSession.localeCompare(b.idSession);
    });

  const historique = construireHistoriqueItemsAnalysePedagogique_(
    tables.ITEMS_SESSIONS,
    tables.EVALUATIONS,
    idsSessionsStagiaire,
    sessions.parId,
    uuidStagiaire,
    avertissements
  );
  const categories = construireCategoriesAnalysePedagogique_(
    tables.CATEGORIES,
    formations,
    stagiaire.formationId,
    avertissements
  );
  const referentiel = construireReferentielAnalysePedagogique_(
    tables.REFERENTIEL,
    formations,
    stagiaire.formationId,
    categories,
    avertissements
  );
  const items = construireDetailsItemsAnalysePedagogique_(
    referentiel,
    categories,
    historique,
    sessions.parId,
    aujourdHui,
    avertissements
  );
  const itemsActifs = items.filter(function (item) {
    return item.compteDansAnalyse;
  });
  const itemsJamaisTravailles = itemsActifs.filter(function (item) {
    return item.nombreFoisTravaille === 0;
  });
  const itemsJamaisAcquis = itemsActifs.filter(function (item) {
    return item.nombreFoisAcquis === 0;
  });
  const pointsForts = calculerPointsFortsAnalysePedagogique_(itemsActifs);
  const pointsFaibles = calculerPointsFaiblesAnalysePedagogique_(itemsActifs);
  const itemsOublies = calculerItemsOubliesAnalysePedagogique_(itemsActifs);
  const itemsPrioritaires = calculerItemsPrioritairesAnalysePedagogique_(
    itemsActifs
  );
  const recommandations = construireRecommandationsAnalysePedagogique_(
    itemsPrioritaires
  );
  const premiereSession = sessionsStagiaire.length
    ? sessionsStagiaire[0]
    : null;
  const derniereSession = sessionsStagiaire.length
    ? sessionsStagiaire[sessionsStagiaire.length - 1]
    : null;

  return {
    stagiaire: {
      uuid: uuidStagiaire,
      formationId: stagiaire.formationId,
      formation: stagiaire.formation
    },
    synthese: {
      nombreSeances: sessionsStagiaire.length,
      premiereSeance: premiereSession
        ? convertirDateIsoAnalysePedagogique_(premiereSession.date)
        : '',
      derniereSeance: derniereSession
        ? convertirDateIsoAnalysePedagogique_(derniereSession.date)
        : '',
      joursDepuisDerniereSeance: derniereSession
        ? differenceJoursAnalysePedagogique_(
          aujourdHui,
          derniereSession.date
        )
        : null,
      nombreItemsReferentielActifs: itemsActifs.length,
      nombreItemsTravailles: itemsActifs.filter(function (item) {
        return item.nombreFoisTravaille > 0;
      }).length,
      nombreItemsAcquis: itemsActifs.filter(function (item) {
        return item.nombreFoisAcquis > 0;
      }).length,
      itemsJamaisTravailles: itemsJamaisTravailles.map(
        resumerItemAnalysePedagogique_
      ),
      itemsJamaisAcquis: itemsJamaisAcquis.map(
        resumerItemAnalysePedagogique_
      )
    },
    items: items,
    pointsForts: pointsForts,
    pointsFaibles: pointsFaibles,
    itemsOublies: itemsOublies,
    itemsPrioritaires: itemsPrioritaires,
    recommandationsProchaineSeance: recommandations,
    messageRecommandations: recommandations.length
      ? ''
      : 'Aucune priorité pédagogique significative n’a été détectée.',
    regles: {
      perimetreIndicateurs:
        'Items actifs rattachés à une catégorie active de la formation du stagiaire.',
      seuilOubliJours: SEUIL_OUBLI_ANALYSE_PEDAGOGIQUE_JOURS_,
      seuilConsolidationJours:
        SEUIL_CONSOLIDATION_ANALYSE_PEDAGOGIQUE_JOURS_,
      seuilPointFortPourcentage:
        SEUIL_POINT_FORT_ANALYSE_PEDAGOGIQUE_,
      nombreMaxRecommandations:
        NOMBRE_MAX_RECOMMANDATIONS_ANALYSE_PEDAGOGIQUE_
    },
    sources: {
      nombreLiaisonsItemsSessions:
        historique.nombreLiaisonsItemsSessions,
      nombreLiaisonsEvaluationsHistoriques:
        historique.nombreLiaisonsEvaluationsHistoriques,
      nombreAcquisitionsDistinctes:
        historique.nombreAcquisitionsDistinctes,
      nombreEchecsExplicitesDistincts:
        historique.nombreEchecsDistincts
    },
    avertissements: avertissements.slice(0, 100)
  };
}


function construireFormationsAnalysePedagogique_(table, avertissements) {
  const parId = {};
  const alias = {};

  table.lignes.forEach(function (ligne) {
    const id = valeurAnalysePedagogique_(table, ligne, 'ID_FORMATION');
    const libelle = valeurAnalysePedagogique_(table, ligne, 'LIBELLE');

    if (!id || !libelle) {
      return;
    }
    if (parId[id]) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'ID_FORMATION dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    parId[id] = {
      idFormation: id,
      libelle: libelle
    };
    alias[normaliserAnalysePedagogique_(id)] = id;
    alias[normaliserAnalysePedagogique_(libelle)] = id;
  });

  return {
    parId: parId,
    resoudre: function (valeur) {
      const texte = String(valeur || '').trim();
      return alias[normaliserAnalysePedagogique_(texte)] || texte;
    }
  };
}


function trouverStagiaireAnalysePedagogique_(
  table,
  uuid,
  formations,
  avertissements
) {
  let resultat = null;

  table.lignes.forEach(function (ligne) {
    const id = valeurAnalysePedagogique_(table, ligne, 'UUID');

    if (id !== uuid) {
      return;
    }
    if (resultat) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'UUID stagiaire dupliqué ignoré : ' + uuid + '.'
      );
      return;
    }

    const formationBrute = valeurAnalysePedagogique_(
      table,
      ligne,
      'FORMATION'
    );
    const formationId = formations.resoudre(formationBrute);
    const formation = formations.parId[formationId];

    resultat = {
      uuid: uuid,
      formationId: formationId,
      formation: formation ? formation.libelle : formationBrute
    };

    if (!formation) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'La formation du stagiaire n’est pas reliée à FORMATIONS : ' +
          formationBrute + '.'
      );
    }
  });

  if (!resultat) {
    throw new Error('Stagiaire introuvable.');
  }
  if (!resultat.formationId) {
    throw new Error('La formation du stagiaire est absente.');
  }

  return resultat;
}


function construireSessionsAnalysePedagogique_(
  table,
  aujourdHui,
  avertissements
) {
  const parId = {};

  table.lignes.forEach(function (ligne) {
    const id = valeurAnalysePedagogique_(table, ligne, 'ID_SESSION');

    if (!id) {
      return;
    }
    if (parId[id]) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'ID_SESSION dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    const date = normaliserDateAnalysePedagogique_(
      ligne[table.index.DATE_SESSION]
    );

    if (!date) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'Date de séance inexploitable pour ' + id + '.'
      );
      return;
    }
    if (comparerDatesAnalysePedagogique_(date, aujourdHui) > 0) {
      return;
    }

    parId[id] = {
      idSession: id,
      date: date
    };
  });

  return { parId: parId };
}


function construirePresencesAnalysePedagogique_(
  table,
  uuid,
  sessionsParId,
  avertissements
) {
  const ids = new Set();

  table.lignes.forEach(function (ligne) {
    const idStagiaire = valeurAnalysePedagogique_(
      table,
      ligne,
      'ID_STAGIAIRE'
    );
    const idSession = valeurAnalysePedagogique_(
      table,
      ligne,
      'ID_SESSION'
    );

    if (idStagiaire !== uuid || !idSession) {
      return;
    }
    if (!sessionsParId[idSession]) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'Présence ignorée pour une séance absente, future ou invalide : ' +
          idSession + '.'
      );
      return;
    }
    ids.add(idSession);
  });

  return ids;
}


function construireHistoriqueItemsAnalysePedagogique_(
  tableItemsSessions,
  tableEvaluations,
  idsSessionsStagiaire,
  sessionsParId,
  uuid,
  avertissements
) {
  const sessionsAvecItemsPrincipaux = new Set();
  const travauxParItem = {};
  const acquisParItem = {};
  const echecsParItem = {};
  const evaluationsParPaire = {};
  let nombreLiaisonsItemsSessions = 0;
  let nombreLiaisonsEvaluationsHistoriques = 0;

  function ajouterDansIndex(index, idItem, idSession) {
    index[idItem] = index[idItem] || new Set();
    index[idItem].add(idSession);
  }

  tableItemsSessions.lignes.forEach(function (ligne) {
    const idSession = valeurAnalysePedagogique_(
      tableItemsSessions,
      ligne,
      'ID_SESSION'
    );
    const idItem = valeurAnalysePedagogique_(
      tableItemsSessions,
      ligne,
      'ID_ITEM'
    );

    if (!idSession || !idItem) {
      return;
    }
    sessionsAvecItemsPrincipaux.add(idSession);

    if (!idsSessionsStagiaire.has(idSession)) {
      return;
    }

    const avant = travauxParItem[idItem]
      ? travauxParItem[idItem].size
      : 0;
    ajouterDansIndex(travauxParItem, idItem, idSession);
    if (travauxParItem[idItem].size > avant) {
      nombreLiaisonsItemsSessions++;
    }
  });

  tableEvaluations.lignes.forEach(function (ligne) {
    const idStagiaire = valeurAnalysePedagogique_(
      tableEvaluations,
      ligne,
      'ID_STAGIAIRE'
    );
    const idSession = valeurAnalysePedagogique_(
      tableEvaluations,
      ligne,
      'ID_SESSION'
    );
    const idItem = valeurAnalysePedagogique_(
      tableEvaluations,
      ligne,
      'ID_ITEM'
    );

    if (
      idStagiaire !== uuid ||
      !idSession ||
      !idItem ||
      !idsSessionsStagiaire.has(idSession) ||
      !sessionsParId[idSession]
    ) {
      return;
    }

    const cle = idSession + '::' + idItem;
    evaluationsParPaire[cle] = evaluationsParPaire[cle] || {
      idSession: idSession,
      idItem: idItem,
      acquis: false,
      travail: false,
      echecExplicite: false
    };
    const evaluation = evaluationsParPaire[cle];

    if (evaluationEstAcquiseAnalysePedagogique_(ligne, tableEvaluations.index)) {
      evaluation.acquis = true;
      evaluation.travail = true;
    }
    if (evaluationIndiqueTravailAnalysePedagogique_(
      ligne,
      tableEvaluations.index
    )) {
      evaluation.travail = true;
    }
    if (evaluationEstEchecAnalysePedagogique_(
      ligne,
      tableEvaluations.index
    )) {
      evaluation.echecExplicite = true;
    }
  });

  Object.keys(evaluationsParPaire).forEach(function (cle) {
    const evaluation = evaluationsParPaire[cle];
    const avaitTravail = Boolean(
      travauxParItem[evaluation.idItem] &&
      travauxParItem[evaluation.idItem].has(evaluation.idSession)
    );

    if (
      evaluation.acquis ||
      (
        evaluation.travail &&
        !sessionsAvecItemsPrincipaux.has(evaluation.idSession)
      )
    ) {
      ajouterDansIndex(
        travauxParItem,
        evaluation.idItem,
        evaluation.idSession
      );
      if (!avaitTravail) {
        nombreLiaisonsEvaluationsHistoriques++;
      }
    }

    const estTravaille = Boolean(
      travauxParItem[evaluation.idItem] &&
      travauxParItem[evaluation.idItem].has(evaluation.idSession)
    );

    if (evaluation.acquis) {
      ajouterDansIndex(
        acquisParItem,
        evaluation.idItem,
        evaluation.idSession
      );
    } else if (evaluation.echecExplicite && estTravaille) {
      ajouterDansIndex(
        echecsParItem,
        evaluation.idItem,
        evaluation.idSession
      );
    }
  });

  const nombreAcquisitionsDistinctes = compterValeursIndexAnalysePedagogique_(
    acquisParItem
  );
  const nombreEchecsDistincts = compterValeursIndexAnalysePedagogique_(
    echecsParItem
  );

  if (nombreLiaisonsEvaluationsHistoriques) {
    ajouterAvertissementAnalysePedagogique_(
      avertissements,
      'Des liaisons historiques ont été reconstituées depuis EVALUATIONS.'
    );
  }

  return {
    travauxParItem: travauxParItem,
    acquisParItem: acquisParItem,
    echecsParItem: echecsParItem,
    nombreLiaisonsItemsSessions: nombreLiaisonsItemsSessions,
    nombreLiaisonsEvaluationsHistoriques:
      nombreLiaisonsEvaluationsHistoriques,
    nombreAcquisitionsDistinctes: nombreAcquisitionsDistinctes,
    nombreEchecsDistincts: nombreEchecsDistincts
  };
}


function construireCategoriesAnalysePedagogique_(
  table,
  formations,
  formationStagiaire,
  avertissements
) {
  const parId = {};

  table.lignes.forEach(function (ligne, position) {
    const id = valeurAnalysePedagogique_(table, ligne, 'ID_CATEGORIE');

    if (!id) {
      return;
    }
    if (parId[id]) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'ID_CATEGORIE dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    const formationId = formations.resoudre(
      valeurAnalysePedagogique_(table, ligne, 'FORMATION')
    );
    parId[id] = {
      idCategorie: id,
      formationId: formationId,
      intitule: valeurAnalysePedagogique_(
        table,
        ligne,
        'CATEGORIE'
      ) || id,
      ordre: convertirNombreAnalysePedagogique_(
        ligne[table.index.ORDRE],
        position + 1
      ),
      actif: convertirBooleenAnalysePedagogique_(
        ligne[table.index.ACTIF]
      ),
      appartientFormation: formationId === formationStagiaire
    };
  });

  return { parId: parId };
}


function construireReferentielAnalysePedagogique_(
  table,
  formations,
  formationStagiaire,
  categories,
  avertissements
) {
  const parId = {};
  const liste = [];

  table.lignes.forEach(function (ligne, position) {
    const id = valeurAnalysePedagogique_(table, ligne, 'ID_ITEM');

    if (!id) {
      return;
    }
    if (parId[id]) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'ID_ITEM dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    const formationId = formations.resoudre(
      valeurAnalysePedagogique_(table, ligne, 'FORMATION')
    );
    const idCategorie = valeurAnalysePedagogique_(
      table,
      ligne,
      'ID_CATEGORIE'
    );
    const categorie = categories.parId[idCategorie];
    const appartientFormation = formationId === formationStagiaire;
    const item = {
      idItem: id,
      formationId: formationId,
      idCategorie: idCategorie,
      intitule: valeurAnalysePedagogique_(table, ligne, 'ITEM') || id,
      ordre: convertirNombreAnalysePedagogique_(
        ligne[table.index.ORDRE],
        position + 1
      ),
      ordreCategorie: categorie
        ? categorie.ordre
        : Number.MAX_SAFE_INTEGER,
      categorie: categorie
        ? categorie.intitule
        : 'Catégorie historique',
      actif: convertirBooleenAnalysePedagogique_(
        ligne[table.index.ACTIF]
      ),
      categorieActive: Boolean(
        categorie && categorie.actif && categorie.appartientFormation
      ),
      appartientFormation: appartientFormation
    };

    parId[id] = item;
    liste.push(item);
  });

  return { parId: parId, liste: liste };
}


function construireDetailsItemsAnalysePedagogique_(
  referentiel,
  categories,
  historique,
  sessionsParId,
  aujourdHui,
  avertissements
) {
  const ids = new Set();

  referentiel.liste.forEach(function (item) {
    if (item.appartientFormation) {
      ids.add(item.idItem);
    }
  });
  [
    historique.travauxParItem,
    historique.acquisParItem,
    historique.echecsParItem
  ].forEach(function (index) {
    Object.keys(index).forEach(function (idItem) {
      ids.add(idItem);
    });
  });

  const items = Array.from(ids).map(function (idItem) {
    const reference = referentiel.parId[idItem] || {
      idItem: idItem,
      idCategorie: '',
      intitule: 'Item historique (' + idItem + ')',
      ordre: Number.MAX_SAFE_INTEGER,
      ordreCategorie: Number.MAX_SAFE_INTEGER,
      categorie: 'Catégorie historique',
      actif: false,
      categorieActive: false,
      appartientFormation: false
    };
    const travaux = historique.travauxParItem[idItem] || new Set();
    const acquis = historique.acquisParItem[idItem] || new Set();
    const echecs = historique.echecsParItem[idItem] || new Set();
    let derniereDate = null;

    travaux.forEach(function (idSession) {
      const session = sessionsParId[idSession];
      if (
        session &&
        (!derniereDate ||
          comparerDatesAnalysePedagogique_(session.date, derniereDate) > 0)
      ) {
        derniereDate = session.date;
      }
    });

    if (!referentiel.parId[idItem]) {
      ajouterAvertissementAnalysePedagogique_(
        avertissements,
        'Item historique absent du REFERENTIEL : ' + idItem + '.'
      );
    }

    const nombreFoisTravaille = travaux.size;
    const nombreFoisAcquis = acquis.size;
    const joursDepuisDernierTravail = derniereDate
      ? differenceJoursAnalysePedagogique_(aujourdHui, derniereDate)
      : null;
    const compteDansAnalyse = Boolean(
      reference.appartientFormation &&
      reference.actif &&
      reference.categorieActive
    );
    const item = {
      idItem: idItem,
      intitule: reference.intitule,
      idCategorie: reference.idCategorie,
      categorie: reference.categorie,
      ordreCategorie: reference.ordreCategorie,
      ordre: reference.ordre,
      actif: reference.actif,
      categorieActive: reference.categorieActive,
      historique: !compteDansAnalyse,
      compteDansAnalyse: compteDansAnalyse,
      nombreFoisTravaille: nombreFoisTravaille,
      nombreFoisAcquis: nombreFoisAcquis,
      nombreEchecsExplicites: echecs.size,
      tauxAcquisition: nombreFoisTravaille
        ? arrondirAnalysePedagogique_(
          nombreFoisAcquis / nombreFoisTravaille * 100,
          1
        )
        : null,
      derniereDateTravail: derniereDate
        ? convertirDateIsoAnalysePedagogique_(derniereDate)
        : '',
      joursDepuisDernierTravail: joursDepuisDernierTravail,
      statut: nombreFoisAcquis
        ? 'ACQUIS'
        : nombreFoisTravaille
          ? 'TRAVAILLE_NON_ACQUIS'
          : 'JAMAIS_TRAVAILLE'
    };
    const score = calculerScorePrioriteAnalysePedagogique_(item);

    item.scorePriorite = compteDansAnalyse ? score.total : 0;
    item.composantesScorePriorite = compteDansAnalyse
      ? score.composantes
      : {
        acquisition: 0,
        anciennete: 0,
        frequence: 0,
        echecs: 0,
        jamaisTravaille: 0
      };
    return item;
  });

  return items.sort(comparerOrdreItemsAnalysePedagogique_);
}


function calculerScorePrioriteAnalysePedagogique_(item) {
  let acquisition = 0;
  let anciennete = 0;
  let frequence = 0;
  let echecs = 0;
  let jamaisTravaille = 0;

  if (!item.nombreFoisAcquis) {
    acquisition = 25;
  } else if (item.tauxAcquisition < 50) {
    acquisition = 15;
  } else if (item.tauxAcquisition < 75) {
    acquisition = 8;
  }

  if (item.joursDepuisDernierTravail === null) {
    anciennete = 25;
  } else {
    anciennete = Math.min(
      25,
      Math.floor(item.joursDepuisDernierTravail / 15) * 5
    );
  }

  if (!item.nombreFoisTravaille) {
    frequence = 15;
    jamaisTravaille = 10;
  } else if (item.nombreFoisTravaille === 1) {
    frequence = 10;
  } else if (item.nombreFoisTravaille === 2) {
    frequence = 5;
  }

  echecs = Math.min(25, item.nombreEchecsExplicites * 8);

  return {
    total: Math.min(
      100,
      acquisition + anciennete + frequence + echecs + jamaisTravaille
    ),
    composantes: {
      acquisition: acquisition,
      anciennete: anciennete,
      frequence: frequence,
      echecs: echecs,
      jamaisTravaille: jamaisTravaille
    }
  };
}


function calculerPointsFortsAnalysePedagogique_(items) {
  return items.filter(function (item) {
    return item.nombreFoisAcquis > 0 &&
      item.tauxAcquisition >= SEUIL_POINT_FORT_ANALYSE_PEDAGOGIQUE_ &&
      item.nombreEchecsExplicites <= 1;
  }).sort(function (a, b) {
    return b.tauxAcquisition - a.tauxAcquisition ||
      b.nombreFoisAcquis - a.nombreFoisAcquis ||
      comparerAncienneteItemsAnalysePedagogique_(a, b) ||
      comparerOrdreItemsAnalysePedagogique_(a, b);
  }).map(resumerItemAnalysePedagogique_);
}


function calculerPointsFaiblesAnalysePedagogique_(items) {
  return items.filter(function (item) {
    return item.nombreFoisTravaille >= 2 && (
      !item.nombreFoisAcquis ||
      item.tauxAcquisition < 50 ||
      item.nombreEchecsExplicites >= 2
    );
  }).sort(function (a, b) {
    return b.scorePriorite - a.scorePriorite ||
      b.nombreEchecsExplicites - a.nombreEchecsExplicites ||
      (a.tauxAcquisition || 0) - (b.tauxAcquisition || 0) ||
      comparerOrdreItemsAnalysePedagogique_(a, b);
  }).map(function (item) {
    const resume = resumerItemAnalysePedagogique_(item);
    const motifs = [];

    if (!item.nombreFoisAcquis) {
      motifs.push('Aucune acquisition validée');
    }
    if (item.nombreEchecsExplicites >= 2) {
      motifs.push(
        item.nombreEchecsExplicites +
        ' échecs explicites distincts'
      );
    }
    if (
      item.tauxAcquisition !== null &&
      item.tauxAcquisition < 50
    ) {
      motifs.push(
        'Taux d’acquisition inférieur à 50 %'
      );
    }

    resume.motifsClassement = motifs;
    resume.motifClassement = motifs.join(' · ');
    return resume;
  });
}


function calculerItemsOubliesAnalysePedagogique_(items) {
  return items.filter(function (item) {
    return item.nombreFoisTravaille === 0 ||
      item.joursDepuisDernierTravail >=
        SEUIL_OUBLI_ANALYSE_PEDAGOGIQUE_JOURS_;
  }).sort(function (a, b) {
    if (!a.nombreFoisTravaille && b.nombreFoisTravaille) {
      return -1;
    }
    if (a.nombreFoisTravaille && !b.nombreFoisTravaille) {
      return 1;
    }
    return (b.joursDepuisDernierTravail || 0) -
      (a.joursDepuisDernierTravail || 0) ||
      comparerOrdreItemsAnalysePedagogique_(a, b);
  }).map(resumerItemAnalysePedagogique_);
}


function calculerItemsPrioritairesAnalysePedagogique_(items) {
  return items.filter(function (item) {
    return !item.nombreFoisAcquis ||
      item.nombreEchecsExplicites >= 2 ||
      item.joursDepuisDernierTravail >=
        SEUIL_CONSOLIDATION_ANALYSE_PEDAGOGIQUE_JOURS_ ||
      (
        item.tauxAcquisition !== null &&
        item.tauxAcquisition < 50
      );
  }).sort(function (a, b) {
    return b.scorePriorite - a.scorePriorite ||
      comparerOrdreItemsAnalysePedagogique_(a, b);
  }).map(resumerItemAnalysePedagogique_);
}


function construireRecommandationsAnalysePedagogique_(itemsPrioritaires) {
  return itemsPrioritaires
    .slice(0, NOMBRE_MAX_RECOMMANDATIONS_ANALYSE_PEDAGOGIQUE_)
    .map(function (item, position) {
      const motifs = [];

      if (!item.nombreFoisTravaille) {
        motifs.push('Item jamais travaillé');
      }
      if (!item.nombreFoisAcquis) {
        motifs.push('Aucune acquisition validée');
      }
      if (item.nombreEchecsExplicites) {
        motifs.push(
          item.nombreEchecsExplicites +
          ' échec(s) explicite(s) distinct(s)'
        );
      }
      if (
        item.joursDepuisDernierTravail !== null &&
        item.joursDepuisDernierTravail >=
          SEUIL_OUBLI_ANALYSE_PEDAGOGIQUE_JOURS_
      ) {
        motifs.push(
          'Dernier travail il y a ' +
          item.joursDepuisDernierTravail + ' jours'
        );
      }
      if (
        item.nombreFoisTravaille > 0 &&
        item.nombreFoisTravaille <= 2
      ) {
        motifs.push(
          'Faible fréquence de travail : ' +
          item.nombreFoisTravaille + ' séance(s)'
        );
      }
      if (
        item.tauxAcquisition !== null &&
        item.tauxAcquisition < 50
      ) {
        motifs.push(
          'Taux d’acquisition limité à ' +
          item.tauxAcquisition + ' %'
        );
      }

      return {
        rang: position + 1,
        idItem: item.idItem,
        intitule: item.intitule,
        categorie: item.categorie,
        scorePriorite: item.scorePriorite,
        niveauPriorite: item.scorePriorite >= 70
          ? 'CRITIQUE'
          : item.scorePriorite >= 50
            ? 'ELEVEE'
            : 'MODEREE',
        motifs: motifs,
        motif: motifs.join(' · ')
      };
    });
}


function resumerItemAnalysePedagogique_(item) {
  return {
    idItem: item.idItem,
    intitule: item.intitule,
    idCategorie: item.idCategorie,
    categorie: item.categorie,
    ordreCategorie: item.ordreCategorie,
    ordre: item.ordre,
    nombreFoisTravaille: item.nombreFoisTravaille,
    nombreFoisAcquis: item.nombreFoisAcquis,
    nombreEchecsExplicites: item.nombreEchecsExplicites,
    tauxAcquisition: item.tauxAcquisition,
    derniereDateTravail: item.derniereDateTravail,
    joursDepuisDernierTravail: item.joursDepuisDernierTravail,
    statut: item.statut,
    scorePriorite: item.scorePriorite,
    composantesScorePriorite: Object.assign(
      {},
      item.composantesScorePriorite
    )
  };
}


function evaluationIndiqueTravailAnalysePedagogique_(ligne, index) {
  if (evaluationEstAcquiseAnalysePedagogique_(ligne, index)) {
    return true;
  }

  if (Number.isInteger(index.VU)) {
    const valeurVu = ligne[index.VU];
    if (
      valeurVu !== '' &&
      valeurVu !== null &&
      valeurVu !== undefined
    ) {
      return convertirBooleenAnalysePedagogique_(valeurVu);
    }
  }

  if (Number.isInteger(index.NIVEAU)) {
    return Boolean(String(ligne[index.NIVEAU] || '').trim());
  }

  return Number.isInteger(index.REMARQUE) && Boolean(
    String(ligne[index.REMARQUE] || '').trim()
  );
}


function evaluationEstAcquiseAnalysePedagogique_(ligne, index) {
  if (
    Number.isInteger(index.ACQUIS) &&
    convertirBooleenAnalysePedagogique_(ligne[index.ACQUIS])
  ) {
    return true;
  }

  return Number.isInteger(index.NIVEAU) &&
    normaliserAnalysePedagogique_(ligne[index.NIVEAU]) === 'ACQUIS';
}


function evaluationEstEchecAnalysePedagogique_(ligne, index) {
  if (evaluationEstAcquiseAnalysePedagogique_(ligne, index)) {
    return false;
  }
  if (!Number.isInteger(index.NIVEAU)) {
    return false;
  }

  return [
    'NON_ACQUIS',
    'ECHEC',
    'A_REVOIR'
  ].includes(normaliserAnalysePedagogique_(ligne[index.NIVEAU]));
}


function compterValeursIndexAnalysePedagogique_(index) {
  return Object.keys(index).reduce(function (total, cle) {
    return total + index[cle].size;
  }, 0);
}


function comparerOrdreItemsAnalysePedagogique_(a, b) {
  return a.ordreCategorie - b.ordreCategorie ||
    a.ordre - b.ordre ||
    a.intitule.localeCompare(
      b.intitule,
      'fr',
      { sensitivity: 'base' }
    );
}


function comparerAncienneteItemsAnalysePedagogique_(a, b) {
  if (a.joursDepuisDernierTravail === null) {
    return 1;
  }
  if (b.joursDepuisDernierTravail === null) {
    return -1;
  }
  return a.joursDepuisDernierTravail - b.joursDepuisDernierTravail;
}


function valeurAnalysePedagogique_(table, ligne, colonne) {
  const position = table.index[colonne];
  if (!Number.isInteger(position)) {
    return '';
  }
  const valeur = ligne[position];
  return valeur === null || valeur === undefined
    ? ''
    : String(valeur).trim();
}


function creerIndexAnalysePedagogique_(entetes) {
  const index = {};
  (entetes || []).forEach(function (entete, position) {
    index[normaliserAnalysePedagogique_(entete)] = position;
  });
  return index;
}


function normaliserAnalysePedagogique_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function convertirBooleenAnalysePedagogique_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }
  return [
    '1', 'TRUE', 'VRAI', 'OUI', 'YES', 'ACTIF', 'VU', 'ACQUIS'
  ].includes(normaliserAnalysePedagogique_(valeur));
}


function convertirNombreAnalysePedagogique_(valeur, valeurParDefaut) {
  const nombre = typeof valeur === 'number'
    ? valeur
    : Number(String(valeur || '').trim().replace(',', '.'));

  return isNaN(nombre) ? valeurParDefaut : nombre;
}


function validerUuidAnalysePedagogique_(valeur) {
  const uuid = String(valeur || '').trim();
  if (!uuid) {
    throw new Error('Identifiant du stagiaire manquant.');
  }
  if (uuid.length > 200 || /[\u0000-\u001F]/.test(uuid)) {
    throw new Error('Identifiant du stagiaire invalide.');
  }
  return uuid;
}


function normaliserDateAnalysePedagogique_(valeur) {
  if (!valeur) {
    return null;
  }

  if (Object.prototype.toString.call(valeur) === '[object Date]') {
    if (isNaN(valeur.getTime())) {
      return null;
    }
    return new Date(
      valeur.getFullYear(),
      valeur.getMonth(),
      valeur.getDate(),
      12
    );
  }

  const correspondance = /^(\d{4})-(\d{2})-(\d{2})/.exec(
    String(valeur).trim()
  );
  if (!correspondance) {
    const date = new Date(valeur);
    return isNaN(date.getTime())
      ? null
      : new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        12
      );
  }

  const date = new Date(
    Number(correspondance[1]),
    Number(correspondance[2]) - 1,
    Number(correspondance[3]),
    12
  );
  if (
    date.getFullYear() !== Number(correspondance[1]) ||
    date.getMonth() !== Number(correspondance[2]) - 1 ||
    date.getDate() !== Number(correspondance[3])
  ) {
    return null;
  }
  return date;
}


function convertirDateIsoAnalysePedagogique_(date) {
  return String(date.getFullYear()).padStart(4, '0') + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}


function comparerDatesAnalysePedagogique_(a, b) {
  return cleDateAnalysePedagogique_(a) - cleDateAnalysePedagogique_(b);
}


function cleDateAnalysePedagogique_(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}


function differenceJoursAnalysePedagogique_(fin, debut) {
  return Math.round(
    (cleDateAnalysePedagogique_(fin) -
      cleDateAnalysePedagogique_(debut)) /
    86400000
  );
}


function arrondirAnalysePedagogique_(valeur, decimales) {
  const facteur = Math.pow(10, Number(decimales || 0));
  return Math.round((Number(valeur) || 0) * facteur) / facteur;
}


function ajouterAvertissementAnalysePedagogique_(liste, message) {
  if (!liste.includes(message) && liste.length < 100) {
    liste.push(message);
  }
}
