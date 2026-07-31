'use strict';

/**
 * Retourne les séances enregistrées avec leurs participants.
 */
function getSessions() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tableSessions = lireFeuilleSession_(
    classeur,
    'SESSIONS'
  );

  const tablePresences = lireFeuilleSession_(
    classeur,
    'PRESENCES_STAGIAIRES'
  );

  const tablePrestations = lireFeuilleSession_(
    classeur,
    'PRESTATIONS_FORMATEURS'
  );

  const tableFormateurs = lireFeuilleSession_(
    classeur,
    'FORMATEURS'
  );

  const formateursParId = {};
  const indexFormateurs = tableFormateurs.index;
  const colonneIdFormateur = trouverIndexSession_(
    indexFormateurs,
    ['ID_FORMATEUR', 'UUID']
  );

  if (colonneIdFormateur !== null) {
    tableFormateurs.lignes.forEach(function (ligne) {
      const id = String(
        ligne[colonneIdFormateur] || ''
      );

      if (!id) {
        return;
      }

      formateursParId[id] = [
        valeurColonneSession_(
          ligne,
          indexFormateurs,
          'PRENOM'
        ),
        valeurColonneSession_(
          ligne,
          indexFormateurs,
          'NOM'
        )
      ]
        .filter(Boolean)
        .join(' ');
    });
  }

  const presencesParSession = {};
  const indexPresences = tablePresences.index;

  if (
    Number.isInteger(indexPresences.ID_SESSION) &&
    Number.isInteger(indexPresences.ID_STAGIAIRE)
  ) {
    tablePresences.lignes.forEach(function (ligne) {
      const idSession = String(
        ligne[indexPresences.ID_SESSION] || ''
      );

      const idStagiaire = String(
        ligne[indexPresences.ID_STAGIAIRE] || ''
      );

      if (!idSession || !idStagiaire) {
        return;
      }

      if (!presencesParSession[idSession]) {
        presencesParSession[idSession] = new Set();
      }

      presencesParSession[idSession].add(idStagiaire);
    });
  }

  const formateursParSession = {};
  const indexPrestations = tablePrestations.index;

  if (
    Number.isInteger(indexPrestations.ID_SESSION) &&
    Number.isInteger(indexPrestations.ID_FORMATEUR)
  ) {
    tablePrestations.lignes.forEach(function (ligne) {
      const idSession = String(
        ligne[indexPrestations.ID_SESSION] || ''
      );

      const idFormateur = String(
        ligne[indexPrestations.ID_FORMATEUR] || ''
      );

      if (!idSession || !idFormateur) {
        return;
      }

      if (!formateursParSession[idSession]) {
        formateursParSession[idSession] = [];
      }

      const nomComplet = formateursParId[idFormateur] ||
        'Formateur non identifié';

      if (
        !formateursParSession[idSession].includes(
          nomComplet
        )
      ) {
        formateursParSession[idSession].push(nomComplet);
      }
    });
  }

  const indexSessions = tableSessions.index;

  if (!Number.isInteger(indexSessions.ID_SESSION)) {
    return [];
  }

  return tableSessions.lignes
    .map(function (ligne) {
      const idSession = String(
        ligne[indexSessions.ID_SESSION] || ''
      );

      if (!idSession) {
        return null;
      }

      const stagiaires = presencesParSession[idSession];

      return {
        idSession: idSession,

        date: convertirDateInterfaceSession_(
          valeurColonneSession_(
            ligne,
            indexSessions,
            'DATE_SESSION'
          )
        ),

        heureDebut: convertirHeureInterfaceSession_(
          valeurColonneSession_(
            ligne,
            indexSessions,
            'HEURE_DEBUT'
          )
        ),

        heureFin: convertirHeureInterfaceSession_(
          valeurColonneSession_(
            ligne,
            indexSessions,
            'HEURE_FIN'
          )
        ),

        dureeHeures: convertirNombreSession_(
          valeurColonneSession_(
            ligne,
            indexSessions,
            'DUREE_HEURES'
          )
        ),

        formation: String(
          valeurColonneSession_(
            ligne,
            indexSessions,
            'FORMATION'
          ) || ''
        ),

        remarques: String(
          valeurColonneSession_(
            ligne,
            indexSessions,
            'REMARQUES'
          ) || ''
        ),

        formateurs: (
          formateursParSession[idSession] || []
        ).sort(function (a, b) {
          return a.localeCompare(
            b,
            'fr',
            { sensitivity: 'base' }
          );
        }),

        nombreStagiaires: stagiaires
          ? stagiaires.size
          : 0
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (
        String(b.date).localeCompare(String(a.date)) ||
        String(b.heureDebut).localeCompare(
          String(a.heureDebut)
        )
      );
    });
}


