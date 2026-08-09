'use strict';

const DUREE_CACHE_RECHERCHE_GLOBALE_SECONDES_ = 2 * 60;
const CLE_GENERATION_CACHE_RECHERCHE_GLOBALE_ =
  'PREPFORMATION_RECHERCHE_GLOBALE_GENERATION';
const PREFIXE_CACHE_RECHERCHE_GLOBALE_ =
  'PREPFORMATION_RECHERCHE_GLOBALE_V1_';
const LIMITE_RESULTATS_RECHERCHE_GLOBALE_ = 5;

const FEUILLES_RECHERCHE_GLOBALE_ = [
  'STAGIAIRES',
  'FORMATEURS',
  'SESSIONS',
  'FORMATIONS',
  'CATEGORIES',
  'REFERENTIEL',
  'PRESENCES_STAGIAIRES',
  'PRESTATIONS_FORMATEURS'
];


/**
 * Recherche globale strictement en lecture seule. Les options sont conservées
 * dans le contrat pour permettre de futurs filtres ou favoris sans changer le
 * format de l'API.
 */
function rechercherGlobalement(texte, options, jetonUtilisateur) {
  exigerUtilisateurAuthentifie_(jetonUtilisateur);
  const debut = Date.now();
  const requete = normaliserRechercheGlobale_(texte);
  const parametres = normaliserOptionsRechercheGlobale_(options);

  if (requete.length < 2) {
    return construireResultatRechercheGlobaleVide_(
      String(texte || '').trim(),
      debut,
      false
    );
  }

  const cache = CacheService.getScriptCache();
  const generation = cache.get(
    CLE_GENERATION_CACHE_RECHERCHE_GLOBALE_
  ) || '0';
  const cleCache = construireCleCacheRechercheGlobale_(
    requete,
    generation,
    parametres
  );
  const contenuCache = cache.get(cleCache);

  if (contenuCache) {
    try {
      const resultatCache = JSON.parse(contenuCache);
      resultatCache.meta.cacheUtilise = true;
      resultatCache.meta.dureeMs = Date.now() - debut;
      return resultatCache;
    } catch (erreurCache) {
      cache.remove(cleCache);
    }
  }

  const avertissements = [];
  const tables = lireTablesRechercheGlobale_(avertissements);
  const index = construireIndexMemoireRechercheGlobale_(
    tables,
    avertissements
  );
  const termes = requete.split(' ').filter(Boolean);
  const groupes = [
    rechercherTypeGlobal_(
      'STAGIAIRE',
      'Stagiaires',
      index.stagiaires,
      requete,
      termes
    ),
    rechercherTypeGlobal_(
      'SESSION',
      'Sessions',
      index.sessions,
      requete,
      termes
    ),
    rechercherTypeGlobal_(
      'FORMATEUR',
      'Formateurs',
      index.formateurs,
      requete,
      termes
    ),
    rechercherTypeGlobal_(
      'FORMATION',
      'Formations',
      index.formations,
      requete,
      termes
    ),
    rechercherTypeGlobal_(
      'REFERENTIEL',
      'Référentiel',
      index.referentiel,
      requete,
      termes
    )
  ];
  const fin = Date.now();
  const resultat = {
    requete: String(texte || '').trim(),
    requeteNormalisee: requete,
    groupes: groupes,
    totaux: groupes.reduce(function (totaux, groupe) {
      totaux[groupe.type] = groupe.total;
      return totaux;
    }, {}),
    nombreResultats: groupes.reduce(function (total, groupe) {
      return total + groupe.total;
    }, 0),
    avertissements: avertissements.slice(0, 50),
    meta: {
      versionFormat: 1,
      versionApplication: obtenirVersionApplication_(),
      calculeA: new Date(fin).toISOString(),
      dureeMs: fin - debut,
      cacheUtilise: false,
      limiteParType: LIMITE_RESULTATS_RECHERCHE_GLOBALE_
    }
  };

  try {
    cache.put(
      cleCache,
      JSON.stringify(resultat),
      DUREE_CACHE_RECHERCHE_GLOBALE_SECONDES_
    );
  } catch (erreurCache) {
    resultat.avertissements.push(
      'Le cache court de recherche n’a pas pu être alimenté.'
    );
  }

  return resultat;
}


