'use strict';

const NOMBRE_MAX_PRIORITES_GROUPE_ = 15;
const NOMBRE_MAX_RECOMMANDATIONS_GROUPE_ = 10;


/**
 * Données minimales nécessaires à la sélection d'un groupe. Cette lecture
 * n'appelle volontairement pas getStagiaires(), qui peut synchroniser les
 * statuts, et ne déclenche donc aucune mutation métier.
 */
function getPreparationAssistantPedagogique(jetonUtilisateur) {
  exigerUtilisateurAuthentifie_(jetonUtilisateur);
  const avertissements = [];
  const tables = lireTablesAnalysePedagogique_(avertissements);
  const formations = construireFormationsAnalysePedagogique_(
    tables.FORMATIONS,
    avertissements
  );
  const stagiairesParId = {};

  tables.STAGIAIRES.lignes.forEach(function (ligne) {
    const uuid = valeurAnalysePedagogique_(
      tables.STAGIAIRES,
      ligne,
      'UUID'
    );
    const statut = valeurAnalysePedagogique_(
      tables.STAGIAIRES,
      ligne,
      'STATUT'
    );
    const statutNormalise = normaliserAnalysePedagogique_(statut);

    if (!uuid || ['CLOTURE', 'ABANDON'].includes(statutNormalise)) {
      return;
    }
    if (stagiairesParId[uuid]) {
      fusionnerAvertissementsGroupe_(avertissements, [
        'UUID stagiaire dupliqué ignoré dans la sélection : ' + uuid + '.'
      ]);
      return;
    }

    const formationBrute = valeurAnalysePedagogique_(
      tables.STAGIAIRES,
      ligne,
      'FORMATION'
    );
    const formationId = formations.resoudre(formationBrute);
    const formation = formations.parId[formationId];

    stagiairesParId[uuid] = {
      uuid: uuid,
      nom: valeurAnalysePedagogique_(
        tables.STAGIAIRES,
        ligne,
        'NOM'
      ),
      prenom: valeurAnalysePedagogique_(
        tables.STAGIAIRES,
        ligne,
        'PRENOM'
      ),
      formationId: formationId,
      formation: formation ? formation.libelle : formationBrute,
      statut: statut || 'À préparer'
    };
  });

  const sessionsParId = {};
  tables.SESSIONS.lignes.forEach(function (ligne) {
    const idSession = valeurAnalysePedagogique_(
      tables.SESSIONS,
      ligne,
      'ID_SESSION'
    );
    if (!idSession || sessionsParId[idSession]) {
      return;
    }

    const dateBrute = valeurAnalysePedagogique_(
      tables.SESSIONS,
      ligne,
      'DATE_SESSION'
    );
    const date = normaliserDateAnalysePedagogique_(dateBrute);
    const formationBrute = valeurAnalysePedagogique_(
      tables.SESSIONS,
      ligne,
      'FORMATION'
    );
    const formationId = formations.resoudre(formationBrute);
    const formation = formations.parId[formationId];

    sessionsParId[idSession] = {
      idSession: idSession,
      date: date ? convertirDateIsoAnalysePedagogique_(date) : '',
      formationId: formationId,
      formation: formation ? formation.libelle : formationBrute,
      idsStagiaires: []
    };
  });

  const presencesDejaAjoutees = new Set();
  tables.PRESENCES_STAGIAIRES.lignes.forEach(function (ligne) {
    const idSession = valeurAnalysePedagogique_(
      tables.PRESENCES_STAGIAIRES,
      ligne,
      'ID_SESSION'
    );
    const idStagiaire = valeurAnalysePedagogique_(
      tables.PRESENCES_STAGIAIRES,
      ligne,
      'ID_STAGIAIRE'
    );
    const cle = idSession + '::' + idStagiaire;

    if (
      !sessionsParId[idSession] ||
      !stagiairesParId[idStagiaire] ||
      presencesDejaAjoutees.has(cle)
    ) {
      return;
    }

    presencesDejaAjoutees.add(cle);
    sessionsParId[idSession].idsStagiaires.push(idStagiaire);
  });

  const stagiaires = Object.keys(stagiairesParId).map(function (uuid) {
    return stagiairesParId[uuid];
  }).sort(comparerIdentitesAssistantPedagogique_);
  const formationsSelection = [];
  const formationsDejaAjoutees = new Set();

  stagiaires.forEach(function (stagiaire) {
    const cle = stagiaire.formationId || stagiaire.formation;
    if (!cle || formationsDejaAjoutees.has(cle)) {
      return;
    }
    formationsDejaAjoutees.add(cle);
    formationsSelection.push({
      idFormation: stagiaire.formationId,
      libelle: stagiaire.formation
    });
  });

  return {
    stagiaires: stagiaires,
    formations: formationsSelection.sort(function (a, b) {
      return a.libelle.localeCompare(
        b.libelle,
        'fr',
        { sensitivity: 'base' }
      );
    }),
    sessions: Object.keys(sessionsParId).map(function (idSession) {
      const session = sessionsParId[idSession];
      session.idsStagiaires.sort();
      session.nombreStagiaires = session.idsStagiaires.length;
      return session;
    }).filter(function (session) {
      return session.nombreStagiaires > 0;
    }).sort(function (a, b) {
      return b.date.localeCompare(a.date) ||
        b.idSession.localeCompare(a.idSession);
    }),
    avertissements: avertissements.slice(0, 100)
  };
}


