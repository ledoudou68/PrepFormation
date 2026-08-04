'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

class FakeRange {
  constructor(sheet, row, column, rows, columns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rows = rows;
    this.columns = columns;
  }

  getValues() {
    const values = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.columns; c++) {
        line.push(this.sheet.valueAt(this.row + r, this.column + c));
      }
      values.push(line);
    }
    return values;
  }

  setValues(values) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        this.sheet.setValueAt(
          this.row + r,
          this.column + c,
          values[r][c]
        );
      }
    }
    return this;
  }

  getValue() {
    return this.getValues()[0][0];
  }

  isBlank() {
    return this.getValues().every(row =>
      row.every(value => value === '' || value === null)
    );
  }

  setValue(value) {
    return this.setValues([[value]]);
  }

  clearContent() {
    const empty = Array.from({ length: this.rows }, () =>
      Array(this.columns).fill('')
    );
    return this.setValues(empty);
  }

  getNumberFormats() {
    return Array.from({ length: this.rows }, () =>
      Array(this.columns).fill('')
    );
  }

  setNumberFormat() { return this; }
  setNumberFormats() { return this; }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(book, name, data) {
    this.book = book;
    this.name = name;
    this.data = (data || []).map(row => row.slice());
  }

  getName() { return this.name; }
  setName(name) { this.book.rename(this, name); return this; }
  getLastRow() { return this.data.length; }
  getLastColumn() {
    return this.data.reduce((max, row) => Math.max(max, row.length), 0);
  }
  getMaxRows() { return Math.max(1, this.getLastRow()); }
  getMaxColumns() { return Math.max(1, this.getLastColumn()); }
  insertRowsAfter() { return this; }
  insertColumnsAfter() { return this; }
  setFrozenRows() { return this; }
  getDataRange() {
    return new FakeRange(
      this,
      1,
      1,
      Math.max(1, this.getLastRow()),
      Math.max(1, this.getLastColumn())
    );
  }
  getRange(row, column, rows = 1, columns = 1) {
    return new FakeRange(this, row, column, rows, columns);
  }
  appendRow(row) {
    this.data.push(row.slice());
    return this;
  }
  deleteRow(number) {
    this.data.splice(number - 1, 1);
  }
  valueAt(row, column) {
    return (this.data[row - 1] || [])[column - 1] ?? '';
  }
  setValueAt(row, column, value) {
    while (this.data.length < row) this.data.push([]);
    while (this.data[row - 1].length < column) this.data[row - 1].push('');
    this.data[row - 1][column - 1] = value;
  }
}

class FakeBook {
  constructor() {
    this.sheets = new Map();
    this.failDelete = new Set();
    this.insertCount = 0;
  }
  add(name, data) {
    const sheet = new FakeSheet(this, name, data);
    this.sheets.set(name, sheet);
    return sheet;
  }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  getSheets() { return [...this.sheets.values()]; }
  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error('duplicate sheet');
    this.insertCount++;
    return this.add(name, []);
  }
  rename(sheet, name) {
    if (this.sheets.has(name) && this.sheets.get(name) !== sheet) {
      throw new Error('duplicate name');
    }
    this.sheets.delete(sheet.name);
    sheet.name = name;
    this.sheets.set(name, sheet);
  }
  deleteSheet(sheet) {
    if (!sheet || this.failDelete.has(sheet.name)) {
      throw new Error('simulated delete failure');
    }
    this.sheets.delete(sheet.name);
  }
}

class FakeProperties {
  constructor() { this.values = {}; }
  getProperty(key) { return this.values[key] ?? null; }
  setProperty(key, value) { this.values[key] = String(value); }
  deleteProperty(key) { delete this.values[key]; }
  getProperties() { return { ...this.values }; }
  setProperties(values) {
    Object.keys(values).forEach(key => this.setProperty(key, values[key]));
  }
}

function createLock() {
  return {
    locked: false,
    acquisitions: 0,
    onTryLock: null,
    hasLock() { return this.locked; },
    tryLock() {
      this.acquisitions++;
      if (this.onTryLock) this.onTryLock();
      this.locked = true;
      return true;
    },
    releaseLock() { this.locked = false; }
  };
}

