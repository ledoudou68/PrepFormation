'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racine = path.resolve(__dirname, '..');
const sourceInterface = fs.readFileSync(
  path.join(racine, 'JavaScript.html'),
  'utf8'
).replace('<script>', '').replace('</script>', '');
const administrationHtml = fs.readFileSync(
  path.join(racine, 'Administration.html'),
  'utf8'
);


class FausseListeClasses {
  constructor(classes) {
    this.valeurs = new Set(classes || []);
  }

  add(...classes) {
    classes.forEach(classe => this.valeurs.add(classe));
  }

  remove(...classes) {
    classes.forEach(classe => this.valeurs.delete(classe));
  }

  contains(classe) {
    return this.valeurs.has(classe);
  }

  toggle(classe, force) {
    if (force === true) this.valeurs.add(classe);
    else if (force === false) this.valeurs.delete(classe);
    else if (this.valeurs.has(classe)) this.valeurs.delete(classe);
    else this.valeurs.add(classe);
  }
}


class FauxElement {
  constructor(id, classes) {
    this.id = id;
    this.classList = new FausseListeClasses(classes);
    this.className = (classes || []).join(' ');
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.type = 'text';
    this.dataset = {};
  }

  focus() {}
  setAttribute() {}
}


function creerEnvironnementClient() {
  let horloge = 0;
  const stockage = {};
  const appels = [];
  const traces = [];
  const elements = {};

  function ajouterElement(id, classes) {
    const element = new FauxElement(id, classes);
    elements[id] = element;
    return element;
  }

  const document = {
    body: ajouterElement('body', []),
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

  [
    'identifiantConnexionFormateur',
    'motDePasseConnexionFormateur',
    'boutonConnexionFormateur',
    'erreurConnexionFormateur',
    'ecranConnexion',
    'formulaireConnexionFormateur',
    'formulairePremiereConnexionFormateur',
    'nouveauMotDePassePremiereConnexion',
    'contenu',
    'loader',
    'toast',
    'resultatDiagnosticConnexionAdministration',
    'resultatDiagnosticChargementAccueilAdministration'
  ].forEach(id => ajouterElement(id, []));
  elements.formulairePremiereConnexionFormateur.classList.add('masque');
  elements.motDePasseConnexionFormateur.type = 'password';

  function creerExecutionServeur() {
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
      connecterFormateur(...parametres) {
        appels.push({
          nom: 'connecterFormateur',
          parametres,
          succes: this.succes,
          echec: this.echec
        });
      },
      getPage(...parametres) {
        appels.push({
          nom: 'getPage',
          parametres,
          succes: this.succes,
          echec: this.echec
        });
      },
      getDonneesTableauBordAccueil(...parametres) {
        appels.push({
          nom: 'getDonneesTableauBordAccueil',
          parametres,
          succes: this.succes,
          echec: this.echec
        });
      },
      getFavoris(...parametres) {
        appels.push({
          nom: 'getFavoris',
          parametres,
          succes: this.succes,
          echec: this.echec
        });
      }
    };
  }

  const google = { script: {} };
  Object.defineProperty(google.script, 'run', {
    get() {
      return creerExecutionServeur();
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
      if (cle === 'prepformation.jetonFormateur') horloge += 5;
    },
    removeItem(cle) {
      delete stockage[cle];
    }
  };

  const contexte = vm.createContext({
    console: {
      info(...argumentsTrace) {
        traces.push(argumentsTrace);
      },
      error() {},
      log() {}
    },
    document,
    window: {
      setTimeout() { return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {}
    },
    google,
    sessionStorage,
    performance: { now: () => horloge },
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

  contexte.appliquerDroitsInterface = () => { horloge += 2; };
  contexte.demarrerSurveillanceAdministration = () => { horloge += 1; };
  contexte.afficherLoader = () => { horloge += 1; };
  contexte.masquerLoader = () => { horloge += 1; };
  contexte.activerBoutonMenu = () => { horloge += 1; };
  contexte.fermerMenuMobile = () => { horloge += 1; };
  contexte.preparerErgonomieResponsivePage_ = () => { horloge += 1; };
  contexte.afficherTableauBordAccueil = () => { horloge += 20; };

  return {
    contexte,
    stockage,
    appels,
    traces,
    elements,
    fixerHorloge(valeur) {
      horloge = valeur;
    }
  };
}


function trouverDernierAppel(environnement, nom) {
  return environnement.appels.filter(
    appel => appel.nom === nom
  ).slice(-1)[0];
}


assert(sourceInterface.includes(
  'const MODE_DIAGNOSTIC_CONNEXION_CLIENT_ = false;'
));
assert(administrationHtml.includes('Diagnostic connexion'));
assert(administrationHtml.includes('Diagnostic chargement accueil'));
assert(administrationHtml.includes('Activer pour la prochaine connexion'));


{
  const environnement = creerEnvironnementClient();
  environnement.elements.identifiantConnexionFormateur.value =
    'alice.sans-diagnostic';
  environnement.elements.motDePasseConnexionFormateur.value =
    'mot de passe non tracé';
  environnement.contexte.soumettreConnexionFormateur({
    preventDefault() {}
  });
  const appel = trouverDernierAppel(environnement, 'connecterFormateur');
  assert(appel);
  assert.strictEqual(appel.parametres.length, 2);
  assert.strictEqual(
    vm.runInContext('etatApplication.diagnosticConnexionEnCours',
      environnement.contexte),
    null
  );
  appel.succes({
    authentifie: true,
    changementMotDePasseRequis: false,
    jeton: 'JETON_NORMAL',
    sessionUtilisateur: {
      contexte: 'FORMATEUR',
      estAdministrateur: false,
      estFormateur: true,
      droits: {}
    }
  });
  const favoris = trouverDernierAppel(environnement, 'getFavoris');
  const page = trouverDernierAppel(environnement, 'getPage');
  assert.strictEqual(favoris.parametres.length, 2);
  assert.strictEqual(page.parametres.length, 2);
  page.succes('<section>Accueil</section>');
  const accueil = trouverDernierAppel(
    environnement,
    'getDonneesTableauBordAccueil'
  );
  assert.strictEqual(accueil.parametres.length, 1);
  accueil.succes({ indicateurs: {} });
  favoris.succes([]);
  assert.strictEqual(
    vm.runInContext('etatApplication.dernierDiagnosticConnexion',
      environnement.contexte),
    null
  );
  assert.strictEqual(environnement.traces.length, 0);
}


{
  const environnement = creerEnvironnementClient();
  environnement.stockage['prepformation.diagnosticConnexionProchaine'] = '1';
  environnement.elements.identifiantConnexionFormateur.value =
    'alice.diagnostic';
  environnement.elements.motDePasseConnexionFormateur.value =
    'mot de passe diagnostic secret';

  environnement.contexte.soumettreConnexionFormateur({
    preventDefault() {}
  });
  const connexion = trouverDernierAppel(
    environnement,
    'connecterFormateur'
  );
  assert.strictEqual(connexion.parametres.length, 3);
  assert.strictEqual(connexion.parametres[2].actif, true);
  assert.strictEqual(connexion.parametres[2].modeClientExplicite, true);
  assert.strictEqual(
    environnement.stockage['prepformation.diagnosticConnexionProchaine'],
    undefined
  );

  environnement.fixerHorloge(120);
  connexion.succes({
    authentifie: true,
    changementMotDePasseRequis: false,
    jeton: 'JETON_FORMATEUR_SECRET',
    sessionUtilisateur: {
      contexte: 'FORMATEUR',
      estAdministrateur: false,
      estFormateur: true,
      droits: {}
    },
    diagnosticConnexion: {
      serveur: {
        normalisationIdentifiantMs: 1,
        rechercheCompteUtilisateurMs: 12,
        controleBlocageMs: 4,
        lectureSelHashMs: 1,
        derivationPbkdf2PepperMs: 85,
        comparaisonVerificateurMs: 1,
        miseAJourConnexionMs: 9,
        creationSessionMs: 2,
        ecritureScriptPropertiesMs: 8,
        constructionContexteUtilisateurMs: 2,
        totalServeurMs: 110,
        hash: 'HASH_INTERDIT',
        sel: 'SEL_INTERDIT',
        pepper: 'PEPPER_INTERDIT'
      }
    }
  });

  const chargementFavoris = trouverDernierAppel(
    environnement,
    'getFavoris'
  );
  assert(chargementFavoris);
  assert.strictEqual(chargementFavoris.parametres.length, 3);
  const chargementPage = trouverDernierAppel(environnement, 'getPage');
  assert(chargementPage);
  assert.strictEqual(chargementPage.parametres.length, 3);
  environnement.fixerHorloge(250);
  chargementPage.succes({
    html: '<section>Accueil</section>',
    diagnosticAccueil: {
      operation: 'CHARGEMENT_FRAGMENT_HTML',
      verificationAccesMs: 15,
      constructionHtmlMs: 25,
      totalServeurMs: 40,
      appelsAutresServices: [{
        operation: 'VERIFICATION_ACCES_PAGE',
        totalServeurMs: 15
      }]
    }
  });

  const chargementAccueil = trouverDernierAppel(
    environnement,
    'getDonneesTableauBordAccueil'
  );
  assert(chargementAccueil);
  assert.strictEqual(chargementAccueil.parametres.length, 2);
  environnement.fixerHorloge(600);
  chargementAccueil.succes({
    indicateurs: {},
    diagnosticAccueil: {
      operation: 'DONNEES_TABLEAU_BORD_ACCUEIL',
      ouvertureSpreadsheetMs: 30,
      recherchesMs: 20,
      filtragesMs: 10,
      trisMs: 5,
      transformationsMs: 35,
      totalServeurMs: 180,
      lecturesFeuilles: [{
        feuille: 'SESSIONS',
        getSheetByNameMs: 5,
        getDataRangeMs: 8,
        getValuesMs: 50,
        constructionTableMs: 2,
        totalLectureMs: 65
      }],
      appelsAutresServices: [{
        operation: 'SYNCHRONISATION_STATUTS_STAGIAIRES',
        totalServeurMs: 70,
        lecturesFeuilles: [{
          feuille: 'STAGIAIRES',
          totalLectureMs: 40
        }]
      }],
      etapesTraitement: [{
        operation: 'Tri des séances réalisées',
        categorie: 'trisMs',
        dureeMs: 5
      }]
    }
  });

  environnement.fixerHorloge(680);
  chargementFavoris.succes({
    favoris: [],
    diagnosticAccueil: {
      operation: 'CHARGEMENT_FAVORIS',
      ouvertureSpreadsheetMs: 10,
      totalServeurMs: 90,
      lecturesFeuilles: [{
        feuille: 'FAVORIS',
        totalLectureMs: 55
      }]
    }
  });

  const rapport = vm.runInContext(
    'etatApplication.dernierDiagnosticConnexion',
    environnement.contexte
  );
  assert.strictEqual(rapport.interfaceUtilisable, true);
  assert.strictEqual(rapport.client.googleScriptRunMs, 120);
  assert.strictEqual(rapport.client.receptionReponseMs, 120);
  assert.strictEqual(rapport.client.stockageJetonSessionMs, 5);
  assert(
    rapport.client.googleScriptRunMs >= rapport.serveur.totalServeurMs
  );
  assert(rapport.client.chargementContexteUtilisateurMs >= 0);
  assert(rapport.client.chargementAccueilMs > 0);
  assert(rapport.client.renduClientMs > 0);
  assert(
    rapport.client.totalJusquaInterfaceUtilisableMs >=
      rapport.client.receptionReponseMs
  );
  assert(
    rapport.client.totalJusquaInterfaceUtilisableMs >=
      rapport.client.chargementAccueilMs
  );
  assert.strictEqual(
    vm.runInContext('etatApplication.diagnosticConnexionEnCours',
      environnement.contexte),
    null
  );
  assert.strictEqual(rapport.accueil.operations.length, 3);
  assert.deepStrictEqual(
    Array.from(rapport.accueil.operations, operation => operation.ordre),
    [1, 2, 3]
  );
  assert.deepStrictEqual(
    Array.from(rapport.accueil.operations, operation => operation.nom),
    [
      'Chargement des favoris',
      'Chargement du fragment HTML Accueil',
      'Chargement des données du tableau de bord'
    ]
  );
  assert.strictEqual(
    rapport.accueil.operations[0].modeExecution,
    'PARALLELE_AVEC_ACCUEIL'
  );
  assert.strictEqual(
    rapport.accueil.operations[1].modeExecution,
    'SEQUENTIEL_ETAPE_1'
  );
  assert.strictEqual(
    rapport.accueil.operations[2].modeExecution,
    'SEQUENTIEL_APRES_FRAGMENT_HTML'
  );
  assert.strictEqual(
    rapport.accueil.operations[2].serveur.lecturesFeuilles[0].feuille,
    'SESSIONS'
  );
  assert.strictEqual(
    rapport.accueil.tempsServeurCumuleMs,
    310
  );
  assert(rapport.accueil.tempsGoogleScriptRunCumuleMs > 0);
  assert(rapport.accueil.tempsTraitementsClientMs > 0);
  assert(rapport.accueil.tempsTotalChargementAccueilMs > 0);
  assert(
    environnement.elements
      .resultatDiagnosticChargementAccueilAdministration
      .innerHTML.includes('Temps serveur cumulé')
  );

  const traceJson = JSON.stringify(environnement.traces);
  [
    'mot de passe diagnostic secret',
    'JETON_FORMATEUR_SECRET',
    'alice.diagnostic',
    'HASH_INTERDIT',
    'SEL_INTERDIT',
    'PEPPER_INTERDIT'
  ].forEach(secret => assert(!traceJson.includes(secret)));
  assert.strictEqual(environnement.traces.length, 1);
}


{
  const environnement = creerEnvironnementClient();
  environnement.stockage['prepformation.jetonAdministration'] =
    'JETON_ADMINISTRATEUR';
  environnement.contexte.__sessionAdmin = {
    contexte: 'ADMINISTRATEUR',
    estAdministrateur: true,
    estFormateur: false,
    droits: {}
  };
  vm.runInContext(
    'etatApplication.sessionUtilisateur = __sessionAdmin;' +
    'activerDiagnosticConnexionProchaineConnexion();',
    environnement.contexte
  );
  assert.strictEqual(
    environnement.stockage['prepformation.diagnosticConnexionProchaine'],
    '1'
  );
}


console.log(
  '✓ diagnostic connexion facultatif, chronologie client et absence de fuite'
);
