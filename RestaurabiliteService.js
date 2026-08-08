'use strict';

const FORMAT_RAPPORT_RESTAURABILITE_ =
  'PREPFORMATION_RESTORE_TEST_REPORT';
const VERSION_FORMAT_RAPPORT_RESTAURABILITE_ = 1;
const SUFFIXE_RAPPORT_RESTAURABILITE_ = '.restore-test.json';
const PREFIXE_DESCRIPTION_RAPPORT_RESTAURABILITE_ =
  'PREPFORMATION_RESTORE_TEST:';
const LIMITE_IDENTIFIANTS_RAPPORT_RESTAURABILITE_ = 50;
const LIMITE_ERREURS_RAPPORT_RESTAURABILITE_ = 500;
const OCTETS_MAX_SIMULATION_RESTAURABILITE_ = 35 * 1024 * 1024;
const CELLULES_MAX_SIMULATION_RESTAURABILITE_ = 1500000;
const LIGNES_MAX_SIMULATION_RESTAURABILITE_ = 250000;


/**
 * Inventaire public des sauvegardes valides de l'installation courante.
 */
function listerSauvegardesRestaurabilite(jetonAdministrateur) {
  exigerAdministrateurLectureSeule_(jetonAdministrateur);
  return construireInventaireSauvegardesRestaurabilite_();
}


/**
 * Consultation vérifiée d'une sauvegarde et de son dernier rapport.
 */
function consulterSauvegardeRestaurabilite(
  backupId,
  jetonAdministrateur
) {
  const session = exigerAdministrateurLectureSeule_(
    jetonAdministrateur
  );
  const identifiant = nettoyerBackupIdSauvegarde_(backupId);
  const contexte = obtenirContexteRestaurabilite_(false);
  const fichier = trouverFichierSauvegardeRestaurabilite_(
    contexte.dossier,
    identifiant
  );

  if (!fichier) {
    throw new Error('Sauvegarde introuvable.');
  }

  const resultat = validerFichierSauvegardeRestaurabilite_(
    fichier,
    contexte,
    identifiant
  );
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const versionSchemaCourante = lireVersionSchemaSansCreation_(
    classeur
  );
  const dernierRapport = lireDernierRapportRestaurabilite_(
    contexte.dossier,
    identifiant,
    resultat.empreinteFichier,
    versionSchemaCourante
  );

  journaliserActionSensible_(
    'SAUVEGARDE_CONSULTATION',
    'SAUVEGARDE',
    identifiant,
    {
      formatValide: true,
      signatureValide: true,
      nombreFeuilles: resultat.sauvegarde.manifest.length,
      tailleOctets: resultat.tailleOctets
    },
    session.identifiantHistorique
  );

  return construireConsultationPubliqueRestaurabilite_(
    resultat,
    dernierRapport
  );
}


/**
 * Teste une restauration sur un modèle en mémoire. Les seules écritures
 * sont le rapport secondaire Drive et les traces d'audit obligatoires.
 */
function testerRestaurabiliteSauvegarde(
  backupId,
  jetonAdministrateur
) {
  const session = exigerAdministrateurLectureSeule_(
    jetonAdministrateur
  );
  const identifiant = nettoyerBackupIdSauvegarde_(backupId);

  return executerMutationMetier_(function () {
    return testerRestaurabiliteSauvegardeInterne_(
      identifiant,
      session
    );
  });
}


function testerRestaurabiliteSauvegardeInterne_(
  identifiant,
  session
) {

  const debut = Date.now();
  let contexte = null;
  let fichier = null;
  let contenu = '';
  let empreinteFichier = '';
  let etatActuel = null;
  let rapport;

  try {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();

    etatActuel = capturerEtatActuelRestaurabilite_(classeur);

    journaliserActionSensible_(
      'SAUVEGARDE_TEST_RESTAURATION_LANCEMENT',
      'SAUVEGARDE',
      identifiant,
      { mode: 'SIMULATION_LECTURE_SEULE' },
      session.identifiantHistorique
    );

    contexte = obtenirContexteRestaurabilite_(false);
    fichier = trouverFichierSauvegardeRestaurabilite_(
      contexte.dossier,
      identifiant
    );

    if (!fichier) {
      throw new Error('Sauvegarde introuvable.');
    }

    contenu = fichier.getBlob().getDataAsString('UTF-8');
    empreinteFichier = hacherTexteSauvegarde_(contenu);

    if (
      Number(fichier.getSize()) !==
        tailleUtf8Sauvegarde_(contenu)
    ) {
      throw new Error(
        'La taille Drive et la taille réelle du JSON diffèrent.'
      );
    }

    rapport = construireRapportTestRestaurabilite_(
      identifiant,
      fichier,
      contenu,
      empreinteFichier,
      contexte,
      etatActuel,
      debut
    );
  } catch (erreur) {
    rapport = construireRapportEchecRestaurabilite_(
      identifiant,
      empreinteFichier,
      etatActuel,
      erreur,
      debut
    );
  }

  try {
    if (contexte && contexte.dossier && fichier) {
      enregistrerRapportRestaurabilite_(
        contexte.dossier,
        rapport
      );
      rapport.rapportSecondaireEnregistre = true;
    }
  } catch (erreurRapport) {
    rapport.rapportSecondaireEnregistre = false;
    rapport.avertissements.push({
      code: 'RAPPORT_DRIVE_NON_ENREGISTRE',
      message: String(
        erreurRapport.message || erreurRapport
      ).slice(0, 500)
    });
  }

  rapport.dureeReelleMs = Date.now() - debut;

  journaliserActionSensible_(
    rapport.statut === 'NON_RESTAURABLE'
      ? 'SAUVEGARDE_TEST_RESTAURATION_ECHEC'
      : 'SAUVEGARDE_TEST_RESTAURATION_SUCCES',
    'SAUVEGARDE',
    identifiant,
    {
      statut: rapport.statut,
      statutSousJacent: rapport.statutSousJacent,
      migrationsNecessaires:
        rapport.migrationsNecessaires.length,
      erreursBloquantes: rapport.erreursBloquantes.length,
      avertissements: rapport.avertissements.length,
      dureeMs: rapport.dureeReelleMs,
      rapportSecondaireEnregistre:
        rapport.rapportSecondaireEnregistre === true
    },
    session.identifiantHistorique
  );

  return rapport;
}


