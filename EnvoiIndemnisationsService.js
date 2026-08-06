'use strict';

const COLONNES_HISTORIQUE_ENVOIS_INDEMNISATIONS_ = [
  'ID_ENVOI', 'DATE_ENVOI', 'DESTINATAIRE', 'COPIES',
  'OBJET', 'REFERENCE_DEMANDE', 'ID_PRESTATIONS',
  'NOMBRE_FORMATEURS', 'NOMBRE_SEANCES', 'VOLUME_HEURES',
  'STATUT_ENVOI', 'MESSAGE_ERREUR', 'SESSION_ADMIN',
  'DATE_CREATION', 'PDF_FILE_ID', 'PDF_NOM', 'PDF_TAILLE',
  'PDF_HASH'
];
const STATUT_ENVOI_PREPARATION_ = 'EN_COURS_AVANT_ENVOI';
const STATUT_ENVOI_MESSAGE_ENVOYE_ = 'EMAIL_ENVOYE_MAJ_EN_COURS';
const STATUT_ENVOI_TERMINE_ = 'TERMINE';
const STATUT_ENVOI_ECHEC_ = 'ECHEC_ENVOI';
const STATUT_ENVOI_ECHEC_PDF_ = 'ECHEC_PDF';
const STATUT_ENVOI_REGULARISATION_ = 'REGULARISATION_REQUISE';
const PREFIXE_SEQUENCE_INDEMNISATION_ =
  'PREPFORMATION_INDEMNISATION_SEQUENCE_';
const LONGUEUR_MAX_REFERENCE_INDEMNISATION_ = 100;


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

  const referenceProposee =
    proposerProchaineReferenceIndemnisation_();

  const demande = construireDemandeIndemnisationEmail_(
    donnees.idsPrestations,
    {
      idEnvoi: nettoyerIdentifiantEnvoiIndemnisation_(
        Utilities.getUuid()
      ),
      reference: referenceProposee,
      objet: donnees.objet,
      introduction: donnees.introduction,
      remarqueFinale: donnees.remarqueFinale,
      referenceObligatoire: false,
      refuserIndemnisees: true
    }
  );

  demande.referenceProposeeAutomatique = referenceProposee;
  demande.referenceGenereeAutomatiquement = true;

  return demande;
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

    const idEnvoi = nettoyerIdentifiantEnvoiIndemnisation_(
      donnees.idEnvoi
    );
    const resolutionReference =
      resoudreReferenceDefinitiveIndemnisation_(
        donnees.reference,
        donnees.referenceProposeeAutomatique,
        idEnvoi
      );
    const demande = construireDemandeIndemnisationEmail_(
      donnees.idsPrestations,
      {
        idEnvoi: idEnvoi,
        reference: resolutionReference.reference,
        objet: donnees.objet,
        introduction: donnees.introduction,
        remarqueFinale: donnees.remarqueFinale,
        referenceObligatoire: true,
        refuserIndemnisees: true
      }
    );

    demande.referenceProposeeAutomatique =
      String(donnees.referenceProposeeAutomatique || '').trim();
    demande.referenceAjusteeAutomatiquement =
      resolutionReference.ajusteeAutomatiquement;
    demande.referenceRejouee = resolutionReference.rejouee;

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

  let pdf;

  try {
    pdf = obtenirOuCreerPdfDemandeIndemnisation_(
      demande,
      historique
    );
    mettreAJourHistoriqueEnvoiIndemnisation_(historique, {
      PDF_FILE_ID: pdf.fileId,
      PDF_NOM: pdf.nom,
      PDF_TAILLE: pdf.taille,
      PDF_HASH: pdf.hash
    });
  } catch (erreurPdf) {
    mettreAJourHistoriqueEnvoiIndemnisation_(historique, {
      STATUT_ENVOI: STATUT_ENVOI_ECHEC_PDF_,
      MESSAGE_ERREUR: limiterMessageErreurEnvoiIndemnisation_(
        erreurPdf
      )
    });

    journaliserActionSensible_(
      'INDEMNISATION_PDF_ECHEC',
      'HISTORIQUE_ENVOIS_INDEMNISATIONS',
      demande.idEnvoi,
      {
        nombrePrestations: demande.nombrePrestations,
        statut: STATUT_ENVOI_ECHEC_PDF_
      },
      session.identifiantHistorique
    );

    throw new Error(
      'Le PDF n’a pas pu être créé ou vérifié. Aucun courriel n’a été ' +
      'envoyé et aucune prestation n’a été modifiée. ' +
      limiterMessageErreurEnvoiIndemnisation_(erreurPdf)
    );
  }

  try {
    const optionsEnvoi = {
      to: demande.destinataire,
      subject: demande.objet,
      body: demande.corpsTexte,
      htmlBody: demande.corpsHtml,
      name: demande.nomCentre || 'PrepFormation',
      attachments: [pdf.blob]
    };

    if (demande.copies.length) {
      optionsEnvoi.cc = demande.copies.join(',');
    }

    MailApp.sendEmail(optionsEnvoi);

    try {
      enregistrerSequenceReferenceIndemnisation_(demande.reference);
    } catch (erreurSequence) {
      demande.avertissementSequence =
        limiterMessageErreurEnvoiIndemnisation_(erreurSequence);
    }
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
        statut: STATUT_ENVOI_ECHEC_,
        pdfConserve: true
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
    pdfNom: pdf.nom,
    referenceProposeeAutomatique:
      demande.referenceProposeeAutomatique,
    referenceAjusteeAutomatiquement:
      Boolean(demande.referenceAjusteeAutomatiquement),
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
      referenceProposeeAutomatique:
        demande.referenceProposeeAutomatique,
      referenceAjusteeAutomatiquement:
        Boolean(demande.referenceAjusteeAutomatiquement),
      message: 'Cette demande a déjà été envoyée. Aucun nouvel e-mail n’a été émis.'
    };
  }

  throw new Error(
    'Une tentative existe déjà pour cet ID d’envoi (' +
    historique.statut + '). Aucun nouvel e-mail n’a été émis. ' +
    'Vérifie l’historique avant toute action manuelle.'
  );
}


