'use strict';

const DUREE_PLAN_RESTAURATION_MS_ = 10 * 60 * 1000;
const DUREE_CONFIRMATION_RESTAURATION_MS_ = 2 * 60 * 1000;
const PREFIXE_PLAN_RESTAURATION_ = 'PREPFORMATION_RESTORE_PREVIEW_';
const PREFIXE_CONFIRMATION_RESTAURATION_ =
  'PREPFORMATION_RESTORE_CONFIRMATION_';
const PROPRIETE_DERNIERE_RESTAURATION_ =
  'PREPFORMATION_RESTORE_LAST_OPERATION';
const PREFIXES_FEUILLES_TECHNIQUES_RESTAURATION_ = [
  '__PF_STG_',
  '__PF_RBK_',
  '__PF_BAD_'
];
const TAILLE_BLOC_ECRITURE_RESTAURATION_ = 1000;
const TAILLE_LOT_FORMAT_TEXTE_RESTAURATION_ = 500;
const STATUTS_RESTAURATION_AUTORISES_ = [
  'RESTAURABLE',
  'RESTAURABLE_AVEC_MIGRATIONS'
];


/**
 * Prépare une prévisualisation vérifiée et un identifiant opaque valable
 * dix minutes. Aucune feuille n'est modifiée ; seule la trace d'audit et
 * le plan temporaire privé sont écrits.
 */
function preparerRestaurationSauvegarde(
  backupId,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  exigerEcritureAutorisee_();
  verifierFeuillesTechniquesAvantRestauration_();
  const identifiant = nettoyerBackupIdSauvegarde_(backupId);
  const validation = chargerSauvegardeEtRapportRestauration_(
    identifiant
  );
  const rapport = validation.rapport;
  const maintenant = Date.now();
  const previewId = creerSecretAleatoireSecurite_();
  const expireA = maintenant + DUREE_PLAN_RESTAURATION_MS_;
  const plan = {
    backupId: identifiant,
    empreinteFichier: validation.resultat.empreinteFichier,
    dateRapport: rapport.testedAt,
    statutRapport: rapport.statut,
    versionApplicationTest: rapport.applicationVersionTest,
    versionSchemaCourante: rapport.schemaVersionCourante,
    versionSchemaSource: rapport.schemaVersionSauvegarde,
    versionSchemaCible: rapport.schemaVersionCible,
    migrations: (rapport.migrationsNecessaires || []).map(
      resumerMigrationRestauration_
    ),
    adminSessionAuditId: session.identifiantHistorique,
    journauxDifferes: [
      creerEvenementAuditRestauration_(
        'RESTAURATION_PREPARATION',
        identifiant,
        {
          statutRapport: rapport.statut,
          schemaSource: rapport.schemaVersionSauvegarde,
          schemaCible: rapport.schemaVersionCible,
          nombreMigrations: (
            rapport.migrationsNecessaires || []
          ).length,
          expirationMinutes: DUREE_PLAN_RESTAURATION_MS_ / 60000
        },
        session.identifiantHistorique
      )
    ],
    creeA: maintenant,
    expireA: expireA
  };
  const proprietes = PropertiesService.getScriptProperties();
  const verrou = LockService.getScriptLock();

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le service de préparation de restauration est momentanément occupé.'
    );
  }

  try {
    nettoyerPlansRestaurationExpires_(proprietes, maintenant);
    proprietes.setProperty(
      PREFIXE_PLAN_RESTAURATION_ +
        hacherIdentifiantOpaqueRestauration_(previewId),
      JSON.stringify(plan)
    );
  } finally {
    verrou.releaseLock();
  }

  return construirePrevisualisationRestauration_(
    validation.resultat.sauvegarde,
    rapport,
    previewId,
    expireA
  );
}


/**
 * Consomme le plan, revalide le mot de passe et émet une confirmation
 * opaque à usage unique. Aucune donnée métier n'est modifiée.
 */
function confirmerRestaurationSauvegarde(
  previewId,
  texteConfirmation,
  sauvegardeSecuriteConfirmee,
  motDePasse,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  exigerEcritureAutorisee_();

  if (String(texteConfirmation || '').trim() !== 'RESTAURER') {
    throw new Error('Saisis exactement le mot RESTAURER.');
  }

  if (sauvegardeSecuriteConfirmee !== true) {
    throw new Error(
      'Confirme la création obligatoire de la sauvegarde de sécurité.'
    );
  }

  const opaque = verifierIdentifiantOpaqueRestauration_(previewId);
  const proprietes = PropertiesService.getScriptProperties();
  const verrou = LockService.getScriptLock();
  const maintenant = Date.now();
  let plan;
  let confirmationId;
  let expireA;

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le service de confirmation de restauration est momentanément occupé.'
    );
  }

  try {
    nettoyerPlansRestaurationExpires_(proprietes, maintenant);
    const clePlan = PREFIXE_PLAN_RESTAURATION_ +
      hacherIdentifiantOpaqueRestauration_(opaque);
    const valeur = proprietes.getProperty(clePlan);

    if (!valeur) {
      throw new Error(
        'Le plan de restauration est expiré ou a déjà été consommé.'
      );
    }

    try {
      plan = JSON.parse(valeur);
    } catch (erreur) {
      throw new Error('Le plan de restauration est invalide.');
    }

    if (
      Number(plan.expireA || 0) <= maintenant ||
      plan.adminSessionAuditId !== session.identifiantHistorique
    ) {
      throw new Error(
        'Le plan de restauration est expiré ou ne correspond pas à cette session.'
      );
    }

    if (!revaliderMotDePasseAdministrateur_(motDePasse)) {
      plan.journauxDifferes = plan.journauxDifferes || [];
      plan.journauxDifferes.push(
        creerEvenementAuditRestauration_(
          'RESTAURATION_CONFIRMATION_REFUSEE',
          plan.backupId,
          { raison: 'MOT_DE_PASSE_INCORRECT' },
          session.identifiantHistorique
        )
      );
      proprietes.setProperty(clePlan, JSON.stringify(plan));
      throw new Error('Mot de passe administrateur incorrect.');
    }

    // Le plan n'est consommé qu'après revalidation complète.
    proprietes.deleteProperty(clePlan);

    plan.journauxDifferes = plan.journauxDifferes || [];
    plan.journauxDifferes.push(
      creerEvenementAuditRestauration_(
        'RESTAURATION_CONFIRMATION',
        plan.backupId,
        {
          sauvegardeSecuriteAcceptee: true,
          motDePasseRevalide: true
        },
        session.identifiantHistorique
      )
    );

    confirmationId = creerSecretAleatoireSecurite_();
    expireA = maintenant + DUREE_CONFIRMATION_RESTAURATION_MS_;
    proprietes.setProperty(
      PREFIXE_CONFIRMATION_RESTAURATION_ +
        hacherIdentifiantOpaqueRestauration_(confirmationId),
      JSON.stringify({
        plan: plan,
        adminSessionAuditId: session.identifiantHistorique,
        creeA: maintenant,
        expireA: expireA
      })
    );
  } finally {
    verrou.releaseLock();
  }

  return {
    confirmationId: confirmationId,
    expiresAt: new Date(expireA).toISOString(),
    backupId: plan.backupId
  };
}


/**
 * Exécute la restauration confirmée en une seule exécution Apps Script.
 * Le client peut interroger getEtatRestaurationAdministration pendant
 * l'appel afin d'afficher la progression durable.
 */
function executerRestaurationConfirmee(
  confirmationId,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const confirmation = consommerConfirmationRestauration_(
    confirmationId,
    session
  );

  return executerRestaurationInterne_(
    confirmation.plan,
    session,
    jetonAdministrateur,
    {}
  );
}


function getEtatRestaurationAdministration(jetonAdministrateur) {
  exigerAdministrateurLectureSeule_(jetonAdministrateur);
  const proprietes = PropertiesService.getScriptProperties();
  const actif = lireEtatOperationRestauration_(proprietes);
  const dernier = lireJsonProprieteRestauration_(
    proprietes.getProperty(PROPRIETE_DERNIERE_RESTAURATION_)
  );

  return {
    operationActive: actif
      ? construireEtatPublicRestauration_(actif)
      : null,
    derniereOperation: dernier
      ? construireEtatPublicRestauration_(dernier)
      : null,
    ecrituresBloquees: Boolean(actif),
    restaurationInterrompue: Boolean(
      actif && String(actif.statut || '') === 'RECUPERATION_REQUISE'
    ),
    repriseRollbackDisponible: Boolean(
      actif && [
        'ROLLBACK',
        'AUDIT_APRES_ROLLBACK'
      ].includes(String(actif.modeRecuperation || ''))
    ),
    repriseFinalisationDisponible: Boolean(
      actif && String(actif.modeRecuperation || '') === 'FINALISATION'
    ),
    feuillesTechniquesDetectees: actif
      ? (actif.feuillesTechniquesOrphelines || []).slice()
      : []
  };
}


function reprendreRollbackRestauration(jetonAdministrateur) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const verrou = LockService.getDocumentLock();

  if (!verrou.tryLock(30000)) {
    throw new Error(
      'La récupération est déjà en cours. Réessaie dans quelques instants.'
    );
  }

  try {
    const proprietes = PropertiesService.getScriptProperties();
    const etat = lireEtatOperationRestauration_(proprietes);

    if (!etat) {
      return {
        succes: true,
        message: 'Aucune restauration interrompue à récupérer.'
      };
    }

    if (![
      'ROLLBACK',
      'AUDIT_APRES_ROLLBACK'
    ].includes(String(etat.modeRecuperation || ''))) {
      throw new Error(
        'Cette opération ne nécessite pas un rollback, mais une reprise de finalisation.'
      );
    }

    const resultat = executerRollbackRestauration_(
      SpreadsheetApp.getActiveSpreadsheet(),
      etat,
      proprietes,
      session.identifiantHistorique,
      true
    );

    return {
      succes: resultat.complet,
      message: resultat.complet
        ? 'Rollback repris et terminé. Les données initiales ont été rétablies.'
        : 'Le rollback reste incomplet. Les écritures demeurent bloquées.'
    };
  } finally {
    verrou.releaseLock();
  }
}