function construireInventaireSauvegardesRestaurabilite_() {
  let contexte;

  try {
    contexte = obtenirContexteRestaurabilite_(true);
  } catch (erreur) {
    return {
      disponible: false,
      sauvegardes: [],
      resume: construireResumeGlobalInventaireSauvegardes_([]),
      fichiersIgnores: 0,
      erreur: String(erreur.message || erreur)
    };
  }

  if (!contexte.dossier) {
    return {
      disponible: true,
      sauvegardes: [],
      resume: construireResumeGlobalInventaireSauvegardes_([]),
      fichiersIgnores: 0,
      erreur: ''
    };
  }

  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const versionSchemaCourante = lireVersionSchemaSansCreation_(
    classeur
  );
  const rapports = indexerRapportsRestaurabilite_(
    contexte.dossier
  );
  const fichiers = contexte.dossier.getFiles();
  const sauvegardes = [];
  let ignores = 0;

  while (fichiers.hasNext()) {
    const fichier = fichiers.next();
    const nom = String(fichier.getName() || '');

    if (
      fichier.isTrashed() ||
      nom.endsWith('.partial') ||
      nom.endsWith(SUFFIXE_RAPPORT_RESTAURABILITE_) ||
      !nom.endsWith('.json')
    ) {
      continue;
    }

    try {
      const resultat = validerFichierSauvegardeRestaurabilite_(
        fichier,
        contexte,
        ''
      );
      const rapport = selectionnerRapportCourantRestaurabilite_(
        rapports[resultat.sauvegarde.backupId] || [],
        resultat.empreinteFichier,
        versionSchemaCourante
      );

      sauvegardes.push(
        construireResumeInventaireRestaurabilite_(
          resultat,
          rapport
        )
      );
    } catch (erreur) {
      ignores++;
    }
  }

  sauvegardes.sort(function (a, b) {
    return String(b.createdAt || '').localeCompare(
      String(a.createdAt || '')
    );
  });

  const proteges = obtenirBackupIdsProtegesRestauration_();

  sauvegardes.forEach(function (sauvegarde) {
    sauvegarde.protegeeOperationActive = proteges.has(
      sauvegarde.backupId
    );
    sauvegarde.suppressionAutorisee =
      !sauvegarde.protegeeOperationActive;
  });

  return {
    disponible: true,
    sauvegardes: sauvegardes,
    resume: construireResumeGlobalInventaireSauvegardes_(
      sauvegardes
    ),
    fichiersIgnores: ignores,
    erreur: ''
  };
}


function construireResumeGlobalInventaireSauvegardes_(sauvegardes) {
  const liste = Array.isArray(sauvegardes) ? sauvegardes : [];
  const dates = liste
    .map(function (sauvegarde) {
      return String(sauvegarde.createdAt || '');
    })
    .filter(Boolean)
    .sort();

  return {
    nombreTotal: liste.length,
    espaceTotalOctets: liste.reduce(function (total, sauvegarde) {
      return total + Number(sauvegarde.fileSizeBytes || 0);
    }, 0),
    plusAncienne: dates.length ? dates[0] : '',
    plusRecente: dates.length ? dates[dates.length - 1] : '',
    parType: {
      manuelles: liste.filter(function (sauvegarde) {
        return sauvegarde.type === TYPE_SAUVEGARDE_MANUELLE_;
      }).length,
      automatiques: liste.filter(function (sauvegarde) {
        return sauvegarde.type ===
          TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_;
      }).length,
      securite: liste.filter(function (sauvegarde) {
        return sauvegarde.type ===
          TYPE_SAUVEGARDE_SECURITE_RESTAURATION_;
      }).length,
      operationsAdministration: liste.filter(function (sauvegarde) {
        return sauvegarde.type ===
          TYPE_SAUVEGARDE_AVANT_OPERATION_ADMIN_;
      }).length,
      reinitialisationsProduction: liste.filter(function (sauvegarde) {
        return sauvegarde.type ===
          TYPE_SAUVEGARDE_AVANT_REINITIALISATION_PRODUCTION_;
      }).length
    }
  };
}


function obtenirContexteRestaurabilite_(autoriserVide) {
  const proprietes = PropertiesService.getScriptProperties();
  const installationId = String(
    proprietes.getProperty(
      PROPRIETE_INSTALLATION_SAUVEGARDE_
    ) || ''
  );
  const cleHmac = String(
    proprietes.getProperty(PROPRIETE_CLE_HMAC_SAUVEGARDE_) || ''
  );
  const keyId = String(
    proprietes.getProperty(
      PROPRIETE_ID_CLE_HMAC_SAUVEGARDE_
    ) || ''
  );
  const idRacine = String(
    proprietes.getProperty(
      PROPRIETE_DOSSIER_RACINE_SAUVEGARDE_
    ) || ''
  );
  const idDossier = String(
    proprietes.getProperty(PROPRIETE_DOSSIER_SAUVEGARDE_) || ''
  );

  if (
    !installationId ||
    !cleHmac ||
    !keyId ||
    !idRacine ||
    !idDossier
  ) {
    if (autoriserVide) {
      return {
        installationId: installationId,
        cleHmac: cleHmac,
        keyId: keyId,
        dossier: null
      };
    }

    throw new Error(
      'Le stockage des sauvegardes n’est pas encore initialisé.'
    );
  }

  let racine;
  let dossier;

  try {
    racine = DriveApp.getFolderById(idRacine);
    dossier = DriveApp.getFolderById(idDossier);
  } catch (erreur) {
    throw new Error(
      'Le dossier privé des sauvegardes est inaccessible.'
    );
  }

  const marqueurRacine =
    'PREPFORMATION_INSTALLATION:' + installationId;
  const marqueurSauvegardes =
    'PREPFORMATION_BACKUPS:' + installationId;

  if (
    racine.isTrashed() ||
    dossier.isTrashed() ||
    racine.getName() !== 'PrepFormation' ||
    dossier.getName() !== 'Sauvegardes' ||
    !String(racine.getDescription() || '')
      .includes(marqueurRacine) ||
    !String(dossier.getDescription() || '')
      .includes(marqueurSauvegardes) ||
    !dossierEstEnfantSauvegarde_(dossier, racine.getId())
  ) {
    throw new Error(
      'Le dossier privé des sauvegardes ne correspond pas à cette installation.'
    );
  }

  return {
    installationId: installationId,
    cleHmac: cleHmac,
    keyId: keyId,
    dossier: dossier
  };
}


