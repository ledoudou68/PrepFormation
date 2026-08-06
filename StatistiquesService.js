'use strict';

const DUREE_CACHE_STATISTIQUES_SECONDES_ = 5 * 60;
const CLE_GENERATION_CACHE_STATISTIQUES_ =
  'PREPFORMATION_STATS_CACHE_GENERATION';
const PREFIXE_CACHE_STATISTIQUES_ = 'PREPFORMATION_STATS_V1_';

const FEUILLES_STATISTIQUES_ = [
  {
    nom: 'FORMATIONS',
    colonnes: ['ID_FORMATION', 'LIBELLE', 'ORDRE', 'ACTIF']
  },
  {
    nom: 'FORMATEURS',
    colonnes: ['ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF']
  },
  {
    nom: 'STAGIAIRES',
    colonnes: [
      'UUID', 'FORMATION', 'STATUT', 'DATE_CLOTURE'
    ]
  },
  {
    nom: 'SESSIONS',
    colonnes: [
      'ID_SESSION', 'DATE_SESSION', 'FORMATION'
    ]
  },
  {
    nom: 'PRESENCES_STAGIAIRES',
    colonnes: ['ID_SESSION', 'ID_STAGIAIRE']
  },
  {
    nom: 'PRESTATIONS_FORMATEURS',
    colonnes: [
      'ID_PRESTATION', 'ID_SESSION', 'ID_FORMATEUR',
      'DUREE_HEURES'
    ]
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
    colonnes: [
      'ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM',
      'NIVEAU', 'REMARQUE', 'VU'
    ]
  }
];


/**
 * Point d'entrée unique du module. Il ne crée aucune feuille et ne modifie
 * aucune donnée métier. Le jeton sert uniquement à renouveler, si elle
 * existe, la session administrateur ; les formateurs ont le même accès aux
 * agrégats non sensibles.
 */
function getDonneesStatistiques(filtres, jetonAdministrateur) {
  getSessionUtilisateur(jetonAdministrateur);

  if (restaurationBloqueEcritures_()) {
    throw new Error(
      'Les statistiques sont temporairement indisponibles pendant la restauration.'
    );
  }

  const maintenant = new Date();
  const filtresResolus = resoudreFiltresStatistiques_(
    filtres || {},
    maintenant
  );
  const forcerActualisation = Boolean(
    filtres && filtres.forcerActualisation
  );
  const cache = CacheService.getScriptCache();
  const generation = PropertiesService
    .getScriptProperties()
    .getProperty(CLE_GENERATION_CACHE_STATISTIQUES_) || 'initiale';
  const cleCache = construireCleCacheStatistiques_(
    filtresResolus,
    generation
  );

  if (!forcerActualisation) {
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
  const tables = lireTablesStatistiques_(avertissements);
  const resultat = calculerStatistiquesDepuisTables_(
    tables,
    filtresResolus,
    maintenant,
    avertissements
  );
  const finCalcul = Date.now();

  resultat.meta = {
    versionFormatRapport: 1,
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
      'Une restauration a démarré pendant le calcul. Aucun résultat statistique n’a été conservé.'
    );
  }

  try {
    cache.put(
      cleCache,
      JSON.stringify(resultat),
      DUREE_CACHE_STATISTIQUES_SECONDES_
    );
  } catch (erreurMiseEnCache) {
    resultat.meta.avertissements.push(
      'Le cache court n’a pas pu être alimenté ; les résultats restent valides.'
    );
  }

  return resultat;
}


/**
 * Appel privé prévu pour la restauration et les futures mutations majeures.
 * Changer la génération rend immédiatement inaccessibles les anciennes clés.
 */
function invaliderCacheStatistiques_() {
  PropertiesService
    .getScriptProperties()
    .setProperty(
      CLE_GENERATION_CACHE_STATISTIQUES_,
      Utilities.getUuid()
    );
}


function construireCleCacheStatistiques_(filtres, generation) {
  const contenu = JSON.stringify({
    version: obtenirVersionApplication_(),
    generation: String(generation || ''),
    periode: filtres.periode,
    dateDebut: convertirDateIsoStatistiques_(filtres.dateDebut),
    dateFin: convertirDateIsoStatistiques_(filtres.dateFin),
    formationId: filtres.formationId,
    formateurId: filtres.formateurId,
    inclureFormateursSansActivite:
      filtres.inclureFormateursSansActivite,
    inclureItemsInactifs: filtres.inclureItemsInactifs
  });
  const empreinte = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    contenu,
    Utilities.Charset.UTF_8
  );

  return PREFIXE_CACHE_STATISTIQUES_ +
    Utilities.base64EncodeWebSafe(empreinte).replace(/=+$/g, '');
}


