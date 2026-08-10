'use strict';

const COLONNES_FORMATIONS_ADMINISTRATION = [
  'ID_FORMATION',
  'LIBELLE',
  'ORDRE',
  'ACTIF'
];
const CLES_PARAMETRES_EMAIL_INDEMNISATION_ = [
  'EMAIL_CHEF_CENTRE',
  'NOM_CHEF_CENTRE',
  'NOM_CENTRE',
  'OBJET_MAIL_INDEMNISATION'
];


function getDonneesAdministration(jetonAdministrateur) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const etatSauvegardes =
    obtenirEtatSauvegardesAdministrationSansErreur_();

  etatSauvegardes.inventaire =
    construireInventaireSauvegardesRestaurabilite_();
  etatSauvegardes.planification =
    obtenirConfigurationSauvegardesAutomatiques_();

  return {
    session: session,
    formations: lireFormationsAdministration_(),
    parametresIndemnisation:
      lireParametresEmailIndemnisation_(),
    diagnostic: verifierIntegriteBase(jetonAdministrateur),
    sauvegardes: etatSauvegardes,
    restauration: getEtatRestaurationAdministration(
      jetonAdministrateur
    )
  };
}


function enregistrerParametresEmailIndemnisationAdministration(
  donnees,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    return enregistrerParametresEmailIndemnisationAdministrationInterne_(
      donnees,
      session
    );
  });
}


function enregistrerParametresEmailIndemnisationAdministrationInterne_(
  donnees,
  session
) {
  donnees = donnees || {};

  const valeurs = {
    EMAIL_CHEF_CENTRE: String(
      donnees.emailChefCentre || ''
    ).trim().slice(0, 320),
    NOM_CHEF_CENTRE: String(
      donnees.nomChefCentre || ''
    ).trim().slice(0, 250),
    NOM_CENTRE: String(
      donnees.nomCentre || ''
    ).trim().slice(0, 250),
    OBJET_MAIL_INDEMNISATION: String(
      donnees.objetMailIndemnisation || ''
    ).trim().slice(0, 500)
  };

  if (
    valeurs.EMAIL_CHEF_CENTRE &&
    !adresseEmailValideAdministration_(valeurs.EMAIL_CHEF_CENTRE)
  ) {
    throw new Error('L’adresse e-mail du chef de centre est invalide.');
  }

  if (!valeurs.OBJET_MAIL_INDEMNISATION) {
    throw new Error('L’objet du message est obligatoire.');
  }

  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const feuille = obtenirFeuilleLecturePure_(
    classeur,
    'PARAMETRES',
    ['CLE', 'VALEUR']
  );
  const donneesFeuille = feuille.getDataRange().getValues();
  const index = creerIndexAdministration_(donneesFeuille[0]);
  const lignesParCle = {};

  donneesFeuille.slice(1).forEach(function (ligne, position) {
    const cle = normaliserAdministration_(ligne[index.CLE]);

    if (cle) {
      lignesParCle[cle] = position + 2;
    }
  });

  CLES_PARAMETRES_EMAIL_INDEMNISATION_.forEach(function (cle) {
    if (!lignesParCle[cle]) {
      throw new Error(
        'Le paramètre ' + cle +
        ' est absent. Exécute les migrations avant l’enregistrement.'
      );
    }
  });

  const restaurations = [];

  try {
    CLES_PARAMETRES_EMAIL_INDEMNISATION_.forEach(function (cle) {
      const cellule = feuille.getRange(
        lignesParCle[cle],
        index.VALEUR + 1
      );
      restaurations.push({
        cellule: cellule,
        valeur: cellule.getValue()
      });
      cellule.setValue(valeurs[cle]);
    });

    SpreadsheetApp.flush();

    journaliserActionSensible_(
      'PARAMETRES_EMAIL_INDEMNISATION_MODIFICATION',
      'PARAMETRES',
      'EMAIL_INDEMNISATION',
      {
        emailChefRenseigne: Boolean(valeurs.EMAIL_CHEF_CENTRE),
        nomChefRenseigne: Boolean(valeurs.NOM_CHEF_CENTRE),
        nomCentreRenseigne: Boolean(valeurs.NOM_CENTRE),
        objetRenseigne: Boolean(valeurs.OBJET_MAIL_INDEMNISATION)
      },
      session.identifiantHistorique
    );
  } catch (erreur) {
    restaurations.reverse().forEach(function (restauration) {
      restauration.cellule.setValue(restauration.valeur);
    });
    SpreadsheetApp.flush();
    throw erreur;
  }

  return {
    succes: true,
    message: 'Paramètres d’envoi enregistrés.',
    parametres: construireParametresEmailIndemnisation_(valeurs)
  };
}


