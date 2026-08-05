'use strict';

const COLONNES_HISTORIQUE_ENVOIS_INDEMNISATIONS_ = [
  'ID_ENVOI', 'DATE_ENVOI', 'DESTINATAIRE', 'COPIES',
  'OBJET', 'REFERENCE_DEMANDE', 'ID_PRESTATIONS',
  'NOMBRE_FORMATEURS', 'NOMBRE_SEANCES', 'VOLUME_HEURES',
  'STATUT_ENVOI', 'MESSAGE_ERREUR', 'SESSION_ADMIN',
  'DATE_CREATION'
];
const STATUT_ENVOI_PREPARATION_ = 'EN_COURS_AVANT_ENVOI';
const STATUT_ENVOI_MESSAGE_ENVOYE_ = 'EMAIL_ENVOYE_MAJ_EN_COURS';
const STATUT_ENVOI_TERMINE_ = 'TERMINE';
const STATUT_ENVOI_ECHEC_ = 'ECHEC_ENVOI';
const STATUT_ENVOI_REGULARISATION_ = 'REGULARISATION_REQUISE';


/**
 * Construit une prévisualisation. Cette fonction ne modifie aucune feuille
 * et n'envoie aucun message.
 */
function preparerDemandeIndemnisationEmail(
  donnees,
  jetonAdministrateur
) {
  exigerAdministrateur_(jetonAdministrateur);
  donnees = donnees || {};

  return construireDemandeIndemnisationEmail_(
    donnees.idsPrestations,
    {
      idEnvoi: nettoyerIdentifiantEnvoiIndemnisation_(
        Utilities.getUuid()
      ),
      reference: donnees.reference,
      objet: donnees.objet,
      introduction: donnees.introduction,
      remarqueFinale: donnees.remarqueFinale,
      referenceObligatoire: false,
      refuserIndemnisees: true
    }
  );
}


/**
 * Seul point d'envoi public. Le jeton est revalidé sous verrou juste avant
 * l'envoi et toutes les données calculées sont relues côté serveur.
 */
function envoyerDemandeIndemnisationEmail(
  donnees,
  jetonAdministrateur
) {
  donnees = donnees || {};

  return executerMutationMetier_(function () {
    const session = exigerAdministrateur_(jetonAdministrateur);

    if (!convertirBooleenIndemnisation_(donnees.confirmationFinale)) {
      throw new Error(
        'La confirmation finale est obligatoire avant l’envoi.'
      );
    }

    const demande = construireDemandeIndemnisationEmail_(
      donnees.idsPrestations,
      {
        idEnvoi: nettoyerIdentifiantEnvoiIndemnisation_(
          donnees.idEnvoi
        ),
        reference: donnees.reference,
        objet: donnees.objet,
        introduction: donnees.introduction,
        remarqueFinale: donnees.remarqueFinale,
        referenceObligatoire: true,
        refuserIndemnisees: true
      }
    );

    return envoyerDemandeIndemnisationEmailInterne_(
      demande,
      session
    );
  });
}


function consulterEnvoiIndemnisation(
  idEnvoi,
  jetonAdministrateur
) {
  exigerAdministrateur_(jetonAdministrateur);

  const historique = trouverHistoriqueEnvoiIndemnisation_(
    nettoyerIdentifiantEnvoiIndemnisation_(idEnvoi)
  );

  if (!historique) {
    throw new Error('Historique d’envoi introuvable.');
  }

  let demande = null;
  let avertissement = '';

  try {
    demande = construireDemandeIndemnisationEmail_(
      historique.idsPrestations,
      {
        idEnvoi: historique.idEnvoi,
        reference: historique.reference,
        objet: historique.objet,
        referenceObligatoire: false,
        refuserIndemnisees: false
      }
    );
  } catch (erreur) {
    avertissement =
      'Le détail courant ne peut plus être reconstruit intégralement : ' +
      String(erreur.message || erreur);
  }

  return {
    historique: serialiserHistoriqueEnvoiIndemnisation_(historique),
    demande: demande,
    avertissement: avertissement
  };
}


