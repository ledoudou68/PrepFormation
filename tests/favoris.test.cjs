'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const sourceService = fs.readFileSync(
  path.join(racine, 'FavorisService.js'),
  'utf8'
);
const sourceInterface = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
).replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
const sourceMigration = fs.readFileSync(
  path.join(racine, 'MigrationService.js'),
  'utf8'
);
const sourceRecherche = fs.readFileSync(
  path.join(racine, 'RechercheGlobaleService.js'),
  'utf8'
);
const indexHtml = fs.readFileSync(path.join(racine, 'Index.html'), 'utf8');
const css = fs.readFileSync(path.join(racine, 'CSS.html'), 'utf8');
const metadonnees = fs.readFileSync(
  path.join(racine, 'ApplicationMetadataService.js'),
  'utf8'
);


function table(entetes, lignes) {
  return [entetes].concat(lignes).map(function (ligne) {
    return ligne.slice();
  });
}


function donneesBase() {
  return {
    FAVORIS: table(
      [
        'ID_FAVORI', 'TYPE', 'IDENTIFIANT', 'LIBELLE',
        'SOUS_LIBELLE', 'UTILISATEUR_CLE', 'DATE_CREATION'
      ],
      []
    ),
    STAGIAIRES: table(
      [
        'UUID', 'NOM', 'PRENOM', 'FORMATION', 'EMAIL',
        'TELEPHONE', 'PHOTO_FILE_ID', 'NOTES_ADMINISTRATIVES'
      ],
      [[
        'T1', 'BONNIN', 'José', 'F1', 'secret@example.test',
        '01234567890', 'DRIVE_SECRET', 'Note secrète'
      ]]
    ),
    FORMATEURS: table(
      ['ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF', 'EMAIL'],
      [
        ['FO1', 'DUPONT', 'Marc', true, 'marc@example.test'],
        ['FO2', 'LEROY', 'Paul', false, 'paul@example.test']
      ]
    ),
    FORMATIONS: table(
      ['ID_FORMATION', 'LIBELLE', 'ACTIF'],
      [
        ['F1', 'EQ PS', true],
        ['F2', 'CA SUAP', false]
      ]
    ),
    SESSIONS: table(
      [
        'ID_SESSION', 'DATE_SESSION', 'HEURE_DEBUT',
        'HEURE_FIN', 'FORMATION', 'REMARQUES'
      ],
      [[
        'S1', '2026-08-01', '09:00', '11:00', 'F1',
        'Remarque confidentielle'
      ]]
    ),
    CATEGORIES: table(
      ['ID_CATEGORIE', 'FORMATION', 'CATEGORIE', 'ACTIF'],
      [['C1', 'F1', 'Respiration', true]]
    ),
    REFERENTIEL: table(
      [
        'ID_ITEM', 'FORMATION', 'ID_CATEGORIE',
        'ITEM', 'DESCRIPTION', 'ACTIF'
      ],
      [
        ['I1', 'F1', 'C1', 'Ventilation', 'Secret descriptif', true],
        ['I2', 'F1', 'C1', 'Bilan', '', false]
      ]
    )
  };
}


