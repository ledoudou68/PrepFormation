'use strict';

const PROPRIETE_SEL_ADMIN = 'ADMIN_PASSWORD_SALT';
const PROPRIETE_HASH_ADMIN = 'ADMIN_PASSWORD_HASH';
const PROPRIETE_TENTATIVES_ADMIN = 'ADMIN_AUTH_ATTEMPTS';
const PREFIXE_SESSION_ADMIN = 'ADMIN_SESSION_';
const DUREE_SESSION_ADMIN_MS = 30 * 60 * 1000;
const DUREE_BLOCAGE_ADMIN_MS = 15 * 60 * 1000;
const NOMBRE_MAX_TENTATIVES_ADMIN = 5;
const MESSAGE_RESTAURATION_ECRITURES_BLOQUEES_ =
  'Une restauration est en cours. Les modifications sont temporairement indisponibles.';
const PROPRIETE_OPERATION_RESTAURATION_ACTIVE_ =
  'PREPFORMATION_RESTORE_ACTIVE_OPERATION';
const CONTEXTE_ECRITURE_RESTAURATION_ = {};

const COLONNES_HISTORIQUE_SECURITE = [
  'ID_HISTORIQUE',
  'DATE_ACTION',
  'UTILISATEUR',
  'ACTION',
  'OBJET',
  'IDENTIFIANT',
  'DETAILS'
];


/**
 * Retourne les droits courants. L'adresse Google, lorsqu'elle
 * est disponible, reste purement informative.
 */
function getSessionUtilisateur(jetonAdministrateur) {
  const sessionAdministration = jetonAdministrateur
    ? obtenirSessionAdministrationValide_(
      jetonAdministrateur,
      true,
      false
    )
    : null;

  return construireSessionUtilisateur_(sessionAdministration);
}


function obtenirSessionUtilisateur_() {
  return construireSessionUtilisateur_(null);
}


function construireSessionUtilisateur_(sessionAdministration) {
  const email = obtenirEmailUtilisateurActif_();
  const estAdministrateur = Boolean(sessionAdministration);

  return {
    email: email,
    estIdentifie: Boolean(email),
    estAdministrateur: estAdministrateur,
    modeExecution: 'USER_DEPLOYING',
    controleAccesSecurise: true,
    authentificationAdministrateurConfiguree:
      motDePasseAdministrateurConfigure_(),
    identifiantSessionAdministration: estAdministrateur
      ? sessionAdministration.idSession
      : '',
    expirationSessionAdministration: estAdministrateur
      ? new Date(sessionAdministration.expireA).toISOString()
      : '',
    droits: {
      consulterStagiaires: true,
      consulterSuiviPedagogique: true,
      gererSessions: true,
      consulterFormateurs: true,
      consulterStatistiques: true,
      consulterMonRecapitulatifHeures: Boolean(email),
      gererStagiaires: estAdministrateur,
      gererFormateurs: estAdministrateur,
      gererFormations: estAdministrateur,
      gererReferentiel: estAdministrateur,
      gererIndemnisations: estAdministrateur,
      accederAdministration: estAdministrateur
    }
  };
}


function obtenirEmailUtilisateurActif_() {
  try {
    return String(
      Session.getActiveUser().getEmail() || ''
    )
      .trim()
      .toLowerCase();
  } catch (erreur) {
    console.error(erreur);
    return '';
  }
}


/**
 * Authentifie le mot de passe et retourne une seule fois le
 * jeton brut. Le serveur ne conserve que son empreinte.
 */
