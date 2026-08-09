'use strict';

const TYPES_FAVORIS_AUTORISES_ = [
  'STAGIAIRE',
  'FORMATEUR',
  'SESSION',
  'FORMATION',
  'ITEM'
];

const COLONNES_FAVORIS_ = [
  'ID_FAVORI',
  'TYPE',
  'IDENTIFIANT',
  'LIBELLE',
  'SOUS_LIBELLE',
  'UTILISATEUR_CLE',
  'DATE_CREATION'
];


/**
 * Pour un formateur authentifié, la clé de stockage est déterminée
 * exclusivement depuis sa session serveur. La clé locale reste utilisée
 * pour l'administrateur et pour une migration volontaire des anciens favoris.
 */
function getFavoris(utilisateurCle, jetonUtilisateur) {
  const session = exigerUtilisateurAuthentifie_(jetonUtilisateur);
  const cle = resoudreCleProprietaireFavoris_(session, utilisateurCle);
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tableFavoris = lireTableFavoris_(classeur, 'FAVORIS', true);
  const lignes = tableFavoris.lignes.filter(function (ligne) {
    return valeurFavoris_(tableFavoris, ligne, 'UTILISATEUR_CLE') === cle;
  });

  if (!lignes.length) {
    return [];
  }

  const typesNecessaires = new Set(lignes.map(function (ligne) {
    return normaliserTypeFavori_(
      valeurFavoris_(tableFavoris, ligne, 'TYPE')
    );
  }).filter(Boolean));
  const indexObjets = construireIndexObjetsFavoris_(
    classeur,
    typesNecessaires
  );

  return lignes.map(function (ligne) {
    const type = normaliserTypeFavori_(
      valeurFavoris_(tableFavoris, ligne, 'TYPE')
    );
    const identifiant = valeurFavoris_(
      tableFavoris,
      ligne,
      'IDENTIFIANT'
    );
    const objet = indexObjets[type + ':' + identifiant] || null;

    return construireFavoriPublic_(
      {
        idFavori: valeurFavoris_(tableFavoris, ligne, 'ID_FAVORI'),
        type: type,
        identifiant: identifiant,
        libelle: valeurFavoris_(tableFavoris, ligne, 'LIBELLE'),
        sousLibelle: valeurFavoris_(
          tableFavoris,
          ligne,
          'SOUS_LIBELLE'
        ),
        dateCreation: valeurBruteFavoris_(
          tableFavoris,
          ligne,
          'DATE_CREATION'
        )
      },
      objet
    );
  }).sort(function (a, b) {
    return String(b.dateCreation || '').localeCompare(
      String(a.dateCreation || '')
    ) || String(a.idFavori).localeCompare(String(b.idFavori));
  });
}


function ajouterFavori(
  type,
  identifiant,
  utilisateurCle,
  jetonUtilisateur
) {
  const session = exigerUtilisateurAuthentifie_(jetonUtilisateur);
  const typeValide = validerTypeFavori_(type);
  const idValide = validerIdentifiantFavori_(identifiant);
  const cle = resoudreCleProprietaireFavoris_(session, utilisateurCle);

  return executerMutationMetier_(function () {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const tableFavoris = lireTableFavoris_(classeur, 'FAVORIS', true);
    const existant = trouverLigneFavori_(
      tableFavoris,
      typeValide,
      idValide,
      cle
    );

    if (existant) {
      const objetExistant = trouverObjetFavori_(
        classeur,
        typeValide,
        idValide
      );
      return construireFavoriPublic_(
        extraireFavoriStocke_(tableFavoris, existant.ligne),
        objetExistant
      );
    }

    const objet = trouverObjetFavori_(classeur, typeValide, idValide);
    if (!objet) {
      throw new Error('Impossible d’ajouter ce favori : objet introuvable.');
    }

    const dateCreation = new Date();
    const favori = {
      idFavori: Utilities.getUuid(),
      type: typeValide,
      identifiant: idValide,
      libelle: objet.libelle,
      sousLibelle: objet.sousLibelle,
      dateCreation: dateCreation
    };
    const ligne = new Array(tableFavoris.feuille.getLastColumn()).fill('');

    ligne[tableFavoris.index.ID_FAVORI] = favori.idFavori;
    ligne[tableFavoris.index.TYPE] = favori.type;
    ligne[tableFavoris.index.IDENTIFIANT] = favori.identifiant;
    ligne[tableFavoris.index.LIBELLE] = favori.libelle;
    ligne[tableFavoris.index.SOUS_LIBELLE] = favori.sousLibelle;
    ligne[tableFavoris.index.UTILISATEUR_CLE] = cle;
    ligne[tableFavoris.index.DATE_CREATION] = dateCreation;

    tableFavoris.feuille
      .getRange(
        tableFavoris.feuille.getLastRow() + 1,
        1,
        1,
        ligne.length
      )
      .setValues([ligne]);

    journaliserActionSensible_(
      'FAVORI_AJOUT',
      typeValide,
      idValide,
      {
        idUtilisateur: session.idUtilisateur || '',
        idFormateur: session.idFormateur || ''
      },
      session.identifiantHistorique
    );

    return construireFavoriPublic_(favori, objet);
  });
}


