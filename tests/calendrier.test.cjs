'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const sourceService = fs.readFileSync(
  path.join(racine, 'CalendrierService.js'),
  'utf8'
);
const sourceInterface = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
).replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
const html = fs.readFileSync(
  path.join(racine, 'Calendrier.html'),
  'utf8'
);
const indexHtml = fs.readFileSync(
  path.join(racine, 'Index.html'),
  'utf8'
);
const css = fs.readFileSync(path.join(racine, 'CSS.html'), 'utf8');
const ui = fs.readFileSync(path.join(racine, 'UI.js'), 'utf8');
const sessionsService = fs.readFileSync(
  path.join(racine, 'SessionsService.js'),
  'utf8'
);
const restaurationService = fs.readFileSync(
  path.join(racine, 'RestaurationService.js'),
  'utf8'
);
const metadonnees = fs.readFileSync(
  path.join(racine, 'ApplicationMetadataService.js'),
  'utf8'
);

function table(entetes, lignes) {
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

function donneesBase() {
  return {
    SESSIONS: table(
      [
        'ID_SESSION', 'DATE_SESSION', 'HEURE_DEBUT', 'HEURE_FIN',
        'DUREE_HEURES', 'FORMATION', 'REMARQUES'
      ],
      [
        ['S0', '2026-01-31', '08:00', '09:00', 1, 'F1', 'Marge'],
        ['S1', '2026-02-02', '09:00', '11:00', 2, 'F1', 'Matin'],
        ['S2', '2026-02-02', '14:00', '16:00', 2, 'EQ SUAP', 'Après-midi'],
        ['S3', '2026-02-15', '10:00', '11:30', 1.5, 'F1', ''],
        ['S4', '2026-02-20', '12:00', '13:00', 1, 'Formation supprimée', 'Orpheline'],
        ['S5', '2026-03-01', '09:00', '10:00', 1, 'F1', 'Marge suivante'],
        ['HORS', '2026-04-01', '09:00', '10:00', 1, 'F1', 'Hors période']
      ]
    ),
    PRESTATIONS_FORMATEURS: table(
      ['ID_SESSION', 'ID_FORMATEUR', 'STATUT_INDEMNISATION'],
      [
        ['S1', 'F01', 'À demander'],
        ['S1', 'F01', 'Indemnisée'],
        ['S2', 'F02', 'À demander'],
        ['S3', 'INCONNU', 'À demander']
      ]
    ),
    PRESENCES_STAGIAIRES: table(
      ['ID_SESSION', 'ID_STAGIAIRE'],
      [
        ['S1', 'T1'],
        ['S1', 'T1'],
        ['S1', 'T2'],
        ['S2', 'T2'],
        ['S3', 'INCONNU']
      ]
    ),
    FORMATEURS: table(
      ['ID_FORMATEUR', 'NOM', 'PRENOM'],
      [
        ['F01', 'Martin', 'Alice'],
        ['F02', 'Bernard', 'Bruno']
      ]
    ),
    FORMATIONS: table(
      ['ID_FORMATION', 'LIBELLE'],
      [
        ['F1', 'EQ PS'],
        ['F2', 'EQ SUAP']
      ]
    ),
    STAGIAIRES: table(
      ['UUID', 'NOM', 'PRENOM'],
      [
        ['T1', 'Durand', 'Chloé'],
        ['T2', 'Petit', 'David']
      ]
    )
  };
}

function creerContexteService(supplements) {
  const contexte = Object.assign({
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
    isFinite
  }, supplements || {});
  vm.createContext(contexte);
  vm.runInContext(sourceService, contexte, {
    filename: 'CalendrierService.js'
  });
  return contexte;
}

function calculer(tables, debut, fin, maintenant) {
  const c = creerContexteService();
  return c.calculerDonneesCalendrierDepuisTables_(
    tables || donneesBase(),
    c.convertirDateIsoCalendrier_(debut || '2026-01-26'),
    c.convertirDateIsoCalendrier_(fin || '2026-03-01'),
    maintenant || new Date(2026, 1, 10, 12),
    []
  );
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
  return Object.assign({
    value: '',
    innerHTML: '',
    textContent: '',
    disabled: false,
    dataset: {},
    classList: creerClassList(),
    focus() { this.focusRecu = true; },
    querySelectorAll: () => [],
    setAttribute: () => {}
  }, options || {});
}

function creerContexteInterface(elements, runner) {
  const tableElements = elements || {};
  const document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: id => tableElements[id] || null,
    querySelectorAll: () => [],
    querySelector: () => null,
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
    Object,
    Array,
    RegExp,
    Error,
    Promise,
    isNaN,
    document,
    window: {
      setTimeout: traitement => traitement(),
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      addEventListener: () => {},
      crypto: { randomUUID: () => 'operation-test' },
      confirm: () => true
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    google: {
      script: {
        run: runner || {
          withSuccessHandler() { return this; },
          withFailureHandler() { return this; },
          getDonneesCalendrier() {}
        }
      }
    }
  };
  vm.createContext(contexte);
  vm.runInContext(sourceInterface, contexte, {
    filename: 'JavaScript.html'
  });
  return contexte;
}

const tests = [];
let dureePerformanceMs = 0;

function test(nom, traitement) {
  tests.push({ nom, traitement });
}

test('le module est déclaré dans le menu et les pages autorisées', () => {
  assert(indexHtml.includes('data-page="Calendrier"'));
  assert(ui.includes("'Calendrier'"));
  assert(sourceInterface.includes("nomPage === 'Calendrier'"));
});

test('le mois courant est chargé par défaut avec sa fenêtre complète', () => {
  const appels = [];
  const runner = {
    withSuccessHandler() { return this; },
    withFailureHandler() { return this; },
    getDonneesCalendrier(debut, fin) { appels.push({ debut, fin }); }
  };
  const c = creerContexteInterface({
    titreMoisCalendrier: creerElement(),
    chargementCalendrier: creerElement({
      classList: creerClassList(['masque'])
    }),
    erreurCalendrier: creerElement({
      classList: creerClassList(['masque'])
    })
  }, runner);
  const etat = vm.runInContext('etatApplication', c);
  etat.pageActive = 'Calendrier';
  c.initialiserPageCalendrier();
  const maintenant = new Date();
  assert.strictEqual(
    etat.moisCalendrierActif.getFullYear(),
    maintenant.getFullYear()
  );
  assert.strictEqual(
    etat.moisCalendrierActif.getMonth(),
    maintenant.getMonth()
  );
  assert.strictEqual(appels.length, 1);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(appels[0].debut));
  assert(/^\d{4}-\d{2}-\d{2}$/.test(appels[0].fin));
});