function envoyerDemandeIndemnisationEmailInterne_(demande, session) {
  const existant = trouverHistoriqueEnvoiIndemnisation_(
    demande.idEnvoi
  );

  if (existant) {
    return traiterReexecutionEnvoiIndemnisation_(
      demande,
      existant
    );
  }

  const historique = creerHistoriqueEnvoiIndemnisation_(
    demande,
    session,
    STATUT_ENVOI_PREPARATION_,
    ''
  );

  try {
    const optionsEnvoi = {
      to: demande.destinataire,
      subject: demande.objet,
      body: demande.corpsTexte,
      htmlBody: demande.corpsHtml,
      name: demande.nomCentre || 'PrepFormation'
    };

    if (demande.copies.length) {
      optionsEnvoi.cc = demande.copies.join(',');
    }

    MailApp.sendEmail(optionsEnvoi);
  } catch (erreurEnvoi) {
    mettreAJourHistoriqueEnvoiIndemnisation_(historique, {
      STATUT_ENVOI: STATUT_ENVOI_ECHEC_,
      MESSAGE_ERREUR: limiterMessageErreurEnvoiIndemnisation_(
        erreurEnvoi
      )
    });

    journaliserActionSensible_(
      'INDEMNISATION_EMAIL_ECHEC',
      'HISTORIQUE_ENVOIS_INDEMNISATIONS',
      demande.idEnvoi,
      {
        nombrePrestations: demande.nombrePrestations,
        statut: STATUT_ENVOI_ECHEC_
      },
      session.identifiantHistorique
    );

    throw new Error(
      'Le message n’a pas été envoyé. Aucune prestation n’a été modifiée. ' +
      limiterMessageErreurEnvoiIndemnisation_(erreurEnvoi)
    );
  }

  try {
    mettreAJourHistoriqueEnvoiIndemnisation_(historique, {
      DATE_ENVOI: new Date(),
      STATUT_ENVOI: STATUT_ENVOI_MESSAGE_ENVOYE_,
      MESSAGE_ERREUR: ''
    });
  } catch (erreurTrace) {
    throw new Error(
      'Le courriel a été envoyé, mais sa confirmation n’a pas pu être ' +
      'enregistrée. Ne renvoie pas la demande. ID d’envoi : ' +
      demande.idEnvoi + '. ' +
      limiterMessageErreurEnvoiIndemnisation_(erreurTrace)
    );
  }

  try {
    mettreAJourPrestationsApresEnvoi_(demande, session);
    mettreAJourHistoriqueEnvoiIndemnisation_(historique, {
      STATUT_ENVOI: STATUT_ENVOI_TERMINE_,
      MESSAGE_ERREUR: ''
    });

    journaliserActionSensible_(
      'INDEMNISATION_EMAIL_ENVOI',
      'HISTORIQUE_ENVOIS_INDEMNISATIONS',
      demande.idEnvoi,
      {
        nombrePrestations: demande.nombrePrestations,
        nombreFormateurs: demande.nombreFormateurs,
        nombreSeances: demande.nombreSeances,
        volumeHeures: demande.volumeHeures,
        reference: demande.reference
      },
      session.identifiantHistorique
    );
  } catch (erreurMiseAJour) {
    try {
      mettreAJourHistoriqueEnvoiIndemnisation_(historique, {
        STATUT_ENVOI: STATUT_ENVOI_REGULARISATION_,
        MESSAGE_ERREUR: limiterMessageErreurEnvoiIndemnisation_(
          erreurMiseAJour
        )
      });
    } catch (erreurTraceFinale) {
      // La ligne durable créée avant MailApp reste volontairement présente.
    }

    throw new Error(
      'Le courriel a été envoyé, mais la mise à jour des prestations a ' +
      'échoué. Ne renvoie pas la demande. Une régularisation est requise. ' +
      'ID d’envoi : ' + demande.idEnvoi + '. ' +
      limiterMessageErreurEnvoiIndemnisation_(erreurMiseAJour)
    );
  }

  return {
    succes: true,
    idEnvoi: demande.idEnvoi,
    destinataire: demande.destinataire,
    copies: demande.copies,
    nombrePrestations: demande.nombrePrestations,
    nombreFormateurs: demande.nombreFormateurs,
    nombreSeances: demande.nombreSeances,
    volumeHeures: demande.volumeHeures,
    volumeHeuresLibelle: demande.volumeHeuresLibelle,
    reference: demande.reference,
    message: 'Demande d’indemnisation envoyée et prestations mises à jour.'
  };
}


function traiterReexecutionEnvoiIndemnisation_(demande, historique) {
  const etat = verifierPrestationsAssocieesEnvoiIndemnisation_(demande);

  if (
    historique.statut === STATUT_ENVOI_TERMINE_ ||
    etat.toutesAssociees
  ) {
    if (etat.toutesAssociees && historique.statut !== STATUT_ENVOI_TERMINE_) {
      mettreAJourHistoriqueEnvoiIndemnisation_(historique, {
        STATUT_ENVOI: STATUT_ENVOI_TERMINE_,
        MESSAGE_ERREUR: ''
      });
    }

    return {
      succes: true,
      rejouee: true,
      idEnvoi: demande.idEnvoi,
      destinataire: demande.destinataire,
      copies: demande.copies,
      nombrePrestations: demande.nombrePrestations,
      nombreFormateurs: demande.nombreFormateurs,
      nombreSeances: demande.nombreSeances,
      volumeHeures: demande.volumeHeures,
      volumeHeuresLibelle: demande.volumeHeuresLibelle,
      reference: demande.reference,
      message: 'Cette demande a déjà été envoyée. Aucun nouvel e-mail n’a été émis.'
    };
  }

  throw new Error(
    'Une tentative existe déjà pour cet ID d’envoi (' +
    historique.statut + '). Aucun nouvel e-mail n’a été émis. ' +
    'Vérifie l’historique avant toute action manuelle.'
  );
}