function lireParametresEmailIndemnisation_() {
  const feuille = obtenirFeuilleLecturePure_(
    SpreadsheetApp.getActiveSpreadsheet(),
    'PARAMETRES',
    ['CLE', 'VALEUR']
  );
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexAdministration_(donnees[0]);
  const valeurs = {};

  donnees.slice(1).forEach(function (ligne) {
    const cle = normaliserAdministration_(ligne[index.CLE]);

    if (CLES_PARAMETRES_EMAIL_INDEMNISATION_.includes(cle)) {
      valeurs[cle] = String(ligne[index.VALEUR] || '').trim();
    }
  });

  CLES_PARAMETRES_EMAIL_INDEMNISATION_.forEach(function (cle) {
    if (!Object.prototype.hasOwnProperty.call(valeurs, cle)) {
      valeurs[cle] = '';
    }
  });

  return construireParametresEmailIndemnisation_(valeurs);
}


function construireParametresEmailIndemnisation_(valeurs) {
  return {
    emailChefCentre: valeurs.EMAIL_CHEF_CENTRE || '',
    nomChefCentre: valeurs.NOM_CHEF_CENTRE || '',
    nomCentre: valeurs.NOM_CENTRE || '',
    objetMailIndemnisation:
      valeurs.OBJET_MAIL_INDEMNISATION || ''
  };
}


function adresseEmailValideAdministration_(adresse) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(adresse || ''));
}


function enregistrerFormationAdministration(
  donnees,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    return enregistrerFormationAdministrationInterne_(
      donnees,
      session
    );
  });
}


