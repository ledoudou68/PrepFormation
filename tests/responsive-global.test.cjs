'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.join(__dirname, '..');
const lire = fichier => fs.readFileSync(path.join(racine, fichier), 'utf8');
const css = lire('CSS.html');
const indexHtml = lire('Index.html');
const interfaceJs = lire('JavaScript.html');
const metadonnees = lire('ApplicationMetadataService.js');
const uiService = lire('UI.js');

const modulesAudites = [
  'Accueil.html',
  'Stagiaires.html',
  'Formateurs.html',
  'Sessions.html',
  'Referentiel.html',
  'Indemnisation.html',
  'Statistiques.html',
  'Calendrier.html',
  'AssistantPedagogique.html',
  'Administration.html'
];

const tests = [];
function test(nom, traitement) {
  tests.push({ nom, traitement });
}

function extraireFonction(source, nom) {
  const debut = source.indexOf('function ' + nom + '(');
  assert.notStrictEqual(debut, -1, 'fonction absente : ' + nom);
  const accolade = source.indexOf('{', debut);
  let profondeur = 0;
  for (let i = accolade; i < source.length; i++) {
    if (source[i] === '{') profondeur++;
    if (source[i] === '}') profondeur--;
    if (profondeur === 0) return source.slice(debut, i + 1);
  }
  throw new Error('fonction incomplète : ' + nom);
}

function extraireBlocCss(source, marqueur) {
  const debut = source.indexOf(marqueur);
  assert.notStrictEqual(debut, -1, 'bloc CSS absent : ' + marqueur);
  const accolade = source.indexOf('{', debut);
  let profondeur = 0;
  for (let i = accolade; i < source.length; i++) {
    if (source[i] === '{') profondeur++;
    if (source[i] === '}') profondeur--;
    if (profondeur === 0) return source.slice(debut, i + 1);
  }
  throw new Error('bloc CSS incomplet : ' + marqueur);
}

function creerClasse(initiales) {
  const valeurs = new Set(initiales || []);
  return {
    add: valeur => valeurs.add(valeur),
    remove: valeur => valeurs.delete(valeur),
    contains: valeur => valeurs.has(valeur),
    toggle: (valeur, force) => {
      if (force === undefined) {
        force = !valeurs.has(valeur);
      }
      if (force) valeurs.add(valeur);
      else valeurs.delete(valeur);
      return force;
    }
  };
}

test('tous les modules audités restent présents dans une page commune', () => {
  modulesAudites.forEach(fichier => {
    const html = lire(fichier);
    assert(html.includes('class="page'), fichier + ' sans conteneur page');
  });
});

test('le viewport est unique, exact et ajouté par HtmlOutput', () => {
  const balisesViewport = indexHtml.match(
    /<meta\s+name="viewport"\s+content="[^"]+">/g
  ) || [];
  assert.strictEqual(balisesViewport.length, 1);
  assert.strictEqual(
    balisesViewport[0],
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  );

  const metaTags = [];
  const sortie = {
    addMetaTag(nom, contenu) {
      metaTags.push({ nom, contenu });
      return this;
    },
    setTitle() { return this; }
  };
  const contexte = {
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => sortie }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' })
    },
    recupererRestaurationInterrompueAuDemarrage_: () => ({
      operationActive: true
    }),
    executerMigrationsAuDemarrage_: () => {
      throw new Error('migration inattendue');
    }
  };
  vm.createContext(contexte);
  vm.runInContext(uiService, contexte);
  const resultat = contexte.doGet();
  assert.strictEqual(resultat, sortie);
  assert.deepStrictEqual(metaTags, [{
    nom: 'viewport',
    contenu: 'width=device-width, initial-scale=1, viewport-fit=cover'
  }]);
});

test('les paliers couvrent 320, 375, 430, tablette et desktop', () => {
  assert(css.includes('@media (max-width: 360px)'));
  assert(css.includes('@media (max-width: 430px)'));
  assert(css.includes('@media (max-width: 700px)'));
  assert(css.includes('@media (max-width: 900px)'));
  assert(css.includes('@media (max-height: 520px) and (orientation: landscape)'));
  assert(css.includes('.menu-lateral {\n  width: 240px;'));
});

