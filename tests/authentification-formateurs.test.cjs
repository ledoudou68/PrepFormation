'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const sourceProduction = fs.readFileSync(
  path.join(racine, 'AuthentificationFormateurService.js'),
  'utf8'
);
const sourceTest = sourceProduction;
const sourceSecurite = fs.readFileSync(
  path.join(racine, 'SecuriteService.js'),
  'utf8'
);
const sourceMigration = fs.readFileSync(
  path.join(racine, 'MigrationService.js'),
  'utf8'
);
const sourceFavoris = fs.readFileSync(
  path.join(racine, 'FavorisService.js'),
  'utf8'
);
const sourceSessions = fs.readFileSync(
  path.join(racine, 'SessionsService.js'),
  'utf8'
);
const sourceSauvegarde = fs.readFileSync(
  path.join(racine, 'SauvegardeService.js'),
  'utf8'
);
const sourceRestauration = fs.readFileSync(
  path.join(racine, 'RestaurationService.js'),
  'utf8'
);
const sourceInterface = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
);
const indexHtml = fs.readFileSync(path.join(racine, 'Index.html'), 'utf8');
const formateursHtml = fs.readFileSync(
  path.join(racine, 'Formateurs.html'),
  'utf8'
);
const css = fs.readFileSync(path.join(racine, 'CSS.html'), 'utf8');
const metadonnees = fs.readFileSync(
  path.join(racine, 'ApplicationMetadataService.js'),
  'utf8'
);


function clonerValeur(valeur) {
  return valeur instanceof Date ? new Date(valeur.getTime()) : valeur;
}


class FausseFeuille {
  constructor(nom, donnees) {
    this.nom = nom;
    this.donnees = donnees.map(ligne => ligne.map(clonerValeur));
    this.lecturesValeurs = 0;
  }

  getLastRow() {
    return this.donnees.length;
  }

  getLastColumn() {
    return this.donnees[0].length;
  }

  getDataRange() {
    return {
      getValues: () => {
        this.lecturesValeurs++;
        return this.donnees.map(
          ligne => ligne.map(clonerValeur)
        );
      }
    };
  }

  appendRow(ligne) {
    this.donnees.push(ligne.map(clonerValeur));
  }

  getRange(ligne, colonne, nombreLignes, nombreColonnes) {
    const hauteur = nombreLignes || 1;
    const largeur = nombreColonnes || 1;
    const plage = {
      getValues: () => Array.from({ length: hauteur }, (_, decalage) =>
        Array.from({ length: largeur }, (_, position) =>
          clonerValeur(
            (this.donnees[ligne - 1 + decalage] || [])[colonne - 1 + position]
          )
        )
      ),
      setValues: valeurs => {
        valeurs.forEach((valeursLigne, decalage) => {
          const numero = ligne - 1 + decalage;
          this.donnees[numero] = this.donnees[numero] ||
            new Array(this.getLastColumn()).fill('');
          valeursLigne.forEach((valeur, position) => {
            this.donnees[numero][colonne - 1 + position] =
              clonerValeur(valeur);
          });
        });
        return plage;
      },
      setNumberFormat: () => plage
    };
    return plage;
  }
}


function octetsSignes(buffer) {
  return Array.from(buffer).map(valeur => valeur > 127 ? valeur - 256 : valeur);
}


function bufferOctets(valeur) {
  if (Array.isArray(valeur)) {
    return Buffer.from(valeur.map(octet => Number(octet) & 255));
  }
  return Buffer.from(String(valeur), 'utf8');
}


function creerEnvironnement() {
  const entetesUtilisateurs = [
    'ID_UTILISATEUR', 'ID_FORMATEUR', 'IDENTIFIANT',
    'PASSWORD_HASH', 'PASSWORD_SALT', 'ACTIF',
    'DOIT_CHANGER_MOT_DE_PASSE', 'NB_ECHECS', 'BLOQUE_JUSQU_A',
    'DERNIERE_CONNEXION', 'DATE_MODIFICATION_MDP', 'DATE_CREATION',
    'DATE_MODIFICATION'
  ];
  const feuilles = {
    UTILISATEURS: new FausseFeuille('UTILISATEURS', [entetesUtilisateurs]),
    FORMATEURS: new FausseFeuille('FORMATEURS', [[
      'ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF'
    ], [
      'F1', 'DUPONT', 'Alice', 'Oui'
    ], [
      'F2', 'MARTIN', 'Bruno', 'Oui'
    ], [
      'F3', 'DURAND', 'Chloé', 'Oui'
    ], [
      'F4', 'INACTIF', 'Igor', 'Non'
    ]])
  };
  const proprietes = {};
  const cache = {};
  const ecrituresProprietes = {};
  const compteursServices = {
    getProperty: 0,
    getProperties: 0,
    getPropertyParCle: {},
    cacheGet: 0,
    cachePut: 0,
    cacheRemove: 0
  };
  const audits = [];
  let sequence = 0;
  const magasinProprietes = {
    getProperty: cle => {
      compteursServices.getProperty++;
      compteursServices.getPropertyParCle[cle] = Number(
        compteursServices.getPropertyParCle[cle] || 0
      ) + 1;
      return Object.prototype.hasOwnProperty.call(proprietes, cle)
        ? proprietes[cle]
        : null;
    },
    setProperty: (cle, valeur) => {
      proprietes[cle] = String(valeur);
      ecrituresProprietes[cle] = Number(ecrituresProprietes[cle] || 0) + 1;
      return magasinProprietes;
    },
    setProperties: objet => {
      Object.keys(objet).forEach(cle => {
        proprietes[cle] = String(objet[cle]);
        ecrituresProprietes[cle] =
          Number(ecrituresProprietes[cle] || 0) + 1;
      });
      return magasinProprietes;
    },
    deleteProperty: cle => {
      delete proprietes[cle];
      return magasinProprietes;
    },
    getProperties: () => {
      compteursServices.getProperties++;
      return Object.assign({}, proprietes);
    }
  };
  let verrouPris = false;
  const verrou = {
    tryLock: () => {
      if (verrouPris) return false;
      verrouPris = true;
      return true;
    },
    releaseLock: () => {
      verrouPris = false;
    },
    hasLock: () => verrouPris
  };
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
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: nom => feuilles[nom] || null
      })
    },
    PropertiesService: {
      getScriptProperties: () => magasinProprietes
    },
    CacheService: {
      getScriptCache: () => ({
        get: cle => {
          compteursServices.cacheGet++;
          return Object.prototype.hasOwnProperty.call(cache, cle)
            ? cache[cle]
            : null;
        },
        put: (cle, valeur) => {
          compteursServices.cachePut++;
          cache[cle] = String(valeur);
        },
        remove: cle => {
          compteursServices.cacheRemove++;
          delete cache[cle];
        }
      })
    },
    LockService: {
      getScriptLock: () => verrou,
      getDocumentLock: () => verrou
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => 'uuid-' + String(++sequence).padStart(36, '0'),
      newBlob: valeur => ({ getBytes: () => octetsSignes(bufferOctets(valeur)) }),
      computeDigest: (_algorithme, valeur) => octetsSignes(
        crypto.createHash('sha256').update(bufferOctets(valeur)).digest()
      ),
      computeHmacSha256Signature: (valeur, cle) => octetsSignes(
        crypto.createHmac('sha256', bufferOctets(cle))
          .update(bufferOctets(valeur)).digest()
      ),
      base64EncodeWebSafe: octets => bufferOctets(octets).toString('base64url')
    },
    obtenirFeuilleLecturePure_: (_classeur, nom, colonnes) => {
      const feuille = feuilles[nom];
      if (!feuille) throw new Error('Feuille absente : ' + nom);
      colonnes.forEach(colonne => {
        if (!feuille.donnees[0].includes(colonne)) {
          throw new Error('Colonne absente : ' + colonne);
        }
      });
      return feuille;
    },
    creerIndexMigration_: entetes => Object.fromEntries(
      entetes.map((entete, position) => [String(entete), position])
    ),
    creerSecretAleatoireSecurite_: () => {
      sequence++;
      return ('secret_' + String(sequence).padStart(4, '0') + '_')
        .padEnd(48, 'x');
    },
    comparaisonConstanteSecurite_: (a, b) => {
      const premier = Buffer.from(String(a || ''));
      const second = Buffer.from(String(b || ''));
      return premier.length === second.length &&
        crypto.timingSafeEqual(premier, second);
    },
    executerMutationMetier_: traitement => traitement(),
    exigerAdministrateur_: jeton => {
      if (jeton !== 'JETON_ADMIN_TEST') {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return {
        estAdministrateur: true,
        identifiantHistorique: 'SESSION_ADMIN:TEST'
      };
    },
    construireSessionUtilisateur_: (_admin, session) => session
      ? {
        contexte: 'FORMATEUR',
        estFormateur: true,
        estAdministrateur: false,
        idUtilisateur: session.idUtilisateur,
        idFormateur: session.idFormateur,
        identifiant: session.identifiant
      }
      : { contexte: 'NON_CONNECTE' },
    journaliserActionSensible_: (action, objet, identifiant, details) => {
      audits.push({ action, objet, identifiant, details });
    },
    journaliserEvenementSecuriteSansBloquer_: (
      action,
      objet,
      identifiant,
      details
    ) => {
      audits.push({ action, objet, identifiant, details });
    }
  };

  vm.createContext(contexte);
  vm.runInContext(sourceTest, contexte, {
    filename: 'AuthentificationFormateurService.js'
  });
  return {
    contexte,
    feuilles,
    proprietes,
    cache,
    compteursServices,
    ecrituresProprietes,
    audits
  };
}


