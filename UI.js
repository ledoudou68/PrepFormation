function doGet() {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('PrepFormation')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nomFichier) {
  return HtmlService
    .createHtmlOutputFromFile(nomFichier)
    .getContent();
}

function getPage(nomPage) {
  const pagesAutorisees = [
    'Accueil',
    'Stagiaires',
    'Formateurs',
    'Sessions',
    'Referentiel',
    'Indemnisation'
  ];

  if (!pagesAutorisees.includes(nomPage)) {
    throw new Error('Page inconnue.');
  }

  return HtmlService
    .createTemplateFromFile(nomPage)
    .evaluate()
    .getContent();
}
