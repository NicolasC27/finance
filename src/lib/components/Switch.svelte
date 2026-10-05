<script lang="ts">
	/**
	 * On/off switch (30 × 18 px, accent when on), a button with role="switch": `onchange` gets the new
	 * state. Name it with `label` (aria-label) or `labelledby` (id of a visible label).
	 */
	let {
		checked,
		onchange,
		label = undefined,
		labelledby = undefined,
		disabled = false
	}: { checked: boolean; onchange: (on: boolean) => void; label?: string; labelledby?: string; disabled?: boolean } = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	aria-labelledby={labelledby}
	{disabled}
	class="switch shrink-0 cursor-pointer"
	onclick={() => onchange(!checked)}
>
	<span class="switch-knob" aria-hidden="true"></span>
</button>

<style>
	.switch {
		position: relative;
		width: 30px;
		height: 18px;
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background-color: var(--surface-2);
		transition:
			background-color var(--motion-base) ease,
			border-color var(--motion-base) ease;
	}

	.switch[aria-checked='true'] {
		background-color: var(--accent);
		border-color: var(--accent);
	}

	.switch:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.switch-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 999px;
		background-color: var(--text-2);
		transition:
			transform var(--motion-slow) var(--ease-spring),
			width var(--motion-fast) var(--ease-out),
			background-color var(--motion-base) ease;
	}

	.switch:active:not(:disabled) .switch-knob {
		width: 15px;
	}

	.switch[aria-checked='true']:active:not(:disabled) .switch-knob {
		transform: translateX(9px);
	}

	.switch[aria-checked='true'] .switch-knob {
		transform: translateX(12px);
		background-color: var(--bg);
	}

	@media (prefers-reduced-motion: reduce) {
		.switch,
		.switch-knob {
			transition: none;
		}
	}
</style>
