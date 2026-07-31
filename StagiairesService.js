'use strict';

const CONFIG_STAGIAIRES = {
  feuille: 'STAGIAIRES',

  colonnes: [
    'UUID',
    'NOM',
    'PRENOM',
    'FORMATION',
    'DATE_DEBUT_PREPARATION',
    'DATE_STAGE',
    'STATUT',
    'DATE_CLOTURE',
    'MOTIF_CLOTURE',
    'NOTES_ADMINISTRATIVES',
    'GRADE',
    'TELEPHONE',
    'EMAIL',
    'PHOTO_URL',
    'FORMATEUR_REFERENT'
  ],

  statuts: [
    'À préparer',
    'Échéance atteinte',
    'Préparation terminée',
    'Préparation abandonnée'
  ]
};


/**
 * Retourne tous les stagiaires.
 */
function getStagiaires() {
  const feuille = obtenirFeuilleStagiaires_();
  const donnees = feuille.getDataRange().getValues();

  if (donnees.length <= 1) {
    return [];
  }

  const entetes = donnees[0];
  const index = creerIndexEntetes_(entetes);

  return donnees
    .slice(1)
    .filter(function (ligne) {
      return ligne[index.UUID];
    })
    .map(function (ligne) {
      return {
        uuid: String(ligne[index.UUID] || ''),

        nom: String(ligne[index.NOM] || ''),

        prenom: String(ligne[index.PRENOM] || ''),

        formation: String(
          ligne[index.FORMATION] || ''
        ),

        dateDebutPreparation: convertirDatePourInterface_(
          ligne[index.DATE_DEBUT_PREPARATION]
        ),

        dateStage: convertirDatePourInterface_(
          ligne[index.DATE_STAGE]
        ),

        statut: String(
          ligne[index.STATUT] || 'À préparer'
        ),

        dateCloture: convertirDatePourInterface_(
          ligne[index.DATE_CLOTURE]
        ),

        motifCloture: String(
          ligne[index.MOTIF_CLOTURE] || ''
        ),

        notesAdministratives: String(
          ligne[index.NOTES_ADMINISTRATIVES] || ''
        ),

        grade: String(
          ligne[index.GRADE] || ''
        ),

        telephone: String(
          ligne[index.TELEPHONE] || ''
        ),

        email: String(
          ligne[index.EMAIL] || ''
        ),

        photoUrl: String(
          ligne[index.PHOTO_URL] || ''
        ),

        formateurReferent: String(
          ligne[index.FORMATEUR_REFERENT] || ''
        )
      };
    })
    .sort(function (a, b) {
      const comparaisonNom = a.nom.localeCompare(
        b.nom,
        'fr',
        { sensitivity: 'base' }
      );

      if (comparaisonNom !== 0) {
        return comparaisonNom;
      }

      return a.prenom.localeCompare(
        b.prenom,
        'fr',
        { sensitivity: 'base' }
      );
    });
}


/**
 * Retourne un stagiaire précis.
 */
function getStagiaire(uuid) {
  if (!uuid) {
    throw new Error(
      'Identifiant du stagiaire manquant.'
    );
  }

  const stagiaires = getStagiaires();

  const stagiaire = stagiaires.find(function (element) {
    return element.uuid === uuid;
  });

  if (!stagiaire) {
    throw new Error('Stagiaire introuvable.');
  }

  return stagiaire;
}


/**
 * Retourne les indicateurs et les sessions suivies
 * affichés dans la fiche de consultation.
 */
