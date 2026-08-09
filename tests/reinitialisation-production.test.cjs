'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(
  path.join(ROOT, 'ReinitialisationProductionService.js'),
  'utf8'
);
const INTERFACE = fs.readFileSync(
  path.join(ROOT, 'JavaScript.html'),
  'utf8'
);
const ADMINISTRATION = fs.readFileSync(
  path.join(ROOT, 'Administration.html'),
  'utf8'
);
const METADONNEES = fs.readFileSync(
  path.join(ROOT, 'ApplicationMetadataService.js'),
  'utf8'
);

const SCHEMA = [
  ['PARAMETRES', ['CLE', 'VALEUR', 'ORDRE', 'ACTIF']],
  ['STAGIAIRES', ['UUID', 'NOM', 'PHOTO_FILE_ID']],
  ['FORMATEURS', ['ID_FORMATEUR', 'NOM']],
  ['FORMATIONS', ['ID_FORMATION', 'LIBELLE']],
  ['SESSIONS', ['ID_SESSION', 'FORMATION']],
  ['PRESENCES_STAGIAIRES', ['ID_PRESENCE', 'ID_SESSION', 'ID_STAGIAIRE']],
  ['PRESTATIONS_FORMATEURS', ['ID_PRESTATION', 'ID_SESSION', 'ID_FORMATEUR']],
  ['REFERENTIEL', ['ID_ITEM', 'FORMATION', 'ID_CATEGORIE']],
  ['CATEGORIES', ['ID_CATEGORIE', 'FORMATION']],
  ['EVALUATIONS', ['ID_EVALUATION', 'ID_SESSION', 'ID_STAGIAIRE', 'ID_ITEM']],
  ['HISTORIQUE', ['ID_HISTORIQUE', 'ACTION']],
  ['HISTORIQUE_INDEMNISATIONS', ['ID_HISTORIQUE', 'ID_PRESTATION']],
  ['ITEMS_SESSIONS', ['ID_SESSION_ITEM', 'ID_SESSION', 'ID_ITEM']],
  ['HISTORIQUE_ENVOIS_INDEMNISATIONS', ['ID_ENVOI', 'ID_PRESTATIONS']],
  ['FAVORIS', ['ID_FAVORI', 'TYPE', 'IDENTIFIANT']],
  ['HISTORIQUE_IMPORTS_REFERENTIEL', ['ID_IMPORT', 'NOM_FICHIER']],
  ['UTILISATEURS', ['ID_UTILISATEUR', 'ID_FORMATEUR', 'IDENTIFIANT']]
].map(([feuille, colonnes]) => ({ feuille, colonnes }));

const RESET = [
  'STAGIAIRES',
  'FORMATEURS',
  'UTILISATEURS',
  'SESSIONS',
  'PRESENCES_STAGIAIRES',
  'PRESTATIONS_FORMATEURS',
  'ITEMS_SESSIONS',
  'EVALUATIONS',
  'HISTORIQUE_INDEMNISATIONS',
  'HISTORIQUE_ENVOIS_INDEMNISATIONS',
  'FAVORIS'
];

const CONSERVEES = [
  'PARAMETRES',
  'FORMATIONS',
  'CATEGORIES',
  'REFERENTIEL',
  'HISTORIQUE',
  'HISTORIQUE_IMPORTS_REFERENTIEL'
];


class FakeRange {
  constructor(sheet, row, column, rows, columns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rows = rows;
    this.columns = columns;
  }

  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.columns }, (_, c) =>
        this.sheet.valueAt(this.row + r, this.column + c)
      )
    );
  }

  getFormulas() {
    return Array.from({ length: this.rows }, () =>
      Array(this.columns).fill('')
    );
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

  clearContent() {
    this.sheet.book.clearCalls++;
    if (this.sheet.book.failClearSheet === this.sheet.name) {
      this.sheet.book.failClearSheet = '';
      throw new Error('Échec de suppression intermédiaire simulé.');
    }
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        this.sheet.setValueAt(this.row + r, this.column + c, '');
      }
    }
    return this;
  }
}


class FakeSheet {
  constructor(book, name, data) {
    this.book = book;
    this.name = name;
    this.data = data.map(row => row.slice());
  }

  getName() { return this.name; }

  getLastColumn() {
    return this.data[0] ? this.data[0].length : 0;
  }