function creerContexteService(donneesOptionnelles) {
  const donnees = donneesOptionnelles || donneesBase();
  const feuilles = {};
  let mutations = 0;
  let sequence = 0;

  Object.keys(donnees).forEach(function (nom) {
    const valeurs = donnees[nom];
    feuilles[nom] = {
      getLastRow: () => valeurs.length,
      getLastColumn: () => valeurs[0].length,
      getDataRange: () => ({
        getValues: () => valeurs.map(function (ligne) {
          return ligne.slice();
        })
      }),
      getRange: (ligne, colonne, nombreLignes, nombreColonnes) => ({
        setValues: lignes => {
          for (let decalage = 0; decalage < nombreLignes; decalage++) {
            const numero = ligne - 1 + decalage;
            valeurs[numero] = valeurs[numero] ||
              new Array(valeurs[0].length).fill('');
            for (let position = 0; position < nombreColonnes; position++) {
              valeurs[numero][colonne - 1 + position] =
                lignes[decalage][position];
            }
          }
        }
      }),
      deleteRow: numero => {
        valeurs.splice(numero - 1, 1);
      }
    };
  });

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
    Utilities: {
      getUuid: () => 'FAVORI-' + (++sequence)
    },
    executerMutationMetier_: traitement => {
      mutations++;
      return traitement();
    }
  };
  vm.createContext(contexte);
  vm.runInContext(sourceService, contexte, {
    filename: 'FavorisService.js'
  });
  return {
    contexte,
    donnees,
    get mutations() {
      return mutations;
    }
  };
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
    title: '',
    setAttribute: (nom, valeur) => { attributs[nom] = String(valeur); },
    getAttribute: nom => attributs[nom],
    removeAttribute: nom => { delete attributs[nom]; },
    contains: () => false,
    querySelectorAll: () => [],
    appendChild: () => {},
    scrollIntoView: () => {},
    focus: () => {}
  }, options || {});
}


function creerRunnerInterface(configuration) {
  const options = configuration || {};
  return {
    succes: null,
    echec: null,
    appels: [],
    withSuccessHandler(traitement) {
      this.succes = traitement;
      return this;
    },
    withFailureHandler(traitement) {
      this.echec = traitement;
      return this;
    },
    getFavoris(cle) {
      this.appels.push({ fonction: 'getFavoris', cle });
      if (options.erreurLecture) {
        this.echec(new Error(options.erreurLecture));
      } else {
        this.succes(options.favoris || []);
      }
    },
    ajouterFavori(type, identifiant, cle) {
      this.appels.push({ fonction: 'ajouterFavori', type, identifiant, cle });
      if (options.erreurAjout) {
        this.echec(new Error(options.erreurAjout));
      } else {
        this.succes({
          idFavori: 'F1', type, identifiant,
          cleResultat: type + ':' + identifiant,
          libelle: identifiant, sousLibelle: '', disponible: true,
          actif: true, dateCreation: '2026-08-08T10:00:00.000Z'
        });
      }
    },
    supprimerFavori(type, identifiant, cle) {
      this.appels.push({ fonction: 'supprimerFavori', type, identifiant, cle });
      if (options.erreurSuppression) {
        this.echec(new Error(options.erreurSuppression));
      } else {
        this.succes({ supprime: true, type, identifiant });
      }
    },
    rechercherGlobalement() {},
    getPhotoStagiaire() {}
  };
}


function creerContexteInterface(configuration) {
  const options = configuration || {};
  const stockage = options.stockage || {};
  const elements = options.elements || {};
  const boutonsFavoris = options.boutonsFavoris || [];
  const runner = options.runner || creerRunnerInterface();
  const document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: id => elements[id] || null,
    querySelectorAll: selecteur => selecteur === '[data-favori-cle]'
      ? boutonsFavoris
      : [],
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
    Uint32Array,
    isNaN,
    document,
    window: {
      localStorage: {
        getItem: cle => stockage[cle] || null,
        setItem: (cle, valeur) => { stockage[cle] = valeur; },
        removeItem: cle => { delete stockage[cle]; }
      },
      crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
      addEventListener: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: traitement => { traitement(); return 1; },
      clearTimeout: () => {},
      confirm: () => true
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    google: { script: { run: runner } }
  };
  vm.createContext(contexte);
  vm.runInContext(sourceInterface, contexte, { filename: 'JavaScript.html' });
  return { contexte, document, stockage, runner, elements };
}


function elementsFavoris() {
  return {
    contenuFavoris: creerElement(),
    compteurFavorisTopbar: creerElement({
      classList: creerClassList(['masque'])
    }),
    panneauFavoris: creerElement({ classList: creerClassList(['masque']) }),
    boutonOuvrirFavoris: creerElement(),
    conteneurFavoris: creerElement(),
    toast: creerElement()
  };
}