function proposerProchaineReferenceIndemnisation_() {
  const annee = Number(Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy'
  ));
  const etat = obtenirEtatReferencesIndemnisation_('');
  const valeurPropriete = PropertiesService
    .getScriptProperties()
    .getProperty(PREFIXE_SEQUENCE_INDEMNISATION_ + annee);

  return calculerProchaineReferenceIndemnisation_(
    annee,
    valeurPropriete,
    Array.from(etat.referencesUtilisees)
  );
}


function resoudreReferenceDefinitiveIndemnisation_(
  referenceDemandee,
  referenceProposee,
  idEnvoi
) {
  const etat = obtenirEtatReferencesIndemnisation_(idEnvoi);

  if (etat.referenceOperationCourante) {
    return {
      reference: etat.referenceOperationCourante,
      ajusteeAutomatiquement: false,
      rejouee: true
    };
  }

  let reference = String(referenceDemandee || '').trim();
  const proposition = String(referenceProposee || '').trim();

  if (!reference) {
    reference = proposition || proposerProchaineReferenceIndemnisation_();
  }

  validerReferenceIndemnisation_(reference);

  const normalisee = normaliserReferenceIndemnisation_(reference);
  const propositionNormalisee =
    normaliserReferenceIndemnisation_(proposition);

  if (etat.referencesUtilisees.has(normalisee)) {
    if (
      propositionNormalisee &&
      normalisee === propositionNormalisee &&
      analyserReferenceAutomatiqueIndemnisation_(reference)
    ) {
      const annee = Number(Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        'yyyy'
      ));
      const valeurPropriete = PropertiesService
        .getScriptProperties()
        .getProperty(PREFIXE_SEQUENCE_INDEMNISATION_ + annee);
      const nouvelleReference = calculerProchaineReferenceIndemnisation_(
        annee,
        valeurPropriete,
        Array.from(etat.referencesUtilisees)
      );

      return {
        reference: nouvelleReference,
        ajusteeAutomatiquement: true,
        rejouee: false
      };
    }

    throw new Error(
      'La référence « ' + reference + ' » est déjà utilisée. ' +
      'Choisis une autre référence.'
    );
  }

  return {
    reference: reference,
    ajusteeAutomatiquement: false,
    rejouee: false
  };
}