test('le menu compact expose son état et un voile fermable', () => {
  assert(indexHtml.includes('id="boutonMenuMobile"'));
  assert(indexHtml.includes('aria-controls="menuLateral"'));
  assert(indexHtml.includes('aria-expanded="false"'));
  assert(indexHtml.includes('id="voileMenuMobile"'));
  assert(css.includes('body.menu-mobile-ouvert'));
});

test('le layout mobile ne réserve aucune largeur à la sidebar', () => {
  const correctif = css.slice(css.indexOf(
    'ERGONOMIE RESPONSIVE GLOBALE 1.9.2'
  ));
  assert(correctif.includes('@media (max-width: 900px)'));
  assert(correctif.includes(
    '.application {\n    width: 100%;\n    max-width: 100%;\n    display: block;'
  ));
  assert(correctif.includes(
    '.menu-lateral {\n    position: fixed;'
  ));
  assert(correctif.includes('display: none;\n    visibility: hidden;'));
  assert(correctif.includes(
    '.menu-lateral.ouvert {\n    left: 0;\n    display: block;'
  ));
  assert(correctif.includes(
    '.contenu-principal {\n    width: 100%;\n    max-width: 100%;\n    margin: 0;\n    flex: none;'
  ));

  const telephone = extraireBlocCss(
    correctif,
    '@media (max-width: 700px)'
  );
  assert(telephone.includes(
    '.application {\n    width: 100%;\n    max-width: 100%;\n    display: block;'
  ));
  assert(telephone.includes(
    '.bouton-menu-mobile {\n    display: inline-flex;'
  ));
  assert(telephone.includes(
    '.menu-lateral:not(.ouvert) {\n    display: none;'
  ));
  assert(telephone.includes(
    '.contenu-principal {\n    width: 100%;\n    max-width: 100%;\n    margin: 0;'
  ));
});

test('le menu mobile s’ouvre, se ferme et synchronise les attributs ARIA', () => {
  const menu = { classList: creerClasse() };
  const voile = { classList: creerClasse(['masque']) };
  const bouton = {
    attributs: {},
    setAttribute(nom, valeur) { this.attributs[nom] = valeur; }
  };
  const body = { classList: creerClasse() };
  const elements = {
    menuLateral: menu,
    voileMenuMobile: voile,
    boutonMenuMobile: bouton
  };
  const document = {
    body,
    getElementById: id => elements[id] || null
  };
  const source = [
    extraireFonction(interfaceJs, 'basculerMenu'),
    extraireFonction(interfaceJs, 'fermerMenuMobile'),
    'return { basculerMenu, fermerMenuMobile };'
  ].join('\n');
  const api = Function('document', source)(document);

  api.basculerMenu();
  assert(menu.classList.contains('ouvert'));
  assert(body.classList.contains('menu-mobile-ouvert'));
  assert(!voile.classList.contains('masque'));
  assert.strictEqual(bouton.attributs['aria-expanded'], 'true');

  api.fermerMenuMobile();
  assert(!menu.classList.contains('ouvert'));
  assert(!body.classList.contains('menu-mobile-ouvert'));
  assert(voile.classList.contains('masque'));
  assert.strictEqual(bouton.attributs['aria-expanded'], 'false');
});

test('la topbar téléphone garde menu, recherche, favoris et administration', () => {
  [
    'boutonMenuMobile',
    'conteneurRechercheGlobale',
    'conteneurFavoris',
    'boutonAccesAdministrateur'
  ].forEach(id => assert(indexHtml.includes('id="' + id + '"')));
  assert(css.includes('.libelle-acces-administration'));
  assert(css.includes('.icone-acces-administration'));
  assert(indexHtml.includes('id="identiteUtilisateurMenuMobile"'));
  assert(interfaceJs.includes(
    "identiteMenuMobile.textContent = identite.textContent"
  ));
  assert(css.includes('flex-wrap: nowrap'));
});

