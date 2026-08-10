'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.resolve(__dirname, '..');
const sourceAccueil = fs.readFileSync(
  path.join(racine, 'AccueilService.js'),
  'utf8'
);
const sourceFavoris = fs.readFileSync(
  path.join(racine, 'FavorisService.js'),
  'utf8'
);
const sourceUi = fs.readFileSync(
  path.join(racine, 'UI.js'),
  'utf8'
);
const sourceClient = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
);
const administrationHtml = fs.readFileSync(
  path.join(racine, 'Administration.html'),
  'utf8'
);

const entetes = {
  STAGIAIRES: [
    'UUID', 'NOM', 'PRENOM', 'FORMATION', 'STATUT', 'DATE_STAGE'
  ],
  SESSIONS: [
    'ID_SESSION', 'DATE', 'HEURE_DEBUT', 'HEURE_FIN', 'FORMATION'
  ],
  PRESENCES_STAGIAIRES: ['ID_SESSION', 'ID_STAGIAIRE'],
  PRESTATIONS_FORMATEURS: [
    'ID_PRESTATION', 'ID_SESSION', 'ID_FORMATEUR',
    'STATUT_INDEMNISATION'
  ],
  FORMATEURS: ['ID_FORMATEUR', 'NOM', 'PRENOM'],
  CATEGORIES: [
    'ID_CATEGORIE', 'ID_FORMATION', 'INTITULE', 'ORDRE', 'ACTIF'
  ],
  REFERENTIEL: [
    'ID_ITEM', 'ID_FORMATION', 'ID_CATEGORIE', 'INTITULE',
    'ORDRE', 'ACTIF'
  ],
  EVALUATIONS: [
    'ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM', 'ACQUIS', 'VU'
  ],
  FAVORIS: [
    'ID_FAVORI', 'TYPE', 'IDENTIFIANT', 'LIBELLE', 'SOUS_LIBELLE',
    'UTILISATEUR_CLE', 'DATE_CREATION'
  ]
};


function creerEnvironnementServeur() {
  const lectures = {};
  const feuilles = {};

  Object.keys(entetes).forEach(function (nom) {
    lectures[nom] = {
      getSheetByName: 0,
      getDataRange: 0,
      getValues: 0
    };
    feuilles[nom] = {
      getLastRow() { return 1; },
      getLastColumn() { return entetes[nom].length; },
      getDataRange() {
        lectures[nom].getDataRange++;
        return {
          getValues() {
            lectures[nom].getValues++;
            return [entetes[nom].slice()];
          }
        };
      }
    };
  });

  const classeur = {
    getSheetByName(nom) {
      if (!Object.prototype.hasOwnProperty.call(lectures, nom)) {
        return null;
      }
      lectures[nom].getSheetByName++;
      return feuilles[nom];
    }
  };
  let ouvertures = 0;

  function lireInstantaneSynchronisation(nom) {
    const donnees = classeur
      .getSheetByName(nom)
      .getDataRange()
      .getValues();
    const index = {};
    donnees[0].forEach(function (entete, position) {
      index[String(entete)] = position;
    });
    return { index: index, lignes: donnees.slice(1) };
  }

  const contexte = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        ouvertures++;
        return classeur;
      }
    },
    HtmlService: {
      createTemplateFromFile(nom) {
        return {
          evaluate() {
            return {
              getContent() {
                return '<section>' + nom + '</section>';
              }
            };
          }
        };
      },
      createHtmlOutputFromFile() {
        return { getContent() { return ''; } };
      }
    },
    Session: {
      getScriptTimeZone() { return 'Europe/Paris'; }
    },
    Utilities: {
      formatDate(date, fuseau, format) {
        const valeur = new Date(date);
        const iso = valeur.toISOString();
        if (format === 'yyyy-MM-dd') return iso.slice(0, 10);
        if (format === 'dd/MM/yyyy') {
          return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' +
            iso.slice(0, 4);
        }
        return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' +
          iso.slice(0, 4) + ' ' + iso.slice(11, 16);
      }
    },
    exigerUtilisateurAuthentifie_(jeton, diagnostic) {
      if (diagnostic) {
        diagnostic.operation = 'VALIDATION_SESSION';
        diagnostic.accesPropertiesServiceMs = 2;
        diagnostic.lectureSessionPersistanteMs = 3;
        diagnostic.parsingSessionMs = 1;
        diagnostic.controleExpirationMs = 1;
        diagnostic.lectureCacheAutorisationMs = 1;
        diagnostic.recuperationUtilisateurMs = 0;
        diagnostic.controleStatutMs = 0;
        diagnostic.totalValidationSessionMs = 8;
        diagnostic.totalServeurMs = 8;
      }
      return {
        estAdministrateur: true,
        estFormateur: true,
        idUtilisateur: 'utilisateur_test_123'
      };
    },
    exigerAdministrateurLectureSeule_() {
      return { estAdministrateur: true };
    },
    verifierAccesPage_(nomPage, jeton, diagnostic) {
      if (diagnostic) {
        diagnostic.operation = 'VERIFICATION_ACCES_PAGE';
        diagnostic.controleDroitsMs = 1;
        diagnostic.totalServeurMs = 9;
        diagnostic.appelsAutresServices = [{
          operation: 'VALIDATION_SESSION',
          totalServeurMs: 8
        }];
      }
    },
    synchroniserStatutsStagiairesPourAccueil_(diagnostic) {
      const instantanesAccueil = {
        STAGIAIRES: lireInstantaneSynchronisation('STAGIAIRES'),
        SESSIONS: lireInstantaneSynchronisation('SESSIONS'),
        PRESENCES_STAGIAIRES:
          lireInstantaneSynchronisation('PRESENCES_STAGIAIRES')
      };
      if (diagnostic) {
        diagnostic.ouvertureSpreadsheetMs = 2;
        diagnostic.getDataRangeMs = 3;
        diagnostic.getValuesMs = 4;
        diagnostic.recherchesMs = 5;
        diagnostic.transformationsMs = 6;
        diagnostic.totalServeurMs = 20;
        diagnostic.lecturesFeuilles.push(
          { feuille: 'STAGIAIRES', totalLectureMs: 7 },
          { feuille: 'SESSIONS', totalLectureMs: 5 },
          { feuille: 'PRESENCES_STAGIAIRES', totalLectureMs: 4 }
        );
      }
      return {
        migres: 0,
        automatiquesMisAJour: 0,
        instantanesAccueil: instantanesAccueil
      };
    },
    obtenirDateSansHeure_(valeur) {
      const date = new Date(valeur);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    },
    normaliserStatutStagiaire_(valeur) { return String(valeur || ''); },
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
  vm.runInContext(sourceAccueil, contexte, { filename: 'AccueilService.js' });
  vm.runInContext(sourceFavoris, contexte, { filename: 'FavorisService.js' });
  vm.runInContext(sourceUi, contexte, { filename: 'UI.js' });

  return {
    contexte,
    lectures,
    obtenirOuvertures() { return ouvertures; },
    reinitialiserCompteurs() {
      ouvertures = 0;
      Object.keys(lectures).forEach(function (nom) {
        Object.keys(lectures[nom]).forEach(function (cle) {
          lectures[nom][cle] = 0;
        });
      });
    }
  };
}


