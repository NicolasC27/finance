import './app.css';
import { diskState, initDiskStorage, onChangesElsewhere } from './lib/diskStorage';

// Database data (donnees/budget.db, encrypted SQLite) is loaded BEFORE the app, because stores read
// their state when they are imported (see diskStorage.ts).
await initDiskStorage();

/**
 * Database unreachable: message instead of the app (which would otherwise write into the browser).
 */
function showDataError(reason: string): void {
	const box = document.createElement('div');
	box.setAttribute('role', 'alert');
	box.style.cssText =
		'max-width:36rem;margin:15vh auto;padding:1rem 1.25rem;font-size:13px;line-height:1.5;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:10px';
	const title = document.createElement('strong');
	title.textContent = 'Base de données inaccessible';
	const why = document.createElement('p');
	why.style.margin = '0.5rem 0';
	why.textContent = reason;
	const safe = document.createElement('p');
	safe.style.cssText = 'margin:0 0 0.75rem;opacity:0.75';
	safe.textContent = "L'app ne démarre pas, pour ne rien écrire ailleurs : tes données restent intactes dans donnees/budget.db.";
	const retry = document.createElement('button');
	retry.className = 'btn btn-sm';
	retry.textContent = 'Réessayer';
	retry.addEventListener('click', () => location.reload());
	box.append(title, why, safe, retry);
	document.getElementById('app')!.replaceChildren(box);
}

if (diskState.mode === 'erreur') {
	showDataError(diskState.erreur);
} else {
	const { mount } = await import('svelte');
	const { default: App } = await import('./App.svelte');
	mount(App, { target: document.getElementById('app')! });
	const { showToast } = await import('./lib/ui.svelte');
	onChangesElsewhere({
		conflit: () =>
			showToast('Pas enregistré : ces données ont changé dans un autre onglet. Recharge la page puis refais la modification.', 'Recharger', () => location.reload()),
		perime: () => showToast('Données modifiées dans un autre onglet.', 'Recharger', () => location.reload())
	});
	if (diskState.migrated > 0) {
		showToast(`Données déplacées dans la base chiffrée (${diskState.migrated} éléments, ${diskState.dir}) : le navigateur n'en garde plus de copie.`);
	}
}