test('les semaines commencent lundi et affichent les jours hors mois', () => {
  const c = creerContexteInterface();
  const periode = c.calculerPeriodeVisibleCalendrier_(
    new Date(2026, 1, 1, 12)
  );
  assert.strictEqual(periode.dateDebut, '2026-01-26');
  assert.strictEqual(periode.dateFin, '2026-03-01');
  assert.strictEqual(periode.nombreJours, 35);
  const periodeLongue = c.calculerPeriodeVisibleCalendrier_(
    new Date(2026, 7, 1, 12)
  );
  assert.strictEqual(periodeLongue.nombreJours, 42);
  assert(html.includes('Lundi'));
  assert(sourceInterface.includes('jour-hors-mois-calendrier'));
});

test('février bissextile conserve le 29 février', () => {
  const c = creerContexteInterface();
  const periode = c.calculerPeriodeVisibleCalendrier_(
    new Date(2024, 1, 1, 12)
  );
  assert.strictEqual(periode.dateDebut, '2024-01-29');
  assert.strictEqual(periode.dateFin, '2024-03-03');
  assert(c.creerDateLocaleCalendrier_('2024-02-29'));
  assert.strictEqual(c.creerDateLocaleCalendrier_('2026-02-29'), null);
});

test('le calcul par dates civiles reste stable au changement d’heure', () => {
  const c = creerContexteInterface();
  const veille = new Date(2026, 2, 28, 12);
  const lendemain = c.ajouterJoursCalendrier_(veille, 1);
  const surlendemain = c.ajouterJoursCalendrier_(veille, 2);
  assert.strictEqual(
    c.formaterDateIsoCalendrierClient_(lendemain),
    '2026-03-29'
  );
  assert.strictEqual(
    c.formaterDateIsoCalendrierClient_(surlendemain),
    '2026-03-30'
  );
});

