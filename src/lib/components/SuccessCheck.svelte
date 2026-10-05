<script lang="ts">
	/**
	 * Animated success mark: the circle draws itself, then the check, with a small spring pop. Used by
	 * success toasts and applied actions; static when motion is reduced (global CSS rule).
	 */
	let { size = 16, color = 'var(--accent)' }: { size?: number; color?: string } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" class="success-check shrink-0">
	<circle cx="12" cy="12" r="10" stroke={color} stroke-width="1.8" pathLength={1} class="success-circle" />
	<path d="M7.5 12.4l3 3 6-6.4" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" pathLength={1} class="success-tick" />
</svg>

<style>
	.success-check {
		animation: success-pop 420ms var(--ease-spring) backwards;
	}
	.success-circle {
		stroke-dasharray: 1;
		animation: trace-line 360ms var(--ease-out) backwards;
	}
	.success-tick {
		stroke-dasharray: 1;
		animation: trace-line 260ms var(--ease-out) 260ms backwards;
	}
	@keyframes success-pop {
		from {
			transform: scale(0.6);
			opacity: 0;
		}
	}
</style>
