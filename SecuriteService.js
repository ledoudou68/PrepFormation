'use strict';

const PROPRIETE_SEL_ADMIN = 'ADMIN_PASSWORD_SALT';
const PROPRIETE_HASH_ADMIN = 'ADMIN_PASSWORD_HASH';
const PROPRIETE_TENTATIVES_ADMIN = 'ADMIN_AUTH_ATTEMPTS';
const PREFIXE_SESSION_ADMIN = 'ADMIN_SESSION_';
const PREFIXE_CACHE_ACTIVITE_SESSION_ADMIN_ = 'ADMIN_LAST_ACTIVITY_';
const PREFIXE_CACHE_TYPE_SESSION_UTILISATEUR_ = 'SESSION_TYPE_';
const DUREE_CACHE_TYPE_SESSION_UTILISATEUR_SECONDES_ = 10 * 60;
const CLE_CACHE_CONFIGURATION_ADMIN_ = 'ADMIN_PASSWORD_CONFIGURED';
const DUREE_CACHE_CONFIGURATION_ADMIN_SECONDES_ = 5 * 60;
const DUREE_SESSION_ADMIN_MS = 30 * 60 * 1000;
const DUREE_THROTTLE_ACTIVITE_SESSION_ADMIN_MS_ = 5 * 60 * 1000;
const NOMBRE_MAX_SESSIONS_ADMIN_ = 10;
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
 * Retourne le contexte courant à partir d'un jeton opaque. L'adresse Google,
 * lorsqu'elle est disponible, reste purement informative.
 */
function getSessionUtilisateur(jetonUtilisateur) {
  const sessions = obtenirSessionsUtilisateurValides_(
    jetonUtilisateur,
    true,
    null
  );

  return construireSessionUtilisateur_(
    sessions.sessionAdministration,
    sessions.sessionFormateur
  );
}


function obtenirSessionUtilisateur_(jetonUtilisateur) {
  return getSessionUtilisateur(jetonUtilisateur);
}


function construireSessionUtilisateur_(
  sessionAdministration,
  sessionFormateur
) {
  const email = obtenirEmailUtilisateurActif_();
  const estAdministrateur = Boolean(sessionAdministration);
  const identiteFormateur = sessionFormateur ||
    construireIdentiteFormateurSessionAdministration_(
      sessionAdministration
    );
  const estFormateur = Boolean(identiteFormateur);
  const contexte = estAdministrateur && estFormateur
    ? 'FORMATEUR_ADMINISTRATEUR'
    : (
      estAdministrateur
        ? 'ADMINISTRATEUR'
        : (estFormateur ? 'FORMATEUR' : 'NON_CONNECTE')
    );
  const nomComplet = estFormateur
    ? [identiteFormateur.prenom, identiteFormateur.nom]
      .filter(Boolean)
      .join(' ')
    : '';

  return {
    email: email,
    emailGoogleInformatif: email,
    contexte: contexte,
    estIdentifie: estAdministrateur || estFormateur,
    estAdministrateur: estAdministrateur,
    estFormateur: estFormateur,
    idUtilisateur: estFormateur
      ? String(identiteFormateur.idUtilisateur || '')
      : '',
    idFormateur: estFormateur
      ? String(identiteFormateur.idFormateur || '')
      : '',
    identifiant: estFormateur
      ? String(identiteFormateur.identifiant || '')
      : '',
    nom: estFormateur ? String(identiteFormateur.nom || '') : '',
    prenom: estFormateur ? String(identiteFormateur.prenom || '') : '',
    nomComplet: nomComplet,
    modeAccesAdministration: estAdministrateur
      ? String(
        sessionAdministration.modeAccesAdministration ||
          'ADMINISTRATION_DIRECTE'
      )
      : '',
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
    expirationAbsolueSessionFormateur: estFormateur
      ? serialiserExpirationSessionUtilisateur_(
        identiteFormateur.expireAbsolueA
      )
      : '',
    droits: {
      consulterStagiaires: estAdministrateur || estFormateur,
      consulterSuiviPedagogique: estAdministrateur || estFormateur,
      gererSessions: estAdministrateur || estFormateur,
      consulterCalendrier: estAdministrateur || estFormateur,
      consulterFormateurs: estAdministrateur || estFormateur,
      consulterStatistiques: estAdministrateur || estFormateur,
      consulterAssistantPedagogique: estAdministrateur || estFormateur,
      consulterMonRecapitulatifHeures: estFormateur,
      gererStagiaires: estAdministrateur,
      gererFormateurs: estAdministrateur,
      gererFormations: estAdministrateur,
      gererReferentiel: estAdministrateur,
      gererIndemnisations: estAdministrateur,
      accederAdministration: estAdministrateur
    }
  };
}


