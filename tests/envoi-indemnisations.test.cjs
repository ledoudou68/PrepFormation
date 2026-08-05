'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'EnvoiIndemnisationsService.js'),
  'utf8'
);

function creerContexte() {
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
    isNaN,
    Utilities: {
      getUuid: () => 'uuid-test',
      formatDate: () => '01/08/2026 12:00:00'
    },
    Session: {
      getScriptTimeZone: () => 'Europe/Paris'
    },
    MailApp: {
      sendEmail: () => {}
    }
  };
  vm.createContext(contexte);
  vm.runInContext(source, contexte, {
    filename: 'EnvoiIndemnisationsService.js'
  });
  return contexte;
}

function prestation(options) {
  options = options || {};
  const nom = options.nom || 'Martin';
  const prenom = options.prenom || 'Alice';
  return {
    idPrestation: options.idPrestation || 'P1',
    idSession: options.idSession || 'S1',
    idFormateur: options.idFormateur || 'F1',
    formateur: {
      nom,
      prenom,
      nomComplet: prenom + ' ' + nom,
      email: options.email || 'alice@example.fr'
    },
    dateSession: options.dateSession || '2026-08-01',
    formation: options.formation || 'EQ PS',
    heureDebut: options.heureDebut || '09:00',
    heureFin: options.heureFin || '10:30',
    dureeHeures: options.dureeHeures == null
      ? 1.5
      : options.dureeHeures,
    nombreStagiaires: options.nombreStagiaires == null
      ? 2
      : options.nombreStagiaires,
    remarqueAdministrative: options.remarque || '',
    referenceExistante: options.reference || ''
  };
}

function demande() {
  return {
    idEnvoi: 'envoi-1',
    idsPrestations: ['P1', 'P2'],
    destinataire: 'chef@example.fr',
    copies: ['alice@example.fr'],
    objet: 'Demande août 2026',
    corpsTexte: 'Texte',
    corpsHtml: '<p>HTML</p>',
    nomCentre: 'Centre test',
    nombrePrestations: 2,
    nombreFormateurs: 1,
    nombreSeances: 2,
    volumeHeures: 3,
    volumeHeuresLibelle: '3 h',
    reference: 'REF-1'
  };
}

const tests = [];
function test(nom, traitement) {
  tests.push({ nom, traitement });
}

test('un seul formateur et une durée amicale', () => {
  const c = creerContexte();
  const resume = c.construireResumePrestationsEnvoiIndemnisation_([
    prestation()
  ]);
  assert.strictEqual(resume.nombreFormateurs, 1);
  assert.strictEqual(resume.nombreSeances, 1);
  assert.strictEqual(resume.nombrePrestations, 1);
  assert.strictEqual(resume.volumeHeures, 1.5);
  assert.strictEqual(resume.volumeHeuresLibelle, '1 h 30');
});

test('plusieurs formateurs sont triés par nom', () => {
  const c = creerContexte();
  const resume = c.construireResumePrestationsEnvoiIndemnisation_([
    prestation({ idFormateur: 'F2', nom: 'Zulu', prenom: 'Zoé' }),
    prestation({ idFormateur: 'F1', nom: 'Alpha', prenom: 'Anne' })
  ]);
  assert.deepStrictEqual(
    Array.from(resume.groupes, groupe => groupe.nom),
    ['Alpha', 'Zulu']
  );
});

test('plusieurs prestations du même formateur calculent les totaux', () => {
  const c = creerContexte();
  const resume = c.construireResumePrestationsEnvoiIndemnisation_([
    prestation({ idPrestation: 'P1', idSession: 'S1', dureeHeures: 1 }),
    prestation({ idPrestation: 'P2', idSession: 'S2', dureeHeures: 1.5 })
  ]);
  assert.strictEqual(resume.nombreFormateurs, 1);
  assert.strictEqual(resume.groupes[0].totalHeures, 2.5);
  assert.strictEqual(resume.groupes[0].totalHeuresLibelle, '2 h 30');
  assert.strictEqual(resume.volumeHeures, 2.5);
});

test('les séances sont dédupliquées dans les compteurs', () => {
  const c = creerContexte();
  const resume = c.construireResumePrestationsEnvoiIndemnisation_([
    prestation({ idPrestation: 'P1', idSession: 'S1' }),
    prestation({ idPrestation: 'P2', idSession: 'S1' })
  ]);
  assert.strictEqual(resume.nombrePrestations, 2);
  assert.strictEqual(resume.nombreSeances, 1);
  assert.strictEqual(resume.groupes[0].nombreSeances, 1);
});

