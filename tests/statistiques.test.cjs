'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const source = fs.readFileSync(
  path.join(racine, 'StatistiquesService.js'),
  'utf8'
);
const interfaceHtml = fs.readFileSync(
  path.join(racine, 'Statistiques.html'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(racine, 'CSS.html'),
  'utf8'
);
const navigation = fs.readFileSync(
  path.join(racine, 'Index.html'),
  'utf8'
);
const restauration = fs.readFileSync(
  path.join(racine, 'RestaurationService.js'),
  'utf8'
);

function creerContexte() {
  const contexte = {
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
    isNaN
  };
  vm.createContext(contexte);
  vm.runInContext(source, contexte, {
    filename: 'StatistiquesService.js'
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
    FORMATIONS: table(
      ['ID_FORMATION', 'LIBELLE', 'ORDRE', 'ACTIF'],
      [
        ['F1', 'EQ PS', 1, true],
        ['F2', 'EQ SUAP', 2, true]
      ]
    ),
    FORMATEURS: table(
      ['ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF'],
      [
        ['A', 'Alpha', 'Alice', true],
        ['B', 'Bravo', 'Bob', true],
        ['C', 'Charlie', 'Chloé', false]
      ]
    ),
    STAGIAIRES: table(
      ['UUID', 'FORMATION', 'STATUT', 'DATE_CLOTURE'],
      [
        ['T1', 'EQ PS', 'Clôturé', '2026-01-15'],
        ['T2', 'F1', 'En préparation', ''],
        ['T3', 'F2', 'En préparation', ''],
        ['T4', 'F1', 'Clôturé', '']
      ]
    ),
    SESSIONS: table(
      ['ID_SESSION', 'DATE_SESSION', 'FORMATION'],
      [
        ['S1', '2026-01-10', 'F1'],
        ['S2', '2026-01-20', 'EQ PS'],
        ['S3', '2026-02-10', 'F2'],
        ['SF', '2026-12-10', 'F1']
      ]
    ),
    PRESENCES_STAGIAIRES: table(
      ['ID_SESSION', 'ID_STAGIAIRE'],
      [
        ['S1', 'T1'],
        ['S1', 'T1'],
        ['S1', 'T2'],
        ['S2', 'T1'],
        ['S3', 'T3'],
        ['SF', 'T1']
      ]
    ),
    PRESTATIONS_FORMATEURS: table(
      ['ID_PRESTATION', 'ID_SESSION', 'ID_FORMATEUR', 'DUREE_HEURES'],
      [
        ['P1', 'S1', 'A', 2],
        ['P2', 'S2', 'A', 2],
        ['P3', 'S2', 'B', 2],
        ['P4', 'S3', 'B', 3],
        ['PF', 'SF', 'A', 4]
      ]
    ),
    CATEGORIES: table(
      ['ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ORDRE', 'ACTIF'],
      [
        ['C1', 'F1', 'Gestes', 1, true],
        ['C2', 'F1', 'Ancienne catégorie', 2, false],
        ['C3', 'F2', 'Secours', 1, true]
      ]
    ),
    REFERENTIEL: table(
      ['ID_ITEM', 'FORMATION', 'ID_CATEGORIE', 'ITEM', 'ORDRE', 'ACTIF'],
      [
        ['I1', 'F1', 'C1', 'Bilan', 1, true],
        ['I2', 'F1', 'C1', 'Oxygénothérapie', 2, true],
        ['I3', 'F1', 'C2', 'Ancien geste', 1, true],
        ['I4', 'F2', 'C3', 'Relevage', 1, true],
        ['I5', 'F1', 'C1', 'Item désactivé', 3, false]
      ]
    ),
    ITEMS_SESSIONS: table(
      ['ID_SESSION', 'ID_ITEM'],
      [
        ['S1', 'I1'],
        ['S1', 'I1'],
        ['S1', 'I3'],
        ['S3', 'I4'],
        ['SF', 'I2']
      ]
    ),
    EVALUATIONS: table(
      ['ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM', 'NIVEAU', 'REMARQUE', 'VU'],
      [
        ['S1', 'T1', 'I2', 'Acquis', '', true],
        ['S2', 'T1', 'I1', 'Acquis', 'Bien', true],
        ['S2', 'T1', 'I1', 'Acquis', 'Doublon', true],
        ['S2', 'T2', 'I2', '', '', false]
      ]
    )
  };
}

function filtres(options) {
  return Object.assign({
    periode: 'PERSONNALISEE',
    dateDebut: new Date(2026, 0, 1, 12),
    dateFin: new Date(2026, 7, 6, 12),
    formationId: '',
    formateurId: '',
    inclureFormateursSansActivite: false,
    inclureItemsInactifs: false
  }, options || {});
}

function calculer(tables, options) {
  const c = creerContexte();
  return c.calculerStatistiquesDepuisTables_(
    tables || donneesBase(),
    filtres(options),
    new Date(2026, 7, 6, 12),
    []
  );
}

const tests = [];
let dureePerformanceMs = null;
function test(nom, traitement) {
  tests.push({ nom, traitement });
}

test('une période sans données renvoie des états vides cohérents', () => {
  const resultat = calculer(donneesBase(), {
    dateDebut: new Date(2025, 0, 1, 12),
    dateFin: new Date(2025, 0, 31, 12)
  });
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 0);
  assert.strictEqual(resultat.indicateurs.stagiairesAccompagnes, 0);
  assert.strictEqual(resultat.indicateurs.volumeHoraireFormateurs, 0);
  assert.strictEqual(resultat.indicateurs.tempsEntreSeances.calculable, false);
});

test('une seule séance est comptée mais ne produit aucun intervalle', () => {
  const resultat = calculer(donneesBase(), {
    dateDebut: new Date(2026, 0, 10, 12),
    dateFin: new Date(2026, 0, 10, 12)
  });
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 1);
  assert.strictEqual(resultat.indicateurs.tempsEntreSeances.nombreIntervalles, 0);
});

