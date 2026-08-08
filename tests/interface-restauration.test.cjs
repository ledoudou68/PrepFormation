'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

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
    this.dataset = {};
    this.attributes = new Map();
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.onclick = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value ?? ''));
    if (name === 'disabled') this.disabled = true;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'disabled') this.disabled = false;
    if (name === 'onclick') this.onclick = null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  click() {
    if (!this.disabled && typeof this.onclick === 'function') {
      this.onclick({ preventDefault() {} });
    }
  }
}

function createRunner(pending) {
  return {
    success: null,
    failure: null,
    withSuccessHandler(handler) {
      this.success = handler;
      return this;
    },
    withFailureHandler(handler) {
      this.failure = handler;
      return this;
    },
    getEtatRestaurationAdministration() {
      pending.push({ success: this.success, failure: this.failure });
    },
    getFavoris() {
      this.success([]);
    }
  };
}

const elements = {};
function addElement(id, classes) {
  const element = new FakeElement(id, classes);
  elements[id] = element;
  return element;
}

const boutonFinal = addElement(
  'boutonConfirmerRestaurationAdministration',
  ['bouton-danger', 'restauration-en-cours']
);
boutonFinal.textContent = 'Restauration en cours…';
boutonFinal.setAttribute('disabled', '');
boutonFinal.dataset.etaitDesactiveRestauration = 'true';

const boutonCroix = addElement(
  'boutonFermerModalPreparationRestauration',
  ['bouton-fermer-modal']
);
boutonCroix.disabled = true;
const boutonAnnuler = addElement(
  'boutonAnnulerPreparationRestauration',
  ['bouton-secondaire']
);
boutonAnnuler.disabled = true;
const modal = addElement('modalPreparationRestaurationAdministration', []);
addElement('contenuPreparationRestaurationAdministration', []);
addElement('confirmationRestaurationAdministration', []);
addElement('etatRestaurationAdministration', []);
addElement('motDePasseConfirmationRestauration', []);

const pending = [];
let clearedInterval = null;
const document = {
  body: addElement('body', []),
  addEventListener() {},
  getElementById(id) {
    return elements[id] || null;
  },
  querySelectorAll(selector) {
    if (selector === '.menu-item') return [];
    if (selector.includes('modalPreparationRestaurationAdministration')) {
      return [boutonFinal, boutonCroix, boutonAnnuler];
    }
    return [];
  }
};
const window = {
  setInterval() { return 77; },
  clearInterval(id) { clearedInterval = id; },
  setTimeout() { return 1; },
  clearTimeout() {},
  confirm() { return true; }
};
const google = {};
Object.defineProperty(google, 'script', {
  value: {}
});
Object.defineProperty(google.script, 'run', {
  get() {
    return createRunner(pending);
  }
});

const context = vm.createContext({
  console,
  document,
  window,
  google,
  sessionStorage: {
    getItem() { return ''; },
    setItem() {},
    removeItem() {}
  },
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

const source = fs.readFileSync(
  path.join(ROOT, 'JavaScript.html'),
  'utf8'
).replace('<script>', '').replace('</script>', '');
vm.runInContext(source, context, { filename: 'JavaScript.html' });

vm.runInContext(`
  etatApplication.restaurationAdministration = {
    operationActive: {
      etape: 'FINALISATION',
      statut: 'EN_COURS',
      progression: 95,
      backupId: 'backup-test'
    },
    derniereOperation: null
  };
  etatApplication.minuterieProgressionRestauration = 77;
  etatApplication.generationSuiviRestauration = 10;
`, context);

vm.runInContext(
  'actualiserEtatRestaurationAdministration_(true, 10);',
  context
);
vm.runInContext(
  'actualiserEtatRestaurationAdministration_(true, 10);',
  context
);
assert.strictEqual(pending.length, 2);

pending[0].success({
  operationActive: null,
  derniereOperation: {
    statut: 'TERMINEE',
    etape: 'TERMINEE',
    progression: 100,
    backupId: 'backup-test'
  },
  ecrituresBloquees: false
});

assert.strictEqual(clearedInterval, 77);
assert.strictEqual(boutonFinal.hasAttribute('disabled'), false);
assert.strictEqual(boutonFinal.disabled, false);
assert.strictEqual(boutonFinal.textContent, 'Fermer');
assert.strictEqual(boutonFinal.classList.contains('bouton-danger'), false);
assert.strictEqual(
  boutonFinal.classList.contains('restauration-en-cours'),
  false
);
assert.strictEqual(boutonFinal.classList.contains('bouton-principal'), true);
assert.strictEqual(typeof boutonFinal.onclick, 'function');

pending[1].success({
  operationActive: {
    etape: 'FINALISATION',
    statut: 'EN_COURS',
    progression: 95,
    backupId: 'backup-test'
  },
  derniereOperation: null,
  ecrituresBloquees: true
});

assert.strictEqual(boutonFinal.disabled, false);
assert.strictEqual(boutonFinal.textContent, 'Fermer');
assert.strictEqual(boutonFinal.classList.contains('bouton-principal'), true);

let inventairesActualises = 0;
let etatsActualises = 0;
context.__inventaire = () => { inventairesActualises++; };
context.__etat = () => { etatsActualises++; };
vm.runInContext(`
  actualiserInventaireSauvegardesAdministration = __inventaire;
  actualiserEtatRestaurationAdministration_ = __etat;
`, context);

boutonFinal.click();

assert.strictEqual(modal.classList.contains('masque'), true);
assert.strictEqual(inventairesActualises, 1);
assert.strictEqual(etatsActualises, 1);

process.stdout.write('✓ bouton final actif et polling tardif neutralisé\n');
