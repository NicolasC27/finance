import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLoan, bankStudy, capacityTable, loanPayment, marketRate, maxLoanAmount, noHealthQuestionnaire, notaryFees, remainingIncomeThreshold, resolveLoan, suggestInsuranceRate, taeg, usuryCheck, verdictOf, weightedIncome, type StudyInput } from '../src/lib/loanStudy';
import { readScenarios, simulate, type Change } from '../src/lib/whatIf';

const TODAY = '2026-10-15';
const loan = (c: Partial<Change>): Change => ({ id: 'l', type: 'loan', label: 'Prêt', amount: 0, rate: 0, months: 1, ...c });

test('taeg: actuarial rate, fees and insurance raise it', () => {
	const p = loanPayment(100000, 3, 240);
	assert.equal(taeg(100000, Array(240).fill(p)), 3.04);
	assert.ok(taeg(98000, Array(240).fill(p)) > 3.2, 'frais déduits du montant reçu');
	assert.equal(taeg(1000, Array(10).fill(100)), 0);
});

test('analyzeLoan: insurance on initial vs remaining capital', () => {
	const initial = analyzeLoan(resolveLoan(loan({ kind: 'mortgage', amount: 200000, rate: 3.4, months: 240, insurance: { mode: 'initial', rate: 0.3 }, application: 0, guarantee: 0 }), 35), TODAY);
	assert.equal(initial.insuranceFirst, 50);
	assert.equal(initial.totalInsurance, 12000);
	assert.equal(initial.totalMonthly, Math.round((loanPayment(200000, 3.4, 240) + 50) * 100) / 100);
	const crd = analyzeLoan(resolveLoan(loan({ kind: 'mortgage', amount: 200000, rate: 3.4, months: 240, insurance: { mode: 'crd', rate: 0.3 }, application: 0, guarantee: 0 }), 35), TODAY);
	assert.equal(crd.insuranceFirst, 50);
	assert.ok(crd.totalInsurance < 7000 && crd.totalInsurance > 5000, `assurance sur le capital restant : ${crd.totalInsurance}`);
	assert.ok(crd.insuranceAvg < crd.insuranceFirst);
	assert.equal(crd.remaining.at(-1), 0);
	const without = analyzeLoan(crd.loan, TODAY, false);
	assert.equal(without.totalInsurance, 0);
	assert.ok(crd.taeg > without.taeg, 'assurance obligatoire comprise dans le TAEG immobilier');
});

test('analyzeLoan: optional insurance of a car loan stays out of the TAEG', () => {
	const a = analyzeLoan(resolveLoan(loan({ kind: 'car', amount: 20000, rate: 4.9, months: 60, insurance: { mode: 'initial', rate: 0.4 } }), 35), TODAY);
	assert.equal(a.insuranceFirst, 6.67);
	assert.equal(a.taeg, 5.01);
	assert.equal(a.totalCost, Math.round((a.totalInterest + a.totalInsurance) * 100) / 100);
});

test('resolveLoan: mortgage project, notary and usual fees', () => {
	assert.equal(notaryFees(250000, false), 18750);
	assert.equal(notaryFees(250000, true), 6250);
	const r = resolveLoan(loan({ kind: 'mortgage', price: 250000, downPayment: 25000, rate: 3.4, months: 240 }), 35);
	assert.equal(r.notary, 18750);
	assert.equal(r.fees.application, 1500);
	assert.equal(r.fees.guarantee, 2925);
	assert.equal(r.principal, 250000 + 18750 + 1500 + 2925 - 25000);
	const old = resolveLoan(loan({ amount: 5000, rate: 6, months: 24 }), 35);
	assert.equal(old.kind, 'personal');
	assert.equal(old.fees.total, 0);
	assert.equal(old.insurance.mode, 'none');
});

