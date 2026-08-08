'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const sourceIndividuelle = fs.readFileSync(
  path.join(racine, 'AnalysePedagogiqueService.js'),
  'utf8'
);
const sourceGroupe = fs.readFileSync(
  path.join(racine, 'AnalyseGroupeService.js'),
  'utf8'
);


function table(entetes, lignes) {
  return [entetes].concat(lignes).map(ligne => ligne.slice());
}


function donneesBase(nombreItems) {
  const totalItems = nombreItems || 12;
  const referentiel = [];
  for (let index = 1; index <= totalItems; index++) {
    referentiel.push([
      'I' + index,
      'F1',
      'C1',
      'Item ' + index,
      index,
      true
    ]);
  }

  return {
    STAGIAIRES: table(
      ['UUID', 'FORMATION'],
      [
        ['T1', 'F1'],
        ['T2', 'F1'],
        ['T3', 'F1']
      ]
    ),
    FORMATIONS: table(
      ['ID_FORMATION', 'LIBELLE'],
      [['F1', 'EQ PS']]
    ),
    SESSIONS: table(
      ['ID_SESSION', 'DATE_SESSION'],
      [
        ['S1', '2020-01-10'],
        ['S2', '2020-02-10'],
        ['S3', '2020-03-10']
      ]
    ),
    PRESENCES_STAGIAIRES: table(
      ['ID_SESSION', 'ID_STAGIAIRE'],
      [
        ['S1', 'T1'],
        ['S2', 'T1'],
        ['S1', 'T2'],
        ['S3', 'T2']
      ]
    ),
    CATEGORIES: table(
      ['ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ORDRE', 'ACTIF'],
      [['C1', 'F1', 'Gestes', 1, true]]
    ),
    REFERENTIEL: table(
      ['ID_ITEM', 'FORMATION', 'ID_CATEGORIE', 'ITEM', 'ORDRE', 'ACTIF'],
      referentiel
    ),
    ITEMS_SESSIONS: table(
      ['ID_SESSION', 'ID_ITEM'],
      [
        ['S1', 'I1'],
        ['S1', 'I2'],
        ['S2', 'I2'],
        ['S3', 'I2'],
        ['S3', 'I3']
      ]
    ),
    EVALUATIONS: table(
      [
        'ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM',
        'NIVEAU', 'REMARQUE', 'VU'
      ],
      [
        ['S1', 'T1', 'I1', 'Acquis', '', true],
        ['S1', 'T1', 'I2', 'Non acquis', '', true],
        ['S2', 'T1', 'I2', 'Non acquis', '', true],
        ['S1', 'T2', 'I1', 'Acquis', '', true],
        ['S3', 'T2', 'I2', 'Acquis', '', true],
        ['S3', 'T2', 'I3', 'Non acquis', '', true]
      ]
    )
  };
}


function clonerValeur(valeur) {
  if (Object.prototype.toString.call(valeur) === '[object Date]') {
    return new Date(valeur.getTime());
  }
  return valeur;
}


function creerEnvironnement(donneesOptionnelles) {
  const donnees = donneesOptionnelles || donneesBase();
  const cacheMemoire = {};
  const lectures = {};
  let totalLectures = 0;
  const feuilles = {};

  Object.keys(donnees).forEach(nom => {
    lectures[nom] = 0;
    feuilles[nom] = {
      getLastRow: () => donnees[nom].length,
      getLastColumn: () => donnees[nom][0].length,
      getDataRange: () => ({
        getValues: () => {
          lectures[nom]++;
          totalLectures++;
          return donnees[nom].map(
            ligne => ligne.map(clonerValeur)
          );
        }
      })
    };
  });

  const cache = {
    get: cle => Object.prototype.hasOwnProperty.call(cacheMemoire, cle)
      ? cacheMemoire[cle]
      : null,
    put: (cle, valeur) => {
      cacheMemoire[cle] = valeur;
    },
    remove: cle => {
      delete cacheMemoire[cle];
    }
  };
  const contexte = {
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Set,
    Map,
    Object,
    Array,
    RegExp,
    Error,
    Boolean,
    isNaN,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: nom => feuilles[nom] || null
      })
    },
    CacheService: {
      getScriptCache: () => cache
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (algorithme, contenu) => Array.from(
        crypto.createHash('sha256').update(String(contenu)).digest()
      ),
      base64EncodeWebSafe: octets => Buffer.from(octets)
        .toString('base64url')
    },
    restaurationBloqueEcritures_: () => false,
    obtenirVersionApplication_: () => '1.9.3'
  };

  vm.createContext(contexte);
  vm.runInContext(sourceIndividuelle, contexte, {
    filename: 'AnalysePedagogiqueService.js'
  });
  vm.runInContext(sourceGroupe, contexte, {
    filename: 'AnalyseGroupeService.js'
  });

  return {
    contexte,
    donnees,
    cacheMemoire,
    lectures,
    get totalLectures() {
      return totalLectures;
    }
  };
}


