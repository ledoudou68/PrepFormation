'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const sourceService = fs.readFileSync(
  path.join(racine, 'ImportReferentielService.js'),
  'utf8'
);
const sourceMigration = fs.readFileSync(
  path.join(racine, 'MigrationService.js'),
  'utf8'
);
const sourceReferentiel = fs.readFileSync(
  path.join(racine, 'ReferentielService.js'),
  'utf8'
);
const sourceInterface = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
);
const htmlReferentiel = fs.readFileSync(
  path.join(racine, 'Referentiel.html'),
  'utf8'
);
const manifeste = JSON.parse(fs.readFileSync(
  path.join(racine, 'appsscript.json'),
  'utf8'
));
const metadonnees = fs.readFileSync(
  path.join(racine, 'ApplicationMetadataService.js'),
  'utf8'
);


function creerContexte() {
  let sequence = 0;
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
    Buffer,
    Utilities: {
      getUuid: () => 'UUID-' + (++sequence),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithme, texte) => Array.from(
        crypto.createHash('sha256').update(String(texte), 'utf8').digest()
      ),
      base64EncodeWebSafe: octets => Buffer.from(octets).toString('base64url')
    }
  };
  vm.createContext(contexte);
  vm.runInContext(
    "const TYPE_SAUVEGARDE_AVANT_OPERATION_ADMIN_ = 'AUTO_AVANT_OPERATION_ADMIN';\n" +
      sourceService,
    contexte,
    {
    filename: 'ImportReferentielService.js'
    }
  );
  return contexte;
}


function matriceXlsx(lignes, entetes) {
  return [
    entetes || [
      'Type de formation',
      'Titre du chapitre',
      'Item',
      'Nature'
    ]
  ].concat(lignes);
}


function fixtureReelle146() {
  const types = ['Prompt secours', 'Équipier VSAV', 'Chef d’agrès'];
  const lignes = [];
  for (let i = 0; i < 146; i++) {
    lignes.push([
      types[i % types.length],
      'Chapitre ' + ((i % 23) + 1),
      'Item pédagogique ' + (i + 1),
      i % 2 ? 'Technique' : 'Théorie'
    ]);
  }
  return matriceXlsx(lignes);
}


function analyseSimple(contexte, lignes) {
  return contexte.analyserValeursXlsxReferentiel_(
    'Référentiel SIS68',
    matriceXlsx(lignes),
    'referentiel.xlsx',
    1234
  );
}


class FaussePlage {
  constructor(feuille, ligne, colonne, nombreLignes, nombreColonnes) {
    this.feuille = feuille;
    this.ligne = ligne;
    this.colonne = colonne;
    this.nombreLignes = nombreLignes;
    this.nombreColonnes = nombreColonnes;
  }

  getValues() {
    return Array.from({ length: this.nombreLignes }, (_, r) =>
      Array.from({ length: this.nombreColonnes }, (_, c) =>
        this.feuille.valeur(this.ligne + r, this.colonne + c)
      )
    );
  }

  getFormulas() {
    return Array.from({ length: this.nombreLignes }, () =>
      Array(this.nombreColonnes).fill('')
    );
  }

  setValues(valeurs) {
    this.feuille.ecritures++;
    for (let r = 0; r < this.nombreLignes; r++) {
      for (let c = 0; c < this.nombreColonnes; c++) {
        this.feuille.definir(
          this.ligne + r,
          this.colonne + c,
          valeurs[r][c]
        );
      }
    }
    return this;
  }

  clearContent() {
    for (let r = 0; r < this.nombreLignes; r++) {
      for (let c = 0; c < this.nombreColonnes; c++) {
        this.feuille.definir(this.ligne + r, this.colonne + c, '');
      }
    }
    return this;
  }
}