function assertLectureUniqueAccueil(lectures) {
  [
    'STAGIAIRES',
    'SESSIONS',
    'PRESENCES_STAGIAIRES',
    'PRESTATIONS_FORMATEURS',
    'FORMATEURS',
    'CATEGORIES',
    'REFERENTIEL',
    'EVALUATIONS'
  ].forEach(function (nom) {
    assert.strictEqual(lectures[nom].getSheetByName, 1, nom);
    assert.strictEqual(lectures[nom].getDataRange, 1, nom);
    assert.strictEqual(lectures[nom].getValues, 1, nom);
  });
}


{
  const environnement = creerEnvironnementServeur();
  const normal = environnement.contexte.getDonneesTableauBordAccueil(
    'jeton_formateur'
  );
  assert.strictEqual(normal.diagnosticAccueil, undefined);
  assertLectureUniqueAccueil(environnement.lectures);

  environnement.reinitialiserCompteurs();
  const diagnostic = environnement.contexte.getDonneesTableauBordAccueil(
    'jeton_formateur',
    { actif: true, modeClientExplicite: true }
  );
  assert(diagnostic.diagnosticAccueil);
  assert.strictEqual(
    diagnostic.diagnosticAccueil.operation,
    'DONNEES_TABLEAU_BORD_ACCUEIL'
  );
  assert.strictEqual(
    diagnostic.diagnosticAccueil.lecturesFeuilles.length,
    5
  );
  assert.deepStrictEqual(
    Array.from(
      diagnostic.diagnosticAccueil.lecturesFeuilles,
      lecture => lecture.feuille
    ),
    [
      'PRESTATIONS_FORMATEURS',
      'FORMATEURS',
      'CATEGORIES',
      'REFERENTIEL',
      'EVALUATIONS'
    ]
  );
  assert.strictEqual(
    diagnostic.diagnosticAccueil.appelsAutresServices[1].operation,
    'SYNCHRONISATION_STATUTS_STAGIAIRES'
  );
  assert.deepStrictEqual(
    Array.from(
      diagnostic.diagnosticAccueil.mutualisationLectures,
      lecture => [lecture.feuille, lecture.mode]
    ),
    [
      ['STAGIAIRES', 'REUTILISEE'],
      ['SESSIONS', 'REUTILISEE'],
      ['PRESENCES_STAGIAIRES', 'REUTILISEE']
    ]
  );
  assert.strictEqual(
    diagnostic.diagnosticAccueil.nombreLecturesSheetsEvitees,
    3
  );
  assert.strictEqual(
    diagnostic.diagnosticAccueil.feuillesLuesUneSeuleFois,
    3
  );
  [
    'ouvertureSpreadsheetMs',
    'recherchesMs',
    'filtragesMs',
    'trisMs',
    'transformationsMs',
    'constructionReponseMs',
    'totalServeurMs'
  ].forEach(function (cle) {
    assert.strictEqual(
      typeof diagnostic.diagnosticAccueil[cle],
      'number',
      cle
    );
  });
  diagnostic.diagnosticAccueil.lecturesFeuilles.forEach(function (lecture) {
    [
      'getSheetByNameMs',
      'getDataRangeMs',
      'getValuesMs',
      'constructionTableMs',
      'totalLectureMs'
    ].forEach(function (cle) {
      assert.strictEqual(typeof lecture[cle], 'number', lecture.feuille + cle);
    });
  });
  assertLectureUniqueAccueil(environnement.lectures);
  assert(!JSON.stringify(diagnostic.diagnosticAccueil).includes(
    'jeton_formateur'
  ));
}


