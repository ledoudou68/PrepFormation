'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.resolve(__dirname, '..');
const sourceStagiaires = fs.readFileSync(
  path.join(racine, 'StagiairesService.js'),
  'utf8'
);
const sourceAccueil = fs.readFileSync(
  path.join(racine, 'AccueilService.js'),
  'utf8'
);


function clonerValeur(valeur) {
  if (valeur instanceof Date) return new Date(valeur.getTime());
  return valeur;
}


function clonerMatrice(matrice) {
  return matrice.map(function (ligne) {
    return ligne.map(clonerValeur);
  });
}


function creerFeuille(nom, matrice, compteurs) {
  const etat = clonerMatrice(matrice);

  function creerPlage(ligne, colonne, nombreLignes, nombreColonnes) {
    const plage = {
      getValues() {
        compteurs[nom].getValues++;
        return etat.slice(ligne - 1, ligne - 1 + nombreLignes)
          .map(function (valeurs) {
            return valeurs.slice(
              colonne - 1,
              colonne - 1 + nombreColonnes
            ).map(clonerValeur);
          });
      },
      setValues(valeurs) {
        compteurs[nom].setValues++;
        valeurs.forEach(function (valeursLigne, positionLigne) {
          valeursLigne.forEach(function (valeur, positionColonne) {
            etat[ligne - 1 + positionLigne][
              colonne - 1 + positionColonne
            ] = clonerValeur(valeur);
          });
        });
        return plage;
      },
      setNumberFormat() {
        compteurs[nom].setNumberFormat++;
        return plage;
      }
    };
    return plage;
  }

  return {
    getLastRow() { return etat.length; },
    getLastColumn() { return etat[0] ? etat[0].length : 0; },
    getDataRange() {
      compteurs[nom].getDataRange++;
      return creerPlage(
        1,
        1,
        etat.length,
        etat[0] ? etat[0].length : 0
      );
    },
    getRange(ligne, colonne, nombreLignes, nombreColonnes) {
      compteurs[nom].getRange++;
      return creerPlage(
        ligne,
        colonne,
        nombreLignes || 1,
        nombreColonnes || 1
      );
    },
    lireMatrice() { return clonerMatrice(etat); }
  };
}


function creerDonnees() {
  const aujourdHui = new Date();
  aujourdHui.setHours(12, 0, 0, 0);
  const hier = new Date(aujourdHui.getTime() - 86400000);
  const demain = new Date(aujourdHui.getTime() + 86400000);
  const entetesStagiaires = [
    'UUID', 'NOM', 'PRENOM', 'FORMATION',
    'DATE_DEBUT_PREPARATION', 'DATE_STAGE', 'STATUT',
    'DATE_CLOTURE', 'MOTIF_CLOTURE', 'NOTES_ADMINISTRATIVES',
    'GRADE', 'TELEPHONE', 'EMAIL', 'PHOTO_URL',
    'FORMATEUR_REFERENT', 'DATE_CHANGEMENT_STATUT_AUTO'
  ];
  function stagiaire(id, statut, dateStage) {
    return [
      id, 'Nom ' + id, 'Prénom ' + id, 'EQ PS',
      hier, dateStage, statut,
      '', '', '', '', '', '', '', '', ''
    ];
  }

  return {
    STAGIAIRES: [
      entetesStagiaires,
      stagiaire('STG_PASSE', 'À préparer', hier),
      stagiaire('STG_PREPARATION', 'À préparer', demain),
      stagiaire('STG_AUJOURD_HUI', 'À préparer', aujourdHui),
      stagiaire('STG_A_PREPARER', 'À préparer', demain),
      stagiaire('STG_CLOTURE', 'Clôturé', hier),
      stagiaire('STG_ABANDON', 'Abandon', hier),
      stagiaire('STG_MIGRATION', 'Préparation terminée', hier)
    ],
    SESSIONS: [
      [
        'ID_SESSION', 'DATE_SESSION', 'HEURE_DEBUT', 'HEURE_FIN',
        'DUREE_HEURES', 'FORMATION'
      ],
      ['SESSION_1', hier, '08:00', '10:00', 2, 'EQ PS']
    ],
    PRESENCES_STAGIAIRES: [
      ['ID_PRESENCE', 'ID_SESSION', 'ID_STAGIAIRE'],
      ['PRESENCE_1', 'SESSION_1', 'STG_PREPARATION']
    ],
    PRESTATIONS_FORMATEURS: [[
      'ID_PRESTATION', 'ID_SESSION', 'ID_FORMATEUR',
      'DUREE_HEURES', 'STATUT_INDEMNISATION'
    ]],
    FORMATEURS: [[
      'ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF'
    ]],
    CATEGORIES: [[
      'ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ORDRE', 'ACTIF'
    ]],
    REFERENTIEL: [[
      'ID_ITEM', 'FORMATION', 'ID_CATEGORIE', 'ITEM', 'ORDRE', 'ACTIF'
    ]],
    EVALUATIONS: [[
      'ID_EVALUATION', 'ID_SESSION', 'ID_STAGIAIRE',
      'ID_ITEM', 'NIVEAU', 'REMARQUE', 'VU'
    ]]
  };
}


