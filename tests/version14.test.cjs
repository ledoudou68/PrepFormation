'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const sourcePhotos = fs.readFileSync(
  path.join(racine, 'PhotosStagiairesService.js'),
  'utf8'
);
const sourceInterface = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
).replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
const htmlStagiaires = fs.readFileSync(
  path.join(racine, 'Stagiaires.html'),
  'utf8'
);
const sourceStagiaires = fs.readFileSync(
  path.join(racine, 'StagiairesService.js'),
  'utf8'
);
const sourceStockage = fs.readFileSync(
  path.join(racine, 'StockageDriveService.js'),
  'utf8'
);
const sourceMetadonnees = fs.readFileSync(
  path.join(racine, 'ApplicationMetadataService.js'),
  'utf8'
);

function contexteInterface() {
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
    Promise,
    isNaN,
    document: {
      addEventListener: () => {},
      querySelectorAll: () => [],
      getElementById: () => null
    },
    window: {
      addEventListener: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {}
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  };
  vm.createContext(contexte);
  vm.runInContext(sourceInterface, contexte, {
    filename: 'JavaScript.html'
  });
  return contexte;
}

function contextePhotos() {
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
    isNaN,
    Utilities: {
      base64Decode: texte => Array.from(Buffer.from(texte, 'base64')),
      base64Encode: octets => Buffer.from(octets).toString('base64'),
      base64EncodeWebSafe: () => 'hash',
      computeDigest: () => [1, 2, 3],
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      newBlob: (octets, type, nom) => ({ octets, type, nom }),
      formatDate: () => '2026-08-06_10-30-00'
    },
    Session: { getScriptTimeZone: () => 'Europe/Paris' },
    SpreadsheetApp: { flush: () => {} },
    DriveApp: {
      getFileById: () => { throw new Error('absent'); }
    }
  };
  vm.createContext(contexte);
  vm.runInContext(sourcePhotos, contexte, {
    filename: 'PhotosStagiairesService.js'
  });
  return contexte;
}

function creerReferencePhoto(fileId) {
  const etat = { valeurs: null, formats: 0 };
  const plage = {
    setValues: valeurs => {
      etat.valeurs = valeurs.map(ligne => ligne.slice());
      return plage;
    },
    setNumberFormat: () => {
      etat.formats++;
      return plage;
    }
  };
  return {
    reference: {
      uuid: 'stag-1',
      fileId: fileId || '',
      photoNom: fileId ? 'ancienne.jpg' : '',
      photoDateModification: '',
      photoUrl: '',
      feuille: {
        getLastColumn: () => 4,
        getRange: () => plage
      },
      index: {
        PHOTO_FILE_ID: 0,
        PHOTO_NOM: 1,
        PHOTO_DATE_MODIFICATION: 2,
        PHOTO_URL: 3
      },
      ligne: [fileId || '', fileId ? 'ancienne.jpg' : '', '', ''],
      numeroLigne: 2
    },
    etat
  };
}

function nouveauFichierPhoto() {
  const etat = { corbeille: false };
  return {
    fichier: {
      setDescription: () => {},
      getId: () => 'nouveau-file-id',
      getName: () => 'nouvelle.jpg',
      setTrashed: valeur => { etat.corbeille = valeur; }
    },
    etat
  };
}

const tests = [];
function test(nom, traitement) {
  tests.push({ nom, traitement });
}

test('l’interface mobile propose capture arrière et photothèque', () => {
  assert(/id="stagiairePhotoCamera"[\s\S]*capture="environment"/.test(
    htmlStagiaires
  ));
  assert(/id="stagiairePhotoFichier"/.test(htmlStagiaires));
  assert(htmlStagiaires.includes('Prendre une photo'));
  assert(htmlStagiaires.includes('Choisir un fichier'));
  assert(!htmlStagiaires.includes('stagiairePhotoUrl'));
});

test('JPEG, PNG, WEBP et HEIC sont filtrés côté client', () => {
  const c = contexteInterface();
  [
    ['photo.jpg', 'image/jpeg'],
    ['photo.png', 'image/png'],
    ['photo.webp', 'image/webp'],
    ['photo.heic', 'image/heic']
  ].forEach(([name, type]) => {
    assert.doesNotThrow(() => c.validerFichierPhotoStagiaireClient_({
      name,
      type,
      size: 1024
    }));
  });
});

