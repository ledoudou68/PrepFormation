'use strict';

const NOM_FEUILLE_XLSX_REFERENTIEL_ = 'Référentiel SIS68';
const ENTETES_XLSX_REFERENTIEL_ = [
  'Type de formation',
  'Titre du chapitre',
  'Item',
  'Nature'
];
const MIME_XLSX_REFERENTIEL_ =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_GOOGLE_SHEETS_REFERENTIEL_ =
  'application/vnd.google-apps.spreadsheet';
const TAILLE_MAX_XLSX_REFERENTIEL_ = 5 * 1024 * 1024;
const DUREE_CACHE_IMPORT_REFERENTIEL_ = 30 * 60;
const TAILLE_BLOC_CACHE_IMPORT_REFERENTIEL_ = 80000;
const NOMBRE_MAX_BLOCS_CACHE_IMPORT_REFERENTIEL_ = 16;
const PREFIXE_CACHE_ANALYSE_IMPORT_REFERENTIEL_ =
  'IMPORT_REFERENTIEL_ANALYSE_';
const PREFIXE_CACHE_PLAN_IMPORT_REFERENTIEL_ =
  'IMPORT_REFERENTIEL_PLAN_';


/**
 * Convertit temporairement un XLSX privé, l'analyse, puis le met à la
 * corbeille. Aucun identifiant Drive n'est renvoyé au navigateur.
 */
function analyserFichierXlsxReferentiel(
  fichier,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  exigerEcritureAutorisee_();
  const entree = validerFichierXlsxReferentiel_(fichier);
  let fichierTemporaire = null;
  let idFichierTemporaire = '';

  try {
    const octets = Utilities.base64Decode(entree.base64);
    if (octets.length > TAILLE_MAX_XLSX_REFERENTIEL_) {
      throw new Error(
        'Le fichier dépasse la taille maximale autorisée de 5 Mo.'
      );
    }

    const blob = Utilities.newBlob(
      octets,
      MIME_XLSX_REFERENTIEL_,
      entree.nom
    );
    const dossier = obtenirDossierRacinePrepFormation_(true);
    const ressource = Drive.Files.create(
      {
        name: 'TEMP_IMPORT_REFERENTIEL_' + Utilities.getUuid(),
        mimeType: MIME_GOOGLE_SHEETS_REFERENTIEL_,
        parents: [dossier.getId()]
      },
      blob,
      { fields: 'id,name,mimeType' }
    );

    idFichierTemporaire = String(ressource.id || '');
    fichierTemporaire = DriveApp.getFileById(ressource.id);
    if (!fichierDriveEstPrive_(fichierTemporaire)) {
      throw new Error(
        'Le fichier temporaire n’est pas privé. Analyse annulée.'
      );
    }

    const classeurTemporaire = SpreadsheetApp.openById(ressource.id);
    const extraction = extraireValeursClasseurXlsxReferentiel_(
      classeurTemporaire
    );
    const analyse = analyserValeursXlsxReferentiel_(
      extraction.nomFeuille,
      extraction.valeurs,
      entree.nom,
      octets.length
    );
    const idAnalyse = Utilities.getUuid();

    memoriserObjetImportReferentiel_(
      PREFIXE_CACHE_ANALYSE_IMPORT_REFERENTIEL_,
      idAnalyse,
      analyse,
      session.identifiantHistorique
    );

    return construireReponseAnalyseImportReferentiel_(
      idAnalyse,
      analyse,
      lireFormationsActives_()
    );
  } finally {
    if (!fichierTemporaire && idFichierTemporaire) {
      try {
        fichierTemporaire = DriveApp.getFileById(idFichierTemporaire);
      } catch (erreurResolutionTemporaire) {
        fichierTemporaire = null;
      }
    }
    if (fichierTemporaire) {
      try {
        fichierTemporaire.setTrashed(true);
      } catch (erreurCorbeille) {
        throw new Error(
          'Le fichier a été analysé, mais son fichier temporaire n’a pas pu être placé dans la corbeille Drive : ' +
          String(erreurCorbeille.message || erreurCorbeille)
        );
      }
    } else if (idFichierTemporaire) {
      try {
        Drive.Files.update(
          { trashed: true },
          idFichierTemporaire
        );
      } catch (erreurCorbeilleApi) {
        throw new Error(
          'Le fichier temporaire n’a pas pu être placé dans la corbeille Drive : ' +
          String(erreurCorbeilleApi.message || erreurCorbeilleApi)
        );
      }
    }
  }
}


/**
 * Construit un plan de fusion en lecture seule. Cette fonction ne crée ni
 * catégorie ni item et n'écrit aucune correspondance.
 */
