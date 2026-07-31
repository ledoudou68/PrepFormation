'use strict';

const CONFIG_CATEGORIES_REFERENTIEL = {
  feuille: 'CATEGORIES',
  colonnes: [
    'ID_CATEGORIE',
    'FORMATION',
    'CATEGORIE',
    'ORDRE',
    'ACTIF'
  ]
};

const CONFIG_ITEMS_REFERENTIEL = {
  feuille: 'REFERENTIEL',
  colonnes: [
    'ID_ITEM',
    'FORMATION',
    'ID_CATEGORIE',
    'ITEM',
    'DESCRIPTION',
    'ORDRE',
    'ACTIF'
  ]
};


/**
 * Retourne les catégories d'une formation dans leur ordre.
 */
function getCategoriesReferentiel(formation) {
  const formationDemandee = nettoyerFormationReferentiel_(
    formation
  );

  if (!formationDemandee) {
    return [];
  }

  const donnees = preparerDonneesReferentiel_();
  const idsUtilises = obtenirIdsItemsUtilisesReferentiel_();
  const items = lireItemsReferentiel_(donnees.feuilleItems);

  return lireCategoriesReferentiel_(donnees.feuilleCategories)
    .filter(function (categorie) {
      return categorie.formation === formationDemandee;
    })
    .map(function (categorie) {
      const itemsCategorie = items.filter(function (item) {
        return item.idCategorie === categorie.idCategorie;
      });

      return {
        idCategorie: categorie.idCategorie,
        formation: categorie.formation,
        ordre: categorie.ordre,
        intitule: categorie.intitule,
        actif: categorie.actif,
        nombreItems: itemsCategorie.length,
        utilisee: itemsCategorie.some(function (item) {
          return idsUtilises.has(item.idItem);
        })
      };
    });
}


/**
 * Retourne tous les items d'une formation, catégories puis items ordonnés.
 */
function getItemsReferentiel(formation) {
  const formationDemandee = nettoyerFormationReferentiel_(
    formation
  );

  if (!formationDemandee) {
    return [];
  }

  const donnees = preparerDonneesReferentiel_();
  const categories = lireCategoriesReferentiel_(
    donnees.feuilleCategories
  );

  const categoriesParId = {};

  categories.forEach(function (categorie) {
    categoriesParId[categorie.idCategorie] = categorie;
  });

  const idsUtilises = obtenirIdsItemsUtilisesReferentiel_();

  return lireItemsReferentiel_(donnees.feuilleItems)
    .filter(function (item) {
      return item.formation === formationDemandee;
    })
    .map(function (item) {
      const categorie = categoriesParId[item.idCategorie];

      return {
        idItem: item.idItem,
        formation: item.formation,
        idCategorie: item.idCategorie,
        categorie: categorie
          ? categorie.intitule
          : 'Catégorie introuvable',
        ordreCategorie: categorie
          ? categorie.ordre
          : 999999,
        categorieActive: Boolean(
          categorie && categorie.actif
        ),
        ordre: item.ordre,
        intitule: item.intitule,
        description: item.description,
        actif: item.actif,
        utilise: idsUtilises.has(item.idItem)
      };
    })
    .sort(function (a, b) {
      return (
        a.ordreCategorie - b.ordreCategorie ||
        a.ordre - b.ordre ||
        a.intitule.localeCompare(
          b.intitule,
          'fr',
          { sensitivity: 'base' }
        )
      );
    });
}


/**
 * Crée ou modifie une catégorie pédagogique.
 */