test('recherche et favoris disposent d’un affichage mobile plein écran', () => {
  assert(css.includes('.panneau-recherche-globale'));
  assert(css.includes('.panneau-favoris'));
  assert(css.includes('.recherche-globale-mobile-ouverte'));
  assert(css.includes('height: 100dvh'));
  assert(indexHtml.includes('aria-label="Fermer les favoris"'));
  assert(interfaceJs.includes('event.stopPropagation()'));
});

test('les fiches stagiaire et séance respectent le viewport dynamique', () => {
  assert(interfaceJs.includes('fiche-consultation-overlay'));
  assert(interfaceJs.includes('fiche-session-overlay'));
  assert(css.includes('.fiche-consultation-overlay,\n  .fiche-consultation {\n    height: 100dvh;'));
  assert(css.includes('var(--marge-sure-haut)'));
  assert(css.includes('var(--marge-sure-bas)'));
});

test('les modales gardent un en-tête et un pied accessibles', () => {
  assert(css.includes('.modal-entete {\n  position: sticky'));
  assert(css.includes('.modal-pied {\n  position: sticky'));
  assert(css.includes('max-height: calc(100dvh - var(--marge-sure-haut))'));
  assert(css.includes('flex-direction: column-reverse'));
});

test('les formulaires séance restent typés et passent sur une colonne', () => {
  const sessions = lire('Sessions.html');
  assert(sessions.includes('type="date"'));
  assert(sessions.includes('type="time"'));
  assert(sessions.includes('section-formulaire-session'));
  assert(css.includes('.grille-formulaire,\n  .grille-filtres'));
  assert(css.includes('font-size: 16px'));
});

test('Sessions utilise des cartes dédiées sous 700 px', () => {
  const sessions = lire('Sessions.html');
  assert(sessions.includes('class="tableau-responsive tableau-responsive-sessions"'));
  assert(sessions.includes('id="listeCartesSessions"'));
  const moduleSessions = css.slice(css.indexOf('MODULE SESSIONS'));
  const telephoneSessions = extraireBlocCss(
    moduleSessions,
    '@media (max-width: 700px)'
  );
  assert(telephoneSessions.includes(
    '.tableau-responsive-sessions {\n    display: none;'
  ));
  assert(telephoneSessions.includes(
    '.liste-cartes-sessions-mobile {\n    display: grid;'
  ));

  const elements = {
    corpsTableauSessions: { innerHTML: '' },
    listeCartesSessions: { innerHTML: '' },
    compteurSessions: { textContent: '' }
  };
  const document = {
    getElementById: id => elements[id] || null
  };
  const etatApplication = {
    sessions: [{
      idSession: 'S1',
      date: '2026-08-08',
      heureDebut: '09:00',
      heureFin: '11:00',
      formation: 'EQ PS',
      formateurs: ['DUPONT Marc'],
      nombreStagiaires: 3,
      dureeHeures: 2,
      remarques: 'RAS'
    }]
  };
  const source = extraireFonction(interfaceJs, 'afficherListeSessions');
  const afficher = Function(
    'document',
    'etatApplication',
    'echapperHtml',
    'afficherDateFrancaise',
    'formaterHeuresFormation',
    source + '; return afficherListeSessions;'
  )(
    document,
    etatApplication,
    valeur => String(valeur),
    () => '08/08/2026',
    () => '2 h'
  );
  afficher();
  const cartes = elements.listeCartesSessions.innerHTML;
  assert(cartes.includes('carte-session-mobile'));
  assert(cartes.includes('08/08/2026'));
  assert(cartes.includes('EQ PS'));
  assert(cartes.includes('09:00 – 11:00'));
  assert(cartes.includes('2 h'));
  assert(cartes.includes('>3</strong>'));
  assert(cartes.includes('Consulter'));
});

