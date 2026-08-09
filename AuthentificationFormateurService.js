'use strict';

const COLONNES_UTILISATEURS_AUTHENTIFICATION_ = [
  'ID_UTILISATEUR',
  'ID_FORMATEUR',
  'IDENTIFIANT',
  'PASSWORD_HASH',
  'PASSWORD_SALT',
  'ACTIF',
  'DOIT_CHANGER_MOT_DE_PASSE',
  'NB_ECHECS',
  'BLOQUE_JUSQU_A',
  'DERNIERE_CONNEXION',
  'DATE_MODIFICATION_MDP',
  'DATE_CREATION',
  'DATE_MODIFICATION'
];

const PREFIXE_SESSION_FORMATEUR_ = 'FORMATEUR_SESSION_';
const PREFIXE_CHANGEMENT_INITIAL_FORMATEUR_ =
  'FORMATEUR_PASSWORD_CHALLENGE_';
const PROPRIETE_ECHECS_IDENTIFIANTS_INCONNUS_ =
  'FORMATEUR_UNKNOWN_ATTEMPTS';
const PROPRIETE_PEPPER_MOT_DE_PASSE_FORMATEUR_ =
  'FORMATEUR_PASSWORD_PEPPER';
const PREFIXE_CACHE_ACTIVITE_SESSION_FORMATEUR_ =
  'FORMATEUR_LAST_ACTIVITY_';
const LIMITE_IDENTIFIANTS_INCONNUS_MEMORISES_ = 100;
const NOMBRE_MAX_SESSIONS_PAR_UTILISATEUR_FORMATEUR_ = 5;
const NOMBRE_MAX_SESSIONS_FORMATEURS_ = 200;
const NOMBRE_MAX_DEFIS_CHANGEMENT_FORMATEURS_ = 100;
const DUREE_ABSOLUE_SESSION_FORMATEUR_MS_ = 8 * 60 * 60 * 1000;
const DUREE_INACTIVITE_SESSION_FORMATEUR_MS_ = 60 * 60 * 1000;
const DUREE_THROTTLE_ACTIVITE_SESSION_FORMATEUR_MS_ = 5 * 60 * 1000;
const DUREE_CHANGEMENT_INITIAL_FORMATEUR_MS_ = 10 * 60 * 1000;
const ITERATIONS_PBKDF2_FORMATEUR_ = 20000;
const LONGUEUR_MIN_MOT_DE_PASSE_FORMATEUR_ = 15;
const LONGUEUR_MAX_MOT_DE_PASSE_FORMATEUR_ = 512;
const VERSION_VERIFICATEUR_MOT_DE_PASSE_FORMATEUR_ = 'PF2';
const ALGORITHME_PBKDF2_FORMATEUR_ = 'PBKDF2-HMAC-SHA-256';
const ALGORITHME_PEPPER_FORMATEUR_ = 'HMAC-SHA-256';
const NOMBRE_ECHECS_AVANT_BLOCAGE_FORMATEUR_ = 5;
const MESSAGE_AUTHENTIFICATION_FORMATEUR_INVALIDE_ =
  'Identifiant ou mot de passe incorrect.';


/**
 * Authentifie un formateur. Une première connexion ne reçoit jamais une
 * session métier : seul un défi opaque de changement de mot de passe est
 * retourné.
 */
function connecterFormateur(identifiant, motDePasse) {
  const identifiantNormalise = normaliserIdentifiantFormateur_(
    identifiant,
    false
  );
  const tentative = normaliserMotDePasseFormateur_(motDePasse);

  return executerMutationMetier_(function () {
    const table = lireTableUtilisateursAuthentification_();
    const compte = identifiantNormalise
      ? trouverCompteParIdentifiant_(table, identifiantNormalise)
      : null;
    const sel = compte
      ? valeurCompteAuthentification_(table, compte.ligne, 'PASSWORD_SALT')
      : 'SEL_FACTICE_PREPFORMATION_FORMATEUR_V2';
    const hashAttendu = compte
      ? valeurCompteAuthentification_(table, compte.ligne, 'PASSWORD_HASH')
      : [
        VERSION_VERIFICATEUR_MOT_DE_PASSE_FORMATEUR_,
        ALGORITHME_PBKDF2_FORMATEUR_,
        ITERATIONS_PBKDF2_FORMATEUR_,
        ALGORITHME_PEPPER_FORMATEUR_,
        'HASH_FACTICE'
      ].join('$');
    const verificationMotDePasse = verifierMotDePasseFormateur_(
      tentative,
      sel,
      hashAttendu
    );
    const maintenant = Date.now();
    const formateur = compte
      ? trouverFormateurCompteAuthentification_(
        valeurCompteAuthentification_(
          table,
          compte.ligne,
          'ID_FORMATEUR'
        )
      )
      : null;
    const compteActif = compte && convertirBooleenAuthentification_(
      valeurBruteCompteAuthentification_(table, compte.ligne, 'ACTIF')
    );
    const formateurActif = formateur && convertirBooleenAuthentification_(
      formateur.actif
    );
    const bloqueJusqua = compte
      ? convertirDateAuthentification_(
        valeurBruteCompteAuthentification_(
          table,
          compte.ligne,
          'BLOQUE_JUSQU_A'
        )
      )
      : null;
    const authentificationValide = Boolean(
      compte &&
      compteActif &&
      formateurActif &&
      (!bloqueJusqua || bloqueJusqua.getTime() <= maintenant) &&
      verificationMotDePasse.valide
    );

    if (!authentificationValide) {
      if (compte) {
        enregistrerEchecCompteFormateur_(table, compte, maintenant);
      } else {
        enregistrerEchecIdentifiantInconnu_(
          identifiantNormalise || 'IDENTIFIANT_INVALIDE',
          maintenant
        );
      }

      journaliserEvenementSecuriteSansBloquer_(
        'FORMATEUR_AUTHENTIFICATION_ECHEC',
        'AUTHENTIFICATION_FORMATEUR',
        Utilities.getUuid().slice(0, 12),
        { resultat: 'REFUSE' },
        'TENTATIVE_FORMATEUR'
      );
      throw new Error(MESSAGE_AUTHENTIFICATION_FORMATEUR_INVALIDE_);
    }

    mettreAJourCompteApresConnexion_(
      table,
      compte,
      maintenant,
      verificationMotDePasse.doitMettreAJour ? tentative : ''
    );
    supprimerEchecsIdentifiantInconnu_(identifiantNormalise);

    const doitChanger = convertirBooleenAuthentification_(
      valeurBruteCompteAuthentification_(
        table,
        compte.ligne,
        'DOIT_CHANGER_MOT_DE_PASSE'
      )
    );

    if (doitChanger) {
      const defi = creerDefiChangementInitialFormateur_(
        compte,
        table,
        maintenant
      );

      journaliserEvenementSecuriteSansBloquer_(
        'FORMATEUR_PREMIERE_CONNEXION',
        'UTILISATEUR',
        valeurCompteAuthentification_(
          table,
          compte.ligne,
          'ID_UTILISATEUR'
        ),
        {
          idFormateur: formateur.idFormateur,
          changementMotDePasseRequis: true
        },
        construireIdentifiantHistoriqueFormateurDepuisCompte_(
          table,
          compte.ligne
        )
      );

      return {
        authentifie: true,
        changementMotDePasseRequis: true,
        jetonChangementMotDePasse: defi.jeton,
        expirationChangementMotDePasse: new Date(
          defi.expireA
        ).toISOString()
      };
    }

    const session = creerSessionFormateur_(compte, table, formateur);
    journaliserConnexionFormateur_(session.sessionServeur);
    return {
      authentifie: true,
      changementMotDePasseRequis: false,
      jeton: session.jeton,
      sessionUtilisateur: construireSessionUtilisateur_(
        null,
        session.sessionServeur
      )
    };
  });
}


