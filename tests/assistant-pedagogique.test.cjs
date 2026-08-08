'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const sourceInterface = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
).replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
const html = fs.readFileSync(
  path.join(racine, 'AssistantPedagogique.html'),
  'utf8'
);
const indexHtml = fs.readFileSync(path.join(racine, 'Index.html'), 'utf8');
const css = fs.readFileSync(path.join(racine, 'CSS.html'), 'utf8');
const ui = fs.readFileSync(path.join(racine, 'UI.js'), 'utf8');
const securite = fs.readFileSync(
  path.join(racine, 'SecuriteService.js'),
  'utf8'
);
const sourceIndividuelle = fs.readFileSync(
  path.join(racine, 'AnalysePedagogiqueService.js'),
  'utf8'
);
const sourceGroupe = fs.readFileSync(
  path.join(racine, 'AnalyseGroupeService.js'),
  'utf8'
);


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
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    style: {},
    parentElement: null,
    setAttribute: (nom, valeur) => {
      attributs[nom] = String(valeur);
    },
    getAttribute: nom => attributs[nom],
    querySelectorAll: () => [],
    scrollIntoView: () => {}
  }, options || {});
}


function creerRunner(options) {
  const parametres = options || {};
  return {
    appelsAnalyse: [],
    appelsPreparation: 0,
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
    getPreparationAssistantPedagogique() {
      this.appelsPreparation++;
      if (parametres.erreurPreparation) {
        this.echec(new Error(parametres.erreurPreparation));
      } else if (parametres.preparation) {
        this.succes(parametres.preparation);
      }
    },
    getAnalyseGroupe(ids, optionsAnalyse) {
      this.appelsAnalyse.push({ ids: Array.from(ids), optionsAnalyse });
      if (parametres.erreurAnalyse) {
        this.echec(new Error(parametres.erreurAnalyse));
      } else if (parametres.resultat) {
        this.succes(parametres.resultat);
      }
    }
  };
}


function creerContexte(elements, runner) {
  const tableElements = elements || {};
  const document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    getElementById: id => tableElements[id] || null,
    createElement: () => creerElement(),
    body: {
      classList: creerClassList(),
      appendChild: () => {}
    }
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
      setTimeout: traitement => {
        if (typeof traitement === 'function') {
          traitement();
        }
        return 0;
      },
      clearTimeout: () => {},
      confirm: () => true
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    google: {
      script: {
        run: runner || creerRunner()
      }
    }
  };

  vm.createContext(contexte);
  vm.runInContext(sourceInterface, contexte, {
    filename: 'JavaScript.html'
  });
  return contexte;
}


function preparationInterface() {
  return {
    stagiaires: [
      {
        uuid: 'T1', nom: 'Martin', prenom: 'Alice',
        formationId: 'F1', formation: 'EQ PS', statut: 'En préparation'
      },
      {
        uuid: 'T2', nom: 'Bernard', prenom: 'Bruno',
        formationId: 'F2', formation: 'EQ SUAP', statut: 'À préparer'
      },
      {
        uuid: 'T3', nom: 'Martin', prenom: 'Chloé',
        formationId: 'F1', formation: 'EQ PS', statut: 'Stage aujourd’hui'
      }
    ],
    formations: [
      { idFormation: 'F1', libelle: 'EQ PS' },
      { idFormation: 'F2', libelle: 'EQ SUAP' }
    ],
    sessions: [
      {
        idSession: 'S1', date: '2026-08-01', formation: 'EQ PS',
        idsStagiaires: ['T1', 'T3'], nombreStagiaires: 2
      }
    ],
    avertissements: []
  };
}


function priorite(numero, niveau) {
  return {
    rang: numero,
    idItem: 'I' + numero,
    item: 'Item ' + numero,
    categorie: numero % 2 ? 'Gestes' : 'Sécurité',
    niveauPriorite: niveau,
    nombreStagiairesConcernes: 2,
    scoreMoyen: 70 - numero,
    scoreMaximum: 80 - numero,
    nombreJamaisAcquis: 1,
    nombreOublies: 1,
    nombreEchecs: 2,
    ancienneteMoyenne: 40,
    motifs: ['Aucune acquisition validée']
  };
}