/**
 * Retourne les participants disponibles pour une nouvelle séance.
 */
function getPreparationSession() {
  const stagiaires = getStagiaires()
    .filter(function (stagiaire) {
      return stagiaire.statut === 'À préparer';
    });

  return {
    stagiaires: stagiaires,
    formateurs: getFormateursActifsSession_(),
    formations: getFormations()
  };
}


/**
 * Retourne le référentiel actif d'une formation.
 */
function getReferentielFormation(formation) {
  const formationDemandee = String(
    formation || ''
  ).trim();

  if (!formationDemandee) {
    return [];
  }

  const categories = getCategoriesReferentiel(
    formationDemandee
  ).filter(function (categorie) {
    return categorie.actif;
  });

  const items = getItemsReferentiel(formationDemandee)
    .filter(function (item) {
      return item.actif && item.categorieActive;
    });

  return categories
    .map(function (categorie) {
      return {
        idCategorie: categorie.idCategorie,
        libelle: categorie.intitule,
        ordre: categorie.ordre,
        items: items
          .filter(function (item) {
            return item.idCategorie ===
              categorie.idCategorie;
          })
          .map(function (item) {
            return {
              idItem: item.idItem,
              libelle: item.intitule,
              description: item.description,
              ordre: item.ordre
            };
          })
      };
    })
    .filter(function (categorie) {
      return categorie.items.length > 0;
    });
}


/**
 * Enregistre une séance et toutes ses données liées.
 */
function enregistrerSession(donnees) {
  const donneesValidees = verifierSession_(donnees);
  const verrou = LockService.getDocumentLock();

  if (!verrou.tryLock(30000)) {
    throw new Error(
      'Une autre séance est en cours d’enregistrement. Réessaie dans quelques instants.'
    );
  }

  const ecritures = [];

  try {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const maintenant = new Date();
    const idSession = Utilities.getUuid();

    ajouterLignesSession_(
      classeur,
      'SESSIONS',
      [{
        ID_SESSION: idSession,
        DATE_SESSION: donneesValidees.date,
        HEURE_DEBUT: donneesValidees.heureDebut,
        HEURE_FIN: donneesValidees.heureFin,
        DUREE_HEURES: donneesValidees.dureeHeures,
        FORMATION: donneesValidees.formation,
        THEME: '',
        REMARQUES: donneesValidees.remarques,
        SAISI_PAR: obtenirUtilisateurSession_(),
        DATE_CREATION: maintenant,
        DATE_MODIFICATION: maintenant
      }],
      [
        'ID_SESSION',
        'DATE_SESSION',
        'HEURE_DEBUT',
        'HEURE_FIN',
        'DUREE_HEURES',
        'FORMATION'
      ],
      ecritures
    );

    const lignesPresences = donneesValidees.stagiaires
      .map(function (idStagiaire) {
        return {
          ID_PRESENCE: Utilities.getUuid(),
          ID_SESSION: idSession,
          ID_STAGIAIRE: idStagiaire,
          DATE_CREATION: maintenant
        };
      });

    ajouterLignesSession_(
      classeur,
      'PRESENCES_STAGIAIRES',
      lignesPresences,
      [
        'ID_PRESENCE',
        'ID_SESSION',
        'ID_STAGIAIRE'
      ],
      ecritures
    );

    const lignesPrestations = donneesValidees.formateurs
      .map(function (idFormateur) {
        return {
          ID_PRESTATION: Utilities.getUuid(),
          ID_SESSION: idSession,
          ID_FORMATEUR: idFormateur,
          DUREE_HEURES: donneesValidees.dureeHeures,
          STATUT_INDEMNISATION: 'À demander',
          DATE_CREATION: maintenant,
          DATE_MODIFICATION: maintenant
        };
      });

    ajouterLignesSession_(
      classeur,
      'PRESTATIONS_FORMATEURS',
      lignesPrestations,
      [
        'ID_PRESTATION',
        'ID_SESSION',
        'ID_FORMATEUR',
        'DUREE_HEURES'
      ],
      ecritures
    );

    const lignesEvaluations = donneesValidees.validations
      .map(function (validation) {
        return {
          ID_EVALUATION: Utilities.getUuid(),
          ID_SESSION: idSession,
          ID_STAGIAIRE: validation.idStagiaire,
          ID_ITEM: validation.idItem,
          NIVEAU: validation.acquis
            ? 'Acquis'
            : validation.vu
              ? 'En cours d’acquisition'
              : 'Non acquis',
          REMARQUE: validation.commentaire,
          DATE_CREATION: maintenant,
          DATE_MODIFICATION: maintenant
        };
      });

    if (lignesEvaluations.length) {
      ajouterLignesSession_(
        classeur,
        'EVALUATIONS',
        lignesEvaluations,
        [
          'ID_EVALUATION',
          'ID_SESSION',
          'ID_STAGIAIRE',
          'ID_ITEM',
          'NIVEAU'
        ],
        ecritures
      );
    }

    appliquerFormatsNouvelleSession_(
      ecritures
    );

    SpreadsheetApp.flush();

    return {
      succes: true,
      idSession: idSession,
      message: 'Séance enregistrée.'
    };
  } catch (erreur) {
    annulerEcrituresSession_(ecritures);
    throw erreur;
  } finally {
    verrou.releaseLock();
  }
}