test('usuryCheck: categories, ceiling and stale table', () => {
	assert.equal(usuryCheck('car', 20000, 60, 4.9, TODAY).ceiling, 8.56);
	assert.equal(usuryCheck('personal', 2500, 12, 10, TODAY).ceiling, 23.6);
	assert.equal(usuryCheck('personal', 5000, 24, 10, TODAY).ceiling, 15.76);
	assert.equal(usuryCheck('mortgage', 200000, 119, 3, TODAY).ceiling, 4.09);
	assert.equal(usuryCheck('mortgage', 200000, 239, 3, TODAY).ceiling, 4.68);
	assert.equal(usuryCheck('mortgage', 200000, 240, 3, TODAY).ceiling, 5.4);
	assert.equal(usuryCheck('mortgage', 200000, 300, 5.6, TODAY).ok, false);
	assert.equal(usuryCheck('car', 20000, 60, 4.9, '2026-12-01').stale, false);
	assert.equal(usuryCheck('car', 20000, 60, 4.9, '2027-03-01').stale, true);
});

test('market rates, insurance rates by age, Lemoine', () => {
	assert.equal(marketRate('mortgage', 240).central, 3.42);
	assert.equal(marketRate('mortgage', 210).central, 3.33);
	assert.equal(marketRate('mortgage', 120).central, 3.23);
	assert.equal(marketRate('car', 48).low, 3.5);
	assert.equal(suggestInsuranceRate('mortgage', 'crd', 35), 0.15);
	assert.equal(suggestInsuranceRate('mortgage', 'initial', 30), 0.32);
	assert.equal(suggestInsuranceRate('mortgage', 'none', 30), 0);
	assert.equal(suggestInsuranceRate('car', 'initial', 30), 0.25);
	assert.equal(noHealthQuestionnaire(150000, 35, 240), true);
	assert.equal(noHealthQuestionnaire(250000, 35, 240), false);
	assert.equal(noHealthQuestionnaire(150000, 45, 240), false);
});

test('weighted income, remaining income threshold, max amount', () => {
	assert.equal(weightedIncome({ salary: 3000, variable: 500, rental: 600, alimony: 0 }), 3770);
	assert.equal(remainingIncomeThreshold(1, 0), 800);
	assert.equal(remainingIncomeThreshold(2, 0), 1300);
	assert.equal(remainingIncomeThreshold(2, 2), 2000);
	const max = maxLoanAmount(1000, 3.4, 240);
	assert.ok(loanPayment(max, 3.4, 240) <= 1000 && loanPayment(max + 100, 3.4, 240) > 1000, `capacité ${max}`);
	assert.ok(maxLoanAmount(1000, 3.4, 240, 0.3) < max, 'l’assurance réduit la capacité');
	assert.equal(maxLoanAmount(0, 3, 240), 0);
});

const HOUSEHOLD: StudyInput = { incomes: { salary: 3000, variable: 0, rental: 0, alimony: 0 }, adults: 1, children: 0, existingPayments: 0, rent: 0, job: 'cdi', seniorityMonths: 24, age: 35, savings: 20000, monthlySpending: 2000, oneOff: 0 };
const zeroRate = (monthly: number) => analyzeLoan(resolveLoan(loan({ amount: monthly * 48, months: 48 }), 35), TODAY);

test('bankStudy: debt ratio thresholds and verdict', () => {
	const ok = bankStudy(HOUSEHOLD, [zeroRate(1000)]);
	assert.equal(ok.debtAfter, 33.3);
	assert.equal(ok.criteria.find((c) => c.id === 'debt')!.status, 'pass');
	assert.equal(ok.verdict, 'high');
	assert.equal(ok.maxMonthly, 1050);
	const tight = bankStudy(HOUSEHOLD, [zeroRate(1150)]);
	assert.equal(tight.criteria.find((c) => c.id === 'debt')!.status, 'warn');
	assert.equal(tight.verdict, 'medium');
	const no = bankStudy(HOUSEHOLD, [zeroRate(1300)]);
	assert.equal(no.criteria.find((c) => c.id === 'debt')!.status, 'fail');
	assert.equal(no.verdict, 'very-low', 'plus de 40 % : bloquant');
	const recent = bankStudy({ ...HOUSEHOLD, job: 'portage', seniorityMonths: 2, today: '2026-10-06' }, [zeroRate(500)]);
	const job = recent.criteria.find((c) => c.id === 'job')!;
	assert.equal(job.status, 'warn', 'portage récent : à surveiller, pas bloquant');
	assert.match(job.reason, /décembre 2026, la plupart en août 2027/);
	assert.equal(recent.verdict, 'medium');
	assert.equal(bankStudy({ ...HOUSEHOLD, job: 'cdd', seniorityMonths: 6 }, [zeroRate(500)]).verdict, 'very-low', 'CDD récent : bloquant');
	assert.equal(bankStudy({ ...HOUSEHOLD, job: 'portage', seniorityMonths: 6 }, []).criteria.find((c) => c.id === 'job')!.status, 'warn');
	assert.equal(bankStudy({ ...HOUSEHOLD, job: 'portage', seniorityMonths: 12 }, []).criteria.find((c) => c.id === 'job')!.status, 'pass');
});