{
  const environnement = creerEnvironnementServeur();
  const normal = environnement.contexte.getFavoris(
    'pfav_123456789012345',
    'jeton_formateur'
  );
  assert(Array.isArray(normal));
  assert.strictEqual(environnement.lectures.FAVORIS.getValues, 1);

  environnement.reinitialiserCompteurs();
  const diagnostic = environnement.contexte.getFavoris(
    'pfav_123456789012345',
    'jeton_formateur',
    { actif: true, modeClientExplicite: true }
  );
  assert(Array.isArray(diagnostic.favoris));
  assert.strictEqual(
    diagnostic.diagnosticAccueil.operation,
    'CHARGEMENT_FAVORIS'
  );
  assert.strictEqual(
    diagnostic.diagnosticAccueil.lecturesFeuilles[0].feuille,
    'FAVORIS'
  );
  assert.strictEqual(environnement.lectures.FAVORIS.getValues, 1);
}


{
  const environnement = creerEnvironnementServeur();
  const normal = environnement.contexte.getPage(
    'Accueil',
    'jeton_formateur'
  );
  assert.strictEqual(normal, '<section>Accueil</section>');

  const diagnostic = environnement.contexte.getPage(
    'Accueil',
    'jeton_formateur',
    { actif: true, modeClientExplicite: true }
  );
  assert.strictEqual(diagnostic.html, '<section>Accueil</section>');
  assert.strictEqual(
    diagnostic.diagnosticAccueil.operation,
    'CHARGEMENT_FRAGMENT_HTML'
  );
  assert.strictEqual(
    typeof diagnostic.diagnosticAccueil.verificationAccesMs,
    'number'
  );
  assert.strictEqual(
    typeof diagnostic.diagnosticAccueil.constructionHtmlMs,
    'number'
  );
}


assert(administrationHtml.includes('Diagnostic chargement accueil'));
assert(administrationHtml.includes(
  'resultatDiagnosticChargementAccueilAdministration'
));
assert(sourceClient.includes("'PARALLELE_AVEC_ACCUEIL'"));
assert(sourceClient.includes("'SEQUENTIEL_ETAPE_1'"));
assert(sourceClient.includes("'SEQUENTIEL_APRES_FRAGMENT_HTML'"));
assert(sourceClient.includes("'Temps serveur cumulé'"));
assert(sourceClient.includes("'Temps google.script.run cumulé'"));
assert(sourceClient.includes("'Traitements client'"));
assert(sourceClient.includes("'Total chargement accueil'"));
assert(sourceClient.includes('Mutualisation des lectures'));
assert(sourceClient.includes('nombreLecturesSheetsEvitees'));
assert(sourceClient.includes('feuillesLuesUneSeuleFois'));
assert(sourceClient.includes("'PREMIERE_LECTURE'"));

[
  'motDePasse',
  'PASSWORD_HASH',
  'PASSWORD_SALT',
  'PEPPER',
  'jetonUtilisateur'
].forEach(function (secret) {
  assert(!sourceAccueil.includes("diagnostic." + secret));
  assert(!sourceFavoris.includes("diagnostic." + secret));
});

console.log(
  '✓ diagnostic détaillé Accueil facultatif, ordonné et sans lecture ajoutée'
);