function nettoyer(objet) {
  return JSON.parse(JSON.stringify(objet));
}


const tests = [];
let dureeVingtStagiairesMs = null;


function test(nom, traitement) {
  tests.push({ nom, traitement });
}


test('un groupe vide retourne des statistiques vides sans lire les feuilles', () => {
  const environnement = creerEnvironnement();
  const resultat = environnement.contexte.getAnalyseGroupe([], {});

  assert.strictEqual(resultat.analyseGlobale.nombreStagiaires, 0);
  assert.strictEqual(resultat.analyseGlobale.nombreItemsActifs, 0);
  assert.strictEqual(resultat.analyseGlobale.homogeneite, 0);
  assert.deepStrictEqual(nettoyer(resultat.priorites), []);
  assert.deepStrictEqual(nettoyer(resultat.recommandations), []);
  assert.strictEqual(environnement.totalLectures, 0);
  assert.strictEqual(resultat.meta.lectureTablesEffectuee, false);
});


test('un stagiaire conserve les compteurs exacts du moteur individuel', () => {
  const environnement = creerEnvironnement();
  const tables = environnement.contexte.lireTablesAnalysePedagogique_([]);
  const individuel = environnement.contexte
    .calculerAnalysePedagogiqueDepuisTables_(
      tables,
      'T1',
      new Date(),
      []
    );
  const resultat = environnement.contexte.getAnalyseGroupe(['T1'], {});

  assert.strictEqual(resultat.analyseGlobale.nombreStagiaires, 1);
  assert.strictEqual(
    resultat.analyseGlobale.nombreItemsActifs,
    individuel.synthese.nombreItemsReferentielActifs
  );
  assert.strictEqual(
    resultat.analyseGlobale.nombreItemsTravailles,
    individuel.synthese.nombreItemsTravailles
  );
  assert.strictEqual(
    resultat.analyseGlobale.nombreItemsAcquis,
    individuel.synthese.nombreItemsAcquis
  );
  assert.strictEqual(resultat.analyseGlobale.homogeneite, 100);
});


test('plusieurs stagiaires sont agrégés par item sans perdre les acquisitions', () => {
  const environnement = creerEnvironnement();
  const resultat = environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});
  const i1 = resultat.analyseGlobale.stagiairesConcernesParItem.find(
    item => item.idItem === 'I1'
  );

  assert.strictEqual(resultat.analyseGlobale.nombreStagiaires, 2);
  assert.strictEqual(resultat.analyseGlobale.nombreItemsActifs, 12);
  assert.strictEqual(resultat.analyseGlobale.nombreItemsTravailles, 3);
  assert.strictEqual(resultat.analyseGlobale.nombreItemsAcquis, 2);
  assert.strictEqual(resultat.analyseGlobale.nombreItemsJamaisAcquis, 10);
  assert(i1);
  assert.strictEqual(typeof i1.nombreStagiairesConcernes, 'number');
  assert(resultat.statistiques.itemsMaitrisesParToutLeGroupe.some(
    item => item.idItem === 'I1'
  ));
});


test('les doublons sont dédupliqués et chaque analyse manque une seule fois', () => {
  const environnement = creerEnvironnement();
  let appelsIndividuels = 0;
  const calculOriginal = environnement.contexte
    .calculerAnalysePedagogiqueDepuisTables_;
  environnement.contexte.calculerAnalysePedagogiqueDepuisTables_ =
    function () {
      appelsIndividuels++;
      return calculOriginal.apply(null, arguments);
    };

  const resultat = environnement.contexte.getAnalyseGroupe(
    ['T1', 'T1', 'T2', 'T2'],
    {}
  );

  assert.strictEqual(resultat.analyseGlobale.nombreStagiaires, 2);
  assert.strictEqual(resultat.perimetre.stagiaires.length, 2);
  assert.strictEqual(appelsIndividuels, 2);
  assert.strictEqual(resultat.meta.nombreAnalysesCalculees, 2);
});


