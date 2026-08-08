'use strict';

const CONTEXTE_MIGRATION_AUTOMATIQUE_ = {};
const CLE_VERSION_SCHEMA_ = 'VERSION_SCHEMA';
const LIMITE_ERREURS_INTEGRITE_ = 500;
const PARAMETRES_EMAIL_INDEMNISATION_DEFAUT_ = [
  ['EMAIL_CHEF_CENTRE', '', 300, true],
  ['NOM_CHEF_CENTRE', '', 301, true],
  ['NOM_CENTRE', '', 302, true],
  [
    'OBJET_MAIL_INDEMNISATION',
    'Demande d’indemnisation des formateurs – {{PERIODE}}',
    303,
    true
  ]
];

const SCHEMA_BASE_ = [
  {
    feuille: 'PARAMETRES',
    colonnes: [
      'CLE',
      'VALEUR',
      'ORDRE',
      'ACTIF'
    ]
  },
  {
    feuille: 'STAGIAIRES',
    identifiant: 'UUID',
    colonnes: [
      'UUID', 'NOM', 'PRENOM', 'FORMATION',
      'DATE_DEBUT_PREPARATION', 'DATE_STAGE', 'STATUT',
      'DATE_CLOTURE', 'MOTIF_CLOTURE',
      'NOTES_ADMINISTRATIVES', 'GRADE', 'TELEPHONE',
      'EMAIL', 'PHOTO_URL', 'FORMATEUR_REFERENT',
      'DATE_CHANGEMENT_STATUT_AUTO', 'DATE_CREATION',
      'DATE_MODIFICATION', 'PHOTO_FILE_ID', 'PHOTO_NOM',
      'PHOTO_DATE_MODIFICATION'
    ]
  },
  {
    feuille: 'FORMATEURS',
    identifiant: 'ID_FORMATEUR',
    colonnes: [
      'ID_FORMATEUR', 'NOM', 'PRENOM', 'ACTIF', 'EMAIL',
      'DATE_CREATION', 'DATE_MODIFICATION'
    ]
  },
  {
    feuille: 'FORMATIONS',
    identifiant: 'ID_FORMATION',
    colonnes: [
      'ID_FORMATION', 'LIBELLE', 'ORDRE', 'ACTIF'
    ]
  },
  {
    feuille: 'SESSIONS',
    identifiant: 'ID_SESSION',
    colonnes: [
      'ID_SESSION', 'DATE_SESSION', 'HEURE_DEBUT',
      'HEURE_FIN', 'DUREE_HEURES', 'FORMATION', 'THEME',
      'REMARQUES', 'SAISI_PAR', 'DATE_CREATION',
      'DATE_MODIFICATION', 'ID_REQUETE'
    ]
  },
  {
    feuille: 'PRESENCES_STAGIAIRES',
    identifiant: 'ID_PRESENCE',
    colonnes: [
      'ID_PRESENCE', 'ID_SESSION', 'ID_STAGIAIRE',
      'DATE_CREATION'
    ]
  },
  {
    feuille: 'PRESTATIONS_FORMATEURS',
    identifiant: 'ID_PRESTATION',
    colonnes: [
      'ID_PRESTATION', 'ID_SESSION', 'ID_FORMATEUR',
      'DUREE_HEURES', 'STATUT_INDEMNISATION',
      'DATE_DEMANDE', 'REFERENCE_DEMANDE',
      'REMARQUES_INDEMNISATION', 'DATE_CREATION',
      'DATE_MODIFICATION', 'ID_ENVOI'
    ]
  },
  {
    feuille: 'REFERENTIEL',
    identifiant: 'ID_ITEM',
    colonnes: [
      'ID_ITEM', 'FORMATION', 'ID_CATEGORIE', 'ITEM',
      'DESCRIPTION', 'ORDRE', 'ACTIF', 'NATURE'
    ]
  },
  {
    feuille: 'CATEGORIES',
    identifiant: 'ID_CATEGORIE',
    colonnes: [
      'ID_CATEGORIE', 'FORMATION', 'CATEGORIE',
      'ORDRE', 'ACTIF'
    ]
  },
  {
    feuille: 'EVALUATIONS',
    identifiant: 'ID_EVALUATION',
    colonnes: [
      'ID_EVALUATION', 'ID_SESSION', 'ID_STAGIAIRE',
      'ID_ITEM', 'NIVEAU', 'REMARQUE', 'VU',
      'DATE_CREATION', 'DATE_MODIFICATION'
    ]
  },
  {
    feuille: 'HISTORIQUE',
    identifiant: 'ID_HISTORIQUE',
    colonnes: [
      'ID_HISTORIQUE', 'DATE_ACTION', 'UTILISATEUR',
      'ACTION', 'OBJET', 'IDENTIFIANT', 'DETAILS'
    ]
  },
  {
    feuille: 'HISTORIQUE_INDEMNISATIONS',
    identifiant: 'ID_HISTORIQUE',
    colonnes: [
      'ID_HISTORIQUE', 'ID_OPERATION', 'ID_PRESTATION',
      'ANCIEN_STATUT', 'NOUVEAU_STATUT',
      'ANCIENNE_DATE_DEMANDE', 'NOUVELLE_DATE_DEMANDE',
      'ANCIENNE_REFERENCE', 'NOUVELLE_REFERENCE',
      'REMARQUE_ACTION', 'UTILISATEUR', 'DATE_ACTION'
    ]
  },
  {
    feuille: 'ITEMS_SESSIONS',
    identifiant: 'ID_SESSION_ITEM',
    colonnes: [
      'ID_SESSION_ITEM', 'ID_SESSION', 'ID_ITEM',
      'DATE_CREATION'
    ]
  },
  {
    feuille: 'HISTORIQUE_ENVOIS_INDEMNISATIONS',
    identifiant: 'ID_ENVOI',
    colonnes: [
      'ID_ENVOI', 'DATE_ENVOI', 'DESTINATAIRE',
      'COPIES', 'OBJET', 'REFERENCE_DEMANDE',
      'ID_PRESTATIONS', 'NOMBRE_FORMATEURS',
      'NOMBRE_SEANCES', 'VOLUME_HEURES',
      'STATUT_ENVOI', 'MESSAGE_ERREUR',
      'SESSION_ADMIN', 'DATE_CREATION', 'PDF_FILE_ID',
      'PDF_NOM', 'PDF_TAILLE', 'PDF_HASH'
    ]
  },
  {
    feuille: 'FAVORIS',
    identifiant: 'ID_FAVORI',
    colonnes: [
      'ID_FAVORI', 'TYPE', 'IDENTIFIANT', 'LIBELLE',
      'SOUS_LIBELLE', 'UTILISATEUR_CLE', 'DATE_CREATION'
    ]
  },
  {
    feuille: 'HISTORIQUE_IMPORTS_REFERENTIEL',
    identifiant: 'ID_IMPORT',
    colonnes: [
      'ID_IMPORT', 'DATE_IMPORT', 'NOM_FICHIER',
      'NOMBRE_LIGNES', 'CATEGORIES_CREEES',
      'ITEMS_CREES', 'ITEMS_EXISTANTS',
      'LIGNES_IGNOREES', 'ANOMALIES',
      'SESSION_ADMIN', 'DATE_CREATION'
    ]
  }
];