const tests = [];
function test(nom, traitement) {
  tests.push({ nom, traitement });
}


test('une clé locale stable est créée dans localStorage sans jeton administrateur', () => {
  const environnement = creerContexteInterface();
  const premiere = environnement.contexte
    .obtenirOuCreerCleUtilisateurFavoris_();
  const seconde = environnement.contexte
    .obtenirOuCreerCleUtilisateurFavoris_();
  assert.strictEqual(premiere, seconde);
  assert(premiere.startsWith('pfav_'));
  assert(!premiere.includes('administr'));
  assert.strictEqual(
    environnement.stockage['prepformation.utilisateurFavoris'],
    premiere
  );
});


test('un favori stagiaire est ajouté par la mutation centrale', () => {
  const environnement = creerContexteService();
  const favori = environnement.contexte.ajouterFavori(
    'STAGIAIRE',
    'T1',
    'pfav_aaaaaaaaaaaaaaaaaaaa'
  );
  assert.strictEqual(environnement.mutations, 1);
  assert.strictEqual(environnement.donnees.FAVORIS.length, 2);
  assert.strictEqual(favori.libelle, 'BONNIN José');
  assert.strictEqual(favori.disponible, true);
});


test('un doublon retourne le favori existant sans ajouter de ligne', () => {
  const environnement = creerContexteService();
  const argumentsFavori = [
    'STAGIAIRE', 'T1', 'pfav_bbbbbbbbbbbbbbbbbbbb'
  ];
  environnement.contexte.ajouterFavori(...argumentsFavori);
  const premierId = environnement.donnees.FAVORIS[1][0];
  const favori = environnement.contexte.ajouterFavori(...argumentsFavori);
  assert.strictEqual(environnement.donnees.FAVORIS.length, 2);
  assert.strictEqual(favori.idFavori, premierId);
});


test('la suppression ne retire que le favori de la clé fournie', () => {
  const environnement = creerContexteService();
  environnement.contexte.ajouterFavori(
    'STAGIAIRE', 'T1', 'pfav_cccccccccccccccccccc'
  );
  environnement.contexte.ajouterFavori(
    'STAGIAIRE', 'T1', 'pfav_dddddddddddddddddddd'
  );
  environnement.contexte.supprimerFavori(
    'STAGIAIRE', 'T1', 'pfav_cccccccccccccccccccc'
  );
  assert.strictEqual(environnement.donnees.FAVORIS.length, 2);
  assert.strictEqual(
    environnement.donnees.FAVORIS[1][5],
    'pfav_dddddddddddddddddddd'
  );
});


test('les cinq types autorisés peuvent être ajoutés et lus ensemble', () => {
  const environnement = creerContexteService();
  const cle = 'pfav_eeeeeeeeeeeeeeeeeeee';
  [
    ['STAGIAIRE', 'T1'],
    ['FORMATEUR', 'FO1'],
    ['SESSION', 'S1'],
    ['FORMATION', 'F1'],
    ['ITEM', 'I1']
  ].forEach(function (element) {
    environnement.contexte.ajouterFavori(element[0], element[1], cle);
  });
  const favoris = environnement.contexte.getFavoris(cle);
  assert.deepStrictEqual(
    Array.from(new Set(favoris.map(favori => favori.type))).sort(),
    ['FORMATEUR', 'FORMATION', 'ITEM', 'SESSION', 'STAGIAIRE']
  );
});


test('estFavori respecte le type, l’identifiant et la clé locale', () => {
  const environnement = creerContexteService();
  const cle = 'pfav_ffffffffffffffffffff';
  environnement.contexte.ajouterFavori('SESSION', 'S1', cle);
  assert.strictEqual(environnement.contexte.estFavori('SESSION', 'S1', cle), true);
  assert.strictEqual(
    environnement.contexte.estFavori(
      'SESSION', 'S1', 'pfav_gggggggggggggggggggg'
    ),
    false
  );
});