function enregistrerCategorieReferentiel(donnees) {
  verifierCategorieReferentiel_(donnees);

  return avecVerrouReferentiel_(function () {
    const preparation = preparerDonneesReferentiel_();
    const feuille = preparation.feuilleCategories;
    const categories = lireCategoriesReferentiel_(feuille);
    const formation = nettoyerFormationReferentiel_(
      donnees.formation
    );

    const idCategorie = String(
      donnees.idCategorie || Utilities.getUuid()
    );

    const categorieExistante = categories.find(
      function (categorie) {
        return categorie.idCategorie === idCategorie;
      }
    );

    if (donnees.idCategorie && !categorieExistante) {
      throw new Error('Catégorie pédagogique introuvable.');
    }

    if (
      categorieExistante &&
      categorieExistante.formation !== formation
    ) {
      throw new Error(
        'Une catégorie ne peut pas changer de formation.'
      );
    }

    const categoriesFormation = categories.filter(
      function (categorie) {
        return categorie.formation === formation;
      }
    );

    const nombreFinal = categoriesFormation.length +
      (categorieExistante ? 0 : 1);

    const ordre = bornerOrdreReferentiel_(
      donnees.ordre,
      nombreFinal
    );

    const index = obtenirIndexReferentiel_(feuille);
    const ligne = categorieExistante
      ? feuille
        .getRange(
          categorieExistante.numeroLigne,
          1,
          1,
          feuille.getLastColumn()
        )
        .getValues()[0]
      : new Array(feuille.getLastColumn()).fill('');

    ligne[index.ID_CATEGORIE] = idCategorie;
    ligne[index.FORMATION] = formation;
    ligne[index.CATEGORIE] = String(
      donnees.intitule || ''
    ).trim();
    ligne[index.ORDRE] = ordre;
    ligne[index.ACTIF] = convertirActifReferentiel_(
      donnees.actif
    )
      ? 'Oui'
      : 'Non';

    if (categorieExistante) {
      feuille
        .getRange(
          categorieExistante.numeroLigne,
          1,
          1,
          ligne.length
        )
        .setValues([ligne]);
    } else {
      feuille.appendRow(ligne);
    }

    positionnerCategorieReferentiel_(
      feuille,
      formation,
      idCategorie,
      ordre
    );

    return {
      succes: true,
      idCategorie: idCategorie,
      message: donnees.idCategorie
        ? 'Catégorie modifiée.'
        : 'Catégorie ajoutée.'
    };
  });
}


/**
 * Crée ou modifie un item pédagogique.
 */
function enregistrerItemReferentiel(donnees) {
  verifierItemReferentiel_(donnees);

  return avecVerrouReferentiel_(function () {
    const preparation = preparerDonneesReferentiel_();
    const feuille = preparation.feuilleItems;
    const categories = lireCategoriesReferentiel_(
      preparation.feuilleCategories
    );

    const items = lireItemsReferentiel_(feuille);
    const formation = nettoyerFormationReferentiel_(
      donnees.formation
    );

    const idCategorie = String(
      donnees.idCategorie || ''
    );

    const categorie = categories.find(function (element) {
      return (
        element.idCategorie === idCategorie &&
        element.formation === formation
      );
    });

    if (!categorie) {
      throw new Error(
        'La catégorie sélectionnée est introuvable pour cette formation.'
      );
    }

    const idItem = String(
      donnees.idItem || Utilities.getUuid()
    );

    const itemExistant = items.find(function (item) {
      return item.idItem === idItem;
    });

    if (donnees.idItem && !itemExistant) {
      throw new Error('Item pédagogique introuvable.');
    }

    if (
      itemExistant &&
      itemExistant.formation !== formation
    ) {
      throw new Error(
        'Un item ne peut pas changer de formation.'
      );
    }

    const idsUtilises = obtenirIdsItemsUtilisesReferentiel_();

    if (
      itemExistant &&
      idsUtilises.has(itemExistant.idItem) &&
      itemExistant.idCategorie !== idCategorie
    ) {
      throw new Error(
        'La catégorie d’un item déjà utilisé ne peut pas être modifiée afin de préserver l’historique.'
      );
    }

    const itemsCategorie = items.filter(function (item) {
      return item.idCategorie === idCategorie;
    });

    const nombreFinal = itemsCategorie.length +
      (
        itemExistant &&
        itemExistant.idCategorie === idCategorie
          ? 0
          : 1
      );

    const ordre = bornerOrdreReferentiel_(
      donnees.ordre,
      nombreFinal
    );

    const ancienneCategorie = itemExistant
      ? itemExistant.idCategorie
      : '';

    const index = obtenirIndexReferentiel_(feuille);
    const ligne = itemExistant
      ? feuille
        .getRange(
          itemExistant.numeroLigne,
          1,
          1,
          feuille.getLastColumn()
        )
        .getValues()[0]
      : new Array(feuille.getLastColumn()).fill('');

    ligne[index.ID_ITEM] = idItem;
    ligne[index.FORMATION] = formation;
    ligne[index.ID_CATEGORIE] = idCategorie;
    ligne[index.ITEM] = String(
      donnees.intitule || ''
    ).trim();
    ligne[index.DESCRIPTION] = String(
      donnees.description || ''
    ).trim();
    ligne[index.ORDRE] = ordre;
    ligne[index.ACTIF] = convertirActifReferentiel_(
      donnees.actif
    )
      ? 'Oui'
      : 'Non';

    if (itemExistant) {
      feuille
        .getRange(
          itemExistant.numeroLigne,
          1,
          1,
          ligne.length
        )
        .setValues([ligne]);
    } else {
      feuille.appendRow(ligne);
    }

    positionnerItemReferentiel_(
      feuille,
      idCategorie,
      idItem,
      ordre
    );

    if (
      ancienneCategorie &&
      ancienneCategorie !== idCategorie
    ) {
      normaliserOrdreItemsReferentiel_(
        feuille,
        ancienneCategorie
      );
    }

    return {
      succes: true,
      idItem: idItem,
      message: donnees.idItem
        ? 'Item pédagogique modifié.'
        : 'Item pédagogique ajouté.'
    };
  });
}