function supprimerFavori(
  type,
  identifiant,
  utilisateurCle,
  jetonUtilisateur
) {
  const session = exigerUtilisateurAuthentifie_(jetonUtilisateur);
  const typeValide = validerTypeFavori_(type);
  const idValide = validerIdentifiantFavori_(identifiant);
  const cle = resoudreCleProprietaireFavoris_(session, utilisateurCle);

  return executerMutationMetier_(function () {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const tableFavoris = lireTableFavoris_(classeur, 'FAVORIS', true);
    const numeros = [];

    tableFavoris.lignes.forEach(function (ligne, position) {
      if (
        normaliserTypeFavori_(
          valeurFavoris_(tableFavoris, ligne, 'TYPE')
        ) === typeValide &&
        valeurFavoris_(tableFavoris, ligne, 'IDENTIFIANT') === idValide &&
        valeurFavoris_(tableFavoris, ligne, 'UTILISATEUR_CLE') === cle
      ) {
        numeros.push(position + 2);
      }
    });

    numeros.sort(function (a, b) {
      return b - a;
    }).forEach(function (numeroLigne) {
      tableFavoris.feuille.deleteRow(numeroLigne);
    });

    if (numeros.length) {
      journaliserActionSensible_(
        'FAVORI_SUPPRESSION',
        typeValide,
        idValide,
        {
          idUtilisateur: session.idUtilisateur || '',
          idFormateur: session.idFormateur || ''
        },
        session.identifiantHistorique
      );
    }

    return {
      supprime: numeros.length > 0,
      type: typeValide,
      identifiant: idValide,
      cleResultat: typeValide + ':' + idValide
    };
  });
}


function estFavori(
  type,
  identifiant,
  utilisateurCle,
  jetonUtilisateur
) {
  const session = exigerUtilisateurAuthentifie_(jetonUtilisateur);
  const typeValide = validerTypeFavori_(type);
  const idValide = validerIdentifiantFavori_(identifiant);
  const cle = resoudreCleProprietaireFavoris_(session, utilisateurCle);
  const tableFavoris = lireTableFavoris_(
    SpreadsheetApp.getActiveSpreadsheet(),
    'FAVORIS',
    true
  );

  return Boolean(trouverLigneFavori_(
    tableFavoris,
    typeValide,
    idValide,
    cle
  ));
}


function importerFavorisLocauxFormateur(
  utilisateurCleLocale,
  jetonUtilisateur
) {
  const session = exigerUtilisateurAuthentifie_(jetonUtilisateur);
  if (!session.estFormateur || !session.idUtilisateur) {
    throw new Error('Cette importation est réservée au formateur connecté.');
  }
  const cleLocale = validerUtilisateurCleFavoris_(utilisateurCleLocale);
  const cleCompte = construireCleCompteFavoris_(session.idUtilisateur);

  return executerMutationMetier_(function () {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    const table = lireTableFavoris_(classeur, 'FAVORIS', true);
    const lignesLocales = table.lignes.filter(function (ligne) {
      return valeurFavoris_(table, ligne, 'UTILISATEUR_CLE') === cleLocale;
    });
    let importes = 0;
    let existants = 0;

    lignesLocales.forEach(function (ligne) {
      const type = normaliserTypeFavori_(
        valeurFavoris_(table, ligne, 'TYPE')
      );
      const identifiant = valeurFavoris_(
        table,
        ligne,
        'IDENTIFIANT'
      );
      if (!type || !identifiant) return;
      if (trouverLigneFavori_(table, type, identifiant, cleCompte)) {
        existants++;
        return;
      }

      const copie = ligne.slice();
      copie[table.index.ID_FAVORI] = Utilities.getUuid();
      copie[table.index.UTILISATEUR_CLE] = cleCompte;
      copie[table.index.DATE_CREATION] = new Date();
      table.feuille.appendRow(copie);
      table.lignes.push(copie);
      importes++;
    });

    journaliserActionSensible_(
      'FAVORIS_LOCAUX_IMPORTATION',
      'UTILISATEUR',
      session.idUtilisateur,
      {
        idFormateur: session.idFormateur,
        importes: importes,
        dejaExistants: existants,
        sourceLocaleConservee: true
      },
      session.identifiantHistorique
    );

    return {
      succes: true,
      importes: importes,
      dejaExistants: existants,
      sourceLocaleConservee: true
    };
  });
}