function deverrouillerAdministration(motDePasse) {
  const tentative = String(motDePasse || '');
  const idTentative = Utilities.getUuid().slice(0, 12);

  if (!motDePasseAdministrateurConfigure_()) {
    journaliserEvenementSecuriteSansBloquer_(
      'ADMIN_AUTHENTIFICATION_ECHEC',
      'SECURITE',
      idTentative,
      { raison: 'MOT_DE_PASSE_NON_CONFIGURE' },
      'TENTATIVE_ADMIN:' + idTentative
    );
    throw new Error(
      'Le mot de passe administrateur n’est pas encore configuré.'
    );
  }

  if (!tentative || tentative.length > 1024) {
    enregistrerEchecAuthentificationAdmin_(idTentative);
    throw new Error('Mot de passe administrateur incorrect.');
  }

  const verrou = LockService.getScriptLock();

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le service d’authentification est momentanément occupé.'
    );
  }

  let resultat;

  try {
    const proprietes = PropertiesService.getScriptProperties();
    const maintenant = Date.now();
    const etatTentatives = lireEtatTentativesAdmin_(proprietes);

    if (
      etatTentatives.bloqueJusqua &&
      etatTentatives.bloqueJusqua > maintenant
    ) {
      journaliserEvenementSecuriteSansBloquer_(
        'ADMIN_AUTHENTIFICATION_ECHEC',
        'SECURITE',
        idTentative,
        {
          raison: 'BLOCAGE_TEMPORAIRE',
          bloqueJusqua: new Date(
            etatTentatives.bloqueJusqua
          ).toISOString()
        },
        'TENTATIVE_ADMIN:' + idTentative
      );
      throw new Error(
        'Trop de tentatives incorrectes. Réessaie dans quelques minutes.'
      );
    }

    if (
      etatTentatives.bloqueJusqua &&
      etatTentatives.bloqueJusqua <= maintenant
    ) {
      proprietes.deleteProperty(PROPRIETE_TENTATIVES_ADMIN);
      etatTentatives.echecs = 0;
      etatTentatives.bloqueJusqua = 0;
    }

    const sel = proprietes.getProperty(PROPRIETE_SEL_ADMIN) || '';
    const hashAttendu =
      proprietes.getProperty(PROPRIETE_HASH_ADMIN) || '';
    const hashTentative = hacherMotDePasseAdministrateur_(
      tentative,
      sel
    );

    if (!comparaisonConstanteSecurite_(hashTentative, hashAttendu)) {
      etatTentatives.echecs =
        Number(etatTentatives.echecs || 0) + 1;

      if (
        etatTentatives.echecs >=
        NOMBRE_MAX_TENTATIVES_ADMIN
      ) {
        etatTentatives.bloqueJusqua =
          maintenant + DUREE_BLOCAGE_ADMIN_MS;
      }

      proprietes.setProperty(
        PROPRIETE_TENTATIVES_ADMIN,
        JSON.stringify(etatTentatives)
      );

      journaliserEvenementSecuriteSansBloquer_(
        'ADMIN_AUTHENTIFICATION_ECHEC',
        'SECURITE',
        idTentative,
        {
          raison: 'MOT_DE_PASSE_INCORRECT',
          nombreEchecs: etatTentatives.echecs,
          blocageActive: Boolean(
            etatTentatives.bloqueJusqua > maintenant
          )
        },
        'TENTATIVE_ADMIN:' + idTentative
      );

      if (etatTentatives.bloqueJusqua > maintenant) {
        throw new Error(
          'Trop de tentatives incorrectes. Accès bloqué pendant 15 minutes.'
        );
      }

      throw new Error('Mot de passe administrateur incorrect.');
    }

    proprietes.deleteProperty(PROPRIETE_TENTATIVES_ADMIN);
    nettoyerSessionsAdministrationDansProprietes_(
      proprietes,
      maintenant
    );

    const jeton = creerSecretAleatoireSecurite_();
    const empreinteJeton = hacherJetonAdministration_(jeton);
    const idSession = Utilities.getUuid().slice(0, 12);
    const session = {
      idSession: idSession,
      creeA: maintenant,
      derniereActivite: maintenant,
      expireA: maintenant + DUREE_SESSION_ADMIN_MS
    };

    proprietes.setProperty(
      PREFIXE_SESSION_ADMIN + empreinteJeton,
      JSON.stringify(session)
    );

    resultat = {
      jeton: jeton,
      sessionUtilisateur: construireSessionUtilisateur_(session)
    };
  } finally {
    verrou.releaseLock();
  }

  journaliserEvenementSecuriteSansBloquer_(
    'ADMIN_DEVERROUILLAGE_REUSSI',
    'SECURITE',
    resultat.sessionUtilisateur.identifiantSessionAdministration,
    {
      expirationInactiviteMinutes:
        DUREE_SESSION_ADMIN_MS / 60000
    },
    'SESSION_ADMIN:' +
      resultat.sessionUtilisateur.identifiantSessionAdministration
  );

  return resultat;
}


function renouvelerSessionAdministration(jetonAdministrateur) {
  const session = obtenirSessionAdministrationValide_(
    jetonAdministrateur,
    true,
    true
  );

  return construireSessionUtilisateur_(session);
}