function deplacerCategorieReferentiel(idCategorie, direction) {
  return deplacerElementReferentiel_(
    'categorie',
    idCategorie,
    direction
  );
}


function deplacerItemReferentiel(idItem, direction) {
  return deplacerElementReferentiel_(
    'item',
    idItem,
    direction
  );
}


function basculerActifCategorieReferentiel(
  idCategorie,
  actif
) {
  const preparation = preparerDonneesReferentiel_();
  const feuille = preparation.feuilleCategories;
  const categorie = lireCategoriesReferentiel_(feuille)
    .find(function (element) {
      return element.idCategorie === String(idCategorie);
    });

  if (!categorie) {
    throw new Error('Catégorie pédagogique introuvable.');
  }

  const nouvelEtat = convertirActifReferentiel_(actif);
  const index = obtenirIndexReferentiel_(feuille);

  feuille
    .getRange(
      categorie.numeroLigne,
      index.ACTIF + 1
    )
    .setValue(nouvelEtat ? 'Oui' : 'Non');

  return {
    succes: true,
    message: nouvelEtat
      ? 'Catégorie activée.'
      : 'Catégorie désactivée.'
  };
}


function basculerActifItemReferentiel(idItem, actif) {
  return avecVerrouReferentiel_(function () {
    const preparation = preparerDonneesReferentiel_();
    const feuille = preparation.feuilleItems;
    const item = lireItemsReferentiel_(feuille).find(
      function (element) {
        return element.idItem === String(idItem);
      }
    );

    if (!item) {
      throw new Error('Item pédagogique introuvable.');
    }

    const nouvelEtat = convertirActifReferentiel_(actif);
    const index = obtenirIndexReferentiel_(feuille);

    feuille
      .getRange(item.numeroLigne, index.ACTIF + 1)
      .setValue(nouvelEtat ? 'Oui' : 'Non');

    SpreadsheetApp.flush();

    return {
      succes: true,
      actif: nouvelEtat,
      message: nouvelEtat
        ? 'Item activé.'
        : 'Item désactivé.'
    };
  });
}


/**
 * Supprime une catégorie jamais utilisée, sinon la désactive.
 */