function creerEnvironnementSessionAdministration() {
  const proprietes = {};
  const cache = {};
  const ecritures = {};
  const compteursServices = {
    getProperty: 0,
    getProperties: 0,
    getPropertyParCle: {},
    cacheGet: 0,
    cachePut: 0,
    cacheRemove: 0
  };
  const magasinProprietes = {
    getProperty: cle => {
      compteursServices.getProperty++;
      compteursServices.getPropertyParCle[cle] = Number(
        compteursServices.getPropertyParCle[cle] || 0
      ) + 1;
      return Object.prototype.hasOwnProperty.call(proprietes, cle)
        ? proprietes[cle]
        : null;
    },
    setProperty: (cle, valeur) => {
      proprietes[cle] = String(valeur);
      ecritures[cle] = Number(ecritures[cle] || 0) + 1;
      return magasinProprietes;
    },
    deleteProperty: cle => {
      delete proprietes[cle];
      return magasinProprietes;
    },
    getProperties: () => {
      compteursServices.getProperties++;
      return Object.assign({}, proprietes);
    }
  };
  let verrouPris = false;
  const verrou = {
    tryLock: () => {
      if (verrouPris) return false;
      verrouPris = true;
      return true;
    },
    releaseLock: () => {
      verrouPris = false;
    },
    hasLock: () => verrouPris
  };
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
    PropertiesService: {
      getScriptProperties: () => magasinProprietes
    },
    CacheService: {
      getScriptCache: () => ({
        get: cle => {
          compteursServices.cacheGet++;
          return Object.prototype.hasOwnProperty.call(cache, cle)
            ? cache[cle]
            : null;
        },
        put: (cle, valeur) => {
          compteursServices.cachePut++;
          cache[cle] = String(valeur);
        },
        remove: cle => {
          compteursServices.cacheRemove++;
          delete cache[cle];
        }
      })
    },
    LockService: {
      getScriptLock: () => verrou,
      getDocumentLock: () => verrou
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithme, valeur) => octetsSignes(
        crypto.createHash('sha256').update(bufferOctets(valeur)).digest()
      ),
      base64EncodeWebSafe: octets => bufferOctets(octets).toString('base64url')
    }
  };
  vm.createContext(contexte);
  vm.runInContext(sourceSecurite, contexte, {
    filename: 'SecuriteService.js'
  });
  return {
    contexte,
    proprietes,
    cache,
    ecritures,
    compteursServices
  };
}


function activerAuthentificationAdministrationReelle(
  environnement,
  motDePasseAdministrateur = 'phrase administrateur de secours'
) {
  environnement.contexte.Session = {
    getActiveUser: () => ({ getEmail: () => '' }),
    getEffectiveUser: () => ({ getEmail: () => 'proprietaire@test.fr' })
  };
  vm.runInContext(sourceSecurite, environnement.contexte, {
    filename: 'SecuriteService.js'
  });
  environnement.contexte.executerMutationMetier_ = traitement => traitement();
  environnement.contexte.journaliserActionSensible_ = (
    action,
    objet,
    identifiant,
    details,
    utilisateur
  ) => {
    environnement.audits.push({
      action,
      objet,
      identifiant,
      details,
      utilisateur
    });
  };
  environnement.contexte.journaliserEvenementSecuriteSansBloquer_ = (
    action,
    objet,
    identifiant,
    details,
    utilisateur
  ) => {
    environnement.audits.push({
      action,
      objet,
      identifiant,
      details,
      utilisateur
    });
  };
  const sel = 'SEL_ADMINISTRATEUR_TEST_SECURITE';
  environnement.proprietes.ADMIN_PASSWORD_SALT = sel;
  environnement.proprietes.ADMIN_PASSWORD_HASH =
    environnement.contexte.hacherMotDePasseAdministrateur_(
      motDePasseAdministrateur,
      sel
    );
  environnement.motDePasseAdministrateur = motDePasseAdministrateur;
  return environnement;
}


function reinitialiserCompteursValidation_(environnement) {
  const compteurs = environnement.compteursServices;
  compteurs.getProperty = 0;
  compteurs.getProperties = 0;
  compteurs.getPropertyParCle = {};
  compteurs.cacheGet = 0;
  compteurs.cachePut = 0;
  compteurs.cacheRemove = 0;
  Object.keys(environnement.feuilles || {}).forEach(function (nomFeuille) {
    environnement.feuilles[nomFeuille].lecturesValeurs = 0;
  });
}


function creerEnvironnementDoubleAuthentification(options = {}) {
  const environnement = creerEnvironnement();
  const motDePasseFormateur =
    options.motDePasseFormateur || 'phrase formateur temporaire robuste';
  creerCompte(
    environnement,
    'F1',
    'alice.double-role',
    motDePasseFormateur
  );
  let jetonFormateur = '';
  if (options.connecterFormateur) {
    const premiere = environnement.contexte.connecterFormateur(
      'alice.double-role',
      motDePasseFormateur
    );
    const terminee = environnement.contexte
      .terminerPremiereConnexionFormateur(
        premiere.jetonChangementMotDePasse,
        'phrase définitive double rôle',
        'phrase définitive double rôle'
      );
    jetonFormateur = terminee.jeton;
  }
  activerAuthentificationAdministrationReelle(environnement);
  environnement.jetonFormateur = jetonFormateur;
  return environnement;
}


function ligneCompte(environnement, idFormateur) {
  const feuille = environnement.feuilles.UTILISATEURS;
  const index = Object.fromEntries(
    feuille.donnees[0].map((entete, position) => [entete, position])
  );
  const ligne = feuille.donnees.slice(1).find(
    element => element[index.ID_FORMATEUR] === idFormateur
  );
  return { ligne, index };
}


function creerCompte(environnement, idFormateur, identifiant, motDePasse) {
  return environnement.contexte.creerAccesFormateur({
    idFormateur,
    identifiant,
    motDePasse
  }, 'JETON_ADMIN_TEST');
}


const environnement = creerEnvironnement();
const tests = [];
function test(nom, traitement) {
  tests.push({ nom, traitement });
}


test('la création lie un compte distinct à un formateur', () => {
  const resultat = creerCompte(
    environnement,
    'F1',
    'Alice.Dupont',
    'phrase de passe commune'
  );
  assert(resultat.succes);
  assert.strictEqual(resultat.compte.idFormateur, 'F1');
  assert.strictEqual(resultat.compte.identifiant, 'alice.dupont');
  assert.strictEqual(resultat.compte.doitChangerMotDePasse, true);
});


test('un identifiant normalisé et un formateur ne peuvent être dupliqués', () => {
  assert.throws(
    () => creerCompte(
      environnement,
      'F3',
      'ALICE.DUPONT',
      'une autre phrase solide'
    ),
    /déjà utilisé/
  );
  assert.throws(
    () => creerCompte(
      environnement,
      'F1',
      'alice.second',
      'une autre phrase solide'
    ),
    /déjà un accès/
  );
});


test('le mot de passe clair n’est jamais stocké', () => {
  const compte = ligneCompte(environnement, 'F1');
  const texte = JSON.stringify(compte.ligne);
  assert(!texte.includes('phrase de passe commune'));
  assert(String(compte.ligne[compte.index.PASSWORD_HASH])
    .startsWith('PF2$PBKDF2-HMAC-SHA-256$1000$HMAC-SHA-256$'));
  assert(environnement.proprietes.FORMATEUR_PASSWORD_PEPPER);
});


test('deux comptes au même mot de passe ont des sels et hashes distincts', () => {
  creerCompte(
    environnement,
    'F2',
    'bruno.martin',
    'phrase de passe commune'
  );
  const premier = ligneCompte(environnement, 'F1');
  const second = ligneCompte(environnement, 'F2');
  assert.notStrictEqual(
    premier.ligne[premier.index.PASSWORD_SALT],
    second.ligne[second.index.PASSWORD_SALT]
  );
  assert.notStrictEqual(
    premier.ligne[premier.index.PASSWORD_HASH],
    second.ligne[second.index.PASSWORD_HASH]
  );
});


test('la politique refuse 9 caractères et en accepte 10', () => {
  assert.throws(
    () => environnement.contexte.verifierPolitiqueMotDePasseFormateur_(
      '123456789'
    ),
    /entre 10 et 512/
  );
  assert.strictEqual(
    environnement.contexte.verifierPolitiqueMotDePasseFormateur_(
      '1234567890'
    ),
    '1234567890'
  );
});


test('la politique accepte les espaces, les phrases de passe et 512 caractères', () => {
  assert.strictEqual(
    environnement.contexte.verifierPolitiqueMotDePasseFormateur_(
      'une longue phrase avec espaces'
    ),
    'une longue phrase avec espaces'
  );
  const maximum = 'é'.repeat(512);
  assert.strictEqual(
    environnement.contexte.verifierPolitiqueMotDePasseFormateur_(maximum),
    maximum
  );
  assert.throws(
    () => environnement.contexte.verifierPolitiqueMotDePasseFormateur_(
      'a'.repeat(513)
    ),
    /entre 10 et 512/
  );
});


