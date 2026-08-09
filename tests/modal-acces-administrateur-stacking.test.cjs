'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'CSS.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const javascript = fs.readFileSync(
  path.join(ROOT, 'JavaScript.html'),
  'utf8'
);
const metadonnees = fs.readFileSync(
  path.join(ROOT, 'ApplicationMetadataService.js'),
  'utf8'
);


function echapperExpressionReguliere(valeur) {
  return valeur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function lireBlocCss(selecteur) {
  const expression = new RegExp(
    echapperExpressionReguliere(selecteur) + '\\s*\\{([^}]*)\\}',
    'm'
  );
  const resultat = css.match(expression);
  assert(resultat, 'Règle CSS absente : ' + selecteur);
  return resultat[1];
}


function lireZIndex(selecteur) {
  const bloc = lireBlocCss(selecteur);
  const resultat = bloc.match(/z-index\s*:\s*(\d+)/);
  assert(resultat, 'z-index absent : ' + selecteur);
  return Number(resultat[1]);
}


const zIndexConnexion = lireZIndex('.ecran-connexion');
const zIndexModalGenerique = lireZIndex('.modal-overlay');
const zIndexModalAdministration = lireZIndex(
  '.modal-overlay.modal-acces-administrateur-overlay'
);

assert.strictEqual(zIndexConnexion, 10000);
assert.strictEqual(zIndexModalGenerique, 900);
assert(
  zIndexModalAdministration > zIndexConnexion,
  'La modale administrateur doit être au-dessus de l’écran de connexion.'
);

const baliseModalAdministration = indexHtml.match(
  /<div\s+id="modalAccesAdministrateur"[\s\S]*?>/
);
assert(baliseModalAdministration);
assert(baliseModalAdministration[0].includes('modal-overlay'));
assert(
  baliseModalAdministration[0].includes(
    'modal-acces-administrateur-overlay'
  )
);
assert.strictEqual(
  (indexHtml.match(/modal-acces-administrateur-overlay/g) || []).length,
  1,
  'La couche prioritaire doit rester réservée à la modale administrateur.'
);

const blocOverlayGenerique = lireBlocCss('.modal-overlay');
const blocOverlayAdministration = lireBlocCss(
  '.modal-overlay.modal-acces-administrateur-overlay'
);
assert(/position\s*:\s*fixed/.test(blocOverlayGenerique));
assert(/inset\s*:\s*0/.test(blocOverlayGenerique));
assert(/pointer-events\s*:\s*auto/.test(blocOverlayAdministration));
assert(javascript.includes("modal.classList.remove('masque')"));

const baliseAutreModal = indexHtml.match(
  /<div\s+id="modalMotDePasseFormateur"[\s\S]*?>/
);
assert(baliseAutreModal);
assert(!baliseAutreModal[0].includes(
  'modal-acces-administrateur-overlay'
));

assert(metadonnees.includes(
  "VERSION_APPLICATION_PREPFORMATION_ = '2.0.0'"
));

process.stdout.write(
  '✓ modale administrateur au-dessus de NON_CONNECTE sans affecter les autres modales\n'
);