test('un objet supprimé reste affiché comme indisponible et retirable', () => {
  const donnees = donneesBase();
  donnees.FAVORIS.push([
    'F-ABSENT', 'STAGIAIRE', 'T404', 'Ancien stagiaire',
    'EQ PS', 'pfav_hhhhhhhhhhhhhhhhhhhh', '2026-08-01T10:00:00.000Z'
  ]);
  const favoris = creerContexteService(donnees).contexte.getFavoris(
    'pfav_hhhhhhhhhhhhhhhhhhhh'
  );
  assert.strictEqual(favoris[0].disponible, false);
  assert.strictEqual(favoris[0].libelle, 'Ancien stagiaire');
});


test('les objets désactivés conservent leur favori avec le statut inactif', () => {
  const environnement = creerContexteService();
  const cle = 'pfav_iiiiiiiiiiiiiiiiiiii';
  environnement.contexte.ajouterFavori('FORMATEUR', 'FO2', cle);
  environnement.contexte.ajouterFavori('ITEM', 'I2', cle);
  const favoris = environnement.contexte.getFavoris(cle);
  assert(favoris.every(favori => favori.disponible));
  assert(favoris.every(favori => favori.actif === false));
});


test('un type invalide, un identifiant vide et une clé invalide sont refusés', () => {
  const c = creerContexteService().contexte;
  assert.throws(
    () => c.ajouterFavori('CATEGORIE', 'C1', 'pfav_jjjjjjjjjjjjjjjjjjjj'),
    /Type de favori invalide/
  );
  assert.throws(
    () => c.ajouterFavori('ITEM', '', 'pfav_jjjjjjjjjjjjjjjjjjjj'),
    /Identifiant de favori invalide/
  );
  assert.throws(() => c.getFavoris('court'), /Clé locale/);
});


test('aucune donnée sensible n’est retournée ou utilisée comme identité', () => {
  const environnement = creerContexteService();
  const cle = 'pfav_kkkkkkkkkkkkkkkkkkkk';
  environnement.contexte.ajouterFavori('STAGIAIRE', 'T1', cle);
  environnement.contexte.ajouterFavori('SESSION', 'S1', cle);
  const json = JSON.stringify(environnement.contexte.getFavoris(cle));
  assert(!json.includes('secret@example.test'));
  assert(!json.includes('01234567890'));
  assert(!json.includes('DRIVE_SECRET'));
  assert(!json.includes('Remarque confidentielle'));
  assert(!sourceService.includes('exigerAdministrateur_'));
  assert(!sourceService.includes('Session.getActiveUser'));
  assert(!sourceService.includes('DriveApp'));
});


test('le panneau vide affiche le libellé attendu', () => {
  const elements = elementsFavoris();
  const environnement = creerContexteInterface({ elements });
  const etat = environnement.contexte.obtenirEtatFavoris_();
  etat.charges = true;
  etat.liste = [];
  environnement.contexte.afficherPanneauFavoris_();
  assert(elements.contenuFavoris.innerHTML.includes(
    'Aucun favori pour le moment'
  ));
});


test('chaque résultat compatible de recherche globale reçoit une étoile', () => {
  const environnement = creerContexteInterface({ elements: elementsFavoris() });
  const etat = environnement.contexte.obtenirEtatFavoris_();
  etat.charges = true;
  const ligne = environnement.contexte.creerLigneResultatRechercheGlobale_(
    {
      type: 'STAGIAIRE', uuid: 'T1', nom: 'BONNIN', prenom: 'José',
      formation: 'EQ PS', statut: 'En préparation', aUnePhoto: false
    },
    0,
    true
  );
  assert(ligne.includes('data-favori-type="STAGIAIRE"'));
  assert(ligne.includes('data-favori-identifiant="T1"'));
  assert(sourceRecherche.includes('cleResultat'));
});