function trouverFichierSauvegardeRestaurabilite_(
  dossier,
  backupId
) {
  const fichiers = dossier.getFiles();
  const correspondances = [];

  while (fichiers.hasNext()) {
    const fichier = fichiers.next();
    const nom = String(fichier.getName() || '');

    if (
      fichier.isTrashed() ||
      !nom.endsWith('.json') ||
      nom.endsWith(SUFFIXE_RAPPORT_RESTAURABILITE_)
    ) {
      continue;
    }

    const description = lireDescriptionFichierSauvegarde_(fichier);

    if (description && description.backupId === backupId) {
      correspondances.push(fichier);
      continue;
    }

    try {
      const donnees = JSON.parse(
        fichier.getBlob().getDataAsString('UTF-8')
      );

      if (String(donnees.backupId || '') === backupId) {
        correspondances.push(fichier);
      }
    } catch (erreur) {
      // Un fichier JSON illisible ne peut être retrouvé que par sa description.
    }
  }

  if (correspondances.length > 1) {
    throw new Error(
      'Plusieurs fichiers portent le même backupId. Le test est bloqué.'
    );
  }

  return correspondances[0] || null;
}


function validerFichierSauvegardeRestaurabilite_(
  fichier,
  contexte,
  backupIdAttendu
) {
  const contenu = fichier.getBlob().getDataAsString('UTF-8');
  const taille = tailleUtf8Sauvegarde_(contenu);

  if (Number(fichier.getSize()) !== taille) {
    throw new Error(
      'La taille Drive et la taille réelle du JSON diffèrent.'
    );
  }

  const verification = verifierContenuSauvegarde_(
    contenu,
    contexte.cleHmac,
    contexte.keyId,
    contexte.installationId
  );
  const sauvegarde = verification.sauvegarde;

  if (
    backupIdAttendu &&
    sauvegarde.backupId !== backupIdAttendu
  ) {
    throw new Error(
      'Le backupId du fichier ne correspond pas à la sauvegarde demandée.'
    );
  }

  verifierTypesDonneesSauvegardeRestaurabilite_(sauvegarde);

  return {
    sauvegarde: sauvegarde,
    verification: verification,
    contenuOriginal: contenu,
    empreinteFichier: hacherTexteSauvegarde_(contenu),
    tailleOctets: taille
  };
}


function verifierTypesDonneesSauvegardeRestaurabilite_(sauvegarde) {
  sauvegarde.manifest.forEach(function (entree) {
    const feuille = sauvegarde.sheets[entree.name];

    feuille.rows.forEach(function (ligne, positionLigne) {
      ligne.forEach(function (valeur, positionColonne) {
        if (typeValeurSauvegardeRestaurabiliteValide_(valeur)) {
          return;
        }

        throw new Error(
          'Type de donnée sérialisé invalide dans ' +
          entree.name + ', ligne ' + (positionLigne + 2) +
          ', colonne ' + (positionColonne + 1) + '.'
        );
      });
    });
  });
}


function typeValeurSauvegardeRestaurabiliteValide_(valeur) {
  if (
    valeur === null ||
    typeof valeur === 'string' ||
    typeof valeur === 'boolean'
  ) {
    return true;
  }

  if (typeof valeur === 'number') {
    return Number.isFinite(valeur);
  }

  if (
    !valeur ||
    Array.isArray(valeur) ||
    typeof valeur !== 'object' ||
    valeur.type !== 'DATE_ISO_UTC' ||
    Object.keys(valeur).sort().join(',') !== 'type,value'
  ) {
    return false;
  }

  const texte = String(valeur.value || '');
  const date = new Date(texte);

  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(texte) &&
    !Number.isNaN(date.getTime())
  );
}