function construireDemandeIndemnisationEmail_(idsDemandes, options) {
  options = options || {};

  const idsPrestations = valeursUniquesIndemnisation_(idsDemandes);

  if (!idsPrestations.length) {
    throw new Error('Sélectionne au moins une prestation.');
  }

  const idEnvoi = nettoyerIdentifiantEnvoiIndemnisation_(
    options.idEnvoi
  );
  const reference = String(options.reference || '')
    .trim()
    .slice(0, 250);

  if (options.referenceObligatoire && !reference) {
    throw new Error('La référence commune de la demande est obligatoire.');
  }

  const parametres = lireParametresEmailIndemnisation_();

  if (!parametres.emailChefCentre) {
    throw new Error(
      'L’adresse e-mail du chef de centre n’est pas configurée dans Administration.'
    );
  }

  if (!adresseEmailValideEnvoiIndemnisation_(
    parametres.emailChefCentre
  )) {
    throw new Error(
      'L’adresse e-mail du chef de centre est invalide : ' +
      parametres.emailChefCentre + '.'
    );
  }

  const contexte = lireContextePrestationsEnvoiIndemnisation_(
    idsPrestations,
    options.refuserIndemnisees !== false,
    idEnvoi
  );
  const formateursSansEmail = contexte.formateurs.filter(
    function (formateur) {
      return !formateur.email ||
        !adresseEmailValideEnvoiIndemnisation_(formateur.email);
    }
  );

  if (formateursSansEmail.length) {
    throw new Error(
      'E-mail manquant ou invalide pour : ' +
      formateursSansEmail.map(function (formateur) {
        return formateur.nomComplet;
      }).join(', ') +
      '. Reviens dans le module Formateurs pour compléter son adresse.'
    );
  }

  const resume = construireResumePrestationsEnvoiIndemnisation_(
    contexte.prestations
  );
  const periode = construirePeriodeEnvoiIndemnisation_(
    contexte.prestations
  );
  const objetModele = String(
    options.objet || parametres.objetMailIndemnisation || ''
  ).trim();

  if (!objetModele) {
    throw new Error(
      'L’objet du message n’est pas configuré dans Administration.'
    );
  }
  const objet = objetModele
    .replace(/\{\{PERIODE\}\}/g, periode)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
  const introduction = String(options.introduction ||
    'Veuillez trouver ci-dessous le récapitulatif des prestations à indemniser.')
    .trim()
    .slice(0, 2000);
  const remarqueFinale = String(options.remarqueFinale ||
    'Je vous remercie par avance pour la prise en compte de cette demande.')
    .trim()
    .slice(0, 2000);
  const destinataire = parametres.emailChefCentre.toLowerCase();
  const copies = dedupliquerEmailsEnvoiIndemnisation_(
    contexte.formateurs.map(function (formateur) {
      return formateur.email;
    }),
    destinataire
  );
  const rendu = rendreCorpsDemandeIndemnisation_(
    resume,
    {
      nomChefCentre: parametres.nomChefCentre,
      nomCentre: parametres.nomCentre,
      introduction: introduction,
      remarqueFinale: remarqueFinale,
      reference: reference,
      periode: periode
    }
  );

  return {
    idEnvoi: idEnvoi,
    idsPrestations: idsPrestations,
    destinataire: destinataire,
    copies: copies,
    objet: objet,
    introduction: introduction,
    remarqueFinale: remarqueFinale,
    reference: reference,
    periode: periode,
    nomCentre: parametres.nomCentre,
    groupes: resume.groupes,
    nombrePrestations: resume.nombrePrestations,
    nombreFormateurs: resume.nombreFormateurs,
    nombreSeances: resume.nombreSeances,
    volumeHeures: resume.volumeHeures,
    volumeHeuresLibelle: resume.volumeHeuresLibelle,
    corpsHtml: rendu.html,
    corpsTexte: rendu.texte
  };
}