function terminerPremiereConnexionFormateur(
  jetonChangement,
  nouveauMotDePasse,
  confirmationMotDePasse
) {
  const motDePasseNormalise = verifierNouveauMotDePasseFormateur_(
    nouveauMotDePasse,
    confirmationMotDePasse
  );

  return executerMutationMetier_(function () {
    const defi = consommerDefiChangementInitialFormateur_(jetonChangement);
    const table = lireTableUtilisateursAuthentification_();
    const compte = trouverCompteParIdUtilisateur_(
      table,
      defi.idUtilisateur
    );

    if (!compte) {
      throw new Error('Le compte formateur est introuvable.');
    }

    const formateur = trouverFormateurCompteAuthentification_(
      valeurCompteAuthentification_(table, compte.ligne, 'ID_FORMATEUR')
    );

    if (
      !formateur ||
      !convertirBooleenAuthentification_(formateur.actif) ||
      !convertirBooleenAuthentification_(
        valeurBruteCompteAuthentification_(table, compte.ligne, 'ACTIF')
      ) ||
      !convertirBooleenAuthentification_(
        valeurBruteCompteAuthentification_(
          table,
          compte.ligne,
          'DOIT_CHANGER_MOT_DE_PASSE'
        )
      )
    ) {
      throw new Error('Ce compte formateur n’est plus actif.');
    }

    remplacerMotDePasseCompteFormateur_(
      table,
      compte,
      motDePasseNormalise,
      false
    );
    invaliderSessionsUtilisateurFormateur_(defi.idUtilisateur);
    const session = creerSessionFormateur_(compte, table, formateur);

    journaliserActionSensible_(
      'FORMATEUR_MOT_DE_PASSE_INITIAL_MODIFIE',
      'UTILISATEUR',
      defi.idUtilisateur,
      { idFormateur: formateur.idFormateur },
      construireIdentifiantHistoriqueFormateur_(session.sessionServeur)
    );

    return {
      succes: true,
      jeton: session.jeton,
      sessionUtilisateur: construireSessionUtilisateur_(
        null,
        session.sessionServeur
      )
    };
  });
}


function changerMotDePasseFormateur(
  jetonFormateur,
  motDePasseActuel,
  nouveauMotDePasse,
  confirmationMotDePasse
) {
  const sessionInitiale = obtenirSessionFormateurValide_(
    jetonFormateur,
    false,
    true
  );
  const nouveauMotDePasseNormalise = verifierNouveauMotDePasseFormateur_(
    nouveauMotDePasse,
    confirmationMotDePasse
  );

  return executerMutationMetier_(function () {
    const table = lireTableUtilisateursAuthentification_();
    const compte = trouverCompteParIdUtilisateur_(
      table,
      sessionInitiale.idUtilisateur
    );

    if (!compte) {
      throw new Error('La session formateur n’est plus valide.');
    }

    const formateur = trouverFormateurCompteAuthentification_(
      sessionInitiale.idFormateur
    );
    if (
      !formateur ||
      !convertirBooleenAuthentification_(formateur.actif) ||
      !convertirBooleenAuthentification_(
        valeurBruteCompteAuthentification_(table, compte.ligne, 'ACTIF')
      ) ||
      convertirBooleenAuthentification_(
        valeurBruteCompteAuthentification_(
          table,
          compte.ligne,
          'DOIT_CHANGER_MOT_DE_PASSE'
        )
      )
    ) {
      throw new Error('La session formateur n’est plus valide.');
    }

    const sel = valeurCompteAuthentification_(
      table,
      compte.ligne,
      'PASSWORD_SALT'
    );
    const hashAttendu = valeurCompteAuthentification_(
      table,
      compte.ligne,
      'PASSWORD_HASH'
    );
    const verificationActuelle = verifierMotDePasseFormateur_(
      motDePasseActuel,
      sel,
      hashAttendu
    );

    if (!verificationActuelle.valide) {
      throw new Error(MESSAGE_AUTHENTIFICATION_FORMATEUR_INVALIDE_);
    }

    remplacerMotDePasseCompteFormateur_(
      table,
      compte,
      nouveauMotDePasseNormalise,
      false
    );
    invaliderSessionsUtilisateurFormateur_(sessionInitiale.idUtilisateur);
    const nouvelleSession = creerSessionFormateur_(
      compte,
      table,
      formateur
    );

    journaliserActionSensible_(
      'FORMATEUR_MOT_DE_PASSE_MODIFIE',
      'UTILISATEUR',
      sessionInitiale.idUtilisateur,
      { idFormateur: sessionInitiale.idFormateur },
      construireIdentifiantHistoriqueFormateur_(sessionInitiale)
    );

    return {
      succes: true,
      jeton: nouvelleSession.jeton,
      sessionUtilisateur: construireSessionUtilisateur_(
        null,
        nouvelleSession.sessionServeur
      )
    };
  });
}


function renouvelerSessionFormateur(jetonFormateur) {
  const session = obtenirSessionFormateurValide_(
    jetonFormateur,
    true,
    true
  );
  return construireSessionUtilisateur_(null, session);
}


function deconnecterFormateur(jetonFormateur, jetonAdministrateurAssocie) {
  const session = obtenirSessionFormateurValide_(
    jetonFormateur,
    false,
    false
  );
  let sessionAdministrationAssociee = null;
  if (
    jetonAdministrateurAssocie &&
    typeof obtenirSessionAdministrationValide_ === 'function'
  ) {
    try {
      sessionAdministrationAssociee =
        obtenirSessionAdministrationValide_(
          jetonAdministrateurAssocie,
          false,
          false
        );
    } catch (erreur) {
      sessionAdministrationAssociee = null;
    }
  }
  supprimerSessionFormateurParJeton_(jetonFormateur);
  if (
    jetonAdministrateurAssocie &&
    typeof supprimerSessionAdministrationParJeton_ === 'function'
  ) {
    supprimerSessionAdministrationParJeton_(
      jetonAdministrateurAssocie
    );
  }

  if (session) {
    journaliserEvenementSecuriteSansBloquer_(
      'FORMATEUR_DECONNEXION',
      'UTILISATEUR',
      session.idUtilisateur,
      { idFormateur: session.idFormateur },
      construireIdentifiantHistoriqueFormateur_(session)
    );
  }
  if (sessionAdministrationAssociee) {
    journaliserEvenementSecuriteSansBloquer_(
      'ADMIN_VERROUILLAGE_DECONNEXION_FORMATEUR',
      'SECURITE',
      sessionAdministrationAssociee.idSession,
      {
        modeAccesAdministration: String(
          sessionAdministrationAssociee.modeAccesAdministration ||
            'ADMINISTRATION_DIRECTE'
        )
      },
      typeof construireIdentifiantHistoriqueAdministration_ === 'function'
        ? construireIdentifiantHistoriqueAdministration_(
          sessionAdministrationAssociee
        )
        : 'SESSION_ADMIN:' + sessionAdministrationAssociee.idSession
    );
  }

  return {
    succes: true,
    administrationAssocieeInvalidee: Boolean(
      jetonAdministrateurAssocie
    )
  };
}


function proposerIdentifiantCompteFormateur(
  idFormateur,
  jetonAdministrateur
) {
  exigerAdministrateur_(jetonAdministrateur);
  const formateur = trouverFormateurCompteAuthentification_(idFormateur);
  if (!formateur) {
    throw new Error('Formateur introuvable.');
  }
  const table = lireTableUtilisateursAuthentification_();
  return {
    identifiant: proposerIdentifiantUniqueFormateur_(
      formateur.prenom,
      formateur.nom,
      table,
      ''
    )
  };
}


