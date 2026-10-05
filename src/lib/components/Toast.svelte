<script lang="ts">
	import { uiState } from '$lib/ui.svelte';
	import SuccessCheck from './SuccessCheck.svelte';

	/**
	 * Global toast (bottom of the viewport, centred): discreet rule, 999px-radius pill, 200 ms
	 * entrance with a slight spring, auto-close after 5 s, optional action (e.g. 'Annuler'), animated
	 * check for success toasts.
	 */

	let timer: ReturnType<typeof setTimeout> | null = null;

	// Auto-close after 5 s (restarted on every new toast via nonce)
	$effect(() => {
		const nonce = uiState.toast?.nonce;
		if (nonce === undefined) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (uiState.toast = null), 5000);
		return () => {
			if (timer) clearTimeout(timer);
		};
	});

	function runAction() {
		const action = uiState.toast?.onAction;
		uiState.toast = null;
		action?.();
	}
</script>

<!-- Live region ALWAYS in the DOM: when inserted together with its content it was not announced -->
<div class="sr-only" role="status" aria-live="polite">{uiState.toast?.message ?? ''}</div>
{#if uiState.toast}
	{#key uiState.toast.nonce}
	<div class="toast-global">
		{#if uiState.toast.success}<SuccessCheck size={16} />{/if}
		<span class="truncate text-sm">{uiState.toast.message}</span>
		{#if uiState.toast.actionLabel}
			<button type="button" class="toast-action press shrink-0 cursor-pointer" onclick={runAction}>
				{uiState.toast.actionLabel}
			</button>
		{/if}
		<button
			type="button"
			class="press flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-secondary transition-colors hover:text-[var(--text)]"
			aria-label="Fermer"
			onclick={() => (uiState.toast = null)}
		>
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
				<path d="M6 6l12 12M18 6L6 18" />
			</svg>
		</button>
	</div>
	{/key}
{/if}

<style>
	.toast-global {
		position: fixed;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
		left: 50%;
		z-index: 90;
		display: flex;
		align-items: center;
		gap: 0.9rem;
		max-width: min(92vw, 480px);
		padding: 0.55rem 0.7rem 0.55rem 1.1rem;
		border: 1px solid var(--hairline);
		border-radius: 999px;
		background-color: var(--surface-2);
		box-shadow: var(--shadow-soft);
		animation: toast-global-in var(--motion-slow) var(--ease-spring) backwards;
	}

	@media (min-width: 1024px) {
		.toast-global {
			bottom: 28px;
		}
	}

	.toast-action {
		font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif;
		font-size: 14px;
		color: var(--accent);
		border-bottom: 1px solid transparent;
		transition: border-color 200ms ease;
	}

	.toast-action:hover {
		border-color: var(--accent);
	}

	@keyframes toast-global-in {
		from {
			opacity: 0;
			transform: translate(-50%, 12px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0) scale(1);
		}
	}

	.toast-global {
		transform: translate(-50%, 0);
	}
</style>
