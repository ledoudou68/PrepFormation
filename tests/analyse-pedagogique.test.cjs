'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const source = fs.readFileSync(
  path.join(racine, 'AnalysePedagogiqueService.js'),
  'utf8'
);
const metadonnees = fs.readFileSync(
  path.join(racine, 'ApplicationMetadataService.js'),
  'utf8'
);

function creerContexte(supplements) {
  const contexte = Object.assign({
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Set,
    Object,
    Array,
    RegExp,
    Error,
    isNaN,
    exigerUtilisateurAuthentifie_: () => ({
      estFormateur: true,
      idUtilisateur: 'U-TEST',
      idFormateur: 'FO-TEST'
    })
  }, supplements || {});
  vm.createContext(contexte);
  vm.runInContext(source, contexte, {
    filename: 'AnalysePedagogiqueService.js'
  });
  return contexte;
}

function table(entetes, lignes) {
  const index = {};
  entetes.forEach((entete, position) => {
    index[entete] = position;
  });
  return {
    entetes: entetes.slice(),
    index,
    lignes: lignes.map(ligne => ligne.slice())
  };
}

function donneesBase() {
  return {
    STAGIAIRES: table(
      ['UUID', 'FORMATION'],
      [
        ['T1', 'EQ PS'],
        ['T2', 'F2']
      ]
    ),
    FORMATIONS: table(
      ['ID_FORMATION', 'LIBELLE'],
      [
        ['F1', 'EQ PS'],
        ['F2', 'EQ SUAP']
      ]
    ),
    SESSIONS: table(
      ['ID_SESSION', 'DATE_SESSION'],
      [
        ['S1', '2026-01-10'],
        ['S2', '2026-03-10'],
        ['S3', '2026-07-01'],
        ['S4', '2026-07-20'],
        ['SF', '2026-12-01']
      ]
    ),
    PRESENCES_STAGIAIRES: table(
      ['ID_SESSION', 'ID_STAGIAIRE'],
      [
        ['S1', 'T1'],
        ['S1', 'T1'],
        ['S2', 'T1'],
        ['S3', 'T1'],
        ['S4', 'T1'],
        ['SF', 'T1'],
        ['S1', 'T2']
      ]
    ),
    CATEGORIES: table(
      ['ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ORDRE', 'ACTIF'],
      [
        ['C1', 'F1', 'Gestes', 1, true],
        ['C2', 'F1', 'Ancienne catégorie', 2, false],
        ['C3', 'F2', 'Autre formation', 1, true]
      ]
    ),
    REFERENTIEL: table(
      ['ID_ITEM', 'FORMATION', 'ID_CATEGORIE', 'ITEM', 'ORDRE', 'ACTIF'],
      [
        ['I1', 'F1', 'C1', 'Bilan', 1, true],
        ['I2', 'F1', 'C1', 'Oxygénothérapie', 2, true],
        ['I3', 'F1', 'C1', 'Relevage', 3, true],
        ['I4', 'F1', 'C1', 'Ventilation', 4, true],
        ['I5', 'F1', 'C1', 'Item désactivé', 5, false],
        ['I6', 'F1', 'C2', 'Item catégorie inactive', 1, true],
        ['I7', 'F1', 'C1', 'Item jamais travaillé', 6, true],
        ['IX', 'F2', 'C3', 'Hors formation', 1, true]
      ]
    ),
    ITEMS_SESSIONS: table(
      ['ID_SESSION', 'ID_ITEM'],
      [
        ['S1', 'I1'],
        ['S1', 'I1'],
        ['S1', 'I2'],
        ['S1', 'I5'],
        ['S2', 'I1'],
        ['S2', 'I2'],
        ['S2', 'I6'],
        ['S3', 'I2'],
        ['S3', 'I3'],
        ['SF', 'I7']
      ]
    ),
    EVALUATIONS: table(
      [
        'ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM',
        'NIVEAU', 'REMARQUE', 'VU'
      ],
      [
        ['S1', 'T1', 'I1', 'Acquis', '', true],
        ['S1', 'T1', 'I1', 'Acquis', 'Doublon', true],
        ['S1', 'T1', 'I2', 'Non acquis', '', true],
        ['S1', 'T1', 'I7', '', '', true],
        ['S2', 'T1', 'I1', 'Acquis', '', true],
        ['S2', 'T1', 'I2', 'Non acquis', '', true],
        ['S3', 'T1', 'I2', 'Non acquis', '', true],
        ['S3', 'T1', 'I3', 'Acquis', '', true],
        ['S4', 'T1', 'I4', 'Acquis', 'Historique', true],
        ['SF', 'T1', 'I7', 'Acquis', '', true],
        ['S1', 'T2', 'IX', 'Acquis', '', true]
      ]
    )
  };
}

