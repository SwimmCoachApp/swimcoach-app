import { appStore, coachStore, teamStore, clearAllCoachData } from '../../src/core/storage.js';

beforeEach(() => { localStorage.clear(); localStorage.setItem('swimcoach_v2','OLD'); localStorage.setItem('swimcoach_theme','dark'); localStorage.setItem('__app_version__','v1'); });
test('coachStore isole deux entraîneurs', () => {
  coachStore('A').set('swimmers',[1]); coachStore('B').set('swimmers',[2]);
  expect(coachStore('A').get('swimmers')).toEqual([1]);
  coachStore('A').clear();
  expect(coachStore('A').get('swimmers')).toBeNull();
  expect(coachStore('B').get('swimmers')).toEqual([2]);
});
test("ne touche jamais aux clés de l'ancienne app", () => {
  coachStore('A').set('x',1); appStore.set('theme','light'); clearAllCoachData();
  expect(localStorage.getItem('swimcoach_v2')).toBe('OLD');
  expect(localStorage.getItem('swimcoach_theme')).toBe('dark');
  expect(localStorage.getItem('__app_version__')).toBe('v1');
  expect(appStore.get('theme')).toBe('light');
  expect(localStorage.getItem('swimcoach2_A_x')).toBeNull();
});
test("teamStore.clear n'efface qu'un espace", () => {
  teamStore('A','T1').set('s',1); teamStore('A','T2').set('s',2); coachStore('A').set('team',"T1");
  teamStore('A','T1').clear();
  expect(teamStore('A','T1').get('s')).toBeNull(); expect(teamStore('A','T2').get('s')).toBe(2); expect(coachStore('A').get('team')).toBe('T1');
  coachStore('A').clear(); expect(teamStore('A','T2').get('s')).toBeNull();
});
test('JSON corrompu → null, pas d’exception', () => { localStorage.setItem('swimcoach2_A_s','{'); expect(coachStore('A').get('s')).toBeNull(); });
