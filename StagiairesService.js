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
    'FORMATEUR_REFERENT',
    'DATE_CHANGEMENT_STATUT_AUTO',
    'PHOTO_FILE_ID',
    'PHOTO_NOM',
    'PHOTO_DATE_MODIFICATION'
  ],

  statuts: [
    'À préparer',
    'En préparation',
    'Stage aujourd\'hui',
    'Stage passé',
    'Clôturé',
    'Abandon'
  ]
};


/**
 * Retourne tous les stagiaires.
 */
function getStagiaires() {
  synchroniserStatutsStagiaires_();
  return lireStagiairesSansSynchronisation_();
}


/**
 * Lit les stagiaires après une éventuelle synchronisation.
 * Cette fonction interne évite les appels récursifs pendant
 * la migration et le calcul des statuts.
 */
function lireStagiairesSansSynchronisation_() {
  const feuille = obtenirFeuilleStagiairesLecture_();
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

        aUnePhoto: Boolean(
          String(ligne[index.PHOTO_FILE_ID] || '').trim()
        ),

        photoNom: String(
          ligne[index.PHOTO_NOM] || ''
        ),

        photoDateModification:
          convertirDateHeureStatutPourInterface_(
            ligne[index.PHOTO_DATE_MODIFICATION]
          ),

        formateurReferent: String(
          ligne[index.FORMATEUR_REFERENT] || ''
        ),

        dateChangementStatutAuto:
          convertirDateHeureStatutPourInterface_(
            ligne[index.DATE_CHANGEMENT_STATUT_AUTO]
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
 * Migre les anciens libellés et recalcule les statuts gérés
 * automatiquement. La feuille est modifiée uniquement lorsque
 * le statut calculé change ou que la date initiale manque.
 */
function synchroniserStatutsStagiaires_() {
  if (restaurationBloqueEcritures_()) {
    return {
      migres: 0,
      automatiquesMisAJour: 0,
      suspenduPendantRestauration: true
    };
  }

  return executerMutationMetier_(function () {
    const feuille = obtenirFeuilleStagiaires_();
    const donnees = feuille.getDataRange().getValues();

    if (donnees.length <= 1) {
      return {
        migres: 0,
        automatiquesMisAJour: 0
      };
    }

    const index = creerIndexEntetes_(donnees[0]);
    const nombreSessionsParStagiaire =
      compterSessionsRealiseesParStagiaire_();
    const maintenant = new Date();
    const aujourdHui = obtenirDateSansHeure_(maintenant);
    let migres = 0;
    let automatiquesMisAJour = 0;
    let modification = false;
    const changementsStatuts = [];

    donnees.slice(1).forEach(function (ligne) {
      const uuid = String(ligne[index.UUID] || '').trim();

      if (!uuid) {
        return;
      }

      const statutBrut = String(
        ligne[index.STATUT] || ''
      ).trim();

      const statutNormalise =
        normaliserStatutStagiaire_(statutBrut);

      const statutManuel = [
        'Clôturé',
        'Abandon'
      ].includes(statutNormalise);

      const statutCible = statutManuel
        ? statutNormalise
        : calculerStatutAutomatiqueStagiaire_(
          ligne[index.DATE_STAGE],
          nombreSessionsParStagiaire[uuid] || 0,
          aujourdHui
        );

      const ancienLibelle = statutBrut || 'À préparer';
      const libelleMigre = ancienLibelle !== statutCible;
      const dateAutomatiqueManquante =
        !statutManuel &&
        !ligne[index.DATE_CHANGEMENT_STATUT_AUTO];

      if (libelleMigre) {
        ligne[index.STATUT] = statutCible;
        modification = true;
        migres++;
        changementsStatuts.push({
          uuid: uuid,
          ancienStatut: ancienLibelle,
          nouveauStatut: statutCible,
          migrationManuelle: statutManuel
        });
      }

      if (!statutManuel && (libelleMigre || dateAutomatiqueManquante)) {
        ligne[index.DATE_CHANGEMENT_STATUT_AUTO] = maintenant;
        modification = true;
        automatiquesMisAJour++;
      }
    });

    if (modification) {
      feuille
        .getRange(
          2,
          index.STATUT + 1,
          donnees.length - 1,
          1
        )
        .setValues(
          donnees.slice(1).map(function (ligne) {
            return [ligne[index.STATUT]];
          })
        );

      feuille
        .getRange(
          2,
          index.DATE_CHANGEMENT_STATUT_AUTO + 1,
          donnees.length - 1,
          1
        )
        .setValues(
          donnees.slice(1).map(function (ligne) {
            return [
              ligne[index.DATE_CHANGEMENT_STATUT_AUTO]
            ];
          })
        )
        .setNumberFormat('dd/mm/yyyy hh:mm');

      SpreadsheetApp.flush();

      changementsStatuts.forEach(function (changement) {
        journaliserActionSensible_(
          changement.migrationManuelle
            ? 'STATUT_STAGIAIRE_MIGRATION'
            : 'STATUT_STAGIAIRE_AUTOMATIQUE',
          'STAGIAIRE',
          changement.uuid,
          {
            ancienStatut: changement.ancienStatut,
            nouveauStatut: changement.nouveauStatut
          }
        );
      });
    }

    return {
      migres: migres,
      automatiquesMisAJour: automatiquesMisAJour
    };
  });
}


function compterSessionsRealiseesParStagiaire_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tableSessions = lireFeuillePourSuivi_(
    classeur,
    'SESSIONS'
  );
  const tablePresences = lireFeuillePourSuivi_(
    classeur,
    'PRESENCES_STAGIAIRES'
  );
  const datesSessions = {};
  const aujourdHui = obtenirDateSansHeure_(new Date());

  if (
    Number.isInteger(tableSessions.index.ID_SESSION) &&
    Number.isInteger(tableSessions.index.DATE_SESSION)
  ) {
    tableSessions.lignes.forEach(function (ligne) {
      const idSession = String(
        ligne[tableSessions.index.ID_SESSION] || ''
      ).trim();
      const dateSession = obtenirDateSansHeure_(
        ligne[tableSessions.index.DATE_SESSION]
      );

      if (
        idSession &&
        dateSession &&
        dateSession.getTime() <= aujourdHui.getTime()
      ) {
        datesSessions[idSession] = true;
      }
    });
  }

  const sessionsParStagiaire = {};

  if (
    Number.isInteger(tablePresences.index.ID_SESSION) &&
    Number.isInteger(tablePresences.index.ID_STAGIAIRE)
  ) {
    tablePresences.lignes.forEach(function (ligne) {
      const idSession = String(
        ligne[tablePresences.index.ID_SESSION] || ''
      ).trim();
      const idStagiaire = String(
        ligne[tablePresences.index.ID_STAGIAIRE] || ''
      ).trim();

      if (!idStagiaire || !datesSessions[idSession]) {
        return;
      }

      if (!sessionsParStagiaire[idStagiaire]) {
        sessionsParStagiaire[idStagiaire] = new Set();
      }

      sessionsParStagiaire[idStagiaire].add(idSession);
    });
  }

  return Object.keys(sessionsParStagiaire).reduce(
    function (resultat, idStagiaire) {
      resultat[idStagiaire] =
        sessionsParStagiaire[idStagiaire].size;
      return resultat;
    },
    {}
  );
}


function calculerStatutAutomatiqueStagiaire_(
  dateStageValeur,
  nombreSessionsRealisees,
  aujourdHui
) {
  const dateStage = obtenirDateSansHeure_(dateStageValeur);

  if (dateStage) {
    const difference = dateStage.getTime() - aujourdHui.getTime();

    if (difference < 0) {
      return 'Stage passé';
    }

    if (difference === 0) {
      return 'Stage aujourd\'hui';
    }

    if (nombreSessionsRealisees > 0) {
      return 'En préparation';
    }
  }

  return 'À préparer';
}


function normaliserStatutStagiaire_(statut) {
  const normalise = normaliserEntete_(statut);
  const correspondances = {
    A_PREPARER: 'À préparer',
    EN_PREPARATION: 'En préparation',
    STAGE_AUJOURD_HUI: 'Stage aujourd\'hui',
    STAGE_PASSE: 'Stage passé',
    ECHEANCE_ATTEINTE: '',
    CLOTURE: 'Clôturé',
    PREPARATION_TERMINEE: 'Clôturé',
    TERMINE: 'Clôturé',
    ABANDON: 'Abandon',
    ABANDONNE: 'Abandon',
    PREPARATION_ABANDONNEE: 'Abandon'
  };

  return Object.prototype.hasOwnProperty.call(
    correspondances,
    normalise
  )
    ? correspondances[normalise]
    : '';
}


function convertirDateHeureStatutPourInterface_(valeur) {
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
    'dd/MM/yyyy HH:mm'
  );
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

  const tableItemsSessions = lireFeuillePourSuivi_(
    classeur,
    'ITEMS_SESSIONS'
  );

  const tablePrestations = lireFeuillePourSuivi_(
    classeur,
    'PRESTATIONS_FORMATEURS'
  );

  const tableFormateurs = lireFeuillePourSuivi_(
    classeur,
    'FORMATEURS'
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

  const formateursParId = {};
  const indexFormateurs = tableFormateurs.index;

  if (Number.isInteger(indexFormateurs.ID_FORMATEUR)) {
    tableFormateurs.lignes.forEach(function (ligne) {
      const idFormateur = String(
        ligne[indexFormateurs.ID_FORMATEUR] || ''
      );

      if (!idFormateur) {
        return;
      }

      formateursParId[idFormateur] = [
        Number.isInteger(indexFormateurs.PRENOM)
          ? String(
            ligne[indexFormateurs.PRENOM] || ''
          ).trim()
          : '',
        Number.isInteger(indexFormateurs.NOM)
          ? String(
            ligne[indexFormateurs.NOM] || ''
          ).trim()
          : ''
      ].filter(Boolean).join(' ');
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

      const nomFormateur = formateursParId[idFormateur] ||
        'Formateur non identifié';

      if (
        !formateursParSession[idSession].includes(
          nomFormateur
        )
      ) {
        formateursParSession[idSession].push(
          nomFormateur
        );
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
  const sessionsParId = {};

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

      sessionsParId[idSession] = {
        idSession: idSession,
        date: convertirDatePourInterface_(
          dateSession
        ),
        dateObjet: dateSession,
        formation: formation
      };

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
          : 0,

        formateurs: (
          formateursParSession[idSession] || []
        ).slice().sort(function (a, b) {
          return a.localeCompare(
            b,
            'fr',
            { sensitivity: 'base' }
          );
        })
      });
    });
  }

  const idsItemsParSession = {};
  const sourcesItemsParSession = {};

  function ajouterItemTravaille(
    idSession,
    idItem,
    source
  ) {
    const session = sessionsParId[idSession];

    if (
      !idsSessionsSuivies.has(idSession) ||
      !session ||
      (
        session.dateObjet &&
        session.dateObjet > maintenant
      ) ||
      !idItem
    ) {
      return;
    }

    if (!idsItemsParSession[idSession]) {
      idsItemsParSession[idSession] = new Set();
    }

    idsItemsParSession[idSession].add(idItem);

    if (!sourcesItemsParSession[idSession]) {
      sourcesItemsParSession[idSession] = new Set();
    }

    sourcesItemsParSession[idSession].add(source);
  }

  const indexItemsSessions = tableItemsSessions.index;

  if (
    Number.isInteger(indexItemsSessions.ID_SESSION) &&
    Number.isInteger(indexItemsSessions.ID_ITEM)
  ) {
    tableItemsSessions.lignes.forEach(function (ligne) {
      ajouterItemTravaille(
        String(
          ligne[indexItemsSessions.ID_SESSION] || ''
        ),
        String(
          ligne[indexItemsSessions.ID_ITEM] || ''
        ),
        'ITEMS_SESSIONS'
      );
    });
  }

  const indexEvaluations = tableEvaluations.index;
  const evaluationsParItem = {};
  const evaluationsParSession = {};
  let nombreEvaluations = 0;

  if (
    Number.isInteger(indexEvaluations.ID_STAGIAIRE) &&
    Number.isInteger(indexEvaluations.ID_ITEM)
  ) {
    tableEvaluations.lignes.forEach(
      function (ligne) {
        const idStagiaire = String(
          ligne[indexEvaluations.ID_STAGIAIRE] || ''
        );

        if (idStagiaire !== String(uuid)) {
          return;
        }

        nombreEvaluations++;

        const idItem = String(
          ligne[indexEvaluations.ID_ITEM] || ''
        );

        const idSession = Number.isInteger(
          indexEvaluations.ID_SESSION
        )
          ? String(
            ligne[indexEvaluations.ID_SESSION] || ''
          )
          : '';

        if (!idItem) {
          return;
        }

        if (
          evaluationIndiqueTravailSuivi_(
            ligne,
            indexEvaluations
          )
        ) {
          ajouterItemTravaille(
            idSession,
            idItem,
            'EVALUATIONS'
          );
        }

        if (!evaluationsParItem[idItem]) {
          evaluationsParItem[idItem] = {
            acquis: false,
            dernierCommentaire: '',
            ordreDernierCommentaire: -1
          };
        }

        const evaluation = evaluationsParItem[idItem];

        const evaluationAcquise =
          evaluationEstAcquiseSuivi_(
            ligne,
            indexEvaluations
          );

        if (evaluationAcquise) {
          evaluation.acquis = true;
        }

        const commentaire = Number.isInteger(
          indexEvaluations.REMARQUE
        )
          ? String(
            ligne[indexEvaluations.REMARQUE] || ''
          ).trim()
          : '';

        if (
          idSession &&
          idsSessionsSuivies.has(idSession)
        ) {
          if (!evaluationsParSession[idSession]) {
            evaluationsParSession[idSession] = {
              idsItemsAcquis: new Set(),
              commentaires: [],
              clesCommentaires: new Set()
            };
          }

          const evaluationSession =
            evaluationsParSession[idSession];

          if (evaluationAcquise) {
            evaluationSession.idsItemsAcquis.add(idItem);
          }

          const cleCommentaire = idItem + '::' +
            commentaire;

          if (
            commentaire &&
            !evaluationSession.clesCommentaires.has(
              cleCommentaire
            )
          ) {
            evaluationSession.clesCommentaires.add(
              cleCommentaire
            );

            evaluationSession.commentaires.push({
              idItem: idItem,
              commentaire: commentaire
            });
          }
        }

        if (!commentaire) {
          return;
        }

        const ordreCommentaire =
          obtenirOrdreEvaluationSuivi_(
            ligne,
            indexEvaluations,
            sessionsParId[idSession]
          );

        if (
          ordreCommentaire >=
          evaluation.ordreDernierCommentaire
        ) {
          evaluation.dernierCommentaire = commentaire;
          evaluation.ordreDernierCommentaire =
            ordreCommentaire;
        }
      }
    );
  }

  const categoriesReferentiel =
    getCategoriesReferentiel(stagiaire.formation);

  const itemsReferentiel =
    getItemsReferentiel(stagiaire.formation);

  const itemsParId = {};
  const positionItems = {};

  itemsReferentiel.forEach(function (item, position) {
    itemsParId[item.idItem] = item;
    positionItems[item.idItem] = position;
  });

  sessionsSuivies.forEach(function (session) {
    const idsItems = idsItemsParSession[
      session.idSession
    ];

    session.itemsTravailles = idsItems
      ? [...idsItems]
        .filter(function (idItem) {
          return Boolean(itemsParId[idItem]);
        })
        .sort(function (a, b) {
          return positionItems[a] - positionItems[b];
        })
        .map(function (idItem) {
          return itemsParId[idItem].intitule;
        })
      : [];

    session.sourcesItemsTravailles =
      sourcesItemsParSession[session.idSession]
        ? [...sourcesItemsParSession[session.idSession]]
        : [];
  });

  const idsItemsDejaAcquis = new Set();

  const chronologiePedagogique = sessionsSuivies
    .slice()
    .sort(function (a, b) {
      return (
        String(a.date).localeCompare(String(b.date)) ||
        String(a.heureDebut).localeCompare(
          String(b.heureDebut)
        )
      );
    })
    .map(function (session) {
      const evaluationSession =
        evaluationsParSession[session.idSession] || {
          idsItemsAcquis: new Set(),
          commentaires: []
        };

      const nouveauxItemsAcquis = [
        ...evaluationSession.idsItemsAcquis
      ]
        .filter(function (idItem) {
          return !idsItemsDejaAcquis.has(idItem);
        })
        .sort(function (a, b) {
          return (
            (positionItems[a] ?? 999999) -
            (positionItems[b] ?? 999999)
          );
        })
        .map(function (idItem) {
          return itemsParId[idItem]
            ? itemsParId[idItem].intitule
            : 'Item historique';
        });

      evaluationSession.idsItemsAcquis.forEach(
        function (idItem) {
          idsItemsDejaAcquis.add(idItem);
        }
      );

      const commentairesIndividuels =
        evaluationSession.commentaires
          .slice()
          .sort(function (a, b) {
            return (
              (positionItems[a.idItem] ?? 999999) -
              (positionItems[b.idItem] ?? 999999)
            );
          })
          .map(function (commentaire) {
            return {
              item: itemsParId[commentaire.idItem]
                ? itemsParId[commentaire.idItem].intitule
                : 'Item historique',
              commentaire: commentaire.commentaire
            };
          });

      return {
        idSession: session.idSession,
        date: session.date,
        heureDebut: session.heureDebut,
        formateurs: session.formateurs,
        itemsTravailles: session.itemsTravailles,
        nouveauxItemsAcquis: nouveauxItemsAcquis,
        commentairesIndividuels:
          commentairesIndividuels
      };
    })
    .reverse();

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

  const heuresFormation = sessionsSuivies.reduce(
    function (total, session) {
      return total + session.dureeHeures;
    },
    0
  );

  const suiviPedagogique =
    construireSuiviPedagogiqueStagiaire_(
      categoriesReferentiel,
      itemsReferentiel,
      idsItemsParSession,
      sessionsParId,
      evaluationsParItem
    );

  const tableauBordPedagogique =
    construireTableauBordPedagogiqueStagiaire_(
      suiviPedagogique
    );

  return {
    sessions: sessionsSuivies,
    suiviPedagogique: suiviPedagogique,
    tableauBordPedagogique: tableauBordPedagogique,
    chronologiePedagogique: chronologiePedagogique,

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


function construireSuiviPedagogiqueStagiaire_(
  categories,
  items,
  idsItemsParSession,
  sessionsParId,
  evaluationsParItem
) {
  const groupesParId = {};

  categories.forEach(function (categorie) {
    groupesParId[categorie.idCategorie] = {
      idCategorie: categorie.idCategorie,
      intitule: categorie.intitule,
      ordre: categorie.ordre,
      actif: categorie.actif,
      items: []
    };
  });

  items.forEach(function (item) {
    const idsSessionsTravaillees = [];

    Object.keys(idsItemsParSession).forEach(
      function (idSession) {
        if (
          idsItemsParSession[idSession].has(item.idItem)
        ) {
          idsSessionsTravaillees.push(idSession);
        }
      }
    );

    const evaluation = evaluationsParItem[item.idItem];
    const historiquementUtilise = Boolean(
      item.utilise ||
      idsSessionsTravaillees.length ||
      evaluation
    );

    if (!item.actif && !historiquementUtilise) {
      return;
    }

    let derniereDate = null;

    idsSessionsTravaillees.forEach(function (idSession) {
      const session = sessionsParId[idSession];

      if (
        session &&
        session.dateObjet &&
        (!derniereDate ||
          session.dateObjet > derniereDate)
      ) {
        derniereDate = session.dateObjet;
      }
    });

    const acquis = Boolean(evaluation && evaluation.acquis);
    const nombreSeances = idsSessionsTravaillees.length;

    const itemSuivi = {
      idItem: item.idItem,
      intitule: item.intitule,
      ordre: item.ordre,
      ordreCategorie: item.ordreCategorie,
      idCategorie: item.idCategorie,
      categorie: item.categorie,
      categorieActive: item.categorieActive,
      actif: item.actif,
      compteDansProgression: Boolean(
        item.actif && item.categorieActive
      ),
      nombreSeances: nombreSeances,
      statut: acquis
        ? 'Acquis'
        : nombreSeances
          ? 'Travaillé'
          : 'Non travaillé',
      derniereDate: convertirDatePourInterface_(
        derniereDate
      ),
      dernierCommentaire: evaluation
        ? evaluation.dernierCommentaire
        : ''
    };

    if (!groupesParId[item.idCategorie]) {
      groupesParId[item.idCategorie] = {
        idCategorie: item.idCategorie,
        intitule: item.categorie ||
          'Catégorie historique',
        ordre: item.ordreCategorie || 999999,
        actif: false,
        items: []
      };
    }

    groupesParId[item.idCategorie].items.push(itemSuivi);
  });

  return Object.keys(groupesParId)
    .map(function (idCategorie) {
      const groupe = groupesParId[idCategorie];

      groupe.items.sort(function (a, b) {
        return (
          a.ordre - b.ordre ||
          a.intitule.localeCompare(
            b.intitule,
            'fr',
            { sensitivity: 'base' }
          )
        );
      });

      return groupe;
    })
    .filter(function (groupe) {
      return groupe.items.length;
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
    });
}


function construireTableauBordPedagogiqueStagiaire_(
  suiviPedagogique
) {
  const itemsActifs = [];

  suiviPedagogique.forEach(function (categorie) {
    categorie.items.forEach(function (item) {
      if (item.compteDansProgression) {
        itemsActifs.push(item);
      }
    });
  });

  const nombreItems = itemsActifs.length;
  const nombreTravailles = itemsActifs.filter(
    function (item) {
      return item.nombreSeances > 0;
    }
  ).length;

  const nombreAcquis = itemsActifs.filter(
    function (item) {
      return item.statut === 'Acquis';
    }
  ).length;

  const progressionCategories = suiviPedagogique
    .map(function (categorie) {
      const itemsCategorie = categorie.items.filter(
        function (item) {
          return item.compteDansProgression;
        }
      );

      const travailles = itemsCategorie.filter(
        function (item) {
          return item.nombreSeances > 0;
        }
      ).length;

      const acquis = itemsCategorie.filter(
        function (item) {
          return item.statut === 'Acquis';
        }
      ).length;

      return {
        idCategorie: categorie.idCategorie,
        intitule: categorie.intitule,
        ordreReferentiel: categorie.ordre,
        nombreItems: itemsCategorie.length,
        travailles: travailles,
        acquis: acquis,
        pourcentage: itemsCategorie.length
          ? Math.round(
            acquis / itemsCategorie.length * 100
          )
          : 0
      };
    })
    .filter(function (categorie) {
      return categorie.nombreItems > 0;
    })
    .sort(function (a, b) {
      return (
        a.pourcentage - b.pourcentage ||
        a.ordreReferentiel - b.ordreReferentiel ||
        a.intitule.localeCompare(
          b.intitule,
          'fr',
          { sensitivity: 'base' }
        )
      );
    });

  const itemsPrioritaires = itemsActifs
    .filter(function (item) {
      return item.statut !== 'Acquis';
    })
    .sort(function (a, b) {
      const prioriteA = a.nombreSeances > 0 ? 1 : 0;
      const prioriteB = b.nombreSeances > 0 ? 1 : 0;

      return (
        prioriteA - prioriteB ||
        a.ordreCategorie - b.ordreCategorie ||
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
        intitule: item.intitule,
        categorie: item.categorie,
        statut: item.nombreSeances > 0
          ? 'Travaillé'
          : 'Non travaillé',
        nombreSeances: item.nombreSeances,
        ordreCategorie: item.ordreCategorie,
        ordre: item.ordre
      };
    });

  return {
    progressionGenerale: nombreItems
      ? Math.round(nombreAcquis / nombreItems * 100)
      : 0,
    nombreItems: nombreItems,
    nombreTravailles: nombreTravailles,
    nombreAcquis: nombreAcquis,
    nombreRestantATravailler:
      Math.max(0, nombreItems - nombreTravailles),
    progressionCategories: progressionCategories,
    itemsPrioritaires: itemsPrioritaires
  };
}


function evaluationIndiqueTravailSuivi_(ligne, index) {
  if (evaluationEstAcquiseSuivi_(ligne, index)) {
    return true;
  }

  if (Number.isInteger(index.VU)) {
    const valeurVu = ligne[index.VU];

    if (
      valeurVu !== '' &&
      valeurVu !== null &&
      valeurVu !== undefined
    ) {
      return estValeurPositiveSuivi_(valeurVu);
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


function evaluationEstAcquiseSuivi_(ligne, index) {
  if (
    Number.isInteger(index.ACQUIS) &&
    estValeurPositiveSuivi_(ligne[index.ACQUIS])
  ) {
    return true;
  }

  if (!Number.isInteger(index.NIVEAU)) {
    return false;
  }

  return normaliserEntete_(ligne[index.NIVEAU]) ===
    'ACQUIS';
}


function estValeurPositiveSuivi_(valeur) {
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


function obtenirOrdreEvaluationSuivi_(
  ligne,
  index,
  session
) {
  const dateSession = session && session.dateObjet
    ? session.dateObjet.getTime()
    : 0;

  const valeurDate = [
    'DATE_MODIFICATION',
    'DATE_CREATION'
  ].reduce(function (dateTrouvee, colonne) {
    if (dateTrouvee || !Number.isInteger(index[colonne])) {
      return dateTrouvee;
    }

    return obtenirDateSansHeure_(ligne[index[colonne]]);
  }, null);

  const dateEvaluation = valeurDate
    ? valeurDate.getTime()
    : 0;

  return Math.max(dateSession, dateEvaluation);
}


/**
 * Ajoute ou modifie un stagiaire.
 */
function enregistrerStagiaire(donnees, jetonAdministrateur) {
  const sessionUtilisateur = exigerAdministrateur_(
    jetonAdministrateur
  );

  return executerMutationMetier_(function () {
    return enregistrerStagiaireInterne_(donnees, sessionUtilisateur);
  });
}


function enregistrerStagiaireInterne_(donnees, sessionUtilisateur) {
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

  const ligne = numeroLigne
    ? valeurs[numeroLigne - 1].slice()
    : new Array(entetes.length).fill('');

  const ancienStatut = numeroLigne
    ? normaliserStatutStagiaire_(ligne[index.STATUT])
    : '';

  const statutManuel = [
    'Clôturé',
    'Abandon'
  ].includes(ancienStatut);

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

  ligne[index.STATUT] = statutManuel
    ? ancienStatut
    : 'À préparer';

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

  if (!numeroLigne && donnees.photoUrl) {
    ligne[index.PHOTO_URL] = String(
      donnees.photoUrl
    ).trim();
  }

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

  synchroniserStatutsStagiaires_();

  journaliserActionSensible_(
    donnees.uuid
      ? 'STAGIAIRE_MODIFICATION'
      : 'STAGIAIRE_CREATION',
    'STAGIAIRE',
    uuid,
    {
      nom: ligne[index.NOM],
      prenom: ligne[index.PRENOM],
      formation: ligne[index.FORMATION],
      dateStage: donnees.dateStage
    },
    sessionUtilisateur.identifiantHistorique
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
 * Applique la seule décision manuelle autorisée sur le cycle
 * de vie d'un stagiaire.
 */
function cloturerPreparationStagiaire(
  donnees,
  jetonAdministrateur
) {
  const sessionUtilisateur = exigerAdministrateur_(
    jetonAdministrateur
  );

  return executerMutationMetier_(function () {
    return cloturerPreparationStagiaireInterne_(
      donnees,
      sessionUtilisateur
    );
  });
}


function cloturerPreparationStagiaireInterne_(
  donnees,
  sessionUtilisateur
) {

  if (!donnees) {
    throw new Error('Aucune donnée de clôture reçue.');
  }

  const uuid = String(donnees.uuid || '').trim();
  const resultat = normaliserStatutStagiaire_(
    donnees.resultat
  );
  const commentaire = String(
    donnees.commentaire || ''
  ).trim();
  const dateCloture = convertirTexteEnDate_(donnees.date);

  if (!uuid) {
    throw new Error('Identifiant du stagiaire manquant.');
  }

  if (!['Clôturé', 'Abandon'].includes(resultat)) {
    throw new Error(
      'Le résultat doit être « Clôturé » ou « Abandon ».'
    );
  }

  if (!dateCloture) {
    throw new Error('La date de clôture est obligatoire.');
  }

  if (!commentaire) {
    throw new Error('Le commentaire de clôture est obligatoire.');
  }

  synchroniserStatutsStagiaires_();

    const feuille = obtenirFeuilleStagiaires_();
    const valeurs = feuille.getDataRange().getValues();
    const index = creerIndexEntetes_(valeurs[0]);
    let numeroLigne = 0;

    for (let i = 1; i < valeurs.length; i++) {
      if (String(valeurs[i][index.UUID] || '') === uuid) {
        numeroLigne = i + 1;
        break;
      }
    }

    if (!numeroLigne) {
      throw new Error('Stagiaire introuvable.');
    }

    feuille
      .getRange(numeroLigne, index.STATUT + 1)
      .setValue(resultat);

    feuille
      .getRange(numeroLigne, index.DATE_CLOTURE + 1)
      .setValue(dateCloture)
      .setNumberFormat('dd/mm/yyyy');

    feuille
      .getRange(numeroLigne, index.MOTIF_CLOTURE + 1)
      .setValue(commentaire);

    SpreadsheetApp.flush();

    journaliserActionSensible_(
      resultat === 'Clôturé'
        ? 'STAGIAIRE_CLOTURE'
        : 'STAGIAIRE_ABANDON',
      'STAGIAIRE',
      uuid,
      {
        resultat: resultat,
        date: donnees.date,
        commentaire: commentaire
      },
      sessionUtilisateur.identifiantHistorique
    );

  return {
    succes: true,
    uuid: uuid,
    statut: resultat,
    message: resultat === 'Clôturé'
      ? 'Préparation clôturée.'
      : 'Abandon enregistré.'
  };
}


/**
 * Réactive une préparation clôturée ou abandonnée puis laisse
 * le moteur automatique recalculer son statut courant.
 */
function reactiverPreparationStagiaire(
  uuid,
  jetonAdministrateur
) {
  const sessionUtilisateur = exigerAdministrateur_(
    jetonAdministrateur
  );

  return executerMutationMetier_(function () {
    return reactiverPreparationStagiaireInterne_(
      uuid,
      sessionUtilisateur
    );
  });
}


function reactiverPreparationStagiaireInterne_(
  uuid,
  sessionUtilisateur
) {
  const identifiant = String(uuid || '').trim();

  if (!identifiant) {
    throw new Error('Identifiant du stagiaire manquant.');
  }

  const feuille = obtenirFeuilleStagiaires_();
    const valeurs = feuille.getDataRange().getValues();
    const index = creerIndexEntetes_(valeurs[0]);
    let numeroLigne = 0;
    let ancienneDateCloture = '';
    let ancienMotif = '';
    let ancienStatut = '';

    for (let i = 1; i < valeurs.length; i++) {
      if (String(valeurs[i][index.UUID] || '') === identifiant) {
        numeroLigne = i + 1;
        ancienStatut = normaliserStatutStagiaire_(
          valeurs[i][index.STATUT]
        );
        ancienneDateCloture = convertirDatePourInterface_(
          valeurs[i][index.DATE_CLOTURE]
        );
        ancienMotif = String(
          valeurs[i][index.MOTIF_CLOTURE] || ''
        );
        break;
      }
    }

    if (!numeroLigne) {
      throw new Error('Stagiaire introuvable.');
    }

    if (!['Clôturé', 'Abandon'].includes(ancienStatut)) {
      throw new Error(
        'Seule une préparation clôturée ou abandonnée peut être réactivée.'
      );
    }

    feuille
      .getRange(numeroLigne, index.STATUT + 1)
      .setValue('À préparer');

    feuille
      .getRange(numeroLigne, index.DATE_CLOTURE + 1)
      .clearContent();

    feuille
      .getRange(numeroLigne, index.MOTIF_CLOTURE + 1)
      .clearContent();

    feuille
      .getRange(
        numeroLigne,
        index.DATE_CHANGEMENT_STATUT_AUTO + 1
      )
      .setValue(new Date())
      .setNumberFormat('dd/mm/yyyy hh:mm');

    SpreadsheetApp.flush();
    synchroniserStatutsStagiaires_();

    const statutRecalcule = String(
      feuille
        .getRange(numeroLigne, index.STATUT + 1)
        .getValue() || 'À préparer'
    );

    journaliserActionSensible_(
      'STAGIAIRE_REACTIVATION',
      'STAGIAIRE',
      identifiant,
      {
        ancienStatut: ancienStatut,
        ancienneDateCloture: ancienneDateCloture,
        ancienMotif: ancienMotif,
        nouveauStatut: statutRecalcule
      },
      sessionUtilisateur.identifiantHistorique
    );

  return {
    succes: true,
    uuid: identifiant,
    statut: statutRecalcule,
    message: 'Préparation réactivée.'
  };
}


/**
 * Retourne les formations actives configurées
 * dans la feuille FORMATIONS.
 */
function getFormations() {
  const feuille = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName('FORMATIONS');

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

  const indexOrdre =
    entetes.indexOf('ORDRE');

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
      return {
        libelle: String(
          ligne[indexLibelle] || ''
        ).trim(),
        ordre: indexOrdre === -1
          ? 999999
          : Number(ligne[indexOrdre]) || 999999
      };
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
    })
    .map(function (formation) {
      return formation.libelle;
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
  const feuille = assurerFeuilleMigration_(
    classeur,
    CONFIG_STAGIAIRES.feuille
  );

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


function obtenirFeuilleStagiairesLecture_() {
  return obtenirFeuilleLecturePure_(
    SpreadsheetApp.getActiveSpreadsheet(),
    CONFIG_STAGIAIRES.feuille,
    CONFIG_STAGIAIRES.colonnes
  );
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
      index.DATE_CHANGEMENT_STATUT_AUTO + 1
    )
    .setNumberFormat('dd/mm/yyyy hh:mm');

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