function calculer(tables, uuid, maintenant) {
  const c = creerContexte();
  return c.calculerAnalysePedagogiqueDepuisTables_(
    tables || donneesBase(),
    uuid || 'T1',
    maintenant || new Date(2026, 7, 6, 12),
    []
  );
}

function trouverItem(resultat, idItem) {
  return resultat.items.find(item => item.idItem === idItem);
}

const tests = [];
let dureePerformanceMs = null;

function test(nom, traitement) {
  tests.push({ nom, traitement });
}

test('un stagiaire sans séance reçoit une analyse vide et des priorités', () => {
  const tables = donneesBase();
  tables.PRESENCES_STAGIAIRES.lignes = [];
  const resultat = calculer(tables);
  assert.strictEqual(resultat.synthese.nombreSeances, 0);
  assert.strictEqual(resultat.synthese.premiereSeance, '');
  assert.strictEqual(resultat.synthese.derniereSeance, '');
  assert.strictEqual(resultat.synthese.joursDepuisDerniereSeance, null);
  assert.strictEqual(resultat.synthese.nombreItemsTravailles, 0);
  assert.strictEqual(resultat.synthese.nombreItemsAcquis, 0);
  assert.strictEqual(resultat.synthese.itemsJamaisTravailles.length, 5);
  assert(resultat.recommandationsProchaineSeance.length > 0);
});

test('les séances sont dédupliquées et les séances futures exclues', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.synthese.nombreSeances, 4);
  assert.strictEqual(resultat.synthese.premiereSeance, '2026-01-10');
  assert.strictEqual(resultat.synthese.derniereSeance, '2026-07-20');
  assert.strictEqual(resultat.synthese.joursDepuisDerniereSeance, 17);
});

test('les compteurs portent sur les items actifs de la formation', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.synthese.nombreItemsReferentielActifs, 5);
  assert.strictEqual(resultat.synthese.nombreItemsTravailles, 4);
  assert.strictEqual(resultat.synthese.nombreItemsAcquis, 3);
  assert.deepStrictEqual(
    Array.from(
      resultat.synthese.itemsJamaisTravailles,
      item => item.idItem
    ),
    ['I7']
  );
  assert.deepStrictEqual(
    Array.from(resultat.synthese.itemsJamaisAcquis, item => item.idItem),
    ['I2', 'I7']
  );
});

test('les agrégats par catégorie reprennent uniquement le périmètre actif', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.agregatsParCategorie.length, 1);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(resultat.agregatsParCategorie[0])),
    {
      idCategorie: 'C1',
      categorie: 'Gestes',
      ordre: 1,
      nombreItemsActifs: 5,
      nombreItemsTravailles: 4,
      nombreItemsAcquis: 3,
      pourcentageAcquisition: 60
    }
  );
});

test('une catégorie active sans item actif conserve un taux non calculable', () => {
  const tables = donneesBase();
  tables.CATEGORIES.lignes.push([
    'C4', 'F1', 'Catégorie vide', 2, true
  ]);
  const resultat = calculer(tables);
  const categorie = resultat.agregatsParCategorie.find(
    agregat => agregat.idCategorie === 'C4'
  );
  assert(categorie);
  assert.strictEqual(categorie.nombreItemsActifs, 0);
  assert.strictEqual(categorie.pourcentageAcquisition, null);
});

