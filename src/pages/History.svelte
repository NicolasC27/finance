<script lang="ts">
	import { onMount } from 'svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { formatDate } from '$lib/format';
	import { diffSnapshots, pointKind, type PointInfo, type PointKind, type SnapshotDiff } from '$lib/restorePoints';
	import { currentData, hasRestorePoints, listRestorePoints, readRestorePoint, restorePoint, rollbackTo } from '$lib/history.svelte';
	import { showSuccess, showToast } from '$lib/ui.svelte';

	/**
	 * History of the data: restore points grouped by day and filtered by kind; the selected point
	 * shows what going back would remove or bring back; « Revenir à ce point » asks for confirmation,
	 * saves the current state first (so it can be undone) and reloads the restored data.
	 */

	const KINDS: { id: PointKind | 'all'; label: string }[] = [
		{ id: 'all', label: 'Tous' },
		{ id: 'import', label: 'Imports' },
		{ id: 'bulk', label: 'Modifications groupées' },
		{ id: 'ai', label: 'Actions IA' },
		{ id: 'daily', label: 'Quotidiens' },
		{ id: 'manual', label: 'Manuels' },
		{ id: 'restore', label: 'Retours' }
	];

	let points = $state<PointInfo[]>([]);
	let loading = $state(true);
	let error = $state('');
	let note = $state('');
	let kind = $state<PointKind | 'all'>('all');
	let selected = $state<number | null>(null);
	let diff = $state<SnapshotDiff | null>(null);
	let confirming = $state(false);
	let busy = $state(false);

	const counts = $derived.by(() => {
		const c = new Map<string, number>([['all', points.length]]);
		for (const p of points) c.set(pointKind(p.raison), (c.get(pointKind(p.raison)) ?? 0) + 1);
		return c;
	});
	const totalBytes = $derived(points.reduce((s, p) => s + p.octets, 0));
	const shown = $derived(kind === 'all' ? points : points.filter((p) => pointKind(p.raison) === kind));
	const days = $derived.by(() => {
		const out: { day: string; items: PointInfo[] }[] = [];
		for (const p of shown) {
			const day = p.cree_le.slice(0, 10);
			if (out.at(-1)?.day === day) out.at(-1)!.items.push(p);
			else out.push({ day, items: [p] });
		}
		return out;
	});
	const current = $derived(points.find((p) => p.id === selected) ?? null);

	async function refresh() {
		loading = true;
		try {
			points = await listRestorePoints();
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		if (hasRestorePoints()) void refresh();
		else loading = false;
	});

	async function create() {
		busy = true;
		const p = await restorePoint(note.trim() || 'point manuel');
		busy = false;
		note = '';
		if (p) showSuccess('Point de restauration créé');
		await refresh();
	}

	async function select(p: PointInfo) {
		confirming = false;
		if (selected === p.id) return void (selected = null);
		selected = p.id;
		diff = null;
		try {
			const d = diffSnapshots(await readRestorePoint(p.id), currentData());
			if (selected === p.id) diff = d;
		} catch (e) {
			showToast(e instanceof Error ? e.message : String(e));
			selected = null;
		}
	}

	async function goBack(p: PointInfo) {
		busy = true;
		try {
			await rollbackTo(p.id);
			showToast('Données revenues au point choisi : rechargement…');
			setTimeout(() => location.reload(), 600);
		} catch (e) {
			busy = false;
			showToast(e instanceof Error ? e.message : String(e));
		}
	}

	const hour = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.round(n / 1024)} Ko`);
	const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;
</script>

<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Historique des données" />
	{#if hasRestorePoints()}
		<form
			class="flex items-center gap-1.5"
			onsubmit={(e) => {
				e.preventDefault();
				void create();
			}}
		>
			<input type="text" class="input-surface w-56" placeholder="Note (facultatif)" maxlength="120" bind:value={note} aria-label="Note du point de restauration" />
			<button type="submit" class="btn btn-secondary btn-sm shrink-0" disabled={busy}>Créer un point</button>
		</form>
	{/if}
</header>

{#if !hasRestorePoints()}
	<p class="card p-4 text-[13px] text-secondary">Disponible quand les données sont dans la base chiffrée du projet.</p>
{:else}
	<p class="meta-xs mb-2">
		Un point est pris avant chaque import, modification groupée, action IA ou restauration, et une fois par jour. Les plus anciens sont espacés
		automatiquement (un par jour sur 30 jours, un par semaine sur 6 mois, un par mois sur 2 ans).
		{#if points.length}<span class="tabular">{plural(points.length, 'point')} · {size(totalBytes)}</span>{/if}
	</p>
	<div class="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Type de point">
		{#each KINDS as k (k.id)}
			{#if k.id === 'all' || counts.get(k.id)}
				<button type="button" class="chip {kind === k.id ? 'chip-accent' : 'chip-outline'}" aria-pressed={kind === k.id} onclick={() => (kind = k.id)}>
					{k.label} <span class="tabular opacity-70">{counts.get(k.id) ?? 0}</span>
				</button>
			{/if}
		{/each}
	</div>

	{#if loading}
		<p class="meta-xs">Chargement…</p>
	{:else if error}
		<p class="meta-xs" style="color: var(--amber);">{error}</p>
	{:else if points.length === 0}
		<p class="meta-xs">Aucun point pour l'instant.</p>
	{:else}
		<div class="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
			<div class="card p-0">
				{#each days as d (d.day)}
					<section>
						<h2 class="label-plain sticky top-0 border-b px-4 py-1.5" style="border-color: var(--border-subtle); background-color: var(--surface);">{formatDate(d.day)}</h2>
						<ul class="divide-y divide-[var(--border-subtle)] text-[12px]">
							{#each d.items as p (p.id)}
								<li>
									<button
										type="button"
										class="flex w-full cursor-pointer items-center gap-3 px-4 py-1.5 text-left hover:bg-[var(--surface-hover)]"
										style={selected === p.id ? 'background-color: var(--surface-2);' : ''}
										aria-pressed={selected === p.id}
										onclick={() => select(p)}
									>
										<span class="tabular w-10 shrink-0 text-secondary">{hour(p.cree_le)}</span>
										<span class="min-w-0 flex-1 truncate">{p.raison}</span>
										<span class="meta-xs shrink-0">{size(p.octets)}</span>
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>

			<aside class="card p-4 text-[13px] lg:sticky lg:top-3" aria-live="polite">
				{#if !current}
					<p class="meta-xs">Choisis un point pour voir ce que changerait un retour en arrière.</p>
				{:else}
					<p class="label-plain">{formatDate(current.cree_le.slice(0, 10))} · {hour(current.cree_le)}</p>
					<p class="mt-1">{current.raison}</p>
					{#if !diff}
						<p class="meta-xs mt-2">Comparaison…</p>
					{:else}
						{@const nothing = !diff.opsAdded && !diff.opsRemoved && !diff.opsChanged && !diff.changed.length}
						{#if nothing}
							<p class="meta-xs mt-2">Identique aux données actuelles.</p>
						{:else}
							<p class="meta-xs mt-2">Revenir à ce point :</p>
							<ul class="mt-1 space-y-0.5 text-[12px]">
								{#if diff.opsAdded}<li>retirera {plural(diff.opsAdded, 'opération')} ajoutée{diff.opsAdded > 1 ? 's' : ''} depuis</li>{/if}
								{#if diff.opsRemoved}<li>rétablira {plural(diff.opsRemoved, 'opération')} supprimée{diff.opsRemoved > 1 ? 's' : ''}</li>{/if}
								{#if diff.opsChanged}<li>annulera {plural(diff.opsChanged, 'modification')} d'opération</li>{/if}
								{#if diff.changed.length}<li>remettra : {diff.changed.join(', ')}</li>{/if}
							</ul>
							{#if confirming}
								<p class="meta-xs mt-3" style="color: var(--amber);">L'état actuel est sauvegardé d'abord : tu pourras revenir ici.</p>
								<div class="mt-1.5 flex gap-1.5">
									<button type="button" class="btn btn-primary btn-sm" disabled={busy} onclick={() => goBack(current)}>Confirmer le retour</button>
									<button type="button" class="btn btn-secondary btn-sm" onclick={() => (confirming = false)}>Annuler</button>
								</div>
							{:else}
								<button type="button" class="btn btn-secondary btn-sm mt-3" onclick={() => (confirming = true)}>Revenir à ce point…</button>
							{/if}
						{/if}
					{/if}
				{/if}
			</aside>
		</div>
	{/if}
{/if}