function lireContextePrestationsEnvoiIndemnisation_(
  idsPrestations,
  refuserIndemnisees,
  idEnvoiAutorise
) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const prestations = lireTableIndemnisation_(
    classeur,
    'PRESTATIONS_FORMATEURS'
  );
  const sessions = lireTableIndemnisation_(classeur, 'SESSIONS');
  const formateurs = lireTableIndemnisation_(classeur, 'FORMATEURS');
  const presences = lireTableIndemnisation_(
    classeur,
    'PRESENCES_STAGIAIRES'
  );

  verifierColonnesIndemnisation_(prestations, 'PRESTATIONS_FORMATEURS', [
    'ID_PRESTATION', 'ID_SESSION', 'ID_FORMATEUR', 'DUREE_HEURES',
    'STATUT_INDEMNISATION', 'DATE_DEMANDE', 'REFERENCE_DEMANDE',
    'REMARQUES_INDEMNISATION', 'DATE_MODIFICATION', 'ID_ENVOI'
  ]);
  verifierColonnesIndemnisation_(sessions, 'SESSIONS', [
    'ID_SESSION', 'DATE_SESSION', 'HEURE_DEBUT', 'HEURE_FIN',
    'FORMATION'
  ]);
  verifierColonnesIndemnisation_(formateurs, 'FORMATEURS', [
    'ID_FORMATEUR', 'NOM', 'PRENOM', 'EMAIL'
  ]);
  verifierColonnesIndemnisation_(presences, 'PRESENCES_STAGIAIRES', [
    'ID_SESSION', 'ID_STAGIAIRE'
  ]);

  const sessionsParId = {};
  sessions.lignes.forEach(function (ligne) {
    const id = String(ligne[sessions.index.ID_SESSION] || '').trim();
    if (!id) return;
    if (sessionsParId[id]) {
      throw new Error('ID_SESSION dupliqué : ' + id + '.');
    }
    sessionsParId[id] = {
      idSession: id,
      dateSession: convertirDateInterfaceIndemnisation_(
        ligne[sessions.index.DATE_SESSION]
      ),
      heureDebut: convertirHeureInterfaceIndemnisation_(
        ligne[sessions.index.HEURE_DEBUT]
      ),
      heureFin: convertirHeureInterfaceIndemnisation_(
        ligne[sessions.index.HEURE_FIN]
      ),
      formation: String(ligne[sessions.index.FORMATION] || '').trim()
    };
  });

  const presencesParSession = {};
  presences.lignes.forEach(function (ligne) {
    const idSession = String(
      ligne[presences.index.ID_SESSION] || ''
    ).trim();
    const idStagiaire = String(
      ligne[presences.index.ID_STAGIAIRE] || ''
    ).trim();
    if (!idSession || !idStagiaire) return;
    presencesParSession[idSession] =
      presencesParSession[idSession] || new Set();
    presencesParSession[idSession].add(idStagiaire);
  });

  const formateursParId = {};
  formateurs.lignes.forEach(function (ligne) {
    const id = String(
      ligne[formateurs.index.ID_FORMATEUR] || ''
    ).trim();
    if (!id) return;
    if (formateursParId[id]) {
      throw new Error('ID_FORMATEUR dupliqué : ' + id + '.');
    }
    const nom = String(ligne[formateurs.index.NOM] || '').trim();
    const prenom = String(ligne[formateurs.index.PRENOM] || '').trim();
    formateursParId[id] = {
      idFormateur: id,
      nom: nom,
      prenom: prenom,
      nomComplet: [prenom, nom].filter(Boolean).join(' ') || id,
      email: String(ligne[formateurs.index.EMAIL] || '').trim()
    };
  });

  const demandes = new Set(idsPrestations);
  const trouvees = {};
  prestations.lignes.forEach(function (ligne, position) {
    const id = String(
      ligne[prestations.index.ID_PRESTATION] || ''
    ).trim();
    if (!demandes.has(id)) return;
    if (trouvees[id]) {
      throw new Error('ID_PRESTATION dupliqué : ' + id + '.');
    }

    const idSession = String(
      ligne[prestations.index.ID_SESSION] || ''
    ).trim();
    const idFormateur = String(
      ligne[prestations.index.ID_FORMATEUR] || ''
    ).trim();
    const session = sessionsParId[idSession];
    const formateur = formateursParId[idFormateur];

    if (!session) {
      throw new Error('Séance introuvable pour la prestation ' + id + '.');
    }
    if (!formateur) {
      throw new Error('Formateur introuvable pour la prestation ' + id + '.');
    }

    const statut = normaliserStatutIndemnisation_(
      ligne[prestations.index.STATUT_INDEMNISATION]
    );
    const idEnvoiExistant = String(
      ligne[prestations.index.ID_ENVOI] || ''
    ).trim();

    validerEligibilitePrestationEnvoiIndemnisation_(
      id,
      statut,
      idEnvoiExistant,
      idEnvoiAutorise,
      refuserIndemnisees
    );

    trouvees[id] = {
      idPrestation: id,
      numeroLigne: position + 2,
      ligne: ligne.slice(),
      idSession: idSession,
      idFormateur: idFormateur,
      formateur: formateur,
      dateSession: session.dateSession,
      formation: session.formation,
      heureDebut: session.heureDebut,
      heureFin: session.heureFin,
      dureeHeures: convertirNombreIndemnisation_(
        ligne[prestations.index.DUREE_HEURES]
      ),
      nombreStagiaires: presencesParSession[idSession]
        ? presencesParSession[idSession].size
        : 0,
      remarqueAdministrative: String(
        ligne[prestations.index.REMARQUES_INDEMNISATION] || ''
      ).trim(),
      referenceExistante: String(
        ligne[prestations.index.REFERENCE_DEMANDE] || ''
      ).trim(),
      statut: statut,
      idEnvoiExistant: idEnvoiExistant
    };
  });

  const absentes = idsPrestations.filter(function (id) {
    return !trouvees[id];
  });
  if (absentes.length) {
    throw new Error(
      'Prestations introuvables : ' + absentes.join(', ') + '. Aucune donnée n’a été modifiée.'
    );
  }

  const liste = idsPrestations.map(function (id) {
    return trouvees[id];
  });
  const clesPrestations = new Set();

  liste.forEach(function (prestation) {
    const cle = prestation.idSession + '::' + prestation.idFormateur;
    if (clesPrestations.has(cle)) {
      throw new Error(
        'Plusieurs prestations sélectionnées concernent la même séance ' +
        'et le même formateur (' + prestation.idSession + '). ' +
        'Corrige ce doublon avant l’envoi.'
      );
    }
    clesPrestations.add(cle);
  });
  const idsFormateurs = new Set(liste.map(function (prestation) {
    return prestation.idFormateur;
  }));

  return {
    tablePrestations: prestations,
    prestations: liste,
    formateurs: Object.keys(formateursParId)
      .filter(function (id) { return idsFormateurs.has(id); })
      .map(function (id) { return formateursParId[id]; })
  };
}


function validerEligibilitePrestationEnvoiIndemnisation_(
  idPrestation,
  statut,
  idEnvoiExistant,
  idEnvoiAutorise,
  verificationActive
) {
  if (!verificationActive) {
    return true;
  }

  if (statut === 'Indemnisée') {
    throw new Error(
      'La prestation ' + idPrestation +
      ' est déjà indemnisée et ne peut pas être envoyée.'
    );
  }

  if (
    idEnvoiExistant &&
    idEnvoiExistant !== String(idEnvoiAutorise || '')
  ) {
    throw new Error(
      'La prestation ' + idPrestation +
      ' est déjà rattachée à l’envoi ' + idEnvoiExistant +
      '. Aucun nouvel e-mail ne sera émis.'
    );
  }

  return true;
}