function trouverLigneFavori_(table, type, identifiant, utilisateurCle) {
  for (let position = 0; position < table.lignes.length; position++) {
    const ligne = table.lignes[position];
    if (
      normaliserTypeFavori_(valeurFavoris_(table, ligne, 'TYPE')) === type &&
      valeurFavoris_(table, ligne, 'IDENTIFIANT') === identifiant &&
      valeurFavoris_(table, ligne, 'UTILISATEUR_CLE') === utilisateurCle
    ) {
      return {
        ligne: ligne,
        numeroLigne: position + 2
      };
    }
  }
  return null;
}


function extraireFavoriStocke_(table, ligne) {
  return {
    idFavori: valeurFavoris_(table, ligne, 'ID_FAVORI'),
    type: normaliserTypeFavori_(valeurFavoris_(table, ligne, 'TYPE')),
    identifiant: valeurFavoris_(table, ligne, 'IDENTIFIANT'),
    libelle: valeurFavoris_(table, ligne, 'LIBELLE'),
    sousLibelle: valeurFavoris_(table, ligne, 'SOUS_LIBELLE'),
    dateCreation: valeurBruteFavoris_(table, ligne, 'DATE_CREATION')
  };
}


function construireFavoriPublic_(favori, objet) {
  const disponible = Boolean(objet);
  return {
    idFavori: String(favori.idFavori || ''),
    type: String(favori.type || ''),
    identifiant: String(favori.identifiant || ''),
    cleResultat: String(favori.type || '') + ':' +
      String(favori.identifiant || ''),
    libelle: disponible
      ? objet.libelle
      : String(favori.libelle || 'Favori indisponible'),
    sousLibelle: disponible
      ? objet.sousLibelle
      : String(favori.sousLibelle || ''),
    disponible: disponible,
    actif: disponible ? objet.actif !== false : false,
    dateCreation: serialiserDateFavori_(favori.dateCreation),
    formation: disponible ? String(objet.formation || '') : ''
  };
}


function trouverObjetFavori_(classeur, type, identifiant) {
  const index = construireIndexObjetsFavoris_(
    classeur,
    new Set([type])
  );
  return index[type + ':' + identifiant] || null;
}