function obtenirEtatReferencesIndemnisation_(idEnvoiCourant) {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const historique = lireTableIndemnisation_(
    classeur,
    'HISTORIQUE_ENVOIS_INDEMNISATIONS'
  );
  const prestations = lireTableIndemnisation_(
    classeur,
    'PRESTATIONS_FORMATEURS'
  );

  verifierColonnesIndemnisation_(
    historique,
    'HISTORIQUE_ENVOIS_INDEMNISATIONS',
    ['ID_ENVOI', 'REFERENCE_DEMANDE', 'STATUT_ENVOI']
  );
  verifierColonnesIndemnisation_(
    prestations,
    'PRESTATIONS_FORMATEURS',
    ['ID_ENVOI', 'REFERENCE_DEMANDE']
  );

  const lignesHistorique = historique.lignes.map(function (ligne) {
    return {
      idEnvoi: String(ligne[historique.index.ID_ENVOI] || '').trim(),
      reference: String(
        ligne[historique.index.REFERENCE_DEMANDE] || ''
      ).trim(),
      statut: String(
        ligne[historique.index.STATUT_ENVOI] || ''
      ).trim()
    };
  });
  const lignesPrestations = prestations.lignes.map(function (ligne) {
    return {
      idEnvoi: String(ligne[prestations.index.ID_ENVOI] || '').trim(),
      reference: String(
        ligne[prestations.index.REFERENCE_DEMANDE] || ''
      ).trim()
    };
  });

  return construireEtatReferencesIndemnisation_(
    lignesHistorique,
    lignesPrestations,
    idEnvoiCourant
  );
}


function construireEtatReferencesIndemnisation_(
  historiques,
  prestations,
  idEnvoiCourant
) {
  const identifiantCourant = String(idEnvoiCourant || '').trim();
  const referencesUtilisees = new Set();
  const referencesOperationCourante = new Set();

  (historiques || []).forEach(function (historique) {
    const reference = String(historique.reference || '').trim();
    const statut = String(historique.statut || '').trim();
    const idEnvoi = String(historique.idEnvoi || '').trim();

    if (
      !reference ||
      statut === STATUT_ENVOI_ECHEC_ ||
      statut === STATUT_ENVOI_ECHEC_PDF_
    ) {
      return;
    }

    if (identifiantCourant && idEnvoi === identifiantCourant) {
      referencesOperationCourante.add(reference);
      return;
    }

    referencesUtilisees.add(
      normaliserReferenceIndemnisation_(reference)
    );
  });

  (prestations || []).forEach(function (prestation) {
    const reference = String(prestation.reference || '').trim();
    const idEnvoi = String(prestation.idEnvoi || '').trim();

    if (!reference) {
      return;
    }

    if (identifiantCourant && idEnvoi === identifiantCourant) {
      referencesOperationCourante.add(reference);
      return;
    }

    referencesUtilisees.add(
      normaliserReferenceIndemnisation_(reference)
    );
  });

  const referencesCourantesNormalisees = new Set(
    Array.from(referencesOperationCourante).map(
      normaliserReferenceIndemnisation_
    )
  );

  if (referencesCourantesNormalisees.size > 1) {
    throw new Error(
      'L’opération ' + identifiantCourant +
      ' utilise plusieurs références incompatibles.'
    );
  }

  return {
    referencesUtilisees: referencesUtilisees,
    referenceOperationCourante:
      Array.from(referencesOperationCourante)[0] || ''
  };
}


function calculerProchaineReferenceIndemnisation_(
  annee,
  valeurPropriete,
  referencesUtilisees
) {
  const anneeValide = Math.floor(Number(annee));

  if (anneeValide < 2000 || anneeValide > 9999) {
    throw new Error('Année invalide pour la référence d’indemnisation.');
  }

  const textePropriete = String(valeurPropriete == null
    ? ''
    : valeurPropriete).trim();
  const sequencePropriete = /^\d+$/.test(textePropriete)
    ? Math.max(0, Number(textePropriete))
    : 0;
  const references = new Set(
    (referencesUtilisees || []).map(
      normaliserReferenceIndemnisation_
    ).filter(Boolean)
  );
  let sequence = sequencePropriete;

  references.forEach(function (reference) {
    const analyse = analyserReferenceAutomatiqueIndemnisation_(reference);

    if (analyse && analyse.annee === anneeValide) {
      sequence = Math.max(sequence, analyse.sequence);
    }
  });

  do {
    sequence++;

    if (sequence > 9999) {
      throw new Error(
        'La séquence annuelle des indemnisations est épuisée.'
      );
    }
  } while (references.has(
    normaliserReferenceIndemnisation_(
      formaterReferenceAutomatiqueIndemnisation_(
        anneeValide,
        sequence
      )
    )
  ));

  return formaterReferenceAutomatiqueIndemnisation_(
    anneeValide,
    sequence
  );
}


