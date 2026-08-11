'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const lire = fichier => fs.readFileSync(
  path.join(racine, fichier),
  'utf8'
);

const code = lire('Code.js');
const ui = lire('UI.js');
const client = lire('JavaScript.html');
const migration = lire('MigrationService.js');
const restauration = lire('RestaurationService.js');
const reinitialisation = lire('ReinitialisationProductionService.js');
const version = lire('ApplicationMetadataService.js');
const fichiersJsServeur = fs.readdirSync(racine)
  .filter(nom => /\.js$/.test(nom));
const sourceServeur = fichiersJsServeur
  .map(lire)
  .join('\n');

const tests = [];
function test(nom, traitement) {
  tests.push({ nom, traitement });
}

test('l’ancien point d’entrée public initialiserApplication est absent', () => {
  const definitionPublique = /function\s+initialiserApplication\s*\(/;
  assert.strictEqual(definitionPublique.test(sourceServeur), false);

  const fonctionsCode = Array.from(
    code.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)
  ).map(correspondance => correspondance[1]);
  assert(fonctionsCode.length > 0);
  assert(fonctionsCode.every(nom => nom.endsWith('_')));
});

test('aucun appel client ne référence initialiserApplication', () => {
  assert.strictEqual(
    /\.initialiserApplication\s*\(/.test(client),
    false
  );
});

test('les mécanismes légitimes de migration et récupération subsistent', () => {
  assert(ui.includes('executerMigrationsAuDemarrage_()'));
  assert(migration.includes('function executerMigrations('));
  assert(migration.includes('function executerMigrationsAuDemarrage_('));
  assert(restauration.includes('function executerRestaurationConfirmee('));
  assert(reinitialisation.includes(
    'function executerReinitialisationProductionConfirmee('
  ));
});

test('doGet retourne la Web App avec la protection X-Frame par défaut', () => {
  assert.strictEqual(ui.includes('ALLOWALL'), false);
  assert.strictEqual(ui.includes('setXFrameOptionsMode'), false);
  assert.strictEqual(ui.includes('XFrameOptionsMode'), false);

  const sortie = {
    titre: '',
    meta: [],
    addMetaTag(nom, contenu) {
      this.meta.push({ nom, contenu });
      return this;
    },
    setTitle(titre) {
      this.titre = titre;
      return this;
    }
  };
  let migrations = 0;
  const contexte = {
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => sortie }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' })
    },
    recupererRestaurationInterrompueAuDemarrage_: () => ({
      operationActive: false
    }),
    executerMigrationsAuDemarrage_: () => {
      migrations++;
    }
  };

  vm.createContext(contexte);
  vm.runInContext(ui, contexte, { filename: 'UI.js' });
  const resultat = contexte.doGet();

  assert.strictEqual(resultat, sortie);
  assert.strictEqual(sortie.titre, 'PrepFormation');
  assert.deepStrictEqual(sortie.meta, [{
    nom: 'viewport',
    contenu: 'width=device-width, initial-scale=1, viewport-fit=cover'
  }]);
  assert.strictEqual(migrations, 1);
});

test('aucun mécanisme applicatif équivalent n’autorise les iframes', () => {
  const fichiersApplicatifs = fs.readdirSync(racine)
    .filter(nom => /\.(?:js|html)$/.test(nom));
  const sourceApplication = fichiersApplicatifs
    .map(lire)
    .join('\n');

  assert.strictEqual(sourceApplication.includes('setXFrameOptionsMode'), false);
  assert.strictEqual(sourceApplication.includes('ALLOWALL'), false);
  assert.strictEqual(/<iframe\b/i.test(sourceApplication), false);
  assert.strictEqual(/frame-ancestors\s+\*/i.test(sourceApplication), false);
});

test('la version applicative reste strictement 2.0.0', () => {
  assert(version.includes(
    "const VERSION_APPLICATION_PREPFORMATION_ = '2.0.0';"
  ));
});

let reussis = 0;
tests.forEach(cas => {
  cas.traitement();
  reussis++;
  console.log('✓ ' + cas.nom);
});

console.log(
  `\n${reussis}/${tests.length} tests de sécurité pré-recette réussis.\n`
);
