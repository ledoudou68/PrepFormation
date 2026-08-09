'use strict';

const CONFIG_FORMATEURS = {
  feuille: 'FORMATEURS',
  colonnes: [
    'ID_FORMATEUR',
    'NOM',
    'PRENOM',
    'ACTIF',
    'EMAIL',
    'DATE_CREATION',
    'DATE_MODIFICATION'
  ]
};


/**
 * Retourne tous les formateurs, actifs ou non.
 */
function getFormateurs(jetonUtilisateur) {
  const sessionUtilisateur = exigerUtilisateurAuthentifie_(
    jetonUtilisateur
  );
  const comptesParFormateur = sessionUtilisateur.estAdministrateur &&
    typeof obtenirComptesPublicsFormateursAdministration_ === 'function'
    ? obtenirComptesPublicsFormateursAdministration_()
    : {};
  const feuille = obtenirFeuilleFormateursLecture_();
  const donnees = feuille.getDataRange().getValues();

  if (donnees.length <= 1) {
    return [];
  }

  const index = creerIndexFormateurs_(donnees[0]);

  return donnees
    .slice(1)
    .filter(function (ligne) {
      return ligne[index.ID_FORMATEUR];
    })
    .map(function (ligne) {
      return {
        idFormateur: String(
          ligne[index.ID_FORMATEUR] || ''
        ),
        nom: String(ligne[index.NOM] || ''),
        prenom: String(ligne[index.PRENOM] || ''),
        email: (function () {
          const email = String(ligne[index.EMAIL] || '')
            .trim()
            .toLowerCase();

          return (
            sessionUtilisateur.estAdministrateur ||
            String(sessionUtilisateur.idFormateur || '') ===
              String(ligne[index.ID_FORMATEUR] || '')
          )
            ? email
            : '';
        })(),
        actif: convertirActifFormateur_(
          ligne[index.ACTIF]
        ),
        compteAcces: comptesParFormateur[
          String(ligne[index.ID_FORMATEUR] || '')
        ] || null
      };
    })
    .sort(function (a, b) {
      return (
        a.nom.localeCompare(
          b.nom,
          'fr',
          { sensitivity: 'base' }
        ) ||
        a.prenom.localeCompare(
          b.prenom,
          'fr',
          { sensitivity: 'base' }
        )
      );
    });
}


/**
 * Crée ou modifie un formateur.
 */
function enregistrerFormateur(donnees, jetonAdministrateur) {
  const sessionUtilisateur = exigerAdministrateur_(
    jetonAdministrateur
  );

  return executerMutationMetier_(function () {
    return enregistrerFormateurInterne_(
      donnees,
      sessionUtilisateur
    );
  });
}


