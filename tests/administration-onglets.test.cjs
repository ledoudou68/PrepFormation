'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(
  path.join(ROOT, 'Administration.html'),
  'utf8'
);
const css = fs.readFileSync(path.join(ROOT, 'CSS.html'), 'utf8');
const serveur = fs.readFileSync(
  path.join(ROOT, 'AdministrationService.js'),
  'utf8'
);
const source = fs.readFileSync(
  path.join(ROOT, 'JavaScript.html'),
  'utf8'
).replace('<script>', '').replace('</script>', '');

class FakeClassList {
  constructor(classes) {
    this.values = new Set(classes || []);
  }

  add(...classes) {
    classes.forEach(classe => this.values.add(classe));
  }

  remove(...classes) {
    classes.forEach(classe => this.values.delete(classe));
  }

  contains(classe) {
    return this.values.has(classe);
  }

  toggle(classe, force) {
    if (force === true) this.values.add(classe);
    else if (force === false) this.values.delete(classe);
    else if (this.values.has(classe)) this.values.delete(classe);
    else this.values.add(classe);
  }
}

class FakeElement {
  constructor(id, classes) {
    this.id = id;
    this.classList = new FakeClassList(classes);
    this.className = (classes || []).join(' ');
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.listeners = {};
  }

  appendChild(enfant) {
    this.children.push(enfant);
    return enfant;
  }

  addEventListener(type, traitement) {
    this.listeners[type] = traitement;
  }

  setAttribute(nom, valeur) {
    this.attributes.set(nom, String(valeur));
  }

  getAttribute(nom) {
    return this.attributes.get(nom);
  }

  removeAttribute(nom) {
    this.attributes.delete(nom);
  }

  focus() {
    document.activeElement = this;
  }

  scrollIntoView() {}
}

const elements = {};
function ajouterElement(id, classes) {
  const element = new FakeElement(id, classes);
  elements[id] = element;
  return element;
}

const identifiants = [
  'general',
  'configuration',
  'securite',
  'sauvegardes',
  'diagnostic',
  'maintenance'
];
const onglets = identifiants.map(identifiant => {
  const element = ajouterElement(
    'onglet-' + identifiant,
    identifiant === 'general' ? ['actif'] : []
  );
  element.dataset.ongletAdministration = identifiant;
  return element;
});
const panneaux = identifiants.map(identifiant => {
  const element = ajouterElement('panneau-' + identifiant, []);
  element.dataset.panneauAdministration = identifiant;
  element.hidden = identifiant !== 'general';
  return element;
});

identifiants.forEach(identifiant => {
  ajouterElement(
    'etatOngletAdministration' +
      identifiant.charAt(0).toUpperCase() + identifiant.slice(1),
    []
  );
});
ajouterElement('navigationOngletsAdministration', []);
ajouterElement('conteneurFormationsAdministration', []);
const sectionFormations = ajouterElement('sectionFormationsAdministration', []);
sectionFormations.hidden = true;
ajouterElement('boutonBenchmarkPbkdf2Administration', []);
ajouterElement('etatRestaurationGlobaleAdministration', []);

const appels = [];
function creerAppelServeur() {
  return {
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
    enregistrer(nom, args) {
      appels.push({
        nom,
        args: Array.from(args),
        succes: this.succes,
        echec: this.echec
      });
    },
    getEtatRestaurationAdministration() {
      this.enregistrer('getEtatRestaurationAdministration', arguments);
    },
    getConfigurationMetierAdministration() {
      this.enregistrer('getConfigurationMetierAdministration', arguments);
    },
    getEtatSauvegardesAdministration() {
      this.enregistrer('getEtatSauvegardesAdministration', arguments);
    },
    listerSauvegardesRestaurabilite() {
      this.enregistrer('listerSauvegardesRestaurabilite', arguments);
    },
    getConfigurationSauvegardesAutomatiques() {
      this.enregistrer('getConfigurationSauvegardesAutomatiques', arguments);
    },
    verifierIntegriteBase() {
      this.enregistrer('verifierIntegriteBase', arguments);
    }
  };
}