function lireTablesStatistiques_(avertissements) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tables = {};

  FEUILLES_STATISTIQUES_.forEach(function (configuration) {
    const feuille = classeur.getSheetByName(configuration.nom);

    if (!feuille || feuille.getLastRow() < 1 || feuille.getLastColumn() < 1) {
      throw new Error(
        'La feuille ' + configuration.nom +
        ' est absente ou non initialisée. Les statistiques restent en lecture seule.'
      );
    }

    const valeurs = feuille.getDataRange().getValues();
    const entetes = valeurs[0] || [];
    const index = creerIndexStatistiques_(entetes);
    const manquantes = configuration.colonnes.filter(function (colonne) {
      return !Number.isInteger(index[colonne]);
    });

    if (manquantes.length) {
      throw new Error(
        'La structure de ' + configuration.nom +
        ' est incomplète en lecture seule : ' + manquantes.join(', ') + '.'
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


function calculerStatistiquesDepuisTables_(
  tables,
  filtres,
  maintenant,
  avertissementsOptionnels
) {
  const avertissements = avertissementsOptionnels || [];
  const aujourdHui = normaliserDateStatistiques_(maintenant) || new Date();
  const contexteFormations = construireFormationsStatistiques_(
    tables.FORMATIONS,
    avertissements
  );
  const contexteFormateurs = construireFormateursStatistiques_(
    tables.FORMATEURS,
    avertissements
  );
  const sessions = construireSessionsStatistiques_(
    tables.SESSIONS,
    contexteFormations,
    avertissements
  );
  const presences = construirePresencesStatistiques_(
    tables.PRESENCES_STAGIAIRES,
    sessions.parId,
    avertissements
  );
  const prestations = construirePrestationsStatistiques_(
    tables.PRESTATIONS_FORMATEURS,
    sessions.parId,
    avertissements
  );

  prestations.liste.forEach(function (prestation) {
    if (!contexteFormateurs.parId[prestation.idFormateur]) {
      contexteFormateurs.parId[prestation.idFormateur] = {
        idFormateur: prestation.idFormateur,
        nom: 'Formateur non identifié',
        prenom: '',
        nomComplet: 'Formateur non identifié (' +
          prestation.idFormateur + ')',
        actif: false,
        ordre: Number.MAX_SAFE_INTEGER
      };
      contexteFormateurs.options.push(
        contexteFormateurs.parId[prestation.idFormateur]
      );
      ajouterAvertissementStatistiques_(
        avertissements,
        'Une prestation référence un formateur absent : ' +
          prestation.idFormateur + '.'
      );
    }
  });

  const dateDebut = filtres.dateDebut;
  const dateFinDemandee = filtres.dateFin;
  const dateFinEffective = comparerDatesStatistiques_(
    dateFinDemandee,
    aujourdHui
  ) > 0
    ? aujourdHui
    : dateFinDemandee;
  const periodeEffectiveValide = comparerDatesStatistiques_(
    dateDebut,
    dateFinEffective
  ) <= 0;
  const dureeJours = periodeEffectiveValide
    ? differenceJoursStatistiques_(dateFinEffective, dateDebut) + 1
    : 0;
  const dateFinPrecedente = ajouterJoursStatistiques_(dateDebut, -1);
  const dateDebutPrecedente = dureeJours
    ? ajouterJoursStatistiques_(dateFinPrecedente, -(dureeJours - 1))
    : null;

  function sessionRespecteFiltres(session, debut, fin) {
    if (
      !session ||
      !session.date ||
      comparerDatesStatistiques_(session.date, aujourdHui) > 0 ||
      !debut ||
      !fin ||
      comparerDatesStatistiques_(session.date, debut) < 0 ||
      comparerDatesStatistiques_(session.date, fin) > 0
    ) {
      return false;
    }

    if (
      filtres.formationId &&
      session.formationId !== filtres.formationId
    ) {
      return false;
    }

    if (
      filtres.formateurId &&
      !prestations.formateursParSession[session.idSession]?.has(
        filtres.formateurId
      )
    ) {
      return false;
    }

    return true;
  }

  const sessionsPeriode = sessions.liste.filter(function (session) {
    return periodeEffectiveValide && sessionRespecteFiltres(
      session,
      dateDebut,
      dateFinEffective
    );
  });
  const sessionsPrecedentes = dureeJours
    ? sessions.liste.filter(function (session) {
      return sessionRespecteFiltres(
        session,
        dateDebutPrecedente,
        dateFinPrecedente
      );
    })
    : [];
  const idsSessionsPeriode = new Set(sessionsPeriode.map(function (session) {
    return session.idSession;
  }));
  const idsSessionsPrecedentes = new Set(
    sessionsPrecedentes.map(function (session) {
      return session.idSession;
    })
  );

  const presencesPeriode = presences.liste.filter(function (presence) {
    return idsSessionsPeriode.has(presence.idSession);
  });
  const idsStagiairesAccompagnes = new Set(
    presencesPeriode.map(function (presence) {
      return presence.idStagiaire;
    })
  );
  const prestationsPeriode = prestations.liste.filter(function (prestation) {
    return idsSessionsPeriode.has(prestation.idSession) && (
      !filtres.formateurId ||
      prestation.idFormateur === filtres.formateurId
    );
  });
  const prestationsPrecedentes = prestations.liste.filter(
    function (prestation) {
      return idsSessionsPrecedentes.has(prestation.idSession) && (
        !filtres.formateurId ||
        prestation.idFormateur === filtres.formateurId
      );
    }
  );

  const volumeHeures = arrondirStatistiques_(
    prestationsPeriode.reduce(function (total, prestation) {
      return total + prestation.dureeHeures;
    }, 0),
    2
  );
  const volumeHeuresPrecedent = arrondirStatistiques_(
    prestationsPrecedentes.reduce(function (total, prestation) {
      return total + prestation.dureeHeures;
    }, 0),
    2
  );
  const preparationsCloturees = compterPreparationsClotureesStatistiques_(
    tables.STAGIAIRES,
    contexteFormations,
    filtres,
    dateDebut,
    dateFinEffective,
    idsStagiairesAccompagnes,
    avertissements
  );
  const intervalles = calculerIntervallesStatistiques_(
    presencesPeriode,
    sessions.parId
  );
  const statistiquesFormateurs = calculerFormateursStatistiques_(
    contexteFormateurs,
    prestationsPeriode,
    idsSessionsPeriode,
    sessions.parId,
    presences.stagiairesParSession,
    filtres
  );
  const evolution = construireEvolutionMensuelleStatistiques_(
    dateDebut,
    dateFinEffective,
    sessionsPeriode,
    prestationsPeriode
  );
  const statistiquesItems = calculerItemsStatistiques_(
    tables,
    sessionsPeriode,
    idsSessionsPeriode,
    contexteFormations,
    filtres,
    avertissements
  );
  const evolutionFma = calculerEvolutionPourcentageStatistiques_(
    sessionsPeriode.length,
    sessionsPrecedentes.length
  );

  return {
    filtres: {
      periode: filtres.periode,
      dateDebut: convertirDateIsoStatistiques_(dateDebut),
      dateFin: convertirDateIsoStatistiques_(dateFinDemandee),
      dateFinEffective: periodeEffectiveValide
        ? convertirDateIsoStatistiques_(dateFinEffective)
        : '',
      formationId: filtres.formationId,
      formateurId: filtres.formateurId,
      inclureFormateursSansActivite:
        filtres.inclureFormateursSansActivite,
      inclureItemsInactifs: filtres.inclureItemsInactifs
    },
    options: {
      formations: contexteFormations.options.map(function (formation) {
        return {
          idFormation: formation.idFormation,
          libelle: formation.libelle,
          actif: formation.actif
        };
      }),
      formateurs: contexteFormateurs.options
        .slice()
        .sort(comparerFormateursStatistiques_)
        .map(function (formateur) {
          return {
            idFormateur: formateur.idFormateur,
            nomComplet: formateur.nomComplet,
            actif: formateur.actif
          };
        })
    },
    indicateurs: {
      fmaRealisees: {
        valeur: sessionsPeriode.length,
        periodePrecedente: sessionsPrecedentes.length,
        evolutionPourcentage: evolutionFma.pourcentage,
        evolutionCalculable: evolutionFma.calculable
      },
      stagiairesAccompagnes: idsStagiairesAccompagnes.size,
      preparationsCloturees: preparationsCloturees,
      volumeHoraireFormateurs: volumeHeures,
      volumeHorairePrecedent: volumeHeuresPrecedent,
      tempsEntreSeances: intervalles
    },
    formateurs: statistiquesFormateurs,
    evolutionMensuelle: evolution,
    items: statistiquesItems,
    avertissements: avertissements.slice(0, 100),
    rapport: {
      type: 'STATISTIQUES_PREPFORMATION',
      version: 1,
      periode: {
        debut: convertirDateIsoStatistiques_(dateDebut),
        fin: periodeEffectiveValide
          ? convertirDateIsoStatistiques_(dateFinEffective)
          : ''
      }
    }
  };
}


function resoudreFiltresStatistiques_(filtres, maintenant) {
  const aujourdHui = normaliserDateStatistiques_(maintenant);
  const periode = String(
    filtres.periode || 'ANNEE_EN_COURS'
  ).trim().toUpperCase();
  let dateDebut;
  let dateFin;

  if (periode === 'MOIS_EN_COURS') {
    dateDebut = new Date(
      aujourdHui.getFullYear(),
      aujourdHui.getMonth(),
      1,
      12
    );
    dateFin = new Date(
      aujourdHui.getFullYear(),
      aujourdHui.getMonth() + 1,
      0,
      12
    );
  } else if (periode === 'DOUZE_DERNIERS_MOIS') {
    dateDebut = new Date(
      aujourdHui.getFullYear(),
      aujourdHui.getMonth() - 11,
      1,
      12
    );
    dateFin = aujourdHui;
  } else if (periode === 'ANNEE_PRECEDENTE') {
    dateDebut = new Date(aujourdHui.getFullYear() - 1, 0, 1, 12);
    dateFin = new Date(aujourdHui.getFullYear() - 1, 11, 31, 12);
  } else if (periode === 'PERSONNALISEE') {
    dateDebut = normaliserDateStatistiques_(filtres.dateDebut);
    dateFin = normaliserDateStatistiques_(filtres.dateFin);

    if (!dateDebut || !dateFin) {
      throw new Error(
        'La date de début et la date de fin sont obligatoires pour une période personnalisée.'
      );
    }
  } else {
    dateDebut = new Date(aujourdHui.getFullYear(), 0, 1, 12);
    dateFin = new Date(aujourdHui.getFullYear(), 11, 31, 12);
  }

  if (comparerDatesStatistiques_(dateDebut, dateFin) > 0) {
    throw new Error('La date de début doit précéder la date de fin.');
  }

  return {
    periode: [
      'MOIS_EN_COURS',
      'ANNEE_EN_COURS',
      'DOUZE_DERNIERS_MOIS',
      'ANNEE_PRECEDENTE',
      'PERSONNALISEE'
    ].includes(periode)
      ? periode
      : 'ANNEE_EN_COURS',
    dateDebut: dateDebut,
    dateFin: dateFin,
    formationId: nettoyerIdentifiantFiltreStatistiques_(
      filtres.formationId
    ),
    formateurId: nettoyerIdentifiantFiltreStatistiques_(
      filtres.formateurId
    ),
    inclureFormateursSansActivite:
      convertirBooleenStatistiques_(
        filtres.inclureFormateursSansActivite
      ),
    inclureItemsInactifs: convertirBooleenStatistiques_(
      filtres.inclureItemsInactifs
    )
  };
}


function construireFormationsStatistiques_(table, avertissements) {
  const parId = {};
  const alias = {};
  const options = [];

  table.lignes.forEach(function (ligne, position) {
    const id = valeurStatistiques_(table, ligne, 'ID_FORMATION');
    const libelle = valeurStatistiques_(table, ligne, 'LIBELLE');

    if (!id || !libelle) {
      return;
    }

    if (parId[id]) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'ID_FORMATION dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    const formation = {
      idFormation: id,
      libelle: libelle,
      ordre: convertirNombreStatistiques_(
        ligne[table.index.ORDRE]
      ) || position + 1,
      actif: convertirBooleenStatistiques_(
        ligne[table.index.ACTIF]
      )
    };
    parId[id] = formation;
    alias[normaliserStatistiques_(id)] = id;
    alias[normaliserStatistiques_(libelle)] = id;
    options.push(formation);
  });

  options.sort(function (a, b) {
    return a.ordre - b.ordre || a.libelle.localeCompare(
      b.libelle,
      'fr',
      { sensitivity: 'base' }
    );
  });

  return {
    parId: parId,
    alias: alias,
    options: options,
    resoudre: function (valeur) {
      return alias[normaliserStatistiques_(valeur)] || '';
    }
  };
}


function construireFormateursStatistiques_(table, avertissements) {
  const parId = {};
  const options = [];

  table.lignes.forEach(function (ligne, position) {
    const id = valeurStatistiques_(table, ligne, 'ID_FORMATEUR');

    if (!id) {
      return;
    }

    if (parId[id]) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'ID_FORMATEUR dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    const nom = valeurStatistiques_(table, ligne, 'NOM');
    const prenom = valeurStatistiques_(table, ligne, 'PRENOM');
    const formateur = {
      idFormateur: id,
      nom: nom,
      prenom: prenom,
      nomComplet: [prenom, nom].filter(Boolean).join(' ') || id,
      actif: convertirBooleenStatistiques_(ligne[table.index.ACTIF]),
      ordre: position
    };
    parId[id] = formateur;
    options.push(formateur);
  });

  return { parId: parId, options: options };
}


function construireSessionsStatistiques_(
  table,
  contexteFormations,
  avertissements
) {
  const parId = {};
  const liste = [];

  table.lignes.forEach(function (ligne) {
    const id = valeurStatistiques_(table, ligne, 'ID_SESSION');

    if (!id) {
      return;
    }

    if (parId[id]) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'ID_SESSION dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    const date = normaliserDateStatistiques_(
      ligne[table.index.DATE_SESSION]
    );
    const formationBrute = valeurStatistiques_(
      table,
      ligne,
      'FORMATION'
    );
    const formationId = contexteFormations.resoudre(formationBrute);

    if (!date) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'Date de séance inexploitable pour ' + id + '.'
      );
    }

    if (formationBrute && !formationId) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'Formation non reliée à FORMATIONS pour la séance ' + id + '.'
      );
    }

    const session = {
      idSession: id,
      date: date,
      formationId: formationId,
      formation: formationBrute
    };
    parId[id] = session;
    liste.push(session);
  });

  return { parId: parId, liste: liste };
}