test('la navigation précédent, suivant et aujourd’hui change le mois', () => {
  const c = creerContexteInterface();
  const etat = vm.runInContext('etatApplication', c);
  let chargements = 0;
  c.chargerMoisCalendrier = () => { chargements++; };
  etat.moisCalendrierActif = new Date(2026, 0, 1, 12);
  etat.chargementCalendrierEnCours = false;
  c.changerMoisCalendrier(-1);
  assert.strictEqual(etat.moisCalendrierActif.getFullYear(), 2025);
  assert.strictEqual(etat.moisCalendrierActif.getMonth(), 11);
  c.changerMoisCalendrier(1);
  assert.strictEqual(etat.moisCalendrierActif.getMonth(), 0);
  c.revenirAujourdhuiCalendrier();
  assert.strictEqual(
    etat.moisCalendrierActif.getMonth(),
    new Date().getMonth()
  );
  assert.strictEqual(chargements, 3);
});

test('plusieurs séances d’un même jour restent distinctes et triées', () => {
  const resultat = calculer();
  const seances = resultat.sessions.filter(
    session => session.date === '2026-02-02'
  );
  assert.strictEqual(seances.length, 2);
  assert.deepStrictEqual(
    Array.from(seances, session => session.heureDebut),
    ['09:00', '14:00']
  );
  assert.strictEqual(seances[0].nombreStagiaires, 2);
  assert.strictEqual(seances[0].formateurs.length, 1);
});

test('une journée chargée annonce son total et garde toutes les séances accessibles', () => {
  const c = creerContexteInterface();
  const modele = calculer().sessions.find(session => session.idSession === 'S1');
  const sessions = Array.from({ length: 5 }, (_, index) => Object.assign(
    {},
    modele,
    { idSession: 'CHARGE_' + index }
  ));
  const rendu = c.creerJourGrilleCalendrier_(
    new Date(2026, 1, 2, 12),
    '2026-02-02',
    true,
    false,
    sessions,
    true
  );
  assert(rendu.includes('5 séances'));
  assert(rendu.includes('+ 2 autres'));
  assert.strictEqual(
    (rendu.match(/class="seance-calendrier"/g) || []).length,
    5
  );
});

test('les doublons participants sont dédupliqués sans donnée d’indemnisation', () => {
  const resultat = calculer();
  const session = resultat.sessions.find(element => element.idSession === 'S1');
  assert.deepStrictEqual(Array.from(session.formateurIds), ['F01']);
  assert.deepStrictEqual(Array.from(session.stagiaireIds), ['T1', 'T2']);
  const contenu = JSON.stringify(resultat);
  assert(!contenu.includes('STATUT_INDEMNISATION'));
  assert(!/email|drive/i.test(contenu));
});

test('les données orphelines restent affichables sans planter', () => {
  const resultat = calculer();
  const orpheline = resultat.sessions.find(session => session.idSession === 'S4');
  const sansIdentites = resultat.sessions.find(session => session.idSession === 'S3');
  assert(orpheline.formationId.startsWith('ORPHELINE:'));
  assert(sansIdentites.formateurs[0].orphelin);
  assert(resultat.avertissements.some(message =>
    message.includes('Formation supprimée')
  ));
});

test('les filtres formation, formateur et stagiaire utilisent les ID', () => {
  const c = creerContexteInterface();
  const sessions = calculer().sessions;
  const filtrer = filtres => Array.from(
    c.filtrerSeancesCalendrier_(sessions, Object.assign({
      formationId: '', formateurId: '', stagiaireId: '',
      temporalite: 'TOUTES'
    }, filtres), '2026-02-10'),
    session => session.idSession
  );
  assert.deepStrictEqual(filtrer({ formationId: 'F2' }), ['S2']);
  assert.deepStrictEqual(filtrer({ formateurId: 'F01' }), ['S1']);
  assert.deepStrictEqual(filtrer({ stagiaireId: 'T2' }), ['S1', 'S2']);
  assert.deepStrictEqual(
    filtrer({ formationId: 'F1', stagiaireId: 'T2' }),
    ['S1']
  );
});

test('les filtres passé et futur se combinent avec les participants', () => {
  const c = creerContexteInterface();
  const sessions = calculer().sessions;
  const passees = c.filtrerSeancesCalendrier_(sessions, {
    temporalite: 'PASSEES', formateurId: 'F01'
  }, '2026-02-10');
  const futures = c.filtrerSeancesCalendrier_(sessions, {
    temporalite: 'FUTURES', formationId: 'F1'
  }, '2026-02-10');
  assert.deepStrictEqual(Array.from(passees, s => s.idSession), ['S1']);
  assert.deepStrictEqual(
    Array.from(futures, s => s.idSession),
    ['S3', 'S5']
  );
});