function construireIndexObjetsFavoris_(classeur, types) {
  const indexObjets = {};
  const besoins = types || new Set();
  const besoinFormations = ['STAGIAIRE', 'SESSION', 'FORMATION', 'ITEM']
    .some(function (type) {
      return besoins.has(type);
    });
  const tableFormations = besoinFormations
    ? lireTableFavoris_(classeur, 'FORMATIONS', false)
    : tableFavorisVide_();
  const formations = construireIndexFormationsFavoris_(tableFormations);

  if (besoins.has('STAGIAIRE')) {
    const table = lireTableFavoris_(classeur, 'STAGIAIRES', false);
    table.lignes.forEach(function (ligne) {
      const id = valeurFavoris_(table, ligne, 'UUID');
      if (!id) {
        return;
      }
      const nom = valeurFavoris_(table, ligne, 'NOM');
      const prenom = valeurFavoris_(table, ligne, 'PRENOM');
      const formation = resoudreFormationFavoris_(
        formations,
        valeurFavoris_(table, ligne, 'FORMATION')
      );
      indexObjets['STAGIAIRE:' + id] = {
        libelle: [nom, prenom].filter(Boolean).join(' ') || id,
        sousLibelle: formation.libelle || 'Formation non renseignée',
        actif: true,
        formation: formation.libelle
      };
    });
  }

  if (besoins.has('FORMATEUR')) {
    const table = lireTableFavoris_(classeur, 'FORMATEURS', false);
    table.lignes.forEach(function (ligne) {
      const id = valeurFavoris_(table, ligne, 'ID_FORMATEUR');
      if (!id) {
        return;
      }
      indexObjets['FORMATEUR:' + id] = {
        libelle: [
          valeurFavoris_(table, ligne, 'NOM'),
          valeurFavoris_(table, ligne, 'PRENOM')
        ].filter(Boolean).join(' ') || id,
        sousLibelle: 'Formateur',
        actif: convertirBooleenFavoris_(
          valeurBruteFavoris_(table, ligne, 'ACTIF')
        ),
        formation: ''
      };
    });
  }

  if (besoins.has('FORMATION')) {
    Object.keys(formations.parId).forEach(function (id) {
      const formation = formations.parId[id];
      indexObjets['FORMATION:' + id] = {
        libelle: formation.libelle || id,
        sousLibelle: 'Formation',
        actif: formation.actif,
        formation: formation.libelle
      };
    });
  }

  if (besoins.has('SESSION')) {
    const table = lireTableFavoris_(classeur, 'SESSIONS', false);
    table.lignes.forEach(function (ligne) {
      const id = valeurFavoris_(table, ligne, 'ID_SESSION');
      if (!id) {
        return;
      }
      const formation = resoudreFormationFavoris_(
        formations,
        valeurFavoris_(table, ligne, 'FORMATION')
      );
      const date = formaterDateLibelleFavori_(
        valeurBruteFavoris_(table, ligne, 'DATE_SESSION')
      );
      const debut = formaterHeureFavori_(
        valeurBruteFavoris_(table, ligne, 'HEURE_DEBUT')
      );
      const fin = formaterHeureFavori_(
        valeurBruteFavoris_(table, ligne, 'HEURE_FIN')
      );
      indexObjets['SESSION:' + id] = {
        libelle: 'Séance du ' + (date || 'date inconnue'),
        sousLibelle: [
          formation.libelle,
          [debut, fin].filter(Boolean).join('–')
        ].filter(Boolean).join(' · '),
        actif: true,
        formation: formation.libelle
      };
    });
  }

  if (besoins.has('ITEM')) {
    const tableCategories = lireTableFavoris_(
      classeur,
      'CATEGORIES',
      false
    );
    const categories = {};
    tableCategories.lignes.forEach(function (ligne) {
      const id = valeurFavoris_(
        tableCategories,
        ligne,
        'ID_CATEGORIE'
      );
      if (id) {
        categories[id] = valeurFavoris_(
          tableCategories,
          ligne,
          'CATEGORIE'
        );
      }
    });
    const table = lireTableFavoris_(classeur, 'REFERENTIEL', false);
    table.lignes.forEach(function (ligne) {
      const id = valeurFavoris_(table, ligne, 'ID_ITEM');
      if (!id) {
        return;
      }
      const formation = resoudreFormationFavoris_(
        formations,
        valeurFavoris_(table, ligne, 'FORMATION')
      );
      const categorie = categories[
        valeurFavoris_(table, ligne, 'ID_CATEGORIE')
      ] || 'Catégorie non renseignée';
      indexObjets['ITEM:' + id] = {
        libelle: valeurFavoris_(table, ligne, 'ITEM') || id,
        sousLibelle: [formation.libelle, categorie]
          .filter(Boolean)
          .join(' · '),
        actif: convertirBooleenFavoris_(
          valeurBruteFavoris_(table, ligne, 'ACTIF')
        ),
        formation: formation.libelle
      };
    });
  }

  return indexObjets;
}


function construireIndexFormationsFavoris_(table) {
  const resultat = {
    parId: {},
    alias: {}
  };
  table.lignes.forEach(function (ligne) {
    const id = valeurFavoris_(table, ligne, 'ID_FORMATION');
    const libelle = valeurFavoris_(table, ligne, 'LIBELLE');
    if (!id) {
      return;
    }
    const formation = {
      idFormation: id,
      libelle: libelle || id,
      actif: convertirBooleenFavoris_(
        valeurBruteFavoris_(table, ligne, 'ACTIF')
      )
    };
    resultat.parId[id] = formation;
    resultat.alias[normaliserFavoris_(id)] = formation;
    resultat.alias[normaliserFavoris_(libelle)] = formation;
  });
  return resultat;
}


function resoudreFormationFavoris_(formations, valeur) {
  const texte = String(valeur || '').trim();
  return formations.alias[normaliserFavoris_(texte)] || {
    idFormation: texte,
    libelle: texte,
    actif: true
  };
}


