'use strict';

const FEUILLES_REINITIALISATION_PRODUCTION_ = [
  { feuille: 'STAGIAIRES', cle: 'stagiaires' },
  { feuille: 'FORMATEURS', cle: 'formateurs' },
  { feuille: 'UTILISATEURS', cle: 'utilisateurs' },
  { feuille: 'SESSIONS', cle: 'sessions' },
  { feuille: 'PRESENCES_STAGIAIRES', cle: 'presences' },
  { feuille: 'PRESTATIONS_FORMATEURS', cle: 'prestations' },
  { feuille: 'ITEMS_SESSIONS', cle: 'itemsSessions' },
  { feuille: 'EVALUATIONS', cle: 'evaluations' },
  {
    feuille: 'HISTORIQUE_INDEMNISATIONS',
    cle: 'historiqueIndemnisations'
  },
  {
    feuille: 'HISTORIQUE_ENVOIS_INDEMNISATIONS',
    cle: 'historiqueEnvoisIndemnisations'
  },
  { feuille: 'FAVORIS', cle: 'favoris' }
];

const FEUILLES_CONSERVEES_REINITIALISATION_PRODUCTION_ = [
  'PARAMETRES',
  'FORMATIONS',
  'CATEGORIES',
  'REFERENTIEL',
  'HISTORIQUE',
  'HISTORIQUE_IMPORTS_REFERENTIEL'
];

const DUREE_PREVISUALISATION_REINITIALISATION_MS_ = 10 * 60 * 1000;
const DUREE_CONFIRMATION_REINITIALISATION_MS_ = 2 * 60 * 1000;
const PREFIXE_PREVISUALISATION_REINITIALISATION_ =
  'PREPFORMATION_RESET_PREVIEW_';
const PREFIXE_CONFIRMATION_REINITIALISATION_ =
  'PREPFORMATION_RESET_CONFIRMATION_';
const CELLULES_MAX_SNAPSHOT_REINITIALISATION_ = 500000;


/**
 * Prépare une photographie en lecture seule des données qui seraient
 * supprimées. Seul le plan opaque et temporaire est mémorisé côté serveur.
 */
function previsualiserReinitialisationProduction(
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  exigerEcritureAutorisee_();
  const classeur = SpreadsheetApp.getActiveSpreadsheet();

  verifierAbsenceFeuillesTechniquesReinitialisation_(classeur);
  const etat = analyserEtatReinitialisationProduction_(classeur);
  verifierVolumeSnapshotReinitialisation_(etat.nombreCellulesSnapshot);

  const previewId = creerSecretAleatoireSecurite_();
  const maintenant = Date.now();
  const expireA = maintenant +
    DUREE_PREVISUALISATION_REINITIALISATION_MS_;
  const plan = {
    signatureEtat: etat.signatureEtat,
    compteurs: etat.compteurs,
    versionSchema: etat.versionSchema,
    adminSessionAuditId: session.identifiantHistorique,
    creeA: maintenant,
    expireA: expireA
  };

  enregistrerObjetTemporaireReinitialisation_(
    PREFIXE_PREVISUALISATION_REINITIALISATION_,
    previewId,
    plan,
    maintenant
  );

  return construirePrevisualisationReinitialisation_(
    previewId,
    expireA,
    etat
  );
}


/**
 * Revalide le mot de passe et transforme la prévisualisation en jeton
 * opaque à usage unique. Aucune donnée métier n'est modifiée ici.
 */