function construireResumePrestationsEnvoiIndemnisation_(prestations) {
  const groupesParFormateur = {};

  prestations.forEach(function (prestation) {
    const cle = prestation.idFormateur;
    if (!groupesParFormateur[cle]) {
      groupesParFormateur[cle] = {
        idFormateur: cle,
        nom: prestation.formateur.nom,
        prenom: prestation.formateur.prenom,
        nomComplet: prestation.formateur.nomComplet,
        email: prestation.formateur.email,
        prestations: []
      };
    }
    groupesParFormateur[cle].prestations.push({
      idPrestation: prestation.idPrestation,
      idSession: prestation.idSession,
      dateSession: prestation.dateSession,
      formation: prestation.formation,
      heureDebut: prestation.heureDebut,
      heureFin: prestation.heureFin,
      dureeHeures: prestation.dureeHeures,
      nombreStagiaires: prestation.nombreStagiaires,
      remarqueAdministrative: prestation.remarqueAdministrative,
      referenceExistante: prestation.referenceExistante
    });
  });

  const groupes = Object.keys(groupesParFormateur).map(function (cle) {
    const groupe = groupesParFormateur[cle];
    groupe.prestations.sort(comparerPrestationsEnvoiIndemnisation_);
    groupe.nombreSeances = new Set(groupe.prestations.map(
      function (prestation) { return prestation.idSession; }
    )).size;
    groupe.totalHeures = arrondirHeuresEnvoiIndemnisation_(
      groupe.prestations.reduce(function (total, prestation) {
        return total + Number(prestation.dureeHeures || 0);
      }, 0)
    );
    groupe.totalHeuresLibelle = formaterDureeAmicaleEnvoiIndemnisation_(
      groupe.totalHeures
    );
    return groupe;
  }).sort(function (a, b) {
    return a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }) ||
      a.prenom.localeCompare(b.prenom, 'fr', { sensitivity: 'base' });
  });

  const volumeHeures = arrondirHeuresEnvoiIndemnisation_(
    prestations.reduce(function (total, prestation) {
      return total + Number(prestation.dureeHeures || 0);
    }, 0)
  );

  return {
    groupes: groupes,
    nombrePrestations: prestations.length,
    nombreFormateurs: groupes.length,
    nombreSeances: new Set(prestations.map(function (prestation) {
      return prestation.idSession;
    })).size,
    volumeHeures: volumeHeures,
    volumeHeuresLibelle:
      formaterDureeAmicaleEnvoiIndemnisation_(volumeHeures)
  };
}


function comparerPrestationsEnvoiIndemnisation_(a, b) {
  return String(a.dateSession || '').localeCompare(
    String(b.dateSession || '')
  ) || String(a.heureDebut || '').localeCompare(
    String(b.heureDebut || '')
  ) || String(a.idPrestation || '').localeCompare(
    String(b.idPrestation || '')
  );
}


function rendreCorpsDemandeIndemnisation_(resume, contenu) {
  const salutation = contenu.nomChefCentre
    ? 'Bonjour ' + contenu.nomChefCentre + ','
    : 'Bonjour,';
  const lignesHtml = resume.groupes.map(function (groupe) {
    const prestations = groupe.prestations.map(function (prestation) {
      const referenceOuRemarque = contenu.reference ||
        prestation.referenceExistante ||
        prestation.remarqueAdministrative || '—';
      return '<tr>' +
        '<td>' + echapperHtmlEnvoiIndemnisation_(
          afficherDateFrancaiseEnvoiIndemnisation_(prestation.dateSession)
        ) + '</td>' +
        '<td>' + echapperHtmlEnvoiIndemnisation_(prestation.formation || '—') + '</td>' +
        '<td>' + echapperHtmlEnvoiIndemnisation_(
          (prestation.heureDebut || '—') + ' – ' + (prestation.heureFin || '—')
        ) + '</td>' +
        '<td>' + echapperHtmlEnvoiIndemnisation_(
          formaterDureeAmicaleEnvoiIndemnisation_(prestation.dureeHeures)
        ) + '</td>' +
        '<td style="text-align:center">' + Number(prestation.nombreStagiaires || 0) + '</td>' +
        '<td>' + echapperHtmlEnvoiIndemnisation_(referenceOuRemarque) + '</td>' +
        '</tr>';
    }).join('');

    return '<h2 style="font-size:17px;margin:26px 0 8px;color:#17324d">' +
      echapperHtmlEnvoiIndemnisation_(groupe.nomComplet) + '</h2>' +
      '<table role="presentation" style="border-collapse:collapse;width:100%;font-size:13px">' +
      '<thead><tr style="background:#eef4f8;color:#17324d">' +
      '<th style="padding:8px;border:1px solid #d7e1e8;text-align:left">Date</th>' +
      '<th style="padding:8px;border:1px solid #d7e1e8;text-align:left">Formation</th>' +
      '<th style="padding:8px;border:1px solid #d7e1e8;text-align:left">Horaires</th>' +
      '<th style="padding:8px;border:1px solid #d7e1e8;text-align:left">Durée</th>' +
      '<th style="padding:8px;border:1px solid #d7e1e8;text-align:left">Nombre de stagiaires</th>' +
      '<th style="padding:8px;border:1px solid #d7e1e8;text-align:left">Référence / remarque</th>' +
      '</tr></thead><tbody>' + prestations + '</tbody></table>' +
      '<p style="margin:8px 0"><strong>Total ' +
      echapperHtmlEnvoiIndemnisation_(groupe.nomComplet) + ' :</strong> ' +
      groupe.nombreSeances + ' séance(s), ' +
      echapperHtmlEnvoiIndemnisation_(groupe.totalHeuresLibelle) + '</p>';
  }).join('');

  const html = '<div style="font-family:Arial,sans-serif;color:#243746;line-height:1.5">' +
    '<p>' + echapperHtmlEnvoiIndemnisation_(salutation) + '</p>' +
    '<p>' + convertirTexteEnHtmlEnvoiIndemnisation_(contenu.introduction) + '</p>' +
    lignesHtml +
    '<div style="margin:24px 0;padding:14px;background:#f5f8fa;border-left:4px solid #1b6ca8">' +
    '<strong>Récapitulatif général</strong><br>' +
    resume.nombreSeances + ' séance(s) distincte(s) · ' +
    resume.nombrePrestations + ' prestation(s) · ' +
    resume.nombreFormateurs + ' formateur(s) · ' +
    echapperHtmlEnvoiIndemnisation_(resume.volumeHeuresLibelle) +
    (contenu.reference
      ? '<br>Référence : ' + echapperHtmlEnvoiIndemnisation_(contenu.reference)
      : '') + '</div>' +
    '<p>' + convertirTexteEnHtmlEnvoiIndemnisation_(contenu.remarqueFinale) + '</p>' +
    '<p style="margin-top:28px">Cordialement,<br><strong>' +
    echapperHtmlEnvoiIndemnisation_(contenu.nomCentre || 'PrepFormation') +
    '</strong></p></div>';

  const texteGroupes = resume.groupes.map(function (groupe) {
    return groupe.nomComplet + '\n' + groupe.prestations.map(
      function (prestation) {
        return '- ' + afficherDateFrancaiseEnvoiIndemnisation_(
          prestation.dateSession
        ) + ' | ' + prestation.formation + ' | ' +
          prestation.heureDebut + '–' + prestation.heureFin + ' | ' +
          formaterDureeAmicaleEnvoiIndemnisation_(prestation.dureeHeures) +
          ' | ' + prestation.nombreStagiaires + ' stagiaire(s) | ' +
          (contenu.reference || prestation.referenceExistante ||
            prestation.remarqueAdministrative || '—');
      }
    ).join('\n') + '\nTotal : ' + groupe.nombreSeances +
      ' séance(s), ' + groupe.totalHeuresLibelle;
  }).join('\n\n');

  const texte = salutation + '\n\n' + contenu.introduction + '\n\n' +
    texteGroupes + '\n\nRécapitulatif général : ' +
    resume.nombreSeances + ' séance(s), ' + resume.nombrePrestations +
    ' prestation(s), ' + resume.nombreFormateurs + ' formateur(s), ' +
    resume.volumeHeuresLibelle +
    (contenu.reference ? '\nRéférence : ' + contenu.reference : '') +
    '\n\n' + contenu.remarqueFinale + '\n\nCordialement,\n' +
    (contenu.nomCentre || 'PrepFormation');

  return { html: html, texte: texte };
}