function normaliserOptionsRechercheGlobale_(options) {
  const parametres = options || {};
  const typesAutorises = [
    'STAGIAIRE', 'SESSION', 'FORMATEUR', 'FORMATION', 'REFERENTIEL'
  ];
  const types = Array.isArray(parametres.types)
    ? parametres.types.map(function (type) {
      return String(type || '').trim().toUpperCase();
    }).filter(function (type) {
      return typesAutorises.includes(type);
    })
    : [];

  return {
    types: Array.from(new Set(types)).sort()
  };
}


function construireCleCacheRechercheGlobale_(requete, generation, options) {
  const contenu = JSON.stringify({
    versionApplication: obtenirVersionApplication_(),
    generation: generation,
    requete: requete,
    types: options.types
  });
  const empreinte = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    contenu,
    Utilities.Charset.UTF_8
  );

  return PREFIXE_CACHE_RECHERCHE_GLOBALE_ +
    Utilities.base64EncodeWebSafe(empreinte).replace(/=+$/g, '');
}


/**
 * CacheService ne permet pas d'énumérer les clés. Une génération courte rend
 * immédiatement inaccessibles les résultats antérieurs ; ils expirent ensuite
 * naturellement avec le même TTL.
 */
function invaliderCacheRechercheGlobale_() {
  try {
    CacheService.getScriptCache().put(
      CLE_GENERATION_CACHE_RECHERCHE_GLOBALE_,
      Utilities.getUuid(),
      DUREE_CACHE_RECHERCHE_GLOBALE_SECONDES_
    );
  } catch (erreurCache) {
    console.warn(
      'Le cache de recherche globale n’a pas pu être invalidé : ' +
      String(erreurCache && erreurCache.message || erreurCache)
    );
  }
}


function lireTablesRechercheGlobale_(avertissements) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const tables = {};

  FEUILLES_RECHERCHE_GLOBALE_.forEach(function (nomFeuille) {
    const feuille = classeur.getSheetByName(nomFeuille);

    if (!feuille || feuille.getLastRow() < 1 || feuille.getLastColumn() < 1) {
      tables[nomFeuille] = creerTableRechercheGlobale_([], []);
      ajouterAvertissementRechercheGlobale_(
        avertissements,
        'Feuille indisponible pour la recherche : ' + nomFeuille + '.'
      );
      return;
    }

    const valeurs = feuille.getDataRange().getValues();
    tables[nomFeuille] = creerTableRechercheGlobale_(
      valeurs[0] || [],
      valeurs.slice(1)
    );
  });

  return tables;
}


function creerTableRechercheGlobale_(entetes, lignes) {
  const index = {};
  (entetes || []).forEach(function (entete, position) {
    index[normaliserEnteteRechercheGlobale_(entete)] = position;
  });
  return {
    entetes: (entetes || []).slice(),
    index: index,
    lignes: (lignes || []).slice()
  };
}


function construireIndexMemoireRechercheGlobale_(tables, avertissements) {
  const formations = construireFormationsRechercheGlobale_(
    tables.FORMATIONS
  );
  const stagiaires = construirePersonnesRechercheGlobale_(
    tables.STAGIAIRES,
    'UUID',
    formations,
    'STAGIAIRE'
  );
  const formateurs = construirePersonnesRechercheGlobale_(
    tables.FORMATEURS,
    'ID_FORMATEUR',
    formations,
    'FORMATEUR'
  );
  const stagiairesParId = indexerParIdRechercheGlobale_(stagiaires);
  const formateursParId = indexerParIdRechercheGlobale_(formateurs);
  const participantsParSession = construireParticipantsRechercheGlobale_(
    tables.PRESENCES_STAGIAIRES,
    'ID_STAGIAIRE',
    stagiairesParId
  );
  const intervenantsParSession = construireParticipantsRechercheGlobale_(
    tables.PRESTATIONS_FORMATEURS,
    'ID_FORMATEUR',
    formateursParId
  );
  const categories = construireCategoriesRechercheGlobale_(
    tables.CATEGORIES,
    formations
  );
  const categoriesParId = indexerParIdRechercheGlobale_(categories);

  return {
    stagiaires: stagiaires,
    formateurs: formateurs,
    formations: formations.liste,
    sessions: construireSessionsRechercheGlobale_(
      tables.SESSIONS,
      formations,
      participantsParSession,
      intervenantsParSession
    ),
    referentiel: categories.concat(
      construireItemsRechercheGlobale_(
        tables.REFERENTIEL,
        formations,
        categoriesParId,
        avertissements
      )
    )
  };
}