function previsualiserImportReferentiel(
  idAnalyse,
  correspondances,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);
  const analyse = lireObjetImportReferentiel_(
    PREFIXE_CACHE_ANALYSE_IMPORT_REFERENTIEL_,
    idAnalyse,
    session.identifiantHistorique
  );
  const formationsActives = lireFormationsActives_();
  const donnees = preparerDonneesReferentiel_(true);
  const categories = lireCategoriesReferentiel_(
    donnees.feuilleCategories
  );
  const items = lireItemsReferentiel_(donnees.feuilleItems);
  const plan = construirePlanFusionImportReferentiel_(
    analyse,
    correspondances,
    formationsActives,
    categories,
    items
  );
  const idPlan = Utilities.getUuid();

  memoriserObjetImportReferentiel_(
    PREFIXE_CACHE_PLAN_IMPORT_REFERENTIEL_,
    idPlan,
    {
      idAnalyse: String(idAnalyse || ''),
      correspondances: plan.correspondances,
      signaturePlan: calculerEmpreinteImportReferentiel_(plan),
      plan: plan
    },
    session.identifiantHistorique
  );

  return construireReponsePrevisualisationImportReferentiel_(
    idPlan,
    plan
  );
}


/**
 * Exécute uniquement le plan prévisualisé, après confirmation textuelle et
 * sauvegarde complète vérifiée. Toute erreur après le début des écritures
 * restaure les quatre feuilles capturées avant l'import.
 */
function importerReferentielXlsx(
  idPlan,
  confirmation,
  idsNaturesAConfirmer,
  jetonAdministrateur
) {
  const session = exigerAdministrateur_(jetonAdministrateur);

  if (String(confirmation || '').trim() !== 'IMPORTER') {
    throw new Error('Saisis exactement IMPORTER pour confirmer.');
  }

  const planMemorise = lireObjetImportReferentiel_(
    PREFIXE_CACHE_PLAN_IMPORT_REFERENTIEL_,
    idPlan,
    session.identifiantHistorique
  );

  return executerMutationMetier_(function () {
    const analyse = lireObjetImportReferentiel_(
      PREFIXE_CACHE_ANALYSE_IMPORT_REFERENTIEL_,
      planMemorise.idAnalyse,
      session.identifiantHistorique
    );
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const donnees = preparerDonneesReferentiel_();
    const categories = lireCategoriesReferentiel_(
      donnees.feuilleCategories
    );
    const items = lireItemsReferentiel_(donnees.feuilleItems);
    const planActuel = construirePlanFusionImportReferentiel_(
      analyse,
      planMemorise.correspondances,
      lireFormationsActives_(),
      categories,
      items
    );

    if (
      calculerEmpreinteImportReferentiel_(planActuel) !==
      planMemorise.signaturePlan
    ) {
      throw new Error(
        'Le référentiel ou les formations ont changé depuis la prévisualisation. Relance la prévisualisation avant d’importer.'
      );
    }

    const sauvegarde = creerSauvegardeCompleteInterne_(
      'Sauvegarde automatique avant import du référentiel « ' +
        analyse.nomFichier + ' »',
      TYPE_SAUVEGARDE_AVANT_OPERATION_ADMIN_,
      session,
      jetonAdministrateur,
      true
    );

    if (!sauvegarde || !sauvegarde.verificationIntegrite) {
      throw new Error(
        'La sauvegarde préalable n’a pas pu être vérifiée. Import annulé.'
      );
    }

    const feuilleHistorique = assurerFeuilleMigration_(
      classeur,
      'HISTORIQUE_IMPORTS_REFERENTIEL'
    );
    const feuilleAudit = assurerFeuilleMigration_(classeur, 'HISTORIQUE');
    const feuillesTransaction = [
      donnees.feuilleCategories,
      donnees.feuilleItems,
      feuilleHistorique,
      feuilleAudit
    ];
    const instantanes = feuillesTransaction.map(
      capturerEtatFeuilleImportReferentiel_
    );
    const idsConfirmes = new Set(
      (idsNaturesAConfirmer || []).map(String)
    );
    const idImport = Utilities.getUuid();
    let ecrituresCommencees = false;

    try {
      ecrituresCommencees = true;
      const resultat = appliquerPlanImportReferentiel_(
        planActuel,
        analyse,
        donnees.feuilleCategories,
        donnees.feuilleItems,
        feuilleHistorique,
        idsConfirmes,
        session,
        idImport
      );

      journaliserActionSensible_(
        'REFERENTIEL_IMPORT_XLSX',
        'REFERENTIEL',
        resultat.idImport,
        {
          nomFichier: analyse.nomFichier,
          sauvegardePrealable: sauvegarde.backupId,
          formationsTraitees: resultat.formationsTraitees,
          categoriesCreees: resultat.categoriesCreees,
          itemsCrees: resultat.itemsCrees,
          itemsExistants: resultat.itemsExistants,
          naturesRenseignees: resultat.naturesRenseignees,
          conflitsNatureConfirmes: resultat.conflitsNatureConfirmes,
          lignesIgnorees: resultat.lignesIgnorees,
          anomalies: resultat.anomalies
        },
        session.identifiantHistorique
      );

      SpreadsheetApp.flush();
      verifierResultatEcritImportReferentiel_(
        resultat,
        donnees.feuilleCategories,
        donnees.feuilleItems,
        feuilleHistorique
      );
      supprimerObjetImportReferentiel_(
        PREFIXE_CACHE_PLAN_IMPORT_REFERENTIEL_,
        idPlan
      );

      return resultat;
    } catch (erreurImport) {
      if (ecrituresCommencees) {
        try {
          instantanes.forEach(restaurerEtatFeuilleImportReferentiel_);
          SpreadsheetApp.flush();
        } catch (erreurRollback) {
          throw new Error(
            'L’import a échoué et le rollback automatique a également échoué. Utilise la sauvegarde ' +
            sauvegarde.backupId + ' avant toute nouvelle écriture. Erreur initiale : ' +
            String(erreurImport.message || erreurImport) +
            '. Erreur rollback : ' +
            String(erreurRollback.message || erreurRollback)
          );
        }
      }

      throw erreurImport;
    }
  });
}


