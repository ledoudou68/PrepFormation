'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const sourceService = fs.readFileSync(
  path.join(racine, 'RechercheGlobaleService.js'),
  'utf8'
);
const sourceInterface = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
).replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
const indexHtml = fs.readFileSync(path.join(racine, 'Index.html'), 'utf8');
const css = fs.readFileSync(path.join(racine, 'CSS.html'), 'utf8');
const securite = fs.readFileSync(
  path.join(racine, 'SecuriteService.js'),
  'utf8'
);
const metadonnees = fs.readFileSync(
  path.join(racine, 'ApplicationMetadataService.js'),
  'utf8'
);


function table(entetes, lignes) {
  return [entetes].concat(lignes).map(ligne => ligne.slice());
}


function donneesBase() {
  return {
    STAGIAIRES: table(
      [
        'UUID', 'NOM', 'PRENOM', 'FORMATION', 'STATUT',
        'PHOTO_FILE_ID', 'EMAIL', 'TELEPHONE', 'NOTES_ADMINISTRATIVES'
      ],
      [
        ['T1', 'BONNIN', 'José', 'F1', 'En préparation', 'PHOTO1', 'secret1@example.test', '0102', 'secret'],
        ['T2', 'DUPONT', 'Ana', 'F2', 'À préparer', '', 'secret2@example.test', '0304', 'secret'],
        ['T3', 'MARTIN', 'Élodie', 'F1', 'Stage aujourd’hui', '', '', '', '']
      ]
    ),
    FORMATEURS: table(
      ['ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF', 'EMAIL'],
      [
        ['FO1', 'DUPONT', 'Marc', true, 'marc@example.test'],
        ['FO2', 'LEROY', 'Paul', false, 'paul@example.test']
      ]
    ),
    SESSIONS: table(
      [
        'ID_SESSION', 'DATE_SESSION', 'HEURE_DEBUT', 'HEURE_FIN',
        'FORMATION', 'THEME', 'REMARQUES'
      ],
      [
        ['S1', '2026-08-01', '09:00', '11:00', 'F2', 'Ventilation', 'Atelier thorax'],
        ['S2', '2026-07-15', '14:00', '16:00', 'F1', 'Relevage', 'Mise en situation']
      ]
    ),
    FORMATIONS: table(
      ['ID_FORMATION', 'LIBELLE', 'ACTIF'],
      [
        ['F1', 'EQ PS', true],
        ['F2', 'Trauma', true]
      ]
    ),
    CATEGORIES: table(
      ['ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ACTIF'],
      [
        ['C1', 'F2', 'Respiration', true],
        ['C2', 'F1', 'Gestes', true]
      ]
    ),
    REFERENTIEL: table(
      [
        'ID_ITEM', 'FORMATION', 'ID_CATEGORIE',
        'ITEM', 'DESCRIPTION', 'ACTIF'
      ],
      [
        ['I1', 'F2', 'C1', 'Ventilation assistée', 'Traumatisme thoracique', true],
        ['I2', 'F1', 'C2', 'Bilan', 'Bilan circonstanciel', true]
      ]
    ),
    PRESENCES_STAGIAIRES: table(
      ['ID_SESSION', 'ID_STAGIAIRE'],
      [
        ['S1', 'T2'],
        ['S1', 'T2'],
        ['S2', 'T1']
      ]
    ),
    PRESTATIONS_FORMATEURS: table(
      ['ID_SESSION', 'ID_FORMATEUR', 'STATUT_INDEMNISATION'],
      [
        ['S1', 'FO1', 'À demander'],
        ['S2', 'FO2', 'Indemnisée']
      ]
    )
  };
}


function creerContexteService(donneesOptionnelles) {
  const donnees = donneesOptionnelles || donneesBase();
  const lectures = {};
  let totalLectures = 0;
  const feuilles = {};
  Object.keys(donnees).forEach(nom => {
    lectures[nom] = 0;
    feuilles[nom] = {
      getLastRow: () => donnees[nom].length,
      getLastColumn: () => donnees[nom][0].length,
      getDataRange: () => ({
        getValues: () => {
          lectures[nom]++;
          totalLectures++;
          return donnees[nom].map(ligne => ligne.slice());
        }
      })
    };
  });

  const memoireCache = {};
  const cache = {
    get: cle => Object.prototype.hasOwnProperty.call(memoireCache, cle)
      ? memoireCache[cle]
      : null,
    put: (cle, valeur) => { memoireCache[cle] = valeur; },
    remove: cle => { delete memoireCache[cle]; }
  };
  let sequenceUuid = 0;
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
    CacheService: { getScriptCache: () => cache },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (algorithme, contenu) => Array.from(
        crypto.createHash('sha256').update(String(contenu)).digest()
      ),
      base64EncodeWebSafe: octets => Buffer.from(octets).toString('base64url'),
      getUuid: () => 'GENERATION-' + (++sequenceUuid)
    },
    obtenirVersionApplication_: () => '1.9.3'
  };
  vm.createContext(contexte);
  vm.runInContext(sourceService, contexte, {
    filename: 'RechercheGlobaleService.js'
  });
  return {
    contexte,
    lectures,
    memoireCache,
    get totalLectures() { return totalLectures; }
  };
}