function construirePresencesStatistiques_(
  table,
  sessionsParId,
  avertissements
) {
  const liste = [];
  const cles = new Set();
  const stagiairesParSession = {};

  table.lignes.forEach(function (ligne) {
    const idSession = valeurStatistiques_(table, ligne, 'ID_SESSION');
    const idStagiaire = valeurStatistiques_(table, ligne, 'ID_STAGIAIRE');

    if (!idSession || !idStagiaire) {
      return;
    }

    if (!sessionsParId[idSession]) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'Présence orpheline ignorée pour la séance ' + idSession + '.'
      );
      return;
    }

    const cle = idSession + '::' + idStagiaire;
    if (cles.has(cle)) {
      return;
    }
    cles.add(cle);
    liste.push({
      idSession: idSession,
      idStagiaire: idStagiaire
    });
    stagiairesParSession[idSession] =
      stagiairesParSession[idSession] || new Set();
    stagiairesParSession[idSession].add(idStagiaire);
  });

  return {
    liste: liste,
    stagiairesParSession: stagiairesParSession
  };
}


function construirePrestationsStatistiques_(
  table,
  sessionsParId,
  avertissements
) {
  const liste = [];
  const ids = new Set();
  const formateursParSession = {};

  table.lignes.forEach(function (ligne) {
    const id = valeurStatistiques_(table, ligne, 'ID_PRESTATION');
    const idSession = valeurStatistiques_(table, ligne, 'ID_SESSION');
    const idFormateur = valeurStatistiques_(table, ligne, 'ID_FORMATEUR');

    if (!id || !idSession || !idFormateur) {
      return;
    }

    if (ids.has(id)) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'ID_PRESTATION dupliqué ignoré : ' + id + '.'
      );
      return;
    }
    ids.add(id);

    if (!sessionsParId[idSession]) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'Prestation orpheline ignorée pour la séance ' + idSession + '.'
      );
      return;
    }

    liste.push({
      idPrestation: id,
      idSession: idSession,
      idFormateur: idFormateur,
      dureeHeures: convertirNombreStatistiques_(
        ligne[table.index.DUREE_HEURES]
      )
    });
    formateursParSession[idSession] =
      formateursParSession[idSession] || new Set();
    formateursParSession[idSession].add(idFormateur);
  });

  return {
    liste: liste,
    formateursParSession: formateursParSession
  };
}


