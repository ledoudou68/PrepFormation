'use strict';

const CONFIG_FORMATEURS = {
  feuille: 'FORMATEURS',
  colonnes: [
    'ID_FORMATEUR',
    'NOM',
    'PRENOM',
    'ACTIF',
    'DATE_CREATION',
    'DATE_MODIFICATION'
  ]
};


/**
 * Retourne tous les formateurs, actifs ou non.
 */
function getFormateurs() {
  const feuille = obtenirFeuilleFormateurs_();
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
        actif: convertirActifFormateur_(
          ligne[index.ACTIF]
        )
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
function enregistrerFormateur(donnees) {
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

  return {
    succes: true,
    idFormateur: idFormateur,
    message: donnees.idFormateur
      ? 'Formateur modifié.'
      : 'Formateur enregistré.'
  };
}


function obtenirFeuilleFormateurs_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  let feuille = classeur.getSheetByName(
    CONFIG_FORMATEURS.feuille
  );

  if (!feuille) {
    feuille = classeur.insertSheet(
      CONFIG_FORMATEURS.feuille
    );
  }

  const premiereLigne = feuille
    .getRange(
      1,
      1,
      1,
      CONFIG_FORMATEURS.colonnes.length
    )
    .getValues()[0];

  if (
    premiereLigne.every(function (valeur) {
      return valeur === '';
    })
  ) {
    feuille
      .getRange(
        1,
        1,
        1,
        CONFIG_FORMATEURS.colonnes.length
      )
      .setValues([CONFIG_FORMATEURS.colonnes])
      .setFontWeight('bold')
      .setBackground('#c62828')
      .setFontColor('#ffffff');

    feuille.setFrozenRows(1);
  }

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