test('ouvrir un stagiaire favori recharge sa fiche existante', () => {
  const environnement = creerContexteInterface({ elements: elementsFavoris() });
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  let page = '';
  environnement.contexte.chargerPage = valeur => { page = valeur; };
  environnement.contexte.remplacerFavorisClient_([{
    idFavori: 'FS', type: 'STAGIAIRE', identifiant: 'T1',
    cleResultat: 'STAGIAIRE:T1', libelle: 'BONNIN José',
    sousLibelle: 'EQ PS', disponible: true, actif: true,
    dateCreation: '2026-08-08T10:00:00.000Z'
  }]);
  environnement.contexte.ouvrirFavoriDepuisPanneau('FS');
  assert.strictEqual(page, 'Stagiaires');
  assert.strictEqual(etat.stagiaireAConsulterDepuisAccueil, 'T1');
});


test('ouvrir une séance favorite réutilise sa consultation détaillée', () => {
  const environnement = creerContexteInterface({ elements: elementsFavoris() });
  let idSession = '';
  environnement.contexte.consulterSession = id => { idSession = id; };
  environnement.contexte.remplacerFavorisClient_([{
    idFavori: 'FSE', type: 'SESSION', identifiant: 'S1',
    cleResultat: 'SESSION:S1', libelle: 'Séance', sousLibelle: 'EQ PS',
    disponible: true, actif: true, dateCreation: '2026-08-08T10:00:00.000Z'
  }]);
  environnement.contexte.ouvrirFavoriDepuisPanneau('FSE');
  assert.strictEqual(idSession, 'S1');
});


test('ouvrir un formateur favori ouvre le module et prépare son surlignage', () => {
  const environnement = creerContexteInterface({ elements: elementsFavoris() });
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  let page = '';
  environnement.contexte.chargerPage = valeur => { page = valeur; };
  environnement.contexte.ouvrirObjetApplication_(
    'FORMATEUR', 'FO1', {}
  );
  assert.strictEqual(page, 'Formateurs');
  assert.strictEqual(etat.formateurDepuisRechercheGlobale, 'FO1');
});


test('un item favori ouvre le Référentiel pour un administrateur', () => {
  const environnement = creerContexteInterface({ elements: elementsFavoris() });
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  etat.sessionUtilisateur = { estAdministrateur: true, droits: {} };
  let page = '';
  environnement.contexte.chargerPage = valeur => { page = valeur; };
  environnement.contexte.ouvrirObjetApplication_(
    'ITEM', 'I1', { formation: 'EQ PS' }
  );
  assert.strictEqual(page, 'Referentiel');
  assert.strictEqual(etat.referentielItemASelectionner, 'I1');
  assert.strictEqual(etat.referentielFormationDepuisRechercheGlobale, 'EQ PS');
});


test('un formateur ne peut pas ouvrir un item mais peut le retirer', () => {
  const elements = elementsFavoris();
  const environnement = creerContexteInterface({ elements });
  const etat = vm.runInContext('etatApplication', environnement.contexte);
  etat.sessionUtilisateur = { estAdministrateur: false, droits: {} };
  environnement.contexte.remplacerFavorisClient_([{
    idFavori: 'FI', type: 'ITEM', identifiant: 'I1',
    cleResultat: 'ITEM:I1', libelle: 'Ventilation', sousLibelle: 'EQ PS',
    disponible: true, actif: true, dateCreation: '2026-08-08T10:00:00.000Z'
  }]);
  assert(elements.contenuFavoris.innerHTML.includes('Lecture seule'));
  assert(elements.contenuFavoris.innerHTML.includes('retirer-favori'));
  assert(elements.contenuFavoris.innerHTML.includes('disabled'));
});