  getLastRow() {
    for (let row = this.data.length - 1; row >= 0; row--) {
      if (this.data[row].some(value => value !== '' && value !== null)) {
        return row + 1;
      }
    }
    return 0;
  }

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

  valueAt(row, column) {
    return (this.data[row - 1] || [])[column - 1] ?? '';
  }

  setValueAt(row, column, value) {
    while (this.data.length < row) {
      this.data.push(Array(this.getLastColumn()).fill(''));
    }
    while (this.data[row - 1].length < column) {
      this.data[row - 1].push('');
    }
    this.data[row - 1][column - 1] = value;
  }

  snapshot() {
    const result = this.data.map(row => row.slice());
    while (
      result.length > 1 &&
      result[result.length - 1].every(value => value === '')
    ) {
      result.pop();
    }
    return result;
  }
}


class FakeBook {
  constructor(data) {
    this.sheets = new Map();
    this.clearCalls = 0;
    this.failClearSheet = '';
    this.deleteCalls = 0;
    Object.keys(data).forEach(name => {
      this.sheets.set(name, new FakeSheet(this, name, data[name]));
    });
  }

  getSheetByName(name) { return this.sheets.get(name) || null; }
  getSheets() { return [...this.sheets.values()]; }
  deleteSheet() { this.deleteCalls++; throw new Error('Suppression interdite'); }
}


class FakeFile {
  constructor(id, options) {
    this.id = id;
    this.trashed = false;
    this.options = options;
  }

  isTrashed() { return this.trashed; }

  setTrashed(value) {
    if (value && this.options.failPhoto === this.id) {
      this.options.failPhoto = '';
      throw new Error('Échec Drive simulé.');
    }
    if (!value && this.options.failPhotoRollback === this.id) {
      this.options.failPhotoRollback = '';
      throw new Error('Échec de rollback Drive simulé.');
    }
    this.trashed = Boolean(value);
    return this;
  }
}


function createProperties() {
  const values = {};
  return {
    getProperty: key => values[key] ?? null,
    setProperty: (key, value) => { values[key] = String(value); },
    deleteProperty: key => { delete values[key]; },
    getProperties: () => ({ ...values }),
    values
  };
}


function baseData(withRows = true) {
  const data = {};
  SCHEMA.forEach(configuration => {
    data[configuration.feuille] = [configuration.colonnes.slice()];
  });
  data.PARAMETRES.push(['VERSION_SCHEMA', 7, 1, true]);
  data.FORMATIONS.push(['F-EQPS', 'EQ PS']);
  data.CATEGORIES.push(['CAT-1', 'F-EQPS']);
  data.REFERENTIEL.push(['ITEM-1', 'F-EQPS', 'CAT-1']);
  data.HISTORIQUE.push(['H-TECHNIQUE', 'MIGRATION']);
  data.HISTORIQUE_IMPORTS_REFERENTIEL.push(['IMPORT-1', 'reference.xlsx']);

  if (!withRows) return data;

  data.STAGIAIRES.push(
    ['ST-1', 'Martin', 'PHOTO-1'],
    ['ST-2', 'Durand', 'PHOTO-2']
  );
  data.FORMATEURS.push(['FO-1', 'Dupont']);
  data.UTILISATEURS.push(['UT-1', 'FO-1', 'dupont']);
  data.SESSIONS.push(['SE-1', 'F-EQPS']);
  data.PRESENCES_STAGIAIRES.push(['PR-1', 'SE-1', 'ST-1']);
  data.PRESTATIONS_FORMATEURS.push(['PF-1', 'SE-1', 'FO-1']);
  data.ITEMS_SESSIONS.push(['IS-1', 'SE-1', 'ITEM-1']);
  data.EVALUATIONS.push(['EV-1', 'SE-1', 'ST-1', 'ITEM-1']);
  data.HISTORIQUE_INDEMNISATIONS.push(['HI-1', 'PF-1']);
  data.HISTORIQUE_ENVOIS_INDEMNISATIONS.push(['HE-1', 'PF-1']);
  data.FAVORIS.push(['FA-1', 'STAGIAIRE', 'ST-1']);
  return data;
}