function confirmerReinitialisationProduction(
  previewId,
  texteConfirmation,
  motDePasse,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  exigerEcritureAutorisee_();

  if (
    String(texteConfirmation || '').trim() !==
      'MISE EN PRODUCTION'
  ) {
    throw new Error('Saisis exactement MISE EN PRODUCTION.');
  }

  const identifiant = verifierIdentifiantTemporaireReinitialisation_(
    previewId
  );
  const proprietes = PropertiesService.getScriptProperties();
  const verrou = LockService.getScriptLock();
  const maintenant = Date.now();
  let plan;
  let confirmationId = '';
  let expireA = 0;
  let motDePasseIncorrect = false;

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le service de confirmation est momentanément occupé.'
    );
  }

  try {
    nettoyerObjetsTemporairesReinitialisation_(proprietes, maintenant);
    const clePlan = PREFIXE_PREVISUALISATION_REINITIALISATION_ +
      hacherIdentifiantReinitialisation_(identifiant);
    const valeur = proprietes.getProperty(clePlan);

    if (!valeur) {
      throw new Error(
        'La prévisualisation est expirée ou a déjà été consommée.'
      );
    }

    plan = lireJsonReinitialisation_(valeur);
    if (
      !plan ||
      Number(plan.expireA || 0) <= maintenant ||
      plan.adminSessionAuditId !== session.identifiantHistorique
    ) {
      throw new Error(
        'La prévisualisation est expirée ou ne correspond pas à cette session.'
      );
    }

    if (!revaliderMotDePasseAdministrateur_(motDePasse)) {
      motDePasseIncorrect = true;
    } else {
      proprietes.deleteProperty(clePlan);
      confirmationId = creerSecretAleatoireSecurite_();
      expireA = maintenant + DUREE_CONFIRMATION_REINITIALISATION_MS_;
      proprietes.setProperty(
        PREFIXE_CONFIRMATION_REINITIALISATION_ +
          hacherIdentifiantReinitialisation_(confirmationId),
        JSON.stringify({
          plan: plan,
          adminSessionAuditId: session.identifiantHistorique,
          creeA: maintenant,
          expireA: expireA
        })
      );
    }
  } finally {
    verrou.releaseLock();
  }

  if (motDePasseIncorrect) {
    journaliserEvenementSecuriteSansBloquer_(
      'REINITIALISATION_PRODUCTION_CONFIRMATION_REFUSEE',
      'BASE_METIER',
      'MISE_EN_PRODUCTION',
      { raison: 'MOT_DE_PASSE_INCORRECT' },
      session.identifiantHistorique
    );
    throw new Error('Mot de passe administrateur incorrect.');
  }

  return {
    confirmationId: confirmationId,
    expiresAt: new Date(expireA).toISOString()
  };
}


/**
 * Consomme atomiquement la confirmation puis exécute la remise à zéro sous
 * la barrière et le DocumentLock de toutes les mutations métier.
 */
function executerReinitialisationProductionConfirmee(
  confirmationId,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const confirmation = consommerConfirmationReinitialisation_(
    confirmationId,
    session
  );
  const operationId = Utilities.getUuid();

  try {
    return executerMutationMetier_(function () {
      return executerReinitialisationProductionInterne_(
        confirmation.plan,
        session,
        jetonAdministrateur,
        operationId
      );
    });
  } catch (erreur) {
    journaliserEvenementSecuriteSansBloquer_(
      'REINITIALISATION_PRODUCTION_ECHEC',
      'BASE_METIER',
      operationId,
      {
        resultat: 'ECHEC',
        message: String(erreur.message || erreur).slice(0, 1000)
      },
      session.identifiantHistorique
    );
    throw erreur;
  }
}