test('la règle de 10 caractères est commune à tous les parcours formateur', () => {
  const envParcours = creerEnvironnement();
  const creation = envParcours.contexte.creerAccesFormateur({
    idFormateur: 'F1',
    identifiant: 'parcours.dix',
    motDePasse: '1234567890'
  }, 'JETON_ADMIN_TEST');
  assert.strictEqual(creation.compte.idFormateur, 'F1');
  let compte = ligneCompte(envParcours, 'F1');
  const pepperInitial = envParcours.proprietes.FORMATEUR_PASSWORD_PEPPER;
  assert.strictEqual(
    String(compte.ligne[compte.index.PASSWORD_HASH]).split('$')[2],
    '1000'
  );

  const premiereConnexion = envParcours.contexte.connecterFormateur(
    'parcours.dix',
    '1234567890'
  );
  const session = envParcours.contexte.terminerPremiereConnexionFormateur(
    premiereConnexion.jetonChangementMotDePasse,
    'abcdefghij',
    'abcdefghij'
  );
  compte = ligneCompte(envParcours, 'F1');
  assert.strictEqual(
    String(compte.ligne[compte.index.PASSWORD_HASH]).split('$')[2],
    '1000'
  );
  const changement = envParcours.contexte.changerMotDePasseFormateur(
    session.jeton,
    'abcdefghij',
    'klmnopqrst',
    'klmnopqrst'
  );
  assert.strictEqual(changement.sessionUtilisateur.idFormateur, 'F1');
  compte = ligneCompte(envParcours, 'F1');
  assert.strictEqual(
    String(compte.ligne[compte.index.PASSWORD_HASH]).split('$')[2],
    '1000'
  );

  const reinitialisation = envParcours.contexte.executerActionAccesFormateur(
    'F1',
    'REINITIALISER_MOT_DE_PASSE',
    { motDePasse: 'uvwxyzABCD' },
    'JETON_ADMIN_TEST'
  );
  assert.strictEqual(reinitialisation.motDePasseTemporaire, 'uvwxyzABCD');
  compte = ligneCompte(envParcours, 'F1');
  assert.strictEqual(
    String(compte.ligne[compte.index.PASSWORD_HASH]).split('$')[2],
    '1000'
  );
  assert.strictEqual(
    envParcours.proprietes.FORMATEUR_PASSWORD_PEPPER,
    pepperInitial
  );
});


test('la normalisation NFC est identique à la création et à la connexion', () => {
  const envNfc = creerEnvironnement();
  const compose = 'Phrase très secrète et sûre';
  const decompose = compose.normalize('NFD');
  creerCompte(envNfc, 'F1', 'alice.nfc', compose);
  const resultat = envNfc.contexte.connecterFormateur(
    'alice.nfc',
    decompose
  );
  assert.strictEqual(resultat.authentifie, true);
  assert.strictEqual(resultat.changementMotDePasseRequis, true);
  assert.strictEqual(
    envNfc.contexte.verifierNouveauMotDePasseFormateur_(
      compose,
      decompose
    ),
    compose.normalize('NFC')
  );
});


test('le format PBKDF2 versionné relit son propre nombre d’itérations', () => {
  const motDePasse = 'phrase robuste avec espaces';
  const sel = 'sel-test-versionne';
  const hash = environnement.contexte.deriverMotDePasseFormateur_(
    motDePasse,
    sel,
    31
  );
  assert(hash.startsWith(
    'PF2$PBKDF2-HMAC-SHA-256$31$HMAC-SHA-256$'
  ));
  const resultat = environnement.contexte.verifierMotDePasseFormateur_(
    motDePasse,
    sel,
    hash
  );
  assert.strictEqual(resultat.valide, true);
  assert.strictEqual(resultat.doitMettreAJour, false);
});


test('les anciens vérificateurs PBKDF2 restent lisibles et sont migrables', () => {
  const motDePasse = 'ancienne phrase de passe valide';
  const sel = 'sel-legacy';
  const cle = environnement.contexte.calculerClePbkdf2Formateur_(
    motDePasse,
    sel,
    24
  );
  const hash = 'PBKDF2-SHA256$24$' +
    environnement.contexte.Utilities.base64EncodeWebSafe(cle)
      .replace(/=+$/g, '');
  const resultat = environnement.contexte.verifierMotDePasseFormateur_(
    motDePasse,
    sel,
    hash
  );
  assert.strictEqual(resultat.valide, true);
  assert.strictEqual(resultat.doitMettreAJour, true);
});


test('un compte PF2 à 20 000 reste intact puis passe à 1 000 au changement', () => {
  const envAncien = creerEnvironnement();
  const ancienMotDePasse = 'ancienne phrase compte 20000';
  creerCompte(
    envAncien,
    'F1',
    'ancien.compte',
    ancienMotDePasse
  );
  let compte = ligneCompte(envAncien, 'F1');
  const selInitial = compte.ligne[compte.index.PASSWORD_SALT];
  const pepperInitial = envAncien.proprietes.FORMATEUR_PASSWORD_PEPPER;
  const hash20000 = envAncien.contexte.deriverMotDePasseFormateur_(
    ancienMotDePasse,
    selInitial,
    20000
  );
  compte.ligne[compte.index.PASSWORD_HASH] = hash20000;
  compte.ligne[compte.index.DOIT_CHANGER_MOT_DE_PASSE] = 'Non';

  const iterationsObservees = [];
  const calculerOriginal = envAncien.contexte
    .calculerClePbkdf2Formateur_;
  envAncien.contexte.calculerClePbkdf2Formateur_ = function (
    motDePasse,
    sel,
    iterations
  ) {
    iterationsObservees.push(Number(iterations));
    return calculerOriginal(motDePasse, sel, iterations);
  };

  const connexion = envAncien.contexte.connecterFormateur(
    'ancien.compte',
    ancienMotDePasse
  );
  assert.strictEqual(connexion.authentifie, true);
  assert(iterationsObservees.includes(20000));
  compte = ligneCompte(envAncien, 'F1');
  assert.strictEqual(compte.ligne[compte.index.PASSWORD_HASH], hash20000);
  assert.strictEqual(compte.ligne[compte.index.PASSWORD_SALT], selInitial);
  assert.strictEqual(
    envAncien.proprietes.FORMATEUR_PASSWORD_PEPPER,
    pepperInitial
  );

  envAncien.contexte.changerMotDePasseFormateur(
    connexion.jeton,
    ancienMotDePasse,
    'nouvelle phrase compte mille',
    'nouvelle phrase compte mille'
  );
  compte = ligneCompte(envAncien, 'F1');
  assert.strictEqual(
    String(compte.ligne[compte.index.PASSWORD_HASH]).split('$')[2],
    '1000'
  );
  assert.notStrictEqual(
    compte.ligne[compte.index.PASSWORD_SALT],
    selInitial
  );
  assert.strictEqual(
    envAncien.proprietes.FORMATEUR_PASSWORD_PEPPER,
    pepperInitial
  );
});


test('les mots de passe temporaires sont longs, aléatoires et conformes', () => {
  const premier = environnement.contexte.creerMotDePasseTemporaireFormateur_();
  const second = environnement.contexte.creerMotDePasseTemporaireFormateur_();
  assert(premier.length >= 35);
  assert(second.length >= 35);
  assert.notStrictEqual(premier, second);
  assert.strictEqual(
    environnement.contexte.verifierPolitiqueMotDePasseFormateur_(premier),
    premier
  );
  assert(sourceProduction.includes('secret.slice(0, 32)'));
});


test('le diagnostic de connexion est absent par défaut et exige une activation autorisée', () => {
  const envDiagnostic = creerEnvironnement();
  creerCompte(
    envDiagnostic,
    'F1',
    'alice.diagnostic',
    'phrase temporaire diagnostic'
  );
  const premiere = envDiagnostic.contexte.connecterFormateur(
    'alice.diagnostic',
    'phrase temporaire diagnostic'
  );
  envDiagnostic.contexte.terminerPremiereConnexionFormateur(
    premiere.jetonChangementMotDePasse,
    'phrase définitive diagnostic',
    'phrase définitive diagnostic'
  );

  const sansDiagnostic = envDiagnostic.contexte.connecterFormateur(
    'alice.diagnostic',
    'phrase définitive diagnostic'
  );
  assert.strictEqual(sansDiagnostic.diagnosticConnexion, undefined);

  const optionInactive = envDiagnostic.contexte.connecterFormateur(
    'alice.diagnostic',
    'phrase définitive diagnostic',
    {
      actif: false,
      modeClientExplicite: true,
      jetonAdministrateur: 'JETON_ADMIN_TEST'
    }
  );
  assert.strictEqual(optionInactive.diagnosticConnexion, undefined);

  const fauxJetonAdmin = envDiagnostic.contexte.connecterFormateur(
    'alice.diagnostic',
    'phrase définitive diagnostic',
    {
      actif: true,
      jetonAdministrateur: 'JETON_ADMIN_INVALIDE'
    }
  );
  assert.strictEqual(fauxJetonAdmin.diagnosticConnexion, undefined);
});