function getSuiviStagiaire(uuid) {
  const stagiaire = getStagiaire(uuid);
  const classeur =
    SpreadsheetApp.getActiveSpreadsheet();

  const tableSessions = lireFeuillePourSuivi_(
    classeur,
    'SESSIONS'
  );

  const tablePresences = lireFeuillePourSuivi_(
    classeur,
    'PRESENCES_STAGIAIRES'
  );

  const tableEvaluations = lireFeuillePourSuivi_(
    classeur,
    'EVALUATIONS'
  );

  const idsSessionsSuivies = new Set();
  const indexPresences = tablePresences.index;

  if (
    Number.isInteger(indexPresences.ID_STAGIAIRE) &&
    Number.isInteger(indexPresences.ID_SESSION)
  ) {
    tablePresences.lignes.forEach(function (ligne) {
      const idStagiaire = String(
        ligne[indexPresences.ID_STAGIAIRE] || ''
      );

      const idSession = String(
        ligne[indexPresences.ID_SESSION] || ''
      );

      if (idStagiaire === String(uuid) && idSession) {
        idsSessionsSuivies.add(idSession);
      }
    });
  }

  const maintenant = new Date();
  maintenant.setHours(12, 0, 0, 0);

  const debutPreparation = obtenirDateSansHeure_(
    stagiaire.dateDebutPreparation
  );

  const dateStage = obtenirDateSansHeure_(
    stagiaire.dateStage
  );

  const indexSessions = tableSessions.index;
  const sessionsConcernees = [];
  const sessionsSuivies = [];

  if (Number.isInteger(indexSessions.ID_SESSION)) {
    tableSessions.lignes.forEach(function (ligne) {
      const idSession = String(
        ligne[indexSessions.ID_SESSION] || ''
      );

      if (!idSession) {
        return;
      }

      const dateSession = Number.isInteger(
        indexSessions.DATE_SESSION
      )
        ? obtenirDateSansHeure_(
          ligne[indexSessions.DATE_SESSION]
        )
        : null;

      const formation = Number.isInteger(
        indexSessions.FORMATION
      )
        ? String(
          ligne[indexSessions.FORMATION] || ''
        ).trim()
        : '';

      const sessionPassee =
        !dateSession || dateSession <= maintenant;

      const sessionDansPeriode =
        dateSession &&
        (!debutPreparation ||
          dateSession >= debutPreparation) &&
        (!dateStage || dateSession <= dateStage) &&
        dateSession <= maintenant;

      if (
        sessionDansPeriode &&
        formation === stagiaire.formation
      ) {
        sessionsConcernees.push(idSession);
      }

      if (
        !idsSessionsSuivies.has(idSession) ||
        !sessionPassee
      ) {
        return;
      }

      sessionsSuivies.push({
        idSession: idSession,

        date: convertirDatePourInterface_(
          dateSession
        ),

        heureDebut: Number.isInteger(
          indexSessions.HEURE_DEBUT
        )
          ? convertirHeurePourInterface_(
            ligne[indexSessions.HEURE_DEBUT]
          )
          : '',

        heureFin: Number.isInteger(
          indexSessions.HEURE_FIN
        )
          ? convertirHeurePourInterface_(
            ligne[indexSessions.HEURE_FIN]
          )
          : '',

        formation: formation,

        theme: Number.isInteger(indexSessions.THEME)
          ? String(
            ligne[indexSessions.THEME] || ''
          ).trim()
          : '',

        dureeHeures: Number.isInteger(
          indexSessions.DUREE_HEURES
        )
          ? convertirNombre_(
            ligne[indexSessions.DUREE_HEURES]
          )
          : 0
      });
    });
  }

  sessionsSuivies.sort(function (a, b) {
    return (
      String(b.date).localeCompare(String(a.date)) ||
      String(b.heureDebut).localeCompare(
        String(a.heureDebut)
      )
    );
  });

  const idsSessionsConcernees = new Set(
    sessionsConcernees
  );

  let nombrePresences = 0;

  idsSessionsSuivies.forEach(function (idSession) {
    if (idsSessionsConcernees.has(idSession)) {
      nombrePresences++;
    }
  });

  const indexEvaluations = tableEvaluations.index;
  let nombreEvaluations = 0;

  if (Number.isInteger(indexEvaluations.ID_STAGIAIRE)) {
    tableEvaluations.lignes.forEach(function (ligne) {
      if (
        String(
          ligne[indexEvaluations.ID_STAGIAIRE] || ''
        ) === String(uuid)
      ) {
        nombreEvaluations++;
      }
    });
  }

  const heuresFormation = sessionsSuivies.reduce(
    function (total, session) {
      return total + session.dureeHeures;
    },
    0
  );

  return {
    sessions: sessionsSuivies,

    synthese: {
      sessionsRealisees: sessionsSuivies.length,
      heuresFormation: Math.round(
        heuresFormation * 100
      ) / 100,

      tauxPresence: sessionsConcernees.length
        ? Math.round(
          nombrePresences /
          sessionsConcernees.length *
          100
        )
        : null,

      evaluations: nombreEvaluations
    }
  };
}


/**
 * Ajoute ou modifie un stagiaire.
 */
