<script lang="ts">
	/** French number plate (blue European band, letter F). */
	let { plaque: plate }: { plaque: string } = $props();
	const STARS = Array.from({ length: 12 }, (_, i) => {
		const a = (i / 12) * Math.PI * 2;
		return { x: 10 + Math.cos(a) * 5.2, y: 9 + Math.sin(a) * 5.2 };
	});
</script>

<span class="plaque" role="img" aria-label="Plaque d'immatriculation {plate}">
	<span class="ue" aria-hidden="true">
		<svg viewBox="0 0 20 18" width="14" height="13">
			{#each STARS as e, i (i)}<circle cx={e.x} cy={e.y} r="1.05" fill="#ffd400" />{/each}
		</svg>
		<b>F</b>
	</span>
	<span class="num">{plate}</span>
	<span class="ue fin" aria-hidden="true"></span>
</span>

<style>
	.plaque {
		display: inline-flex;
		align-items: stretch;
		height: 28px;
		border: 1.5px solid #141414;
		border-radius: 5px;
		overflow: hidden;
		background: #fdfdfb;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.4) inset,
			0 2px 6px rgba(0, 0, 0, 0.35);
		font-family: 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif;
		user-select: all;
	}
	.ue {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 18px;
		background: #0b3fa8;
		color: #fff;
		font-size: 9px;
		line-height: 1;
	}
	.ue.fin {
		width: 12px;
	}
	.num {
		padding: 0 9px;
		color: #111;
		font-size: 17px;
		font-weight: 700;
		letter-spacing: 0.07em;
		line-height: 25px;
		white-space: nowrap;
	}
</style>