function creerEnvironnement(options) {
  const parametres = options || {};
  const donnees = creerDonnees();
  const compteurs = {};
  const feuilles = {};
  const journaux = [];
  let flushs = 0;

  Object.keys(donnees).forEach(function (nom) {
    compteurs[nom] = {
      getSheetByName: 0,
      getDataRange: 0,
      getValues: 0,
      getRange: 0,
      setValues: 0,
      setNumberFormat: 0
    };
    feuilles[nom] = creerFeuille(nom, donnees[nom], compteurs);
  });

  const classeur = {
    getSheetByName(nom) {
      if (!feuilles[nom]) return null;
      compteurs[nom].getSheetByName++;
      return feuilles[nom];
    }
  };

  const contexte = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet() { return classeur; },
      flush() { flushs++; }
    },
    Session: {
      getScriptTimeZone() { return 'Europe/Paris'; }
    },
    Utilities: {
      formatDate(date, fuseau, format) {
        const valeur = new Date(date);
        const annee = valeur.getFullYear();
        const mois = String(valeur.getMonth() + 1).padStart(2, '0');
        const jour = String(valeur.getDate()).padStart(2, '0');
        if (format === 'yyyy-MM-dd') return annee + '-' + mois + '-' + jour;
        if (format === 'dd/MM/yyyy') return jour + '/' + mois + '/' + annee;
        return jour + '/' + mois + '/' + annee + ' 12:00';
      }
    },
    restaurationBloqueEcritures_() { return false; },
    executerMutationMetier_(traitement) { return traitement(); },
    journaliserActionSensible_() {
      journaux.push(Array.from(arguments));
    },
    exigerUtilisateurAuthentifie_(jeton, diagnostic) {
      if (diagnostic) {
        diagnostic.operation = 'VALIDATION_SESSION';
        diagnostic.totalValidationSessionMs = 0;
        diagnostic.totalServeurMs = 0;
      }
      return { estAdministrateur: true, estFormateur: true };
    },
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Set,
    Map,
    JSON,
    Error
  });

  vm.runInContext(sourceStagiaires, contexte, {
    filename: 'StagiairesService.js'
  });
  contexte.obtenirFeuilleStagiaires_ = function () {
    return classeur.getSheetByName('STAGIAIRES');
  };
  vm.runInContext(sourceAccueil, contexte, {
    filename: 'AccueilService.js'
  });

  if (parametres.sansMutualisation) {
    contexte.synchroniserStatutsStagiairesPourAccueil_ = function (
      diagnostic
    ) {
      return contexte.synchroniserStatutsStagiaires_(diagnostic);
    };
  }
  if (parametres.erreurSynchronisation) {
    contexte.synchroniserStatutsStagiairesPourAccueil_ = function () {
      throw new Error('Échec de synchronisation simulé.');
    };
  }

  return {
    contexte,
    compteurs,
    feuilles,
    journaux,
    obtenirFlushs() { return flushs; }
  };
}


function normaliserReponse(reponse) {
  const copie = JSON.parse(JSON.stringify(reponse));
  delete copie.dateActualisation;
  delete copie.diagnosticAccueil;
  return copie;
}