function compterPreparationsClotureesStatistiques_(
  table,
  contexteFormations,
  filtres,
  dateDebut,
  dateFin,
  stagiairesAccompagnes,
  avertissements
) {
  if (!dateFin || comparerDatesStatistiques_(dateDebut, dateFin) > 0) {
    return 0;
  }

  const ids = new Set();
  const idsVus = new Set();

  table.lignes.forEach(function (ligne) {
    const id = valeurStatistiques_(table, ligne, 'UUID');
    const statut = normaliserStatistiques_(
      ligne[table.index.STATUT]
    );
    const dateCloture = normaliserDateStatistiques_(
      ligne[table.index.DATE_CLOTURE]
    );

    if (!id) {
      return;
    }

    if (idsVus.has(id)) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'UUID stagiaire dupliqué ignoré : ' + id + '.'
      );
      return;
    }
    idsVus.add(id);

    if (statut !== 'CLOTURE' || !dateCloture) {
      return;
    }

    const formationId = contexteFormations.resoudre(
      ligne[table.index.FORMATION]
    );

    if (
      comparerDatesStatistiques_(dateCloture, dateDebut) < 0 ||
      comparerDatesStatistiques_(dateCloture, dateFin) > 0 ||
      (filtres.formationId && formationId !== filtres.formationId) ||
      (filtres.formateurId && !stagiairesAccompagnes.has(id))
    ) {
      return;
    }

    ids.add(id);
  });

  return ids.size;
}