test('bankStudy: rent kept or replaced, remaining income, down payment, emergency fund', () => {
	const withRent = bankStudy({ ...HOUSEHOLD, rent: 600 }, [zeroRate(500)]);
	assert.equal(withRent.rentKept, 600);
	assert.equal(withRent.debtAfter, 16.7, 'HCSF : crédits seuls');
	assert.equal(withRent.effortWithRent, 36.7);
	assert.equal(withRent.criteria.find((c) => c.id === 'rent')!.weight, 'minor');
	assert.equal(withRent.verdict, 'high');
	assert.equal(withRent.maxMonthly, 1050, 'la capacité HCSF ignore le loyer');
	const home = analyzeLoan(resolveLoan(loan({ kind: 'mortgage', price: 200000, downPayment: 5000, rate: 3.4, months: 240, replacesRent: true, mainResidence: true }), 35), TODAY);
	const s = bankStudy({ ...HOUSEHOLD, incomes: { salary: 6000, variable: 0, rental: 0, alimony: 0 }, rent: 600 }, [home]);
	assert.equal(s.rentKept, 0);
	assert.equal(s.criteria.find((c) => c.id === 'downPayment')!.status, 'warn', 'prêt à 110 % possible : jamais bloquant');
	assert.equal(s.criteria.find((c) => c.id === 'emergency')!.status, 'pass');
	const big = bankStudy({ ...HOUSEHOLD, incomes: { salary: 6000, variable: 0, rental: 0, alimony: 0 }, savings: 30000 }, [analyzeLoan(resolveLoan(loan({ kind: 'mortgage', price: 200000, downPayment: 28000, rate: 3.4, months: 240 }), 35), TODAY)]);
	assert.equal(big.criteria.find((c) => c.id === 'downPayment')!.status, 'pass');
	assert.equal(big.criteria.find((c) => c.id === 'emergency')!.status, 'warn');
	const poor = bankStudy({ ...HOUSEHOLD, incomes: { salary: 1500, variable: 0, rental: 0, alimony: 0 } }, [zeroRate(500)]);
	assert.equal(poor.criteria.find((c) => c.id === 'remaining')!.status, 'pass');
	assert.equal(bankStudy({ ...HOUSEHOLD, incomes: { salary: 1200, variable: 0, rental: 0, alimony: 0 } }, [zeroRate(420)]).criteria.find((c) => c.id === 'remaining')!.status, 'warn');
	assert.equal(bankStudy({ ...HOUSEHOLD, incomes: { salary: 1200, variable: 0, rental: 0, alimony: 0 } }, [zeroRate(600)]).criteria.find((c) => c.id === 'remaining')!.status, 'fail');
});

test('bankStudy: down payment above the savings, employee savings released for a main residence', () => {
	const flat = (mainResidence: boolean) => analyzeLoan(resolveLoan(loan({ kind: 'mortgage', price: 200000, downPayment: 30000, rate: 3.4, months: 240, replacesRent: true, mainResidence }), 35), TODAY);
	const rich = { ...HOUSEHOLD, incomes: { salary: 6000, variable: 0, rental: 0, alimony: 0 }, savings: 20000, employeeSavings: 25000 };
	const rental = bankStudy(rich, [flat(false)]);
	assert.equal(rental.criteria.find((c) => c.id === 'downPayment')!.status, 'warn');
	assert.match(rental.criteria.find((c) => c.id === 'downPayment')!.reason, /à revoir/);
	const home = bankStudy(rich, [flat(true)]);
	assert.equal(home.criteria.find((c) => c.id === 'downPayment')!.status, 'pass');
	assert.equal(home.criteria.find((c) => c.id === 'emergency')!.status, 'pass', '45 000 − 30 000 = 7,5 mois');
});