function executerReinitialisationProductionInterne_(
  plan,
  session,
  jetonAdministrateur,
  operationId
) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  verifierAbsenceFeuillesTechniquesReinitialisation_(classeur);
  const etatAvant = analyserEtatReinitialisationProduction_(classeur);

  if (
    etatAvant.signatureEtat !== plan.signatureEtat ||
    Number(etatAvant.versionSchema) !== Number(plan.versionSchema)
  ) {
    throw new Error(
      'Les données ont changé depuis la prévisualisation. Relance la prévisualisation avant de confirmer.'
    );
  }

  verifierVolumeSnapshotReinitialisation_(
    etatAvant.nombreCellulesSnapshot
  );

  const sauvegarde = creerSauvegardeCompleteInterne_(
    'Sauvegarde automatique avant mise en production',
    TYPE_SAUVEGARDE_AVANT_REINITIALISATION_PRODUCTION_,
    session,
    jetonAdministrateur,
    true
  );

  if (!sauvegarde || sauvegarde.verificationIntegrite !== true) {
    throw new Error(
      'La sauvegarde préalable n’a pas pu être vérifiée. Réinitialisation annulée.'
    );
  }

  // La sauvegarde journalise sa propre création dans HISTORIQUE. Cette
  // nouvelle trace est légitime et devient l'état conservé de référence.
  etatAvant.signaturesConservees =
    calculerSignaturesConserveesReinitialisation_(classeur);

  const instantanes = capturerInstantanesReinitialisation_(classeur);
  const photosMisesCorbeille = [];
  const avertissementsPhotos = [];
  let suppressionsCommencees = false;

  try {
    suppressionsCommencees = true;
    viderFeuillesMetierReinitialisation_(instantanes);
    SpreadsheetApp.flush();
    verifierFeuillesMetierVidesReinitialisation_(classeur);

    placerPhotosStagiairesCorbeilleReinitialisation_(
      etatAvant.photos,
      photosMisesCorbeille,
      avertissementsPhotos
    );

    const validation = validerEtatFinalReinitialisation_(
      classeur,
      etatAvant
    );

    journaliserActionSensible_(
      'REINITIALISATION_PRODUCTION_REUSSIE',
      'BASE_METIER',
      operationId,
      {
        sauvegarde: sauvegarde.backupId,
        compteursAvant: etatAvant.compteurs,
        compteursApres: validation.compteursApres,
        photosCorbeille: photosMisesCorbeille.length,
        avertissementsPhotos: avertissementsPhotos,
        diagnosticConforme: validation.diagnostic.resume.conforme,
        referentielConserve: true,
        resultat: 'SUCCES'
      },
      session.identifiantHistorique
    );

    invaliderCachesApresReinitialisation_();

    return {
      succes: true,
      message: 'Base métier réinitialisée avec succès',
      operationId: operationId,
      backupId: sauvegarde.backupId,
      compteursSupprimes: etatAvant.compteurs,
      compteursApres: validation.compteursApres,
      photosMisesCorbeille: photosMisesCorbeille.length,
      avertissementsPhotos: avertissementsPhotos,
      diagnostic: resumerDiagnosticReinitialisation_(
        validation.diagnostic
      ),
      referentielConserve: true,
      versionSchema: validation.versionSchema,
      feuillesConservees:
        FEUILLES_CONSERVEES_REINITIALISATION_PRODUCTION_.slice()
    };
  } catch (erreurReinitialisation) {
    if (suppressionsCommencees) {
      try {
        // Les photos sont rétablies avant les lignes STAGIAIRES : même si
        // Drive refuse le rollback, aucun stagiaire restauré ne référence
        // alors un fichier encore placé dans la corbeille.
        restaurerPhotosReinitialisation_(photosMisesCorbeille);
        restaurerInstantanesReinitialisation_(instantanes);
        SpreadsheetApp.flush();
        verifierRollbackReinitialisation_(instantanes);
        if (typeof invaliderGenerationSourcesStatuts_ === 'function') {
          invaliderGenerationSourcesStatuts_(
            [
              'STAGIAIRES',
              'SESSIONS',
              'PRESENCES_STAGIAIRES'
            ],
            'ROLLBACK_REINITIALISATION_PRODUCTION'
          );
        }
      } catch (erreurRollback) {
        throw new Error(
          'La réinitialisation a échoué et le rollback automatique est incomplet. La sauvegarde ' +
          sauvegarde.backupId +
          ' doit être restaurée avant toute nouvelle écriture. Erreur initiale : ' +
          String(erreurReinitialisation.message || erreurReinitialisation) +
          '. Erreur rollback : ' +
          String(erreurRollback.message || erreurRollback)
        );
      }
    }

    journaliserEvenementSecuriteSansBloquer_(
      'REINITIALISATION_PRODUCTION_ROLLBACK',
      'BASE_METIER',
      operationId,
      {
        sauvegarde: sauvegarde.backupId,
        compteursAvant: etatAvant.compteurs,
        resultat: 'ECHEC_ROLLBACK_TERMINE',
        message: String(
          erreurReinitialisation.message || erreurReinitialisation
        ).slice(0, 1000)
      },
      session.identifiantHistorique
    );
    throw erreurReinitialisation;
  }
}