const MIGRATIONS_SCHEMA_ = [
  {
    version: 1,
    versionSource: 0,
    versionCible: 1,
    nom: 'Centralisation de la structure des feuilles',
    executer: migration1StructureInitiale_,
    simulable: true,
    simuler: simulerMigration1StructureInitialeModele_
  },
  {
    version: 2,
    versionSource: 1,
    versionCible: 2,
    nom: 'Valeurs par défaut des formations',
    executer: migration2ValeursFormations_,
    simulable: true,
    simuler: simulerMigration2ValeursFormationsModele_
  },
  {
    version: 3,
    versionSource: 2,
    versionCible: 3,
    nom: 'Rattachement des anciens items à une catégorie',
    executer: migration3CategoriesItemsReferentiel_,
    simulable: true,
    simuler: simulerMigration3CategoriesItemsReferentielModele_
  },
  {
    version: 4,
    versionSource: 3,
    versionCible: 4,
    nom: 'Envoi des demandes d’indemnisation par e-mail',
    executer: migration4EnvoisIndemnisations_,
    simulable: true,
    simuler: simulerMigration4EnvoisIndemnisationsModele_
  },
  {
    version: 5,
    versionSource: 4,
    versionCible: 5,
    nom: 'PDF des indemnisations et photos privées des stagiaires',
    executer: migration5PdfIndemnisationsPhotosStagiaires_,
    simulable: true,
    simuler: simulerMigration5PdfIndemnisationsPhotosStagiairesModele_
  },
  {
    version: 6,
    versionSource: 5,
    versionCible: 6,
    nom: 'Favoris locaux des utilisateurs',
    executer: migration6Favoris_,
    simulable: true,
    simuler: simulerMigration6FavorisModele_
  },
  {
    version: 7,
    versionSource: 6,
    versionCible: 7,
    nom: 'Import XLSX des référentiels pédagogiques',
    executer: migration7ImportReferentielXlsx_,
    simulable: true,
    simuler: simulerMigration7ImportReferentielXlsxModele_
  }
];


/**
 * Point d'entrée public. Le démarrage utilise un contexte privé ;
 * l'appel manuel depuis Administration exige le jeton administrateur.
 */
function executerMigrations(jetonOuContexte) {
  const automatique =
    jetonOuContexte === CONTEXTE_MIGRATION_AUTOMATIQUE_;
  const session = automatique
    ? null
    : exigerAdministrateur_(jetonOuContexte);

  return executerMutationMetier_(function () {
    return executerMigrationsInterne_(automatique, session);
  });
}


function executerMigrationsInterne_(automatique, session) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const versionCible = obtenirVersionSchemaCible_();
  const analyseInitiale = analyserStructureBase_(classeur);
  const versionInitiale = lireVersionSchemaSansCreation_(classeur);

  if (
    analyseInitiale.conforme &&
    versionInitiale >= versionCible
  ) {
    return construireRapportMigrations_(
      versionInitiale,
      versionCible,
      [],
      [],
      analyseInitiale
    );
  }

  const migrationsExecutees = [];
  let changementsStructure = [];

  changementsStructure = assurerStructureBase_(classeur);
  let version = lireVersionSchema_(classeur);

    MIGRATIONS_SCHEMA_
      .slice()
      .sort(function (a, b) {
        return a.version - b.version;
      })
      .forEach(function (migration) {
        if (migration.version <= version) {
          return;
        }

        migration.executer(classeur);
        ecrireVersionSchema_(classeur, migration.version);
        version = migration.version;
        migrationsExecutees.push({
          version: migration.version,
          nom: migration.nom
        });
      });

    SpreadsheetApp.flush();

    if (
      migrationsExecutees.length ||
      changementsStructure.length
    ) {
      journaliserActionSensible_(
        'MIGRATIONS_EXECUTION',
        'SCHEMA_BASE',
        String(version),
        {
          automatique: automatique,
          migrations: migrationsExecutees,
          changementsStructure: changementsStructure
        },
        session
          ? session.identifiantHistorique
          : 'MIGRATION_AUTOMATIQUE'
      );
    }

  return construireRapportMigrations_(
    version,
    versionCible,
    migrationsExecutees,
    changementsStructure,
    analyserStructureBase_(classeur)
  );
}


/**
 * Point d'entrée privé utilisé uniquement par doGet.
 */
function executerMigrationsAuDemarrage_() {
  return executerMigrations(
    CONTEXTE_MIGRATION_AUTOMATIQUE_
  );
}


/**
 * Exécute exclusivement la chaîne qui a été validée par le rapport de
 * restaurabilité. Cette fonction privée ne prend jamais de jeton client.
 * VERSION_SCHEMA n'est écrite qu'une fois la chaîne entière réussie.
 */
function executerChaineMigrationsRestauration_(
  classeur,
  migrationsAttendues,
  versionSource,
  versionCible,
  contexteInterne
) {
  exigerEcritureAutorisee_(contexteInterne);

  if (contexteInterne !== CONTEXTE_ECRITURE_RESTAURATION_) {
    throw new Error('Contexte de migration de restauration invalide.');
  }

  const chaine = obtenirChaineMigrationsSimulation_(
    versionSource,
    versionCible,
    MIGRATIONS_SCHEMA_
  );

  if (!chaine.complete) {
    throw new Error(chaine.raison || 'Chaîne de migrations incomplète.');
  }

  const attendues = (migrationsAttendues || []).map(
    function (migration) {
      return {
        versionSource: Number(migration.versionSource),
        versionCible: Number(migration.versionCible),
        nom: String(migration.nom || '')
      };
    }
  );
  const disponibles = chaine.migrations.map(function (migration) {
    return {
      versionSource: Number(migration.versionSource),
      versionCible: Number(migration.versionCible),
      nom: String(migration.nom || '')
    };
  });

  if (JSON.stringify(attendues) !== JSON.stringify(disponibles)) {
    throw new Error(
      'La chaîne de migrations disponible ne correspond plus à celle validée par le test de restaurabilité.'
    );
  }

  const changementsStructure = assurerStructureBase_(classeur);
  const executees = [];

  chaine.migrations.forEach(function (migration) {
    if (typeof migration.executer !== 'function') {
      throw new Error(
        'La migration ' + migration.versionSource + ' → ' +
        migration.versionCible + ' ne peut pas être exécutée.'
      );
    }

    migration.executer(classeur);
    executees.push({
      versionSource: migration.versionSource,
      versionCible: migration.versionCible,
      nom: migration.nom
    });
  });

  SpreadsheetApp.flush();
  ecrireVersionSchema_(classeur, Number(versionCible) || 0);
  SpreadsheetApp.flush();

  return {
    versionInitiale: Number(versionSource) || 0,
    versionFinale: Number(versionCible) || 0,
    migrationsExecutees: executees,
    changementsStructure: changementsStructure
  };
}