function createFixture(options) {
  options = options || {};
  const book = new FakeBook(baseData(options.withRows !== false));
  const properties = createProperties();
  const files = {
    'PHOTO-1': new FakeFile('PHOTO-1', options),
    'PHOTO-2': new FakeFile('PHOTO-2', options)
  };
  const audit = [];
  const backupCalls = [];
  let secretSequence = 0;
  let mutationCalls = 0;

  function normalize(value) {
    return String(value || '').trim().toUpperCase();
  }

  function indexHeaders(headers) {
    const result = {};
    headers.forEach((header, index) => { result[normalize(header)] = index; });
    return result;
  }

  function hash(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }

  function canonical(value) {
    return JSON.stringify(value, (_key, item) => {
      if (item instanceof Date) return item.toISOString();
      return item;
    });
  }

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
    Map,
    RegExp,
    Error,
    isNaN,
    SCHEMA_BASE_: SCHEMA,
    TYPE_SAUVEGARDE_AVANT_REINITIALISATION_PRODUCTION_:
      'AUTO_AVANT_REINITIALISATION_PRODUCTION',
    SpreadsheetApp: {
      getActiveSpreadsheet: () => book,
      flush: () => {}
    },
    PropertiesService: {
      getScriptProperties: () => properties
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => {}
      })
    },
    Utilities: {
      getUuid: () => 'OPERATION-1'
    },
    DriveApp: {
      getFileById: id => {
        if (!files[id]) throw new Error('Fichier absent');
        return files[id];
      }
    },
    exigerAdministrateur_: token => {
      if (token !== 'admin-token') {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return { identifiantHistorique: 'SESSION-ADMIN-1' };
    },
    exigerEcritureAutorisee_: () => {
      if (options.restaurationActive) {
        throw new Error('Une restauration est en cours.');
      }
    },
    executerMutationMetier_: treatment => {
      mutationCalls++;
      if (options.restaurationActive) {
        throw new Error('Une restauration est en cours.');
      }
      return treatment();
    },
    creerSecretAleatoireSecurite_: () =>
      ('SECRET' + (++secretSequence)).padEnd(48, 'X'),
    revaliderMotDePasseAdministrateur_: password => password === 'correct',
    creerIndexMigration_: indexHeaders,
    normaliserMigration_: normalize,
    canonicaliserSauvegarde_: canonical,
    hacherTexteSauvegarde_: hash,
    lireVersionSchemaSansCreation_: () => {
      const values = book.getSheetByName('PARAMETRES').snapshot();
      const row = values.slice(1).find(line => line[0] === 'VERSION_SCHEMA');
      return row ? Number(row[1]) : 0;
    },
    listerFeuillesTechniquesRestauration_: () =>
      options.technicalSheets || [],
    construireRapportIntegrite_: () => {
      const resetEmpty = RESET.every(name =>
        book.getSheetByName(name).getLastRow() <= 1
      );
      const errors = resetEmpty && options.failFinalDiagnostic
        ? [{ type: 'REFERENCE_INCOHERENTE', feuille: 'EVALUATIONS' }]
        : (options.orphans || []);
      return {
        erreurs: errors,
        resume: {
          conforme: errors.length === 0,
          totalErreurs: errors.length,
          erreursStructure: 0,
          referencesIncoherentes: errors.length
        },
        versionSchema: 7,
        versionCible: 7,
        dateDiagnostic: '2026-08-08T10:00:00.000Z'
      };
    },
    creerSauvegardeCompleteInterne_: (...args) => {
      backupCalls.push(args);
      if (options.failBackup) throw new Error('Sauvegarde impossible.');
      return {
        backupId: 'BACKUP-SECURITE-1',
        verificationIntegrite: !options.invalidBackup
      };
    },
    verifierFichierPhotoStagiaire_: () => {
      if (options.foreignPhoto) throw new Error('Photo étrangère.');
    },
    journaliserActionSensible_: (...args) => audit.push(args),
    journaliserEvenementSecuriteSansBloquer_: (...args) => audit.push(args),
    invaliderCacheStatistiques_: () => {},
    invaliderCacheCalendrier_: () => {}
  });

  new vm.Script(SOURCE, {
    filename: 'ReinitialisationProductionService.js'
  }).runInContext(context);

  return {
    context,
    book,
    properties,
    files,
    audit,
    backupCalls,
    mutationCalls: () => mutationCalls,
    run: expression => vm.runInContext(expression, context)
  };
}


function snapshotSheets(book, names) {
  const result = {};
  names.forEach(name => {
    result[name] = book.getSheetByName(name).snapshot();
  });
  return result;
}