function creerAccesFormateur(donnees, jetonAdministrateur) {
  const sessionAdministrateur = exigerAdministrateur_(
    jetonAdministrateur
  );
  donnees = donnees || {};

  return executerMutationMetier_(function () {
    const idFormateur = String(donnees.idFormateur || '').trim();
    const formateur = trouverFormateurCompteAuthentification_(idFormateur);
    if (!formateur) {
      throw new Error('Formateur introuvable.');
    }
    const table = lireTableUtilisateursAuthentification_();
    if (trouverCompteParIdFormateur_(table, idFormateur)) {
      throw new Error('Ce formateur possède déjà un accès.');
    }

    const identifiant = normaliserIdentifiantFormateur_(
      donnees.identifiant || proposerIdentifiantUniqueFormateur_(
        formateur.prenom,
        formateur.nom,
        table,
        ''
      ),
      true
    );
    if (trouverCompteParIdentifiant_(table, identifiant)) {
      throw new Error('Cet identifiant est déjà utilisé.');
    }

    const motDePasseSaisi = normaliserMotDePasseFormateur_(
      donnees.motDePasse
    );
    const motDePasseGenere = !motDePasseSaisi;
    const motDePasse = motDePasseGenere
      ? creerMotDePasseTemporaireFormateur_()
      : motDePasseSaisi;
    const motDePasseNormalise = verifierPolitiqueMotDePasseFormateur_(
      motDePasse
    );

    const maintenant = new Date();
    const sel = creerSecretAleatoireSecurite_();
    const ligne = new Array(table.feuille.getLastColumn()).fill('');
    const idUtilisateur = Utilities.getUuid();

    ligne[table.index.ID_UTILISATEUR] = idUtilisateur;
    ligne[table.index.ID_FORMATEUR] = idFormateur;
    ligne[table.index.IDENTIFIANT] = identifiant;
    ligne[table.index.PASSWORD_HASH] =
      deriverMotDePasseFormateur_(motDePasseNormalise, sel);
    ligne[table.index.PASSWORD_SALT] = sel;
    ligne[table.index.ACTIF] = 'Oui';
    ligne[table.index.DOIT_CHANGER_MOT_DE_PASSE] = 'Oui';
    ligne[table.index.NB_ECHECS] = 0;
    ligne[table.index.BLOQUE_JUSQU_A] = '';
    ligne[table.index.DERNIERE_CONNEXION] = '';
    ligne[table.index.DATE_MODIFICATION_MDP] = maintenant;
    ligne[table.index.DATE_CREATION] = maintenant;
    ligne[table.index.DATE_MODIFICATION] = maintenant;

    table.feuille.appendRow(ligne);
    appliquerFormatsDatesCompteFormateur_(
      table.feuille,
      table.feuille.getLastRow(),
      table.index
    );

    journaliserActionSensible_(
      'FORMATEUR_ACCES_CREATION',
      'UTILISATEUR',
      idUtilisateur,
      {
        idFormateur: idFormateur,
        identifiant: identifiant,
        motDePasseTemporaireGenere: motDePasseGenere,
        changementObligatoire: true
      },
      sessionAdministrateur.identifiantHistorique
    );

    return {
      succes: true,
      compte: construireCompteFormateurPublicDepuisLigne_(table, ligne),
      motDePasseTemporaire: motDePasseGenere
        ? motDePasseNormalise
        : '',
      motDePasseAfficheUneSeuleFois: motDePasseGenere
    };
  });
}


function executerActionAccesFormateur(
  idFormateur,
  action,
  options,
  jetonAdministrateur
) {
  const sessionAdministrateur = exigerAdministrateur_(
    jetonAdministrateur
  );
  const actionNormalisee = String(action || '').trim().toUpperCase();
  const actionsAutorisees = [
    'DESACTIVER',
    'REACTIVER',
    'REINITIALISER_MOT_DE_PASSE',
    'FORCER_CHANGEMENT_MOT_DE_PASSE',
    'DEBLOQUER'
  ];
  if (!actionsAutorisees.includes(actionNormalisee)) {
    throw new Error('Action de gestion du compte invalide.');
  }

  return executerMutationMetier_(function () {
    const table = lireTableUtilisateursAuthentification_();
    const compte = trouverCompteParIdFormateur_(
      table,
      String(idFormateur || '').trim()
    );
    if (!compte) {
      throw new Error('Aucun accès n’est associé à ce formateur.');
    }

    const ligne = compte.ligne;
    const idUtilisateur = valeurCompteAuthentification_(
      table,
      ligne,
      'ID_UTILISATEUR'
    );
    let motDePasseTemporaire = '';

    if (actionNormalisee === 'DESACTIVER') {
      ligne[table.index.ACTIF] = 'Non';
      invaliderSessionsUtilisateurFormateur_(idUtilisateur);
    }
    if (actionNormalisee === 'REACTIVER') {
      ligne[table.index.ACTIF] = 'Oui';
    }
    if (actionNormalisee === 'DEBLOQUER') {
      ligne[table.index.NB_ECHECS] = 0;
      ligne[table.index.BLOQUE_JUSQU_A] = '';
    }
    if (actionNormalisee === 'FORCER_CHANGEMENT_MOT_DE_PASSE') {
      ligne[table.index.DOIT_CHANGER_MOT_DE_PASSE] = 'Oui';
      invaliderSessionsUtilisateurFormateur_(idUtilisateur);
    }
    if (actionNormalisee === 'REINITIALISER_MOT_DE_PASSE') {
      const motDePasseSaisi = normaliserMotDePasseFormateur_(
        options && options.motDePasse
      );
      motDePasseTemporaire = motDePasseSaisi ||
        creerMotDePasseTemporaireFormateur_();
      motDePasseTemporaire = verifierPolitiqueMotDePasseFormateur_(
        motDePasseTemporaire
      );
      remplacerMotDePasseCompteFormateur_(
        table,
        compte,
        motDePasseTemporaire,
        true
      );
      invaliderSessionsUtilisateurFormateur_(idUtilisateur);
    }

    ligne[table.index.DATE_MODIFICATION] = new Date();
    ecrireLigneCompteFormateur_(table, compte.numeroLigne, ligne);

    journaliserActionSensible_(
      'FORMATEUR_ACCES_' + actionNormalisee,
      'UTILISATEUR',
      idUtilisateur,
      {
        idFormateur: valeurCompteAuthentification_(
          table,
          ligne,
          'ID_FORMATEUR'
        ),
        sessionsInvalidees: [
          'DESACTIVER',
          'REINITIALISER_MOT_DE_PASSE',
          'FORCER_CHANGEMENT_MOT_DE_PASSE'
        ].includes(actionNormalisee)
      },
      sessionAdministrateur.identifiantHistorique
    );

    return {
      succes: true,
      action: actionNormalisee,
      compte: construireCompteFormateurPublicDepuisLigne_(table, ligne),
      motDePasseTemporaire:
        actionNormalisee === 'REINITIALISER_MOT_DE_PASSE'
          ? motDePasseTemporaire
          : '',
      motDePasseAfficheUneSeuleFois:
        actionNormalisee === 'REINITIALISER_MOT_DE_PASSE'
    };
  });
}


function obtenirComptesPublicsFormateursAdministration_() {
  const table = lireTableUtilisateursAuthentification_();
  const comptes = {};
  table.lignes.forEach(function (ligne) {
    const idFormateur = valeurCompteAuthentification_(
      table,
      ligne,
      'ID_FORMATEUR'
    );
    if (idFormateur) {
      comptes[idFormateur] =
        construireCompteFormateurPublicDepuisLigne_(table, ligne);
    }
  });
  return comptes;
}


