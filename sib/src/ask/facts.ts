/**
 * Ask SIB - the facts layer.
 *
 * A small set of recognised questions answered from live data, exactly and
 * server-side: how many POCs are active and which, POCs by BU, use-cases at
 * risk, decisions waiting on leadership, a device's readiness, the live
 * numbers, which categories deliver a capability, the latest landscape
 * entries. Each answer is a card: a title, lines with a link into the page
 * that owns the item, and a note when the caller cannot see the source.
 *
 * Access follows the reader, not the question: `site` is the site key (the
 * same audience that can open /portfolio); `ip` is the IP key (fit page,
 * restricted catalogue). Without them a fact never reads the data - it says
 * where the answer lives and what unlocks it.
 */
import { useCaseStore, ensureSeeded } from '../routes/portfolio.js';
import { HEALTH_LABEL, stageLabel, pocStageLabel, openDecisions, openBottlenecks, summary, currentPoc } from '../portfolio/portfolio-core.js';
import { buildTransition } from '../routes/scorecard.js';
import { quarterOf } from '../scorecard/scorecard-core.js';
import { readDeviceProfiles, readFit, readLandscape } from '../routes/devices.js';
import { anchorStore } from '../routes/anchors.js';
import { guideStore } from '../guides/store.js';
import { omsUsageStore } from '../oms/usage-log.js';
import { presenceSummary } from '../sse/presence.js';
import type { UseCase } from '@spatial/shared';

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey';
export interface FactLine { text: string; href?: string; tag?: string; tone?: Tone }
export interface Fact { id: string; title: string; lines: FactLine[]; href?: string; hrefLabel?: string; note?: string }
export interface Access { site: boolean; ip: boolean }

const tone = (h: string): Tone => (h === 'green' ? 'green' : h === 'amber' ? 'amber' : h === 'red' ? 'red' : 'grey');
const has = (q: string, re: RegExp) => re.test(q);
const LOCK_SITE = 'Opens with the site key - the same access as the page itself.';
const LOCK_IP = 'Opens with the IP key, like the Architecture.';

function useCases(): UseCase[] { ensureSeeded(); return useCaseStore.findAll(); }
const ucLine = (u: UseCase): FactLine => {
  const poc = currentPoc(u);
  return { text: `${u.bu} · ${u.name} - ${stageLabel(u.stage)}${poc ? ` · POC-${poc.number} ${poc.name} (${pocStageLabel(poc.stage)})` : ''}`, href: `/portfolio#${u.id}`, tag: HEALTH_LABEL[u.health], tone: tone(u.health) };
};