function formaterReferenceAutomatiqueIndemnisation_(annee, sequence) {
  return 'IND-' + String(annee) + '-' +
    String(sequence).padStart(4, '0');
}


function analyserReferenceAutomatiqueIndemnisation_(reference) {
  const correspondance = /^IND-(\d{4})-(\d{4})$/.exec(
    normaliserReferenceIndemnisation_(reference)
  );

  if (!correspondance) {
    return null;
  }

  return {
    annee: Number(correspondance[1]),
    sequence: Number(correspondance[2])
  };
}


function enregistrerSequenceReferenceIndemnisation_(reference) {
  const analyse = analyserReferenceAutomatiqueIndemnisation_(reference);

  if (!analyse) {
    return false;
  }

  const proprietes = PropertiesService.getScriptProperties();
  const cle = PREFIXE_SEQUENCE_INDEMNISATION_ + analyse.annee;
  const valeurActuelle = String(proprietes.getProperty(cle) || '').trim();
  const sequenceActuelle = /^\d+$/.test(valeurActuelle)
    ? Number(valeurActuelle)
    : 0;

  if (analyse.sequence > sequenceActuelle) {
    proprietes.setProperty(cle, String(analyse.sequence));
    return true;
  }

  return false;
}


function validerReferenceIndemnisation_(reference) {
  const texte = String(reference || '').trim();

  if (!texte) {
    throw new Error('La référence commune de la demande est obligatoire.');
  }

  if (texte.length > LONGUEUR_MAX_REFERENCE_INDEMNISATION_) {
    throw new Error(
      'La référence ne doit pas dépasser ' +
      LONGUEUR_MAX_REFERENCE_INDEMNISATION_ + ' caractères.'
    );
  }

  if (!/^[A-Za-z0-9À-ÖØ-öø-ÿ._\/ -]+$/.test(texte)) {
    throw new Error(
      'La référence contient des caractères non autorisés.'
    );
  }

  return texte;
}


