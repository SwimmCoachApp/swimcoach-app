import { ownerOf, deletionBlocked, ownerMayNotBeRemoved } from '../../src/features/teams/owner.js';

const A = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const members = (...ids) => ids.map((id) => ({ id, email: `${id.slice(0, 1)}@toac.fr`, name: '' }));

describe('propriétaire du groupe (même règle que le serveur)', () => {
  test('le créateur est le propriétaire tant qu’il est membre', () => {
    expect(ownerOf({ ownerId: A, members: members(A, C) })).toBe(A);
  });

  test('le créateur parti n’est plus propriétaire', () => {
    expect(ownerOf({ ownerId: A, members: members(C) })).toBeNull();
  });

  test('compte du créateur supprimé (created_by nul) : pas de propriétaire', () => {
    expect(ownerOf({ ownerId: null, members: members(A, C) })).toBeNull();
  });

  test('le propriétaire peut supprimer le groupe', () => {
    expect(deletionBlocked({ ownerId: A, members: members(A, C) }, A)).toBe(false);
  });

  test('un invité ne peut pas supprimer le groupe', () => {
    expect(deletionBlocked({ ownerId: A, members: members(A, C) }, C)).toBe(true);
  });

  test('sans propriétaire membre, tout membre peut supprimer le groupe', () => {
    expect(deletionBlocked({ ownerId: A, members: members(C) }, C)).toBe(false);
    expect(deletionBlocked({ ownerId: null, members: members(A, C) }, C)).toBe(false);
  });

  test('membres pas encore chargés : rien n’est décidé', () => {
    expect(deletionBlocked(null, C)).toBe(false);
  });

  test('le propriétaire ne peut être retiré que par lui-même', () => {
    const data = { ownerId: A, members: members(A, C) };
    expect(ownerMayNotBeRemoved(data, A, C)).toBe(true); // C ne retire pas A
    expect(ownerMayNotBeRemoved(data, A, A)).toBe(false); // A part de lui-même
    expect(ownerMayNotBeRemoved(data, C, A)).toBe(false); // le propriétaire retire un invité
    expect(ownerMayNotBeRemoved(data, C, C)).toBe(false); // un invité part de lui-même
  });

  test('sans propriétaire membre, personne n’est protégé', () => {
    expect(ownerMayNotBeRemoved({ ownerId: A, members: members(C) }, A, C)).toBe(false);
    expect(ownerMayNotBeRemoved(null, A, C)).toBe(false);
  });
});
