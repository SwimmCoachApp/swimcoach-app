/**
 * Section « Espace » des réglages : nom de l'espace, membres, invitations, nouvel espace, suppression.
 *
 * Tous les membres ont les mêmes droits (renommer, ajouter, retirer n'importe qui, soi compris).
 * Le dernier membre ne peut pas quitter l'espace : il le supprime. Aucune invitation n'est envoyée
 * par e-mail : l'entraîneur prévient lui-même son collègue.
 */
import { supabase } from '../../core/supabase.js';
import { html, raw } from '../../core/html.js';
import { getCoach } from '../../core/session.js';
import { listMyTeams, createTeam } from '../../core/teams.js';
import { openTeam, forgetTeam } from '../../core/sync.js';
import { flush, pendingCount } from '../../core/outbox.js';
import { on } from '../../app/actions.js';
import { askConfirm } from '../../app/dialog.js';
import { toast } from '../../app/toast.js';
import { setCurrentTeamName, switchTeam, leaveClosedTeam, currentTeam } from '../../app/shell.js';

const BUCKET = 'photos';
/** Taille d'une page de lecture (et d'un lot de suppression) du stockage. */
export const STORAGE_PAGE = 100;
/** Attente maximale de l'envoi de la file avant de quitter un espace. */
const LEAVE_FLUSH_MS = 3000;

export const MSG_LAST_MEMBER = "Tu es le dernier membre : supprime l'espace si tu n'en as plus besoin";
export const MSG_PHOTOS_FAILED = "Impossible de supprimer les photos de l'espace (vérifie ta connexion) : l'espace n'a pas été supprimé";

/** Message français pour une erreur de fonction serveur des espaces. */
export function memberError(error) {
  const m = String(error?.message ?? '');
  if (/invalid_email/.test(m)) return 'Adresse e-mail invalide';
  if (/too_many_invites/.test(m)) return "Trop d'invitations, réessaie dans une heure";
  if (/last_member/.test(m)) return MSG_LAST_MEMBER;
  if (/invalid_name/.test(m)) return "Le nom de l'espace doit faire entre 1 et 60 caractères";
  if (/not_allowed/.test(m)) return "Tu n'as pas accès à cette action";
  if (/fetch|network|Failed/i.test(m) || error?.status === 0) return 'Connexion impossible, vérifie ta connexion internet';
  return 'Une erreur est survenue, réessaie';
}

async function rpc(name, args) {
  let res;
  try {
    res = await supabase.rpc(name, args);
  } catch (e) {
    throw new Error(memberError(e));
  }
  if (res.error) throw new Error(memberError(res.error));
  return res.data;
}

/**
 * Membres et invitations en attente d'un espace.
 * @param {string} teamId
 * @returns {Promise<{members: {id: string, email: string, name: string}[], invites: {email: string}[]}>}
 * @throws {Error} hors ligne
 */
export async function loadMembers(teamId) {
  const fail = () => { throw new Error('Membres indisponibles : vérifie ta connexion'); };
  const links = await supabase.from('team_members').select('coach_id').eq('team_id', teamId);
  if (links.error) fail();
  const ids = links.data.map((m) => m.coach_id);
  const coaches = ids.length ? await supabase.from('coaches').select('id, email, display_name').in('id', ids) : { data: [], error: null };
  if (coaches.error) fail();
  const invites = await supabase.from('team_invites').select('email').eq('team_id', teamId).order('email');
  if (invites.error) fail();
  const byId = new Map(coaches.data.map((c) => [c.id, c]));
  const members = ids.map((id) => {
    const c = byId.get(id);
    return { id, email: c?.email ?? '', name: (c?.display_name ?? '').trim() };
  }).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'fr'));
  return { members, invites: invites.data.map((i) => ({ email: i.email })) };
}

/**
 * Ajoute un entraîneur par son adresse e-mail.
 * @param {string} teamId
 * @param {string} email
 * @returns {Promise<string>} message à afficher
 * @throws {Error} message français (adresse invalide, trop d'invitations…)
 */