test('un fichier non-image ou supérieur à 15 Mo est refusé', () => {
  const c = contexteInterface();
  assert.throws(
    () => c.validerFichierPhotoStagiaireClient_({
      name: 'document.pdf', type: 'application/pdf', size: 1000
    }),
    /Formats acceptés/
  );
  assert.throws(
    () => c.validerFichierPhotoStagiaireClient_({
      name: 'photo.jpg', type: 'image/jpeg', size: 16 * 1024 * 1024
    }),
    /15 Mo/
  );
});

test('le redimensionnement conserve les proportions et plafonne à 1200 px', () => {
  const c = contexteInterface();
  const paysage = c.calculerDimensionsPhotoStagiaire_(4000, 3000, 1200);
  const portrait = c.calculerDimensionsPhotoStagiaire_(2000, 4000, 1200);
  assert.deepStrictEqual(
    { largeur: paysage.largeur, hauteur: paysage.hauteur },
    { largeur: 1200, hauteur: 900 }
  );
  assert.deepStrictEqual(
    { largeur: portrait.largeur, hauteur: portrait.hauteur },
    { largeur: 600, hauteur: 1200 }
  );
  assert(sourceInterface.includes("}, 'image/jpeg', 0.8)"));
  assert(sourceInterface.includes("imageOrientation: 'from-image'"));
});

test('une photo manquante reste consultable sans droit administrateur', () => {
  const c = contextePhotos();
  let controleAdmin = false;
  c.exigerAdministrateur_ = () => { controleAdmin = true; };
  c.lireReferencePhotoStagiaire_ = () => ({
    uuid: 'stag-1', fileId: '', photoUrl: ''
  });
  const resultat = c.getPhotoStagiaire('stag-1');
  assert.strictEqual(resultat.disponible, false);
  assert.strictEqual(controleAdmin, false);
});

test('le serveur refuse un contenu qui n’est pas un JPEG complet', () => {
  const c = contextePhotos();
  const jpeg = new Array(130).fill(0);
  jpeg[0] = 0xFF;
  jpeg[1] = 0xD8;
  jpeg[2] = 0xFF;
  jpeg[128] = 0xFF;
  jpeg[129] = 0xD9;
  assert.doesNotThrow(() => c.verifierOctetsJpegPhotoStagiaire_(jpeg));
  assert.throws(
    () => c.verifierOctetsJpegPhotoStagiaire_([1, 2, 3, 4]),
    /vide ou incomplète/
  );
});

test('une mutation photo est refusée sans jeton administrateur', () => {
  const c = contextePhotos();
  c.exigerAdministrateur_ = () => {
    throw new Error('Accès réservé à l’administrateur.');
  };
  assert.throws(
    () => c.enregistrerPhotoStagiaire({}, ''),
    /Accès réservé/
  );
});

test('l’ajout sur un nouveau stagiaire écrit uniquement les métadonnées', () => {
  const c = contextePhotos();
  const { reference, etat } = creerReferencePhoto('');
  const nouveau = nouveauFichierPhoto();
  c.verifierOctetsJpegPhotoStagiaire_ = () => {};
  c.hacherOctetsPhotoStagiaire_ = () => 'hash';
  c.lireReferencePhotoStagiaire_ = () => reference;
  c.obtenirDossierUuidPhotoStagiaire_ = () => ({
    createFile: () => nouveau.fichier
  });
  c.verifierFichierPhotoStagiaire_ = () => ({
    hash: 'hash', taille: 1234
  });
  c.convertirDateHeureStatutPourInterface_ = () => '06/08/2026 10:30';
  c.journaliserActionSensible_ = () => {};

  const resultat = c.enregistrerPhotoStagiaireInterne_(
    { uuid: 'stag-1', contenuBase64: 'YWJj' },
    { identifiantHistorique: 'SESSION:test' }
  );
  assert.strictEqual(resultat.succes, true);
  assert.strictEqual(etat.valeurs[0][0], 'nouveau-file-id');
  assert(/stag-1__2026-08-06_10-30-00\.jpg/.test(etat.valeurs[0][1]));
  assert(!etat.valeurs[0].some(valeur => String(valeur).includes('YWJj')));
  assert.strictEqual(nouveau.etat.corbeille, false);
});