function calculerIntervallesStatistiques_(presences, sessionsParId) {
  const sessionsParStagiaire = {};

  presences.forEach(function (presence) {
    const session = sessionsParId[presence.idSession];
    if (!session || !session.date) {
      return;
    }
    sessionsParStagiaire[presence.idStagiaire] =
      sessionsParStagiaire[presence.idStagiaire] || {};
    sessionsParStagiaire[presence.idStagiaire][presence.idSession] =
      session.date;
  });

  const intervalles = [];

  Object.keys(sessionsParStagiaire).forEach(function (idStagiaire) {
    const dates = Object.keys(sessionsParStagiaire[idStagiaire])
      .map(function (idSession) {
        return sessionsParStagiaire[idStagiaire][idSession];
      })
      .sort(comparerDatesStatistiques_);

    for (let index = 1; index < dates.length; index++) {
      intervalles.push(
        differenceJoursStatistiques_(dates[index], dates[index - 1])
      );
    }
  });

  if (!intervalles.length) {
    return {
      calculable: false,
      moyenneJours: null,
      medianeJours: null,
      nombreIntervalles: 0,
      message: 'Au moins un stagiaire doit avoir deux séances réalisées sur la période.'
    };
  }

  const tries = intervalles.slice().sort(function (a, b) {
    return a - b;
  });
  const milieu = Math.floor(tries.length / 2);
  const mediane = tries.length % 2
    ? tries[milieu]
    : (tries[milieu - 1] + tries[milieu]) / 2;

  return {
    calculable: true,
    moyenneJours: arrondirStatistiques_(
      intervalles.reduce(function (total, valeur) {
        return total + valeur;
      }, 0) / intervalles.length,
      1
    ),
    medianeJours: arrondirStatistiques_(mediane, 1),
    nombreIntervalles: intervalles.length,
    message: ''
  };
}


function calculerFormateursStatistiques_(
  contexte,
  prestations,
  idsSessions,
  sessionsParId,
  stagiairesParSession,
  filtres
) {
  const agregats = {};

  prestations.forEach(function (prestation) {
    const id = prestation.idFormateur;
    agregats[id] = agregats[id] || {
      idFormateur: id,
      sessions: new Set(),
      heures: 0,
      stagiaires: new Set(),
      derniereDate: null
    };
    const agregat = agregats[id];
    const session = sessionsParId[prestation.idSession];
    agregat.sessions.add(prestation.idSession);
    agregat.heures += prestation.dureeHeures;

    (stagiairesParSession[prestation.idSession] || new Set())
      .forEach(function (idStagiaire) {
        agregat.stagiaires.add(idStagiaire);
      });

    if (
      session && session.date &&
      (!agregat.derniereDate ||
        comparerDatesStatistiques_(session.date, agregat.derniereDate) > 0)
    ) {
      agregat.derniereDate = session.date;
    }
  });

  if (
    filtres.inclureFormateursSansActivite &&
    !filtres.formateurId
  ) {
    contexte.options.forEach(function (formateur) {
      agregats[formateur.idFormateur] =
        agregats[formateur.idFormateur] || {
          idFormateur: formateur.idFormateur,
          sessions: new Set(),
          heures: 0,
          stagiaires: new Set(),
          derniereDate: null
        };
    });
  }

  const lignes = Object.keys(agregats).map(function (id) {
    const agregat = agregats[id];
    const formateur = contexte.parId[id] || {
      nom: 'Formateur non identifié',
      prenom: '',
      nomComplet: 'Formateur non identifié (' + id + ')'
    };
    let totalStagiairesSeances = 0;
    agregat.sessions.forEach(function (idSession) {
      totalStagiairesSeances += (
        stagiairesParSession[idSession] || new Set()
      ).size;
    });

    return {
      idFormateur: id,
      nom: formateur.nom,
      prenom: formateur.prenom,
      nomComplet: formateur.nomComplet,
      nombreSeances: agregat.sessions.size,
      totalHeures: arrondirStatistiques_(agregat.heures, 2),
      nombreStagiairesDistincts: agregat.stagiaires.size,
      moyenneStagiairesParSeance: agregat.sessions.size
        ? arrondirStatistiques_(
          totalStagiairesSeances / agregat.sessions.size,
          1
        )
        : 0,
      derniereSeance: agregat.derniereDate
        ? convertirDateIsoStatistiques_(agregat.derniereDate)
        : ''
    };
  }).sort(function (a, b) {
    return (
      b.totalHeures - a.totalHeures ||
      b.nombreSeances - a.nombreSeances ||
      a.nomComplet.localeCompare(
        b.nomComplet,
        'fr',
        { sensitivity: 'base' }
      )
    );
  });

  return {
    lignes: lignes,
    graphiqueHeures: lignes.slice(0, 15).map(function (ligne) {
      return {
        idFormateur: ligne.idFormateur,
        libelle: ligne.nomComplet,
        valeur: ligne.totalHeures
      };
    }),
    limiteGraphique: 15,
    nombreFormateurs: lignes.length
  };
}