function supprimerCategorieReferentiel(idCategorie) {
  return avecVerrouReferentiel_(function () {
    const preparation = preparerDonneesReferentiel_();
    const feuilleCategories = preparation.feuilleCategories;
    const feuilleItems = preparation.feuilleItems;
    const categorie = lireCategoriesReferentiel_(
      feuilleCategories
    ).find(function (element) {
      return element.idCategorie === String(idCategorie);
    });

    if (!categorie) {
      throw new Error('Catégorie pédagogique introuvable.');
    }

    const itemsCategorie = lireItemsReferentiel_(
      feuilleItems
    ).filter(function (item) {
      return item.idCategorie === categorie.idCategorie;
    });

    const idsUtilises = obtenirIdsItemsUtilisesReferentiel_();
    const categorieUtilisee = itemsCategorie.some(
      function (item) {
        return idsUtilises.has(item.idItem);
      }
    );

    if (categorieUtilisee) {
      const index = obtenirIndexReferentiel_(
        feuilleCategories
      );

      feuilleCategories
        .getRange(
          categorie.numeroLigne,
          index.ACTIF + 1
        )
        .setValue('Non');

      return {
        succes: true,
        supprime: false,
        desactive: true,
        message: 'Cette catégorie a déjà été utilisée : elle a été désactivée afin de préserver l’historique.'
      };
    }

    itemsCategorie
      .slice()
      .sort(function (a, b) {
        return b.numeroLigne - a.numeroLigne;
      })
      .forEach(function (item) {
        feuilleItems.deleteRow(item.numeroLigne);
      });

    feuilleCategories.deleteRow(categorie.numeroLigne);

    normaliserOrdreCategoriesReferentiel_(
      feuilleCategories,
      categorie.formation
    );

    return {
      succes: true,
      supprime: true,
      desactive: false,
      message: 'Catégorie et items inutilisés supprimés.'
    };
  });
}


/**
 * Supprime un item jamais utilisé, sinon le désactive.
 */
function supprimerItemReferentiel(idItem) {
  return avecVerrouReferentiel_(function () {
    const preparation = preparerDonneesReferentiel_();
    const feuille = preparation.feuilleItems;
    const item = lireItemsReferentiel_(feuille).find(
      function (element) {
        return element.idItem === String(idItem);
      }
    );

    if (!item) {
      throw new Error('Item pédagogique introuvable.');
    }

    const idsUtilises = obtenirIdsItemsUtilisesReferentiel_();

    if (idsUtilises.has(item.idItem)) {
      const index = obtenirIndexReferentiel_(feuille);

      feuille
        .getRange(item.numeroLigne, index.ACTIF + 1)
        .setValue('Non');

      return {
        succes: true,
        supprime: false,
        desactive: true,
        message: 'Cet item a déjà été utilisé : il a été désactivé afin de préserver l’historique.'
      };
    }

    feuille.deleteRow(item.numeroLigne);
    normaliserOrdreItemsReferentiel_(
      feuille,
      item.idCategorie
    );

    return {
      succes: true,
      supprime: true,
      desactive: false,
      message: 'Item pédagogique supprimé.'
    };
  });
}


function preparerDonneesReferentiel_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const feuilleCategories = obtenirFeuilleStructuree_(
    classeur,
    CONFIG_CATEGORIES_REFERENTIEL
  );

  const feuilleItems = obtenirFeuilleStructuree_(
    classeur,
    CONFIG_ITEMS_REFERENTIEL
  );

  migrerItemsSansCategorieReferentiel_(
    feuilleCategories,
    feuilleItems
  );

  return {
    feuilleCategories: feuilleCategories,
    feuilleItems: feuilleItems
  };
}


function obtenirFeuilleStructuree_(classeur, configuration) {
  let feuille = classeur.getSheetByName(
    configuration.feuille
  );

  if (!feuille) {
    feuille = classeur.insertSheet(configuration.feuille);
  }

  if (
    feuille.getLastRow() < 1 ||
    feuille.getLastColumn() < 1
  ) {
    feuille
      .getRange(
        1,
        1,
        1,
        configuration.colonnes.length
      )
      .setValues([configuration.colonnes]);
  }

  let entetes = feuille
    .getRange(1, 1, 1, feuille.getLastColumn())
    .getValues()[0];

  let index = creerIndexReferentiel_(entetes);

  configuration.colonnes.forEach(function (colonne) {
    if (Number.isInteger(index[colonne])) {
      return;
    }

    const nouvelleColonne = feuille.getLastColumn() + 1;
    feuille
      .getRange(1, nouvelleColonne)
      .setValue(colonne);

    entetes.push(colonne);
    index = creerIndexReferentiel_(entetes);
  });

  feuille
    .getRange(1, 1, 1, feuille.getLastColumn())
    .setFontWeight('bold');

  feuille.setFrozenRows(1);
  return feuille;
}


