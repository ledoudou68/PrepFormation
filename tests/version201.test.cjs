'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.resolve(__dirname, '..');
const stagiairesHtml = fs.readFileSync(
  path.join(racine, 'Stagiaires.html'),
  'utf8'
);
const sessionsHtml = fs.readFileSync(
  path.join(racine, 'Sessions.html'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(racine, 'CSS.html'),
  'utf8'
);
const sessionsService = fs.readFileSync(
  path.join(racine, 'SessionsService.js'),
  'utf8'
);
const metadata = fs.readFileSync(
  path.join(racine, 'ApplicationMetadataService.js'),
  'utf8'
);
const sourceClient = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
).replace('<script>', '').replace('</script>', '');

function decoderAttributHtml(valeur) {
  return String(valeur || '')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

const optionsFiltreStatuts = {
  contenu: '',
  set innerHTML(valeur) {
    this.contenu = String(valeur || '');
    champsStatuts = Array.from(
      this.contenu.matchAll(/<input([\s\S]*?)>/g),
      correspondance => {
        const attributs = correspondance[1];
        const valeur = attributs.match(/value="([^"]*)"/);
        return {
          value: decoderAttributHtml(valeur ? valeur[1] : ''),
          checked: /\bchecked\b/.test(attributs)
        };
      }
    );
  },
  get innerHTML() {
    return this.contenu;
  }
};

const elements = {
  resumeFiltreStatutsStagiaire: { textContent: '' },
  filtreStatutStagiaire: { open: true },
  optionsFiltreStatutsStagiaire: optionsFiltreStatuts,
  afficherStagiairesInactifsSession: { checked: true },
  sessionFormation: { value: 'SUAP' },
  listeStagiairesSession: { innerHTML: '' }
};
let champsStatuts = [];
let champsStagiairesSession = [];

const document = {
  body: { classList: { add() {}, remove() {} } },
  addEventListener() {},
  getElementById(id) {
    return elements[id] || null;
  },
  querySelector() {
    return null;
  },
  querySelectorAll(selecteur) {
    if (selecteur === 'input[name="filtreStatutStagiaire"]') {
      return champsStatuts;
    }
    if (selecteur === 'input[name="filtreStatutStagiaire"]:checked') {
      return champsStatuts.filter(champ => champ.checked);
    }
    if (selecteur === 'input[name="stagiaireSession"]:checked') {
      return champsStagiairesSession.filter(champ => champ.checked);
    }
    if (selecteur === '.referentiel-stagiaire-session') {
      return [];
    }
    return [];
  },
  createElement() {
    return {
      appendChild() {},
      options: [],
      value: '',
      textContent: ''
    };
  }
};

