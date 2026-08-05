'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function iterator(values) {
  let index = 0;
  return {
    hasNext: () => index < values.length,
    next: () => values[index++]
  };
}

class FakeFile {
  constructor(id, type) {
    this.id = id;
    this.type = type || 'MANUELLE';
    this.trashed = false;
    this.name = id + '.json';
  }
  isTrashed() { return this.trashed; }
  setTrashed(value) { this.trashed = Boolean(value); return this; }
  getName() { return this.name; }
}

function createProperties(initial) {
  const values = { ...(initial || {}) };
  return {
    getProperty: key => Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : null,
    setProperty: (key, value) => { values[key] = String(value); },
    deleteProperty: key => { delete values[key]; },
    getProperties: () => ({ ...values }),
    values
  };
}

function loadService(file, extras) {
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Error,
    ...extras
  });
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  new vm.Script(source, { filename: file }).runInContext(context);
  return context;
}

function createDeletionFixture(options) {
  options = options || {};
  const json = new FakeFile('backup-1234', 'MANUELLE');
  const report = new FakeFile('report-1234', 'RAPPORT');
  report.name = 'backup-1234.restore-test.json';
  const audit = [];
  const properties = createProperties();
  const context = loadService('SauvegardeService.js', {
    TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_: 'AUTO_PLANIFIEE',
    exigerAdministrateur_: () => ({
      identifiantHistorique: 'SESSION_ADMIN:test'
    }),
    executerMutationMetier_: fn => fn(),
    journaliserActionSensible_: (...args) => audit.push(args),
    obtenirBackupIdsProtegesRestauration_: () => new Set(
      options.protected ? ['backup-1234'] : []
    ),
    obtenirContexteRestaurabilite_: () => ({ dossier: {} }),
    trouverFichierSauvegardeRestaurabilite_: () => json,
    validerFichierSauvegardeRestaurabilite_: () => ({
      sauvegarde: {
        metadata: {
          type: 'MANUELLE',
          createdAt: '2026-08-05T10:00:00.000Z',
          comment: 'Test'
        }
      }
    }),
    PropertiesService: {
      getScriptProperties: () => properties
    }
  });

  context.trouverRapportsSauvegardePourCorbeille_ = () => [report];
  context.mettreAJourDerniereSauvegardeApresCorbeille_ = () => {};

  return { context, json, report, audit };
}

function createScriptAppFixture() {
  let sequence = 0;
  const triggers = [];
  const calls = [];

  function makeTrigger(handler) {
    const id = `trigger-${++sequence}`;
    return {
      getUniqueId: () => id,
      getHandlerFunction: () => handler
    };
  }

  const ScriptApp = {
    WeekDay: {
      LUNDI: 'MONDAY', MARDI: 'TUESDAY', MERCREDI: 'WEDNESDAY',
      JEUDI: 'THURSDAY', VENDREDI: 'FRIDAY', SAMEDI: 'SATURDAY',
      DIMANCHE: 'SUNDAY'
    },
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: trigger => {
      const index = triggers.indexOf(trigger);
      if (index >= 0) triggers.splice(index, 1);
    },
    newTrigger: handler => {
      calls.push(['newTrigger', handler]);
      const builder = {
        timeBased() { calls.push(['timeBased']); return this; },
        everyHours(value) { calls.push(['everyHours', value]); return this; },
        everyDays(value) { calls.push(['everyDays', value]); return this; },
        everyWeeks(value) { calls.push(['everyWeeks', value]); return this; },
        atHour(value) { calls.push(['atHour', value]); return this; },
        onWeekDay(value) { calls.push(['onWeekDay', value]); return this; },
        inTimezone(value) { calls.push(['inTimezone', value]); return this; },
        create() {
          calls.push(['create']);
          const trigger = makeTrigger(handler);
          triggers.push(trigger);
          return trigger;
        }
      };
      return builder;
    }
  };

  return { ScriptApp, triggers, calls, makeTrigger };
}

