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