const contexte = vm.createContext({
  console,
  document,
  window: {
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    alert() {},
    confirm() { return true; }
  },
  google: { script: {} },
  sessionStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  localStorage: {
    getItem() { return null; },
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
  TypeError,
  Intl
});
vm.runInContext(sourceClient, contexte, {
  filename: 'JavaScript.html'
});

const statuts = [
  'À préparer',
  'En préparation',
  "Stage aujourd'hui",
  'Stage passé',
  'Clôturé',
  'Abandon'
];
const stagiaires = [
  { uuid: 'S1', nom: 'Martin', prenom: 'Léa', formation: 'SUAP', statut: 'À préparer' },
  { uuid: 'S2', nom: 'Durand', prenom: 'Noé', formation: 'SUAP', statut: 'En préparation' },
  { uuid: 'S3', nom: 'Petit', prenom: 'Zoé', formation: 'PS', statut: "Stage aujourd'hui" },
  { uuid: 'S4', nom: 'Bernard', prenom: 'Luc', formation: 'PS', statut: 'Stage passé' },
  { uuid: 'S5', nom: 'Robert', prenom: 'Mia', formation: 'SUAP', statut: 'Clôturé' },
  { uuid: 'S6', nom: 'Richard', prenom: 'Eli', formation: 'SUAP', statut: 'Abandon' }
];

function ids(liste) {
  return Array.from(liste, element => element.uuid);
}

function filtrer(recherche, formation, selection) {
  return contexte.filtrerStagiairesSelonCriteres_(
    stagiaires,
    recherche || '',
    formation || '',
    selection || []
  );
}

function candidats(options) {
  return contexte.filtrerStagiairesDisponiblesSession_(
    stagiaires,
    options.formation || 'SUAP',
    Boolean(options.afficherInactifs),
    options.historiques || {},
    new Set(options.selectionnes || [])
  );
}

const tests = [];
function test(nom, traitement) {
  tests.push({ nom, traitement });
}

test('le filtre utilise un popover compact à cases à cocher', () => {
  assert(stagiairesHtml.includes('class="filtre-multi-statut"'));
  assert(stagiairesHtml.includes('optionsFiltreStatutsStagiaire'));
  assert(stagiairesHtml.includes('Tous les statuts'));
  assert(!/<select[^>]*multiple/i.test(stagiairesHtml));
});

test('l’ouverture Stagiaires coche exactement les trois statuts par défaut', () => {
  vm.runInContext(
    'etatApplication.statutsStagiaires = ' + JSON.stringify(statuts),
    contexte
  );
  contexte.remplirFiltreStatutsStagiaires_();

  assert.deepStrictEqual(
    champsStatuts.filter(champ => champ.checked).map(champ => champ.value),
    ['À préparer', 'En préparation', "Stage aujourd'hui"]
  );
  assert.strictEqual(champsStatuts[3].checked, false);
  assert.strictEqual(champsStatuts[4].checked, false);
  assert.strictEqual(champsStatuts[5].checked, false);
  assert.strictEqual(
    elements.resumeFiltreStatutsStagiaire.textContent,
    'Statuts : 3 sélectionnés'
  );
});

test('le filtrage initial utilise uniquement les trois statuts par défaut', () => {
  const selection = contexte.obtenirStatutsStagiairesParDefaut_();
  assert.deepStrictEqual(ids(filtrer('', '', selection)), ['S1', 'S2', 'S3']);
});

test('recherche et formation se combinent avec les statuts par défaut', () => {
  const selection = contexte.obtenirStatutsStagiairesParDefaut_();
  assert.deepStrictEqual(ids(filtrer('zoe', '', selection)), ['S3']);
  assert.deepStrictEqual(ids(filtrer('', 'SUAP', selection)), ['S1', 'S2']);
});

test('un résultat initial vide ne bascule jamais automatiquement sur Tous', () => {
  const uniquementAnciens = stagiaires.slice(3);
  assert.deepStrictEqual(
    ids(contexte.filtrerStagiairesSelonCriteres_(
      uniquementAnciens,
      '',
      '',
      contexte.obtenirStatutsStagiairesParDefaut_()
    )),
    []
  );
});

test('un seul statut filtre exactement la liste', () => {
  assert.deepStrictEqual(ids(filtrer('', '', ['Abandon'])), ['S6']);
});

test('deux statuts sont combinés en union', () => {
  assert.deepStrictEqual(
    ids(filtrer('', '', ['À préparer', 'En préparation'])),
    ['S1', 'S2']
  );
});

test('tous les statuts affichent toute la liste', () => {
  assert.deepStrictEqual(ids(filtrer('', '', statuts)), ids(stagiaires));
});

test('aucun statut sélectionné signifie explicitement Tous', () => {
  assert.deepStrictEqual(ids(filtrer('', '', [])), ids(stagiaires));
});

test('recherche, formation et union de statuts se combinent en ET', () => {
  assert.deepStrictEqual(
    ids(filtrer('lea', 'SUAP', ['À préparer', 'En préparation'])),
    ['S1']
  );
  assert.deepStrictEqual(
    ids(filtrer('', 'SUAP', ['À préparer', 'En préparation'])),
    ['S1', 'S2']
  );
});

test('Abandon, Clôturé et leur union restent sélectionnables', () => {
  assert.deepStrictEqual(ids(filtrer('', '', ['Abandon'])), ['S6']);
  assert.deepStrictEqual(ids(filtrer('', '', ['Clôturé'])), ['S5']);
  assert.deepStrictEqual(
    ids(filtrer('', '', ['Abandon', 'Clôturé'])),
    ['S5', 'S6']
  );
});

test('le changement dynamique actualise le résumé et la liste', () => {
  champsStatuts = [
    { value: 'À préparer', checked: true },
    { value: 'En préparation', checked: true }
  ];
  let actualisations = 0;
  contexte.filtrerStagiaires = () => { actualisations++; };
  vm.runInContext(
    'etatApplication.statutsStagiaires = ' + JSON.stringify(statuts),
    contexte
  );
  contexte.changerFiltreStatutsStagiaires();
  assert.strictEqual(
    elements.resumeFiltreStatutsStagiaire.textContent,
    'À préparer · En préparation'
  );
  assert.strictEqual(actualisations, 1);
});

test('un retour sur Stagiaires réapplique les trois valeurs par défaut', () => {
  champsStatuts.forEach(function (champ) {
    champ.checked = champ.value === 'Abandon';
  });
  contexte.remplirFiltreStatutsStagiaires_();
  assert.deepStrictEqual(
    champsStatuts.filter(champ => champ.checked).map(champ => champ.value),
    ['À préparer', 'En préparation', "Stage aujourd'hui"]
  );
});

test('Tous décoche les statuts, ferme le popover et actualise', () => {
  champsStatuts.forEach(champ => { champ.checked = true; });
  elements.filtreStatutStagiaire.open = true;
  contexte.reinitialiserFiltreStatutsStagiaires();
  assert(champsStatuts.every(champ => !champ.checked));
  assert.strictEqual(elements.filtreStatutStagiaire.open, false);
  assert.strictEqual(
    elements.resumeFiltreStatutsStagiaire.textContent,
    'Statuts : Tous'
  );
});

test('le filtre est adapté au desktop, à l’iPhone et à l’iPad', () => {
  assert(/\.panneau-filtre-multi-statut\s*\{[\s\S]*?position:\s*absolute/.test(css));
  assert(/@media \(max-width: 700px\)[\s\S]*?\.panneau-filtre-multi-statut\s*\{[\s\S]*?position:\s*static/.test(css));
  assert(css.includes('@media (max-width: 900px)'));
  assert(/\.option-filtre-statut\s*\{[\s\S]*?min-height:\s*44px/.test(css));
});

test('une nouvelle ouverture masque Abandon et Clôturé par défaut', () => {
  assert.deepStrictEqual(ids(candidats({})), ['S1', 'S2']);
});

test('tous les autres statuts restent proposés par défaut', () => {
  assert.deepStrictEqual(
    ids(candidats({ formation: 'PS' })),
    ['S3', 'S4']
  );
});

test('Afficher les stagiaires inactifs rétablit Abandon et Clôturé', () => {
  assert.deepStrictEqual(
    ids(candidats({ afficherInactifs: true })),
    ['S1', 'S2', 'S5', 'S6']
  );
});

test('l’option des inactifs est explicite, décochée et tactile', () => {
  assert(sessionsHtml.includes('id="afficherStagiairesInactifsSession"'));
  assert(sessionsHtml.includes('Afficher les stagiaires inactifs'));
  assert(!/id="afficherStagiairesInactifsSession"[^>]*checked/.test(sessionsHtml));
  assert(/\.option-affichage-inactifs-session\s*\{[\s\S]*?min-height:\s*44px/.test(css));
});

test('chaque nouvelle ouverture réinitialise explicitement l’option', () => {
  elements.afficherStagiairesInactifsSession.checked = true;
  contexte.reinitialiserEtatFormulaireSession();
  assert.strictEqual(
    elements.afficherStagiairesInactifsSession.checked,
    false
  );
});

test('un participant historique Abandon ou Clôturé reste visible', () => {
  assert.deepStrictEqual(
    ids(candidats({ historiques: { S5: true, S6: true } })),
    ['S1', 'S2', 'S5', 'S6']
  );
});

test('un inactif volontairement sélectionné ne disparaît pas au masquage', () => {
  assert.deepStrictEqual(
    ids(candidats({ selectionnes: ['S6'] })),
    ['S1', 'S2', 'S6']
  );
  assert.deepStrictEqual(ids(candidats({ selectionnes: [] })), ['S1', 'S2']);
});

test('le retrait volontaire d’un inactif non historique le masque à nouveau', () => {
  const champ = { value: 'S6', checked: false };
  champsStagiairesSession = [champ];
  elements.afficherStagiairesInactifsSession.checked = false;
  vm.runInContext(
    'etatApplication.stagiairesSession = ' + JSON.stringify(stagiaires) + ';' +
    'etatApplication.idsStagiairesHistoriquesSession = {};' +
    'etatApplication.confirmationsStagiairesFermesSession = { S6: true };',
    contexte
  );
  contexte.changerStagiairesSession(champ);
  assert(!elements.listeStagiairesSession.innerHTML.includes('S6'));
});

test('le statut inactif est identifié visuellement', () => {
  assert(css.includes('.statut-participant-inactif-session'));
  assert(sourceClient.includes('Déjà présent · '));
  assert(sourceClient.includes('statut-participant-inactif-session'));
});

test('édition et duplication conservent la sélection historique', () => {
  assert(/preparerOptionsHistoriquesSession\(session\);[\s\S]*?afficherStagiairesSession\(\);[\s\S]*?selectionnerParticipantsSession\(/.test(
    sourceClient
  ));
  assert(/mode === 'duplication'[\s\S]*?dateDuJourPourChamp\(\)/.test(sourceClient));
  assert(/\(session\.stagiaires \|\| \[\]\)\.map/.test(sourceClient));
});

test('la sauvegarde conserve les participants cochés et les protections serveur', () => {
  assert(sourceClient.includes(
    'const stagiaires = obtenirIdsStagiairesSession();'
  ));
  assert(sessionsService.includes(
    'const idsStagiairesHistoriques = new Set('
  ));
  assert(sessionsService.includes(
    'Une confirmation explicite est obligatoire.'
  ));
});

test('la règle inactif est centralisée côté interface', () => {
  assert(sourceClient.includes(
    'function estStatutStagiaireInactif_(statut)'
  ));
  const occurrences = sourceClient.match(
    /\['Clôturé', 'Abandon'\]/g
  ) || [];
  assert.strictEqual(occurrences.length, 1);
});

test('la version applicative centralisée est 2.0.1', () => {
  assert(metadata.includes(
    "const VERSION_APPLICATION_PREPFORMATION_ = '2.0.1';"
  ));
});

let reussis = 0;
tests.forEach(cas => {
  cas.traitement();
  reussis++;
  console.log('✓ ' + cas.nom);
});

console.log(
  `\n${reussis}/${tests.length} tests de PrepFormation 2.0.1 réussis.\n`
);