class FausseFeuille {
  constructor(nom, donnees) {
    this.nom = nom;
    this.donnees = donnees.map(ligne => ligne.slice());
    this.ecritures = 0;
  }
  getName() { return this.nom; }
  getLastRow() { return this.donnees.length; }
  getLastColumn() { return this.donnees[0].length; }
  getDataRange() {
    return new FaussePlage(
      this,
      1,
      1,
      this.getLastRow(),
      this.getLastColumn()
    );
  }
  getRange(ligne, colonne, nombreLignes, nombreColonnes) {
    return new FaussePlage(
      this,
      ligne,
      colonne,
      nombreLignes,
      nombreColonnes
    );
  }
  valeur(ligne, colonne) {
    return (this.donnees[ligne - 1] || [])[colonne - 1] ?? '';
  }
  definir(ligne, colonne, valeur) {
    while (this.donnees.length < ligne) {
      this.donnees.push(Array(this.getLastColumn()).fill(''));
    }
    while (this.donnees[ligne - 1].length < colonne) {
      this.donnees[ligne - 1].push('');
    }
    this.donnees[ligne - 1][colonne - 1] = valeur;
  }
  copie() {
    const copie = this.donnees.map(ligne => ligne.slice());
    while (
      copie.length > 1 &&
      copie[copie.length - 1].every(valeur => valeur === '')
    ) {
      copie.pop();
    }
    return copie;
  }
}


function installerTransaction(contexte, options) {
  const parametres = options || {};
  const feuilles = {
    CATEGORIES: new FausseFeuille('CATEGORIES', [
      ['ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ORDRE', 'ACTIF'],
      ['C1', 'F1', 'Chapitre existant', 1, 'Oui']
    ]),
    REFERENTIEL: new FausseFeuille('REFERENTIEL', [
      ['ID_ITEM', 'FORMATION', 'ID_CATEGORIE', 'ITEM', 'DESCRIPTION', 'ORDRE', 'ACTIF', 'NATURE'],
      ['I1', 'F1', 'C1', 'Item existant', '', 1, 'Oui', '']
    ]),
    HISTORIQUE_IMPORTS_REFERENTIEL: new FausseFeuille(
      'HISTORIQUE_IMPORTS_REFERENTIEL',
      [[
        'ID_IMPORT', 'DATE_IMPORT', 'NOM_FICHIER', 'NOMBRE_LIGNES',
        'CATEGORIES_CREEES', 'ITEMS_CREES', 'ITEMS_EXISTANTS',
        'LIGNES_IGNOREES', 'ANOMALIES', 'SESSION_ADMIN', 'DATE_CREATION'
      ]]
    ),
    HISTORIQUE: new FausseFeuille('HISTORIQUE', [[
      'ID_HISTORIQUE', 'DATE_ACTION', 'UTILISATEUR',
      'ACTION', 'OBJET', 'IDENTIFIANT', 'DETAILS'
    ]])
  };
  const analyse = analyseSimple(contexte, [
    ['Source', 'Chapitre existant', 'Item existant', 'Théorie'],
    ['Source', 'Nouveau chapitre', 'Nouvel item', 'Technique']
  ]);
  const correspondances = [{ source: 'Source', cible: 'F1', ignore: false }];

  function lireCategories(feuille) {
    return feuille.donnees.slice(1).filter(l => l[0]).map((ligne, i) => ({
      idCategorie: ligne[0], formation: ligne[1], intitule: ligne[2],
      ordre: Number(ligne[3]), actif: ligne[4] === 'Oui', numeroLigne: i + 2
    }));
  }
  function lireItems(feuille) {
    return feuille.donnees.slice(1).filter(l => l[0]).map((ligne, i) => ({
      idItem: ligne[0], formation: ligne[1], idCategorie: ligne[2],
      intitule: ligne[3], description: ligne[4], ordre: Number(ligne[5]),
      actif: ligne[6] === 'Oui', nature: ligne[7], numeroLigne: i + 2
    }));
  }

  contexte.lireCategoriesReferentiel_ = lireCategories;
  contexte.lireItemsReferentiel_ = lireItems;
  contexte.creerIndexReferentiel_ = entetes => {
    const index = {};
    entetes.forEach((entete, i) => { index[String(entete)] = i; });
    return index;
  };
  contexte.lireFormationsActives_ = () => ['F1'];
  contexte.preparerDonneesReferentiel_ = () => ({
    feuilleCategories: feuilles.CATEGORIES,
    feuilleItems: feuilles.REFERENTIEL
  });
  contexte.assurerFeuilleMigration_ = (_classeur, nom) => feuilles[nom];
  contexte.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({}),
    flush: () => {}
  };
  contexte.exigerAdministrateur_ = () => ({
    identifiantHistorique: 'SESSION_ADMIN:TEST'
  });
  contexte.executerMutationMetier_ = traitement => traitement();
  contexte.creerSauvegardeCompleteInterne_ = () => {
    if (parametres.echecSauvegarde) {
      throw new Error('Sauvegarde impossible');
    }
    return { backupId: 'BACKUP-1', verificationIntegrite: true };
  };
  contexte.journaliserActionSensible_ = () => {
    if (parametres.echecApresEcriture) {
      throw new Error('Échec après écriture');
    }
  };
  contexte.supprimerObjetImportReferentiel_ = () => {};

  const plan = contexte.construirePlanFusionImportReferentiel_(
    analyse,
    correspondances,
    ['F1'],
    lireCategories(feuilles.CATEGORIES),
    lireItems(feuilles.REFERENTIEL)
  );
  const planMemorise = {
    idAnalyse: 'ANALYSE-1',
    correspondances,
    signaturePlan: contexte.calculerEmpreinteImportReferentiel_(plan),
    plan
  };
  contexte.lireObjetImportReferentiel_ = prefixe =>
    String(prefixe).includes('PLAN') ? planMemorise : analyse;

  return { feuilles, analyse, plan };
}


