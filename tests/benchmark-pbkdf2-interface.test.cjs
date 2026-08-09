'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const administrationHtml = fs.readFileSync(
  path.join(ROOT, 'Administration.html'),
  'utf8'
);
const sourceInterface = fs.readFileSync(
  path.join(ROOT, 'JavaScript.html'),
  'utf8'
).replace('<script>', '').replace('</script>', '');


class FakeClassList {
  constructor(classes) {
    this.values = new Set(classes || []);
  }

  add(...classes) {
    classes.forEach(value => this.values.add(value));
  }

  remove(...classes) {
    classes.forEach(value => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
}


class FakeElement {
  constructor(id, classes) {
    this.id = id;
    this.classList = new FakeClassList(classes);
    this.className = (classes || []).join(' ');
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.dataset = {};
  }

  focus() {}
}


const elements = {};
function addElement(id, classes) {
  const element = new FakeElement(id, classes);
  elements[id] = element;
  return element;
}

const bouton = addElement(
  'boutonBenchmarkPbkdf2Administration',
  ['bouton-principal']
);
bouton.disabled = true;
bouton.textContent = 'Tester les performances PBKDF2';
const resultat = addElement(
  'resultatBenchmarkPbkdf2Administration',
  ['masque']
);
addElement('toast', []);
addElement('loader', []);
addElement('contenu', []);
addElement('ecranConnexion', ['masque']);
addElement('formulaireConnexionFormateur', []);
addElement('formulairePremiereConnexionFormateur', ['masque']);
addElement('modalAccesAdministrateur', ['masque']);
addElement('motDePasseAdministrateur', []);

const stockage = {};
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
    benchmarkerDerivationMotDePasseFormateur(jeton) {
      appels.push({
        nom: 'benchmarkerDerivationMotDePasseFormateur',
        jeton,
        succes: this.succes,
        echec: this.echec
      });
    },
    getSessionUtilisateur(jeton) {
      appels.push({
        nom: 'getSessionUtilisateur',
        jeton,
        succes: this.succes,
        echec: this.echec
      });
    }
  };
}