test('cliquer sur une étoile de recherche n’ouvre pas le résultat', () => {
  const environnement = creerContexteInterface({ elements: elementsFavoris() });
  const etat = environnement.contexte.obtenirEtatFavoris_();
  etat.charges = true;
  etat.utilisateurCle = 'pfav_mmmmmmmmmmmmmmmmmmmm';
  let propagationArretee = false;
  environnement.contexte.basculerFavoriDepuisBouton(
    {
      preventDefault() {},
      stopPropagation() { propagationArretee = true; }
    },
    {
      dataset: {
        favoriType: 'SESSION',
        favoriIdentifiant: 'S1'
      }
    }
  );
  assert.strictEqual(propagationArretee, true);
  assert(etat.parCle['SESSION:S1']);
});


test('une erreur serveur restaure immédiatement l’étoile précédente', () => {
  const cle = 'STAGIAIRE:T1';
  const bouton = creerElement({
    dataset: {
      favoriCle: cle,
      favoriType: 'STAGIAIRE',
      favoriIdentifiant: 'T1'
    }
  });
  const environnement = creerContexteInterface({
    elements: elementsFavoris(),
    boutonsFavoris: [bouton],
    runner: creerRunnerInterface({ erreurAjout: 'Échec simulé' })
  });
  const etat = environnement.contexte.obtenirEtatFavoris_();
  etat.charges = true;
  etat.utilisateurCle = 'pfav_llllllllllllllllllll';
  environnement.contexte.basculerFavoriDepuisBouton(
    { preventDefault() {}, stopPropagation() {} },
    bouton
  );
  assert.strictEqual(etat.parCle[cle], undefined);
  assert.strictEqual(bouton.textContent, '☆');
  assert.strictEqual(bouton.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(bouton.disabled, false);
});


test('une restauration terminale force un seul rechargement des favoris', () => {
  const environnement = creerContexteInterface({ elements: elementsFavoris() });
  let appels = 0;
  environnement.contexte.chargerFavorisUtilisateur_ = () => { appels++; };
  environnement.contexte.rechargerFavorisApresRestauration_();
  environnement.contexte.rechargerFavorisApresRestauration_();
  assert.strictEqual(appels, 1);
  assert(sourceInterface.includes(
    'rechargerFavorisApresRestauration_();'
  ));
});


test('la migration 6 ajoute uniquement la feuille FAVORIS au schéma', () => {
  assert(sourceMigration.includes("feuille: 'FAVORIS'"));
  [
    'ID_FAVORI', 'TYPE', 'IDENTIFIANT', 'LIBELLE',
    'SOUS_LIBELLE', 'UTILISATEUR_CLE', 'DATE_CREATION'
  ].forEach(colonne => assert(sourceMigration.includes("'" + colonne + "'")));
  assert(/version:\s*6[\s\S]*versionSource:\s*5[\s\S]*versionCible:\s*6/.test(
    sourceMigration
  ));
  assert(sourceMigration.includes('migration6Favoris_'));
  assert(sourceMigration.includes('simulerMigration6FavorisModele_'));
});


test('le panneau mobile est plein écran avec des cibles tactiles suffisantes', () => {
  assert(css.includes('@media (max-width: 800px)'));
  assert(css.includes('.panneau-favoris'));
  assert(css.includes('position: fixed'));
  assert(css.includes('inset: 0'));
  assert(css.includes('width: 48px'));
  assert(indexHtml.includes('id="boutonOuvrirFavoris"'));
  assert(indexHtml.includes('id="panneauFavoris"'));
});


test('la version applicative est centralisée à 1.9.4', () => {
  assert(metadonnees.includes(
    "VERSION_APPLICATION_PREPFORMATION_ = '1.9.4'"
  ));
});


let reussis = 0;
tests.forEach(function (cas) {
  try {
    cas.traitement();
    reussis++;
    console.log('✓ ' + cas.nom);
  } catch (erreur) {
    console.error('✗ ' + cas.nom);
    throw erreur;
  }
});

console.log('\n' + reussis + '/' + tests.length + ' tests des favoris réussis.');