function reprendreFinalisationRestauration(jetonAdministrateur) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const verrou = LockService.getDocumentLock();

  if (!verrou.tryLock(30000)) {
    throw new Error(
      'La récupération est déjà en cours. Réessaie dans quelques instants.'
    );
  }

  try {
    const proprietes = PropertiesService.getScriptProperties();
    const etat = lireEtatOperationRestauration_(proprietes);

    if (!etat || String(etat.modeRecuperation || '') !== 'FINALISATION') {
      throw new Error('Aucune finalisation de restauration n’est à reprendre.');
    }

    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const diagnostic = construireRapportIntegrite_(classeur);
    const erreursBloquantes = (diagnostic.erreurs || []).filter(
      function (erreur) {
        return [
          'FEUILLE_MANQUANTE',
          'COLONNE_MANQUANTE',
          'IDENTIFIANT_MANQUANT',
          'IDENTIFIANT_DOUBLON',
          'REFERENCE_INCOHERENTE'
        ].includes(erreur.type);
      }
    );

    if (
      Number(diagnostic.versionSchema) !==
        Number(etat.versionSchemaCible) ||
      erreursBloquantes.length
    ) {
      throw new Error(
        'La base restaurée n’est plus conforme ; la finalisation reste bloquée.'
      );
    }

    ajouterJournalDiffereRestauration_(
      etat,
      'RESTAURATION_REPRISE_FINALISATION',
      'RESTAURATION',
      etat.backupIdCible,
      {},
      session.identifiantHistorique
    );
    ecrireJournauxDifferesRestauration_(etat);
    enregistrerEtatOperationRestauration_(proprietes, etat);
    const nettoyage = supprimerFeuillesRollbackRestauration_(
      classeur,
      etat
    );

    return finaliserOperationRestauration_(
      proprietes,
      etat,
      diagnostic,
      nettoyage
    );
  } finally {
    verrou.releaseLock();
  }
}


function chargerSauvegardeEtRapportRestauration_(backupId) {
  const contexte = obtenirContexteRestaurabilite_(false);
  const fichier = trouverFichierSauvegardeRestaurabilite_(
    contexte.dossier,
    backupId
  );

  if (!fichier) {
    throw new Error('Sauvegarde introuvable.');
  }

  const resultat = validerFichierSauvegardeRestaurabilite_(
    fichier,
    contexte,
    backupId
  );
  const versionSchemaCourante = lireVersionSchemaSansCreation_(
    SpreadsheetApp.getActiveSpreadsheet()
  );
  const rapport = lireDernierRapportRestaurabilite_(
    contexte.dossier,
    backupId,
    resultat.empreinteFichier,
    versionSchemaCourante
  );

  if (!rapport) {
    throw new Error(
      'La sauvegarde doit d’abord réussir un test de restaurabilité.'
    );
  }

  if (rapport.obsolete || rapport.statut === 'OBSOLETE') {
    throw new Error(
      'Le rapport de restaurabilité est obsolète. Relance le test.'
    );
  }

  if (!STATUTS_RESTAURATION_AUTORISES_.includes(rapport.statut)) {
    throw new Error(
      'La sauvegarde n’est pas restaurable avec son dernier rapport.'
    );
  }

  if (
    rapport.empreinteFichier !== resultat.empreinteFichier ||
    rapport.backupId !== backupId ||
    rapport.applicationVersionTest !== obtenirVersionApplication_() ||
    Number(rapport.schemaVersionCourante) !==
      Number(versionSchemaCourante)
  ) {
    throw new Error(
      'Le rapport ne correspond plus à la sauvegarde ou à l’application courante.'
    );
  }

  const estimation = rapport.estimation || {};

  if (
    estimation.faisable !== true ||
    Number(resultat.tailleOctets || 0) >
      OCTETS_MAX_SIMULATION_RESTAURABILITE_ ||
    Number(estimation.cellules || 0) >
      CELLULES_MAX_SIMULATION_RESTAURABILITE_ ||
    Number(estimation.lignes || 0) >
      LIGNES_MAX_SIMULATION_RESTAURABILITE_
  ) {
    throw new Error(
      'Le volume dépasse les limites de la restauration en une exécution. Le mode reprenable par blocs n’est pas encore disponible.'
    );
  }

  return {
    contexte: contexte,
    fichier: fichier,
    resultat: resultat,
    rapport: rapport
  };
}


function construirePrevisualisationRestauration_(
  sauvegarde,
  rapport,
  previewId,
  expireA
) {
  const differences = rapport.differencesBaseActuelle || {};
  const feuilles = Array.isArray(differences.feuilles)
    ? differences.feuilles
    : [];

  return {
    previewId: previewId,
    expiresAt: new Date(expireA).toISOString(),
    backupId: sauvegarde.backupId,
    metadata: {
      createdAt: sauvegarde.metadata.createdAt,
      type: sauvegarde.metadata.type,
      comment: String(sauvegarde.metadata.comment || ''),
      applicationVersion: sauvegarde.metadata.applicationVersion,
      schemaVersion: sauvegarde.metadata.schemaVersion,
      integrityStatus: sauvegarde.metadata.integrityStatus,
      counts: sauvegarde.metadata.counts,
      fileSizeBytes: sauvegarde.metadata.fileSizeBytes
    },
    statutRestaurabilite: rapport.statut,
    migrations: (rapport.migrationsNecessaires || []).map(
      resumerMigrationRestauration_
    ),
    anomalies: (rapport.anomaliesSauvegarde || []).map(
      function (anomalie) {
        return {
          type: String(anomalie.type || anomalie.code || 'ANOMALIE'),
          feuille: String(anomalie.feuille || ''),
          message: String(anomalie.message || '')
        };
      }
    ),
    avertissements: (rapport.avertissements || []).map(
      function (avertissement) {
        return {
          code: String(avertissement.code || ''),
          message: String(avertissement.message || '')
        };
      }
    ),
    differences: feuilles.map(function (feuille) {
      return {
        feuille: feuille.feuille,
        lignesActuelles: Number(feuille.lignesActuelles || 0),
        lignesSauvegarde: Number(feuille.lignesSauvegarde || 0),
        seulementSauvegarde: Number(
          (feuille.seulementSauvegarde || {}).total || 0
        ),
        seulementActuelle: Number(
          (feuille.seulementActuelle || {}).total || 0
        ),
        identifiantsCommuns: Number(
          feuille.identifiantsCommuns || 0
        ),
        lignesNonIdentifiablesSauvegarde: Number(
          feuille.lignesNonIdentifiablesSauvegarde || 0
        ),
        entetesIdentiques: feuille.entetesIdentiques === true
      };
    }),
    feuillesRemplacees: SCHEMA_BASE_.map(function (configuration) {
      return configuration.feuille;
    }),
    avertissementRemplacementIntegral:
      'Les 13 feuilles déclarées seront intégralement remplacées par les valeurs de la sauvegarde. Les formats, formules et protections ne sont pas restaurés.',
    confirmationRequise: 'RESTAURER',
    sauvegardeSecuriteObligatoire: true,
    motDePasseRequis: true
  };
}