function resultatInterface(options) {
  const base = {
    analyseGlobale: {
      nombreStagiaires: 2,
      nombreItemsActifs: 12,
      nombreItemsTravailles: 5,
      nombreItemsAcquis: 3,
      nombreItemsJamaisAcquis: 9,
      homogeneite: 75
    },
    priorites: [
      priorite(1, 'CRITIQUE'),
      priorite(2, 'ELEVEE'),
      priorite(3, 'MODEREE'),
      priorite(4, 'FAIBLE')
    ],
    recommandations: [{
      rang: 1,
      idItem: 'I1',
      item: 'Item 1',
      categorie: 'Gestes',
      score: 69,
      niveau: 'CRITIQUE',
      justification: 'Motifs issus des analyses individuelles.',
      nombreStagiairesConcernes: 2,
      nombreJamaisAcquis: 1,
      nombreOublies: 1,
      nombreEchecs: 2
    }],
    detailsStagiaires: [{
      uuid: 'T1',
      nombreRecommandationsIndividuelles: 3,
      nombreItemsPrioritaires: 5,
      nombrePointsFaibles: 2,
      joursDepuisDerniereSeance: 12
    }],
    statistiques: {
      itemsMaitrisesParToutLeGroupe: [{
        idItem: 'I9', item: 'Bilan', categorie: 'Gestes', scoreMoyen: 5
      }],
      itemsCritiques: [{
        idItem: 'I1', item: 'Item 1', categorie: 'Gestes', scoreMoyen: 69
      }],
      dispersionScores: 18.5,
      moyenneScores: 44.2,
      medianeScores: 42
    },
    meta: {
      calculeA: '2026-08-08T10:00:00.000Z',
      dureeCalculMs: 24
    }
  };
  return Object.assign(base, options || {});
}


function installerEtat(contexte, preparation) {
  const etatApplication = vm.runInContext('etatApplication', contexte);
  etatApplication.pageActive = 'AssistantPedagogique';
  etatApplication.assistantPedagogique = {
    preparation: preparation || preparationInterface(),
    selection: {},
    resultat: null,
    signatureAnalyse: '',
    analyseObsolete: false,
    chargementPreparation: false,
    chargementAnalyse: false,
    generation: 0,
    filtresPriorites: { niveau: 'TOUS', categorie: '' }
  };
  return etatApplication;
}


function elementsAnalyse() {
  const parentHomogeneite = creerElement();
  return {
    boutonAnalyserGroupe: creerElement(),
    compteurSelectionAssistant: creerElement(),
    analyseObsoleteAssistant: creerElement({
      classList: creerClassList(['masque'])
    }),
    chargementAnalyseGroupe: creerElement({
      classList: creerClassList(['masque'])
    }),
    erreurAssistantPedagogique: creerElement({
      classList: creerClassList(['masque'])
    }),
    resultatAssistantPedagogique: creerElement({
      classList: creerClassList(['masque'])
    }),
    metadonneesAssistantPedagogique: creerElement(),
    cartesSyntheseAssistant: creerElement(),
    valeurHomogeneiteAssistant: creerElement(),
    remplissageHomogeneiteAssistant: creerElement({
      parentElement: parentHomogeneite
    }),
    graphiqueRepartitionAssistant: creerElement(),
    categoriePrioriteAssistant: creerElement(),
    niveauPrioriteAssistant: creerElement({ value: 'TOUS' }),
    corpsPrioritesAssistant: creerElement(),
    compteurPrioritesAssistant: creerElement(),
    listeRecommandationsAssistant: creerElement(),
    corpsDetailsStagiairesAssistant: creerElement(),
    listeMaitrisesAssistant: creerElement(),
    listeCritiquesAssistant: creerElement()
  };
}


function tableServeur(entetes, lignes) {
  const index = {};
  entetes.forEach((entete, position) => {
    index[entete] = position;
  });
  return {
    entetes: entetes.slice(),
    index,
    lignes: lignes.map(ligne => ligne.slice())
  };
}