/**
 * Analyse pédagogique agrégée d'un groupe.
 *
 * Ce service ne porte aucune règle pédagogique : les scores, classements,
 * oublis, niveaux et motifs proviennent exclusivement des résultats produits
 * par AnalysePedagogiqueService.js. Il ne fait que mutualiser leur lecture et
 * calculer des statistiques descriptives.
 */
function getAnalyseGroupe(idsStagiaires, options, jetonUtilisateur) {
  exigerUtilisateurAuthentifie_(jetonUtilisateur);
  const debutCalcul = Date.now();
  const parametres = options || {};
  const ids = normaliserIdsStagiairesGroupe_(idsStagiaires);

  if (restaurationBloqueEcritures_()) {
    throw new Error(
      'L’analyse pédagogique de groupe est temporairement indisponible pendant la restauration.'
    );
  }

  if (!ids.length) {
    return construireResultatGroupeVide_(debutCalcul);
  }

  const chargement = chargerAnalysesIndividuellesGroupe_(ids, parametres);
  const resultat = agregerAnalysesPedagogiquesGroupe_(
    chargement.analyses,
    chargement.avertissements
  );
  const finCalcul = Date.now();

  resultat.meta = {
    versionFormat: 1,
    versionApplication: obtenirVersionApplication_(),
    calculeA: new Date(finCalcul).toISOString(),
    dureeCalculMs: finCalcul - debutCalcul,
    nombreAnalysesCache: chargement.nombreAnalysesCache,
    nombreAnalysesCalculees: chargement.nombreAnalysesCalculees,
    lectureTablesEffectuee: chargement.nombreAnalysesCalculees > 0,
    donneesPartielles: chargement.avertissements.length > 0,
    avertissements: chargement.avertissements.slice()
  };

  if (restaurationBloqueEcritures_()) {
    throw new Error(
      'Une restauration a démarré pendant l’analyse de groupe. Aucun résultat n’a été conservé.'
    );
  }

  return resultat;
}


function normaliserIdsStagiairesGroupe_(idsStagiaires) {
  if (!Array.isArray(idsStagiaires)) {
    throw new Error('La liste des stagiaires doit être un tableau.');
  }

  const idsUniques = [];
  const dejaVus = new Set();

  idsStagiaires.forEach(function (valeur) {
    const uuid = validerUuidAnalysePedagogique_(valeur);
    if (!dejaVus.has(uuid)) {
      dejaVus.add(uuid);
      idsUniques.push(uuid);
    }
  });

  return idsUniques;
}


/**
 * Consulte d'abord le cache exact du moteur individuel. S'il reste au moins
 * une analyse à calculer, toutes les feuilles sont lues une seule fois puis
 * chaque identifiant manquant est confié une seule fois au coeur pur du moteur
 * individuel.
 */
