'use strict';

const STATUTS_INDEMNISATION = [
  'À demander',
  'Demande envoyée',
  'Indemnisée',
  'À corriger'
];

const COLONNES_HISTORIQUE_INDEMNISATIONS = [
  'ID_HISTORIQUE',
  'ID_OPERATION',
  'ID_PRESTATION',
  'ANCIEN_STATUT',
  'NOUVEAU_STATUT',
  'ANCIENNE_DATE_DEMANDE',
  'NOUVELLE_DATE_DEMANDE',
  'ANCIENNE_REFERENCE',
  'NOUVELLE_REFERENCE',
  'REMARQUE_ACTION',
  'UTILISATEUR',
  'DATE_ACTION'
];


/**
 * Retourne toutes les prestations existantes, enrichies avec
 * les informations des séances et des formateurs.
 */
function getDonneesIndemnisations(jetonAdministrateur) {
  exigerAdministrateur_(jetonAdministrateur);

  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tablePrestations = lireTableIndemnisation_(
    classeur,
    'PRESTATIONS_FORMATEURS'
  );

  verifierColonnesIndemnisation_(
    tablePrestations,
    'PRESTATIONS_FORMATEURS',
    [
      'ID_PRESTATION',
      'ID_SESSION',
      'ID_FORMATEUR',
      'DUREE_HEURES',
      'STATUT_INDEMNISATION',
      'DATE_DEMANDE',
      'REFERENCE_DEMANDE',
      'REMARQUES_INDEMNISATION',
      'DATE_MODIFICATION'
    ]
  );

  const tableSessions = lireTableIndemnisation_(
    classeur,
    'SESSIONS'
  );

  verifierColonnesIndemnisation_(
    tableSessions,
    'SESSIONS',
    [
      'ID_SESSION',
      'DATE_SESSION',
      'HEURE_DEBUT',
      'HEURE_FIN',
      'FORMATION'
    ]
  );

  const tableFormateurs = lireTableIndemnisation_(
    classeur,
    'FORMATEURS'
  );

  verifierColonnesIndemnisation_(
    tableFormateurs,
    'FORMATEURS',
    ['ID_FORMATEUR', 'NOM', 'PRENOM']
  );

  const sessionsParId = {};
  const indexSessions = tableSessions.index;

  tableSessions.lignes.forEach(function (ligne) {
    const idSession = String(
      ligne[indexSessions.ID_SESSION] || ''
    );

    if (!idSession) {
      return;
    }

    if (sessionsParId[idSession]) {
      throw new Error(
        'Plusieurs séances utilisent le même ID_SESSION : ' +
        idSession + '.'
      );
    }

    sessionsParId[idSession] = {
      date: convertirDateInterfaceIndemnisation_(
        ligne[indexSessions.DATE_SESSION]
      ),
      heureDebut: convertirHeureInterfaceIndemnisation_(
        ligne[indexSessions.HEURE_DEBUT]
      ),
      heureFin: convertirHeureInterfaceIndemnisation_(
        ligne[indexSessions.HEURE_FIN]
      ),
      formation: String(
        ligne[indexSessions.FORMATION] || ''
      ).trim()
    };
  });

  const formateursParId = {};
  const indexFormateurs = tableFormateurs.index;

  tableFormateurs.lignes.forEach(function (ligne) {
    const idFormateur = String(
      ligne[indexFormateurs.ID_FORMATEUR] || ''
    );

    if (!idFormateur) {
      return;
    }

    formateursParId[idFormateur] = {
      idFormateur: idFormateur,
      nom: String(ligne[indexFormateurs.NOM] || '').trim(),
      prenom: String(
        ligne[indexFormateurs.PRENOM] || ''
      ).trim()
    };
  });

  const idsPrestations = new Set();
  const comptesParCle = {};
  const indexPrestations = tablePrestations.index;

  tablePrestations.lignes.forEach(function (ligne) {
    const idPrestation = String(
      ligne[indexPrestations.ID_PRESTATION] || ''
    );

    if (!idPrestation) {
      return;
    }

    if (idsPrestations.has(idPrestation)) {
      throw new Error(
        'Plusieurs prestations utilisent le même ID_PRESTATION : ' +
        idPrestation + '.'
      );
    }

    idsPrestations.add(idPrestation);

    const cle = [
      String(ligne[indexPrestations.ID_SESSION] || ''),
      String(ligne[indexPrestations.ID_FORMATEUR] || '')
    ].join('::');

    comptesParCle[cle] = (comptesParCle[cle] || 0) + 1;
  });

  const prestations = tablePrestations.lignes
    .map(function (ligne) {
      const idPrestation = String(
        ligne[indexPrestations.ID_PRESTATION] || ''
      );

      if (!idPrestation) {
        return null;
      }

      const idSession = String(
        ligne[indexPrestations.ID_SESSION] || ''
      );

      const idFormateur = String(
        ligne[indexPrestations.ID_FORMATEUR] || ''
      );

      const session = sessionsParId[idSession] || {};
      const formateur = formateursParId[idFormateur] || {
        idFormateur: idFormateur,
        nom: 'Formateur',
        prenom: 'non identifié'
      };

      const cle = idSession + '::' + idFormateur;

      return {
        idPrestation: idPrestation,
        idSession: idSession,
        idFormateur: idFormateur,
        dateSession: session.date || '',
        formation: session.formation || '',
        heureDebut: session.heureDebut || '',
        heureFin: session.heureFin || '',
        dureeHeures: convertirNombreIndemnisation_(
          ligne[indexPrestations.DUREE_HEURES]
        ),
        formateur: [formateur.prenom, formateur.nom]
          .filter(Boolean)
          .join(' '),
        nomFormateur: formateur.nom,
        prenomFormateur: formateur.prenom,
        statut: normaliserStatutIndemnisation_(
          ligne[indexPrestations.STATUT_INDEMNISATION]
        ),
        dateDemande: convertirDateInterfaceIndemnisation_(
          ligne[indexPrestations.DATE_DEMANDE]
        ),
        referenceDemande: String(
          ligne[indexPrestations.REFERENCE_DEMANDE] || ''
        ).trim(),
        remarqueAdministrative: String(
          ligne[
            indexPrestations.REMARQUES_INDEMNISATION
          ] || ''
        ).trim(),
        doublonPotentiel: comptesParCle[cle] > 1
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (
        String(b.dateSession).localeCompare(
          String(a.dateSession)
        ) ||
        a.nomFormateur.localeCompare(
          b.nomFormateur,
          'fr',
          { sensitivity: 'base' }
        ) ||
        a.prenomFormateur.localeCompare(
          b.prenomFormateur,
          'fr',
          { sensitivity: 'base' }
        )
      );
    });

  const idsFormateursUtilises = new Set(
    prestations.map(function (prestation) {
      return prestation.idFormateur;
    })
  );

  const formateurs = Object.keys(formateursParId)
    .filter(function (idFormateur) {
      return idsFormateursUtilises.has(idFormateur);
    })
    .map(function (idFormateur) {
      const formateur = formateursParId[idFormateur];

      return {
        idFormateur: idFormateur,
        libelle: [formateur.prenom, formateur.nom]
          .filter(Boolean)
          .join(' ')
      };
    })
    .sort(function (a, b) {
      return a.libelle.localeCompare(
        b.libelle,
        'fr',
        { sensitivity: 'base' }
      );
    });

  const formations = [...new Set(
    prestations
      .map(function (prestation) {
        return prestation.formation;
      })
      .filter(Boolean)
  )].sort(function (a, b) {
    return a.localeCompare(
      b,
      'fr',
      { sensitivity: 'base' }
    );
  });

  return {
    prestations: prestations,
    formateurs: formateurs,
    formations: formations,
    statuts: STATUTS_INDEMNISATION.slice(),
    derniersEnvois: lireDerniersEnvoisIndemnisation_()
  };
}


/**
 * Change le statut des seules prestations sélectionnées et
 * inscrit une ligne d'audit par prestation.
 */
function changerStatutPrestationsIndemnisation(
  donnees,
  jetonAdministrateur
) {
  const sessionUtilisateur = exigerAdministrateur_(
    jetonAdministrateur
  );

  return executerMutationMetier_(function () {
    return changerStatutPrestationsIndemnisationInterne_(
      donnees,
      sessionUtilisateur
    );
  });
}


function changerStatutPrestationsIndemnisationInterne_(
  donnees,
  sessionUtilisateur
) {

  if (!donnees) {
    throw new Error('Aucune action d’indemnisation reçue.');
  }

  const idsPrestations = valeursUniquesIndemnisation_(
    donnees.idsPrestations
  );

  if (!idsPrestations.length) {
    throw new Error('Sélectionne au moins une prestation.');
  }

  const statutCible = normaliserStatutIndemnisation_(
    donnees.statut
  );

  if (!STATUTS_INDEMNISATION.includes(statutCible)) {
    throw new Error('Le statut demandé est invalide.');
  }

  const idOperation = nettoyerOperationIndemnisation_(
    donnees.idOperation
  );

  const referenceCommune = String(
    donnees.reference || ''
  ).trim().slice(0, 250);

  const remarqueAction = String(
    donnees.remarque || ''
  ).trim().slice(0, 2000);

  const confirmationIndemnisee =
    convertirBooleenIndemnisation_(
      donnees.confirmationIndemnisee
    );

  const restaurations = [];
  let ajoutHistorique = null;

  try {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const feuilleHistorique =
      obtenirFeuilleHistoriqueIndemnisations_(classeur);

    if (
      operationIndemnisationDejaExecutee_(
        feuilleHistorique,
        idOperation,
        idsPrestations
      )
    ) {
      return {
        succes: true,
        rejouee: true,
        nombreModifiees: 0,
        message: 'Cette action a déjà été appliquée.'
      };
    }

    const table = lireTableIndemnisation_(
      classeur,
      'PRESTATIONS_FORMATEURS'
    );

    verifierColonnesIndemnisation_(
      table,
      'PRESTATIONS_FORMATEURS',
      [
        'ID_PRESTATION',
        'STATUT_INDEMNISATION',
        'DATE_DEMANDE',
        'REFERENCE_DEMANDE',
        'REMARQUES_INDEMNISATION',
        'DATE_MODIFICATION'
      ]
    );

    const index = table.index;
    const lignesParId = {};

    table.lignes.forEach(function (ligne, position) {
      const idPrestation = String(
        ligne[index.ID_PRESTATION] || ''
      );

      if (!idPrestation) {
        return;
      }

      if (lignesParId[idPrestation]) {
        throw new Error(
          'Plusieurs prestations utilisent le même ID_PRESTATION : ' +
          idPrestation + '.'
        );
      }

      lignesParId[idPrestation] = {
        numeroLigne: position + 2,
        valeurs: ligne.slice()
      };
    });

    idsPrestations.forEach(function (idPrestation) {
      if (!lignesParId[idPrestation]) {
        throw new Error(
          'La prestation ' + idPrestation +
          ' est introuvable. Aucune donnée n’a été modifiée.'
        );
      }
    });

    const contientIndemnisee = idsPrestations.some(
      function (idPrestation) {
        return normaliserStatutIndemnisation_(
          lignesParId[idPrestation].valeurs[
            index.STATUT_INDEMNISATION
          ]
        ) === 'Indemnisée';
      }
    );

    if (
      contientIndemnisee &&
      statutCible !== 'Indemnisée' &&
      !confirmationIndemnisee
    ) {
      throw new Error(
        'La sélection contient une prestation déjà indemnisée. Une confirmation explicite est obligatoire.'
      );
    }

    const maintenant = new Date();
    const aujourdHui = new Date(
      maintenant.getFullYear(),
      maintenant.getMonth(),
      maintenant.getDate(),
      12,
      0,
      0
    );

    const utilisateur =
      sessionUtilisateur.identifiantHistorique;
    const historiques = [];
    let nombreModifiees = 0;

    idsPrestations.forEach(function (idPrestation) {
      const entree = lignesParId[idPrestation];
      const ancienneLigne = entree.valeurs.slice();
      const nouvelleLigne = entree.valeurs.slice();

      const ancienStatut = normaliserStatutIndemnisation_(
        ancienneLigne[index.STATUT_INDEMNISATION]
      );

      const ancienneDate = ancienneLigne[index.DATE_DEMANDE];
      const ancienneReference = String(
        ancienneLigne[index.REFERENCE_DEMANDE] || ''
      ).trim();

      nouvelleLigne[index.STATUT_INDEMNISATION] = statutCible;

      if (statutCible === 'Demande envoyée') {
        nouvelleLigne[index.DATE_DEMANDE] = aujourdHui;

        if (referenceCommune) {
          nouvelleLigne[index.REFERENCE_DEMANDE] =
            referenceCommune;
        }
      }

      if (statutCible === 'À demander') {
        nouvelleLigne[index.DATE_DEMANDE] = '';
        nouvelleLigne[index.REFERENCE_DEMANDE] = '';
      }

      if (remarqueAction) {
        nouvelleLigne[
          index.REMARQUES_INDEMNISATION
        ] = ajouterRemarqueIndemnisation_(
          ancienneLigne[
            index.REMARQUES_INDEMNISATION
          ],
          remarqueAction,
          statutCible,
          aujourdHui
        );
      }

      nouvelleLigne[index.DATE_MODIFICATION] = maintenant;

      const modificationReelle =
        JSON.stringify(
          ancienneLigne.map(serialiserValeurIndemnisation_)
        ) !== JSON.stringify(
          nouvelleLigne.map(serialiserValeurIndemnisation_)
        );

      if (modificationReelle) {
        const feuille = table.feuille;
        const plage = feuille.getRange(
          entree.numeroLigne,
          1,
          1,
          feuille.getLastColumn()
        );

        restaurations.push({
          plage: plage,
          valeurs: plage.getValues(),
          formats: plage.getNumberFormats()
        });

        plage.setValues([nouvelleLigne]);

        feuille
          .getRange(
            entree.numeroLigne,
            index.DATE_DEMANDE + 1
          )
          .setNumberFormat('dd/MM/yyyy');

        feuille
          .getRange(
            entree.numeroLigne,
            index.DATE_MODIFICATION + 1
          )
          .setNumberFormat('dd/MM/yyyy HH:mm');

        nombreModifiees++;
      }

      historiques.push({
        ID_HISTORIQUE: Utilities.getUuid(),
        ID_OPERATION: idOperation,
        ID_PRESTATION: idPrestation,
        ANCIEN_STATUT: ancienStatut,
        NOUVEAU_STATUT: statutCible,
        ANCIENNE_DATE_DEMANDE: ancienneDate,
        NOUVELLE_DATE_DEMANDE:
          nouvelleLigne[index.DATE_DEMANDE],
        ANCIENNE_REFERENCE: ancienneReference,
        NOUVELLE_REFERENCE: String(
          nouvelleLigne[index.REFERENCE_DEMANDE] || ''
        ).trim(),
        REMARQUE_ACTION: remarqueAction,
        UTILISATEUR: utilisateur,
        DATE_ACTION: maintenant
      });
    });

    ajoutHistorique = ajouterHistoriqueIndemnisation_(
      feuilleHistorique,
      historiques
    );

    SpreadsheetApp.flush();

    journaliserActionSensible_(
      'INDEMNISATIONS_CHANGEMENT_STATUT',
      'PRESTATIONS_FORMATEURS',
      idsPrestations.join(','),
      {
        nombrePrestations: idsPrestations.length,
        statut: statutCible,
        reference: referenceCommune,
        confirmationIndemnisee: confirmationIndemnisee
      },
      sessionUtilisateur.identifiantHistorique
    );

    return {
      succes: true,
      nombreModifiees: nombreModifiees,
      message: nombreModifiees +
        (nombreModifiees > 1
          ? ' prestations mises à jour.'
          : ' prestation mise à jour.')
    };
  } catch (erreur) {
    if (ajoutHistorique) {
      try {
        ajoutHistorique.clearContent();
      } catch (erreurHistorique) {
        console.error(erreurHistorique);
      }
    }

    restaurations
      .slice()
      .reverse()
      .forEach(function (restauration) {
        try {
          restauration.plage.setValues(
            restauration.valeurs
          );
          restauration.plage.setNumberFormats(
            restauration.formats
          );
        } catch (erreurRestauration) {
          console.error(erreurRestauration);
        }
      });

    try {
      SpreadsheetApp.flush();
    } catch (erreurFlush) {
      console.error(erreurFlush);
    }

    throw erreur;
  }
}


function lireTableIndemnisation_(classeur, nomFeuille) {
  const feuille = classeur.getSheetByName(nomFeuille);

  if (!feuille || feuille.getLastRow() < 1) {
    return {
      feuille: feuille,
      index: {},
      lignes: []
    };
  }

  const donnees = feuille.getDataRange().getValues();

  return {
    feuille: feuille,
    index: creerIndexIndemnisation_(donnees[0]),
    lignes: donnees.slice(1)
  };
}


function verifierColonnesIndemnisation_(
  table,
  nomFeuille,
  colonnes
) {
  if (!table.feuille) {
    throw new Error('La feuille ' + nomFeuille + ' est absente.');
  }

  colonnes.forEach(function (colonne) {
    if (!Number.isInteger(table.index[colonne])) {
      throw new Error(
        'La colonne "' + colonne +
        '" est absente de la feuille ' + nomFeuille + '.'
      );
    }
  });
}


function creerIndexIndemnisation_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserTexteIndemnisation_(entete)] = position;
  });

  return index;
}