test('la progression ne compte un item qu’à sa première acquisition', () => {
  const resultat = calculer();
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(resultat.progressionChronologique)),
    [
      {
        date: '2026-01-10', nombreSeances: 1,
        nouvellesAcquisitions: 1, cumulItemsAcquis: 1
      },
      {
        date: '2026-03-10', nombreSeances: 1,
        nouvellesAcquisitions: 0, cumulItemsAcquis: 1
      },
      {
        date: '2026-07-01', nombreSeances: 1,
        nouvellesAcquisitions: 1, cumulItemsAcquis: 2
      },
      {
        date: '2026-07-20', nombreSeances: 1,
        nouvellesAcquisitions: 1, cumulItemsAcquis: 3
      }
    ]
  );
});

test('plusieurs séances et acquisitions le même jour sont regroupées', () => {
  const tables = donneesBase();
  tables.SESSIONS.lignes.push(['S5', '2026-07-01']);
  tables.PRESENCES_STAGIAIRES.lignes.push(['S5', 'T1']);
  tables.ITEMS_SESSIONS.lignes.push(['S5', 'I7']);
  tables.EVALUATIONS.lignes.push([
    'S5', 'T1', 'I7', 'Acquis', '', true
  ]);
  const resultat = calculer(tables);
  const point = resultat.progressionChronologique.find(
    valeur => valeur.date === '2026-07-01'
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(point)), {
    date: '2026-07-01',
    nombreSeances: 2,
    nouvellesAcquisitions: 2,
    cumulItemsAcquis: 3
  });
});

test('les acquisitions et séances futures sont absentes des agrégats visuels', () => {
  const resultat = calculer();
  assert(!resultat.progressionChronologique.some(
    point => point.date === '2026-12-01'
  ));
  assert(!resultat.activiteMensuelle.some(
    mois => mois.mois === '2026-12'
  ));
  assert.strictEqual(
    resultat.progressionChronologique[
      resultat.progressionChronologique.length - 1
    ].cumulItemsAcquis,
    3
  );
});

test('l’activité mensuelle couvre douze mois et déduplique item-séance', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.activiteMensuelle.length, 12);
  assert.strictEqual(resultat.activiteMensuelle[0].mois, '2025-09');
  assert.strictEqual(resultat.activiteMensuelle[11].mois, '2026-08');
  const janvier = resultat.activiteMensuelle.find(
    mois => mois.mois === '2026-01'
  );
  const mars = resultat.activiteMensuelle.find(
    mois => mois.mois === '2026-03'
  );
  const juillet = resultat.activiteMensuelle.find(
    mois => mois.mois === '2026-07'
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(janvier)), {
    mois: '2026-01',
    nombreItemsTravailles: 2,
    nouvellesAcquisitions: 1
  });
  assert.strictEqual(mars.nombreItemsTravailles, 2);
  assert.strictEqual(mars.nouvellesAcquisitions, 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(juillet)), {
    mois: '2026-07',
    nombreItemsTravailles: 3,
    nouvellesAcquisitions: 2
  });
});

test('le nombre de travaux est dédupliqué par séance et par item', () => {
  const resultat = calculer();
  assert.strictEqual(trouverItem(resultat, 'I1').nombreFoisTravaille, 2);
  assert.strictEqual(trouverItem(resultat, 'I2').nombreFoisTravaille, 3);
  assert.strictEqual(resultat.sources.nombreLiaisonsItemsSessions, 8);
});

test('les acquisitions dupliquées ne comptent qu’une fois par séance', () => {
  const resultat = calculer();
  const item = trouverItem(resultat, 'I1');
  assert.strictEqual(item.nombreFoisAcquis, 2);
  assert.strictEqual(item.tauxAcquisition, 100);
});

test('le taux d’acquisition utilise séances acquises sur séances travaillées', () => {
  const resultat = calculer();
  const jamaisAcquis = trouverItem(resultat, 'I2');
  const jamaisTravaille = trouverItem(resultat, 'I7');
  assert.strictEqual(jamaisAcquis.tauxAcquisition, 0);
  assert.strictEqual(jamaisTravaille.tauxAcquisition, null);
});

test('ITEMS_SESSIONS prime sur un VU historique de la même séance', () => {
  const resultat = calculer();
  assert.strictEqual(trouverItem(resultat, 'I7').nombreFoisTravaille, 0);
});