test('la couleur d’une formation est stable et le libellé reste visible', () => {
  const c = creerContexteInterface();
  const premiere = JSON.stringify(c.obtenirCouleurFormationCalendrier_('F1'));
  const seconde = JSON.stringify(c.obtenirCouleurFormationCalendrier_('F1'));
  assert.strictEqual(premiere, seconde);
  const bouton = c.creerBoutonSeanceCalendrier_(calculer().sessions[1]);
  assert(bouton.includes('EQ PS'));
  assert(bouton.includes('aria-label='));
  assert(bouton.includes('title='));
});

test('un clic ouvre la fiche Sessions existante', () => {
  const c = creerContexteInterface();
  const etat = vm.runInContext('etatApplication', c);
  let page = '';
  c.chargerPage = nom => { page = nom; };
  c.ouvrirSessionDepuisCalendrier('S1');
  assert.strictEqual(etat.sessionAConsulterDepuisCalendrier, 'S1');
  assert.strictEqual(page, 'Sessions');
  assert(sourceInterface.includes('consulterSession(idSession)'));
});

test('la création depuis une date réutilise le formulaire sans horaires', () => {
  const champs = {
    sessionDate: creerElement(),
    sessionHeureDebut: creerElement({ value: '09:00' }),
    sessionHeureFin: creerElement({ value: '11:00' })
  };
  const c = creerContexteInterface(champs);
  let formulaireOuvert = false;
  c.nouvelleSession = () => { formulaireOuvert = true; };
  c.mettreAJourDureeSession = () => {};
  c.nouvelleSessionDepuisDate('2026-02-18');
  assert(formulaireOuvert);
  assert.strictEqual(champs.sessionDate.value, '2026-02-18');
  assert.strictEqual(champs.sessionHeureDebut.value, '');
  assert.strictEqual(champs.sessionHeureFin.value, '');
  assert(champs.sessionDate.focusRecu);
});

test('un utilisateur sans droit ne peut pas lancer la création', () => {
  const c = creerContexteInterface();
  const etat = vm.runInContext('etatApplication', c);
  let navigation = false;
  c.chargerPage = () => { navigation = true; };
  c.afficherToast = () => {};
  etat.sessionUtilisateur = { droits: { gererSessions: false } };
  etat.donneesCalendrier = { droits: { creerSession: false } };
  c.ouvrirNouvelleSessionDepuisCalendrier('2026-02-18');
  assert.strictEqual(navigation, false);
  assert.strictEqual(etat.dateNouvelleSessionDepuisCalendrier, '');
  assert(sourceInterface.includes('donnees.droits && donnees.droits.creerSession'));
});

test('un mois vide conserve la grille et l’agenda sans exception', () => {
  const elements = {
    titreMoisCalendrier: creerElement(),
    compteurSeancesCalendrier: creerElement(),
    legendeFormationsCalendrier: creerElement(),
    grilleCalendrier: creerElement(),
    agendaCalendrier: creerElement()
  };
  const c = creerContexteInterface(elements);
  const etat = vm.runInContext('etatApplication', c);
  etat.moisCalendrierActif = new Date(2026, 1, 1, 12);
  c.afficherCalendrier_([], {
    periode: { aujourdHui: '2026-02-10' },
    droits: { creerSession: false }
  });
  assert.strictEqual(elements.compteurSeancesCalendrier.textContent, '0 séance');
  assert(elements.grilleCalendrier.innerHTML.includes('role="row"'));
  assert(elements.grilleCalendrier.innerHTML.includes('role="gridcell"'));
  assert(elements.agendaCalendrier.innerHTML.includes('Aucune séance'));
});

test('la vue téléphone passe automatiquement en agenda et la tablette garde la grille', () => {
  assert(css.includes('@media (max-width: 720px)'));
  assert(css.includes('.calendrier-grille-conteneur {\n    display: none;'));
  assert(css.includes('.agenda-calendrier {\n    display: block;'));
  assert(css.includes('@media (max-width: 1100px)'));
  assert(css.includes('grid-template-columns: repeat(7'));
});

