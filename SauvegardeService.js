'use strict';

const FORMAT_SAUVEGARDE_PREPFORMATION_ = 'PREPFORMATION_BACKUP';
const VERSION_FORMAT_SAUVEGARDE_ = 1;
const VERSION_CANONICALISATION_SAUVEGARDE_ = 1;
const TYPE_SAUVEGARDE_MANUELLE_ = 'MANUELLE';
const TYPE_SAUVEGARDE_SECURITE_RESTAURATION_ =
  'AUTO_AVANT_RESTAURATION';
const TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_ =
  'AUTO_PLANIFIEE';
const TYPE_SAUVEGARDE_AVANT_OPERATION_ADMIN_ =
  'AUTO_AVANT_OPERATION_ADMIN';
const OCTETS_AVERTISSEMENT_SAUVEGARDE_ = 5 * 1024 * 1024;
const OCTETS_MAX_PHASE_1_SAUVEGARDE_ = 45 * 1024 * 1024;
const DUREE_PRUDENTE_PHASE_1_MS_ = 4 * 60 * 1000;
const DUREE_JETON_TELECHARGEMENT_MS_ = 2 * 60 * 1000;

const PROPRIETE_INSTALLATION_SAUVEGARDE_ =
  'PREPFORMATION_BACKUP_INSTALLATION_ID';
const PROPRIETE_DOSSIER_RACINE_SAUVEGARDE_ =
  'PREPFORMATION_BACKUP_ROOT_FOLDER_ID';
const PROPRIETE_DOSSIER_SAUVEGARDE_ =
  'PREPFORMATION_BACKUP_FOLDER_ID';
const PROPRIETE_CLE_HMAC_SAUVEGARDE_ =
  'PREPFORMATION_BACKUP_HMAC_KEY';
const PROPRIETE_ID_CLE_HMAC_SAUVEGARDE_ =
  'PREPFORMATION_BACKUP_HMAC_KEY_ID';
const PROPRIETE_DERNIERE_SAUVEGARDE_ =
  'PREPFORMATION_BACKUP_LAST_ID';
const PREFIXE_JETON_TELECHARGEMENT_SAUVEGARDE_ =
  'PREPFORMATION_BACKUP_DOWNLOAD_';
const PREFIXE_DESCRIPTION_FICHIER_SAUVEGARDE_ =
  'PREPFORMATION_BACKUP_FILE:';


/**
 * Crée une sauvegarde manuelle complète, puis relit et vérifie
 * le fichier Drive avant de confirmer sa réussite.
 */
function creerSauvegardeManuelle(
  commentaire,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    return creerSauvegardeCompleteInterne_(
      nettoyerCommentaireSauvegarde_(commentaire),
      TYPE_SAUVEGARDE_MANUELLE_,
      session,
      jetonAdministrateur,
      true,
      {}
    );
  });
}


/**
 * Point privé partagé par la sauvegarde manuelle et la sauvegarde de
 * sécurité d'une restauration. Le contexte de restauration détient déjà
 * le verrou document et ne peut jamais provenir du navigateur.
 */
function creerSauvegardeCompleteInterne_(
  commentaire,
  typeSauvegarde,
  session,
  secretAExclure,
  verrouDejaDetenu,
  options
) {
  if (!verrouDejaDetenu) {
    return executerMutationMetier_(function () {
      return creerSauvegardeCompleteInterne_(
        commentaire,
        typeSauvegarde,
        session,
        secretAExclure,
        true,
        options
      );
    });
  }

  const commentaireNettoye = nettoyerCommentaireSauvegarde_(
    commentaire
  );
  const type = String(typeSauvegarde || '').trim();
  const parametres = options || {};

  if (![
    TYPE_SAUVEGARDE_MANUELLE_,
    TYPE_SAUVEGARDE_SECURITE_RESTAURATION_,
    TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_,
    TYPE_SAUVEGARDE_AVANT_OPERATION_ADMIN_
  ].includes(type)) {
    throw new Error('Type de sauvegarde interne invalide.');
  }

  const debut = Date.now();
  let fichierPartiel = null;

  try {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const estimation = estimerVolumeSauvegarde_(classeur);

    verifierCapacitePhase1Sauvegarde_(estimation, 0);

    const dossier = obtenirDossierSauvegardes_(true);
    const proprietes = PropertiesService.getScriptProperties();
    const installationId = obtenirInstallationSauvegarde_(
      proprietes
    );
    const cleHmac = obtenirCleHmacSauvegarde_(proprietes);
    const keyId = obtenirIdCleHmacSauvegarde_(
      proprietes,
      cleHmac
    );
    const diagnostic = construireRapportIntegrite_(classeur);
    const sauvegarde = construireSauvegardeComplete_(
      classeur,
      commentaireNettoye,
      type,
      session,
      installationId,
      diagnostic,
      keyId
    );
    const contenu = finaliserContenuSigneSauvegarde_(
      sauvegarde,
      cleHmac
    );
    const taille = tailleUtf8Sauvegarde_(contenu);

    verifierCapacitePhase1Sauvegarde_(
      {
        octetsEstimes: taille,
        cellules: estimation.cellules
      },
      Date.now() - debut
    );

    verifierAbsenceSecretsSauvegarde_(
      contenu,
      secretAExclure,
      cleHmac,
      proprietes
    );

    const noms = construireNomsFichierSauvegarde_(sauvegarde);
    const blob = Utilities.newBlob(
      contenu,
      'application/json',
      noms.partiel
    );

    fichierPartiel = dossier.createFile(blob);

    const contenuRelu = fichierPartiel
      .getBlob()
      .getDataAsString('UTF-8');
    const verification = verifierContenuSauvegarde_(
      contenuRelu,
      cleHmac,
      keyId,
      installationId
    );

    if (contenuRelu !== contenu) {
      throw new Error(
        'Le fichier relu depuis Drive diffère du JSON créé.'
      );
    }

    if (Number(fichierPartiel.getSize()) !== taille) {
      throw new Error(
        'La taille du fichier Drive ne correspond pas à la taille déclarée.'
      );
    }

    fichierPartiel.setName(noms.final);
    fichierPartiel.setDescription(
      construireDescriptionFichierSauvegarde_(
        sauvegarde,
        noms.final,
        verification
      )
    );

    proprietes.setProperty(
      PROPRIETE_DERNIERE_SAUVEGARDE_,
      sauvegarde.backupId
    );

    if (!parametres.differerJournalisation) {
      journaliserActionSensible_(
        type === TYPE_SAUVEGARDE_MANUELLE_
          ? 'SAUVEGARDE_MANUELLE_CREATION'
          : (
            type === TYPE_SAUVEGARDE_AUTOMATIQUE_PLANIFIEE_
              ? 'SAUVEGARDE_AUTOMATIQUE_CREATION'
              : (
                type === TYPE_SAUVEGARDE_AVANT_OPERATION_ADMIN_
                  ? 'SAUVEGARDE_AVANT_OPERATION_ADMIN_CREATION'
                  : 'SAUVEGARDE_SECURITE_RESTAURATION_CREATION'
              )
          ),
        'SAUVEGARDE',
        sauvegarde.backupId,
        {
          nomFichier: noms.final,
          tailleOctets: taille,
          statutIntegrite:
            sauvegarde.metadata.integrityStatus,
          nombreAnomalies: sauvegarde.anomalies.length,
          verificationApresCreation: true
        },
        session.identifiantHistorique
      );
    }

    return construireResultatSauvegarde_(
      sauvegarde,
      noms.final,
      verification,
      taille
    );
  } catch (erreur) {
    if (fichierPartiel) {
      try {
        fichierPartiel.setDescription(
          'Sauvegarde partielle non validée : ' +
          String(erreur.message || erreur).slice(0, 1000)
        );
      } catch (erreurDescription) {
        console.error(erreurDescription);
      }
    }

    throw erreur;
  }
}


