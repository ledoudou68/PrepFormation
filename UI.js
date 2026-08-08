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

function getPage(nomPage, jetonAdministrateur) {
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

  verifierAccesPage_(nomPage, jetonAdministrateur);

  return HtmlService
    .createTemplateFromFile(nomPage)
    .evaluate()
    .getContent();
}