const tests = [];
function test(nom, traitement) { tests.push({ nom, traitement }); }


test('la structure réelle 146/23/3 et les deux Natures est analysée', () => {
  const contexte = creerContexte();
  const analyse = contexte.analyserValeursXlsxReferentiel_(
    'Référentiel SIS68', fixtureReelle146(),
    'referentiel_sis68_formations.xlsx', 25000
  );
  assert.strictEqual(analyse.nombreLignes, 146);
  assert.strictEqual(analyse.nombreItems, 146);
  assert.strictEqual(analyse.nombreCategories, 23);
  assert.strictEqual(analyse.typesFormation.length, 3);
  assert.strictEqual(analyse.theories + analyse.techniques, 146);
});

test('la feuille de repli exige les quatre colonnes exactes', () => {
  const contexte = creerContexte();
  const valeurs = fixtureReelle146();
  const feuille = {
    getName: () => 'Premier onglet',
    getDataRange: () => ({ getDisplayValues: () => valeurs })
  };
  const resultat = contexte.extraireValeursClasseurXlsxReferentiel_({
    getSheets: () => [feuille],
    getSheetByName: () => null
  });
  assert.strictEqual(resultat.feuilleRepli, true);
  assert.throws(() => contexte.extraireValeursClasseurXlsxReferentiel_({
    getSheets: () => [{
      getName: () => 'Mauvaise feuille',
      getDataRange: () => ({
        getDisplayValues: () => matriceXlsx(
          [['A', 'B', 'C']],
          ['Type de formation', 'Titre du chapitre', 'Item']
        )
      })
    }],
    getSheetByName: () => null
  }), /Nature/);
});

test('un fichier vide et une colonne absente sont refusés', () => {
  const contexte = creerContexte();
  assert.throws(() => contexte.analyserValeursXlsxReferentiel_(
    'Référentiel SIS68',
    [['Type de formation', 'Titre du chapitre', 'Item', 'Nature']],
    'vide.xlsx', 10
  ), /aucune ligne/i);
  assert.throws(() => contexte.verifierEntetesXlsxReferentiel_([
    'Type de formation', 'Titre du chapitre', 'Item'
  ]), /Nature/);
});

