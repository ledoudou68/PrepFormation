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
const css = fs.readFileSync(
  path.join(racine, 'CSS.html'),
  'utf8'
);
const sourceMoteur = fs.readFileSync(
  path.join(racine, 'AnalysePedagogiqueService.js'),
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
    },
    toString: () => Array.from(classes).join(' ')
  };
}

function creerElement(options) {
  const attributs = {};
  return Object.assign({
    dataset: {},
    classList: creerClassList(),
    innerHTML: '',
    textContent: '',
    disabled: false,
    setAttribute: (nom, valeur) => { attributs[nom] = String(valeur); },
    getAttribute: nom => attributs[nom],
    querySelectorAll: () => []
  }, options || {});
}

function creerContexte(elements, googleScriptRun) {
  const table = elements || {};
  const document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    getElementById: id => table[id] || null,
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
    },
    google: {
      script: {
        run: googleScriptRun || {
          withSuccessHandler() { return this; },
          withFailureHandler() { return this; }
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

function donneesInterface(options) {
  const base = {
    synthese: {
      nombreSeances: 3,
      premiereSeance: '2026-01-10',
      derniereSeance: '2026-07-20',
      joursDepuisDerniereSeance: 17,
      nombreItemsReferentielActifs: 3,
      nombreItemsTravailles: 2,
      nombreItemsAcquis: 1,
      itemsJamaisTravailles: [{ idItem: 'I3' }],
      itemsJamaisAcquis: [{ idItem: 'I2' }, { idItem: 'I3' }]
    },
    items: [
      {
        idItem: 'I1', intitule: 'Bilan', categorie: 'Gestes',
        historique: false, nombreFoisTravaille: 2,
        nombreFoisAcquis: 2, nombreEchecsExplicites: 0,
        tauxAcquisition: 100, derniereDateTravail: '2026-07-20',
        joursDepuisDernierTravail: 17, scorePriorite: 10
      },
      {
        idItem: 'I2', intitule: 'Ventilation', categorie: 'Gestes',
        historique: false, nombreFoisTravaille: 2,
        nombreFoisAcquis: 0, nombreEchecsExplicites: 2,
        tauxAcquisition: 0, derniereDateTravail: '2026-05-01',
        joursDepuisDernierTravail: 97, scorePriorite: 74
      },
      {
        idItem: 'I3', intitule: 'Relevage', categorie: 'Gestes',
        historique: false, nombreFoisTravaille: 0,
        nombreFoisAcquis: 0, nombreEchecsExplicites: 0,
        tauxAcquisition: null, derniereDateTravail: '',
        joursDepuisDernierTravail: null, scorePriorite: 75
      },
      {
        idItem: 'IH', intitule: 'Ancien item', categorie: 'Historique',
        historique: true, nombreFoisTravaille: 1,
        nombreFoisAcquis: 1, nombreEchecsExplicites: 0,
        tauxAcquisition: 100, derniereDateTravail: '2025-01-01',
        joursDepuisDernierTravail: 582, scorePriorite: 0
      }
    ],
    pointsForts: [{ idItem: 'I1' }],
    pointsFaibles: [{
      idItem: 'I2', intitule: 'Ventilation', categorie: 'Gestes',
      nombreFoisTravaille: 2, nombreFoisAcquis: 0,
      nombreEchecsExplicites: 2, tauxAcquisition: 0,
      derniereDateTravail: '2026-05-01',
      motifClassement: 'Aucune acquisition validée'
    }],
    itemsOublies: [{
      idItem: 'I3', intitule: 'Relevage', categorie: 'Gestes',
      nombreFoisTravaille: 0, joursDepuisDernierTravail: null,
      derniereDateTravail: ''
    }],
    itemsPrioritaires: [{ idItem: 'I3' }, { idItem: 'I2' }],
    agregatsParCategorie: [
      {
        idCategorie: 'C1', categorie: 'Gestes', ordre: 1,
        nombreItemsActifs: 3, nombreItemsTravailles: 2,
        nombreItemsAcquis: 1, pourcentageAcquisition: 33.3
      },
      {
        idCategorie: 'C2', categorie: 'Sécurité', ordre: 2,
        nombreItemsActifs: 2, nombreItemsTravailles: 2,
        nombreItemsAcquis: 2, pourcentageAcquisition: 100
      },
      {
        idCategorie: 'C3', categorie: 'Communication', ordre: 3,
        nombreItemsActifs: 1, nombreItemsTravailles: 0,
        nombreItemsAcquis: 0, pourcentageAcquisition: 0
      }
    ],
    progressionChronologique: [
      {
        date: '2026-01-10', nombreSeances: 1,
        nouvellesAcquisitions: 1, cumulItemsAcquis: 1
      },
      {
        date: '2026-03-10', nombreSeances: 1,
        nouvellesAcquisitions: 0, cumulItemsAcquis: 1
      },
      {
        date: '2026-07-20', nombreSeances: 1,
        nouvellesAcquisitions: 1, cumulItemsAcquis: 2
      }
    ],
    activiteMensuelle: Array.from({ length: 12 }, (_, index) => ({
      mois: '2026-' + String(index + 1).padStart(2, '0'),
      nombreItemsTravailles: index % 4,
      nouvellesAcquisitions: index % 3 === 0 ? 1 : 0
    })),
    recommandationsProchaineSeance: [
      {
        rang: 1, idItem: 'I3', intitule: 'Relevage',
        categorie: 'Gestes', scorePriorite: 75,
        niveauPriorite: 'CRITIQUE',
        motifs: ['Item jamais travaillé', 'Aucune acquisition validée']
      },
      {
        rang: 2, idItem: 'I2', intitule: 'Ventilation',
        categorie: 'Gestes', scorePriorite: 74,
        niveauPriorite: 'ELEVEE',
        motifs: ['Deux échecs distincts']
      }
    ],
    regles: { seuilOubliJours: 45 },
    meta: {
      calculeA: '2026-08-06T10:00:00.000Z',
      dureeCalculMs: 12,
      cacheUtilise: false,
      ageCacheSecondes: 0
    },
    avertissements: []
  };
  return Object.assign(base, options || {});
}

const tests = [];
let dureeRenduVisuelMs = null;
function test(nom, traitement) {
  tests.push({ nom, traitement });
}

test('la fiche contient les onglets Parcours et Analyse pédagogique', () => {
  const c = creerContexte();
  const html = c.creerOngletAnalysePedagogiqueFicheStagiaire_();
  assert(sourceInterface.includes('data-onglet-fiche-stagiaire="analyse"'));
  assert(html.includes('Analyse pédagogique'));
  assert(html.includes('Recommandations pour la prochaine séance'));
  assert(html.includes('Détail complet par item'));
  assert(!html.includes('<details open'));
});

test('un stagiaire sans séance produit uniquement l’état vide', () => {
  const c = creerContexte();
  const donnees = donneesInterface({
    synthese: {
      nombreSeances: 0,
      itemsJamaisTravailles: [],
      itemsJamaisAcquis: []
    }
  });
  assert.strictEqual(c.analysePedagogiqueSansDonnees_(donnees), true);
  assert.strictEqual(
    c.construirePhraseSyntheseAnalysePedagogique_(donnees),
    'Aucune séance pédagogique exploitable n’est encore enregistrée.'
  );
});

test('une seule séance reste une donnée exploitable sans conclusion inventée', () => {
  const c = creerContexte();
  const donnees = donneesInterface({
    synthese: {
      nombreSeances: 1,
      nombreItemsAcquis: 1,
      itemsJamaisTravailles: []
    },
    pointsFaibles: []
  });
  assert.strictEqual(c.analysePedagogiqueSansDonnees_(donnees), false);
  assert(c.construirePhraseSyntheseAnalysePedagogique_(donnees).includes(
    'acquisitions enregistrées'
  ));
});

test('le bloc principal ne rend jamais plus de dix recommandations', () => {
  const zone = creerElement();
  const c = creerContexte({
    recommandationsAnalysePedagogiqueFiche: zone
  });
  const donnees = donneesInterface();
  donnees.recommandationsProchaineSeance = Array.from(
    { length: 14 },
    (_, index) => ({
      rang: index + 1,
      idItem: 'I3',
      intitule: 'Item ' + index,
      categorie: 'Gestes',
      scorePriorite: 80 - index,
      niveauPriorite: 'CRITIQUE',
      motifs: ['Motif']
    })
  );
  c.afficherRecommandationsAnalysePedagogiqueFiche_(donnees);
  assert.strictEqual(
    (zone.innerHTML.match(/<article class="recommandation-analyse/g) || [])
      .length,
    10
  );
});

test('les quatre niveaux de priorité ont un texte explicite', () => {
  const c = creerContexte();
  assert.strictEqual(
    c.obtenirPresentationNiveauPrioriteAnalysePedagogique_('CRITIQUE')
      .libelle,
    'Priorité très élevée'
  );
  assert.strictEqual(
    c.obtenirPresentationNiveauPrioriteAnalysePedagogique_('ELEVEE')
      .libelle,
    'Priorité élevée'
  );
  assert.strictEqual(
    c.obtenirPresentationNiveauPrioriteAnalysePedagogique_('MODEREE')
      .libelle,
    'Priorité moyenne'
  );
  assert.strictEqual(
    c.obtenirPresentationNiveauPrioriteAnalysePedagogique_('FAIBLE')
      .libelle,
    'Priorité faible'
  );
});

test('les états vides des points forts et faibles sont explicites', () => {
  const fort = creerElement();
  const faible = creerElement();
  const c = creerContexte({
    pointsFortsAnalysePedagogiqueFiche: fort,
    pointsFaiblesAnalysePedagogiqueFiche: faible
  });
  c.afficherPointsFortsAnalysePedagogiqueFiche_([]);
  c.afficherPointsFaiblesAnalysePedagogiqueFiche_([]);
  assert(fort.innerHTML.includes(
    'Aucun point fort suffisamment consolidé pour le moment.'
  ));
  assert(faible.innerHTML.includes(
    'Aucun point faible majeur détecté.'
  ));
});

test('jamais travaillé et non revu sont distingués', () => {
  const zone = creerElement();
  const seuil = creerElement();
  const c = creerContexte({
    itemsOubliesAnalysePedagogiqueFiche: zone,
    seuilOubliAnalysePedagogiqueFiche: seuil
  });
  const donnees = donneesInterface();
  donnees.itemsOublies.push({
    idItem: 'I1', intitule: 'Bilan', categorie: 'Gestes',
    nombreFoisTravaille: 2, joursDepuisDernierTravail: 80,
    derniereDateTravail: '2026-05-18'
  });
  c.afficherItemsOubliesAnalysePedagogiqueFiche_(donnees);
  assert(zone.innerHTML.includes('Jamais travaillé'));
  assert(zone.innerHTML.includes('Non revu depuis 80 jours'));
  assert(seuil.textContent.includes('45 jours'));
});

test('null, zéro et cent pour cent restent distincts', () => {
  const c = creerContexte();
  assert.strictEqual(
    c.formaterTauxAnalysePedagogique_(null),
    'Non calculable'
  );
  assert.strictEqual(c.formaterTauxAnalysePedagogique_(0), '0 %');
  assert.strictEqual(c.formaterTauxAnalysePedagogique_(100), '100 %');
});

test('le résumé visuel affiche quatre rapports absolus et leurs pourcentages', () => {
  const zone = creerElement();
  const c = creerContexte({
    resumeVisuelAnalysePedagogiqueFiche: zone
  });
  c.afficherResumeVisuelAnalysePedagogiqueFiche_(donneesInterface());
  assert.strictEqual(
    (zone.innerHTML.match(/<article class="jauge-analyse/g) || []).length,
    4
  );
  assert(zone.innerHTML.includes('2 / 3 · 66,7 %'));
  assert(zone.innerHTML.includes('1 / 3 · 33,3 %'));
  assert(zone.innerHTML.includes('role="progressbar"'));
});

test('moins de trois catégories déclenche le fallback en barres', () => {
  const zone = creerElement();
  const c = creerContexte({
    visualisationCategoriesAnalysePedagogiqueFiche: zone
  });
  const donnees = donneesInterface();
  donnees.agregatsParCategorie = donnees.agregatsParCategorie.slice(0, 2);
  c.afficherVisualisationCategoriesAnalysePedagogiqueFiche_(donnees);
  assert(zone.innerHTML.includes(
    'data-visualisation-analyse="barres-categories"'
  ));
  assert(!zone.innerHTML.includes('data-visualisation-analyse="radar"'));
  assert(zone.innerHTML.includes('Moins de trois catégories'));
});

test('au moins trois catégories exploitables produisent un radar accessible', () => {
  const zone = creerElement();
  const c = creerContexte({
    visualisationCategoriesAnalysePedagogiqueFiche: zone
  });
  c.afficherVisualisationCategoriesAnalysePedagogiqueFiche_(
    donneesInterface()
  );
  assert(zone.innerHTML.includes('data-visualisation-analyse="radar"'));
  assert(zone.innerHTML.includes('Échelle fixe : 0 à 100 %'));
  assert(zone.innerHTML.includes('tabindex="0"'));
  assert(zone.innerHTML.includes('<caption'));
  assert(zone.innerHTML.includes('Communication'));
  assert(
    zone.innerHTML.indexOf('conteneur-radar-analyse') <
    zone.innerHTML.indexOf('legende-visualisation-analyse')
  );
});

test('des catégories toutes non calculables ne produisent aucun radar', () => {
  const zone = creerElement();
  const c = creerContexte({
    visualisationCategoriesAnalysePedagogiqueFiche: zone
  });
  const donnees = donneesInterface();
  donnees.agregatsParCategorie.forEach(agregat => {
    agregat.nombreItemsActifs = 0;
    agregat.pourcentageAcquisition = null;
  });
  c.afficherVisualisationCategoriesAnalysePedagogiqueFiche_(donnees);
  assert(!zone.innerHTML.includes('data-visualisation-analyse="radar"'));
  assert(zone.innerHTML.includes('Aucun pourcentage calculable'));
});

test('la courbe exige deux dates et conserve toujours son tableau accessible', () => {
  const zone = creerElement();
  const c = creerContexte({
    progressionChronologiqueAnalysePedagogiqueFiche: zone
  });
  const donnees = donneesInterface();
  donnees.progressionChronologique = [donnees.progressionChronologique[0]];
  c.afficherProgressionChronologiqueAnalysePedagogiqueFiche_(donnees);
  assert(zone.innerHTML.includes('Une deuxième date de séance'));
  assert(!zone.innerHTML.includes(
    'data-visualisation-analyse="courbe-progression"'
  ));
  assert(zone.innerHTML.includes('<table'));

  donnees.progressionChronologique.push({
    date: '2026-02-10', nombreSeances: 2,
    nouvellesAcquisitions: 2, cumulItemsAcquis: 3
  });
  c.afficherProgressionChronologiqueAnalysePedagogiqueFiche_(donnees);
  assert(zone.innerHTML.includes(
    'data-visualisation-analyse="courbe-progression"'
  ));
  assert(zone.innerHTML.includes('Séances ce jour'));
});

test('l’activité mensuelle utilise deux graphiques et une seule table', () => {
  const zone = creerElement();
  const c = creerContexte({
    activiteMensuelleAnalysePedagogiqueFiche: zone
  });
  c.afficherActiviteMensuelleAnalysePedagogiqueFiche_(donneesInterface());
  assert(zone.innerHTML.includes('data-visualisation-analyse="activite-travail"'));
  assert(zone.innerHTML.includes('data-visualisation-analyse="activite-acquis"'));
  assert.strictEqual((zone.innerHTML.match(/<svg/g) || []).length, 2);
  assert.strictEqual((zone.innerHTML.match(/<table/g) || []).length, 1);
  assert(!zone.innerHTML.includes('double'));
});

test('le rendu visuel normal reste rapide et ne modifie pas la réponse', () => {
  const elements = {
    resumeVisuelAnalysePedagogiqueFiche: creerElement(),
    visualisationCategoriesAnalysePedagogiqueFiche: creerElement(),
    progressionChronologiqueAnalysePedagogiqueFiche: creerElement(),
    activiteMensuelleAnalysePedagogiqueFiche: creerElement()
  };
  const c = creerContexte(elements);
  const donnees = donneesInterface();
  const avant = JSON.stringify(donnees);
  const debut = Date.now();
  c.afficherResumeVisuelAnalysePedagogiqueFiche_(donnees);
  c.afficherVisualisationCategoriesAnalysePedagogiqueFiche_(donnees);
  c.afficherProgressionChronologiqueAnalysePedagogiqueFiche_(donnees);
  c.afficherActiviteMensuelleAnalysePedagogiqueFiche_(donnees);
  const duree = Date.now() - debut;
  dureeRenduVisuelMs = duree;
  assert.strictEqual(JSON.stringify(donnees), avant);
  assert(duree < 1000, 'Rendu visuel trop lent : ' + duree + ' ms');
});

test('les filtres locaux utilisent uniquement les agrégats reçus', () => {
  const c = creerContexte();
  const donnees = donneesInterface();
  const index = c.construireIndexClassificationsAnalysePedagogique_(donnees);
  const ids = filtre => Array.from(
    c.filtrerItemsDetailAnalysePedagogique_(donnees, filtre, index),
    item => item.idItem
  );
  assert.deepStrictEqual(ids('PRIORITAIRES'), ['I2', 'I3']);
  assert.deepStrictEqual(ids('FORTS'), ['I1']);
  assert.deepStrictEqual(ids('FAIBLES'), ['I2']);
  assert.deepStrictEqual(ids('JAMAIS_TRAVAILLES'), ['I3']);
  assert.deepStrictEqual(ids('HISTORIQUES'), ['IH']);
  assert.deepStrictEqual(ids('TOUS'), ['I1', 'I2', 'I3', 'IH']);
});

test('un item peut afficher plusieurs classifications retournées', () => {
  const c = creerContexte();
  const donnees = donneesInterface();
  donnees.itemsOublies.push({ idItem: 'I2' });
  const index = c.construireIndexClassificationsAnalysePedagogique_(donnees);
  assert.deepStrictEqual(
    Array.from(c.obtenirClassificationsItemAnalysePedagogique_('I2', index)),
    ['prioritaire', 'faible', 'oublie']
  );
  assert.deepStrictEqual(
    Array.from(c.obtenirClassificationsItemAnalysePedagogique_('IH', index)),
    ['neutre']
  );
});

test('une erreur serveur est visible et permet de réessayer', () => {
  const erreur = creerElement({ classList: creerClassList(['masque']) });
  const contenu = creerElement();
  const vide = creerElement();
  const c = creerContexte({
    erreurAnalysePedagogiqueFiche: erreur,
    contenuAnalysePedagogiqueFiche: contenu,
    etatVideAnalysePedagogiqueFiche: vide
  });
  const etat = vm.runInContext('etatApplication', c);
  etat.analysePedagogiqueFicheStagiaire = {
    chargee: false,
    donnees: null
  };
  c.afficherErreurAnalysePedagogiqueFicheStagiaire_(
    new Error('Serveur indisponible')
  );
  assert(!erreur.classList.contains('masque'));
  assert(erreur.innerHTML.includes('Serveur indisponible'));
  assert(erreur.innerHTML.includes('Réessayer'));
  assert(contenu.classList.contains('masque'));
});

test('le cache de fiche évite les appels inutiles et le bouton force le calcul', () => {
  const appels = [];
  const runner = {
    withSuccessHandler() { return this; },
    withFailureHandler() { return this; },
    getAnalysePedagogiqueStagiaire(uuid, options) {
      appels.push({ uuid, options });
    }
  };
  const modal = creerElement({ dataset: { uuid: 'T1' } });
  const chargement = creerElement({ classList: creerClassList(['masque']) });
  const bouton = creerElement();
  const erreur = creerElement({ classList: creerClassList(['masque']) });
  const c = creerContexte({
    modalFicheStagiaire: modal,
    chargementAnalysePedagogiqueFiche: chargement,
    boutonActualiserAnalysePedagogiqueFiche: bouton,
    erreurAnalysePedagogiqueFiche: erreur
  }, runner);
  const etatApplication = vm.runInContext('etatApplication', c);
  etatApplication.analysePedagogiqueFicheStagiaire = {
    uuid: 'T1', chargee: false, chargement: false,
    donnees: null, filtreDetail: 'TOUS', generation: 0
  };

  c.chargerAnalysePedagogiqueFicheStagiaire(false);
  c.chargerAnalysePedagogiqueFicheStagiaire(false);
  assert.strictEqual(appels.length, 1);
  assert.strictEqual(appels[0].options.forcerActualisation, false);

  etatApplication.analysePedagogiqueFicheStagiaire.chargement = false;
  etatApplication.analysePedagogiqueFicheStagiaire.chargee = true;
  c.chargerAnalysePedagogiqueFicheStagiaire(false);
  assert.strictEqual(appels.length, 1);

  c.chargerAnalysePedagogiqueFicheStagiaire(true);
  assert.strictEqual(appels.length, 2);
  assert.strictEqual(appels[1].options.forcerActualisation, true);
});

test('l’onglet est responsive sans hauteur fixe ni débordement imposé', () => {
  assert(css.includes('@media (max-width: 700px)'));
  assert(css.includes('.grille-indicateurs-analyse-pedagogique'));
  assert(css.includes('grid-template-columns: 1fr'));
  const section = css.slice(css.indexOf('PROFIL D’ANALYSE PÉDAGOGIQUE'));
  assert(!section.includes(
    '.contenu-onglet-fiche-consultation {\n  height:'
  ));
  const reglesContenuOnglet = Array.from(section.matchAll(
    /\.contenu-onglet-fiche-consultation\s*\{([^}]*)\}/g
  ));
  assert(reglesContenuOnglet.every(correspondance => (
    !/(^|;)\s*(height|max-height)\s*:/.test(correspondance[1])
  )));
  assert(section.includes('.tableau-detail-analyse-pedagogique'));
  assert(section.includes('.navigation-rapide-analyse-pedagogique'));
  assert(section.includes('overflow-x: auto'));
  assert(section.includes('.conteneur-radar-analyse svg'));
  assert(section.includes('.conteneur-courbe-analyse'));
  assert(section.includes('@media (max-width: 1150px)'));
  assert(section.includes('(orientation: landscape)'));
});

test('le redimensionnement est natif et ne relance aucun calcul', () => {
  const c = creerContexte();
  const radar = c.creerRadarCategoriesAnalysePedagogique_(
    donneesInterface().agregatsParCategorie
  );
  const courbe = c.creerCourbeProgressionAnalysePedagogique_(
    donneesInterface().progressionChronologique
  );
  assert(radar.includes('viewBox="0 0'));
  assert(courbe.includes('viewBox="0 0'));
  assert(!sourceInterface.includes(
    "addEventListener('resize', afficherVisualisationCategories"
  ));
});

test('l’interface d’analyse ne contient aucune mutation métier', () => {
  const debut = sourceInterface.indexOf(
    'function changerOngletFicheStagiaire'
  );
  const fin = sourceInterface.indexOf(
    'function mettreAJourSuiviFicheStagiaire',
    debut
  );
  const section = sourceInterface.slice(debut, fin);
  const appelsServeur = Array.from(
    section.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)\s*\(/g),
    correspondance => correspondance[1]
  ).filter(nom => nom === 'getAnalysePedagogiqueStagiaire');
  assert.strictEqual(appelsServeur.length, 1);
  assert(!/enregistrer|supprimer|modifier|assurerFeuilleMigration_/.test(section));
  assert(!/setValues|appendRow|insertSheet/.test(sourceMoteur));
});

test('la fiche existante conserve suivi sécurisé, fermeture et touche Échap', () => {
  assert(sourceInterface.includes('.getSuiviStagiaire('));
  assert(sourceInterface.includes('obtenirJetonUtilisateurApplication()'));
  assert(sourceInterface.includes('function afficherSessionsFicheStagiaire'));
  assert(sourceInterface.includes('function afficherSuiviPedagogiqueFicheStagiaire'));
  assert(sourceInterface.includes('evenement.key === \'Escape\''));
  assert(sourceInterface.includes('onclick="fermerFicheStagiaire()"'));
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
  ' tests de l’interface d’analyse pédagogique réussis.\n' +
  'Rendu visuel simulé en ' + dureeRenduVisuelMs + ' ms.\n'
);