/**
 * Diagnostic en lecture seule. Aucune feuille ni cellule n'est modifiée.
 */
function verifierIntegriteBase(jetonAdministrateur) {
  exigerAdministrateur_(jetonAdministrateur);

  return construireRapportIntegrite_(
    SpreadsheetApp.getActiveSpreadsheet()
  );
}


function migration1StructureInitiale_(classeur) {
  assurerStructureBase_(classeur);
}


function migration2ValeursFormations_(classeur) {
  const feuille = classeur.getSheetByName('FORMATIONS');

  if (!feuille || feuille.getLastRow() < 2) {
    return;
  }

  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexMigration_(donnees[0]);

  if (
    !Number.isInteger(index.ORDRE) ||
    !Number.isInteger(index.ACTIF)
  ) {
    return;
  }

  let ordreFormation = 0;

  donnees.slice(1).forEach(function (ligne, position) {
    const numeroLigne = position + 2;
    const ligneRenseignee = ligne.some(function (valeur) {
      return valeur !== '' && valeur !== null;
    });

    if (!ligneRenseignee) {
      return;
    }

    ordreFormation++;

    if (
      ligne[index.ORDRE] === '' ||
      ligne[index.ORDRE] === null
    ) {
      feuille
        .getRange(numeroLigne, index.ORDRE + 1)
        .setValue(ordreFormation);
    }

    if (
      ligne[index.ACTIF] === '' ||
      ligne[index.ACTIF] === null
    ) {
      feuille
        .getRange(numeroLigne, index.ACTIF + 1)
        .setValue(true);
    }
  });
}


/**
 * Migration non destructive des items créés avant les catégories.
 */
function migration3CategoriesItemsReferentiel_(classeur) {
  const feuilleCategories = classeur.getSheetByName('CATEGORIES');
  const feuilleItems = classeur.getSheetByName('REFERENTIEL');

  if (
    !feuilleCategories ||
    !feuilleItems ||
    feuilleItems.getLastRow() < 2
  ) {
    return;
  }

  const donneesCategories = feuilleCategories
    .getDataRange()
    .getValues();
  const donneesItems = feuilleItems.getDataRange().getValues();
  const indexCategories = creerIndexMigration_(
    donneesCategories[0]
  );
  const indexItems = creerIndexMigration_(donneesItems[0]);

  if (
    !Number.isInteger(indexCategories.ID_CATEGORIE) ||
    !Number.isInteger(indexCategories.FORMATION) ||
    !Number.isInteger(indexCategories.CATEGORIE) ||
    !Number.isInteger(indexCategories.ORDRE) ||
    !Number.isInteger(indexCategories.ACTIF) ||
    !Number.isInteger(indexItems.ID_CATEGORIE) ||
    !Number.isInteger(indexItems.FORMATION)
  ) {
    return;
  }

  const categories = donneesCategories.slice(1)
    .map(function (ligne) {
      const idCategorie = String(
        ligne[indexCategories.ID_CATEGORIE] || ''
      ).trim();

      if (!idCategorie) {
        return null;
      }

      return {
        idCategorie: idCategorie,
        formation: String(
          ligne[indexCategories.FORMATION] || ''
        ).trim(),
        intitule: String(
          ligne[indexCategories.CATEGORIE] || ''
        ).trim()
      };
    })
    .filter(Boolean);
  const categoriesMigration = {};

  donneesItems.slice(1).forEach(function (ligne, position) {
    const formation = String(
      ligne[indexItems.FORMATION] || ''
    ).trim();
    const idCategorie = String(
      ligne[indexItems.ID_CATEGORIE] || ''
    ).trim();
    if (!formation || idCategorie) {
      return;
    }

    let categorieMigration =
      categoriesMigration[formation] ||
      categories.find(function (element) {
        return (
          element.formation === formation &&
          normaliserMigration_(element.intitule) ===
            'ITEMS_PEDAGOGIQUES'
        );
      });

    if (!categorieMigration) {
      categorieMigration = {
        idCategorie: Utilities.getUuid(),
        formation: formation,
        intitule: 'Items pédagogiques'
      };

      const ligneCategorie = new Array(
        feuilleCategories.getLastColumn()
      ).fill('');
      const nombreCategoriesFormation = categories.filter(
        function (element) {
          return element.formation === formation;
        }
      ).length;

      ligneCategorie[indexCategories.ID_CATEGORIE] =
        categorieMigration.idCategorie;
      ligneCategorie[indexCategories.FORMATION] = formation;
      ligneCategorie[indexCategories.CATEGORIE] =
        categorieMigration.intitule;
      ligneCategorie[indexCategories.ORDRE] =
        nombreCategoriesFormation + 1;
      ligneCategorie[indexCategories.ACTIF] = 'Oui';
      feuilleCategories.appendRow(ligneCategorie);
      categories.push(categorieMigration);
    }

    categoriesMigration[formation] = categorieMigration;
    feuilleItems
      .getRange(position + 2, indexItems.ID_CATEGORIE + 1)
      .setValue(categorieMigration.idCategorie);
  });
}


/**
 * Prépare l'envoi des demandes d'indemnisation sans écraser les paramètres
 * éventuellement déjà renseignés par l'administrateur.
 */
function migration4EnvoisIndemnisations_(classeur) {
  const feuille = classeur.getSheetByName('PARAMETRES');

  if (!feuille || feuille.getLastRow() < 1) {
    throw new Error('La feuille PARAMETRES est absente ou non initialisée.');
  }

  ajouterParametresEmailIndemnisationMigration_(feuille);
}


function migration5PdfIndemnisationsPhotosStagiaires_(classeur) {
  assurerStructureBase_(classeur);
}


function migration6Favoris_(classeur) {
  assurerFeuilleMigration_(classeur, 'FAVORIS');
}


function migration7ImportReferentielXlsx_(classeur) {
  assurerFeuilleMigration_(classeur, 'REFERENTIEL');
  assurerFeuilleMigration_(
    classeur,
    'HISTORIQUE_IMPORTS_REFERENTIEL'
  );
}


function ajouterParametresEmailIndemnisationMigration_(feuille) {
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexMigration_(donnees[0]);

  if (!Number.isInteger(index.CLE) || !Number.isInteger(index.VALEUR)) {
    throw new Error(
      'PARAMETRES doit contenir les colonnes CLE et VALEUR.'
    );
  }

  const clesExistantes = new Set(
    donnees.slice(1).map(function (ligne) {
      return normaliserMigration_(ligne[index.CLE]);
    }).filter(Boolean)
  );
  const lignes = PARAMETRES_EMAIL_INDEMNISATION_DEFAUT_
    .filter(function (parametre) {
      return !clesExistantes.has(normaliserMigration_(parametre[0]));
    })
    .map(function (parametre) {
      const ligne = new Array(feuille.getLastColumn()).fill('');
      ligne[index.CLE] = parametre[0];
      ligne[index.VALEUR] = parametre[1];

      if (Number.isInteger(index.ORDRE)) {
        ligne[index.ORDRE] = parametre[2];
      }

      if (Number.isInteger(index.ACTIF)) {
        ligne[index.ACTIF] = parametre[3];
      }

      return ligne;
    });

  if (lignes.length) {
    feuille
      .getRange(
        feuille.getLastRow() + 1,
        1,
        lignes.length,
        feuille.getLastColumn()
      )
      .setValues(lignes);
  }
}