function construireIdentiteFormateurSessionAdministration_(session) {
  if (
    !session ||
    !session.idUtilisateurFormateur ||
    !session.idFormateurAssocie
  ) {
    return null;
  }
  return {
    idUtilisateur: String(session.idUtilisateurFormateur),
    idFormateur: String(session.idFormateurAssocie),
    identifiant: String(session.identifiantFormateur || ''),
    nom: String(session.nomFormateur || ''),
    prenom: String(session.prenomFormateur || ''),
    expireAbsolueA: Number(session.expireAbsolueFormateurA || 0)
  };
}


function serialiserExpirationSessionUtilisateur_(valeur) {
  const date = new Date(Number(valeur || 0));
  return Number(valeur || 0) && !isNaN(date.getTime())
    ? date.toISOString()
    : '';
}


function construireIdentifiantHistoriqueAdministration_(session) {
  const idSession = String(session && session.idSession || '');
  const base = 'SESSION_ADMIN:' + idSession;
  if (
    session &&
    session.idUtilisateurFormateur &&
    session.idFormateurAssocie
  ) {
    return base +
      '|UTILISATEUR:' + String(session.idUtilisateurFormateur) +
      '|FORMATEUR:' + String(session.idFormateurAssocie);
  }
  return base + '|ADMINISTRATION_DIRECTE';
}


function construireIdentifiantHistoriqueAdministrationDepuisContexte_(
  contexte
) {
  const idSession = String(
    contexte && contexte.identifiantSessionAdministration || ''
  );
  if (
    contexte &&
    contexte.idUtilisateur &&
    contexte.idFormateur
  ) {
    return 'SESSION_ADMIN:' + idSession +
      '|UTILISATEUR:' + String(contexte.idUtilisateur) +
      '|FORMATEUR:' + String(contexte.idFormateur);
  }
  return 'SESSION_ADMIN:' + idSession + '|ADMINISTRATION_DIRECTE';
}


function exigerUtilisateurAuthentifie_(jetonUtilisateur, diagnostic) {
  const debutTotal = diagnostic ? Date.now() : 0;
  initialiserDiagnosticValidationUtilisateur_(diagnostic);
  const sessions = obtenirSessionsUtilisateurValides_(
    jetonUtilisateur,
    true,
    diagnostic
  );
  const sessionAdministration = sessions.sessionAdministration;
  if (sessionAdministration) {
    const debutContexte = diagnostic ? Date.now() : 0;
    const contexteAdministration = construireSessionUtilisateur_(
      sessionAdministration,
      null
    );
    contexteAdministration.identifiantHistorique =
      construireIdentifiantHistoriqueAdministration_(
        sessionAdministration
      );
    ajouterDureeDiagnosticValidationUtilisateur_(
      diagnostic,
      'constructionContexteMs',
      debutContexte
    );
    finaliserDiagnosticValidationUtilisateur_(diagnostic, debutTotal);
    return contexteAdministration;
  }

  const sessionFormateur = sessions.sessionFormateur;
  if (!sessionFormateur) {
    finaliserDiagnosticValidationUtilisateur_(diagnostic, debutTotal);
    throw new Error('Authentification requise.');
  }

  const debutContexte = diagnostic ? Date.now() : 0;
  const contexteFormateur = construireSessionUtilisateur_(
    null,
    sessionFormateur
  );
  contexteFormateur.identifiantHistorique =
    construireIdentifiantHistoriqueFormateur_(sessionFormateur);
  ajouterDureeDiagnosticValidationUtilisateur_(
    diagnostic,
    'constructionContexteMs',
    debutContexte
  );
  finaliserDiagnosticValidationUtilisateur_(diagnostic, debutTotal);
  return contexteFormateur;
}


