function doGet() {
  const recuperation =
    recupererRestaurationInterrompueAuDemarrage_();

  if (!recuperation.operationActive) {
    executerMigrationsAuDemarrage_();
  }

  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1, viewport-fit=cover'
    )
    .setTitle('PrepFormation')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nomFichier) {
  return HtmlService
    .createHtmlOutputFromFile(nomFichier)
    .getContent();
}

function getPage(nomPage, jetonUtilisateur, optionsDiagnostic) {
  const diagnosticActif =
    typeof diagnosticChargementAccueilAutorise_ === 'function' &&
    diagnosticChargementAccueilAutorise_(optionsDiagnostic);
  const diagnostic = diagnosticActif
    ? creerDiagnosticServeurChargementAccueil_('CHARGEMENT_FRAGMENT_HTML')
    : null;
  const debutTotal = diagnostic ? Date.now() : 0;
  const pagesAutorisees = [
    'Accueil',
    'Stagiaires',
    'Formateurs',
    'Sessions',
    'Calendrier',
    'Statistiques',
    'AssistantPedagogique',
    'Referentiel',
    'Indemnisation',
    'Administration'
  ];

  if (!pagesAutorisees.includes(nomPage)) {
    throw new Error('Page inconnue.');
  }

  const debutVerificationAcces = diagnostic ? Date.now() : 0;
  const diagnosticVerificationAcces = diagnostic ? {} : null;
  verifierAccesPage_(
    nomPage,
    jetonUtilisateur,
    diagnosticVerificationAcces
  );
  if (diagnostic) {
    diagnostic.verificationAccesMs =
      Date.now() - debutVerificationAcces;
    diagnostic.appelsAutresServices.push(
      diagnosticVerificationAcces
    );
  }

  const debutConstructionHtml = diagnostic ? Date.now() : 0;
  const html = HtmlService
    .createTemplateFromFile(nomPage)
    .evaluate()
    .getContent();
  if (!diagnostic) return html;

  diagnostic.constructionHtmlMs = Date.now() - debutConstructionHtml;
  diagnostic.totalServeurMs = Date.now() - debutTotal;
  return {
    html: html,
    diagnosticAccueil: diagnostic
  };
}