export async function addMember(teamId, email) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) throw new Error('Adresse e-mail invalide');
  const result = await rpc('add_team_member', { team: teamId, email: clean });
  if (result === 'added') return `${clean} a été ajouté`;
  if (result === 'invited') return `Invitation en attente : demande à ${clean} de créer son compte avec cette adresse`;
  if (result === 'already_member') return 'Déjà membre';
  return 'Une erreur est survenue, réessaie';
}

/**
 * Chemins de tous les fichiers du bucket photos sous `<teamId>/` (sous-dossiers compris), page par page.
 * @param {string} teamId
 * @returns {Promise<string[]>}
 * @throws {Error} si une page ne peut pas être lue
 */
export async function listTeamPhotos(teamId) {
  const files = [];
  const folders = [String(teamId).toLowerCase()];
  while (folders.length) {
    const dir = folders.shift();
    for (let offset = 0; ; offset += STORAGE_PAGE) {
      let res;
      try {
        res = await supabase.storage.from(BUCKET).list(dir, { limit: STORAGE_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
      } catch (e) {
        res = { data: null, error: e };
      }
      if (res.error || !Array.isArray(res.data)) throw new Error(MSG_PHOTOS_FAILED);
      for (const entry of res.data) {
        const path = `${dir}/${entry.name}`;
        if (entry.id == null) folders.push(path);
        else files.push(path);
      }
      if (res.data.length < STORAGE_PAGE) break;
    }
  }
  return files;
}

/**
 * Supprime toutes les photos d'un espace (jamais d'image d'un mineur orpheline). Relit jusqu'à ce que
 * le dossier soit vide (une photo envoyée entre-temps par un collègue est aussi supprimée).
 * @param {string} teamId
 * @throws {Error} MSG_PHOTOS_FAILED si une lecture ou une suppression échoue, ou si le dossier ne se vide pas
 */
export async function deleteTeamPhotos(teamId) {
  for (let round = 0; round < 5; round += 1) {
    const paths = await listTeamPhotos(teamId);
    if (!paths.length) return;
    for (let i = 0; i < paths.length; i += STORAGE_PAGE) {
      let res;
      try {
        res = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + STORAGE_PAGE));
      } catch (e) {
        res = { error: e };
      }
      if (res.error) throw new Error(MSG_PHOTOS_FAILED);
    }
  }
  throw new Error(MSG_PHOTOS_FAILED);
}

/**
 * Supprime un espace pour tous ses membres : ses photos d'abord, puis l'espace et ses données.
 * Sans effet sur le serveur si les photos ne peuvent pas être supprimées.
 * @param {string} teamId
 * @throws {Error} message français
 */
export async function deleteTeam(teamId) {
  await deleteTeamPhotos(teamId);
  await rpc('delete_team', { team: teamId });
}

