'use strict';

/**
 * Construit en une seule lecture le tableau de bord d'accueil.
 * Aucune donnée n'est créée ou modifiée par cette fonction.
 */
function getDonneesTableauBordAccueil(jetonUtilisateur) {
  const sessionUtilisateur = exigerUtilisateurAuthentifie_(
    jetonUtilisateur
  );
  synchroniserStatutsStagiaires_();

  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tables = {};

  [
    'STAGIAIRES',
    'SESSIONS',
    'PRESENCES_STAGIAIRES',
    'PRESTATIONS_FORMATEURS',
    'FORMATEURS',
    'CATEGORIES',
    'REFERENTIEL',
    'EVALUATIONS'
  ].forEach(function (nomFeuille) {
    tables[nomFeuille] = lireTableAccueil_(
      classeur,
      nomFeuille
    );
  });

  const aujourdHui = new Date();
  aujourdHui.setHours(12, 0, 0, 0);

  const debutMois = new Date(
    aujourdHui.getFullYear(),
    aujourdHui.getMonth(),
    1,
    12,
    0,
    0
  );

  const stagiaires = lireStagiairesAccueil_(
    tables.STAGIAIRES
  );

  const stagiairesParId = {};

  stagiaires.forEach(function (stagiaire) {
    stagiairesParId[stagiaire.idStagiaire] = stagiaire;
  });

  const formateursParId = lireFormateursAccueil_(
    tables.FORMATEURS
  );

  const sessions = lireSessionsAccueil_(
    tables.SESSIONS,
    aujourdHui
  );

  const sessionsParId = {};

  sessions.forEach(function (session) {
    sessionsParId[session.idSession] = session;
  });

  const presences = lirePresencesAccueil_(
    tables.PRESENCES_STAGIAIRES,
    sessionsParId
  );

  const prestations = lirePrestationsAccueil_(
    tables.PRESTATIONS_FORMATEURS,
    sessionsParId
  );

  const itemsActifsParFormation =
    lireItemsActifsParFormationAccueil_(
      tables.CATEGORIES,
      tables.REFERENTIEL
    );

  const acquisParStagiaire = lireAcquisAccueil_(
    tables.EVALUATIONS
  );

  const progressionParStagiaire = {};

  stagiaires.forEach(function (stagiaire) {
    const idsItems = itemsActifsParFormation[
      stagiaire.formation
    ] || new Set();

    const idsAcquis = acquisParStagiaire[
      stagiaire.idStagiaire
    ] || new Set();

    let nombreAcquis = 0;

    idsItems.forEach(function (idItem) {
      if (idsAcquis.has(idItem)) {
        nombreAcquis++;
      }
    });

    progressionParStagiaire[stagiaire.idStagiaire] = {
      nombreItems: idsItems.size,
      nombreAcquis: nombreAcquis,
      pourcentage: idsItems.size
        ? Math.round(nombreAcquis / idsItems.size * 100)
        : 0
    };
  });

  const echeancesProches = stagiaires
    .filter(function (stagiaire) {
      if (
        !preparationOuverteAccueil_(stagiaire.statut) ||
        !stagiaire.dateStageObjet
      ) {
        return false;
      }

      const jours = differenceJoursAccueil_(
        stagiaire.dateStageObjet,
        aujourdHui
      );

      return jours >= 0 && jours < 30;
    })
    .map(function (stagiaire) {
      const progression = progressionParStagiaire[
        stagiaire.idStagiaire
      ];

      return {
        idStagiaire: stagiaire.idStagiaire,
        nom: stagiaire.nom,
        prenom: stagiaire.prenom,
        formation: stagiaire.formation,
        dateStage: convertirDateAccueil_(
          stagiaire.dateStageObjet
        ),
        joursRestants: differenceJoursAccueil_(
          stagiaire.dateStageObjet,
          aujourdHui
        ),
        progression: progression.pourcentage
      };
    })
    .sort(function (a, b) {
      return (
        a.joursRestants - b.joursRestants ||
        a.nom.localeCompare(
          b.nom,
          'fr',
          { sensitivity: 'base' }
        )
      );
    });

  const alertesPedagogiques = [];

  stagiaires
    .filter(function (stagiaire) {
      return preparationOuverteAccueil_(stagiaire.statut);
    })
    .forEach(function (stagiaire) {
      const progression = progressionParStagiaire[
        stagiaire.idStagiaire
      ];

      const joursAvantStage = stagiaire.dateStageObjet
        ? differenceJoursAccueil_(
          stagiaire.dateStageObjet,
          aujourdHui
        )
        : null;

      if (
        joursAvantStage !== null &&
        joursAvantStage >= 0 &&
        joursAvantStage < 30 &&
        progression.pourcentage < 50
      ) {
        alertesPedagogiques.push(
          creerAlerteAccueil_(
            stagiaire,
            'progression',
            'Échéance proche avec une progression inférieure à 50 %',
            progression.pourcentage,
            joursAvantStage
          )
        );
      }

      const derniereSession = presences
        .derniereSessionParStagiaire[
          stagiaire.idStagiaire
        ];

      const dateReferenceInactivite = derniereSession ||
        stagiaire.dateDebutPreparationObjet;

      if (dateReferenceInactivite) {
        const joursSansSession = differenceJoursAccueil_(
          aujourdHui,
          dateReferenceInactivite
        );

        if (joursSansSession > 30) {
          alertesPedagogiques.push(
            creerAlerteAccueil_(
              stagiaire,
              'inactivite',
              derniereSession
                ? 'Aucune séance depuis plus de 30 jours'
                : 'Aucune séance depuis le début de la préparation',
              progression.pourcentage,
              joursSansSession
            )
          );
        }
      }

      if (
        progression.nombreItems > 0 &&
        progression.nombreAcquis === 0
      ) {
        alertesPedagogiques.push(
          creerAlerteAccueil_(
            stagiaire,
            'aucun_acquis',
            'Aucun item pédagogique n’est encore acquis',
            progression.pourcentage,
            progression.nombreItems
          )
        );
      }
    });

  const prioritesAlertes = {
    progression: 0,
    inactivite: 1,
    aucun_acquis: 2
  };

  alertesPedagogiques.sort(function (a, b) {
    return (
      prioritesAlertes[a.type] -
        prioritesAlertes[b.type] ||
      a.nom.localeCompare(
        b.nom,
        'fr',
        { sensitivity: 'base' }
      )
    );
  });

  const prestationsParSession = {};

  prestations.lignes.forEach(function (prestation) {
    if (!prestationsParSession[prestation.idSession]) {
      prestationsParSession[prestation.idSession] = [];
    }

    prestationsParSession[prestation.idSession].push(
      prestation
    );
  });

  const dernieresSessions = sessions
    .filter(function (session) {
      return session.realisee;
    })
    .sort(function (a, b) {
      return (
        b.dateObjet - a.dateObjet ||
        String(b.heureDebut).localeCompare(
          String(a.heureDebut)
        )
      );
    })
    .slice(0, 5)
    .map(function (session) {
      const idsStagiaires = presences.idsParSession[
        session.idSession
      ] || new Set();

      const nomsStagiaires = [...idsStagiaires]
        .map(function (idStagiaire) {
          const stagiaire = stagiairesParId[idStagiaire];

          return stagiaire
            ? [stagiaire.prenom, stagiaire.nom]
              .filter(Boolean)
              .join(' ')
            : 'Stagiaire non identifié';
        })
        .sort(function (a, b) {
          return a.localeCompare(
            b,
            'fr',
            { sensitivity: 'base' }
          );
        });

      const nomsFormateurs = [
        ...new Set(
          (prestationsParSession[session.idSession] || [])
            .map(function (prestation) {
              return formateursParId[
                prestation.idFormateur
              ] || 'Formateur non identifié';
            })
        )
      ].sort(function (a, b) {
        return a.localeCompare(
          b,
          'fr',
          { sensitivity: 'base' }
        );
      });

      return {
        idSession: session.idSession,
        date: convertirDateAccueil_(session.dateObjet),
        formation: session.formation,
        formateurs: nomsFormateurs,
        stagiaires: nomsStagiaires,
        dureeHeures: session.dureeHeures
      };
    });

  const indemnisationsParFormateur = {};

  prestations.lignes
    .filter(function (prestation) {
      return prestation.statut === 'À demander';
    })
    .forEach(function (prestation) {
      const idFormateur = prestation.idFormateur ||
        'formateur-inconnu';

      if (!indemnisationsParFormateur[idFormateur]) {
        indemnisationsParFormateur[idFormateur] = {
          idFormateur: prestation.idFormateur,
          formateur: formateursParId[prestation.idFormateur] ||
            'Formateur non identifié',
          nombrePrestations: 0,
          totalHeures: 0
        };
      }

      indemnisationsParFormateur[
        idFormateur
      ].nombrePrestations++;

      indemnisationsParFormateur[
        idFormateur
      ].totalHeures += prestation.dureeHeures;
    });

  const indemnisationsEnAttente = Object.keys(
    indemnisationsParFormateur
  ).map(function (idFormateur) {
    const groupe = indemnisationsParFormateur[idFormateur];

    groupe.totalHeures = Math.round(
      groupe.totalHeures * 100
    ) / 100;

    return groupe;
  }).sort(function (a, b) {
    return (
      b.nombrePrestations - a.nombrePrestations ||
      a.formateur.localeCompare(
        b.formateur,
        'fr',
        { sensitivity: 'base' }
      )
    );
  });

  const sessionsDuMois = sessions.filter(
    function (session) {
      return (
        session.realisee &&
        session.dateObjet >= debutMois
      );
    }
  );

  const idsSessionsDuMois = new Set(
    sessionsDuMois.map(function (session) {
      return session.idSession;
    })
  );

  const heuresFormateursMois = prestations.lignes.reduce(
    function (total, prestation) {
      return idsSessionsDuMois.has(prestation.idSession)
        ? total + prestation.dureeHeures
        : total;
    },
    0
  );

  return {
    indicateurs: {
      stagiairesAPreparer: stagiaires.filter(
        function (stagiaire) {
          return normaliserTexteAccueil_(stagiaire.statut) ===
            'A_PREPARER';
        }
      ).length,
      stagiairesEnPreparation: stagiaires.filter(
        function (stagiaire) {
          return normaliserTexteAccueil_(stagiaire.statut) ===
            'EN_PREPARATION';
        }
      ).length,
      stagesAujourdhui: stagiaires.filter(
        function (stagiaire) {
          return normaliserTexteAccueil_(stagiaire.statut) ===
            'STAGE_AUJOURD_HUI';
        }
      ).length,
      stagesPassesNonClotures: stagiaires.filter(
        function (stagiaire) {
          return normaliserTexteAccueil_(stagiaire.statut) ===
            'STAGE_PASSE';
        }
      ).length,
      sessionsMois: sessionsDuMois.length,
      heuresFormateursMois: Math.round(
        (sessionUtilisateur.estAdministrateur
          ? heuresFormateursMois
          : 0) * 100
      ) / 100,
      prestationsADemander: prestations.lignes.filter(
        function (prestation) {
          return (
            sessionUtilisateur.estAdministrateur &&
            prestation.statut === 'À demander'
          );
        }
      ).length
    },
    echeancesProches: echeancesProches,
    alertesPedagogiques: alertesPedagogiques,
    dernieresSessions: dernieresSessions,
    indemnisationsEnAttente:
      sessionUtilisateur.estAdministrateur
        ? indemnisationsEnAttente
        : [],
    dateActualisation: convertirDateHeureAccueil_(new Date())
  };
}


