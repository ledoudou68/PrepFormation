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