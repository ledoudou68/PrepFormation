'use strict';

const FONCTION_DECLENCHEUR_SAUVEGARDE_AUTOMATIQUE_ =
  'executerSauvegardeAutomatiquePlanifiee_';
const PROPRIETE_CONFIGURATION_SAUVEGARDES_AUTOMATIQUES_ =
  'PREPFORMATION_BACKUP_SCHEDULE_CONFIG';
const PROPRIETE_DERNIERE_FENETRE_SAUVEGARDE_AUTOMATIQUE_ =
  'PREPFORMATION_BACKUP_SCHEDULE_LAST_WINDOW';
const MODES_SAUVEGARDE_AUTOMATIQUE_ = [
  'DESACTIVE',
  'TOUTES_LES_6_HEURES',
  'TOUTES_LES_12_HEURES',
  'QUOTIDIENNE',
  'HEBDOMADAIRE'
];
const JOURS_SAUVEGARDE_AUTOMATIQUE_ = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE'
];
const RETENTIONS_SAUVEGARDE_AUTOMATIQUE_ = [5, 10, 20, 30];


/**
 * Lecture administrateur de la configuration et de l'état réel du
 * déclencheur. Aucun identifiant Drive n'est retourné.
 */
function getConfigurationSauvegardesAutomatiques(
  jetonAdministrateur
) {
  exigerAdministrateur_(jetonAdministrateur);
  return obtenirConfigurationSauvegardesAutomatiques_();
}


/**
 * Crée ou remplace l'unique déclencheur PrepFormation. Les autres
 * déclencheurs du projet ne sont jamais touchés.
 */
function enregistrerConfigurationSauvegardesAutomatiques(
  configuration,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    const config = normaliserConfigurationSauvegardesAutomatiques_(
      configuration
    );

    if (config.mode === 'DESACTIVE') {
      return desactiverSauvegardesAutomatiquesInterne_(
        session,
        config
      );
    }

    const existants = listerDeclencheursSauvegardesAutomatiques_();
    let nouveau = null;

    try {
      nouveau = creerDeclencheurSauvegardeAutomatique_(config);

      existants.forEach(function (declencheur) {
        ScriptApp.deleteTrigger(declencheur);
      });

      const restants = listerDeclencheursSauvegardesAutomatiques_();

      if (
        restants.length !== 1 ||
        restants[0].getUniqueId() !== nouveau.getUniqueId()
      ) {
        throw new Error(
          'Le déclencheur automatique unique n’a pas pu être vérifié.'
        );
      }

      config.triggerId = nouveau.getUniqueId();
      config.configuredAt = new Date().toISOString();
      enregistrerConfigurationSauvegardesAutomatiques_(config);

      journaliserActionSensible_(
        'SAUVEGARDE_AUTOMATIQUE_CONFIGURATION',
        'SAUVEGARDE',
        config.triggerId,
        {
          mode: config.mode,
          heure: config.heure,
          jourHebdomadaire: config.jourHebdomadaire,
          retention: config.retention,
          nombreDeclencheursSupprimes: existants.length
        },
        session.identifiantHistorique
      );

      return obtenirConfigurationSauvegardesAutomatiques_();
    } catch (erreur) {
      if (nouveau) {
        try {
          ScriptApp.deleteTrigger(nouveau);
        } catch (erreurNettoyage) {
          console.error(erreurNettoyage);
        }
      }

      throw erreur;
    }
  });
}


function desactiverSauvegardesAutomatiques(jetonAdministrateur) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    return desactiverSauvegardesAutomatiquesInterne_(session);
  });
}


function nettoyerDeclencheursSauvegardesAutomatiques(
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    const config = lireConfigurationSauvegardesAutomatiques_();
    const declencheurs = listerDeclencheursSauvegardesAutomatiques_();
    let conserve = null;

    if (config.mode !== 'DESACTIVE') {
      conserve = declencheurs.find(function (declencheur) {
        return declencheur.getUniqueId() === config.triggerId;
      }) || declencheurs[0] || null;
    }

    const aSupprimer = declencheurs.filter(function (declencheur) {
      return !conserve ||
        declencheur.getUniqueId() !== conserve.getUniqueId();
    });

    aSupprimer.forEach(function (declencheur) {
      ScriptApp.deleteTrigger(declencheur);
    });

    config.triggerId = conserve ? conserve.getUniqueId() : '';

    if (!conserve) {
      config.mode = 'DESACTIVE';
    }

    enregistrerConfigurationSauvegardesAutomatiques_(config);

    journaliserActionSensible_(
      'SAUVEGARDE_AUTOMATIQUE_NETTOYAGE_DECLENCHEURS',
      'SAUVEGARDE',
      config.triggerId || 'DESACTIVE',
      { nombreDeclencheursSupprimes: aSupprimer.length },
      session.identifiantHistorique
    );

    return obtenirConfigurationSauvegardesAutomatiques_();
  });
}