function construireFormationsRechercheGlobale_(table) {
  const liste = [];
  const parId = {};
  const alias = {};
  const dejaVus = new Set();

  table.lignes.forEach(function (ligne) {
    const id = valeurRechercheGlobale_(table, ligne, 'ID_FORMATION');
    const libelle = valeurRechercheGlobale_(table, ligne, 'LIBELLE');
    if (!id || !libelle || dejaVus.has(id)) {
      return;
    }
    dejaVus.add(id);
    const resultat = creerEntreeRechercheGlobale_(
      'FORMATION',
      id,
      [libelle],
      {
        idFormation: id,
        libelle: libelle
      }
    );
    liste.push(resultat);
    parId[id] = resultat.donnees;
    alias[normaliserRechercheGlobale_(id)] = resultat.donnees;
    alias[normaliserRechercheGlobale_(libelle)] = resultat.donnees;
  });

  return {
    liste: liste,
    parId: parId,
    resoudre: function (valeur) {
      const texte = String(valeur || '').trim();
      return alias[normaliserRechercheGlobale_(texte)] || {
        idFormation: texte,
        libelle: texte
      };
    }
  };
}


function construirePersonnesRechercheGlobale_(
  table,
  colonneId,
  formations,
  type
) {
  const resultats = [];
  const dejaVus = new Set();

  table.lignes.forEach(function (ligne) {
    const id = valeurRechercheGlobale_(table, ligne, colonneId);
    if (!id || dejaVus.has(id)) {
      return;
    }
    dejaVus.add(id);
    const nom = valeurRechercheGlobale_(table, ligne, 'NOM');
    const prenom = valeurRechercheGlobale_(table, ligne, 'PRENOM');

    if (type === 'STAGIAIRE') {
      const formation = formations.resoudre(
        valeurRechercheGlobale_(table, ligne, 'FORMATION')
      );
      resultats.push(creerEntreeRechercheGlobale_(
        type,
        id,
        [nom, prenom, nom + ' ' + prenom, prenom + ' ' + nom,
          formation.libelle],
        {
          uuid: id,
          nom: nom,
          prenom: prenom,
          formation: formation.libelle,
          formationId: formation.idFormation,
          statut: valeurRechercheGlobale_(table, ligne, 'STATUT') ||
            'À préparer',
          aUnePhoto: Boolean(
            valeurRechercheGlobale_(table, ligne, 'PHOTO_FILE_ID')
          )
        },
        id
      ));
      return;
    }

    resultats.push(creerEntreeRechercheGlobale_(
      type,
      id,
      [nom, prenom, nom + ' ' + prenom, prenom + ' ' + nom],
      {
        idFormateur: id,
        nom: nom,
        prenom: prenom,
        actif: convertirBooleenRechercheGlobale_(
          valeurBruteRechercheGlobale_(table, ligne, 'ACTIF')
        )
      }
    ));
  });

  return resultats;
}


function construireParticipantsRechercheGlobale_(
  table,
  colonneParticipant,
  participantsParId
) {
  const parSession = {};
  const dejaVus = new Set();

  table.lignes.forEach(function (ligne) {
    const idSession = valeurRechercheGlobale_(
      table,
      ligne,
      'ID_SESSION'
    );
    const idParticipant = valeurRechercheGlobale_(
      table,
      ligne,
      colonneParticipant
    );
    const participant = participantsParId[idParticipant];
    const cle = idSession + '::' + idParticipant;

    if (!idSession || !participant || dejaVus.has(cle)) {
      return;
    }
    dejaVus.add(cle);
    if (!parSession[idSession]) {
      parSession[idSession] = [];
    }
    parSession[idSession].push(participant);
  });

  return parSession;
}