function groupe(resultat, type) {
  return resultat.groupes.find(element => element.type === type);
}


function nettoyer(objet) {
  return JSON.parse(JSON.stringify(objet));
}


function creerClassList(classesInitiales) {
  const classes = new Set(classesInitiales || []);
  return {
    add: classe => classes.add(classe),
    remove: classe => classes.delete(classe),
    contains: classe => classes.has(classe),
    toggle: (classe, force) => {
      if (force === true) {
        classes.add(classe);
        return true;
      }
      if (force === false) {
        classes.delete(classe);
        return false;
      }
      if (classes.has(classe)) {
        classes.delete(classe);
        return false;
      }
      classes.add(classe);
      return true;
    }
  };
}


function creerElement(options) {
  const attributs = {};
  return Object.assign({
    dataset: {},
    classList: creerClassList(),
    value: '',
    innerHTML: '',
    textContent: '',
    disabled: false,
    style: {},
    setAttribute: (nom, valeur) => { attributs[nom] = String(valeur); },
    getAttribute: nom => attributs[nom],
    contains: () => false,
    querySelectorAll: () => [],
    appendChild: () => {},
    scrollIntoView: () => {},
    focus: () => {}
  }, options || {});
}


function creerRunnerInterface(options) {
  const parametres = options || {};
  return {
    appels: [],
    succes: null,
    echec: null,
    withSuccessHandler(traitement) {
      this.succes = traitement;
      return this;
    },
    withFailureHandler(traitement) {
      this.echec = traitement;
      return this;
    },
    rechercherGlobalement(texte, optionsRecherche) {
      this.appels.push({ texte, optionsRecherche });
      if (parametres.erreur) {
        this.echec(new Error(parametres.erreur));
      } else if (parametres.resultat) {
        this.succes(parametres.resultat);
      }
    },
    getPhotoStagiaire() {}
  };
}


function creerContexteInterface(elements, runner) {
  const tableElements = elements || {};
  const minuteries = [];
  const document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: id => tableElements[id] || null,
    querySelectorAll: () => [],
    createElement: () => creerElement(),
    body: { classList: creerClassList(), appendChild: () => {} }
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
    Promise,
    Intl,
    isNaN,
    document,
    window: {
      addEventListener: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: (traitement, delai) => {
        minuteries.push({ traitement, delai });
        return minuteries.length;
      },
      clearTimeout: () => {},
      confirm: () => true
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    google: { script: { run: runner || creerRunnerInterface() } }
  };
  vm.createContext(contexte);
  vm.runInContext(sourceInterface, contexte, { filename: 'JavaScript.html' });
  return { contexte, minuteries, document };
}


function elementsRecherche() {
  return {
    champRechercheGlobale: creerElement(),
    panneauRechercheGlobale: creerElement({
      classList: creerClassList(['masque'])
    }),
    contenuRechercheGlobale: creerElement(),
    chargementRechercheGlobale: creerElement({
      classList: creerClassList(['masque'])
    }),
    conteneurRechercheGlobale: creerElement()
  };
}


const tests = [];
let dureePerformanceMs = null;
function test(nom, traitement) {
  tests.push({ nom, traitement });
}


test('moins de deux caractères ne lit aucune feuille', () => {
  const environnement = creerContexteService();
  const resultat = environnement.contexte.rechercherGlobalement('a', {});
  assert.strictEqual(resultat.nombreResultats, 0);
  assert.strictEqual(environnement.totalLectures, 0);
});


test('accents, casse et espaces superflus sont normalisés', () => {
  const environnement = creerContexteService();
  const resultat = environnement.contexte.rechercherGlobalement(
    '   ELODIE   ',
    {}
  );
  assert.strictEqual(groupe(resultat, 'STAGIAIRE').resultats[0].uuid, 'T3');
});