function preparePlan(fixture) {
  fixture.context.__book = fixture.book;
  const state = fixture.run(
    'analyserEtatReinitialisationProduction_(__book)'
  );
  return {
    signatureEtat: state.signatureEtat,
    versionSchema: state.versionSchema,
    compteurs: state.compteurs,
    adminSessionAuditId: 'SESSION-ADMIN-1'
  };
}


const tests = [];
function test(name, fn) { tests.push({ name, fn }); }


test('la liste métier est explicite et aucune feuille conservée ne peut être vidée', () => {
  const fixture = createFixture();
  assert.deepStrictEqual(
    Array.from(fixture.run(
      'FEUILLES_REINITIALISATION_PRODUCTION_.map(function (c) { return c.feuille; })'
    )),
    RESET
  );
  assert.deepStrictEqual(
    Array.from(fixture.run(
      'FEUILLES_CONSERVEES_REINITIALISATION_PRODUCTION_.slice()'
    )),
    CONSERVEES
  );
  assert(!SOURCE.includes('deleteSheet('));
  assert(SOURCE.includes('.clearContent()'));
});


test('la prévisualisation compte les données, photos et références orphelines', () => {
  const fixture = createFixture({
    orphans: [{
      type: 'REFERENCE_INCOHERENTE',
      feuille: 'EVALUATIONS',
      colonne: 'ID_STAGIAIRE',
      cible: 'STAGIAIRES.UUID',
      message: 'Stagiaire manquant.'
    }]
  });
  const preview = fixture.context.previsualiserReinitialisationProduction(
    'admin-token'
  );
  assert.equal(preview.compteurs.stagiaires, 2);
  assert.equal(preview.compteurs.formateurs, 1);
  assert.equal(preview.compteurs.sessions, 1);
  assert.equal(preview.compteurs.historiquesIndemnisation, 2);
  assert.equal(preview.photosStagiairesConcernees, 2);
  assert.equal(preview.referencesOrphelines.length, 1);
  assert.equal(preview.confirmationRequise, 'MISE EN PRODUCTION');
  assert(!JSON.stringify(preview).includes('PHOTO-1'));
});


test('une base remplie est vidée par lots après sauvegarde vérifiée', () => {
  const fixture = createFixture();
  const preservedBefore = snapshotSheets(fixture.book, CONSERVEES);
  const plan = preparePlan(fixture);
  fixture.context.__plan = plan;
  const result = fixture.run(
    'executerReinitialisationProductionInterne_(__plan, { identifiantHistorique: "SESSION-ADMIN-1" }, "admin-token", "OP-1")'
  );
  RESET.forEach(name => {
    assert.equal(fixture.book.getSheetByName(name).getLastRow(), 1, name);
  });
  assert.deepStrictEqual(snapshotSheets(fixture.book, CONSERVEES), preservedBefore);
  assert.equal(fixture.book.deleteCalls, 0);
  assert.equal(fixture.files['PHOTO-1'].trashed, true);
  assert.equal(fixture.files['PHOTO-2'].trashed, true);
  assert.equal(result.succes, true);
  assert.equal(result.referentielConserve, true);
  assert.equal(result.versionSchema, 7);
  assert.equal(fixture.backupCalls[0][1], 'AUTO_AVANT_REINITIALISATION_PRODUCTION');
  assert.equal(fixture.backupCalls[0][4], true);
});


test('une base vide reste conforme sans suppression de structure', () => {
  const fixture = createFixture({ withRows: false });
  const plan = preparePlan(fixture);
  fixture.context.__plan = plan;
  const result = fixture.run(
    'executerReinitialisationProductionInterne_(__plan, { identifiantHistorique: "SESSION-ADMIN-1" }, "admin-token", "OP-VIDE")'
  );
  assert.equal(result.succes, true);
  assert.equal(fixture.book.clearCalls, 0);
  assert.equal(fixture.book.deleteCalls, 0);
  RESET.forEach(name => {
    assert.deepStrictEqual(
      fixture.book.getSheetByName(name).snapshot(),
      [SCHEMA.find(item => item.feuille === name).colonnes]
    );
  });
});