function construireRapportTestRestaurabilite_(
  backupId,
  fichier,
  contenu,
  empreinteFichier,
  contexte,
  etatActuel,
  debut
) {
  const validation = validerFichierSauvegardeRestaurabilite_(
    fichier,
    contexte,
    backupId
  );
  const sauvegarde = validation.sauvegarde;
  const versionSauvegarde = Math.max(
    0,
    Number(sauvegarde.metadata.schemaVersion) || 0
  );
  const versionCible = obtenirVersionSchemaCible_();
  const erreursBloquantes = [];
  const avertissements = [];
  const estimation = estimerSimulationRestaurabilite_(
    sauvegarde,
    validation.tailleOctets
  );

  if (!estimation.faisable) {
    const rapportCapacite = construireRapportEchecRestaurabilite_(
      backupId,
      empreinteFichier,
      etatActuel,
      new Error(
        'Capacité de simulation dépassée : ' + estimation.raison
      ),
      debut
    );

    rapportCapacite.schemaVersionSauvegarde = versionSauvegarde;
    rapportCapacite.estimation = estimation;
    rapportCapacite.validation = {
      jsonValide: true,
      formatValide: true,
      versionFormatValide: true,
      installationValide: true,
      canonicalisationValide: true,
      empreintesFeuillesValides: true,
      empreinteGlobaleValide: true,
      signatureHmacValide: true,
      compteursValides: true,
      dimensionsValides: true,
      typesValides: true
    };
    rapportCapacite.elementsParFeuille =
      sauvegarde.manifest.map(function (entree) {
        return {
          feuille: entree.name,
          lignes: entree.rowCount,
          colonnes: entree.columnCount,
          cellules: entree.cellCount,
          lignesIdentifiees: entree.identifiedRowCount
        };
      });

    return rapportCapacite;
  }

  if (versionSauvegarde > versionCible) {
    erreursBloquantes.push({
      code: 'SCHEMA_PLUS_RECENT',
      message: 'Le schéma sauvegardé (' + versionSauvegarde +
        ') est plus récent que le schéma pris en charge (' +
        versionCible + ').'
    });
  }

  const modeleSource = {
    sheets: JSON.parse(JSON.stringify(sauvegarde.sheets))
  };
  const diagnosticAvant =
    construireDiagnosticModeleRestaurabilite_(modeleSource);
  const simulation = simulerMigrationsModele_(
    modeleSource,
    versionSauvegarde,
    versionCible
  );

  if (!simulation.chaineComplete || !simulation.reussie) {
    erreursBloquantes.push({
      code: 'CHAINE_MIGRATIONS_INCOMPLETE',
      message: simulation.raison ||
        'La chaîne de migrations n’est pas complète.'
    });
  }

  const diagnosticApres = simulation.reussie
    ? construireDiagnosticModeleRestaurabilite_(
      simulation.modele
    )
    : diagnosticAvant;

  diagnosticApres.erreurs.forEach(function (erreur) {
    erreursBloquantes.push({
      code: erreur.type,
      feuille: erreur.feuille || '',
      message: erreur.message
    });
  });

  if (
    sauvegarde.metadata.integrityStatus ===
      'AVEC_ANOMALIES' &&
    !diagnosticApres.erreurs.length
  ) {
    avertissements.push({
      code: 'ANOMALIES_ORIGINE_RESOLUES',
      message: 'La sauvegarde contenait des anomalies, mais la simulation et les migrations les ont résolues.'
    });
  }

  if (
    String(sauvegarde.metadata.applicationVersion) !==
      obtenirVersionApplication_()
  ) {
    avertissements.push({
      code: 'VERSION_APPLICATION_DIFFERENTE',
      message: 'La sauvegarde a été créée avec l’application ' +
        sauvegarde.metadata.applicationVersion + '.'
    });
  }

  if (estimation.avertissement) {
    avertissements.push({
      code: 'VOLUME_ELEVE',
      message: estimation.avertissement
    });
  }

  const migrationsNecessaires = simulation.migrations.map(
    function (migration) {
      return {
        versionSource: migration.versionSource,
        versionCible: migration.versionCible,
        nom: migration.nom,
        simulable: migration.simulable
      };
    }
  );
  const differences = simulation.reussie
    ? comparerModelesRestaurabilite_(
      simulation.modele,
      etatActuel.modele,
      etatActuel.feuillesSupplementaires
    )
    : construireComparaisonVideRestaurabilite_();
  const statutSousJacent = migrationsNecessaires.length
    ? 'RESTAURABLE_AVEC_MIGRATIONS'
    : 'RESTAURABLE';
  const statut = erreursBloquantes.length
    ? 'NON_RESTAURABLE'
    : (avertissements.length
      ? 'AVEC_AVERTISSEMENTS'
      : statutSousJacent);

  return {
    format: FORMAT_RAPPORT_RESTAURABILITE_,
    formatVersion: VERSION_FORMAT_RAPPORT_RESTAURABILITE_,
    backupId: backupId,
    empreinteFichier: empreinteFichier,
    testedAt: new Date().toISOString(),
    applicationVersionTest: obtenirVersionApplication_(),
    schemaVersionSauvegarde: versionSauvegarde,
    schemaVersionCourante: etatActuel.versionSchema,
    schemaVersionCible: versionCible,
    statut: statut,
    statutSousJacent: statutSousJacent,
    migrationsNecessaires: migrationsNecessaires,
    erreursBloquantes: limiterRapportRestaurabilite_(
      erreursBloquantes
    ),
    avertissements: limiterRapportRestaurabilite_(
      avertissements
    ),
    validation: {
      jsonValide: true,
      formatValide: true,
      versionFormatValide: true,
      installationValide: true,
      canonicalisationValide: true,
      empreintesFeuillesValides: true,
      empreinteGlobaleValide: true,
      signatureHmacValide: true,
      compteursValides: true,
      dimensionsValides: true,
      typesValides: true
    },
    diagnosticAvantMigration: diagnosticAvant,
    diagnosticApresMigration: diagnosticApres,
    differencesBaseActuelle: differences,
    estimation: estimation,
    elementsParFeuille: sauvegarde.manifest.map(function (entree) {
      return {
        feuille: entree.name,
        lignes: entree.rowCount,
        colonnes: entree.columnCount,
        cellules: entree.cellCount,
        lignesIdentifiees: entree.identifiedRowCount
      };
    }),
    anomaliesSauvegarde: sauvegarde.anomalies.map(
      serialiserAnomalieSauvegarde_
    ),
    lectureSeule: true,
    originalJsonModifie: false,
    rapportSecondaireEnregistre: false,
    dureeReelleMs: Date.now() - debut
  };
}


function construireRapportEchecRestaurabilite_(
  backupId,
  empreinteFichier,
  etatActuel,
  erreur,
  debut
) {
  const erreurNormalisee = normaliserErreurRestaurabilite_(erreur);

  return {
    format: FORMAT_RAPPORT_RESTAURABILITE_,
    formatVersion: VERSION_FORMAT_RAPPORT_RESTAURABILITE_,
    backupId: backupId,
    empreinteFichier: empreinteFichier || '',
    testedAt: new Date().toISOString(),
    applicationVersionTest: obtenirVersionApplication_(),
    schemaVersionSauvegarde: null,
    schemaVersionCourante: etatActuel
      ? etatActuel.versionSchema
      : null,
    schemaVersionCible: obtenirVersionSchemaCible_(),
    statut: 'NON_RESTAURABLE',
    statutSousJacent: 'NON_RESTAURABLE',
    migrationsNecessaires: [],
    erreursBloquantes: [erreurNormalisee],
    avertissements: [],
    validation: {
      jsonValide: erreurNormalisee.code !== 'JSON_INVALIDE',
      formatValide: false,
      versionFormatValide: false,
      installationValide: false,
      canonicalisationValide: false,
      empreintesFeuillesValides: false,
      empreinteGlobaleValide: false,
      signatureHmacValide: false,
      compteursValides: false,
      dimensionsValides: false,
      typesValides: false
    },
    diagnosticAvantMigration: null,
    diagnosticApresMigration: null,
    differencesBaseActuelle:
      construireComparaisonVideRestaurabilite_(),
    estimation: null,
    elementsParFeuille: [],
    anomaliesSauvegarde: [],
    lectureSeule: true,
    originalJsonModifie: false,
    rapportSecondaireEnregistre: false,
    dureeReelleMs: Date.now() - debut
  };
}