test('plusieurs séances alimentent tous les indicateurs généraux', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 3);
  assert.strictEqual(resultat.indicateurs.stagiairesAccompagnes, 3);
  assert.strictEqual(resultat.indicateurs.preparationsCloturees, 1);
  assert.strictEqual(resultat.indicateurs.volumeHoraireFormateurs, 9);
  assert.strictEqual(resultat.indicateurs.tempsEntreSeances.moyenneJours, 10);
  assert.strictEqual(resultat.indicateurs.tempsEntreSeances.medianeJours, 10);
  assert.strictEqual(resultat.indicateurs.tempsEntreSeances.nombreIntervalles, 1);
});

test('les séances futures et leurs heures sont exclues', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 3);
  assert.strictEqual(resultat.indicateurs.volumeHoraireFormateurs, 9);
  assert(!resultat.evolutionMensuelle.some(mois => mois.cle === '2026-12'));
});

test('le filtre formation utilise ID_FORMATION et ses alias historiques', () => {
  const resultat = calculer(donneesBase(), { formationId: 'F1' });
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 2);
  assert.strictEqual(resultat.indicateurs.stagiairesAccompagnes, 2);
  assert.strictEqual(resultat.indicateurs.volumeHoraireFormateurs, 6);
  assert(resultat.items.moinsTravailles.some(item => item.idItem === 'I2'));
  assert(!resultat.items.moinsTravailles.some(item => item.idItem === 'I4'));
});

test('le filtre formateur restreint séances, heures et stagiaires', () => {
  const resultat = calculer(donneesBase(), { formateurId: 'A' });
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 2);
  assert.strictEqual(resultat.indicateurs.volumeHoraireFormateurs, 4);
  assert.strictEqual(resultat.indicateurs.stagiairesAccompagnes, 2);
  assert.strictEqual(resultat.formateurs.lignes.length, 1);
  assert.strictEqual(resultat.formateurs.lignes[0].idFormateur, 'A');
});

test('les ID_SESSION et ID_PRESTATION dupliqués ne sont comptés qu’une fois', () => {
  const tables = donneesBase();
  tables.SESSIONS.lignes.push(['S1', '2026-01-11', 'F1']);
  tables.PRESTATIONS_FORMATEURS.lignes.push(['P1', 'S1', 'A', 99]);
  const resultat = calculer(tables);
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 3);
  assert.strictEqual(resultat.indicateurs.volumeHoraireFormateurs, 9);
  assert(resultat.avertissements.some(message => message.includes('ID_SESSION')));
  assert(resultat.avertissements.some(message => message.includes('ID_PRESTATION')));
});

