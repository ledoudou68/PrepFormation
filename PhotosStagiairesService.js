'use strict';

const TAILLE_MAX_PHOTO_STAGIAIRE_SERVEUR_ = 4 * 1024 * 1024;
const PREFIXE_DESCRIPTION_PHOTO_STAGIAIRE_ =
  'PREPFORMATION_PHOTO_STAGIAIRE:';


/**
 * Consultation autorisée aux formateurs. Aucun identifiant Drive n'est
 * renvoyé au navigateur : seul un contenu temporaire est sérialisé.
 */
function getPhotoStagiaire(uuid, jetonUtilisateur) {
  exigerUtilisateurAuthentifie_(jetonUtilisateur);
  const reference = lireReferencePhotoStagiaire_(uuid);

  if (!reference.fileId) {
    return construirePhotoStagiaireIndisponible_(
      reference.photoUrl
        ? 'Photo historique indisponible dans le stockage privé.'
        : 'Aucune photo.'
    );
  }

  try {
    const fichier = DriveApp.getFileById(reference.fileId);
    verifierFichierPhotoStagiaire_(
      fichier,
      reference.uuid,
      false
    );
    const blob = fichier.getBlob();
    const type = String(blob.getContentType() || '').toLowerCase();

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      throw new Error('Format de photo stocké non pris en charge.');
    }

    return {
      disponible: true,
      dataUrl: 'data:' + type + ';base64,' +
        Utilities.base64Encode(blob.getBytes()),
      mimeType: type,
      nom: reference.photoNom || fichier.getName(),
      dateModification: convertirDateHeureStatutPourInterface_(
        reference.photoDateModification
      ),
      message: ''
    };
  } catch (erreur) {
    return construirePhotoStagiaireIndisponible_('Photo indisponible.');
  }
}


function enregistrerPhotoStagiaire(donnees, jetonAdministrateur) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    return enregistrerPhotoStagiaireInterne_(donnees, session);
  });
}


function enregistrerPhotoStagiaireInterne_(donnees, session) {
  donnees = donnees || {};
  const uuid = nettoyerUuidPhotoStagiaire_(donnees.uuid);
  const base64 = String(donnees.contenuBase64 || '').trim();

  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('Le contenu de la photo est absent ou invalide.');
  }

  let octets;
  try {
    octets = Utilities.base64Decode(base64);
  } catch (erreur) {
    throw new Error('La photo transmise est illisible.');
  }

  verifierOctetsJpegPhotoStagiaire_(octets);

  const reference = lireReferencePhotoStagiaire_(uuid, true);
  const dossier = obtenirDossierUuidPhotoStagiaire_(uuid, true);
  const nom = construireNomPhotoStagiaire_(uuid);
  const hashAttendu = hacherOctetsPhotoStagiaire_(octets);
  const blob = Utilities.newBlob(octets, 'image/jpeg', nom);
  let nouveauFichier = null;
  let ecritureFeuilleConfirmee = false;

  try {
    nouveauFichier = dossier.createFile(blob);
    nouveauFichier.setDescription(
      PREFIXE_DESCRIPTION_PHOTO_STAGIAIRE_ + JSON.stringify({
        uuid: uuid,
        dateCreation: new Date().toISOString()
      })
    );

    const verification = verifierFichierPhotoStagiaire_(
      nouveauFichier,
      uuid,
      true
    );

    if (verification.hash !== hashAttendu) {
      throw new Error('La photo relue depuis Drive diffère du fichier reçu.');
    }

    const maintenant = new Date();
    const ancienneLigne = reference.ligne.slice();
    const nouvelleLigne = reference.ligne.slice();
    nouvelleLigne[reference.index.PHOTO_FILE_ID] =
      nouveauFichier.getId();
    nouvelleLigne[reference.index.PHOTO_NOM] = nom;
    nouvelleLigne[reference.index.PHOTO_DATE_MODIFICATION] = maintenant;

    if (Number.isInteger(reference.index.PHOTO_URL)) {
      nouvelleLigne[reference.index.PHOTO_URL] = '';
    }

    try {
      reference.feuille.getRange(
        reference.numeroLigne,
        1,
        1,
        reference.feuille.getLastColumn()
      ).setValues([nouvelleLigne]);
      reference.feuille.getRange(
        reference.numeroLigne,
        reference.index.PHOTO_DATE_MODIFICATION + 1
      ).setNumberFormat('dd/MM/yyyy HH:mm');
      SpreadsheetApp.flush();
      ecritureFeuilleConfirmee = true;
      if (typeof invaliderGenerationSourcesStatuts_ === 'function') {
        invaliderGenerationSourcesStatuts_(
          'STAGIAIRES',
          'MODIFICATION_PHOTO_STAGIAIRE'
        );
      }
    } catch (erreurFeuille) {
      try {
        reference.feuille.getRange(
          reference.numeroLigne,
          1,
          1,
          reference.feuille.getLastColumn()
        ).setValues([ancienneLigne]);
        SpreadsheetApp.flush();
      } catch (erreurRetour) {
        // L'erreur d'écriture initiale reste l'erreur utile.
      }
      throw erreurFeuille;
    }

    let anciennePhotoCorbeille = false;
    let avertissement = '';

    if (
      reference.fileId &&
      reference.fileId !== nouveauFichier.getId()
    ) {
      try {
        const ancienFichier = DriveApp.getFileById(reference.fileId);
        verifierFichierPhotoStagiaire_(ancienFichier, uuid, true);
        ancienFichier.setTrashed(true);
        anciennePhotoCorbeille = true;
      } catch (erreurAnciennePhoto) {
        avertissement =
          'La nouvelle photo est enregistrée, mais l’ancienne n’a pas pu être placée dans la corbeille.';
      }
    }

    journaliserActionSensible_(
      reference.fileId
        ? 'PHOTO_STAGIAIRE_REMPLACEMENT'
        : 'PHOTO_STAGIAIRE_AJOUT',
      'STAGIAIRE',
      uuid,
      {
        nom: nom,
        taille: verification.taille,
        anciennePhotoCorbeille: anciennePhotoCorbeille,
        avertissement: avertissement
      },
      session.identifiantHistorique
    );

    return {
      succes: true,
      message: avertissement || 'Photo enregistrée.',
      nom: nom,
      dateModification: convertirDateHeureStatutPourInterface_(maintenant),
      avertissement: avertissement
    };
  } catch (erreur) {
    if (nouveauFichier && !ecritureFeuilleConfirmee) {
      try {
        nouveauFichier.setTrashed(true);
      } catch (erreurCorbeille) {
        // Le fichier non référencé reste inutilisable par l'application.
      }
    }
    throw new Error(
      'La photo n’a pas été enregistrée. La photo précédente est conservée. ' +
      String(erreur.message || erreur)
    );
  }
}