function construireSessionsRechercheGlobale_(
  table,
  formations,
  participantsParSession,
  intervenantsParSession
) {
  const resultats = [];
  const dejaVus = new Set();

  table.lignes.forEach(function (ligne) {
    const id = valeurRechercheGlobale_(table, ligne, 'ID_SESSION');
    if (!id || dejaVus.has(id)) {
      return;
    }
    dejaVus.add(id);
    const date = convertirDateRechercheGlobale_(
      valeurBruteRechercheGlobale_(table, ligne, 'DATE_SESSION')
    );
    const formation = formations.resoudre(
      valeurRechercheGlobale_(table, ligne, 'FORMATION')
    );
    const participants = participantsParSession[id] || [];
    const formateurs = intervenantsParSession[id] || [];
    const nomsParticipants = participants.map(nomCompletRechercheGlobale_);
    const nomsFormateurs = formateurs.map(nomCompletRechercheGlobale_);
    const champs = [
      date.iso,
      date.francaise,
      formation.libelle,
      valeurRechercheGlobale_(table, ligne, 'THEME'),
      valeurRechercheGlobale_(table, ligne, 'REMARQUES')
    ].concat(nomsParticipants, nomsFormateurs);

    resultats.push(creerEntreeRechercheGlobale_(
      'SESSION',
      id,
      champs,
      {
        idSession: id,
        date: date.iso,
        heureDebut: convertirHeureRechercheGlobale_(
          valeurBruteRechercheGlobale_(table, ligne, 'HEURE_DEBUT')
        ),
        heureFin: convertirHeureRechercheGlobale_(
          valeurBruteRechercheGlobale_(table, ligne, 'HEURE_FIN')
        ),
        formation: formation.libelle,
        participantsPrincipaux: nomsParticipants.slice(0, 3),
        nombreParticipants: nomsParticipants.length,
        formateursPrincipaux: nomsFormateurs.slice(0, 3)
      }
    ));
  });

  return resultats;
}


function construireCategoriesRechercheGlobale_(table, formations) {
  const resultats = [];
  const dejaVus = new Set();

  table.lignes.forEach(function (ligne) {
    const id = valeurRechercheGlobale_(table, ligne, 'ID_CATEGORIE');
    const categorie = valeurRechercheGlobale_(table, ligne, 'CATEGORIE');
    if (!id || !categorie || dejaVus.has(id)) {
      return;
    }
    dejaVus.add(id);
    const formation = formations.resoudre(
      valeurRechercheGlobale_(table, ligne, 'FORMATION')
    );
    resultats.push(creerEntreeRechercheGlobale_(
      'CATEGORIE',
      id,
      [categorie, formation.libelle],
      {
        idCategorie: id,
        sousType: 'CATEGORIE',
        formation: formation.libelle,
        formationId: formation.idFormation,
        categorie: categorie,
        item: ''
      }
    ));
  });

  return resultats;
}


function construireItemsRechercheGlobale_(
  table,
  formations,
  categoriesParId,
  avertissements
) {
  const resultats = [];
  const dejaVus = new Set();

  table.lignes.forEach(function (ligne) {
    const id = valeurRechercheGlobale_(table, ligne, 'ID_ITEM');
    const item = valeurRechercheGlobale_(table, ligne, 'ITEM');
    if (!id || !item || dejaVus.has(id)) {
      return;
    }
    dejaVus.add(id);
    const idCategorie = valeurRechercheGlobale_(
      table,
      ligne,
      'ID_CATEGORIE'
    );
    const categorie = categoriesParId[idCategorie];
    const formation = formations.resoudre(
      valeurRechercheGlobale_(table, ligne, 'FORMATION')
    );
    if (!categorie && idCategorie) {
      ajouterAvertissementRechercheGlobale_(
        avertissements,
        'Catégorie introuvable pour l’item ' + id + '.'
      );
    }

    const categorieLibelle = categorie
      ? categorie.donnees.categorie
      : 'Catégorie non renseignée';
    resultats.push(creerEntreeRechercheGlobale_(
      'ITEM',
      id,
      [
        item,
        valeurRechercheGlobale_(table, ligne, 'DESCRIPTION'),
        categorieLibelle,
        formation.libelle
      ],
      {
        idItem: id,
        idCategorie: idCategorie,
        sousType: 'ITEM',
        formation: formation.libelle,
        formationId: formation.idFormation,
        categorie: categorieLibelle,
        item: item
      }
    ));
  });

  return resultats;
}


