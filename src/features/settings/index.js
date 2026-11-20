/**
 * Écran Réglages : nom affiché (`coaches.display_name`), thème, groupes, espace (membres), envoi des
 * modifications (en attente / refusées), déconnexion et suppression du compte.
 */
import { supabase } from '../../core/supabase.js';
import { getCoach, deleteAccount } from '../../core/session.js';
import { coachStore } from '../../core/storage.js';
import { subscribe, TABLES } from '../../core/store.js';
import { pendingCount, rejectedCount, listRejected, clearRejected } from '../../core/outbox.js';
import { todayKey } from '../../core/dates.js';
import { on } from '../../app/actions.js';
import { registerScreen, currentTeam } from '../../app/shell.js';
import { applyTheme, currentTheme } from '../../app/theme.js';
import { askConfirm } from '../../app/dialog.js';
import { toast } from '../../app/toast.js';
import { listGroups, addGroup, deleteGroup } from '../contacts/logic.js';
import { spaceSectionHtml, mountSpaceSection } from '../teams/members.js';
import { screenHtml, groupsHtml, syncHtml } from './view.js';

const ui = { root: null, unsubs: [] };

function stop() {
  for (const off of ui.unsubs) off();
  ui.unsubs = [];
  ui.root = null;
}

const find = (sel) => ui.root?.querySelector(sel) ?? null;

/** Redessine les blocs qui dépendent du store (groupes, compteurs d'envoi). */
function draw() {
  const box = find('#settings-groups');
  if (box) box.innerHTML = groupsHtml(listGroups());
  refreshSync();
}

/** Changement du store : redessine, ou se désabonne si l'écran a été remplacé. */
function onStoreChange() {
  if (!ui.root) return;
  if (!ui.root.isConnected) {
    stop();
    return;
  }
  draw();
}

/** Compteurs de l'espace ouvert seulement (la déconnexion, elle, compte tous les espaces). */
function refreshSync() {
  const box = find('#settings-sync');
  const team = currentTeam();
  if (box && team) box.innerHTML = syncHtml(pendingCount(team.id), rejectedCount(team.id));
}

/** Lit le nom affiché (dernier connu hors ligne). */
async function loadDisplayName(coachId) {
  const { data, error } = await supabase.from('coaches').select('display_name').eq('id', coachId).maybeSingle();
  if (error) return;
  const name = data?.display_name ?? '';
  coachStore(coachId).set('displayName', name);
  const input = find('#settings-display-name');
  if (input && getCoach()?.id === coachId && document.activeElement !== input) input.value = name;
}

function render(root) {
  stop();
  const coach = getCoach();
  const team = currentTeam();
  if (!coach || !team) return;
  ui.root = root;
  root.classList.add('screen', 'settings');
  root.innerHTML = screenHtml({
    email: coach.email,
    displayName: coachStore(coach.id).get('displayName') ?? '',
    theme: currentTheme(),
    space: spaceSectionHtml(team),
  });
  draw(); // l'écran n'est pas encore dans la page : pas de test isConnected ici
  mountSpaceSection(root, team);
  ui.unsubs = TABLES.map((t) => subscribe(t, onStoreChange));
  loadDisplayName(coach.id).catch(() => {});
}

/** Enregistre l'écran Réglages (bouton engrenage de la barre du haut). */
export function registerSettingsScreen() {
  registerScreen('settings', { title: 'Réglages', render });
}

on('settings-save-name', async (btn) => {
  const coach = getCoach();
  const input = find('#settings-display-name');
  if (!coach || !input || btn.disabled) return;
  const name = input.value.trim().slice(0, 60);
  btn.disabled = true;
  try {
    const { error } = await supabase.from('coaches').update({ display_name: name }).eq('id', coach.id);
    if (error) throw error;
    coachStore(coach.id).set('displayName', name);
    toast('Nom enregistré');
    if (ui.root) mountSpaceSection(ui.root, currentTeam()); // la liste des membres montre le nouveau nom
  } catch {
    toast('Enregistrement impossible, vérifie ta connexion');
  } finally {
    btn.disabled = false;
  }
});

on('settings-theme', (btn) => {
  applyTheme(btn.dataset.key);
  const theme = currentTheme();
  for (const b of ui.root?.querySelectorAll('[data-action="settings-theme"]') ?? []) {
    b.classList.toggle('active', b.dataset.key === theme);
    b.setAttribute('aria-pressed', b.dataset.key === theme ? 'true' : 'false');
  }
  const toggle = document.querySelector('.top-bar [data-action="toggle-theme"]');
  if (toggle) toggle.textContent = theme === 'dark' ? '🌙' : '☀️';
});

on('settings-add-group', () => {
  const input = find('#settings-group-input');
  if (!input) return;
  const res = addGroup(input.value);
  if (!res.ok) {
    toast(res.error);
    return;
  }
  input.value = '';
  toast('Groupe ajouté');
});

on('settings-del-group', (btn) => {
  const res = deleteGroup(btn.dataset.id);
  toast(res.ok ? 'Groupe supprimé' : res.error);
});

on('settings-export-rejected', () => {
  const coach = getCoach();
  const team = currentTeam();
  if (!coach || !team) return;
  const names = new Map((coachStore(coach.id).get('teams') ?? []).map((t) => [t.id, t.name]));
  const rows = listRejected(coach.id, team.id).map((e) => ({ teamId: e.teamId, teamName: names.get(e.teamId) ?? '', at: e.at, error: e.error, op: e.op }));
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `swimcoach-modifs-refusees-${todayKey()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

on('settings-clear-rejected', async () => {
  const coach = getCoach();
  const team = currentTeam();
  if (!coach || !team) return;
  const n = rejectedCount(team.id);
  const ok = await askConfirm({
    icon: '🧹',
    title: 'Effacer les modifications refusées ?',
    text: `${n} modification(s) refusée(s) par le serveur du groupe « ${team.name} » seront oubliées sur cet appareil. Exporte-les d'abord pour en garder une trace.`,
    confirm: 'Effacer',
    danger: true,
  });
  if (!ok || getCoach()?.id !== coach.id || currentTeam()?.id !== team.id) return;
  clearRejected(coach.id, team.id);
  refreshSync();
});

on('settings-delete-account', async (btn) => {
  if (!getCoach() || btn.disabled) return;
  const ok = await askConfirm({
    icon: '⚠️',
    title: 'Supprimer mon compte ?',
    text: 'Les groupes dont tu es le seul membre seront supprimés avec leurs données (nageurs, séances, photos…). Tu quittes les groupes partagés, leurs données restent. Cette action est définitive.',
    typed: 'SUPPRIMER',
    typedLabel: 'Tape SUPPRIMER pour confirmer',
    confirm: 'Supprimer définitivement',
    danger: true,
  });
  if (!ok) return;
  btn.disabled = true;
  try {
    await deleteAccount(); // déconnexion : le routage ramène à l'écran de connexion
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
});