test('verdictOf: blocking, major and minor weights', () => {
	const c = (status: 'pass' | 'warn' | 'fail', weight: 'blocking' | 'major' | 'minor' | 'info') => ({ status, weight });
	assert.equal(verdictOf([c('pass', 'blocking'), c('pass', 'major')]), 'high');
	assert.equal(verdictOf([c('warn', 'info'), c('warn', 'minor')]), 'high');
	assert.equal(verdictOf([c('warn', 'minor'), c('warn', 'minor')]), 'medium');
	assert.equal(verdictOf([c('warn', 'major')]), 'medium');
	assert.equal(verdictOf([c('warn', 'blocking')]), 'medium', 'dérogation HCSF possible');
	assert.equal(verdictOf([c('fail', 'major')]), 'low');
	assert.equal(verdictOf([c('warn', 'major'), c('warn', 'blocking')]), 'low');
	assert.equal(verdictOf([c('fail', 'major'), c('warn', 'major')]), 'very-low');
	assert.equal(verdictOf([c('fail', 'blocking')]), 'very-low');
});

test('capacityTable: longer = lower instalment, higher cost', () => {
	const r = resolveLoan(loan({ kind: 'mortgage', amount: 200000, rate: 3.4, months: 240, application: 0, guarantee: 0 }), 35);
	const rows = capacityTable(r, [180, 240, 300], TODAY, { income: 5000, existingPayments: 0, maxMonthly: 1750 });
	assert.equal(rows.length, 3);
	assert.ok(rows[0]!.monthly > rows[2]!.monthly && rows[0]!.totalCost < rows[2]!.totalCost);
	assert.ok(rows[0]!.maxAmount < rows[2]!.maxAmount);
});

test('simulate: a mortgage keeps the home in net worth, saves the rent', () => {
	const base = { income: 4000, expenses: 2500, loanPrincipal: 0, netWorth: 40000, realRate: 0 };
	const s = simulate(base, [loan({ kind: 'mortgage', price: 200000, downPayment: 30000, rate: 3.4, months: 240, replacesRent: true })], 240, { rent: 700, today: TODAY });
	const r = s.loans[0]!.loan;
	assert.equal(s.path[0], 40000 - r.notary - r.fees.total);
	assert.equal(s.rentSaved, 700);
	assert.equal(s.savings, Math.round((4000 - 2500 + 700 - s.loans[0]!.totalMonthly) * 100) / 100);
	assert.ok(s.path[240]! > 200000, 'logement payé à la fin');
});

test('readScenarios: loan study fields kept, old rows untouched', () => {
	const [s] = readScenarios([{ id: 's', name: 'Achat', study: { age: 40, adults: 2, job: 'portage', salary: 'x' }, changes: [
		{ id: 'a', type: 'loan', label: 'Immo', amount: 0, rate: 3.4, months: 240, kind: 'mortgage', price: 250000, downPayment: 25000, insurance: { mode: 'crd', rate: null }, application: null, replacesRent: true },
		{ id: 'b', type: 'loan', label: 'Ancien', amount: 9000, rate: 5, months: 36 }
	] }]);
	assert.deepEqual(s!.changes[0], { id: 'a', type: 'loan', label: 'Immo', amount: 0, rate: 3.4, months: 240, kind: 'mortgage', insurance: { mode: 'crd', rate: null }, application: null, price: 250000, downPayment: 25000, replacesRent: true });
	assert.deepEqual(s!.changes[1], { id: 'b', type: 'loan', label: 'Ancien', amount: 9000, rate: 5, months: 36 });
	assert.equal(s!.study!.age, 40);
	assert.equal(s!.study!.adults, 2);
	assert.equal(s!.study!.job, 'portage');
	assert.equal(s!.study!.salary, null);
});