function enregistrerFormationAdministrationInterne_(
  donnees,
  session
) {

  if (!donnees) {
    throw new Error('Aucune donnée de formation reçue.');
  }

  const libelle = String(donnees.libelle || '').trim();
  const idDemande = String(donnees.idFormation || '').trim();
  const ordreDemande = Math.max(
    1,
    Math.floor(Number(donnees.ordre) || 1)
  );
  const actif = convertirBooleenAdministration_(donnees.actif);

  if (!libelle) {
    throw new Error('Le libellé de la formation est obligatoire.');
  }

  const restaurations = [];

  try {
    const feuille = obtenirFeuilleFormationsAdministration_();
    const formations = lireFormationsAdministration_();
    const formationExistante = idDemande
      ? formations.find(function (formation) {
        return formation.idFormation === idDemande;
      })
      : null;

    if (idDemande && !formationExistante) {
      throw new Error('Formation introuvable.');
    }

    const doublon = formations.find(function (formation) {
      return (
        formation.idFormation !== idDemande &&
        normaliserAdministration_(formation.libelle) ===
          normaliserAdministration_(libelle)
      );
    });

    if (doublon) {
      throw new Error(
        'Une formation utilise déjà ce libellé.'
      );
    }

    const idFormation = idDemande || Utilities.getUuid();
    const index = obtenirIndexFormationAdministration_(feuille);
    const ancienneLigne = formationExistante
      ? feuille
        .getRange(
          formationExistante.numeroLigne,
          1,
          1,
          feuille.getLastColumn()
        )
        .getValues()[0]
      : null;
    const ligne = ancienneLigne
      ? ancienneLigne.slice()
      : new Array(feuille.getLastColumn()).fill('');

    ligne[index.ID_FORMATION] = idFormation;
    ligne[index.LIBELLE] = libelle;
    ligne[index.ORDRE] = ordreDemande;
    ligne[index.ACTIF] = actif ? 'Oui' : 'Non';

    if (formationExistante) {
      const plage = feuille.getRange(
        formationExistante.numeroLigne,
        1,
        1,
        ligne.length
      );

      restaurations.push({
        plage: plage,
        valeurs: [ancienneLigne]
      });
      plage.setValues([ligne]);
    } else {
      feuille.appendRow(ligne);
      restaurations.push({
        feuille: feuille,
        ligneAjoutee: feuille.getLastRow()
      });
    }

    if (
      formationExistante &&
      formationExistante.libelle !== libelle
    ) {
      remplacerLibelleFormationUtilisee_(
        formationExistante.libelle,
        libelle,
        restaurations
      );
    }

    reordonnerFormationsAdministration_(
      feuille,
      idFormation,
      ordreDemande,
      restaurations
    );

    SpreadsheetApp.flush();

    if (
      formationExistante &&
      formationExistante.libelle !== libelle &&
      typeof invaliderGenerationSourcesStatuts_ === 'function'
    ) {
      invaliderGenerationSourcesStatuts_(
        ['STAGIAIRES', 'SESSIONS'],
        'RENOMMAGE_FORMATION_UTILISEE'
      );
    }

    journaliserActionSensible_(
      formationExistante
        ? 'FORMATION_MODIFICATION'
        : 'FORMATION_CREATION',
      'FORMATION',
      idFormation,
      {
        ancienLibelle: formationExistante
          ? formationExistante.libelle
          : '',
        libelle: libelle,
        ordre: ordreDemande,
        actif: actif
      },
      session.identifiantHistorique
    );

    return {
      succes: true,
      idFormation: idFormation,
      message: formationExistante
        ? 'Formation modifiée.'
        : 'Formation ajoutée.'
    };
  } catch (erreur) {
    restaurerAdministration_(restaurations);
    throw erreur;
  }
}


function basculerActifFormationAdministration(
  idFormation,
  actif,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    return basculerActifFormationAdministrationInterne_(
      idFormation,
      actif,
      session
    );
  });
}


function basculerActifFormationAdministrationInterne_(
  idFormation,
  actif,
  session
) {
  const identifiant = String(idFormation || '').trim();
  const nouvelEtat = convertirBooleenAdministration_(actif);
  const feuille = obtenirFeuilleFormationsAdministration_();
  const formation = lireFormationsAdministration_().find(
    function (element) {
      return element.idFormation === identifiant;
    }
  );

  if (!formation) {
    throw new Error('Formation introuvable.');
  }

  const index = obtenirIndexFormationAdministration_(feuille);
  feuille
    .getRange(formation.numeroLigne, index.ACTIF + 1)
    .setValue(nouvelEtat ? 'Oui' : 'Non');

  journaliserActionSensible_(
    nouvelEtat
      ? 'FORMATION_ACTIVATION'
      : 'FORMATION_DESACTIVATION',
    'FORMATION',
    identifiant,
    {
      libelle: formation.libelle,
      actif: nouvelEtat
    },
    session.identifiantHistorique
  );

  return {
    succes: true,
    actif: nouvelEtat,
    message: nouvelEtat
      ? 'Formation activée.'
      : 'Formation désactivée.'
  };
}


function supprimerFormationAdministration(
  idFormation,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    return supprimerFormationAdministrationInterne_(
      idFormation,
      session
    );
  });
}