test('le diagnostic admin retourne une chronologie serveur cohérente sans secret', () => {
  const envDiagnostic = creerEnvironnement();
  creerCompte(
    envDiagnostic,
    'F1',
    'alice.metriques',
    'phrase temporaire métriques'
  );
  const premiere = envDiagnostic.contexte.connecterFormateur(
    'alice.metriques',
    'phrase temporaire métriques'
  );
  envDiagnostic.contexte.terminerPremiereConnexionFormateur(
    premiere.jetonChangementMotDePasse,
    'phrase définitive métriques',
    'phrase définitive métriques'
  );

  const resultat = envDiagnostic.contexte.connecterFormateur(
    'alice.metriques',
    'phrase définitive métriques',
    {
      actif: true,
      jetonAdministrateur: 'JETON_ADMIN_TEST'
    }
  );
  const metriques = resultat.diagnosticConnexion.serveur;
  [
    'normalisationIdentifiantMs',
    'rechercheCompteUtilisateurMs',
    'controleBlocageMs',
    'lectureSelHashMs',
    'derivationPbkdf2PepperMs',
    'comparaisonVerificateurMs',
    'miseAJourConnexionMs',
    'creationSessionMs',
    'ecritureScriptPropertiesMs',
    'constructionContexteUtilisateurMs',
    'totalServeurMs'
  ].forEach(cle => {
    assert(Number.isFinite(metriques[cle]), cle + ' doit être numérique');
    assert(metriques[cle] >= 0, cle + ' doit être positive');
    assert(
      metriques.totalServeurMs >= metriques[cle],
      'le total serveur doit couvrir ' + cle
    );
  });
  assert(metriques.derivationPbkdf2PepperMs >= 0);

  const diagnosticJson = JSON.stringify(resultat.diagnosticConnexion);
  const compte = ligneCompte(envDiagnostic, 'F1');
  [
    'phrase définitive métriques',
    compte.ligne[compte.index.PASSWORD_HASH],
    compte.ligne[compte.index.PASSWORD_SALT],
    envDiagnostic.proprietes.FORMATEUR_PASSWORD_PEPPER,
    resultat.jeton,
    'alice.metriques'
  ].forEach(secret => {
    assert(!diagnosticJson.includes(String(secret)));
  });
});


test('le mode client explicitement activé obtient uniquement les durées', () => {
  const envDiagnostic = creerEnvironnement();
  creerCompte(
    envDiagnostic,
    'F1',
    'alice.mode-client',
    'phrase temporaire mode client'
  );
  const premiere = envDiagnostic.contexte.connecterFormateur(
    'alice.mode-client',
    'phrase temporaire mode client'
  );
  envDiagnostic.contexte.terminerPremiereConnexionFormateur(
    premiere.jetonChangementMotDePasse,
    'phrase définitive mode client',
    'phrase définitive mode client'
  );
  const resultat = envDiagnostic.contexte.connecterFormateur(
    'alice.mode-client',
    'phrase définitive mode client',
    { actif: true, modeClientExplicite: true }
  );
  assert(resultat.diagnosticConnexion);
  assert.deepStrictEqual(
    Object.keys(resultat.diagnosticConnexion),
    ['serveur']
  );
});


test('la première connexion correcte ne livre aucune session métier', () => {
  const resultat = environnement.contexte.connecterFormateur(
    'alice.dupont',
    'phrase de passe commune'
  );
  assert.strictEqual(resultat.changementMotDePasseRequis, true);
  assert(resultat.jetonChangementMotDePasse);
  assert.strictEqual(resultat.jeton, undefined);
  environnement.defiAlice = resultat.jetonChangementMotDePasse;
});


test('la fin de première connexion crée une session opaque', () => {
  const resultat = environnement.contexte.terminerPremiereConnexionFormateur(
    environnement.defiAlice,
    'nouvelle phrase de passe Alice',
    'nouvelle phrase de passe Alice'
  );
  assert(resultat.jeton.length >= 40);
  assert.strictEqual(resultat.sessionUtilisateur.idFormateur, 'F1');
  assert(resultat.sessionUtilisateur.idUtilisateur);
  assert(!JSON.stringify(environnement.proprietes).includes(resultat.jeton));
  environnement.sessionAlice = resultat.jeton;
});


test('mauvais identifiant et mauvais mot de passe ont le même message', () => {
  let inconnu = '';
  let incorrect = '';
  try {
    environnement.contexte.connecterFormateur(
      'personne.inconnue',
      'mot de passe incorrect'
    );
  } catch (erreur) {
    inconnu = erreur.message;
  }
  try {
    environnement.contexte.connecterFormateur(
      'bruno.martin',
      'mot de passe incorrect'
    );
  } catch (erreur) {
    incorrect = erreur.message;
  }
  assert.strictEqual(inconnu, 'Identifiant ou mot de passe incorrect.');
  assert.strictEqual(incorrect, inconnu);
});


test('cinq échecs activent le blocage progressif', () => {
  for (let tentative = 1; tentative < 5; tentative++) {
    assert.throws(() => environnement.contexte.connecterFormateur(
      'bruno.martin',
      'encore un mauvais mot de passe'
    ), /Identifiant ou mot de passe incorrect/);
  }
  const compte = ligneCompte(environnement, 'F2');
  assert.strictEqual(Number(compte.ligne[compte.index.NB_ECHECS]), 5);
  assert(compte.ligne[compte.index.BLOQUE_JUSQU_A] instanceof Date);
  assert(
    compte.ligne[compte.index.BLOQUE_JUSQU_A].getTime() > Date.now()
  );
});


test('l’administrateur peut débloquer le compte', () => {
  const resultat = environnement.contexte.executerActionAccesFormateur(
    'F2',
    'DEBLOQUER',
    {},
    'JETON_ADMIN_TEST'
  );
  assert.strictEqual(resultat.compte.bloque, false);
  assert.strictEqual(resultat.compte.nombreEchecs, 0);
});


test('un compte ou un formateur inactif ne peut pas se connecter', () => {
  creerCompte(
    environnement,
    'F4',
    'igor.inactif',
    'mot de passe suffisamment long'
  );
  assert.throws(() => environnement.contexte.connecterFormateur(
    'igor.inactif',
    'mot de passe suffisamment long'
  ), /Identifiant ou mot de passe incorrect/);
});


test('le changement de mot de passe invalide les anciennes sessions', () => {
  const resultat = environnement.contexte.changerMotDePasseFormateur(
    environnement.sessionAlice,
    'nouvelle phrase de passe Alice',
    'troisième phrase de passe Alice',
    'troisième phrase de passe Alice'
  );
  assert(resultat.jeton);
  assert.strictEqual(
    environnement.contexte.obtenirSessionFormateurValide_(
      environnement.sessionAlice,
      false,
      false
    ),
    null
  );
  environnement.sessionAlice = resultat.jeton;
});


test('deux appareils peuvent conserver simultanément une session valide', () => {
  const secondeConnexion = environnement.contexte.connecterFormateur(
    'alice.dupont',
    'troisième phrase de passe Alice'
  );
  assert(secondeConnexion.jeton);
  assert(environnement.contexte.obtenirSessionFormateurValide_(
    environnement.sessionAlice,
    false,
    false
  ));
  assert(environnement.contexte.obtenirSessionFormateurValide_(
    secondeConnexion.jeton,
    false,
    false
  ));
  environnement.sessionAliceSecondaire = secondeConnexion.jeton;
});


test('la validation formateur cible une propriété et réutilise le cache court', () => {
  const envSession = creerEnvironnement();
  creerCompte(
    envSession,
    'F1',
    'alice.validation-ciblee',
    'phrase temporaire suffisamment longue'
  );
  const premiere = envSession.contexte.connecterFormateur(
    'alice.validation-ciblee',
    'phrase temporaire suffisamment longue'
  );
  const connexion = envSession.contexte.terminerPremiereConnexionFormateur(
    premiere.jetonChangementMotDePasse,
    'phrase définitive validation ciblée',
    'phrase définitive validation ciblée'
  );

  reinitialiserCompteursValidation_(envSession);
  assert(envSession.contexte.obtenirSessionFormateurValide_(
    connexion.jeton,
    false,
    true
  ));
  assert.strictEqual(envSession.compteursServices.getProperties, 0);
  assert.strictEqual(envSession.compteursServices.getProperty, 1);
  assert.strictEqual(envSession.feuilles.UTILISATEURS.lecturesValeurs, 0);
  assert.strictEqual(envSession.feuilles.FORMATEURS.lecturesValeurs, 0);

  Object.keys(envSession.cache).filter(function (cle) {
    return cle.startsWith('FORMATEUR_SESSION_AUTHORIZATION_');
  }).forEach(function (cle) {
    delete envSession.cache[cle];
  });
  reinitialiserCompteursValidation_(envSession);
  assert(envSession.contexte.obtenirSessionFormateurValide_(
    connexion.jeton,
    false,
    true
  ));
  assert.strictEqual(envSession.compteursServices.getProperties, 0);
  assert.strictEqual(envSession.feuilles.UTILISATEURS.lecturesValeurs, 1);
  assert.strictEqual(envSession.feuilles.FORMATEURS.lecturesValeurs, 1);

  assert(envSession.contexte.obtenirSessionFormateurValide_(
    connexion.jeton,
    false,
    true
  ));
  assert.strictEqual(envSession.feuilles.UTILISATEURS.lecturesValeurs, 1);
  assert.strictEqual(envSession.feuilles.FORMATEURS.lecturesValeurs, 1);
});


test('la propriété persistante reste prioritaire sur le cache formateur', () => {
  const envSession = creerEnvironnement();
  creerCompte(
    envSession,
    'F1',
    'alice.source-persistante',
    'phrase temporaire suffisamment longue'
  );
  const premiere = envSession.contexte.connecterFormateur(
    'alice.source-persistante',
    'phrase temporaire suffisamment longue'
  );
  const connexion = envSession.contexte.terminerPremiereConnexionFormateur(
    premiere.jetonChangementMotDePasse,
    'phrase définitive source persistante',
    'phrase définitive source persistante'
  );
  const cle = Object.keys(envSession.proprietes).find(function (nom) {
    return nom.startsWith('FORMATEUR_SESSION_');
  });
  assert(Object.keys(envSession.cache).some(function (nom) {
    return nom === 'FORMATEUR_SESSION_AUTHORIZATION_' + cle;
  }));
  delete envSession.proprietes[cle];
  assert.strictEqual(
    envSession.contexte.obtenirSessionFormateurValide_(
      connexion.jeton,
      false,
      false
    ),
    null
  );
});