function verrouillerAdministration(jetonAdministrateur) {
  const session = obtenirSessionAdministrationValide_(
    jetonAdministrateur,
    false,
    true
  );
  const proprietes = PropertiesService.getScriptProperties();

  proprietes.deleteProperty(
    PREFIXE_SESSION_ADMIN +
      hacherJetonAdministration_(jetonAdministrateur)
  );

  journaliserEvenementSecuriteSansBloquer_(
    'ADMIN_VERROUILLAGE',
    'SECURITE',
    session.idSession,
    {},
    'SESSION_ADMIN:' + session.idSession
  );

  return {
    succes: true,
    sessionUtilisateur: construireSessionUtilisateur_(null)
  };
}


function exigerAdministrateur_(jetonAdministrateur) {
  const sessionAdministration =
    obtenirSessionAdministrationValide_(
      jetonAdministrateur,
      true,
      true
    );
  const sessionUtilisateur =
    construireSessionUtilisateur_(sessionAdministration);

  sessionUtilisateur.identifiantHistorique =
    'SESSION_ADMIN:' + sessionAdministration.idSession;

  return sessionUtilisateur;
}


/**
 * Barrière centrale appelée par toutes les mutations métier. Le seul
 * contournement possible est l'objet privé détenu par le service de
 * restauration et jamais sérialisé vers le navigateur.
 */
function exigerEcritureAutorisee_(contexteInterne) {
  if (contexteInterne === CONTEXTE_ECRITURE_RESTAURATION_) {
    return true;
  }

  if (restaurationBloqueEcritures_()) {
    throw new Error(MESSAGE_RESTAURATION_ECRITURES_BLOQUEES_);
  }

  return true;
}


/**
 * Point de passage unique de toute mutation métier. Le contrôle de
 * restauration est volontairement effectué après l'acquisition du verrou
 * document afin d'éviter toute fenêtre de course avec le démarrage d'une
 * restauration.
 */
function executerMutationMetier_(traitement, contexteInterne) {
  if (typeof traitement !== 'function') {
    throw new Error('Mutation métier invalide.');
  }

  const verrou = LockService.getDocumentLock();
  const verrouDejaDetenu = verrou.hasLock();

  if (!verrouDejaDetenu && !verrou.tryLock(30000)) {
    throw new Error(
      'Une autre opération est en cours. Réessaie dans quelques instants.'
    );
  }

  try {
    exigerEcritureAutorisee_(contexteInterne);
    return traitement();
  } finally {
    if (!verrouDejaDetenu) {
      verrou.releaseLock();
    }
  }
}


function restaurationBloqueEcritures_() {
  const valeur = PropertiesService
    .getScriptProperties()
    .getProperty(PROPRIETE_OPERATION_RESTAURATION_ACTIVE_);

  if (!valeur) {
    return false;
  }

  try {
    const etat = JSON.parse(valeur);

    return ![
      'TERMINEE',
      'ECHEC_ROLLBACK_TERMINE'
    ].includes(String(etat.statut || ''));
  } catch (erreur) {
    // Un état illisible est traité comme une opération incomplète.
    return true;
  }
}


/**
 * Revalide le secret sans créer une nouvelle session et sans exposer
 * l'empreinte. La limitation générale des tentatives reste portée par le
 * déverrouillage initial ; cette vérification n'est accessible qu'avec une
 * session administrateur déjà valide.
 */
function revaliderMotDePasseAdministrateur_(motDePasse) {
  const tentative = String(motDePasse || '');

  if (!tentative || tentative.length > 1024) {
    return false;
  }

  const proprietes = PropertiesService.getScriptProperties();
  const sel = String(
    proprietes.getProperty(PROPRIETE_SEL_ADMIN) || ''
  );
  const hashAttendu = String(
    proprietes.getProperty(PROPRIETE_HASH_ADMIN) || ''
  );

  if (!sel || !hashAttendu) {
    return false;
  }

  return comparaisonConstanteSecurite_(
    hacherMotDePasseAdministrateur_(tentative, sel),
    hashAttendu
  );
}


/**
 * Variante strictement en lecture seule pour les diagnostics qui ne
 * doivent ni renouveler la session ni nettoyer les propriétés du script.
 */