test('les contrôles sont accessibles au clavier et le jour courant est annoncé', () => {
  assert(html.includes('role="grid"'));
  assert(html.includes('aria-label="Afficher le mois précédent"'));
  assert(sourceInterface.includes('aria-current="date"'));
  assert(sourceInterface.includes('type="button"'));
  assert(css.includes('.seance-calendrier:focus-visible'));
});

test('chaque feuille est lue une fois et le cache évite la seconde lecture', () => {
  const tables = donneesBase();
  const feuilles = {};
  const lectures = {};
  Object.keys(tables).forEach(nom => {
    const source = tables[nom];
    const valeurs = [source.entetes].concat(source.lignes);
    lectures[nom] = 0;
    feuilles[nom] = {
      getLastRow: () => valeurs.length,
      getLastColumn: () => valeurs[0].length,
      getDataRange: () => ({
        getValues: () => {
          lectures[nom]++;
          return valeurs.map(ligne => ligne.slice());
        }
      })
    };
  });
  const memoire = {};
  const cache = {
    get: cle => memoire[cle] || null,
    put: (cle, valeur) => { memoire[cle] = valeur; },
    remove: cle => { delete memoire[cle]; }
  };
  const c = creerContexteService({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: nom => feuilles[nom]
      })
    },
    CacheService: { getScriptCache: () => cache },
    getSessionUtilisateur: () => ({
      estAdministrateur: false,
      droits: { gererSessions: true }
    }),
    obtenirVersionApplication_: () => '1.9.3',
    restaurationBloqueEcritures_: () => false
  });
  const premier = c.getDonneesCalendrier(
    '2026-01-26', '2026-03-01', ''
  );
  const second = c.getDonneesCalendrier(
    '2026-01-26', '2026-03-01', ''
  );
  Object.values(lectures).forEach(nombre => assert.strictEqual(nombre, 1));
  assert.strictEqual(premier.meta.cacheUtilise, false);
  assert.strictEqual(second.meta.cacheUtilise, true);
  assert.strictEqual(second.droits.creerSession, true);
});

test('le service ne mute pas les tables et reste rapide avec 5 000 séances', () => {
  const tables = donneesBase();
  tables.SESSIONS.lignes = [];
  tables.PRESTATIONS_FORMATEURS.lignes = [];
  tables.PRESENCES_STAGIAIRES.lignes = [];
  for (let index = 0; index < 5000; index++) {
    const id = 'S' + index;
    const jour = String(index % 28 + 1).padStart(2, '0');
    tables.SESSIONS.lignes.push([
      id, '2026-02-' + jour, '09:00', '10:00', 1, 'F1', ''
    ]);
    tables.PRESTATIONS_FORMATEURS.lignes.push([id, 'F01', 'À demander']);
    tables.PRESENCES_STAGIAIRES.lignes.push([id, 'T1']);
  }
  const avant = JSON.stringify(tables);
  const debut = Date.now();
  const resultat = calculer(
    tables,
    '2026-02-01',
    '2026-02-28'
  );
  dureePerformanceMs = Date.now() - debut;
  assert.strictEqual(resultat.sessions.length, 5000);
  assert.strictEqual(JSON.stringify(tables), avant);
  assert(dureePerformanceMs < 2000, 'Calcul trop lent : ' + dureePerformanceMs + ' ms');
});

test('aucune écriture Sheets ni migration n’est introduite', () => {
  assert(!/setValue|setValues|appendRow|insertSheet|deleteSheet|clearContent/.test(sourceService));
  assert(!sourceService.includes('assurerFeuilleMigration_'));
  assert(!sourceService.includes('executerMigrations'));
  assert(!sourceInterface.includes('.enregistrerSessionDepuisCalendrier'));
});

test('le cache calendrier est invalidé après séance et restauration', () => {
  assert(sessionsService.includes('invaliderCacheCalendrier_()'));
  assert.strictEqual(
    (restaurationService.match(/invaliderCacheCalendrier_\(\)/g) || []).length,
    2
  );
});

test('la version applicative est centralisée à 1.9.4', () => {
  assert(metadonnees.includes(
    "VERSION_APPLICATION_PREPFORMATION_ = '1.9.4'"
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
  ' tests du calendrier réussis.\n' +
  'Mesure locale : 5 000 séances agrégées en ' +
  dureePerformanceMs + ' ms.\n'
);