function construireEvolutionMensuelleStatistiques_(
  dateDebut,
  dateFin,
  sessions,
  prestations
) {
  if (!dateFin || comparerDatesStatistiques_(dateDebut, dateFin) > 0) {
    return [];
  }

  const mois = {};
  const sessionsParId = {};
  sessions.forEach(function (session) {
    sessionsParId[session.idSession] = session;
  });
  let curseur = new Date(
    dateDebut.getFullYear(),
    dateDebut.getMonth(),
    1,
    12
  );
  const fin = new Date(
    dateFin.getFullYear(),
    dateFin.getMonth(),
    1,
    12
  );

  while (comparerDatesStatistiques_(curseur, fin) <= 0) {
    const cle = cleMoisStatistiques_(curseur);
    mois[cle] = {
      cle: cle,
      libelle: libelleMoisStatistiques_(curseur),
      nombreSeances: 0,
      volumeHeures: 0
    };
    curseur = new Date(
      curseur.getFullYear(),
      curseur.getMonth() + 1,
      1,
      12
    );
  }

  sessions.forEach(function (session) {
    const cle = cleMoisStatistiques_(session.date);
    if (mois[cle]) {
      mois[cle].nombreSeances++;
    }
  });

  prestations.forEach(function (prestation) {
    const session = sessionsParId[prestation.idSession];
    if (!session) {
      return;
    }
    const cle = cleMoisStatistiques_(session.date);
    if (mois[cle]) {
      mois[cle].volumeHeures += prestation.dureeHeures;
    }
  });

  return Object.keys(mois).sort().map(function (cle) {
    mois[cle].volumeHeures = arrondirStatistiques_(
      mois[cle].volumeHeures,
      2
    );
    return mois[cle];
  });
}