function normaliserErreurRestaurabilite_(erreur) {
  const message = String(erreur.message || erreur).slice(0, 1000);
  let code = 'VALIDATION_ECHEC';

  if (/JSON invalide/i.test(message)) {
    code = 'JSON_INVALIDE';
  } else if (/autre installation/i.test(message)) {
    code = 'AUTRE_INSTALLATION';
  } else if (/version du format/i.test(message)) {
    code = 'VERSION_FORMAT_NON_PRISE_EN_CHARGE';
  } else if (/format de sauvegarde est inconnu/i.test(message)) {
    code = 'FORMAT_NON_PRIS_EN_CHARGE';
  } else if (/canonicalisation|signée par cette installation/i.test(message)) {
    code = 'SIGNATURE_INSTALLATION_INVALIDE';
  } else if (/signature HMAC/i.test(message)) {
    code = 'SIGNATURE_HMAC_INVALIDE';
  } else if (/empreinte/i.test(message)) {
    code = 'EMPREINTE_INVALIDE';
  } else if (/type de donnée/i.test(message)) {
    code = 'TYPE_DONNEE_INVALIDE';
  } else if (/manifeste|dimensions|compteurs|incomplètes/i.test(message)) {
    code = 'SAUVEGARDE_INCOMPLETE';
  } else if (/capacit/i.test(message)) {
    code = 'CAPACITE_SIMULATION_DEPASSEE';
  }

  return {
    code: code,
    message: message
  };
}


function estimerSimulationRestaurabilite_(sauvegarde, tailleOctets) {
  const counts = sauvegarde.metadata.counts || {};
  const cellules = Number(counts.totalCells || 0);
  const lignes = Number(counts.totalRows || 0);
  const memoireEstimee = Math.ceil(
    tailleOctets * 6 + cellules * 24
  );
  const dureeSecondes = Math.max(
    1,
    Math.ceil(
      tailleOctets / (1024 * 1024) * 1.5 +
      cellules / 100000 * 0.8 +
      lignes / 10000 * 0.5
    )
  );
  let raison = '';

  if (tailleOctets > OCTETS_MAX_SIMULATION_RESTAURABILITE_) {
    raison = 'Le JSON dépasse la limite opérationnelle de 35 Mo de la simulation en mémoire.';
  } else if (cellules > CELLULES_MAX_SIMULATION_RESTAURABILITE_) {
    raison = 'Le modèle dépasse 1 500 000 cellules.';
  } else if (lignes > LIGNES_MAX_SIMULATION_RESTAURABILITE_) {
    raison = 'Le modèle dépasse 250 000 lignes.';
  }

  return {
    faisable: !raison,
    raison: raison,
    tailleJsonOctets: tailleOctets,
    cellules: cellules,
    lignes: lignes,
    memoireEstimeeOctets: memoireEstimee,
    dureeEstimeeSecondes: dureeSecondes,
    avertissement: tailleOctets >= 5 * 1024 * 1024
      ? 'Le volume dépasse 5 Mo ; le test peut durer plusieurs minutes.'
      : ''
  };
}


function capturerEtatActuelRestaurabilite_(classeur) {
  const modele = { sheets: {} };

  SCHEMA_BASE_.forEach(function (configuration) {
    modele.sheets[configuration.feuille] =
      lireFeuillePourSauvegarde_(classeur, configuration);
  });

  const attendues = new Set(SCHEMA_BASE_.map(function (configuration) {
    return configuration.feuille;
  }));
  const supplementaires = classeur.getSheets
    ? classeur.getSheets().map(function (feuille) {
      return feuille.getName();
    }).filter(function (nom) {
      return !attendues.has(nom);
    })
    : [];

  return {
    capturedAt: new Date().toISOString(),
    versionSchema: lireVersionSchemaSansCreation_(classeur),
    modele: modele,
    feuillesSupplementaires: supplementaires
  };
}


function construireDiagnosticModeleRestaurabilite_(modele) {
  const erreurs = [];
  const tables = {};
  const feuilles = [];

  SCHEMA_BASE_.forEach(function (configuration) {
    const feuille = modele.sheets &&
      modele.sheets[configuration.feuille];
    const colonnesAttendues = configuration.colonnes.map(
      obtenirNomColonneMigration_
    );

    if (!feuille || !feuille.exists) {
      feuilles.push({
        nom: configuration.feuille,
        existe: false,
        conforme: false,
        colonnesManquantes: colonnesAttendues,
        nombreLignes: 0
      });
      ajouterErreurModeleRestaurabilite_(erreurs, {
        type: 'FEUILLE_MANQUANTE',
        feuille: configuration.feuille,
        message: 'La feuille ' + configuration.feuille +
          ' est absente du modèle.'
      });
      return;
    }

    const index = creerIndexMigration_(feuille.headers || []);
    const manquantes = colonnesAttendues.filter(function (colonne) {
      return !Number.isInteger(
        index[normaliserMigration_(colonne)]
      );
    });

    feuilles.push({
      nom: configuration.feuille,
      existe: true,
      conforme: !manquantes.length,
      colonnesManquantes: manquantes,
      nombreLignes: (feuille.rows || []).length
    });

    manquantes.forEach(function (colonne) {
      ajouterErreurModeleRestaurabilite_(erreurs, {
        type: 'COLONNE_MANQUANTE',
        feuille: configuration.feuille,
        colonne: colonne,
        message: 'La colonne ' + colonne + ' est absente.'
      });
    });

    tables[configuration.feuille] = {
      rows: feuille.rows || [],
      index: index
    };

    if (configuration.identifiant) {
      verifierIdentifiantsModeleRestaurabilite_(
        configuration,
        feuille.rows || [],
        index,
        erreurs
      );
    }
  });

  obtenirReglesReferencesMigration_().forEach(function (regle) {
    verifierReferenceModeleRestaurabilite_(
      tables,
      regle,
      erreurs
    );
  });

  return {
    conforme: !erreurs.length,
    feuilles: feuilles,
    erreurs: erreurs,
    limiteErreursAtteinte:
      erreurs.length >= LIMITE_ERREURS_RAPPORT_RESTAURABILITE_,
    resume: {
      nombreFeuilles: feuilles.length,
      feuillesConformes: feuilles.filter(function (feuille) {
        return feuille.conforme;
      }).length,
      identifiantsManquants: erreurs.filter(function (erreur) {
        return erreur.type === 'IDENTIFIANT_MANQUANT';
      }).length,
      doublonsIdentifiants: erreurs.filter(function (erreur) {
        return erreur.type === 'IDENTIFIANT_DOUBLON';
      }).length,
      referencesIncoherentes: erreurs.filter(function (erreur) {
        return erreur.type === 'REFERENCE_INCOHERENTE';
      }).length,
      totalErreurs: erreurs.length
    }
  };
}