function supprimerFormationAdministrationInterne_(
  idFormation,
  session
) {
  const identifiant = String(idFormation || '').trim();
  const feuille = obtenirFeuilleFormationsAdministration_();
  const formation = lireFormationsAdministration_().find(
    function (element) {
      return element.idFormation === identifiant;
    }
  );

  if (!formation) {
    throw new Error('Formation introuvable.');
  }

  if (formationUtiliseeAdministration_(formation.libelle)) {
    const index = obtenirIndexFormationAdministration_(feuille);
    feuille
      .getRange(formation.numeroLigne, index.ACTIF + 1)
      .setValue('Non');

    journaliserActionSensible_(
      'FORMATION_DESACTIVATION_HISTORIQUE',
      'FORMATION',
      identifiant,
      {
        libelle: formation.libelle,
        suppressionPhysique: false
      },
      session.identifiantHistorique
    );

    return {
      succes: true,
      supprimee: false,
      desactivee: true,
      message: 'Cette formation est déjà utilisée : elle a été désactivée afin de préserver l’historique.'
    };
  }

  feuille.deleteRow(formation.numeroLigne);
  normaliserOrdreFormationsAdministration_(feuille);

  journaliserActionSensible_(
    'FORMATION_SUPPRESSION',
    'FORMATION',
    identifiant,
    {
      libelle: formation.libelle,
      suppressionPhysique: true
    },
    session.identifiantHistorique
  );

  return {
    succes: true,
    supprimee: true,
    desactivee: false,
    message: 'Formation inutilisée supprimée.'
  };
}


function lireFormationsAdministration_() {
  const feuille = obtenirFeuilleFormationsAdministration_();
  const donnees = feuille.getDataRange().getValues();

  if (donnees.length <= 1) {
    return [];
  }

  const index = creerIndexAdministration_(donnees[0]);

  return donnees.slice(1).map(function (ligne, position) {
    const idFormation = String(
      ligne[index.ID_FORMATION] || ''
    ).trim();
    const libelle = String(
      ligne[index.LIBELLE] || ''
    ).trim();

    if (!idFormation && !libelle) {
      return null;
    }

    return {
      idFormation: idFormation,
      libelle: libelle,
      ordre: Number(ligne[index.ORDRE]) || position + 1,
      actif: convertirBooleenAdministration_(
        ligne[index.ACTIF]
      ),
      utilisee: formationUtiliseeAdministration_(libelle),
      numeroLigne: position + 2
    };
  }).filter(Boolean).sort(function (a, b) {
    return (
      a.ordre - b.ordre ||
      a.libelle.localeCompare(
        b.libelle,
        'fr',
        { sensitivity: 'base' }
      )
    );
  });
}


function obtenirFeuilleFormationsAdministration_() {
  const feuille = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName('FORMATIONS');

  if (!feuille) {
    throw new Error('La feuille FORMATIONS est absente.');
  }

  const entetes = feuille
    .getRange(1, 1, 1, feuille.getLastColumn())
    .getValues()[0];
  const index = creerIndexAdministration_(entetes);

  COLONNES_FORMATIONS_ADMINISTRATION.forEach(function (colonne) {
    if (!Number.isInteger(index[colonne])) {
      throw new Error(
        'La colonne "' + colonne +
        '" est absente de FORMATIONS.'
      );
    }
  });

  return feuille;
}


function formationUtiliseeAdministration_(libelle) {
  if (!libelle) {
    return false;
  }

  const classeur = SpreadsheetApp.getActiveSpreadsheet();

  return [
    'STAGIAIRES',
    'SESSIONS',
    'CATEGORIES',
    'REFERENTIEL'
  ].some(function (nomFeuille) {
    const feuille = classeur.getSheetByName(nomFeuille);

    if (!feuille || feuille.getLastRow() < 2) {
      return false;
    }

    const donnees = feuille.getDataRange().getValues();
    const index = creerIndexAdministration_(donnees[0]);

    if (!Number.isInteger(index.FORMATION)) {
      return false;
    }

    return donnees.slice(1).some(function (ligne) {
      return String(ligne[index.FORMATION] || '').trim() ===
        libelle;
    });
  });
}


