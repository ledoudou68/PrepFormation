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
const sourceCache = fs.readFileSync(
  path.join(racine, 'AccueilCacheService.js'),
  'utf8'
);


function cloner(valeur) {
  if (valeur instanceof Date) return new Date(valeur.getTime());
  if (Array.isArray(valeur)) return valeur.map(cloner);
  return valeur;
}


function creerDonnees() {
  const maintenant = new Date();
  const hier = new Date(maintenant.getTime() - 86400000);
  const demain = new Date(maintenant.getTime() + 86400000 * 10);
  return {
    STAGIAIRES: [
      [
        'UUID', 'NOM', 'PRENOM', 'FORMATION',
        'DATE_DEBUT_PREPARATION', 'DATE_STAGE', 'STATUT'
      ],
      ['STG_1', 'Martin', 'Lina', 'EQ PS', hier, demain, 'En préparation']
    ],
    SESSIONS: [
      [
        'ID_SESSION', 'DATE_SESSION', 'HEURE_DEBUT',
        'DUREE_HEURES', 'FORMATION'
      ],
      ['SES_1', hier, '09:00', 2, 'EQ PS']
    ],
    PRESENCES_STAGIAIRES: [
      ['ID_PRESENCE', 'ID_SESSION', 'ID_STAGIAIRE'],
      ['PRE_1', 'SES_1', 'STG_1']
    ],
    PRESTATIONS_FORMATEURS: [
      [
        'ID_PRESTATION', 'ID_SESSION', 'ID_FORMATEUR',
        'DUREE_HEURES', 'STATUT_INDEMNISATION'
      ],
      ['PFO_1', 'SES_1', 'FOR_1', 2, 'À demander']
    ],
    FORMATEURS: [
      ['ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF', 'EMAIL'],
      ['FOR_1', 'Durand', 'Alice', 'Oui', 'alice@example.test']
    ],
    CATEGORIES: [
      ['ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ORDRE', 'ACTIF'],
      ['CAT_1', 'EQ PS', 'Sécurité', 1, 'Oui'],
      ['CAT_2', 'EQ PS', 'Inactive', 2, 'Non']
    ],
    REFERENTIEL: [
      [
        'ID_ITEM', 'FORMATION', 'ID_CATEGORIE',
        'ITEM', 'ORDRE', 'ACTIF'
      ],
      ['ITEM_1', 'EQ PS', 'CAT_1', 'Protection', 1, 'Oui'],
      ['ITEM_2', 'EQ PS', 'CAT_1', 'Inactif', 2, 'Non'],
      ['ITEM_3', 'EQ PS', 'CAT_2', 'Catégorie inactive', 1, 'Oui']
    ],
    EVALUATIONS: [
      ['ID_EVALUATION', 'ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM', 'NIVEAU'],
      ['EVA_1', 'SES_1', 'STG_1', 'ITEM_1', 'Acquis']
    ]
  };
}