function supprimerPhotoStagiaire(donnees, jetonAdministrateur) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  return executerMutationMetier_(function () {
    donnees = donnees || {};

    if (donnees.confirmation !== true) {
      throw new Error('La confirmation de suppression est obligatoire.');
    }

    const uuid = nettoyerUuidPhotoStagiaire_(donnees.uuid);
    const reference = lireReferencePhotoStagiaire_(uuid, true);
    let fichier = null;

    if (reference.fileId) {
      try {
        fichier = DriveApp.getFileById(reference.fileId);
      } catch (erreurFichierAbsent) {
        fichier = null;
      }

      if (fichier) {
        verifierFichierPhotoStagiaire_(fichier, uuid, true);
      }
    }

    const ancienneLigne = reference.ligne.slice();
    const nouvelleLigne = reference.ligne.slice();
    nouvelleLigne[reference.index.PHOTO_FILE_ID] = '';
    nouvelleLigne[reference.index.PHOTO_NOM] = '';
    nouvelleLigne[reference.index.PHOTO_DATE_MODIFICATION] = '';

    if (Number.isInteger(reference.index.PHOTO_URL)) {
      nouvelleLigne[reference.index.PHOTO_URL] = '';
    }

    reference.feuille.getRange(
      reference.numeroLigne,
      1,
      1,
      reference.feuille.getLastColumn()
    ).setValues([nouvelleLigne]);
    SpreadsheetApp.flush();

    try {
      if (fichier) {
        fichier.setTrashed(true);
      }
    } catch (erreurCorbeille) {
      reference.feuille.getRange(
        reference.numeroLigne,
        1,
        1,
        reference.feuille.getLastColumn()
      ).setValues([ancienneLigne]);
      SpreadsheetApp.flush();
      throw new Error(
        'La photo n’a pas pu être placée dans la corbeille ; sa référence a été restaurée.'
      );
    }

    if (typeof invaliderGenerationSourcesStatuts_ === 'function') {
      invaliderGenerationSourcesStatuts_(
        'STAGIAIRES',
        'SUPPRESSION_PHOTO_STAGIAIRE'
      );
    }

    journaliserActionSensible_(
      'PHOTO_STAGIAIRE_SUPPRESSION',
      'STAGIAIRE',
      uuid,
      { fichierPlaceDansCorbeille: Boolean(fichier) },
      session.identifiantHistorique
    );

    return {
      succes: true,
      message: fichier
        ? 'Photo supprimée et placée dans la corbeille Drive.'
        : 'Référence photo supprimée ; le fichier Drive était déjà indisponible.'
    };
  });
}