test('la validation admin ne balaie plus toutes les Script Properties', () => {
  const envAdmin = creerEnvironnementSessionAdministration();
  const jeton = 'R'.repeat(48);
  const cle = 'ADMIN_SESSION_' +
    envAdmin.contexte.hacherJetonAdministration_(jeton);
  const maintenant = Date.now();
  envAdmin.proprietes[cle] = JSON.stringify({
    idSession: 'ADMIN_CIBLE',
    creeA: maintenant,
    derniereActivite: maintenant,
    expireA: maintenant + 30 * 60 * 1000
  });
  reinitialiserCompteursValidation_(envAdmin);
  assert(envAdmin.contexte.obtenirSessionAdministrationValide_(
    jeton,
    false,
    true
  ));
  assert.strictEqual(envAdmin.compteursServices.getProperties, 0);
  assert.strictEqual(envAdmin.compteursServices.getProperty, 1);
});


test('l’activité est validée à chaque appel mais persistée au plus toutes les cinq minutes', () => {
  const envSession = creerEnvironnement();
  creerCompte(
    envSession,
    'F1',
    'alice.session',
    'phrase temporaire suffisamment longue'
  );
  const premiere = envSession.contexte.connecterFormateur(
    'alice.session',
    'phrase temporaire suffisamment longue'
  );
  const connexion = envSession.contexte.terminerPremiereConnexionFormateur(
    premiere.jetonChangementMotDePasse,
    'nouvelle phrase de session robuste',
    'nouvelle phrase de session robuste'
  );
  const cle = Object.keys(envSession.proprietes).find(
    nom => nom.startsWith('FORMATEUR_SESSION_')
  );
  const avant = Number(envSession.ecrituresProprietes[cle] || 0);
  assert(envSession.contexte.obtenirSessionFormateurValide_(
    connexion.jeton,
    true,
    true
  ));
  assert.strictEqual(
    Number(envSession.ecrituresProprietes[cle] || 0),
    avant
  );

  const session = JSON.parse(envSession.proprietes[cle]);
  session.derniereActivite = Date.now() - 6 * 60 * 1000;
  envSession.proprietes[cle] = JSON.stringify(session);
  delete envSession.cache['FORMATEUR_LAST_ACTIVITY_' + cle];
  assert(envSession.contexte.obtenirSessionFormateurValide_(
    connexion.jeton,
    true,
    true
  ));
  assert.strictEqual(
    Number(envSession.ecrituresProprietes[cle] || 0),
    avant + 1
  );
});


test('le cache d’activité préserve l’expiration exacte entre deux écritures', () => {
  const envSession = creerEnvironnement();
  creerCompte(
    envSession,
    'F1',
    'alice.expiration',
    'phrase temporaire suffisamment longue'
  );
  const premiere = envSession.contexte.connecterFormateur(
    'alice.expiration',
    'phrase temporaire suffisamment longue'
  );
  const connexion = envSession.contexte.terminerPremiereConnexionFormateur(
    premiere.jetonChangementMotDePasse,
    'nouvelle phrase expiration robuste',
    'nouvelle phrase expiration robuste'
  );
  const cle = Object.keys(envSession.proprietes).find(
    nom => nom.startsWith('FORMATEUR_SESSION_')
  );
  const session = JSON.parse(envSession.proprietes[cle]);
  session.derniereActivite = Date.now() - 61 * 60 * 1000;
  envSession.proprietes[cle] = JSON.stringify(session);
  envSession.cache['FORMATEUR_LAST_ACTIVITY_' + cle] = String(Date.now());
  assert(envSession.contexte.obtenirSessionFormateurValide_(
    connexion.jeton,
    false,
    false
  ));
  delete envSession.cache['FORMATEUR_LAST_ACTIVITY_' + cle];
  assert.strictEqual(
    envSession.contexte.obtenirSessionFormateurValide_(
      connexion.jeton,
      false,
      false
    ),
    null
  );
  assert.strictEqual(envSession.proprietes[cle], undefined);
});


test('les sessions administrateur utilisent le même throttling de cinq minutes', () => {
  const envAdmin = creerEnvironnementSessionAdministration();
  const jeton = 'A'.repeat(48);
  const cle = 'ADMIN_SESSION_' +
    envAdmin.contexte.hacherJetonAdministration_(jeton);
  const maintenant = Date.now();
  envAdmin.proprietes[cle] = JSON.stringify({
    idSession: 'ADMIN_TEST',
    creeA: maintenant,
    derniereActivite: maintenant,
    expireA: maintenant + 30 * 60 * 1000
  });
  assert(envAdmin.contexte.obtenirSessionAdministrationValide_(
    jeton,
    true,
    true
  ));
  assert.strictEqual(Number(envAdmin.ecritures[cle] || 0), 0);

  const session = JSON.parse(envAdmin.proprietes[cle]);
  session.expireA = Date.now() - 1;
  envAdmin.proprietes[cle] = JSON.stringify(session);
  envAdmin.cache['ADMIN_LAST_ACTIVITY_' + cle] = String(Date.now());
  assert(envAdmin.contexte.obtenirSessionAdministrationValide_(
    jeton,
    false,
    true
  ));

  session.derniereActivite = Date.now() - 6 * 60 * 1000;
  session.expireA = Date.now() + 24 * 60 * 1000;
  envAdmin.proprietes[cle] = JSON.stringify(session);
  delete envAdmin.cache['ADMIN_LAST_ACTIVITY_' + cle];
  assert(envAdmin.contexte.obtenirSessionAdministrationValide_(
    jeton,
    true,
    true
  ));
  assert.strictEqual(Number(envAdmin.ecritures[cle] || 0), 1);
});


test('un compte formateur bloqué ne bloque jamais l’accès administrateur direct', () => {
  const env = creerEnvironnementDoubleAuthentification();
  const compte = ligneCompte(env, 'F1');
  compte.ligne[compte.index.NB_ECHECS] = 5;
  compte.ligne[compte.index.BLOQUE_JUSQU_A] = new Date(
    Date.now() + 60 * 60 * 1000
  );
  const resultat = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur
  );
  assert.strictEqual(resultat.sessionUtilisateur.estAdministrateur, true);
  assert.strictEqual(resultat.sessionUtilisateur.estFormateur, false);
  assert.strictEqual(
    resultat.sessionUtilisateur.modeAccesAdministration,
    'ADMINISTRATION_DIRECTE'
  );
  assert.strictEqual(resultat.sessionUtilisateur.idUtilisateur, '');
  assert.strictEqual(resultat.sessionUtilisateur.idFormateur, '');
  assert(env.audits.some(evenement =>
    evenement.action === 'ADMIN_DEVERROUILLAGE_REUSSI' &&
    String(evenement.utilisateur).includes('ADMINISTRATION_DIRECTE') &&
    !String(evenement.utilisateur).includes('FORMATEUR:')
  ));
});


test('le routage en cache sélectionne directement la session administrateur', () => {
  const env = creerEnvironnementDoubleAuthentification({
    connecterFormateur: true
  });
  const resultat = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur,
    ''
  );
  reinitialiserCompteursValidation_(env);
  const session = env.contexte.getSessionUtilisateur(resultat.jeton);
  assert.strictEqual(session.estAdministrateur, true);
  assert.strictEqual(session.estFormateur, false);
  const clesLues = Object.keys(
    env.compteursServices.getPropertyParCle
  );
  assert.strictEqual(
    clesLues.filter(cle => cle.startsWith('FORMATEUR_SESSION_')).length,
    0
  );
  assert.strictEqual(
    clesLues.filter(cle => cle.startsWith('ADMIN_SESSION_')).length,
    1
  );
  assert.strictEqual(env.compteursServices.getProperties, 0);
  assert.strictEqual(
    env.contexte.obtenirSessionFormateurValide_(
      resultat.jeton,
      false,
      false
    ),
    null
  );
});


test('le diagnostic détaille la validation et le contrôle des droits sans secret', () => {
  const env = creerEnvironnementDoubleAuthentification({
    connecterFormateur: true
  });
  const diagnostic = {};
  const session = env.contexte.verifierAccesPage_(
    'Accueil',
    env.jetonFormateur,
    diagnostic
  );
  assert.strictEqual(session.estFormateur, true);
  assert.strictEqual(diagnostic.operation, 'VERIFICATION_ACCES_PAGE');
  assert.strictEqual(typeof diagnostic.controleDroitsMs, 'number');
  assert.strictEqual(diagnostic.appelsAutresServices.length, 1);
  const validation = diagnostic.appelsAutresServices[0];
  [
    'determinationTypeSessionMs',
    'accesPropertiesServiceMs',
    'lectureSessionPersistanteMs',
    'parsingSessionMs',
    'lectureCacheActiviteMs',
    'controleExpirationMs',
    'lectureCacheAutorisationMs',
    'recuperationUtilisateurMs',
    'controleStatutMs',
    'renouvellementActiviteMs',
    'constructionContexteMs',
    'totalValidationSessionMs',
    'totalServeurMs'
  ].forEach(function (cle) {
    assert.strictEqual(typeof validation[cle], 'number', cle);
  });
  const rapport = JSON.stringify(diagnostic);
  assert(!rapport.includes(env.jetonFormateur));
  assert(!rapport.includes('PASSWORD_HASH'));
  assert(!rapport.includes('PASSWORD_SALT'));
  assert(!rapport.includes('PEPPER'));
});