function testerPreparationServeur() {
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
    restaurationBloqueEcritures_: () => false,
    obtenirVersionApplication_: () => '1.9.0'
  };
  vm.createContext(contexte);
  vm.runInContext(sourceIndividuelle, contexte);
  vm.runInContext(sourceGroupe, contexte);

  const tables = {
    STAGIAIRES: tableServeur(
      ['UUID', 'NOM', 'PRENOM', 'FORMATION', 'STATUT'],
      [
        ['T1', 'Martin', 'Alice', 'F1', 'En préparation'],
        ['T2', 'Clos', 'Claude', 'F1', 'Clôturé'],
        ['T3', 'Abandon', 'Anne', 'F1', 'Abandon'],
        ['T4', 'Bernard', 'Bruno', 'F1', 'À préparer']
      ]
    ),
    FORMATIONS: tableServeur(
      ['ID_FORMATION', 'LIBELLE'],
      [['F1', 'EQ PS']]
    ),
    SESSIONS: tableServeur(
      ['ID_SESSION', 'DATE_SESSION', 'FORMATION'],
      [['S1', '2026-08-01', 'F1']]
    ),
    PRESENCES_STAGIAIRES: tableServeur(
      ['ID_SESSION', 'ID_STAGIAIRE'],
      [['S1', 'T1'], ['S1', 'T1'], ['S1', 'T2'], ['S1', 'T4']]
    ),
    CATEGORIES: tableServeur([], []),
    REFERENTIEL: tableServeur([], []),
    ITEMS_SESSIONS: tableServeur([], []),
    EVALUATIONS: tableServeur([], [])
  };
  contexte.lireTablesAnalysePedagogique_ = () => tables;
  return contexte.getPreparationAssistantPedagogique();
}


const tests = [];
function test(nom, traitement) {
  tests.push({ nom, traitement });
}


test('le module est déclaré dans le menu, le routage et les droits formateur', () => {
  assert(indexHtml.includes('data-page="AssistantPedagogique"'));
  assert(indexHtml.includes('Assistant pédagogique'));
  assert(ui.includes("'AssistantPedagogique'"));
  assert(sourceInterface.includes(
    "if (nomPage === 'AssistantPedagogique')"
  ));
  assert(securite.includes('consulterAssistantPedagogique: true'));
  assert(!indexHtml.includes(
    'data-page="AssistantPedagogique" data-admin-only="true"'
  ));
});


test('la préparation serveur exclut clôturés et abandons sans doublon', () => {
  const preparation = testerPreparationServeur();
  assert.deepStrictEqual(
    Array.from(preparation.stagiaires, stagiaire => stagiaire.uuid),
    ['T4', 'T1']
  );
  assert.deepStrictEqual(
    Array.from(preparation.sessions[0].idsStagiaires),
    ['T1', 'T4']
  );
  assert.strictEqual(preparation.sessions[0].nombreStagiaires, 2);
});


test('aucun stagiaire sélectionné bloque l’analyse avec un message clair', () => {
  const elements = elementsAnalyse();
  const runner = creerRunner();
  const c = creerContexte(elements, runner);
  installerEtat(c);
  c.analyserGroupeAssistantPedagogique();
  assert.strictEqual(runner.appelsAnalyse.length, 0);
  assert(elements.erreurAssistantPedagogique.textContent.includes(
    'au moins un stagiaire'
  ));
});


test('un stagiaire déclenche un seul appel avec son identifiant', () => {
  const elements = elementsAnalyse();
  const runner = creerRunner();
  const c = creerContexte(elements, runner);
  const etat = installerEtat(c);
  etat.assistantPedagogique.selection.T1 = true;
  c.analyserGroupeAssistantPedagogique();
  assert.deepStrictEqual(runner.appelsAnalyse[0].ids, ['T1']);
  assert.strictEqual(runner.appelsAnalyse.length, 1);
});


test('plusieurs stagiaires sont triés et les doublons sont impossibles', () => {
  const c = creerContexte(elementsAnalyse(), creerRunner());
  const etat = installerEtat(c);
  etat.assistantPedagogique.selection.T2 = true;
  etat.assistantPedagogique.selection.T1 = true;
  etat.assistantPedagogique.selection.T2 = true;
  assert.deepStrictEqual(
    Array.from(c.obtenirIdsSelectionAssistant_()),
    ['T1', 'T2']
  );
});


test('une séance charge automatiquement ses stagiaires présents', () => {
  const elements = elementsAnalyse();
  elements.sessionSourceAssistant = creerElement({ value: 'S1' });
  elements.listeStagiairesAssistant = creerElement();
  elements.rechercheStagiaireAssistant = creerElement();
  elements.formationStagiaireAssistant = creerElement();
  const c = creerContexte(elements);
  const etat = installerEtat(c);
  c.selectionnerDepuisSessionAssistant();
  assert.deepStrictEqual(
    Array.from(c.obtenirIdsSelectionAssistant_()),
    ['T1', 'T3']
  );
  assert.strictEqual(etat.assistantPedagogique.resultat, null);
});