/**
 * Simule en mémoire la chaîne de migrations sans utiliser SpreadsheetApp.
 * Le modèle reçu contient exclusivement les valeurs sérialisées du JSON.
 */
function simulerMigrationsModele_(
  modeleSource,
  versionSource,
  versionCible,
  migrationsOptionnelles
) {
  const modele = clonerModeleMigration_(modeleSource);
  const migrations = migrationsOptionnelles || MIGRATIONS_SCHEMA_;
  const chaine = obtenirChaineMigrationsSimulation_(
    versionSource,
    versionCible,
    migrations
  );
  const changementsStructure = assurerStructureModeleMigration_(
    modele
  );
  const migrationsSimulees = [];

  if (!chaine.complete) {
    return {
      reussie: false,
      modele: modele,
      versionInitiale: Number(versionSource) || 0,
      versionFinale: Number(versionSource) || 0,
      versionCible: Number(versionCible) || 0,
      chaineComplete: false,
      raison: chaine.raison,
      migrations: chaine.migrations,
      changementsStructure: changementsStructure
    };
  }

  chaine.migrations.forEach(function (migration) {
    migration.simuler(modele);
    ecrireVersionSchemaModeleMigration_(
      modele,
      migration.versionCible
    );
    recalculerToutesFeuillesModeleMigration_(modele);
    migrationsSimulees.push({
      versionSource: migration.versionSource,
      versionCible: migration.versionCible,
      version: migration.version,
      nom: migration.nom,
      simulable: true
    });
  });

  recalculerToutesFeuillesModeleMigration_(modele);

  return {
    reussie: true,
    modele: modele,
    versionInitiale: Number(versionSource) || 0,
    versionFinale: Number(versionCible) || 0,
    versionCible: Number(versionCible) || 0,
    chaineComplete: true,
    raison: '',
    migrations: migrationsSimulees,
    changementsStructure: changementsStructure
  };
}


function obtenirChaineMigrationsSimulation_(
  versionSource,
  versionCible,
  migrationsOptionnelles
) {
  const source = Math.max(0, Number(versionSource) || 0);
  const cible = Math.max(0, Number(versionCible) || 0);
  const migrations = (migrationsOptionnelles || MIGRATIONS_SCHEMA_)
    .slice();
  const chaine = [];

  if (source > cible) {
    return {
      complete: false,
      migrations: [],
      raison: 'Le schéma sauvegardé est plus récent que le schéma pris en charge.'
    };
  }

  for (let version = source + 1; version <= cible; version++) {
    const migration = migrations.find(function (element) {
      return (
        Number(element.versionSource) === version - 1 &&
        Number(element.versionCible) === version
      );
    });

    if (
      !migration ||
      migration.simulable !== true ||
      typeof migration.simuler !== 'function'
    ) {
      return {
        complete: false,
        migrations: chaine.map(resumerMigrationSimulation_),
        raison: 'La migration ' + (version - 1) + ' → ' +
          version + ' est absente ou non simulable.'
      };
    }

    chaine.push(migration);
  }

  return {
    complete: true,
    migrations: chaine,
    raison: ''
  };
}


function resumerMigrationSimulation_(migration) {
  return {
    versionSource: migration.versionSource,
    versionCible: migration.versionCible,
    version: migration.version,
    nom: migration.nom,
    simulable: migration.simulable === true
  };
}


function simulerMigration1StructureInitialeModele_(modele) {
  assurerStructureModeleMigration_(modele);
}


function simulerMigration2ValeursFormationsModele_(modele) {
  const feuille = modele.sheets && modele.sheets.FORMATIONS;

  if (!feuille || !feuille.exists || !feuille.rows.length) {
    return;
  }

  const index = creerIndexMigration_(feuille.headers);

  if (
    !Number.isInteger(index.ORDRE) ||
    !Number.isInteger(index.ACTIF)
  ) {
    return;
  }

  let ordreFormation = 0;

  feuille.rows.forEach(function (ligne) {
    if (!ligneRenseigneeModeleMigration_(ligne)) {
      return;
    }

    ordreFormation++;

    if (ligne[index.ORDRE] === '' || ligne[index.ORDRE] === null) {
      ligne[index.ORDRE] = ordreFormation;
    }

    if (ligne[index.ACTIF] === '' || ligne[index.ACTIF] === null) {
      ligne[index.ACTIF] = true;
    }
  });
}