test('un compte formateur désactivé ne bloque jamais l’accès administrateur direct', () => {
  const env = creerEnvironnementDoubleAuthentification();
  const compte = ligneCompte(env, 'F1');
  compte.ligne[compte.index.ACTIF] = 'Non';
  const resultat = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur
  );
  assert.strictEqual(resultat.sessionUtilisateur.estAdministrateur, true);
  assert.strictEqual(resultat.sessionUtilisateur.estFormateur, false);
  assert.strictEqual(
    resultat.sessionUtilisateur.contexte,
    'ADMINISTRATEUR'
  );
});


test('un stockage formateur inaccessible ne bloque pas l’administrateur de secours', () => {
  const env = creerEnvironnementDoubleAuthentification();
  delete env.feuilles.UTILISATEURS;
  delete env.feuilles.FORMATEURS;
  const resultat = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur
  );
  assert.strictEqual(resultat.sessionUtilisateur.estAdministrateur, true);
  assert.strictEqual(
    resultat.sessionUtilisateur.modeAccesAdministration,
    'ADMINISTRATION_DIRECTE'
  );
});


test('une session formateur expirée est ignorée sans bloquer l’accès admin', () => {
  const env = creerEnvironnementDoubleAuthentification({
    connecterFormateur: true
  });
  const cleSession = Object.keys(env.proprietes).find(
    cle => cle.startsWith('FORMATEUR_SESSION_')
  );
  const session = JSON.parse(env.proprietes[cleSession]);
  session.expireAbsolueA = Date.now() - 1;
  env.proprietes[cleSession] = JSON.stringify(session);
  const resultat = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur,
    env.jetonFormateur
  );
  assert.strictEqual(resultat.sessionUtilisateur.estAdministrateur, true);
  assert.strictEqual(resultat.sessionUtilisateur.estFormateur, false);
  assert.strictEqual(
    resultat.sessionUtilisateur.modeAccesAdministration,
    'ADMINISTRATION_DIRECTE'
  );
});


test('un mot de passe formateur erroné n’affecte pas le mot de passe admin', () => {
  const env = creerEnvironnementDoubleAuthentification();
  assert.throws(
    () => env.contexte.connecterFormateur(
      'alice.double-role',
      'mauvais mot de passe formateur'
    ),
    /Identifiant ou mot de passe incorrect/
  );
  const compte = ligneCompte(env, 'F1');
  assert.strictEqual(Number(compte.ligne[compte.index.NB_ECHECS]), 1);
  const resultat = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur
  );
  assert.strictEqual(resultat.sessionUtilisateur.estAdministrateur, true);
  assert.strictEqual(env.proprietes.ADMIN_AUTH_ATTEMPTS, undefined);
});


test('l’administrateur direct peut débloquer et réactiver un formateur', () => {
  const env = creerEnvironnementDoubleAuthentification();
  const compte = ligneCompte(env, 'F1');
  compte.ligne[compte.index.NB_ECHECS] = 5;
  compte.ligne[compte.index.BLOQUE_JUSQU_A] = new Date(
    Date.now() + 60 * 60 * 1000
  );
  compte.ligne[compte.index.ACTIF] = 'Non';
  const admin = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur
  );
  env.contexte.executerActionAccesFormateur(
    'F1',
    'DEBLOQUER',
    {},
    admin.jeton
  );
  env.contexte.executerActionAccesFormateur(
    'F1',
    'REACTIVER',
    {},
    admin.jeton
  );
  assert.strictEqual(Number(compte.ligne[compte.index.NB_ECHECS]), 0);
  assert.strictEqual(compte.ligne[compte.index.BLOQUE_JUSQU_A], '');
  assert.strictEqual(compte.ligne[compte.index.ACTIF], 'Oui');
});


test('l’administrateur direct peut réinitialiser et forcer le mot de passe', () => {
  const env = creerEnvironnementDoubleAuthentification();
  const admin = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur
  );
  const resultat = env.contexte.executerActionAccesFormateur(
    'F1',
    'REINITIALISER_MOT_DE_PASSE',
    {},
    admin.jeton
  );
  assert(resultat.motDePasseTemporaire.length >= 15);
  assert.strictEqual(resultat.compte.doitChangerMotDePasse, true);
  const force = env.contexte.executerActionAccesFormateur(
    'F1',
    'FORCER_CHANGEMENT_MOT_DE_PASSE',
    {},
    admin.jeton
  );
  assert.strictEqual(force.compte.doitChangerMotDePasse, true);
});


test('un formateur connecté peut élever ses droits sans perdre son identité', () => {
  const env = creerEnvironnementDoubleAuthentification({
    connecterFormateur: true
  });
  const resultat = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur,
    env.jetonFormateur
  );
  const session = resultat.sessionUtilisateur;
  assert.strictEqual(session.contexte, 'FORMATEUR_ADMINISTRATEUR');
  assert.strictEqual(session.estAdministrateur, true);
  assert.strictEqual(session.estFormateur, true);
  assert.strictEqual(session.idUtilisateur, ligneCompte(env, 'F1')
    .ligne[ligneCompte(env, 'F1').index.ID_UTILISATEUR]);
  assert.strictEqual(session.idFormateur, 'F1');
  assert.strictEqual(
    session.modeAccesAdministration,
    'ELEVATION_FORMATEUR'
  );
  const sessionRelue = env.contexte.getSessionUtilisateur(resultat.jeton);
  assert.strictEqual(sessionRelue.idUtilisateur, session.idUtilisateur);
  assert.strictEqual(sessionRelue.idFormateur, 'F1');
  assert.strictEqual(sessionRelue.estFormateur, true);
  assert.strictEqual(sessionRelue.estAdministrateur, true);
  assert(env.audits.some(evenement =>
    evenement.action === 'ADMIN_DEVERROUILLAGE_REUSSI' &&
    String(evenement.utilisateur).includes('UTILISATEUR:') &&
    String(evenement.utilisateur).includes('FORMATEUR:F1')
  ));
  env.jetonAdministrateur = resultat.jeton;
});


test('verrouiller l’administration conserve la session formateur', () => {
  const env = creerEnvironnementDoubleAuthentification({
    connecterFormateur: true
  });
  const elevation = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur,
    env.jetonFormateur
  );
  env.contexte.verrouillerAdministration(elevation.jeton);
  const sessionFormateur = env.contexte.getSessionUtilisateur(
    env.jetonFormateur
  );
  assert.strictEqual(sessionFormateur.contexte, 'FORMATEUR');
  assert.strictEqual(sessionFormateur.estAdministrateur, false);
  assert.strictEqual(sessionFormateur.estFormateur, true);
  assert.strictEqual(
    env.contexte.getSessionUtilisateur(elevation.jeton).contexte,
    'NON_CONNECTE'
  );
});


test('la déconnexion après élévation invalide les deux sessions concernées', () => {
  const env = creerEnvironnementDoubleAuthentification({
    connecterFormateur: true
  });
  const elevation = env.contexte.deverrouillerAdministration(
    env.motDePasseAdministrateur,
    env.jetonFormateur
  );
  const resultat = env.contexte.deconnecterFormateur(
    env.jetonFormateur,
    elevation.jeton
  );
  assert.strictEqual(resultat.administrationAssocieeInvalidee, true);
  assert.strictEqual(
    env.contexte.getSessionUtilisateur(env.jetonFormateur).contexte,
    'NON_CONNECTE'
  );
  assert.strictEqual(
    env.contexte.getSessionUtilisateur(elevation.jeton).contexte,
    'NON_CONNECTE'
  );
});


test('un formateur ne peut pas s’accorder les droits admin sans le secret admin', () => {
  const env = creerEnvironnementDoubleAuthentification({
    connecterFormateur: true
  });
  assert.throws(
    () => env.contexte.deverrouillerAdministration(
      'mot de passe administrateur incorrect',
      env.jetonFormateur
    ),
    /Mot de passe administrateur incorrect/
  );
  const session = env.contexte.getSessionUtilisateur(env.jetonFormateur);
  assert.strictEqual(session.estFormateur, true);
  assert.strictEqual(session.estAdministrateur, false);
  assert.strictEqual(
    Object.keys(env.proprietes).some(cle => cle.startsWith('ADMIN_SESSION_')),
    false
  );
});


test('les sessions sont bornées et les plus anciennes sont purgées', () => {
  const envSession = creerEnvironnement();
  creerCompte(
    envSession,
    'F1',
    'alice.bornee',
    'phrase temporaire suffisamment longue'
  );
  const premiere = envSession.contexte.connecterFormateur(
    'alice.bornee',
    'phrase temporaire suffisamment longue'
  );
  envSession.contexte.terminerPremiereConnexionFormateur(
    premiere.jetonChangementMotDePasse,
    'nouvelle phrase sessions bornées',
    'nouvelle phrase sessions bornées'
  );
  for (let i = 0; i < 7; i++) {
    envSession.contexte.connecterFormateur(
      'alice.bornee',
      'nouvelle phrase sessions bornées'
    );
  }
  const sessions = Object.keys(envSession.proprietes).filter(
    nom => nom.startsWith('FORMATEUR_SESSION_')
  );
  assert.strictEqual(sessions.length, 5);
});