function chargerAnalysesIndividuellesGroupe_(ids, options) {
  const cache = CacheService.getScriptCache();
  const analysesParId = {};
  const idsACalculer = [];
  const avertissements = [];
  const forcerActualisation = Boolean(options.forcerActualisation);

  ids.forEach(function (uuid) {
    const cleCache = construireCleCacheAnalysePedagogique_(uuid);

    if (!forcerActualisation) {
      const resultatCache = lireAnalyseIndividuelleCacheGroupe_(
        cache,
        cleCache,
        uuid
      );
      if (resultatCache) {
        analysesParId[uuid] = resultatCache;
        return;
      }
    }

    idsACalculer.push(uuid);
  });

  if (idsACalculer.length) {
    const avertissementsLecture = [];
    const tables = lireTablesAnalysePedagogique_(avertissementsLecture);
    const maintenant = new Date();
    const nouveauxResultats = [];

    idsACalculer.forEach(function (uuid) {
      const debutAnalyse = Date.now();
      let analyse;

      try {
        analyse = calculerAnalysePedagogiqueDepuisTables_(
          tables,
          uuid,
          maintenant,
          avertissementsLecture.slice()
        );
      } catch (erreur) {
        if (/Stagiaire introuvable/i.test(String(erreur && erreur.message))) {
          throw new Error('Stagiaire introuvable : ' + uuid + '.');
        }
        throw erreur;
      }

      const finAnalyse = Date.now();
      analyse.meta = {
        versionFormat: 1,
        versionApplication: obtenirVersionApplication_(),
        calculeA: new Date(finAnalyse).toISOString(),
        calculeAms: finAnalyse,
        dureeCalculMs: finAnalyse - debutAnalyse,
        cacheUtilise: false,
        ageCacheSecondes: 0,
        donneesPartielles: analyse.avertissements.length > 0,
        avertissements: analyse.avertissements.slice()
      };
      analysesParId[uuid] = analyse;
      nouveauxResultats.push({
        uuid: uuid,
        cleCache: construireCleCacheAnalysePedagogique_(uuid),
        analyse: analyse
      });
      fusionnerAvertissementsGroupe_(avertissements, analyse.avertissements);
    });

    nouveauxResultats.forEach(function (resultat) {
      try {
        cache.put(
          resultat.cleCache,
          JSON.stringify(resultat.analyse),
          DUREE_CACHE_ANALYSE_PEDAGOGIQUE_SECONDES_
        );
      } catch (erreurCache) {
        fusionnerAvertissementsGroupe_(avertissements, [
          'Le cache court n’a pas pu être alimenté pour le stagiaire ' +
          resultat.uuid + ' ; son analyse reste valide.'
        ]);
      }
    });
  }

  const analyses = ids.map(function (uuid) {
    const analyse = analysesParId[uuid];
    fusionnerAvertissementsGroupe_(
      avertissements,
      analyse && analyse.avertissements
    );
    return analyse;
  });

  return {
    analyses: analyses,
    nombreAnalysesCache: ids.length - idsACalculer.length,
    nombreAnalysesCalculees: idsACalculer.length,
    avertissements: avertissements
  };
}


function lireAnalyseIndividuelleCacheGroupe_(cache, cleCache, uuid) {
  const contenu = cache.get(cleCache);
  if (!contenu) {
    return null;
  }

  try {
    const analyse = JSON.parse(contenu);
    if (
      !analyse ||
      !analyse.meta ||
      !analyse.stagiaire ||
      analyse.stagiaire.uuid !== uuid ||
      !Array.isArray(analyse.items)
    ) {
      throw new Error('Entrée de cache incomplète.');
    }
    analyse.meta.cacheUtilise = true;
    analyse.meta.ageCacheSecondes = Math.max(
      0,
      Math.round(
        (Date.now() - Number(analyse.meta.calculeAms || 0)) / 1000
      )
    );
    return analyse;
  } catch (erreurCache) {
    cache.remove(cleCache);
    return null;
  }
}


