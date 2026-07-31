function initialiserApplication() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();

  const feuilles = {
    PARAMETRES: [
      'Type',
      'Valeur',
      'Ordre',
      'Actif'
    ],

    STAGIAIRES: [
      'ID_STAGIAIRE',
      'NOM',
      'PRENOM',
      'FORMATION',
      'DATE_DEBUT_PREPARATION',
      'DATE_STAGE',
      'STATUT',
      'DATE_CLOTURE',
      'MOTIF_CLOTURE',
      'REMARQUES_ADMINISTRATIVES',
      'DATE_CREATION',
      'DATE_MODIFICATION'
    ],

    FORMATEURS: [
      'ID_FORMATEUR',
      'NOM',
      'PRENOM',
      'ACTIF',
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

  remplirParametres(classeur);
  appliquerFormats(classeur);

  SpreadsheetApp.flush();

  SpreadsheetApp.getUi().alert(
    'Initialisation terminée',
    'Les feuilles de l’application ont été créées.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function remplirParametres(classeur) {
  const feuille = classeur.getSheetByName('PARAMETRES');

  const donnees = [
    ['FORMATION', 'EQ PS', 1, 'Oui'],
    ['FORMATION', 'EQ SUAP', 2, 'Oui'],
    ['FORMATION', 'CA SUAP', 3, 'Oui'],

    ['STATUT_STAGIAIRE', 'À préparer', 1, 'Oui'],
    ['STATUT_STAGIAIRE', 'Échéance atteinte', 2, 'Oui'],
    ['STATUT_STAGIAIRE', 'Préparation terminée', 3, 'Oui'],
    ['STATUT_STAGIAIRE', 'Préparation abandonnée', 4, 'Oui'],

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

function appliquerFormats(classeur) {
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
function getPage(page) {
  return HtmlService.createTemplateFromFile(page)
.evaluate()
.getContent();
}

function getFormations(){

const sh=SpreadsheetApp.getActive()
.getSheetByName("PARAMETRES");

const data=sh.getDataRange().getValues();

return data
.filter(r=>r[0]=="FORMATION" && r[3]=="Oui")
.map(r=>r[1]);

}