test('les prestations sont triées par date puis heure', () => {
  const c = creerContexte();
  const resume = c.construireResumePrestationsEnvoiIndemnisation_([
    prestation({ idPrestation: 'P3', dateSession: '2026-08-03' }),
    prestation({ idPrestation: 'P2', dateSession: '2026-08-01', heureDebut: '14:00' }),
    prestation({ idPrestation: 'P1', dateSession: '2026-08-01', heureDebut: '08:00' })
  ]);
  assert.deepStrictEqual(
    Array.from(resume.groupes[0].prestations, p => p.idPrestation),
    ['P1', 'P2', 'P3']
  );
});

test('les adresses en copie sont normalisées et dédupliquées', () => {
  const c = creerContexte();
  const copies = c.dedupliquerEmailsEnvoiIndemnisation_([
    'ALICE@example.fr',
    'alice@example.fr ',
    'chef@example.fr',
    'bob@example.fr'
  ], 'CHEF@example.fr');
  assert.deepStrictEqual(Array.from(copies), [
    'alice@example.fr',
    'bob@example.fr'
  ]);
});

test('un formateur sans e-mail est nommé dans le blocage', () => {
  const c = creerContexte();
  c.valeursUniquesIndemnisation_ = ids => ids;
  c.lireParametresEmailIndemnisation_ = () => ({
    emailChefCentre: 'chef@example.fr',
    nomChefCentre: 'Chef',
    nomCentre: 'Centre',
    objetMailIndemnisation: 'Demande – {{PERIODE}}'
  });
  c.lireContextePrestationsEnvoiIndemnisation_ = () => ({
    prestations: [prestation()],
    formateurs: [{ nomComplet: 'Alice Martin', email: '' }]
  });
  assert.throws(
    () => c.construireDemandeIndemnisationEmail_(['P1'], {
      idEnvoi: 'envoi-1'
    }),
    /Alice Martin.*module Formateurs/
  );
});

test('un formateur avec une adresse invalide est nommé dans le blocage', () => {
  const c = creerContexte();
  c.valeursUniquesIndemnisation_ = ids => ids;
  c.lireParametresEmailIndemnisation_ = () => ({
    emailChefCentre: 'chef@example.fr',
    nomChefCentre: 'Chef',
    nomCentre: 'Centre',
    objetMailIndemnisation: 'Demande – {{PERIODE}}'
  });
  c.lireContextePrestationsEnvoiIndemnisation_ = () => ({
    prestations: [prestation()],
    formateurs: [{ nomComplet: 'Bob Durand', email: 'adresse-invalide' }]
  });
  assert.throws(
    () => c.construireDemandeIndemnisationEmail_(['P1'], {
      idEnvoi: 'envoi-1'
    }),
    /Bob Durand.*module Formateurs/
  );
});

test('l’adresse absente du chef de centre bloque la préparation', () => {
  const c = creerContexte();
  c.valeursUniquesIndemnisation_ = ids => ids;
  c.lireParametresEmailIndemnisation_ = () => ({
    emailChefCentre: ''
  });
  assert.throws(
    () => c.construireDemandeIndemnisationEmail_(['P1'], {
      idEnvoi: 'envoi-1'
    }),
    /chef de centre.*pas configurée/
  );
});

test('une adresse invalide bloque la préparation', () => {
  const c = creerContexte();
  c.valeursUniquesIndemnisation_ = ids => ids;
  c.lireParametresEmailIndemnisation_ = () => ({
    emailChefCentre: 'adresse-invalide'
  });
  assert.throws(
    () => c.construireDemandeIndemnisationEmail_(['P1'], {
      idEnvoi: 'envoi-1'
    }),
    /invalide/
  );
});

test('une prestation déjà indemnisée est refusée', () => {
  const c = creerContexte();
  assert.throws(
    () => c.validerEligibilitePrestationEnvoiIndemnisation_(
      'P9', 'Indemnisée', '', 'envoi-1', true
    ),
    /déjà indemnisée/
  );
});