function agregerAnalysesPedagogiquesGroupe_(analyses, avertissements) {
  const nombreStagiaires = analyses.length;
  const agregatsParItem = construireAgregatsItemsGroupe_(analyses);
  const items = Array.from(agregatsParItem.values()).map(
    finaliserAgregatItemGroupe_
  );
  const prioritesInternes = items.filter(function (item) {
    return item.nombreStagiairesConcernes > 0;
  }).sort(comparerPrioritesGroupe_).slice(0, NOMBRE_MAX_PRIORITES_GROUPE_)
    .map(function (item, position) {
      return Object.assign({ rang: position + 1 }, item);
    });
  const recommandations = construireRecommandationsGroupe_(prioritesInternes);
  const priorites = prioritesInternes.map(resumerPrioriteGroupe_);
  const scores = [];

  analyses.forEach(function (analyse) {
    (analyse.items || []).forEach(function (item) {
      if (item.compteDansAnalyse) {
        scores.push(Number(item.scorePriorite) || 0);
      }
    });
  });

  const stagiairesConcernesParItem = items.map(function (item) {
    return {
      idItem: item.idItem,
      item: item.item,
      categorie: item.categorie,
      nombreStagiairesConcernes: item.nombreStagiairesConcernes
    };
  }).sort(comparerOrdreItemsGroupe_);

  return {
    analyseGlobale: {
      nombreStagiaires: nombreStagiaires,
      nombreItemsActifs: items.length,
      nombreItemsTravailles: items.filter(function (item) {
        return item.nombreStagiairesAyantTravaille > 0;
      }).length,
      nombreItemsAcquis: items.filter(function (item) {
        return item.nombreStagiairesAyantAcquis > 0;
      }).length,
      nombreItemsJamaisAcquis: items.filter(function (item) {
        return item.nombreStagiairesAyantAcquis === 0;
      }).length,
      homogeneite: calculerHomogeneiteGroupe_(analyses),
      stagiairesConcernesParItem: stagiairesConcernesParItem
    },
    priorites: priorites,
    recommandations: recommandations,
    detailsStagiaires: analyses.map(function (analyse) {
      return {
        uuid: analyse.stagiaire.uuid,
        nombreRecommandationsIndividuelles:
          (analyse.recommandationsProchaineSeance || []).length,
        nombreItemsPrioritaires:
          (analyse.itemsPrioritaires || []).length,
        nombrePointsFaibles: (analyse.pointsFaibles || []).length,
        joursDepuisDerniereSeance:
          analyse.synthese.joursDepuisDerniereSeance
      };
    }),
    statistiques: {
      itemsMaitrisesParToutLeGroupe: items.filter(function (item) {
        return item.nombreStagiairesDansPerimetre === nombreStagiaires &&
          item.nombreStagiairesAyantAcquis === nombreStagiaires;
      }).sort(comparerOrdreItemsGroupe_).map(resumerItemStatistiqueGroupe_),
      itemsCritiques: items.filter(function (item) {
        return item.niveauxIndividuels.indexOf('CRITIQUE') !== -1;
      }).sort(comparerPrioritesGroupe_).map(resumerItemStatistiqueGroupe_),
      itemsJamaisTravaillesParAuMoinsUnStagiaire: items.filter(
        function (item) {
          return item.nombreJamaisTravailles > 0;
        }
      ).sort(comparerOrdreItemsGroupe_).map(resumerItemStatistiqueGroupe_),
      dispersionScores: calculerEcartTypeGroupe_(scores),
      moyenneScores: calculerMoyenneGroupe_(scores),
      medianeScores: calculerMedianeGroupe_(scores)
    },
    perimetre: {
      stagiaires: analyses.map(function (analyse) {
        return {
          uuid: analyse.stagiaire.uuid,
          formationId: analyse.stagiaire.formationId,
          formation: analyse.stagiaire.formation
        };
      }),
      nombreMaxPriorites: NOMBRE_MAX_PRIORITES_GROUPE_,
      nombreMaxRecommandations: NOMBRE_MAX_RECOMMANDATIONS_GROUPE_,
      sourceRegles: 'AnalysePedagogiqueService.js'
    },
    avertissements: (avertissements || []).slice(0, 100)
  };
}