function verifierSession_(donnees) {
  if (!donnees) {
    throw new Error('Aucune donnée de séance reçue.');
  }

  const formation = String(
    donnees.formation || ''
  ).trim();

  if (!formation) {
    throw new Error('La formation est obligatoire.');
  }

  const date = convertirDateSession_(donnees.date);
  const debut = convertirHeureSession_(
    donnees.heureDebut,
    'L’heure de début'
  );

  const fin = convertirHeureSession_(
    donnees.heureFin,
    'L’heure de fin'
  );

  if (fin.minutes <= debut.minutes) {
    throw new Error(
      'L’heure de fin doit être postérieure à l’heure de début.'
    );
  }

  const formateurs = valeursUniquesSession_(
    donnees.formateurs
  );

  const stagiaires = valeursUniquesSession_(
    donnees.stagiaires
  );

  if (!formateurs.length) {
    throw new Error(
      'Sélectionne au moins un formateur.'
    );
  }

  if (!stagiaires.length) {
    throw new Error(
      'Sélectionne au moins un stagiaire.'
    );
  }

  const stagiairesAutorises = getStagiaires()
    .filter(function (stagiaire) {
      return (
        stagiaire.statut === 'À préparer' &&
        stagiaire.formation === formation
      );
    });

  const idsStagiairesAutorises = new Set(
    stagiairesAutorises.map(function (stagiaire) {
      return String(stagiaire.uuid);
    })
  );

  stagiaires.forEach(function (idStagiaire) {
    if (!idsStagiairesAutorises.has(idStagiaire)) {
      throw new Error(
        'Un stagiaire sélectionné n’est plus disponible pour cette formation.'
      );
    }
  });

  const idsFormateursActifs = new Set(
    getFormateursActifsSession_()
      .map(function (formateur) {
        return String(formateur.idFormateur);
      })
  );

  formateurs.forEach(function (idFormateur) {
    if (!idsFormateursActifs.has(idFormateur)) {
      throw new Error(
        'Un formateur sélectionné est introuvable ou inactif.'
      );
    }
  });

  const idsItemsAutorises = new Set();

  getReferentielFormation(formation)
    .forEach(function (categorie) {
      categorie.items.forEach(function (item) {
        idsItemsAutorises.add(String(item.idItem));
      });
    });

  const idsStagiairesSelectionnes = new Set(stagiaires);
  const validationsParCle = {};

  (Array.isArray(donnees.validations)
    ? donnees.validations
    : []
  ).forEach(function (validation) {
    const idStagiaire = String(
      validation.idStagiaire || ''
    );

    const idItem = String(
      validation.idItem || ''
    );

    if (
      !idsStagiairesSelectionnes.has(idStagiaire) ||
      !idsItemsAutorises.has(idItem)
    ) {
      throw new Error(
        'Une validation reçue ne correspond pas à la séance.'
      );
    }

    const commentaire = String(
      validation.commentaire || ''
    ).trim();

    const acquis = Boolean(validation.acquis);
    const vu = Boolean(validation.vu) || acquis;

    if (!vu && !acquis && !commentaire) {
      return;
    }

    validationsParCle[
      idStagiaire + '::' + idItem
    ] = {
      idStagiaire: idStagiaire,
      idItem: idItem,
      vu: vu,
      acquis: acquis,
      commentaire: commentaire
    };
  });

  return {
    formation: formation,
    date: date,
    heureDebut: debut.date,
    heureFin: fin.date,
    dureeHeures: (
      fin.minutes - debut.minutes
    ) / 60,
    formateurs: formateurs,
    stagiaires: stagiaires,
    remarques: String(
      donnees.remarques || ''
    ).trim(),
    validations: Object.keys(validationsParCle)
      .map(function (cle) {
        return validationsParCle[cle];
      })
  };
}