test('un nom partiel retrouve le stagiaire', () => {
  const resultat = creerContexteService().contexte.rechercherGlobalement(
    'bonn',
    {}
  );
  assert.strictEqual(groupe(resultat, 'STAGIAIRE').resultats[0].nom, 'BONNIN');
});


test('un prénom retrouve un stagiaire et un formateur', () => {
  const contexte = creerContexteService().contexte;
  const stagiaires = contexte.rechercherGlobalement('ana', {});
  const formateurs = contexte.rechercherGlobalement(
    'marc',
    {}
  );
  assert(groupe(stagiaires, 'STAGIAIRE').resultats.some(
    stagiaire => stagiaire.uuid === 'T2'
  ));
  assert(groupe(formateurs, 'FORMATEUR').resultats.some(
    resultatFormateur => resultatFormateur.idFormateur === 'FO1'
  ));
});


test('une séance est retrouvée par son formateur', () => {
  const resultat = creerContexteService().contexte.rechercherGlobalement(
    'marc',
    {}
  );
  assert(groupe(resultat, 'SESSION').resultats.some(
    session => session.idSession === 'S1'
  ));
});


test('une recherche multi-termes favorise le résultat qui contient tous les termes', () => {
  const resultat = creerContexteService().contexte.rechercherGlobalement(
    'dupont trauma',
    {}
  );
  const session = groupe(resultat, 'SESSION').resultats[0];
  assert.strictEqual(session.idSession, 'S1');
  assert.strictEqual(session.niveauCorrespondance, 2);
});


test('une formation est retrouvée par son libellé', () => {
  const resultat = creerContexteService().contexte.rechercherGlobalement(
    'trauma',
    {}
  );
  assert.strictEqual(groupe(resultat, 'FORMATION').resultats[0].libelle, 'Trauma');
});


test('un item est retrouvé par son intitulé ou sa description', () => {
  const environnement = creerContexteService();
  const parIntitule = environnement.contexte.rechercherGlobalement(
    'ventil',
    {}
  );
  const parDescription = environnement.contexte.rechercherGlobalement(
    'thoracique',
    {}
  );
  assert(groupe(parIntitule, 'REFERENTIEL').resultats.some(
    resultat => resultat.idItem === 'I1'
  ));
  assert(groupe(parDescription, 'REFERENTIEL').resultats.some(
    resultat => resultat.idItem === 'I1'
  ));
});


test('une catégorie est retrouvée sans exposer sa gestion', () => {
  const resultat = creerContexteService().contexte.rechercherGlobalement(
    'respiration',
    {}
  );
  const categorie = groupe(resultat, 'REFERENTIEL').resultats.find(
    element => element.sousType === 'CATEGORIE'
  );
  assert.strictEqual(categorie.idCategorie, 'C1');
});


test('une séance est retrouvée par sa date française', () => {
  const resultat = creerContexteService().contexte.rechercherGlobalement(
    '01/08/2026',
    {}
  );
  assert.strictEqual(groupe(resultat, 'SESSION').resultats[0].idSession, 'S1');
});


test('une séance est retrouvée par un stagiaire présent', () => {
  const resultat = creerContexteService().contexte.rechercherGlobalement(
    'ana dupont',
    {}
  );
  assert(groupe(resultat, 'SESSION').resultats.some(
    session => session.idSession === 'S1'
  ));
});


test('le classement respecte exact, début, multi-termes puis partiel', () => {
  const c = creerContexteService().contexte;
  const entree = c.creerEntreeRechercheGlobale_(
    'TEST',
    '1',
    ['BONNIN', 'TRAUMA'],
    {}
  );
  assert.strictEqual(
    c.classerCorrespondanceRechercheGlobale_(entree, 'bonnin', ['bonnin']).niveau,
    0
  );
  assert.strictEqual(
    c.classerCorrespondanceRechercheGlobale_(entree, 'bon', ['bon']).niveau,
    1
  );
  assert.strictEqual(
    c.classerCorrespondanceRechercheGlobale_(
      entree,
      'bonnin trauma',
      ['bonnin', 'trauma']
    ).niveau,
    2
  );
  assert.strictEqual(
    c.classerCorrespondanceRechercheGlobale_(entree, 'onni', ['onni']).niveau,
    3
  );
});