test('les présences dupliquées ne doublent pas les stagiaires', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.indicateurs.stagiairesAccompagnes, 3);
  const alice = resultat.formateurs.lignes.find(ligne => ligne.idFormateur === 'A');
  assert.strictEqual(alice.nombreStagiairesDistincts, 2);
  assert.strictEqual(alice.moyenneStagiairesParSeance, 1.5);
});

test('les clôtures sans date ne sont jamais inventées', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.indicateurs.preparationsCloturees, 1);
});

test('la moyenne et la médiane utilisent tous les intervalles consécutifs', () => {
  const tables = donneesBase();
  tables.PRESENCES_STAGIAIRES.lignes.push(['S3', 'T1']);
  const resultat = calculer(tables);
  assert.strictEqual(resultat.indicateurs.tempsEntreSeances.nombreIntervalles, 2);
  assert.strictEqual(resultat.indicateurs.tempsEntreSeances.moyenneJours, 15.5);
  assert.strictEqual(resultat.indicateurs.tempsEntreSeances.medianeJours, 15.5);
});

test('les heures par formateur dédupliquent les séances mais pas les prestations', () => {
  const resultat = calculer();
  const alice = resultat.formateurs.lignes.find(ligne => ligne.idFormateur === 'A');
  const bob = resultat.formateurs.lignes.find(ligne => ligne.idFormateur === 'B');
  assert.strictEqual(alice.nombreSeances, 2);
  assert.strictEqual(alice.totalHeures, 4);
  assert.strictEqual(bob.nombreSeances, 2);
  assert.strictEqual(bob.totalHeures, 5);
  assert.strictEqual(bob.derniereSeance, '2026-02-10');
});

test('une séance avec plusieurs formateurs reste une seule FMA', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 3);
  assert.strictEqual(
    resultat.formateurs.lignes.filter(ligne => ligne.nombreSeances).length,
    2
  );
});

test('les formateurs sans activité sont optionnels et absents sous filtre', () => {
  const avecInactifs = calculer(donneesBase(), {
    inclureFormateursSansActivite: true
  });
  assert(avecInactifs.formateurs.lignes.some(ligne => ligne.idFormateur === 'C'));

  const filtre = calculer(donneesBase(), {
    formateurId: 'A',
    inclureFormateursSansActivite: true
  });
  assert.deepStrictEqual(
    Array.from(filtre.formateurs.lignes, ligne => ligne.idFormateur),
    ['A']
  );
});

test('ITEMS_SESSIONS prime et les évaluations dupliquées servent seulement de repli', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.items.totalOccurrences, 4);
  assert.strictEqual(resultat.items.sources.occurrencesItemsSessions, 3);
  assert.strictEqual(resultat.items.sources.occurrencesEvaluationsHistoriques, 1);
  const bilan = resultat.items.plusTravailles.find(item => item.idItem === 'I1');
  assert.strictEqual(bilan.nombreSeances, 2);
});

test('une acquisition historique reste un travail même avec VU négatif', () => {
  const tables = donneesBase();
  tables.EVALUATIONS.lignes.push([
    'S2', 'T2', 'I2', 'Acquis', '', false
  ]);
  const resultat = calculer(tables);
  const item = resultat.items.plusTravailles.find(
    ligne => ligne.idItem === 'I2'
  );
  assert(item);
  assert.strictEqual(item.nombreSeances, 1);
});

test('un item actif jamais travaillé est prioritaire dans les moins travaillés', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.items.moinsTravailles[0].idItem, 'I2');
  assert.strictEqual(resultat.items.moinsTravailles[0].nombreSeances, 0);
});

test('une catégorie inactive reste historique mais sort du classement courant', () => {
  const resultat = calculer();
  const historique = resultat.items.repartitionCategories.find(
    categorie => categorie.idCategorie === 'C2'
  );
  assert(historique);
  assert.strictEqual(historique.actif, false);
  assert(!resultat.items.plusTravailles.some(item => item.idItem === 'I3'));
});

test('l’option dédiée réintègre les items inactifs', () => {
  const resultat = calculer(donneesBase(), { inclureItemsInactifs: true });
  const ids = resultat.items.moinsTravailles.map(item => item.idItem);
  assert(ids.includes('I5'));
  assert(ids.includes('I3'));
});