function analyserEtatReinitialisationProduction_(classeur) {
  const compteurs = {};
  let nombreCellulesSnapshot = 0;

  FEUILLES_REINITIALISATION_PRODUCTION_.forEach(
    function (configuration) {
      const feuille = obtenirFeuilleReinitialisation_(
        classeur,
        configuration.feuille
      );
      const matrice = lireMatriceAvecFormulesReinitialisation_(feuille);
      compteurs[configuration.cle] = compterLignesRenseigneesReinitialisation_(
        matrice
      );
      nombreCellulesSnapshot += matrice.length *
        (matrice[0] ? matrice[0].length : 0);
    }
  );

  compteurs.historiquesIndemnisation =
    Number(compteurs.historiqueIndemnisations || 0) +
    Number(compteurs.historiqueEnvoisIndemnisations || 0);

  const photos = listerPhotosReinitialisation_(classeur);
  const diagnostic = construireRapportIntegrite_(classeur);
  const feuillesReinitialisees = new Set(
    FEUILLES_REINITIALISATION_PRODUCTION_.map(function (configuration) {
      return configuration.feuille;
    })
  );
  const referencesOrphelines = (diagnostic.erreurs || []).filter(
    function (erreur) {
      return erreur.type === 'REFERENCE_INCOHERENTE' &&
        feuillesReinitialisees.has(erreur.feuille);
    }
  );
  const versionSchema = lireVersionSchemaSansCreation_(classeur);
  const signaturesConservees =
    calculerSignaturesConserveesReinitialisation_(classeur);

  return {
    compteurs: compteurs,
    photos: photos,
    nombrePhotos: photos.length,
    referencesOrphelines: referencesOrphelines.map(function (erreur) {
      return {
        feuille: erreur.feuille,
        colonne: erreur.colonne,
        cible: erreur.cible,
        message: erreur.message
      };
    }),
    nombreCellulesSnapshot: nombreCellulesSnapshot,
    versionSchema: versionSchema,
    signaturesConservees: signaturesConservees,
    signatureEtat: calculerEmpreinteReinitialisation_({
      feuillesMetier: calculerSignaturesFeuillesMetierReinitialisation_(
        classeur
      ),
      feuillesConservees: signaturesConservees,
      versionSchema: versionSchema,
      feuillesTechniques: listerFeuillesTechniquesRestauration_(classeur)
    })
  };
}


function construirePrevisualisationReinitialisation_(
  previewId,
  expireA,
  etat
) {
  return {
    previewId: previewId,
    expiresAt: new Date(expireA).toISOString(),
    compteurs: etat.compteurs,
    photosStagiairesConcernees: etat.nombrePhotos,
    referencesOrphelines: etat.referencesOrphelines,
    nombreCellulesSnapshot: etat.nombreCellulesSnapshot,
    versionSchema: etat.versionSchema,
    feuillesReinitialisees:
      FEUILLES_REINITIALISATION_PRODUCTION_.map(function (configuration) {
        return configuration.feuille;
      }),
    feuillesConservees:
      FEUILLES_CONSERVEES_REINITIALISATION_PRODUCTION_.slice(),
    structuresConservees: [
      'Formations',
      'Catégories',
      'Référentiel',
      'Paramètres',
      'Sauvegardes Drive',
      'Configuration des sauvegardes automatiques',
      'Configuration des indemnisations',
      'Paramètres administrateur',
      'En-têtes, formats et protections des feuilles'
    ],
    confirmationRequise: 'MISE EN PRODUCTION',
    motDePasseRequis: true,
    sauvegardeObligatoire: true
  };
}


function capturerInstantanesReinitialisation_(classeur) {
  return FEUILLES_REINITIALISATION_PRODUCTION_.map(
    function (configuration) {
      const feuille = obtenirFeuilleReinitialisation_(
        classeur,
        configuration.feuille
      );
      const matrice = lireMatriceAvecFormulesReinitialisation_(feuille);
      return {
        feuille: feuille,
        nom: configuration.feuille,
        matrice: matrice,
        empreinte: calculerEmpreinteReinitialisation_(matrice)
      };
    }
  );
}


function viderFeuillesMetierReinitialisation_(instantanes) {
  instantanes.forEach(function (instantane) {
    const feuille = instantane.feuille;
    const nombreLignes = Math.max(0, feuille.getLastRow() - 1);
    if (nombreLignes) {
      feuille.getRange(
        2,
        1,
        nombreLignes,
        feuille.getLastColumn()
      ).clearContent();
    }
  });
}


function verifierFeuillesMetierVidesReinitialisation_(classeur) {
  FEUILLES_REINITIALISATION_PRODUCTION_.forEach(
    function (configuration) {
      const feuille = obtenirFeuilleReinitialisation_(
        classeur,
        configuration.feuille
      );
      const matrice = feuille.getDataRange().getValues();
      if (compterLignesRenseigneesReinitialisation_(matrice) !== 0) {
        throw new Error(
          'La feuille ' + configuration.feuille +
          ' contient encore des données après la suppression.'
        );
      }
    }
  );
}