function consommerConfirmationRestauration_(confirmationId, session) {
  const opaque = verifierIdentifiantOpaqueRestauration_(confirmationId);
  const proprietes = PropertiesService.getScriptProperties();
  const verrou = LockService.getScriptLock();
  const maintenant = Date.now();
  let confirmation;

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le service de restauration est momentanément occupé.'
    );
  }

  try {
    nettoyerPlansRestaurationExpires_(proprietes, maintenant);

    if (lireEtatOperationRestauration_(proprietes)) {
      throw new Error('Une restauration est déjà active.');
    }

    const cle = PREFIXE_CONFIRMATION_RESTAURATION_ +
      hacherIdentifiantOpaqueRestauration_(opaque);
    const valeur = proprietes.getProperty(cle);

    proprietes.deleteProperty(cle);

    if (!valeur) {
      throw new Error(
        'La confirmation est expirée ou a déjà été consommée.'
      );
    }

    try {
      confirmation = JSON.parse(valeur);
    } catch (erreur) {
      throw new Error('La confirmation de restauration est invalide.');
    }

    if (
      Number(confirmation.expireA || 0) <= maintenant ||
      confirmation.adminSessionAuditId !==
        session.identifiantHistorique
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


function executerRestaurationInterne_(
  plan,
  session,
  jetonAdministrateur,
  optionsTest
) {
  const validation = chargerSauvegardeEtRapportRestauration_(
    plan.backupId
  );

  verifierCorrespondancePlanRestauration_(plan, validation);

  const verrou = LockService.getDocumentLock();

  if (!verrou.tryLock(30000)) {
    throw new Error(
      'Une autre opération est en cours. Prépare une nouvelle restauration dans quelques instants.'
    );
  }

  const proprietes = PropertiesService.getScriptProperties();
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const maintenant = Date.now();
  const operationId = Utilities.getUuid();
  const techniquesInitiales = listerFeuillesTechniquesRestauration_(
    classeur
  );

  if (techniquesInitiales.length) {
    enregistrerEtatOperationRestauration_(
      proprietes,
      creerEtatFeuillesOrphelinesRestauration_(techniquesInitiales)
    );
    verrou.releaseLock();
    throw new Error(
      'Des feuilles techniques nécessitent un diagnostic avant la restauration.'
    );
  }

  let etat;

  try {
    etat = {
    operationId: operationId,
    backupIdCible: plan.backupId,
    backupIdSecurite: '',
    etapeCourante: 'INITIALISATION',
    dateDebut: new Date(maintenant).toISOString(),
    derniereActivite: maintenant,
    versionSchemaSource: Number(plan.versionSchemaSource) || 0,
    versionSchemaCible: Number(plan.versionSchemaCible) || 0,
    feuillesStaging:
      construirePlanStagingRestauration_(operationId),
    feuillesRollback:
      construirePlanRollbackRestauration_(operationId, classeur),
    feuillesInitialementPresentes: SCHEMA_BASE_
      .filter(function (configuration) {
        return Boolean(classeur.getSheetByName(configuration.feuille));
      })
      .map(function (configuration) {
        return configuration.feuille;
      }),
    statut: 'EN_COURS',
    modeRecuperation: '',
    basculementCommence: false,
    basculementTermine: false,
    adminSessionAuditId: session.identifiantHistorique,
    journauxDifferes: (plan.journauxDifferes || []).slice(),
    journauxEcrits: false,
    nombreJournauxEcrits: 0,
    feuillesTechniquesOrphelines: []
    };
  } catch (erreurPreparationEtat) {
    verrou.releaseLock();
    throw erreurPreparationEtat;
  }

  try {
    if (lireEtatOperationRestauration_(proprietes)) {
      throw new Error('Une restauration est déjà active.');
    }

    enregistrerEtatOperationRestauration_(proprietes, etat);
    journaliserEtapeRestauration_(
      'RESTAURATION_DEBUT',
      etat,
      { schemaSource: etat.versionSchemaSource },
      session.identifiantHistorique
    );

    mettreAJourEtapeRestauration_(
      proprietes,
      etat,
      'SAUVEGARDE_SECURITE'
    );
    verifierPointEchecRestauration_(optionsTest, 'SAUVEGARDE_SECURITE');

    const sauvegardeSecurite = creerSauvegardeCompleteInterne_(
      'Sauvegarde automatique avant restauration de ' +
        plan.backupId,
      TYPE_SAUVEGARDE_SECURITE_RESTAURATION_,
      session,
      jetonAdministrateur,
      true,
      { differerJournalisation: true }
    );

    if (
      !sauvegardeSecurite ||
      sauvegardeSecurite.verificationIntegrite !== true
    ) {
      throw new Error(
        'La sauvegarde automatique de sécurité n’a pas pu être vérifiée.'
      );
    }

    etat.backupIdSecurite = sauvegardeSecurite.backupId;
    ajouterJournalDiffereRestauration_(
      etat,
      'SAUVEGARDE_SECURITE_RESTAURATION_CREATION',
      'SAUVEGARDE',
      sauvegardeSecurite.backupId,
      {
        tailleOctets: sauvegardeSecurite.tailleOctets,
        verificationApresCreation: true
      },
      session.identifiantHistorique
    );
    enregistrerEtatOperationRestauration_(proprietes, etat);
    journaliserEtapeRestauration_(
      'RESTAURATION_SAUVEGARDE_SECURITE_VALIDEE',
      etat,
      { backupIdSecurite: etat.backupIdSecurite },
      session.identifiantHistorique
    );

    mettreAJourEtapeRestauration_(proprietes, etat, 'STAGING');
    creerStagingRestauration_(
      classeur,
      validation.resultat.sauvegarde,
      etat,
      proprietes,
      optionsTest
    );

    mettreAJourEtapeRestauration_(
      proprietes,
      etat,
      'VALIDATION_STAGING'
    );
    const diagnosticStaging = validerStagingRestauration_(
      classeur,
      validation.resultat.sauvegarde,
      etat
    );
    etat.feuillesStaging.forEach(function (liaison) {
      liaison.etat = 'VALIDEE';
    });
    enregistrerEtatOperationRestauration_(proprietes, etat);
    verifierPointEchecRestauration_(optionsTest, 'VALIDATION_STAGING');
    journaliserEtapeRestauration_(
      'RESTAURATION_STAGING_VALIDE',
      etat,
      {
        nombreFeuilles: etat.feuillesStaging.length,
        identifiantsManquants:
          diagnosticStaging.resume.identifiantsManquants,
        doublons: diagnosticStaging.resume.doublonsIdentifiants,
        references: diagnosticStaging.resume.referencesIncoherentes
      },
      session.identifiantHistorique
    );

    mettreAJourEtapeRestauration_(proprietes, etat, 'BASCULEMENT');
    basculerFeuillesRestauration_(
      classeur,
      etat,
      proprietes,
      optionsTest
    );
    journaliserEtapeRestauration_(
      'RESTAURATION_BASCULEMENT_TERMINE',
      etat,
      { nombreFeuilles: etat.feuillesRollback.length },
      session.identifiantHistorique
    );

    mettreAJourEtapeRestauration_(proprietes, etat, 'MIGRATIONS');
    verifierPointEchecRestauration_(optionsTest, 'MIGRATIONS');
    const migrations = executerChaineMigrationsRestauration_(
      classeur,
      validation.rapport.migrationsNecessaires,
      plan.versionSchemaSource,
      plan.versionSchemaCible,
      CONTEXTE_ECRITURE_RESTAURATION_
    );
    journaliserEtapeRestauration_(
      'RESTAURATION_MIGRATIONS_TERMINEES',
      etat,
      { migrations: migrations.migrationsExecutees },
      session.identifiantHistorique
    );

    mettreAJourEtapeRestauration_(proprietes, etat, 'DIAGNOSTIC');
    verifierPointEchecRestauration_(optionsTest, 'DIAGNOSTIC');
    const diagnosticFinal = construireRapportIntegrite_(classeur);

    validerDiagnosticFinalRestauration_(
      diagnosticFinal,
      validation.rapport,
      plan.versionSchemaCible
    );
    journaliserEtapeRestauration_(
      'RESTAURATION_DIAGNOSTIC_FINAL_VALIDE',
      etat,
      {
        versionSchema: diagnosticFinal.versionSchema,
        totalErreurs: diagnosticFinal.resume.totalErreurs
      },
      session.identifiantHistorique
    );

    mettreAJourEtapeRestauration_(proprietes, etat, 'FINALISATION');
    journaliserEtapeRestauration_(
      'RESTAURATION_REUSSIE',
      etat,
      {
        backupIdSecurite: etat.backupIdSecurite,
        versionSchema: diagnosticFinal.versionSchema
      },
      session.identifiantHistorique
    );
    enregistrerEtatOperationRestauration_(proprietes, etat);
    ecrireJournauxDifferesRestauration_(etat);
    enregistrerEtatOperationRestauration_(proprietes, etat);

    etat.statut = 'RECUPERATION_REQUISE';
    etat.etapeCourante = 'NETTOYAGE_FINAL';
    etat.modeRecuperation = 'FINALISATION';
    enregistrerEtatOperationRestauration_(proprietes, etat);

    const nettoyage = supprimerFeuillesRollbackRestauration_(
      classeur,
      etat
    );
    const resultat = finaliserOperationRestauration_(
      proprietes,
      etat,
      diagnosticFinal,
      nettoyage
    );

    return resultat;
  } catch (erreur) {
    const etatDurableCourant = lireEtatOperationRestauration_(proprietes);

    if (
      etatDurableCourant &&
      String(etatDurableCourant.operationId || '') !==
        String(etat.operationId || '')
    ) {
      throw erreur;
    }

    if (String(etat.modeRecuperation || '') === 'FINALISATION') {
      etat.statut = 'RECUPERATION_REQUISE';
      etat.etapeCourante = 'NETTOYAGE_INCOMPLET';
      etat.erreurInterne = String(
        erreur.message || erreur
      ).slice(0, 1000);
      etat.feuillesTechniquesOrphelines =
        listerFeuillesTechniquesRestauration_(classeur);
      enregistrerEtatOperationRestauration_(proprietes, etat);

      throw new Error(
        'La restauration est validée mais sa finalisation est incomplète. Les écritures restent bloquées ; utilise « Reprendre la finalisation ». '
        + nettoyerMessagePublicRestauration_(erreur)
      );
    }

    etat.statut = 'ECHEC';
    etat.journauxEcrits = false;
    etat.nombreJournauxEcrits = 0;
    etat.erreurInterne = String(erreur.message || erreur).slice(0, 1000);
    enregistrerEtatOperationRestauration_(proprietes, etat);

    try {
      journaliserEtapeRestauration_(
        'RESTAURATION_ECHEC',
        etat,
        { etape: etat.etapeCourante },
        session.identifiantHistorique
      );
      enregistrerEtatOperationRestauration_(proprietes, etat);
    } catch (erreurAudit) {
      console.error(erreurAudit);
    }

    const rollback = executerRollbackRestauration_(
      classeur,
      etat,
      proprietes,
      session.identifiantHistorique,
      false
    );

    if (!rollback.complet) {
      throw new Error(
        'La restauration a échoué et le rollback est incomplet. Les écritures restent bloquées ; utilise « Reprendre le rollback » dans Administration.'
      );
    }

    throw new Error(
      'La restauration a échoué à l’étape ' +
      etat.etapeCourante +
      '. Les données initiales ont été rétablies. ' +
      nettoyerMessagePublicRestauration_(erreur)
    );
  } finally {
    verrou.releaseLock();
  }
}


function verifierCorrespondancePlanRestauration_(plan, validation) {
  const rapport = validation.rapport;
  const migrationsPlan = (plan.migrations || []).map(
    resumerMigrationRestauration_
  );
  const migrationsRapport = (rapport.migrationsNecessaires || [])
    .map(resumerMigrationRestauration_);

  if (
    plan.empreinteFichier !== validation.resultat.empreinteFichier ||
    plan.dateRapport !== rapport.testedAt ||
    plan.statutRapport !== rapport.statut ||
    plan.versionApplicationTest !== obtenirVersionApplication_() ||
    Number(plan.versionSchemaCourante) !==
      Number(rapport.schemaVersionCourante) ||
    Number(plan.versionSchemaSource) !==
      Number(rapport.schemaVersionSauvegarde) ||
    Number(plan.versionSchemaCible) !==
      Number(rapport.schemaVersionCible) ||
    JSON.stringify(migrationsPlan) !== JSON.stringify(migrationsRapport)
  ) {
    throw new Error(
      'Le plan de restauration est devenu obsolète. Prépare une nouvelle restauration.'
    );
  }
}


function creerStagingRestauration_(
  classeur,
  sauvegarde,
  etat,
  proprietes,
  optionsTest
) {
  SCHEMA_BASE_.forEach(function (configuration, position) {
    verifierPointEchecRestauration_(optionsTest, 'STAGING_' + position);
    verifierPointEchecRestauration_(optionsTest, 'STAGING');

    const liaison = etat.feuillesStaging.find(function (element) {
      return element.feuille === configuration.feuille;
    });

    if (!liaison) {
      throw new Error('Plan de staging incomplet.');
    }

    const nomTemporaire = liaison.nomTemporaire;

    if (classeur.getSheetByName(nomTemporaire)) {
      throw new Error('Collision de nom technique pendant le staging.');
    }

    liaison.etat = 'CREATION_PREVUE';
    enregistrerEtatOperationRestauration_(proprietes, etat);

    const feuille = classeur.insertSheet(nomTemporaire);
    const source = sauvegarde.sheets[configuration.feuille];

    liaison.empreinteAvantEcriture = hacherTexteSauvegarde_(
      canonicaliserSauvegarde_(source)
    );

    liaison.etat = 'CREEE';
    enregistrerEtatOperationRestauration_(proprietes, etat);
    ecrireFeuilleStagingRestauration_(feuille, source);
    liaison.etat = 'ECRITE';
    enregistrerEtatOperationRestauration_(proprietes, etat);
  });

  SpreadsheetApp.flush();
}


function ecrireFeuilleStagingRestauration_(feuille, source) {
  const entetes = (source.headers || []).slice();
  const lignes = (source.rows || []).map(function (ligne) {
    return ligne.map(deserialiserValeurRestauration_);
  });
  const colonnes = entetes.length;
  const nombreLignes = lignes.length + (colonnes ? 1 : 0);

  assurerDimensionsFeuilleRestauration_(
    feuille,
    Math.max(nombreLignes, 1),
    Math.max(colonnes, 1)
  );

  if (!colonnes) {
    return;
  }

  appliquerFormatTexteChainesStaging_(
    feuille,
    [entetes].concat(lignes)
  );

  feuille.getRange(1, 1, 1, colonnes).setValues([entetes]);

  for (
    let debut = 0;
    debut < lignes.length;
    debut += TAILLE_BLOC_ECRITURE_RESTAURATION_
  ) {
    const bloc = lignes.slice(
      debut,
      debut + TAILLE_BLOC_ECRITURE_RESTAURATION_
    );

    feuille
      .getRange(debut + 2, 1, bloc.length, colonnes)
      .setValues(bloc);
  }
}


/**
 * Préformate uniquement les cellules dont la valeur attendue est une chaîne.
 * Les plages contiguës d'une même ligne sont regroupées puis appliquées par
 * lots afin de ne modifier aucun format de nombre, booléen ou Date.
 */
function appliquerFormatTexteChainesStaging_(feuille, valeurs) {
  const plages = [];

  (valeurs || []).forEach(function (ligne, indexLigne) {
    let debut = -1;

    for (let colonne = 0; colonne <= ligne.length; colonne++) {
      const estChaine = colonne < ligne.length &&
        typeof ligne[colonne] === 'string';

      if (estChaine && debut < 0) {
        debut = colonne;
      }

      if (!estChaine && debut >= 0) {
        plages.push(
          construirePlageA1Restauration_(
            indexLigne + 1,
            debut + 1,
            colonne
          )
        );
        debut = -1;
      }
    }
  });

  for (
    let debut = 0;
    debut < plages.length;
    debut += TAILLE_LOT_FORMAT_TEXTE_RESTAURATION_
  ) {
    feuille
      .getRangeList(
        plages.slice(
          debut,
          debut + TAILLE_LOT_FORMAT_TEXTE_RESTAURATION_
        )
      )
      .setNumberFormat('@');
  }
}


function construirePlageA1Restauration_(
  ligne,
  premiereColonne,
  derniereColonne
) {
  const debut = convertirNumeroColonneRestauration_(premiereColonne) +
    ligne;
  const fin = convertirNumeroColonneRestauration_(derniereColonne) +
    ligne;

  return debut === fin ? debut : debut + ':' + fin;
}


function assurerDimensionsFeuilleRestauration_(
  feuille,
  nombreLignes,
  nombreColonnes
) {
  if (feuille.getMaxRows() < nombreLignes) {
    feuille.insertRowsAfter(
      feuille.getMaxRows(),
      nombreLignes - feuille.getMaxRows()
    );
  }

  if (feuille.getMaxColumns() < nombreColonnes) {
    feuille.insertColumnsAfter(
      feuille.getMaxColumns(),
      nombreColonnes - feuille.getMaxColumns()
    );
  }
}


function deserialiserValeurRestauration_(valeur) {
  if (
    valeur &&
    typeof valeur === 'object' &&
    !Array.isArray(valeur) &&
    valeur.type === 'DATE_ISO_UTC'
  ) {
    const date = new Date(valeur.value);

    if (Number.isNaN(date.getTime())) {
      throw new Error('Une date sérialisée de la sauvegarde est invalide.');
    }

    return date;
  }

  return valeur;
}


function validerStagingRestauration_(classeur, sauvegarde, etat) {
  const modele = { sheets: {} };

  SCHEMA_BASE_.forEach(function (configuration) {
    const liaison = etat.feuillesStaging.find(function (element) {
      return element.feuille === configuration.feuille;
    });

    if (!liaison) {
      throw new Error(
        'La feuille de staging ' + configuration.feuille + ' est absente.'
      );
    }

    const feuille = classeur.getSheetByName(liaison.nomTemporaire);
    const source = sauvegarde.sheets[configuration.feuille];

    if (!feuille) {
      throw new Error(
        'Une feuille temporaire de staging est introuvable.'
      );
    }

    const relue = lireFeuilleTemporaireRestauration_(
      feuille,
      configuration
    );

    if (source.exists) {
      const hashRelu = hacherTexteSauvegarde_(
        canonicaliserSauvegarde_(relue)
      );
      const hashAttendu = sauvegarde.integrity
        .sheetHashes[configuration.feuille];
      const hashAvantEcriture = String(
        liaison.empreinteAvantEcriture ||
        hacherTexteSauvegarde_(canonicaliserSauvegarde_(source))
      );

      if (!comparaisonConstanteSecurite_(hashRelu, hashAttendu)) {
        const diagnostic = construireDiagnosticDivergenceStaging_(
          feuille,
          source,
          relue,
          hashAvantEcriture,
          hashRelu,
          hashAttendu
        );

        throw new Error(
          formaterErreurDivergenceStaging_(
            configuration.feuille,
            diagnostic
          )
        );
      }
    } else if (
      relue.rowCount !== 0 ||
      relue.columnCount !== 0 ||
      relue.cellCount !== 0
    ) {
      throw new Error(
        'Une feuille absente de la sauvegarde contient des données dans le staging.'
      );
    }

    if (
      relue.rowCount !== Number(source.rowCount || 0) ||
      relue.columnCount !== Number(source.columnCount || 0) ||
      relue.cellCount !== Number(source.cellCount || 0)
    ) {
      throw new Error(
        'Les dimensions du staging diffèrent de la sauvegarde pour ' +
        configuration.feuille + '.'
      );
    }

    modele.sheets[configuration.feuille] = relue;
  });

  const diagnostic = construireDiagnosticModeleRestaurabilite_(modele);
  const bloquantes = diagnostic.erreurs.filter(function (erreur) {
    return [
      'IDENTIFIANT_MANQUANT',
      'IDENTIFIANT_DOUBLON',
      'REFERENCE_INCOHERENTE'
    ].includes(erreur.type);
  });

  if (bloquantes.length) {
    throw new Error(
      'Le staging contient des identifiants dupliqués, manquants ou des références incohérentes.'
    );
  }

  return diagnostic;
}


/**
 * Instrumentation de diagnostic uniquement. Cette comparaison ne participe
 * ni au calcul des empreintes ni à la décision de valider le staging.
 */
function construireDiagnosticDivergenceStaging_(
  feuille,
  attendue,
  relue,
  empreinteAvantEcriture,
  empreinteRelue,
  empreinteSignee
) {
  const difference = trouverPremiereDifferenceStaging_(
    attendue,
    relue
  );

  if (difference.portee === 'CELLULE') {
    enrichirDifferenceCelluleStaging_(feuille, difference);
  }

  difference.typeAttendu = decrireTypeValeurStaging_(
    difference.valeurAttendue,
    difference.attenduePresente,
    false
  );
  difference.typeRelu = decrireTypeValeurStaging_(
    difference.valeurRelueBrute,
    difference.reluePresente,
    difference.celluleRelueVide
  );
  difference.categorieDifference =
    classifierDifferenceValeurStaging_(difference);
  difference.valeurAttendueAffichee =
    formaterValeurDiagnosticStaging_(
      difference.valeurAttendue,
      difference.attenduePresente
    );
  difference.valeurRelueAffichee =
    formaterValeurDiagnosticStaging_(
      difference.valeurRelueBrute,
      difference.reluePresente
    );

  return {
    empreinteCalculeeAvantEcriture:
      String(empreinteAvantEcriture || ''),
    empreinteRelueApresEcriture: String(empreinteRelue || ''),
    empreinteSigneeSauvegarde: String(empreinteSignee || ''),
    premiereDifference: difference
  };
}


function trouverPremiereDifferenceStaging_(attendue, relue) {
  const lignesAttendues = [attendue.headers || []]
    .concat(attendue.rows || []);
  const lignesRelues = [relue.headers || []]
    .concat(relue.rows || []);
  const nombreLignes = Math.max(
    lignesAttendues.length,
    lignesRelues.length
  );

  for (let ligne = 0; ligne < nombreLignes; ligne++) {
    const ligneAttendue = lignesAttendues[ligne] || [];
    const ligneRelue = lignesRelues[ligne] || [];
    const nombreColonnes = Math.max(
      ligneAttendue.length,
      ligneRelue.length
    );

    for (let colonne = 0; colonne < nombreColonnes; colonne++) {
      const attenduePresente = colonne < ligneAttendue.length;
      const reluePresente = colonne < ligneRelue.length;
      const valeurAttendue = ligneAttendue[colonne];
      const valeurRelue = ligneRelue[colonne];

      if (
        attenduePresente !== reluePresente ||
        canonicaliserSauvegarde_(valeurAttendue) !==
          canonicaliserSauvegarde_(valeurRelue)
      ) {
        return {
          portee: 'CELLULE',
          ligne: ligne + 1,
          colonne: colonne + 1,
          entete: String(
            (attendue.headers || [])[colonne] ||
            (relue.headers || [])[colonne] ||
            ''
          ),
          attenduePresente: attenduePresente,
          reluePresente: reluePresente,
          valeurAttendue: valeurAttendue,
          valeurRelue: valeurRelue,
          valeurRelueBrute: valeurRelue,
          celluleRelueVide: false
        };
      }
    }
  }

  const champs = [
    'exists',
    'rowCount',
    'columnCount',
    'cellCount',
    'idColumn',
    'identifiedRowCount'
  ];

  for (let index = 0; index < champs.length; index++) {
    const champ = champs[index];

    if (
      canonicaliserSauvegarde_(attendue[champ]) !==
      canonicaliserSauvegarde_(relue[champ])
    ) {
      return {
        portee: 'METADONNEE',
        ligne: 0,
        colonne: 0,
        entete: champ,
        attenduePresente: Object.prototype.hasOwnProperty.call(
          attendue,
          champ
        ),
        reluePresente: Object.prototype.hasOwnProperty.call(relue, champ),
        valeurAttendue: attendue[champ],
        valeurRelue: relue[champ],
        valeurRelueBrute: relue[champ],
        celluleRelueVide: false
      };
    }
  }

  return {
    portee: 'OBJET_CANONIQUE',
    ligne: 0,
    colonne: 0,
    entete: 'objet canonique complet',
    attenduePresente: true,
    reluePresente: true,
    valeurAttendue: attendue,
    valeurRelue: relue,
    valeurRelueBrute: relue,
    celluleRelueVide: false
  };
}


function enrichirDifferenceCelluleStaging_(feuille, difference) {
  if (
    !feuille ||
    !Number.isInteger(difference.ligne) ||
    !Number.isInteger(difference.colonne) ||
    difference.ligne < 1 ||
    difference.colonne < 1
  ) {
    return;
  }

  try {
    const cellule = feuille.getRange(
      difference.ligne,
      difference.colonne
    );

    difference.valeurRelueBrute = cellule.getValue();
    difference.celluleRelueVide = typeof cellule.isBlank === 'function'
      ? cellule.isBlank()
      : false;
  } catch (erreurLectureDiagnostic) {
    difference.erreurLectureCellule = String(
      erreurLectureDiagnostic.message || erreurLectureDiagnostic
    );
  }
}


function decrireTypeValeurStaging_(valeur, presente, celluleVide) {
  if (!presente) {
    return 'cellule absente';
  }

  if (celluleVide) {
    return 'cellule vide';
  }

  if (
    valeur instanceof Date ||
    valeur &&
      typeof valeur === 'object' &&
      !Array.isArray(valeur) &&
      valeur.type === 'DATE_ISO_UTC'
  ) {
    return 'Date';
  }

  if (typeof valeur === 'number') {
    return 'nombre';
  }

  if (typeof valeur === 'boolean') {
    return 'booléen';
  }

  if (valeur === '') {
    return 'chaîne vide';
  }

  if (typeof valeur === 'string') {
    return 'chaîne';
  }

  return 'autre type (' + (
    valeur === null ? 'null' : typeof valeur
  ) + ')';
}


function classifierDifferenceValeurStaging_(difference) {
  const types = [
    difference.typeAttendu,
    difference.typeRelu
  ];

  if (types.includes('Date')) {
    return 'Date';
  }

  if (types.includes('nombre')) {
    return 'nombre';
  }

  if (types.includes('booléen')) {
    return 'booléen';
  }

  if (types.includes('cellule vide')) {
    return 'cellule vide';
  }

  if (types.includes('chaîne vide')) {
    return 'chaîne vide';
  }

  return 'autre type';
}


function formaterValeurDiagnosticStaging_(valeur, presente) {
  if (!presente) {
    return 'undefined';
  }

  const texte = JSON.stringify(valeur);

  return texte === undefined ? 'undefined' : texte;
}


function formaterErreurDivergenceStaging_(nomFeuille, diagnostic) {
  const difference = diagnostic.premiereDifference;
  const cellule = difference.portee === 'CELLULE'
    ? convertirNumeroColonneRestauration_(difference.colonne) +
      difference.ligne
    : 'aucune (divergence de métadonnée)';
  const ligne = difference.portee === 'CELLULE'
    ? String(difference.ligne)
    : 'hors cellule';
  const colonne = difference.portee === 'CELLULE'
    ? (difference.entete || '[sans nom]') +
      ' (#' + difference.colonne + ')'
    : difference.entete + ' (#0)';

  return 'L’empreinte relue du staging est invalide pour ' +
    nomFeuille + '. Empreinte attendue=' +
    diagnostic.empreinteSigneeSauvegarde +
    '; empreinte relue=' +
    diagnostic.empreinteRelueApresEcriture +
    '; première cellule différente=' + cellule +
    '; ligne Google=' + ligne +
    '; colonne=' + colonne +
    '; valeur attendue (JSON.stringify)=' +
    difference.valeurAttendueAffichee +
    '; valeur relue (JSON.stringify)=' +
    difference.valeurRelueAffichee +
    '; type attendu=' + difference.typeAttendu +
    '; type relu=' + difference.typeRelu + '.';
}


function convertirNumeroColonneRestauration_(numero) {
  let valeur = Math.max(1, Math.floor(Number(numero) || 1));
  let lettres = '';

  while (valeur > 0) {
    valeur--;
    lettres = String.fromCharCode(65 + (valeur % 26)) + lettres;
    valeur = Math.floor(valeur / 26);
  }

  return lettres;
}


function lireFeuilleTemporaireRestauration_(feuille, configuration) {
  if (feuille.getLastRow() < 1 || feuille.getLastColumn() < 1) {
    return {
      exists: true,
      headers: [],
      rows: [],
      rowCount: 0,
      columnCount: 0,
      cellCount: 0,
      idColumn: String(configuration.identifiant || ''),
      identifiedRowCount: 0
    };
  }

  const valeurs = feuille.getDataRange().getValues();
  const headers = valeurs[0].map(function (valeur) {
    return String(valeur === null ? '' : valeur);
  });
  const rows = valeurs.slice(1).map(function (ligne) {
    return ligne.map(serialiserValeurSauvegarde_);
  });
  const idColumn = String(configuration.identifiant || '');
  const index = creerIndexMigration_(headers);
  const positionId = idColumn
    ? index[normaliserMigration_(idColumn)]
    : null;
  const identifiedRowCount = Number.isInteger(positionId)
    ? rows.filter(function (ligne) {
      return String(ligne[positionId] || '').trim() !== '';
    }).length
    : 0;

  return {
    exists: true,
    headers: headers,
    rows: rows,
    rowCount: rows.length,
    columnCount: headers.length,
    cellCount: (rows.length + 1) * headers.length,
    idColumn: idColumn,
    identifiedRowCount: identifiedRowCount
  };
}


function basculerFeuillesRestauration_(
  classeur,
  etat,
  proprietes,
  optionsTest
) {
  etat.basculementCommence = true;
  enregistrerEtatOperationRestauration_(proprietes, etat);

  SCHEMA_BASE_.forEach(function (configuration, position) {
    verifierPointEchecRestauration_(
      optionsTest,
      'AVANT_RENOMMAGE_SOURCE_' + position
    );
    verifierPointEchecRestauration_(optionsTest, 'RENOMMAGE_' + position);
    verifierPointEchecRestauration_(optionsTest, 'RENOMMAGE');

    const active = classeur.getSheetByName(configuration.feuille);
    const staging = etat.feuillesStaging.find(function (element) {
      return element.feuille === configuration.feuille;
    });
    const rollback = etat.feuillesRollback.find(function (element) {
      return element.feuille === configuration.feuille;
    });

    if (!active || !staging || !rollback) {
      throw new Error(
        'La bascule ne peut pas trouver toutes les feuilles attendues.'
      );
    }

    const nomRollback = rollback.nomRollback;

    if (classeur.getSheetByName(nomRollback)) {
      throw new Error('Collision de nom technique pendant la bascule.');
    }

    rollback.nomSource = configuration.feuille;
    rollback.empreinteSource =
      calculerEmpreinteFeuilleRestauration_(active, configuration);
    rollback.etat = 'RENOMMAGE_SOURCE_PREVU';
    enregistrerEtatOperationRestauration_(proprietes, etat);

    active.setName(nomRollback);
    rollback.etat = 'SOURCE_RENOMMEE';
    enregistrerEtatOperationRestauration_(proprietes, etat);
    verifierPointEchecRestauration_(
      optionsTest,
      'APRES_RENOMMAGE_SOURCE_' + position
    );

    const stagingActuel = classeur.getSheetByName(
      staging.nomTemporaire
    );

    if (!stagingActuel) {
      throw new Error('Une feuille de staging a disparu pendant la bascule.');
    }

    rollback.etat = 'RENOMMAGE_STAGING_PREVU';
    enregistrerEtatOperationRestauration_(proprietes, etat);
    verifierPointEchecRestauration_(
      optionsTest,
      'AVANT_RENOMMAGE_STAGING_' + position
    );

    stagingActuel.setName(configuration.feuille);
    staging.basculee = true;
    staging.etat = 'ACTIVE';
    rollback.etat = 'STAGING_ACTIVE';
    enregistrerEtatOperationRestauration_(proprietes, etat);
    verifierPointEchecRestauration_(
      optionsTest,
      'APRES_RENOMMAGE_STAGING_' + position
    );
  });

  etat.basculementTermine = true;
  enregistrerEtatOperationRestauration_(proprietes, etat);
  SpreadsheetApp.flush();
}


function validerDiagnosticFinalRestauration_(
  diagnostic,
  rapport,
  versionSchemaCible
) {
  const attendu = rapport.diagnosticApresMigration || {};
  const erreurs = diagnostic.erreurs || [];
  const erreursBloquantes = erreurs.filter(function (erreur) {
    return [
      'FEUILLE_MANQUANTE',
      'COLONNE_MANQUANTE',
      'IDENTIFIANT_MANQUANT',
      'IDENTIFIANT_DOUBLON',
      'REFERENCE_INCOHERENTE'
    ].includes(erreur.type);
  });

  if (
    Number(diagnostic.versionSchema) !== Number(versionSchemaCible) ||
    erreursBloquantes.length ||
    Number((diagnostic.resume || {}).totalErreurs || 0) !==
      Number((attendu.resume || {}).totalErreurs || 0)
  ) {
    throw new Error(
      'Le diagnostic réel ne correspond pas au résultat simulé.'
    );
  }

  const feuillesReelles = (diagnostic.feuilles || []).map(
    function (feuille) {
      return feuille.nom;
    }
  );

  SCHEMA_BASE_.forEach(function (configuration) {
    if (!feuillesReelles.includes(configuration.feuille)) {
      throw new Error(
        'La feuille ' + configuration.feuille +
        ' manque après restauration.'
      );
    }

    const reelle = (diagnostic.feuilles || []).find(
      function (feuille) {
        return feuille.nom === configuration.feuille;
      }
    );
    const simulee = (attendu.feuilles || []).find(
      function (feuille) {
        return feuille.nom === configuration.feuille;
      }
    );

    if (!reelle || reelle.conforme !== true) {
      throw new Error(
        'La structure réelle de ' + configuration.feuille +
        ' n’est pas conforme après restauration.'
      );
    }

    if (
      configuration.feuille !== 'HISTORIQUE' &&
      simulee &&
      Number(reelle.nombreLignes || 0) !==
        Number(simulee.nombreLignes || 0)
    ) {
      throw new Error(
        'Le nombre de lignes réel de ' + configuration.feuille +
        ' diffère du rapport simulé.'
      );
    }
  });
}


function executerRollbackRestauration_(
  classeur,
  etat,
  proprietes,
  identifiantHistorique,
  reprise
) {
  if (String(etat.modeRecuperation || '') === 'AUDIT_APRES_ROLLBACK') {
    return finaliserRollbackRestauration_(etat, proprietes);
  }

  // Les éventuels journaux écrits dans la base candidate disparaîtront avec
  // son rollback ; ils devront donc être rejoués dans la base source.
  etat.journauxEcrits = false;
  etat.nombreJournauxEcrits = 0;
  etat.statut = 'ROLLBACK_EN_COURS';
  etat.etapeCourante = 'ROLLBACK';
  etat.modeRecuperation = 'ROLLBACK';
  enregistrerEtatOperationRestauration_(proprietes, etat);
  const erreurs = [];

  (etat.feuillesRollback || [])
    .slice()
    .sort(function (a, b) {
      return Number(a.position) - Number(b.position);
    })
    .forEach(function (liaison) {
      try {
        restaurerLiaisonRollbackRestauration_(
          classeur,
          etat,
          liaison,
          proprietes
        );
      } catch (erreur) {
        erreurs.push(
          liaison.feuille + ' : ' + String(erreur.message || erreur)
        );
      }
    });

  const feuillesFinalesOk = (
    etat.feuillesInitialementPresentes ||
    SCHEMA_BASE_.map(function (configuration) {
      return configuration.feuille;
    })
  ).every(
    function (nomFeuille) {
      return Boolean(classeur.getSheetByName(nomFeuille));
    }
  );
  const techniquesRestantes = listerFeuillesTechniquesRestauration_(
    classeur
  );
  const techniquesInconnues = rattacherFeuillesTechniquesRestauration_(
    etat,
    techniquesRestantes
  );
  const complet = !erreurs.length &&
    feuillesFinalesOk && !techniquesRestantes.length;

  SpreadsheetApp.flush();

  ajouterJournalDiffereRestauration_(
    etat,
    reprise
      ? 'RESTAURATION_RECUPERATION_INTERRUPTION'
      : 'RESTAURATION_ROLLBACK',
    'RESTAURATION',
    etat.backupIdCible,
    {
      complet: complet,
      nombreErreurs: erreurs.length,
      sauvegardeSecuriteConservee: Boolean(etat.backupIdSecurite)
    },
    identifiantHistorique || 'RECUPERATION_AUTOMATIQUE'
  );

  if (complet) {
    ajouterJournalDiffereRestauration_(
      etat,
      'RESTAURATION_ECHEC',
      'RESTAURATION',
      etat.backupIdCible,
      {
        etapeEchec: etat.erreurInterne ? 'CONSERVEE' : '',
        auditApresRollback: true
      },
      identifiantHistorique || 'RECUPERATION_AUTOMATIQUE'
    );
    etat.statut = 'RECUPERATION_REQUISE';
    etat.etapeCourante = 'AUDIT_APRES_ROLLBACK';
    etat.modeRecuperation = 'AUDIT_APRES_ROLLBACK';
    enregistrerEtatOperationRestauration_(proprietes, etat);
    return finaliserRollbackRestauration_(etat, proprietes);
  } else {
    etat.statut = 'RECUPERATION_REQUISE';
    etat.etapeCourante = techniquesInconnues.length
      ? 'FEUILLES_TECHNIQUES_ORPHELINES'
      : 'ROLLBACK_INCOMPLET';
    etat.modeRecuperation = techniquesInconnues.length
      ? 'DIAGNOSTIC'
      : 'ROLLBACK';
    etat.erreursRollback = erreurs.slice(0, 20);
    etat.feuillesTechniquesOrphelines = techniquesInconnues.slice();
    enregistrerEtatOperationRestauration_(proprietes, etat);
  }

  return {
    complet: complet,
    nombreErreurs: erreurs.length,
    erreurs: erreurs
  };
}


function finaliserRollbackRestauration_(etat, proprietes) {
  ecrireJournauxDifferesRestauration_(etat);
  enregistrerEtatOperationRestauration_(proprietes, etat);
  etat.statut = 'ECHEC_ROLLBACK_TERMINE';
  etat.etapeCourante = 'ROLLBACK_TERMINE';
  etat.modeRecuperation = '';
  etat.dateFin = new Date().toISOString();
  etat.dureeMs = Date.now() - new Date(etat.dateDebut).getTime();
  proprietes.setProperty(
    PROPRIETE_DERNIERE_RESTAURATION_,
    JSON.stringify(construireEtatArchiveRestauration_(etat))
  );
  proprietes.deleteProperty(
    PROPRIETE_OPERATION_RESTAURATION_ACTIVE_
  );

  if (typeof invaliderCacheStatistiques_ === 'function') {
    invaliderCacheStatistiques_();
  }
  if (typeof invaliderCacheCalendrier_ === 'function') {
    invaliderCacheCalendrier_();
  }

  return {
    complet: true,
    nombreErreurs: 0,
    erreurs: []
  };
}


function restaurerLiaisonRollbackRestauration_(
  classeur,
  etat,
  liaison,
  proprietes
) {
  const configuration = SCHEMA_BASE_.find(function (element) {
    return element.feuille === liaison.feuille;
  });

  if (!configuration || !liaison.empreinteSource) {
    throw new Error('Empreinte source durable absente.');
  }

  let active = classeur.getSheetByName(liaison.feuille);
  let sourceTechnique = trouverCopieSourceTechniqueRestauration_(
    classeur,
    etat,
    liaison,
    configuration
  );

  if (!feuilleCorrespondEmpreinteRestauration_(
    active,
    configuration,
    liaison.empreinteSource
  )) {
    if (!sourceTechnique) {
      throw new Error('Aucune copie valide de la feuille source.');
    }

    if (active) {
      const nomBad = obtenirNomBadDisponibleRestauration_(
        classeur,
        etat,
        liaison
      );

      liaison.etat = 'ECARTEMENT_ACTIF_PREVU';
      enregistrerEtatOperationRestauration_(proprietes, etat);
      active.setName(nomBad);
      liaison.etat = 'ACTIF_ECARTE';
      enregistrerEtatOperationRestauration_(proprietes, etat);
    }

    liaison.etat = 'RESTAURATION_SOURCE_PREVUE';
    enregistrerEtatOperationRestauration_(proprietes, etat);
    sourceTechnique.setName(liaison.feuille);
    liaison.etat = 'SOURCE_RESTAUREE';
    enregistrerEtatOperationRestauration_(proprietes, etat);
    active = classeur.getSheetByName(liaison.feuille);
  }

  if (!feuilleCorrespondEmpreinteRestauration_(
    active,
    configuration,
    liaison.empreinteSource
  )) {
    throw new Error('La copie source restaurée ne correspond pas.');
  }

  liaison.etat = 'SOURCE_VALIDEE';
  enregistrerEtatOperationRestauration_(proprietes, etat);
  nettoyerCopiesTechniquesLiaisonRestauration_(
    classeur,
    etat,
    liaison,
    proprietes
  );
}


function trouverCopieSourceTechniqueRestauration_(
  classeur,
  etat,
  liaison,
  configuration
) {
  const noms = [liaison.nomRollback]
    .concat(liaison.nomsBad || [])
    .filter(Boolean);

  for (let i = 0; i < noms.length; i++) {
    const feuille = classeur.getSheetByName(noms[i]);

    if (feuilleCorrespondEmpreinteRestauration_(
      feuille,
      configuration,
      liaison.empreinteSource
    )) {
      return feuille;
    }
  }

  return null;
}


function obtenirNomBadDisponibleRestauration_(
  classeur,
  etat,
  liaison
) {
  liaison.nomsBad = liaison.nomsBad || [];
  let nom = liaison.nomBad;
  let tentative = 0;

  while (classeur.getSheetByName(nom)) {
    tentative++;
    nom = liaison.nomBad + '_' + tentative;
  }

  if (!liaison.nomsBad.includes(nom)) {
    liaison.nomsBad.push(nom);
  }

  return nom;
}


function nettoyerCopiesTechniquesLiaisonRestauration_(
  classeur,
  etat,
  liaison,
  proprietes
) {
  const staging = (etat.feuillesStaging || []).find(
    function (element) {
      return element.feuille === liaison.feuille;
    }
  );
  const noms = [liaison.nomRollback]
    .concat(liaison.nomsBad || [])
    .concat(staging ? [staging.nomTemporaire] : [])
    .filter(Boolean);

  liaison.etat = 'NETTOYAGE_PREVU';
  enregistrerEtatOperationRestauration_(proprietes, etat);

  noms.forEach(function (nom) {
    const feuille = classeur.getSheetByName(nom);

    if (feuille) {
      classeur.deleteSheet(feuille);
    }
  });

  liaison.etat = 'NETTOYEE';
  enregistrerEtatOperationRestauration_(proprietes, etat);
}


function supprimerFeuillesRollbackRestauration_(classeur, etat) {
  const nonSupprimees = [];

  (etat.feuillesRollback || []).forEach(function (liaison) {
    const feuille = classeur.getSheetByName(liaison.nomRollback);

    if (!feuille) {
      return;
    }

    try {
      const active = classeur.getSheetByName(liaison.feuille);

      if (!active) {
        throw new Error('Feuille active de remplacement absente.');
      }

      classeur.deleteSheet(feuille);
    } catch (erreur) {
      nonSupprimees.push(liaison.feuille);
    }
  });

  (etat.feuillesRollback || []).forEach(function (liaison) {
    const active = classeur.getSheetByName(liaison.feuille);
    const staging = (etat.feuillesStaging || []).find(
      function (element) {
        return element.feuille === liaison.feuille;
      }
    );
    const nomsConnus = (liaison.nomsBad || [])
      .concat(staging ? [staging.nomTemporaire] : [])
      .filter(Boolean);

    nomsConnus.forEach(function (nom) {
      const feuille = classeur.getSheetByName(nom);

      if (!feuille) {
        return;
      }

      if (!active) {
        nonSupprimees.push(nom);
        return;
      }

      try {
        classeur.deleteSheet(feuille);
      } catch (erreur) {
        nonSupprimees.push(nom);
      }
    });
  });

  try {
    SpreadsheetApp.flush();
  } catch (erreurFlush) {
    nonSupprimees.push('FLUSH_FINAL');
  }

  const techniquesRestantes = listerFeuillesTechniquesRestauration_(
    classeur
  );

  return {
    complet: !nonSupprimees.length && !techniquesRestantes.length,
    feuillesRollbackConservees: nonSupprimees,
    feuillesTechniquesRestantes: techniquesRestantes
  };
}


function finaliserOperationRestauration_(
  proprietes,
  etat,
  diagnosticFinal,
  nettoyage
) {
  const fin = Date.now();

  etat.statut = nettoyage.complet
    ? 'TERMINEE'
    : 'TERMINEE_AVEC_NETTOYAGE';
  etat.etapeCourante = 'TERMINEE';
  etat.dateFin = new Date(fin).toISOString();
  etat.dureeMs = fin - new Date(etat.dateDebut).getTime();
  etat.versionSchemaFinale = diagnosticFinal.versionSchema;
  etat.nettoyageRollbackComplet = nettoyage.complet;
  etat.feuillesRollbackConservees =
    nettoyage.feuillesRollbackConservees.slice();

  if (!nettoyage.complet) {
    etat.statut = 'RECUPERATION_REQUISE';
    etat.etapeCourante = 'NETTOYAGE_INCOMPLET';
    etat.modeRecuperation = 'FINALISATION';
    etat.feuillesTechniquesOrphelines = (
      nettoyage.feuillesTechniquesRestantes || []
    ).slice();
    enregistrerEtatOperationRestauration_(proprietes, etat);

    return {
      succes: false,
      recuperationRequise: true,
      backupId: etat.backupIdCible,
      backupIdSecurite: etat.backupIdSecurite,
      versionSchema: diagnosticFinal.versionSchema,
      dureeMs: etat.dureeMs,
      nettoyageRollbackComplet: false,
      message: 'Restauration validée, mais la finalisation doit être reprise avant toute écriture.'
    };
  }

  proprietes.setProperty(
    PROPRIETE_DERNIERE_RESTAURATION_,
    JSON.stringify(construireEtatArchiveRestauration_(etat))
  );
  proprietes.deleteProperty(PROPRIETE_OPERATION_RESTAURATION_ACTIVE_);

  if (typeof invaliderCacheStatistiques_ === 'function') {
    invaliderCacheStatistiques_();
  }
  if (typeof invaliderCacheCalendrier_ === 'function') {
    invaliderCacheCalendrier_();
  }

  return {
    succes: true,
    backupId: etat.backupIdCible,
    backupIdSecurite: etat.backupIdSecurite,
    versionSchema: diagnosticFinal.versionSchema,
    dureeMs: etat.dureeMs,
    nettoyageRollbackComplet: nettoyage.complet,
    message: nettoyage.complet
      ? 'Restauration terminée avec succès.'
      : 'Restauration terminée ; certaines feuilles techniques de rollback restent à nettoyer.'
  };
}


/**
 * Appelé avant les migrations de démarrage. Si une exécution Apps Script
 * est encore vivante, son verrou document empêche toute récupération. Si
 * le verrou est libre, l'état durable est nécessairement interrompu et le
 * rollback est tenté immédiatement.
 */
function recupererRestaurationInterrompueAuDemarrage_() {
  const proprietes = PropertiesService.getScriptProperties();
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const techniques = listerFeuillesTechniquesRestauration_(classeur);
  let etat = lireEtatOperationRestauration_(proprietes);

  if (!etat) {
    if (!techniques.length) {
      return { operationActive: false, recuperee: false };
    }

    etat = creerEtatFeuillesOrphelinesRestauration_(techniques);
    enregistrerEtatOperationRestauration_(proprietes, etat);

    return {
      operationActive: true,
      recuperee: false,
      diagnosticRequis: true
    };
  }

  const verrou = LockService.getDocumentLock();

  if (!verrou.tryLock(1000)) {
    return { operationActive: true, recuperee: false };
  }

  try {
    const inconnues = rattacherFeuillesTechniquesRestauration_(
      etat,
      techniques
    );

    if (inconnues.length) {
      etat.statut = 'RECUPERATION_REQUISE';
      etat.etapeCourante = 'FEUILLES_TECHNIQUES_ORPHELINES';
      etat.modeRecuperation = 'DIAGNOSTIC';
      enregistrerEtatOperationRestauration_(proprietes, etat);

      return {
        operationActive: true,
        recuperee: false,
        diagnosticRequis: true
      };
    }

    if (String(etat.modeRecuperation || '') === 'DIAGNOSTIC') {
      etat.statut = 'RECUPERATION_REQUISE';
      enregistrerEtatOperationRestauration_(proprietes, etat);
      return {
        operationActive: true,
        recuperee: false,
        diagnosticRequis: true
      };
    }

    if (String(etat.modeRecuperation || '') === 'FINALISATION') {
      enregistrerEtatOperationRestauration_(proprietes, etat);
      return {
        operationActive: true,
        recuperee: false,
        finalisationRequise: true
      };
    }

    etat.statut = 'INTERROMPUE';
    etat.etapeCourante = 'RECUPERATION_AUTOMATIQUE';
    enregistrerEtatOperationRestauration_(proprietes, etat);
    const resultat = executerRollbackRestauration_(
      classeur,
      etat,
      proprietes,
      'RECUPERATION_AUTOMATIQUE',
      true
    );

    return {
      operationActive: !resultat.complet,
      recuperee: resultat.complet
    };
  } finally {
    verrou.releaseLock();
  }
}


function enregistrerEtatOperationRestauration_(proprietes, etat) {
  etat.derniereActivite = Date.now();
  proprietes.setProperty(
    PROPRIETE_OPERATION_RESTAURATION_ACTIVE_,
    JSON.stringify(etat)
  );
}


function mettreAJourEtapeRestauration_(proprietes, etat, etape) {
  etat.etapeCourante = etape;
  enregistrerEtatOperationRestauration_(proprietes, etat);
}


function lireEtatOperationRestauration_(proprietes) {
  return lireJsonProprieteRestauration_(
    proprietes.getProperty(PROPRIETE_OPERATION_RESTAURATION_ACTIVE_)
  );
}


function lireJsonProprieteRestauration_(valeur) {
  if (!valeur) {
    return null;
  }

  try {
    return JSON.parse(valeur);
  } catch (erreur) {
    return {
      statut: 'RECUPERATION_REQUISE',
      etapeCourante: 'ETAT_ILLISIBLE',
      modeRecuperation: 'DIAGNOSTIC',
      etatIllisible: true,
      operationId: '',
      backupIdCible: '',
      backupIdSecurite: '',
      feuillesStaging: [],
      feuillesRollback: []
    };
  }
}


function construireEtatPublicRestauration_(etat) {
  return {
    backupId: String(etat.backupIdCible || ''),
    backupIdSecurite: String(etat.backupIdSecurite || ''),
    etape: String(etat.etapeCourante || ''),
    statut: String(etat.statut || ''),
    dateDebut: String(etat.dateDebut || ''),
    dateFin: String(etat.dateFin || ''),
    derniereActivite: etat.derniereActivite
      ? new Date(Number(etat.derniereActivite)).toISOString()
      : '',
    versionSchemaSource: Number(etat.versionSchemaSource || 0),
    versionSchemaCible: Number(etat.versionSchemaCible || 0),
    versionSchemaFinale: Number(etat.versionSchemaFinale || 0),
    dureeMs: Number(etat.dureeMs || 0),
    modeRecuperation: String(etat.modeRecuperation || ''),
    feuillesTechniquesDetectees: (
      etat.feuillesTechniquesOrphelines || []
    ).slice(),
    progression: construireProgressionRestauration_(
      etat.etapeCourante,
      etat.statut
    ),
    message: etat.statut === 'RECUPERATION_REQUISE'
      ? 'Une récupération est requise. Les écritures restent bloquées.'
      : ''
  };
}


function construireEtatArchiveRestauration_(etat) {
  return {
    operationId: etat.operationId,
    backupIdCible: etat.backupIdCible,
    backupIdSecurite: etat.backupIdSecurite,
    etapeCourante: etat.etapeCourante,
    statut: etat.statut,
    dateDebut: etat.dateDebut,
    dateFin: etat.dateFin || '',
    derniereActivite: Date.now(),
    versionSchemaSource: etat.versionSchemaSource,
    versionSchemaCible: etat.versionSchemaCible,
    versionSchemaFinale: etat.versionSchemaFinale || 0,
    dureeMs: etat.dureeMs || 0,
    nettoyageRollbackComplet:
      etat.nettoyageRollbackComplet !== false
  };
}


function construireProgressionRestauration_(etape, statut) {
  const etapes = [
    'SAUVEGARDE_SECURITE',
    'STAGING',
    'VALIDATION_STAGING',
    'BASCULEMENT',
    'MIGRATIONS',
    'DIAGNOSTIC',
    'FINALISATION'
  ];
  const position = etapes.indexOf(String(etape || ''));

  if (String(statut || '').startsWith('TERMINEE')) {
    return 100;
  }

  if (position < 0) {
    return 0;
  }

  return Math.round(((position + 1) / etapes.length) * 100);
}


function construirePlanStagingRestauration_(operationId) {
  return SCHEMA_BASE_.map(function (configuration, position) {
    return {
      feuille: configuration.feuille,
      nomTemporaire: construireNomFeuilleTemporaireRestauration_(
        'STG',
        operationId,
        position
      ),
      position: position,
      etat: 'PREVU',
      basculee: false
    };
  });
}


function construirePlanRollbackRestauration_(operationId, classeur) {
  return SCHEMA_BASE_.map(function (configuration, position) {
    const feuille = classeur.getSheetByName(configuration.feuille);

    if (!feuille) {
      throw new Error(
        'La feuille source ' + configuration.feuille + ' est absente.'
      );
    }

    return {
      feuille: configuration.feuille,
      nomSource: configuration.feuille,
      nomRollback: construireNomFeuilleTemporaireRestauration_(
        'RBK',
        operationId,
        position
      ),
      nomBad: construireNomFeuilleTemporaireRestauration_(
        'BAD',
        operationId,
        position
      ),
      nomsBad: [],
      position: position,
      empreinteSource: calculerEmpreinteFeuilleRestauration_(
        feuille,
        configuration
      ),
      etat: 'PREVU'
    };
  });
}


function calculerEmpreinteFeuilleRestauration_(
  feuille,
  configuration
) {
  if (!feuille) {
    return '';
  }

  return hacherTexteSauvegarde_(
    canonicaliserSauvegarde_(
      lireFeuilleTemporaireRestauration_(feuille, configuration)
    )
  );
}


function feuilleCorrespondEmpreinteRestauration_(
  feuille,
  configuration,
  empreinte
) {
  if (!feuille || !empreinte) {
    return false;
  }

  try {
    return calculerEmpreinteFeuilleRestauration_(
      feuille,
      configuration
    ) === empreinte;
  } catch (erreur) {
    return false;
  }
}


function listerFeuillesTechniquesRestauration_(classeur) {
  return classeur.getSheets()
    .map(function (feuille) {
      return feuille.getName();
    })
    .filter(function (nom) {
      return PREFIXES_FEUILLES_TECHNIQUES_RESTAURATION_.some(
        function (prefixe) {
          return nom.startsWith(prefixe);
        }
      );
    })
    .sort();
}


function rattacherFeuillesTechniquesRestauration_(etat, noms) {
  const cleOperation = String(etat.operationId || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 10);
  const inconnues = [];

  (noms || []).forEach(function (nom) {
    const correspondance = String(nom).match(
      /^__PF_(STG|RBK|BAD)_([A-Za-z0-9]{1,10})_(\d+)(?:_\d+)?$/
    );

    if (!correspondance || correspondance[2] !== cleOperation) {
      inconnues.push(nom);
      return;
    }

    const position = Number(correspondance[3]);
    const staging = (etat.feuillesStaging || []).find(
      function (element) {
        return Number(element.position) === position;
      }
    );
    const rollback = (etat.feuillesRollback || []).find(
      function (element) {
        return Number(element.position) === position;
      }
    );

    if (correspondance[1] === 'STG' && staging) {
      staging.nomTemporaire = nom;
      return;
    }

    if (correspondance[1] === 'RBK' && rollback) {
      rollback.nomRollback = nom;
      return;
    }

    if (correspondance[1] === 'BAD' && rollback) {
      rollback.nomsBad = rollback.nomsBad || [];

      if (!rollback.nomsBad.includes(nom)) {
        rollback.nomsBad.push(nom);
      }
      return;
    }

    inconnues.push(nom);
  });

  etat.feuillesTechniquesOrphelines = inconnues.slice();
  return inconnues;
}


function creerEtatFeuillesOrphelinesRestauration_(noms) {
  return {
    operationId: '',
    backupIdCible: '',
    backupIdSecurite: '',
    dateDebut: new Date().toISOString(),
    derniereActivite: Date.now(),
    statut: 'RECUPERATION_REQUISE',
    etapeCourante: 'FEUILLES_TECHNIQUES_ORPHELINES',
    modeRecuperation: 'DIAGNOSTIC',
    feuillesStaging: [],
    feuillesRollback: [],
    feuillesTechniquesOrphelines: (noms || []).slice(),
    journauxDifferes: [],
    journauxEcrits: false,
    nombreJournauxEcrits: 0
  };
}


function verifierFeuillesTechniquesAvantRestauration_(classeurOptionnel) {
  const classeur = classeurOptionnel ||
    SpreadsheetApp.getActiveSpreadsheet();
  const proprietes = PropertiesService.getScriptProperties();
  const noms = listerFeuillesTechniquesRestauration_(classeur);

  if (!noms.length) {
    return;
  }

  const verrou = LockService.getScriptLock();

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le diagnostic des feuilles techniques est momentanément occupé.'
    );
  }

  try {
    let etat = lireEtatOperationRestauration_(proprietes);

    if (!etat) {
      etat = creerEtatFeuillesOrphelinesRestauration_(noms);
    } else {
      const inconnues = rattacherFeuillesTechniquesRestauration_(
        etat,
        noms
      );

      if (inconnues.length) {
        etat.statut = 'RECUPERATION_REQUISE';
        etat.etapeCourante = 'FEUILLES_TECHNIQUES_ORPHELINES';
        etat.modeRecuperation = 'DIAGNOSTIC';
      }
    }

    enregistrerEtatOperationRestauration_(proprietes, etat);
  } finally {
    verrou.releaseLock();
  }

  throw new Error(
    'Des feuilles techniques de restauration nécessitent un diagnostic administrateur avant toute nouvelle restauration.'
  );
}