function lireStagiairesAccueil_(table) {
  const index = table.index;
  const colonneId = trouverColonneAccueil_(
    index,
    ['UUID', 'ID_STAGIAIRE']
  );

  if (colonneId === null) {
    return [];
  }

  return table.lignes.map(function (ligne) {
    const idStagiaire = String(
      ligne[colonneId] || ''
    ).trim();

    if (!idStagiaire) {
      return null;
    }

    return {
      idStagiaire: idStagiaire,
      nom: valeurAccueil_(ligne, index, 'NOM'),
      prenom: valeurAccueil_(ligne, index, 'PRENOM'),
      formation: valeurAccueil_(ligne, index, 'FORMATION'),
      statut: valeurAccueil_(ligne, index, 'STATUT') ||
        'À préparer',
      dateDebutPreparationObjet: convertirObjetDateAccueil_(
        valeurBruteAccueil_(
          ligne,
          index,
          'DATE_DEBUT_PREPARATION'
        )
      ),
      dateStageObjet: convertirObjetDateAccueil_(
        valeurBruteAccueil_(ligne, index, 'DATE_STAGE')
      )
    };
  }).filter(Boolean);
}


function lireFormateursAccueil_(table) {
  const index = table.index;
  const colonneId = trouverColonneAccueil_(
    index,
    ['ID_FORMATEUR', 'UUID']
  );
  const resultat = {};

  if (colonneId === null) {
    return resultat;
  }

  table.lignes.forEach(function (ligne) {
    const idFormateur = String(
      ligne[colonneId] || ''
    ).trim();

    if (!idFormateur) {
      return;
    }

    resultat[idFormateur] = [
      valeurAccueil_(ligne, index, 'PRENOM'),
      valeurAccueil_(ligne, index, 'NOM')
    ].filter(Boolean).join(' ');
  });

  return resultat;
}