function createContext(files) {
  const properties = new FakeProperties();
  const documentLock = createLock();
  const scriptLock = createLock();
  let currentBook = new FakeBook();
  let uuid = 0;
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    isNaN,
    PropertiesService: {
      getScriptProperties: () => properties
    },
    LockService: {
      getDocumentLock: () => documentLock,
      getScriptLock: () => scriptLock
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => currentBook,
      flush: () => {}
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => `uuid-${++uuid}`,
      computeDigest: (_algorithm, text) =>
        [...crypto.createHash('sha256').update(String(text)).digest()]
          .map(value => value > 127 ? value - 256 : value)
    }
  });

  files.forEach(file => {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, file), 'utf8'),
      context,
      { filename: file }
    );
  });

  return {
    context,
    properties,
    documentLock,
    scriptLock,
    getBook: () => currentBook,
    setBook: book => { currentBook = book; },
    run: expression => vm.runInContext(expression, context)
  };
}

function sourceData(configuration, suffix) {
  const headers = configuration.colonnes.slice();
  const row = Array(headers.length).fill('');
  if (configuration.feuille === 'PARAMETRES') {
    row[headers.indexOf('CLE')] = 'VERSION_SCHEMA';
    row[headers.indexOf('VALEUR')] = suffix === 'SRC' ? 3 : 2;
    row[headers.indexOf('ORDRE')] = 1;
    row[headers.indexOf('ACTIF')] = 'Oui';
  } else {
    const id = configuration.identifiant || headers[0];
    row[headers.indexOf(id)] = `${suffix}_${configuration.feuille}`;
  }
  return [headers, row];
}

function buildRestoreFixture() {
  const env = createContext([
    'SecuriteService.js',
    'MigrationService.js',
    'SauvegardeService.js',
    'RestaurationService.js'
  ]);
  env.run('journaliserActionsSensiblesEnLot_ = function (events) { return (events || []).length; };');
  const schema = env.run('SCHEMA_BASE_');
  const book = new FakeBook();
  schema.forEach(configuration => {
    book.add(configuration.feuille, sourceData(configuration, 'SRC'));
  });
  env.setBook(book);
  env.context.__book = book;
  const operationId = '12345678-abcd-ef00-1111-222222222222';
  env.context.__operationId = operationId;
  const state = env.run(`({
    operationId: __operationId,
    backupIdCible: 'backup-test',
    backupIdSecurite: 'backup-security',
    dateDebut: new Date().toISOString(),
    versionSchemaSource: 3,
    versionSchemaCible: 3,
    feuillesStaging: construirePlanStagingRestauration_(__operationId),
    feuillesRollback: construirePlanRollbackRestauration_(__operationId, __book),
    feuillesInitialementPresentes: SCHEMA_BASE_.map(function (c) { return c.feuille; }),
    statut: 'EN_COURS',
    etapeCourante: 'BASCULEMENT',
    modeRecuperation: '',
    basculementCommence: false,
    basculementTermine: false,
    journauxDifferes: [],
    journauxEcrits: false,
    nombreJournauxEcrits: 0,
    feuillesTechniquesOrphelines: []
  })`);
  env.context.__state = state;
  state.feuillesStaging.forEach((liaison, position) => {
    const configuration = schema[position];
    book.add(liaison.nomTemporaire, sourceData(configuration, 'NEW'));
    liaison.etat = 'VALIDEE';
  });
  env.properties.setProperty(
    'PREPFORMATION_RESTORE_ACTIVE_OPERATION',
    JSON.stringify(state)
  );
  const snapshot = {};
  schema.forEach(configuration => {
    snapshot[configuration.feuille] = JSON.parse(JSON.stringify(
      book.getSheetByName(configuration.feuille).data
    ));
  });
  return { env, schema, book, state, snapshot };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assertJsonEqual(actual, expected) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));
}

