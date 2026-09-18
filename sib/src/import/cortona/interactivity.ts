// interactivity.ts — read the two XML side files of a Cortona3D bundle.
//
//   <title>.interactivity.xml  (root SimulationInteractivity)
//     Procedure[@id]/Item[@id]/…/Action[@id]   text carriers: Description, Comment, Text, tooltip
//     Simulation[@id]/Step[@id]/Substep[@id]   runtime tree (ids match the VRML Step/SubStep ids)
//     DocItems/DocItem[@id,@objectID]/metadata/value[@name]   id → part number / description / qty
//     SimulationInformation/Options/Value[@name,@type]        publish options (GLTF, X3D, UpRight…)
//
//   <title>.xml  (root rwi)  job/task index + bom/part{pnr,desc,qty,altpnr}.
//     NOT a step source (0 steps in sample 2) — used for BOM enrichment only.
//
// Text is returned as-is (plain); RTF/HTML bodies live in the VRML widget
// parameters, not here, and are handled by richtext.ts.

import { parseXml, walkXml, findAll, child, type XmlEl } from './xml-lite.js';
import { htmlToText } from './widgets.js';

/** One human work step from the <Procedure>/<Item> tree (the document's own
 *  step list). Its Actions are the animation SubSteps (Simulation tree) that
 *  play while the step is shown — several per work step in every real file. */
export interface WorkItem {
  id:         string;
  title?:     string;        // Item/Description (plain)
  text?:      string;        // Item/Text (HTML in CDATA → plain)
  comment?:   string;        // Item/Comment (HTML → plain)
  actionIds:  string[];      // Action @id in order == VRML SubStep ids
  path:       string[];      // ancestor Item titles, outermost first
  topIndex:   number;        // 1-based index of the top-level Item (== Simulation Step order)
}

export interface StepText { title?: string; comment?: string; text?: string; tooltip?: string }
export interface PartInfo { objectID?: number; partNumber?: string; description?: string; quantity?: string; altPartNumber?: string }

export interface InteractivityIndex {
  textById:       Map<string, StepText>;      // any element with @id that carries text children
  partByObjectID: Map<number, PartInfo>;      // DocItems keyed by objectID
  partByDocId:    Map<string, PartInfo>;      // DocItems keyed by @id
  publishOptions: Record<string, string>;
  info:           Record<string, string>;     // SimulationInformation scalar fields (ExporterVersionNumber, SpecID…)
  stepIds:        string[];                   // Simulation/Step @id in document order
  substepIds:     string[];                   // Simulation/Step/Substep @id in document order
  substepParent:  Map<string, string>;        // substep id → step id
  workItems:      WorkItem[];                 // Procedure leaf Items in document order (empty when no Procedure tree)
}

const TEXT_TAGS = ['Description', 'Comment', 'Text', 'tooltip', 'Title', 'Name'];