function normaliserTexteIndemnisation_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function normaliserStatutIndemnisation_(valeur) {
  const correspondances = {
    A_DEMANDER: 'À demander',
    DEMANDE_ENVOYEE: 'Demande envoyée',
    INDEMNISEE: 'Indemnisée',
    A_CORRIGER: 'À corriger'
  };

  const normalise = normaliserTexteIndemnisation_(valeur);

  if (!normalise) {
    return 'À demander';
  }

  return correspondances[normalise] || String(valeur).trim();
}


function convertirDateInterfaceIndemnisation_(valeur) {
  if (!valeur) {
    return '';
  }

  const date = Object.prototype.toString.call(valeur) ===
    '[object Date]'
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


function convertirHeureInterfaceIndemnisation_(valeur) {
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

  const texte = String(valeur).trim();
  const correspondance = texte.match(/^(\d{1,2}):(\d{2})/);

  return correspondance
    ? correspondance[1].padStart(2, '0') +
      ':' + correspondance[2]
    : texte;
}


function convertirNombreIndemnisation_(valeur) {
  if (typeof valeur === 'number') {
    return isNaN(valeur) ? 0 : valeur;
  }

  const nombre = Number(
    String(valeur || '').trim().replace(',', '.')
  );

  return isNaN(nombre) ? 0 : nombre;
}


function valeursUniquesIndemnisation_(valeurs) {
  return [...new Set(
    (Array.isArray(valeurs) ? valeurs : [])
      .map(function (valeur) {
        return String(valeur || '').trim();
      })
      .filter(Boolean)
  )];
}


function nettoyerOperationIndemnisation_(valeur) {
  const identifiant = String(
    valeur || Utilities.getUuid()
  ).trim();

  if (!/^[A-Za-z0-9_-]{8,120}$/.test(identifiant)) {
    throw new Error(
      'L’identifiant technique de l’action est invalide.'
    );
  }

  return identifiant;
}


function convertirBooleenIndemnisation_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }

  return ['oui', 'true', '1'].includes(
    String(valeur || '').trim().toLowerCase()
  );
}