function restaurerInstantanesReinitialisation_(instantanes) {
  instantanes.forEach(function (instantane) {
    const feuille = instantane.feuille;
    const nombreLignesActuelles = Math.max(0, feuille.getLastRow() - 1);
    const nombreLignesSnapshot = Math.max(0, instantane.matrice.length - 1);
    const nombreLignesANettoyer = Math.max(
      nombreLignesActuelles,
      nombreLignesSnapshot
    );

    if (nombreLignesANettoyer) {
      feuille.getRange(
        2,
        1,
        nombreLignesANettoyer,
        feuille.getLastColumn()
      ).clearContent();
    }
    if (nombreLignesSnapshot) {
      feuille.getRange(
        2,
        1,
        nombreLignesSnapshot,
        instantane.matrice[0].length
      ).setValues(instantane.matrice.slice(1));
    }
  });
}


function verifierRollbackReinitialisation_(instantanes) {
  instantanes.forEach(function (instantane) {
    const empreinte = calculerEmpreinteReinitialisation_(
      lireMatriceAvecFormulesReinitialisation_(instantane.feuille)
    );
    if (empreinte !== instantane.empreinte) {
      throw new Error(
        'Le rollback de la feuille ' + instantane.nom + ' est incomplet.'
      );
    }
  });
}


function placerPhotosStagiairesCorbeilleReinitialisation_(
  photos,
  photosMisesCorbeille,
  avertissements
) {
  (photos || []).forEach(function (photo) {
    let fichier;
    try {
      fichier = DriveApp.getFileById(photo.fileId);
    } catch (erreurFichier) {
      avertissements.push(
        'Photo indisponible pour le stagiaire ' + photo.uuid + '.'
      );
      return;
    }

    if (fichier.isTrashed()) {
      avertissements.push(
        'La photo du stagiaire ' + photo.uuid +
        ' était déjà dans la corbeille.'
      );
      return;
    }

    verifierFichierPhotoStagiaire_(fichier, photo.uuid, true);
    fichier.setTrashed(true);
    photosMisesCorbeille.push({
      uuid: photo.uuid,
      fileId: photo.fileId,
      fichier: fichier
    });
  });
}


function restaurerPhotosReinitialisation_(photosMisesCorbeille) {
  (photosMisesCorbeille || []).slice().reverse().forEach(function (photo) {
    photo.fichier.setTrashed(false);
    if (photo.fichier.isTrashed()) {
      throw new Error(
        'La photo du stagiaire ' + photo.uuid +
        ' n’a pas pu être restaurée depuis la corbeille.'
      );
    }
  });
}


function validerEtatFinalReinitialisation_(classeur, etatAvant) {
  verifierFeuillesMetierVidesReinitialisation_(classeur);
  const signaturesApres =
    calculerSignaturesConserveesReinitialisation_(classeur);

  Object.keys(etatAvant.signaturesConservees).forEach(function (nom) {
    if (
      signaturesApres[nom] !== etatAvant.signaturesConservees[nom]
    ) {
      throw new Error(
        'La structure conservée ' + nom +
        ' a été modifiée pendant la réinitialisation.'
      );
    }
  });

  const versionSchema = lireVersionSchemaSansCreation_(classeur);
  if (Number(versionSchema) !== Number(etatAvant.versionSchema)) {
    throw new Error('VERSION_SCHEMA a été modifiée pendant l’opération.');
  }

  verifierAbsenceFeuillesTechniquesReinitialisation_(classeur);
  const diagnostic = construireRapportIntegrite_(classeur);
  const feuillesMetier = new Set(
    FEUILLES_REINITIALISATION_PRODUCTION_.map(function (configuration) {
      return configuration.feuille;
    })
  );
  const erreursMetier = (diagnostic.erreurs || []).filter(
    function (erreur) {
      return feuillesMetier.has(erreur.feuille);
    }
  );
  if (erreursMetier.length) {
    throw new Error(
      'Le diagnostic final détecte encore des incohérences métier.'
    );
  }

  const compteursApres = {};
  FEUILLES_REINITIALISATION_PRODUCTION_.forEach(
    function (configuration) {
      compteursApres[configuration.cle] = 0;
    }
  );
  compteursApres.historiquesIndemnisation = 0;

  return {
    diagnostic: diagnostic,
    compteursApres: compteursApres,
    versionSchema: versionSchema
  };
}