const document = {
  body: addElement('body', []),
  addEventListener() {},
  getElementById(id) {
    return elements[id] || null;
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
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
    return Object.prototype.hasOwnProperty.call(stockage, cle)
      ? stockage[cle]
      : null;
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
vm.runInContext(sourceInterface, contexte, {
  filename: 'JavaScript.html'
});


function definirContexteAuthentification(options) {
  stockage['prepformation.jetonAdministration'] =
    options.jetonAdministrateur || '';
  stockage['prepformation.jetonFormateur'] =
    options.jetonFormateur || '';
  contexte.__sessionTest = {
    contexte: options.contexte,
    estAdministrateur: Boolean(options.estAdministrateur),
    estFormateur: Boolean(options.estFormateur),
    droits: {}
  };
  vm.runInContext(
    'etatApplication.sessionUtilisateur = __sessionTest;' +
    'etatApplication.benchmarkPbkdf2AdministrationEnCours = false;',
    contexte
  );
  bouton.disabled = true;
  bouton.textContent = 'Tester les performances PBKDF2';
  resultat.innerHTML = '';
  resultat.className = 'masque';
}


assert(administrationHtml.includes("Sécurité de l'authentification"));
assert(administrationHtml.includes('Tester les performances PBKDF2'));
assert(administrationHtml.includes('data-admin-only="true"'));
assert(/id="boutonBenchmarkPbkdf2Administration"[\s\S]*?disabled/.test(
  administrationHtml
));

definirContexteAuthentification({
  contexte: 'NON_CONNECTE'
});
vm.runInContext(
  'mettreAJourDisponibiliteBenchmarkPbkdf2Administration_(true);',
  contexte
);
assert.strictEqual(bouton.disabled, true);
vm.runInContext('executerBenchmarkPbkdf2Administration();', contexte);
assert.strictEqual(appels.length, 0);

definirContexteAuthentification({
  contexte: 'FORMATEUR',
  estFormateur: true,
  jetonFormateur: 'JETON_FORMATEUR_SEUL'
});
vm.runInContext(
  'mettreAJourDisponibiliteBenchmarkPbkdf2Administration_(true);',
  contexte
);
assert.strictEqual(bouton.disabled, true);
vm.runInContext('executerBenchmarkPbkdf2Administration();', contexte);
assert.strictEqual(appels.length, 0);

definirContexteAuthentification({
  contexte: 'ADMINISTRATEUR',
  estAdministrateur: true,
  jetonAdministrateur: 'JETON_ADMINISTRATION_DIRECTE'
});
vm.runInContext(
  'mettreAJourDisponibiliteBenchmarkPbkdf2Administration_(true);',
  contexte
);
assert.strictEqual(bouton.disabled, false);
vm.runInContext('executerBenchmarkPbkdf2Administration();', contexte);
vm.runInContext('executerBenchmarkPbkdf2Administration();', contexte);
assert.strictEqual(appels.length, 1);
assert.strictEqual(
  appels[0].nom,
  'benchmarkerDerivationMotDePasseFormateur'
);
assert.strictEqual(appels[0].jeton, 'JETON_ADMINISTRATION_DIRECTE');
assert.strictEqual(bouton.disabled, true);
assert.strictEqual(bouton.textContent, 'Benchmark en cours…');
appels.shift().succes({
  500: 108,
  1000: 216,
  1500: 327,
  2000: 438
});
assert.strictEqual(bouton.disabled, false);
assert.strictEqual(bouton.textContent, 'Tester les performances PBKDF2');
assert(resultat.innerHTML.includes('108 ms'));
assert(resultat.innerHTML.includes('216 ms'));
assert(resultat.innerHTML.includes('327 ms'));
assert(resultat.innerHTML.includes('438 ms'));
const resultatNormalise = resultat.innerHTML.replace(/[\u00a0\u202f]/g, ' ');
assert(resultatNormalise.includes('500'));
assert(resultatNormalise.includes('1 000'));
assert(resultatNormalise.includes('1 500'));
assert(resultatNormalise.includes('2 000'));
assert(resultatNormalise.includes('20 000 itérations'));

definirContexteAuthentification({
  contexte: 'FORMATEUR_ADMINISTRATEUR',
  estAdministrateur: true,
  estFormateur: true,
  jetonAdministrateur: 'JETON_ADMIN_ELEVATION',
  jetonFormateur: 'JETON_FORMATEUR_A_NE_PAS_ENVOYER'
});
vm.runInContext('executerBenchmarkPbkdf2Administration();', contexte);
assert.strictEqual(appels.length, 1);
assert.strictEqual(appels[0].jeton, 'JETON_ADMIN_ELEVATION');
appels.shift().succes({
  500: 101,
  1000: 203,
  1500: 304,
  2000: 407
});
assert(resultat.innerHTML.includes('407 ms'));

const debutRenduBenchmark = sourceInterface.indexOf(
  'function afficherResultatsBenchmarkPbkdf2Administration_('
);
const finRenduBenchmark = sourceInterface.indexOf(
  'function afficherErreurBenchmarkPbkdf2Administration_(',
  debutRenduBenchmark
);
const sourceRenduBenchmark = sourceInterface.slice(
  debutRenduBenchmark,
  finRenduBenchmark
);
assert(sourceRenduBenchmark.includes(
  'const iterations = [500, 1000, 1500, 2000];'
));
assert(!sourceRenduBenchmark.includes('[20000, 30000, 50000]'));

definirContexteAuthentification({
  contexte: 'ADMINISTRATEUR',
  estAdministrateur: true,
  jetonAdministrateur: 'JETON_ADMIN_ERREUR'
});
vm.runInContext('executerBenchmarkPbkdf2Administration();', contexte);
assert.strictEqual(appels.length, 1);
appels.shift().echec({
  message: 'Erreur interne PEPPER=secret HASH=secret SEL=secret JETON=secret'
});
assert.strictEqual(bouton.disabled, false);
assert(resultat.innerHTML.includes('n’a pas pu être exécuté'));
assert(!/PEPPER|HASH|SEL=|JETON=|secret/.test(resultat.innerHTML));
assert(!/PEPPER|HASH|SEL=|JETON=|secret/.test(elements.toast.textContent));

definirContexteAuthentification({
  contexte: 'ADMINISTRATEUR',
  estAdministrateur: true,
  jetonAdministrateur: 'JETON_ADMIN_EXPIRE'
});
vm.runInContext('executerBenchmarkPbkdf2Administration();', contexte);
assert.strictEqual(appels.length, 1);
appels.shift().echec({
  message: 'Accès réservé à l’administrateur.'
});
assert.strictEqual(bouton.disabled, true);
assert(resultat.innerHTML.includes('a expiré ou a été verrouillée'));

process.stdout.write(
  '✓ interface PBKDF2 sécurisée, résultats dynamiques et doubles clics bloqués\n'
);