function obtenirSessionFormateurValide_(
  jetonFormateur,
  renouveler,
  erreur,
  forcerEcritureActivite
) {
  const jeton = String(jetonFormateur || '').trim();
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(jeton)) {
    if (erreur) throw new Error('Authentification requise.');
    return null;
  }

  const proprietes = PropertiesService.getScriptProperties();
  const verrou = LockService.getScriptLock();
  const verrouDejaDetenu = typeof verrou.hasLock === 'function' &&
    verrou.hasLock();
  if (!verrouDejaDetenu && !verrou.tryLock(10000)) {
    if (erreur) throw new Error('Authentification requise.');
    return null;
  }

  try {
    const maintenant = Date.now();
    const cle = PREFIXE_SESSION_FORMATEUR_ +
      hacherJetonFormateur_(jeton);
    nettoyerSessionsFormateursDansProprietes_(proprietes, maintenant);
    const valeur = proprietes.getProperty(cle);
    if (!valeur) {
      if (erreur) throw new Error('Authentification requise.');
      return null;
    }

    let session;
    try {
      session = JSON.parse(valeur);
    } catch (erreurJson) {
      proprietes.deleteProperty(cle);
      if (erreur) throw new Error('Authentification requise.');
      return null;
    }

    const derniereActivitePersistante = Number(
      session.derniereActivite || 0
    );
    const derniereActiviteEffective = Math.max(
      derniereActivitePersistante,
      lireActiviteSessionFormateurCache_(cle)
    );
    if (
      !session.idSession ||
      !session.idUtilisateur ||
      !session.idFormateur ||
      Number(session.expireAbsolueA || 0) <= maintenant ||
      maintenant - derniereActiviteEffective >=
        DUREE_INACTIVITE_SESSION_FORMATEUR_MS_
    ) {
      proprietes.deleteProperty(cle);
      supprimerActiviteSessionFormateurCache_(cle);
      if (erreur) throw new Error('Authentification requise.');
      return null;
    }

    const table = lireTableUtilisateursAuthentification_();
    const compte = trouverCompteParIdUtilisateur_(
      table,
      session.idUtilisateur
    );
    const formateur = trouverFormateurCompteAuthentification_(
      session.idFormateur
    );
    const autorise = compte && formateur &&
      convertirBooleenAuthentification_(formateur.actif) &&
      convertirBooleenAuthentification_(
        valeurBruteCompteAuthentification_(table, compte.ligne, 'ACTIF')
      ) &&
      !convertirBooleenAuthentification_(
        valeurBruteCompteAuthentification_(
          table,
          compte.ligne,
          'DOIT_CHANGER_MOT_DE_PASSE'
        )
      );

    if (!autorise) {
      proprietes.deleteProperty(cle);
      supprimerActiviteSessionFormateurCache_(cle);
      if (erreur) throw new Error('Authentification requise.');
      return null;
    }

    session.nom = formateur.nom;
    session.prenom = formateur.prenom;
    session.identifiant = valeurCompteAuthentification_(
      table,
      compte.ligne,
      'IDENTIFIANT'
    );

    if (renouveler) {
      enregistrerActiviteSessionFormateurCache_(cle, maintenant);
      if (
        forcerEcritureActivite ||
        maintenant - derniereActivitePersistante >=
          DUREE_THROTTLE_ACTIVITE_SESSION_FORMATEUR_MS_
      ) {
        session.derniereActivite = maintenant;
        proprietes.setProperty(cle, JSON.stringify(session));
      }
    }
    return session;
  } finally {
    if (!verrouDejaDetenu) verrou.releaseLock();
  }
}


function creerSessionFormateur_(compte, table, formateur) {
  const jeton = creerSecretAleatoireSecurite_();
  const maintenant = Date.now();
  const sessionServeur = {
    idSession: Utilities.getUuid().slice(0, 12),
    idUtilisateur: valeurCompteAuthentification_(
      table,
      compte.ligne,
      'ID_UTILISATEUR'
    ),
    idFormateur: valeurCompteAuthentification_(
      table,
      compte.ligne,
      'ID_FORMATEUR'
    ),
    identifiant: valeurCompteAuthentification_(
      table,
      compte.ligne,
      'IDENTIFIANT'
    ),
    nom: formateur ? formateur.nom : '',
    prenom: formateur ? formateur.prenom : '',
    creeA: maintenant,
    derniereActivite: maintenant,
    expireAbsolueA: maintenant + DUREE_ABSOLUE_SESSION_FORMATEUR_MS_
  };
  const proprietes = PropertiesService.getScriptProperties();
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(10000)) {
    throw new Error('Le service de session est momentanément occupé.');
  }
  try {
    nettoyerSessionsFormateursDansProprietes_(proprietes, maintenant);
    limiterSessionsFormateursAvantCreation_(
      proprietes,
      sessionServeur.idUtilisateur
    );
    const cle = PREFIXE_SESSION_FORMATEUR_ + hacherJetonFormateur_(jeton);
    proprietes.setProperty(
      cle,
      JSON.stringify(sessionServeur)
    );
    enregistrerActiviteSessionFormateurCache_(cle, maintenant);
  } finally {
    verrou.releaseLock();
  }
  return { jeton: jeton, sessionServeur: sessionServeur };
}


function supprimerSessionFormateurParJeton_(jetonFormateur) {
  const jeton = String(jetonFormateur || '').trim();
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(jeton)) return;
  executerSousVerrouSessionsFormateur_(function () {
    const cle = PREFIXE_SESSION_FORMATEUR_ + hacherJetonFormateur_(jeton);
    PropertiesService.getScriptProperties().deleteProperty(cle);
    supprimerActiviteSessionFormateurCache_(cle);
  });
}


function invaliderSessionsUtilisateurFormateur_(idUtilisateur) {
  const id = String(idUtilisateur || '').trim();
  if (!id) return 0;
  return executerSousVerrouSessionsFormateur_(function () {
    const proprietes = PropertiesService.getScriptProperties();
    const toutes = proprietes.getProperties();
    let nombre = 0;
    Object.keys(toutes).forEach(function (cle) {
      if (
        !cle.startsWith(PREFIXE_SESSION_FORMATEUR_) &&
        !cle.startsWith(PREFIXE_CHANGEMENT_INITIAL_FORMATEUR_)
      ) return;
      try {
        const sessionOuDefi = JSON.parse(toutes[cle]);
        if (String(sessionOuDefi.idUtilisateur || '') === id) {
          proprietes.deleteProperty(cle);
          supprimerActiviteSessionFormateurCache_(cle);
          nombre++;
        }
      } catch (erreur) {
        proprietes.deleteProperty(cle);
        supprimerActiviteSessionFormateurCache_(cle);
      }
    });
    return nombre;
  });
}


function invaliderSessionsFormateurParIdFormateur_(idFormateur) {
  const table = lireTableUtilisateursAuthentification_();
  const compte = trouverCompteParIdFormateur_(
    table,
    String(idFormateur || '').trim()
  );
  if (!compte) return 0;
  return invaliderSessionsUtilisateurFormateur_(
    valeurCompteAuthentification_(
      table,
      compte.ligne,
      'ID_UTILISATEUR'
    )
  );
}


function nettoyerSessionsFormateursDansProprietes_(proprietes, maintenant) {
  const toutes = proprietes.getProperties();
  Object.keys(toutes).forEach(function (cle) {
    if (
      !cle.startsWith(PREFIXE_SESSION_FORMATEUR_) &&
      !cle.startsWith(PREFIXE_CHANGEMENT_INITIAL_FORMATEUR_)
    ) {
      return;
    }
    try {
      const objet = JSON.parse(toutes[cle]);
      const expire = cle.startsWith(PREFIXE_SESSION_FORMATEUR_)
        ? Number(objet.expireAbsolueA || 0) <= maintenant ||
          maintenant - Math.max(
            Number(objet.derniereActivite || 0),
            lireActiviteSessionFormateurCache_(cle)
          ) >= DUREE_INACTIVITE_SESSION_FORMATEUR_MS_
        : Number(objet.expireA || 0) <= maintenant;
      if (expire) {
        proprietes.deleteProperty(cle);
        supprimerActiviteSessionFormateurCache_(cle);
      }
    } catch (erreur) {
      proprietes.deleteProperty(cle);
      supprimerActiviteSessionFormateurCache_(cle);
    }
  });
}