function remplacerLibelleFormationUtilisee_(
  ancienLibelle,
  nouveauLibelle,
  restaurations
) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();

  [
    'STAGIAIRES',
    'SESSIONS',
    'CATEGORIES',
    'REFERENTIEL'
  ].forEach(function (nomFeuille) {
    const feuille = classeur.getSheetByName(nomFeuille);

    if (!feuille || feuille.getLastRow() < 2) {
      return;
    }

    const donnees = feuille.getDataRange().getValues();
    const index = creerIndexAdministration_(donnees[0]);

    if (!Number.isInteger(index.FORMATION)) {
      return;
    }

    donnees.slice(1).forEach(function (ligne, position) {
      if (
        String(ligne[index.FORMATION] || '').trim() !==
        ancienLibelle
      ) {
        return;
      }

      const cellule = feuille.getRange(
        position + 2,
        index.FORMATION + 1
      );

      restaurations.push({
        plage: cellule,
        valeurs: [[cellule.getValue()]]
      });
      cellule.setValue(nouveauLibelle);
    });
  });
}


function reordonnerFormationsAdministration_(
  feuille,
  idFormation,
  ordreDemande,
  restaurations
) {
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexAdministration_(donnees[0]);
  const formations = donnees.slice(1).map(function (ligne, position) {
    return {
      idFormation: String(ligne[index.ID_FORMATION] || ''),
      ordre: Number(ligne[index.ORDRE]) || position + 1,
      numeroLigne: position + 2
    };
  }).filter(function (formation) {
    return formation.idFormation;
  }).sort(function (a, b) {
    return a.ordre - b.ordre;
  });

  const positionActuelle = formations.findIndex(
    function (formation) {
      return formation.idFormation === idFormation;
    }
  );

  if (positionActuelle === -1) {
    return;
  }

  const cible = formations.splice(positionActuelle, 1)[0];
  const nouvellePosition = Math.min(
    Math.max(ordreDemande - 1, 0),
    formations.length
  );
  formations.splice(nouvellePosition, 0, cible);

  formations.forEach(function (formation, position) {
    const cellule = feuille.getRange(
      formation.numeroLigne,
      index.ORDRE + 1
    );

    restaurations.push({
      plage: cellule,
      valeurs: [[cellule.getValue()]]
    });
    cellule.setValue(position + 1);
  });
}


function normaliserOrdreFormationsAdministration_(feuille) {
  const donnees = feuille.getDataRange().getValues();

  if (donnees.length <= 1) {
    return;
  }

  const index = creerIndexAdministration_(donnees[0]);
  const lignes = donnees.slice(1).map(function (ligne, position) {
    return {
      numeroLigne: position + 2,
      ordre: Number(ligne[index.ORDRE]) || position + 1
    };
  }).sort(function (a, b) {
    return a.ordre - b.ordre;
  });

  lignes.forEach(function (ligne, position) {
    feuille
      .getRange(ligne.numeroLigne, index.ORDRE + 1)
      .setValue(position + 1);
  });
}


function restaurerAdministration_(restaurations) {
  restaurations.slice().reverse().forEach(function (entree) {
    try {
      if (entree.plage) {
        entree.plage.setValues(entree.valeurs);
      } else if (
        entree.feuille &&
        entree.ligneAjoutee &&
        entree.feuille.getLastRow() >= entree.ligneAjoutee
      ) {
        entree.feuille.deleteRow(entree.ligneAjoutee);
      }
    } catch (erreur) {
      console.error(erreur);
    }
  });

  try {
    SpreadsheetApp.flush();
  } catch (erreur) {
    console.error(erreur);
  }
}


function obtenirIndexFormationAdministration_(feuille) {
  return creerIndexAdministration_(
    feuille
      .getRange(1, 1, 1, feuille.getLastColumn())
      .getValues()[0]
  );
}


function creerIndexAdministration_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserAdministration_(entete)] = position;
  });

  return index;
}


function normaliserAdministration_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function convertirBooleenAdministration_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }

  return [
    'oui',
    'true',
    '1',
    'actif',
    'active'
  ].includes(String(valeur || '').trim().toLowerCase());
}