function creerEnvironnement(options) {
  const parametres = options || {};
  const matrices = creerDonnees();
  const lectures = {};
  const cache = {};
  const proprietes = {};
  let sequenceUuid = 0;
  let restaurationActive = false;
  let verrouDocument = false;
  let verrouScript = false;
  let actionAvantVerrou = null;
  let administrateur = parametres.administrateur !== false;

  Object.keys(matrices).forEach(function (nom) {
    lectures[nom] = 0;
  });

  const feuilles = {};
  Object.keys(matrices).forEach(function (nom) {
    feuilles[nom] = {
      getLastRow() { return matrices[nom].length; },
      getLastColumn() {
        return matrices[nom][0] ? matrices[nom][0].length : 0;
      },
      getDataRange() {
        return {
          getValues() {
            lectures[nom]++;
            return cloner(matrices[nom]);
          }
        };
      }
    };
  });

  const classeur = {
    getSheetByName(nom) { return feuilles[nom] || null; }
  };
  const scriptProperties = {
    getProperty(cle) { return proprietes[cle] || null; },
    setProperty(cle, valeur) {
      proprietes[cle] = String(valeur);
      return scriptProperties;
    }
  };
  const scriptCache = {
    get(cle) { return cache[cle] || null; },
    put(cle, valeur) { cache[cle] = String(valeur); },
    remove(cle) { delete cache[cle]; }
  };

  const contexte = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet() { return classeur; }
    },
    CacheService: {
      getScriptCache() { return scriptCache; }
    },
    PropertiesService: {
      getScriptProperties() { return scriptProperties; }
    },
    LockService: {
      getDocumentLock() {
        return {
          hasLock() { return verrouDocument; },
          tryLock() {
            if (actionAvantVerrou) {
              const action = actionAvantVerrou;
              actionAvantVerrou = null;
              action();
            }
            verrouDocument = true;
            return true;
          },
          releaseLock() { verrouDocument = false; }
        };
      },
      getScriptLock() {
        return {
          hasLock() { return verrouScript; },
          tryLock() {
            verrouScript = true;
            return true;
          },
          releaseLock() { verrouScript = false; }
        };
      }
    },
    Utilities: {
      getUuid() {
        sequenceUuid++;
        return 'generation_test_' + sequenceUuid;
      },
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
    Session: {
      getScriptTimeZone() { return 'Europe/Paris'; }
    },
    restaurationBloqueEcritures_() { return restaurationActive; },
    synchroniserStatutsStagiairesPourAccueil_() {
      return { migres: 0, automatiquesMisAJour: 0 };
    },
    exigerUtilisateurAuthentifie_() {
      return {
        estAdministrateur: administrateur,
        estFormateur: !administrateur,
        idUtilisateur: administrateur ? '' : 'USR_1'
      };
    },
    exigerAdministrateurLectureSeule_() {
      if (!administrateur) throw new Error('Accès refusé');
      return { estAdministrateur: true };
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

  vm.runInContext(sourceAccueil, contexte, {
    filename: 'AccueilService.js'
  });
  vm.runInContext(sourceCache, contexte, {
    filename: 'AccueilCacheService.js'
  });

  return {
    contexte,
    classeur,
    matrices,
    lectures,
    cache,
    proprietes,
    setRestaurationActive(valeur) {
      restaurationActive = Boolean(valeur);
    },
    setAdministrateur(valeur) { administrateur = Boolean(valeur); },
    avantVerrou(action) { actionAvantVerrou = action; },
    reinitialiserLectures() {
      Object.keys(lectures).forEach(function (nom) { lectures[nom] = 0; });
    }
  };
}


function creerDiagnostic(contexte) {
  return contexte.creerDiagnosticServeurChargementAccueil_('TEST_CACHE');
}


function normaliserReponse(reponse) {
  const copie = JSON.parse(JSON.stringify(reponse));
  delete copie.dateActualisation;
  delete copie.diagnosticAccueil;
  return copie;
}


function normaliserReferentiel(valeur) {
  const resultat = {};
  Object.keys(valeur).forEach(function (formation) {
    resultat[formation] = Array.from(valeur[formation]).sort();
  });
  return resultat;
}


{
  const environnement = creerEnvironnement();
  const diagnosticPremier = creerDiagnostic(environnement.contexte);
  const premier = environnement.contexte
    .obtenirIndexFormateursCacheAccueil_(
      environnement.classeur,
      diagnosticPremier
    );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(premier)),
    { FOR_1: 'Alice Durand' }
  );
  assert.strictEqual(environnement.lectures.FORMATEURS, 1);
  assert.strictEqual(diagnosticPremier.cachesCibles[0].statut, 'RECONSTRUIT');
  assert.strictEqual(diagnosticPremier.cachesCibles[0].origine, 'MISS');

  const diagnosticSecond = creerDiagnostic(environnement.contexte);
  const second = environnement.contexte
    .obtenirIndexFormateursCacheAccueil_(
      environnement.classeur,
      diagnosticSecond
    );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(second)),
    JSON.parse(JSON.stringify(premier))
  );
  assert.strictEqual(environnement.lectures.FORMATEURS, 1);
  assert.strictEqual(diagnosticSecond.cachesCibles[0].statut, 'HIT');
  assert.strictEqual(
    diagnosticSecond.nombreLecturesSheetsEviteesCaches,
    1
  );

  environnement.matrices.FORMATEURS[1][1] = 'Renommé';
  environnement.contexte.invaliderCacheFormateursAccueil_(
    'MODIFICATION_FORMATEUR'
  );
  const apresMutation = environnement.contexte
    .obtenirIndexFormateursCacheAccueil_(
      environnement.classeur,
      creerDiagnostic(environnement.contexte)
    );
  assert.strictEqual(apresMutation.FOR_1, 'Alice Renommé');
  assert.strictEqual(environnement.lectures.FORMATEURS, 2);
}