function limiterSessionsFormateursAvantCreation_(proprietes, idUtilisateur) {
  const toutes = proprietes.getProperties();
  let sessions = Object.keys(toutes)
    .filter(function (cle) {
      return cle.startsWith(PREFIXE_SESSION_FORMATEUR_);
    })
    .map(function (cle) {
      try {
        return { cle: cle, session: JSON.parse(toutes[cle]) };
      } catch (erreur) {
        proprietes.deleteProperty(cle);
        supprimerActiviteSessionFormateurCache_(cle);
        return null;
      }
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return Number(a.session.creeA || 0) - Number(b.session.creeA || 0);
    });

  const memeUtilisateur = sessions.filter(function (entree) {
    return String(entree.session.idUtilisateur || '') ===
      String(idUtilisateur || '');
  });
  const excedentUtilisateur = Math.max(
    0,
    memeUtilisateur.length -
      NOMBRE_MAX_SESSIONS_PAR_UTILISATEUR_FORMATEUR_ + 1
  );
  memeUtilisateur.slice(0, excedentUtilisateur).forEach(function (entree) {
    proprietes.deleteProperty(entree.cle);
    supprimerActiviteSessionFormateurCache_(entree.cle);
  });

  sessions = sessions.filter(function (entree) {
    return proprietes.getProperty(entree.cle) !== null;
  });
  const excedentGlobal = Math.max(
    0,
    sessions.length - NOMBRE_MAX_SESSIONS_FORMATEURS_ + 1
  );
  sessions.slice(0, excedentGlobal).forEach(function (entree) {
    proprietes.deleteProperty(entree.cle);
    supprimerActiviteSessionFormateurCache_(entree.cle);
  });
}


function lireActiviteSessionFormateurCache_(cleSession) {
  try {
    return Number(
      CacheService.getScriptCache().get(
        PREFIXE_CACHE_ACTIVITE_SESSION_FORMATEUR_ + cleSession
      ) || 0
    );
  } catch (erreur) {
    return 0;
  }
}


function enregistrerActiviteSessionFormateurCache_(cleSession, maintenant) {
  try {
    CacheService.getScriptCache().put(
      PREFIXE_CACHE_ACTIVITE_SESSION_FORMATEUR_ + cleSession,
      String(maintenant),
      Math.ceil(DUREE_INACTIVITE_SESSION_FORMATEUR_MS_ / 1000)
    );
  } catch (erreur) {
    // Le timestamp persistant conserve une dégradation sûre et bornée.
  }
}


function supprimerActiviteSessionFormateurCache_(cleSession) {
  try {
    CacheService.getScriptCache().remove(
      PREFIXE_CACHE_ACTIVITE_SESSION_FORMATEUR_ + cleSession
    );
  } catch (erreur) {
    // Le cache est une optimisation : l'expiration persistante reste active.
  }
}


function creerDefiChangementInitialFormateur_(compte, table, maintenant) {
  const jeton = creerSecretAleatoireSecurite_();
  const expireA = maintenant + DUREE_CHANGEMENT_INITIAL_FORMATEUR_MS_;
  executerSousVerrouSessionsFormateur_(function () {
    const proprietes = PropertiesService.getScriptProperties();
    nettoyerSessionsFormateursDansProprietes_(proprietes, maintenant);
    supprimerDefisChangementUtilisateurFormateur_(
      proprietes,
      valeurCompteAuthentification_(
        table,
        compte.ligne,
        'ID_UTILISATEUR'
      )
    );
    limiterDefisChangementFormateursAvantCreation_(proprietes);
    proprietes.setProperty(
      PREFIXE_CHANGEMENT_INITIAL_FORMATEUR_ + hacherJetonFormateur_(jeton),
      JSON.stringify({
        idUtilisateur: valeurCompteAuthentification_(
          table,
          compte.ligne,
          'ID_UTILISATEUR'
        ),
        idFormateur: valeurCompteAuthentification_(
          table,
          compte.ligne,
          'ID_FORMATEUR'
        ),
        creeA: maintenant,
        expireA: expireA
      })
    );
  });
  return { jeton: jeton, expireA: expireA };
}


function supprimerDefisChangementUtilisateurFormateur_(
  proprietes,
  idUtilisateur
) {
  const toutes = proprietes.getProperties();
  Object.keys(toutes).forEach(function (cle) {
    if (!cle.startsWith(PREFIXE_CHANGEMENT_INITIAL_FORMATEUR_)) return;
    try {
      const defi = JSON.parse(toutes[cle]);
      if (String(defi.idUtilisateur || '') === String(idUtilisateur || '')) {
        proprietes.deleteProperty(cle);
      }
    } catch (erreur) {
      proprietes.deleteProperty(cle);
    }
  });
}


function limiterDefisChangementFormateursAvantCreation_(proprietes) {
  const toutes = proprietes.getProperties();
  const defis = Object.keys(toutes)
    .filter(function (cle) {
      return cle.startsWith(PREFIXE_CHANGEMENT_INITIAL_FORMATEUR_);
    })
    .map(function (cle) {
      try {
        return { cle: cle, defi: JSON.parse(toutes[cle]) };
      } catch (erreur) {
        proprietes.deleteProperty(cle);
        return null;
      }
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return Number(a.defi.creeA || 0) - Number(b.defi.creeA || 0);
    });
  const excedent = Math.max(
    0,
    defis.length - NOMBRE_MAX_DEFIS_CHANGEMENT_FORMATEURS_ + 1
  );
  defis.slice(0, excedent).forEach(function (entree) {
    proprietes.deleteProperty(entree.cle);
  });
}


function consommerDefiChangementInitialFormateur_(jetonChangement) {
  const jeton = String(jetonChangement || '').trim();
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(jeton)) {
    throw new Error('La demande de changement de mot de passe est invalide.');
  }
  const valeur = executerSousVerrouSessionsFormateur_(function () {
    const proprietes = PropertiesService.getScriptProperties();
    const cle = PREFIXE_CHANGEMENT_INITIAL_FORMATEUR_ +
      hacherJetonFormateur_(jeton);
    const contenu = proprietes.getProperty(cle);
    proprietes.deleteProperty(cle);
    return contenu;
  });
  if (!valeur) {
    throw new Error('La demande de changement de mot de passe a expiré.');
  }
  let defi;
  try {
    defi = JSON.parse(valeur);
  } catch (erreur) {
    throw new Error('La demande de changement de mot de passe est invalide.');
  }
  if (!defi.idUtilisateur || Number(defi.expireA || 0) <= Date.now()) {
    throw new Error('La demande de changement de mot de passe a expiré.');
  }
  return defi;
}


function lireTableUtilisateursAuthentification_() {
  const feuille = obtenirFeuilleLecturePure_(
    SpreadsheetApp.getActiveSpreadsheet(),
    'UTILISATEURS',
    COLONNES_UTILISATEURS_AUTHENTIFICATION_
  );
  const donnees = feuille.getDataRange().getValues();
  return {
    feuille: feuille,
    index: creerIndexMigration_(donnees[0] || []),
    lignes: donnees.slice(1)
  };
}


function trouverCompteParIdentifiant_(table, identifiant) {
  const recherche = normaliserIdentifiantFormateur_(identifiant, false);
  for (let i = 0; i < table.lignes.length; i++) {
    if (
      normaliserIdentifiantFormateur_(
        valeurCompteAuthentification_(
          table,
          table.lignes[i],
          'IDENTIFIANT'
        ),
        false
      ) === recherche
    ) {
      return { ligne: table.lignes[i], numeroLigne: i + 2 };
    }
  }
  return null;
}