function simulerMigration3CategoriesItemsReferentielModele_(modele) {
  const feuilleCategories = modele.sheets && modele.sheets.CATEGORIES;
  const feuilleItems = modele.sheets && modele.sheets.REFERENTIEL;

  if (
    !feuilleCategories ||
    !feuilleItems ||
    !feuilleCategories.exists ||
    !feuilleItems.exists ||
    !feuilleItems.rows.length
  ) {
    return;
  }

  const indexCategories = creerIndexMigration_(
    feuilleCategories.headers
  );
  const indexItems = creerIndexMigration_(feuilleItems.headers);

  if (
    !Number.isInteger(indexCategories.ID_CATEGORIE) ||
    !Number.isInteger(indexCategories.FORMATION) ||
    !Number.isInteger(indexCategories.CATEGORIE) ||
    !Number.isInteger(indexCategories.ORDRE) ||
    !Number.isInteger(indexCategories.ACTIF) ||
    !Number.isInteger(indexItems.ID_CATEGORIE) ||
    !Number.isInteger(indexItems.FORMATION)
  ) {
    return;
  }

  const categories = feuilleCategories.rows.map(function (ligne) {
    const idCategorie = String(
      ligne[indexCategories.ID_CATEGORIE] || ''
    ).trim();

    if (!idCategorie) {
      return null;
    }

    return {
      idCategorie: idCategorie,
      formation: String(
        ligne[indexCategories.FORMATION] || ''
      ).trim(),
      intitule: String(
        ligne[indexCategories.CATEGORIE] || ''
      ).trim()
    };
  }).filter(Boolean);
  const categoriesMigration = {};
  const idsUtilises = new Set(categories.map(function (categorie) {
    return categorie.idCategorie;
  }));

  feuilleItems.rows.forEach(function (ligne) {
    const formation = String(
      ligne[indexItems.FORMATION] || ''
    ).trim();
    const idCategorie = String(
      ligne[indexItems.ID_CATEGORIE] || ''
    ).trim();

    if (!formation || idCategorie) {
      return;
    }

    let categorieMigration = categoriesMigration[formation] ||
      categories.find(function (element) {
        return (
          element.formation === formation &&
          normaliserMigration_(element.intitule) ===
            'ITEMS_PEDAGOGIQUES'
        );
      });

    if (!categorieMigration) {
      const baseIdentifiant = 'SIM-CATEGORIE-' +
        normaliserMigration_(formation)
          .replace(/[^A-Z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48);
      let identifiant = baseIdentifiant || 'SIM-CATEGORIE';
      let suffixe = 1;

      while (idsUtilises.has(identifiant)) {
        suffixe++;
        identifiant = baseIdentifiant + '-' + suffixe;
      }

      idsUtilises.add(identifiant);
      categorieMigration = {
        idCategorie: identifiant,
        formation: formation,
        intitule: 'Items pédagogiques'
      };

      const ligneCategorie = new Array(
        feuilleCategories.headers.length
      ).fill('');
      const nombreCategoriesFormation = categories.filter(
        function (element) {
          return element.formation === formation;
        }
      ).length;

      ligneCategorie[indexCategories.ID_CATEGORIE] = identifiant;
      ligneCategorie[indexCategories.FORMATION] = formation;
      ligneCategorie[indexCategories.CATEGORIE] =
        categorieMigration.intitule;
      ligneCategorie[indexCategories.ORDRE] =
        nombreCategoriesFormation + 1;
      ligneCategorie[indexCategories.ACTIF] = 'Oui';
      feuilleCategories.rows.push(ligneCategorie);
      categories.push(categorieMigration);
    }

    categoriesMigration[formation] = categorieMigration;
    ligne[indexItems.ID_CATEGORIE] =
      categorieMigration.idCategorie;
  });
}


function simulerMigration4EnvoisIndemnisationsModele_(modele) {
  assurerStructureModeleMigration_(modele);

  const feuille = modele.sheets && modele.sheets.PARAMETRES;

  if (!feuille || !feuille.exists) {
    return;
  }

  const index = creerIndexMigration_(feuille.headers);

  if (!Number.isInteger(index.CLE) || !Number.isInteger(index.VALEUR)) {
    return;
  }

  const clesExistantes = new Set(
    feuille.rows.map(function (ligne) {
      return normaliserMigration_(ligne[index.CLE]);
    }).filter(Boolean)
  );

  PARAMETRES_EMAIL_INDEMNISATION_DEFAUT_.forEach(
    function (parametre) {
      if (clesExistantes.has(normaliserMigration_(parametre[0]))) {
        return;
      }

      const ligne = new Array(feuille.headers.length).fill('');
      ligne[index.CLE] = parametre[0];
      ligne[index.VALEUR] = parametre[1];

      if (Number.isInteger(index.ORDRE)) {
        ligne[index.ORDRE] = parametre[2];
      }

      if (Number.isInteger(index.ACTIF)) {
        ligne[index.ACTIF] = parametre[3];
      }

      feuille.rows.push(ligne);
      clesExistantes.add(normaliserMigration_(parametre[0]));
    }
  );
}


function simulerMigration5PdfIndemnisationsPhotosStagiairesModele_(modele) {
  assurerStructureModeleMigration_(modele);
}


function simulerMigration6FavorisModele_(modele) {
  assurerStructureModeleMigration_(modele);
}


function simulerMigration7ImportReferentielXlsxModele_(modele) {
  assurerStructureModeleMigration_(modele);
}


function assurerStructureModeleMigration_(modele) {
  modele.sheets = modele.sheets || {};
  const changements = [];

  SCHEMA_BASE_.forEach(function (configuration) {
    let feuille = modele.sheets[configuration.feuille];
    const colonnesAttendues = configuration.colonnes.map(
      obtenirNomColonneMigration_
    );

    if (!feuille || !feuille.exists) {
      feuille = {
        exists: true,
        headers: colonnesAttendues.slice(),
        rows: [],
        rowCount: 0,
        columnCount: colonnesAttendues.length,
        cellCount: colonnesAttendues.length,
        idColumn: String(configuration.identifiant || ''),
        identifiedRowCount: 0
      };
      modele.sheets[configuration.feuille] = feuille;
      changements.push({
        type: 'FEUILLE_AJOUTEE',
        feuille: configuration.feuille
      });
      return;
    }

    feuille.headers = Array.isArray(feuille.headers)
      ? feuille.headers.slice()
      : [];
    feuille.rows = Array.isArray(feuille.rows)
      ? feuille.rows.map(function (ligne) {
        return Array.isArray(ligne) ? ligne.slice() : [];
      })
      : [];

    const index = creerIndexMigration_(feuille.headers);
    const manquantes = colonnesAttendues.filter(function (colonne) {
      return !Number.isInteger(index[normaliserMigration_(colonne)]);
    });

    if (!manquantes.length) {
      recalculerFeuilleModeleMigration_(
        feuille,
        configuration
      );
      return;
    }

    const ancienneLongueur = feuille.headers.length;

    Array.prototype.push.apply(feuille.headers, manquantes);
    feuille.rows.forEach(function (ligne) {
      while (ligne.length < feuille.headers.length) {
        ligne.push('');
      }
    });

    initialiserColonnesModeleMigration_(
      feuille,
      configuration.feuille,
      manquantes,
      ancienneLongueur
    );
    recalculerFeuilleModeleMigration_(feuille, configuration);
    changements.push({
      type: 'COLONNES_AJOUTEES',
      feuille: configuration.feuille,
      colonnes: manquantes.slice()
    });
  });

  return changements;
}


function initialiserColonnesModeleMigration_(
  feuille,
  nomFeuille,
  colonnesAjoutees,
  premierePosition
) {
  if (nomFeuille !== 'FORMATIONS') {
    return;
  }

  let ordre = 0;

  feuille.rows.forEach(function (ligne) {
    if (!ligneRenseigneeModeleMigration_(
      ligne.slice(0, premierePosition)
    )) {
      return;
    }

    colonnesAjoutees.forEach(function (nom, position) {
      if (nom === 'ORDRE') {
        ordre++;
        ligne[premierePosition + position] = ordre;
      } else if (nom === 'ACTIF') {
        ligne[premierePosition + position] = true;
      }
    });
  });
}


function ecrireVersionSchemaModeleMigration_(modele, version) {
  const feuille = modele.sheets && modele.sheets.PARAMETRES;

  if (!feuille || !feuille.exists) {
    return;
  }

  const index = creerIndexMigration_(feuille.headers);
  const colonneCle = trouverIndexParNomsMigration_(
    index,
    ['CLE', 'TYPE', 'PARAMETRE']
  );
  const colonneValeur = trouverIndexParNomsMigration_(
    index,
    ['VALEUR', 'VALUE']
  );

  if (colonneCle === null || colonneValeur === null) {
    return;
  }

  for (let i = 0; i < feuille.rows.length; i++) {
    if (
      normaliserMigration_(feuille.rows[i][colonneCle]) ===
      CLE_VERSION_SCHEMA_
    ) {
      feuille.rows[i][colonneValeur] = version;
      return;
    }
  }

  const ligne = new Array(feuille.headers.length).fill('');
  ligne[colonneCle] = CLE_VERSION_SCHEMA_;
  ligne[colonneValeur] = version;

  if (Number.isInteger(index.ORDRE)) {
    ligne[index.ORDRE] = 9999;
  }

  if (Number.isInteger(index.ACTIF)) {
    ligne[index.ACTIF] = true;
  }

  feuille.rows.push(ligne);
}


function recalculerToutesFeuillesModeleMigration_(modele) {
  SCHEMA_BASE_.forEach(function (configuration) {
    const feuille = modele.sheets &&
      modele.sheets[configuration.feuille];

    if (feuille) {
      recalculerFeuilleModeleMigration_(
        feuille,
        configuration
      );
    }
  });
}


function recalculerFeuilleModeleMigration_(feuille, configuration) {
  feuille.exists = Boolean(feuille.exists);
  feuille.headers = Array.isArray(feuille.headers)
    ? feuille.headers
    : [];
  feuille.rows = Array.isArray(feuille.rows) ? feuille.rows : [];

  feuille.rows.forEach(function (ligne) {
    while (ligne.length < feuille.headers.length) {
      ligne.push('');
    }
  });

  feuille.rowCount = feuille.rows.length;
  feuille.columnCount = feuille.headers.length;
  feuille.cellCount =
    (feuille.rows.length + (feuille.exists ? 1 : 0)) *
    feuille.headers.length;
  feuille.idColumn = String(configuration.identifiant || '');

  const index = creerIndexMigration_(feuille.headers);
  const positionIdentifiant = feuille.idColumn
    ? index[normaliserMigration_(feuille.idColumn)]
    : null;

  feuille.identifiedRowCount = Number.isInteger(
    positionIdentifiant
  )
    ? feuille.rows.filter(function (ligne) {
      return String(ligne[positionIdentifiant] || '').trim() !== '';
    }).length
    : 0;
}


function ligneRenseigneeModeleMigration_(ligne) {
  return (ligne || []).some(function (valeur) {
    return valeur !== '' && valeur !== null;
  });
}


function clonerModeleMigration_(modele) {
  return JSON.parse(JSON.stringify(modele || { sheets: {} }));
}


function assurerStructureBase_(classeur) {
  const changements = [];

  SCHEMA_BASE_.forEach(function (configuration) {
    const resultat = assurerConfigurationFeuilleMigration_(
      classeur,
      configuration
    );

    Array.prototype.push.apply(
      changements,
      resultat.changements
    );
  });

  return changements;
}


function assurerFeuilleMigration_(classeur, nomFeuille) {
  const configuration = SCHEMA_BASE_.find(
    function (element) {
      return element.feuille === nomFeuille;
    }
  );

  if (!configuration) {
    throw new Error(
      'Aucun schéma de migration déclaré pour ' +
      nomFeuille + '.'
    );
  }

  return assurerConfigurationFeuilleMigration_(
    classeur,
    configuration
  ).feuille;
}


/**
 * Accès strictement en lecture : ne crée aucune feuille et n'ajoute aucune
 * colonne. Les consultations utilisent ce point d'entrée afin qu'une
 * restauration active ne puisse jamais déclencher une migration implicite.
 */
function obtenirFeuilleLecturePure_(
  classeur,
  nomFeuille,
  colonnesRequises
) {
  const feuille = classeur.getSheetByName(nomFeuille);

  if (!feuille || feuille.getLastRow() < 1 || feuille.getLastColumn() < 1) {
    throw new Error(
      'La feuille ' + nomFeuille +
      ' est absente ou non initialisée. Exécute les migrations avant de consulter ces données.'
    );
  }

  const configuration = SCHEMA_BASE_.find(function (element) {
    return element.feuille === nomFeuille;
  });
  const attendues = colonnesRequises || (
    configuration ? configuration.colonnes : []
  );
  const entetes = feuille
    .getRange(1, 1, 1, feuille.getLastColumn())
    .getValues()[0];
  const index = creerIndexMigration_(entetes);
  const manquantes = attendues.filter(function (colonne) {
    return !trouverColonneMigration_(index, colonne);
  });

  if (manquantes.length) {
    throw new Error(
      'La structure de ' + nomFeuille +
      ' est incomplète en lecture seule : ' + manquantes.join(', ') + '.'
    );
  }

  return feuille;
}


function assurerConfigurationFeuilleMigration_(
  classeur,
  configuration
) {
  const changements = [];
  let feuille = classeur.getSheetByName(
    configuration.feuille
  );

  if (!feuille) {
    feuille = classeur.insertSheet(configuration.feuille);
    changements.push({
      type: 'FEUILLE_AJOUTEE',
      feuille: configuration.feuille
    });
  }

  if (
    feuille.getLastRow() < 1 ||
    feuille.getLastColumn() < 1
  ) {
    const entetes = configuration.colonnes.map(
      obtenirNomColonneMigration_
    );

    feuille
      .getRange(1, 1, 1, entetes.length)
      .setValues([entetes])
      .setFontWeight('bold');
    feuille.setFrozenRows(1);

    changements.push({
      type: 'ENTETES_INITIALISEES',
      feuille: configuration.feuille,
      colonnes: entetes
    });

    return {
      feuille: feuille,
      changements: changements
    };
  }

  const entetesExistantes = feuille
    .getRange(1, 1, 1, feuille.getLastColumn())
    .getValues()[0];
  const index = creerIndexMigration_(entetesExistantes);
  const colonnesManquantes = configuration.colonnes.filter(
    function (colonne) {
      return !trouverColonneMigration_(index, colonne);
    }
  );

  if (!colonnesManquantes.length) {
    return {
      feuille: feuille,
      changements: changements
    };
  }

  const nomsManquants = colonnesManquantes.map(
    obtenirNomColonneMigration_
  );
  const premiereColonne = feuille.getLastColumn() + 1;

  feuille
    .getRange(
      1,
      premiereColonne,
      1,
      nomsManquants.length
    )
    .setValues([nomsManquants])
    .setFontWeight('bold');

  initialiserColonnesAjouteesMigration_(
    feuille,
    configuration.feuille,
    nomsManquants,
    premiereColonne
  );

  changements.push({
    type: 'COLONNES_AJOUTEES',
    feuille: configuration.feuille,
    colonnes: nomsManquants
  });

  return {
    feuille: feuille,
    changements: changements
  };
}


function initialiserColonnesAjouteesMigration_(
  feuille,
  nomFeuille,
  colonnesAjoutees,
  premiereColonne
) {
  if (
    nomFeuille !== 'FORMATIONS' ||
    feuille.getLastRow() < 2
  ) {
    return;
  }

  const nombreLignes = feuille.getLastRow() - 1;
  const nombreColonnesAvant = premiereColonne - 1;
  const donneesExistantes = feuille
    .getRange(2, 1, nombreLignes, nombreColonnesAvant)
    .getValues();
  let ordre = 0;

  colonnesAjoutees.forEach(function (nom, position) {
    if (!['ORDRE', 'ACTIF'].includes(nom)) {
      return;
    }

    const valeurs = donneesExistantes.map(function (ligne) {
      const ligneRenseignee = ligne.some(function (valeur) {
        return valeur !== '' && valeur !== null;
      });

      if (!ligneRenseignee) {
        return [''];
      }

      if (nom === 'ORDRE') {
        ordre++;
        return [ordre];
      }

      return [true];
    });

    feuille
      .getRange(
        2,
        premiereColonne + position,
        nombreLignes,
        1
      )
      .setValues(valeurs);
  });
}


function analyserStructureBase_(classeur) {
  const feuilles = SCHEMA_BASE_.map(function (configuration) {
    const feuille = classeur.getSheetByName(
      configuration.feuille
    );

    if (!feuille) {
      return {
        nom: configuration.feuille,
        existe: false,
        conforme: false,
        colonnesManquantes: configuration.colonnes.map(
          obtenirNomColonneMigration_
        ),
        nombreLignes: 0
      };
    }

    if (
      feuille.getLastRow() < 1 ||
      feuille.getLastColumn() < 1
    ) {
      return {
        nom: configuration.feuille,
        existe: true,
        conforme: false,
        colonnesManquantes: configuration.colonnes.map(
          obtenirNomColonneMigration_
        ),
        nombreLignes: 0
      };
    }

    const entetes = feuille
      .getRange(1, 1, 1, feuille.getLastColumn())
      .getValues()[0];
    const index = creerIndexMigration_(entetes);
    const manquantes = configuration.colonnes
      .filter(function (colonne) {
        return !trouverColonneMigration_(index, colonne);
      })
      .map(obtenirNomColonneMigration_);

    return {
      nom: configuration.feuille,
      existe: true,
      conforme: manquantes.length === 0,
      colonnesManquantes: manquantes,
      nombreLignes: Math.max(feuille.getLastRow() - 1, 0)
    };
  });

  return {
    conforme: feuilles.every(function (feuille) {
      return feuille.conforme;
    }),
    feuilles: feuilles
  };
}


function construireRapportIntegrite_(classeur) {
  const structure = analyserStructureBase_(classeur);
  const erreurs = [];
  const tables = {};

  structure.feuilles.forEach(function (feuille) {
    if (!feuille.existe) {
      ajouterErreurIntegrite_(erreurs, {
        type: 'FEUILLE_MANQUANTE',
        feuille: feuille.nom,
        message: 'La feuille ' + feuille.nom + ' est absente.'
      });
      return;
    }

    feuille.colonnesManquantes.forEach(function (colonne) {
      ajouterErreurIntegrite_(erreurs, {
        type: 'COLONNE_MANQUANTE',
        feuille: feuille.nom,
        colonne: colonne,
        message: 'La colonne ' + colonne + ' est absente.'
      });
    });
  });

  SCHEMA_BASE_.forEach(function (configuration) {
    const feuille = classeur.getSheetByName(
      configuration.feuille
    );

    if (
      !feuille ||
      feuille.getLastRow() < 1 ||
      feuille.getLastColumn() < 1
    ) {
      return;
    }

    const donnees = feuille.getDataRange().getValues();
    tables[configuration.feuille] = {
      donnees: donnees,
      index: creerIndexMigration_(donnees[0])
    };

    if (!configuration.identifiant) {
      return;
    }

    verifierDoublonsIdentifiants_(
      configuration,
      donnees,
      tables[configuration.feuille].index,
      erreurs
    );
  });

  obtenirReglesReferencesMigration_().forEach(
    function (regle) {
      verifierReferenceMigration_(tables, regle, erreurs);
    }
  );

  const version = lireVersionSchemaSansCreation_(classeur);
  const nombreErreursStructure = erreurs.filter(
    function (erreur) {
      return [
        'FEUILLE_MANQUANTE',
        'COLONNE_MANQUANTE'
      ].includes(erreur.type);
    }
  ).length;
  const nombreDoublons = erreurs.filter(function (erreur) {
    return erreur.type === 'IDENTIFIANT_DOUBLON';
  }).length;
  const nombreReferences = erreurs.filter(function (erreur) {
    return erreur.type === 'REFERENCE_INCOHERENTE';
  }).length;

  return {
    dateDiagnostic: Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'dd/MM/yyyy HH:mm:ss'
    ),
    versionSchema: version,
    versionCible: obtenirVersionSchemaCible_(),
    migrations: MIGRATIONS_SCHEMA_.map(function (migration) {
      return {
        version: migration.version,
        nom: migration.nom,
        executee: migration.version <= version
      };
    }),
    feuilles: structure.feuilles,
    erreurs: erreurs,
    limiteErreursAtteinte:
      erreurs.length >= LIMITE_ERREURS_INTEGRITE_,
    resume: {
      conforme: erreurs.length === 0,
      feuillesConformes: structure.feuilles.filter(
        function (feuille) {
          return feuille.conforme;
        }
      ).length,
      nombreFeuilles: structure.feuilles.length,
      erreursStructure: nombreErreursStructure,
      doublonsIdentifiants: nombreDoublons,
      referencesIncoherentes: nombreReferences,
      totalErreurs: erreurs.length
    }
  };
}


