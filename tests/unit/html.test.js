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
