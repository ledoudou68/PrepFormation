'use strict';

const DUREE_CACHE_CALENDRIER_SECONDES_ = 3 * 60;
const DUREE_GENERATION_CACHE_CALENDRIER_SECONDES_ = 6 * 60 * 60;
const CLE_GENERATION_CACHE_CALENDRIER_ =
  'PREPFORMATION_CALENDRIER_GENERATION';
const PREFIXE_CACHE_CALENDRIER_ = 'PREPFORMATION_CALENDRIER_V1_';

const FEUILLES_CALENDRIER_ = [
  {
    nom: 'SESSIONS',
    colonnes: ['ID_SESSION', 'DATE_SESSION', 'FORMATION']
  },
  {
    nom: 'PRESTATIONS_FORMATEURS',
    colonnes: ['ID_SESSION', 'ID_FORMATEUR']
  },
  {
    nom: 'PRESENCES_STAGIAIRES',
    colonnes: ['ID_SESSION', 'ID_STAGIAIRE']
  },
  {
    nom: 'FORMATEURS',
    colonnes: ['ID_FORMATEUR', 'NOM', 'PRENOM']
  },
  {
    nom: 'FORMATIONS',
    colonnes: ['ID_FORMATION', 'LIBELLE']
  },
  {
    nom: 'STAGIAIRES',
    colonnes: ['UUID', 'NOM', 'PRENOM']
  }
];


/**
 * Lecture pure de la fenêtre visible. Le cache contient uniquement les
 * agrégats structurels : les droits sont rattachés à chaque requête.
 */