function verifierDoublonsIdentifiants_(
  configuration,
  donnees,
  index,
  erreurs
) {
  const colonne = index[configuration.identifiant];

  if (!Number.isInteger(colonne)) {
    return;
  }

  const occurrences = {};

  donnees.slice(1).forEach(function (ligne, position) {
    const ligneRenseignee = ligne.some(function (valeur) {
      return valeur !== '' && valeur !== null;
    });

    if (!ligneRenseignee) {
      return;
    }

    const valeur = String(ligne[colonne] || '').trim();

    if (!valeur) {
      ajouterErreurIntegrite_(erreurs, {
        type: 'IDENTIFIANT_MANQUANT',
        feuille: configuration.feuille,
        ligne: position + 2,
        colonne: configuration.identifiant,
        message: 'Identifiant absent à la ligne ' +
          (position + 2) + '.'
      });
      return;
    }

    if (!occurrences[valeur]) {
      occurrences[valeur] = [];
    }

    occurrences[valeur].push(position + 2);
  });

  Object.keys(occurrences).forEach(function (valeur) {
    if (occurrences[valeur].length < 2) {
      return;
    }

    ajouterErreurIntegrite_(erreurs, {
      type: 'IDENTIFIANT_DOUBLON',
      feuille: configuration.feuille,
      colonne: configuration.identifiant,
      valeur: valeur,
      lignes: occurrences[valeur],
      message: 'Identifiant dupliqué : ' + valeur +
        ' (lignes ' + occurrences[valeur].join(', ') + ').'
    });
  });
}


