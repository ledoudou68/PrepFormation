'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const racine = path.resolve(__dirname, '..');
const lire = nom => fs.readFileSync(path.join(racine, nom), 'utf8');
const client = lire('JavaScript.html');
const stagiaires = lire('Stagiaires.html');
const sessions = lire('SessionsService.js');
const favoris = lire('FavorisService.js');
const authentification = lire('AuthentificationFormateurService.js');
const securite = lire('SecuriteService.js');
const administration = lire('AdministrationService.js');
const administrationHtml = lire('Administration.html');
const sauvegardes = lire('SauvegardeService.js');
const planification = lire('PlanificationSauvegardesService.js');
const version = lire('ApplicationMetadataService.js');

function definitionFonction(source, nom) {
  return new RegExp(
    'function\\s+' + nom.replace(/[$]/g, '\\$&') + '\\s*\\('
  ).test(source);
}

test('l’ancien fragment ModalStagiaire est absent sans toucher à la vraie modale', () => {
  assert.strictEqual(
    fs.existsSync(path.join(racine, 'ModalStagiaire.html')),
    false
  );

  const fichiersApplication = fs.readdirSync(racine)
    .filter(nom => /\.(?:js|html)$/.test(nom));
  const sourceApplication = fichiersApplication.map(lire).join('\n');
  assert.strictEqual(
    /['"]ModalStagiaire['"]/.test(sourceApplication),
    false
  );
  assert(stagiaires.includes('id="modalStagiaire"'));
  assert(stagiaires.includes('id="formulaireStagiaire"'));
  assert(definitionFonction(client, 'ouvrirModalStagiaire'));
  assert(definitionFonction(client, 'fermerModalStagiaire'));
  assert(definitionFonction(client, 'consulterStagiaire'));
});

test('les wrappers publics et helpers confirmés orphelins sont absents', () => {
  assert.strictEqual(
    definitionFonction(sessions, 'getReferentielFormation'),
    false
  );
  assert.strictEqual(
    definitionFonction(authentification, 'renouvelerSessionFormateur'),
    false
  );
  assert.strictEqual(definitionFonction(favoris, 'estFavori'), false);
  assert.strictEqual(
    definitionFonction(administration, 'getDonneesAdministration'),
    false
  );
  assert.strictEqual(
    definitionFonction(
      sauvegardes,
      'obtenirEtatSauvegardesAdministrationSansErreur_'
    ),
    false
  );
  assert.strictEqual(
    definitionFonction(securite, 'obtenirSessionUtilisateur_'),
    false
  );
  assert.strictEqual(
    definitionFonction(securite, 'trouverColonneSecurite_'),
    false
  );
  assert.strictEqual(
    definitionFonction(sessions, 'obtenirFeuilleItemsSessions_'),
    false
  );
  assert.strictEqual(
    definitionFonction(client, 'estFavoriClient_'),
    false
  );
});

test('aucune référence client ne subsiste vers les endpoints supprimés', () => {
  [
    'getReferentielFormation',
    'renouvelerSessionFormateur',
    'estFavori',
    'getDonneesAdministration'
  ].forEach(function (nom) {
    assert.strictEqual(
      new RegExp('\\.' + nom + '\\s*\\(').test(client),
      false,
      'Référence client résiduelle : ' + nom
    );
  });
});

test('le référentiel de séance et les favoris utilisés restent raccordés', () => {
  assert(definitionFonction(sessions, 'getReferentielSession'));
  assert(/\.getReferentielSession\s*\(/.test(client));

  ['getFavoris', 'ajouterFavori', 'supprimerFavori'].forEach(function (nom) {
    assert(definitionFonction(favoris, nom));
    assert(new RegExp('\\.' + nom + '\\s*\\(').test(client));
  });
});

test('les sessions formateur conservent leur validation et renouvellement interne', () => {
  assert(definitionFonction(securite, 'getSessionUtilisateur'));
  assert(definitionFonction(
    authentification,
    'obtenirSessionFormateurValide_'
  ));
  assert(definitionFonction(
    authentification,
    'renouvelerSessionFormateurPersistante_'
  ));
  assert(/\.getSessionUtilisateur\s*\(/.test(client));
});

test('Administration conserve les lecteurs différés réellement utilisés', () => {
  assert.strictEqual(
    (administrationHtml.match(/role="tab"/g) || []).length,
    6
  );
  assert(definitionFonction(
    administration,
    'getConfigurationMetierAdministration'
  ));
  assert(definitionFonction(
    sauvegardes,
    'getEtatSauvegardesAdministration'
  ));
  assert(/\.getConfigurationMetierAdministration\s*\(/.test(client));
  assert(/\.getEtatSauvegardesAdministration\s*\(/.test(client));
});

test('la planification automatique et son outil prudent de nettoyage subsistent', () => {
  assert(definitionFonction(
    planification,
    'getConfigurationSauvegardesAutomatiques'
  ));
  assert(/\.getConfigurationSauvegardesAutomatiques\s*\(/.test(client));
  assert(definitionFonction(
    planification,
    'nettoyerDeclencheursSauvegardesAutomatiques'
  ));
  assert(definitionFonction(
    planification,
    'executerSauvegardeAutomatiquePlanifiee_'
  ));
  assert(planification.includes(
    ".newTrigger(FONCTION_DECLENCHEUR_SAUVEGARDE_AUTOMATIQUE_)"
  ));
});

test('aucun handler HTML supprimé ne reste orphelin', () => {
  const fichiersHtml = fs.readdirSync(racine)
    .filter(nom => nom.endsWith('.html'));
  const sourceHtml = fichiersHtml.map(lire).join('\n');
  const nomsIgnores = new Set(['print', 'stopPropagation']);
  const handlers = new Set();

  for (const attribut of sourceHtml.matchAll(
    /on(?:click|submit|change|input|keydown|keyup|blur|focus)\s*=\s*"([^"]+)"/g
  )) {
    for (const appel of attribut[1].matchAll(
      /\b([A-Za-z_$][\w$]*)\s*\(/g
    )) {
      if (!nomsIgnores.has(appel[1])) handlers.add(appel[1]);
    }
  }

  handlers.forEach(function (nom) {
    assert(
      definitionFonction(client, nom),
      'Handler HTML sans fonction client : ' + nom
    );
  });
});

test('la version reste strictement 2.0.1', () => {
  assert(version.includes(
    "const VERSION_APPLICATION_PREPFORMATION_ = '2.0.1';"
  ));
});
