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
 * Retourne toutes les données nécessaires à la consultation,
 * à la modification ou à la duplication d'une séance.
 */
function getSessionDetaillee(idSession) {
  const identifiant = String(idSession || '').trim();

  if (!identifiant) {
    throw new Error('Identifiant de séance manquant.');
  }

  return construireSessionDetaillee_(
    SpreadsheetApp.getActiveSpreadsheet(),
    identifiant
  );
}


function construireSessionDetaillee_(classeur, idSession) {
  const tableSessions = lireFeuilleSession_(
    classeur,
    'SESSIONS'
  );

  const indexSessions = tableSessions.index;

  if (!Number.isInteger(indexSessions.ID_SESSION)) {
    throw new Error(
      'La colonne ID_SESSION est absente de la feuille SESSIONS.'
    );
  }

  const lignesSession = tableSessions.lignes.filter(
    function (ligne) {
      return String(
        ligne[indexSessions.ID_SESSION] || ''
      ) === idSession;
    }
  );

  if (!lignesSession.length) {
    throw new Error('Séance introuvable.');
  }

  if (lignesSession.length > 1) {
    throw new Error(
      'Plusieurs séances utilisent le même ID_SESSION. Corrige la feuille SESSIONS avant de continuer.'
    );
  }

  const ligneSession = lignesSession[0];
  const formation = String(
    valeurColonneSession_(
      ligneSession,
      indexSessions,
      'FORMATION'
    ) || ''
  ).trim();

  const stagiairesParId = {};

  getStagiaires().forEach(function (stagiaire) {
    stagiairesParId[String(stagiaire.uuid)] = stagiaire;
  });

  const formateursParId = {};

  getFormateurs().forEach(function (formateur) {
    formateursParId[
      String(formateur.idFormateur)
    ] = formateur;
  });

  const tablePresences = lireFeuilleSession_(
    classeur,
    'PRESENCES_STAGIAIRES'
  );

  const idsStagiaires = new Set();
  const indexPresences = tablePresences.index;

  if (
    Number.isInteger(indexPresences.ID_SESSION) &&
    Number.isInteger(indexPresences.ID_STAGIAIRE)
  ) {
    tablePresences.lignes.forEach(function (ligne) {
      if (
        String(ligne[indexPresences.ID_SESSION] || '') ===
        idSession
      ) {
        const idStagiaire = String(
          ligne[indexPresences.ID_STAGIAIRE] || ''
        );

        if (idStagiaire) {
          idsStagiaires.add(idStagiaire);
        }
      }
    });
  }

  const tablePrestations = lireFeuilleSession_(
    classeur,
    'PRESTATIONS_FORMATEURS'
  );

  const idsFormateurs = new Set();
  const indexPrestations = tablePrestations.index;

  if (
    Number.isInteger(indexPrestations.ID_SESSION) &&
    Number.isInteger(indexPrestations.ID_FORMATEUR)
  ) {
    tablePrestations.lignes.forEach(function (ligne) {
      if (
        String(ligne[indexPrestations.ID_SESSION] || '') ===
        idSession
      ) {
        const idFormateur = String(
          ligne[indexPrestations.ID_FORMATEUR] || ''
        );

        if (idFormateur) {
          idsFormateurs.add(idFormateur);
        }
      }
    });
  }

  const tableItemsSessions = lireFeuilleSession_(
    classeur,
    'ITEMS_SESSIONS'
  );

  const idsItems = new Set();
  const sourcesItems = {};
  const indexItemsSessions = tableItemsSessions.index;

  function ajouterItemSession(idItem, source) {
    const identifiantItem = String(idItem || '').trim();

    if (!identifiantItem) {
      return;
    }

    idsItems.add(identifiantItem);

    if (!sourcesItems[identifiantItem]) {
      sourcesItems[identifiantItem] = new Set();
    }

    sourcesItems[identifiantItem].add(source);
  }

  if (
    Number.isInteger(indexItemsSessions.ID_SESSION) &&
    Number.isInteger(indexItemsSessions.ID_ITEM)
  ) {
    tableItemsSessions.lignes.forEach(function (ligne) {
      if (
        String(
          ligne[indexItemsSessions.ID_SESSION] || ''
        ) === idSession
      ) {
        ajouterItemSession(
          ligne[indexItemsSessions.ID_ITEM],
          'ITEMS_SESSIONS'
        );
      }
    });
  }

  const tableEvaluations = lireFeuilleSession_(
    classeur,
    'EVALUATIONS'
  );

  const indexEvaluations = tableEvaluations.index;
  const validationsParCle = {};

  if (
    Number.isInteger(indexEvaluations.ID_SESSION) &&
    Number.isInteger(indexEvaluations.ID_STAGIAIRE) &&
    Number.isInteger(indexEvaluations.ID_ITEM)
  ) {
    tableEvaluations.lignes.forEach(
      function (ligne, position) {
        if (
          String(
            ligne[indexEvaluations.ID_SESSION] || ''
          ) !== idSession
        ) {
          return;
        }

        const idStagiaire = String(
          ligne[indexEvaluations.ID_STAGIAIRE] || ''
        );

        const idItem = String(
          ligne[indexEvaluations.ID_ITEM] || ''
        );

        if (!idStagiaire || !idItem) {
          return;
        }

        const acquis = evaluationAcquiseSession_(
          ligne,
          indexEvaluations
        );

        const vuHistorique = Number.isInteger(
          indexEvaluations.VU
        ) && estValeurPositiveSession_(
          ligne[indexEvaluations.VU]
        );

        const commentaire = String(
          valeurColonneSession_(
            ligne,
            indexEvaluations,
            'REMARQUE'
          ) || ''
        ).trim();

        const cle = idStagiaire + '::' + idItem;

        if (!validationsParCle[cle]) {
          validationsParCle[cle] = {
            idStagiaire: idStagiaire,
            idItem: idItem,
            acquis: false,
            commentaire: '',
            vuHistorique: false,
            ordreCommentaire: -1
          };
        }

        const validation = validationsParCle[cle];
        validation.acquis = validation.acquis || acquis;
        validation.vuHistorique =
          validation.vuHistorique || vuHistorique;

        if (commentaire && position >= validation.ordreCommentaire) {
          validation.commentaire = commentaire;
          validation.ordreCommentaire = position;
        }

        if (
          evaluationIndiqueTravailSession_(
            ligne,
            indexEvaluations
          )
        ) {
          ajouterItemSession(idItem, 'EVALUATIONS');
        }
      }
    );
  }

  const categoriesReferentiel = formation
    ? getCategoriesReferentiel(formation)
    : [];

  const itemsReferentiel = formation
    ? getItemsReferentiel(formation)
    : [];

  const categoriesParId = {};
  const itemsParId = {};

  categoriesReferentiel.forEach(function (categorie) {
    categoriesParId[categorie.idCategorie] = categorie;
  });

  itemsReferentiel.forEach(function (item) {
    itemsParId[item.idItem] = item;
  });

  const groupesParId = {};

  [...idsItems].forEach(function (idItem) {
    const item = itemsParId[idItem];
    const idCategorie = item && item.idCategorie
      ? item.idCategorie
      : '__HISTORIQUE__';

    const categorie = categoriesParId[idCategorie];

    if (!groupesParId[idCategorie]) {
      groupesParId[idCategorie] = {
        idCategorie: idCategorie,
        libelle: categorie
          ? categorie.intitule
          : 'Items historiques',
        ordre: categorie ? categorie.ordre : 999999,
        actif: Boolean(categorie && categorie.actif),
        items: []
      };
    }

    groupesParId[idCategorie].items.push({
      idItem: idItem,
      libelle: item ? item.intitule : idItem,
      description: item ? item.description : '',
      ordre: item ? item.ordre : 999999,
      actif: Boolean(item && item.actif),
      sources: sourcesItems[idItem]
        ? [...sourcesItems[idItem]]
        : []
    });
  });

  const categories = Object.keys(groupesParId)
    .map(function (idCategorie) {
      const categorie = groupesParId[idCategorie];

      categorie.items.sort(function (a, b) {
        return (
          a.ordre - b.ordre ||
          a.libelle.localeCompare(
            b.libelle,
            'fr',
            { sensitivity: 'base' }
          )
        );
      });

      return categorie;
    })
    .sort(function (a, b) {
      return (
        a.ordre - b.ordre ||
        a.libelle.localeCompare(
          b.libelle,
          'fr',
          { sensitivity: 'base' }
        )
      );
    });

  const stagiaires = [...idsStagiaires]
    .map(function (idStagiaire) {
      const stagiaire = stagiairesParId[idStagiaire];

      return {
        idStagiaire: idStagiaire,
        uuid: idStagiaire,
        nom: stagiaire ? stagiaire.nom : 'Stagiaire',
        prenom: stagiaire ? stagiaire.prenom : 'non identifié',
        formation: stagiaire ? stagiaire.formation : formation,
        statut: stagiaire ? stagiaire.statut : 'Historique'
      };
    })
    .sort(trierIdentitesSession_);

  const formateurs = [...idsFormateurs]
    .map(function (idFormateur) {
      const formateur = formateursParId[idFormateur];

      return {
        idFormateur: idFormateur,
        nom: formateur ? formateur.nom : 'Formateur',
        prenom: formateur ? formateur.prenom : 'non identifié',
        actif: Boolean(formateur && formateur.actif)
      };
    })
    .sort(trierIdentitesSession_);

  const validations = [];

  stagiaires.forEach(function (stagiaire) {
    categories.forEach(function (categorie) {
      categorie.items.forEach(function (item) {
        const cle = stagiaire.idStagiaire +
          '::' + item.idItem;

        const evaluation = validationsParCle[cle];

        validations.push({
          idStagiaire: stagiaire.idStagiaire,
          idItem: item.idItem,
          acquis: Boolean(evaluation && evaluation.acquis),
          commentaire: evaluation
            ? evaluation.commentaire
            : '',
          vuHistorique: Boolean(
            evaluation && evaluation.vuHistorique
          )
        });
      });
    });
  });

  return {
    idSession: idSession,
    date: convertirDateInterfaceSession_(
      valeurColonneSession_(
        ligneSession,
        indexSessions,
        'DATE_SESSION'
      )
    ),
    heureDebut: convertirHeureInterfaceSession_(
      valeurColonneSession_(
        ligneSession,
        indexSessions,
        'HEURE_DEBUT'
      )
    ),
    heureFin: convertirHeureInterfaceSession_(
      valeurColonneSession_(
        ligneSession,
        indexSessions,
        'HEURE_FIN'
      )
    ),
    dureeHeures: convertirNombreSession_(
      valeurColonneSession_(
        ligneSession,
        indexSessions,
        'DUREE_HEURES'
      )
    ),
    formation: formation,
    theme: String(
      valeurColonneSession_(
        ligneSession,
        indexSessions,
        'THEME'
      ) || ''
    ),
    remarques: String(
      valeurColonneSession_(
        ligneSession,
        indexSessions,
        'REMARQUES'
      ) || ''
    ),
    formateurs: formateurs,
    stagiaires: stagiaires,
    categories: categories,
    itemsTravailles: categories.reduce(
      function (items, categorie) {
        return items.concat(
          categorie.items.map(function (item) {
            return item.idItem;
          })
        );
      },
      []
    ),
    validations: validations
  };
}