{
  const mutualise = creerEnvironnement();
  const ancien = creerEnvironnement({ sansMutualisation: true });
  const resultatMutualise = mutualise.contexte.getDonneesTableauBordAccueil(
    'jeton_test',
    { actif: true, modeClientExplicite: true }
  );
  const resultatAncien = ancien.contexte.getDonneesTableauBordAccueil(
    'jeton_test',
    { actif: true, modeClientExplicite: true }
  );

  assert.deepStrictEqual(
    normaliserReponse(resultatMutualise),
    normaliserReponse(resultatAncien)
  );
  [
    'STAGIAIRES',
    'SESSIONS',
    'PRESENCES_STAGIAIRES'
  ].forEach(function (nom) {
    assert.strictEqual(mutualise.compteurs[nom].getValues, 1, nom);
    assert.strictEqual(ancien.compteurs[nom].getValues, 2, nom);
  });
  assert.strictEqual(
    resultatMutualise.indicateurs.stagesPassesNonClotures,
    1
  );
  assert.strictEqual(resultatMutualise.indicateurs.stagesAujourdhui, 1);
  assert.strictEqual(resultatMutualise.indicateurs.stagiairesEnPreparation, 1);
  assert.strictEqual(resultatMutualise.indicateurs.stagiairesAPreparer, 1);
  assert.strictEqual(
    resultatMutualise.diagnosticAccueil.nombreLecturesSheetsEvitees,
    3
  );
  assert.deepStrictEqual(
    Array.from(
      resultatMutualise.diagnosticAccueil.mutualisationLectures,
      function (lecture) { return lecture.mode; }
    ),
    ['REUTILISEE', 'REUTILISEE', 'REUTILISEE']
  );
  assert.strictEqual(
    resultatAncien.diagnosticAccueil.nombreLecturesSheetsEvitees,
    0
  );
  assert.deepStrictEqual(
    Array.from(
      resultatAncien.diagnosticAccueil.mutualisationLectures,
      function (lecture) { return lecture.mode; }
    ),
    ['RELUE', 'RELUE', 'RELUE']
  );
  assert.strictEqual(
    typeof resultatMutualise.diagnosticAccueil.totalServeurMs,
    'number'
  );

  const diagnosticSerialise = JSON.stringify(
    resultatMutualise.diagnosticAccueil
  );
  [
    'STG_PASSE',
    'STG_PREPARATION',
    'Nom STG',
    'Stage passé'
  ].forEach(function (donneeMetier) {
    assert(!diagnosticSerialise.includes(donneeMetier));
  });

  assert.strictEqual(
    mutualise.compteurs.STAGIAIRES.setValues,
    ancien.compteurs.STAGIAIRES.setValues
  );
  assert.strictEqual(mutualise.obtenirFlushs(), ancien.obtenirFlushs());
  assert.strictEqual(
    JSON.stringify(mutualise.journaux.map(function (journal) {
      return journal.slice(0, 4);
    })),
    JSON.stringify(ancien.journaux.map(function (journal) {
      return journal.slice(0, 4);
    }))
  );
}


{
  const environnement = creerEnvironnement();
  const resultat = environnement.contexte.synchroniserStatutsStagiaires_();
  assert.strictEqual(resultat.migres, 4);
  assert.strictEqual(resultat.automatiquesMisAJour, 4);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(resultat, 'instantanesAccueil'),
    false
  );
  assert.strictEqual(environnement.compteurs.STAGIAIRES.getValues, 1);
  assert.strictEqual(environnement.compteurs.SESSIONS.getValues, 1);
  assert.strictEqual(
    environnement.compteurs.PRESENCES_STAGIAIRES.getValues,
    1
  );
}


{
  const environnement = creerEnvironnement({
    erreurSynchronisation: true
  });
  assert.throws(
    function () {
      environnement.contexte.getDonneesTableauBordAccueil('jeton_test');
    },
    /Échec de synchronisation simulé/
  );
  Object.keys(environnement.compteurs).forEach(function (nom) {
    assert.strictEqual(environnement.compteurs[nom].getValues, 0, nom);
  });
  assert.strictEqual(environnement.journaux.length, 0);
}


assert(sourceStagiaires.includes(
  'function synchroniserStatutsStagiairesPourAccueil_('
));
assert(!sourceAccueil.includes('CacheService'));
assert(!sourceStagiaires.includes('instantanesAccueil.diagnostic'));

console.log(
  '✓ mutualisation Accueil : lectures uniques, statuts cohérents et contrat privé inchangé'
);