{
  const environnement = creerEnvironnement();
  const direct = environnement.contexte.lireItemsActifsParFormationAccueil_(
    environnement.contexte.lireTableAccueil_(
      environnement.classeur,
      'CATEGORIES'
    ),
    environnement.contexte.lireTableAccueil_(
      environnement.classeur,
      'REFERENTIEL'
    )
  );
  environnement.reinitialiserLectures();
  const diagnosticPremier = creerDiagnostic(environnement.contexte);
  const premier = environnement.contexte
    .obtenirReferentielActifCacheAccueil_(
      environnement.classeur,
      diagnosticPremier
    );
  assert.deepStrictEqual(
    normaliserReferentiel(premier),
    normaliserReferentiel(direct)
  );
  assert.deepStrictEqual(normaliserReferentiel(premier), {
    'EQ PS': ['ITEM_1']
  });
  assert.strictEqual(environnement.lectures.CATEGORIES, 1);
  assert.strictEqual(environnement.lectures.REFERENTIEL, 1);
  assert.strictEqual(diagnosticPremier.cachesCibles[0].statut, 'RECONSTRUIT');

  const diagnosticSecond = creerDiagnostic(environnement.contexte);
  environnement.contexte.obtenirReferentielActifCacheAccueil_(
    environnement.classeur,
    diagnosticSecond
  );
  assert.strictEqual(environnement.lectures.CATEGORIES, 1);
  assert.strictEqual(environnement.lectures.REFERENTIEL, 1);
  assert.strictEqual(diagnosticSecond.cachesCibles[0].statut, 'HIT');
  assert.strictEqual(
    diagnosticSecond.nombreLecturesSheetsEviteesCaches,
    2
  );

  environnement.matrices.CATEGORIES[1][4] = 'Non';
  environnement.contexte.invaliderCacheReferentielAccueil_(
    'MUTATION_CATEGORIE'
  );
  const apresCategorie = environnement.contexte
    .obtenirReferentielActifCacheAccueil_(
      environnement.classeur,
      creerDiagnostic(environnement.contexte)
    );
  assert.deepStrictEqual(normaliserReferentiel(apresCategorie), {});

  environnement.matrices.CATEGORIES[1][4] = 'Oui';
  environnement.matrices.REFERENTIEL[1][5] = 'Non';
  environnement.contexte.invaliderCacheReferentielAccueil_(
    'MUTATION_ITEM'
  );
  const apresItem = environnement.contexte
    .obtenirReferentielActifCacheAccueil_(
      environnement.classeur,
      creerDiagnostic(environnement.contexte)
    );
  assert.deepStrictEqual(normaliserReferentiel(apresItem), {});
}