function trierIdentitesSession_(a, b) {
  return (
    String(a.nom || '').localeCompare(
      String(b.nom || ''),
      'fr',
      { sensitivity: 'base' }
    ) ||
    String(a.prenom || '').localeCompare(
      String(b.prenom || ''),
      'fr',
      { sensitivity: 'base' }
    )
  );
}


function evaluationIndiqueTravailSession_(ligne, index) {
  if (evaluationAcquiseSession_(ligne, index)) {
    return true;
  }

  if (Number.isInteger(index.VU)) {
    const valeurVu = ligne[index.VU];

    if (
      valeurVu !== '' &&
      valeurVu !== null &&
      valeurVu !== undefined
    ) {
      return estValeurPositiveSession_(valeurVu);
    }
  }

  if (Number.isInteger(index.NIVEAU)) {
    return Boolean(
      String(ligne[index.NIVEAU] || '').trim()
    );
  }

  return Number.isInteger(index.REMARQUE) && Boolean(
    String(ligne[index.REMARQUE] || '').trim()
  );
}


function evaluationAcquiseSession_(ligne, index) {
  if (
    Number.isInteger(index.ACQUIS) &&
    estValeurPositiveSession_(ligne[index.ACQUIS])
  ) {
    return true;
  }

  return Number.isInteger(index.NIVEAU) &&
    normaliserEnteteSession_(ligne[index.NIVEAU]) ===
      'ACQUIS';
}