function verifierIdentifiantsModeleRestaurabilite_(
  configuration,
  lignes,
  index,
  erreurs
) {
  const colonne = index[configuration.identifiant];

  if (!Number.isInteger(colonne)) {
    return;
  }

  const occurrences = {};

  lignes.forEach(function (ligne, position) {
    if (!ligneRenseigneeModeleMigration_(ligne)) {
      return;
    }

    const valeur = String(ligne[colonne] || '').trim();

    if (!valeur) {
      ajouterErreurModeleRestaurabilite_(erreurs, {
        type: 'IDENTIFIANT_MANQUANT',
        feuille: configuration.feuille,
        ligne: position + 2,
        message: 'Identifiant absent à la ligne ' +
          (position + 2) + '.'
      });
      return;
    }

    occurrences[valeur] = occurrences[valeur] || [];
    occurrences[valeur].push(position + 2);
  });

  Object.keys(occurrences).forEach(function (valeur) {
    if (occurrences[valeur].length < 2) {
      return;
    }

    ajouterErreurModeleRestaurabilite_(erreurs, {
      type: 'IDENTIFIANT_DOUBLON',
      feuille: configuration.feuille,
      valeur: valeur,
      lignes: occurrences[valeur].slice(),
      message: 'Identifiant dupliqué : ' + valeur + '.'
    });
  });
}


function verifierReferenceModeleRestaurabilite_(
  tables,
  regle,
  erreurs
) {
  const source = tables[regle.feuilleSource];
  const cible = tables[regle.feuilleCible];

  if (!source || !cible) {
    return;
  }

  const colonneSource = source.index[regle.colonneSource];
  const colonneCible = cible.index[regle.colonneCible];

  if (
    !Number.isInteger(colonneSource) ||
    !Number.isInteger(colonneCible)
  ) {
    return;
  }

  const valeurs = new Set(cible.rows.map(function (ligne) {
    return String(ligne[colonneCible] || '').trim();
  }).filter(Boolean));

  source.rows.forEach(function (ligne, position) {
    const valeur = String(ligne[colonneSource] || '').trim();

    if (!valeur || valeurs.has(valeur)) {
      return;
    }

    ajouterErreurModeleRestaurabilite_(erreurs, {
      type: 'REFERENCE_INCOHERENTE',
      feuille: regle.feuilleSource,
      ligne: position + 2,
      valeur: valeur,
      cible: regle.feuilleCible + '.' + regle.colonneCible,
      message: 'Référence ' + valeur + ' absente de ' +
        regle.feuilleCible + '.' + regle.colonneCible + '.'
    });
  });
}


function ajouterErreurModeleRestaurabilite_(erreurs, erreur) {
  if (erreurs.length < LIMITE_ERREURS_RAPPORT_RESTAURABILITE_) {
    erreurs.push(erreur);
  }
}


function comparerModelesRestaurabilite_(
  modeleSauvegarde,
  modeleActuel,
  feuillesSupplementairesActuelles
) {
  const feuilles = SCHEMA_BASE_.map(function (configuration) {
    return comparerFeuilleRestaurabilite_(
      configuration,
      modeleSauvegarde.sheets[configuration.feuille],
      modeleActuel.sheets[configuration.feuille]
    );
  });
  const obtenirDelta = function (nomFeuille) {
    const feuille = feuilles.find(function (element) {
      return element.feuille === nomFeuille;
    });

    return feuille
      ? feuille.lignesSauvegarde - feuille.lignesActuelles
      : 0;
  };

  return {
    feuilles: feuilles,
    feuillesSupplementairesBaseActuelle:
      (feuillesSupplementairesActuelles || []).slice(),
    feuillesSupplementairesSauvegarde: [],
    resume: {
      differenceStagiaires: obtenirDelta('STAGIAIRES'),
      differenceFormateurs: obtenirDelta('FORMATEURS'),
      differenceSessions: obtenirDelta('SESSIONS'),
      differenceEvaluations: obtenirDelta('EVALUATIONS'),
      feuillesAbsentesSauvegarde: feuilles.filter(function (feuille) {
        return !feuille.presenteSauvegarde;
      }).map(function (feuille) {
        return feuille.feuille;
      }),
      feuillesAbsentesActuelles: feuilles.filter(function (feuille) {
        return !feuille.presenteActuelle;
      }).map(function (feuille) {
        return feuille.feuille;
      })
    },
    limiteIdentifiantsAffiches:
      LIMITE_IDENTIFIANTS_RAPPORT_RESTAURABILITE_
  };
}