{
  const environnement = creerEnvironnement();
  environnement.cache.PF_ACCUEIL_FORMATEURS_V1 = '{cache-invalide';
  const diagnostic = creerDiagnostic(environnement.contexte);
  environnement.contexte.obtenirIndexFormateursCacheAccueil_(
    environnement.classeur,
    diagnostic
  );
  assert.strictEqual(environnement.lectures.FORMATEURS, 1);
  assert.strictEqual(diagnostic.cachesCibles[0].origine, 'CORROMPU');

  environnement.proprietes.PREPFORMATION_ACCUEIL_CACHES_GENERATIONS =
    JSON.stringify({
      version: 1,
      FORMATEURS: 'GENERATION_NOUVELLE',
      REFERENTIEL: 'GENERATION_INITIALE'
    });
  const diagnosticGeneration = creerDiagnostic(environnement.contexte);
  environnement.contexte.obtenirIndexFormateursCacheAccueil_(
    environnement.classeur,
    diagnosticGeneration
  );
  assert.strictEqual(environnement.lectures.FORMATEURS, 2);
  assert.strictEqual(
    diagnosticGeneration.cachesCibles[0].origine,
    'GENERATION_DIFFERENTE'
  );
}


{
  const environnement = creerEnvironnement();
  environnement.contexte.obtenirIndexFormateursCacheAccueil_(
    environnement.classeur,
    creerDiagnostic(environnement.contexte)
  );
  const cacheAvant = environnement.cache.PF_ACCUEIL_FORMATEURS_V1;
  environnement.proprietes.PREPFORMATION_ACCUEIL_CACHES_GENERATIONS =
    '{generations-invalides';
  environnement.matrices.FORMATEURS[1][1] = 'Source autoritaire';
  const diagnostic = creerDiagnostic(environnement.contexte);
  const valeur = environnement.contexte
    .obtenirIndexFormateursCacheAccueil_(
      environnement.classeur,
      diagnostic
    );
  assert.strictEqual(valeur.FOR_1, 'Alice Source autoritaire');
  assert.strictEqual(
    diagnostic.cachesCibles[0].origine,
    'GENERATIONS_INDISPONIBLES'
  );
  assert.strictEqual(
    environnement.cache.PF_ACCUEIL_FORMATEURS_V1,
    cacheAvant
  );
}


{
  const environnement = creerEnvironnement();
  environnement.avantVerrou(function () {
    environnement.cache.PF_ACCUEIL_FORMATEURS_V1 = JSON.stringify({
      version: 1,
      famille: 'FORMATEURS',
      generation: 'GENERATION_INITIALE',
      dureeLectureSheetsMs: 321,
      donnees: { FOR_CONCURRENT: 'Cache concurrent' }
    });
  });
  const diagnostic = creerDiagnostic(environnement.contexte);
  const valeur = environnement.contexte
    .obtenirIndexFormateursCacheAccueil_(
      environnement.classeur,
      diagnostic
    );
  assert.strictEqual(valeur.FOR_CONCURRENT, 'Cache concurrent');
  assert.strictEqual(environnement.lectures.FORMATEURS, 0);
  assert.strictEqual(diagnostic.cachesCibles[0].statut, 'HIT');
  assert.strictEqual(
    diagnostic.cachesCibles[0].origine,
    'RECONSTRUCTION_CONCURRENTE'
  );
}


{
  const environnement = creerEnvironnement();
  environnement.contexte.obtenirIndexFormateursCacheAccueil_(
    environnement.classeur,
    creerDiagnostic(environnement.contexte)
  );
  const cacheAvant = environnement.cache.PF_ACCUEIL_FORMATEURS_V1;
  environnement.matrices.FORMATEURS[1][1] = 'Valeur staging';
  environnement.setRestaurationActive(true);
  const diagnostic = creerDiagnostic(environnement.contexte);
  const valeur = environnement.contexte
    .obtenirIndexFormateursCacheAccueil_(
      environnement.classeur,
      diagnostic
    );
  assert.strictEqual(valeur.FOR_1, 'Alice Valeur staging');
  assert.strictEqual(diagnostic.cachesCibles[0].statut, 'MISS');
  assert.strictEqual(diagnostic.cachesCibles[0].origine, 'RESTAURATION');
  assert.strictEqual(
    environnement.cache.PF_ACCUEIL_FORMATEURS_V1,
    cacheAvant
  );
}