function trouverCompteParIdUtilisateur_(table, idUtilisateur) {
  return trouverCompteParColonne_(
    table,
    'ID_UTILISATEUR',
    idUtilisateur
  );
}


function trouverCompteParIdFormateur_(table, idFormateur) {
  return trouverCompteParColonne_(
    table,
    'ID_FORMATEUR',
    idFormateur
  );
}


function trouverCompteParColonne_(table, colonne, valeur) {
  const recherche = String(valeur || '').trim();
  for (let i = 0; i < table.lignes.length; i++) {
    if (
      valeurCompteAuthentification_(
        table,
        table.lignes[i],
        colonne
      ) === recherche
    ) {
      return { ligne: table.lignes[i], numeroLigne: i + 2 };
    }
  }
  return null;
}


function trouverFormateurCompteAuthentification_(idFormateur) {
  const id = String(idFormateur || '').trim();
  if (!id) return null;
  const feuille = obtenirFeuilleLecturePure_(
    SpreadsheetApp.getActiveSpreadsheet(),
    'FORMATEURS',
    ['ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF']
  );
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexMigration_(donnees[0] || []);
  for (let i = 1; i < donnees.length; i++) {
    if (String(donnees[i][index.ID_FORMATEUR] || '').trim() === id) {
      return {
        idFormateur: id,
        nom: String(donnees[i][index.NOM] || '').trim(),
        prenom: String(donnees[i][index.PRENOM] || '').trim(),
        actif: donnees[i][index.ACTIF]
      };
    }
  }
  return null;
}


function mettreAJourCompteApresConnexion_(
  table,
  compte,
  maintenant,
  motDePasseAReencoder
) {
  if (motDePasseAReencoder) {
    const sel = creerSecretAleatoireSecurite_();
    compte.ligne[table.index.PASSWORD_SALT] = sel;
    compte.ligne[table.index.PASSWORD_HASH] =
      deriverMotDePasseFormateur_(motDePasseAReencoder, sel);
    compte.ligne[table.index.DATE_MODIFICATION_MDP] =
      new Date(maintenant);
  }
  compte.ligne[table.index.NB_ECHECS] = 0;
  compte.ligne[table.index.BLOQUE_JUSQU_A] = '';
  compte.ligne[table.index.DERNIERE_CONNEXION] = new Date(maintenant);
  compte.ligne[table.index.DATE_MODIFICATION] = new Date(maintenant);
  ecrireLigneCompteFormateur_(table, compte.numeroLigne, compte.ligne);
}


function enregistrerEchecCompteFormateur_(table, compte, maintenant) {
  const echecs = Number(
    valeurBruteCompteAuthentification_(
      table,
      compte.ligne,
      'NB_ECHECS'
    ) || 0
  ) + 1;
  compte.ligne[table.index.NB_ECHECS] = echecs;
  if (echecs >= NOMBRE_ECHECS_AVANT_BLOCAGE_FORMATEUR_) {
    compte.ligne[table.index.BLOQUE_JUSQU_A] = new Date(
      maintenant + calculerDureeBlocageFormateur_(echecs)
    );
  }
  compte.ligne[table.index.DATE_MODIFICATION] = new Date(maintenant);
  ecrireLigneCompteFormateur_(table, compte.numeroLigne, compte.ligne);
}


function calculerDureeBlocageFormateur_(nombreEchecs) {
  if (nombreEchecs < NOMBRE_ECHECS_AVANT_BLOCAGE_FORMATEUR_) return 0;
  const palier = Math.min(
    4,
    nombreEchecs - NOMBRE_ECHECS_AVANT_BLOCAGE_FORMATEUR_
  );
  return Math.min(60, 5 * Math.pow(2, palier)) * 60 * 1000;
}


function enregistrerEchecIdentifiantInconnu_(identifiant, maintenant) {
  const proprietes = PropertiesService.getScriptProperties();
  let tentatives = {};
  try {
    tentatives = JSON.parse(
      proprietes.getProperty(
        PROPRIETE_ECHECS_IDENTIFIANTS_INCONNUS_
      ) || '{}'
    );
  } catch (erreur) {
    tentatives = {};
  }
  Object.keys(tentatives).forEach(function (cle) {
    if (Number(tentatives[cle].expireA || 0) <= maintenant) {
      delete tentatives[cle];
    }
  });
  const cle = hacherJetonFormateur_(identifiant);
  const etat = tentatives[cle] || {};
  etat.echecs = Number(etat.echecs || 0) + 1;
  etat.derniereTentative = maintenant;
  etat.expireA = maintenant + 60 * 60 * 1000;
  tentatives[cle] = etat;
  const cles = Object.keys(tentatives).sort(function (a, b) {
    return Number(tentatives[b].derniereTentative || 0) -
      Number(tentatives[a].derniereTentative || 0);
  });
  cles.slice(LIMITE_IDENTIFIANTS_INCONNUS_MEMORISES_).forEach(
    function (ancienneCle) {
      delete tentatives[ancienneCle];
    }
  );
  proprietes.setProperty(
    PROPRIETE_ECHECS_IDENTIFIANTS_INCONNUS_,
    JSON.stringify(tentatives)
  );
}


function supprimerEchecsIdentifiantInconnu_(identifiant) {
  const proprietes = PropertiesService.getScriptProperties();
  let tentatives = {};
  try {
    tentatives = JSON.parse(
      proprietes.getProperty(
        PROPRIETE_ECHECS_IDENTIFIANTS_INCONNUS_
      ) || '{}'
    );
  } catch (erreur) {
    tentatives = {};
  }
  delete tentatives[hacherJetonFormateur_(identifiant)];
  if (Object.keys(tentatives).length) {
    proprietes.setProperty(
      PROPRIETE_ECHECS_IDENTIFIANTS_INCONNUS_,
      JSON.stringify(tentatives)
    );
  } else {
    proprietes.deleteProperty(
      PROPRIETE_ECHECS_IDENTIFIANTS_INCONNUS_
    );
  }
}


function remplacerMotDePasseCompteFormateur_(
  table,
  compte,
  motDePasse,
  forcerChangement
) {
  const motDePasseNormalise = verifierPolitiqueMotDePasseFormateur_(
    motDePasse
  );
  const sel = creerSecretAleatoireSecurite_();
  const maintenant = new Date();
  compte.ligne[table.index.PASSWORD_SALT] = sel;
  compte.ligne[table.index.PASSWORD_HASH] =
    deriverMotDePasseFormateur_(motDePasseNormalise, sel);
  compte.ligne[table.index.DOIT_CHANGER_MOT_DE_PASSE] =
    forcerChangement ? 'Oui' : 'Non';
  compte.ligne[table.index.NB_ECHECS] = 0;
  compte.ligne[table.index.BLOQUE_JUSQU_A] = '';
  compte.ligne[table.index.DATE_MODIFICATION_MDP] = maintenant;
  compte.ligne[table.index.DATE_MODIFICATION] = maintenant;
  ecrireLigneCompteFormateur_(table, compte.numeroLigne, compte.ligne);
}


function ecrireLigneCompteFormateur_(table, numeroLigne, ligne) {
  table.feuille
    .getRange(numeroLigne, 1, 1, table.feuille.getLastColumn())
    .setValues([ligne]);
  appliquerFormatsDatesCompteFormateur_(
    table.feuille,
    numeroLigne,
    table.index
  );
}