test('un envoi réussi met à jour l’historique puis les prestations', () => {
  const c = creerContexte();
  const ordre = [];
  let optionsMail = null;
  c.trouverHistoriqueEnvoiIndemnisation_ = () => null;
  c.creerHistoriqueEnvoiIndemnisation_ = (d, s, statut) => {
    ordre.push(statut);
    return { idEnvoi: d.idEnvoi, numeroLigne: 2 };
  };
  c.MailApp.sendEmail = options => {
    optionsMail = options;
    ordre.push('MAIL');
  };
  c.mettreAJourHistoriqueEnvoiIndemnisation_ = (h, valeurs) => {
    ordre.push(valeurs.STATUT_ENVOI);
  };
  c.mettreAJourPrestationsApresEnvoi_ = () => ordre.push('PRESTATIONS');
  c.journaliserActionSensible_ = () => ordre.push('AUDIT');

  const resultat = c.envoyerDemandeIndemnisationEmailInterne_(
    demande(),
    { identifiantHistorique: 'SESSION_ADMIN:test' }
  );
  assert.strictEqual(resultat.succes, true);
  assert.strictEqual(optionsMail.to, 'chef@example.fr');
  assert.strictEqual(optionsMail.cc, 'alice@example.fr');
  assert(optionsMail.htmlBody);
  assert(optionsMail.body);
  assert.deepStrictEqual(ordre, [
    'EN_COURS_AVANT_ENVOI',
    'MAIL',
    'EMAIL_ENVOYE_MAJ_EN_COURS',
    'PRESTATIONS',
    'TERMINE',
    'AUDIT'
  ]);
});

test('un échec MailApp ne modifie aucune prestation', () => {
  const c = creerContexte();
  const statuts = [];
  let prestationsModifiees = false;
  c.trouverHistoriqueEnvoiIndemnisation_ = () => null;
  c.creerHistoriqueEnvoiIndemnisation_ = d => ({
    idEnvoi: d.idEnvoi,
    numeroLigne: 2
  });
  c.MailApp.sendEmail = () => { throw new Error('SMTP indisponible'); };
  c.mettreAJourHistoriqueEnvoiIndemnisation_ = (h, valeurs) => {
    statuts.push(valeurs.STATUT_ENVOI);
  };
  c.mettreAJourPrestationsApresEnvoi_ = () => {
    prestationsModifiees = true;
  };
  c.journaliserActionSensible_ = () => {};
  assert.throws(
    () => c.envoyerDemandeIndemnisationEmailInterne_(
      demande(),
      { identifiantHistorique: 'SESSION_ADMIN:test' }
    ),
    /Aucune prestation n’a été modifiée/
  );
  assert.strictEqual(prestationsModifiees, false);
  assert.deepStrictEqual(statuts, ['ECHEC_ENVOI']);
});

test('la réexécution du même ID n’envoie pas un second e-mail', () => {
  const c = creerContexte();
  let appelsMail = 0;
  c.trouverHistoriqueEnvoiIndemnisation_ = () => ({
    statut: 'TERMINE'
  });
  c.verifierPrestationsAssocieesEnvoiIndemnisation_ = () => ({
    toutesAssociees: true
  });
  c.MailApp.sendEmail = () => { appelsMail++; };
  const resultat = c.envoyerDemandeIndemnisationEmailInterne_(
    demande(),
    { identifiantHistorique: 'SESSION_ADMIN:test' }
  );
  assert.strictEqual(resultat.rejouee, true);
  assert.strictEqual(appelsMail, 0);
});

test('un double clic avec opération en cours est bloqué sans renvoi', () => {
  const c = creerContexte();
  let appelsMail = 0;
  c.trouverHistoriqueEnvoiIndemnisation_ = () => ({
    statut: 'EN_COURS_AVANT_ENVOI'
  });
  c.verifierPrestationsAssocieesEnvoiIndemnisation_ = () => ({
    toutesAssociees: false
  });
  c.MailApp.sendEmail = () => { appelsMail++; };
  assert.throws(
    () => c.envoyerDemandeIndemnisationEmailInterne_(
      demande(),
      { identifiantHistorique: 'SESSION_ADMIN:test' }
    ),
    /Aucun nouvel e-mail n’a été émis/
  );
  assert.strictEqual(appelsMail, 0);
});

test('un échec après l’envoi exige une régularisation sans renvoi', () => {
  const c = creerContexte();
  const statuts = [];
  let appelsMail = 0;
  c.trouverHistoriqueEnvoiIndemnisation_ = () => null;
  c.creerHistoriqueEnvoiIndemnisation_ = d => ({
    idEnvoi: d.idEnvoi,
    numeroLigne: 2
  });
  c.MailApp.sendEmail = () => { appelsMail++; };
  c.mettreAJourHistoriqueEnvoiIndemnisation_ = (h, valeurs) => {
    statuts.push(valeurs.STATUT_ENVOI);
  };
  c.mettreAJourPrestationsApresEnvoi_ = () => {
    throw new Error('écriture impossible');
  };
  assert.throws(
    () => c.envoyerDemandeIndemnisationEmailInterne_(
      demande(),
      { identifiantHistorique: 'SESSION_ADMIN:test' }
    ),
    /Ne renvoie pas.*régularisation.*envoi-1/
  );
  assert.strictEqual(appelsMail, 1);
  assert.deepStrictEqual(statuts, [
    'EMAIL_ENVOYE_MAJ_EN_COURS',
    'REGULARISATION_REQUISE'
  ]);
});