test('la réinitialisation admin invalide la session et force le changement', () => {
  const resultat = environnement.contexte.executerActionAccesFormateur(
    'F1',
    'REINITIALISER_MOT_DE_PASSE',
    {},
    'JETON_ADMIN_TEST'
  );
  assert(resultat.motDePasseTemporaire.length >= 15);
  assert.strictEqual(resultat.compte.doitChangerMotDePasse, true);
  assert.strictEqual(
    environnement.contexte.obtenirSessionFormateurValide_(
      environnement.sessionAlice,
      false,
      false
    ),
    null
  );
  assert.strictEqual(
    environnement.contexte.obtenirSessionFormateurValide_(
      environnement.sessionAliceSecondaire,
      false,
      false
    ),
    null
  );
});


test('la réinitialisation invalide aussi un défi de première connexion', () => {
  creerCompte(
    environnement,
    'F3',
    'chloe.durand',
    'première phrase de passe Chloé'
  );
  const connexion = environnement.contexte.connecterFormateur(
    'chloe.durand',
    'première phrase de passe Chloé'
  );
  environnement.contexte.executerActionAccesFormateur(
    'F3',
    'REINITIALISER_MOT_DE_PASSE',
    {},
    'JETON_ADMIN_TEST'
  );
  assert.throws(
    () => environnement.contexte.terminerPremiereConnexionFormateur(
      connexion.jetonChangementMotDePasse,
      'mot de passe qui ne doit pas passer',
      'mot de passe qui ne doit pas passer'
    ),
    /expiré/
  );
});


test('la désactivation invalide immédiatement toutes les sessions', () => {
  const debut = environnement.contexte.connecterFormateur(
    'bruno.martin',
    'phrase de passe commune'
  );
  const session = environnement.contexte.terminerPremiereConnexionFormateur(
    debut.jetonChangementMotDePasse,
    'nouvelle phrase de passe Bruno',
    'nouvelle phrase de passe Bruno'
  );
  environnement.contexte.executerActionAccesFormateur(
    'F2',
    'DESACTIVER',
    {},
    'JETON_ADMIN_TEST'
  );
  assert.strictEqual(
    environnement.contexte.obtenirSessionFormateurValide_(
      session.jeton,
      false,
      false
    ),
    null
  );
});


test('une session expirée ou un jeton invalide est refusé', () => {
  environnement.contexte.executerActionAccesFormateur(
    'F2', 'REACTIVER', {}, 'JETON_ADMIN_TEST'
  );
  const compte = ligneCompte(environnement, 'F2');
  compte.ligne[compte.index.DOIT_CHANGER_MOT_DE_PASSE] = 'Non';
  const feuille = environnement.feuilles.UTILISATEURS;
  const position = feuille.donnees.findIndex(
    ligne => ligne[compte.index.ID_FORMATEUR] === 'F2'
  );
  feuille.donnees[position] = compte.ligne;
  const connexion = environnement.contexte.connecterFormateur(
    'bruno.martin',
    'nouvelle phrase de passe Bruno'
  );
  const cle = Object.keys(environnement.proprietes).find(
    nom => nom.startsWith('FORMATEUR_SESSION_')
  );
  const session = JSON.parse(environnement.proprietes[cle]);
  session.expireAbsolueA = Date.now() - 1;
  environnement.proprietes[cle] = JSON.stringify(session);
  assert.strictEqual(
    environnement.contexte.obtenirSessionFormateurValide_(
      connexion.jeton,
      false,
      false
    ),
    null
  );
  assert.strictEqual(
    environnement.contexte.obtenirSessionFormateurValide_(
      'jeton-invalide',
      false,
      false
    ),
    null
  );
});


test('la déconnexion supprime réellement le jeton serveur', () => {
  const connexion = environnement.contexte.connecterFormateur(
    'bruno.martin',
    'nouvelle phrase de passe Bruno'
  );
  environnement.contexte.deconnecterFormateur(connexion.jeton);
  assert.strictEqual(
    environnement.contexte.obtenirSessionFormateurValide_(
      connexion.jeton,
      false,
      false
    ),
    null
  );
});


test('les réponses publiques ne contiennent jamais hash ni sel', () => {
  const comptes = environnement.contexte
    .obtenirComptesPublicsFormateursAdministration_();
  const json = JSON.stringify(comptes);
  assert(!/PASSWORD_HASH|PASSWORD_SALT|PBKDF2|PEPPER/.test(json));
  assert(!json.includes('troisième phrase de passe Alice'));
});


test('le pepper reste hors des réponses et des sauvegardes', () => {
  assert(sourceProduction.includes(
    "'FORMATEUR_PASSWORD_PEPPER'"
  ));
  assert(sourceSauvegarde.includes(
    "getProperty('FORMATEUR_PASSWORD_PEPPER')"
  ));
  const json = JSON.stringify(
    environnement.contexte.obtenirComptesPublicsFormateursAdministration_()
  );
  assert(!json.includes(environnement.proprietes.FORMATEUR_PASSWORD_PEPPER));
});


test('le benchmark est protégé par le jeton admin et ne lit aucun utilisateur', () => {
  const debut = sourceProduction.indexOf(
    'function benchmarkerDerivationMotDePasseFormateur('
  );
  const fin = sourceProduction.indexOf(
    'function normaliserOctetsSignesAuthentification_',
    debut
  );
  const benchmark = sourceProduction.slice(debut, fin);
  const debutDerivation = sourceProduction.indexOf(
    'function deriverMotDePasseFormateur_('
  );
  const finDerivation = sourceProduction.indexOf(
    'function verifierMotDePasseFormateur_(',
    debutDerivation
  );
  const derivation = sourceProduction.slice(
    debutDerivation,
    finDerivation
  );
  assert(debut >= 0);
  assert(benchmark.indexOf('exigerAdministrateur_(') <
    benchmark.indexOf('calculerVerificateurMotDePasseFormateur_('));
  assert(benchmark.includes(
    'lirePepperMotDePasseFormateurPourBenchmark_()'
  ));
  assert(benchmark.includes(
    'const iterationsTestees = [500, 1000, 1500, 2000];'
  ));
  assert(!/\[20000, 30000, 50000\]|100000/.test(benchmark));
  assert(!/lireTableUtilisateurs|SpreadsheetApp|journaliser|setProperty/.test(
    benchmark
  ));
  assert(derivation.includes(
    'calculerVerificateurMotDePasseFormateur_('
  ));
  assert(derivation.includes('calculerClePbkdf2Formateur_('));
  assert(derivation.includes('appliquerPepperMotDePasseFormateur_('));
  assert.throws(
    () => environnement.contexte
      .benchmarkerDerivationMotDePasseFormateur('JETON_INVALIDE'),
    /Accès réservé/
  );
});


test('le benchmark accepte les deux modes administrateur et refuse le jeton formateur seul', () => {
  const envDirect = creerEnvironnementDoubleAuthentification();
  envDirect.contexte.calculerClePbkdf2Formateur_ = () => [];
  const administrationDirecte = envDirect.contexte
    .deverrouillerAdministration(
      envDirect.motDePasseAdministrateur
    );
  const resultatDirect = envDirect.contexte
    .benchmarkerDerivationMotDePasseFormateur(
      administrationDirecte.jeton
    );
  assert.deepStrictEqual(
    Object.keys(resultatDirect.durees).sort(),
    ['1000', '1500', '2000', '500']
  );
  assert.strictEqual(resultatDirect.iterationsConfiguration, 1000);
  assert.strictEqual(
    resultatDirect.algorithme,
    'PBKDF2-HMAC-SHA-256'
  );
  assert(!JSON.stringify(resultatDirect).includes(
    envDirect.proprietes.FORMATEUR_PASSWORD_PEPPER
  ));
  assert.strictEqual(
    administrationDirecte.sessionUtilisateur.modeAccesAdministration,
    'ADMINISTRATION_DIRECTE'
  );

  const envEleve = creerEnvironnementDoubleAuthentification({
    connecterFormateur: true
  });
  envEleve.contexte.calculerClePbkdf2Formateur_ = () => [];
  assert.throws(
    () => envEleve.contexte
      .benchmarkerDerivationMotDePasseFormateur(
        envEleve.jetonFormateur
      ),
    /Accès réservé/
  );
  const elevation = envEleve.contexte.deverrouillerAdministration(
    envEleve.motDePasseAdministrateur,
    envEleve.jetonFormateur
  );
  const resultatEleve = envEleve.contexte
    .benchmarkerDerivationMotDePasseFormateur(elevation.jeton);
  assert.strictEqual(
    elevation.sessionUtilisateur.modeAccesAdministration,
    'ELEVATION_FORMATEUR'
  );
  assert.strictEqual(typeof resultatEleve.durees['500'], 'number');
  assert.strictEqual(typeof resultatEleve.durees['1000'], 'number');
  assert.strictEqual(typeof resultatEleve.durees['1500'], 'number');
  assert.strictEqual(typeof resultatEleve.durees['2000'], 'number');
});