function obtenirFeuilleHistoriqueIndemnisations_(classeur) {
  return assurerFeuilleMigration_(
    classeur,
    'HISTORIQUE_INDEMNISATIONS'
  );
}


function operationIndemnisationDejaExecutee_(
  feuille,
  idOperation,
  idsPrestations
) {
  if (feuille.getLastRow() < 2) {
    return false;
  }

  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexIndemnisation_(donnees[0]);
  const idsTrouves = [...new Set(
    donnees.slice(1)
      .filter(function (ligne) {
        return String(
          ligne[index.ID_OPERATION] || ''
        ) === idOperation;
      })
      .map(function (ligne) {
        return String(
          ligne[index.ID_PRESTATION] || ''
        );
      })
      .filter(Boolean)
  )].sort();

  if (!idsTrouves.length) {
    return false;
  }

  const idsAttendus = idsPrestations.slice().sort();

  if (
    JSON.stringify(idsTrouves) !==
    JSON.stringify(idsAttendus)
  ) {
    throw new Error(
      'Cet identifiant d’action a déjà été utilisé pour une autre sélection.'
    );
  }

  return true;
}


function ajouterHistoriqueIndemnisation_(feuille, objets) {
  if (!objets.length) {
    return null;
  }

  const entetes = feuille
    .getRange(1, 1, 1, feuille.getLastColumn())
    .getValues()[0];

  const index = creerIndexIndemnisation_(entetes);
  const lignes = objets.map(function (objet) {
    const ligne = new Array(feuille.getLastColumn()).fill('');

    Object.keys(objet).forEach(function (colonne) {
      if (Number.isInteger(index[colonne])) {
        ligne[index[colonne]] = objet[colonne];
      }
    });

    return ligne;
  });

  const premiereLigne = feuille.getLastRow() + 1;
  const derniereLigne = premiereLigne + lignes.length - 1;

  if (derniereLigne > feuille.getMaxRows()) {
    feuille.insertRowsAfter(
      feuille.getMaxRows(),
      derniereLigne - feuille.getMaxRows()
    );
  }

  const plage = feuille.getRange(
    premiereLigne,
    1,
    lignes.length,
    feuille.getLastColumn()
  );

  try {
    plage.setValues(lignes);

    [
      'ANCIENNE_DATE_DEMANDE',
      'NOUVELLE_DATE_DEMANDE'
    ].forEach(function (colonne) {
      feuille
        .getRange(
          premiereLigne,
          index[colonne] + 1,
          lignes.length,
          1
        )
        .setNumberFormat('dd/MM/yyyy');
    });

    feuille
      .getRange(
        premiereLigne,
        index.DATE_ACTION + 1,
        lignes.length,
        1
      )
      .setNumberFormat('dd/MM/yyyy HH:mm');
  } catch (erreur) {
    try {
      plage.clearContent();
    } catch (erreurNettoyage) {
      console.error(erreurNettoyage);
    }

    throw erreur;
  }

  return plage;
}


function ajouterRemarqueIndemnisation_(
  valeurExistante,
  remarque,
  statut,
  date
) {
  const existante = String(valeurExistante || '').trim();
  const dateTexte = Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'dd/MM/yyyy'
  );

  const ajout = '[' + dateTexte + ' · ' + statut + '] ' +
    remarque;

  return [existante, ajout].filter(Boolean).join('\n');
}


function serialiserValeurIndemnisation_(valeur) {
  if (
    Object.prototype.toString.call(valeur) ===
    '[object Date]'
  ) {
    return valeur.getTime();
  }

  return valeur;
}