function comparerFeuilleRestaurabilite_(
  configuration,
  sauvegarde,
  actuelle
) {
  sauvegarde = sauvegarde || {
    exists: false,
    headers: [],
    rows: []
  };
  actuelle = actuelle || {
    exists: false,
    headers: [],
    rows: []
  };
  const entetesSauvegarde = sauvegarde.headers || [];
  const entetesActuelles = actuelle.headers || [];
  const normaliseesSauvegarde = entetesSauvegarde.map(
    normaliserMigration_
  );
  const normaliseesActuelles = entetesActuelles.map(
    normaliserMigration_
  );
  const colonnesAbsentesActuelles = entetesSauvegarde.filter(
    function (entete, position) {
      return !normaliseesActuelles.includes(
        normaliseesSauvegarde[position]
      );
    }
  );
  const colonnesSupplementairesActuelles = entetesActuelles.filter(
    function (entete, position) {
      return !normaliseesSauvegarde.includes(
        normaliseesActuelles[position]
      );
    }
  );
  const resultat = {
    feuille: configuration.feuille,
    presenteSauvegarde: Boolean(sauvegarde.exists),
    presenteActuelle: Boolean(actuelle.exists),
    lignesSauvegarde: (sauvegarde.rows || []).length,
    lignesActuelles: (actuelle.rows || []).length,
    colonnesSauvegarde: entetesSauvegarde.length,
    colonnesActuelles: entetesActuelles.length,
    entetesIdentiques:
      JSON.stringify(normaliseesSauvegarde) ===
      JSON.stringify(normaliseesActuelles),
    colonnesAbsentesActuelles: colonnesAbsentesActuelles,
    colonnesSupplementairesActuelles:
      colonnesSupplementairesActuelles,
    identifiantMetier: String(configuration.identifiant || ''),
    seulementSauvegarde: { total: 0, exemples: [] },
    seulementActuelle: { total: 0, exemples: [] },
    identifiantsCommuns: 0,
    lignesNonIdentifiablesSauvegarde: 0,
    lignesNonIdentifiablesActuelles: 0
  };

  if (!configuration.identifiant) {
    resultat.lignesNonIdentifiablesSauvegarde =
      compterLignesRenseigneesRestaurabilite_(sauvegarde.rows || []);
    resultat.lignesNonIdentifiablesActuelles =
      compterLignesRenseigneesRestaurabilite_(actuelle.rows || []);
    return resultat;
  }

  const indexSauvegarde = creerIndexMigration_(entetesSauvegarde);
  const indexActuel = creerIndexMigration_(entetesActuelles);
  const positionSauvegarde =
    indexSauvegarde[configuration.identifiant];
  const positionActuelle = indexActuel[configuration.identifiant];

  if (
    !Number.isInteger(positionSauvegarde) ||
    !Number.isInteger(positionActuelle)
  ) {
    resultat.lignesNonIdentifiablesSauvegarde =
      compterLignesRenseigneesRestaurabilite_(sauvegarde.rows || []);
    resultat.lignesNonIdentifiablesActuelles =
      compterLignesRenseigneesRestaurabilite_(actuelle.rows || []);
    return resultat;
  }

  const idsSauvegarde = extraireIdentifiantsRestaurabilite_(
    sauvegarde.rows || [],
    positionSauvegarde
  );
  const idsActuels = extraireIdentifiantsRestaurabilite_(
    actuelle.rows || [],
    positionActuelle
  );
  const seulementSauvegarde = Array.from(idsSauvegarde.ids).filter(
    function (id) {
      return !idsActuels.ids.has(id);
    }
  );
  const seulementActuelle = Array.from(idsActuels.ids).filter(
    function (id) {
      return !idsSauvegarde.ids.has(id);
    }
  );

  resultat.seulementSauvegarde = {
    total: seulementSauvegarde.length,
    exemples: seulementSauvegarde.slice(
      0,
      LIMITE_IDENTIFIANTS_RAPPORT_RESTAURABILITE_
    )
  };
  resultat.seulementActuelle = {
    total: seulementActuelle.length,
    exemples: seulementActuelle.slice(
      0,
      LIMITE_IDENTIFIANTS_RAPPORT_RESTAURABILITE_
    )
  };
  resultat.identifiantsCommuns = Array.from(
    idsSauvegarde.ids
  ).filter(function (id) {
    return idsActuels.ids.has(id);
  }).length;
  resultat.lignesNonIdentifiablesSauvegarde =
    idsSauvegarde.nonIdentifiables;
  resultat.lignesNonIdentifiablesActuelles =
    idsActuels.nonIdentifiables;

  return resultat;
}


function extraireIdentifiantsRestaurabilite_(lignes, position) {
  const ids = new Set();
  let nonIdentifiables = 0;

  lignes.forEach(function (ligne) {
    if (!ligneRenseigneeModeleMigration_(ligne)) {
      return;
    }

    const id = String(ligne[position] || '').trim();

    if (id) {
      ids.add(id);
    } else {
      nonIdentifiables++;
    }
  });

  return {
    ids: ids,
    nonIdentifiables: nonIdentifiables
  };
}


function compterLignesRenseigneesRestaurabilite_(lignes) {
  return lignes.filter(ligneRenseigneeModeleMigration_).length;
}


function construireComparaisonVideRestaurabilite_() {
  return {
    feuilles: [],
    feuillesSupplementairesBaseActuelle: [],
    feuillesSupplementairesSauvegarde: [],
    resume: {
      differenceStagiaires: 0,
      differenceFormateurs: 0,
      differenceSessions: 0,
      differenceEvaluations: 0,
      feuillesAbsentesSauvegarde: [],
      feuillesAbsentesActuelles: []
    },
    limiteIdentifiantsAffiches:
      LIMITE_IDENTIFIANTS_RAPPORT_RESTAURABILITE_
  };
}


function construireResumeInventaireRestaurabilite_(resultat, rapport) {
  const sauvegarde = resultat.sauvegarde;
  const counts = sauvegarde.metadata.counts || {};

  return {
    format: sauvegarde.format,
    formatVersion: sauvegarde.formatVersion,
    backupId: sauvegarde.backupId,
    createdAt: sauvegarde.metadata.createdAt,
    type: sauvegarde.metadata.type,
    comment: String(sauvegarde.metadata.comment || ''),
    applicationVersion: sauvegarde.metadata.applicationVersion,
    schemaVersion: sauvegarde.metadata.schemaVersion,
    fileSizeBytes: resultat.tailleOctets,
    integrityStatus: sauvegarde.metadata.integrityStatus,
    counts: {
      stagiaires: Number(counts.stagiaires || 0),
      formateurs: Number(counts.formateurs || 0),
      sessions: Number(counts.sessions || 0),
      evaluations: Number(counts.evaluations || 0),
      totalRows: Number(counts.totalRows || 0),
      totalCells: Number(counts.totalCells || 0)
    },
    nombreFeuilles: sauvegarde.manifest.length,
    derniereDateTest: rapport ? rapport.testedAt : '',
    statutRestaurabilite: rapport
      ? rapport.statut
      : 'NON_TESTEE',
    rapportObsolete: rapport ? rapport.obsolete === true : false,
    restaurationAutorisee: Boolean(
      rapport &&
      rapport.obsolete !== true &&
      [
        'RESTAURABLE',
        'RESTAURABLE_AVEC_MIGRATIONS'
      ].includes(rapport.statut)
    )
  };
}


function construireConsultationPubliqueRestaurabilite_(
  resultat,
  dernierRapport
) {
  const sauvegarde = resultat.sauvegarde;

  return {
    format: sauvegarde.format,
    formatVersion: sauvegarde.formatVersion,
    backupId: sauvegarde.backupId,
    metadata: {
      createdAt: sauvegarde.metadata.createdAt,
      type: sauvegarde.metadata.type,
      comment: sauvegarde.metadata.comment,
      schemaVersion: sauvegarde.metadata.schemaVersion,
      applicationVersion: sauvegarde.metadata.applicationVersion,
      installationCorrespondante: true,
      adminSessionAuditId:
        sauvegarde.metadata.adminSessionAuditId || '',
      integrityStatus: sauvegarde.metadata.integrityStatus,
      counts: sauvegarde.metadata.counts,
      timezone: sauvegarde.metadata.timezone,
      fileSizeBytes: sauvegarde.metadata.fileSizeBytes
    },
    manifest: sauvegarde.manifest.map(function (entree) {
      return {
        name: entree.name,
        exists: entree.exists,
        headers: entree.headers,
        rowCount: entree.rowCount,
        columnCount: entree.columnCount,
        cellCount: entree.cellCount,
        idColumn: entree.idColumn,
        identifiedRowCount: entree.identifiedRowCount,
        hash: entree.hash
      };
    }),
    anomalies: sauvegarde.anomalies.map(
      serialiserAnomalieSauvegarde_
    ),
    integrity: {
      hashAlgorithm: sauvegarde.integrity.hashAlgorithm,
      sheetHashes: sauvegarde.integrity.sheetHashes,
      globalHash: sauvegarde.integrity.globalHash,
      signatureAlgorithm:
        sauvegarde.integrity.signatureAlgorithm,
      keyId: sauvegarde.integrity.keyId,
      canonicalizationVersion:
        sauvegarde.integrity.canonicalizationVersion,
      signatureValide: true
    },
    empreinteFichier: resultat.empreinteFichier,
    dernierRapport: dernierRapport,
    identifiantDriveExpose: false
  };
}