function getFormateursActifsSession_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const table = lireFeuilleSession_(classeur, 'FORMATEURS');
  const index = table.index;
  const colonneId = trouverIndexSession_(
    index,
    ['ID_FORMATEUR', 'UUID']
  );

  if (
    colonneId === null ||
    !Number.isInteger(index.NOM)
  ) {
    return [];
  }

  return table.lignes
    .filter(function (ligne) {
      return (
        String(ligne[colonneId] || '') &&
        estLigneActiveSession_(ligne, index.ACTIF)
      );
    })
    .map(function (ligne) {
      return {
        idFormateur: String(ligne[colonneId]),
        nom: String(ligne[index.NOM] || '').trim(),
        prenom: Number.isInteger(index.PRENOM)
          ? String(ligne[index.PRENOM] || '').trim()
          : ''
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


function lireFeuilleSession_(classeur, nomFeuille) {
  const feuille = classeur.getSheetByName(nomFeuille);

  if (!feuille || feuille.getLastRow() < 1) {
    return {
      index: {},
      lignes: []
    };
  }

  const donnees = feuille.getDataRange().getValues();

  return {
    index: creerIndexSession_(donnees[0]),
    lignes: donnees.slice(1)
  };
}


function creerIndexSession_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserEnteteSession_(entete)] = position;
  });

  return index;
}


function normaliserEnteteSession_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function trouverIndexSession_(index, noms) {
  for (let i = 0; i < noms.length; i++) {
    if (Number.isInteger(index[noms[i]])) {
      return index[noms[i]];
    }
  }

  return null;
}


function valeurColonneSession_(ligne, index, colonne) {
  return Number.isInteger(index[colonne])
    ? ligne[index[colonne]]
    : '';
}


