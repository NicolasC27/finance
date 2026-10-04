<script lang="ts">
	/** Shimmer skeleton block (1.2 s) shown while data first loads. */
	let {
		h = 16,
		w = '100%',
		rounded = 10,
		class: cls = ''
	}: {
		/** Height in px. */
		h?: number;
		/** Width (px or CSS value). */
		w?: number | string;
		rounded?: number;
		class?: string;
	} = $props();
</script>

<div
	class="skeleton {cls}"
	style="height: {h}px; width: {typeof w === 'number' ? `${w}px` : w}; border-radius: {rounded}px;"
	aria-hidden="true"
></div>