function construireAgregatsItemsGroupe_(analyses) {
  const agregats = new Map();

  analyses.forEach(function (analyse) {
    const idsPrioritaires = new Set(
      (analyse.itemsPrioritaires || []).map(function (item) {
        return item.idItem;
      })
    );
    const idsOublies = new Set(
      (analyse.itemsOublies || []).map(function (item) {
        return item.idItem;
      })
    );
    const recommandationsParItem = {};

    (analyse.recommandationsProchaineSeance || []).forEach(
      function (recommandation) {
        recommandationsParItem[recommandation.idItem] = recommandation;
      }
    );

    (analyse.items || []).forEach(function (item) {
      if (!item.compteDansAnalyse) {
        return;
      }

      let agregat = agregats.get(item.idItem);
      if (!agregat) {
        agregat = creerAgregatItemGroupe_(item);
        agregats.set(item.idItem, agregat);
      }

      const estPrioritaire = idsPrioritaires.has(item.idItem);
      const recommandation = recommandationsParItem[item.idItem] || null;

      agregat.nombreStagiairesDansPerimetre++;
      agregat.nombreStagiairesAyantTravaille +=
        item.nombreFoisTravaille > 0 ? 1 : 0;
      agregat.nombreStagiairesAyantAcquis +=
        item.nombreFoisAcquis > 0 ? 1 : 0;
      agregat.nombreJamaisTravailles +=
        item.nombreFoisTravaille === 0 ? 1 : 0;
      agregat.nombreJamaisAcquis += item.nombreFoisAcquis === 0 ? 1 : 0;
      agregat.nombreOublies += idsOublies.has(item.idItem) ? 1 : 0;
      agregat.nombreEchecs += Number(item.nombreEchecsExplicites) || 0;

      if (item.joursDepuisDernierTravail !== null) {
        agregat.anciennetes.push(
          Number(item.joursDepuisDernierTravail) || 0
        );
      }

      if (estPrioritaire) {
        agregat.nombreStagiairesConcernes++;
        agregat.scoresConcernes.push(Number(item.scorePriorite) || 0);
      }

      if (recommandation) {
        agregat.recommandationsIndividuelles.push(recommandation);
        agregat.niveauxIndividuels.push(recommandation.niveauPriorite);
      }
    });
  });

  return agregats;
}


function creerAgregatItemGroupe_(item) {
  return {
    idItem: item.idItem,
    item: item.intitule,
    idCategorie: item.idCategorie,
    categorie: item.categorie,
    ordreCategorie: item.ordreCategorie,
    ordreItem: item.ordre,
    nombreStagiairesDansPerimetre: 0,
    nombreStagiairesConcernes: 0,
    nombreStagiairesAyantTravaille: 0,
    nombreStagiairesAyantAcquis: 0,
    nombreJamaisTravailles: 0,
    nombreJamaisAcquis: 0,
    nombreOublies: 0,
    nombreEchecs: 0,
    anciennetes: [],
    scoresConcernes: [],
    recommandationsIndividuelles: [],
    niveauxIndividuels: []
  };
}


function finaliserAgregatItemGroupe_(agregat) {
  return {
    idItem: agregat.idItem,
    item: agregat.item,
    idCategorie: agregat.idCategorie,
    categorie: agregat.categorie,
    ordreCategorie: agregat.ordreCategorie,
    ordreItem: agregat.ordreItem,
    nombreStagiairesDansPerimetre: agregat.nombreStagiairesDansPerimetre,
    nombreStagiairesConcernes: agregat.nombreStagiairesConcernes,
    nombreStagiairesAyantTravaille: agregat.nombreStagiairesAyantTravaille,
    nombreStagiairesAyantAcquis: agregat.nombreStagiairesAyantAcquis,
    nombreJamaisTravailles: agregat.nombreJamaisTravailles,
    nombreJamaisAcquis: agregat.nombreJamaisAcquis,
    nombreOublies: agregat.nombreOublies,
    nombreEchecs: agregat.nombreEchecs,
    ancienneteMoyenne: calculerMoyenneGroupe_(agregat.anciennetes),
    scoreMoyen: calculerMoyenneGroupe_(agregat.scoresConcernes),
    scoreMaximum: agregat.scoresConcernes.length
      ? Math.max.apply(null, agregat.scoresConcernes)
      : 0,
    recommandationsIndividuelles: agregat.recommandationsIndividuelles.slice(),
    niveauxIndividuels: agregat.niveauxIndividuels.slice()
  };
}


function comparerPrioritesGroupe_(a, b) {
  return b.scoreMoyen - a.scoreMoyen ||
    b.scoreMaximum - a.scoreMaximum ||
    b.nombreStagiairesConcernes - a.nombreStagiairesConcernes ||
    comparerOrdreItemsGroupe_(a, b);
}