function calculerItemsStatistiques_(
  tables,
  sessions,
  idsSessions,
  contexteFormations,
  filtres,
  avertissements
) {
  const categories = construireCategoriesStatistiques_(
    tables.CATEGORIES,
    contexteFormations,
    avertissements
  );
  const items = construireReferentielStatistiques_(
    tables.REFERENTIEL,
    contexteFormations,
    avertissements
  );
  const dateParSession = {};
  sessions.forEach(function (session) {
    dateParSession[session.idSession] = session.date;
  });
  const sessionsAvecSourcePrincipale = new Set();
  const paires = new Set();

  tables.ITEMS_SESSIONS.lignes.forEach(function (ligne) {
    const idSession = valeurStatistiques_(
      tables.ITEMS_SESSIONS,
      ligne,
      'ID_SESSION'
    );
    const idItem = valeurStatistiques_(
      tables.ITEMS_SESSIONS,
      ligne,
      'ID_ITEM'
    );

    if (!idSession || !idItem) {
      return;
    }
    sessionsAvecSourcePrincipale.add(idSession);
    if (idsSessions.has(idSession)) {
      paires.add(idSession + '::' + idItem);
    }
  });

  let nombrePairesRepli = 0;
  tables.EVALUATIONS.lignes.forEach(function (ligne) {
    const idSession = valeurStatistiques_(
      tables.EVALUATIONS,
      ligne,
      'ID_SESSION'
    );
    const idItem = valeurStatistiques_(
      tables.EVALUATIONS,
      ligne,
      'ID_ITEM'
    );

    if (
      !idSession ||
      !idItem ||
      !idsSessions.has(idSession) ||
      sessionsAvecSourcePrincipale.has(idSession) ||
      !evaluationIndiqueTravailStatistiques_(
        ligne,
        tables.EVALUATIONS.index
      )
    ) {
      return;
    }

    const tailleAvant = paires.size;
    paires.add(idSession + '::' + idItem);
    if (paires.size > tailleAvant) {
      nombrePairesRepli++;
    }
  });

  const occurrencesParItem = {};
  const sessionsParItem = {};
  const derniereDateParItem = {};
  const agregatsCategories = {};

  paires.forEach(function (paire) {
    const separation = paire.indexOf('::');
    const idSession = paire.slice(0, separation);
    const idItem = paire.slice(separation + 2);
    const item = items.parId[idItem];
    const idCategorie = item && item.idCategorie
      ? item.idCategorie
      : '__INCONNUE__';
    const date = dateParSession[idSession];

    if (!item) {
      ajouterAvertissementStatistiques_(
        avertissements,
        'Item historique absent du REFERENTIEL : ' + idItem + '.'
      );
    }

    occurrencesParItem[idItem] = (occurrencesParItem[idItem] || 0) + 1;
    sessionsParItem[idItem] = sessionsParItem[idItem] || new Set();
    sessionsParItem[idItem].add(idSession);

    if (
      date &&
      (!derniereDateParItem[idItem] ||
        comparerDatesStatistiques_(date, derniereDateParItem[idItem]) > 0)
    ) {
      derniereDateParItem[idItem] = date;
    }

    agregatsCategories[idCategorie] =
      agregatsCategories[idCategorie] || {
        idCategorie: idCategorie,
        sessions: new Set(),
        occurrences: 0
      };
    agregatsCategories[idCategorie].sessions.add(idSession);
    agregatsCategories[idCategorie].occurrences++;
  });

  const totalOccurrences = paires.size;
  const repartitionCategories = Object.keys(agregatsCategories)
    .map(function (idCategorie) {
      const agregat = agregatsCategories[idCategorie];
      const categorie = categories.parId[idCategorie] || {
        libelle: 'Catégorie inconnue',
        ordre: Number.MAX_SAFE_INTEGER,
        actif: false,
        formationOrdre: Number.MAX_SAFE_INTEGER
      };
      return {
        idCategorie: idCategorie,
        libelle: categorie.libelle,
        actif: categorie.actif,
        nombreSeances: agregat.sessions.size,
        occurrences: agregat.occurrences,
        pourcentage: totalOccurrences
          ? arrondirStatistiques_(
            agregat.occurrences / totalOccurrences * 100,
            1
          )
          : 0,
        ordre: categorie.ordre,
        formationOrdre: categorie.formationOrdre
      };
    })
    .sort(function (a, b) {
      return a.formationOrdre - b.formationOrdre ||
        a.ordre - b.ordre ||
        a.libelle.localeCompare(b.libelle, 'fr', { sensitivity: 'base' });
    });

  const itemsClassement = items.liste.filter(function (item) {
    const categorie = categories.parId[item.idCategorie];
    const formationRespectee = !filtres.formationId ||
      item.formationId === filtres.formationId;
    const actifCourant = item.actif && Boolean(categorie && categorie.actif);

    return formationRespectee && (
      filtres.inclureItemsInactifs || actifCourant
    );
  }).map(function (item) {
    const categorie = categories.parId[item.idCategorie];
    return {
      idItem: item.idItem,
      intitule: item.intitule,
      categorie: categorie
        ? categorie.libelle
        : 'Catégorie inconnue',
      actif: item.actif && Boolean(categorie && categorie.actif),
      nombreSeances: (sessionsParItem[item.idItem] || new Set()).size,
      occurrences: occurrencesParItem[item.idItem] || 0,
      derniereDate: derniereDateParItem[item.idItem]
        ? convertirDateIsoStatistiques_(derniereDateParItem[item.idItem])
        : '',
      ordreFormation: item.formationOrdre,
      ordreCategorie: categorie
        ? categorie.ordre
        : Number.MAX_SAFE_INTEGER,
      ordreItem: item.ordre
    };
  });

  const plusTravailles = itemsClassement.slice().sort(function (a, b) {
    return b.nombreSeances - a.nombreSeances ||
      b.occurrences - a.occurrences ||
      comparerOrdreItemsStatistiques_(a, b);
  }).slice(0, 10);
  const moinsTravailles = itemsClassement.slice().sort(function (a, b) {
    return a.nombreSeances - b.nombreSeances ||
      a.occurrences - b.occurrences ||
      comparerOrdreItemsStatistiques_(a, b);
  }).slice(0, 10);

  return {
    repartitionCategories: repartitionCategories,
    totalOccurrences: totalOccurrences,
    plusTravailles: plusTravailles,
    moinsTravailles: moinsTravailles,
    sources: {
      occurrencesItemsSessions: totalOccurrences - nombrePairesRepli,
      occurrencesEvaluationsHistoriques: nombrePairesRepli
    }
  };
}


function construireCategoriesStatistiques_(
  table,
  contexteFormations,
  avertissements
) {
  const parId = {};

  table.lignes.forEach(function (ligne) {
    const id = valeurStatistiques_(table, ligne, 'ID_CATEGORIE');
    if (!id || parId[id]) {
      if (id && parId[id]) {
        ajouterAvertissementStatistiques_(
          avertissements,
          'ID_CATEGORIE dupliqué ignoré : ' + id + '.'
        );
      }
      return;
    }
    const formationId = contexteFormations.resoudre(
      ligne[table.index.FORMATION]
    );
    const formation = contexteFormations.parId[formationId];
    parId[id] = {
      idCategorie: id,
      formationId: formationId,
      libelle: valeurStatistiques_(table, ligne, 'CATEGORIE') || id,
      ordre: convertirNombreStatistiques_(ligne[table.index.ORDRE]) || 0,
      actif: convertirBooleenStatistiques_(ligne[table.index.ACTIF]),
      formationOrdre: formation
        ? formation.ordre
        : Number.MAX_SAFE_INTEGER
    };
  });

  return { parId: parId };
}