function mettreAJourPrestationsApresEnvoi_(demande, session) {
  const contexte = lireContextePrestationsEnvoiIndemnisation_(
    demande.idsPrestations,
    true,
    demande.idEnvoi
  );
  const table = contexte.tablePrestations;
  const index = table.index;
  const maintenant = new Date();
  const aujourdHui = new Date(
    maintenant.getFullYear(),
    maintenant.getMonth(),
    maintenant.getDate(),
    12, 0, 0
  );
  const restaurations = [];
  let ajoutHistorique = null;

  contexte.prestations.forEach(function (prestation) {
    if (
      prestation.idEnvoiExistant &&
      prestation.idEnvoiExistant !== demande.idEnvoi
    ) {
      throw new Error(
        'La prestation ' + prestation.idPrestation +
        ' est déjà rattachée à l’envoi ' +
        prestation.idEnvoiExistant + '.'
      );
    }
  });

  try {
    const historiques = contexte.prestations.map(function (prestation) {
      const ancienne = prestation.ligne.slice();
      const nouvelle = prestation.ligne.slice();
      nouvelle[index.STATUT_INDEMNISATION] = 'Demande envoyée';
      nouvelle[index.DATE_DEMANDE] = aujourdHui;
      nouvelle[index.REFERENCE_DEMANDE] = demande.reference;
      nouvelle[index.DATE_MODIFICATION] = maintenant;
      nouvelle[index.ID_ENVOI] = demande.idEnvoi;

      const plage = table.feuille.getRange(
        prestation.numeroLigne,
        1,
        1,
        table.feuille.getLastColumn()
      );
      restaurations.push({
        plage: plage,
        valeurs: plage.getValues(),
        formats: plage.getNumberFormats()
      });
      plage.setValues([nouvelle]);
      table.feuille.getRange(
        prestation.numeroLigne,
        index.DATE_DEMANDE + 1
      ).setNumberFormat('dd/MM/yyyy');
      table.feuille.getRange(
        prestation.numeroLigne,
        index.DATE_MODIFICATION + 1
      ).setNumberFormat('dd/MM/yyyy HH:mm');

      return {
        ID_HISTORIQUE: Utilities.getUuid(),
        ID_OPERATION: demande.idEnvoi,
        ID_PRESTATION: prestation.idPrestation,
        ANCIEN_STATUT: prestation.statut,
        NOUVEAU_STATUT: 'Demande envoyée',
        ANCIENNE_DATE_DEMANDE: ancienne[index.DATE_DEMANDE],
        NOUVELLE_DATE_DEMANDE: aujourdHui,
        ANCIENNE_REFERENCE: String(
          ancienne[index.REFERENCE_DEMANDE] || ''
        ).trim(),
        NOUVELLE_REFERENCE: demande.reference,
        REMARQUE_ACTION: 'Envoi par e-mail ' + demande.idEnvoi,
        UTILISATEUR: session.identifiantHistorique,
        DATE_ACTION: maintenant
      };
    });

    ajoutHistorique = ajouterHistoriqueIndemnisation_(
      obtenirFeuilleHistoriqueIndemnisations_(
        SpreadsheetApp.getActiveSpreadsheet()
      ),
      historiques
    );
    SpreadsheetApp.flush();
  } catch (erreur) {
    if (ajoutHistorique) {
      ajoutHistorique.clearContent();
    }
    restaurations.reverse().forEach(function (restauration) {
      restauration.plage.setValues(restauration.valeurs);
      restauration.plage.setNumberFormats(restauration.formats);
    });
    SpreadsheetApp.flush();
    throw erreur;
  }
}