const stockage = {
  'prepformation.jetonAdministration': 'JETON_ADMIN_TEST'
};
const document = {
  activeElement: null,
  body: ajouterElement('body', []),
  addEventListener() {},
  getElementById(id) {
    return elements[id] || null;
  },
  querySelectorAll(selecteur) {
    if (selecteur.includes('data-onglet-administration')) return onglets;
    if (selecteur === '[data-panneau-administration]') return panneaux;
    return [];
  }
};
const window = {
  setTimeout() { return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {}
};
const google = { script: {} };
Object.defineProperty(google.script, 'run', {
  get() {
    return creerAppelServeur();
  }
});
const sessionStorage = {
  getItem(cle) {
    return stockage[cle] || '';
  },
  setItem(cle, valeur) {
    stockage[cle] = String(valeur);
  },
  removeItem(cle) {
    delete stockage[cle];
  }
};

const contexte = vm.createContext({
  console,
  document,
  window,
  google,
  sessionStorage,
  Date,
  JSON,
  Math,
  Number,
  String,
  Boolean,
  Object,
  Array,
  Set,
  Map,
  Error,
  TypeError
});
vm.runInContext(source, contexte, { filename: 'JavaScript.html' });

let rendusConfiguration = 0;
let rendusDiagnostic = 0;
let dernierEtatRestauration = null;
contexte.__session = {
  contexte: 'ADMINISTRATION_DIRECTE',
  estAdministrateur: true,
  identifiantSessionAdministration: 'ADMIN-TEST',
  expirationSessionAdministration: new Date(Date.now() + 60000).toISOString()
};
contexte.__renduConfiguration = () => { rendusConfiguration++; };
contexte.__renduDiagnostic = () => { rendusDiagnostic++; };
contexte.__renduRestauration = etat => { dernierEtatRestauration = etat; };
vm.runInContext(`
  etatApplication.pageActive = 'Administration';
  etatApplication.sessionUtilisateur = __session;
  afficherDiagnosticAdministration = function () {};
  afficherDiagnosticConnexionAdministration_ = function () {};
  mettreAJourDisponibiliteBenchmarkPbkdf2Administration_ = function () {};
  afficherParametresEmailIndemnisationAdministration = __renduConfiguration;
  afficherFormationsAdministration = __renduConfiguration;
  afficherSauvegardesAdministration = function () {};
  afficherInventaireSauvegardesAdministration = function () {};
  afficherPlanificationSauvegardesAdministration = function () {};
  afficherEtatRestaurationAdministration = __renduRestauration;
  afficherDiagnosticBaseAdministration = __renduDiagnostic;
  reappliquerBlocageRestaurationAdministration_ = function () {};
  extraireMessageErreur = function (erreur) {
    return erreur && erreur.message || String(erreur);
  };
`, contexte);

function extraireFonction(nom, nomSuivant) {
  const debut = source.indexOf('function ' + nom + '(');
  const fin = source.indexOf('function ' + nomSuivant + '(', debut + 1);
  assert(debut >= 0 && fin > debut, `Fonction ${nom} introuvable`);
  return source.slice(debut, fin);
}

assert.equal((html.match(/role="tab"/g) || []).length, 6);
assert.equal((html.match(/role="tabpanel"/g) || []).length, 6);
assert(/id="panneauAdministrationGeneral"[\s\S]*?role="tabpanel"/.test(html));
assert(!/id="panneauAdministrationGeneral"[\s\S]{0,250}?hidden/.test(html));
[
  'Configuration',
  'Securite',
  'Sauvegardes',
  'Diagnostic',
  'Maintenance'
].forEach(nom => {
  assert(new RegExp(
    `id="panneauAdministration${nom}"[\\s\\S]{0,300}?hidden`
  ).test(html));
});
assert(html.includes('aria-selected="true"'));
assert(html.includes('aria-controls="panneauAdministrationGeneral"'));
assert(css.includes('.navigation-onglets-administration'));
assert(css.includes('overflow-x: auto'));
assert(css.includes('scroll-snap-type: x proximity'));

const initialisation = extraireFonction(
  'initialiserPageAdministration',
  'creerEtatPanneauAdministration_'
);
assert(!initialisation.includes('getDonneesAdministration'));
assert(!initialisation.includes('verifierIntegriteBase'));
assert(!initialisation.includes('listerSauvegardesRestaurabilite'));
assert(!initialisation.includes('getConfigurationMetierAdministration'));
assert(initialisation.includes('chargerEtatRestaurationInitialAdministration_'));
assert(!serveur.includes('function getDonneesAdministration('));
const debutConfigurationServeur = serveur.indexOf(
  'function getConfigurationMetierAdministration('
);
const finConfigurationServeur = serveur.indexOf(
  'function enregistrerParametresEmailIndemnisationAdministration(',
  debutConfigurationServeur
);
const configurationServeur = serveur.slice(
  debutConfigurationServeur,
  finConfigurationServeur
);
assert(configurationServeur.includes('exigerAdministrateur_('));
assert(
  configurationServeur.indexOf('exigerAdministrateur_(') <
  configurationServeur.indexOf('lireFormationsAdministration_(')
);

vm.runInContext('initialiserPageAdministration();', contexte);
assert.equal(appels.length, 1);
assert.equal(appels[0].nom, 'getEtatRestaurationAdministration');
assert.equal(
  vm.runInContext('etatApplication.ongletsAdministration.actif', contexte),
  'general'
);
assert.equal(panneaux[0].hidden, false);
panneaux.slice(1).forEach(panneau => assert.equal(panneau.hidden, true));
appels.shift().succes({
  operationActive: {
    statut: 'RECUPERATION_REQUISE',
    etape: 'ROLLBACK',
    progression: 70
  },
  restaurationInterrompue: true
});
assert(dernierEtatRestauration.operationActive);

vm.runInContext("activerOngletAdministration('configuration');", contexte);
assert.equal(appels.length, 1);
assert.equal(appels[0].nom, 'getConfigurationMetierAdministration');
vm.runInContext("activerOngletAdministration('configuration');", contexte);
assert.equal(appels.length, 1, 'un double clic ne doit pas relancer');
appels.shift().succes({
  formations: [],
  parametresIndemnisation: {}
});
assert.equal(rendusConfiguration, 2);
vm.runInContext("activerOngletAdministration('general');", contexte);
vm.runInContext("activerOngletAdministration('configuration');", contexte);
assert.equal(appels.length, 0, 'un panneau chargé doit rester en mémoire');
vm.runInContext("actualiserOngletAdministration('configuration');", contexte);
assert.equal(appels.length, 1, 'Actualiser doit forcer une nouvelle lecture');
appels.shift().echec({ message: 'Erreur configuration isolée' });
assert.equal(
  elements.etatOngletAdministrationConfiguration.dataset.statut,
  'erreur'
);
assert.equal(
  vm.runInContext(
    'etatApplication.ongletsAdministration.panneaux.sauvegardes.erreur',
    contexte
  ),
  ''
);

vm.runInContext("activerOngletAdministration('diagnostic');", contexte);
assert.equal(appels.length, 1);
const diagnosticTardif = appels.shift();
vm.runInContext("etatApplication.pageActive = 'Accueil';", contexte);
diagnosticTardif.succes({ resume: { conforme: true } });
assert.equal(rendusDiagnostic, 0, 'une réponse tardive ne doit rien rendre');
vm.runInContext("etatApplication.pageActive = 'Administration';", contexte);

vm.runInContext("activerOngletAdministration('sauvegardes');", contexte);
assert.deepEqual(
  appels.map(appel => appel.nom).sort(),
  [
    'getConfigurationSauvegardesAutomatiques',
    'getEtatRestaurationAdministration',
    'getEtatSauvegardesAdministration',
    'listerSauvegardesRestaurabilite'
  ].sort()
);
vm.runInContext("activerOngletAdministration('sauvegardes');", contexte);
assert.equal(appels.length, 4, 'double clic Sauvegardes sans doublon');
appels.splice(0).forEach(appel => appel.succes({}));
assert.equal(
  vm.runInContext(
    'etatApplication.ongletsAdministration.panneaux.sauvegardes.charge',
    contexte
  ),
  true
);
vm.runInContext("activerOngletAdministration('general');", contexte);
vm.runInContext("activerOngletAdministration('sauvegardes');", contexte);
assert.equal(appels.length, 0);
vm.runInContext("actualiserOngletAdministration('sauvegardes');", contexte);
assert.equal(appels.length, 4);
appels.splice(0).forEach(appel => appel.succes({}));

document.activeElement = onglets[0];
let clavierBloque = false;
contexte.__evenementClavier = {
  key: 'ArrowRight',
  preventDefault() { clavierBloque = true; }
};
vm.runInContext(
  'gererClavierOngletsAdministration_(__evenementClavier);',
  contexte
);
assert.equal(clavierBloque, true);
assert.equal(document.activeElement, onglets[1]);
assert.equal(onglets[1].getAttribute('aria-selected'), 'true');

assert(source.includes("invaliderOngletAdministration_('configuration')"));
assert(source.includes('invaliderPanneauxAdministrationApresOperationMajeure_();'));
assert(source.includes("chargerSauvegardesAdministration_(true);"));
assert(!source.includes('.getDonneesAdministration(\n      obtenirJetonAdministrateurApplication()'));

process.stdout.write(
  '✓ Administration à six onglets, chargement différé et réponses obsolètes ignorées\n'
);