function construireRecommandationsGroupe_(priorites) {
  return priorites.filter(function (priorite) {
    return priorite.recommandationsIndividuelles.length > 0;
  }).slice(0, NOMBRE_MAX_RECOMMANDATIONS_GROUPE_)
    .map(function (priorite, position) {
      const motifs = compterMotifsRecommandationsGroupe_(
        priorite.recommandationsIndividuelles
      );
      return {
        rang: position + 1,
        idItem: priorite.idItem,
        item: priorite.item,
        categorie: priorite.categorie,
        score: priorite.scoreMoyen,
        niveau: choisirNiveauRecommandationGroupe_(
          priorite.recommandationsIndividuelles
        ),
        justification: construireJustificationGroupe_(priorite, motifs),
        nombreStagiairesConcernes: priorite.nombreStagiairesConcernes,
        nombreJamaisAcquis: priorite.nombreJamaisAcquis,
        nombreOublies: priorite.nombreOublies,
        nombreEchecs: priorite.nombreEchecs,
        motifs: motifs.map(function (motif) {
          return motif.texte;
        })
      };
    });
}


function compterMotifsRecommandationsGroupe_(recommandations) {
  const compteurs = new Map();

  recommandations.forEach(function (recommandation) {
    (recommandation.motifs || []).forEach(function (motif) {
      compteurs.set(motif, (compteurs.get(motif) || 0) + 1);
    });
  });

  return Array.from(compteurs.entries()).map(function (entree) {
    return { texte: entree[0], nombre: entree[1] };
  }).sort(function (a, b) {
    return b.nombre - a.nombre || a.texte.localeCompare(b.texte);
  });
}


function construireJustificationGroupe_(priorite, motifs) {
  const parties = [
    'Classé prioritaire dans ' + priorite.nombreStagiairesConcernes +
      ' analyse(s) individuelle(s).'
  ];

  motifs.forEach(function (motif) {
    parties.push(
      motif.texte + ' (' + motif.nombre + ' stagiaire(s)).'
    );
  });

  return parties.join(' ');
}


function choisirNiveauRecommandationGroupe_(recommandations) {
  if (!recommandations.length) {
    return '';
  }

  return recommandations.slice().sort(function (a, b) {
    return Number(b.scorePriorite || 0) - Number(a.scorePriorite || 0) ||
      Number(a.rang || 0) - Number(b.rang || 0);
  })[0].niveauPriorite || '';
}


/**
 * Indicateur purement descriptif : 100 moins l'écart absolu moyen entre les
 * taux individuels d'acquisition. Aucun seuil pédagogique n'est introduit.
 */
function calculerHomogeneiteGroupe_(analyses) {
  if (!analyses.length) {
    return 0;
  }
  if (analyses.length === 1) {
    return 100;
  }

  const taux = analyses.map(function (analyse) {
    const synthese = analyse.synthese || {};
    const total = Number(synthese.nombreItemsReferentielActifs) || 0;
    const acquis = Number(synthese.nombreItemsAcquis) || 0;
    return total ? acquis / total * 100 : 0;
  });
  let totalEcarts = 0;
  let nombreEcarts = 0;

  for (let premier = 0; premier < taux.length; premier++) {
    for (let second = premier + 1; second < taux.length; second++) {
      totalEcarts += Math.abs(taux[premier] - taux[second]);
      nombreEcarts++;
    }
  }

  return arrondirGroupe_(
    Math.max(0, Math.min(100, 100 - totalEcarts / nombreEcarts)),
    1
  );
}


function calculerMoyenneGroupe_(valeurs) {
  if (!valeurs.length) {
    return 0;
  }
  return arrondirGroupe_(
    valeurs.reduce(function (total, valeur) {
      return total + Number(valeur || 0);
    }, 0) / valeurs.length,
    1
  );
}


function calculerMedianeGroupe_(valeurs) {
  if (!valeurs.length) {
    return 0;
  }
  const tries = valeurs.map(Number).sort(function (a, b) {
    return a - b;
  });
  const milieu = Math.floor(tries.length / 2);
  return arrondirGroupe_(
    tries.length % 2
      ? tries[milieu]
      : (tries[milieu - 1] + tries[milieu]) / 2,
    1
  );
}