function desactiverSauvegardesAutomatiquesInterne_(
  session,
  configurationDemandee
) {
  const declencheurs = listerDeclencheursSauvegardesAutomatiques_();

  declencheurs.forEach(function (declencheur) {
    ScriptApp.deleteTrigger(declencheur);
  });

  if (listerDeclencheursSauvegardesAutomatiques_().length) {
    throw new Error(
      'Tous les déclencheurs automatiques n’ont pas pu être supprimés.'
    );
  }

  const config = configurationDemandee
    ? normaliserConfigurationSauvegardesAutomatiques_(
      configurationDemandee
    )
    : lireConfigurationSauvegardesAutomatiques_();

  config.mode = 'DESACTIVE';
  config.triggerId = '';
  config.configuredAt = new Date().toISOString();
  enregistrerConfigurationSauvegardesAutomatiques_(config);

  journaliserActionSensible_(
    'SAUVEGARDE_AUTOMATIQUE_DESACTIVATION',
    'SAUVEGARDE',
    'DESACTIVE',
    { nombreDeclencheursSupprimes: declencheurs.length },
    session.identifiantHistorique
  );

  return obtenirConfigurationSauvegardesAutomatiques_();
}


/**
 * Gestionnaire privé du déclencheur propriétaire. Le suffixe "_" le
 * rend inaccessible à google.script.run.
 */
function executerSauvegardeAutomatiquePlanifiee_(evenement) {
  const debut = Date.now();
  const identifiantAudit = construireIdentifiantAuditDeclencheur_(
    evenement
  );

  try {
    return executerMutationMetier_(function () {
      const config = lireConfigurationSauvegardesAutomatiques_();

      if (config.mode === 'DESACTIVE') {
        return {
          succes: true,
          ignoree: true,
          raison: 'PLANIFICATION_DESACTIVEE'
        };
      }

      if (
        evenement &&
        evenement.triggerUid &&
        config.triggerId &&
        String(evenement.triggerUid) !== String(config.triggerId)
      ) {
        return {
          succes: true,
          ignoree: true,
          raison: 'DECLENCHEUR_OBSOLETE'
        };
      }

      const proprietes = PropertiesService.getScriptProperties();
      const fenetre = construireFenetreSauvegardeAutomatique_(
        config,
        new Date()
      );

      if (
        proprietes.getProperty(
          PROPRIETE_DERNIERE_FENETRE_SAUVEGARDE_AUTOMATIQUE_
        ) === fenetre
      ) {
        return {
          succes: true,
          ignoree: true,
          raison: 'FENETRE_DEJA_TRAITEE',
          fenetre: fenetre
        };
      }

      const session = {
        identifiantHistorique: identifiantAudit
      };
      const resultat = creerSauvegardeCompleteInterne_(
        'Sauvegarde automatique planifiée',
        TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_,
        session,
        '',
        true,
        { differerJournalisation: true }
      );

      proprietes.setProperty(
        PROPRIETE_DERNIERE_FENETRE_SAUVEGARDE_AUTOMATIQUE_,
        fenetre
      );

      let retention = {
        succes: true,
        placeesCorbeille: [],
        erreurs: []
      };

      try {
        retention = appliquerRetentionSauvegardesAutomatiques_(
          config.retention,
          resultat.backupId,
          session
        );
      } catch (erreurRetention) {
        retention = {
          succes: false,
          placeesCorbeille: [],
          erreurs: [String(
            erreurRetention.message || erreurRetention
          ).slice(0, 500)]
        };
      }

      const duree = Date.now() - debut;

      config.lastExecutionAt = new Date().toISOString();
      config.lastResult = retention.succes
        ? 'SUCCES'
        : 'SUCCES_RETENTION_ECHEC';
      config.lastMessage = retention.succes
        ? 'Sauvegarde automatique vérifiée.'
        : 'Sauvegarde vérifiée ; la rétention a rencontré une erreur.';
      config.lastDurationMs = duree;
      config.lastBackupId = resultat.backupId;
      enregistrerConfigurationSauvegardesAutomatiques_(config);

      journaliserActionSensible_(
        'SAUVEGARDE_AUTOMATIQUE_SUCCES',
        'SAUVEGARDE',
        resultat.backupId,
        {
          type: TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_,
          fenetre: fenetre,
          dureeMs: duree,
          tailleOctets: resultat.fileSizeBytes,
          statutIntegrite: resultat.integrityStatus,
          retentionReussie: retention.succes,
          nombrePurges: retention.placeesCorbeille.length,
          erreursRetention: retention.erreurs
        },
        identifiantAudit
      );

      return {
        succes: true,
        backupId: resultat.backupId,
        dureeMs: duree,
        retention: retention
      };
    });
  } catch (erreur) {
    const duree = Date.now() - debut;

    memoriserEchecSauvegardeAutomatique_(erreur, duree);
    journaliserEvenementSecuriteSansBloquer_(
      'SAUVEGARDE_AUTOMATIQUE_ECHEC',
      'SAUVEGARDE',
      'DECLENCHEUR_PLANIFIE',
      {
        dureeMs: duree,
        message: String(erreur.message || erreur).slice(0, 500)
      },
      identifiantAudit
    );
    throw erreur;
  }
}