test('EVALUATIONS reconstitue les anciennes séances sans ITEMS_SESSIONS', () => {
  const resultat = calculer();
  const item = trouverItem(resultat, 'I4');
  assert.strictEqual(item.nombreFoisTravaille, 1);
  assert.strictEqual(item.nombreFoisAcquis, 1);
  assert.strictEqual(item.derniereDateTravail, '2026-07-20');
  assert.strictEqual(item.joursDepuisDernierTravail, 17);
  assert.strictEqual(
    resultat.sources.nombreLiaisonsEvaluationsHistoriques,
    1
  );
});

test('une acquisition implique toujours que l’item a été travaillé', () => {
  const tables = donneesBase();
  tables.EVALUATIONS.lignes.push([
    'S1', 'T1', 'I7', 'Acquis', '', false
  ]);
  const resultat = calculer(tables);
  const item = trouverItem(resultat, 'I7');
  assert.strictEqual(item.nombreFoisTravaille, 1);
  assert.strictEqual(item.nombreFoisAcquis, 1);
});

test('les échecs répétés sont distincts par séance', () => {
  const tables = donneesBase();
  tables.EVALUATIONS.lignes.push([
    'S3', 'T1', 'I2', 'Non acquis', 'Doublon', true
  ]);
  const resultat = calculer(tables);
  assert.strictEqual(
    trouverItem(resultat, 'I2').nombreEchecsExplicites,
    3
  );
});

test('un échec incohérent sur un item non travaillé est ignoré', () => {
  const tables = donneesBase();
  tables.EVALUATIONS.lignes.push([
    'S1', 'T1', 'I7', 'Non acquis', '', false
  ]);
  const resultat = calculer(tables);
  const item = trouverItem(resultat, 'I7');
  assert.strictEqual(item.nombreFoisTravaille, 0);
  assert.strictEqual(item.nombreEchecsExplicites, 0);
});

test('les dates de dernier travail et leur ancienneté sont calculées', () => {
  const resultat = calculer();
  const bilan = trouverItem(resultat, 'I1');
  assert.strictEqual(bilan.derniereDateTravail, '2026-03-10');
  assert.strictEqual(bilan.joursDepuisDernierTravail, 149);
});

test('les points forts exigent une acquisition fiable', () => {
  const resultat = calculer();
  const ids = resultat.pointsForts.map(item => item.idItem);
  assert(ids.includes('I1'));
  assert(ids.includes('I3'));
  assert(ids.includes('I4'));
  assert(!ids.includes('I2'));
});

test('les points faibles détectent les non-acquis répétés', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.pointsFaibles[0].idItem, 'I2');
  assert.strictEqual(resultat.pointsFaibles[0].nombreEchecsExplicites, 3);
  assert(resultat.pointsFaibles[0].motifClassement.includes(
    'Aucune acquisition validée'
  ));
  assert(resultat.pointsFaibles[0].motifsClassement.length >= 2);
});

test('les items oubliés regroupent jamais travaillés et anciens', () => {
  const resultat = calculer();
  const ids = resultat.itemsOublies.map(item => item.idItem);
  assert.strictEqual(ids[0], 'I7');
  assert(ids.includes('I1'));
  assert(!ids.includes('I2'));
});

test('le score de priorité expose ses cinq composantes et reste borné', () => {
  const resultat = calculer();
  const jamais = trouverItem(resultat, 'I7');
  const faible = trouverItem(resultat, 'I2');
  assert.deepStrictEqual(
    Object.keys(jamais.composantesScorePriorite).sort(),
    ['acquisition', 'anciennete', 'echecs', 'frequence', 'jamaisTravaille']
  );
  assert.strictEqual(jamais.scorePriorite, 75);
  assert.strictEqual(faible.scorePriorite, 59);
  resultat.items.forEach(item => {
    assert(item.scorePriorite >= 0 && item.scorePriorite <= 100);
  });
});

test('les priorités sont triées par score puis ordre du référentiel', () => {
  const resultat = calculer();
  const scores = resultat.itemsPrioritaires.map(item => item.scorePriorite);
  assert.deepStrictEqual(scores, scores.slice().sort((a, b) => b - a));
  assert.deepStrictEqual(
    Array.from(resultat.itemsPrioritaires, item => item.idItem),
    ['I7', 'I2', 'I1']
  );
});