function lireSessionsAccueil_(table, aujourdHui) {
  const index = table.index;

  if (!Number.isInteger(index.ID_SESSION)) {
    return [];
  }

  const idsVus = new Set();

  return table.lignes.map(function (ligne) {
    const idSession = String(
      ligne[index.ID_SESSION] || ''
    ).trim();

    if (!idSession || idsVus.has(idSession)) {
      return null;
    }

    idsVus.add(idSession);

    const dateObjet = convertirObjetDateAccueil_(
      valeurBruteAccueil_(ligne, index, 'DATE_SESSION')
    );

    if (!dateObjet) {
      return null;
    }

    return {
      idSession: idSession,
      dateObjet: dateObjet,
      realisee: dateObjet <= aujourdHui,
      heureDebut: convertirHeureAccueil_(
        valeurBruteAccueil_(ligne, index, 'HEURE_DEBUT')
      ),
      formation: valeurAccueil_(ligne, index, 'FORMATION'),
      dureeHeures: convertirNombreAccueil_(
        valeurBruteAccueil_(ligne, index, 'DUREE_HEURES')
      )
    };
  }).filter(Boolean);
}


function lirePresencesAccueil_(table, sessionsParId) {
  const index = table.index;
  const idsParSession = {};
  const derniereSessionParStagiaire = {};

  if (
    !Number.isInteger(index.ID_SESSION) ||
    !Number.isInteger(index.ID_STAGIAIRE)
  ) {
    return {
      idsParSession: idsParSession,
      derniereSessionParStagiaire:
        derniereSessionParStagiaire
    };
  }

  table.lignes.forEach(function (ligne) {
    const idSession = String(
      ligne[index.ID_SESSION] || ''
    ).trim();
    const idStagiaire = String(
      ligne[index.ID_STAGIAIRE] || ''
    ).trim();

    if (!idSession || !idStagiaire) {
      return;
    }

    if (!idsParSession[idSession]) {
      idsParSession[idSession] = new Set();
    }

    idsParSession[idSession].add(idStagiaire);

    const session = sessionsParId[idSession];

    if (
      session &&
      session.realisee &&
      (
        !derniereSessionParStagiaire[idStagiaire] ||
        session.dateObjet >
          derniereSessionParStagiaire[idStagiaire]
      )
    ) {
      derniereSessionParStagiaire[idStagiaire] =
        session.dateObjet;
    }
  });

  return {
    idsParSession: idsParSession,
    derniereSessionParStagiaire:
      derniereSessionParStagiaire
  };
}