function getDonneesCalendrier(
  dateDebutIso,
  dateFinIso,
  jetonUtilisateur
) {
  if (
    typeof restaurationBloqueEcritures_ === 'function' &&
    restaurationBloqueEcritures_()
  ) {
    throw new Error(
      'Le calendrier est temporairement indisponible pendant la restauration.'
    );
  }

  const periode = validerPeriodeCalendrier_(dateDebutIso, dateFinIso);
  const droits = obtenirDroitsCalendrier_(jetonUtilisateur);
  const cache = CacheService.getScriptCache();
  const generation = cache.get(CLE_GENERATION_CACHE_CALENDRIER_) || '0';
  const version = typeof obtenirVersionApplication_ === 'function'
    ? obtenirVersionApplication_()
    : 'inconnue';
  const cleCache = PREFIXE_CACHE_CALENDRIER_ +
    generation + '_' + version + '_' +
    periode.dateDebutIso + '_' + periode.dateFinIso;
  const contenuCache = cache.get(cleCache);

  if (contenuCache) {
    try {
      const resultatCache = JSON.parse(contenuCache);
      resultatCache.droits = droits;
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

  const debutCalcul = Date.now();
  const avertissements = [];
  const tables = lireTablesCalendrier_(avertissements);
  const resultat = calculerDonneesCalendrierDepuisTables_(
    tables,
    periode.dateDebut,
    periode.dateFin,
    new Date(),
    avertissements
  );
  const finCalcul = Date.now();

  resultat.meta = {
    dateDebut: periode.dateDebutIso,
    dateFin: periode.dateFinIso,
    calculeA: new Date(finCalcul).toISOString(),
    calculeAms: finCalcul,
    dureeCalculMs: finCalcul - debutCalcul,
    cacheUtilise: false,
    ageCacheSecondes: 0,
    nombreAvertissements: resultat.avertissements.length,
    versionApplication: version
  };

  try {
    cache.put(
      cleCache,
      JSON.stringify(resultat),
      DUREE_CACHE_CALENDRIER_SECONDES_
    );
  } catch (erreurCache) {
    resultat.avertissements.push(
      'Le cache court du calendrier n’a pas pu être alimenté.'
    );
    resultat.meta.nombreAvertissements = resultat.avertissements.length;
  }

  resultat.droits = droits;
  return resultat;
}


function obtenirDroitsCalendrier_(jetonUtilisateur) {
  const session = exigerUtilisateurAuthentifie_(jetonUtilisateur);

  return {
    consulterCalendrier: true,
    creerSession: Boolean(
      session && session.droits && session.droits.gererSessions
    ),
    estAdministrateur: Boolean(session && session.estAdministrateur)
  };
}


function validerPeriodeCalendrier_(dateDebutIso, dateFinIso) {
  const dateDebut = convertirDateIsoCalendrier_(dateDebutIso);
  const dateFin = convertirDateIsoCalendrier_(dateFinIso);

  if (!dateDebut || !dateFin) {
    throw new Error('Période du calendrier invalide.');
  }
  if (dateDebut.getTime() > dateFin.getTime()) {
    throw new Error('La date de début doit précéder la date de fin.');
  }

  const nombreJours = Math.round(
    (dateFin.getTime() - dateDebut.getTime()) / 86400000
  ) + 1;

  if (nombreJours > 62) {
    throw new Error(
      'La période demandée dépasse la fenêtre maximale du calendrier.'
    );
  }

  return {
    dateDebut: dateDebut,
    dateFin: dateFin,
    dateDebutIso: formaterDateIsoCalendrier_(dateDebut),
    dateFinIso: formaterDateIsoCalendrier_(dateFin)
  };
}


function lireTablesCalendrier_(avertissements) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tables = {};

  FEUILLES_CALENDRIER_.forEach(function (configuration) {
    const feuille = classeur.getSheetByName(configuration.nom);

    if (!feuille || feuille.getLastRow() < 1 || feuille.getLastColumn() < 1) {
      throw new Error(
        'La feuille ' + configuration.nom +
        ' est absente ou non initialisée. Aucune migration n’a été exécutée.'
      );
    }

    const valeurs = feuille.getDataRange().getValues();
    const entetes = valeurs[0] || [];
    const index = creerIndexCalendrier_(entetes);
    const manquantes = configuration.colonnes.filter(function (colonne) {
      return !Number.isInteger(index[colonne]);
    });

    if (manquantes.length) {
      throw new Error(
        'La structure de ' + configuration.nom +
        ' est incomplète : ' + manquantes.join(', ') + '.'
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


/** Coeur pur, injectable dans les tests. */
function calculerDonneesCalendrierDepuisTables_(
  tables,
  dateDebut,
  dateFin,
  maintenant,
  avertissementsOptionnels
) {
  const avertissements = avertissementsOptionnels || [];
  const formations = construireFormationsCalendrier_(
    tables.FORMATIONS,
    avertissements
  );
  const formateurs = construireIdentitesCalendrier_(
    tables.FORMATEURS,
    'ID_FORMATEUR',
    avertissements
  );
  const stagiaires = construireIdentitesCalendrier_(
    tables.STAGIAIRES,
    'UUID',
    avertissements
  );
  const sessionsParId = {};
  const sessions = [];
  const indexSessions = tables.SESSIONS.index;

  tables.SESSIONS.lignes.forEach(function (ligne) {
    const idSession = valeurCalendrier_(
      tables.SESSIONS,
      ligne,
      'ID_SESSION'
    );

    if (!idSession) {
      return;
    }
    if (sessionsParId[idSession]) {
      ajouterAvertissementCalendrier_(
        avertissements,
        'ID_SESSION dupliqué ignoré : ' + idSession + '.'
      );
      return;
    }

    const date = convertirDateCalendrier_(
      ligne[indexSessions.DATE_SESSION]
    );

    if (!date) {
      ajouterAvertissementCalendrier_(
        avertissements,
        'Date de séance inexploitable pour ' + idSession + '.'
      );
      return;
    }
    if (date < dateDebut || date > dateFin) {
      return;
    }

    const formationBrute = valeurCalendrier_(
      tables.SESSIONS,
      ligne,
      'FORMATION'
    );
    const formation = formations.resoudre(formationBrute);
    const heureDebut = convertirHeureCalendrier_(
      valeurBruteCalendrier_(
        tables.SESSIONS,
        ligne,
        'HEURE_DEBUT'
      )
    );
    const heureFin = convertirHeureCalendrier_(
      valeurBruteCalendrier_(
        tables.SESSIONS,
        ligne,
        'HEURE_FIN'
      )
    );
    const dureeEnregistree = convertirNombreCalendrier_(
      valeurBruteCalendrier_(
        tables.SESSIONS,
        ligne,
        'DUREE_HEURES'
      )
    );
    const session = {
      idSession: idSession,
      date: formaterDateIsoCalendrier_(date),
      heureDebut: heureDebut,
      heureFin: heureFin,
      dureeHeures: dureeEnregistree !== null
        ? dureeEnregistree
        : calculerDureeCalendrier_(heureDebut, heureFin),
      formationId: formation.idFormation,
      formation: formation.libelle,
      remarques: valeurCalendrier_(
        tables.SESSIONS,
        ligne,
        'REMARQUES'
      ),
      formateurIds: [],
      formateurs: [],
      stagiaireIds: [],
      nombreStagiaires: 0
    };

    sessionsParId[idSession] = session;
    sessions.push(session);
  });

  rattacherParticipantsCalendrier_(
    tables.PRESTATIONS_FORMATEURS,
    sessionsParId,
    'ID_FORMATEUR',
    'formateurIds'
  );
  rattacherParticipantsCalendrier_(
    tables.PRESENCES_STAGIAIRES,
    sessionsParId,
    'ID_STAGIAIRE',
    'stagiaireIds'
  );

  const formationsUtiles = {};
  const formateursUtiles = {};
  const stagiairesUtiles = {};

  sessions.forEach(function (session) {
    formationsUtiles[session.formationId] = {
      idFormation: session.formationId,
      libelle: session.formation
    };

    session.formateurs = session.formateurIds.map(function (idFormateur) {
      const identite = formateurs.parId[idFormateur] || {
        id: idFormateur,
        nomComplet: 'Formateur non identifié',
        orphelin: true
      };
      const resultat = {
        idFormateur: idFormateur,
        nomComplet: identite.nomComplet,
        orphelin: Boolean(identite.orphelin)
      };
      formateursUtiles[idFormateur] = resultat;
      return resultat;
    }).sort(comparerIdentitesCalendrier_);

    session.formateurIds = session.formateurs.map(function (formateur) {
      return formateur.idFormateur;
    });

    session.stagiaireIds.forEach(function (idStagiaire) {
      const identite = stagiaires.parId[idStagiaire] || {
        id: idStagiaire,
        nomComplet: 'Stagiaire non identifié',
        orphelin: true
      };
      stagiairesUtiles[idStagiaire] = {
        idStagiaire: idStagiaire,
        nomComplet: identite.nomComplet,
        orphelin: Boolean(identite.orphelin)
      };
    });
    session.stagiaireIds.sort();
    session.nombreStagiaires = session.stagiaireIds.length;
  });

  sessions.sort(function (a, b) {
    return a.date.localeCompare(b.date) ||
      a.heureDebut.localeCompare(b.heureDebut) ||
      a.idSession.localeCompare(b.idSession);
  });

  return {
    periode: {
      dateDebut: formaterDateIsoCalendrier_(dateDebut),
      dateFin: formaterDateIsoCalendrier_(dateFin),
      aujourdHui: formaterDateIsoCalendrier_(
        convertirDateCalendrier_(maintenant) || new Date()
      )
    },
    sessions: sessions,
    formations: Object.keys(formationsUtiles).map(function (id) {
      return formationsUtiles[id];
    }).sort(function (a, b) {
      return a.libelle.localeCompare(b.libelle, 'fr', {
        sensitivity: 'base'
      });
    }),
    formateurs: Object.keys(formateursUtiles).map(function (id) {
      return formateursUtiles[id];
    }).sort(comparerIdentitesCalendrier_),
    stagiaires: Object.keys(stagiairesUtiles).map(function (id) {
      return stagiairesUtiles[id];
    }).sort(comparerIdentitesCalendrier_),
    avertissements: avertissements.slice(0, 100)
  };
}


function construireFormationsCalendrier_(table, avertissements) {
  const parId = {};
  const alias = {};

  table.lignes.forEach(function (ligne) {
    const id = valeurCalendrier_(table, ligne, 'ID_FORMATION');
    const libelle = valeurCalendrier_(table, ligne, 'LIBELLE');

    if (!id || !libelle) {
      return;
    }
    if (parId[id]) {
      ajouterAvertissementCalendrier_(
        avertissements,
        'ID_FORMATION dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    parId[id] = { idFormation: id, libelle: libelle };
    alias[normaliserTexteCalendrier_(id)] = id;
    alias[normaliserTexteCalendrier_(libelle)] = id;
  });

  return {
    resoudre: function (valeur) {
      const texte = String(valeur || '').trim();
      const id = alias[normaliserTexteCalendrier_(texte)];
      if (id && parId[id]) {
        return parId[id];
      }
      if (texte) {
        ajouterAvertissementCalendrier_(
          avertissements,
          'Formation de séance non reliée à FORMATIONS : ' + texte + '.'
        );
      }
      return {
        idFormation: 'ORPHELINE:' + (texte || 'SANS_FORMATION'),
        libelle: texte || 'Formation non identifiée'
      };
    }
  };
}


function construireIdentitesCalendrier_(
  table,
  colonneId,
  avertissements
) {
  const parId = {};

  table.lignes.forEach(function (ligne) {
    const id = valeurCalendrier_(table, ligne, colonneId);

    if (!id) {
      return;
    }
    if (parId[id]) {
      ajouterAvertissementCalendrier_(
        avertissements,
        colonneId + ' dupliqué ignoré : ' + id + '.'
      );
      return;
    }

    const prenom = valeurCalendrier_(table, ligne, 'PRENOM');
    const nom = valeurCalendrier_(table, ligne, 'NOM');
    parId[id] = {
      id: id,
      nomComplet: [prenom, nom].filter(Boolean).join(' ') ||
        'Participant non identifié',
      orphelin: false
    };
  });

  return { parId: parId };
}


function rattacherParticipantsCalendrier_(
  table,
  sessionsParId,
  colonneParticipant,
  proprieteCible
) {
  const index = table.index;

  table.lignes.forEach(function (ligne) {
    const idSession = valeurCalendrier_(table, ligne, 'ID_SESSION');
    const idParticipant = valeurCalendrier_(
      table,
      ligne,
      colonneParticipant
    );
    const session = sessionsParId[idSession];

    if (
      !session ||
      !idParticipant ||
      session[proprieteCible].includes(idParticipant)
    ) {
      return;
    }

    session[proprieteCible].push(idParticipant);
  });
}


function invaliderCacheCalendrier_() {
  try {
    CacheService.getScriptCache().put(
      CLE_GENERATION_CACHE_CALENDRIER_,
      Utilities.getUuid(),
      DUREE_GENERATION_CACHE_CALENDRIER_SECONDES_
    );
  } catch (erreur) {
    console.error(
      'Le cache du calendrier n’a pas pu être invalidé : ' +
      String(erreur && erreur.message || erreur)
    );
  }
}


function creerIndexCalendrier_(entetes) {
  const index = {};
  (entetes || []).forEach(function (entete, position) {
    const cle = String(entete || '').trim().toUpperCase();
    if (cle && !Number.isInteger(index[cle])) {
      index[cle] = position;
    }
  });
  return index;
}


function valeurCalendrier_(table, ligne, colonne) {
  const valeur = valeurBruteCalendrier_(table, ligne, colonne);
  return valeur === null || valeur === undefined
    ? ''
    : String(valeur).trim();
}


function valeurBruteCalendrier_(table, ligne, colonne) {
  const position = table && table.index
    ? table.index[colonne]
    : null;
  return Number.isInteger(position) ? ligne[position] : '';
}


function convertirDateIsoCalendrier_(valeur) {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    String(valeur || '').trim()
  );
  if (!correspondance) {
    return null;
  }
  const date = new Date(
    Number(correspondance[1]),
    Number(correspondance[2]) - 1,
    Number(correspondance[3]),
    12
  );
  return date.getFullYear() === Number(correspondance[1]) &&
    date.getMonth() === Number(correspondance[2]) - 1 &&
    date.getDate() === Number(correspondance[3])
    ? date
    : null;
}


function convertirDateCalendrier_(valeur) {
  if (valeur instanceof Date && !isNaN(valeur.getTime())) {
    return new Date(
      valeur.getFullYear(),
      valeur.getMonth(),
      valeur.getDate(),
      12
    );
  }

  const iso = convertirDateIsoCalendrier_(valeur);
  if (iso) {
    return iso;
  }

  const correspondance = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(
    String(valeur || '').trim()
  );
  if (!correspondance) {
    return null;
  }
  return convertirDateIsoCalendrier_(
    correspondance[3] + '-' +
    String(correspondance[2]).padStart(2, '0') + '-' +
    String(correspondance[1]).padStart(2, '0')
  );
}


function formaterDateIsoCalendrier_(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}


function convertirHeureCalendrier_(valeur) {
  if (valeur instanceof Date && !isNaN(valeur.getTime())) {
    return String(valeur.getHours()).padStart(2, '0') + ':' +
      String(valeur.getMinutes()).padStart(2, '0');
  }
  if (typeof valeur === 'number' && isFinite(valeur)) {
    const minutes = Math.round((valeur % 1) * 24 * 60);
    return String(Math.floor(minutes / 60) % 24).padStart(2, '0') + ':' +
      String(minutes % 60).padStart(2, '0');
  }
  const correspondance = /^(\d{1,2}):(\d{2})/.exec(
    String(valeur || '').trim()
  );
  if (!correspondance) {
    return '';
  }
  return String(Number(correspondance[1])).padStart(2, '0') + ':' +
    correspondance[2];
}


function convertirNombreCalendrier_(valeur) {
  if (valeur === '' || valeur === null || valeur === undefined) {
    return null;
  }
  const nombre = Number(String(valeur).replace(',', '.'));
  return isFinite(nombre) ? nombre : null;
}


function calculerDureeCalendrier_(heureDebut, heureFin) {
  const debut = convertirMinutesCalendrier_(heureDebut);
  const fin = convertirMinutesCalendrier_(heureFin);
  return debut !== null && fin !== null && fin >= debut
    ? Math.round((fin - debut) / 60 * 100) / 100
    : null;
}


function convertirMinutesCalendrier_(heure) {
  const correspondance = /^(\d{2}):(\d{2})$/.exec(String(heure || ''));
  if (!correspondance) {
    return null;
  }
  return Number(correspondance[1]) * 60 + Number(correspondance[2]);
}


function normaliserTexteCalendrier_(valeur) {
  return String(valeur || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}


function comparerIdentitesCalendrier_(a, b) {
  return String(a.nomComplet || '').localeCompare(
    String(b.nomComplet || ''),
    'fr',
    { sensitivity: 'base' }
  );
}


function ajouterAvertissementCalendrier_(avertissements, message) {
  if (avertissements.length < 100 && !avertissements.includes(message)) {
    avertissements.push(message);
  }
}