/**
 * Place une sauvegarde et ses rapports de restaurabilité dans la corbeille.
 * L'identité et l'intégrité du JSON sont vérifiées avant toute mutation
 * Drive. Aucune suppression définitive n'est utilisée.
 */
function supprimerSauvegardeAdministration(
  backupId,
  confirmation,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const identifiant = nettoyerBackupIdSauvegarde_(backupId);

  return executerMutationMetier_(function () {
    journaliserActionSensible_(
      'SAUVEGARDE_SUPPRESSION_DEMANDE',
      'SAUVEGARDE',
      identifiant,
      { confirmationRecue: Boolean(String(confirmation || '')) },
      session.identifiantHistorique
    );

    if (String(confirmation || '').trim() !== 'SUPPRIMER') {
      journaliserActionSensible_(
        'SAUVEGARDE_SUPPRESSION_ECHEC',
        'SAUVEGARDE',
        identifiant,
        { raison: 'CONFIRMATION_INCORRECTE' },
        session.identifiantHistorique
      );
      throw new Error('Saisis exactement le mot SUPPRIMER.');
    }

    journaliserActionSensible_(
      'SAUVEGARDE_SUPPRESSION_CONFIRMATION',
      'SAUVEGARDE',
      identifiant,
      { confirmationValide: true },
      session.identifiantHistorique
    );

    try {
      const resultat = placerSauvegardeCorbeilleInterne_(
        identifiant,
        { autoriserProtectionActive: false }
      );

      journaliserActionSensible_(
        'SAUVEGARDE_SUPPRESSION_SUCCES',
        'SAUVEGARDE',
        identifiant,
        {
          type: resultat.type,
          rapportsPlacesCorbeille:
            resultat.nombreRapportsCorbeille,
          suppressionDefinitive: false
        },
        session.identifiantHistorique
      );

      return {
        succes: true,
        message: 'La sauvegarde a été placée dans la corbeille Drive.',
        backupId: identifiant,
        type: resultat.type,
        nombreRapportsCorbeille:
          resultat.nombreRapportsCorbeille,
        suppressionDefinitive: false
      };
    } catch (erreur) {
      journaliserActionSensible_(
        'SAUVEGARDE_SUPPRESSION_ECHEC',
        'SAUVEGARDE',
        identifiant,
        {
          raison: String(erreur.message || erreur).slice(0, 500)
        },
        session.identifiantHistorique
      );
      throw erreur;
    }
  });
}


/**
 * Retourne uniquement le résultat de la dernière sauvegarde.
 */
function getEtatSauvegardesAdministration(jetonAdministrateur) {
  exigerAdministrateur_(jetonAdministrateur);
  return obtenirEtatSauvegardesAdministration_();
}


/**
 * Vérifie la sauvegarde puis émet un jeton opaque de deux minutes.
 */
function preparerTelechargementSauvegarde(
  backupId,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const identifiant = nettoyerBackupIdSauvegarde_(backupId);
  const fichier = trouverFichierSauvegardeParId_(identifiant);

  if (!fichier) {
    throw new Error('Sauvegarde introuvable.');
  }

  const proprietes = PropertiesService.getScriptProperties();
  const cleHmac = obtenirCleHmacSauvegarde_(proprietes);
  const keyId = obtenirIdCleHmacSauvegarde_(
    proprietes,
    cleHmac
  );
  const contenu = fichier.getBlob().getDataAsString('UTF-8');
  const installationId = String(
    proprietes.getProperty(
      PROPRIETE_INSTALLATION_SAUVEGARDE_
    ) || ''
  );

  verifierContenuSauvegarde_(
    contenu,
    cleHmac,
    keyId,
    installationId
  );

  const jetonTelechargement = creerSecretAleatoireSecurite_();
  const empreinte = hacherJetonTelechargementSauvegarde_(
    jetonTelechargement
  );
  const expireA = Date.now() + DUREE_JETON_TELECHARGEMENT_MS_;
  const verrou = LockService.getScriptLock();

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le service de téléchargement est momentanément occupé.'
    );
  }

  try {
    nettoyerJetonsTelechargementSauvegarde_(proprietes);
    proprietes.setProperty(
      PREFIXE_JETON_TELECHARGEMENT_SAUVEGARDE_ + empreinte,
      JSON.stringify({
        backupId: identifiant,
        expireA: expireA,
        adminSessionAuditId: session.identifiantHistorique
      })
    );
  } finally {
    verrou.releaseLock();
  }

  return {
    token: jetonTelechargement,
    backupId: identifiant,
    fileName: fichier.getName(),
    expiresAt: new Date(expireA).toISOString()
  };
}


/**
 * Consomme une seule fois le jeton opaque et retourne les octets
 * JSON originaux sous forme base64 pour le téléchargement client.
 */