function enregistrerStagiaire(donnees) {
  verifierDonneesStagiaire_(donnees);

  const feuille = obtenirFeuilleStagiaires_();
  const valeurs = feuille.getDataRange().getValues();
  const entetes = valeurs[0];
  const index = creerIndexEntetes_(entetes);

  const uuid = donnees.uuid || Utilities.getUuid();

  let numeroLigne = null;

  for (let i = 1; i < valeurs.length; i++) {
    if (
      String(valeurs[i][index.UUID]) ===
      String(uuid)
    ) {
      numeroLigne = i + 1;
      break;
    }
  }

  const statut = String(
    donnees.statut || 'À préparer'
  ).trim();

  const preparationFermee = [
    'Préparation terminée',
    'Préparation abandonnée'
  ].includes(statut);

  let dateCloture = convertirTexteEnDate_(
    donnees.dateCloture
  );

  let motifCloture = String(
    donnees.motifCloture || ''
  ).trim();

  if (!preparationFermee) {
    dateCloture = '';
    motifCloture = '';
  } else if (!dateCloture) {
    dateCloture = new Date();
  }

  const ligne = new Array(entetes.length).fill('');

  ligne[index.UUID] = uuid;

  ligne[index.NOM] = nettoyerNom_(
    donnees.nom
  );

  ligne[index.PRENOM] = nettoyerPrenom_(
    donnees.prenom
  );

  ligne[index.FORMATION] = String(
    donnees.formation || ''
  ).trim();

  ligne[index.DATE_DEBUT_PREPARATION] =
    convertirTexteEnDate_(
      donnees.dateDebutPreparation
    );

  ligne[index.DATE_STAGE] =
    convertirTexteEnDate_(
      donnees.dateStage
    );

  ligne[index.STATUT] = statut;

  ligne[index.DATE_CLOTURE] = dateCloture;

  ligne[index.MOTIF_CLOTURE] = motifCloture;

  ligne[index.NOTES_ADMINISTRATIVES] = String(
    donnees.notesAdministratives || ''
  ).trim();

  ligne[index.GRADE] = String(
    donnees.grade || ''
  ).trim();

  ligne[index.TELEPHONE] = nettoyerTelephone_(
    donnees.telephone
  );

  ligne[index.EMAIL] = String(
    donnees.email || ''
  )
    .trim()
    .toLowerCase();

  ligne[index.PHOTO_URL] = String(
    donnees.photoUrl || ''
  ).trim();

  ligne[index.FORMATEUR_REFERENT] = String(
    donnees.formateurReferent || ''
  ).trim();

  if (numeroLigne) {
    feuille
      .getRange(
        numeroLigne,
        1,
        1,
        ligne.length
      )
      .setValues([ligne]);
  } else {
    feuille.appendRow(ligne);
    numeroLigne = feuille.getLastRow();
  }

  appliquerFormatsStagiaires_(
    feuille,
    numeroLigne
  );

  return {
    succes: true,
    uuid: uuid,

    message: donnees.uuid
      ? 'Stagiaire modifié.'
      : 'Stagiaire enregistré.'
  };
}


/**
 * Retourne les formations actives configurées
 * dans la feuille FORMATIONS.
 */
function getFormations() {
  const classeur =
    SpreadsheetApp.getActiveSpreadsheet();

  const feuille =
    classeur.getSheetByName('FORMATIONS');

  if (!feuille || feuille.getLastRow() < 2) {
    return [];
  }

  const donnees =
    feuille.getDataRange().getValues();

  const entetes = donnees[0].map(function (valeur) {
    return normaliserEntete_(valeur);
  });

  const indexLibelle =
    entetes.indexOf('LIBELLE');

  const indexActif =
    entetes.indexOf('ACTIF');

  if (indexLibelle === -1) {
    throw new Error(
      'La colonne LIBELLE est absente de la feuille FORMATIONS.'
    );
  }

  return donnees
    .slice(1)
    .filter(function (ligne) {
      const libelle = String(
        ligne[indexLibelle] || ''
      ).trim();

      if (!libelle) {
        return false;
      }

      if (indexActif === -1) {
        return true;
      }

      const actif = String(
        ligne[indexActif] || ''
      )
        .trim()
        .toLowerCase();

      return [
        'oui',
        'true',
        '1',
        'actif',
        'active'
      ].includes(actif);
    })
    .map(function (ligne) {
      return String(
        ligne[indexLibelle] || ''
      ).trim();
    })
    .sort(function (a, b) {
      return a.localeCompare(
        b,
        'fr',
        { sensitivity: 'base' }
      );
    });
}


/**
 * Retourne les statuts disponibles.
 */
function getStatutsStagiaires() {
  return CONFIG_STAGIAIRES.statuts.slice();
}


/**
 * Crée la feuille et ses entêtes si nécessaire.
 */