function lirePrestationsAccueil_(table, sessionsParId) {
  const index = table.index;
  const lignes = [];
  const idsVus = new Set();

  if (
    !Number.isInteger(index.ID_SESSION) ||
    !Number.isInteger(index.ID_FORMATEUR)
  ) {
    return { lignes: lignes };
  }

  table.lignes.forEach(function (ligne, position) {
    const idPrestation = Number.isInteger(index.ID_PRESTATION)
      ? String(ligne[index.ID_PRESTATION] || '').trim()
      : '';

    const cleUnique = idPrestation ||
      'ligne-prestation-' + position;

    if (idsVus.has(cleUnique)) {
      return;
    }

    idsVus.add(cleUnique);

    const idSession = String(
      ligne[index.ID_SESSION] || ''
    ).trim();
    const idFormateur = String(
      ligne[index.ID_FORMATEUR] || ''
    ).trim();

    if (!idSession || !idFormateur) {
      return;
    }

    lignes.push({
      idPrestation: idPrestation,
      idSession: idSession,
      idFormateur: idFormateur,
      dureeHeures: convertirNombreAccueil_(
        valeurBruteAccueil_(
          ligne,
          index,
          'DUREE_HEURES'
        ) || (
          sessionsParId[idSession]
            ? sessionsParId[idSession].dureeHeures
            : 0
        )
      ),
      statut: normaliserStatutIndemnisationAccueil_(
        valeurAccueil_(
          ligne,
          index,
          'STATUT_INDEMNISATION'
        )
      )
    });
  });

  return { lignes: lignes };
}