function obtenirSessionsUtilisateurValides_(
  jetonUtilisateur,
  renouveler,
  diagnostic
) {
  const resultat = {
    sessionAdministration: null,
    sessionFormateur: null
  };
  const jeton = String(jetonUtilisateur || '').trim();
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(jeton)) return resultat;

  const debutRoutage = diagnostic ? Date.now() : 0;
  const typeEnCache = lireTypeSessionUtilisateurCache_(jeton);
  ajouterDureeDiagnosticValidationUtilisateur_(
    diagnostic,
    'determinationTypeSessionMs',
    debutRoutage
  );

  if (typeEnCache === 'ADMINISTRATEUR') {
    resultat.sessionAdministration =
      obtenirSessionAdministrationValide_(
        jeton,
        renouveler,
        false,
        false,
        diagnostic
      );
    if (resultat.sessionAdministration) return resultat;
    supprimerTypeSessionUtilisateurCache_(jeton);
  }

  if (
    typeEnCache === 'FORMATEUR' &&
    typeof obtenirSessionFormateurValide_ === 'function'
  ) {
    resultat.sessionFormateur = obtenirSessionFormateurValide_(
      jeton,
      renouveler,
      false,
      false,
      diagnostic
    );
    if (resultat.sessionFormateur) return resultat;
    supprimerTypeSessionUtilisateurCache_(jeton);
  }

  if (
    typeEnCache !== 'FORMATEUR' &&
    typeof obtenirSessionFormateurValide_ === 'function'
  ) {
    resultat.sessionFormateur = obtenirSessionFormateurValide_(
      jeton,
      renouveler,
      false,
      false,
      diagnostic
    );
    if (resultat.sessionFormateur) {
      enregistrerTypeSessionUtilisateurCache_(jeton, 'FORMATEUR');
      return resultat;
    }
  }

  if (typeEnCache !== 'ADMINISTRATEUR') {
    resultat.sessionAdministration =
      obtenirSessionAdministrationValide_(
        jeton,
        renouveler,
        false,
        false,
        diagnostic
      );
    if (resultat.sessionAdministration) {
      enregistrerTypeSessionUtilisateurCache_(
        jeton,
        'ADMINISTRATEUR'
      );
    }
  }
  return resultat;
}


function initialiserDiagnosticValidationUtilisateur_(diagnostic) {
  if (!diagnostic) return;
  diagnostic.operation = 'VALIDATION_SESSION';
  [
    'determinationTypeSessionMs',
    'accesPropertiesServiceMs',
    'lectureSessionPersistanteMs',
    'parsingSessionMs',
    'lectureCacheActiviteMs',
    'controleExpirationMs',
    'lectureCacheAutorisationMs',
    'recuperationUtilisateurMs',
    'controleStatutMs',
    'renouvellementActiviteMs',
    'constructionContexteMs',
    'totalValidationSessionMs',
    'totalServeurMs'
  ].forEach(function (cle) {
    diagnostic[cle] = Number(diagnostic[cle] || 0);
  });
}


function ajouterDureeDiagnosticValidationUtilisateur_(
  diagnostic,
  propriete,
  debut
) {
  if (!diagnostic) return;
  diagnostic[propriete] = Number(diagnostic[propriete] || 0) +
    Math.max(0, Date.now() - debut);
}