function exigerAdministrateurLectureSeule_(jetonAdministrateur) {
  const jeton = String(jetonAdministrateur || '').trim();

  if (!/^[A-Za-z0-9_-]{40,200}$/.test(jeton)) {
    throw new Error('Accès réservé à l’administrateur.');
  }

  const proprietes = PropertiesService.getScriptProperties();
  const cle = PREFIXE_SESSION_ADMIN +
    hacherJetonAdministration_(jeton);
  const valeur = proprietes.getProperty(cle);
  let session;

  if (!valeur) {
    throw new Error('Accès réservé à l’administrateur.');
  }

  try {
    session = JSON.parse(valeur);
  } catch (erreur) {
    throw new Error('Accès réservé à l’administrateur.');
  }

  const maintenant = Date.now();

  if (
    !session.idSession ||
    !session.derniereActivite ||
    Number(session.expireA || 0) <= maintenant ||
    maintenant - Number(session.derniereActivite) >=
      DUREE_SESSION_ADMIN_MS
  ) {
    throw new Error('Accès réservé à l’administrateur.');
  }

  const sessionUtilisateur = construireSessionUtilisateur_(session);

  sessionUtilisateur.identifiantHistorique =
    'SESSION_ADMIN:' + session.idSession;

  return sessionUtilisateur;
}


function verifierAccesPage_(nomPage, jetonAdministrateur) {
  if ([
    'Referentiel',
    'Indemnisation',
    'Administration'
  ].includes(String(nomPage || ''))) {
    exigerAdministrateur_(jetonAdministrateur);
  }
}


