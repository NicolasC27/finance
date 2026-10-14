/**
 * Demo data (entirely fictitious): 18 months of transactions of « Alex Martin »,
 * a developer who moved to umbrella employment (portage salarial), with a car,
 * a savings account, holidays, assets and an AI analysis conversation.
 *
 *   npm run demo           → writes the demo database in ./demo/donnees (key
 *                            « demo » in the keyring) then starts the app on
 *                            http://localhost:5180 with this data
 *   npm run demo -- --ecrire-seulement   → writes the database without starting the app
 *
 * Fixed-seed pseudo-random draws: same data on every generation.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Transaction } from '../src/lib/types.ts';
import type { PortageData } from '../src/lib/portage.ts';
import type { Asset } from '../src/lib/assets.ts';
import { categorize } from '../src/lib/categories.ts';
import { subcategorize } from '../src/lib/subcategories.ts';
import { monthlyCost, kmPerYear, kmPoints, nextMilestones } from '../src/lib/vehicle.ts';
import { defaultChecklist } from '../src/lib/trips.ts';
import { templateItems } from '../src/lib/packing.ts';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_DIR = join(APP, 'demo', 'donnees');
export const DEMO_PORT = 5180;

/** Fixed-seed generator (mulberry32). */
function seededRandom(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pad = (n: number) => String(n).padStart(2, '0');
const r2 = (n: number) => Math.round(n * 100) / 100;

const CURRENT_ACCOUNT = 'cm-00000012345';
const SAVINGS_ACCOUNT = 'cm-00000067890';
const LOAN_ACCOUNT = 'cm-00000012301';

/**
 * All the demo's `budget:*` keys (JSON values as text), as of `today`
 * (YYYY-MM-DD). Generated content:
 * - car loan: 60 payments of 189.40 € at 4.9 %; the loan account shows the
 *   principal part (last 2 statements);
 * - income: permanent job until May 2026, umbrella employment afterwards
 *   (transfers on the 30th; 4 months of InfoPortage salaries);
 * - fixed costs, price rises (home insurance in January, streaming in April,
 *   faster than inflation), car costs (loan, insurance, fuel, tolls, parking);
 * - groceries, bakery, restaurants, deliveries; leisure, health, transport;
 * - savings: savings account and crypto (transfers to oneself, neither expense
 *   nor income); one-offs: servicing, roadworthiness test, tax adjustment,
 *   holidays, interest; business purchases advanced in August (refunded with the
 *   September salary); three ATM withdrawals (August to October) for the cash
 *   wallet of the quick entry;
 * - balances: current and savings accounts recomputed from an opening balance.
 */
export function generateDemo(today = '2026-10-03'): Record<string, string> {
	const rand = seededRandom(20261003);
	const between = (min: number, max: number) => r2(min + rand() * (max - min));
	const pick = <T>(l: readonly T[]) => l[Math.floor(rand() * l.length)]!;
	const txs: Transaction[] = [];
	const add = (date: string, amount: number, label: string, cat?: [string, string], account = CURRENT_ACCOUNT) => {
		if (date > today) return;
		txs.push({
			transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
			booking_date: date,
			value_date: date,
			remittance_information: [label],
			credit_debit_indicator: amount < 0 ? 'DBIT' : 'CRDT',
			account,
			source: 'cm-xlsx',
			...(cat ? { bank_category: cat[0], bank_subcategory: cat[1] } : {})
		});
	};
	const cardLabel = (month: number, day: number, city: string, merchant: string) => `PAIEMENT CB ${pad(day)}${pad(month)} ${city} ${merchant} CARTE 1234`;

	const loanRate = 4.9 / 1200;
	let loanBalance = r2((189.4 * (1 - Math.pow(1 + loanRate, -60))) / loanRate);
	const start = { an: 2025, mois: 4 };
	for (let i = 0; i < 19; i++) {
		const year = start.an + Math.floor((start.mois - 1 + i) / 12);
		const month = ((start.mois - 1 + i) % 12) + 1;
		const d = (day: number) => `${year}-${pad(month)}-${pad(Math.min(day, 28))}`;
		const inPortage = `${year}-${pad(month)}` >= '2026-06';

		if (!inPortage) add(d(28), between(2840, 2870), 'VIR SALAIRE ACME SAS', ['Revenus', 'Salaires']);
		add(d(5), -780, 'PRLV SEPA FONCIA LOYER APPARTEMENT', ['Logement / maison', 'Loyer / charges']);
		add(d(9), -(month >= 11 || month <= 3 ? 92 : 58), 'PRLV SEPA EDF CLIENTS PARTICULIERS', ['Energie', 'Electricité']);
		if (month % 3 === 1) add(d(15), -34.6, 'PRLV SEPA VEOLIA EAU', ['Energie', 'Eau']);
		add(d(7), -15.99, 'PRLV SEPA FREE MOBILE', ['Numérique', 'Téléphone']);
		add(d(12), -39.99, 'PRLV SEPA ORANGE INTERNET', ['Numérique', 'Internet']);
		add(d(14), -(year * 100 + month >= 202604 ? 14.99 : 13.49), 'PRLV SEPA NETFLIX.COM', ['Numérique', 'Streaming']);
		add(d(16), -11.12, 'PRLV SEPA SPOTIFY', ['Numérique', 'Streaming']);
		add(d(3), -21.6, cardLabel(month, 2, 'SAN FRANCISCO', 'ANTHROPIC CLAUDE'), ['Numérique', 'Logiciel']);
		add(d(10), -(year * 100 + month >= 202601 ? 20.9 : 18.4), 'PRLV SEPA MAIF HABITATION', ['Logement / maison', 'Assurance']);
		add(d(11), -42.3, 'PRLV SEPA MGEN MUTUELLE', ['Santé', 'Mutuelle']);
		add(d(2), -7.5, 'F COTIS EUROCOMPTE', ['Banque', 'Frais bancaires']);
		add(d(6), -189.4, 'ECH PRET AUTO 00000 000123 01', ['Véhicule', 'Achat / crédit / leasing']);
		if (d(6) <= today) {
			const principal = r2(189.4 - loanBalance * loanRate);
			loanBalance = r2(loanBalance - principal);
			if (`${year}-${pad(month)}` >= '2026-08') add(d(6), principal, 'MENSUALITE PRELEVEE', undefined, LOAN_ACCOUNT);
		}
		add(d(8), -52.3, 'PRLV SEPA MATMUT AUTOMOBILE', ['Véhicule', 'Assurance']);
		for (const j of [6, 19]) add(d(j + 1), -between(42, 74), cardLabel(month, j, 'LYON', pick(['TOTAL ACCESS', 'ESSO EXPRESS', 'STATION AVIA'])), ['Véhicule', 'Carburant']);
		if (rand() < 0.6) add(d(20), -between(8, 46), 'PRLV SEPA APRR AUTOROUTES', ['Véhicule', 'Parking / péage']);
		if (rand() < 0.5) add(d(23), -between(3, 14), cardLabel(month, 22, 'LYON', 'INDIGO PARKING'), ['Véhicule', 'Parking / péage']);
		for (let k = 0; k < 6; k++) {
			const j = 2 + Math.floor(rand() * 26);
			add(d(j + 1), -between(14, 72), cardLabel(month, j, 'LYON', pick(['CARREFOUR', 'MONOPRIX', 'LIDL', 'BIOCOOP'])), ['Alimentation', 'Grande surface']);
		}
		for (let k = 0; k < 3; k++) {
			const j = 2 + Math.floor(rand() * 26);
			add(d(j + 1), -between(3.2, 9.8), cardLabel(month, j, 'LYON', 'BOULANGERIE DU PARC'), ['Alimentation', 'Petit commerçant']);
		}
		for (let k = 0; k < 3; k++) {
			const j = 2 + Math.floor(rand() * 26);
			add(d(j + 1), -between(14, 48), cardLabel(month, j, 'LYON', pick(['BISTROT DU COIN', 'PIZZERIA NAPOLI', 'SUSHI SHOP', 'LE COMPTOIR'])), ['Restaurants & bars', 'Restaurant']);
		}
		if (rand() < 0.7) add(d(18), -between(19, 34), cardLabel(month, 17, 'PARIS', 'UBER EATS'), ['Restaurants & bars', 'Restaurant']);
		if (rand() < 0.8) add(d(13), -between(12, 89), cardLabel(month, 12, 'LYON', pick(['FNAC', 'DECATHLON', 'CULTURA', 'UGC CINE CITE'])), ['Loisirs', 'Shopping']);
		if (rand() < 0.5) add(d(24), -between(25, 140), cardLabel(month, 23, 'LUXEMBOURG', 'AMAZON EU'), ['Loisirs', 'Shopping']);
		if (rand() < 0.6) add(d(21), -between(8, 36), cardLabel(month, 20, 'LYON', 'PHARMACIE DU CENTRE'), ['Santé', 'Pharmacie']);
		if (month % 4 === 2) {
			add(d(17), -26.5, cardLabel(month, 16, 'LYON', 'DR LAMBERT MEDECIN'), ['Santé', 'Médecin']);
			add(d(24), 18.55, 'VIR CPAM DU RHONE REMBOURSEMENT', ['Santé', 'Remboursement']);
			add(d(27), 5.95, 'VIR MGEN PRESTATIONS SANTE', ['Santé', 'Remboursement']);
		}
		if (rand() < 0.35) add(d(26), -between(39, 118), cardLabel(month, 25, 'PARIS 12', 'SNCF CONNECT'), ['Véhicule', 'Véhicule, divers']);
		add(d(29), -300, 'VIREMENT INTERNE VERS LIVRET BLEU', ['Epargne', 'Virements internes']);
		add(d(29), 300, 'VIREMENT INTERNE DEPUIS C/C', ['Epargne', 'Virements internes'], SAVINGS_ACCOUNT);
		add(d(27), -100, 'VIR INST KRAKEN', ['Epargne', 'Placement']);
	}
	add('2025-06-12', -289.9, cardLabel(6, 11, 'LYON', 'NORAUTO'), ['Véhicule', 'Entretien']);
	add('2026-03-18', -79, cardLabel(3, 17, 'LYON', 'DEKRA CONTROLE TECHNIQUE'), ['Véhicule', 'Entretien']);
	add('2025-09-15', -318, 'PRLV SEPA DGFIP IMPOT 2024 REGULARISATION', ['Impôts et taxes', 'Impôts']);
	add('2025-12-31', 212.4, 'INTERETS CREDITEURS 2025', ['Revenus', 'Intérêts'], SAVINGS_ACCOUNT);
	for (const [date, amount, label] of [
		['2025-08-04', -642, cardLabel(8, 2, 'AMSTERDAM', 'BOOKING.COM HOTEL')],
		['2025-08-06', -48.5, cardLabel(8, 5, 'BIARRITZ', 'LE COMPTOIR BASQUE')],
		['2025-08-09', -36.2, cardLabel(8, 8, 'BIARRITZ', 'SURF SCHOOL')],
		['2025-08-12', -61.4, cardLabel(8, 11, 'BAYONNE', 'TOTAL ACCESS')],
		['2026-02-16', -385, cardLabel(2, 14, 'TIGNES', 'ESF COURS DE SKI')],
		['2026-02-18', -212, cardLabel(2, 16, 'TIGNES', 'SKIPASS TIGNES')],
		['2025-05-02', -62, cardLabel(5, 1, 'ROMA', 'TRATTORIA DA ENZO')],
		['2025-05-05', -68, cardLabel(5, 3, 'ROMA', 'MUSEI VATICANI')],
		['2025-05-06', -31.5, cardLabel(5, 4, 'ROMA', 'PIZZERIA TRASTEVERE')],
		['2026-10-02', -320, cardLabel(10, 1, 'LISBOA', 'TAP AIR PORTUGAL')],
		['2026-10-03', -560.5, cardLabel(10, 2, 'LISBOA', 'AIRBNB STUDIO BAIXA')]
	] as const)
		add(date, amount, label);

	const portageMonths = [
		{ mois: '2026-06', jours: 20, brut: 5120, net: 3398.4, pasTaux: 7.5, pasBase: 4012.6, tr: 19, remb: 0 },
		{ mois: '2026-07', jours: 22, brut: 5640, net: 3931.2, pasTaux: 7.5, pasBase: 4430.2, tr: 21, remb: 0 },
		{ mois: '2026-08', jours: 17, brut: 4360, net: 3204.7, pasTaux: 7.5, pasBase: 3428.9, tr: 16, remb: 0 },
		{ mois: '2026-09', jours: 21, brut: 5390, net: 3878.35, pasTaux: 7.5, pasBase: 4235.4, tr: 20, remb: 62.4 }
	];
	for (const m of portageMonths) add(`${m.mois}-28`, m.net, 'VIR INFOPORTAGE SALAIRE', ['Revenus', 'Salaires']);
	add('2026-08-05', -21.6, cardLabel(8, 4, 'SAN FRANCISCO', 'GITHUB COPILOT'), ['Numérique', 'Logiciel']);
	add('2026-08-19', -40.8, cardLabel(8, 18, 'PARIS', 'JETBRAINS'), ['Numérique', 'Logiciel']);
	add('2026-09-05', -21.6, cardLabel(9, 4, 'SAN FRANCISCO', 'GITHUB COPILOT'), ['Numérique', 'Logiciel']);
	add('2026-09-19', -40.8, cardLabel(9, 18, 'PARIS', 'JETBRAINS'), ['Numérique', 'Logiciel']);
	add('2026-09-23', -36, cardLabel(9, 22, 'PARIS', 'AMAZON EU SARL'));
	add('2026-09-27', -89.23, cardLabel(9, 26, 'SINGAPORE', 'AI TOOLS PTE'), ['Numérique', 'Logiciel']);
	for (const [date, amount, day, month] of [
		['2026-08-18', -50, 16, 8],
		['2026-09-21', -60, 19, 9],
		['2026-10-02', -40, 30, 9]
	] as const)
		add(date, amount, `RETRAIT DAB ${pad(day)}${pad(month)} LYON CARTE 1234`, ['Retrait', 'Retrait DAB']);
	const portage: PortageData = {
		compte: {
			periode: '2026-09',
			tjm: 520,
			client: 'ACME CONSEIL',
			clientFinal: 'BANQUE EXEMPLE',
			fraisGestionPct: 6,
			delaiPaiement: '45 jours fin de mois',
			attenteClient: 10920,
			dateEntree: '2026-06-01',
			mois: portageMonths.map((m) => ({
				mois: m.mois,
				jours: m.jours,
				ca: m.jours * 520,
				fraisGestion: r2(m.jours * 520 * 0.06),
				reserve: r2(m.jours * 520 * 0.04),
				brut: m.brut,
				netApresImpot: m.net,
				impot: r2((m.pasBase * m.pasTaux) / 100),
				reserveDisponible: 120
			}))
		},
		paies: portageMonths.map((m) => ({
			mois: m.mois,
			emploi: 'Développeur',
			brut: m.brut,
			titresRestaurant: { nombre: m.tr, partSalariale: r2(m.tr * 5.5), partPatronale: r2(m.tr * 5.5) },
			rembFrais: m.remb,
			netAvantImpot: r2(m.net + (m.pasBase * m.pasTaux) / 100),
			pas: { base: m.pasBase, taux: m.pasTaux, montant: r2((m.pasBase * m.pasTaux) / 100) },
			netPaye: m.net,
			datePaiement: `${m.mois}-28`
		})),
		notes: [
			{
				numero: '1001',
				mois: '2026-08',
				etat: 'Payée',
				total: 62.4,
				lignes: [
					{ id: '1001-1', n: 1, date: '2026-08-04', nature: 'Logiciel', type: 'Frais de fonctionnement', montant: 21.6, commentaire: 'Copilot' },
					{ id: '1001-2', n: 2, date: '2026-08-18', nature: 'Logiciel', type: 'Frais de fonctionnement', montant: 40.8, commentaire: 'IDE' }
				]
			},
			{
				numero: '1002',
				mois: '2026-09',
				etat: 'Créée',
				total: 204.18,
				lignes: [
					{ id: '1002-1', n: 1, date: '2026-09-04', nature: 'Logiciel', type: 'Frais de fonctionnement', montant: 21.6, commentaire: 'Copilot' },
					{ id: '1002-2', n: 2, date: '2026-09-10', nature: 'Télétravail', type: 'Indemnité', montant: 20, commentaire: 'TT septembre' },
					{ id: '1002-3', n: 3, date: '2026-09-18', nature: 'Logiciel', type: 'Frais de fonctionnement', montant: 40.8, commentaire: 'IDE' },
					{ id: '1002-4', n: 4, date: '2026-09-22', nature: 'Fournitures', type: 'Frais de fonctionnement', montant: 36, commentaire: 'Câble et hub USB-C' },
					{ id: '1002-5', n: 5, date: '2026-09-26', nature: 'Logiciel', type: 'Frais de fonctionnement', montant: 85.78, devise: { montant: 99, code: 'USD' }, commentaire: 'assistant IA' }
				]
			}
		],
		choix: {},
		cheques: {
			credits: [{ id: 'cc-1', date: '2026-09-30', montant: 300, libelle: 'septembre 2026' }],
			depenses: [{ id: 'cd-1', date: '2026-10-01', montant: 45.9, libelle: 'Livres', categoryId: 'loisirs' }]
		}
	};

	const balanceOf = (account: string, opening: number) => r2(txs.filter((t) => t.account === account).reduce((s, t) => s + (t.credit_debit_indicator === 'CRDT' ? 1 : -1) * Number(t.transaction_amount.amount), opening));
	const assets: Asset[] = [
		{
			id: 'b-demo-voiture',
			type: 'vehicule',
			name: 'Peugeot 2008',
			purchaseDate: '2025-03-14',
			purchasePrice: 17900,
			estimatedValue: 15400,
			valueDate: today,
			linkedTxKeys: [],
			note: 'Crédit auto sur 60 mois.',
			vehicle: {
				version: '1.2 PureTech 130 Allure EAT8',
				plate: 'AB-123-CD',
				boughtUsed: true,
				color: '#1f3554',
				cote: {
					date: today,
					reprise: 13600,
					particulier: 15400,
					pro: 16900,
					annonces: [
						{ libelle: '1.2 PureTech 130 Allure', annee: 2022, km: 48200, prix: 17490, source: 'exemple' },
						{ libelle: '1.2 PureTech 100 Active', annee: 2022, km: 61500, prix: 15990, source: 'exemple' },
						{ libelle: '1.2 PureTech 130 GT', annee: 2022, km: 39800, prix: 18900, source: 'exemple' },
						{ libelle: '1.5 BlueHDi 110 Allure', annee: 2022, km: 82300, prix: 14990, source: 'exemple' },
						{ libelle: '1.2 PureTech 130 Allure EAT8', annee: 2022, km: 70100, prix: 16450, source: 'exemple' }
					]
				},
				firstRegistration: '2022-05-20',
				kmAtPurchase: 38000,
				kmLog: [
					{ date: '2025-06-11', km: 41200, source: 'facture' },
					{ date: '2026-03-17', km: 53900, source: 'ct' },
					{ date: '2026-09-28', km: 62400, source: 'saisie' }
				]
			}
		},
		{ id: 'b-demo-piano', type: 'instrument', name: 'Piano numérique', purchaseDate: '2025-11-22', purchasePrice: 1890, estimatedValue: 1600, valueDate: '2026-09-01', linkedTxKeys: [] },
		{ id: 'b-demo-velo', type: 'autre', name: 'Vélo électrique', purchaseDate: '2025-04-12', purchasePrice: 2390, linkedTxKeys: [] }
	];
	const car = assets[0]!;
	const carExpenses = txs
		.filter((t) => categorize(t, {}, [], new Map()) === 'voiture')
		.map((t) => ({ date: t.booking_date, montant: (t.credit_debit_indicator === 'DBIT' ? 1 : -1) * Number(t.transaction_amount.amount), sub: subcategorize(t, {}, [], new Map()) }));
	const cost = monthlyCost(car, carExpenses, today);
	const yearlyKm = kmPerYear(kmPoints(car), today).moyenne ?? 0;
	const nextInspection = nextMilestones(car, carExpenses, today).find((e) => e.id === 'ct')?.date ?? '';
	const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')}`;
	const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
	const costRows = [...cost.lignes].sort((a, b) => b.parMois - a.parMois).map((l) => `| ${l.poste === 'amortissement' ? 'Amortissement (cote −15 %/an)' : l.label} | ${eur(l.parMois)} |`);
	const chat = {
		sessionId: '',
		messages: [
			{ id: 'm1', role: 'user', mode: 'chat', text: 'Combien me coûte vraiment ma voiture par mois ?', at: `${today}T09:12:00.000Z` },
			{
				id: 'm2',
				role: 'assistant',
				mode: 'chat',
				at: `${today}T09:12:40.000Z`,
				text: `**≈ ${eur(cost.total)} € par mois** depuis l'achat (mars 2025, ${cost.mois.toLocaleString('fr-FR')} mois), soit **${((cost.total * 12) / yearlyKm).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €/km** à ton rythme de ${eur(yearlyKm)} km/an.\n\n| Poste | € / mois |\n|---|---:|\n${costRows.join('\n')}\n\nLe carburant pèse plus que l'assurance : deux pleins par mois en moyenne. Ton prochain contrôle technique est en **${MONTH_NAMES[Number(nextInspection.slice(5, 7)) - 1]} ${nextInspection.slice(0, 4)}**.\n\nJ'ai lu le compteur sur la facture que tu as jointe : le relevé attend ta confirmation.`,
				actions: [
					{ id: 'a1', state: 'pending', action: { type: 'log_km', assetId: 'b-demo-voiture', date: '2026-10-02', km: 62550, source: 'facture', why: 'Compteur lu sur la facture déposée' } },
					{ id: 'a2', state: 'pending', action: { type: 'set_budget', categoryId: 'voiture', amount: 420, why: 'Moyenne des 12 derniers mois hors amortissement' } }
				]
			}
		]
	};
	const data: Record<string, unknown> = {
		'budget:imported-txs': txs,
		'budget:accounts': [
			{ id: CURRENT_ACCOUNT, label: 'C/C EUROCOMPTE CONFORT M ALEX MARTIN', last4: '2345', kind: 'courant', balance: balanceOf(CURRENT_ACCOUNT, 2140), balanceAt: today, currency: 'EUR' },
			{ id: SAVINGS_ACCOUNT, label: 'LIVRET BLEU M ALEX MARTIN', last4: '7890', kind: 'livret', balance: balanceOf(SAVINGS_ACCOUNT, 9800), balanceAt: today, currency: 'EUR' },
			{ id: LOAN_ACCOUNT, label: 'PRET AUTO M ALEX MARTIN', last4: '2301', kind: 'pret', balance: -loanBalance, balanceAt: today, currency: 'EUR' }
		],
		'budget:natixis-holdings': {
			holdings: [
				{ fund: 'MONETAIRE ISR (DEMO)', availableAt: '2029-06-01', shareValue: 12.84, shares: 249.22, amount: 3200, valuedAt: '2026-09-30', plan: 'PEI', perfY: 3.1 },
				{ fund: 'ACTIONS MONDE ISR (DEMO)', availableAt: 'retraite', shareValue: 31.07, shares: 173.8, amount: 5400, valuedAt: '2026-09-30', plan: 'PERCOL', perfY: 8.4 }
			],
			total: 8600,
			importedAt: Date.parse('2026-09-30T10:00:00Z'),
			availability: [
				{ label: '2029', key: 2029, amount: 3200 },
				{ label: 'Retraite', key: 9999, amount: 5400 }
			],
			valuedAt: '2026-09-30'
		},
		'budget:natixis-perfs': { perfs: { 'MONETAIRE ISR (DEMO)': 3.1, 'ACTIONS MONDE ISR (DEMO)': 8.4 }, year: 2025 },
		'budget:budgets': { alimentation: 650, logement: 820, energie: 110, transport: 40, voiture: 420, abonnements: 110, loisirs: 180, sante: 60, vacances: 150, impots: 280, autre: 40 },
		'budget:biens': assets,
		'budget:modules': { active: ['analyse', 'patrimoine', 'crypto', 'voiture', 'vacances', 'portage', 'ia', 'rapport'] },
		'budget:portage': portage,
		'budget:goals': [
			{ id: 'g-apport', name: 'Apport appartement', targetAmount: 30000, currentAmount: 14800, targetDate: '2028-06-30', createdAt: 1767225600000 },
			{ id: 'g-japon', name: 'Voyage au Japon', targetAmount: 4000, currentAmount: 2650, targetDate: '2027-04-01', createdAt: 1767225600000 }
		],
		'budget:vacations': [
			{ id: 'v-rome', label: 'Rome en mai', start: '2025-05-01', end: '2025-05-05' },
			{ id: 'v-ete', label: 'Pays basque', start: '2025-08-02', end: '2025-08-14' },
			{ id: 'v-ski', label: 'Ski à Tignes', start: '2026-02-14', end: '2026-02-21' },
			{ id: 'v-lisbonne', label: 'Lisbonne', start: '2027-04-10', end: '2027-04-16' }
		],
		'budget:atlas': [
			{ id: 'visit-1', country: 'Italie', year: 2022 },
			{ id: 'visit-2', country: 'Espagne', year: 2023 },
			{ id: 'visit-3', country: 'Maroc', year: 2021 },
			{ id: 'visit-4', country: 'Grèce', year: 2024 }
		],
		'budget:wishes': [
			{ id: 'wish-1', name: 'Islande', country: 'Islande', budget: 3400, days: 10, season: 'ete', notes: 'Route 1 en van, aurores en septembre ?', createdAt: 1790000200000 },
			{ id: 'wish-2', name: 'Vietnam', country: 'Vietnam', budget: 2800, days: 15, season: 'hiver', notes: '', createdAt: 1790000300000 },
			{ id: 'wish-3', name: 'Écosse', country: 'Royaume-Uni', budget: 1500, days: 7, season: 'printemps', notes: 'Highlands et Skye.', createdAt: 1790000400000 }
		],
		'budget:trips': [
			{
				id: 'trip-rome',
				name: 'Rome en mai',
				destination: 'Rome',
				country: 'Italie',
				start: '2025-05-01',
				end: '2025-05-05',
				travellers: 2,
				status: 'termine',
				notes: 'Colisée à l’ouverture, Trastevere le soir.',
				photo: '',
				periodId: 'v-rome',
				goalId: null,
				envelopes: { transport: 180, hebergement: 420, repas: 260, activites: 90, extras: 40 },
				checklist: [],
				quotes: [],
				days: [
					{ id: 'dr1', title: 'Centre antique', notes: '', places: [{ id: 'pr1', name: 'Colisée', url: '', cost: 36, envelope: 'activites', lat: 41.8902, lon: 12.4922 }, { id: 'pr2', name: 'Panthéon', url: '', cost: null, envelope: 'activites', lat: 41.8986, lon: 12.4769 }] },
					{ id: 'dr2', title: 'Vatican', notes: '', places: [{ id: 'pr3', name: 'Musées du Vatican', url: '', cost: 40, envelope: 'activites', lat: 41.9065, lon: 12.4536 }, { id: 'pr4', name: 'Dîner à Trastevere', url: '', cost: 55, envelope: 'repas', lat: 41.8897, lon: 12.4694 }] }
				],
				packing: [
					{ id: 'pk-r1', category: 'tech', label: 'Adaptateur de prise', qty: 1, shared: true, done: true, forgot: true },
					{ id: 'pk-r2', category: 'vetements', label: 'Chaussures confortables', qty: 2, shared: false, done: true, forgot: false },
					{ id: 'pk-r3', category: 'divers', label: 'Gourde', qty: 2, shared: false, done: true, forgot: false }
				],
				createdAt: 1745000000000
			},
			{
				id: 'trip-lisbonne',
				name: 'Lisbonne',
				destination: 'Lisbonne',
				country: 'Portugal',
				start: '2027-04-10',
				end: '2027-04-16',
				travellers: 2,
				status: 'prevu',
				notes: 'Alfama, Belém, une journée à Sintra.',
				photo: '',
				periodId: 'v-lisbonne',
				goalId: null,
				envelopes: { transport: 320, hebergement: 560, repas: 350, activites: 120, extras: 80 },
				checklist: defaultChecklist({ start: '2027-04-10', end: '2027-04-16', country: 'Portugal' }),
				quotes: [
					{ id: 'q-booking', site: 'Booking', label: 'Appartement Alfama, 2 pers.', price: 620, url: 'https://www.booking.com/', conditions: 'annulation gratuite jusqu’à J−7', date: '2026-10-01', envelope: 'hebergement', bought: false },
					{ id: 'q-airbnb', site: 'Airbnb', label: 'Studio Baixa', price: 560, url: 'https://www.airbnb.fr/', conditions: 'non remboursable', date: '2026-10-03', envelope: 'hebergement', bought: true },
					{ id: 'q-vols', site: 'Google Flights', label: 'Vols A/R Lyon–Lisbonne, 2 pers.', price: 320, url: 'https://www.google.com/travel/flights', conditions: 'bagage cabine seulement', date: '2026-10-03', envelope: 'transport', bought: true }
				],
				days: [
					{ id: 'd1', title: 'Arrivée et Alfama', notes: 'Vol du matin, métro depuis l’aéroport.', places: [{ id: 'p1', name: 'Tram 28', url: '', cost: 6.5, envelope: 'transport', lat: 38.7158, lon: -9.1356 }, { id: 'p2', name: 'Miradouro de Santa Luzia', url: '', cost: null, envelope: 'activites', lat: 38.7118, lon: -9.1301 }, { id: 'p3', name: 'Dîner à Alfama', url: '', cost: 45, envelope: 'repas', lat: null, lon: null }] },
					{ id: 'd2', title: 'Belém', notes: '', places: [{ id: 'p4', name: 'Monastère des Hiéronymites', url: 'https://www.patrimoniocultural.gov.pt/', cost: 24, envelope: 'activites', lat: 38.6979, lon: -9.2065 }, { id: 'p5', name: 'Pastéis de Belém', url: '', cost: 8, envelope: 'repas', lat: 38.6975, lon: -9.2033 }, { id: 'p6', name: 'Tour de Belém', url: '', cost: 16, envelope: 'activites', lat: 38.6916, lon: -9.216 }] },
					{ id: 'd3', title: 'Sintra', notes: 'Partir tôt : la file au palais de Pena.', places: [{ id: 'p7', name: 'Train Rossio – Sintra A/R', url: '', cost: 12, envelope: 'transport', lat: 38.7141, lon: -9.1409 }, { id: 'p8', name: 'Palais de Pena', url: '', cost: 40, envelope: 'activites', lat: 38.7876, lon: -9.3906 }, { id: 'p9', name: 'Quinta da Regaleira', url: '', cost: 30, envelope: 'activites', lat: 38.7963, lon: -9.3961 }] },
					{ id: 'd4', title: 'Baixa et Chiado', notes: '', places: [{ id: 'p10', name: 'Elevador de Santa Justa', url: '', cost: 12, envelope: 'activites', lat: 38.7122, lon: -9.1394 }, { id: 'p11', name: 'Time Out Market', url: '', cost: 40, envelope: 'repas', lat: 38.707, lon: -9.1458 }] },
					{ id: 'd5', title: 'Cascais', notes: '', places: [{ id: 'p12', name: 'Train A/R Cais do Sodré – Cascais', url: '', cost: 10, envelope: 'transport', lat: 38.7059, lon: -9.1453 }, { id: 'p13', name: 'Vélos jusqu’au Guincho', url: '', cost: 20, envelope: 'activites', lat: 38.6979, lon: -9.4215 }] },
					{ id: 'd6', title: 'LX Factory et Bairro Alto', notes: '', places: [{ id: 'p16', name: 'LX Factory', url: '', cost: null, envelope: 'activites', lat: 38.7034, lon: -9.1786 }, { id: 'p14', name: 'Soirée fado', url: '', cost: 60, envelope: 'activites', lat: 38.7133, lon: -9.1448 }] },
					{ id: 'd7', title: 'Retour', notes: 'Vol à 18 h.', places: [{ id: 'p15', name: 'Aerobus', url: '', cost: 8, envelope: 'transport', lat: 38.7756, lon: -9.1354 }] }
				],
				packing: (() => {
					let k = 0;
					return templateItems(['ville'], 2, [], () => `pk-${++k}`).map((i, n) => (n < 4 ? { ...i, done: true } : i));
				})(),
				createdAt: 1790000000000
			},
			{ id: 'trip-japon', name: 'Japon', destination: 'Tokyo et Kyoto', country: 'Japon', start: '', end: '', travellers: 2, status: 'idee', notes: 'Financé par l’objectif « Voyage au Japon ». Deux semaines, saison des érables ?', photo: '', periodId: null, goalId: 'g-japon', envelopes: { transport: 1800, hebergement: 1400, repas: 700, activites: 300 }, checklist: defaultChecklist({ start: '', end: '', country: 'Japon' }), quotes: [], days: [{ id: 'dj1', title: 'Tokyo : Asakusa et Shibuya', notes: '', places: [{ id: 'pj1', name: 'Senso-ji', url: '', cost: null, envelope: 'activites', lat: 35.7148, lon: 139.7967 }, { id: 'pj3', name: 'Carrefour de Shibuya', url: '', cost: null, envelope: 'activites', lat: 35.6595, lon: 139.7005 }] }, { id: 'dj2', title: 'Kyoto : Fushimi Inari à l’aube', notes: '', places: [{ id: 'pj2', name: 'Fushimi Inari-taisha', url: '', cost: null, envelope: 'activites', lat: 34.9671, lon: 135.7727 }] }], packing: [], createdAt: 1790000100000 }
		],
		'budget:ia-chat': chat,
		'budget:ia-reports': [{ id: 'r1', title: 'Rapport de septembre 2026', prompt: 'Rapport du mois', createdAt: `${today}T08:30:00.000Z`, html: SAMPLE_REPORT }]
	};
	return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
}

/** Sample report (AI analysis page → Reports), self-contained like the ones Claude produces. */
const SAMPLE_REPORT = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport de septembre 2026</title><style>:root{--bg:#fbfaf7;--tx:#1f1e1c;--mu:#6b6b66;--ac:#9a7b3c}@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--tx:#ecebe7;--mu:#8e8e8e;--ac:#c9a86c}}body{margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--tx)}h1{font-size:20px;margin:0 0 4px}p{color:var(--mu)}.k{display:flex;gap:24px;flex-wrap:wrap;margin:16px 0}.k b{display:block;font-size:20px;color:var(--tx)}.k span{color:var(--mu);font-size:12px}</style></head><body><h1>Rapport de septembre 2026</h1><p>Données de démonstration.</p><div class="k"><div><b>3 878 €</b><span>revenus</span></div><div><b>2 410 €</b><span>dépenses</span></div><div><b>38 %</b><span>taux d'épargne</span></div></div><p>Analyse, pas un conseil en investissement agréé.</p></body></html>`;

// ---------- Command line ----------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const { openDataStore } = await import('../server/base.ts');
	const store = await openDataStore(DEMO_DIR, { nom: 'demo' });
	const n = store.importer(generateDemo(), 'démo');
	store.fermer();
	console.log(`\n  Base de démo écrite : ${n} clés dans ${DEMO_DIR} (clé « demo » dans le trousseau).`);
	if (!process.argv.includes('--ecrire-seulement')) {
		console.log(`  Lancement de l'app de démo sur http://localhost:${DEMO_PORT}\n`);
		const vite = spawn(join(APP, 'node_modules', '.bin', 'vite'), ['--port', String(DEMO_PORT), '--strictPort'], {
			cwd: APP,
			stdio: 'inherit',
			env: { ...process.env, BUDGET_DATA_DIR: DEMO_DIR, BUDGET_DB_NOM: 'demo' }
		});
		vite.on('exit', (code) => process.exit(code ?? 0));
	}
}