test('le benchmark ne crée pas de pepper et ne retourne aucun secret', () => {
  const envSansPepper = creerEnvironnementDoubleAuthentification();
  delete envSansPepper.proprietes.FORMATEUR_PASSWORD_PEPPER;
  const administration = envSansPepper.contexte
    .deverrouillerAdministration(
      envSansPepper.motDePasseAdministrateur
    );
  assert.throws(
    () => envSansPepper.contexte
      .benchmarkerDerivationMotDePasseFormateur(
        administration.jeton
      ),
    /secret d’installation.*indisponible/
  );
  assert.strictEqual(
    envSansPepper.proprietes.FORMATEUR_PASSWORD_PEPPER,
    undefined
  );
});


test('le benchmark refuse une session administrateur expirée ou verrouillée', () => {
  const envExpire = creerEnvironnementDoubleAuthentification();
  envExpire.contexte.calculerClePbkdf2Formateur_ = () => [];
  const administration = envExpire.contexte
    .deverrouillerAdministration(
      envExpire.motDePasseAdministrateur
    );
  const cleSession = Object.keys(envExpire.proprietes).find(
    cle => cle.startsWith('ADMIN_SESSION_')
  );
  const session = JSON.parse(envExpire.proprietes[cleSession]);
  session.derniereActivite = Date.now() - 31 * 60 * 1000;
  session.expireA = Date.now() - 60 * 1000;
  envExpire.proprietes[cleSession] = JSON.stringify(session);
  delete envExpire.cache['ADMIN_LAST_ACTIVITY_' + cleSession];
  assert.throws(
    () => envExpire.contexte
      .benchmarkerDerivationMotDePasseFormateur(
        administration.jeton
      ),
    /Accès réservé/
  );

  const envVerrouille = creerEnvironnementDoubleAuthentification();
  envVerrouille.contexte.calculerClePbkdf2Formateur_ = () => [];
  const sessionVerrouillable = envVerrouille.contexte
    .deverrouillerAdministration(
      envVerrouille.motDePasseAdministrateur
    );
  envVerrouille.contexte.verrouillerAdministration(
    sessionVerrouillable.jeton
  );
  assert.throws(
    () => envVerrouille.contexte
      .benchmarkerDerivationMotDePasseFormateur(
        sessionVerrouillable.jeton
      ),
    /Accès réservé/
  );
});


test('l’identité et les droits sont toujours résolus côté serveur', () => {
  assert(sourceSecurite.includes("? 'FORMATEUR_ADMINISTRATEUR'"));
  assert(sourceSecurite.includes("? 'ADMINISTRATEUR'"));
  assert(sourceSecurite.includes(
    'construireIdentiteFormateurSessionAdministration_('
  ));
  assert(sourceSecurite.includes(
    'consulterStagiaires: estAdministrateur || estFormateur'
  ));
  assert(sourceSecurite.includes('gererReferentiel: estAdministrateur'));
  assert(sourceSecurite.includes('gererIndemnisations: estAdministrateur'));
  assert(sourceSessions.includes(
    'const sessionUtilisateur = exigerUtilisateurAuthentifie_('
  ));
  assert(sourceSessions.includes('sessionUtilisateur.identifiantHistorique'));
});


test('l’accès administrateur reste visible hors connexion et reçoit le jeton formateur facultatif', () => {
  const ecranConnexion = indexHtml.slice(
    indexHtml.indexOf('id="ecranConnexion"'),
    indexHtml.indexOf('</main>')
  );
  assert(ecranConnexion.includes('Accès administrateur'));
  assert(ecranConnexion.includes('ouvrirModalAccesAdministrateur()'));
  assert(sourceInterface.includes(
    '.deverrouillerAdministration(\n      motDePasse,\n      obtenirJetonFormateurApplication()'
  ));
  assert(sourceInterface.includes('Formateur + Administrateur'));
  assert(sourceInterface.includes(
    '.deconnecterFormateur(jeton, jetonAdministrateur)'
  ));
});


test('les favoris formateur utilisent ID_UTILISATEUR et l’import reste explicite', () => {
  assert(sourceFavoris.includes("return 'pusr_' + identifiant;"));
  assert(sourceFavoris.includes('session.idUtilisateur'));
  assert(sourceFavoris.includes('function importerFavorisLocauxFormateur('));
  assert(sourceInterface.includes('Importer les favoris de cet appareil'));
  assert(!sourceInterface.includes('importerFavorisLocauxFormateur(\n      cleLocale') ||
    sourceInterface.includes('onclick="importerFavorisLocauxFormateurInterface_()"'));
});


test('la migration 8 ajoute UTILISATEURS sans créer de compte', () => {
  assert(sourceMigration.includes('version: 8'));
  assert(sourceMigration.includes("feuille: 'UTILISATEURS'"));
  assert(sourceMigration.includes('function migration8AuthentificationFormateurs_'));
  const migration = sourceMigration.slice(
    sourceMigration.indexOf('function migration8AuthentificationFormateurs_'),
    sourceMigration.indexOf('function ajouterParametresEmail',
      sourceMigration.indexOf('function migration8AuthentificationFormateurs_'))
  );
  assert(migration.includes("assurerFeuilleMigration_(classeur, 'UTILISATEURS')"));
  assert(!/appendRow|setValues/.test(migration));
});


test('UTILISATEURS appartient au périmètre sauvegarde et restauration admin', () => {
  assert(sourceSauvegarde.includes('SCHEMA_BASE_'));
  assert(sourceRestauration.includes('SCHEMA_BASE_'));
  assert(sourceRestauration.includes('Toutes les feuilles déclarées'));
  assert(sourceSauvegarde.includes('exigerAdministrateur_'));
});


test('l’écran de connexion ne charge aucune donnée avant une session valide', () => {
  assert(indexHtml.includes('id="ecranConnexion"'));
  assert(indexHtml.includes('id="identifiantConnexionFormateur"'));
  assert(indexHtml.includes('id="motDePasseConnexionFormateur"'));
  assert(indexHtml.includes('Accès administrateur'));
  assert(sourceInterface.includes('resoudreSessionUtilisateurAuDemarrage_();'));
  assert(sourceInterface.includes("chargerPage('Accueil')"));
  assert(
    sourceInterface.indexOf('resoudreSessionUtilisateurAuDemarrage_();') <
    sourceInterface.indexOf("chargerPage('Accueil')")
  );
});


test('Administration Formateurs expose toutes les actions de compte', () => {
  [
    'Créer un accès', 'Gérer l’accès', 'Désactiver', 'Réactiver',
    'Débloquer', 'Forcer le changement', 'Réinitialiser le mot de passe'
  ].forEach(libelle => {
    assert(
      formateursHtml.includes(libelle) || sourceInterface.includes(libelle),
      'action absente : ' + libelle
    );
  });
});


test('la connexion est responsive et respecte Safari iOS', () => {
  assert(indexHtml.includes(
    'width=device-width, initial-scale=1, viewport-fit=cover'
  ));
  assert(css.includes('.ecran-connexion'));
  assert(css.includes('font-size: 16px;'));
  assert(css.includes('min-height: 44px;'));
  assert(css.includes('env(safe-area-inset-top'));
});


test('les champs de mot de passe utilisent les bons autocomplete et autorisent le collage', () => {
  assert(indexHtml.includes('autocomplete="username"'));
  assert(indexHtml.includes('autocomplete="current-password"'));
  assert(indexHtml.includes('autocomplete="new-password"'));
  assert(indexHtml.includes('minlength="10"'));
  assert(!indexHtml.includes('minlength="15"'));
  assert(formateursHtml.includes('minlength="10"'));
  assert(!/onpaste\s*=/.test(indexHtml));
  assert(sourceInterface.includes('function basculerVisibiliteMotDePasse_('));
});


test('le bouton afficher/masquer modifie réellement le type du champ', () => {
  const debut = sourceInterface.indexOf(
    'function basculerVisibiliteMotDePasse_('
  );
  const fin = sourceInterface.indexOf(
    'function masquerMotDePasseInterface_(',
    debut
  );
  const champ = {
    type: 'password',
    focus: () => {}
  };
  const attributs = {};
  const bouton = {
    textContent: 'Afficher',
    setAttribute: (nom, valeur) => {
      attributs[nom] = valeur;
    }
  };
  const contexteDom = {
    document: {
      getElementById: id => id === 'secret' ? champ : null
    }
  };
  vm.createContext(contexteDom);
  vm.runInContext(sourceInterface.slice(debut, fin), contexteDom);
  contexteDom.basculerVisibiliteMotDePasse_('secret', bouton);
  assert.strictEqual(champ.type, 'text');
  assert.strictEqual(bouton.textContent, 'Masquer');
  assert.strictEqual(attributs['aria-pressed'], 'true');
  contexteDom.basculerVisibiliteMotDePasse_('secret', bouton);
  assert.strictEqual(champ.type, 'password');
  assert.strictEqual(bouton.textContent, 'Afficher');
});


test('la dérivation réelle est PBKDF2-HMAC-SHA-256 à 1 000 itérations', () => {
  assert(sourceProduction.includes(
    'const ITERATIONS_PBKDF2_FORMATEUR_ = 1000;'
  ));
  assert(sourceProduction.includes('Utilities.computeHmacSha256Signature'));
  assert(sourceProduction.includes("'PF2'"));
  assert(sourceProduction.includes("'PBKDF2-HMAC-SHA-256'"));
  assert(sourceProduction.includes('comparaisonConstanteSecurite_'));
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
    console.log('✓ ' + nom);
  } catch (erreur) {
    console.error('✗ ' + nom);
    throw erreur;
  }
});

console.log('\n' + reussis + '/' + tests.length +
  ' tests d’authentification formateur réussis.');