function creerEntreeRechercheGlobale_(
  type,
  id,
  champs,
  donnees,
  identifiantExact
) {
  return {
    type: type,
    id: id,
    cleResultat: type + ':' + id,
    champs: (champs || []).map(normaliserRechercheGlobale_).filter(Boolean),
    identifiantExact: identifiantExact
      ? normaliserRechercheGlobale_(identifiantExact)
      : '',
    donnees: donnees
  };
}


function rechercherTypeGlobal_(type, libelle, entrees, requete, termes) {
  const correspondances = (entrees || []).map(function (entree) {
    const classement = classerCorrespondanceRechercheGlobale_(
      entree,
      requete,
      termes
    );
    if (!classement) {
      return null;
    }
    return {
      entree: entree,
      classement: classement
    };
  }).filter(Boolean).sort(comparerResultatsRechercheGlobale_);

  return {
    type: type,
    libelle: libelle,
    total: correspondances.length,
    resultats: correspondances.slice(
      0,
      LIMITE_RESULTATS_RECHERCHE_GLOBALE_
    ).map(function (correspondance) {
      return Object.assign({
        type: correspondance.entree.type,
        id: correspondance.entree.id,
        cleResultat: correspondance.entree.cleResultat,
        niveauCorrespondance: correspondance.classement.niveau
      }, correspondance.entree.donnees);
    })
  };
}


function classerCorrespondanceRechercheGlobale_(entree, requete, termes) {
  const champs = entree.champs;
  const exact = entree.identifiantExact === requete || champs.some(
    function (champ) {
      return champ === requete;
    }
  );
  const debut = champs.some(function (champ) {
    return champ.indexOf(requete) === 0;
  });
  const termesCorrespondants = termes.filter(function (terme) {
    return champs.some(function (champ) {
      return champ.includes(terme);
    });
  }).length;

  if (!exact && !debut && !termesCorrespondants) {
    return null;
  }

  let niveau = 3;
  if (exact) {
    niveau = 0;
  } else if (debut) {
    niveau = 1;
  } else if (termes.length > 1 && termesCorrespondants === termes.length) {
    niveau = 2;
  }

  const positions = [];
  champs.forEach(function (champ) {
    termes.forEach(function (terme) {
      const position = champ.indexOf(terme);
      if (position >= 0) {
        positions.push(position);
      }
    });
  });

  return {
    niveau: niveau,
    termesCorrespondants: termesCorrespondants,
    premierePosition: positions.length
      ? Math.min.apply(null, positions)
      : Number.MAX_SAFE_INTEGER
  };
}


function comparerResultatsRechercheGlobale_(a, b) {
  return a.classement.niveau - b.classement.niveau ||
    b.classement.termesCorrespondants -
      a.classement.termesCorrespondants ||
    a.classement.premierePosition - b.classement.premierePosition ||
    construireLibelleTriRechercheGlobale_(a.entree).localeCompare(
      construireLibelleTriRechercheGlobale_(b.entree),
      'fr',
      { sensitivity: 'base' }
    ) || a.entree.id.localeCompare(b.entree.id);
}


function construireLibelleTriRechercheGlobale_(entree) {
  const donnees = entree.donnees || {};
  return [
    donnees.nom,
    donnees.prenom,
    donnees.libelle,
    donnees.date,
    donnees.item,
    donnees.categorie
  ].filter(Boolean).join(' ');
}