function lireTableFavoris_(classeur, nomFeuille, obligatoire) {
  const feuille = classeur.getSheetByName(nomFeuille);
  if (!feuille || feuille.getLastRow() < 1 || feuille.getLastColumn() < 1) {
    if (obligatoire) {
      throw new Error(
        'La feuille ' + nomFeuille +
        ' est absente. Exécute les migrations de schéma.'
      );
    }
    return tableFavorisVide_();
  }

  const valeurs = feuille.getDataRange().getValues();
  const entetes = valeurs[0].map(function (entete) {
    return normaliserFavoris_(entete).toUpperCase().replace(/ /g, '_');
  });
  const index = {};
  entetes.forEach(function (entete, position) {
    if (entete && !Object.prototype.hasOwnProperty.call(index, entete)) {
      index[entete] = position;
    }
  });

  if (nomFeuille === 'FAVORIS') {
    const manquantes = COLONNES_FAVORIS_.filter(function (colonne) {
      return !Number.isInteger(index[colonne]);
    });
    if (manquantes.length) {
      throw new Error(
        'La structure de FAVORIS est incomplète : ' +
        manquantes.join(', ') + '.'
      );
    }
  }

  return {
    feuille: feuille,
    index: index,
    lignes: valeurs.slice(1)
  };
}


function tableFavorisVide_() {
  return {
    feuille: null,
    index: {},
    lignes: []
  };
}


function valeurFavoris_(table, ligne, colonne) {
  const valeur = valeurBruteFavoris_(table, ligne, colonne);
  return valeur === null || valeur === undefined
    ? ''
    : String(valeur).trim();
}


function valeurBruteFavoris_(table, ligne, colonne) {
  const position = table.index[colonne];
  return Number.isInteger(position) ? ligne[position] : '';
}


function validerTypeFavori_(type) {
  const normalise = normaliserTypeFavori_(type);
  if (!TYPES_FAVORIS_AUTORISES_.includes(normalise)) {
    throw new Error('Type de favori invalide.');
  }
  return normalise;
}


function normaliserTypeFavori_(type) {
  return String(type || '').trim().toUpperCase();
}


function validerIdentifiantFavori_(identifiant) {
  const valeur = String(identifiant || '').trim();
  if (!valeur || valeur.length > 200 || /[\u0000-\u001f]/.test(valeur)) {
    throw new Error('Identifiant de favori invalide.');
  }
  return valeur;
}


function validerUtilisateurCleFavoris_(utilisateurCle) {
  const valeur = String(utilisateurCle || '').trim();
  if (
    valeur.length < 20 ||
    valeur.length > 120 ||
    !/^pfav_[a-z0-9._:-]+$/i.test(valeur)
  ) {
    throw new Error('Clé locale de favoris invalide.');
  }
  return valeur;
}


function resoudreCleProprietaireFavoris_(session, utilisateurCle) {
  if (session && session.estFormateur && session.idUtilisateur) {
    return construireCleCompteFavoris_(session.idUtilisateur);
  }
  if (session && session.estAdministrateur) {
    return validerUtilisateurCleFavoris_(utilisateurCle);
  }
  throw new Error('Authentification requise.');
}


function construireCleCompteFavoris_(idUtilisateur) {
  const identifiant = String(idUtilisateur || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(identifiant)) {
    throw new Error('Compte utilisateur invalide pour les favoris.');
  }
  return 'pusr_' + identifiant;
}


function convertirBooleenFavoris_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }
  const normalise = normaliserFavoris_(valeur);
  return ['TRUE', 'VRAI', 'OUI', '1', 'ACTIF', 'ACTIVE'].includes(
    normalise.toUpperCase()
  );
}


function serialiserDateFavori_(valeur) {
  if (valeur instanceof Date && !isNaN(valeur.getTime())) {
    return valeur.toISOString();
  }
  const date = new Date(valeur);
  return isNaN(date.getTime()) ? String(valeur || '') : date.toISOString();
}


function formaterDateLibelleFavori_(valeur) {
  const texte = String(valeur || '').trim();
  const dateIso = texte.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateIso) {
    return dateIso[3] + '/' + dateIso[2] + '/' + dateIso[1];
  }
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  if (isNaN(date.getTime())) {
    return String(valeur || '').trim();
  }
  return String(date.getDate()).padStart(2, '0') + '/' +
    String(date.getMonth() + 1).padStart(2, '0') + '/' +
    date.getFullYear();
}


function formaterHeureFavori_(valeur) {
  if (valeur instanceof Date && !isNaN(valeur.getTime())) {
    return String(valeur.getHours()).padStart(2, '0') + ':' +
      String(valeur.getMinutes()).padStart(2, '0');
  }
  const texte = String(valeur || '').trim();
  const heure = texte.match(/(?:^|T)(\d{1,2}):(\d{2})/);
  return heure
    ? String(heure[1]).padStart(2, '0') + ':' + heure[2]
    : texte;
}


function normaliserFavoris_(valeur) {
  return String(valeur || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