test('chaque groupe est limité à cinq résultats avec son total réel', () => {
  const donnees = donneesBase();
  for (let index = 0; index < 8; index++) {
    donnees.STAGIAIRES.push([
      'TX' + index, 'TEST' + index, 'Camille', 'F1', 'À préparer',
      '', '', '', ''
    ]);
  }
  const resultat = creerContexteService(donnees).contexte
    .rechercherGlobalement('test', {});
  const stagiaires = groupe(resultat, 'STAGIAIRE');
  assert.strictEqual(stagiaires.resultats.length, 5);
  assert.strictEqual(stagiaires.total, 8);
});


test('chaque feuille utile est lue une seule fois', () => {
  const environnement = creerContexteService();
  environnement.contexte.rechercherGlobalement('dupont', {});
  assert.strictEqual(environnement.totalLectures, 8);
  Object.values(environnement.lectures).forEach(nombre => {
    assert.strictEqual(nombre, 1);
  });
});


test('le cache court évite une seconde lecture puis son invalidation force la relire', () => {
  const environnement = creerContexteService();
  const premier = environnement.contexte.rechercherGlobalement('dupont', {});
  const lecturesPremier = environnement.totalLectures;
  const second = environnement.contexte.rechercherGlobalement('dupont', {});
  assert.strictEqual(environnement.totalLectures, lecturesPremier);
  assert.strictEqual(premier.meta.cacheUtilise, false);
  assert.strictEqual(second.meta.cacheUtilise, true);
  environnement.contexte.invaliderCacheRechercheGlobale_();
  environnement.contexte.rechercherGlobalement('dupont', {});
  assert.strictEqual(environnement.totalLectures, lecturesPremier + 8);
});


test('aucune donnée sensible n’est retournée au navigateur', () => {
  const resultat = creerContexteService().contexte.rechercherGlobalement(
    'dupont',
    {}
  );
  const texte = JSON.stringify(resultat);
  [
    'secret1@example.test', 'secret2@example.test', '0102', '0304',
    'NOTES_ADMINISTRATIVES', 'STATUT_INDEMNISATION', 'PHOTO1'
  ].forEach(secret => assert(!texte.includes(secret)));
  assert(!/email|telephone|fileId|photoFileId/i.test(texte));
});


test('la recherche reste en lecture seule et sans migration', () => {
  assert(!/\.setValue|\.setValues|appendRow|insertSheet|deleteSheet|clearContent/.test(
    sourceService
  ));
  assert(!sourceService.includes('executerMigrations'));
  assert(!sourceService.includes('executerMutationMetier_'));
  assert(!sourceService.includes('DriveApp'));
  assert(!sourceService.includes('MailApp'));
});


test('l’index mémoire reste sous 300 ms sur un volume habituel conséquent', () => {
  const donnees = donneesBase();
  for (let index = 0; index < 2500; index++) {
    donnees.STAGIAIRES.push([
      'P' + index, 'NOM' + index, 'PRENOM' + index,
      index % 2 ? 'F1' : 'F2', 'À préparer', '', '', '', ''
    ]);
  }
  const environnement = creerContexteService(donnees);
  const debut = Date.now();
  environnement.contexte.rechercherGlobalement('nom2499', {});
  dureePerformanceMs = Date.now() - debut;
  assert(
    dureePerformanceMs < 300,
    'Recherche trop lente : ' + dureePerformanceMs + ' ms'
  );
});


test('l’interface attend deux caractères et programme exactement 250 ms', () => {
  const elements = elementsRecherche();
  const runner = creerRunnerInterface();
  const environnement = creerContexteInterface(elements, runner);
  elements.champRechercheGlobale.value = 'a';
  environnement.contexte.programmerRechercheGlobale();
  assert.strictEqual(environnement.minuteries.length, 0);
  assert.strictEqual(runner.appels.length, 0);
  elements.champRechercheGlobale.value = 'ab';
  environnement.contexte.programmerRechercheGlobale();
  assert.strictEqual(environnement.minuteries[0].delai, 250);
  environnement.minuteries[0].traitement();
  assert.strictEqual(runner.appels.length, 1);
});


test('un résultat stagiaire recharge les données autorisées puis ouvre la fiche existante', () => {
  const environnement = creerContexteInterface(elementsRecherche());
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  etat.rechercheGlobale = {
    resultatsNavigables: [{
      type: 'STAGIAIRE', uuid: 'T1', nom: 'BONNIN', prenom: 'José',
      formation: 'EQ PS', statut: 'En préparation', aUnePhoto: false
    }],
    generation: 0
  };
  let pageOuverte = '';
  environnement.contexte.chargerPage = page => { pageOuverte = page; };
  environnement.contexte.ouvrirResultatRechercheGlobale(0);
  assert.strictEqual(etat.stagiaireAConsulterDepuisAccueil, 'T1');
  assert.strictEqual(pageOuverte, 'Stagiaires');
});