function obtenirSessionAdministrationValide_(
  jetonAdministrateur,
  renouveler,
  erreurSiInvalide
) {
  const jeton = String(jetonAdministrateur || '').trim();

  if (!/^[A-Za-z0-9_-]{40,200}$/.test(jeton)) {
    if (erreurSiInvalide) {
      throw new Error('Accès réservé à l’administrateur.');
    }
    return null;
  }

  const verrou = LockService.getScriptLock();

  if (!verrou.tryLock(10000)) {
    if (erreurSiInvalide) {
      throw new Error('Accès réservé à l’administrateur.');
    }
    return null;
  }

  try {
    const proprietes = PropertiesService.getScriptProperties();
    const maintenant = Date.now();
    const cle =
      PREFIXE_SESSION_ADMIN +
      hacherJetonAdministration_(jeton);
    const valeur = proprietes.getProperty(cle);

    nettoyerSessionsAdministrationDansProprietes_(
      proprietes,
      maintenant
    );

    if (!valeur) {
      if (erreurSiInvalide) {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return null;
    }

    let session;

    try {
      session = JSON.parse(valeur);
    } catch (erreur) {
      proprietes.deleteProperty(cle);

      if (erreurSiInvalide) {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return null;
    }

    if (
      !session.idSession ||
      !session.derniereActivite ||
      Number(session.expireA || 0) <= maintenant ||
      maintenant - Number(session.derniereActivite) >=
        DUREE_SESSION_ADMIN_MS
    ) {
      proprietes.deleteProperty(cle);

      if (erreurSiInvalide) {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return null;
    }

    if (renouveler) {
      session.derniereActivite = maintenant;
      session.expireA = maintenant + DUREE_SESSION_ADMIN_MS;
      proprietes.setProperty(cle, JSON.stringify(session));
    }

    return session;
  } finally {
    verrou.releaseLock();
  }
}


function motDePasseAdministrateurConfigure_() {
  const proprietes = PropertiesService.getScriptProperties();

  return Boolean(
    proprietes.getProperty(PROPRIETE_SEL_ADMIN) &&
    proprietes.getProperty(PROPRIETE_HASH_ADMIN)
  );
}


/**
 * À lancer manuellement depuis l'éditeur Apps Script par le
 * propriétaire. Aucun secret n'est accepté en paramètre web.
 */
function initialiserMotDePasseAdministrateur_() {
  const ui = SpreadsheetApp.getUi();
  const premiereSaisie = ui.prompt(
    'Mot de passe administrateur',
    'Saisis un mot de passe d’au moins 12 caractères. Il ne sera jamais enregistré en clair.',
    ui.ButtonSet.OK_CANCEL
  );

  if (premiereSaisie.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const motDePasse = premiereSaisie.getResponseText();

  if (motDePasse.length < 12 || motDePasse.length > 1024) {
    throw new Error(
      'Le mot de passe doit contenir entre 12 et 1024 caractères.'
    );
  }

  const confirmation = ui.prompt(
    'Confirmation',
    'Saisis de nouveau le mot de passe administrateur.',
    ui.ButtonSet.OK_CANCEL
  );

  if (confirmation.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  if (confirmation.getResponseText() !== motDePasse) {
    throw new Error('Les deux saisies ne correspondent pas.');
  }

  const proprietes = PropertiesService.getScriptProperties();
  const modification = motDePasseAdministrateurConfigure_();
  const sel = creerSecretAleatoireSecurite_();
  const hash = hacherMotDePasseAdministrateur_(motDePasse, sel);
  const verrou = LockService.getScriptLock();

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'La configuration de sécurité est momentanément occupée.'
    );
  }

  try {
    proprietes.setProperties({
      ADMIN_PASSWORD_SALT: sel,
      ADMIN_PASSWORD_HASH: hash
    }, false);
    proprietes.deleteProperty(PROPRIETE_TENTATIVES_ADMIN);
    supprimerToutesSessionsAdministration_(proprietes);
  } finally {
    verrou.releaseLock();
  }

  journaliserEvenementSecuriteSansBloquer_(
    modification
      ? 'ADMIN_MOT_DE_PASSE_MODIFICATION'
      : 'ADMIN_MOT_DE_PASSE_INITIALISATION',
    'SECURITE',
    'MOT_DE_PASSE_ADMIN',
    { sessionsExistantesInvalidees: true },
    obtenirEmailUtilisateurEffectif_() || 'PROPRIETAIRE_SCRIPT'
  );

  ui.alert(
    'Mot de passe administrateur enregistré. Toutes les anciennes sessions ont été invalidées.'
  );
}


function enregistrerEchecAuthentificationAdmin_(idTentative) {
  journaliserEvenementSecuriteSansBloquer_(
    'ADMIN_AUTHENTIFICATION_ECHEC',
    'SECURITE',
    idTentative,
    { raison: 'SAISIE_INVALIDE' },
    'TENTATIVE_ADMIN:' + idTentative
  );
}


function lireEtatTentativesAdmin_(proprietes) {
  try {
    return JSON.parse(
      proprietes.getProperty(PROPRIETE_TENTATIVES_ADMIN) || '{}'
    );
  } catch (erreur) {
    return {};
  }
}


function nettoyerSessionsAdministrationDansProprietes_(
  proprietes,
  maintenant
) {
  const toutes = proprietes.getProperties();

  Object.keys(toutes).forEach(function (cle) {
    if (!cle.startsWith(PREFIXE_SESSION_ADMIN)) {
      return;
    }

    try {
      const session = JSON.parse(toutes[cle]);

      if (
        !session.derniereActivite ||
        Number(session.expireA || 0) <= maintenant ||
        maintenant - Number(session.derniereActivite) >=
          DUREE_SESSION_ADMIN_MS
      ) {
        proprietes.deleteProperty(cle);
      }
    } catch (erreur) {
      proprietes.deleteProperty(cle);
    }
  });
}


function supprimerToutesSessionsAdministration_(proprietes) {
  const toutes = proprietes.getProperties();

  Object.keys(toutes).forEach(function (cle) {
    if (cle.startsWith(PREFIXE_SESSION_ADMIN)) {
      proprietes.deleteProperty(cle);
    }
  });
}


function hacherMotDePasseAdministrateur_(motDePasse, sel) {
  const octets = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(sel || '') + '\u0000' + String(motDePasse || ''),
    Utilities.Charset.UTF_8
  );

  return Utilities.base64EncodeWebSafe(octets);
}


function hacherJetonAdministration_(jeton) {
  const octets = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'JETON_ADMIN\u0000' + String(jeton || ''),
    Utilities.Charset.UTF_8
  );

  return Utilities.base64EncodeWebSafe(octets);
}


function creerSecretAleatoireSecurite_() {
  const materiau = [
    Utilities.getUuid(),
    Utilities.getUuid(),
    Utilities.getUuid(),
    String(Date.now()),
    String(Math.random())
  ].join('|');
  const octets = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    materiau,
    Utilities.Charset.UTF_8
  );

  return Utilities.base64EncodeWebSafe(octets).replace(/=+$/g, '');
}


function comparaisonConstanteSecurite_(valeurA, valeurB) {
  const a = String(valeurA || '');
  const b = String(valeurB || '');
  const longueur = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;

  for (let i = 0; i < longueur; i++) {
    difference |=
      (a.charCodeAt(i) || 0) ^
      (b.charCodeAt(i) || 0);
  }

  return difference === 0;
}