for (let position = 0; position < 13; position++) {
  [
    `AVANT_RENOMMAGE_SOURCE_${position}`,
    `APRES_RENOMMAGE_SOURCE_${position}`,
    `AVANT_RENOMMAGE_STAGING_${position}`,
    `APRES_RENOMMAGE_STAGING_${position}`
  ].forEach(point => {
    test(`rollback exact après interruption ${point}`, () => {
      const fixture = buildRestoreFixture();
      fixture.env.context.__point = point;
      assert.throws(() => fixture.env.run(
        'basculerFeuillesRestauration_(__book, __state, PropertiesService.getScriptProperties(), { echecEtape: __point });'
      ));
      const durable = JSON.parse(fixture.env.properties.getProperty(
        'PREPFORMATION_RESTORE_ACTIVE_OPERATION'
      ));
      assert(durable.feuillesRollback[position].nomRollback);
      assert(durable.feuillesRollback[position].empreinteSource);
      const result = fixture.env.run(
        'executerRollbackRestauration_(__book, __state, PropertiesService.getScriptProperties(), "TEST", false);'
      );
      assert.strictEqual(result.complet, true);
      fixture.schema.forEach(configuration => {
        assertJsonEqual(
          fixture.book.getSheetByName(configuration.feuille).data,
          fixture.snapshot[configuration.feuille]
        );
      });
      assert.strictEqual(
        fixture.book.getSheetByName('PARAMETRES').data[1][1],
        3
      );
      assertJsonEqual(
        fixture.env.run('listerFeuillesTechniquesRestauration_(__book)'),
        []
      );
    });
  });
}

test('détection non destructive des trois préfixes orphelins', () => {
  const fixture = buildRestoreFixture();
  fixture.state.feuillesStaging.forEach(link => {
    const sheet = fixture.book.getSheetByName(link.nomTemporaire);
    if (sheet) fixture.book.deleteSheet(sheet);
  });
  fixture.env.properties.deleteProperty('PREPFORMATION_RESTORE_ACTIVE_OPERATION');
  fixture.book.add('__PF_STG_ORPHAN_0', [['x']]);
  fixture.book.add('__PF_RBK_ORPHAN_0', [['x']]);
  fixture.book.add('__PF_BAD_ORPHAN_0', [['x']]);
  assert.throws(() => fixture.env.run(
    'verifierFeuillesTechniquesAvantRestauration_(__book);'
  ));
  const state = JSON.parse(fixture.env.properties.getProperty(
    'PREPFORMATION_RESTORE_ACTIVE_OPERATION'
  ));
  assert.strictEqual(state.statut, 'RECUPERATION_REQUISE');
  assert.strictEqual(state.modeRecuperation, 'DIAGNOSTIC');
  assert.strictEqual(state.feuillesTechniquesOrphelines.length, 3);
  assert(fixture.book.getSheetByName('__PF_STG_ORPHAN_0'));
  assert(fixture.book.getSheetByName('__PF_RBK_ORPHAN_0'));
  assert(fixture.book.getSheetByName('__PF_BAD_ORPHAN_0'));
});

test('rollback relançable sans perte ni aggravation', () => {
  const fixture = buildRestoreFixture();
  assert.throws(() => fixture.env.run(
    'basculerFeuillesRestauration_(__book, __state, PropertiesService.getScriptProperties(), { echecEtape: "APRES_RENOMMAGE_STAGING_4" });'
  ));
  const first = fixture.env.run(
    'executerRollbackRestauration_(__book, __state, PropertiesService.getScriptProperties(), "TEST", false);'
  );
  const second = fixture.env.run(
    'executerRollbackRestauration_(__book, __state, PropertiesService.getScriptProperties(), "TEST", true);'
  );
  assert.strictEqual(first.complet, true);
  assert.strictEqual(second.complet, true);
  fixture.schema.forEach(configuration => {
    assertJsonEqual(
      fixture.book.getSheetByName(configuration.feuille).data,
      fixture.snapshot[configuration.feuille]
    );
  });
});