function construireNomFeuilleTemporaireRestauration_(
  type,
  operationId,
  position
) {
  return '__PF_' + type + '_' +
    String(operationId || '').replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 10) + '_' + String(position);
}


function resumerMigrationRestauration_(migration) {
  return {
    versionSource: Number(migration.versionSource) || 0,
    versionCible: Number(migration.versionCible) || 0,
    nom: String(migration.nom || '')
  };
}


function hacherIdentifiantOpaqueRestauration_(identifiant) {
  return hacherTexteSauvegarde_(String(identifiant || ''));
}


function verifierIdentifiantOpaqueRestauration_(identifiant) {
  const valeur = String(identifiant || '').trim();

  if (!/^[A-Za-z0-9_-]{40,200}$/.test(valeur)) {
    throw new Error('Identifiant temporaire de restauration invalide.');
  }

  return valeur;
}


function nettoyerPlansRestaurationExpires_(proprietes, maintenant) {
  const toutes = proprietes.getProperties();

  Object.keys(toutes).forEach(function (cle) {
    if (
      !cle.startsWith(PREFIXE_PLAN_RESTAURATION_) &&
      !cle.startsWith(PREFIXE_CONFIRMATION_RESTAURATION_)
    ) {
      return;
    }

    const valeur = lireJsonProprieteRestauration_(toutes[cle]);

    if (!valeur || Number(valeur.expireA || 0) <= maintenant) {
      proprietes.deleteProperty(cle);
    }
  });
}