test('les recommandations sont ordonnées, motivées et limitées', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.recommandationsProchaineSeance[0].rang, 1);
  assert.strictEqual(
    resultat.recommandationsProchaineSeance[0].idItem,
    'I7'
  );
  assert(resultat.recommandationsProchaineSeance[0].motifs.length >= 2);
  assert(resultat.recommandationsProchaineSeance[0].motif.includes(
    'jamais travaillé'
  ));
  assert(
    resultat.recommandationsProchaineSeance.length <=
      resultat.regles.nombreMaxRecommandations
  );
});

test('les items désactivés restent historiques mais jamais prioritaires', () => {
  const resultat = calculer();
  const inactif = trouverItem(resultat, 'I5');
  const categorieInactive = trouverItem(resultat, 'I6');
  assert.strictEqual(inactif.nombreFoisTravaille, 1);
  assert.strictEqual(inactif.compteDansAnalyse, false);
  assert.strictEqual(categorieInactive.compteDansAnalyse, false);
  assert(!resultat.itemsPrioritaires.some(item => item.idItem === 'I5'));
  assert(!resultat.itemsPrioritaires.some(item => item.idItem === 'I6'));
});

test('les items orphelins restent lisibles et produisent un avertissement', () => {
  const tables = donneesBase();
  tables.ITEMS_SESSIONS.lignes.push(['S3', 'ITEM_ORPHELIN']);
  const resultat = calculer(tables);
  const item = trouverItem(resultat, 'ITEM_ORPHELIN');
  assert(item);
  assert.strictEqual(item.historique, true);
  assert(resultat.avertissements.some(message =>
    message.includes('ITEM_ORPHELIN')
  ));
});

test('les libellés et identifiants de formation sont résolus sans collision', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.stagiaire.formationId, 'F1');
  assert.strictEqual(resultat.stagiaire.formation, 'EQ PS');
  assert(!resultat.items.some(item => item.idItem === 'IX'));
});

test('un stagiaire inconnu est refusé explicitement', () => {
  assert.throws(
    () => calculer(donneesBase(), 'INCONNU'),
    /Stagiaire introuvable/
  );
});

test('un identifiant vide ou dangereux est refusé', () => {
  const c = creerContexte();
  assert.throws(() => c.validerUuidAnalysePedagogique_(''), /manquant/);
  assert.throws(
    () => c.validerUuidAnalysePedagogique_('T1\nT2'),
    /invalide/
  );
});

test('les dates invalides et présences orphelines ne bloquent pas l’analyse', () => {
  const tables = donneesBase();
  tables.SESSIONS.lignes.push(['INVALIDE', '31/31/2026']);
  tables.PRESENCES_STAGIAIRES.lignes.push(['INVALIDE', 'T1']);
  const resultat = calculer(tables);
  assert.strictEqual(resultat.synthese.nombreSeances, 4);
  assert(resultat.avertissements.some(message => message.includes('INVALIDE')));
});

test('chaque feuille est lue une fois et aucune migration n’est déclenchée', () => {
  const c = creerContexte();
  const configurations = vm.runInContext(
    'FEUILLES_ANALYSE_PEDAGOGIQUE_',
    c
  );
  const compteurs = {};
  const feuilles = {};

  configurations.forEach(configuration => {
    const entetes = Array.from(configuration.colonnes);
    compteurs[configuration.nom] = 0;
    feuilles[configuration.nom] = {
      getLastRow: () => 1,
      getLastColumn: () => entetes.length,
      getDataRange: () => ({
        getValues: () => {
          compteurs[configuration.nom]++;
          return [entetes];
        }
      })
    };
  });
  c.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: nom => feuilles[nom]
    })
  };
  c.lireTablesAnalysePedagogique_([]);
  Object.values(compteurs).forEach(nombre => assert.strictEqual(nombre, 1));
  assert(!/\.setValue|\.appendRow|insertSheet|deleteSheet|\.clear\(/.test(source));
  assert(!source.includes('executerMutationMetier_'));
  assert(!source.includes('executerMigrations'));
});

test('les nouveaux agrégats n’altèrent aucune table injectée', () => {
  const tables = donneesBase();
  const avant = JSON.stringify(tables);
  calculer(tables);
  assert.strictEqual(JSON.stringify(tables), avant);
});

