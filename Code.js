function initialiserApplication(jetonAdministrateur) {
  const sessionUtilisateur = exigerAdministrateur_(
    jetonAdministrateur
  );

  return executerMutationMetier_(function () {
    return initialiserApplicationInterne_(sessionUtilisateur);
  });
}


function initialiserApplicationInterne_(sessionUtilisateur) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();

  const feuilles = {
    PARAMETRES: [
      'Type',
      'Valeur',
      'Ordre',
      'Actif'
    ],

    FORMATIONS: [
      'ID_FORMATION',
      'LIBELLE',
      'ORDRE',
      'ACTIF'
    ],

    STAGIAIRES: [
      'UUID',
      'NOM',
      'PRENOM',
      'FORMATION',
      'DATE_DEBUT_PREPARATION',
      'DATE_STAGE',
      'STATUT',
      'DATE_CLOTURE',
      'MOTIF_CLOTURE',
      'NOTES_ADMINISTRATIVES',
      'GRADE',
      'TELEPHONE',
      'EMAIL',
      'PHOTO_URL',
      'FORMATEUR_REFERENT',
      'DATE_CHANGEMENT_STATUT_AUTO',
      'DATE_CREATION',
      'DATE_MODIFICATION'
    ],

    FORMATEURS: [
      'ID_FORMATEUR',
      'NOM',
      'PRENOM',
      'ACTIF',
      'EMAIL',
      'DATE_CREATION',
      'DATE_MODIFICATION'
    ],

    UTILISATEURS: [
      'ID_UTILISATEUR',
      'ID_FORMATEUR',
      'IDENTIFIANT',
      'PASSWORD_HASH',
      'PASSWORD_SALT',
      'ACTIF',
      'DOIT_CHANGER_MOT_DE_PASSE',
      'NB_ECHECS',
      'BLOQUE_JUSQU_A',
      'DERNIERE_CONNEXION',
      'DATE_MODIFICATION_MDP',
      'DATE_CREATION',
      'DATE_MODIFICATION'
    ],

    SESSIONS: [
      'ID_SESSION',
      'DATE_SESSION',
      'HEURE_DEBUT',
      'HEURE_FIN',
      'DUREE_HEURES',
      'FORMATION',
      'THEME',
      'REMARQUES',
      'SAISI_PAR',
      'DATE_CREATION',
      'DATE_MODIFICATION'
    ],

    PRESENCES_STAGIAIRES: [
      'ID_PRESENCE',
      'ID_SESSION',
      'ID_STAGIAIRE',
      'DATE_CREATION'
    ],

    PRESTATIONS_FORMATEURS: [
      'ID_PRESTATION',
      'ID_SESSION',
      'ID_FORMATEUR',
      'DUREE_HEURES',
      'STATUT_INDEMNISATION',
      'DATE_DEMANDE',
      'REFERENCE_DEMANDE',
      'REMARQUES_INDEMNISATION',
      'DATE_CREATION',
      'DATE_MODIFICATION'
    ],

    CATEGORIES: [
      'ID_CATEGORIE',
      'FORMATION',
      'CATEGORIE',
      'ORDRE',
      'ACTIF'
    ],

    REFERENTIEL: [
      'ID_ITEM',
      'FORMATION',
      'ID_CATEGORIE',
      'ITEM',
      'DESCRIPTION',
      'ORDRE',
      'ACTIF'
    ],

    EVALUATIONS: [
      'ID_EVALUATION',
      'ID_SESSION',
      'ID_STAGIAIRE',
      'ID_ITEM',
      'NIVEAU',
      'REMARQUE',
      'DATE_CREATION',
      'DATE_MODIFICATION'
    ],

    HISTORIQUE: [
      'ID_HISTORIQUE',
      'DATE_ACTION',
      'UTILISATEUR',
      'ACTION',
      'OBJET',
      'IDENTIFIANT',
      'DETAILS'
    ]
  };

  Object.entries(feuilles).forEach(([nomFeuille, entetes]) => {
    let feuille = classeur.getSheetByName(nomFeuille);

    if (!feuille) {
      feuille = classeur.insertSheet(nomFeuille);
    } else {
      feuille.clear();
    }

    feuille
      .getRange(1, 1, 1, entetes.length)
      .setValues([entetes])
      .setFontWeight('bold');

    feuille.setFrozenRows(1);
    feuille.autoResizeColumns(1, entetes.length);

    if (feuille.getFilter()) {
      feuille.getFilter().remove();
    }

    feuille
      .getRange(1, 1, Math.max(feuille.getMaxRows(), 2), entetes.length)
      .createFilter();
  });

  remplirFormations_(classeur);
  remplirParametres_(classeur);
  appliquerFormats_(classeur);

  SpreadsheetApp.flush();
  if (typeof invaliderGenerationSourcesStatuts_ === 'function') {
    invaliderGenerationSourcesStatuts_(
      [
        'STAGIAIRES',
        'SESSIONS',
        'PRESENCES_STAGIAIRES'
      ],
      'INITIALISATION_APPLICATION'
    );
  }

  journaliserActionSensible_(
    'APPLICATION_INITIALISATION',
    'APPLICATION',
    'PrepFormation',
    { feuilles: Object.keys(feuilles) },
    sessionUtilisateur.identifiantHistorique
  );

  SpreadsheetApp.getUi().alert(
    'Initialisation terminée',
    'Les feuilles de l’application ont été créées.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function remplirParametres_(classeur) {
  const feuille = classeur.getSheetByName('PARAMETRES');

  const donnees = [
    ['STATUT_STAGIAIRE', 'À préparer', 10, 'Oui'],
    ['STATUT_STAGIAIRE', 'En préparation', 11, 'Oui'],
    ['STATUT_STAGIAIRE', 'Stage aujourd\'hui', 12, 'Oui'],
    ['STATUT_STAGIAIRE', 'Stage passé', 13, 'Oui'],
    ['STATUT_STAGIAIRE', 'Clôturé', 14, 'Oui'],
    ['STATUT_STAGIAIRE', 'Abandon', 15, 'Oui'],

    ['NIVEAU_EVALUATION', 'Non acquis', 1, 'Oui'],
    ['NIVEAU_EVALUATION', 'En cours d’acquisition', 2, 'Oui'],
    ['NIVEAU_EVALUATION', 'Acquis', 3, 'Oui'],

    ['STATUT_INDEMNISATION', 'À demander', 1, 'Oui'],
    ['STATUT_INDEMNISATION', 'Demande envoyée', 2, 'Oui'],
    ['STATUT_INDEMNISATION', 'Indemnisée', 3, 'Oui'],
    ['STATUT_INDEMNISATION', 'À corriger', 4, 'Oui']
  ];

  feuille
    .getRange(2, 1, donnees.length, donnees[0].length)
    .setValues(donnees);
}