function appliquerRetentionSauvegardesAutomatiques_(
  retention,
  nouveauBackupId,
  session
) {
  const limite = normaliserRetentionSauvegardeAutomatique_(retention);
  const contexte = obtenirContexteRestaurabilite_(false);
  const fichiers = contexte.dossier.getFiles();
  const automatiques = [];

  while (fichiers.hasNext()) {
    const fichier = fichiers.next();
    const nom = String(fichier.getName() || '');

    if (
      fichier.isTrashed() ||
      !nom.endsWith('.json') ||
      nom.endsWith(SUFFIXE_RAPPORT_RESTAURABILITE_) ||
      nom.endsWith('.partial')
    ) {
      continue;
    }

    try {
      const validation = validerFichierSauvegardeRestaurabilite_(
        fichier,
        contexte,
        ''
      );

      if (
        validation.sauvegarde.metadata.type ===
          TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_
      ) {
        automatiques.push({
          backupId: validation.sauvegarde.backupId,
          createdAt: validation.sauvegarde.metadata.createdAt
        });
      }
    } catch (erreur) {
      // Un fichier non vérifiable n'est jamais purgé automatiquement.
    }
  }

  automatiques.sort(function (a, b) {
    return String(b.createdAt || '').localeCompare(
      String(a.createdAt || '')
    );
  });

  const proteges = obtenirBackupIdsProtegesRestauration_();
  const aConserver = new Set(
    automatiques.slice(0, limite).map(function (sauvegarde) {
      return sauvegarde.backupId;
    })
  );

  if (nouveauBackupId) {
    aConserver.add(String(nouveauBackupId));
  }

  proteges.forEach(function (backupId) {
    aConserver.add(backupId);
  });

  const resultat = {
    succes: true,
    retention: limite,
    placeesCorbeille: [],
    erreurs: []
  };

  automatiques.forEach(function (sauvegarde) {
    if (aConserver.has(sauvegarde.backupId)) {
      return;
    }

    try {
      const suppression = placerSauvegardeCorbeilleInterne_(
        sauvegarde.backupId,
        { autoriserProtectionActive: false }
      );

      resultat.placeesCorbeille.push(sauvegarde.backupId);
      journaliserActionSensible_(
        'SAUVEGARDE_AUTOMATIQUE_RETENTION_CORBEILLE',
        'SAUVEGARDE',
        sauvegarde.backupId,
        {
          type: suppression.type,
          retention: limite,
          rapportsPlacesCorbeille:
            suppression.nombreRapportsCorbeille
        },
        session.identifiantHistorique
      );
    } catch (erreur) {
      resultat.succes = false;
      resultat.erreurs.push(
        sauvegarde.backupId + ' : ' +
        String(erreur.message || erreur).slice(0, 300)
      );
    }
  });

  return resultat;
}


