<script lang="ts">
	import { bodyPalette } from '$lib/vehicle';

	/**
	 * Illustration of a compact SUV (compact SUV proportions: 4.40 m, 1.54 m, 2.66 m wheelbase, 18"
	 * rims), drawn in SVG: gradient paint, reflections, glazing, black cladding, glossy floor. Colour
	 * of your choice; no manufacturer artwork (copyright), no file.
	 */
	let { couleur: color = '#c8102e', titre: title = 'Voiture' }: { couleur?: string; titre?: string } = $props();

	// SVG ids specific to each drawing (gradients, masks)
	const u = `v${Math.random().toString(36).slice(2, 8)}`;
	const p = $derived(bodyPalette(color));

	const BODY_PATH =
		'M 62 236 C 59 222 58 202 60 186 C 61 174 66 164 78 158 C 100 150 148 143 190 138 C 230 134 270 130 300 126 C 318 118 342 100 368 84 C 380 76 392 68 408 62 C 440 54 500 52 540 56 C 570 59 596 68 616 82 C 630 92 640 104 646 116 C 652 126 656 140 658 156 C 660 176 660 200 656 222 C 654 230 650 236 642 238 L 598 238 A 56 56 0 1 0 496 238 L 236 238 A 56 56 0 1 0 134 238 L 74 238 C 68 238 64 238 62 236 Z';
	const SPOKE_ANGLES = Array.from({ length: 10 }, (_, i) => i * 36 + 8);
</script>