function remplirFormations_(classeur) {
  const feuille = classeur.getSheetByName('FORMATIONS');

  const donnees = [
    ['EQ_PS', 'EQ PS', 1, 'Oui'],
    ['EQ_SUAP', 'EQ SUAP', 2, 'Oui'],
    ['CA_SUAP', 'CA SUAP', 3, 'Oui']
  ];

  feuille
    .getRange(2, 1, donnees.length, donnees[0].length)
    .setValues(donnees);
}

function appliquerFormats_(classeur) {
  const formatsDates = {
    STAGIAIRES: [5, 6, 8, 11, 12],
    FORMATEURS: [5, 6],
    SESSIONS: [2, 10, 11],
    PRESENCES_STAGIAIRES: [4],
    PRESTATIONS_FORMATEURS: [6, 9, 10],
    EVALUATIONS: [7, 8]
  };

  Object.entries(formatsDates).forEach(([nomFeuille, colonnes]) => {
    const feuille = classeur.getSheetByName(nomFeuille);

    colonnes.forEach(numeroColonne => {
      feuille
        .getRange(2, numeroColonne, feuille.getMaxRows() - 1, 1)
        .setNumberFormat('dd/MM/yyyy HH:mm');
    });
  });

  const feuilleStagiaires = classeur.getSheetByName('STAGIAIRES');

  feuilleStagiaires
    .getRange(2, 5, feuilleStagiaires.getMaxRows() - 1, 2)
    .setNumberFormat('dd/MM/yyyy');

  feuilleStagiaires
    .getRange(2, 8, feuilleStagiaires.getMaxRows() - 1, 1)
    .setNumberFormat('dd/MM/yyyy');

  const feuilleSessions = classeur.getSheetByName('SESSIONS');

  feuilleSessions
    .getRange(2, 2, feuilleSessions.getMaxRows() - 1, 1)
    .setNumberFormat('dd/MM/yyyy');

  feuilleSessions
    .getRange(2, 3, feuilleSessions.getMaxRows() - 1, 2)
    .setNumberFormat('HH:mm');

  feuilleSessions
    .getRange(2, 5, feuilleSessions.getMaxRows() - 1, 1)
    .setNumberFormat('0.00');

  const feuillePrestations = classeur.getSheetByName(
    'PRESTATIONS_FORMATEURS'
  );

  feuillePrestations
    .getRange(2, 4, feuillePrestations.getMaxRows() - 1, 1)
    .setNumberFormat('0.00');
}