function lireItemsActifsParFormationAccueil_(
  tableCategories,
  tableItems
) {
  const indexCategories = tableCategories.index;
  const categoriesActives = new Set();

  if (
    Number.isInteger(indexCategories.ID_CATEGORIE) &&
    Number.isInteger(indexCategories.ACTIF)
  ) {
    tableCategories.lignes.forEach(function (ligne) {
      const idCategorie = String(
        ligne[indexCategories.ID_CATEGORIE] || ''
      ).trim();

      if (
        idCategorie &&
        convertirBooleenAccueil_(
          ligne[indexCategories.ACTIF]
        )
      ) {
        categoriesActives.add(idCategorie);
      }
    });
  }

  const indexItems = tableItems.index;
  const resultat = {};

  if (
    !Number.isInteger(indexItems.ID_ITEM) ||
    !Number.isInteger(indexItems.FORMATION) ||
    !Number.isInteger(indexItems.ID_CATEGORIE) ||
    !Number.isInteger(indexItems.ACTIF)
  ) {
    return resultat;
  }

  tableItems.lignes.forEach(function (ligne) {
    const idItem = String(
      ligne[indexItems.ID_ITEM] || ''
    ).trim();
    const formation = String(
      ligne[indexItems.FORMATION] || ''
    ).trim();
    const idCategorie = String(
      ligne[indexItems.ID_CATEGORIE] || ''
    ).trim();

    if (
      !idItem ||
      !formation ||
      !categoriesActives.has(idCategorie) ||
      !convertirBooleenAccueil_(ligne[indexItems.ACTIF])
    ) {
      return;
    }

    if (!resultat[formation]) {
      resultat[formation] = new Set();
    }

    resultat[formation].add(idItem);
  });

  return resultat;
}