test('le cache court évite une seconde lecture complète', () => {
  const tables = donneesBase();
  const configurations = [];
  const temporaire = creerContexte();
  vm.runInContext('FEUILLES_ANALYSE_PEDAGOGIQUE_', temporaire)
    .forEach(configuration => configurations.push({
      nom: configuration.nom,
      colonnes: Array.from(configuration.colonnes)
    }));
  const feuilles = {};
  let lectures = 0;

  configurations.forEach(configuration => {
    const tableSource = tables[configuration.nom];
    const valeurs = [tableSource.entetes].concat(tableSource.lignes);
    feuilles[configuration.nom] = {
      getLastRow: () => valeurs.length,
      getLastColumn: () => valeurs[0].length,
      getDataRange: () => ({
        getValues: () => {
          lectures++;
          return valeurs.map(ligne => ligne.slice());
        }
      })
    };
  });

  const cacheMemoire = {};
  const cache = {
    get: cle => cacheMemoire[cle] || null,
    put: (cle, valeur) => { cacheMemoire[cle] = valeur; },
    remove: cle => { delete cacheMemoire[cle]; }
  };
  const c = creerContexte({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: nom => feuilles[nom]
      })
    },
    CacheService: { getScriptCache: () => cache },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: () => [1, 2, 3],
      base64EncodeWebSafe: () => 'cle-cache'
    },
    restaurationBloqueEcritures_: () => false,
    obtenirVersionApplication_: () => '1.6.0'
  });

  const premier = c.getAnalysePedagogiqueStagiaire('T1', {});
  const lecturesApresPremier = lectures;
  const second = c.getAnalysePedagogiqueStagiaire('T1', {});
  assert.strictEqual(lecturesApresPremier, configurations.length);
  assert.strictEqual(lectures, lecturesApresPremier);
  assert.strictEqual(premier.meta.cacheUtilise, false);
  assert.strictEqual(second.meta.cacheUtilise, true);
  assert(source.includes(
    'DUREE_CACHE_ANALYSE_PEDAGOGIQUE_SECONDES_ = 3 * 60'
  ));
});

test('le calcul reste rapide avec plusieurs milliers de séances', () => {
  const tables = donneesBase();
  tables.SESSIONS.lignes = [];
  tables.PRESENCES_STAGIAIRES.lignes = [];
  tables.ITEMS_SESSIONS.lignes = [];
  tables.EVALUATIONS.lignes = [];

  for (let index = 0; index < 5000; index++) {
    const idSession = 'V' + index;
    const mois = String(index % 7 + 1).padStart(2, '0');
    const jour = String(index % 28 + 1).padStart(2, '0');
    const idItem = 'I' + (index % 4 + 1);
    tables.SESSIONS.lignes.push([
      idSession,
      '2026-' + mois + '-' + jour
    ]);
    tables.PRESENCES_STAGIAIRES.lignes.push([idSession, 'T1']);
    tables.ITEMS_SESSIONS.lignes.push([idSession, idItem]);
    tables.EVALUATIONS.lignes.push([
      idSession,
      'T1',
      idItem,
      index % 3 ? 'Non acquis' : 'Acquis',
      '',
      true
    ]);
  }

  const debut = Date.now();
  const resultat = calculer(tables);
  dureePerformanceMs = Date.now() - debut;
  assert.strictEqual(resultat.synthese.nombreSeances, 5000);
  assert.strictEqual(
    resultat.items.slice(0, 4).reduce(
      (total, item) => total + item.nombreFoisTravaille,
      0
    ),
    5000
  );
  assert(
    dureePerformanceMs < 2000,
    'Calcul trop lent : ' + dureePerformanceMs + ' ms'
  );
});

test('la version applicative est centralisée à 2.0.0', () => {
  assert(metadonnees.includes(
    "VERSION_APPLICATION_PREPFORMATION_ = '2.0.0'"
  ));
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
  ' tests du moteur d’analyse pédagogique réussis.\n' +
  'Mesure locale : 5 000 séances analysées en ' +
  dureePerformanceMs + ' ms.\n'
);