function calculerSignaturesFeuillesMetierReinitialisation_(classeur) {
  const signatures = {};
  FEUILLES_REINITIALISATION_PRODUCTION_.forEach(
    function (configuration) {
      const feuille = obtenirFeuilleReinitialisation_(
        classeur,
        configuration.feuille
      );
      signatures[configuration.feuille] =
        calculerEmpreinteReinitialisation_(
          lireMatriceAvecFormulesReinitialisation_(feuille)
        );
    }
  );
  return signatures;
}


function calculerSignaturesConserveesReinitialisation_(classeur) {
  const signatures = {};
  FEUILLES_CONSERVEES_REINITIALISATION_PRODUCTION_.forEach(
    function (nom) {
      const feuille = obtenirFeuilleReinitialisation_(classeur, nom);
      signatures[nom] = calculerEmpreinteReinitialisation_(
        lireMatriceAvecFormulesReinitialisation_(feuille)
      );
    }
  );
  return signatures;
}


function listerPhotosReinitialisation_(classeur) {
  const feuille = obtenirFeuilleReinitialisation_(classeur, 'STAGIAIRES');
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexMigration_(donnees[0] || []);
  if (
    !Number.isInteger(index.UUID) ||
    !Number.isInteger(index.PHOTO_FILE_ID)
  ) {
    throw new Error(
      'Les colonnes UUID et PHOTO_FILE_ID sont obligatoires dans STAGIAIRES.'
    );
  }

  const ids = new Set();
  return donnees.slice(1).map(function (ligne) {
    const uuid = String(ligne[index.UUID] || '').trim();
    const fileId = String(ligne[index.PHOTO_FILE_ID] || '').trim();
    if (!uuid || !fileId || ids.has(fileId)) return null;
    ids.add(fileId);
    return { uuid: uuid, fileId: fileId };
  }).filter(Boolean);
}


function obtenirFeuilleReinitialisation_(classeur, nom) {
  const configuration = SCHEMA_BASE_.find(function (element) {
    return element.feuille === nom;
  });
  const feuille = classeur.getSheetByName(nom);
  if (!configuration || !feuille) {
    throw new Error('La feuille requise ' + nom + ' est absente.');
  }

  const entetes = feuille.getRange(
    1,
    1,
    1,
    feuille.getLastColumn()
  ).getValues()[0];
  const index = creerIndexMigration_(entetes);
  const manquantes = configuration.colonnes.filter(function (colonne) {
    return !Number.isInteger(index[normaliserMigration_(colonne)]);
  });
  if (manquantes.length) {
    throw new Error(
      'Colonnes absentes de ' + nom + ' : ' + manquantes.join(', ') + '.'
    );
  }
  return feuille;
}


function lireMatriceAvecFormulesReinitialisation_(feuille) {
  const plage = feuille.getDataRange();
  const valeurs = plage.getValues();
  const formules = plage.getFormulas();
  return valeurs.map(function (ligne, numeroLigne) {
    return ligne.map(function (valeur, numeroColonne) {
      return formules[numeroLigne][numeroColonne] || valeur;
    });
  });
}


function compterLignesRenseigneesReinitialisation_(matrice) {
  return (matrice || []).slice(1).filter(function (ligne) {
    return ligne.some(function (valeur) {
      return valeur !== '' && valeur !== null;
    });
  }).length;
}


function calculerEmpreinteReinitialisation_(valeur) {
  return hacherTexteSauvegarde_(canonicaliserSauvegarde_(valeur));
}


function verifierVolumeSnapshotReinitialisation_(nombreCellules) {
  if (Number(nombreCellules || 0) >
    CELLULES_MAX_SNAPSHOT_REINITIALISATION_) {
    throw new Error(
      'Le volume à réinitialiser dépasse la limite transactionnelle de ' +
      CELLULES_MAX_SNAPSHOT_REINITIALISATION_.toLocaleString('fr-FR') +
      ' cellules. Aucune donnée n’a été modifiée.'
    );
  }
}


function verifierAbsenceFeuillesTechniquesReinitialisation_(classeur) {
  const techniques = listerFeuillesTechniquesRestauration_(classeur);
  if (techniques.length) {
    throw new Error(
      'Des feuilles techniques de restauration sont présentes. Termine leur récupération avant la mise en production.'
    );
  }
}