test('les lignes incomplètes, Natures invalides et doublons sont signalés', () => {
  const contexte = creerContexte();
  const analyse = analyseSimple(contexte, [
    ['Source', 'Chapitre', 'Item valide', ' Théorie '],
    ['', 'Chapitre', 'Item incomplet', 'Technique'],
    ['Source', 'Chapitre', 'Item invalide', 'Pratique'],
    ['Source', 'Chapitre', 'Item valide', 'Théorie']
  ]);
  assert.strictEqual(analyse.nombreLignes, 4);
  assert.strictEqual(analyse.nombreLignesValides, 1);
  assert.deepStrictEqual(
    Array.from(analyse.anomalies, anomalie => anomalie.code),
    ['LIGNE_INCOMPLETE', 'NATURE_INVALIDE', 'DOUBLON_FICHIER']
  );
});

test('aucune correspondance de formation n’est devinée', () => {
  const contexte = creerContexte();
  const analyse = analyseSimple(contexte, [
    ['Source inconnue', 'Chapitre', 'Item', 'Théorie']
  ]);
  assert.throws(() => contexte.construirePlanFusionImportReferentiel_(
    analyse, [], ['F1'], [], []
  ), /correspondance/i);
});

test('un type peut être ignoré explicitement', () => {
  const contexte = creerContexte();
  const analyse = analyseSimple(contexte, [
    ['Source A', 'Chapitre A', 'Item A', 'Théorie'],
    ['Source B', 'Chapitre B', 'Item B', 'Technique']
  ]);
  const plan = contexte.construirePlanFusionImportReferentiel_(
    analyse,
    [
      { source: 'Source A', cible: 'F1', ignore: false },
      { source: 'Source B', cible: '', ignore: true }
    ],
    ['F1'], [], []
  );
  assert.strictEqual(plan.itemsACreer.length, 1);
  assert.strictEqual(plan.lignesIgnorees.length, 1);
});

test('les catégories et items normalisés sont réutilisés sans doublon', () => {
  const contexte = creerContexte();
  const analyse = analyseSimple(contexte, [
    ['Source', '  Réanimation  ', 'Massage Cardiaque', 'Théorie'],
    ['Source', 'Nouveau chapitre', 'Nouvel item', 'Technique']
  ]);
  const plan = contexte.construirePlanFusionImportReferentiel_(
    analyse,
    [{ source: 'Source', cible: 'F1', ignore: false }],
    ['F1'],
    [{
      idCategorie: 'C1', formation: 'F1', intitule: 'Reanimation',
      ordre: 1, actif: true
    }],
    [{
      idItem: 'I1', formation: 'F1', idCategorie: 'C1',
      intitule: 'massage cardiaque', ordre: 1, actif: true, nature: ''
    }]
  );
  assert.strictEqual(plan.categoriesReutilisees.length, 1);
  assert.strictEqual(plan.categoriesACreer.length, 1);
  assert.strictEqual(plan.itemsIdentiques.length, 1);
  assert.strictEqual(plan.itemsACreer.length, 1);
  assert.strictEqual(plan.naturesACompleter.length, 1);
  assert.strictEqual(plan.detailsFormations.length, 1);
  assert.strictEqual(plan.detailsFormations[0].categoriesACreer, 1);
  assert.strictEqual(plan.detailsFormations[0].itemsExistants, 1);
});

test('une Nature différente est conservée sans confirmation spécifique', () => {
  const contexte = creerContexte();
  const analyse = analyseSimple(contexte, [
    ['Source', 'Chapitre', 'Item', 'Technique']
  ]);
  const plan = contexte.construirePlanFusionImportReferentiel_(
    analyse,
    [{ source: 'Source', cible: 'F1', ignore: false }],
    ['F1'],
    [{ idCategorie: 'C1', formation: 'F1', intitule: 'Chapitre', ordre: 1 }],
    [{
      idItem: 'I1', formation: 'F1', idCategorie: 'C1',
      intitule: 'Item', ordre: 1, nature: 'Théorie'
    }]
  );
  assert.strictEqual(plan.naturesACompleter.length, 0);
  assert.strictEqual(plan.conflitsNature.length, 1);
  assert.strictEqual(plan.conflitsNature[0].natureExistante, 'Théorie');
});