function appliquerFormatsDatesCompteFormateur_(feuille, ligne, index) {
  [
    'BLOQUE_JUSQU_A',
    'DERNIERE_CONNEXION',
    'DATE_MODIFICATION_MDP',
    'DATE_CREATION',
    'DATE_MODIFICATION'
  ].forEach(function (colonne) {
    if (Number.isInteger(index[colonne])) {
      feuille.getRange(ligne, index[colonne] + 1)
        .setNumberFormat('dd/MM/yyyy HH:mm:ss');
    }
  });
}


function construireCompteFormateurPublicDepuisLigne_(table, ligne) {
  const bloque = convertirDateAuthentification_(
    valeurBruteCompteAuthentification_(table, ligne, 'BLOQUE_JUSQU_A')
  );
  return {
    idUtilisateur: valeurCompteAuthentification_(
      table,
      ligne,
      'ID_UTILISATEUR'
    ),
    idFormateur: valeurCompteAuthentification_(
      table,
      ligne,
      'ID_FORMATEUR'
    ),
    identifiant: valeurCompteAuthentification_(
      table,
      ligne,
      'IDENTIFIANT'
    ),
    actif: convertirBooleenAuthentification_(
      valeurBruteCompteAuthentification_(table, ligne, 'ACTIF')
    ),
    doitChangerMotDePasse: convertirBooleenAuthentification_(
      valeurBruteCompteAuthentification_(
        table,
        ligne,
        'DOIT_CHANGER_MOT_DE_PASSE'
      )
    ),
    nombreEchecs: Number(
      valeurBruteCompteAuthentification_(table, ligne, 'NB_ECHECS') || 0
    ),
    bloqueJusqua: serialiserDateAuthentification_(bloque),
    bloque: Boolean(bloque && bloque.getTime() > Date.now()),
    derniereConnexion: serialiserDateAuthentification_(
      convertirDateAuthentification_(
        valeurBruteCompteAuthentification_(
          table,
          ligne,
          'DERNIERE_CONNEXION'
        )
      )
    ),
    dateModificationMotDePasse: serialiserDateAuthentification_(
      convertirDateAuthentification_(
        valeurBruteCompteAuthentification_(
          table,
          ligne,
          'DATE_MODIFICATION_MDP'
        )
      )
    )
  };
}


function proposerIdentifiantUniqueFormateur_(
  prenom,
  nom,
  table,
  idUtilisateurExclu
) {
  const base = normaliserIdentifiantFormateur_(
    [prenom, nom].filter(Boolean).join('.'),
    false
  ) || 'formateur';
  let candidat = base;
  let suffixe = 1;
  while (true) {
    const existant = trouverCompteParIdentifiant_(table, candidat);
    if (
      !existant ||
      valeurCompteAuthentification_(
        table,
        existant.ligne,
        'ID_UTILISATEUR'
      ) === idUtilisateurExclu
    ) {
      return candidat;
    }
    suffixe++;
    candidat = base.slice(0, 75) + suffixe;
  }
}


function normaliserIdentifiantFormateur_(valeur, erreurSiInvalide) {
  const normalise = String(valeur || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(normalise)) {
    if (erreurSiInvalide) {
      throw new Error(
        'L’identifiant doit contenir entre 3 et 80 caractères autorisés.'
      );
    }
    return '';
  }
  return normalise;
}


function verifierNouveauMotDePasseFormateur_(motDePasse, confirmation) {
  const valeur = normaliserMotDePasseFormateur_(motDePasse);
  const confirmationNormalisee = normaliserMotDePasseFormateur_(confirmation);
  if (valeur !== confirmationNormalisee) {
    throw new Error('Les deux mots de passe ne correspondent pas.');
  }
  return verifierPolitiqueMotDePasseFormateur_(valeur);
}


function verifierPolitiqueMotDePasseFormateur_(motDePasse) {
  const valeur = normaliserMotDePasseFormateur_(motDePasse);
  if (
    valeur.length < LONGUEUR_MIN_MOT_DE_PASSE_FORMATEUR_ ||
    valeur.length > LONGUEUR_MAX_MOT_DE_PASSE_FORMATEUR_
  ) {
    throw new Error(
      'Le mot de passe doit contenir entre 15 et 512 caractères.'
    );
  }
  if (/\u0000/.test(valeur)) {
    throw new Error('Le mot de passe contient un caractère interdit.');
  }
  return valeur;
}


function motDePasseDansLimitesFormateur_(motDePasse) {
  const valeur = normaliserMotDePasseFormateur_(motDePasse);
  return valeur.length >= LONGUEUR_MIN_MOT_DE_PASSE_FORMATEUR_ &&
    valeur.length <= LONGUEUR_MAX_MOT_DE_PASSE_FORMATEUR_ &&
    !/\u0000/.test(valeur);
}


function normaliserMotDePasseFormateur_(motDePasse) {
  const valeur = motDePasse === null || motDePasse === undefined
    ? ''
    : String(motDePasse);
  return typeof valeur.normalize === 'function'
    ? valeur.normalize('NFC')
    : valeur;
}


/**
 * PBKDF2-HMAC-SHA-256 standard, bloc unique de 32 octets. Apps Script expose
 * HMAC-SHA-256 mais pas PBKDF2 : la boucle est donc implémentée ici avec un
 * coût borné compatible avec les quotas d'une Web App.
 */
function calculerClePbkdf2Formateur_(motDePasse, sel, nombreIterations) {
  const iterations = Number(nombreIterations);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 200000) {
    throw new Error('Paramètre PBKDF2 invalide.');
  }
  const motDePasseNormalise = normaliserMotDePasseFormateur_(motDePasse);
  const cle = Utilities.newBlob(motDePasseNormalise).getBytes();
  const octetsSel = Utilities.newBlob(String(sel || '')).getBytes();
  const bloc = octetsSel.concat([0, 0, 0, 1]);
  let u = normaliserOctetsSignesAuthentification_(
    Utilities.computeHmacSha256Signature(bloc, cle)
  );
  const resultat = u.slice();

  for (let iteration = 1;
    iteration < iterations;
    iteration++
  ) {
    u = normaliserOctetsSignesAuthentification_(
      Utilities.computeHmacSha256Signature(u, cle)
    );
    for (let position = 0; position < resultat.length; position++) {
      const xor = (resultat[position] & 255) ^ (u[position] & 255);
      resultat[position] = xor > 127 ? xor - 256 : xor;
    }
  }

  return resultat;
}


function deriverMotDePasseFormateur_(motDePasse, sel, nombreIterations) {
  const valeur = verifierPolitiqueMotDePasseFormateur_(motDePasse);
  const iterations = nombreIterations === undefined
    ? ITERATIONS_PBKDF2_FORMATEUR_
    : Number(nombreIterations);
  const cleDerivee = calculerClePbkdf2Formateur_(
    valeur,
    sel,
    iterations
  );
  const verificateur = appliquerPepperMotDePasseFormateur_(
    cleDerivee,
    obtenirPepperMotDePasseFormateur_()
  );

  return [
    VERSION_VERIFICATEUR_MOT_DE_PASSE_FORMATEUR_,
    ALGORITHME_PBKDF2_FORMATEUR_,
    iterations,
    ALGORITHME_PEPPER_FORMATEUR_,
    Utilities.base64EncodeWebSafe(verificateur).replace(/=+$/g, '')
  ].join('$');
}