test('échec de nettoyage conserve l’état actif puis finalisation reprise', () => {
  const fixture = buildRestoreFixture();
  fixture.env.run(
    'basculerFeuillesRestauration_(__book, __state, PropertiesService.getScriptProperties(), {});'
  );
  fixture.state.modeRecuperation = 'FINALISATION';
  const blockedName = fixture.state.feuillesRollback[0].nomRollback;
  fixture.book.failDelete.add(blockedName);
  const cleanup1 = fixture.env.run(
    'supprimerFeuillesRollbackRestauration_(__book, __state);'
  );
  fixture.env.context.__cleanup1 = cleanup1;
  const result1 = fixture.env.run(
    'finaliserOperationRestauration_(PropertiesService.getScriptProperties(), __state, { versionSchema: 3 }, __cleanup1);'
  );
  assert.strictEqual(cleanup1.complet, false);
  assert.strictEqual(result1.recuperationRequise, true);
  assert(fixture.env.properties.getProperty(
    'PREPFORMATION_RESTORE_ACTIVE_OPERATION'
  ));
  fixture.book.failDelete.clear();
  const cleanup2 = fixture.env.run(
    'supprimerFeuillesRollbackRestauration_(__book, __state);'
  );
  fixture.env.context.__cleanup2 = cleanup2;
  const result2 = fixture.env.run(
    'finaliserOperationRestauration_(PropertiesService.getScriptProperties(), __state, { versionSchema: 3 }, __cleanup2);'
  );
  assert.strictEqual(cleanup2.complet, true);
  assert.strictEqual(result2.succes, true);
  assert.strictEqual(
    fixture.env.properties.getProperty(
      'PREPFORMATION_RESTORE_ACTIVE_OPERATION'
    ),
    null
  );
});

test('mutation concurrente bloquée après acquisition du verrou', () => {
  const env = createContext(['SecuriteService.js']);
  let executed = false;
  env.context.__mutation = () => { executed = true; };
  env.documentLock.onTryLock = () => {
    env.properties.setProperty(
      'PREPFORMATION_RESTORE_ACTIVE_OPERATION',
      JSON.stringify({ statut: 'EN_COURS' })
    );
  };
  assert.throws(() => env.run('executerMutationMetier_(__mutation);'));
  assert.strictEqual(executed, false);
  assert.strictEqual(env.documentLock.locked, false);
});

test('consultation pendant restauration ne crée aucune structure', () => {
  const env = createContext(['MigrationService.js']);
  const book = new FakeBook();
  env.setBook(book);
  env.context.__book = book;
  env.properties.setProperty(
    'PREPFORMATION_RESTORE_ACTIVE_OPERATION',
    JSON.stringify({ statut: 'EN_COURS' })
  );
  assert.throws(() => env.run(
    'obtenirFeuilleLecturePure_(__book, "STAGIAIRES", ["UUID"]);'
  ));
  assert.strictEqual(book.insertCount, 0);
  assert.strictEqual(book.getSheets().length, 0);
});

test('journalisation verrouillée et bloquée pendant restauration', () => {
  const env = createContext(['SecuriteService.js', 'MigrationService.js']);
  const book = new FakeBook();
  book.add('HISTORIQUE', [[
    'ID_HISTORIQUE', 'DATE_ACTION', 'UTILISATEUR',
    'ACTION', 'OBJET', 'IDENTIFIANT', 'DETAILS'
  ]]);
  env.setBook(book);
  env.run('journaliserActionSensible_("TEST", "OBJET", "1", {}, "TEST");');
  assert.strictEqual(book.getSheetByName('HISTORIQUE').getLastRow(), 2);
  assert(env.documentLock.acquisitions >= 1);
  env.properties.setProperty(
    'PREPFORMATION_RESTORE_ACTIVE_OPERATION',
    JSON.stringify({ statut: 'EN_COURS' })
  );
  assert.throws(() => env.run(
    'journaliserActionSensible_("TEST2", "OBJET", "2", {}, "TEST");'
  ));
  assert.strictEqual(book.getSheetByName('HISTORIQUE').getLastRow(), 2);
});

test('journaux de restauration différés jusqu’à validation explicite', () => {
  const env = createContext([
    'SecuriteService.js',
    'MigrationService.js',
    'RestaurationService.js'
  ]);
  const book = new FakeBook();
  book.add('HISTORIQUE', [[
    'ID_HISTORIQUE', 'DATE_ACTION', 'UTILISATEUR',
    'ACTION', 'OBJET', 'IDENTIFIANT', 'DETAILS'
  ]]);
  env.setBook(book);
  env.context.__state = {
    operationId: 'op-test',
    backupIdCible: 'backup-test',
    etapeCourante: 'STAGING',
    statut: 'EN_COURS',
    journauxDifferes: [],
    journauxEcrits: false,
    nombreJournauxEcrits: 0
  };
  env.properties.setProperty(
    'PREPFORMATION_RESTORE_ACTIVE_OPERATION',
    JSON.stringify(env.context.__state)
  );
  env.run(
    'journaliserEtapeRestauration_("RESTAURATION_STAGING", __state, {}, "TEST");'
  );
  assert.strictEqual(book.getSheetByName('HISTORIQUE').getLastRow(), 1);
  env.run('ecrireJournauxDifferesRestauration_(__state);');
  assert.strictEqual(book.getSheetByName('HISTORIQUE').getLastRow(), 2);
});