function indexerParIdRechercheGlobale_(entrees) {
  return (entrees || []).reduce(function (index, entree) {
    index[entree.id] = entree;
    return index;
  }, {});
}


function nomCompletRechercheGlobale_(entree) {
  const donnees = entree.donnees || {};
  return [donnees.prenom, donnees.nom].filter(Boolean).join(' ') || entree.id;
}


function construireResultatRechercheGlobaleVide_(texte, debut, cacheUtilise) {
  const groupes = [
    ['STAGIAIRE', 'Stagiaires'],
    ['SESSION', 'Sessions'],
    ['FORMATEUR', 'Formateurs'],
    ['FORMATION', 'Formations'],
    ['REFERENTIEL', 'Référentiel']
  ].map(function (configuration) {
    return {
      type: configuration[0],
      libelle: configuration[1],
      total: 0,
      resultats: []
    };
  });
  return {
    requete: texte,
    requeteNormalisee: normaliserRechercheGlobale_(texte),
    groupes: groupes,
    totaux: {
      STAGIAIRE: 0,
      SESSION: 0,
      FORMATEUR: 0,
      FORMATION: 0,
      REFERENTIEL: 0
    },
    nombreResultats: 0,
    avertissements: [],
    meta: {
      versionFormat: 1,
      versionApplication: obtenirVersionApplication_(),
      calculeA: new Date().toISOString(),
      dureeMs: Date.now() - debut,
      cacheUtilise: Boolean(cacheUtilise),
      limiteParType: LIMITE_RESULTATS_RECHERCHE_GLOBALE_
    }
  };
}


function normaliserRechercheGlobale_(valeur) {
  return String(valeur || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function normaliserEnteteRechercheGlobale_(valeur) {
  return normaliserRechercheGlobale_(valeur)
    .toUpperCase()
    .replace(/ /g, '_');
}


function valeurRechercheGlobale_(table, ligne, colonne) {
  const valeur = valeurBruteRechercheGlobale_(table, ligne, colonne);
  return valeur === null || valeur === undefined
    ? ''
    : String(valeur).trim();
}


function valeurBruteRechercheGlobale_(table, ligne, colonne) {
  const position = table.index[colonne];
  return Number.isInteger(position) ? ligne[position] : '';
}


function convertirBooleenRechercheGlobale_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }
  return ['1', 'TRUE', 'VRAI', 'OUI', 'ACTIF'].includes(
    String(valeur || '').trim().toUpperCase()
  );
}


function convertirDateRechercheGlobale_(valeur) {
  let date = null;

  if (Object.prototype.toString.call(valeur) === '[object Date]') {
    date = isNaN(valeur.getTime()) ? null : valeur;
  } else {
    const correspondance = /^(\d{4})-(\d{2})-(\d{2})/.exec(
      String(valeur || '').trim()
    );
    if (correspondance) {
      date = new Date(
        Number(correspondance[1]),
        Number(correspondance[2]) - 1,
        Number(correspondance[3]),
        12
      );
    }
  }

  if (!date || isNaN(date.getTime())) {
    return { iso: '', francaise: '' };
  }
  const annee = String(date.getFullYear()).padStart(4, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return {
    iso: annee + '-' + mois + '-' + jour,
    francaise: jour + '/' + mois + '/' + annee
  };
}


function convertirHeureRechercheGlobale_(valeur) {
  if (Object.prototype.toString.call(valeur) === '[object Date]') {
    return String(valeur.getHours()).padStart(2, '0') + ':' +
      String(valeur.getMinutes()).padStart(2, '0');
  }
  const texte = String(valeur || '').trim();
  const correspondance = /^(\d{1,2})[:hH](\d{2})/.exec(texte);
  return correspondance
    ? String(Number(correspondance[1])).padStart(2, '0') + ':' +
      correspondance[2]
    : texte;
}


function ajouterAvertissementRechercheGlobale_(liste, message) {
  if (!liste.includes(message) && liste.length < 50) {
    liste.push(message);
  }
}