function verifierMotDePasseFormateur_(motDePasse, sel, hashAttendu) {
  const valeur = normaliserMotDePasseFormateur_(motDePasse);
  const attendu = String(hashAttendu || '');
  let iterations = ITERATIONS_PBKDF2_FORMATEUR_;
  let format = 'INVALIDE';
  const parties = attendu.split('$');

  if (
    parties.length === 5 &&
    parties[0] === VERSION_VERIFICATEUR_MOT_DE_PASSE_FORMATEUR_ &&
    parties[1] === ALGORITHME_PBKDF2_FORMATEUR_ &&
    parties[3] === ALGORITHME_PEPPER_FORMATEUR_
  ) {
    iterations = Number(parties[2]);
    format = 'PF2';
  } else if (
    parties.length === 3 &&
    parties[0] === 'PBKDF2-SHA256'
  ) {
    iterations = Number(parties[1]);
    format = 'LEGACY_PBKDF2';
  }

  if (
    !motDePasseDansLimitesFormateur_(valeur) ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 200000
  ) {
    const cleFactice = calculerClePbkdf2Formateur_(
      'TENTATIVE_INVALIDE_15_CARACTERES',
      sel,
      ITERATIONS_PBKDF2_FORMATEUR_
    );
    appliquerPepperMotDePasseFormateur_(
      cleFactice,
      obtenirPepperMotDePasseFormateur_()
    );
    return { valide: false, doitMettreAJour: false };
  }

  const cleDerivee = calculerClePbkdf2Formateur_(valeur, sel, iterations);
  let calcule;
  if (format === 'PF2') {
    const verificateur = appliquerPepperMotDePasseFormateur_(
      cleDerivee,
      obtenirPepperMotDePasseFormateur_()
    );
    calcule = [
      VERSION_VERIFICATEUR_MOT_DE_PASSE_FORMATEUR_,
      ALGORITHME_PBKDF2_FORMATEUR_,
      iterations,
      ALGORITHME_PEPPER_FORMATEUR_,
      Utilities.base64EncodeWebSafe(verificateur).replace(/=+$/g, '')
    ].join('$');
  } else if (format === 'LEGACY_PBKDF2') {
    calcule = 'PBKDF2-SHA256$' + iterations + '$' +
      Utilities.base64EncodeWebSafe(cleDerivee).replace(/=+$/g, '');
  } else {
    calcule = 'FORMAT_INVALIDE';
  }

  const valide = comparaisonConstanteSecurite_(calcule, attendu);
  return {
    valide: valide,
    doitMettreAJour: valide && (
      format !== 'PF2' ||
      iterations !== ITERATIONS_PBKDF2_FORMATEUR_
    )
  };
}


function appliquerPepperMotDePasseFormateur_(cleDerivee, pepper) {
  return normaliserOctetsSignesAuthentification_(
    Utilities.computeHmacSha256Signature(
      cleDerivee,
      Utilities.newBlob(String(pepper || '')).getBytes()
    )
  );
}


/**
 * Le pepper est propre à l'installation et n'est pas sauvegardé. Une
 * restauration de UTILISATEURS fonctionne sur la même installation car les
 * Script Properties ne sont pas restaurées. Une transplantation isolée vers
 * une autre installation exige une réinitialisation des mots de passe.
 */
function obtenirPepperMotDePasseFormateur_() {
  const proprietes = PropertiesService.getScriptProperties();
  const existant = String(
    proprietes.getProperty(PROPRIETE_PEPPER_MOT_DE_PASSE_FORMATEUR_) || ''
  );
  if (existant.length >= 32) return existant;

  return executerSousVerrouSessionsFormateur_(function () {
    const valeurExistante = String(
      proprietes.getProperty(PROPRIETE_PEPPER_MOT_DE_PASSE_FORMATEUR_) || ''
    );
    if (valeurExistante.length >= 32) return valeurExistante;
    const nouveauPepper = creerSecretAleatoireSecurite_();
    proprietes.setProperty(
      PROPRIETE_PEPPER_MOT_DE_PASSE_FORMATEUR_,
      nouveauPepper
    );
    return nouveauPepper;
  });
}


/**
 * Benchmark manuel réservé à une session administrateur valide. Il n'accède
 * à aucun compte et utilise exclusivement des données factices internes.
 */
function benchmarkerDerivationMotDePasseFormateur(jetonAdministrateur) {
  exigerAdministrateur_(jetonAdministrateur);
  const motDePasseFactice =
    'Phrase de passe factice pour benchmark NFC é';
  const selFactice = 'SEL_FACTICE_BENCHMARK_PREPFORMATION_V2';
  const iterationsTestees = [20000, 30000, 50000];
  const durees = {};

  iterationsTestees.forEach(function (iterations) {
    const debut = Date.now();
    calculerClePbkdf2Formateur_(
      motDePasseFactice,
      selFactice,
      iterations
    );
    durees[String(iterations)] = Date.now() - debut;
  });

  if (durees['50000'] <= 5000) {
    const debut100000 = Date.now();
    calculerClePbkdf2Formateur_(
      motDePasseFactice,
      selFactice,
      100000
    );
    durees['100000'] = Date.now() - debut100000;
  }

  return durees;
}


function normaliserOctetsSignesAuthentification_(octets) {
  return Array.prototype.slice.call(octets || []).map(function (octet) {
    const valeur = Number(octet) & 255;
    return valeur > 127 ? valeur - 256 : valeur;
  });
}


function creerMotDePasseTemporaireFormateur_() {
  const secret = creerSecretAleatoireSecurite_();
  return 'Pf-' + secret.slice(0, 32);
}


function hacherJetonFormateur_(jeton) {
  const octets = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'JETON_FORMATEUR\u0000' + String(jeton || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(octets).replace(/=+$/g, '');
}


function valeurCompteAuthentification_(table, ligne, colonne) {
  const valeur = valeurBruteCompteAuthentification_(table, ligne, colonne);
  return valeur === null || valeur === undefined
    ? ''
    : String(valeur).trim();
}


function valeurBruteCompteAuthentification_(table, ligne, colonne) {
  const position = table.index[colonne];
  return Number.isInteger(position) ? ligne[position] : '';
}


function convertirBooleenAuthentification_(valeur) {
  if (valeur === true || valeur === 1) return true;
  return ['OUI', 'TRUE', 'VRAI', '1', 'ACTIF', 'ACTIVE'].includes(
    String(valeur || '').trim().toUpperCase()
  );
}


function convertirDateAuthentification_(valeur) {
  if (!valeur) return null;
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  return isNaN(date.getTime()) ? null : date;
}


function serialiserDateAuthentification_(date) {
  return date && !isNaN(date.getTime()) ? date.toISOString() : '';
}


function construireIdentifiantHistoriqueFormateur_(session) {
  return 'UTILISATEUR:' + String(session.idUtilisateur || '') +
    '|FORMATEUR:' + String(session.idFormateur || '') +
    '|SESSION:' + String(session.idSession || '');
}


function construireIdentifiantHistoriqueFormateurDepuisCompte_(table, ligne) {
  return 'UTILISATEUR:' + valeurCompteAuthentification_(
    table,
    ligne,
    'ID_UTILISATEUR'
  ) + '|FORMATEUR:' + valeurCompteAuthentification_(
    table,
    ligne,
    'ID_FORMATEUR'
  );
}


function journaliserConnexionFormateur_(session) {
  journaliserEvenementSecuriteSansBloquer_(
    'FORMATEUR_CONNEXION_REUSSIE',
    'UTILISATEUR',
    session.idUtilisateur,
    {
      idFormateur: session.idFormateur,
      dureeMaxHeures: DUREE_ABSOLUE_SESSION_FORMATEUR_MS_ / 3600000,
      inactiviteMinutes: DUREE_INACTIVITE_SESSION_FORMATEUR_MS_ / 60000
    },
    construireIdentifiantHistoriqueFormateur_(session)
  );
}


function executerSousVerrouSessionsFormateur_(traitement) {
  const verrou = LockService.getScriptLock();
  const dejaDetenu = typeof verrou.hasLock === 'function' && verrou.hasLock();
  if (!dejaDetenu && !verrou.tryLock(10000)) {
    throw new Error('Le service de session est momentanément occupé.');
  }
  try {
    return traitement();
  } finally {
    if (!dejaDetenu) verrou.releaseLock();
  }
}