function telechargerSauvegarde(
  jetonTelechargement,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const jeton = String(jetonTelechargement || '').trim();

  if (!/^[A-Za-z0-9_-]{40,200}$/.test(jeton)) {
    throw new Error('Jeton de téléchargement invalide ou expiré.');
  }

  const proprietes = PropertiesService.getScriptProperties();
  const empreinte = hacherJetonTelechargementSauvegarde_(jeton);
  const clePropriete =
    PREFIXE_JETON_TELECHARGEMENT_SAUVEGARDE_ + empreinte;
  const verrou = LockService.getScriptLock();
  let autorisation;

  if (!verrou.tryLock(10000)) {
    throw new Error(
      'Le service de téléchargement est momentanément occupé.'
    );
  }

  try {
    nettoyerJetonsTelechargementSauvegarde_(proprietes);
    const valeur = proprietes.getProperty(clePropriete);

    proprietes.deleteProperty(clePropriete);

    if (!valeur) {
      throw new Error('Jeton de téléchargement invalide ou expiré.');
    }

    try {
      autorisation = JSON.parse(valeur);
    } catch (erreur) {
      throw new Error('Jeton de téléchargement invalide ou expiré.');
    }

    if (
      Number(autorisation.expireA || 0) <= Date.now() ||
      autorisation.adminSessionAuditId !==
        session.identifiantHistorique
    ) {
      throw new Error('Jeton de téléchargement invalide ou expiré.');
    }
  } finally {
    verrou.releaseLock();
  }

  const fichier = trouverFichierSauvegardeParId_(
    autorisation.backupId
  );

  if (!fichier) {
    throw new Error('Sauvegarde introuvable.');
  }

  const cleHmac = obtenirCleHmacSauvegarde_(proprietes);
  const keyId = obtenirIdCleHmacSauvegarde_(
    proprietes,
    cleHmac
  );
  const blob = fichier.getBlob();
  const contenu = blob.getDataAsString('UTF-8');
  const installationId = String(
    proprietes.getProperty(
      PROPRIETE_INSTALLATION_SAUVEGARDE_
    ) || ''
  );

  verifierContenuSauvegarde_(
    contenu,
    cleHmac,
    keyId,
    installationId
  );

  return {
    fileName: fichier.getName(),
    mimeType: 'application/json',
    sizeBytes: Number(fichier.getSize()) ||
      tailleUtf8Sauvegarde_(contenu),
    contentBase64: Utilities.base64Encode(blob.getBytes())
  };
}


function obtenirEtatSauvegardesAdministrationSansErreur_() {
  try {
    return obtenirEtatSauvegardesAdministration_();
  } catch (erreur) {
    return {
      disponible: false,
      derniereSauvegarde: null,
      erreur: String(erreur.message || erreur)
    };
  }
}


function obtenirEtatSauvegardesAdministration_() {
  return executerMutationMetier_(function () {
    return obtenirEtatSauvegardesAdministrationSansVerrou_();
  });
}


function obtenirEtatSauvegardesAdministrationSansVerrou_() {
  const dossier = obtenirDossierSauvegardes_(true);
  const proprietes = PropertiesService.getScriptProperties();
  const idMemorise = String(
    proprietes.getProperty(PROPRIETE_DERNIERE_SAUVEGARDE_) || ''
  ).trim();
  let fichier = idMemorise
    ? trouverFichierSauvegardeDansDossier_(dossier, idMemorise)
    : null;

  if (!fichier) {
    fichier = trouverDernierFichierSauvegarde_(dossier);
  }

  if (!fichier) {
    return {
      disponible: true,
      derniereSauvegarde: null,
      erreur: ''
    };
  }

  const description = lireDescriptionFichierSauvegarde_(fichier);

  if (!description) {
    return {
      disponible: true,
      derniereSauvegarde: null,
      erreur: ''
    };
  }

  proprietes.setProperty(
    PROPRIETE_DERNIERE_SAUVEGARDE_,
    description.backupId
  );

  return {
    disponible: true,
    derniereSauvegarde:
      construireEtatDepuisDescriptionSauvegarde_(description),
    erreur: ''
  };
}


function construireSauvegardeComplete_(
  classeur,
  commentaire,
  typeSauvegarde,
  session,
  installationId,
  diagnostic,
  keyId
) {
  const feuilles = {};
  const manifest = [];

  SCHEMA_BASE_.forEach(function (configuration) {
    const donneeFeuille = lireFeuillePourSauvegarde_(
      classeur,
      configuration
    );

    feuilles[configuration.feuille] = donneeFeuille;
    manifest.push({
      name: configuration.feuille,
      exists: donneeFeuille.exists,
      headers: donneeFeuille.headers.slice(),
      rowCount: donneeFeuille.rowCount,
      columnCount: donneeFeuille.columnCount,
      cellCount: donneeFeuille.cellCount,
      idColumn: donneeFeuille.idColumn,
      identifiedRowCount: donneeFeuille.identifiedRowCount,
      hash: ''
    });
  });

  const counts = calculerCompteursSauvegarde_(feuilles);
  const anomalies = Array.isArray(diagnostic.erreurs)
    ? diagnostic.erreurs.map(serialiserAnomalieSauvegarde_)
    : [];

  return {
    format: FORMAT_SAUVEGARDE_PREPFORMATION_,
    formatVersion: VERSION_FORMAT_SAUVEGARDE_,
    backupId: Utilities.getUuid(),
    metadata: {
      createdAt: new Date().toISOString(),
      type: typeSauvegarde,
      comment: commentaire,
      schemaVersion: lireVersionSchemaSansCreation_(classeur),
      applicationVersion: obtenirVersionApplication_(),
      installationId: installationId,
      adminSessionAuditId: session.identifiantHistorique,
      integrityStatus: anomalies.length
        ? 'AVEC_ANOMALIES'
        : 'CONFORME',
      counts: counts,
      timezone: Session.getScriptTimeZone(),
      fileSizeBytes: 0
    },
    manifest: manifest,
    sheets: feuilles,
    anomalies: anomalies,
    integrity: {
      hashAlgorithm: 'SHA-256',
      sheetHashes: {},
      globalHash: '',
      signatureAlgorithm: 'HMAC-SHA-256',
      keyId: keyId,
      signature: '',
      canonicalizationVersion:
        VERSION_CANONICALISATION_SAUVEGARDE_
    }
  };
}