test('la prise de photo mobile conserve capture et formats adaptés', () => {
  const stagiaires = lire('Stagiaires.html');
  assert(stagiaires.includes('accept="image/*"'));
  assert(stagiaires.includes('capture="environment"'));
  assert(stagiaires.includes('image/heic'));
});

test('les tableaux conservent toutes leurs colonnes avec défilement accessible', () => {
  assert(css.includes('overscroll-behavior-inline: contain'));
  assert(css.includes('-webkit-overflow-scrolling: touch'));
  assert(css.includes('.tableau-responsive:focus-visible'));
  assert(interfaceJs.includes("conteneur.setAttribute('tabindex', '0')"));
  assert(interfaceJs.includes("conteneur.setAttribute('role', 'region')"));
});

test('l’assistant d’accessibilité des tableaux ne lance aucun appel serveur', () => {
  const source = extraireFonction(
    interfaceJs,
    'preparerErgonomieResponsivePage_'
  );
  assert(!source.includes('google.script.run'));
  assert(!source.includes('addEventListener'));
  assert(source.includes('aria-label'));
});

test('le calendrier conserve grille et agenda sans appel au changement visuel', () => {
  const calendrier = lire('Calendrier.html');
  assert(calendrier.includes('class="calendrier-grille-conteneur"'));
  assert(calendrier.includes('agendaCalendrier'));
  assert(css.includes('.calendrier-grille-conteneur {\n    display: none;'));
  assert(css.includes('.agenda-calendrier {\n    display: block;'));
  assert(!interfaceJs.includes('addEventListener(\'orientationchange\''));
});

test('statistiques, analyse et assistant conservent des visuels redimensionnables', () => {
  assert(lire('Statistiques.html').includes('zone-graphique-statistiques'));
  assert(lire('AssistantPedagogique.html').includes('graphiqueRepartitionAssistant'));
  assert(interfaceJs.includes('svg-radar-analyse'));
  assert(css.includes('svg,\ncanvas {\n  height: auto;'));
  assert(css.includes('touch-action: pan-x'));
});

test('l’administration et les actions sensibles restent dans les composants communs', () => {
  const administration = lire('Administration.html');
  assert(administration.includes('page-administration'));
  assert(administration.includes('modal-contenu'));
  assert(indexHtml.includes('actions-acces-administration'));
  assert(css.includes('.actions-acces-administration {\n    width: auto;'));
});

test('les cibles tactiles importantes utilisent un minimum commun de 44 px', () => {
  assert(css.includes('--cible-tactile: 44px'));
  assert(css.includes('@media (pointer: coarse)'));
  [
    '.bouton-fermer-modal',
    '.bouton-fermer-fiche',
    '.bouton-favori',
    '.bouton-action-referentiel',
    '.bouton-consulter-session',
    '.bouton-ajouter-calendrier'
  ].forEach(selecteur => assert(css.includes(selecteur)));
});

test('les protections globales empêchent le débordement de la page', () => {
  assert(css.includes('html {\n  overflow-x: hidden'));
  assert(css.includes('body {\n  overflow-x: hidden'));
  assert(css.includes('.contenu-principal,\n.page'));
  assert(css.includes('min-width: 0'));
});

test('les safe areas iOS sont centralisées et utilisées', () => {
  [
    'safe-area-inset-top',
    'safe-area-inset-right',
    'safe-area-inset-bottom',
    'safe-area-inset-left'
  ].forEach(valeur => assert(css.includes(valeur)));
  assert(css.includes('@supports (height: 100dvh)'));
});

test('la passe responsive ne crée ni migration ni nouvelle feuille', () => {
  assert(!interfaceJs.includes('migrationResponsive'));
  assert(!interfaceJs.includes('feuilleResponsive'));
  assert(!css.includes('@import'));
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
    process.stdout.write('✓ ' + nom + '\n');
  } catch (erreur) {
    process.stderr.write('✗ ' + nom + '\n');
    throw erreur;
  }
});

process.stdout.write(
  '\n' + reussis + '/' + tests.length +
  ' tests responsive globaux réussis.\n'
);