function estValeurPositiveSession_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }

  return [
    'oui',
    'true',
    '1',
    'vu',
    'acquis'
  ].includes(
    String(valeur || '').trim().toLowerCase()
  );
}


/**
 * Retourne les participants disponibles pour une nouvelle séance.
 */
function getPreparationSession() {
  return {
    stagiaires: getStagiaires(),
    formateurs: getFormateursActifsSession_(),
    formations: getFormations()
  };
}


/**
 * Retourne le référentiel actif d'une formation.
 */
function getReferentielFormation(formation) {
  return getReferentielSession(formation, '');
}


/**
 * Retourne le référentiel actif et, pour une édition ou une
 * duplication, les éléments inactifs déjà utilisés.
 */
function getReferentielSession(
  formation,
  idSessionHistorique
) {
  const formationDemandee = String(
    formation || ''
  ).trim();

  if (!formationDemandee) {
    return [];
  }

  const idHistorique = String(
    idSessionHistorique || ''
  ).trim();

  const idsItemsHistoriques = new Set();
  const classeur = SpreadsheetApp.getActiveSpreadsheet();

  if (idHistorique) {
    const formationHistorique =
      obtenirFormationSessionHistorique_(
        classeur,
        idHistorique
      );

    if (formationHistorique !== formationDemandee) {
      throw new Error(
        'La séance historique ne correspond pas à la formation sélectionnée.'
      );
    }

    obtenirIdsItemsSessionHistorique_(
      classeur,
      idHistorique
    ).forEach(function (idItem) {
      idsItemsHistoriques.add(idItem);
    });
  }

  const categories = getCategoriesReferentiel(
    formationDemandee
  );

  const items = getItemsReferentiel(formationDemandee)
    .filter(function (item) {
      return (
        item.actif && item.categorieActive
      ) || idsItemsHistoriques.has(item.idItem);
    });

  items.forEach(function (item) {
    if (categories.some(function (categorie) {
      return categorie.idCategorie === item.idCategorie;
    })) {
      return;
    }

    categories.push({
      idCategorie: item.idCategorie,
      intitule: item.categorie || 'Catégorie historique',
      ordre: item.ordreCategorie || 999999,
      actif: false
    });
  });

  const idsItemsConnus = new Set(
    items.map(function (item) {
      return item.idItem;
    })
  );

  const idsItemsSansDefinition = [...idsItemsHistoriques]
    .filter(function (idItem) {
      return !idsItemsConnus.has(idItem);
    });

  if (idsItemsSansDefinition.length) {
    categories.push({
      idCategorie: '__HISTORIQUE__',
      intitule: 'Items historiques',
      ordre: 999999,
      actif: false
    });

    idsItemsSansDefinition.forEach(function (idItem, position) {
      items.push({
        idItem: idItem,
        idCategorie: '__HISTORIQUE__',
        intitule: idItem,
        description: '',
        ordre: position + 1,
        actif: false,
        categorieActive: false
      });
    });
  }

  categories.sort(function (a, b) {
    return (
      a.ordre - b.ordre ||
      a.intitule.localeCompare(
        b.intitule,
        'fr',
        { sensitivity: 'base' }
      )
    );
  });

  return categories
    .filter(function (categorie) {
      return categorie.actif || items.some(
        function (item) {
          return item.idCategorie ===
            categorie.idCategorie;
        }
      );
    })
    .map(function (categorie) {
      return {
        idCategorie: categorie.idCategorie,
        libelle: categorie.intitule,
        ordre: categorie.ordre,
        actif: categorie.actif,
        items: items
          .filter(function (item) {
            return item.idCategorie ===
              categorie.idCategorie;
          })
          .sort(function (a, b) {
            return (
              a.ordre - b.ordre ||
              a.intitule.localeCompare(
                b.intitule,
                'fr',
                { sensitivity: 'base' }
              )
            );
          })
          .map(function (item) {
            return {
              idItem: item.idItem,
              libelle: item.intitule,
              description: item.description,
              ordre: item.ordre,
              actif: item.actif,
              historique: idsItemsHistoriques.has(
                item.idItem
              )
            };
          })
      };
    })
    .filter(function (categorie) {
      return categorie.items.length > 0;
    });
}