test('un échec de sauvegarde bloque toute suppression et toute photo', () => {
  const fixture = createFixture({ failBackup: true });
  const before = snapshotSheets(fixture.book, SCHEMA.map(item => item.feuille));
  const plan = preparePlan(fixture);
  fixture.context.__plan = plan;
  assert.throws(() => fixture.run(
    'executerReinitialisationProductionInterne_(__plan, { identifiantHistorique: "SESSION-ADMIN-1" }, "admin-token", "OP-BACKUP")'
  ), /Sauvegarde impossible/);
  assert.deepStrictEqual(
    snapshotSheets(fixture.book, SCHEMA.map(item => item.feuille)),
    before
  );
  assert.equal(fixture.files['PHOTO-1'].trashed, false);
});


test('un échec de suppression intermédiaire déclenche un rollback intégral', () => {
  const fixture = createFixture();
  const before = snapshotSheets(fixture.book, SCHEMA.map(item => item.feuille));
  fixture.book.failClearSheet = 'PRESTATIONS_FORMATEURS';
  const plan = preparePlan(fixture);
  fixture.context.__plan = plan;
  assert.throws(() => fixture.run(
    'executerReinitialisationProductionInterne_(__plan, { identifiantHistorique: "SESSION-ADMIN-1" }, "admin-token", "OP-CLEAR")'
  ), /intermédiaire simulé/);
  assert.deepStrictEqual(
    snapshotSheets(fixture.book, SCHEMA.map(item => item.feuille)),
    before
  );
  assert.equal(fixture.files['PHOTO-1'].trashed, false);
});


test('un diagnostic final invalide restaure les lignes et les photos', () => {
  const fixture = createFixture({ failFinalDiagnostic: true });
  const before = snapshotSheets(fixture.book, SCHEMA.map(item => item.feuille));
  const plan = preparePlan(fixture);
  fixture.context.__plan = plan;
  assert.throws(() => fixture.run(
    'executerReinitialisationProductionInterne_(__plan, { identifiantHistorique: "SESSION-ADMIN-1" }, "admin-token", "OP-DIAG")'
  ), /diagnostic final/);
  assert.deepStrictEqual(
    snapshotSheets(fixture.book, SCHEMA.map(item => item.feuille)),
    before
  );
  assert.equal(fixture.files['PHOTO-1'].trashed, false);
  assert.equal(fixture.files['PHOTO-2'].trashed, false);
});


test('un échec Drive après une photo restaure la première photo et les lignes', () => {
  const fixture = createFixture({ failPhoto: 'PHOTO-2' });
  const before = snapshotSheets(fixture.book, RESET);
  const plan = preparePlan(fixture);
  fixture.context.__plan = plan;
  assert.throws(() => fixture.run(
    'executerReinitialisationProductionInterne_(__plan, { identifiantHistorique: "SESSION-ADMIN-1" }, "admin-token", "OP-PHOTO")'
  ), /Drive simulé/);
  assert.deepStrictEqual(snapshotSheets(fixture.book, RESET), before);
  assert.equal(fixture.files['PHOTO-1'].trashed, false);
  assert.equal(fixture.files['PHOTO-2'].trashed, false);
});


test('un rollback photo impossible ne restaure pas prématurément les stagiaires', () => {
  const fixture = createFixture({
    failFinalDiagnostic: true,
    failPhotoRollback: 'PHOTO-2'
  });
  const plan = preparePlan(fixture);
  fixture.context.__plan = plan;
  assert.throws(() => fixture.run(
    'executerReinitialisationProductionInterne_(__plan, { identifiantHistorique: "SESSION-ADMIN-1" }, "admin-token", "OP-PHOTO-RBK")'
  ), /rollback automatique est incomplet.*BACKUP-SECURITE-1/);
  assert.equal(fixture.book.getSheetByName('STAGIAIRES').getLastRow(), 1);
  assert.equal(fixture.files['PHOTO-2'].trashed, true);
});


test('une modification après prévisualisation bloque avant la sauvegarde', () => {
  const fixture = createFixture();
  const plan = preparePlan(fixture);
  fixture.book.getSheetByName('STAGIAIRES').setValueAt(2, 2, 'Modifié');
  fixture.context.__plan = plan;
  assert.throws(() => fixture.run(
    'executerReinitialisationProductionInterne_(__plan, { identifiantHistorique: "SESSION-ADMIN-1" }, "admin-token", "OP-CHANGE")'
  ), /données ont changé/);
  assert.equal(fixture.backupCalls.length, 0);
  assert.equal(fixture.book.clearCalls, 0);
});


