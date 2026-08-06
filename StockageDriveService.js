'use strict';

const PROPRIETE_DOSSIER_DEMANDES_INDEMNISATION_ =
  'PREPFORMATION_INDEMNISATIONS_FOLDER_ID';
const PROPRIETE_DOSSIER_PHOTOS_STAGIAIRES_ =
  'PREPFORMATION_PHOTOS_FOLDER_ID';


/**
 * Retourne la racine privée PrepFormation déjà utilisée par les sauvegardes.
 * La résolution conserve le marqueur d'installation et refuse les ambiguïtés.
 */
function obtenirDossierRacinePrepFormation_(creerSiAbsent) {
  const proprietes = PropertiesService.getScriptProperties();
  const installationId = obtenirInstallationSauvegarde_(proprietes);
  const marqueur = 'PREPFORMATION_INSTALLATION:' + installationId;
  const racineDrive = DriveApp.getRootFolder();
  let dossier = obtenirDossierMemoriseSauvegarde_(
    proprietes.getProperty(PROPRIETE_DOSSIER_RACINE_SAUVEGARDE_),
    'PrepFormation',
    racineDrive.getId()
  );

  if (!dossier) {
    const candidats = listerSousDossiersSauvegarde_(
      racineDrive,
      'PrepFormation'
    );
    const marques = candidats.filter(function (candidat) {
      return String(candidat.getDescription() || '').includes(marqueur);
    });

    if (marques.length > 1 || (!marques.length && candidats.length > 1)) {
      throw new Error(
        'Plusieurs dossiers PrepFormation ambigus existent dans le Drive du propriétaire.'
      );
    }

    if (marques.length === 1) {
      dossier = marques[0];
    } else if (candidats.length === 1) {
      const description = String(candidats[0].getDescription() || '');

      if (
        description.includes('PREPFORMATION_INSTALLATION:') &&
        !description.includes(marqueur)
      ) {
        throw new Error(
          'Le dossier PrepFormation existant appartient à une autre installation.'
        );
      }

      dossier = candidats[0];
    } else if (creerSiAbsent) {
      dossier = racineDrive.createFolder('PrepFormation');
    }
  }

  if (!dossier) {
    return null;
  }

  assurerMarqueurDossierSauvegarde_(dossier, marqueur);
  proprietes.setProperty(
    PROPRIETE_DOSSIER_RACINE_SAUVEGARDE_,
    dossier.getId()
  );
  return dossier;
}


function obtenirSousDossierPrepFormation_(
  nom,
  clePropriete,
  prefixeMarqueur,
  creerSiAbsent
) {
  const proprietes = PropertiesService.getScriptProperties();
  const racine = obtenirDossierRacinePrepFormation_(creerSiAbsent);

  if (!racine) {
    return null;
  }

  const installationId = obtenirInstallationSauvegarde_(proprietes);
  const marqueur = prefixeMarqueur + installationId;
  let dossier = obtenirDossierMemoriseSauvegarde_(
    proprietes.getProperty(clePropriete),
    nom,
    racine.getId()
  );

  if (!dossier) {
    const candidats = listerSousDossiersSauvegarde_(racine, nom);
    const marques = candidats.filter(function (candidat) {
      return String(candidat.getDescription() || '').includes(marqueur);
    });

    if (marques.length > 1 || (!marques.length && candidats.length > 1)) {
      throw new Error(
        'Plusieurs dossiers « ' + nom + ' » ambigus existent dans PrepFormation.'
      );
    }

    dossier = marques[0] || candidats[0] || null;

    if (dossier) {
      const description = String(dossier.getDescription() || '');
      if (
        description.includes(prefixeMarqueur) &&
        !description.includes(marqueur)
      ) {
        throw new Error(
          'Le dossier « ' + nom + ' » appartient à une autre installation.'
        );
      }
    } else if (creerSiAbsent) {
      dossier = racine.createFolder(nom);
    }
  }

  if (!dossier) {
    return null;
  }

  assurerMarqueurDossierSauvegarde_(dossier, marqueur);
  proprietes.setProperty(clePropriete, dossier.getId());
  return dossier;
}


function dossierContientFichierPrepFormation_(dossier, fichier) {
  if (!dossier || !fichier || fichier.isTrashed()) {
    return false;
  }

  const parents = fichier.getParents();

  while (parents.hasNext()) {
    if (parents.next().getId() === dossier.getId()) {
      return true;
    }
  }

  return false;
}


function fichierDriveEstPrive_(fichier) {
  return fichier.getSharingAccess() === DriveApp.Access.PRIVATE;
}