function enregistrerFormateurInterne_(donnees, sessionUtilisateur) {
  verifierFormateur_(donnees);

  const feuille = obtenirFeuilleFormateurs_();
  const valeurs = feuille.getDataRange().getValues();
  const index = creerIndexFormateurs_(valeurs[0]);
  const idFormateur = String(
    donnees.idFormateur || Utilities.getUuid()
  );

  let numeroLigne = null;
  let dateCreation = new Date();

  for (let i = 1; i < valeurs.length; i++) {
    if (
      String(valeurs[i][index.ID_FORMATEUR]) ===
      idFormateur
    ) {
      numeroLigne = i + 1;
      dateCreation =
        valeurs[i][index.DATE_CREATION] ||
        dateCreation;
      break;
    }
  }

  if (donnees.idFormateur && !numeroLigne) {
    throw new Error('Formateur introuvable.');
  }

  const ligne = new Array(valeurs[0].length).fill('');

  ligne[index.ID_FORMATEUR] = idFormateur;
  ligne[index.NOM] = nettoyerNomFormateur_(donnees.nom);
  ligne[index.PRENOM] = nettoyerPrenomFormateur_(
    donnees.prenom
  );
  ligne[index.ACTIF] = convertirActifFormateur_(
    donnees.actif
  )
    ? 'Oui'
    : 'Non';
  ligne[index.EMAIL] = String(donnees.email || '')
    .trim()
    .toLowerCase();
  ligne[index.DATE_CREATION] = dateCreation;
  ligne[index.DATE_MODIFICATION] = new Date();

  if (numeroLigne) {
    feuille
      .getRange(numeroLigne, 1, 1, ligne.length)
      .setValues([ligne]);
  } else {
    feuille.appendRow(ligne);
    numeroLigne = feuille.getLastRow();
  }

  [
    index.DATE_CREATION,
    index.DATE_MODIFICATION
  ].forEach(function (position) {
    feuille
      .getRange(numeroLigne, position + 1)
      .setNumberFormat('dd/MM/yyyy HH:mm');
  });

  if (
    !convertirActifFormateur_(donnees.actif) &&
    typeof invaliderSessionsFormateurParIdFormateur_ === 'function'
  ) {
    invaliderSessionsFormateurParIdFormateur_(idFormateur);
  }

  journaliserActionSensible_(
    donnees.idFormateur
      ? 'FORMATEUR_MODIFICATION'
      : 'FORMATEUR_CREATION',
    'FORMATEUR',
    idFormateur,
    {
      nom: ligne[index.NOM],
      prenom: ligne[index.PRENOM],
      email: ligne[index.EMAIL],
      actif: ligne[index.ACTIF]
    },
    sessionUtilisateur.identifiantHistorique
  );

  return {
    succes: true,
    idFormateur: idFormateur,
    message: donnees.idFormateur
      ? 'Formateur modifié.'
      : 'Formateur enregistré.'
  };
}


function obtenirFeuilleFormateursLecture_() {
  return obtenirFeuilleLecturePure_(
    SpreadsheetApp.getActiveSpreadsheet(),
    CONFIG_FORMATEURS.feuille,
    CONFIG_FORMATEURS.colonnes
  );
}


function obtenirFeuilleFormateurs_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const feuille = assurerFeuilleMigration_(
    classeur,
    CONFIG_FORMATEURS.feuille
  );

  const entetes = feuille
    .getRange(1, 1, 1, feuille.getLastColumn())
    .getValues()[0];

  const index = creerIndexFormateurs_(entetes);

  CONFIG_FORMATEURS.colonnes.forEach(function (colonne) {
    if (!Number.isInteger(index[colonne])) {
      throw new Error(
        'La colonne "' + colonne +
        '" est absente de la feuille FORMATEURS.'
      );
    }
  });

  return feuille;
}


function verifierFormateur_(donnees) {
  if (!donnees) {
    throw new Error('Aucune donnée reçue.');
  }

  if (!String(donnees.nom || '').trim()) {
    throw new Error('Le nom est obligatoire.');
  }

  if (!String(donnees.prenom || '').trim()) {
    throw new Error('Le prénom est obligatoire.');
  }

  const email = String(donnees.email || '').trim();

  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error('L’adresse e-mail est invalide.');
  }
}


/**
 * Retourne exclusivement les prestations du formateur identifié par la
 * session interne. L'adresse Google n'intervient jamais dans ce rattachement.
 */