function resumerDiagnosticReinitialisation_(diagnostic) {
  return {
    conforme: Boolean(diagnostic.resume && diagnostic.resume.conforme),
    totalErreurs: Number(
      diagnostic.resume && diagnostic.resume.totalErreurs || 0
    ),
    erreursStructure: Number(
      diagnostic.resume && diagnostic.resume.erreursStructure || 0
    ),
    referencesIncoherentes: Number(
      diagnostic.resume && diagnostic.resume.referencesIncoherentes || 0
    ),
    versionSchema: diagnostic.versionSchema,
    versionCible: diagnostic.versionCible,
    dateDiagnostic: diagnostic.dateDiagnostic
  };
}


function invaliderCachesApresReinitialisation_() {
  if (typeof invaliderGenerationSourcesStatuts_ === 'function') {
    invaliderGenerationSourcesStatuts_(
      [
        'STAGIAIRES',
        'SESSIONS',
        'PRESENCES_STAGIAIRES'
      ],
      'REINITIALISATION_PRODUCTION'
    );
  }
  try {
    if (typeof invaliderCacheStatistiques_ === 'function') {
      invaliderCacheStatistiques_();
    }
  } catch (erreurStatistiques) {
    console.error(erreurStatistiques);
  }
  try {
    if (typeof invaliderCacheCalendrier_ === 'function') {
      invaliderCacheCalendrier_();
    }
  } catch (erreurCalendrier) {
    console.error(erreurCalendrier);
  }
}


function enregistrerObjetTemporaireReinitialisation_(
  prefixe,
  identifiant,
  objet,
  maintenant
) {
  const proprietes = PropertiesService.getScriptProperties();
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(10000)) {
    throw new Error('Le service de prévisualisation est momentanément occupé.');
  }
  try {
    nettoyerObjetsTemporairesReinitialisation_(proprietes, maintenant);
    proprietes.setProperty(
      prefixe + hacherIdentifiantReinitialisation_(identifiant),
      JSON.stringify(objet)
    );
  } finally {
    verrou.releaseLock();
  }
}


function consommerConfirmationReinitialisation_(identifiant, session) {
  const opaque = verifierIdentifiantTemporaireReinitialisation_(identifiant);
  const proprietes = PropertiesService.getScriptProperties();
  const verrou = LockService.getScriptLock();
  const maintenant = Date.now();
  let confirmation;

  if (!verrou.tryLock(10000)) {
    throw new Error('Le service de confirmation est momentanément occupé.');
  }
  try {
    nettoyerObjetsTemporairesReinitialisation_(proprietes, maintenant);
    const cle = PREFIXE_CONFIRMATION_REINITIALISATION_ +
      hacherIdentifiantReinitialisation_(opaque);
    const valeur = proprietes.getProperty(cle);
    proprietes.deleteProperty(cle);
    if (!valeur) {
      throw new Error(
        'La confirmation est expirée ou a déjà été consommée.'
      );
    }
    confirmation = lireJsonReinitialisation_(valeur);
    if (
      !confirmation ||
      Number(confirmation.expireA || 0) <= maintenant ||
      confirmation.adminSessionAuditId !== session.identifiantHistorique
    ) {
      throw new Error(
        'La confirmation est expirée ou ne correspond pas à cette session.'
      );
    }
  } finally {
    verrou.releaseLock();
  }
  return confirmation;
}


function nettoyerObjetsTemporairesReinitialisation_(
  proprietes,
  maintenant
) {
  const toutes = proprietes.getProperties();
  Object.keys(toutes).forEach(function (cle) {
    if (
      !cle.startsWith(PREFIXE_PREVISUALISATION_REINITIALISATION_) &&
      !cle.startsWith(PREFIXE_CONFIRMATION_REINITIALISATION_)
    ) {
      return;
    }
    const valeur = lireJsonReinitialisation_(toutes[cle]);
    if (!valeur || Number(valeur.expireA || 0) <= maintenant) {
      proprietes.deleteProperty(cle);
    }
  });
}


function lireJsonReinitialisation_(valeur) {
  try {
    return JSON.parse(String(valeur || ''));
  } catch (erreur) {
    return null;
  }
}


function verifierIdentifiantTemporaireReinitialisation_(identifiant) {
  const valeur = String(identifiant || '').trim();
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(valeur)) {
    throw new Error('Identifiant temporaire de réinitialisation invalide.');
  }
  return valeur;
}


function hacherIdentifiantReinitialisation_(identifiant) {
  return hacherTexteSauvegarde_(
    'REINITIALISATION_PRODUCTION\u0000' + String(identifiant || '')
  );
}
