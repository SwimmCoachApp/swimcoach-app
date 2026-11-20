import { esc, html, raw, sanitizeRich } from '../../src/core/html.js';

test('html échappe chaque valeur interpolée', () => {
  expect(html`<b>${'<img src=x onerror=alert(1)>'}</b>`).toBe('<b>&lt;img src=x onerror=alert(1)&gt;</b>');
});

test('html laisse passer les valeurs enveloppées par raw et gère null, nombres et listes', () => {
  expect(html`<i>${raw('<u>ok</u>')}</i>`).toBe('<i><u>ok</u></i>');
  expect(html`${null}|${0}|${undefined}`).toBe('|0|');
  expect(html`<ul>${['<a>', raw('<li>')].map((x) => x)}</ul>`).toBe('<ul>&lt;a&gt;<li></ul>');
  expect(html`<p>${raw(html`<b>${'<'}</b>`)}</p>`).toBe('<p><b>&lt;</b></p>'); // un fragment déjà produit par html s'enveloppe dans raw
});

test('esc échappe & < > " \'', () => {
  expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
});

test('sanitizeRich ne garde que les balises permises, sans attribut', () => {
  expect(sanitizeRich('<b onclick="x">a</b><script>1</script><img src=x>')).toBe('<b>a</b>');
  expect(sanitizeRich('<div style="x"><i>a</i><br><span class="c">b</span></div>')).toBe('<div><i>a</i><br><span>b</span></div>');
  expect(sanitizeRich('<a href="javascript:x">lien</a><ul><li>1</li></ul>')).toBe('lien<ul><li>1</li></ul>');
  expect(sanitizeRich('')).toBe('');
});

test('sanitizeRich supprime le contenu des éléments SVG et MathML dangereux, les commentaires et les champs', () => {
  expect(sanitizeRich('a<svg><style>x{}</style><script>alert(1)</script></svg>b')).toBe('ab');
  expect(sanitizeRich('a<math><style>x</style></math>b')).toBe('ab');
  expect(sanitizeRich('a<!-- <script>x</script> -->b')).toBe('ab');
  expect(sanitizeRich('<div><p><input value="x"><b>ok</b></p></div>')).toBe('<div><p><b>ok</b></p></div>');
});

test('html : un guillemet dans une valeur ne sort pas d’un attribut', () => {
  const out = html`<input value="${'" onfocus="alert(1)'}">`;
  expect(out).toBe('<input value="&quot; onfocus=&quot;alert(1)">');
  const el = document.createElement('div');
  el.innerHTML = out;
  expect(el.firstChild.attributes).toHaveLength(1);
});

describe('sanitizeRich : barré et couleurs (parité club4)', () => {
  test('<s> et <strike> sont gardés, <strike> devient <s>', () => {
    expect(sanitizeRich('<s>a</s><strike class="x">b</strike>')).toBe('<s>a</s><s>b</s>');
  });

  test('couleur et surlignage : seuls color et background-color, en #rgb, #rrggbb, rgb() ou rgba()', () => {
    expect(sanitizeRich('<span style="color:#1e6fff">a</span>')).toBe('<span style="color: #1e6fff">a</span>');
    expect(sanitizeRich('<span style="background-color: rgba(253, 224, 71, 0.5);">h</span>')).toBe('<span style="background-color: rgba(253, 224, 71, 0.5)">h</span>');
    expect(sanitizeRich('<span style="COLOR: #F00; background-color: rgb(1,2,3)">x</span>')).toBe('<span style="color: #F00; background-color: rgb(1,2,3)">x</span>');
  });

  test('<font color> de execCommand devient <span style="color:…">, ses autres attributs disparaissent', () => {
    expect(sanitizeRich('<font color="#ff0000" face="Comic" size="7">r</font>')).toBe('<span style="color: #ff0000">r</span>');
    expect(sanitizeRich('<font face="x" color="red">r</font>')).toBe('r');
    expect(sanitizeRich('<font color="#ff0000" style="position:fixed">r</font>')).toBe('<span style="color: #ff0000">r</span>');
  });

  test.each([
    ['url(javascript:…)', '<span style="background-color:url(javascript:alert(1))">x</span>'],
    ['background:url(x)', '<span style="background:url(x)">x</span>'],
    ['expression()', '<span style="color:expression(alert(1))">x</span>'],
    ['var()', '<span style="color:var(--x)">x</span>'],
    ['couleur nommée', '<span style="color:red">x</span>'],
    ['!important', '<span style="color:#fff !important">x</span>'],
    ['rgb() non numérique', '<span style="color:rgb(1,2,calc(3))">x</span>'],
    ['hexa à 8 chiffres', '<span style="color:#fde04780">x</span>'],
    ['commentaire', '<span style="color:/**/#fff">x</span>'],
    ['échappement CSS', '<span style="color:\\23 fff">x</span>'],
  ])('style hostile ou hors liste (%s) : supprimé', (_, input) => {
    expect(sanitizeRich(input)).toBe('<span>x</span>');
  });

  test('color:red;position:fixed : tout est supprimé ; une couleur valide reste sans les autres propriétés', () => {
    expect(sanitizeRich('<span style="color:red;position:fixed">x</span>')).toBe('<span>x</span>');
    expect(sanitizeRich('<span style="position:fixed;color:#abc;top:0;background-image:url(x)">x</span>')).toBe('<span style="color: #abc">x</span>');
  });

  test('style sur une autre balise que span : supprimé', () => {
    expect(sanitizeRich('<b style="color:#fff">a</b><div style="background-color:#000">b</div>')).toBe('<b>a</b><div>b</div>');
  });

  test('le résultat se relit à l’identique (stable)', () => {
    const once = sanitizeRich('<font color="#00ff00">a</font><span style="background-color: rgba(1, 2, 3, 0.5)">b</span><strike>c</strike>');
    expect(sanitizeRich(once)).toBe(once);
  });
});