function normaliserReferenceIndemnisation_(reference) {
  return String(reference || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
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


function obtenirOuCreerPdfDemandeIndemnisation_(demande, historique) {
  const existant = trouverPdfDemandeIndemnisation_(
    demande.idEnvoi,
    historique
  );

  if (existant) {
    return verifierPdfDemandeIndemnisation_(existant, demande.idEnvoi);
  }

  const dossier = obtenirSousDossierPrepFormation_(
    'Demandes indemnisation',
    PROPRIETE_DOSSIER_DEMANDES_INDEMNISATION_,
    'PREPFORMATION_INDEMNISATIONS:',
    true
  );
  const nom = construireNomPdfDemandeIndemnisation_(demande.reference);
  const html = construireHtmlPdfDemandeIndemnisation_(demande);
  const blob = HtmlService
    .createHtmlOutput(html)
    .getAs(MimeType.PDF)
    .setName(nom);

  verifierBlobPdfDemandeIndemnisation_(blob);
  const octetsGeneres = blob.getBytes();
  const tailleAttendue = octetsGeneres.length;
  const hashAttendu = hacherOctetsDemandeIndemnisation_(
    octetsGeneres
  );

  let fichier = null;

  try {
    fichier = dossier.createFile(blob);
    fichier.setDescription(JSON.stringify({
      type: 'PREPFORMATION_DEMANDE_INDEMNISATION',
      idEnvoi: demande.idEnvoi,
      reference: demande.reference,
      dateCreation: new Date().toISOString()
    }));

    const verification = verifierPdfDemandeIndemnisation_(
      fichier,
      demande.idEnvoi,
      dossier
    );

    if (
      verification.taille !== tailleAttendue ||
      verification.hash !== hashAttendu
    ) {
      throw new Error(
        'Le PDF relu depuis Drive diffère du document généré.'
      );
    }

    return verification;
  } catch (erreur) {
    if (fichier) {
      try {
        fichier.setTrashed(true);
      } catch (erreurCorbeille) {
        // Le document non vérifié n'est jamais utilisé pour l'envoi.
      }
    }
    throw erreur;
  }
}


function trouverPdfDemandeIndemnisation_(idEnvoi, historique) {
  if (historique && historique.pdfFileId) {
    try {
      const fichier = DriveApp.getFileById(historique.pdfFileId);
      if (!fichier.isTrashed()) {
        return fichier;
      }
    } catch (erreur) {
      // Recherche par marqueur ci-dessous.
    }
  }

  const dossier = obtenirSousDossierPrepFormation_(
    'Demandes indemnisation',
    PROPRIETE_DOSSIER_DEMANDES_INDEMNISATION_,
    'PREPFORMATION_INDEMNISATIONS:',
    false
  );

  if (!dossier) {
    return null;
  }

  const fichiers = dossier.getFiles();
  let trouve = null;

  while (fichiers.hasNext()) {
    const fichier = fichiers.next();
    if (fichier.isTrashed()) {
      continue;
    }

    let description = null;
    try {
      description = JSON.parse(fichier.getDescription() || '{}');
    } catch (erreurDescription) {
      description = null;
    }

    if (description && description.idEnvoi === idEnvoi) {
      if (trouve) {
        throw new Error(
          'Plusieurs PDF sont rattachés au même ID_ENVOI : ' + idEnvoi + '.'
        );
      }
      trouve = fichier;
    }
  }

  return trouve;
}


function verifierPdfDemandeIndemnisation_(fichier, idEnvoi, dossierOptionnel) {
  const dossier = dossierOptionnel || obtenirSousDossierPrepFormation_(
    'Demandes indemnisation',
    PROPRIETE_DOSSIER_DEMANDES_INDEMNISATION_,
    'PREPFORMATION_INDEMNISATIONS:',
    false
  );

  if (!dossier || !dossierContientFichierPrepFormation_(dossier, fichier)) {
    throw new Error('Le PDF archivé n’appartient pas au dossier attendu.');
  }

  if (!fichierDriveEstPrive_(fichier)) {
    throw new Error('Le PDF archivé n’est pas privé.');
  }

  let description;
  try {
    description = JSON.parse(fichier.getDescription() || '{}');
  } catch (erreur) {
    throw new Error('Le marqueur du PDF archivé est illisible.');
  }

  if (description.idEnvoi !== idEnvoi) {
    throw new Error('Le PDF archivé ne correspond pas à cet ID_ENVOI.');
  }

  const blob = fichier.getBlob();
  verifierBlobPdfDemandeIndemnisation_(blob);
  const octets = blob.getBytes();
  const taille = octets.length;

  if (Number(fichier.getSize()) !== taille) {
    throw new Error('La taille relue du PDF archivé est incohérente.');
  }

  return {
    fileId: fichier.getId(),
    nom: fichier.getName(),
    taille: taille,
    hash: hacherOctetsDemandeIndemnisation_(octets),
    blob: blob.setName(fichier.getName())
  };
}


function verifierBlobPdfDemandeIndemnisation_(blob) {
  if (!blob || blob.getContentType() !== MimeType.PDF) {
    throw new Error('Le document généré n’est pas un PDF valide.');
  }

  const octets = blob.getBytes();
  const signature = octets.slice(0, 5).map(function (octet) {
    return String.fromCharCode((octet + 256) % 256);
  }).join('');

  if (octets.length < 100 || signature !== '%PDF-') {
    throw new Error('Le contenu PDF généré est vide ou illisible.');
  }
}


function hacherOctetsDemandeIndemnisation_(octets) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      octets
    )
  ).replace(/=+$/g, '');
}