function obtenirFormationSessionHistorique_(
  classeur,
  idSession
) {
  const table = lireFeuilleSession_(classeur, 'SESSIONS');
  const index = table.index;

  if (
    !Number.isInteger(index.ID_SESSION) ||
    !Number.isInteger(index.FORMATION)
  ) {
    throw new Error(
      'La structure de la feuille SESSIONS est incomplète.'
    );
  }

  const lignes = table.lignes.filter(function (ligne) {
    return String(ligne[index.ID_SESSION] || '') === idSession;
  });

  if (lignes.length !== 1) {
    throw new Error(
      lignes.length
        ? 'Plusieurs séances utilisent le même ID_SESSION.'
        : 'Séance historique introuvable.'
    );
  }

  return String(lignes[0][index.FORMATION] || '').trim();
}


function obtenirIdsItemsSessionHistorique_(
  classeur,
  idSession
) {
  const idsItems = new Set();
  const tableItems = lireFeuilleSession_(
    classeur,
    'ITEMS_SESSIONS'
  );

  const indexItems = tableItems.index;

  if (
    Number.isInteger(indexItems.ID_SESSION) &&
    Number.isInteger(indexItems.ID_ITEM)
  ) {
    tableItems.lignes.forEach(function (ligne) {
      if (
        String(ligne[indexItems.ID_SESSION] || '') ===
        idSession
      ) {
        const idItem = String(
          ligne[indexItems.ID_ITEM] || ''
        );

        if (idItem) {
          idsItems.add(idItem);
        }
      }
    });
  }

  const tableEvaluations = lireFeuilleSession_(
    classeur,
    'EVALUATIONS'
  );

  const indexEvaluations = tableEvaluations.index;

  if (
    Number.isInteger(indexEvaluations.ID_SESSION) &&
    Number.isInteger(indexEvaluations.ID_ITEM)
  ) {
    tableEvaluations.lignes.forEach(function (ligne) {
      if (
        String(
          ligne[indexEvaluations.ID_SESSION] || ''
        ) !== idSession ||
        !evaluationIndiqueTravailSession_(
          ligne,
          indexEvaluations
        )
      ) {
        return;
      }

      const idItem = String(
        ligne[indexEvaluations.ID_ITEM] || ''
      );

      if (idItem) {
        idsItems.add(idItem);
      }
    });
  }

  return idsItems;
}


/**
 * Enregistre une séance et toutes ses données liées.
 */
function enregistrerSession(donnees) {
  if (!donnees) {
    throw new Error('Aucune donnée de séance reçue.');
  }

  const sessionUtilisateur = obtenirSessionUtilisateur_();

  return executerMutationMetier_(function () {
    return enregistrerSessionInterne_(donnees, sessionUtilisateur);
  });
}