test('un stagiaire inexistant est refusé explicitement', () => {
  const environnement = creerEnvironnement();
  assert.throws(
    () => environnement.contexte.getAnalyseGroupe(['INCONNU'], {}),
    /Stagiaire introuvable : INCONNU/
  );
});


test('un groupe homogène obtient un indice de 100', () => {
  const donnees = donneesBase();
  donnees.EVALUATIONS = donnees.EVALUATIONS.filter(ligne => !(
    ligne[1] === 'T2' && ligne[2] === 'I2'
  ));
  const environnement = creerEnvironnement(donnees);
  const resultat = environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});

  assert.strictEqual(resultat.analyseGlobale.homogeneite, 100);
});


test('un groupe aux acquisitions opposées obtient un indice de 0', () => {
  const donnees = donneesBase();
  donnees.PRESENCES_STAGIAIRES = table(
    ['ID_SESSION', 'ID_STAGIAIRE'],
    [['S1', 'T1'], ['S1', 'T2']]
  );
  donnees.ITEMS_SESSIONS = table(
    ['ID_SESSION', 'ID_ITEM'],
    donnees.REFERENTIEL.slice(1).map(ligne => ['S1', ligne[0]])
  );
  donnees.EVALUATIONS = table(
    [
      'ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM',
      'NIVEAU', 'REMARQUE', 'VU'
    ],
    donnees.REFERENTIEL.slice(1).map(ligne => [
      'S1', 'T2', ligne[0], 'Acquis', '', true
    ])
  );
  const environnement = creerEnvironnement(donnees);
  const resultat = environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});

  assert.strictEqual(resultat.analyseGlobale.homogeneite, 0);
});


test('les priorités et recommandations sont triées, motivées et limitées', () => {
  const environnement = creerEnvironnement(donneesBase(20));
  const resultat = environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});
  const scores = resultat.priorites.map(item => item.scoreMoyen);

  assert(resultat.priorites.length > 1);
  assert(resultat.priorites.length <= 15);
  assert(resultat.recommandations.length > 1);
  assert(resultat.recommandations.length <= 10);
  assert.deepStrictEqual(scores, scores.slice().sort((a, b) => b - a));
  assert(!Object.prototype.hasOwnProperty.call(
    resultat.priorites[0],
    'recommandationsIndividuelles'
  ));
  assert(!Object.prototype.hasOwnProperty.call(
    resultat.priorites[0],
    'niveauxIndividuels'
  ));
  resultat.recommandations.forEach(recommandation => {
    assert(recommandation.item);
    assert(recommandation.categorie);
    assert(recommandation.score >= 0);
    assert(recommandation.niveau);
    assert(recommandation.justification.includes('analyse(s) individuelle(s)'));
    assert(recommandation.nombreStagiairesConcernes > 0);
  });
});


test('les statistiques descriptives exposent dispersion, moyenne et médiane', () => {
  const environnement = creerEnvironnement();
  const resultat = environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});

  assert(resultat.statistiques.dispersionScores >= 0);
  assert(resultat.statistiques.moyenneScores >= 0);
  assert(resultat.statistiques.medianeScores >= 0);
  assert(resultat.statistiques.itemsCritiques.length > 0);
  assert(
    resultat.statistiques.itemsJamaisTravaillesParAuMoinsUnStagiaire.length > 0
  );
});


test('le cache individuel évite toute seconde lecture et tout recalcul', () => {
  const environnement = creerEnvironnement();
  let appelsIndividuels = 0;
  const calculOriginal = environnement.contexte
    .calculerAnalysePedagogiqueDepuisTables_;
  environnement.contexte.calculerAnalysePedagogiqueDepuisTables_ =
    function () {
      appelsIndividuels++;
      return calculOriginal.apply(null, arguments);
    };

  const premier = environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});
  const lecturesPremier = environnement.totalLectures;
  const second = environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});

  assert.strictEqual(lecturesPremier, 8);
  assert.strictEqual(environnement.totalLectures, lecturesPremier);
  assert.strictEqual(appelsIndividuels, 2);
  assert.strictEqual(premier.meta.nombreAnalysesCalculees, 2);
  assert.strictEqual(second.meta.nombreAnalysesCache, 2);
  assert.strictEqual(second.meta.nombreAnalysesCalculees, 0);
});