function construireNomPdfDemandeIndemnisation_(reference) {
  const referenceNom = String(reference || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'SANS_REFERENCE';
  const date = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
  return 'Demande_indemnisation__' + referenceNom + '__' + date + '.pdf';
}


function construireHtmlPdfDemandeIndemnisation_(demande) {
  const lignes = demande.groupes.map(function (groupe) {
    const prestations = groupe.prestations.map(function (prestation) {
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
        '<td>' + Number(prestation.nombreStagiaires || 0) + '</td>' +
        '<td>' + echapperHtmlEnvoiIndemnisation_(
          prestation.remarqueAdministrative || '—'
        ) + '</td></tr>';
    }).join('');

    return '<section><h2>' +
      echapperHtmlEnvoiIndemnisation_(groupe.nomComplet) +
      '</h2><table><thead><tr><th>Date</th><th>Formation</th>' +
      '<th>Horaires</th><th>Durée</th><th>Stagiaires</th>' +
      '<th>Remarque</th></tr></thead><tbody>' + prestations +
      '</tbody></table><p class="total"><strong>Total individuel :</strong> ' +
      groupe.nombreSeances + ' séance(s) · ' +
      echapperHtmlEnvoiIndemnisation_(groupe.totalHeuresLibelle) +
      '</p></section>';
  }).join('');
  const date = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'dd/MM/yyyy'
  );

  return '<!doctype html><html><head><meta charset="UTF-8"><style>' +
    '@page{size:A4;margin:18mm 14mm}body{font-family:Arial,sans-serif;' +
    'color:#243746;font-size:10.5pt;line-height:1.4}h1{color:#17324d;' +
    'font-size:22pt;margin:0 0 4px}h2{font-size:14pt;color:#17324d;' +
    'margin:20px 0 7px}header{border-bottom:3px solid #1b6ca8;' +
    'padding-bottom:12px;margin-bottom:18px}.meta{display:grid;' +
    'grid-template-columns:1fr 1fr;gap:5px 20px;background:#f2f6f9;' +
    'padding:12px;border-radius:6px}table{width:100%;border-collapse:collapse;' +
    'font-size:9pt}th{background:#17324d;color:white;text-align:left}' +
    'th,td{border:1px solid #cbd8e1;padding:6px;vertical-align:top}' +
    'tr:nth-child(even) td{background:#f7f9fb}.total{text-align:right}' +
    '.resume{margin-top:20px;padding:12px;border-left:4px solid #1b6ca8;' +
    'background:#eef4f8}.remarque{margin-top:18px;white-space:pre-wrap}' +
    '</style></head><body><header><h1>Demande d’indemnisation</h1>' +
    '<strong>' + echapperHtmlEnvoiIndemnisation_(
      demande.nomCentre || 'PrepFormation'
    ) + '</strong></header><div class="meta"><div><strong>Référence :</strong> ' +
    echapperHtmlEnvoiIndemnisation_(demande.reference) +
    '</div><div><strong>Date :</strong> ' + date +
    '</div><div><strong>Destinataire :</strong> ' +
    echapperHtmlEnvoiIndemnisation_(demande.destinataire) +
    '</div><div><strong>Formateurs :</strong> ' +
    echapperHtmlEnvoiIndemnisation_(demande.groupes.map(function (groupe) {
      return groupe.nomComplet;
    }).join(', ')) + '</div></div>' + lignes +
    '<div class="resume"><strong>Récapitulatif général</strong><br>' +
    demande.nombreSeances + ' séance(s) distincte(s) · ' +
    demande.nombrePrestations + ' prestation(s) · ' +
    echapperHtmlEnvoiIndemnisation_(demande.volumeHeuresLibelle) +
    '</div><div class="remarque"><strong>Remarque finale</strong><br>' +
    echapperHtmlEnvoiIndemnisation_(demande.remarqueFinale || '—') +
    '</div></body></html>';
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
    DATE_CREATION: new Date(),
    PDF_FILE_ID: '',
    PDF_NOM: '',
    PDF_TAILLE: '',
    PDF_HASH: ''
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
    sessionAdmin: envoi.sessionAdmin,
    pdfNom: envoi.pdfNom,
    pdfTaille: envoi.pdfTaille,
    pdfHash: envoi.pdfHash
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
    pdfFileId: String(ligne[index.PDF_FILE_ID] || '').trim(),
    pdfNom: String(ligne[index.PDF_NOM] || '').trim(),
    pdfTaille: Number(ligne[index.PDF_TAILLE] || 0),
    pdfHash: String(ligne[index.PDF_HASH] || '').trim(),
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