test('une seconde planification après fusion ne recrée rien', () => {
  const contexte = creerContexte();
  const analyse = analyseSimple(contexte, [
    ['Source', 'Chapitre', 'Item', 'Technique']
  ]);
  const mapping = [{ source: 'Source', cible: 'F1', ignore: false }];
  const premier = contexte.construirePlanFusionImportReferentiel_(
    analyse, mapping, ['F1'], [], []
  );
  assert.strictEqual(premier.categoriesACreer.length, 1);
  assert.strictEqual(premier.itemsACreer.length, 1);
  const second = contexte.construirePlanFusionImportReferentiel_(
    analyse,
    mapping,
    ['F1'],
    [{ idCategorie: 'C1', formation: 'F1', intitule: 'Chapitre', ordre: 1 }],
    [{
      idItem: 'I1', formation: 'F1', idCategorie: 'C1',
      intitule: 'Item', ordre: 1, nature: 'Technique'
    }]
  );
  assert.strictEqual(second.categoriesACreer.length, 0);
  assert.strictEqual(second.itemsACreer.length, 0);
  assert.strictEqual(second.itemsIdentiques.length, 1);
});

test('l’accès sans administrateur est refusé avant tout appel Drive', () => {
  const contexte = creerContexte();
  let driveAppelee = false;
  contexte.exigerAdministrateur_ = () => {
    throw new Error('Accès réservé à l’administrateur.');
  };
  contexte.Drive = { Files: { create: () => { driveAppelee = true; } } };
  assert.throws(() => contexte.analyserFichierXlsxReferentiel(
    { nom: 'test.xlsx', type: '', taille: 1, base64: 'AA==' },
    ''
  ), /Accès réservé/);
  assert.strictEqual(driveAppelee, false);
});

test('un échec de sauvegarde bloque toute écriture', () => {
  const contexte = creerContexte();
  const environnement = installerTransaction(contexte, {
    echecSauvegarde: true
  });
  const avant = Object.fromEntries(Object.entries(environnement.feuilles)
    .map(([nom, feuille]) => [nom, feuille.copie()]));
  assert.throws(() => contexte.importerReferentielXlsx(
    'PLAN-1', 'IMPORTER', [], 'JETON'
  ), /Sauvegarde impossible/);
  Object.entries(environnement.feuilles).forEach(([nom, feuille]) => {
    assert.deepStrictEqual(feuille.copie(), avant[nom]);
  });
});

test('une erreur après écriture déclenche le rollback complet', () => {
  const contexte = creerContexte();
  const environnement = installerTransaction(contexte, {
    echecApresEcriture: true
  });
  const avant = Object.fromEntries(Object.entries(environnement.feuilles)
    .map(([nom, feuille]) => [nom, feuille.copie()]));
  assert.throws(() => contexte.importerReferentielXlsx(
    'PLAN-1', 'IMPORTER', [], 'JETON'
  ), /Échec après écriture/);
  Object.entries(environnement.feuilles).forEach(([nom, feuille]) => {
    assert.deepStrictEqual(feuille.copie(), avant[nom]);
  });
});

test('un import réussi complète la Nature et reste idempotent', () => {
  const contexte = creerContexte();
  const environnement = installerTransaction(contexte);
  const resultat = contexte.importerReferentielXlsx(
    'PLAN-1', 'IMPORTER', [], 'JETON'
  );
  assert.strictEqual(resultat.categoriesCreees, 1);
  assert.strictEqual(resultat.itemsCrees, 1);
  assert.strictEqual(resultat.itemsExistants, 1);
  assert.strictEqual(resultat.naturesRenseignees, 1);
  assert.strictEqual(environnement.feuilles.REFERENTIEL.donnees[1][7], 'Théorie');
  assert.strictEqual(
    environnement.feuilles.HISTORIQUE_IMPORTS_REFERENTIEL.copie().length,
    2
  );

  const planRejoue = contexte.construirePlanFusionImportReferentiel_(
    environnement.analyse,
    [{ source: 'Source', cible: 'F1', ignore: false }],
    ['F1'],
    contexte.lireCategoriesReferentiel_(environnement.feuilles.CATEGORIES),
    contexte.lireItemsReferentiel_(environnement.feuilles.REFERENTIEL)
  );
  assert.strictEqual(planRejoue.categoriesACreer.length, 0);
  assert.strictEqual(planRejoue.itemsACreer.length, 0);
  assert.strictEqual(planRejoue.itemsIdentiques.length, 2);
});