test('la sélection issue d’une séance reste modifiable', () => {
  const elements = elementsAnalyse();
  elements.sessionSourceAssistant = creerElement({ value: 'S1' });
  elements.listeStagiairesAssistant = creerElement();
  elements.rechercheStagiaireAssistant = creerElement();
  elements.formationStagiaireAssistant = creerElement();
  const c = creerContexte(elements);
  installerEtat(c);
  c.selectionnerDepuisSessionAssistant();
  c.basculerSelectionStagiaireAssistant('T3', false);
  c.basculerSelectionStagiaireAssistant('T2', true);
  assert.deepStrictEqual(
    Array.from(c.obtenirIdsSelectionAssistant_()),
    ['T1', 'T2']
  );
});


test('la recherche et la formation filtrent uniquement la liste locale', () => {
  const elements = elementsAnalyse();
  elements.rechercheStagiaireAssistant = creerElement({ value: 'martin' });
  elements.formationStagiaireAssistant = creerElement({ value: 'F1' });
  const c = creerContexte(elements);
  installerEtat(c);
  assert.deepStrictEqual(
    Array.from(c.obtenirStagiairesFiltresAssistant_(), stagiaire => stagiaire.uuid),
    ['T1', 'T3']
  );
  elements.rechercheStagiaireAssistant.value = 'bruno';
  assert.deepStrictEqual(
    Array.from(c.obtenirStagiairesFiltresAssistant_()),
    []
  );
});


test('les analyses homogène et hétérogène affichent seulement la valeur moteur', () => {
  const elements = elementsAnalyse();
  const c = creerContexte(elements);
  const etat = installerEtat(c);
  etat.assistantPedagogique.resultat = resultatInterface();
  c.afficherSyntheseAssistant_(etat.assistantPedagogique.resultat);
  assert.strictEqual(elements.valeurHomogeneiteAssistant.textContent, '75 %');
  assert(!elements.valeurHomogeneiteAssistant.textContent.includes('bon'));
  etat.assistantPedagogique.resultat.analyseGlobale.homogeneite = 0;
  c.afficherSyntheseAssistant_(etat.assistantPedagogique.resultat);
  assert.strictEqual(elements.valeurHomogeneiteAssistant.textContent, '0 %');
});


test('une absence de recommandation produit un état vide explicite', () => {
  const elements = elementsAnalyse();
  const c = creerContexte(elements);
  c.afficherRecommandationsAssistant_([]);
  assert(elements.listeRecommandationsAssistant.innerHTML.includes(
    'Aucune recommandation'
  ));
});


test('le rendu ne dépasse jamais quinze priorités', () => {
  const elements = elementsAnalyse();
  const c = creerContexte(elements);
  const priorites = Array.from({ length: 22 }, (_, index) =>
    priorite(index + 1, 'ELEVEE')
  );
  c.afficherPrioritesAssistant_(priorites);
  assert.strictEqual(
    (elements.corpsPrioritesAssistant.innerHTML.match(/<tr>/g) || []).length,
    15
  );
});


test('les filtres niveau et catégorie restent entièrement locaux', () => {
  const elements = elementsAnalyse();
  elements.niveauPrioriteAssistant.value = 'CRITIQUE';
  elements.categoriePrioriteAssistant.value = 'Gestes';
  const runner = creerRunner();
  const c = creerContexte(elements, runner);
  const etat = installerEtat(c);
  etat.assistantPedagogique.resultat = resultatInterface();
  c.appliquerFiltresPrioritesAssistant();
  assert(elements.corpsPrioritesAssistant.innerHTML.includes('Item 1'));
  assert(!elements.corpsPrioritesAssistant.innerHTML.includes('Item 2'));
  assert.strictEqual(runner.appelsAnalyse.length, 0);
});


test('le bouton Ouvrir la fiche réutilise consulterStagiaire', () => {
  const c = creerContexte(elementsAnalyse());
  const etat = installerEtat(c);
  let uuidOuvert = '';
  c.consulterStagiaire = uuid => { uuidOuvert = uuid; };
  c.ouvrirFicheStagiaireDepuisAssistant('T1');
  assert.strictEqual(uuidOuvert, 'T1');
  assert(etat.stagiaires.some(stagiaire => stagiaire.uuid === 'T1'));
});