test('la phrase exacte et le mot de passe sont tous deux obligatoires', () => {
  const fixture = createFixture();
  const preview = fixture.context.previsualiserReinitialisationProduction(
    'admin-token'
  );
  assert.throws(() => fixture.context.confirmerReinitialisationProduction(
    preview.previewId,
    'mise en production',
    'correct',
    'admin-token'
  ), /exactement MISE EN PRODUCTION/);
  assert.throws(() => fixture.context.confirmerReinitialisationProduction(
    preview.previewId,
    'MISE EN PRODUCTION',
    'incorrect',
    'admin-token'
  ), /Mot de passe administrateur incorrect/);
  assert(fixture.audit.some(entry =>
    entry[0] === 'REINITIALISATION_PRODUCTION_CONFIRMATION_REFUSEE'
  ));
});


test('le jeton de confirmation est à usage unique et résiste au double clic', () => {
  const fixture = createFixture();
  const preview = fixture.context.previsualiserReinitialisationProduction(
    'admin-token'
  );
  const confirmation = fixture.context.confirmerReinitialisationProduction(
    preview.previewId,
    'MISE EN PRODUCTION',
    'correct',
    'admin-token'
  );
  const first = fixture.context.executerReinitialisationProductionConfirmee(
    confirmation.confirmationId,
    'admin-token'
  );
  assert.equal(first.succes, true);
  assert.throws(() =>
    fixture.context.executerReinitialisationProductionConfirmee(
      confirmation.confirmationId,
      'admin-token'
    ),
  /déjà été consommée/);
  assert.equal(fixture.mutationCalls(), 1);
});


test('un jeton expiré est refusé sans mutation', () => {
  const fixture = createFixture();
  const id = 'X'.repeat(48);
  fixture.context.__id = id;
  const key = fixture.run(
    'PREFIXE_CONFIRMATION_REINITIALISATION_ + hacherIdentifiantReinitialisation_(__id)'
  );
  fixture.properties.setProperty(key, JSON.stringify({
    plan: {},
    adminSessionAuditId: 'SESSION-ADMIN-1',
    expireA: 1
  }));
  assert.throws(() =>
    fixture.context.executerReinitialisationProductionConfirmee(
      id,
      'admin-token'
    ),
  /expirée/);
  assert.equal(fixture.mutationCalls(), 0);
});


test('une restauration active bloque prévisualisation et exécution', () => {
  const fixture = createFixture({ restaurationActive: true });
  assert.throws(() =>
    fixture.context.previsualiserReinitialisationProduction('admin-token'),
  /restauration est en cours/);
  assert.equal(fixture.book.clearCalls, 0);
});


test('le volume transactionnel excessif est refusé avant toute écriture', () => {
  const fixture = createFixture();
  assert.throws(() => fixture.run(
    'verifierVolumeSnapshotReinitialisation_(500001)'
  ), /500[\s.\u202f]?000 cellules/);
  assert.equal(fixture.book.clearCalls, 0);
});


test('l’interface expose le bloc administrateur et la confirmation renforcée', () => {
  assert(ADMINISTRATION.includes('Mise en production'));
  assert(ADMINISTRATION.includes('Réinitialiser les données métier'));
  assert(ADMINISTRATION.includes('MISE EN PRODUCTION'));
  assert(ADMINISTRATION.includes('type="password"'));
  assert(INTERFACE.includes('.previsualiserReinitialisationProduction('));
  assert(INTERFACE.includes('.confirmerReinitialisationProduction('));
  assert(INTERFACE.includes('.executerReinitialisationProductionConfirmee('));
  assert(!INTERFACE.includes('sessionStorage.setItem(\'motDePasse'));
});


test('le service n’ajoute ni migration ni restauration réelle', () => {
  assert(!SOURCE.includes('insertSheet('));
  assert(!SOURCE.includes('executerMigrations('));
  assert(!SOURCE.includes('executerRestaurationConfirmee('));
  assert(!SOURCE.includes('setProperty(\'VERSION_SCHEMA\''));
});


test('la version applicative est centralisée à 2.0.0', () => {
  assert(METADONNEES.includes(
    "VERSION_APPLICATION_PREPFORMATION_ = '2.0.0'"
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

process.stdout.write(
  `\n${passed}/${tests.length} tests de réinitialisation réussis.\n`
);
if (passed !== tests.length) process.exit(1);