test('une seule lecture des huit feuilles alimente vingt analyses', () => {
  const donnees = donneesBase(20);
  const lignesStagiaires = [];
  for (let index = 1; index <= 20; index++) {
    lignesStagiaires.push(['P' + index, 'F1']);
  }
  donnees.STAGIAIRES = table(['UUID', 'FORMATION'], lignesStagiaires);
  donnees.PRESENCES_STAGIAIRES = table(
    ['ID_SESSION', 'ID_STAGIAIRE'],
    []
  );
  donnees.ITEMS_SESSIONS = table(['ID_SESSION', 'ID_ITEM'], []);
  donnees.EVALUATIONS = table(
    [
      'ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM',
      'NIVEAU', 'REMARQUE', 'VU'
    ],
    []
  );
  const environnement = creerEnvironnement(donnees);
  const ids = lignesStagiaires.map(ligne => ligne[0]);
  const debut = Date.now();
  const resultat = environnement.contexte.getAnalyseGroupe(ids, {});
  dureeVingtStagiairesMs = Date.now() - debut;

  assert.strictEqual(resultat.analyseGlobale.nombreStagiaires, 20);
  assert.strictEqual(environnement.totalLectures, 8);
  Object.values(environnement.lectures).forEach(nombre => {
    assert.strictEqual(nombre, 1);
  });
  assert(
    dureeVingtStagiairesMs < 500,
    'Analyse de 20 stagiaires trop lente : ' +
      dureeVingtStagiairesMs + ' ms'
  );
});


test('le moteur ne modifie aucune donnée et ne contient aucune écriture métier', () => {
  const environnement = creerEnvironnement();
  const avant = JSON.stringify(environnement.donnees);
  environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});

  assert.strictEqual(JSON.stringify(environnement.donnees), avant);
  assert(!sourceGroupe.includes('SpreadsheetApp'));
  assert(!/\.setValue|\.setValues|\.appendRow|insertSheet|deleteSheet|\.clear\(/.test(
    sourceGroupe
  ));
  assert(!sourceGroupe.includes('executerMigrations'));
  assert(!sourceGroupe.includes('executerMutationMetier_'));
});


test('aucune règle pédagogique du moteur individuel n’est dupliquée', () => {
  assert(sourceGroupe.includes('calculerAnalysePedagogiqueDepuisTables_'));
  assert(sourceGroupe.includes('lireTablesAnalysePedagogique_'));
  assert(sourceGroupe.includes('construireCleCacheAnalysePedagogique_'));
  assert(!sourceGroupe.includes('calculerScorePrioriteAnalysePedagogique_'));
  assert(!sourceGroupe.includes('SEUIL_OUBLI_ANALYSE_PEDAGOGIQUE'));
  assert(!sourceGroupe.includes('SEUIL_CONSOLIDATION_ANALYSE_PEDAGOGIQUE'));
  assert(!sourceGroupe.includes('SEUIL_POINT_FORT_ANALYSE_PEDAGOGIQUE'));
});


test('l’analyse de groupe ne modifie pas les résultats individuels', () => {
  const environnement = creerEnvironnement();
  const tables = environnement.contexte.lireTablesAnalysePedagogique_([]);
  const date = new Date(2026, 7, 8, 12);
  const avant = environnement.contexte.calculerAnalysePedagogiqueDepuisTables_(
    tables,
    'T1',
    date,
    []
  );

  environnement.contexte.getAnalyseGroupe(['T1', 'T2'], {});

  const apres = environnement.contexte.calculerAnalysePedagogiqueDepuisTables_(
    tables,
    'T1',
    date,
    []
  );
  assert.deepStrictEqual(nettoyer(apres), nettoyer(avant));
});


let reussis = 0;
tests.forEach(({ nom, traitement }) => {
  try {
    traitement();
    reussis++;
    process.stdout.write('✓ ' + nom + '\n');
  } catch (erreur) {
    process.stderr.write('✗ ' + nom + '\n');
    throw erreur;
  }
});

process.stdout.write(
  '\n' + reussis + '/' + tests.length +
  ' tests du moteur d’analyse de groupe réussis.\n' +
  'Mesure locale : 20 stagiaires analysés en ' +
  dureeVingtStagiairesMs + ' ms.\n'
);