function obtenirConfigurationSauvegardesAutomatiques_() {
  const config = lireConfigurationSauvegardesAutomatiques_();
  const declencheurs = listerDeclencheursSauvegardesAutomatiques_();
  const actif = declencheurs.find(function (declencheur) {
    return declencheur.getUniqueId() === config.triggerId;
  }) || null;

  return {
    mode: config.mode,
    heure: config.heure,
    jourHebdomadaire: config.jourHebdomadaire,
    retention: config.retention,
    configuredAt: config.configuredAt,
    lastExecutionAt: config.lastExecutionAt,
    lastResult: config.lastResult,
    lastMessage: config.lastMessage,
    lastDurationMs: config.lastDurationMs,
    prochaineExecutionEstimee:
      estimerProchaineExecutionSauvegardeAutomatique_(config),
    declencheurActif: Boolean(actif),
    nombreDeclencheursPrepFormation: declencheurs.length,
    configurationCoherente: config.mode === 'DESACTIVE'
      ? declencheurs.length === 0
      : Boolean(actif && declencheurs.length === 1),
    precisionHoraire:
      'L’heure est approximative : Apps Script exécute les déclencheurs dans une plage horaire.'
  };
}


function lireConfigurationSauvegardesAutomatiques_() {
  const proprietes = PropertiesService.getScriptProperties();
  const valeur = proprietes.getProperty(
    PROPRIETE_CONFIGURATION_SAUVEGARDES_AUTOMATIQUES_
  );
  let config = {};

  if (valeur) {
    try {
      config = JSON.parse(valeur);
    } catch (erreur) {
      config = {};
    }
  }

  return normaliserConfigurationSauvegardesAutomatiques_(config);
}


function enregistrerConfigurationSauvegardesAutomatiques_(config) {
  PropertiesService.getScriptProperties().setProperty(
    PROPRIETE_CONFIGURATION_SAUVEGARDES_AUTOMATIQUES_,
    JSON.stringify(normaliserConfigurationSauvegardesAutomatiques_(
      config
    ))
  );
}


function normaliserConfigurationSauvegardesAutomatiques_(config) {
  const source = config || {};
  const mode = MODES_SAUVEGARDE_AUTOMATIQUE_.includes(
    String(source.mode || '')
  )
    ? String(source.mode)
    : 'DESACTIVE';
  const jour = JOURS_SAUVEGARDE_AUTOMATIQUE_.includes(
    String(source.jourHebdomadaire || '')
  )
    ? String(source.jourHebdomadaire)
    : 'LUNDI';
  const heure = Math.max(
    0,
    Math.min(23, Math.floor(Number(source.heure) || 0))
  );

  return {
    mode: mode,
    heure: heure,
    jourHebdomadaire: jour,
    retention: normaliserRetentionSauvegardeAutomatique_(
      source.retention
    ),
    triggerId: String(source.triggerId || ''),
    configuredAt: String(source.configuredAt || ''),
    lastExecutionAt: String(source.lastExecutionAt || ''),
    lastResult: String(source.lastResult || 'JAMAIS_EXECUTEE'),
    lastMessage: String(source.lastMessage || ''),
    lastDurationMs: Math.max(
      0,
      Number(source.lastDurationMs || 0)
    ),
    lastBackupId: String(source.lastBackupId || '')
  };
}


function normaliserRetentionSauvegardeAutomatique_(valeur) {
  const retention = Math.floor(Number(valeur) || 10);

  return RETENTIONS_SAUVEGARDE_AUTOMATIQUE_.includes(retention)
    ? retention
    : 10;
}


function creerDeclencheurSauvegardeAutomatique_(config) {
  let constructeur = ScriptApp
    .newTrigger(FONCTION_DECLENCHEUR_SAUVEGARDE_AUTOMATIQUE_)
    .timeBased();
  const fuseau = Session.getScriptTimeZone();

  if (config.mode === 'TOUTES_LES_6_HEURES') {
    constructeur = constructeur.everyHours(6);
  } else if (config.mode === 'TOUTES_LES_12_HEURES') {
    constructeur = constructeur.everyHours(12);
  } else if (config.mode === 'QUOTIDIENNE') {
    constructeur = constructeur
      .atHour(config.heure)
      .everyDays(1)
      .inTimezone(fuseau);
  } else if (config.mode === 'HEBDOMADAIRE') {
    constructeur = constructeur
      .atHour(config.heure)
      .everyWeeks(1)
      .onWeekDay(
        ScriptApp.WeekDay[config.jourHebdomadaire]
      )
      .inTimezone(fuseau);
  } else {
    throw new Error('Fréquence de sauvegarde automatique invalide.');
  }

  return constructeur.create();
}