function verifierPrestationsAssocieesEnvoiIndemnisation_(demande) {
  const contexte = lireContextePrestationsEnvoiIndemnisation_(
    demande.idsPrestations,
    false
  );
  return {
    toutesAssociees: contexte.prestations.every(function (prestation) {
      return prestation.idEnvoiExistant === demande.idEnvoi &&
        prestation.statut === 'Demande envoyée';
    })
  };
}


function creerHistoriqueEnvoiIndemnisation_(
  demande,
  session,
  statut,
  messageErreur
) {
  const table = obtenirTableHistoriqueEnvoisIndemnisation_();
  const ligne = new Array(table.feuille.getLastColumn()).fill('');
  const valeurs = {
    ID_ENVOI: demande.idEnvoi,
    DATE_ENVOI: '',
    DESTINATAIRE: demande.destinataire,
    COPIES: demande.copies.join(','),
    OBJET: demande.objet,
    REFERENCE_DEMANDE: demande.reference,
    ID_PRESTATIONS: JSON.stringify(demande.idsPrestations),
    NOMBRE_FORMATEURS: demande.nombreFormateurs,
    NOMBRE_SEANCES: demande.nombreSeances,
    VOLUME_HEURES: demande.volumeHeures,
    STATUT_ENVOI: statut,
    MESSAGE_ERREUR: messageErreur || '',
    SESSION_ADMIN: session.identifiantHistorique,
    DATE_CREATION: new Date()
  };
  COLONNES_HISTORIQUE_ENVOIS_INDEMNISATIONS_.forEach(
    function (colonne) {
      ligne[table.index[colonne]] = valeurs[colonne];
    }
  );
  table.feuille.appendRow(ligne);
  SpreadsheetApp.flush();

  return lireHistoriqueEnvoiDepuisLigne_(
    ligne,
    table.index,
    table.feuille.getLastRow()
  );
}


function mettreAJourHistoriqueEnvoiIndemnisation_(historique, valeurs) {
  const table = obtenirTableHistoriqueEnvoisIndemnisation_();
  let numeroLigne = historique.numeroLigne;

  if (!numeroLigne) {
    const retrouve = trouverHistoriqueEnvoiIndemnisation_(
      historique.idEnvoi
    );
    numeroLigne = retrouve && retrouve.numeroLigne;
  }
  if (!numeroLigne) {
    throw new Error('Trace durable de l’envoi introuvable.');
  }

  Object.keys(valeurs || {}).forEach(function (colonne) {
    if (!Number.isInteger(table.index[colonne])) {
      throw new Error('Colonne d’historique absente : ' + colonne + '.');
    }
    table.feuille.getRange(
      numeroLigne,
      table.index[colonne] + 1
    ).setValue(valeurs[colonne]);
  });
  SpreadsheetApp.flush();
}


function trouverHistoriqueEnvoiIndemnisation_(idEnvoi) {
  const table = obtenirTableHistoriqueEnvoisIndemnisation_();
  let resultat = null;

  table.lignes.forEach(function (ligne, position) {
    if (String(ligne[table.index.ID_ENVOI] || '').trim() === idEnvoi) {
      if (resultat) {
        throw new Error('ID_ENVOI dupliqué dans l’historique : ' + idEnvoi + '.');
      }
      resultat = lireHistoriqueEnvoiDepuisLigne_(
        ligne,
        table.index,
        position + 2
      );
    }
  });
  return resultat;
}


function lireDerniersEnvoisIndemnisation_() {
  const table = obtenirTableHistoriqueEnvoisIndemnisation_();
  return table.lignes.map(function (ligne, position) {
    return lireHistoriqueEnvoiDepuisLigne_(
      ligne,
      table.index,
      position + 2
    );
  }).filter(function (envoi) {
    return envoi.idEnvoi;
  }).sort(function (a, b) {
    return String(b.dateCreationIso).localeCompare(a.dateCreationIso);
  }).slice(0, 50).map(serialiserHistoriqueEnvoiIndemnisation_);
}


function serialiserHistoriqueEnvoiIndemnisation_(envoi) {
  return {
    idEnvoi: envoi.idEnvoi,
    dateEnvoi: envoi.dateEnvoi,
    dateCreation: envoi.dateCreation,
    destinataire: envoi.destinataire,
    copies: envoi.copies.slice(),
    objet: envoi.objet,
    reference: envoi.reference,
    idsPrestations: envoi.idsPrestations.slice(),
    nombrePrestations: envoi.nombrePrestations,
    nombreFormateurs: envoi.nombreFormateurs,
    nombreSeances: envoi.nombreSeances,
    volumeHeures: envoi.volumeHeures,
    volumeHeuresLibelle: envoi.volumeHeuresLibelle,
    statut: envoi.statut,
    messageErreur: envoi.messageErreur,
    sessionAdmin: envoi.sessionAdmin
  };
}


function obtenirTableHistoriqueEnvoisIndemnisation_() {
  const table = lireTableIndemnisation_(
    SpreadsheetApp.getActiveSpreadsheet(),
    'HISTORIQUE_ENVOIS_INDEMNISATIONS'
  );
  verifierColonnesIndemnisation_(
    table,
    'HISTORIQUE_ENVOIS_INDEMNISATIONS',
    COLONNES_HISTORIQUE_ENVOIS_INDEMNISATIONS_
  );
  return table;
}


