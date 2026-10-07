<script lang="ts">
	import { describeSky, formatDegrees, formatMillimetres, observationHour, placeLabel } from '$lib/weather';
	import { weatherState } from '$lib/weather.svelte';
	import SkyIcon from './SkyIcon.svelte';

	/**
	 * One discreet line in the home page header: sky icon, temperature and town; the sky, the day's
	 * range, the rain and the hour of the reading in the tooltip. Nothing while no place is chosen or
	 * before the first answer; after a failed refresh the last reading stays, marked as such.
	 */
	const sky = $derived(weatherState.weather ? describeSky(weatherState.weather.code) : null);
	const title = $derived.by(() => {
		const w = weatherState.weather;
		const place = weatherState.place;
		if (!w || !place || !sky) return '';
		const hour = observationHour(w.at);
		return [
			placeLabel(place),
			sky.label,
			formatDegrees(w.temperature),
			`min ${formatDegrees(w.min)}`,
			`max ${formatDegrees(w.max)}`,
			w.precipitation > 0 ? `pluie ${formatMillimetres(w.precipitation)}` : '',
			hour ? `relevé à ${hour}` : '',
			weatherState.error ? 'dernière lecture connue' : '',
			'Open-Meteo'
		]
			.filter(Boolean)
			.join(' · ');
	});
</script>

{#if weatherState.weather && weatherState.place && sky}
	<p class="meta-xs flex items-center gap-1.5" {title}>
		<SkyIcon icon={sky.icon} size={14} />
		<span class="sr-only">{sky.label},</span>
		<span class="tabular">{formatDegrees(weatherState.weather.temperature)}</span><span class="truncate">· {weatherState.place.name}</span>
	</p>
{/if}