function lireAcquisAccueil_(table) {
  const index = table.index;
  const resultat = {};

  if (
    !Number.isInteger(index.ID_STAGIAIRE) ||
    !Number.isInteger(index.ID_ITEM)
  ) {
    return resultat;
  }

  table.lignes.forEach(function (ligne) {
    const acquis = (
      Number.isInteger(index.ACQUIS) &&
      convertirBooleenAccueil_(ligne[index.ACQUIS])
    ) || (
      Number.isInteger(index.NIVEAU) &&
      normaliserTexteAccueil_(ligne[index.NIVEAU]) ===
        'ACQUIS'
    );

    if (!acquis) {
      return;
    }

    const idStagiaire = String(
      ligne[index.ID_STAGIAIRE] || ''
    ).trim();
    const idItem = String(
      ligne[index.ID_ITEM] || ''
    ).trim();

    if (!idStagiaire || !idItem) {
      return;
    }

    if (!resultat[idStagiaire]) {
      resultat[idStagiaire] = new Set();
    }

    resultat[idStagiaire].add(idItem);
  });

  return resultat;
}


function creerAlerteAccueil_(
  stagiaire,
  type,
  message,
  progression,
  valeur
) {
  return {
    idStagiaire: stagiaire.idStagiaire,
    nom: stagiaire.nom,
    prenom: stagiaire.prenom,
    formation: stagiaire.formation,
    type: type,
    message: message,
    progression: progression,
    valeur: valeur
  };
}


function lireTableAccueil_(classeur, nomFeuille) {
  const feuille = classeur.getSheetByName(nomFeuille);

  if (!feuille || feuille.getLastRow() < 1) {
    return { index: {}, lignes: [] };
  }

  const donnees = feuille.getDataRange().getValues();

  return {
    index: creerIndexAccueil_(donnees[0]),
    lignes: donnees.slice(1)
  };
}


function creerIndexAccueil_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserTexteAccueil_(entete)] = position;
  });

  return index;
}


function trouverColonneAccueil_(index, noms) {
  for (let i = 0; i < noms.length; i++) {
    if (Number.isInteger(index[noms[i]])) {
      return index[noms[i]];
    }
  }

  return null;
}


function valeurBruteAccueil_(ligne, index, colonne) {
  return Number.isInteger(index[colonne])
    ? ligne[index[colonne]]
    : '';
}


function valeurAccueil_(ligne, index, colonne) {
  return String(
    valeurBruteAccueil_(ligne, index, colonne) || ''
  ).trim();
}


function normaliserTexteAccueil_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function convertirBooleenAccueil_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }

  return [
    'OUI',
    'TRUE',
    '1',
    'ACTIF',
    'ACTIVE',
    'ACQUIS'
  ].includes(normaliserTexteAccueil_(valeur));
}


function normaliserStatutIndemnisationAccueil_(valeur) {
  const statuts = {
    A_DEMANDER: 'À demander',
    DEMANDE_ENVOYEE: 'Demande envoyée',
    INDEMNISEE: 'Indemnisée',
    A_CORRIGER: 'À corriger'
  };

  const normalise = normaliserTexteAccueil_(valeur);

  if (!normalise) {
    return 'À demander';
  }

  return statuts[normalise] || String(valeur).trim();
}


function preparationOuverteAccueil_(statut) {
  return ![
    'CLOTURE',
    'ABANDON',
    'PREPARATION_TERMINEE',
    'PREPARATION_ABANDONNEE'
  ].includes(normaliserTexteAccueil_(statut));
}


function convertirObjetDateAccueil_(valeur) {
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
    const parties = String(valeur).split('-');

    if (parties.length === 3) {
      date = new Date(
        Number(parties[0]),
        Number(parties[1]) - 1,
        Number(parties[2]),
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


function differenceJoursAccueil_(dateFin, dateDebut) {
  return Math.round(
    (dateFin.getTime() - dateDebut.getTime()) /
    (24 * 60 * 60 * 1000)
  );
}


function convertirDateAccueil_(date) {
  if (!date) {
    return '';
  }

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
}


function convertirDateHeureAccueil_(date) {
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'dd/MM/yyyy HH:mm'
  );
}


function convertirHeureAccueil_(valeur) {
  if (!valeur) {
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


function convertirNombreAccueil_(valeur) {
  if (typeof valeur === 'number') {
    return isNaN(valeur) ? 0 : valeur;
  }

  const nombre = Number(
    String(valeur || '').trim().replace(',', '.')
  );

  return isNaN(nombre) ? 0 : nombre;
}