/**
 * Rattache sans perte les anciens items orphelins à une catégorie créée.
 */
function migrerItemsSansCategorieReferentiel_(
  feuilleCategories,
  feuilleItems
) {
  const categories = lireCategoriesReferentiel_(
    feuilleCategories
  );

  const items = lireItemsReferentiel_(feuilleItems);
  const categoriesParId = {};

  categories.forEach(function (categorie) {
    categoriesParId[categorie.idCategorie] = categorie;
  });

  const indexItems = obtenirIndexReferentiel_(feuilleItems);
  const categoriesMigration = {};

  items.forEach(function (item) {
    const categorie = categoriesParId[item.idCategorie];

    if (
      categorie &&
      categorie.formation === item.formation
    ) {
      return;
    }

    if (!item.formation) {
      return;
    }

    let categorieMigration =
      categoriesMigration[item.formation] ||
      categories.find(function (element) {
        return (
          element.formation === item.formation &&
          element.intitule.toLowerCase() ===
            'items pédagogiques'
        );
      });

    if (!categorieMigration) {
      const categoriesFormation = categories.filter(
        function (element) {
          return element.formation === item.formation;
        }
      );

      const ligne = new Array(
        feuilleCategories.getLastColumn()
      ).fill('');

      const indexCategories = obtenirIndexReferentiel_(
        feuilleCategories
      );

      categorieMigration = {
        idCategorie: Utilities.getUuid(),
        formation: item.formation,
        intitule: 'Items pédagogiques',
        ordre: categoriesFormation.length + 1,
        actif: true
      };

      ligne[indexCategories.ID_CATEGORIE] =
        categorieMigration.idCategorie;
      ligne[indexCategories.FORMATION] = item.formation;
      ligne[indexCategories.CATEGORIE] =
        categorieMigration.intitule;
      ligne[indexCategories.ORDRE] =
        categorieMigration.ordre;
      ligne[indexCategories.ACTIF] = 'Oui';

      feuilleCategories.appendRow(ligne);
      categories.push(categorieMigration);
      categoriesParId[categorieMigration.idCategorie] =
        categorieMigration;
    }

    categoriesMigration[item.formation] =
      categorieMigration;

    feuilleItems
      .getRange(
        item.numeroLigne,
        indexItems.ID_CATEGORIE + 1
      )
      .setValue(categorieMigration.idCategorie);
  });
}


function lireCategoriesReferentiel_(feuille) {
  if (feuille.getLastRow() < 2) {
    return [];
  }

  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexReferentiel_(donnees[0]);

  return donnees
    .slice(1)
    .map(function (ligne, position) {
      const idCategorie = String(
        ligne[index.ID_CATEGORIE] || ''
      );

      if (!idCategorie) {
        return null;
      }

      return {
        idCategorie: idCategorie,
        formation: String(
          ligne[index.FORMATION] || ''
        ).trim(),
        intitule: String(
          ligne[index.CATEGORIE] || ''
        ).trim(),
        ordre: lireOrdreReferentiel_(
          ligne[index.ORDRE]
        ),
        actif: convertirActifReferentiel_(
          ligne[index.ACTIF]
        ),
        numeroLigne: position + 2
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (
        a.formation.localeCompare(
          b.formation,
          'fr',
          { sensitivity: 'base' }
        ) ||
        a.ordre - b.ordre ||
        a.numeroLigne - b.numeroLigne
      );
    });
}


function lireItemsReferentiel_(feuille) {
  if (feuille.getLastRow() < 2) {
    return [];
  }

  const donnees = feuille.getDataRange().getValues();
  const index = creerIndexReferentiel_(donnees[0]);

  return donnees
    .slice(1)
    .map(function (ligne, position) {
      const idItem = String(ligne[index.ID_ITEM] || '');

      if (!idItem) {
        return null;
      }

      return {
        idItem: idItem,
        formation: String(
          ligne[index.FORMATION] || ''
        ).trim(),
        idCategorie: String(
          ligne[index.ID_CATEGORIE] || ''
        ),
        intitule: String(
          ligne[index.ITEM] || ''
        ).trim(),
        description: String(
          ligne[index.DESCRIPTION] || ''
        ).trim(),
        ordre: lireOrdreReferentiel_(
          ligne[index.ORDRE]
        ),
        actif: convertirActifReferentiel_(
          ligne[index.ACTIF]
        ),
        numeroLigne: position + 2
      };
    })
    .filter(Boolean);
}


function obtenirIdsItemsUtilisesReferentiel_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const ids = new Set();

  ['EVALUATIONS', 'ITEMS_SESSIONS'].forEach(
    function (nomFeuille) {
      const feuille = classeur.getSheetByName(
        nomFeuille
      );

      if (!feuille || feuille.getLastRow() < 2) {
        return;
      }

      const donnees = feuille.getDataRange().getValues();
      const index = creerIndexReferentiel_(donnees[0]);

      if (!Number.isInteger(index.ID_ITEM)) {
        return;
      }

      donnees.slice(1).forEach(function (ligne) {
        const idItem = String(
          ligne[index.ID_ITEM] || ''
        );

        if (idItem) {
          ids.add(idItem);
        }
      });
    }
  );

  return ids;
}