function obtenirReglesReferencesMigration_() {
  return [
    ['PRESENCES_STAGIAIRES', 'ID_SESSION', 'SESSIONS', 'ID_SESSION'],
    ['PRESENCES_STAGIAIRES', 'ID_STAGIAIRE', 'STAGIAIRES', 'UUID'],
    ['PRESTATIONS_FORMATEURS', 'ID_SESSION', 'SESSIONS', 'ID_SESSION'],
    ['PRESTATIONS_FORMATEURS', 'ID_FORMATEUR', 'FORMATEURS', 'ID_FORMATEUR'],
    ['EVALUATIONS', 'ID_SESSION', 'SESSIONS', 'ID_SESSION'],
    ['EVALUATIONS', 'ID_STAGIAIRE', 'STAGIAIRES', 'UUID'],
    ['EVALUATIONS', 'ID_ITEM', 'REFERENTIEL', 'ID_ITEM'],
    ['REFERENTIEL', 'ID_CATEGORIE', 'CATEGORIES', 'ID_CATEGORIE'],
    ['ITEMS_SESSIONS', 'ID_SESSION', 'SESSIONS', 'ID_SESSION'],
    ['ITEMS_SESSIONS', 'ID_ITEM', 'REFERENTIEL', 'ID_ITEM'],
    ['HISTORIQUE_INDEMNISATIONS', 'ID_PRESTATION', 'PRESTATIONS_FORMATEURS', 'ID_PRESTATION'],
    ['PRESTATIONS_FORMATEURS', 'ID_ENVOI', 'HISTORIQUE_ENVOIS_INDEMNISATIONS', 'ID_ENVOI'],
    ['STAGIAIRES', 'FORMATION', 'FORMATIONS', 'LIBELLE'],
    ['SESSIONS', 'FORMATION', 'FORMATIONS', 'LIBELLE'],
    ['CATEGORIES', 'FORMATION', 'FORMATIONS', 'LIBELLE'],
    ['REFERENTIEL', 'FORMATION', 'FORMATIONS', 'LIBELLE']
  ].map(function (regle) {
    return {
      feuilleSource: regle[0],
      colonneSource: regle[1],
      feuilleCible: regle[2],
      colonneCible: regle[3]
    };
  });
}


