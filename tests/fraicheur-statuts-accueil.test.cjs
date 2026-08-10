'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(racine, 'AccueilCacheService.js'),
  'utf8'
);


function creerEnvironnement() {
  const proprietes = {};
  let jour = '2026-08-10';
  let sequenceUuid = 0;
  let synchronisations = 0;
  let restaurationActive = false;
  let erreurProchaineSynchronisation = false;
  let verrouDetenu = false;
  let verrouScriptDetenu = false;
  let avantAcquisition = null;

  const scriptProperties = {
    getProperties() { return Object.assign({}, proprietes); },
    getProperty(cle) { return proprietes[cle] || null; },
    setProperty(cle, valeur) {
      proprietes[cle] = String(valeur);
      return scriptProperties;
    },
    setProperties(valeurs) {
      Object.keys(valeurs).forEach(function (cle) {
        proprietes[cle] = String(valeurs[cle]);
      });
      return scriptProperties;
    }
  };

  const contexte = vm.createContext({
    PropertiesService: {
      getScriptProperties() { return scriptProperties; }
    },
    Utilities: {
      getUuid() {
        sequenceUuid++;
        return 'generation_' + sequenceUuid;
      },
      formatDate() { return jour; }
    },
    Session: {
      getScriptTimeZone() { return 'Europe/Paris'; }
    },
    LockService: {
      getDocumentLock() {
        return {
          hasLock() { return verrouDetenu; },
          tryLock() {
            verrouDetenu = true;
            if (avantAcquisition) {
              const action = avantAcquisition;
              avantAcquisition = null;
              action();
            }
            return true;
          },
          releaseLock() { verrouDetenu = false; }
        };
      },
      getScriptLock() {
        return {
          hasLock() { return verrouScriptDetenu; },
          tryLock() {
            verrouScriptDetenu = true;
            return true;
          },
          releaseLock() { verrouScriptDetenu = false; }
        };
      }
    },
    restaurationBloqueEcritures_() { return restaurationActive; },
    synchroniserStatutsStagiaires_(diagnostic, inclureInstantanes) {
      synchronisations++;
      if (erreurProchaineSynchronisation) {
        erreurProchaineSynchronisation = false;
        throw new Error('Synchronisation simulée en échec.');
      }
      if (restaurationActive) {
        return {
          migres: 0,
          automatiquesMisAJour: 0,
          suspenduPendantRestauration: true
        };
      }
      return {
        migres: 0,
        automatiquesMisAJour: 0,
        instantanesAccueil: inclureInstantanes ? {
          STAGIAIRES: { index: {}, lignes: [] }
        } : undefined
      };
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

  vm.runInContext(source, contexte, {
    filename: 'AccueilCacheService.js'
  });

  return {
    contexte,
    proprietes,
    setJour(valeur) { jour = valeur; },
    setRestaurationActive(valeur) {
      restaurationActive = Boolean(valeur);
    },
    faireEchouerProchaineSynchronisation() {
      erreurProchaineSynchronisation = true;
    },
    avantProchaineAcquisition(action) { avantAcquisition = action; },
    obtenirNombreSynchronisations() { return synchronisations; },
    lireEtatPersistant() {
      const valeur = proprietes.PREPFORMATION_STATUTS_ACCUEIL_ETAT;
      return valeur ? JSON.parse(valeur) : null;
    },
    ecrireMarqueurFrais() {
      const etat = contexte.lireEtatFraicheurStatutsAccueil_();
      contexte.enregistrerSuccesSynchronisationStatutsAccueil_(
        etat.generationCourante,
        etat.jourCourant
      );
    }
  };
}


{
  const environnement = creerEnvironnement();
  const diagnosticPremier = {};
  environnement.contexte
    .synchroniserStatutsStagiairesAccueilSiNecessaire_(diagnosticPremier);
  assert.strictEqual(environnement.obtenirNombreSynchronisations(), 1);
  assert.strictEqual(diagnosticPremier.statutSynchronisation, 'EXECUTEE');
  assert.strictEqual(
    diagnosticPremier.motifSynchronisation,
    'MARQUEUR_ABSENT'
  );
  assert.strictEqual(
    typeof diagnosticPremier.dureeSynchronisationReelleMs,
    'number'
  );

  const diagnosticSecond = {};
  const second = environnement.contexte
    .synchroniserStatutsStagiairesAccueilSiNecessaire_(diagnosticSecond);
  assert.strictEqual(environnement.obtenirNombreSynchronisations(), 1);
  assert.strictEqual(second.synchronisationSautee, true);
  assert.strictEqual(diagnosticSecond.statutSynchronisation, 'SAUTEE');
  assert.strictEqual(diagnosticSecond.motifSynchronisation, 'FRAICHE');

  environnement.setJour('2026-08-11');
  const diagnosticJour = {};
  environnement.contexte
    .synchroniserStatutsStagiairesAccueilSiNecessaire_(diagnosticJour);
  assert.strictEqual(environnement.obtenirNombreSynchronisations(), 2);
  assert.strictEqual(diagnosticJour.motifSynchronisation, 'JOUR_CHANGE');

  [
    ['STAGIAIRES', 'MODIFICATION_STAGIAIRE'],
    ['SESSIONS', 'MODIFICATION_SESSION'],
    ['PRESENCES_STAGIAIRES', 'MODIFICATION_PRESENCE'],
    ['STAGIAIRES', 'MIGRATION'],
    ['SESSIONS', 'REINITIALISATION_PRODUCTION']
  ].forEach(function (scenario) {
    environnement.contexte.invaliderGenerationSourcesStatuts_(
      scenario[0],
      scenario[1]
    );
    const diagnostic = {};
    environnement.contexte
      .synchroniserStatutsStagiairesAccueilSiNecessaire_(diagnostic);
    assert.strictEqual(
      diagnostic.motifSynchronisation,
      'GENERATION_CHANGE',
      scenario[1]
    );
  });

  environnement.contexte.invaliderGenerationSourcesStatuts_(
    ['STAGIAIRES', 'SESSIONS', 'PRESENCES_STAGIAIRES'],
    'RESTAURATION'
  );
  const diagnosticRestauration = {};
  environnement.contexte
    .synchroniserStatutsStagiairesAccueilSiNecessaire_(
      diagnosticRestauration
    );
  assert.strictEqual(
    diagnosticRestauration.motifSynchronisation,
    'RESTAURATION'
  );

  environnement.contexte.invaliderGenerationSourcesStatuts_(
    'STAGIAIRES',
    'MUTATION_AVANT_ECHEC'
  );
  environnement.faireEchouerProchaineSynchronisation();
  assert.throws(function () {
    environnement.contexte
      .synchroniserStatutsStagiairesAccueilSiNecessaire_({});
  }, /Synchronisation simulée en échec/);
  const diagnosticReprise = {};
  environnement.contexte
    .synchroniserStatutsStagiairesAccueilSiNecessaire_(diagnosticReprise);
  assert.strictEqual(
    diagnosticReprise.motifSynchronisation,
    'ECHEC_PRECEDENT'
  );

  const diagnosticSerialise = JSON.stringify(diagnosticReprise);
  [
    'motDePasse',
    'PASSWORD_HASH',
    'PASSWORD_SALT',
    'PEPPER',
    'Nom stagiaire',
    'jeton'
  ].forEach(function (secret) {
    assert(!diagnosticSerialise.includes(secret));
  });
}


{
  const environnement = creerEnvironnement();
  environnement.setRestaurationActive(true);
  const diagnostic = {};
  const resultat = environnement.contexte
    .synchroniserStatutsStagiairesAccueilSiNecessaire_(diagnostic);
  assert.strictEqual(resultat.suspenduPendantRestauration, true);
  assert.strictEqual(diagnostic.motifSynchronisation, 'RESTAURATION');
  assert.strictEqual(environnement.obtenirNombreSynchronisations(), 1);
  assert.strictEqual(
    environnement.lireEtatPersistant(),
    null
  );
}


{
  // Simule un second appel arrivé avec un marqueur absent, mais qui obtient
  // le DocumentLock après qu'un premier appel a terminé la synchronisation.
  const environnement = creerEnvironnement();
  let synchronisationConcurrente = 0;
  environnement.avantProchaineAcquisition(function () {
    synchronisationConcurrente++;
    environnement.ecrireMarqueurFrais();
  });
  const diagnostic = {};
  const resultat = environnement.contexte
    .synchroniserStatutsStagiairesAccueilSiNecessaire_(diagnostic);
  assert.strictEqual(synchronisationConcurrente, 1);
  assert.strictEqual(environnement.obtenirNombreSynchronisations(), 0);
  assert.strictEqual(resultat.synchronisationSautee, true);
  assert.strictEqual(diagnostic.statutSynchronisation, 'SAUTEE');
  assert.strictEqual(diagnostic.motifSynchronisation, 'FRAICHE');
}


{
  const environnement = creerEnvironnement();
  environnement.contexte.invaliderGenerationSourcesStatuts_(
    'FORMATEURS',
    'HORS_SOURCE'
  );
  assert.strictEqual(
    environnement.lireEtatPersistant(),
    null
  );

  const generationAvant = environnement.contexte
    .invaliderGenerationSourcesStatuts_(
      'STAGIAIRES',
      'PREPARATION_TEST_ON_EDIT'
    );
  assert.strictEqual(
    environnement.contexte.onEdit({
      range: {
        getSheet() {
          return { getName() { return 'FORMATEURS'; } };
        }
      }
    }),
    false
  );
  assert.strictEqual(
    environnement.lireEtatPersistant().generationCourante,
    generationAvant
  );
  assert.strictEqual(
    environnement.contexte.onEdit({
      range: {
        getSheet() {
          return { getName() { return 'SESSIONS'; } };
        }
      }
    }),
    true
  );
  assert.notStrictEqual(
    environnement.lireEtatPersistant().generationCourante,
    generationAvant
  );
}


const sourcesMutations = {
  StagiairesService: fs.readFileSync(
    path.join(racine, 'StagiairesService.js'),
    'utf8'
  ),
  SessionsService: fs.readFileSync(
    path.join(racine, 'SessionsService.js'),
    'utf8'
  ),
  MigrationService: fs.readFileSync(
    path.join(racine, 'MigrationService.js'),
    'utf8'
  ),
  RestaurationService: fs.readFileSync(
    path.join(racine, 'RestaurationService.js'),
    'utf8'
  ),
  ReinitialisationProductionService: fs.readFileSync(
    path.join(racine, 'ReinitialisationProductionService.js'),
    'utf8'
  ),
  AdministrationService: fs.readFileSync(
    path.join(racine, 'AdministrationService.js'),
    'utf8'
  ),
  PhotosStagiairesService: fs.readFileSync(
    path.join(racine, 'PhotosStagiairesService.js'),
    'utf8'
  ),
  Code: fs.readFileSync(
    path.join(racine, 'Code.js'),
    'utf8'
  )
};

Object.keys(sourcesMutations).forEach(function (service) {
  assert(
    sourcesMutations[service].includes(
      'invaliderGenerationSourcesStatuts_('
    ),
    service
  );
});
[
  'CREATION_STAGIAIRE',
  'MODIFICATION_STAGIAIRE',
  'CLOTURE_STAGIAIRE',
  'REACTIVATION_STAGIAIRE'
].forEach(function (motif) {
  assert(sourcesMutations.StagiairesService.includes(motif), motif);
});
[
  'CREATION_SESSION',
  'MODIFICATION_SESSION',
  'DUPLICATION_SESSION',
  'ROLLBACK_SESSION'
].forEach(function (motif) {
  assert(sourcesMutations.SessionsService.includes(motif), motif);
});
assert(sourcesMutations.MigrationService.includes("'MIGRATION'"));
assert(sourcesMutations.RestaurationService.includes("'RESTAURATION'"));
assert(sourcesMutations.RestaurationService.includes(
  "'ROLLBACK_RESTAURATION'"
));
assert(sourcesMutations.ReinitialisationProductionService.includes(
  "'REINITIALISATION_PRODUCTION'"
));
assert(sourcesMutations.ReinitialisationProductionService.includes(
  "'ROLLBACK_REINITIALISATION_PRODUCTION'"
));
assert(!source.includes('.getProperties()'));
assert(!source.includes('CacheService'));

console.log(
  '✓ fraîcheur Accueil : génération, invalidations, reprise et concurrence'
);