test('le remplacement place l’ancien fichier dans la corbeille après écriture', () => {
  const c = contextePhotos();
  const { reference, etat } = creerReferencePhoto('ancien-file-id');
  const nouveau = nouveauFichierPhoto();
  let ancienCorbeille = false;
  c.verifierOctetsJpegPhotoStagiaire_ = () => {};
  c.hacherOctetsPhotoStagiaire_ = () => 'hash';
  c.lireReferencePhotoStagiaire_ = () => reference;
  c.obtenirDossierUuidPhotoStagiaire_ = () => ({
    createFile: () => nouveau.fichier
  });
  c.verifierFichierPhotoStagiaire_ = () => ({
    hash: 'hash', taille: 1234
  });
  c.DriveApp.getFileById = () => ({
    setTrashed: valeur => { ancienCorbeille = valeur; }
  });
  c.convertirDateHeureStatutPourInterface_ = () => 'date';
  c.journaliserActionSensible_ = () => {};

  c.enregistrerPhotoStagiaireInterne_(
    { uuid: 'stag-1', contenuBase64: 'YWJj' },
    { identifiantHistorique: 'SESSION:test' }
  );
  assert.strictEqual(etat.valeurs[0][0], 'nouveau-file-id');
  assert.strictEqual(ancienCorbeille, true);
});

test('un échec Drive avant validation conserve l’ancienne photo', () => {
  const c = contextePhotos();
  const { reference, etat } = creerReferencePhoto('ancien-file-id');
  const nouveau = nouveauFichierPhoto();
  let ancienCorbeille = false;
  c.verifierOctetsJpegPhotoStagiaire_ = () => {};
  c.hacherOctetsPhotoStagiaire_ = () => 'hash';
  c.lireReferencePhotoStagiaire_ = () => reference;
  c.obtenirDossierUuidPhotoStagiaire_ = () => ({
    createFile: () => nouveau.fichier
  });
  c.verifierFichierPhotoStagiaire_ = () => {
    throw new Error('Drive indisponible');
  };
  c.DriveApp.getFileById = () => ({
    setTrashed: valeur => { ancienCorbeille = valeur; }
  });

  assert.throws(
    () => c.enregistrerPhotoStagiaireInterne_(
      { uuid: 'stag-1', contenuBase64: 'YWJj' },
      { identifiantHistorique: 'SESSION:test' }
    ),
    /photo précédente est conservée/
  );
  assert.strictEqual(etat.valeurs, null);
  assert.strictEqual(ancienCorbeille, false);
  assert.strictEqual(nouveau.etat.corbeille, true);
});

test('la suppression confirmée vide les métadonnées puis met à la corbeille', () => {
  const c = contextePhotos();
  const { reference, etat } = creerReferencePhoto('ancien-file-id');
  let corbeille = false;
  c.exigerAdministrateur_ = () => ({ identifiantHistorique: 'SESSION:test' });
  c.executerMutationMetier_ = traitement => traitement();
  c.lireReferencePhotoStagiaire_ = () => reference;
  c.verifierFichierPhotoStagiaire_ = () => ({ hash: 'hash' });
  c.DriveApp.getFileById = () => ({
    setTrashed: valeur => { corbeille = valeur; }
  });
  c.journaliserActionSensible_ = () => {};

  c.supprimerPhotoStagiaire(
    { uuid: 'stag-1', confirmation: true },
    'jeton'
  );
  assert.deepStrictEqual(Array.from(etat.valeurs[0]), ['', '', '', '']);
  assert.strictEqual(corbeille, true);
});

test('aucun Base64 n’est stocké dans STAGIAIRES et aucun partage public n’est créé', () => {
  assert(!sourceStagiaires.includes('contenuBase64'));
  assert(sourcePhotos.includes('PHOTO_FILE_ID'));
  assert(!sourcePhotos.includes('.setSharing('));
  assert(!sourceStockage.includes('.setSharing('));
  assert(sourceStockage.includes('DriveApp.Access.PRIVATE'));
});

test('le formulaire conserve les champs métier existants', () => {
  [
    'stagiaireNom', 'stagiairePrenom', 'stagiaireFormation',
    'stagiaireDateDebut', 'stagiaireDateStage', 'stagiaireNotes',
    'stagiaireGrade', 'stagiaireTelephone', 'stagiaireEmail'
  ].forEach(identifiant => {
    assert(htmlStagiaires.includes('id="' + identifiant + '"'));
  });
  assert(sourceInterface.includes(
    "document.getElementById('stagiaireUuid').value = resultat.uuid"
  ));
});

test('la version applicative est centralisée à 1.6.2', () => {
  assert(sourceMetadonnees.includes(
    "VERSION_APPLICATION_PREPFORMATION_ = '1.6.2'"
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
  '\n' + reussis + '/' + tests.length + ' tests hérités de la version 1.4 réussis.\n'
);