test('création puis modification réelle d’un item du référentiel', () => {
  const env = createContext([
    'SecuriteService.js',
    'MigrationService.js',
    'ReferentielService.js'
  ]);
  const book = new FakeBook();
  book.add('CATEGORIES', [[
    'ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ORDRE', 'ACTIF'
  ], ['CAT-1', 'F1', 'Catégorie 1', 1, 'Oui']]);
  book.add('REFERENTIEL', [[
    'ID_ITEM', 'FORMATION', 'ID_CATEGORIE', 'ITEM',
    'DESCRIPTION', 'ORDRE', 'ACTIF'
  ]]);
  env.setBook(book);
  env.run(`
    exigerAdministrateur_ = function () { return { identifiantHistorique: 'TEST' }; };
    getFormations = function () { return ['F1']; };
    journaliserActionSensible_ = function () {};
  `);
  env.context.__create = {
    formation: 'F1', idCategorie: 'CAT-1', intitule: 'Item initial',
    description: 'Description', ordre: 1, actif: true
  };
  const created = env.run(
    'enregistrerItemReferentiel(__create, "token-test");'
  );
  assert.strictEqual(created.succes, true);
  env.context.__update = {
    idItem: created.idItem, formation: 'F1', idCategorie: 'CAT-1',
    intitule: 'Item modifié', description: 'Nouvelle description',
    ordre: 1, actif: false
  };
  const updated = env.run(
    'enregistrerItemReferentiel(__update, "token-test");'
  );
  assert.strictEqual(updated.succes, true);
  const data = book.getSheetByName('REFERENTIEL').data;
  assert.strictEqual(data.length, 2);
  assert.strictEqual(data[1][3], 'Item modifié');
  assert.strictEqual(data[1][4], 'Nouvelle description');
  assert.strictEqual(data[1][6], 'Non');
});