function deplacerElementReferentiel_(
  type,
  identifiant,
  direction
) {
  const sens = Number(direction);

  if (![ -1, 1 ].includes(sens)) {
    throw new Error('Direction de déplacement invalide.');
  }

  return avecVerrouReferentiel_(function () {
    const preparation = preparerDonneesReferentiel_();
    const estCategorie = type === 'categorie';
    const feuille = estCategorie
      ? preparation.feuilleCategories
      : preparation.feuilleItems;

    const elements = estCategorie
      ? lireCategoriesReferentiel_(feuille)
      : lireItemsReferentiel_(feuille);

    const cle = estCategorie
      ? 'idCategorie'
      : 'idItem';

    const element = elements.find(function (item) {
      return item[cle] === String(identifiant);
    });

    if (!element) {
      throw new Error(
        estCategorie
          ? 'Catégorie pédagogique introuvable.'
          : 'Item pédagogique introuvable.'
      );
    }

    const groupe = elements.filter(function (item) {
      return estCategorie
        ? item.formation === element.formation
        : item.idCategorie === element.idCategorie;
    }).sort(function (a, b) {
      return a.ordre - b.ordre ||
        a.numeroLigne - b.numeroLigne;
    });

    const position = groupe.findIndex(function (item) {
      return item[cle] === element[cle];
    });

    const nouvellePosition = position + sens;

    if (
      nouvellePosition < 0 ||
      nouvellePosition >= groupe.length
    ) {
      return {
        succes: true,
        message: 'L’élément est déjà en limite de liste.'
      };
    }

    const deplace = groupe.splice(position, 1)[0];
    groupe.splice(nouvellePosition, 0, deplace);

    enregistrerOrdreReferentiel_(feuille, groupe);

    return {
      succes: true,
      message: 'Ordre mis à jour.'
    };
  });
}


function positionnerCategorieReferentiel_(
  feuille,
  formation,
  idCategorie,
  ordre
) {
  const categories = lireCategoriesReferentiel_(feuille)
    .filter(function (categorie) {
      return categorie.formation === formation;
    });

  positionnerElementReferentiel_(
    feuille,
    categories,
    'idCategorie',
    idCategorie,
    ordre
  );
}


function positionnerItemReferentiel_(
  feuille,
  idCategorie,
  idItem,
  ordre
) {
  const items = lireItemsReferentiel_(feuille)
    .filter(function (item) {
      return item.idCategorie === idCategorie;
    })
    .sort(function (a, b) {
      return a.ordre - b.ordre ||
        a.numeroLigne - b.numeroLigne;
    });

  positionnerElementReferentiel_(
    feuille,
    items,
    'idItem',
    idItem,
    ordre
  );
}