function validerFichierXlsxReferentiel_(fichier) {
  if (!fichier || typeof fichier !== 'object') {
    throw new Error('Sélectionne un fichier Excel .xlsx.');
  }

  const nom = String(fichier.nom || fichier.name || '').trim();
  const type = String(fichier.type || '').trim();
  const taille = Number(fichier.taille || fichier.size || 0);
  const base64 = String(fichier.base64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .trim();

  if (!/\.xlsx$/i.test(nom)) {
    throw new Error('Seuls les fichiers .xlsx sont autorisés.');
  }
  if (type && type !== MIME_XLSX_REFERENTIEL_) {
    throw new Error('Le type MIME du fichier Excel est invalide.');
  }
  if (!base64 || !/^[A-Za-z0-9+/=_-]+$/.test(base64)) {
    throw new Error('Le contenu du fichier Excel est invalide.');
  }
  if (taille <= 0 || taille > TAILLE_MAX_XLSX_REFERENTIEL_) {
    throw new Error(
      'Le fichier doit être un .xlsx non vide de 5 Mo maximum.'
    );
  }

  return { nom: nom, type: type, taille: taille, base64: base64 };
}


function extraireValeursClasseurXlsxReferentiel_(classeur) {
  const feuilles = classeur.getSheets();
  if (!feuilles.length) {
    throw new Error('Le classeur Excel ne contient aucune feuille.');
  }

  let feuille = classeur.getSheetByName(
    NOM_FEUILLE_XLSX_REFERENTIEL_
  );

  if (!feuille) {
    feuille = feuilles[0];
    const valeursPremierOnglet = feuille.getDataRange().getDisplayValues();
    verifierEntetesXlsxReferentiel_(valeursPremierOnglet[0] || []);
    return {
      nomFeuille: feuille.getName(),
      valeurs: valeursPremierOnglet,
      feuilleRepli: true
    };
  }

  const valeurs = feuille.getDataRange().getDisplayValues();
  verifierEntetesXlsxReferentiel_(valeurs[0] || []);
  return {
    nomFeuille: feuille.getName(),
    valeurs: valeurs,
    feuilleRepli: false
  };
}


function verifierEntetesXlsxReferentiel_(entetes) {
  const presentes = (entetes || []).map(function (valeur) {
    return String(valeur || '').trim();
  });
  const manquantes = ENTETES_XLSX_REFERENTIEL_.filter(
    function (entete) {
      return presentes.indexOf(entete) === -1;
    }
  );

  if (manquantes.length) {
    throw new Error(
      'Colonnes obligatoires absentes du fichier Excel : ' +
      manquantes.join(', ') + '.'
    );
  }
}


function analyserValeursXlsxReferentiel_(
  nomFeuille,
  valeurs,
  nomFichier,
  tailleOctets
) {
  if (!Array.isArray(valeurs) || valeurs.length < 2) {
    throw new Error('Le fichier Excel ne contient aucune ligne de données.');
  }

  const entetes = valeurs[0].map(function (valeur) {
    return String(valeur || '').trim();
  });
  verifierEntetesXlsxReferentiel_(entetes);
  const index = {};
  ENTETES_XLSX_REFERENTIEL_.forEach(function (entete) {
    index[entete] = entetes.indexOf(entete);
  });

  const lignes = [];
  const anomalies = [];
  const doublons = new Set();
  let nombreLignes = 0;

  valeurs.slice(1).forEach(function (ligne, position) {
    const valeursTexte = ENTETES_XLSX_REFERENTIEL_.map(
      function (entete) {
        return String(ligne[index[entete]] || '').trim();
      }
    );

    if (!valeursTexte.some(Boolean)) {
      return;
    }

    nombreLignes++;
    const numeroLigne = position + 2;
    const typeFormation = valeursTexte[0];
    const chapitre = valeursTexte[1];
    const item = valeursTexte[2];
    const nature = normaliserNatureImportReferentiel_(valeursTexte[3]);
    const champsManquants = [];

    if (!typeFormation) champsManquants.push('Type de formation');
    if (!chapitre) champsManquants.push('Titre du chapitre');
    if (!item) champsManquants.push('Item');
    if (!valeursTexte[3]) champsManquants.push('Nature');

    if (champsManquants.length) {
      anomalies.push({
        ligne: numeroLigne,
        code: 'LIGNE_INCOMPLETE',
        typeFormation: typeFormation,
        message: 'Champ(s) obligatoire(s) vide(s) : ' +
          champsManquants.join(', ') + '.'
      });
      return;
    }

    if (!nature) {
      anomalies.push({
        ligne: numeroLigne,
        code: 'NATURE_INVALIDE',
        typeFormation: typeFormation,
        message: 'Nature invalide : « ' + valeursTexte[3] + ' ».'
      });
      return;
    }

    if ([typeFormation, chapitre, item].some(function (valeur) {
      return /^=/.test(valeur);
    })) {
      anomalies.push({
        ligne: numeroLigne,
        code: 'FORMULE_INTERDITE',
        typeFormation: typeFormation,
        message: 'Une valeur commençant par « = » ne peut pas être importée.'
      });
      return;
    }

    const cleDoublon = [
      typeFormation,
      chapitre,
      item,
      nature
    ].map(normaliserCleImportReferentiel_).join('|');

    if (doublons.has(cleDoublon)) {
      anomalies.push({
        ligne: numeroLigne,
        code: 'DOUBLON_FICHIER',
        typeFormation: typeFormation,
        message: 'Doublon exact déjà rencontré dans le fichier.'
      });
      return;
    }

    doublons.add(cleDoublon);
    lignes.push({
      numeroLigne: numeroLigne,
      typeFormation: typeFormation,
      chapitre: chapitre,
      item: item,
      nature: nature,
      ordreApparition: position + 1
    });
  });

  if (!nombreLignes) {
    throw new Error('Le fichier Excel ne contient aucune ligne de données.');
  }
  if (!lignes.length) {
    throw new Error(
      'Aucune ligne valide ne peut être importée. Corrige les anomalies du fichier.'
    );
  }

  const types = listeDistincteImportReferentiel_(lignes, 'typeFormation');
  const categories = new Set();
  let theories = 0;
  let techniques = 0;

  lignes.forEach(function (ligne) {
    categories.add(normaliserCleImportReferentiel_(ligne.chapitre));
    if (ligne.nature === 'Théorie') theories++;
    if (ligne.nature === 'Technique') techniques++;
  });

  return {
    nomFichier: String(nomFichier || ''),
    tailleOctets: Number(tailleOctets) || 0,
    nomFeuille: String(nomFeuille || ''),
    nombreLignes: nombreLignes,
    nombreLignesValides: lignes.length,
    nombreCategories: categories.size,
    nombreItems: lignes.length,
    theories: theories,
    techniques: techniques,
    typesFormation: types,
    anomalies: anomalies,
    lignes: lignes
  };
}


function construireReponseAnalyseImportReferentiel_(
  idAnalyse,
  analyse,
  formationsActives
) {
  return {
    idAnalyse: idAnalyse,
    nomFichier: analyse.nomFichier,
    nomFeuille: analyse.nomFeuille,
    tailleOctets: analyse.tailleOctets,
    nombreLignes: analyse.nombreLignes,
    nombreLignesValides: analyse.nombreLignesValides,
    nombreCategories: analyse.nombreCategories,
    nombreItems: analyse.nombreItems,
    theories: analyse.theories,
    techniques: analyse.techniques,
    typesFormation: analyse.typesFormation.slice(),
    formationsActives: formationsActives.slice(),
    anomalies: analyse.anomalies.slice()
  };
}


function construirePlanFusionImportReferentiel_(
  analyse,
  correspondances,
  formationsActives,
  categoriesExistantes,
  itemsExistants
) {
  const correspondancesValidees =
    validerCorrespondancesImportReferentiel_(
      analyse.typesFormation,
      correspondances,
      formationsActives
    );
  const categories = (categoriesExistantes || []).map(function (categorie) {
    return Object.assign({}, categorie);
  });
  const items = (itemsExistants || []).map(function (item) {
    return Object.assign({}, item);
  });
  const categoriesParCle = {};
  const itemsParCle = {};
  const ordreCategorieMax = {};
  const ordreItemMax = {};

  categories.forEach(function (categorie) {
    const formationCle = normaliserCleImportReferentiel_(categorie.formation);
    const cle = formationCle + '|' +
      normaliserCleImportReferentiel_(categorie.intitule);
    if (!categoriesParCle[cle]) categoriesParCle[cle] = categorie;
    ordreCategorieMax[formationCle] = Math.max(
      ordreCategorieMax[formationCle] || 0,
      Number(categorie.ordre) || 0
    );
  });

  items.forEach(function (item) {
    const cle = normaliserCleImportReferentiel_(item.formation) + '|' +
      normaliserCleImportReferentiel_(item.intitule);
    if (!itemsParCle[cle]) itemsParCle[cle] = item;
    const categorieCle = String(item.idCategorie || '');
    ordreItemMax[categorieCle] = Math.max(
      ordreItemMax[categorieCle] || 0,
      Number(item.ordre) || 0
    );
  });

  const categoriesACreer = [];
  const categoriesReutilisees = [];
  const itemsACreer = [];
  const itemsIdentiques = [];
  const naturesACompleter = [];
  const conflitsNature = [];
  const lignesIgnorees = [];
  const categoriesReutiliseesVues = new Set();
  const itemsVusDansPlan = new Set();
  const lignesParFormation = {};

  analyse.lignes.forEach(function (ligne) {
    const mapping = correspondancesValidees.find(function (element) {
      return element.source === ligne.typeFormation;
    });

    if (!mapping || mapping.ignore) {
      lignesIgnorees.push({
        ligne: ligne.numeroLigne,
        motif: 'Type de formation ignoré',
        typeFormation: ligne.typeFormation
      });
      return;
    }

    const formation = mapping.cible;
    const formationCle = normaliserCleImportReferentiel_(formation);
    lignesParFormation[formation] = (lignesParFormation[formation] || 0) + 1;
    const cleCategorie = formationCle + '|' +
      normaliserCleImportReferentiel_(ligne.chapitre);
    let categorie = categoriesParCle[cleCategorie];

    if (!categorie) {
      ordreCategorieMax[formationCle] =
        (ordreCategorieMax[formationCle] || 0) + 1;
      categorie = {
        nouvelle: true,
        cleImport: cleCategorie,
        formation: formation,
        intitule: ligne.chapitre,
        ordre: ordreCategorieMax[formationCle],
        actif: true
      };
      categoriesParCle[cleCategorie] = categorie;
      categoriesACreer.push(categorie);
    } else if (!categorie.nouvelle && !categoriesReutiliseesVues.has(cleCategorie)) {
      categoriesReutiliseesVues.add(cleCategorie);
      categoriesReutilisees.push({
        idCategorie: categorie.idCategorie,
        formation: formation,
        intitule: categorie.intitule
      });
    }

    const cleItem = formationCle + '|' +
      normaliserCleImportReferentiel_(ligne.item);

    if (itemsVusDansPlan.has(cleItem)) {
      lignesIgnorees.push({
        ligne: ligne.numeroLigne,
        motif: 'Item déjà traité pour cette formation cible',
        formation: formation,
        item: ligne.item
      });
      return;
    }
    itemsVusDansPlan.add(cleItem);

    const itemExistant = itemsParCle[cleItem];
    if (itemExistant) {
      const natureExistante = normaliserNatureImportReferentiel_(
        itemExistant.nature
      );
      itemsIdentiques.push({
        idItem: itemExistant.idItem,
        formation: formation,
        intitule: itemExistant.intitule,
        nature: itemExistant.nature || ''
      });
      if (!String(itemExistant.nature || '').trim()) {
        naturesACompleter.push({
          idItem: itemExistant.idItem,
          formation: formation,
          intitule: itemExistant.intitule,
          nature: ligne.nature
        });
      } else if (natureExistante !== ligne.nature) {
        conflitsNature.push({
          idItem: itemExistant.idItem,
          formation: formation,
          intitule: itemExistant.intitule,
          natureExistante: itemExistant.nature,
          natureImportee: ligne.nature
        });
      }
      return;
    }

    const cleOrdreCategorie = categorie.nouvelle
      ? 'NOUVELLE:' + categorie.cleImport
      : String(categorie.idCategorie || '');
    ordreItemMax[cleOrdreCategorie] =
      (ordreItemMax[cleOrdreCategorie] || 0) + 1;
    itemsACreer.push({
      formation: formation,
      cleCategorie: categorie.nouvelle ? categorie.cleImport : '',
      idCategorie: categorie.nouvelle ? '' : categorie.idCategorie,
      intitule: ligne.item,
      nature: ligne.nature,
      ordre: ordreItemMax[cleOrdreCategorie],
      actif: true,
      numeroLigneSource: ligne.numeroLigne
    });
  });

  const plan = {
    mode: 'FUSION',
    nomFichier: analyse.nomFichier,
    nombreLignes: analyse.nombreLignes,
    correspondances: correspondancesValidees,
    formationsTraitees: Object.keys(lignesParFormation),
    lignesParFormation: lignesParFormation,
    categoriesACreer: categoriesACreer,
    categoriesReutilisees: categoriesReutilisees,
    itemsACreer: itemsACreer,
    itemsIdentiques: itemsIdentiques,
    naturesACompleter: naturesACompleter,
    conflitsNature: conflitsNature,
    lignesIgnorees: lignesIgnorees,
    anomalies: analyse.anomalies.slice()
  };
  plan.detailsFormations = construireDetailsFormationsImportReferentiel_(plan);
  return plan;
}


function construireDetailsFormationsImportReferentiel_(plan) {
  return plan.formationsTraitees.map(function (formation) {
    const sources = plan.correspondances.filter(function (mapping) {
      return !mapping.ignore && mapping.cible === formation;
    }).map(function (mapping) {
      return mapping.source;
    });
    const sourceSet = new Set(sources);

    return {
      formation: formation,
      sources: sources,
      nombreLignes: plan.lignesParFormation[formation] || 0,
      categoriesACreer: plan.categoriesACreer.filter(function (element) {
        return element.formation === formation;
      }).length,
      categoriesReutilisees: plan.categoriesReutilisees.filter(
        function (element) {
          return element.formation === formation;
        }
      ).length,
      itemsACreer: plan.itemsACreer.filter(function (element) {
        return element.formation === formation;
      }).length,
      itemsExistants: plan.itemsIdentiques.filter(function (element) {
        return element.formation === formation;
      }).length,
      naturesACompleter: plan.naturesACompleter.filter(function (element) {
        return element.formation === formation;
      }).length,
      conflitsNature: plan.conflitsNature.filter(function (element) {
        return element.formation === formation;
      }).length,
      lignesIgnorees: plan.lignesIgnorees.filter(function (element) {
        return element.formation === formation ||
          sourceSet.has(element.typeFormation);
      }).length,
      anomalies: plan.anomalies.filter(function (anomalie) {
        return sourceSet.has(anomalie.typeFormation);
      }).length
    };
  });
}


function validerCorrespondancesImportReferentiel_(
  typesSource,
  correspondances,
  formationsActives
) {
  const types = (typesSource || []).slice();
  const formations = new Set((formationsActives || []).map(String));
  const recus = Array.isArray(correspondances) ? correspondances : [];

  return types.map(function (source) {
    const correspondance = recus.find(function (element) {
      return String(element && element.source || '') === source;
    });

    if (!correspondance) {
      throw new Error(
        'Choisis une correspondance ou « Ignorer » pour « ' + source + ' ».'
      );
    }

    const ignore = Boolean(correspondance.ignore);
    const cible = String(correspondance.cible || '').trim();
    if (!ignore && !cible) {
      throw new Error(
        'Aucune formation cible n’est sélectionnée pour « ' + source + ' ».'
      );
    }
    if (!ignore && !formations.has(cible)) {
      throw new Error(
        'La formation cible « ' + cible + ' » est absente ou inactive.'
      );
    }

    return { source: source, cible: ignore ? '' : cible, ignore: ignore };
  });
}


function construireReponsePrevisualisationImportReferentiel_(idPlan, plan) {
  return {
    idPlan: idPlan,
    mode: plan.mode,
    correspondances: plan.correspondances,
    formationsTraitees: plan.formationsTraitees,
    lignesParFormation: plan.lignesParFormation,
    detailsFormations: plan.detailsFormations,
    categoriesACreer: plan.categoriesACreer,
    categoriesReutilisees: plan.categoriesReutilisees,
    itemsACreer: plan.itemsACreer,
    itemsIdentiques: plan.itemsIdentiques,
    naturesACompleter: plan.naturesACompleter,
    conflitsNature: plan.conflitsNature,
    lignesIgnorees: plan.lignesIgnorees,
    anomalies: plan.anomalies,
    totaux: {
      formations: plan.formationsTraitees.length,
      categoriesACreer: plan.categoriesACreer.length,
      categoriesReutilisees: plan.categoriesReutilisees.length,
      itemsACreer: plan.itemsACreer.length,
      itemsExistants: plan.itemsIdentiques.length,
      naturesACompleter: plan.naturesACompleter.length,
      conflitsNature: plan.conflitsNature.length,
      lignesIgnorees: plan.lignesIgnorees.length,
      anomalies: plan.anomalies.length
    }
  };
}


function appliquerPlanImportReferentiel_(
  plan,
  analyse,
  feuilleCategories,
  feuilleItems,
  feuilleHistorique,
  idsNaturesAConfirmer,
  session,
  idImport
) {
  const donneesCategories = lireMatriceAvecFormulesImportReferentiel_(
    feuilleCategories
  );
  const donneesItems = lireMatriceAvecFormulesImportReferentiel_(feuilleItems);
  const indexCategories = creerIndexReferentiel_(donneesCategories[0]);
  const indexItems = creerIndexReferentiel_(donneesItems[0]);
  const idsCategories = {};
  const idsCategoriesCrees = [];
  const idsItemsCrees = [];
  const naturesAttendues = {};
  let conflitsNatureConfirmes = 0;

  plan.categoriesACreer.forEach(function (categorie) {
    const idCategorie = Utilities.getUuid();
    const ligne = new Array(donneesCategories[0].length).fill('');
    ligne[indexCategories.ID_CATEGORIE] = idCategorie;
    ligne[indexCategories.FORMATION] = categorie.formation;
    ligne[indexCategories.CATEGORIE] = categorie.intitule;
    ligne[indexCategories.ORDRE] = categorie.ordre;
    ligne[indexCategories.ACTIF] = 'Oui';
    donneesCategories.push(ligne);
    idsCategories[categorie.cleImport] = idCategorie;
    idsCategoriesCrees.push(idCategorie);
  });

  plan.itemsACreer.forEach(function (item) {
    const idItem = Utilities.getUuid();
    const ligne = new Array(donneesItems[0].length).fill('');
    ligne[indexItems.ID_ITEM] = idItem;
    ligne[indexItems.FORMATION] = item.formation;
    ligne[indexItems.ID_CATEGORIE] = item.idCategorie ||
      idsCategories[item.cleCategorie];
    ligne[indexItems.ITEM] = item.intitule;
    ligne[indexItems.DESCRIPTION] = '';
    ligne[indexItems.ORDRE] = item.ordre;
    ligne[indexItems.ACTIF] = 'Oui';
    ligne[indexItems.NATURE] = item.nature;
    donneesItems.push(ligne);
    idsItemsCrees.push(idItem);
    naturesAttendues[idItem] = item.nature;
  });

  const naturesParId = {};
  plan.naturesACompleter.forEach(function (element) {
    naturesParId[element.idItem] = element.nature;
  });
  plan.conflitsNature.forEach(function (element) {
    if (idsNaturesAConfirmer.has(element.idItem)) {
      naturesParId[element.idItem] = element.natureImportee;
      conflitsNatureConfirmes++;
    }
  });

  donneesItems.slice(1).forEach(function (ligne) {
    const idItem = String(ligne[indexItems.ID_ITEM] || '');
    if (naturesParId[idItem]) {
      ligne[indexItems.NATURE] = naturesParId[idItem];
      naturesAttendues[idItem] = naturesParId[idItem];
    }
  });

  ecrireMatriceImportReferentiel_(feuilleCategories, donneesCategories);
  ecrireMatriceImportReferentiel_(feuilleItems, donneesItems);

  const donneesHistorique = lireMatriceAvecFormulesImportReferentiel_(
    feuilleHistorique
  );
  const indexHistorique = creerIndexReferentiel_(donneesHistorique[0]);
  const ligneHistorique = new Array(donneesHistorique[0].length).fill('');
  const maintenant = new Date();
  ligneHistorique[indexHistorique.ID_IMPORT] = idImport;
  ligneHistorique[indexHistorique.DATE_IMPORT] = maintenant;
  ligneHistorique[indexHistorique.NOM_FICHIER] = analyse.nomFichier;
  ligneHistorique[indexHistorique.NOMBRE_LIGNES] = analyse.nombreLignes;
  ligneHistorique[indexHistorique.CATEGORIES_CREEES] =
    plan.categoriesACreer.length;
  ligneHistorique[indexHistorique.ITEMS_CREES] = plan.itemsACreer.length;
  ligneHistorique[indexHistorique.ITEMS_EXISTANTS] =
    plan.itemsIdentiques.length;
  ligneHistorique[indexHistorique.LIGNES_IGNOREES] =
    plan.lignesIgnorees.length;
  ligneHistorique[indexHistorique.ANOMALIES] = plan.anomalies.length;
  ligneHistorique[indexHistorique.SESSION_ADMIN] =
    session.identifiantHistorique;
  ligneHistorique[indexHistorique.DATE_CREATION] = maintenant;
  donneesHistorique.push(ligneHistorique);
  ecrireMatriceImportReferentiel_(feuilleHistorique, donneesHistorique);

  return {
    succes: true,
    message: 'Import terminé',
    idImport: idImport,
    formationsTraitees: plan.formationsTraitees.length,
    formations: plan.formationsTraitees.slice(),
    categoriesCreees: plan.categoriesACreer.length,
    categoriesReutilisees: plan.categoriesReutilisees.length,
    itemsCrees: plan.itemsACreer.length,
    itemsExistants: plan.itemsIdentiques.length,
    naturesRenseignees: plan.naturesACompleter.length +
      conflitsNatureConfirmes,
    conflitsNatureConfirmes: conflitsNatureConfirmes,
    lignesIgnorees: plan.lignesIgnorees.length,
    anomalies: plan.anomalies.length,
    idsCategoriesCrees: idsCategoriesCrees,
    idsItemsCrees: idsItemsCrees,
    naturesAttendues: naturesAttendues
  };
}


function verifierResultatEcritImportReferentiel_(
  resultat,
  feuilleCategories,
  feuilleItems,
  feuilleHistorique
) {
  const idsCategories = new Set(
    lireCategoriesReferentiel_(feuilleCategories).map(function (element) {
      return element.idCategorie;
    })
  );
  const items = lireItemsReferentiel_(feuilleItems);
  const itemsParId = {};
  items.forEach(function (item) {
    itemsParId[item.idItem] = item;
  });

  resultat.idsCategoriesCrees.forEach(function (idCategorie) {
    if (!idsCategories.has(idCategorie)) {
      throw new Error(
        'Validation après écriture impossible : catégorie créée introuvable.'
      );
    }
  });
  resultat.idsItemsCrees.forEach(function (idItem) {
    if (!itemsParId[idItem]) {
      throw new Error(
        'Validation après écriture impossible : item créé introuvable.'
      );
    }
  });
  Object.keys(resultat.naturesAttendues).forEach(function (idItem) {
    if (
      !itemsParId[idItem] ||
      itemsParId[idItem].nature !== resultat.naturesAttendues[idItem]
    ) {
      throw new Error(
        'Validation après écriture impossible : Nature incohérente pour l’item ' +
        idItem + '.'
      );
    }
  });

  const donneesHistorique = feuilleHistorique.getDataRange().getValues();
  const index = creerIndexReferentiel_(donneesHistorique[0]);
  const historiquePresent = donneesHistorique.slice(1).some(function (ligne) {
    return String(ligne[index.ID_IMPORT] || '') === resultat.idImport;
  });
  if (!historiquePresent) {
    throw new Error(
      'Validation après écriture impossible : historique d’import absent.'
    );
  }

  delete resultat.idsCategoriesCrees;
  delete resultat.idsItemsCrees;
  delete resultat.naturesAttendues;
}


function ecrireMatriceImportReferentiel_(feuille, matrice) {
  if (!Array.isArray(matrice) || !matrice.length || !matrice[0].length) {
    throw new Error('Matrice d’import invalide pour ' + feuille.getName() + '.');
  }
  feuille.getRange(1, 1, matrice.length, matrice[0].length).setValues(matrice);
}


function capturerEtatFeuilleImportReferentiel_(feuille) {
  return {
    feuille: feuille,
    matrice: lireMatriceAvecFormulesImportReferentiel_(feuille)
  };
}


function lireMatriceAvecFormulesImportReferentiel_(feuille) {
  const plage = feuille.getDataRange();
  const valeurs = plage.getValues();
  const formules = plage.getFormulas();
  return valeurs.map(function (ligne, numeroLigne) {
    return ligne.map(function (valeur, numeroColonne) {
      return formules[numeroLigne][numeroColonne] || valeur;
    });
  });
}


function restaurerEtatFeuilleImportReferentiel_(instantane) {
  const feuille = instantane.feuille;
  const utilisee = feuille.getDataRange();
  utilisee.clearContent();
  if (instantane.matrice.length && instantane.matrice[0].length) {
    feuille
      .getRange(
        1,
        1,
        instantane.matrice.length,
        instantane.matrice[0].length
      )
      .setValues(instantane.matrice);
  }
}


function memoriserObjetImportReferentiel_(
  prefixe,
  identifiant,
  objet,
  identifiantSession
) {
  const cache = CacheService.getScriptCache();
  const contenu = JSON.stringify({
    session: String(identifiantSession || ''),
    expireA: Date.now() + DUREE_CACHE_IMPORT_REFERENTIEL_ * 1000,
    objet: objet
  });
  const blocs = [];
  for (let i = 0; i < contenu.length; i += TAILLE_BLOC_CACHE_IMPORT_REFERENTIEL_) {
    blocs.push(contenu.slice(i, i + TAILLE_BLOC_CACHE_IMPORT_REFERENTIEL_));
  }
  if (blocs.length > NOMBRE_MAX_BLOCS_CACHE_IMPORT_REFERENTIEL_) {
    throw new Error('Le référentiel analysé est trop volumineux pour être traité en une fois.');
  }
  const cle = prefixe + String(identifiant || '');
  blocs.forEach(function (bloc, position) {
    cache.put(
      cle + '_BLOC_' + position,
      bloc,
      DUREE_CACHE_IMPORT_REFERENTIEL_
    );
  });
  cache.put(
    cle + '_META',
    JSON.stringify({
      blocs: blocs.length,
      empreinte: calculerEmpreinteImportReferentiel_(contenu)
    }),
    DUREE_CACHE_IMPORT_REFERENTIEL_
  );
}


function lireObjetImportReferentiel_(
  prefixe,
  identifiant,
  identifiantSession
) {
  const cache = CacheService.getScriptCache();
  const cle = prefixe + String(identifiant || '');
  const metaTexte = cache.get(cle + '_META');
  if (!metaTexte) {
    throw new Error(
      'Cette analyse a expiré. Relance l’analyse du fichier Excel.'
    );
  }
  const meta = JSON.parse(metaTexte);
  let contenu = '';
  for (let i = 0; i < Number(meta.blocs || 0); i++) {
    const bloc = cache.get(cle + '_BLOC_' + i);
    if (bloc === null) {
      throw new Error(
        'Cette analyse est incomplète ou a expiré. Relance l’analyse.'
      );
    }
    contenu += bloc;
  }
  if (calculerEmpreinteImportReferentiel_(contenu) !== meta.empreinte) {
    throw new Error('Les données temporaires de l’analyse sont altérées.');
  }
  const enveloppe = JSON.parse(contenu);
  if (
    enveloppe.session !== String(identifiantSession || '') ||
    Number(enveloppe.expireA || 0) <= Date.now()
  ) {
    throw new Error(
      'Cette analyse n’appartient plus à la session administrateur active.'
    );
  }
  return enveloppe.objet;
}


function supprimerObjetImportReferentiel_(prefixe, identifiant) {
  const cache = CacheService.getScriptCache();
  const cle = prefixe + String(identifiant || '');
  const metaTexte = cache.get(cle + '_META');
  if (!metaTexte) return;
  const meta = JSON.parse(metaTexte);
  const cles = [cle + '_META'];
  for (let i = 0; i < Number(meta.blocs || 0); i++) {
    cles.push(cle + '_BLOC_' + i);
  }
  cache.removeAll(cles);
}


function calculerEmpreinteImportReferentiel_(valeur) {
  const texte = typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      texte,
      Utilities.Charset.UTF_8
    )
  );
}


function normaliserNatureImportReferentiel_(valeur) {
  const texte = String(valeur || '').trim();
  if (texte === 'Théorie') return 'Théorie';
  if (texte === 'Technique') return 'Technique';
  return '';
}


function normaliserCleImportReferentiel_(valeur) {
  return String(valeur || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}


function listeDistincteImportReferentiel_(lignes, propriete) {
  const vues = new Set();
  const resultat = [];
  (lignes || []).forEach(function (ligne) {
    const valeur = String(ligne[propriete] || '');
    const cle = normaliserCleImportReferentiel_(valeur);
    if (cle && !vues.has(cle)) {
      vues.add(cle);
      resultat.push(valeur);
    }
  });
  return resultat;
}