test('le mode fusion ne contient aucune suppression métier', () => {
  assert(!/\.deleteRow\s*\(/.test(sourceService));
  assert(!/\.deleteSheet\s*\(/.test(sourceService));
  assert(!/setValue\s*\(\s*['"]Non['"]\s*\)/.test(sourceService));
});

test('la migration 7 ajoute NATURE et l’historique sans destruction', () => {
  assert(/version:\s*7[\s\S]*versionSource:\s*6[\s\S]*versionCible:\s*7/.test(
    sourceMigration
  ));
  assert(/'ACTIF',\s*'NATURE'/.test(sourceMigration));
  assert(sourceMigration.includes("feuille: 'HISTORIQUE_IMPORTS_REFERENTIEL'"));
  assert(sourceMigration.includes('migration7ImportReferentielXlsx_'));
  assert(!/migration7ImportReferentielXlsx_[\s\S]{0,500}delete/.test(sourceMigration));
});

test('Nature est affichée et modifiable manuellement dans Référentiel', () => {
  assert(htmlReferentiel.includes('<th>Nature</th>'));
  assert(htmlReferentiel.includes('id="itemReferentielNature"'));
  assert(sourceReferentiel.includes('ligne[index.NATURE]'));
  assert(sourceReferentiel.includes('nature: item.nature'));
  assert(sourceInterface.includes("'itemReferentielNature'"));
});

test('la modale expose les six étapes sans analyser à la sélection', () => {
  for (let etape = 1; etape <= 6; etape++) {
    assert(htmlReferentiel.includes(`data-etape-import="${etape}"`));
  }
  const selection = sourceInterface.slice(
    sourceInterface.indexOf('function selectionnerFichierImportReferentiel'),
    sourceInterface.indexOf('function executerEtapeImportReferentiel')
  );
  assert(!selection.includes('.analyserFichierXlsxReferentiel('));
  assert(sourceInterface.includes('.previsualiserImportReferentiel('));
  assert(sourceInterface.includes('.importerReferentielXlsx('));
});

test('Drive v3 est déclaré sans nouveau scope OAuth et la version vaut 2.0.0', () => {
  const serviceDrive = manifeste.dependencies.enabledAdvancedServices.find(
    service => service.serviceId === 'drive' && service.version === 'v3'
  );
  assert(serviceDrive);
  assert(manifeste.oauthScopes.includes('https://www.googleapis.com/auth/drive'));
  assert.strictEqual(
    manifeste.oauthScopes.filter(scope => scope.includes('/drive')).length,
    1
  );
  assert(metadonnees.includes(
    "VERSION_APPLICATION_PREPFORMATION_ = '2.0.0'"
  ));
});

test('le fichier Drive temporaire reste serveur, privé et mis à la corbeille', () => {
  assert(sourceService.includes('fichierDriveEstPrive_'));
  assert(sourceService.includes('fichierTemporaire.setTrashed(true)'));
  assert(!/return\s+[^;]*ressource\.id/.test(sourceService));
  assert(!/DriveApp\.Permission|setSharing/.test(sourceService));
});


let echecs = 0;
tests.forEach(({ nom, traitement }) => {
  try {
    traitement();
    console.log('✓ ' + nom);
  } catch (erreur) {
    echecs++;
    console.error('✗ ' + nom);
    console.error(erreur.stack || erreur);
  }
});

if (echecs) {
  throw new Error(echecs + ' test(s) d’import référentiel en échec.');
}

console.log(`\n${tests.length}/${tests.length} tests d’import référentiel réussis.`);