function enregistrerSessionInterne_(donnees, sessionUtilisateur) {

  let transaction = null;

  try {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    preparerStructureEcritureSession_(classeur);

    const maintenant = new Date();
    const idSessionEdition = String(
      donnees.idSession || ''
    ).trim();

    const idSessionSource = String(
      idSessionEdition || donnees.idSessionSource || ''
    ).trim();

    const idOperation = nettoyerIdOperationSession_(
      donnees.idOperation
    );

    if (!idSessionEdition) {
      const sessionRejouee = trouverSessionParOperation_(
        classeur,
        idOperation
      );

      if (sessionRejouee) {
        return {
          succes: true,
          idSession: sessionRejouee,
          rejouee: true,
          message: 'Séance déjà enregistrée.'
        };
      }
    }

    const detailSource = idSessionSource
      ? construireSessionDetaillee_(
        classeur,
        idSessionSource
      )
      : null;

    const donneesValidees = verifierSession_(
      donnees,
      detailSource
    );

    const idSession = idSessionEdition ||
      Utilities.getUuid();

    transaction = {
      ajouts: [],
      modifications: [],
      formats: []
    };

    const objetSession = {
      ID_SESSION: idSession,
      DATE_SESSION: donneesValidees.date,
      HEURE_DEBUT: donneesValidees.heureDebut,
      HEURE_FIN: donneesValidees.heureFin,
      DUREE_HEURES: donneesValidees.dureeHeures,
      FORMATION: donneesValidees.formation,
      REMARQUES: donneesValidees.remarques,
      DATE_MODIFICATION: maintenant,
      ID_REQUETE: idOperation
    };

    if (idSessionEdition) {
      mettreAJourSessionExistante_(
        classeur,
        idSession,
        objetSession,
        transaction
      );
    } else {
      objetSession.THEME = '';
      objetSession.SAISI_PAR = obtenirUtilisateurSession_();
      objetSession.DATE_CREATION = maintenant;

      ajouterLignesSession_(
        classeur,
        'SESSIONS',
        [objetSession],
        [
          'ID_SESSION',
          'DATE_SESSION',
          'HEURE_DEBUT',
          'HEURE_FIN',
          'DUREE_HEURES',
          'FORMATION',
          'ID_REQUETE'
        ],
        transaction.ajouts
      );
    }

    const lignesPresences = donneesValidees.stagiaires
      .map(function (idStagiaire) {
        return {
          ID_PRESENCE: Utilities.getUuid(),
          ID_SESSION: idSession,
          ID_STAGIAIRE: idStagiaire,
          DATE_CREATION: maintenant
        };
      });

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

    const lignesItemsSession =
      donneesValidees.itemsTravailles.map(
        function (idItem) {
          return {
            ID_SESSION_ITEM: Utilities.getUuid(),
            ID_SESSION: idSession,
            ID_ITEM: idItem,
            DATE_CREATION: maintenant
          };
        }
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
            : 'Non acquis',
          REMARQUE: validation.commentaire,
          VU: validation.vuHistorique ? 'Oui' : '',
          DATE_CREATION: maintenant,
          DATE_MODIFICATION: maintenant
        };
      });

    const liaisons = [
      {
        feuille: 'PRESENCES_STAGIAIRES',
        objets: lignesPresences,
        colonnes: [
          'ID_PRESENCE',
          'ID_SESSION',
          'ID_STAGIAIRE'
        ],
        cle: ['ID_STAGIAIRE'],
        identifiant: 'ID_PRESENCE'
      },
      {
        feuille: 'PRESTATIONS_FORMATEURS',
        objets: lignesPrestations,
        colonnes: [
          'ID_PRESTATION',
          'ID_SESSION',
          'ID_FORMATEUR',
          'DUREE_HEURES'
        ],
        cle: ['ID_FORMATEUR'],
        identifiant: 'ID_PRESTATION'
      },
      {
        feuille: 'ITEMS_SESSIONS',
        objets: lignesItemsSession,
        colonnes: [
          'ID_SESSION_ITEM',
          'ID_SESSION',
          'ID_ITEM'
        ],
        cle: ['ID_ITEM'],
        identifiant: 'ID_SESSION_ITEM'
      },
      {
        feuille: 'EVALUATIONS',
        objets: lignesEvaluations,
        colonnes: [
          'ID_EVALUATION',
          'ID_SESSION',
          'ID_STAGIAIRE',
          'ID_ITEM',
          'NIVEAU'
        ],
        cle: ['ID_STAGIAIRE', 'ID_ITEM'],
        identifiant: 'ID_EVALUATION'
      }
    ];

    if (idSessionEdition) {
      liaisons.forEach(function (liaison) {
        remplacerLignesLieesSession_(
          classeur,
          liaison.feuille,
          idSession,
          liaison.objets,
          liaison.colonnes,
          liaison.cle,
          liaison.identifiant,
          maintenant,
          transaction
        );
      });
    } else {
      liaisons.forEach(function (liaison) {
        if (!liaison.objets.length) {
          return;
        }

        ajouterLignesSession_(
          classeur,
          liaison.feuille,
          liaison.objets,
          liaison.colonnes,
          transaction.ajouts
        );
      });
    }

    appliquerFormatsNouvelleSession_(
      transaction.ajouts.concat(transaction.formats)
    );

    SpreadsheetApp.flush();

    synchroniserStatutsStagiaires_();

    journaliserActionSensible_(
      idSessionEdition
        ? 'SESSION_MODIFICATION'
        : idSessionSource
          ? 'SESSION_DUPLICATION'
          : 'SESSION_CREATION',
      'SESSION',
      idSession,
      {
        sessionSource: idSessionSource || '',
        date: donnees.date,
        formation: donneesValidees.formation,
        nombreFormateurs: donneesValidees.formateurs.length,
        nombreStagiaires: donneesValidees.stagiaires.length,
        nombreItems: donneesValidees.itemsTravailles.length
      },
      sessionUtilisateur.email || 'FORMATEUR_PUBLIC'
    );

    return {
      succes: true,
      idSession: idSession,
      message: idSessionEdition
        ? 'Séance modifiée.'
        : idSessionSource
          ? 'Séance dupliquée.'
          : 'Séance enregistrée.'
    };
  } catch (erreur) {
    if (transaction) {
      annulerTransactionSession_(transaction);
    }

    throw erreur;
  }
}