test('les références orphelines produisent un avertissement sans planter', () => {
  const tables = donneesBase();
  tables.PRESENCES_STAGIAIRES.lignes.push(['INCONNUE', 'T9']);
  tables.PRESTATIONS_FORMATEURS.lignes.push(['PX', 'INCONNUE', 'A', 2]);
  tables.ITEMS_SESSIONS.lignes.push(['S1', 'ITEM_INCONNU']);
  const resultat = calculer(tables);
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 3);
  assert(resultat.avertissements.some(message => message.includes('orpheline')));
  assert(resultat.avertissements.some(message => message.includes('ITEM_INCONNU')));
});

test('une évolution sans période précédente ne produit aucun pourcentage trompeur', () => {
  const resultat = calculer();
  assert.strictEqual(resultat.indicateurs.fmaRealisees.evolutionCalculable, false);
  assert.strictEqual(resultat.indicateurs.fmaRealisees.evolutionPourcentage, null);
});

test('chaque feuille utile est lue une seule fois et aucune écriture n’est appelée', () => {
  const c = creerContexte();
  const compteurs = {};
  const feuilles = {};

  vm.runInContext('FEUILLES_STATISTIQUES_', c).forEach(configuration => {
    compteurs[configuration.nom] = 0;
    const entetes = configuration.colonnes.slice();
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

  c.lireTablesStatistiques_([]);
  Object.values(compteurs).forEach(nombre => assert.strictEqual(nombre, 1));
  assert(!/\.setValues\(|\.appendRow\(|insertSheet\(/.test(source));
  assert(!source.includes('executerMutationMetier_'));
});

test('le calcul supporte plusieurs milliers de séances en mémoire', () => {
  const tables = donneesBase();
  tables.SESSIONS.lignes = [];
  tables.PRESENCES_STAGIAIRES.lignes = [];
  tables.PRESTATIONS_FORMATEURS.lignes = [];
  tables.ITEMS_SESSIONS.lignes = [];
  tables.EVALUATIONS.lignes = [];

  for (let index = 0; index < 5000; index++) {
    const id = 'S' + index;
    const jour = String(index % 28 + 1).padStart(2, '0');
    const mois = String(index % 7 + 1).padStart(2, '0');
    tables.SESSIONS.lignes.push([id, '2026-' + mois + '-' + jour, 'F1']);
    tables.PRESENCES_STAGIAIRES.lignes.push([id, 'T' + (index % 400)]);
    tables.PRESTATIONS_FORMATEURS.lignes.push([
      'P' + index, id, index % 2 ? 'A' : 'B', 1.5
    ]);
  }

  const debut = Date.now();
  const resultat = calculer(tables);
  const duree = Date.now() - debut;
  dureePerformanceMs = duree;
  assert.strictEqual(resultat.indicateurs.fmaRealisees.valeur, 5000);
  assert.strictEqual(resultat.indicateurs.volumeHoraireFormateurs, 7500);
  assert(duree < 2000, 'Calcul trop lent : ' + duree + ' ms');
});

test('l’interface est responsive, lisible et sans dépendance graphique externe', () => {
  assert(navigation.includes('data-page="Statistiques"'));
  assert(interfaceHtml.includes('Réinitialiser les filtres'));
  assert(interfaceHtml.includes('graphiqueEvolutionSeancesStatistiques'));
  assert(css.includes('@media (max-width: 760px)'));
  assert(css.includes('.grille-indicateurs-statistiques'));
  assert(!/chart\.js|highcharts|plotly|cdn\.jsdelivr/i.test(
    interfaceHtml + source
  ));
});

test('le cache est invalidé après restauration et rollback', () => {
  const appels = restauration.match(/invaliderCacheStatistiques_/g) || [];
  assert(appels.length >= 2);
  assert(source.includes('DUREE_CACHE_STATISTIQUES_SECONDES_ = 5 * 60'));
});

test('aucune donnée individuelle d’indemnisation ou d’e-mail n’est exposée', () => {
  const resultat = calculer();
  const json = JSON.stringify(resultat);
  assert(!json.includes('REFERENCE_DEMANDE'));
  assert(!json.includes('STATUT_INDEMNISATION'));
  assert(!json.includes('@'));
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
  ' tests du module Statistiques réussis.\n' +
  'Mesure locale : 5 000 séances agrégées en ' +
  dureePerformanceMs + ' ms.\n'
);