function positionnerElementReferentiel_(
  feuille,
  elements,
  cle,
  identifiant,
  ordre
) {
  const position = elements.findIndex(function (element) {
    return element[cle] === identifiant;
  });

  const element = elements.splice(position, 1)[0];
  elements.splice(ordre - 1, 0, element);
  enregistrerOrdreReferentiel_(feuille, elements);
}


function normaliserOrdreCategoriesReferentiel_(
  feuille,
  formation
) {
  enregistrerOrdreReferentiel_(
    feuille,
    lireCategoriesReferentiel_(feuille)
      .filter(function (categorie) {
        return categorie.formation === formation;
      })
  );
}


function normaliserOrdreItemsReferentiel_(
  feuille,
  idCategorie
) {
  enregistrerOrdreReferentiel_(
    feuille,
    lireItemsReferentiel_(feuille)
      .filter(function (item) {
        return item.idCategorie === idCategorie;
      })
      .sort(function (a, b) {
        return a.ordre - b.ordre ||
          a.numeroLigne - b.numeroLigne;
      })
  );
}


function enregistrerOrdreReferentiel_(feuille, elements) {
  const index = obtenirIndexReferentiel_(feuille);

  elements.forEach(function (element, position) {
    const ordre = position + 1;

    feuille
      .getRange(element.numeroLigne, index.ORDRE + 1)
      .setValue(ordre);

    element.ordre = ordre;
  });
}


function obtenirIndexReferentiel_(feuille) {
  return creerIndexReferentiel_(
    feuille
      .getRange(1, 1, 1, feuille.getLastColumn())
      .getValues()[0]
  );
}


function creerIndexReferentiel_(entetes) {
  const index = {};

  entetes.forEach(function (entete, position) {
    index[normaliserEnteteReferentiel_(entete)] = position;
  });

  return index;
}


function normaliserEnteteReferentiel_(valeur) {
  return String(valeur || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function convertirActifReferentiel_(valeur) {
  if (valeur === true || valeur === 1) {
    return true;
  }

  return [
    'oui',
    'true',
    '1',
    'actif',
    'active'
  ].includes(
    String(valeur || '').trim().toLowerCase()
  );
}


function lireOrdreReferentiel_(valeur) {
  const ordre = Math.trunc(Number(valeur));
  return ordre > 0 ? ordre : 999999;
}


function bornerOrdreReferentiel_(valeur, maximum) {
  const ordre = Math.trunc(Number(valeur));

  if (!ordre || ordre < 1) {
    return maximum;
  }

  return Math.min(ordre, maximum);
}


function nettoyerFormationReferentiel_(formation) {
  return String(formation || '').trim();
}


function verifierCategorieReferentiel_(donnees) {
  if (!donnees) {
    throw new Error('Aucune donnée reçue.');
  }

  verifierFormationActiveReferentiel_(donnees.formation);

  if (!String(donnees.intitule || '').trim()) {
    throw new Error(
      'L’intitulé de la catégorie est obligatoire.'
    );
  }
}


function verifierItemReferentiel_(donnees) {
  if (!donnees) {
    throw new Error('Aucune donnée reçue.');
  }

  verifierFormationActiveReferentiel_(donnees.formation);

  if (!String(donnees.idCategorie || '').trim()) {
    throw new Error('La catégorie est obligatoire.');
  }

  if (!String(donnees.intitule || '').trim()) {
    throw new Error('L’intitulé est obligatoire.');
  }
}


function verifierFormationActiveReferentiel_(formation) {
  const formationDemandee = nettoyerFormationReferentiel_(
    formation
  );

  if (!formationDemandee) {
    throw new Error('La formation est obligatoire.');
  }

  if (!getFormations().includes(formationDemandee)) {
    throw new Error(
      'La formation sélectionnée est inactive ou introuvable.'
    );
  }
}


function avecVerrouReferentiel_(traitement) {
  const verrou = LockService.getDocumentLock();

  if (!verrou.tryLock(30000)) {
    throw new Error(
      'Le référentiel est déjà en cours de modification.'
    );
  }

  try {
    return traitement();
  } finally {
    verrou.releaseLock();
  }
}