[
  true,
  false
].forEach(function (administrateur) {
  const environnement = creerEnvironnement({ administrateur });
  const premier = environnement.contexte.getDonneesTableauBordAccueil(
    'jeton_utilisateur',
    administrateur
      ? { actif: true, modeClientExplicite: true }
      : undefined
  );
  const second = environnement.contexte.getDonneesTableauBordAccueil(
    'jeton_utilisateur',
    administrateur
      ? { actif: true, modeClientExplicite: true }
      : undefined
  );
  assert.deepStrictEqual(normaliserReponse(second), normaliserReponse(premier));
  assert.strictEqual(environnement.lectures.FORMATEURS, 1);
  assert.strictEqual(environnement.lectures.CATEGORIES, 1);
  assert.strictEqual(environnement.lectures.REFERENTIEL, 1);
  if (administrateur) {
    assert.strictEqual(second.diagnosticAccueil.cachesCibles.length, 2);
    assert.strictEqual(
      second.diagnosticAccueil.nombreLecturesSheetsEviteesCaches,
      3
    );
    const diagnosticSerialise = JSON.stringify(
      second.diagnosticAccueil.cachesCibles
    );
    [
      'Alice Durand',
      'FOR_1',
      'ITEM_1',
      'EQ PS',
      'Lina Martin'
    ].forEach(function (donneeMetier) {
      assert(!diagnosticSerialise.includes(donneeMetier));
    });
  }
});


const sourcesInvalidations = {
  formateurs: fs.readFileSync(
    path.join(racine, 'FormateursService.js'),
    'utf8'
  ),
  referentiel: fs.readFileSync(
    path.join(racine, 'ReferentielService.js'),
    'utf8'
  ),
  importReferentiel: fs.readFileSync(
    path.join(racine, 'ImportReferentielService.js'),
    'utf8'
  ),
  administration: fs.readFileSync(
    path.join(racine, 'AdministrationService.js'),
    'utf8'
  ),
  migration: fs.readFileSync(
    path.join(racine, 'MigrationService.js'),
    'utf8'
  ),
  restauration: fs.readFileSync(
    path.join(racine, 'RestaurationService.js'),
    'utf8'
  ),
  reinitialisation: fs.readFileSync(
    path.join(racine, 'ReinitialisationProductionService.js'),
    'utf8'
  ),
  initialisation: fs.readFileSync(
    path.join(racine, 'Code.js'),
    'utf8'
  )
};

assert(sourcesInvalidations.formateurs.includes(
  'invaliderCacheFormateursAccueil_('
));
assert(sourcesInvalidations.referentiel.includes(
  'invaliderCacheReferentielAccueil_('
));
assert(sourcesInvalidations.importReferentiel.includes(
  "invaliderCacheReferentielAccueil_('IMPORT_REFERENTIEL')"
));
assert(sourcesInvalidations.administration.includes(
  "invaliderCacheReferentielAccueil_("
));
[
  sourcesInvalidations.migration,
  sourcesInvalidations.restauration,
  sourcesInvalidations.reinitialisation,
  sourcesInvalidations.initialisation
].forEach(function (source) {
  assert(source.includes('invaliderTousCachesCiblesAccueil_('));
});
assert(sourceCache.includes("nom === 'FORMATEURS'"));
assert(sourceCache.includes("['CATEGORIES', 'REFERENTIEL'].includes(nom)"));
assert(!sourceCache.includes('.getProperties()'));

console.log(
  '✓ caches Accueil ciblés : cohérence, invalidation, concurrence et diagnostic'
);