test('une erreur serveur est affichée sans masquer la sélection', () => {
  const elements = elementsAnalyse();
  const runner = creerRunner({ erreurAnalyse: 'Serveur indisponible' });
  const c = creerContexte(elements, runner);
  const etat = installerEtat(c);
  etat.assistantPedagogique.selection.T1 = true;
  c.analyserGroupeAssistantPedagogique();
  assert(elements.erreurAssistantPedagogique.textContent.includes(
    'Serveur indisponible'
  ));
  assert.strictEqual(etat.assistantPedagogique.chargementAnalyse, false);
});


test('une sélection modifiée conserve le résultat et le marque à recalculer', () => {
  const elements = elementsAnalyse();
  elements.listeStagiairesAssistant = creerElement();
  elements.rechercheStagiaireAssistant = creerElement();
  elements.formationStagiaireAssistant = creerElement();
  const c = creerContexte(elements);
  const etat = installerEtat(c);
  etat.assistantPedagogique.selection.T1 = true;
  etat.assistantPedagogique.resultat = resultatInterface();
  etat.assistantPedagogique.signatureAnalyse = 'T1';
  c.basculerSelectionStagiaireAssistant('T2', true);
  assert.strictEqual(etat.assistantPedagogique.analyseObsolete, true);
  assert(etat.assistantPedagogique.resultat);
  assert(!elements.analyseObsoleteAssistant.classList.contains('masque'));
});


test('un résultat à jour empêche un second appel serveur', () => {
  const elements = elementsAnalyse();
  const resultat = resultatInterface();
  const runner = creerRunner({ resultat });
  const c = creerContexte(elements, runner);
  const etat = installerEtat(c);
  etat.assistantPedagogique.selection.T1 = true;
  c.analyserGroupeAssistantPedagogique();
  c.analyserGroupeAssistantPedagogique();
  assert.strictEqual(runner.appelsAnalyse.length, 1);
});


test('les données individuelles et les motifs viennent du moteur de groupe', () => {
  assert(sourceGroupe.includes('detailsStagiaires: analyses.map'));
  assert(sourceGroupe.includes('niveauPriorite: choisirNiveauRecommandationGroupe_'));
  assert(sourceGroupe.includes('motifs: motifs.map'));
  assert(sourceGroupe.includes('nombreJamaisAcquis: priorite.nombreJamaisAcquis'));
  assert(html.includes('Détail par stagiaire'));
  assert(html.includes('Items maîtrisés par le groupe'));
  assert(html.includes('Items critiques'));
});


test('la mise en page est responsive et tactile sans dépendance externe', () => {
  const section = css.slice(css.indexOf('ASSISTANT PÉDAGOGIQUE DE GROUPE'));
  assert(section.includes('@media (max-width: 760px)'));
  assert(section.includes('grid-template-columns: 1fr'));
  assert(section.includes('min-height: 46px'));
  assert(section.includes('overflow-x: auto'));
  assert(html.includes('navigation-rapide-assistant'));
  assert(!section.includes('@import'));
  assert(!html.includes('<script src='));
});


test('le module ne contient aucune écriture métier, migration ou accès sensible', () => {
  const debutClient = sourceInterface.indexOf(
    'function initialiserPageAssistantPedagogique'
  );
  const finClient = sourceInterface.indexOf(
    '/* =====================================================\n   STATISTIQUES',
    debutClient
  );
  const client = sourceInterface.slice(debutClient, finClient);
  const debutPreparation = sourceGroupe.indexOf(
    'function getPreparationAssistantPedagogique'
  );
  const finPreparation = sourceGroupe.indexOf(
    'function getAnalyseGroupe',
    debutPreparation
  );
  const serveur = sourceGroupe.slice(debutPreparation, finPreparation);

  assert.strictEqual(
    (client.match(/\.getAnalyseGroupe\s*\(/g) || []).length,
    1
  );
  assert(!/\.setValue|\.setValues|appendRow|insertSheet|deleteSheet/.test(
    serveur
  ));
  assert(!/executerMigrations|executerMutationMetier_/.test(serveur));
  assert(!/DriveApp|MailApp|GmailApp|PropertiesService/.test(
    client + serveur
  ));
  assert(!client.includes('.enregistrer'));
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
  ' tests de l’assistant pédagogique réussis.\n'
);