function estLigneActiveSession_(ligne, indexActif) {
  if (!Number.isInteger(indexActif)) {
    return true;
  }

  const valeur = ligne[indexActif];

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


function convertirDateInterfaceSession_(valeur) {
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


function convertirHeureInterfaceSession_(valeur) {
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
  const correspondance = texte.match(
    /^(\d{1,2}):(\d{2})/
  );

  return correspondance
    ? correspondance[1].padStart(2, '0') +
      ':' + correspondance[2]
    : texte;
}


function convertirNombreSession_(valeur) {
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


function convertirDateSession_(valeur) {
  const elements = String(valeur || '').split('-');

  if (elements.length !== 3) {
    throw new Error('La date de la séance est obligatoire.');
  }

  const annee = Number(elements[0]);
  const mois = Number(elements[1]);
  const jour = Number(elements[2]);
  const date = new Date(annee, mois - 1, jour, 12, 0, 0);

  if (
    isNaN(date.getTime()) ||
    date.getFullYear() !== annee ||
    date.getMonth() !== mois - 1 ||
    date.getDate() !== jour
  ) {
    throw new Error('La date de la séance est invalide.');
  }

  return date;
}


function convertirHeureSession_(valeur, libelle) {
  const correspondance = String(
    valeur || ''
  ).match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!correspondance) {
    throw new Error(libelle + ' est invalide.');
  }

  const heures = Number(correspondance[1]);
  const minutes = Number(correspondance[2]);

  return {
    minutes: heures * 60 + minutes,
    date: new Date(1899, 11, 30, heures, minutes, 0)
  };
}


function valeursUniquesSession_(valeurs) {
  return [...new Set(
    (Array.isArray(valeurs) ? valeurs : [])
      .map(function (valeur) {
        return String(valeur || '').trim();
      })
      .filter(Boolean)
  )];
}


function obtenirUtilisateurSession_() {
  try {
    return Session.getActiveUser().getEmail() ||
      Session.getEffectiveUser().getEmail() ||
      '';
  } catch (erreur) {
    return '';
  }
}


function ajouterLignesSession_(
  classeur,
  nomFeuille,
  objets,
  colonnesObligatoires,
  ecritures
) {
  if (!objets.length) {
    return;
  }

  const feuille = classeur.getSheetByName(nomFeuille);

  if (!feuille || feuille.getLastRow() < 1) {
    throw new Error(
      'La feuille ' + nomFeuille + ' est absente ou non initialisée.'
    );
  }

  const derniereColonne = feuille.getLastColumn();
  const entetes = feuille
    .getRange(1, 1, 1, derniereColonne)
    .getValues()[0];

  const index = creerIndexSession_(entetes);

  colonnesObligatoires.forEach(function (colonne) {
    if (!Number.isInteger(index[colonne])) {
      throw new Error(
        'La colonne "' + colonne +
        '" est absente de la feuille ' + nomFeuille + '.'
      );
    }
  });

  const lignes = objets.map(function (objet) {
    const ligne = new Array(derniereColonne).fill('');

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

  feuille
    .getRange(
      premiereLigne,
      1,
      lignes.length,
      derniereColonne
    )
    .setValues(lignes);

  ecritures.push({
    feuille: feuille,
    premiereLigne: premiereLigne,
    nombreLignes: lignes.length,
    nombreColonnes: derniereColonne,
    index: index,
    nomFeuille: nomFeuille
  });
}


function appliquerFormatsNouvelleSession_(ecritures) {
  ecritures.forEach(function (ecriture) {
    const formats = {
      SESSIONS: {
        DATE_SESSION: 'dd/MM/yyyy',
        HEURE_DEBUT: 'HH:mm',
        HEURE_FIN: 'HH:mm',
        DUREE_HEURES: '0.00',
        DATE_CREATION: 'dd/MM/yyyy HH:mm',
        DATE_MODIFICATION: 'dd/MM/yyyy HH:mm'
      },
      PRESENCES_STAGIAIRES: {
        DATE_CREATION: 'dd/MM/yyyy HH:mm'
      },
      PRESTATIONS_FORMATEURS: {
        DUREE_HEURES: '0.00',
        DATE_CREATION: 'dd/MM/yyyy HH:mm',
        DATE_MODIFICATION: 'dd/MM/yyyy HH:mm'
      },
      EVALUATIONS: {
        DATE_CREATION: 'dd/MM/yyyy HH:mm',
        DATE_MODIFICATION: 'dd/MM/yyyy HH:mm'
      }
    };

    const formatsFeuille = formats[ecriture.nomFeuille] || {};

    Object.keys(formatsFeuille).forEach(function (colonne) {
      if (!Number.isInteger(ecriture.index[colonne])) {
        return;
      }

      ecriture.feuille
        .getRange(
          ecriture.premiereLigne,
          ecriture.index[colonne] + 1,
          ecriture.nombreLignes,
          1
        )
        .setNumberFormat(formatsFeuille[colonne]);
    });
  });
}


function annulerEcrituresSession_(ecritures) {
  ecritures
    .slice()
    .reverse()
    .forEach(function (ecriture) {
      try {
        ecriture.feuille
          .getRange(
            ecriture.premiereLigne,
            1,
            ecriture.nombreLignes,
            ecriture.nombreColonnes
          )
          .clearContent();
      } catch (erreurAnnulation) {
        console.error(erreurAnnulation);
      }
    });
}