/** Envoie la file d'un espace avant de le quitter (attente bornée, en ligne seulement). */
async function flushBefore(coachId, teamId) {
  if (!navigator.onLine) return;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, LEAVE_FLUSH_MS); });
  try {
    await Promise.race([flush(supabase, coachId, teamId).catch(() => {}), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────────── affichage

/** État de la section, par espace ouvert dans les réglages. */
const ui = { root: null, team: null, data: null, error: '' };

function memberRowHtml(m, meId) {
  const self = m.id === meId;
  return html`<li class="member-row" data-id="${m.id}">
    <div class="member-text">
      <div class="member-name">${m.name || m.email}${self ? raw(' <span class="member-self">(toi)</span>') : ''}</div>
      ${m.name ? raw(html`<div class="member-email">${m.email}</div>`) : ''}
    </div>
    <button type="button" class="btn-sm btn-danger-ghost" data-action="member-remove" data-id="${m.id}">${self ? "Quitter l'espace" : 'Retirer'}</button>
  </li>`;
}

function listsHtml() {
  if (ui.error) return html`<p class="settings-note" role="status">${ui.error}</p>`;
  if (!ui.data) return '<p class="settings-note" role="status">Chargement des membres…</p>';
  const meId = getCoach()?.id;
  const invites = ui.data.invites.length
    ? html`<h3 class="settings-sub">Invitations en attente</h3>
      <ul class="settings-list">${ui.data.invites.map((i) => raw(html`<li class="invite-row">
        <div class="member-text"><div class="member-name">${i.email}</div><div class="member-email">Compte pas encore créé</div></div>
        <button type="button" class="btn-sm btn-ghost" data-action="invite-cancel" data-email="${i.email}" aria-label="Annuler l'invitation de ${i.email}">Annuler</button>
      </li>`))}</ul>`
    : '';
  return html`<h3 class="settings-sub">Membres</h3>
    <ul class="settings-list">${ui.data.members.map((m) => raw(memberRowHtml(m, meId)))}</ul>
    ${raw(invites)}`;
}

/**
 * Balisage de la section « Espace ».
 * @param {{id: string, name: string}} team espace ouvert
 * @returns {string}
 */
export function spaceSectionHtml(team) {
  return html`<section class="settings-card" aria-labelledby="settings-space-title">
    <h2 class="settings-title" id="settings-space-title">Espace</h2>
    <label class="form-label" for="space-name">Nom de l'espace</label>
    <div class="settings-row">
      <input type="text" class="form-input" id="space-name" maxlength="60" autocomplete="off" value="${team.name}">
      <button type="button" class="btn-sm btn-accent" data-action="space-rename">Renommer</button>
    </div>
    <div id="space-lists">${raw(listsHtml())}</div>
    <label class="form-label settings-gap" for="member-email">Ajouter un entraîneur (adresse e-mail)</label>
    <div class="settings-row">
      <input type="email" class="form-input" id="member-email" autocomplete="off" autocapitalize="none" inputmode="email" placeholder="collegue@club.fr">
      <button type="button" class="btn-sm btn-accent" data-action="member-add">Ajouter</button>
    </div>
    <p class="settings-msg" data-members-msg role="status"></p>
    <p class="settings-note">Aucun e-mail n'est envoyé : préviens ton collègue toi-même.</p>
    <label class="form-label settings-gap" for="space-new">Créer un autre espace</label>
    <div class="settings-row">
      <input type="text" class="form-input" id="space-new" maxlength="60" autocomplete="off" placeholder="Nom du nouvel espace" aria-label="Nom du nouvel espace">
      <button type="button" class="btn-sm btn-ghost" data-action="space-create">Créer l'espace</button>
    </div>
    <button type="button" class="btn-full btn-danger-ghost settings-gap" data-action="space-delete">Supprimer l'espace et toutes ses données</button>
  </section>`;
}

const find = (sel) => ui.root?.querySelector(sel) ?? null;

function refreshLists() {
  const box = find('#space-lists');
  if (box) box.innerHTML = listsHtml();
}

function setMsg(text) {
  const el = find('[data-members-msg]');
  if (el) el.textContent = text;
}

async function reload() {
  const team = ui.team;
  try {
    const data = await loadMembers(team.id);
    if (ui.team !== team) return;
    ui.data = data;
    ui.error = '';
  } catch (e) {
    if (ui.team !== team) return;
    ui.error = e.message;
  }
  refreshLists();
}

/**
 * Branche la section « Espace » dans l'écran des réglages (après insertion de spaceSectionHtml).
 * @param {HTMLElement} root écran des réglages
 * @param {{id: string, name: string}} team espace ouvert
 */
export function mountSpaceSection(root, team) {
  ui.root = root;
  ui.team = team;
  ui.data = null;
  ui.error = '';
  reload();
}

const live = () => ui.root?.isConnected && ui.team;

/** Bouton occupé pendant un appel (évite les doubles envois). */
async function busy(btn, run) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await run();
  } finally {
    btn.disabled = false;
  }
}

on('space-rename', (btn) => busy(btn, async () => {
  if (!live()) return;
  const team = ui.team;
  const name = find('#space-name').value.trim();
  if (!name || name.length > 60) {
    toast("Le nom de l'espace doit faire entre 1 et 60 caractères");
    return;
  }
  try {
    await rpc('rename_team', { team: team.id, name });
  } catch (e) {
    toast(e.message);
    return;
  }
  // Pendant l'appel, l'entraîneur a pu changer d'espace : l'en-tête ne doit pas prendre ce nom.
  if (currentTeam()?.id !== team.id) return;
  ui.team = { ...team, name };
  try { await listMyTeams(); } catch { /* la liste sera relue au prochain routage */ }
  if (currentTeam()?.id !== team.id) return;
  const coach = getCoach();
  if (coach) openTeam(coach.id, ui.team).catch(() => {}); // espace déjà ouvert : retient seulement le nouveau nom
  setCurrentTeamName(team.id, name);
  toast('Espace renommé');
}));

on('member-add', (btn) => busy(btn, async () => {
  if (!live()) return;
  const input = find('#member-email');
  try {
    setMsg(await addMember(ui.team.id, input.value));
    input.value = '';
    await reload();
  } catch (e) {
    setMsg(e.message);
  }
}));

on('invite-cancel', (btn) => busy(btn, async () => {
  if (!live()) return;
  try {
    await rpc('cancel_invite', { team: ui.team.id, email: btn.dataset.email });
    setMsg('Invitation annulée');
    await reload();
  } catch (e) {
    setMsg(e.message);
  }
}));

on('member-remove', async (btn) => {
  if (!live() || btn.disabled) return;
  const team = ui.team;
  const coach = getCoach();
  const member = ui.data?.members.find((m) => m.id === btn.dataset.id);
  if (!coach || !member) return;
  const self = member.id === coach.id;
  const pending = self ? pendingCount(team.id) : 0;
  const ok = await askConfirm(self
    ? {
      icon: '🚪',
      title: `Quitter l'espace « ${team.name} » ?`,
      text: `Tu n'y auras plus accès sur aucun appareil, sauf si un membre t'ajoute de nouveau.${pending ? ` ${pending} modification(s) pas encore envoyée(s) seront perdues si le réseau manque.` : ''}`,
      confirm: 'Quitter',
      danger: true,
    }
    : {
      icon: '👋',
      title: `Retirer ${member.name || member.email} de l'espace ?`,
      text: "Il n'aura plus accès aux données de l'espace.",
      confirm: 'Retirer',
      danger: true,
    });
  if (!ok || ui.team !== team) return;
  await busy(btn, async () => {
    if (self) await flushBefore(coach.id, team.id);
    try {
      await rpc('remove_team_member', { team: team.id, coach: member.id });
    } catch (e) {
      setMsg(e.message);
      return;
    }
    if (!self) {
      setMsg(`${member.name || member.email} a été retiré`);
      await reload();
      return;
    }
    forgetTeam(coach.id, team.id);
    toast(`Tu as quitté l'espace « ${team.name} »`);
    leaveClosedTeam();
  });
});

on('space-create', (btn) => busy(btn, async () => {
  if (!live()) return;
  const name = find('#space-new').value.trim();
  try {
    const id = await createTeam(name);
    switchTeam(id, name);
  } catch (e) {
    toast(e.message);
  }
}));

on('space-delete', async (btn) => {
  if (!live() || btn.disabled) return;
  const team = ui.team;
  const coach = getCoach();
  if (!coach) return;
  const ok = await askConfirm({
    icon: '🗑',
    title: `Supprimer l'espace « ${team.name} » ?`,
    text: 'Toutes ses données (nageurs, séances, présences, planning, performances, photos) seront supprimées pour tous ses membres. Cette action est définitive.',
    typed: team.name,
    typedLabel: "Tape le nom de l'espace pour confirmer",
    confirm: "Supprimer l'espace",
    danger: true,
  });
  if (!ok || ui.team !== team) return;
  await busy(btn, async () => {
    try {
      await deleteTeam(team.id);
    } catch (e) {
      toast(e.message);
      return;
    }
    forgetTeam(coach.id, team.id);
    toast(`L'espace « ${team.name} » a été supprimé`);
    leaveClosedTeam();
  });
});