function finaliserDiagnosticValidationUtilisateur_(diagnostic, debut) {
  if (!diagnostic) return;
  diagnostic.totalServeurMs = Math.max(0, Date.now() - debut);
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
 * L'association d'une identité formateur est facultative et n'intervient
 * qu'après validation du mot de passe administrateur. Une session absente,
 * expirée, bloquée par ses données ou illisible ne peut donc jamais empêcher
 * la création de la session administrateur de secours.
 */
function obtenirSessionFormateurPourElevationAdministration_(jetonFormateur) {
  if (
    !jetonFormateur ||
    typeof obtenirSessionFormateurValide_ !== 'function'
  ) {
    return null;
  }
  try {
    return obtenirSessionFormateurValide_(
      jetonFormateur,
      true,
      false
    );
  } catch (erreur) {
    return null;
  }
}


/**
 * Authentifie le mot de passe et retourne une seule fois le
 * jeton brut. Le serveur ne conserve que son empreinte.
 */
function deverrouillerAdministration(motDePasse, jetonFormateur) {
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
    limiterSessionsAdministrationAvantCreation_(proprietes);

    const sessionFormateurAssociee =
      obtenirSessionFormateurPourElevationAdministration_(jetonFormateur);
    const jeton = creerSecretAleatoireSecurite_();
    const empreinteJeton = hacherJetonAdministration_(jeton);
    const idSession = Utilities.getUuid().slice(0, 12);
    const session = {
      idSession: idSession,
      creeA: maintenant,
      derniereActivite: maintenant,
      expireA: maintenant + DUREE_SESSION_ADMIN_MS,
      modeAccesAdministration: sessionFormateurAssociee
        ? 'ELEVATION_FORMATEUR'
        : 'ADMINISTRATION_DIRECTE',
      idUtilisateurFormateur: sessionFormateurAssociee
        ? String(sessionFormateurAssociee.idUtilisateur || '')
        : '',
      idFormateurAssocie: sessionFormateurAssociee
        ? String(sessionFormateurAssociee.idFormateur || '')
        : '',
      identifiantFormateur: sessionFormateurAssociee
        ? String(sessionFormateurAssociee.identifiant || '')
        : '',
      nomFormateur: sessionFormateurAssociee
        ? String(sessionFormateurAssociee.nom || '')
        : '',
      prenomFormateur: sessionFormateurAssociee
        ? String(sessionFormateurAssociee.prenom || '')
        : '',
      expireAbsolueFormateurA: sessionFormateurAssociee
        ? Number(sessionFormateurAssociee.expireAbsolueA || 0)
        : 0
    };

    proprietes.setProperty(
      PREFIXE_SESSION_ADMIN + empreinteJeton,
      JSON.stringify(session)
    );
    enregistrerActiviteSessionAdministrationCache_(
      PREFIXE_SESSION_ADMIN + empreinteJeton,
      maintenant
    );
    enregistrerTypeSessionUtilisateurCache_(
      jeton,
      'ADMINISTRATEUR'
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
        DUREE_SESSION_ADMIN_MS / 60000,
      modeAccesAdministration:
        resultat.sessionUtilisateur.modeAccesAdministration,
      idUtilisateur: resultat.sessionUtilisateur.idUtilisateur || '',
      idFormateur: resultat.sessionUtilisateur.idFormateur || ''
    },
    construireIdentifiantHistoriqueAdministrationDepuisContexte_(
      resultat.sessionUtilisateur
    )
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
  supprimerSessionAdministrationParJeton_(jetonAdministrateur);

  journaliserEvenementSecuriteSansBloquer_(
    'ADMIN_VERROUILLAGE',
    'SECURITE',
    session.idSession,
    {
      modeAccesAdministration: String(
        session.modeAccesAdministration || 'ADMINISTRATION_DIRECTE'
      ),
      idUtilisateur: String(session.idUtilisateurFormateur || ''),
      idFormateur: String(session.idFormateurAssocie || '')
    },
    construireIdentifiantHistoriqueAdministration_(session)
  );

  return {
    succes: true,
    sessionUtilisateur: construireSessionUtilisateur_(null)
  };
}


function exigerAdministrateur_(jetonAdministrateur, diagnostic) {
  const debutTotal = diagnostic ? Date.now() : 0;
  initialiserDiagnosticValidationUtilisateur_(diagnostic);
  const sessionAdministration =
    obtenirSessionAdministrationValide_(
      jetonAdministrateur,
      true,
      true,
      false,
      diagnostic
    );
  const debutContexte = diagnostic ? Date.now() : 0;
  const sessionUtilisateur =
    construireSessionUtilisateur_(sessionAdministration);
  ajouterDureeDiagnosticValidationUtilisateur_(
    diagnostic,
    'constructionContexteMs',
    debutContexte
  );

  sessionUtilisateur.identifiantHistorique =
    construireIdentifiantHistoriqueAdministration_(
      sessionAdministration
    );

  finaliserDiagnosticValidationUtilisateur_(diagnostic, debutTotal);
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
  let mutationCommencee = false;

  if (!verrouDejaDetenu && !verrou.tryLock(30000)) {
    throw new Error(
      'Une autre opération est en cours. Réessaie dans quelques instants.'
    );
  }

  try {
    exigerEcritureAutorisee_(contexteInterne);
    mutationCommencee = true;
    return traitement();
  } finally {
    if (
      mutationCommencee &&
      typeof invaliderCacheRechercheGlobale_ === 'function'
    ) {
      invaliderCacheRechercheGlobale_();
    }
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
  const derniereActiviteEffective = Math.max(
    Number(session.derniereActivite || 0),
    lireActiviteSessionAdministrationCache_(cle)
  );

  if (
    !session.idSession ||
    !session.derniereActivite ||
    !Number(session.expireA || 0) ||
    maintenant - derniereActiviteEffective >=
      DUREE_SESSION_ADMIN_MS
  ) {
    throw new Error('Accès réservé à l’administrateur.');
  }

  const sessionUtilisateur = construireSessionUtilisateur_(session);

  sessionUtilisateur.identifiantHistorique =
    construireIdentifiantHistoriqueAdministration_(session);

  return sessionUtilisateur;
}


function verifierAccesPage_(nomPage, jetonUtilisateur, diagnostic) {
  const debutTotal = diagnostic ? Date.now() : 0;
  if (diagnostic) {
    diagnostic.operation = 'VERIFICATION_ACCES_PAGE';
    diagnostic.controleDroitsMs = 0;
    diagnostic.appelsAutresServices = [];
  }
  const diagnosticValidation = diagnostic ? {} : null;
  const session = exigerUtilisateurAuthentifie_(
    jetonUtilisateur,
    diagnosticValidation
  );
  const debutDroits = diagnostic ? Date.now() : 0;
  const accesAdministrateurRequis = [
    'Referentiel',
    'Indemnisation',
    'Administration'
  ].includes(String(nomPage || ''));
  if (diagnostic) {
    diagnostic.controleDroitsMs = Date.now() - debutDroits;
    diagnostic.appelsAutresServices.push(diagnosticValidation);
  }
  if (accesAdministrateurRequis && !session.estAdministrateur) {
    if (diagnostic) {
      diagnostic.totalServeurMs = Date.now() - debutTotal;
    }
    throw new Error('Accès réservé à l’administrateur.');
  }
  if (diagnostic) {
    diagnostic.totalServeurMs = Date.now() - debutTotal;
  }
  return session;
}


function obtenirSessionAdministrationValide_(
  jetonAdministrateur,
  renouveler,
  erreurSiInvalide,
  forcerEcritureActivite,
  diagnostic
) {
  const debutTotal = diagnostic ? Date.now() : 0;
  try {
    initialiserDiagnosticValidationUtilisateur_(diagnostic);
    const jeton = String(jetonAdministrateur || '').trim();

    if (!/^[A-Za-z0-9_-]{40,200}$/.test(jeton)) {
      if (erreurSiInvalide) {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return null;
    }

    let debutEtape = diagnostic ? Date.now() : 0;
    const proprietes = PropertiesService.getScriptProperties();
    ajouterDureeDiagnosticValidationUtilisateur_(
      diagnostic,
      'accesPropertiesServiceMs',
      debutEtape
    );
    const maintenant = Date.now();
    const cle =
      PREFIXE_SESSION_ADMIN +
      hacherJetonAdministration_(jeton);
    debutEtape = diagnostic ? Date.now() : 0;
    const valeur = proprietes.getProperty(cle);
    ajouterDureeDiagnosticValidationUtilisateur_(
      diagnostic,
      'lectureSessionPersistanteMs',
      debutEtape
    );

    if (!valeur) {
      if (erreurSiInvalide) {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return null;
    }

    let session;

    debutEtape = diagnostic ? Date.now() : 0;
    try {
      session = JSON.parse(valeur);
    } catch (erreur) {
      supprimerSessionAdministrationCibleInvalide_(cle, '');

      if (erreurSiInvalide) {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return null;
    } finally {
      ajouterDureeDiagnosticValidationUtilisateur_(
        diagnostic,
        'parsingSessionMs',
        debutEtape
      );
    }

    const derniereActivitePersistante = Number(
      session.derniereActivite || 0
    );
    debutEtape = diagnostic ? Date.now() : 0;
    const derniereActiviteEffective = Math.max(
      derniereActivitePersistante,
      lireActiviteSessionAdministrationCache_(cle)
    );
    ajouterDureeDiagnosticValidationUtilisateur_(
      diagnostic,
      'lectureCacheActiviteMs',
      debutEtape
    );

    debutEtape = diagnostic ? Date.now() : 0;
    const sessionExpiree = Boolean(
      !session.idSession ||
      !session.derniereActivite ||
      !Number(session.expireA || 0) ||
      maintenant - derniereActiviteEffective >=
        DUREE_SESSION_ADMIN_MS
    );
    ajouterDureeDiagnosticValidationUtilisateur_(
      diagnostic,
      'controleExpirationMs',
      debutEtape
    );
    if (sessionExpiree) {
      supprimerSessionAdministrationCibleInvalide_(cle, session.idSession);

      if (erreurSiInvalide) {
        throw new Error('Accès réservé à l’administrateur.');
      }
      return null;
    }

    if (renouveler) {
      debutEtape = diagnostic ? Date.now() : 0;
      enregistrerActiviteSessionAdministrationCache_(cle, maintenant);
      if (
        forcerEcritureActivite ||
        maintenant - derniereActivitePersistante >=
          DUREE_THROTTLE_ACTIVITE_SESSION_ADMIN_MS_
      ) {
        const sessionRenouvelee =
          renouvelerSessionAdministrationPersistante_(
            proprietes,
            cle,
            session,
            maintenant
          );
        if (!sessionRenouvelee) {
          if (erreurSiInvalide) {
            throw new Error('Accès réservé à l’administrateur.');
          }
          return null;
        }
        session = sessionRenouvelee;
      }
      ajouterDureeDiagnosticValidationUtilisateur_(
        diagnostic,
        'renouvellementActiviteMs',
        debutEtape
      );
    }
    session.expireA = Math.max(
      Number(session.expireA || 0),
      (renouveler ? maintenant : derniereActiviteEffective) +
        DUREE_SESSION_ADMIN_MS
    );

    return session;
  } finally {
    if (diagnostic) {
      diagnostic.totalValidationSessionMs = Number(
        diagnostic.totalValidationSessionMs || 0
      ) + Math.max(0, Date.now() - debutTotal);
    }
  }
}


function supprimerSessionAdministrationCibleInvalide_(cleSession, idSession) {
  const verrou = LockService.getScriptLock();
  const verrouDejaDetenu = typeof verrou.hasLock === 'function' &&
    verrou.hasLock();
  if (!verrouDejaDetenu && !verrou.tryLock(10000)) {
    supprimerActiviteSessionAdministrationCache_(cleSession);
    return;
  }
  try {
    const proprietes = PropertiesService.getScriptProperties();
    const valeurCourante = proprietes.getProperty(cleSession);
    if (valeurCourante && idSession) {
      try {
        const sessionCourante = JSON.parse(valeurCourante);
        if (
          String(sessionCourante.idSession || '') !== String(idSession)
        ) {
          return;
        }
      } catch (erreurJson) {
        // Une valeur illisible portant la même clé doit être retirée.
      }
    }
    proprietes.deleteProperty(cleSession);
  } finally {
    if (!verrouDejaDetenu) verrou.releaseLock();
    supprimerActiviteSessionAdministrationCache_(cleSession);
  }
}


function renouvelerSessionAdministrationPersistante_(
  proprietes,
  cleSession,
  sessionValidee,
  maintenant
) {
  const verrou = LockService.getScriptLock();
  const verrouDejaDetenu = typeof verrou.hasLock === 'function' &&
    verrou.hasLock();
  if (!verrouDejaDetenu && !verrou.tryLock(10000)) return null;
  try {
    const valeurCourante = proprietes.getProperty(cleSession);
    if (!valeurCourante) return null;
    let sessionCourante;
    try {
      sessionCourante = JSON.parse(valeurCourante);
    } catch (erreurJson) {
      proprietes.deleteProperty(cleSession);
      return null;
    }
    if (
      String(sessionCourante.idSession || '') !==
        String(sessionValidee.idSession || '')
    ) {
      return null;
    }
    const derniereActiviteEffective = Math.max(
      Number(sessionCourante.derniereActivite || 0),
      lireActiviteSessionAdministrationCache_(cleSession)
    );
    if (
      !sessionCourante.derniereActivite ||
      maintenant - derniereActiviteEffective >= DUREE_SESSION_ADMIN_MS
    ) {
      proprietes.deleteProperty(cleSession);
      return null;
    }
    sessionCourante.derniereActivite = maintenant;
    sessionCourante.expireA = maintenant + DUREE_SESSION_ADMIN_MS;
    proprietes.setProperty(cleSession, JSON.stringify(sessionCourante));
    return sessionCourante;
  } finally {
    if (!verrouDejaDetenu) verrou.releaseLock();
  }
}


function lireTypeSessionUtilisateurCache_(jetonUtilisateur) {
  try {
    const type = String(
      CacheService.getScriptCache().get(
        construireCleCacheTypeSessionUtilisateur_(jetonUtilisateur)
      ) || ''
    );
    return ['FORMATEUR', 'ADMINISTRATEUR'].includes(type) ? type : '';
  } catch (erreur) {
    return '';
  }
}


function enregistrerTypeSessionUtilisateurCache_(jetonUtilisateur, type) {
  const typeNormalise = String(type || '').toUpperCase();
  if (!['FORMATEUR', 'ADMINISTRATEUR'].includes(typeNormalise)) return;
  try {
    CacheService.getScriptCache().put(
      construireCleCacheTypeSessionUtilisateur_(jetonUtilisateur),
      typeNormalise,
      DUREE_CACHE_TYPE_SESSION_UTILISATEUR_SECONDES_
    );
  } catch (erreur) {
    // Le routage retombe sur les deux validations persistantes ciblées.
  }
}


function supprimerTypeSessionUtilisateurCache_(jetonUtilisateur) {
  try {
    CacheService.getScriptCache().remove(
      construireCleCacheTypeSessionUtilisateur_(jetonUtilisateur)
    );
  } catch (erreur) {
    // Une entrée de routage ne peut jamais valider une session à elle seule.
  }
}


function construireCleCacheTypeSessionUtilisateur_(jetonUtilisateur) {
  const octets = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'ROUTAGE_SESSION\u0000' + String(jetonUtilisateur || ''),
    Utilities.Charset.UTF_8
  );
  return PREFIXE_CACHE_TYPE_SESSION_UTILISATEUR_ +
    Utilities.base64EncodeWebSafe(octets).replace(/=+$/g, '');
}


function motDePasseAdministrateurConfigure_() {
  try {
    const valeurCache = CacheService.getScriptCache().get(
      CLE_CACHE_CONFIGURATION_ADMIN_
    );
    if (valeurCache === '1') return true;
    if (valeurCache === '0') return false;
  } catch (erreurCache) {
    // La propriété persistante reste utilisée ci-dessous.
  }
  const proprietes = PropertiesService.getScriptProperties();
  const configure = Boolean(
    proprietes.getProperty(PROPRIETE_SEL_ADMIN) &&
    proprietes.getProperty(PROPRIETE_HASH_ADMIN)
  );
  try {
    CacheService.getScriptCache().put(
      CLE_CACHE_CONFIGURATION_ADMIN_,
      configure ? '1' : '0',
      DUREE_CACHE_CONFIGURATION_ADMIN_SECONDES_
    );
  } catch (erreurCache) {
    // Cette valeur est informative et sera simplement relue si nécessaire.
  }
  return configure;
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
    try {
      CacheService.getScriptCache().put(
        CLE_CACHE_CONFIGURATION_ADMIN_,
        '1',
        DUREE_CACHE_CONFIGURATION_ADMIN_SECONDES_
      );
    } catch (erreurCache) {
      // Le secret persistant vient d'être écrit et reste la source de vérité.
    }
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
      const derniereActiviteEffective = Math.max(
        Number(session.derniereActivite || 0),
        lireActiviteSessionAdministrationCache_(cle)
      );

      if (
        !session.derniereActivite ||
        !Number(session.expireA || 0) ||
        maintenant - derniereActiviteEffective >=
          DUREE_SESSION_ADMIN_MS
      ) {
        proprietes.deleteProperty(cle);
        supprimerActiviteSessionAdministrationCache_(cle);
      }
    } catch (erreur) {
      proprietes.deleteProperty(cle);
      supprimerActiviteSessionAdministrationCache_(cle);
    }
  });
}


function supprimerToutesSessionsAdministration_(proprietes) {
  const toutes = proprietes.getProperties();

  Object.keys(toutes).forEach(function (cle) {
    if (cle.startsWith(PREFIXE_SESSION_ADMIN)) {
      proprietes.deleteProperty(cle);
      supprimerActiviteSessionAdministrationCache_(cle);
    }
  });
}


function limiterSessionsAdministrationAvantCreation_(proprietes) {
  const toutes = proprietes.getProperties();
  const sessions = Object.keys(toutes)
    .filter(function (cle) {
      return cle.startsWith(PREFIXE_SESSION_ADMIN);
    })
    .map(function (cle) {
      try {
        return { cle: cle, session: JSON.parse(toutes[cle]) };
      } catch (erreur) {
        proprietes.deleteProperty(cle);
        supprimerActiviteSessionAdministrationCache_(cle);
        return null;
      }
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return Number(a.session.creeA || 0) - Number(b.session.creeA || 0);
    });
  const excedent = Math.max(
    0,
    sessions.length - NOMBRE_MAX_SESSIONS_ADMIN_ + 1
  );
  sessions.slice(0, excedent).forEach(function (entree) {
    proprietes.deleteProperty(entree.cle);
    supprimerActiviteSessionAdministrationCache_(entree.cle);
  });
}


function supprimerSessionAdministrationParJeton_(jetonAdministrateur) {
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le service d’authentification est momentanément occupé.'
    );
  }
  try {
    const cle = PREFIXE_SESSION_ADMIN +
      hacherJetonAdministration_(jetonAdministrateur);
    PropertiesService.getScriptProperties().deleteProperty(cle);
    supprimerActiviteSessionAdministrationCache_(cle);
  } finally {
    verrou.releaseLock();
  }
  supprimerTypeSessionUtilisateurCache_(jetonAdministrateur);
}


function lireActiviteSessionAdministrationCache_(cleSession) {
  try {
    return Number(
      CacheService.getScriptCache().get(
        PREFIXE_CACHE_ACTIVITE_SESSION_ADMIN_ + cleSession
      ) || 0
    );
  } catch (erreur) {
    return 0;
  }
}


function enregistrerActiviteSessionAdministrationCache_(
  cleSession,
  maintenant
) {
  try {
    CacheService.getScriptCache().put(
      PREFIXE_CACHE_ACTIVITE_SESSION_ADMIN_ + cleSession,
      String(maintenant),
      Math.ceil(DUREE_SESSION_ADMIN_MS / 1000)
    );
  } catch (erreur) {
    // Le timestamp persistant conserve une dégradation sûre et bornée.
  }
}


function supprimerActiviteSessionAdministrationCache_(cleSession) {
  try {
    CacheService.getScriptCache().remove(
      PREFIXE_CACHE_ACTIVITE_SESSION_ADMIN_ + cleSession
    );
  } catch (erreur) {
    // Le cache est une optimisation : l'expiration persistante reste active.
  }
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