test('l’historique durable est créé avant MailApp', () => {
  const c = creerContexte();
  const ordre = [];
  c.trouverHistoriqueEnvoiIndemnisation_ = () => null;
  c.creerHistoriqueEnvoiIndemnisation_ = (d, s, statut) => {
    ordre.push('HISTORIQUE:' + statut);
    return { idEnvoi: d.idEnvoi, numeroLigne: 2 };
  };
  c.MailApp.sendEmail = () => ordre.push('MAIL');
  c.mettreAJourHistoriqueEnvoiIndemnisation_ = () => {};
  c.mettreAJourPrestationsApresEnvoi_ = () => {};
  c.journaliserActionSensible_ = () => {};
  c.envoyerDemandeIndemnisationEmailInterne_(
    demande(),
    { identifiantHistorique: 'SESSION_ADMIN:test' }
  );
  assert.deepStrictEqual(ordre.slice(0, 2), [
    'HISTORIQUE:EN_COURS_AVANT_ENVOI',
    'MAIL'
  ]);
});

test('le mail généré contient les tableaux, totaux et versions HTML/texte', () => {
  const c = creerContexte();
  const resume = c.construireResumePrestationsEnvoiIndemnisation_([
    prestation()
  ]);
  const rendu = c.rendreCorpsDemandeIndemnisation_(resume, {
    nomChefCentre: 'Dupont',
    nomCentre: 'Centre Test',
    introduction: 'Introduction',
    remarqueFinale: 'Conclusion',
    reference: 'REF-42'
  });
  assert(rendu.html.includes('<table'));
  assert(rendu.html.includes('Nombre de stagiaires'));
  assert(rendu.html.includes('Récapitulatif général'));
  assert(rendu.html.includes('REF-42'));
  assert(rendu.texte.includes('Alice Martin'));
  assert(rendu.texte.includes('1 h 30'));
});

test('la migration 4 est versionnée, complète et idempotente', () => {
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '..', 'MigrationService.js'),
    'utf8'
  );
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
    isNaN,
    Utilities: { getUuid: () => 'uuid-migration' }
  };
  vm.createContext(contexte);
  vm.runInContext(migrationSource, contexte, {
    filename: 'MigrationService.js'
  });

  const modele = {
    sheets: {
      PARAMETRES: {
        exists: true,
        headers: ['CLE', 'VALEUR', 'ORDRE', 'ACTIF'],
        rows: [['VERSION_SCHEMA', 3, 9999, true]]
      }
    }
  };
  const premier = contexte.simulerMigrationsModele_(modele, 3, 4);
  const second = contexte.simulerMigrationsModele_(
    premier.modele,
    4,
    4
  );
  const parametres = second.modele.sheets.PARAMETRES;
  const cles = parametres.rows.map(ligne => ligne[0]);

  assert.strictEqual(premier.reussie, true);
  assert.strictEqual(premier.versionFinale, 4);
  assert.strictEqual(
    cles.filter(cle => cle === 'EMAIL_CHEF_CENTRE').length,
    1
  );
  assert.strictEqual(
    cles.filter(cle => cle === 'OBJET_MAIL_INDEMNISATION').length,
    1
  );
  assert(
    second.modele.sheets.PRESTATIONS_FORMATEURS.headers
      .includes('ID_ENVOI')
  );
  assert.deepStrictEqual(
    Array.from(
      second.modele.sheets.HISTORIQUE_ENVOIS_INDEMNISATIONS.headers
    ),
    [
      'ID_ENVOI', 'DATE_ENVOI', 'DESTINATAIRE', 'COPIES',
      'OBJET', 'REFERENCE_DEMANDE', 'ID_PRESTATIONS',
      'NOMBRE_FORMATEURS', 'NOMBRE_SEANCES', 'VOLUME_HEURES',
      'STATUT_ENVOI', 'MESSAGE_ERREUR', 'SESSION_ADMIN',
      'DATE_CREATION'
    ]
  );
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
  ' tests du module d’envoi réussis.\n'
);