export function readInteractivity(xml: string): InteractivityIndex {
  const root = parseXml(xml);
  const idx: InteractivityIndex = {
    textById: new Map(), partByObjectID: new Map(), partByDocId: new Map(),
    publishOptions: {}, info: {}, stepIds: [], substepIds: [], substepParent: new Map(), workItems: [],
  };

  walkXml(root, (e) => {
    const id = e.attrs.id;
    if (id) {
      const t: StepText = {};
      for (const c of e.children) {
        if (!TEXT_TAGS.includes(c.name)) continue;
        const v = c.text.trim(); if (!v) continue;
        if (c.name === 'Description' || c.name === 'Title' || c.name === 'Name') t.title = t.title ?? v;
        else if (c.name === 'Comment') t.comment = htmlToText(v).trim() || undefined;
        else if (c.name === 'Text') t.text = htmlToText(v).trim() || undefined;
        else if (c.name === 'tooltip') t.tooltip = v;
      }
      if (e.attrs.title && !t.title) t.title = e.attrs.title;
      if (Object.keys(t).length) {
        const prev = idx.textById.get(id);
        idx.textById.set(id, prev ? { ...t, ...prev } : t); // first occurrence wins per field
      }
    }
    if (e.name === 'Step' && e.parent?.name === 'Simulation' && id) idx.stepIds.push(id);
    if (e.name === 'Substep' && id) {
      idx.substepIds.push(id);
      const p = e.parent; if (p?.name === 'Step' && p.attrs.id) idx.substepParent.set(id, p.attrs.id);
    }
  });

  for (const d of findAll(root, 'DocItem')) {
    const info: PartInfo = {};
    const oid = d.attrs.objectID !== undefined ? Number(d.attrs.objectID) : NaN;
    if (Number.isFinite(oid)) info.objectID = oid;
    const meta = child(d, 'metadata');
    for (const v of meta?.children ?? []) {
      if (v.name !== 'value') continue;
      const name = (v.attrs.name ?? '').toLowerCase(); const val = v.text.trim();
      if (name === 'part number') info.partNumber = val;
      else if (name === 'description') info.description = val;
      else if (name === 'quantity') info.quantity = val;
      else if (name === 'alternate part number') info.altPartNumber = val;
    }
    if (Number.isFinite(oid)) idx.partByObjectID.set(oid, info);
    if (d.attrs.id) idx.partByDocId.set(d.attrs.id, info);
  }

  for (const procEl of findAll(root, 'Procedure').filter(e => e.parent?.name !== 'Item')) {
    let topIndex = 0;
    const walkItems = (el: XmlEl, path: string[], top: number): void => {
      const items = el.children.filter(c => c.name === 'Item');
      if (items.length) { for (const it of items) walkItems(it, [...path, ...(plain(it, 'Description') ? [plain(it, 'Description')!] : [])], top); return; }
      // leaf Item
      const actions = el.children.filter(c => c.name === 'Action');
      const own = itemText(el);
      const actionsWithText = actions.filter(a => itemText(a).title || itemText(a).text);
      if (!own.title && !own.text && actionsWithText.length) {
        // text carried per Action (each Action is its own work step)
        for (const a of actions) idx.workItems.push({ id: a.attrs.id ?? el.attrs.id ?? '', ...itemText(a), actionIds: a.attrs.id ? [a.attrs.id] : [], path: path.slice(0, -1), topIndex: top });
      } else {
        idx.workItems.push({ id: el.attrs.id ?? '', ...own, actionIds: actions.map(a => a.attrs.id).filter((x): x is string => !!x), path: path.slice(0, -1), topIndex: top });
      }
    };
    for (const top of procEl.children.filter(c => c.name === 'Item')) {
      topIndex++;
      const t = plain(top, 'Description');
      walkItems(top, t ? [t] : [], topIndex);
    }
  }

  const simInfo = findAll(root, 'SimulationInformation')[0];
  if (simInfo) {
    for (const c of simInfo.children) {
      if (c.name === 'Options') { for (const v of c.children) if (v.name === 'Value' && v.attrs.name) idx.publishOptions[v.attrs.name] = v.text.trim(); }
      else if (c.children.length === 0 && c.text.trim()) idx.info[c.name] = c.text.trim();
    }
  }
  return idx;
}

function plain(el: XmlEl, name: string): string | undefined {
  const v = child(el, name)?.text.trim(); return v || undefined;
}
function itemText(el: XmlEl): { title?: string; text?: string; comment?: string } {
  const o: { title?: string; text?: string; comment?: string } = {};
  const d = plain(el, 'Description'); if (d) o.title = d;
  const t = plain(el, 'Text');        if (t) o.text = htmlToText(t).trim() || undefined;
  const c = plain(el, 'Comment');     if (c) o.comment = htmlToText(c).trim() || undefined;
  return o;
}

export interface RwiIndex {
  jobTitle?:  string;
  taskCount:  number;
  stepCount:  number;
  bom:        PartInfo[];
}

export function readRwi(xml: string): RwiIndex {
  const root = parseXml(xml);
  const rwi = findAll(root, 'rwi')[0] ?? root;
  const job = findAll(rwi, 'job')[0];
  const out: RwiIndex = { taskCount: findAll(rwi, 'task').length, stepCount: findAll(rwi, 'step').length, bom: [] };
  const jt = job ? child(job, 'title')?.text.trim() : undefined;
  if (jt && !/^\d+$/.test(jt)) out.jobTitle = jt;           // rwi titles are often bare integers — never display those
  for (const p of findAll(rwi, 'part')) {
    out.bom.push({
      partNumber:    child(p, 'pnr')?.text.trim() || undefined,
      description:   child(p, 'desc')?.text.trim() || undefined,
      quantity:      child(p, 'qty')?.text.trim() || undefined,
      altPartNumber: child(p, 'altpnr')?.text.trim() || undefined,
    });
  }
  return out;
}

export { type XmlEl };