function lireFeuillePourSauvegarde_(classeur, configuration) {
  const feuille = classeur.getSheetByName(
    configuration.feuille
  );
  const idColumn = String(configuration.identifiant || '');

  if (
    !feuille ||
    feuille.getLastRow() < 1 ||
    feuille.getLastColumn() < 1
  ) {
    return {
      exists: Boolean(feuille),
      headers: [],
      rows: [],
      rowCount: 0,
      columnCount: 0,
      cellCount: 0,
      idColumn: idColumn,
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
  const index = creerIndexMigration_(headers);
  const positionIdentifiant = idColumn
    ? index[normaliserMigration_(idColumn)]
    : null;
  const identifiedRowCount = Number.isInteger(
    positionIdentifiant
  )
    ? rows.filter(function (ligne) {
      return String(ligne[positionIdentifiant] || '').trim() !== '';
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


function serialiserValeurSauvegarde_(valeur) {
  if (valeur instanceof Date) {
    return {
      type: 'DATE_ISO_UTC',
      value: valeur.toISOString()
    };
  }

  if (
    valeur === null ||
    typeof valeur === 'string' ||
    typeof valeur === 'boolean' ||
    typeof valeur === 'number'
  ) {
    return valeur;
  }

  return String(valeur === undefined ? '' : valeur);
}


function calculerCompteursSauvegarde_(feuilles) {
  const obtenirNombre = function (nomFeuille) {
    return feuilles[nomFeuille]
      ? Number(feuilles[nomFeuille].identifiedRowCount || 0)
      : 0;
  };
  let totalRows = 0;
  let totalCells = 0;

  Object.keys(feuilles).forEach(function (nomFeuille) {
    totalRows += Number(feuilles[nomFeuille].rowCount || 0);
    totalCells += Number(feuilles[nomFeuille].cellCount || 0);
  });

  return {
    stagiaires: obtenirNombre('STAGIAIRES'),
    formateurs: obtenirNombre('FORMATEURS'),
    sessions: obtenirNombre('SESSIONS'),
    presences: obtenirNombre('PRESENCES_STAGIAIRES'),
    prestations: obtenirNombre('PRESTATIONS_FORMATEURS'),
    items: obtenirNombre('REFERENTIEL'),
    evaluations: obtenirNombre('EVALUATIONS'),
    totalRows: totalRows,
    totalCells: totalCells
  };
}


function serialiserAnomalieSauvegarde_(anomalie) {
  const resultat = {};

  Object.keys(anomalie || {}).forEach(function (cle) {
    const valeur = anomalie[cle];

    if (
      valeur === null ||
      typeof valeur === 'string' ||
      typeof valeur === 'number' ||
      typeof valeur === 'boolean'
    ) {
      resultat[cle] = valeur;
    } else if (Array.isArray(valeur)) {
      resultat[cle] = valeur.slice();
    } else if (valeur !== undefined) {
      resultat[cle] = String(valeur);
    }
  });

  return resultat;
}


function finaliserContenuSigneSauvegarde_(sauvegarde, cleHmac) {
  for (let tentative = 0; tentative < 12; tentative++) {
    recalculerIntegriteSauvegarde_(sauvegarde, cleHmac);

    const contenu = JSON.stringify(sauvegarde);
    const taille = tailleUtf8Sauvegarde_(contenu);

    if (sauvegarde.metadata.fileSizeBytes === taille) {
      return contenu;
    }

    sauvegarde.metadata.fileSizeBytes = taille;
  }

  throw new Error(
    'Impossible de stabiliser la taille du fichier de sauvegarde.'
  );
}


function recalculerIntegriteSauvegarde_(sauvegarde, cleHmac) {
  const sheetHashes = {};

  sauvegarde.manifest.forEach(function (entree) {
    const contenuFeuille = sauvegarde.sheets[entree.name];
    const hash = hacherTexteSauvegarde_(
      canonicaliserSauvegarde_(contenuFeuille)
    );

    entree.hash = hash;
    sheetHashes[entree.name] = hash;
  });

  sauvegarde.integrity.sheetHashes = sheetHashes;

  const contenuGlobal = construireContenuGlobalSauvegarde_(
    sauvegarde
  );
  const globalHash = hacherTexteSauvegarde_(
    canonicaliserSauvegarde_(contenuGlobal)
  );

  sauvegarde.integrity.globalHash = globalHash;
  sauvegarde.integrity.signature = signerTexteSauvegarde_(
    canonicaliserSauvegarde_({
      content: contenuGlobal,
      globalHash: globalHash
    }),
    cleHmac
  );
}


function construireContenuGlobalSauvegarde_(sauvegarde) {
  return {
    format: sauvegarde.format,
    formatVersion: sauvegarde.formatVersion,
    backupId: sauvegarde.backupId,
    metadata: sauvegarde.metadata,
    manifest: sauvegarde.manifest,
    sheets: sauvegarde.sheets,
    anomalies: sauvegarde.anomalies,
    integrity: {
      hashAlgorithm: sauvegarde.integrity.hashAlgorithm,
      sheetHashes: sauvegarde.integrity.sheetHashes,
      signatureAlgorithm:
        sauvegarde.integrity.signatureAlgorithm,
      keyId: sauvegarde.integrity.keyId,
      canonicalizationVersion:
        sauvegarde.integrity.canonicalizationVersion
    }
  };
}


function verifierContenuSauvegarde_(
  contenu,
  cleHmac,
  keyIdAttendu,
  installationIdAttendu
) {
  let sauvegarde;

  try {
    sauvegarde = JSON.parse(contenu);
  } catch (erreur) {
    throw new Error('Le fichier de sauvegarde contient un JSON invalide.');
  }

  if (!sauvegarde || typeof sauvegarde !== 'object') {
    throw new Error('Le format de la sauvegarde est invalide.');
  }

  if (sauvegarde.format !== FORMAT_SAUVEGARDE_PREPFORMATION_) {
    throw new Error('Le format de sauvegarde est inconnu.');
  }

  if (
    Number(sauvegarde.formatVersion) !==
      VERSION_FORMAT_SAUVEGARDE_
  ) {
    throw new Error(
      'La version du format de sauvegarde n’est pas prise en charge.'
    );
  }

  if (
    !sauvegarde.metadata ||
    !sauvegarde.metadata.counts ||
    !Array.isArray(sauvegarde.manifest) ||
    !sauvegarde.sheets ||
    typeof sauvegarde.sheets !== 'object' ||
    !Array.isArray(sauvegarde.anomalies) ||
    !sauvegarde.integrity ||
    !sauvegarde.integrity.sheetHashes
  ) {
    throw new Error('Le format de la sauvegarde est invalide.');
  }

  if (
    !/^[A-Za-z0-9_-]{8,100}$/.test(
      String(sauvegarde.backupId || '')
    ) ||
    !String(sauvegarde.metadata.createdAt || '') ||
    !String(sauvegarde.metadata.installationId || '') ||
    !Number.isFinite(Number(sauvegarde.metadata.schemaVersion)) ||
    !String(sauvegarde.metadata.applicationVersion || '')
  ) {
    throw new Error(
      'Les métadonnées obligatoires de la sauvegarde sont incomplètes.'
    );
  }

  if (
    installationIdAttendu &&
    !comparaisonConstanteSecurite_(
      String(sauvegarde.metadata.installationId),
      String(installationIdAttendu)
    )
  ) {
    throw new Error(
      'La sauvegarde provient d’une autre installation.'
    );
  }

  if (
    sauvegarde.integrity.hashAlgorithm !== 'SHA-256' ||
    sauvegarde.integrity.signatureAlgorithm !==
      'HMAC-SHA-256' ||
    Number(sauvegarde.integrity.canonicalizationVersion) !==
      VERSION_CANONICALISATION_SAUVEGARDE_ ||
    sauvegarde.integrity.keyId !== keyIdAttendu
  ) {
    throw new Error(
      'La sauvegarde n’est pas signée par cette installation.'
    );
  }

  const nomsAttendus = SCHEMA_BASE_.map(function (configuration) {
    return configuration.feuille;
  });
  const nomsManifest = sauvegarde.manifest.map(function (entree) {
    return String(entree.name || '');
  });
  const nomsFeuilles = Object.keys(sauvegarde.sheets).sort();
  const nomsEmpreintes = Object.keys(
    sauvegarde.integrity.sheetHashes
  ).sort();
  const nomsTries = nomsAttendus.slice().sort();

  if (
    JSON.stringify(nomsManifest) !== JSON.stringify(nomsAttendus) ||
    JSON.stringify(nomsFeuilles) !== JSON.stringify(nomsTries) ||
    JSON.stringify(nomsEmpreintes) !== JSON.stringify(nomsTries)
  ) {
    throw new Error(
      'Le manifeste et le contenu des feuilles sont incohérents.'
    );
  }

  const sheetHashes = {};

  sauvegarde.manifest.forEach(function (entree) {
    const feuille = sauvegarde.sheets[entree.name];

    verifierDimensionsFeuilleSauvegarde_(entree, feuille);

    const hash = hacherTexteSauvegarde_(
      canonicaliserSauvegarde_(feuille)
    );

    if (
      !comparaisonConstanteSecurite_(hash, entree.hash) ||
      !comparaisonConstanteSecurite_(
        hash,
        sauvegarde.integrity.sheetHashes[entree.name]
      )
    ) {
      throw new Error(
        'L’empreinte de la feuille ' + entree.name +
        ' est invalide.'
      );
    }

    sheetHashes[entree.name] = hash;
  });

  sauvegarde.integrity.sheetHashes = sheetHashes;

  const compteurs = calculerCompteursSauvegarde_(
    sauvegarde.sheets
  );

  if (
    canonicaliserSauvegarde_(compteurs) !==
    canonicaliserSauvegarde_(sauvegarde.metadata.counts)
  ) {
    throw new Error(
      'Les compteurs de la sauvegarde sont incohérents.'
    );
  }

  const taille = tailleUtf8Sauvegarde_(contenu);

  if (Number(sauvegarde.metadata.fileSizeBytes) !== taille) {
    throw new Error(
      'La taille déclarée de la sauvegarde est incohérente.'
    );
  }

  const contenuGlobal = construireContenuGlobalSauvegarde_(
    sauvegarde
  );
  const globalHash = hacherTexteSauvegarde_(
    canonicaliserSauvegarde_(contenuGlobal)
  );

  if (!comparaisonConstanteSecurite_(
    globalHash,
    sauvegarde.integrity.globalHash
  )) {
    throw new Error('L’empreinte globale de la sauvegarde est invalide.');
  }

  const signature = signerTexteSauvegarde_(
    canonicaliserSauvegarde_({
      content: contenuGlobal,
      globalHash: globalHash
    }),
    cleHmac
  );

  if (!comparaisonConstanteSecurite_(
    signature,
    sauvegarde.integrity.signature
  )) {
    throw new Error('La signature HMAC de la sauvegarde est invalide.');
  }

  const statutAttendu = sauvegarde.anomalies.length
    ? 'AVEC_ANOMALIES'
    : 'CONFORME';

  if (sauvegarde.metadata.integrityStatus !== statutAttendu) {
    throw new Error(
      'Le statut d’intégrité de la sauvegarde est incohérent.'
    );
  }

  return {
    valide: true,
    verificationIntegrite: true,
    backupId: sauvegarde.backupId,
    metadata: sauvegarde.metadata,
    nombreFeuilles: sauvegarde.manifest.length,
    nombreAnomalies: sauvegarde.anomalies.length,
    sauvegarde: sauvegarde
  };
}


function verifierDimensionsFeuilleSauvegarde_(entree, feuille) {
  if (
    !feuille ||
    !Array.isArray(feuille.headers) ||
    !Array.isArray(feuille.rows)
  ) {
    throw new Error(
      'Les données de la feuille ' + entree.name + ' sont absentes.'
    );
  }

  const nombreColonnes = feuille.headers.length;

  if (
    Boolean(entree.exists) !== Boolean(feuille.exists) ||
    canonicaliserSauvegarde_(entree.headers) !==
      canonicaliserSauvegarde_(feuille.headers) ||
    Number(feuille.columnCount) !== nombreColonnes ||
    Number(feuille.rowCount) !== feuille.rows.length ||
    Number(feuille.cellCount) !==
      (feuille.rows.length + (feuille.exists ? 1 : 0)) *
        nombreColonnes ||
    Number(entree.columnCount) !== nombreColonnes ||
    Number(entree.rowCount) !== feuille.rows.length ||
    Number(entree.cellCount) !== Number(feuille.cellCount) ||
    Number(entree.identifiedRowCount) !==
      Number(feuille.identifiedRowCount)
  ) {
    throw new Error(
      'Les dimensions de la feuille ' + entree.name +
      ' sont incohérentes.'
    );
  }

  feuille.rows.forEach(function (ligne) {
    if (!Array.isArray(ligne) || ligne.length !== nombreColonnes) {
      throw new Error(
        'Une ligne de la feuille ' + entree.name +
        ' possède une dimension invalide.'
      );
    }
  });

  const configuration = SCHEMA_BASE_.find(function (element) {
    return element.feuille === entree.name;
  });
  const idColumn = configuration
    ? String(configuration.identifiant || '')
    : '';
  const index = creerIndexMigration_(feuille.headers);
  const positionIdentifiant = idColumn
    ? index[normaliserMigration_(idColumn)]
    : null;
  const compteIdentifies = Number.isInteger(positionIdentifiant)
    ? feuille.rows.filter(function (ligne) {
      return String(ligne[positionIdentifiant] || '').trim() !== '';
    }).length
    : 0;

  if (
    entree.idColumn !== idColumn ||
    feuille.idColumn !== idColumn ||
    Number(feuille.identifiedRowCount) !== compteIdentifies
  ) {
    throw new Error(
      'Le comptage des identifiants de la feuille ' +
      entree.name + ' est incohérent.'
    );
  }
}


function canonicaliserSauvegarde_(valeur) {
  if (valeur === null || valeur === undefined) {
    return 'null';
  }

  if (typeof valeur === 'string') {
    return JSON.stringify(valeur);
  }

  if (typeof valeur === 'number') {
    return Number.isFinite(valeur) ? String(valeur) : 'null';
  }

  if (typeof valeur === 'boolean') {
    return valeur ? 'true' : 'false';
  }

  if (Array.isArray(valeur)) {
    return '[' + valeur.map(canonicaliserSauvegarde_).join(',') + ']';
  }

  return '{' + Object.keys(valeur).sort().map(function (cle) {
    return JSON.stringify(cle) + ':' +
      canonicaliserSauvegarde_(valeur[cle]);
  }).join(',') + '}';
}


function hacherTexteSauvegarde_(texte) {
  const octets = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(texte || ''),
    Utilities.Charset.UTF_8
  );

  return encoderOctetsHexadecimalSauvegarde_(octets);
}


function signerTexteSauvegarde_(texte, cleHmac) {
  const octets = Utilities.computeHmacSha256Signature(
    String(texte || ''),
    String(cleHmac || ''),
    Utilities.Charset.UTF_8
  );

  return encoderOctetsHexadecimalSauvegarde_(octets);
}


function encoderOctetsHexadecimalSauvegarde_(octets) {
  return octets.map(function (octet) {
    const valeur = octet < 0 ? octet + 256 : octet;
    return ('0' + valeur.toString(16)).slice(-2);
  }).join('');
}


function tailleUtf8Sauvegarde_(texte) {
  return Utilities.newBlob(String(texte || '')).getBytes().length;
}


function obtenirCleHmacSauvegarde_(proprietes) {
  let cle = proprietes.getProperty(
    PROPRIETE_CLE_HMAC_SAUVEGARDE_
  );

  if (!cle) {
    cle = creerSecretAleatoireSecurite_() +
      creerSecretAleatoireSecurite_();
    proprietes.setProperty(
      PROPRIETE_CLE_HMAC_SAUVEGARDE_,
      cle
    );
  }

  return cle;
}


function obtenirIdCleHmacSauvegarde_(proprietes, cleHmac) {
  let keyId = proprietes.getProperty(
    PROPRIETE_ID_CLE_HMAC_SAUVEGARDE_
  );

  if (!keyId) {
    keyId = hacherTexteSauvegarde_(
      'CLE_HMAC_SAUVEGARDE\u0000' + cleHmac
    ).slice(0, 20);
    proprietes.setProperty(
      PROPRIETE_ID_CLE_HMAC_SAUVEGARDE_,
      keyId
    );
  }

  return keyId;
}


function obtenirInstallationSauvegarde_(proprietes) {
  let identifiant = proprietes.getProperty(
    PROPRIETE_INSTALLATION_SAUVEGARDE_
  );

  if (!identifiant) {
    identifiant = Utilities.getUuid();
    proprietes.setProperty(
      PROPRIETE_INSTALLATION_SAUVEGARDE_,
      identifiant
    );
  }

  return identifiant;
}


function obtenirDossierSauvegardes_(creerSiAbsent) {
  const proprietes = PropertiesService.getScriptProperties();
  const installationId = obtenirInstallationSauvegarde_(
    proprietes
  );
  const marqueurRacine =
    'PREPFORMATION_INSTALLATION:' + installationId;
  const racineDrive = DriveApp.getRootFolder();
  let dossierRacine = obtenirDossierMemoriseSauvegarde_(
    proprietes.getProperty(
      PROPRIETE_DOSSIER_RACINE_SAUVEGARDE_
    ),
    'PrepFormation',
    racineDrive.getId()
  );

  if (!dossierRacine) {
    const candidats = listerSousDossiersSauvegarde_(
      racineDrive,
      'PrepFormation'
    );
    const marques = candidats.filter(function (dossier) {
      return String(dossier.getDescription() || '')
        .includes(marqueurRacine);
    });

    if (marques.length > 1 || (!marques.length && candidats.length > 1)) {
      throw new Error(
        'Plusieurs dossiers PrepFormation ambigus existent dans le Drive du propriétaire.'
      );
    }

    if (marques.length === 1) {
      dossierRacine = marques[0];
    } else if (candidats.length === 1) {
      const description = String(
        candidats[0].getDescription() || ''
      );

      if (
        description.includes('PREPFORMATION_INSTALLATION:') &&
        !description.includes(marqueurRacine)
      ) {
        throw new Error(
          'Le dossier PrepFormation existant appartient à une autre installation.'
        );
      }

      dossierRacine = candidats[0];
    } else if (creerSiAbsent) {
      dossierRacine = racineDrive.createFolder('PrepFormation');
    }
  }

  if (!dossierRacine) {
    return null;
  }

  const descriptionRacine = String(
    dossierRacine.getDescription() || ''
  );

  if (
    descriptionRacine.includes(
      'PREPFORMATION_INSTALLATION:'
    ) &&
    !descriptionRacine.includes(marqueurRacine)
  ) {
    throw new Error(
      'Le dossier PrepFormation mémorisé appartient à une autre installation.'
    );
  }

  assurerMarqueurDossierSauvegarde_(
    dossierRacine,
    marqueurRacine
  );
  proprietes.setProperty(
    PROPRIETE_DOSSIER_RACINE_SAUVEGARDE_,
    dossierRacine.getId()
  );

  let dossierSauvegardes = obtenirDossierMemoriseSauvegarde_(
    proprietes.getProperty(PROPRIETE_DOSSIER_SAUVEGARDE_),
    'Sauvegardes',
    dossierRacine.getId()
  );

  if (!dossierSauvegardes) {
    const candidats = listerSousDossiersSauvegarde_(
      dossierRacine,
      'Sauvegardes'
    );

    if (candidats.length > 1) {
      throw new Error(
        'Plusieurs dossiers Sauvegardes ambigus existent dans PrepFormation.'
      );
    }

    if (candidats.length === 1) {
      dossierSauvegardes = candidats[0];
    } else if (creerSiAbsent) {
      dossierSauvegardes = dossierRacine.createFolder(
        'Sauvegardes'
      );
    }
  }

  if (!dossierSauvegardes) {
    return null;
  }

  assurerMarqueurDossierSauvegarde_(
    dossierSauvegardes,
    'PREPFORMATION_BACKUPS:' + installationId
  );
  proprietes.setProperty(
    PROPRIETE_DOSSIER_SAUVEGARDE_,
    dossierSauvegardes.getId()
  );

  return dossierSauvegardes;
}


function obtenirDossierMemoriseSauvegarde_(
  idDossier,
  nomAttendu,
  idParentAttendu
) {
  if (!idDossier) {
    return null;
  }

  try {
    const dossier = DriveApp.getFolderById(idDossier);

    if (
      dossier.isTrashed() ||
      dossier.getName() !== nomAttendu ||
      !dossierEstEnfantSauvegarde_(dossier, idParentAttendu)
    ) {
      return null;
    }

    return dossier;
  } catch (erreur) {
    return null;
  }
}


function dossierEstEnfantSauvegarde_(dossier, idParent) {
  const parents = dossier.getParents();

  while (parents.hasNext()) {
    if (parents.next().getId() === idParent) {
      return true;
    }
  }

  return false;
}


function listerSousDossiersSauvegarde_(parent, nom) {
  const iterateur = parent.getFoldersByName(nom);
  const dossiers = [];

  while (iterateur.hasNext()) {
    const dossier = iterateur.next();

    if (!dossier.isTrashed()) {
      dossiers.push(dossier);
    }
  }

  return dossiers;
}


function assurerMarqueurDossierSauvegarde_(dossier, marqueur) {
  const description = String(dossier.getDescription() || '');

  if (description.includes(marqueur)) {
    return;
  }

  dossier.setDescription(
    [description.trim(), marqueur].filter(Boolean).join('\n')
  );
}


function estimerVolumeSauvegarde_(classeur) {
  let cellules = 0;

  SCHEMA_BASE_.forEach(function (configuration) {
    const feuille = classeur.getSheetByName(
      configuration.feuille
    );

    if (!feuille) {
      return;
    }

    cellules += Math.max(feuille.getLastRow(), 1) *
      Math.max(feuille.getLastColumn(), 1);
  });

  return {
    cellules: cellules,
    octetsEstimes: cellules * 32
  };
}


function verifierCapacitePhase1Sauvegarde_(estimation, duree) {
  if (
    Number(estimation.octetsEstimes || 0) >
      OCTETS_MAX_PHASE_1_SAUVEGARDE_ ||
    Number(duree || 0) > DUREE_PRUDENTE_PHASE_1_MS_
  ) {
    throw new Error(
      'Cette sauvegarde risque de dépasser les capacités d’une exécution Apps Script. Le mode par blocs sera ajouté dans une phase ultérieure.'
    );
  }
}


function construireNomsFichierSauvegarde_(sauvegarde) {
  const date = sauvegarde.metadata.createdAt
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  const versionApp = String(
    sauvegarde.metadata.applicationVersion || 'inconnue'
  ).replace(/[^A-Za-z0-9._-]+/g, '-');
  const suffixe = sauvegarde.backupId
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 8);
  const base = [
    'PrepFormation',
    date,
    String(sauvegarde.metadata.type || TYPE_SAUVEGARDE_MANUELLE_)
      .replace(/[^A-Za-z0-9_-]+/g, '-'),
    'schema-' + sauvegarde.metadata.schemaVersion,
    'app-' + versionApp,
    suffixe
  ].join('__');

  return {
    partiel: base + '.partial',
    final: base + '.json'
  };
}


function construireDescriptionFichierSauvegarde_(
  sauvegarde,
  nomFichier,
  verification
) {
  return PREFIXE_DESCRIPTION_FICHIER_SAUVEGARDE_ +
    JSON.stringify({
      backupId: sauvegarde.backupId,
      createdAt: sauvegarde.metadata.createdAt,
      type: sauvegarde.metadata.type,
      schemaVersion: sauvegarde.metadata.schemaVersion,
      applicationVersion:
        sauvegarde.metadata.applicationVersion,
      integrityStatus: sauvegarde.metadata.integrityStatus,
      fileName: nomFichier,
      fileSizeBytes: sauvegarde.metadata.fileSizeBytes,
      counts: sauvegarde.metadata.counts,
      verified: Boolean(verification.valide),
      warningLargeFile:
        sauvegarde.metadata.fileSizeBytes >=
          OCTETS_AVERTISSEMENT_SAUVEGARDE_
    });
}


function lireDescriptionFichierSauvegarde_(fichier) {
  const texte = String(fichier.getDescription() || '');

  if (!texte.startsWith(
    PREFIXE_DESCRIPTION_FICHIER_SAUVEGARDE_
  )) {
    return null;
  }

  try {
    const description = JSON.parse(
      texte.slice(
        PREFIXE_DESCRIPTION_FICHIER_SAUVEGARDE_.length
      )
    );

    if (!description.backupId) {
      return null;
    }

    return description;
  } catch (erreur) {
    return null;
  }
}


function construireEtatDepuisDescriptionSauvegarde_(description) {
  return {
    backupId: description.backupId,
    createdAt: description.createdAt,
    type: description.type,
    schemaVersion: description.schemaVersion,
    applicationVersion: description.applicationVersion,
    integrityStatus: description.integrityStatus,
    fileName: description.fileName,
    fileSizeBytes: Number(description.fileSizeBytes || 0),
    counts: description.counts || {},
    verificationIntegrite: Boolean(description.verified),
    warningLargeFile: Boolean(description.warningLargeFile)
  };
}


function construireResultatSauvegarde_(
  sauvegarde,
  nomFichier,
  verification,
  taille
) {
  return {
    succes: true,
    message: sauvegarde.anomalies.length
      ? 'Sauvegarde réussie avec anomalies.'
      : 'Sauvegarde réussie.',
    backupId: sauvegarde.backupId,
    createdAt: sauvegarde.metadata.createdAt,
    type: sauvegarde.metadata.type,
    fileName: nomFichier,
    fileSizeBytes: taille,
    schemaVersion: sauvegarde.metadata.schemaVersion,
    applicationVersion: sauvegarde.metadata.applicationVersion,
    integrityStatus: sauvegarde.metadata.integrityStatus,
    counts: sauvegarde.metadata.counts,
    verificationIntegrite: Boolean(verification.valide),
    nombreAnomalies: sauvegarde.anomalies.length,
    warningLargeFile: taille >=
      OCTETS_AVERTISSEMENT_SAUVEGARDE_
  };
}


function trouverFichierSauvegardeParId_(backupId) {
  const dossier = obtenirDossierSauvegardes_(false);

  if (!dossier) {
    return null;
  }

  return trouverFichierSauvegardeDansDossier_(
    dossier,
    backupId
  );
}


function trouverFichierSauvegardeDansDossier_(dossier, backupId) {
  const fichiers = dossier.getFiles();

  while (fichiers.hasNext()) {
    const fichier = fichiers.next();

    if (fichier.isTrashed() || !fichier.getName().endsWith('.json')) {
      continue;
    }

    const description = lireDescriptionFichierSauvegarde_(fichier);

    if (description && description.backupId === backupId) {
      return fichier;
    }
  }

  return null;
}


function trouverDernierFichierSauvegarde_(dossier) {
  const fichiers = dossier.getFiles();
  let meilleur = null;
  let meilleureDate = '';

  while (fichiers.hasNext()) {
    const fichier = fichiers.next();

    if (fichier.isTrashed() || !fichier.getName().endsWith('.json')) {
      continue;
    }

    const description = lireDescriptionFichierSauvegarde_(fichier);

    if (
      description &&
      String(description.createdAt || '') > meilleureDate
    ) {
      meilleur = fichier;
      meilleureDate = String(description.createdAt || '');
    }
  }

  return meilleur;
}


function placerSauvegardeCorbeilleInterne_(backupId, options) {
  const identifiant = nettoyerBackupIdSauvegarde_(backupId);
  const parametres = options || {};
  const proteges = obtenirBackupIdsProtegesRestauration_();

  if (
    !parametres.autoriserProtectionActive &&
    proteges.has(identifiant)
  ) {
    throw new Error(
      'Cette sauvegarde est utilisée par une restauration active et ne peut pas être supprimée.'
    );
  }

  const contexte = obtenirContexteRestaurabilite_(false);
  const fichier = trouverFichierSauvegardeRestaurabilite_(
    contexte.dossier,
    identifiant
  );

  if (!fichier) {
    throw new Error('Sauvegarde introuvable.');
  }

  const validation = validerFichierSauvegardeRestaurabilite_(
    fichier,
    contexte,
    identifiant
  );
  const rapports = trouverRapportsSauvegardePourCorbeille_(
    contexte.dossier,
    identifiant
  );
  const deplaces = [];

  try {
    rapports.forEach(function (rapport) {
      rapport.setTrashed(true);
      deplaces.push(rapport);
    });

    fichier.setTrashed(true);
    deplaces.push(fichier);
  } catch (erreur) {
    deplaces.slice().reverse().forEach(function (element) {
      try {
        element.setTrashed(false);
      } catch (erreurRetour) {
        console.error(erreurRetour);
      }
    });
    throw new Error(
      'Le placement dans la corbeille a échoué ; les éléments déjà déplacés ont été restaurés.'
    );
  }

  try {
    mettreAJourDerniereSauvegardeApresCorbeille_(
      identifiant,
      contexte.dossier
    );
  } catch (erreurEtatDerniereSauvegarde) {
    console.error(erreurEtatDerniereSauvegarde);
  }

  return {
    backupId: identifiant,
    type: validation.sauvegarde.metadata.type,
    createdAt: validation.sauvegarde.metadata.createdAt,
    comment: String(validation.sauvegarde.metadata.comment || ''),
    nombreRapportsCorbeille: rapports.length
  };
}


function trouverRapportsSauvegardePourCorbeille_(dossier, backupId) {
  const fichiers = dossier.getFiles();
  const rapports = [];

  while (fichiers.hasNext()) {
    const fichier = fichiers.next();

    if (
      fichier.isTrashed() ||
      !String(fichier.getName() || '')
        .endsWith(SUFFIXE_RAPPORT_RESTAURABILITE_)
    ) {
      continue;
    }

    const description = lireDescriptionRapportRestaurabilite_(fichier);

    if (!description || description.backupId !== backupId) {
      continue;
    }

    verifierRapportSauvegardePourCorbeille_(fichier, backupId);
    rapports.push(fichier);
  }

  return rapports;
}


function verifierRapportSauvegardePourCorbeille_(fichier, backupId) {
  let rapport;

  try {
    rapport = JSON.parse(
      fichier.getBlob().getDataAsString('UTF-8')
    );
  } catch (erreur) {
    throw new Error(
      'Un rapport de restaurabilité associé est illisible ; la suppression est bloquée.'
    );
  }

  const integrite = rapport && rapport.integrity;
  const contenu = JSON.parse(JSON.stringify(rapport || {}));

  delete contenu.integrity;

  if (
    !rapport ||
    rapport.format !== FORMAT_RAPPORT_RESTAURABILITE_ ||
    Number(rapport.formatVersion) !==
      VERSION_FORMAT_RAPPORT_RESTAURABILITE_ ||
    String(rapport.backupId || '') !== backupId ||
    !integrite ||
    integrite.hashAlgorithm !== 'SHA-256' ||
    !comparaisonConstanteSecurite_(
      hacherTexteSauvegarde_(
        canonicaliserSauvegarde_(contenu)
      ),
      String(integrite.contentHash || '')
    )
  ) {
    throw new Error(
      'L’identité ou l’intégrité d’un rapport associé est invalide ; la suppression est bloquée.'
    );
  }
}


function mettreAJourDerniereSauvegardeApresCorbeille_(
  backupId,
  dossier
) {
  const proprietes = PropertiesService.getScriptProperties();

  if (
    String(proprietes.getProperty(
      PROPRIETE_DERNIERE_SAUVEGARDE_
    ) || '') !== backupId
  ) {
    return;
  }

  const derniere = trouverDernierFichierSauvegarde_(dossier);

  if (!derniere) {
    proprietes.deleteProperty(PROPRIETE_DERNIERE_SAUVEGARDE_);
    return;
  }

  const description = lireDescriptionFichierSauvegarde_(derniere);

  if (description && description.backupId) {
    proprietes.setProperty(
      PROPRIETE_DERNIERE_SAUVEGARDE_,
      description.backupId
    );
  } else {
    proprietes.deleteProperty(PROPRIETE_DERNIERE_SAUVEGARDE_);
  }
}


function hacherJetonTelechargementSauvegarde_(jeton) {
  return hacherTexteSauvegarde_(
    'JETON_TELECHARGEMENT_SAUVEGARDE\u0000' +
    String(jeton || '')
  );
}


function nettoyerJetonsTelechargementSauvegarde_(proprietes) {
  const maintenant = Date.now();
  const toutes = proprietes.getProperties();

  Object.keys(toutes).forEach(function (cle) {
    if (!cle.startsWith(
      PREFIXE_JETON_TELECHARGEMENT_SAUVEGARDE_
    )) {
      return;
    }

    try {
      const valeur = JSON.parse(toutes[cle]);

      if (Number(valeur.expireA || 0) <= maintenant) {
        proprietes.deleteProperty(cle);
      }
    } catch (erreur) {
      proprietes.deleteProperty(cle);
    }
  });
}


function nettoyerCommentaireSauvegarde_(commentaire) {
  const texte = String(commentaire || '').trim();

  if (texte.length > 500) {
    throw new Error(
      'Le commentaire de sauvegarde est limité à 500 caractères.'
    );
  }

  return texte;
}


function nettoyerBackupIdSauvegarde_(backupId) {
  const identifiant = String(backupId || '').trim();

  if (!/^[A-Za-z0-9_-]{8,100}$/.test(identifiant)) {
    throw new Error('Identifiant de sauvegarde invalide.');
  }

  return identifiant;
}


function verifierAbsenceSecretsSauvegarde_(
  contenu,
  jetonAdministrateur,
  cleHmac,
  proprietes
) {
  const secrets = [
    String(jetonAdministrateur || ''),
    String(cleHmac || ''),
    String(proprietes.getProperty('ADMIN_PASSWORD_SALT') || ''),
    String(proprietes.getProperty('ADMIN_PASSWORD_HASH') || '')
  ].filter(function (secret) {
    return secret.length >= 12;
  });

  if (secrets.some(function (secret) {
    return contenu.includes(secret);
  })) {
    throw new Error(
      'La sauvegarde contient une donnée de sécurité interdite.'
    );
  }
}