function enregistrerRapportRestaurabilite_(dossier, rapport) {
  const copie = JSON.parse(JSON.stringify(rapport));

  delete copie.rapportSecondaireEnregistre;
  copie.integrity = {
    hashAlgorithm: 'SHA-256',
    contentHash: hacherTexteSauvegarde_(
      canonicaliserSauvegarde_(copie)
    )
  };

  const contenu = JSON.stringify(copie);
  const date = String(copie.testedAt || '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  const nom = [
    'PrepFormation',
    'RAPPORT_RESTAURABILITE',
    date,
    copie.backupId
  ].join('__') + SUFFIXE_RAPPORT_RESTAURABILITE_;
  const fichier = dossier.createFile(
    Utilities.newBlob(contenu, 'application/json', nom)
  );
  const contenuRelu = fichier.getBlob().getDataAsString('UTF-8');

  if (contenuRelu !== contenu) {
    throw new Error(
      'Le rapport secondaire relu depuis Drive diffère du rapport créé.'
    );
  }

  fichier.setDescription(
    PREFIXE_DESCRIPTION_RAPPORT_RESTAURABILITE_ +
    JSON.stringify({
      backupId: copie.backupId,
      empreinteFichier: copie.empreinteFichier,
      testedAt: copie.testedAt,
      applicationVersionTest: copie.applicationVersionTest,
      schemaVersionCourante: copie.schemaVersionCourante,
      statut: copie.statut
    })
  );
}


function indexerRapportsRestaurabilite_(dossier) {
  const fichiers = dossier.getFiles();
  const index = {};

  while (fichiers.hasNext()) {
    const fichier = fichiers.next();

    if (
      fichier.isTrashed() ||
      !String(fichier.getName() || '')
        .endsWith(SUFFIXE_RAPPORT_RESTAURABILITE_)
    ) {
      continue;
    }

    const description = lireDescriptionRapportRestaurabilite_(
      fichier
    );

    if (!description) {
      continue;
    }

    index[description.backupId] =
      index[description.backupId] || [];
    index[description.backupId].push({
      fichier: fichier,
      description: description
    });
  }

  Object.keys(index).forEach(function (backupId) {
    index[backupId].sort(function (a, b) {
      return String(b.description.testedAt || '').localeCompare(
        String(a.description.testedAt || '')
      );
    });
  });

  return index;
}


function lireDescriptionRapportRestaurabilite_(fichier) {
  const texte = String(fichier.getDescription() || '');

  if (!texte.startsWith(
    PREFIXE_DESCRIPTION_RAPPORT_RESTAURABILITE_
  )) {
    return null;
  }

  try {
    const description = JSON.parse(texte.slice(
      PREFIXE_DESCRIPTION_RAPPORT_RESTAURABILITE_.length
    ));

    return description.backupId ? description : null;
  } catch (erreur) {
    return null;
  }
}


function selectionnerRapportCourantRestaurabilite_(
  rapports,
  empreinteFichier,
  versionSchemaCourante
) {
  if (!rapports.length) {
    return null;
  }

  const candidat = rapports[0].description;
  const obsolete = (
    candidat.empreinteFichier !== empreinteFichier ||
    candidat.applicationVersionTest !==
      obtenirVersionApplication_() ||
    Number(candidat.schemaVersionCourante) !==
      Number(versionSchemaCourante)
  );

  return {
    backupId: candidat.backupId,
    testedAt: candidat.testedAt,
    statut: obsolete ? 'OBSOLETE' : candidat.statut,
    obsolete: obsolete
  };
}


function lireDernierRapportRestaurabilite_(
  dossier,
  backupId,
  empreinteFichier,
  versionSchemaCourante
) {
  const index = indexerRapportsRestaurabilite_(dossier);
  const rapports = index[backupId] || [];

  if (!rapports.length) {
    return null;
  }

  const entree = rapports[0];
  let rapport;

  try {
    rapport = JSON.parse(
      entree.fichier.getBlob().getDataAsString('UTF-8')
    );
  } catch (erreur) {
    return {
      backupId: backupId,
      testedAt: entree.description.testedAt,
      statut: 'OBSOLETE',
      obsolete: true,
      erreur: 'Le rapport secondaire est illisible.'
    };
  }

  const integrite = rapport.integrity || {};
  const contenu = JSON.parse(JSON.stringify(rapport));

  delete contenu.integrity;

  if (
    integrite.hashAlgorithm !== 'SHA-256' ||
    !comparaisonConstanteSecurite_(
      hacherTexteSauvegarde_(
        canonicaliserSauvegarde_(contenu)
      ),
      integrite.contentHash
    )
  ) {
    return {
      backupId: backupId,
      testedAt: entree.description.testedAt,
      statut: 'OBSOLETE',
      obsolete: true,
      erreur: 'L’intégrité du rapport secondaire est invalide.'
    };
  }

  rapport.obsolete = (
    rapport.empreinteFichier !== empreinteFichier ||
    rapport.applicationVersionTest !==
      obtenirVersionApplication_() ||
    Number(rapport.schemaVersionCourante) !==
      Number(versionSchemaCourante)
  );

  if (rapport.obsolete) {
    rapport.statutOriginal = rapport.statut;
    rapport.statut = 'OBSOLETE';
  }

  return rapport;
}


function limiterRapportRestaurabilite_(elements) {
  return elements.slice(0, LIMITE_ERREURS_RAPPORT_RESTAURABILITE_);
}