function getMonRecapitulatifHeuresFormateur(jetonUtilisateur) {
  const session = exigerUtilisateurAuthentifie_(jetonUtilisateur);
  if (!session.estFormateur || !session.idFormateur) {
    throw new Error('Ce récapitulatif est réservé au formateur connecté.');
  }
  const formateur = getFormateurs(jetonUtilisateur).find(
    function (element) {
      return element.idFormateur === session.idFormateur;
    }
  );

  if (!formateur) {
    return {
      estIdentifie: true,
      formateurAssocie: false,
      email: '',
      totalHeures: 0,
      nombrePrestations: 0,
      prestations: []
    };
  }

  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const feuillePrestations = classeur.getSheetByName(
    'PRESTATIONS_FORMATEURS'
  );
  const feuilleSessions = classeur.getSheetByName('SESSIONS');

  if (
    !feuillePrestations ||
    feuillePrestations.getLastRow() < 2
  ) {
    return {
      estIdentifie: true,
      formateurAssocie: true,
      email: formateur.email || '',
      formateur: [formateur.prenom, formateur.nom]
        .filter(Boolean)
        .join(' '),
      totalHeures: 0,
      nombrePrestations: 0,
      prestations: []
    };
  }

  const donneesPrestations = feuillePrestations
    .getDataRange()
    .getValues();
  const indexPrestations = creerIndexFormateurs_(
    donneesPrestations[0]
  );
  const sessionsParId = {};

  if (feuilleSessions && feuilleSessions.getLastRow() > 1) {
    const donneesSessions = feuilleSessions
      .getDataRange()
      .getValues();
    const indexSessions = creerIndexFormateurs_(
      donneesSessions[0]
    );

    donneesSessions.slice(1).forEach(function (ligne) {
      const idSession = String(
        ligne[indexSessions.ID_SESSION] || ''
      );

      if (idSession) {
        sessionsParId[idSession] = {
          date: convertirDateFormateurInterface_(
            ligne[indexSessions.DATE_SESSION]
          ),
          formation: String(
            ligne[indexSessions.FORMATION] || ''
          )
        };
      }
    });
  }

  const prestations = donneesPrestations
    .slice(1)
    .filter(function (ligne) {
      return String(
        ligne[indexPrestations.ID_FORMATEUR] || ''
      ) === formateur.idFormateur;
    })
    .map(function (ligne) {
      const idSession = String(
        ligne[indexPrestations.ID_SESSION] || ''
      );
      const sessionLiee = sessionsParId[idSession] || {};

      return {
        idPrestation: String(
          ligne[indexPrestations.ID_PRESTATION] || ''
        ),
        idSession: idSession,
        date: sessionLiee.date || '',
        formation: sessionLiee.formation || '',
        dureeHeures: Number(
          ligne[indexPrestations.DUREE_HEURES]
        ) || 0,
        statut: Number.isInteger(
          indexPrestations.STATUT_INDEMNISATION
        )
          ? String(
            ligne[
              indexPrestations.STATUT_INDEMNISATION
            ] || 'À demander'
          )
          : 'À demander'
      };
    })
    .sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });

  const totalHeures = prestations.reduce(
    function (total, prestation) {
      return total + prestation.dureeHeures;
    },
    0
  );

  return {
    estIdentifie: true,
    formateurAssocie: true,
    email: formateur.email || '',
    formateur: [formateur.prenom, formateur.nom]
      .filter(Boolean)
      .join(' '),
    totalHeures: Math.round(totalHeures * 100) / 100,
    nombrePrestations: prestations.length,
    prestations: prestations
  };
}


function convertirDateFormateurInterface_(valeur) {
  if (!valeur) {
    return '';
  }

  const date = valeur instanceof Date
    ? valeur
    : new Date(valeur);

  if (isNaN(date.getTime())) {
    return '';
  }

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
}


function creerIndexFormateurs_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserEnteteFormateur_(entete)] = position;
  });

  return index;
}


function normaliserEnteteFormateur_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function convertirActifFormateur_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }

  return [
    'oui',
    'true',
    '1',
    'actif',
    'active'
  ].includes(
    String(valeur || '').trim().toLowerCase()
  );
}


function nettoyerNomFormateur_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase();
}


function nettoyerPrenomFormateur_(valeur) {
  const texte = String(valeur || '')
    .trim()
    .toLowerCase();

  return texte
    .split(/([\s-])/)
    .map(function (partie) {
      if (/[\s-]/.test(partie)) {
        return partie;
      }

      return partie.charAt(0).toUpperCase() +
        partie.slice(1);
    })
    .join('');
}