function calculerEcartTypeGroupe_(valeurs) {
  if (!valeurs.length) {
    return 0;
  }
  const moyenne = valeurs.reduce(function (total, valeur) {
    return total + Number(valeur || 0);
  }, 0) / valeurs.length;
  const variance = valeurs.reduce(function (total, valeur) {
    return total + Math.pow(Number(valeur || 0) - moyenne, 2);
  }, 0) / valeurs.length;
  return arrondirGroupe_(Math.sqrt(variance), 1);
}


function arrondirGroupe_(valeur, decimales) {
  const facteur = Math.pow(10, Number(decimales || 0));
  return Math.round((Number(valeur) || 0) * facteur) / facteur;
}


function comparerOrdreItemsGroupe_(a, b) {
  return Number(a.ordreCategorie) - Number(b.ordreCategorie) ||
    Number(a.ordreItem) - Number(b.ordreItem) ||
    String(a.idItem).localeCompare(String(b.idItem));
}


function resumerItemStatistiqueGroupe_(item) {
  return {
    idItem: item.idItem,
    item: item.item,
    categorie: item.categorie,
    nombreStagiairesConcernes: item.nombreStagiairesConcernes,
    scoreMoyen: item.scoreMoyen,
    scoreMaximum: item.scoreMaximum
  };
}


function resumerPrioriteGroupe_(item) {
  const motifs = compterMotifsRecommandationsGroupe_(
    item.recommandationsIndividuelles
  );
  return {
    rang: item.rang,
    idItem: item.idItem,
    item: item.item,
    idCategorie: item.idCategorie,
    categorie: item.categorie,
    nombreStagiairesConcernes: item.nombreStagiairesConcernes,
    scoreMoyen: item.scoreMoyen,
    scoreMaximum: item.scoreMaximum,
    nombreJamaisAcquis: item.nombreJamaisAcquis,
    nombreOublies: item.nombreOublies,
    nombreEchecs: item.nombreEchecs,
    ancienneteMoyenne: item.ancienneteMoyenne,
    niveauPriorite: choisirNiveauRecommandationGroupe_(
      item.recommandationsIndividuelles
    ),
    motifs: motifs.map(function (motif) {
      return motif.texte;
    })
  };
}


function comparerIdentitesAssistantPedagogique_(a, b) {
  return String(a.nom || '').localeCompare(
    String(b.nom || ''),
    'fr',
    { sensitivity: 'base' }
  ) || String(a.prenom || '').localeCompare(
    String(b.prenom || ''),
    'fr',
    { sensitivity: 'base' }
  ) || String(a.uuid).localeCompare(String(b.uuid));
}


function fusionnerAvertissementsGroupe_(destination, source) {
  (source || []).forEach(function (message) {
    if (!destination.includes(message) && destination.length < 100) {
      destination.push(message);
    }
  });
}


function construireResultatGroupeVide_(debutCalcul) {
  const finCalcul = Date.now();
  return {
    analyseGlobale: {
      nombreStagiaires: 0,
      nombreItemsActifs: 0,
      nombreItemsTravailles: 0,
      nombreItemsAcquis: 0,
      nombreItemsJamaisAcquis: 0,
      homogeneite: 0,
      stagiairesConcernesParItem: []
    },
    priorites: [],
    recommandations: [],
    detailsStagiaires: [],
    statistiques: {
      itemsMaitrisesParToutLeGroupe: [],
      itemsCritiques: [],
      itemsJamaisTravaillesParAuMoinsUnStagiaire: [],
      dispersionScores: 0,
      moyenneScores: 0,
      medianeScores: 0
    },
    perimetre: {
      stagiaires: [],
      nombreMaxPriorites: NOMBRE_MAX_PRIORITES_GROUPE_,
      nombreMaxRecommandations: NOMBRE_MAX_RECOMMANDATIONS_GROUPE_,
      sourceRegles: 'AnalysePedagogiqueService.js'
    },
    avertissements: [],
    meta: {
      versionFormat: 1,
      versionApplication: obtenirVersionApplication_(),
      calculeA: new Date(finCalcul).toISOString(),
      dureeCalculMs: finCalcul - debutCalcul,
      nombreAnalysesCache: 0,
      nombreAnalysesCalculees: 0,
      lectureTablesEffectuee: false,
      donneesPartielles: false,
      avertissements: []
    }
  };
}