function verifierReferenceMigration_(tables, regle, erreurs) {
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

  const valeursCibles = new Set(
    cible.donnees.slice(1).map(function (ligne) {
      return String(ligne[colonneCible] || '').trim();
    }).filter(Boolean)
  );

  source.donnees.slice(1).forEach(function (ligne, position) {
    const valeur = String(ligne[colonneSource] || '').trim();

    if (!valeur || valeursCibles.has(valeur)) {
      return;
    }

    ajouterErreurIntegrite_(erreurs, {
      type: 'REFERENCE_INCOHERENTE',
      feuille: regle.feuilleSource,
      ligne: position + 2,
      colonne: regle.colonneSource,
      valeur: valeur,
      cible: regle.feuilleCible + '.' + regle.colonneCible,
      message: 'Référence ' + valeur + ' absente de ' +
        regle.feuilleCible + '.' + regle.colonneCible + '.'
    });
  });
}


function ajouterErreurIntegrite_(erreurs, erreur) {
  if (erreurs.length < LIMITE_ERREURS_INTEGRITE_) {
    erreurs.push(erreur);
  }
}


function construireRapportMigrations_(
  version,
  versionCible,
  migrationsExecutees,
  changementsStructure,
  structure
) {
  return {
    succes: true,
    versionSchema: version,
    versionCible: versionCible,
    migrationsExecutees: migrationsExecutees,
    changementsStructure: changementsStructure,
    structureConforme: structure.conforme,
    feuilles: structure.feuilles,
    message: migrationsExecutees.length ||
      changementsStructure.length
      ? 'Migrations exécutées avec succès.'
      : 'Le schéma est déjà à jour.'
  };
}


function obtenirVersionSchemaCible_() {
  return MIGRATIONS_SCHEMA_.reduce(function (maximum, migration) {
    return Math.max(maximum, migration.version);
  }, 0);
}


function lireVersionSchemaSansCreation_(classeur) {
  const feuille = classeur.getSheetByName('PARAMETRES');

  if (
    !feuille ||
    feuille.getLastRow() < 2 ||
    feuille.getLastColumn() < 1
  ) {
    return 0;
  }

  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexMigration_(donnees[0]);
  const colonnesCle = ['CLE', 'TYPE', 'PARAMETRE']
    .map(function (nom) {
      return trouverIndexParNomsMigration_(index, [nom]);
    })
    .filter(function (position) {
      return position !== null;
    });
  const colonneValeur = trouverIndexParNomsMigration_(
    index,
    ['VALEUR', 'VALUE']
  );

  if (!colonnesCle.length || colonneValeur === null) {
    return 0;
  }

  let version = 0;

  for (let i = 1; i < donnees.length; i++) {
    const ligneVersion = colonnesCle.some(function (colonneCle) {
      return normaliserMigration_(donnees[i][colonneCle]) ===
        CLE_VERSION_SCHEMA_;
    });

    if (ligneVersion) {
      version = Math.max(
        version,
        Number(donnees[i][colonneValeur]) || 0
      );
    }
  }

  return Math.max(0, version);
}


function lireVersionSchema_(classeur) {
  return lireVersionSchemaSansCreation_(classeur);
}


function ecrireVersionSchema_(classeur, version) {
  const feuille = classeur.getSheetByName('PARAMETRES');
  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexMigration_(donnees[0]);
  const colonneCle = trouverIndexParNomsMigration_(
    index,
    ['CLE']
  );
  const colonneValeur = trouverIndexParNomsMigration_(
    index,
    ['VALEUR', 'VALUE']
  );

  if (colonneCle === null || colonneValeur === null) {
    throw new Error(
      'PARAMETRES doit contenir les colonnes CLE et VALEUR.'
    );
  }

  for (let i = 1; i < donnees.length; i++) {
    if (
      normaliserMigration_(donnees[i][colonneCle]) ===
      CLE_VERSION_SCHEMA_
    ) {
      feuille.getRange(i + 1, colonneValeur + 1).setValue(version);
      return;
    }
  }

  const ligne = new Array(feuille.getLastColumn()).fill('');
  ligne[colonneCle] = CLE_VERSION_SCHEMA_;
  ligne[colonneValeur] = version;

  if (Number.isInteger(index.ORDRE)) {
    ligne[index.ORDRE] = 9999;
  }

  if (Number.isInteger(index.ACTIF)) {
    ligne[index.ACTIF] = true;
  }

  feuille.appendRow(ligne);
}


function obtenirNomColonneMigration_(colonne) {
  return typeof colonne === 'string' ? colonne : colonne.nom;
}


function trouverColonneMigration_(index, colonne) {
  const noms = [obtenirNomColonneMigration_(colonne)].concat(
    typeof colonne === 'string'
      ? []
      : (colonne.alias || [])
  );

  return noms.some(function (nom) {
    return Number.isInteger(index[normaliserMigration_(nom)]);
  });
}


function creerIndexMigration_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserMigration_(entete)] = position;
  });

  return index;
}


function trouverIndexParNomsMigration_(index, noms) {
  for (let i = 0; i < noms.length; i++) {
    const nom = normaliserMigration_(noms[i]);

    if (Number.isInteger(index[nom])) {
      return index[nom];
    }
  }

  return null;
}


function normaliserMigration_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