test('diagnostic staging localise uniquement la première Date différente', () => {
  const env = createContext([
    'MigrationService.js',
    'SauvegardeService.js',
    'RestaurationService.js'
  ]);
  const book = new FakeBook();
  const dateRelue = new Date('2026-08-04T10:00:00.000Z');
  const sheet = book.add('__PF_STG_TEST_0', [[
    'ID_STAGIAIRE', 'DATE_STAGE', 'ACTIF'
  ], [
    'S-1', dateRelue, false
  ]]);
  env.setBook(book);
  env.context.__sheet = sheet;
  env.context.__expected = {
    exists: true,
    headers: ['ID_STAGIAIRE', 'DATE_STAGE', 'ACTIF'],
    rows: [[
      'S-1',
      { type: 'DATE_ISO_UTC', value: '2026-08-04T09:00:00.000Z' },
      true
    ]],
    rowCount: 1,
    columnCount: 3,
    cellCount: 6,
    idColumn: 'ID_STAGIAIRE',
    identifiedRowCount: 1
  };
  env.context.__actual = {
    exists: true,
    headers: ['ID_STAGIAIRE', 'DATE_STAGE', 'ACTIF'],
    rows: [[
      'S-1',
      { type: 'DATE_ISO_UTC', value: '2026-08-04T10:00:00.000Z' },
      false
    ]],
    rowCount: 1,
    columnCount: 3,
    cellCount: 6,
    idColumn: 'ID_STAGIAIRE',
    identifiedRowCount: 1
  };
  const diagnostic = env.run(
    'construireDiagnosticDivergenceStaging_(__sheet, __expected, __actual, "hash-avant", "hash-apres", "hash-signe");'
  );
  assert.strictEqual(
    diagnostic.empreinteCalculeeAvantEcriture,
    'hash-avant'
  );
  assert.strictEqual(
    diagnostic.empreinteRelueApresEcriture,
    'hash-apres'
  );
  assert.strictEqual(diagnostic.premiereDifference.ligne, 2);
  assert.strictEqual(diagnostic.premiereDifference.colonne, 2);
  assert.strictEqual(
    diagnostic.premiereDifference.entete,
    'DATE_STAGE'
  );
  assert.strictEqual(
    diagnostic.premiereDifference.valeurAttendueAffichee,
    '{"type":"DATE_ISO_UTC","value":"2026-08-04T09:00:00.000Z"}'
  );
  assert.strictEqual(
    diagnostic.premiereDifference.valeurRelueAffichee,
    '"2026-08-04T10:00:00.000Z"'
  );
  assert.strictEqual(diagnostic.premiereDifference.typeAttendu, 'Date');
  assert.strictEqual(diagnostic.premiereDifference.typeRelu, 'Date');
  assert.strictEqual(
    diagnostic.premiereDifference.categorieDifference,
    'Date'
  );
  env.context.__diagnostic = diagnostic;
  const message = env.run(
    'formaterErreurDivergenceStaging_("STAGIAIRES", __diagnostic);'
  );
  assert(message.includes('Empreinte attendue=hash-signe'));
  assert(message.includes('empreinte relue=hash-apres'));
  assert(message.includes('première cellule différente=B2'));
  assert(message.includes('ligne Google=2'));
  assert(message.includes('colonne=DATE_STAGE (#2)'));
  assert(message.includes(
    'valeur attendue (JSON.stringify)={"type":"DATE_ISO_UTC","value":"2026-08-04T09:00:00.000Z"}'
  ));
  assert(message.includes(
    'valeur relue (JSON.stringify)="2026-08-04T10:00:00.000Z"'
  ));
  assert(message.includes('type attendu=Date'));
  assert(message.includes('type relu=Date'));
  env.context.__messageDiagnostic = message;
  const messagePublic = env.run(
    'nettoyerMessagePublicRestauration_(new Error(__messageDiagnostic));'
  );
  assert.strictEqual(messagePublic, message);
});

test('diagnostic staging identifie une cellule réellement vide', () => {
  const env = createContext([
    'MigrationService.js',
    'SauvegardeService.js',
    'RestaurationService.js'
  ]);
  const book = new FakeBook();
  const sheet = book.add('__PF_STG_TEST_1', [[
    'ID_STAGIAIRE', 'TELEPHONE'
  ], [
    'S-1', ''
  ]]);
  env.setBook(book);
  env.context.__sheet = sheet;
  env.context.__expected = {
    exists: true,
    headers: ['ID_STAGIAIRE', 'TELEPHONE'],
    rows: [['S-1', '0600000000']],
    rowCount: 1,
    columnCount: 2,
    cellCount: 4,
    idColumn: 'ID_STAGIAIRE',
    identifiedRowCount: 1
  };
  env.context.__actual = {
    exists: true,
    headers: ['ID_STAGIAIRE', 'TELEPHONE'],
    rows: [['S-1', '']],
    rowCount: 1,
    columnCount: 2,
    cellCount: 4,
    idColumn: 'ID_STAGIAIRE',
    identifiedRowCount: 1
  };
  const diagnostic = env.run(
    'construireDiagnosticDivergenceStaging_(__sheet, __expected, __actual, "avant", "apres", "signe");'
  );
  assert.strictEqual(diagnostic.premiereDifference.ligne, 2);
  assert.strictEqual(diagnostic.premiereDifference.colonne, 2);
  assert.strictEqual(
    diagnostic.premiereDifference.typeAttendu,
    'chaîne'
  );
  assert.strictEqual(
    diagnostic.premiereDifference.typeRelu,
    'cellule vide'
  );
  assert.strictEqual(
    diagnostic.premiereDifference.categorieDifference,
    'cellule vide'
  );
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.fn();
    passed++;
    process.stdout.write(`✓ ${entry.name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${entry.name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write(`\n${passed}/${tests.length} tests réussis.\n`);
if (passed !== tests.length) process.exit(1);