function lireReferencePhotoStagiaire_(uuid, inclureLigne) {
  const identifiant = nettoyerUuidPhotoStagiaire_(uuid);
  const feuille = obtenirFeuilleStagiairesLecture_();
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexEntetes_(donnees[0] || []);

  [
    'UUID',
    'PHOTO_FILE_ID',
    'PHOTO_NOM',
    'PHOTO_DATE_MODIFICATION'
  ].forEach(function (colonne) {
    if (!Number.isInteger(index[colonne])) {
      throw new Error(
        'La colonne « ' + colonne + ' » est absente de STAGIAIRES.'
      );
    }
  });

  for (let position = 1; position < donnees.length; position++) {
    if (String(donnees[position][index.UUID] || '').trim() !== identifiant) {
      continue;
    }

    return {
      uuid: identifiant,
      fileId: String(
        donnees[position][index.PHOTO_FILE_ID] || ''
      ).trim(),
      photoNom: String(
        donnees[position][index.PHOTO_NOM] || ''
      ).trim(),
      photoDateModification:
        donnees[position][index.PHOTO_DATE_MODIFICATION],
      photoUrl: Number.isInteger(index.PHOTO_URL)
        ? String(donnees[position][index.PHOTO_URL] || '').trim()
        : '',
      feuille: inclureLigne ? feuille : null,
      index: inclureLigne ? index : null,
      ligne: inclureLigne ? donnees[position].slice() : null,
      numeroLigne: position + 1
    };
  }

  throw new Error('Stagiaire introuvable.');
}


function obtenirDossierPhotosStagiaires_(creerSiAbsent) {
  return obtenirSousDossierPrepFormation_(
    'Photos stagiaires',
    PROPRIETE_DOSSIER_PHOTOS_STAGIAIRES_,
    'PREPFORMATION_PHOTOS:',
    creerSiAbsent
  );
}


function obtenirDossierUuidPhotoStagiaire_(uuid, creerSiAbsent) {
  const racine = obtenirDossierPhotosStagiaires_(creerSiAbsent);

  if (!racine) {
    return null;
  }

  const candidats = listerSousDossiersSauvegarde_(racine, uuid);

  if (candidats.length > 1) {
    throw new Error(
      'Plusieurs dossiers photo existent pour le stagiaire ' + uuid + '.'
    );
  }

  const dossier = candidats[0] || (
    creerSiAbsent ? racine.createFolder(uuid) : null
  );

  if (dossier) {
    assurerMarqueurDossierSauvegarde_(
      dossier,
      'PREPFORMATION_PHOTO_UUID:' + uuid
    );
  }

  return dossier;
}


function verifierFichierPhotoStagiaire_(fichier, uuid, exigerJpeg) {
  if (!fichier || fichier.isTrashed()) {
    throw new Error('Le fichier photo est absent ou dans la corbeille.');
  }

  const dossier = obtenirDossierUuidPhotoStagiaire_(uuid, false);

  if (!dossier || !dossierContientFichierPrepFormation_(dossier, fichier)) {
    throw new Error(
      'Le fichier photo n’appartient pas au dossier privé de ce stagiaire.'
    );
  }

  if (!fichierDriveEstPrive_(fichier)) {
    throw new Error('Le fichier photo n’est pas privé.');
  }

  const blob = fichier.getBlob();
  const type = String(blob.getContentType() || '').toLowerCase();
  const octets = blob.getBytes();

  if (exigerJpeg || type === 'image/jpeg') {
    verifierOctetsJpegPhotoStagiaire_(octets);
  }

  return {
    taille: octets.length,
    hash: hacherOctetsPhotoStagiaire_(octets),
    mimeType: type
  };
}


function verifierOctetsJpegPhotoStagiaire_(octets) {
  if (!octets || octets.length < 128) {
    throw new Error('La photo JPEG est vide ou incomplète.');
  }

  if (octets.length > TAILLE_MAX_PHOTO_STAGIAIRE_SERVEUR_) {
    throw new Error(
      'La photo redimensionnée dépasse la limite serveur de 4 Mo.'
    );
  }

  const debutValide =
    ((octets[0] + 256) % 256) === 0xFF &&
    ((octets[1] + 256) % 256) === 0xD8 &&
    ((octets[2] + 256) % 256) === 0xFF;
  const finValide =
    ((octets[octets.length - 2] + 256) % 256) === 0xFF &&
    ((octets[octets.length - 1] + 256) % 256) === 0xD9;

  if (!debutValide || !finValide) {
    throw new Error('Le contenu transmis n’est pas un JPEG lisible.');
  }
}


function hacherOctetsPhotoStagiaire_(octets) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      octets
    )
  ).replace(/=+$/g, '');
}


function construireNomPhotoStagiaire_(uuid) {
  return uuid + '__' + Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd_HH-mm-ss'
  ) + '.jpg';
}


function nettoyerUuidPhotoStagiaire_(uuid) {
  const identifiant = String(uuid || '').trim();

  if (
    !identifiant ||
    identifiant.length > 100 ||
    !/^[A-Za-z0-9._:-]+$/.test(identifiant)
  ) {
    throw new Error('Identifiant du stagiaire invalide.');
  }

  return identifiant;
}


function construirePhotoStagiaireIndisponible_(message) {
  return {
    disponible: false,
    dataUrl: '',
    mimeType: '',
    nom: '',
    dateModification: '',
    message: message || 'Photo indisponible.'
  };
}