function journaliserEtapeRestauration_(
  action,
  etat,
  details,
  identifiantHistorique
) {
  const nettoyes = Object.assign({}, details || {}, {
    operationId: etat.operationId,
    etape: etat.etapeCourante,
    statut: etat.statut
  });

  ajouterJournalDiffereRestauration_(
    etat,
    action,
    'RESTAURATION',
    etat.backupIdCible,
    nettoyes,
    identifiantHistorique
  );
}


function ajouterJournalDiffereRestauration_(
  etat,
  action,
  objet,
  identifiant,
  details,
  identifiantHistorique
) {
  etat.journauxDifferes = etat.journauxDifferes || [];
  etat.journauxDifferes.push(
    creerEvenementAuditRestauration_(
      action,
      identifiant,
      details,
      identifiantHistorique,
      objet
    )
  );
}


function creerEvenementAuditRestauration_(
  action,
  identifiant,
  details,
  identifiantHistorique,
  objet
) {
  return {
    idHistorique: Utilities.getUuid(),
    dateAction: new Date().toISOString(),
    action: String(action || ''),
    objet: String(objet || 'RESTAURATION'),
    identifiant: String(identifiant || ''),
    details: details || {},
    utilisateur: String(
      identifiantHistorique || 'RECUPERATION_AUTOMATIQUE'
    )
  };
}


function ecrireJournauxDifferesRestauration_(etat) {
  const journaux = etat.journauxDifferes || [];
  const dejaEcrits = Math.max(
    0,
    Math.min(Number(etat.nombreJournauxEcrits || 0), journaux.length)
  );
  const aEcrire = journaux.slice(dejaEcrits);

  if (!aEcrire.length) {
    etat.journauxEcrits = true;
    return 0;
  }

  const nombre = journaliserActionsSensiblesEnLot_(
    aEcrire,
    CONTEXTE_ECRITURE_RESTAURATION_
  );

  etat.nombreJournauxEcrits = dejaEcrits + nombre;
  etat.journauxEcrits =
    etat.nombreJournauxEcrits >= journaux.length;
  return nombre;
}


function verifierPointEchecRestauration_(options, point) {
  if (options && String(options.echecEtape || '') === point) {
    throw new Error('Échec simulé à l’étape ' + point + '.');
  }
}


function nettoyerMessagePublicRestauration_(erreur) {
  const message = String(erreur && erreur.message || erreur || '')
    .replace(/__PF_[A-Za-z0-9_]+/g, '[feuille technique]');

  if (message.includes('Empreinte attendue=')) {
    return message;
  }

  return message.slice(0, 500);
}