export function answerFacts(question: string, access: Access): Fact[] {
  const q = question.toLowerCase().trim();
  const facts: Fact[] = [];
  const pocQ = has(q, /\b(pocs?|proof[- ]of[- ]concepts?|use[- ]?cases?|portfolio|pilots?)\b/);
  const bus = access.site ? [...new Set(useCases().map(u => u.bu))] : [];
  const buHit = bus.find(b => has(q, new RegExp(`\\b${b.toLowerCase()}\\b`)));

  // ── POCs by BU ("what POCs are we doing with Etch") ───────────────────────
  if (buHit) {
    const list = useCases().filter(u => u.bu === buHit);
    facts.push({ id: 'bu', title: `${buHit}: ${list.length} use-case${list.length === 1 ? '' : 's'}, ${list.reduce((n, u) => n + u.pocs.length, 0)} POCs`,
      lines: list.flatMap(u => [ucLine(u), ...u.pocs.map(p => ({ text: `   POC-${p.number} ${p.name} - ${pocStageLabel(p.stage)}${p.nextMilestone ? ` · next: ${p.nextMilestone.text} (${p.nextMilestone.due})` : ''}`, href: `/portfolio#${u.id}`, tone: 'grey' as Tone }))]),
      href: '/portfolio', hrefLabel: 'The POC Portfolio' });
  } else if (pocQ && has(q, /\b(etch|mdp|ddp|bu\b|business unit)/) && !access.site) {
    facts.push({ id: 'bu', title: 'POCs by business unit', lines: [], href: '/portfolio', hrefLabel: 'The POC Portfolio', note: LOCK_SITE });
  }

  // ── POC status / how many active ──────────────────────────────────────────
  if (pocQ && has(q, /\b(status|how many|active|in progress|running|current|overview|going|list|which|where)\b/) && !buHit) {
    if (!access.site) facts.push({ id: 'pocs', title: 'POC status', lines: [], href: '/portfolio', hrefLabel: 'The POC Portfolio', note: LOCK_SITE });
    else {
      const list = useCases(); const s = summary(list);
      const active = list.flatMap(u => u.pocs.filter(p => p.stage === 'in-progress').map(p => ({ u, p })));
      facts.push({ id: 'pocs', title: `${s.useCases} use-cases across ${s.bus.join(', ')} · ${s.pocsInProgress} POC${s.pocsInProgress === 1 ? '' : 's'} active · ${s.pocsCompleted} completed · ${s.decisions} decision${s.decisions === 1 ? '' : 's'} waiting on leadership`,
        lines: active.length ? active.map(({ u, p }) => ({ text: `${u.bu} · ${u.name} · POC-${p.number} ${p.name}${p.nextMilestone ? ` · next: ${p.nextMilestone.text} (${p.nextMilestone.due})` : ''}`, href: `/portfolio#${u.id}`, tag: HEALTH_LABEL[u.health], tone: tone(u.health) })) : list.map(ucLine),
        href: '/portfolio', hrefLabel: 'The POC Portfolio' });
    }
  }

  // ── Health: at risk / off track ───────────────────────────────────────────
  if (has(q, /\b(at risk|off track|on track|health|red|amber|risk|risks|struggling|behind)\b/) && (pocQ || has(q, /\b(anything|what|which|who)\b/))) {
    if (!access.site) facts.push({ id: 'health', title: 'Health of the use-cases', lines: [], href: '/portfolio', hrefLabel: 'The POC Portfolio', note: LOCK_SITE });
    else {
      const list = useCases().filter(u => u.health !== 'green');
      facts.push({ id: 'health', title: list.length ? `${list.length} use-case${list.length === 1 ? '' : 's'} not on track` : 'Every use-case is on track',
        lines: list.map(u => ({ text: `${u.bu} · ${u.name}${u.healthReason ? ` - ${u.healthReason}` : ''}`, href: `/portfolio#${u.id}`, tag: HEALTH_LABEL[u.health], tone: tone(u.health) })), href: '/portfolio', hrefLabel: 'The POC Portfolio' });
    }
  }

  // ── Decisions and bottlenecks ─────────────────────────────────────────────
  if (has(q, /\b(decisions?|bottlenecks?|blockers?|blocked|leadership|waiting on|needs? (a )?decision)\b/)) {
    if (!access.site) facts.push({ id: 'decisions', title: 'Decisions waiting on leadership', lines: [], href: '/portfolio', hrefLabel: 'The POC Portfolio', note: LOCK_SITE });
    else {
      const list = useCases();
      const dec = list.flatMap(u => openDecisions(u).map(b => ({ u, b })));
      const open = list.flatMap(u => openBottlenecks(u).filter(b => !b.needsLeadership).map(b => ({ u, b })));
      facts.push({ id: 'decisions', title: `${dec.length} decision${dec.length === 1 ? '' : 's'} waiting on leadership · ${open.length} other open bottleneck${open.length === 1 ? '' : 's'}`,
        lines: [...dec.map(({ u, b }) => ({ text: `${u.bu} · ${u.name}: ${b.text} (owner ${b.owner})`, href: `/portfolio#${u.id}`, tag: 'decision', tone: 'red' as Tone })), ...open.map(({ u, b }) => ({ text: `${u.bu} · ${u.name}: ${b.text} (owner ${b.owner})`, href: `/portfolio#${u.id}`, tag: b.severity, tone: 'amber' as Tone }))],
        href: '/portfolio', hrefLabel: 'The POC Portfolio' });
    }
  }

  // ── Devices: readiness, which glasses fit, a device's card ────────────────
  const profiles = readDeviceProfiles();
  const GENERIC = new Set(['the', 'sib', 'app', 'pro', 'meta', 'apple', 'realities', 'glasses', 'iphone', 'ipad']);
  const devHit = profiles.filter(p => { const words = p.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !GENERIC.has(w)); return words.some(w => has(q, new RegExp(`\\b${w}\\b`))) || (/\bipad\b/.test(q) && p.id === 'ipad'); });
  const devQ = has(q, /\b(devices?|glasses|headsets?|wearables?|hardware)\b/);
  const capQ = has(q, /\b(categor(y|ies)|which (glasses|devices?|wearables?)).*\b(voice|hands[- ]free|anchor|anchors|overlay|overlays|evidence|photo|remote expert|see what i see|validation|pass|audit trail|2d|instructions in view)\b/) || has(q, /\b(voice|anchor|overlay|evidence|remote expert|validation|audit trail)\b.*\b(which|what) (glasses|devices?|categor)/);
  if (!capQ && (devQ || devHit.length) && has(q, /\b(ready|readiness|pilot|verdict|fit|fits|suit|which|best|recommend|choose|should we)\b/)) {
    if (!access.site) facts.push({ id: 'readiness', title: 'Device readiness', lines: [], href: '/scorecard#transition', hrefLabel: 'The Glasses transition', note: LOCK_SITE });
    else {
      const t = buildTransition(quarterOf());
      const devs = (devHit.length ? t.devices.filter(d => devHit.some(h => h.id === d.id)) : t.devices);
      const vt = (v: string): Tone => (v === 'READY FOR PILOT' ? 'green' : v === 'ASSESSING' ? 'amber' : v === 'NOT YET' ? 'red' : 'grey');
      facts.push({ id: 'readiness', title: `Readiness this quarter (${t.quarter}): ${t.counts.ready} ready for pilot · ${t.counts.assessing} assessing · ${t.counts.notYet} not yet · ${t.counts.notScored} not scored`,
        lines: devs.map(d => ({ text: `${d.name}${d.coverage != null ? ` · ${Math.round(d.coverage * 100)}% of steps delivered` : ''}${d.runs ? ` · ${d.runs} run${d.runs === 1 ? '' : 's'}` : ''}${d.blockers?.length ? ` · blockers: ${d.blockers.map((b: { name: string }) => b.name).join(', ')}` : ''}`, href: `/devices/gallery#${d.id}`, tag: d.verdict, tone: vt(d.verdict) })),
        href: '/scorecard#transition', hrefLabel: 'The Glasses transition', note: 'Readiness is scored per device by named engineers with evidence; a demo never lifts a verdict.' });
    }
    const fit = access.ip ? readFit() : null;
    if (fit) facts.push({ id: 'fit', title: 'Fit for AR OMS today, against our enterprise cleanroom requirements', lines: fit.devices.filter(d => !devHit.length || devHit.some(h => h.id === d.id)).map(d => ({ text: `${d.name} (${d.segment}): ${d.verdict}`, href: `/devices/gallery#${d.id}`, tone: d.fit === 'poc' ? 'amber' : d.fit === 'no' ? 'red' : 'blue' })), href: '/devices/fit', hrefLabel: 'Fit for the cleanroom' });
    else if (devQ) facts.push({ id: 'fit', title: 'Fit for the cleanroom: which glasses fit our requirements', lines: [], href: '/devices/fit', hrefLabel: 'Fit for the cleanroom', note: LOCK_IP });
  } else if (devHit.length) {
    for (const p of devHit.slice(0, 2)) {
      const i = p.info || {};
      facts.push({ id: 'device-' + p.id, title: p.name, lines: [...(i.what ? [{ text: i.what }] : []), ...(i.displaySpec ? [{ text: `Display: ${i.displaySpec}` }] : []), ...(i.fov ? [{ text: `Field of view: ${i.fov}` }] : []), ...(i.weight ? [{ text: `Weight: ${i.weight}` }] : []), ...(i.battery ? [{ text: `Battery: ${i.battery}` }] : []), ...(i.poc ? [{ text: `In the POC: ${i.poc}`, tone: 'green' as Tone }] : [])], href: `/devices/gallery#${p.id}`, hrefLabel: 'The device card' });
    }
  }

  // ── Capability by category ("which glasses can do voice / anchors / validation") ──
  if (capQ) {
    const fit = access.ip ? readFit() : null;
    if (!fit) facts.push({ id: 'capability', title: 'What each device category can do for AR work instructions', lines: [], href: '/devices/fit', hrefLabel: 'Fit for the cleanroom', note: LOCK_IP });
    else {
      const cap = fit.capabilities.find(c => c.name.toLowerCase().split(/[^a-z0-9]+/).some(w => w.length > 3 && has(q, new RegExp(`\\b${w}`))));
      if (cap) facts.push({ id: 'capability', title: `${cap.name}: by device category`, lines: fit.categories.map((c, i) => ({ text: `${c.eye} · ${c.kind} (${c.examples}) - ${c.role}`, tag: cap.cells[i], tone: cap.cells[i] === 'YES' ? 'green' : cap.cells[i] === 'PART' ? 'amber' : 'red' })), href: '/devices/fit', hrefLabel: 'Fit for the cleanroom' });
    }
  }

  // ── Live numbers ──────────────────────────────────────────────────────────
  if (has(q, /\b(how many|number of|count|live|right now|currently)\b/) && has(q, /\b(chambers?|anchors?|guides?|runs?|steps?|validated|on tools?|people|technicians?|mapped)\b/)) {
    if (!access.site) facts.push({ id: 'live', title: 'Live from this server', lines: [], href: '/platform', hrefLabel: 'The platform map', note: LOCK_SITE });
    else {
      const usage = omsUsageStore.findAll(); const live = presenceSummary();
      const validated = usage.reduce((n, r) => n + r.steps.filter(e => e.validation?.mode === 'system').length, 0);
      facts.push({ id: 'live', title: 'Live from this server, now', lines: [
        { text: `${anchorStore.findAll().length} chambers mapped`, href: '/portal#anchors' }, { text: `${guideStore.findAll().filter(g => g.published).length} guides published`, href: '/portal#content/guides' },
        { text: `${usage.length} guided runs · ${validated} steps validated`, href: '/portal#analytics/runs' }, { text: `${live.people} on tools now, on ${live.anchors.length} chamber${live.anchors.length === 1 ? '' : 's'}`, href: '/portal#analytics' }], href: '/platform', hrefLabel: 'The platform map' });
    }
  }

  // ── Landscape: news, latest, market ───────────────────────────────────────
  if (has(q, /\b(news|announce\w*|landscape|latest|market|new glasses|what('s| is) new|senz)\b/)) {
    const list = readLandscape(access.ip).slice(0, 4);
    facts.push({ id: 'landscape', title: 'The latest on the AR glasses landscape', lines: list.map(e => ({ text: `${e.date} · ${e.maker}: ${e.title}${e.means ? ` - ${e.means}` : ''}`, href: `/devices/landscape#${e.id}`, tag: e.signal, tone: e.signal === 'exited' ? 'red' : e.signal === 'candidate' ? 'green' : e.signal === 'optics' ? 'blue' : 'grey' })), href: '/devices/landscape', hrefLabel: 'AR glasses landscape', ...(access.ip ? {} : { note: '"What it means for us" opens with the IP key.' }) });
  }

  return facts;
}