function obtenirFeuilleStagiaires_() {
  const classeur =
    SpreadsheetApp.getActiveSpreadsheet();

  let feuille = classeur.getSheetByName(
    CONFIG_STAGIAIRES.feuille
  );

  if (!feuille) {
    feuille = classeur.insertSheet(
      CONFIG_STAGIAIRES.feuille
    );
  }

  const premiereLigne = feuille
    .getRange(
      1,
      1,
      1,
      CONFIG_STAGIAIRES.colonnes.length
    )
    .getValues()[0];

  const ligneVide =
    premiereLigne.every(function (valeur) {
      return valeur === '';
    });

  if (ligneVide) {
    feuille
      .getRange(
        1,
        1,
        1,
        CONFIG_STAGIAIRES.colonnes.length
      )
      .setValues([
        CONFIG_STAGIAIRES.colonnes
      ]);

    feuille
      .getRange(
        1,
        1,
        1,
        CONFIG_STAGIAIRES.colonnes.length
      )
      .setFontWeight('bold')
      .setBackground('#c62828')
      .setFontColor('#ffffff');

    feuille.setFrozenRows(1);
  }

  const entetes = feuille
    .getRange(
      1,
      1,
      1,
      feuille.getLastColumn()
    )
    .getValues()[0];

  CONFIG_STAGIAIRES.colonnes.forEach(
    function (colonne) {
      const existe = entetes.some(
        function (entete) {
          return normaliserEntete_(entete) ===
            colonne;
        }
      );

      if (!existe) {
        throw new Error(
          'La colonne "' +
          colonne +
          '" est absente de la feuille STAGIAIRES.'
        );
      }
    }
  );

  return feuille;
}


/**
 * Vérifie les données reçues.
 */
function verifierDonneesStagiaire_(donnees) {
  if (!donnees) {
    throw new Error('Aucune donnée reçue.');
  }

  if (!String(donnees.nom || '').trim()) {
    throw new Error('Le nom est obligatoire.');
  }

  if (!String(donnees.prenom || '').trim()) {
    throw new Error(
      'Le prénom est obligatoire.'
    );
  }

  if (
    !String(donnees.formation || '').trim()
  ) {
    throw new Error(
      'La formation est obligatoire.'
    );
  }

  if (!donnees.dateDebutPreparation) {
    throw new Error(
      'La date de début de préparation est obligatoire.'
    );
  }

  if (!donnees.dateStage) {
    throw new Error(
      'La date du stage est obligatoire.'
    );
  }

  if (
    !CONFIG_STAGIAIRES.statuts.includes(
      donnees.statut
    )
  ) {
    throw new Error(
      'Le statut sélectionné est invalide.'
    );
  }

  const dateDebut = convertirTexteEnDate_(
    donnees.dateDebutPreparation
  );

  const dateStage = convertirTexteEnDate_(
    donnees.dateStage
  );

  if (dateStage < dateDebut) {
    throw new Error(
      'La date du stage ne peut pas précéder le début de préparation.'
    );
  }

  const email = String(
    donnees.email || ''
  ).trim();

  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error(
      'L’adresse e-mail renseignée est invalide.'
    );
  }

  const photoUrl = String(
    donnees.photoUrl || ''
  ).trim();

  if (
    photoUrl &&
    !/^https?:\/\/.+/i.test(photoUrl)
  ) {
    throw new Error(
      'Le lien de la photo doit commencer par http:// ou https://.'
    );
  }
}


/**
 * Crée un index à partir des entêtes.
 */
function creerIndexEntetes_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserEntete_(entete)] = position;
  });

  return index;
}


/**
 * Normalise un nom de colonne.
 */
function normaliserEntete_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


/**
 * Convertit une date yyyy-MM-dd en objet Date.
 */
function convertirTexteEnDate_(valeur) {
  if (!valeur) {
    return '';
  }

  if (
    Object.prototype.toString.call(valeur) ===
    '[object Date]'
  ) {
    return valeur;
  }

  const elements =
    String(valeur).split('-');

  if (elements.length !== 3) {
    throw new Error(
      'Format de date invalide.'
    );
  }

  const annee = Number(elements[0]);
  const mois = Number(elements[1]);
  const jour = Number(elements[2]);

  const date = new Date(
    annee,
    mois - 1,
    jour,
    12,
    0,
    0
  );

  if (
    date.getFullYear() !== annee ||
    date.getMonth() !== mois - 1 ||
    date.getDate() !== jour
  ) {
    throw new Error(
      'La date renseignée est invalide.'
    );
  }

  return date;
}