function createPlanningFixture(options) {
  options = options || {};
  const properties = createProperties(options.properties);
  const script = createScriptAppFixture();
  const audit = [];
  const context = loadService('PlanificationSauvegardesService.js', {
    TYPE_SAUVEGARDE_MANUELLE_: 'MANUELLE',
    TYPE_SAUVEGARDE_SECURITE_RESTAURATION_: 'AUTO_AVANT_RESTAURATION',
    TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_: 'AUTO_PLANIFIEE',
    SUFFIXE_RAPPORT_RESTAURABILITE_: '.restore-test.json',
    exigerAdministrateur_: () => ({
      identifiantHistorique: 'SESSION_ADMIN:test'
    }),
    executerMutationMetier_: options.mutation || (fn => fn()),
    journaliserActionSensible_: (...args) => audit.push(args),
    journaliserEvenementSecuriteSansBloquer_: (...args) => audit.push(args),
    hacherTexteSauvegarde_: text => `hash-${String(text)}`,
    creerSauvegardeCompleteInterne_: options.createBackup || (() => ({
      backupId: 'auto-new',
      fileSizeBytes: 100,
      integrityStatus: 'CONFORME'
    })),
    obtenirContexteRestaurabilite_: options.getContext || (() => ({
      dossier: { getFiles: () => iterator([]) }
    })),
    validerFichierSauvegardeRestaurabilite_: options.validateFile || (() => {
      throw new Error('not configured');
    }),
    placerSauvegardeCorbeilleInterne_: options.trashBackup || (() => ({
      type: 'AUTO_PLANIFIEE',
      nombreRapportsCorbeille: 0
    })),
    lireEtatOperationRestauration_: () => options.activeRestore || null,
    PropertiesService: {
      getScriptProperties: () => properties
    },
    LockService: {
      getDocumentLock: () => ({
        hasLock: () => false,
        tryLock: () => true,
        releaseLock: () => {}
      })
    },
    ScriptApp: script.ScriptApp,
    Session: { getScriptTimeZone: () => 'Europe/Paris' },
    Utilities: {
      formatDate: date => date.toISOString().slice(0, 10)
    }
  });

  return { context, properties, script, audit };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('suppression manuelle confirmée place JSON et rapport dans la corbeille', () => {
  const fixture = createDeletionFixture();
  const result = fixture.context.supprimerSauvegardeAdministration(
    'backup-1234', 'SUPPRIMER', 'token'
  );
  assert.equal(result.succes, true);
  assert.equal(fixture.json.trashed, true);
  assert.equal(fixture.report.trashed, true);
  assert.deepEqual(
    fixture.audit.map(entry => entry[0]),
    [
      'SAUVEGARDE_SUPPRESSION_DEMANDE',
      'SAUVEGARDE_SUPPRESSION_CONFIRMATION',
      'SAUVEGARDE_SUPPRESSION_SUCCES'
    ]
  );
});

test('mot SUPPRIMER incorrect bloque toute mutation Drive', () => {
  const fixture = createDeletionFixture();
  assert.throws(
    () => fixture.context.supprimerSauvegardeAdministration(
      'backup-1234', 'supprimer', 'token'
    ),
    /SUPPRIMER/
  );
  assert.equal(fixture.json.trashed, false);
  assert.equal(fixture.report.trashed, false);
});

test('sauvegarde liée à une restauration active non supprimable', () => {
  const fixture = createDeletionFixture({ protected: true });
  assert.throws(
    () => fixture.context.supprimerSauvegardeAdministration(
      'backup-1234', 'SUPPRIMER', 'token'
    ),
    /restauration active/
  );
  assert.equal(fixture.json.trashed, false);
});

test('planification quotidienne utilise heure, jour et fuseau attendus', () => {
  const fixture = createPlanningFixture();
  fixture.context.creerDeclencheurSauvegardeAutomatique_({
    mode: 'QUOTIDIENNE', heure: 4, jourHebdomadaire: 'LUNDI'
  });
  assert(fixture.script.calls.some(call => call[0] === 'atHour' && call[1] === 4));
  assert(fixture.script.calls.some(call => call[0] === 'everyDays' && call[1] === 1));
  assert(fixture.script.calls.some(call => call[0] === 'inTimezone' && call[1] === 'Europe/Paris'));
});

test('planification hebdomadaire utilise jour, heure et fréquence attendus', () => {
  const fixture = createPlanningFixture();
  fixture.context.creerDeclencheurSauvegardeAutomatique_({
    mode: 'HEBDOMADAIRE', heure: 7, jourHebdomadaire: 'VENDREDI'
  });
  assert(fixture.script.calls.some(call => call[0] === 'everyWeeks' && call[1] === 1));
  assert(fixture.script.calls.some(call => call[0] === 'onWeekDay' && call[1] === 'FRIDAY'));
  assert(fixture.script.calls.some(call => call[0] === 'atHour' && call[1] === 7));
});

test('remplacement du déclencheur conserve exactement un déclencheur PrepFormation', () => {
  const fixture = createPlanningFixture();
  fixture.script.triggers.push(
    fixture.script.makeTrigger('executerSauvegardeAutomatiquePlanifiee_'),
    fixture.script.makeTrigger('executerSauvegardeAutomatiquePlanifiee_'),
    fixture.script.makeTrigger('autreFonctionProjet')
  );
  fixture.context.enregistrerConfigurationSauvegardesAutomatiques(
    { mode: 'TOUTES_LES_6_HEURES', retention: 10 },
    'token'
  );
  assert.equal(
    fixture.script.triggers.filter(trigger =>
      trigger.getHandlerFunction() === 'executerSauvegardeAutomatiquePlanifiee_'
    ).length,
    1
  );
  assert.equal(
    fixture.script.triggers.filter(trigger =>
      trigger.getHandlerFunction() === 'autreFonctionProjet'
    ).length,
    1
  );
});

test('deux déclenchements dans la même fenêtre ne créent pas de doublon', () => {
  let creations = 0;
  const fixture = createPlanningFixture({
    createBackup: () => {
      creations++;
      return {
        backupId: `auto-${creations}`,
        fileSizeBytes: 100,
        integrityStatus: 'CONFORME'
      };
    }
  });
  fixture.context.enregistrerConfigurationSauvegardesAutomatiques_({
    mode: 'TOUTES_LES_6_HEURES',
    retention: 10,
    triggerId: 'trigger-owner'
  });
  fixture.context.executerSauvegardeAutomatiquePlanifiee_({
    triggerUid: 'trigger-owner'
  });
  const second = fixture.context.executerSauvegardeAutomatiquePlanifiee_({
    triggerUid: 'trigger-owner'
  });
  assert.equal(creations, 1);
  assert.equal(second.raison, 'FENETRE_DEJA_TRAITEE');
});

test('déclenchement pendant une restauration est refusé avant la sauvegarde', () => {
  let creations = 0;
  const fixture = createPlanningFixture({
    mutation: () => {
      throw new Error('Une restauration est en cours.');
    },
    createBackup: () => { creations++; }
  });
  assert.throws(
    () => fixture.context.executerSauvegardeAutomatiquePlanifiee_({}),
    /restauration/
  );
  assert.equal(creations, 0);
});

[5, 10, 20, 30].forEach(retention => {
  test(`rétention ${retention} purge uniquement les automatiques excédentaires`, () => {
    const files = [];
    const types = {};
    for (let index = 0; index < retention + 3; index++) {
      const id = `auto-${String(index).padStart(2, '0')}`;
      const file = new FakeFile(id, 'AUTO_PLANIFIEE');
      files.push(file);
      types[id] = {
        type: 'AUTO_PLANIFIEE',
        createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
      };
    }
    const manual = new FakeFile('manual-1', 'MANUELLE');
    const security = new FakeFile('security-1', 'AUTO_AVANT_RESTAURATION');
    files.push(manual, security);
    types[manual.id] = { type: 'MANUELLE', createdAt: '2025-01-01T00:00:00.000Z' };
    types[security.id] = { type: 'AUTO_AVANT_RESTAURATION', createdAt: '2025-01-02T00:00:00.000Z' };
    const trashed = [];
    const fixture = createPlanningFixture({
      getContext: () => ({ dossier: { getFiles: () => iterator(files) } }),
      validateFile: file => ({
        sauvegarde: {
          backupId: file.id,
          metadata: types[file.id]
        }
      }),
      trashBackup: id => {
        trashed.push(id);
        return { type: 'AUTO_PLANIFIEE', nombreRapportsCorbeille: 0 };
      }
    });
    const newest = `auto-${String(retention + 2).padStart(2, '0')}`;
    const result = fixture.context.appliquerRetentionSauvegardesAutomatiques_(
      retention,
      newest,
      { identifiantHistorique: 'AUTO:test' }
    );
    assert.equal(result.succes, true);
    assert.equal(trashed.length, 3);
    assert(!trashed.includes('manual-1'));
    assert(!trashed.includes('security-1'));
    assert(!trashed.includes(newest));
  });
});

test('échec de purge conserve la nouvelle sauvegarde et signale seulement la rétention', () => {
  const files = Array.from({ length: 7 }, (_, index) =>
    new FakeFile(`auto-${index}`, 'AUTO_PLANIFIEE')
  );
  const attempts = [];
  const fixture = createPlanningFixture({
    getContext: () => ({ dossier: { getFiles: () => iterator(files) } }),
    validateFile: file => ({
      sauvegarde: {
        backupId: file.id,
        metadata: {
          type: 'AUTO_PLANIFIEE',
          createdAt: new Date(Date.UTC(2026, 0, Number(file.id.split('-')[1]) + 1)).toISOString()
        }
      }
    }),
    trashBackup: id => {
      attempts.push(id);
      throw new Error('Drive indisponible');
    }
  });
  const result = fixture.context.appliquerRetentionSauvegardesAutomatiques_(
    5,
    'auto-6',
    { identifiantHistorique: 'AUTO:test' }
  );
  assert.equal(result.succes, false);
  assert(!attempts.includes('auto-6'));
  assert(result.erreurs.length > 0);
});

test('la rétention conserve une sauvegarde requise par une restauration active', () => {
  const files = Array.from({ length: 7 }, (_, index) =>
    new FakeFile(`auto-${index}`, 'AUTO_PLANIFIEE')
  );
  const trashed = [];
  const fixture = createPlanningFixture({
    getContext: () => ({ dossier: { getFiles: () => iterator(files) } }),
    validateFile: file => ({
      sauvegarde: {
        backupId: file.id,
        metadata: {
          type: 'AUTO_PLANIFIEE',
          createdAt: new Date(Date.UTC(2026, 0, Number(file.id.split('-')[1]) + 1)).toISOString()
        }
      }
    }),
    activeRestore: {
      backupIdCible: 'auto-0',
      backupIdSecurite: ''
    },
    trashBackup: id => {
      trashed.push(id);
      return { type: 'AUTO_PLANIFIEE', nombreRapportsCorbeille: 0 };
    }
  });
  fixture.context.appliquerRetentionSauvegardesAutomatiques_(
    5,
    'auto-6',
    { identifiantHistorique: 'AUTO:test' }
  );
  assert(!trashed.includes('auto-0'));
});

test('le gestionnaire du déclencheur reste privé et le manifeste déclare le scope minimal', () => {
  const service = fs.readFileSync(
    path.join(ROOT, 'PlanificationSauvegardesService.js'),
    'utf8'
  );
  const client = fs.readFileSync(path.join(ROOT, 'JavaScript.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'appsscript.json'),
    'utf8'
  ));
  assert(service.includes('function executerSauvegardeAutomatiquePlanifiee_('));
  assert(!client.includes('.executerSauvegardeAutomatiquePlanifiee_('));
  assert(manifest.oauthScopes.includes(
    'https://www.googleapis.com/auth/script.scriptapp'
  ));
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.fn();
    passed++;
    process.stdout.write(`✓ ${entry.name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${entry.name}\n${error.stack}\n`);
  }
}

process.stdout.write(`\n${passed}/${tests.length} tests phase 4 réussis.\n`);
if (passed !== tests.length) process.exit(1);