function construireReferentielStatistiques_(
  table,
  contexteFormations,
  avertissements
) {
  const parId = {};
  const liste = [];

  table.lignes.forEach(function (ligne) {
    const id = valeurStatistiques_(table, ligne, 'ID_ITEM');
    if (!id || parId[id]) {
      if (id && parId[id]) {
        ajouterAvertissementStatistiques_(
          avertissements,
          'ID_ITEM dupliqué ignoré : ' + id + '.'
        );
      }
      return;
    }
    const formationId = contexteFormations.resoudre(
      ligne[table.index.FORMATION]
    );
    const formation = contexteFormations.parId[formationId];
    const item = {
      idItem: id,
      formationId: formationId,
      idCategorie: valeurStatistiques_(table, ligne, 'ID_CATEGORIE'),
      intitule: valeurStatistiques_(table, ligne, 'ITEM') || id,
      ordre: convertirNombreStatistiques_(ligne[table.index.ORDRE]) || 0,
      actif: convertirBooleenStatistiques_(ligne[table.index.ACTIF]),
      formationOrdre: formation
        ? formation.ordre
        : Number.MAX_SAFE_INTEGER
    };
    parId[id] = item;
    liste.push(item);
  });

  return { parId: parId, liste: liste };
}


function evaluationIndiqueTravailStatistiques_(ligne, index) {
  if (
    normaliserStatistiques_(ligne[index.NIVEAU]) === 'ACQUIS'
  ) {
    return true;
  }

  const vu = ligne[index.VU];
  if (vu !== '' && vu !== null && vu !== undefined) {
    return convertirBooleenStatistiques_(vu);
  }

  return Boolean(
    String(ligne[index.NIVEAU] || '').trim() ||
    String(ligne[index.REMARQUE] || '').trim()
  );
}


function calculerEvolutionPourcentageStatistiques_(courant, precedent) {
  if (!precedent) {
    return {
      calculable: false,
      pourcentage: null
    };
  }

  return {
    calculable: true,
    pourcentage: arrondirStatistiques_(
      (courant - precedent) / precedent * 100,
      1
    )
  };
}


function comparerOrdreItemsStatistiques_(a, b) {
  return a.ordreFormation - b.ordreFormation ||
    a.ordreCategorie - b.ordreCategorie ||
    a.ordreItem - b.ordreItem ||
    a.intitule.localeCompare(b.intitule, 'fr', { sensitivity: 'base' });
}


function comparerFormateursStatistiques_(a, b) {
  return a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }) ||
    a.prenom.localeCompare(b.prenom, 'fr', { sensitivity: 'base' });
}


function valeurStatistiques_(table, ligne, colonne) {
  return String(ligne[table.index[colonne]] || '').trim();
}


function creerIndexStatistiques_(entetes) {
  const index = {};
  (entetes || []).forEach(function (entete, position) {
    index[normaliserStatistiques_(entete)] = position;
  });
  return index;
}


function normaliserStatistiques_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function convertirBooleenStatistiques_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }
  return [
    '1', 'TRUE', 'VRAI', 'OUI', 'YES', 'ACTIF', 'VU', 'ACQUIS'
  ].includes(normaliserStatistiques_(valeur));
}


function convertirNombreStatistiques_(valeur) {
  if (typeof valeur === 'number') {
    return isNaN(valeur) ? 0 : valeur;
  }
  const nombre = Number(String(valeur || '').trim().replace(',', '.'));
  return isNaN(nombre) ? 0 : nombre;
}


function nettoyerIdentifiantFiltreStatistiques_(valeur) {
  const texte = String(valeur || '').trim();
  if (!texte) {
    return '';
  }
  if (texte.length > 150 || !/^[A-Za-z0-9._:-]+$/.test(texte)) {
    throw new Error('Identifiant technique de filtre invalide.');
  }
  return texte;
}


function normaliserDateStatistiques_(valeur) {
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


function convertirDateIsoStatistiques_(date) {
  if (!date) {
    return '';
  }
  return String(date.getFullYear()).padStart(4, '0') + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}


function comparerDatesStatistiques_(a, b) {
  return cleDateStatistiques_(a) - cleDateStatistiques_(b);
}


function cleDateStatistiques_(date) {
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}


function differenceJoursStatistiques_(fin, debut) {
  return Math.round(
    (cleDateStatistiques_(fin) - cleDateStatistiques_(debut)) / 86400000
  );
}


function ajouterJoursStatistiques_(date, nombre) {
  const resultat = new Date(date.getTime());
  resultat.setDate(resultat.getDate() + nombre);
  resultat.setHours(12, 0, 0, 0);
  return resultat;
}


function cleMoisStatistiques_(date) {
  return String(date.getFullYear()) + '-' +
    String(date.getMonth() + 1).padStart(2, '0');
}


function libelleMoisStatistiques_(date) {
  const noms = [
    'Jan.', 'Fév.', 'Mars', 'Avr.', 'Mai', 'Juin',
    'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'
  ];
  return noms[date.getMonth()] + ' ' + date.getFullYear();
}


function arrondirStatistiques_(valeur, decimales) {
  const facteur = Math.pow(10, Number(decimales || 0));
  return Math.round((Number(valeur) || 0) * facteur) / facteur;
}


function ajouterAvertissementStatistiques_(liste, message) {
  if (!liste.includes(message) && liste.length < 100) {
    liste.push(message);
  }
}