test('un résultat séance ouvre directement sa consultation détaillée', () => {
  const environnement = creerContexteInterface(elementsRecherche());
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  etat.rechercheGlobale = {
    resultatsNavigables: [{ type: 'SESSION', idSession: 'S1' }],
    generation: 0
  };
  let sessionOuverte = '';
  environnement.contexte.consulterSession = id => { sessionOuverte = id; };
  environnement.contexte.ouvrirResultatRechercheGlobale(0);
  assert.strictEqual(sessionOuverte, 'S1');
});


test('un formateur voit le Référentiel dans les résultats sans pouvoir l’ouvrir', () => {
  const environnement = creerContexteInterface(elementsRecherche());
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  etat.sessionUtilisateur = { estAdministrateur: false, droits: {} };
  assert.strictEqual(
    environnement.contexte.resultatRechercheGlobaleAccessible_({ type: 'ITEM' }),
    false
  );
  const htmlResultat = environnement.contexte.creerLigneResultatRechercheGlobale_(
    {
      type: 'ITEM', item: 'Ventilation', categorie: 'Respiration',
      formation: 'Trauma', sousType: 'ITEM'
    },
    -1,
    false
  );
  assert(htmlResultat.includes('réservée à l’administrateur'));
});


test('les flèches, Entrée et Échap pilotent le panneau', () => {
  const elements = elementsRecherche();
  const bouton0 = creerElement({ dataset: { indexRecherche: '0' } });
  const bouton1 = creerElement({ dataset: { indexRecherche: '1' } });
  const environnement = creerContexteInterface(elements);
  environnement.document.querySelectorAll = selecteur =>
    selecteur === '[data-index-recherche]' ? [bouton0, bouton1] : [];
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  etat.rechercheGlobale = {
    resultatsNavigables: [{ id: '1' }, { id: '2' }],
    indexActif: -1,
    generation: 0
  };
  let indexOuvert = -1;
  environnement.contexte.ouvrirResultatRechercheGlobale = index => {
    indexOuvert = index;
  };
  const evenement = cle => ({ key: cle, preventDefault: () => {} });
  environnement.contexte.gererClavierRechercheGlobale(evenement('ArrowDown'));
  environnement.contexte.gererClavierRechercheGlobale(evenement('Enter'));
  assert.strictEqual(indexOuvert, 0);
  environnement.contexte.gererClavierRechercheGlobale(evenement('Escape'));
  assert(elements.panneauRechercheGlobale.classList.contains('masque'));
});


test('une erreur serveur reste confinée au panneau de recherche', () => {
  const elements = elementsRecherche();
  const runner = creerRunnerInterface({ erreur: 'Serveur indisponible' });
  const environnement = creerContexteInterface(elements, runner);
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  etat.rechercheGlobale = {
    generation: 1, resultatsNavigables: [], indexActif: -1
  };
  environnement.contexte.executerRechercheGlobale_('test', 1);
  assert(elements.contenuRechercheGlobale.innerHTML.includes(
    'Serveur indisponible'
  ));
});


test('le mobile utilise un panneau plein écran et des cibles tactiles', () => {
  const section = css.slice(css.indexOf('RECHERCHE GLOBALE'));
  assert(section.includes('@media (max-width: 800px)'));
  assert(section.includes('position: fixed'));
  assert(section.includes('inset: 0'));
  assert(section.includes('min-height: 58px'));
  assert(indexHtml.includes('bouton-ouvrir-recherche-mobile'));
  assert(indexHtml.includes('Rechercher dans PrepFormation…'));
});


test('l’invalidation est raccordée au point central de toutes les mutations', () => {
  assert(securite.includes(
    "typeof invaliderCacheRechercheGlobale_ === 'function'"
  ));
  assert(securite.includes('invaliderCacheRechercheGlobale_();'));
});


test('la version applicative est centralisée à 1.9.3', () => {
  assert(metadonnees.includes(
    "VERSION_APPLICATION_PREPFORMATION_ = '1.9.3'"
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
  '\n' + reussis + '/' + tests.length +
  ' tests de recherche globale réussis.\n' +
  'Mesure locale : 2 500 stagiaires indexés et recherchés en ' +
  dureePerformanceMs + ' ms.\n'
);