function lireHistoriqueEnvoiDepuisLigne_(ligne, index, numeroLigne) {
  const idsBruts = String(ligne[index.ID_PRESTATIONS] || '');
  let idsPrestations = [];
  try {
    const lus = JSON.parse(idsBruts);
    idsPrestations = Array.isArray(lus) ? lus.map(String) : [];
  } catch (erreur) {
    idsPrestations = idsBruts.split(',').map(function (id) {
      return id.trim();
    }).filter(Boolean);
  }
  const dateCreation = ligne[index.DATE_CREATION];
  const dateEnvoi = ligne[index.DATE_ENVOI];

  return {
    idEnvoi: String(ligne[index.ID_ENVOI] || '').trim(),
    dateEnvoi: convertirDateHeureEnvoiIndemnisation_(dateEnvoi),
    dateCreation: convertirDateHeureEnvoiIndemnisation_(dateCreation),
    dateCreationIso: convertirDateIsoEnvoiIndemnisation_(dateCreation),
    destinataire: String(ligne[index.DESTINATAIRE] || '').trim(),
    copies: String(ligne[index.COPIES] || '').split(',')
      .map(function (email) { return email.trim(); })
      .filter(Boolean),
    objet: String(ligne[index.OBJET] || ''),
    reference: String(ligne[index.REFERENCE_DEMANDE] || ''),
    idsPrestations: idsPrestations,
    nombrePrestations: idsPrestations.length,
    nombreFormateurs: Number(ligne[index.NOMBRE_FORMATEURS] || 0),
    nombreSeances: Number(ligne[index.NOMBRE_SEANCES] || 0),
    volumeHeures: Number(ligne[index.VOLUME_HEURES] || 0),
    volumeHeuresLibelle: formaterDureeAmicaleEnvoiIndemnisation_(
      Number(ligne[index.VOLUME_HEURES] || 0)
    ),
    statut: String(ligne[index.STATUT_ENVOI] || ''),
    messageErreur: String(ligne[index.MESSAGE_ERREUR] || ''),
    sessionAdmin: String(ligne[index.SESSION_ADMIN] || ''),
    numeroLigne: numeroLigne
  };
}


function nettoyerIdentifiantEnvoiIndemnisation_(valeur) {
  const identifiant = String(valeur || '').trim();
  if (!identifiant || identifiant.length > 100 ||
      !/^[A-Za-z0-9._:-]+$/.test(identifiant)) {
    throw new Error('Identifiant d’envoi invalide.');
  }
  return identifiant;
}


function dedupliquerEmailsEnvoiIndemnisation_(emails, destinataire) {
  const exclus = String(destinataire || '').trim().toLowerCase();
  const dejaVus = new Set();
  return (emails || []).map(function (email) {
    return String(email || '').trim().toLowerCase();
  }).filter(function (email) {
    if (!email || email === exclus || dejaVus.has(email)) return false;
    dejaVus.add(email);
    return true;
  });
}


function adresseEmailValideEnvoiIndemnisation_(adresse) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(adresse || ''));
}


function construirePeriodeEnvoiIndemnisation_(prestations) {
  const dates = prestations.map(function (prestation) {
    return String(prestation.dateSession || '');
  }).filter(Boolean).sort();
  if (!dates.length) return 'période non renseignée';
  const debut = afficherDateFrancaiseEnvoiIndemnisation_(dates[0]);
  const fin = afficherDateFrancaiseEnvoiIndemnisation_(
    dates[dates.length - 1]
  );
  return debut === fin ? debut : 'du ' + debut + ' au ' + fin;
}


function afficherDateFrancaiseEnvoiIndemnisation_(valeur) {
  const texte = String(valeur || '');
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte);
  return correspondance
    ? correspondance[3] + '/' + correspondance[2] + '/' + correspondance[1]
    : texte;
}


function convertirDateHeureEnvoiIndemnisation_(valeur) {
  if (!valeur) return '';
  const date = Object.prototype.toString.call(valeur) === '[object Date]'
    ? valeur : new Date(valeur);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'dd/MM/yyyy HH:mm:ss'
  );
}


function convertirDateIsoEnvoiIndemnisation_(valeur) {
  if (!valeur) return '';
  const date = Object.prototype.toString.call(valeur) === '[object Date]'
    ? valeur : new Date(valeur);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}


function formaterDureeAmicaleEnvoiIndemnisation_(heures) {
  const minutes = Math.round(Math.max(0, Number(heures || 0)) * 60);
  const heuresEntieres = Math.floor(minutes / 60);
  const reste = minutes % 60;
  if (!reste) return heuresEntieres + ' h';
  if (!heuresEntieres) return reste + ' min';
  return heuresEntieres + ' h ' + String(reste).padStart(2, '0');
}


function arrondirHeuresEnvoiIndemnisation_(heures) {
  return Math.round(Number(heures || 0) * 100) / 100;
}


function echapperHtmlEnvoiIndemnisation_(valeur) {
  return String(valeur == null ? '' : valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function convertirTexteEnHtmlEnvoiIndemnisation_(valeur) {
  return echapperHtmlEnvoiIndemnisation_(valeur).replace(/\n/g, '<br>');
}


function limiterMessageErreurEnvoiIndemnisation_(erreur) {
  return String(erreur && erreur.message ? erreur.message : erreur || '')
    .trim()
    .slice(0, 2000);
}