function listerDeclencheursSauvegardesAutomatiques_() {
  return ScriptApp.getProjectTriggers().filter(function (declencheur) {
    return declencheur.getHandlerFunction() ===
      FONCTION_DECLENCHEUR_SAUVEGARDE_AUTOMATIQUE_;
  });
}


function construireFenetreSauvegardeAutomatique_(config, date) {
  const maintenant = date instanceof Date ? date : new Date(date);
  const fuseau = Session.getScriptTimeZone();

  if (config.mode === 'TOUTES_LES_6_HEURES') {
    return '6H:' + Math.floor(maintenant.getTime() / (6 * 3600000));
  }

  if (config.mode === 'TOUTES_LES_12_HEURES') {
    return '12H:' + Math.floor(maintenant.getTime() / (12 * 3600000));
  }

  if (config.mode === 'HEBDOMADAIRE') {
    return 'SEMAINE:' + Utilities.formatDate(
      maintenant,
      fuseau,
      'yyyy-ww'
    );
  }

  return 'JOUR:' + Utilities.formatDate(
    maintenant,
    fuseau,
    'yyyy-MM-dd'
  );
}


function estimerProchaineExecutionSauvegardeAutomatique_(config) {
  if (config.mode === 'DESACTIVE') {
    return '';
  }

  const maintenant = new Date();

  if (
    config.mode === 'TOUTES_LES_6_HEURES' ||
    config.mode === 'TOUTES_LES_12_HEURES'
  ) {
    const heures = config.mode === 'TOUTES_LES_6_HEURES' ? 6 : 12;
    const base = config.lastExecutionAt
      ? new Date(config.lastExecutionAt)
      : (config.configuredAt
        ? new Date(config.configuredAt)
        : maintenant);
    let prochaine = new Date(base.getTime() + heures * 3600000);

    while (prochaine <= maintenant) {
      prochaine = new Date(prochaine.getTime() + heures * 3600000);
    }

    return prochaine.toISOString();
  }

  const prochaine = new Date(maintenant.getTime());

  prochaine.setHours(config.heure, 0, 0, 0);

  if (config.mode === 'QUOTIDIENNE') {
    if (prochaine <= maintenant) {
      prochaine.setDate(prochaine.getDate() + 1);
    }

    return prochaine.toISOString();
  }

  const joursJavascript = {
    DIMANCHE: 0,
    LUNDI: 1,
    MARDI: 2,
    MERCREDI: 3,
    JEUDI: 4,
    VENDREDI: 5,
    SAMEDI: 6
  };
  let decalage = (
    joursJavascript[config.jourHebdomadaire] -
    prochaine.getDay() + 7
  ) % 7;

  if (decalage === 0 && prochaine <= maintenant) {
    decalage = 7;
  }

  prochaine.setDate(prochaine.getDate() + decalage);
  return prochaine.toISOString();
}


function construireIdentifiantAuditDeclencheur_(evenement) {
  const uid = String(
    evenement && evenement.triggerUid
      ? evenement.triggerUid
      : 'PLANIFIE'
  );

  return 'DECLENCHEUR_AUTO:' + hacherTexteSauvegarde_(uid).slice(0, 16);
}


function memoriserEchecSauvegardeAutomatique_(erreur, duree) {
  const verrou = LockService.getDocumentLock();
  const dejaDetenu = verrou.hasLock();

  if (!dejaDetenu && !verrou.tryLock(1000)) {
    return;
  }

  try {
    const config = lireConfigurationSauvegardesAutomatiques_();

    config.lastExecutionAt = new Date().toISOString();
    config.lastResult = 'ECHEC';
    config.lastMessage = String(
      erreur.message || erreur
    ).slice(0, 500);
    config.lastDurationMs = Number(duree || 0);
    enregistrerConfigurationSauvegardesAutomatiques_(config);
  } catch (erreurMemorisation) {
    console.error(erreurMemorisation);
  } finally {
    if (!dejaDetenu) {
      verrou.releaseLock();
    }
  }
}


function obtenirBackupIdsProtegesRestauration_() {
  const etat = lireEtatOperationRestauration_(
    PropertiesService.getScriptProperties()
  );
  const proteges = new Set();

  if (etat) {
    [etat.backupIdCible, etat.backupIdSecurite]
      .map(function (valeur) {
        return String(valeur || '').trim();
      })
      .filter(Boolean)
      .forEach(function (backupId) {
        proteges.add(backupId);
      });
  }

  return proteges;
}