function obtenirEmailUtilisateurEffectif_() {
  try {
    return String(
      Session.getEffectiveUser().getEmail() || ''
    )
      .trim()
      .toLowerCase();
  } catch (erreur) {
    return '';
  }
}


function journaliserEvenementSecuriteSansBloquer_(
  action,
  objet,
  identifiant,
  details,
  utilisateur
) {
  try {
    journaliserActionSensible_(
      action,
      objet,
      identifiant,
      details,
      utilisateur
    );
  } catch (erreur) {
    console.error(erreur);
  }
}


function journaliserActionSensible_(
  action,
  objet,
  identifiant,
  details,
  utilisateur,
  contexteInterne
) {
  return journaliserActionsSensiblesEnLot_([
    {
      action: action,
      objet: objet,
      identifiant: identifiant,
      details: details,
      utilisateur: utilisateur
    }
  ], contexteInterne);
}


/**
 * Écrit un lot d'audit sous le même verrou document que les mutations.
 * Le contexte privé de restauration est requis lorsque l'état actif bloque
 * normalement les écritures.
 */
function journaliserActionsSensiblesEnLot_(
  evenements,
  contexteInterne
) {
  const liste = (evenements || []).filter(Boolean);

  if (!liste.length) {
    return 0;
  }

  return executerMutationMetier_(function () {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const feuille = obtenirFeuilleHistoriqueSecurite_(classeur);
    const entetes = feuille
      .getRange(1, 1, 1, feuille.getLastColumn())
      .getValues()[0];
    const index = creerIndexSecurite_(entetes);
    const idsExistants = new Set();

    if (
      Number.isInteger(index.ID_HISTORIQUE) &&
      feuille.getLastRow() > 1
    ) {
      feuille
        .getRange(
          2,
          index.ID_HISTORIQUE + 1,
          feuille.getLastRow() - 1,
          1
        )
        .getValues()
        .forEach(function (ligne) {
          const id = String(ligne[0] || '');

          if (id) {
            idsExistants.add(id);
          }
        });
    }

    const aInserer = liste.filter(function (evenement) {
      const id = String(evenement.idHistorique || '');
      return !id || !idsExistants.has(id);
    });
    const lignes = aInserer.map(function (evenement) {
      const ligne = new Array(entetes.length).fill('');
      const dateAction = evenement.dateAction
        ? new Date(evenement.dateAction)
        : new Date();

      ligne[index.ID_HISTORIQUE] = String(
        evenement.idHistorique || Utilities.getUuid()
      );
      ligne[index.DATE_ACTION] = dateAction;
      ligne[index.UTILISATEUR] = String(
        evenement.utilisateur || obtenirEmailUtilisateurActif_() ||
          'FORMATEUR_PUBLIC'
      );
      ligne[index.ACTION] = String(evenement.action || '');
      ligne[index.OBJET] = String(evenement.objet || '');
      ligne[index.IDENTIFIANT] = String(
        evenement.identifiant || ''
      );
      ligne[index.DETAILS] = serialiserDetailsHistorique_(
        evenement.details
      );

      return ligne;
    });
    if (!lignes.length) {
      return liste.length;
    }

    const premiereLigne = feuille.getLastRow() + 1;

    feuille
      .getRange(premiereLigne, 1, lignes.length, entetes.length)
      .setValues(lignes);
    feuille
      .getRange(
        premiereLigne,
        index.DATE_ACTION + 1,
        lignes.length,
        1
      )
      .setNumberFormat('dd/MM/yyyy HH:mm:ss');

    return liste.length;
  }, contexteInterne);
}


function obtenirFeuilleHistoriqueSecurite_(classeur) {
  return assurerFeuilleMigration_(classeur, 'HISTORIQUE');
}


function serialiserDetailsHistorique_(details) {
  if (details === null || details === undefined) {
    return '';
  }

  if (typeof details === 'string') {
    return details.slice(0, 5000);
  }

  return JSON.stringify(details, function (cle, valeur) {
    if (valeur instanceof Date) {
      return valeur.toISOString();
    }

    return valeur;
  }).slice(0, 5000);
}


function creerIndexSecurite_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserTexteSecurite_(entete)] = position;
  });

  return index;
}


function trouverColonneSecurite_(index, noms) {
  for (let i = 0; i < noms.length; i++) {
    if (Number.isInteger(index[noms[i]])) {
      return index[noms[i]];
    }
  }

  return null;
}


function normaliserTexteSecurite_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