<svg viewBox="0 0 720 330" width="100%" role="img" aria-label={title}>
	<title>{title}</title>
	<defs>
		<linearGradient id="{u}peinture" gradientUnits="userSpaceOnUse" x1="0" y1="52" x2="0" y2="240">
			<stop offset="0" stop-color={p[0]} />
			<stop offset="0.36" stop-color={p[1]} />
			<stop offset="0.66" stop-color={p[2]} />
			<stop offset="1" stop-color={p[3]} />
		</linearGradient>
		<linearGradient id="{u}brillance" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.3" stop-color="#fff" stop-opacity="0.6" />
			<stop offset="0.75" stop-color="#fff" stop-opacity="0.15" />
			<stop offset="1" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
		<linearGradient id="{u}vitre" x1="0" y1="0" x2="0.6" y2="1">
			<stop offset="0" stop-color="#46536a" />
			<stop offset="0.5" stop-color="#151b24" />
			<stop offset="1" stop-color="#06080b" />
		</linearGradient>
		<linearGradient id="{u}reflet" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.28" />
			<stop offset="1" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
		<radialGradient id="{u}jante" cx="0.4" cy="0.35" r="0.75">
			<stop offset="0" stop-color="#f4f6f8" />
			<stop offset="0.5" stop-color="#a3aab1" />
			<stop offset="1" stop-color="#3a3f44" />
		</radialGradient>
		<radialGradient id="{u}pneu" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0.62" stop-color="#202226" />
			<stop offset="0.9" stop-color="#121315" />
			<stop offset="1" stop-color="#060607" />
		</radialGradient>
		<linearGradient id="{u}noir" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#2b2d31" />
			<stop offset="1" stop-color="#0c0d0f" />
		</linearGradient>
		<linearGradient id="{u}phare" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="#fff" />
			<stop offset="1" stop-color="#cfe6ff" />
		</linearGradient>
		<linearGradient id="{u}feu" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#ff3b3b" />
			<stop offset="1" stop-color="#7a0000" />
		</linearGradient>
		<radialGradient id="{u}halo">
			<stop offset="0" stop-color="currentColor" stop-opacity="0.09" />
			<stop offset="1" stop-color="currentColor" stop-opacity="0" />
		</radialGradient>
		<filter id="{u}flou" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="7" /></filter>
		<filter id="{u}lueur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.8" /></filter>
		<linearGradient id="{u}fondu" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#fff" stop-opacity="0.32" />
			<stop offset="0.55" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
		<mask id="{u}masque"><rect x="0" y="262" width="720" height="70" fill="url(#{u}fondu)" /></mask>
		<clipPath id="{u}caisse"><path d={BODY_PATH} /></clipPath>
		<g id="{u}roue">
			<circle r="47" fill="url(#{u}pneu)" />
			<circle r="34.5" fill="#1d2023" />
			<circle r="33" fill="url(#{u}jante)" />
			<g fill="#15171a">
				{#each SPOKE_ANGLES as a (a)}
					<path transform="rotate({a})" d="M -3.6 -10 L -7.6 -29.5 Q 0 -32.5 7.6 -29.5 L 3.6 -10 Z" />
				{/each}
			</g>
			<circle r="27" fill="none" stroke="#e6e9ec" stroke-opacity="0.28" />
			<circle r="10.5" fill="#24272b" />
			<circle r="7.5" fill="url(#{u}jante)" />
			<circle r="2.4" fill="#16181b" />
		</g>
		<g id="{u}voiture">
			<!-- Wheel arches (visible around the tyres) -->
			<path d="M 131.8 238 A 58 58 0 1 1 238.2 238 Z M 493.8 238 A 58 58 0 1 1 600.2 238 Z" fill="#0b0c0e" />
			<path d={BODY_PATH} fill="url(#{u}peinture)" />
			<g clip-path="url(#{u}caisse)">
				<path d="M 96 152 C 220 138 400 128 650 120 L 650 131 C 400 140 220 148 96 166 Z" fill="url(#{u}brillance)" opacity="0.6" />
				<path d="M 90 158 C 150 146 220 138 298 128 L 300 134 C 220 144 150 152 94 166 Z" fill="#fff" opacity="0.22" />
				<!-- S-shaped door reflection (Kodo style) -->
				<path d="M 238 203 C 318 210 398 198 468 178 C 520 163 570 152 628 148 L 628 157 C 572 160 522 170 472 186 C 402 207 320 219 238 213 Z" fill="#fff" opacity="0.15" />
				<path d="M 238 213 C 320 219 402 207 472 186 C 522 170 572 160 628 157 L 640 222 L 238 228 Z" fill="#000" opacity="0.2" />
				<path d="M 410 60 C 450 54 500 53 540 57 L 540 62 C 500 59 450 60 412 66 Z" fill="#fff" opacity="0.35" />
			</g>
			<!-- Windscreen, windows, pillars -->
			<path d="M 300 126 C 318 118 342 100 368 84 C 380 76 392 68 408 62 L 414 66 C 398 72 386 80 374 88 C 350 104 328 118 314 126 Z" fill="url(#{u}vitre)" />
			<path d="M 330 120 C 348 104 370 88 396 76 C 412 70 428 66 444 64 C 486 60 526 62 556 66 C 580 70 600 80 614 94 C 620 100 624 106 626 110 Z" fill="#0a0c0f" />
			<path d="M 336 118 C 352 104 372 90 398 79 C 414 73 430 69 446 67 C 452 66 462 66 468 66 L 468 117 Z" fill="url(#{u}vitre)" />
			<path d="M 476 66 C 500 65 528 66 552 70 C 560 72 568 75 574 78 L 574 114 L 476 116 Z" fill="url(#{u}vitre)" />
			<path d="M 586 84 C 598 91 610 100 619 109 L 586 111 Z" fill="url(#{u}vitre)" />
			<path d="M 348 112 C 372 92 410 76 452 70 L 428 114 Z" fill="url(#{u}reflet)" />
			<path d="M 490 70 C 512 69 534 70 556 74 L 528 112 L 486 113 Z" fill="url(#{u}reflet)" opacity="0.6" />
			<path d="M 334 120 L 626 110" stroke="#d9dde1" stroke-opacity="0.45" stroke-width="1.4" />
			<!-- Mirror, doors, handles -->
			<path d="M 318 123 C 320 113 332 109 345 113 L 343 125 C 333 128 322 128 318 123 Z" fill="url(#{u}peinture)" stroke="#000" stroke-opacity="0.35" />
			<path d="M 472 121 L 474 222 M 312 130 C 302 160 300 196 306 222 M 590 118 C 600 150 600 184 596 222" fill="none" stroke="#000" stroke-opacity="0.28" stroke-width="1.2" />
			<rect x="404" y="142" width="24" height="4.5" rx="2.2" fill="#000" opacity="0.4" />
			<rect x="528" y="138" width="24" height="4.5" rx="2.2" fill="#000" opacity="0.4" />
			<!-- Black cladding: sills, bumpers, wheel arches -->
			<path d="M 62 236 C 64 238 68 238 74 238 L 134 238 L 131 227 L 66 225 Z" fill="url(#{u}noir)" />
			<path d="M 236 238 L 496 238 L 498 220 C 420 224 320 225 238 223 Z" fill="url(#{u}noir)" />
			<path d="M 598 238 L 642 238 C 650 236 654 230 656 222 L 600 225 Z" fill="url(#{u}noir)" />
			<path d="M 127 238 A 62 62 0 1 1 243 238" fill="none" stroke="url(#{u}noir)" stroke-width="14" />
			<path d="M 489 238 A 62 62 0 1 1 605 238" fill="none" stroke="url(#{u}noir)" stroke-width="14" />
			<!-- Grille, headlight, tail light -->
			<path d="M 60 186 C 60 202 61 218 63 231 L 80 229 C 77 214 77 199 79 184 Z" fill="#0c0d0f" />
			<path d="M 63 200 L 78 199 M 63 212 L 78 211" stroke="#2a2c30" stroke-width="2" />
			<path d="M 61 184 C 78 176 106 167 142 160" fill="none" stroke="#dfe3e7" stroke-width="1.8" stroke-opacity="0.85" />
			<path d="M 68 170 C 82 162 106 154 142 148 L 139 157 C 110 162 88 169 72 177 Z" fill="url(#{u}phare)" />
			<path d="M 68 170 C 82 162 106 154 142 148" fill="none" stroke="#eaf5ff" stroke-width="2.4" filter="url(#{u}lueur)" />
			<path d="M 628 108 C 642 112 652 122 657 136 L 650 138 C 644 126 636 118 624 114 Z" fill="url(#{u}feu)" />
			<path d="M 628 108 C 642 112 652 122 657 136" fill="none" stroke="#ff5a5a" stroke-width="2.4" filter="url(#{u}lueur)" opacity="0.85" />
			<use href="#{u}roue" x="185" y="215" />
			<use href="#{u}roue" x="547" y="215" />
		</g>
	</defs>
	<ellipse cx="360" cy="165" rx="340" ry="140" fill="url(#{u}halo)" />
	<ellipse cx="362" cy="262" rx="305" ry="14" fill="#000" opacity="0.5" filter="url(#{u}flou)" />
	<!-- Glossy floor: inverted reflection fading out -->
	<g mask="url(#{u}masque)"><use href="#{u}voiture" transform="translate(0 524) scale(1 -1)" /></g>
	<use href="#{u}voiture" />
</svg>