/**
 * Convertit une date Sheets pour l'interface.
 */
function convertirDatePourInterface_(valeur) {
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


/**
 * Met le nom en majuscules.
 */
function nettoyerNom_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase();
}


/**
 * Met en forme le prénom.
 */
function nettoyerPrenom_(valeur) {
  const texte = String(valeur || '')
    .trim()
    .toLowerCase();

  if (!texte) {
    return '';
  }

  return texte
    .split(/([\s-])/)
    .map(function (partie) {
      if (/[\s-]/.test(partie)) {
        return partie;
      }

      return (
        partie.charAt(0).toUpperCase() +
        partie.slice(1)
      );
    })
    .join('');
}


/**
 * Nettoie le numéro de téléphone
 * sans supprimer les caractères utiles.
 */
function nettoyerTelephone_(valeur) {
  return String(valeur || '')
    .trim()
    .replace(/\s+/g, ' ');
}


/**
 * Lit une feuille facultative utilisée par la synthèse.
 */
function lireFeuillePourSuivi_(classeur, nomFeuille) {
  const feuille = classeur.getSheetByName(nomFeuille);

  if (!feuille || feuille.getLastRow() < 1) {
    return {
      index: {},
      lignes: []
    };
  }

  const donnees = feuille.getDataRange().getValues();

  return {
    index: creerIndexEntetes_(donnees[0]),
    lignes: donnees.slice(1)
  };
}


/**
 * Retourne une date locale normalisée à midi.
 */
function obtenirDateSansHeure_(valeur) {
  if (!valeur) {
    return null;
  }

  let date;

  if (
    Object.prototype.toString.call(valeur) ===
    '[object Date]'
  ) {
    date = new Date(valeur.getTime());
  } else {
    const elements = String(valeur).split('-');

    if (elements.length === 3) {
      date = new Date(
        Number(elements[0]),
        Number(elements[1]) - 1,
        Number(elements[2]),
        12,
        0,
        0
      );
    } else {
      date = new Date(valeur);
    }
  }

  if (isNaN(date.getTime())) {
    return null;
  }

  date.setHours(12, 0, 0, 0);
  return date;
}


/**
 * Convertit une heure Sheets pour l'interface.
 */
function convertirHeurePourInterface_(valeur) {
  if (valeur === '' || valeur === null) {
    return '';
  }

  if (
    Object.prototype.toString.call(valeur) ===
    '[object Date]'
  ) {
    return Utilities.formatDate(
      valeur,
      Session.getScriptTimeZone(),
      'HH:mm'
    );
  }

  if (typeof valeur === 'number') {
    const minutes = Math.round(valeur * 24 * 60);
    const heures = Math.floor(minutes / 60) % 24;
    const resteMinutes = minutes % 60;

    return (
      String(heures).padStart(2, '0') +
      ':' +
      String(resteMinutes).padStart(2, '0')
    );
  }

  const texte = String(valeur).trim();
  const correspondance = texte.match(
    /^(\d{1,2}):(\d{2})/
  );

  if (!correspondance) {
    return texte;
  }

  return (
    correspondance[1].padStart(2, '0') +
    ':' +
    correspondance[2]
  );
}


/**
 * Convertit une valeur numérique issue de Sheets.
 */
function convertirNombre_(valeur) {
  if (typeof valeur === 'number') {
    return isNaN(valeur) ? 0 : valeur;
  }

  const nombre = Number(
    String(valeur || '')
      .trim()
      .replace(',', '.')
  );

  return isNaN(nombre) ? 0 : nombre;
}


/**
 * Applique les formats dans la feuille.
 */
function appliquerFormatsStagiaires_(
  feuille,
  ligne
) {
  const entetes = feuille
    .getRange(
      1,
      1,
      1,
      feuille.getLastColumn()
    )
    .getValues()[0];

  const index = creerIndexEntetes_(entetes);

  [
    'DATE_DEBUT_PREPARATION',
    'DATE_STAGE',
    'DATE_CLOTURE'
  ].forEach(function (colonne) {
    feuille
      .getRange(
        ligne,
        index[colonne] + 1
      )
      .setNumberFormat('dd/mm/yyyy');
  });

  feuille
    .getRange(
      ligne,
      index.TELEPHONE + 1
    )
    .setNumberFormat('@');

  feuille
    .getRange(
      ligne,
      index.EMAIL + 1
    )
    .setNumberFormat('@');
}