function verifierSession_(donnees, detailSource) {
  if (!donnees) {
    throw new Error('Aucune donnée de séance reçue.');
  }

  const formation = String(
    donnees.formation || ''
  ).trim();

  if (!formation) {
    throw new Error('La formation est obligatoire.');
  }

  if (
    detailSource &&
    detailSource.formation !== formation
  ) {
    throw new Error(
      'La formation d’une séance modifiée ou dupliquée ne peut pas être remplacée.'
    );
  }

  if (
    !detailSource &&
    !getFormations().includes(formation)
  ) {
    throw new Error(
      'La formation sélectionnée est introuvable ou inactive.'
    );
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

  const idsStagiairesHistoriques = new Set(
    detailSource
      ? detailSource.stagiaires.map(function (stagiaire) {
        return String(stagiaire.idStagiaire);
      })
      : []
  );

  const confirmationsStagiairesFermes = new Set(
    valeursUniquesSession_(
      donnees.confirmationsStagiairesFermes
    )
  );

  const modificationExistante = Boolean(
    String(donnees.idSession || '').trim()
  );

  const stagiairesAutorises = getStagiaires()
    .filter(function (stagiaire) {
      return (
        stagiaire.formation === formation
      );
    });

  const idsStagiairesAutorises = new Set(
    stagiairesAutorises.map(function (stagiaire) {
      return String(stagiaire.uuid);
    })
  );

  idsStagiairesHistoriques.forEach(function (idStagiaire) {
    idsStagiairesAutorises.add(idStagiaire);
  });

  stagiaires.forEach(function (idStagiaire) {
    if (!idsStagiairesAutorises.has(idStagiaire)) {
      throw new Error(
        'Un stagiaire sélectionné n’est plus disponible pour cette formation.'
      );
    }

    const stagiaire = stagiairesAutorises.find(
      function (element) {
        return String(element.uuid) === idStagiaire;
      }
    );

    const statutFerme = stagiaire && [
      'Clôturé',
      'Abandon'
    ].includes(stagiaire.statut);

    const participantHistoriqueModifie =
      modificationExistante &&
      idsStagiairesHistoriques.has(idStagiaire);

    if (
      statutFerme &&
      !participantHistoriqueModifie &&
      !confirmationsStagiairesFermes.has(idStagiaire)
    ) {
      throw new Error(
        'Le stagiaire ' +
        [stagiaire.prenom, stagiaire.nom]
          .filter(Boolean)
          .join(' ') +
        ' est au statut « ' + stagiaire.statut +
        ' ». Une confirmation explicite est obligatoire.'
      );
    }
  });

  const idsFormateursHistoriques = new Set(
    detailSource
      ? detailSource.formateurs.map(function (formateur) {
        return String(formateur.idFormateur);
      })
      : []
  );

  const idsFormateursActifs = new Set(
    getFormateursActifsSession_()
      .map(function (formateur) {
        return String(formateur.idFormateur);
      })
  );

  formateurs.forEach(function (idFormateur) {
    if (
      !idsFormateursActifs.has(idFormateur) &&
      !idsFormateursHistoriques.has(idFormateur)
    ) {
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

  if (detailSource) {
    detailSource.itemsTravailles.forEach(
      function (idItem) {
        idsItemsAutorises.add(String(idItem));
      }
    );
  }

  const validationsRecues = Array.isArray(
    donnees.validations
  )
    ? donnees.validations
    : [];

  /*
   * Le repli sur les anciennes validations permet à une
   * interface encore en cache, qui enverrait VU sans la
   * nouvelle liste commune, de continuer à enregistrer la
   * séance sans perdre les items concernés.
   */
  const itemsTravailles = valeursUniquesSession_(
    Array.isArray(donnees.itemsTravailles)
      ? donnees.itemsTravailles
      : validationsRecues
        .filter(function (validation) {
          return (
            Boolean(validation.vu) ||
            Boolean(validation.acquis) ||
            String(
              validation.commentaire || ''
            ).trim()
          );
        })
        .map(function (validation) {
          return validation.idItem;
        })
  );

  itemsTravailles.forEach(function (idItem) {
    if (!idsItemsAutorises.has(idItem)) {
      throw new Error(
        'Un item travaillé est introuvable ou inactif.'
      );
    }
  });

  const idsStagiairesSelectionnes = new Set(stagiaires);
  const idsItemsTravailles = new Set(itemsTravailles);
  const validationsParCle = {};

  const validationsSourceParCle = {};

  if (detailSource) {
    detailSource.validations.forEach(function (validation) {
      validationsSourceParCle[
        validation.idStagiaire + '::' + validation.idItem
      ] = validation;
    });
  }

  validationsRecues.forEach(function (validation) {
    const idStagiaire = String(
      validation.idStagiaire || ''
    );

    const idItem = String(
      validation.idItem || ''
    );

    if (
      !idsStagiairesSelectionnes.has(idStagiaire) ||
      !idsItemsTravailles.has(idItem)
    ) {
      throw new Error(
        'Une validation reçue ne correspond pas à la séance.'
      );
    }

    const commentaire = String(
      validation.commentaire || ''
    ).trim();

    const acquis = convertirBooleenSession_(
      validation.acquis
    );

    const validationSource = validationsSourceParCle[
      idStagiaire + '::' + idItem
    ];

    validationsParCle[
      idStagiaire + '::' + idItem
    ] = {
      idStagiaire: idStagiaire,
      idItem: idItem,
      acquis: acquis,
      commentaire: commentaire,
      vuHistorique: convertirBooleenSession_(
        validation.vuHistorique
      ) || Boolean(
        validationSource &&
        validationSource.vuHistorique
      )
    };
  });

  const validations = [];

  stagiaires.forEach(function (idStagiaire) {
    itemsTravailles.forEach(function (idItem) {
      const cle = idStagiaire + '::' + idItem;
      const validation = validationsParCle[cle];
      const validationSource = validationsSourceParCle[cle];

      validations.push({
        idStagiaire: idStagiaire,
        idItem: idItem,
        acquis: Boolean(
          validation
            ? validation.acquis
            : validationSource &&
              validationSource.acquis
        ),
        commentaire: validation
          ? validation.commentaire
          : validationSource
            ? validationSource.commentaire
            : '',
        vuHistorique: Boolean(
          validation
            ? validation.vuHistorique
            : validationSource &&
              validationSource.vuHistorique
        )
      });
    });
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
    itemsTravailles: itemsTravailles,
    remarques: String(
      donnees.remarques || ''
    ).trim(),
    validations: validations
  };
}


function convertirBooleenSession_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }

  return [
    'oui',
    'true',
    '1',
    'acquis',
    'vu'
  ].includes(
    String(valeur || '').trim().toLowerCase()
  );
}


function preparerStructureEcritureSession_(classeur) {
  [
    'SESSIONS',
    'PRESENCES_STAGIAIRES',
    'PRESTATIONS_FORMATEURS',
    'ITEMS_SESSIONS',
    'EVALUATIONS'
  ].forEach(function (nomFeuille) {
    assurerFeuilleMigration_(classeur, nomFeuille);
  });

  const structures = {
    SESSIONS: [
      'ID_SESSION',
      'DATE_SESSION',
      'HEURE_DEBUT',
      'HEURE_FIN',
      'DUREE_HEURES',
      'FORMATION',
      'ID_REQUETE'
    ],
    PRESENCES_STAGIAIRES: [
      'ID_PRESENCE',
      'ID_SESSION',
      'ID_STAGIAIRE'
    ],
    PRESTATIONS_FORMATEURS: [
      'ID_PRESTATION',
      'ID_SESSION',
      'ID_FORMATEUR',
      'DUREE_HEURES'
    ],
    ITEMS_SESSIONS: [
      'ID_SESSION_ITEM',
      'ID_SESSION',
      'ID_ITEM'
    ],
    EVALUATIONS: [
      'ID_EVALUATION',
      'ID_SESSION',
      'ID_STAGIAIRE',
      'ID_ITEM',
      'NIVEAU'
    ]
  };

  Object.keys(structures).forEach(function (nomFeuille) {
    verifierColonnesSession_(
      classeur,
      nomFeuille,
      structures[nomFeuille]
    );
  });
}


function verifierColonnesSession_(
  classeur,
  nomFeuille,
  colonnes
) {
  const feuille = classeur.getSheetByName(nomFeuille);

  if (!feuille || feuille.getLastRow() < 1) {
    throw new Error(
      'La feuille ' + nomFeuille +
      ' est absente ou non initialisée.'
    );
  }

  const entetes = feuille
    .getRange(1, 1, 1, feuille.getLastColumn())
    .getValues()[0];

  const index = creerIndexSession_(entetes);

  colonnes.forEach(function (colonne) {
    if (!Number.isInteger(index[colonne])) {
      throw new Error(
        'La colonne "' + colonne +
        '" est absente de la feuille ' + nomFeuille + '.'
      );
    }
  });
}


function nettoyerIdOperationSession_(valeur) {
  const identifiant = String(
    valeur || Utilities.getUuid()
  ).trim();

  if (!/^[A-Za-z0-9_-]{8,120}$/.test(identifiant)) {
    throw new Error(
      'L’identifiant technique de l’enregistrement est invalide.'
    );
  }

  return identifiant;
}


function trouverSessionParOperation_(classeur, idOperation) {
  const table = lireFeuilleSession_(classeur, 'SESSIONS');
  const index = table.index;

  if (
    !Number.isInteger(index.ID_REQUETE) ||
    !Number.isInteger(index.ID_SESSION)
  ) {
    return '';
  }

  const ids = table.lignes
    .filter(function (ligne) {
      return String(
        ligne[index.ID_REQUETE] || ''
      ) === idOperation;
    })
    .map(function (ligne) {
      return String(ligne[index.ID_SESSION] || '');
    })
    .filter(Boolean);

  if (ids.length > 1) {
    throw new Error(
      'Plusieurs séances correspondent à la même requête. Aucune nouvelle écriture n’a été effectuée.'
    );
  }

  return ids[0] || '';
}


function mettreAJourSessionExistante_(
  classeur,
  idSession,
  objet,
  transaction
) {
  const feuille = classeur.getSheetByName('SESSIONS');
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexSession_(donnees[0]);
  const numerosLignes = [];

  donnees.slice(1).forEach(function (ligne, position) {
    if (
      String(ligne[index.ID_SESSION] || '') === idSession
    ) {
      numerosLignes.push(position + 2);
    }
  });

  if (numerosLignes.length !== 1) {
    throw new Error(
      numerosLignes.length
        ? 'Plusieurs séances utilisent le même ID_SESSION.'
        : 'Séance à modifier introuvable.'
    );
  }

  const numeroLigne = numerosLignes[0];
  const ligne = feuille
    .getRange(numeroLigne, 1, 1, feuille.getLastColumn())
    .getValues()[0];

  Object.keys(objet).forEach(function (colonne) {
    if (Number.isInteger(index[colonne])) {
      ligne[index[colonne]] = objet[colonne];
    }
  });

  ecrireLigneTransactionSession_(
    feuille,
    numeroLigne,
    ligne,
    'SESSIONS',
    index,
    transaction
  );
}


function remplacerLignesLieesSession_(
  classeur,
  nomFeuille,
  idSession,
  objets,
  colonnesObligatoires,
  colonnesCle,
  colonneIdentifiant,
  maintenant,
  transaction
) {
  const feuille = classeur.getSheetByName(nomFeuille);
  const derniereColonne = feuille.getLastColumn();
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexSession_(donnees[0]);

  colonnesObligatoires.forEach(function (colonne) {
    if (!Number.isInteger(index[colonne])) {
      throw new Error(
        'La colonne "' + colonne +
        '" est absente de la feuille ' + nomFeuille + '.'
      );
    }
  });

  const lignesExistantes = [];

  donnees.slice(1).forEach(function (ligne, position) {
    if (
      String(ligne[index.ID_SESSION] || '') === idSession
    ) {
      lignesExistantes.push({
        numeroLigne: position + 2,
        valeurs: ligne.slice()
      });
    }
  });

  const lignesParCle = {};

  lignesExistantes.forEach(function (ligne) {
    const cle = creerCleLiaisonSession_(
      ligne.valeurs,
      colonnesCle,
      index
    );

    if (!lignesParCle[cle]) {
      lignesParCle[cle] = [];
    }

    lignesParCle[cle].push(ligne);
  });

  if (
    nomFeuille === 'PRESTATIONS_FORMATEURS' &&
    Number.isInteger(index.STATUT_INDEMNISATION)
  ) {
    const clesFinales = new Set(
      objets.map(function (objet) {
        return creerCleObjetLiaisonSession_(
          objet,
          colonnesCle
        );
      })
    );

    lignesExistantes.forEach(function (ligne) {
      const cle = creerCleLiaisonSession_(
        ligne.valeurs,
        colonnesCle,
        index
      );

      const statut = normaliserEnteteSession_(
        ligne.valeurs[index.STATUT_INDEMNISATION]
      );

      if (
        !clesFinales.has(cle) &&
        statut &&
        statut !== 'A_DEMANDER'
      ) {
        throw new Error(
          'Un formateur avec une indemnisation engagée ne peut pas être retiré de la séance.'
        );
      }
    });
  }

  const lignesUtilisees = new Set();

  objets.forEach(function (objetInitial) {
    const objet = Object.assign({}, objetInitial);
    const cle = creerCleObjetLiaisonSession_(
      objet,
      colonnesCle
    );

    let ligneCible = (lignesParCle[cle] || []).find(
      function (ligne) {
        return !lignesUtilisees.has(ligne.numeroLigne);
      }
    );

    const correspondanceExacte = Boolean(ligneCible);

    if (
      correspondanceExacte &&
      nomFeuille === 'PRESTATIONS_FORMATEURS'
    ) {
      delete objet.STATUT_INDEMNISATION;
    }

    if (!ligneCible) {
      ligneCible = lignesExistantes.find(
        function (ligne) {
          return !lignesUtilisees.has(ligne.numeroLigne);
        }
      );
    }

    const ligne = correspondanceExacte
      ? ligneCible.valeurs.slice()
      : new Array(derniereColonne).fill('');

    if (
      correspondanceExacte &&
      Number.isInteger(index[colonneIdentifiant])
    ) {
      objet[colonneIdentifiant] =
        ligneCible.valeurs[index[colonneIdentifiant]] ||
        objet[colonneIdentifiant];
    }

    if (
      correspondanceExacte &&
      Number.isInteger(index.DATE_CREATION)
    ) {
      objet.DATE_CREATION =
        ligneCible.valeurs[index.DATE_CREATION] ||
        objet.DATE_CREATION || maintenant;
    }

    Object.keys(objet).forEach(function (colonne) {
      if (Number.isInteger(index[colonne])) {
        ligne[index[colonne]] = objet[colonne];
      }
    });

    if (ligneCible) {
      lignesUtilisees.add(ligneCible.numeroLigne);

      ecrireLigneTransactionSession_(
        feuille,
        ligneCible.numeroLigne,
        ligne,
        nomFeuille,
        index,
        transaction
      );
    } else {
      ajouterLignesSession_(
        classeur,
        nomFeuille,
        [objet],
        colonnesObligatoires,
        transaction.ajouts
      );
    }
  });

  lignesExistantes.forEach(function (ligne) {
    if (lignesUtilisees.has(ligne.numeroLigne)) {
      return;
    }

    ecrireLigneTransactionSession_(
      feuille,
      ligne.numeroLigne,
      new Array(derniereColonne).fill(''),
      nomFeuille,
      index,
      transaction,
      false
    );
  });
}


function creerCleLiaisonSession_(ligne, colonnes, index) {
  return colonnes.map(function (colonne) {
    return String(ligne[index[colonne]] || '').trim();
  }).join('::');
}


function creerCleObjetLiaisonSession_(objet, colonnes) {
  return colonnes.map(function (colonne) {
    return String(objet[colonne] || '').trim();
  }).join('::');
}


function ecrireLigneTransactionSession_(
  feuille,
  numeroLigne,
  ligne,
  nomFeuille,
  index,
  transaction,
  formater
) {
  const plage = feuille.getRange(
    numeroLigne,
    1,
    1,
    feuille.getLastColumn()
  );

  transaction.modifications.push({
    feuille: feuille,
    premiereLigne: numeroLigne,
    nombreColonnes: feuille.getLastColumn(),
    valeurs: plage.getValues(),
    formats: plage.getNumberFormats()
  });

  plage.setValues([ligne]);

  if (formater !== false) {
    transaction.formats.push({
      feuille: feuille,
      premiereLigne: numeroLigne,
      nombreLignes: 1,
      nombreColonnes: feuille.getLastColumn(),
      index: index,
      nomFeuille: nomFeuille
    });
  }
}


function annulerTransactionSession_(transaction) {
  annulerEcrituresSession_(transaction.ajouts);

  transaction.modifications
    .slice()
    .reverse()
    .forEach(function (modification) {
      try {
        const plage = modification.feuille.getRange(
          modification.premiereLigne,
          1,
          1,
          modification.nombreColonnes
        );

        plage.setValues(modification.valeurs);
        plage.setNumberFormats(modification.formats);
      } catch (erreurAnnulation) {
        console.error(erreurAnnulation);
      }
    });

  try {
    SpreadsheetApp.flush();
  } catch (erreurFlush) {
    console.error(erreurFlush);
  }
}


/**
 * Crée la feuille de liaison des items travaillés si elle
 * n'existe pas et complète ses entêtes sans effacer de données.
 */
function obtenirFeuilleItemsSessions_(classeur) {
  return assurerFeuilleMigration_(
    classeur,
    'ITEMS_SESSIONS'
  );
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
          : '',
        actif: true
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
  return obtenirEmailUtilisateurActif_() ||
    'FORMATEUR_PUBLIC';
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
      ITEMS_SESSIONS: {
        DATE_CREATION: 'dd/MM/yyyy HH:mm'
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
