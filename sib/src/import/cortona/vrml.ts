// vrml.ts — VRML97 parser that KEEPS PROTO declarations and instances.
//
// Why our own: every stock VRML/X3D loader drops nodes it does not know, and
// in a Cortona3D publication the entire procedure (Procedure → Step →
// SubStep → Set_* commands) is expressed as PROTO instances wired by ROUTEs.
// A "successful" load with a generic loader yields static geometry and no
// motion, silently. This parser is deliberately type-agnostic: it does not
// need to know a node's field types to parse it, because VRML97's grammar is
// self-delimiting for our purposes:
//
//   value := '[' value* ']' | node | 'NULL' | TRUE | FALSE | string | number+
//            | 'IS' ident   (inside PROTO bodies)
//
// Greedy number runs are correct because field names are identifiers, never
// numbers, so a run of numbers can only end at the next field name or brace.
//
// Output is a plain AST: nodes {type, def, fields}, PROTO declarations with
// their interface (type, name, default), EXTERNPROTOs, ROUTEs. Field values
// are: number[] | string | string[] | boolean | VrmlNode | (VrmlNode|null)[]
// | null | {is: name}.

export interface VrmlNode {
  type:   string;
  def?:   string;
  fields: Record<string, VrmlValue>;
}
export interface VrmlUse { use: string }
export interface VrmlIs  { is: string }
export type VrmlValue =
  | number[] | string | string[] | boolean | null
  | VrmlNode | VrmlUse | VrmlIs
  | (VrmlNode | VrmlUse | null)[];

export interface ProtoField {
  kind:  'field' | 'exposedField' | 'eventIn' | 'eventOut';
  type:  string;     // SFVec3f, MFNode, ...
  name:  string;
  value?: VrmlValue; // default (field / exposedField)
}
export interface ProtoDecl {
  name:     string;
  fields:   ProtoField[];
  body:     VrmlNode[];           // top-level nodes of the PROTO body
  routes:   VrmlRoute[];
  external?: string[];            // EXTERNPROTO url(s)
}
export interface VrmlRoute { fromNode: string; fromField: string; toNode: string; toField: string }

export interface VrmlScene {
  nodes:   VrmlNode[];             // top-level scene nodes (DEF/USE resolved to VrmlNode/VrmlUse)
  protos:  Map<string, ProtoDecl>;
  routes:  VrmlRoute[];
  defs:    Map<string, VrmlNode>;  // every DEF'd node anywhere in the scene (not inside PROTO bodies)
  header:  string;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Tok = { t: 'id' | 'num' | 'str' | 'sym'; v: string; line: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0, line = 1;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 10) { line++; i++; continue; }
    if (c === 32 || c === 9 || c === 13 || c === 44 /* , */) { i++; continue; }
    if (c === 35 /* # */) { while (i < n && src.charCodeAt(i) !== 10) i++; continue; }
    if (c === 34 /* " */) {
      let j = i + 1; let s = '';
      while (j < n) {
        const d = src[j];
        if (d === '\\' && j + 1 < n) { s += src[j + 1]; j += 2; continue; }
        if (d === '"') break;
        if (d === '\n') line++;
        s += d; j++;
      }
      toks.push({ t: 'str', v: s, line }); i = j + 1; continue;
    }
    if (c === 123 || c === 125 || c === 91 || c === 93) { toks.push({ t: 'sym', v: src[i], line }); i++; continue; }
    // number: [+-]?(digits[.digits]?|.digits)([eE][+-]?digits)? or 0x hex
    if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
      let j = i;
      if (src[j] === '+' || src[j] === '-') j++;
      if (src[j] === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X')) {
        j += 2; while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        toks.push({ t: 'num', v: String(parseInt(src.slice(i, j), 16)), line }); i = j; continue;
      }
      const start = j;
      while (j < n && src.charCodeAt(j) >= 48 && src.charCodeAt(j) <= 57) j++;
      if (src[j] === '.') { j++; while (j < n && src.charCodeAt(j) >= 48 && src.charCodeAt(j) <= 57) j++; }
      if (j === start || (j === start + 1 && src[start] === '.')) {
        // lone sign / dot — treat as identifier char to avoid infinite loop
        let k = i; while (k < n && !/[\s,{}\[\]"]/.test(src[k])) k++;
        toks.push({ t: 'id', v: src.slice(i, k), line }); i = k; continue;
      }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1; if (src[k] === '+' || src[k] === '-') k++;
        if (/[0-9]/.test(src[k] ?? '')) { j = k; while (j < n && /[0-9]/.test(src[j])) j++; }
      }
      toks.push({ t: 'num', v: src.slice(i, j), line }); i = j; continue;
    }
    // identifier: anything up to whitespace/comma/brace/bracket/quote
    let k = i; while (k < n && !/[\s,{}\[\]"#]/.test(src[k])) k++;
    if (k === i) { i++; continue; }
    toks.push({ t: 'id', v: src.slice(i, k), line }); i = k;
  }
  return toks;
}

// ── Parser ───────────────────────────────────────────────────────────────────

class Parser {
  private p = 0;
  readonly protos = new Map<string, ProtoDecl>();
  readonly defs   = new Map<string, VrmlNode>();
  private routeSink: VrmlRoute[] = [];
  constructor(private toks: Tok[]) {}

  /** DEF names that contain spaces (Cortona part descriptions) — for USE / ROUTE matching. */
  private spacedDefs: string[] = [];
  private peek(o = 0): Tok | undefined { return this.toks[this.p + o]; }
  private next(): Tok { const t = this.toks[this.p++]; if (!t) throw new Error('vrml: unexpected end of input'); return t; }
  private expectSym(s: string): void {
    const t = this.next();
    if (t.t !== 'sym' || t.v !== s) throw new Error(`vrml: expected "${s}" at line ${t.line}, got "${t.v}"${this.context()}`);
  }
  /** Content-free context for error messages: the preceding tokens, strings masked. */
  private context(): string {
    const from = Math.max(0, this.p - 9);
    const parts = this.toks.slice(from, this.p - 1).map(t => t.t === 'str' ? '"…"' : t.v);
    return parts.length ? ` (after: ${parts.join(' ')})` : '';
  }
  private isSym(s: string, o = 0): boolean { const t = this.peek(o); return !!t && t.t === 'sym' && t.v === s; }
  private isId(s: string, o = 0): boolean { const t = this.peek(o); return !!t && t.t === 'id' && t.v === s; }

  parseScene(): { nodes: VrmlNode[]; routes: VrmlRoute[] } {
    const nodes: VrmlNode[] = []; const routes: VrmlRoute[] = [];
    this.routeSink = routes;
    while (this.peek()) {
      const s = this.parseStatement(false);
      if (s) nodes.push(s as VrmlNode);
    }
    return { nodes, routes };
  }

  /** One top-level statement: PROTO / EXTERNPROTO / ROUTE / node. */
  private parseStatement(inProto: boolean): VrmlNode | VrmlUse | null {
    const t = this.peek()!;
    if (t.t === 'id') {
      if (t.v === 'PROTO')       { this.parseProto(); return null; }
      if (t.v === 'EXTERNPROTO') { this.parseExternProto(); return null; }
      if (t.v === 'ROUTE')       { this.routeSink.push(this.parseRoute()); return null; }
      return this.parseNodeStatement(inProto);
    }
    throw new Error(`vrml: unexpected token "${t.v}" at line ${t.line}`);
  }

  private parseRoute(): VrmlRoute {
    this.next(); // ROUTE
    // Endpoints are `node.field`; a DEF name with spaces spreads over several
    // tokens, so gather until the one that carries the ".field" tail.
    const endpoint = (): string => {
      let v = this.next().v;
      while (!v.includes('.') && this.peek()?.t === 'id' && !this.isId('TO')) v += ' ' + this.next().v;
      return v;
    };
    const from = endpoint(); if (!this.isId('TO')) throw new Error('vrml: ROUTE missing TO'); this.next();
    const to = endpoint();
    const [fromNode, fromField] = splitDot(from); const [toNode, toField] = splitDot(to);
    return { fromNode, fromField, toNode, toField };
  }

  private parseInterface(withDefaults: boolean): ProtoField[] {
    this.expectSym('[');
    const fields: ProtoField[] = [];
    while (!this.isSym(']')) {
      const kind = this.next().v as ProtoField['kind'];
      if (!['field', 'exposedField', 'eventIn', 'eventOut'].includes(kind)) throw new Error(`vrml: bad interface keyword "${kind}"`);
      const type = this.next().v; const name = this.next().v;
      const f: ProtoField = { kind, type, name };
      if (withDefaults && (kind === 'field' || kind === 'exposedField')) f.value = this.parseValue(type, true);
      fields.push(f);
    }
    this.expectSym(']');
    return fields;
  }

  private parseProto(): void {
    this.next(); // PROTO
    const name = this.next().v;
    const fields = this.parseInterface(true);
    this.expectSym('{');
    const body: VrmlNode[] = []; const routes: VrmlRoute[] = [];
    // PROTO bodies may declare nested PROTOs and ROUTEs; DEFs inside are body-local.
    const savedDefs = new Map(this.defs); const savedSink = this.routeSink; this.routeSink = routes;
    while (!this.isSym('}')) {
      const s = this.parseStatement(true);
      if (s && !('use' in s)) body.push(s);
    }
    this.expectSym('}');
    this.defs.clear(); for (const [k, v] of savedDefs) this.defs.set(k, v);
    this.routeSink = savedSink;
    this.protos.set(name, { name, fields, body, routes });
  }

  private parseExternProto(): void {
    this.next(); // EXTERNPROTO
    const name = this.next().v;
    const fields = this.parseInterface(false);   // EXTERNPROTO interfaces carry no defaults
    const urls: string[] = [];
    if (this.isSym('[')) { this.next(); while (!this.isSym(']')) urls.push(this.next().v); this.next(); }
    else urls.push(this.next().v);
    this.protos.set(name, { name, fields, body: [], routes: [], external: urls });
  }

  private parseNodeStatement(inProto: boolean): VrmlNode | VrmlUse {
    const t = this.next();
    if (t.v === 'USE') {
      let name = this.next().v;
      // A USE of a spaced DEF name: extend while a known name continues this way.
      while (this.peek()?.t === 'id' && this.spacedDefs.some(d => d === name + ' ' + this.peek()!.v || d.startsWith(name + ' ' + this.peek()!.v + ' '))) name += ' ' + this.next().v;
      return { use: name };
    }
    let def: string | undefined;
    let typeTok = t;
    if (t.v === 'DEF') {
      def = this.next().v;
      typeTok = this.next();
      // Cortona writes DEF names straight from part descriptions, spaces
      // included ("DEF Callout_P/N_0022_HOUSING LIFT_e0c ObjectVM {"), which
      // VRML97 forbids but the viewer accepts. The name is everything up to
      // the token that is followed by "{" — that token is the node type.
      while (typeTok.t === 'id' && !this.isSym('{')) {
        const nxt = this.peek();
        if (!nxt || nxt.t !== 'id') break;
        def += ' ' + typeTok.v;
        typeTok = this.next();
      }
      if (def.includes(' ') && !this.spacedDefs.includes(def)) this.spacedDefs.push(def);
    }
    if (typeTok.t !== 'id') throw new Error(`vrml: expected node type at line ${typeTok.line}`);
    const node: VrmlNode = { type: typeTok.v, fields: {} };
    if (def) node.def = def;
    this.expectSym('{');
    const decl = this.protos.get(node.type);
    while (!this.isSym('}')) {
      const ft = this.next();
      if (ft.t !== 'id') throw new Error(`vrml: expected field name in ${node.type} at line ${ft.line}, got "${ft.v}"`);
      if (ft.v === 'ROUTE') { this.p--; this.routeSink.push(this.parseRoute()); continue; }
      if (ft.v === 'PROTO') { this.p--; this.parseProto(); continue; }
      if (ft.v === 'EXTERNPROTO') { this.p--; this.parseExternProto(); continue; }
      // Script nodes declare their own interface inline: field SFInt32 x 0 / eventIn ... / url ...
      if (node.type === 'Script' && (ft.v === 'field' || ft.v === 'exposedField' || ft.v === 'eventIn' || ft.v === 'eventOut')) {
        const type = this.next().v; const name = this.next().v;
        if (ft.v === 'field' || ft.v === 'exposedField') node.fields[name] = this.parseValue(type, inProto);
        else if (this.isId('IS')) { this.next(); this.next(); }   // eventIn/eventOut may be IS-bound inside PROTO bodies
        continue;
      }
      const declType = decl?.fields.find(f => f.name === ft.v)?.type;
      node.fields[ft.v] = this.parseValue(declType, inProto);
    }
    this.expectSym('}');
    if (def && !inProto) this.defs.set(def, node);
    return node;
  }

  /** Parse a field value; `type` is a hint (may be undefined for standard nodes). */
  private parseValue(type: string | undefined, inProto: boolean): VrmlValue {
    const t = this.peek();
    if (!t) throw new Error('vrml: unexpected end in value');
    if (t.t === 'id' && t.v === 'IS') { this.next(); return { is: this.next().v }; }
    if (t.t === 'sym' && t.v === '[') {
      this.next();
      const nums: number[] = []; const strs: string[] = []; const nodes: (VrmlNode | VrmlUse | null)[] = [];
      while (!this.isSym(']')) {
        const u = this.peek()!;
        if (u.t === 'num') nums.push(Number(this.next().v));
        else if (u.t === 'str') strs.push(this.next().v);
        else if (u.t === 'id' && u.v === 'NULL') { this.next(); nodes.push(null); }
        else if (u.t === 'id' && u.v === 'ROUTE') { this.routeSink.push(this.parseRoute()); }
        else if (u.t === 'id' && (u.v === 'TRUE' || u.v === 'FALSE')) { this.next(); nums.push(u.v === 'TRUE' ? 1 : 0); }
        else if (u.t === 'id') nodes.push(this.parseNodeStatement(inProto));
        else throw new Error(`vrml: unexpected "${u.v}" in list at line ${u.line}`);
      }
      this.next();
      if (nodes.length) return nodes;
      if (strs.length) return strs;
      return nums;
    }
    if (t.t === 'num') {
      const nums: number[] = [];
      while (this.peek()?.t === 'num') nums.push(Number(this.next().v));
      return nums;
    }
    if (t.t === 'str') { this.next(); return type?.startsWith('MF') ? [t.v] : t.v; }
    if (t.t === 'id') {
      if (t.v === 'TRUE')  { this.next(); return true; }
      if (t.v === 'FALSE') { this.next(); return false; }
      if (t.v === 'NULL')  { this.next(); return null; }
      const n = this.parseNodeStatement(inProto);
      return type?.startsWith('MF') ? [n] : n;
    }
    throw new Error(`vrml: unexpected token "${t.v}" at line ${t.line}`);
  }
}

function splitDot(s: string): [string, string] {
  const i = s.lastIndexOf('.');
  if (i < 0) return [s, ''];
  return [s.slice(0, i), s.slice(i + 1)];
}

export function parseVrml(text: string): VrmlScene {
  const header = text.split('\n', 1)[0].trim();
  if (!header.startsWith('#VRML V2.0')) throw new Error(`vrml: not a VRML97 file (header "${header.slice(0, 40)}")`);
  const parser = new Parser(tokenize(text));
  const { nodes, routes } = parser.parseScene();
  return { nodes, routes, protos: parser.protos, defs: parser.defs, header };
}

// ── Helpers for consumers ────────────────────────────────────────────────────

// Field readers tolerate a USE / IS reference or a null slipping in where a
// node was expected (a top-level `USE X`, an IS-bound child): they read as
// "no such field" instead of throwing on `.fields` of undefined.
const fieldsOf = (n: unknown): Record<string, VrmlValue> =>
  n && typeof n === 'object' && 'fields' in n && (n as VrmlNode).fields ? (n as VrmlNode).fields : {};
export function numField(n: VrmlNode, name: string, fallback: number[]): number[] {
  const v = fieldsOf(n)[name];
  return Array.isArray(v) && v.every(x => typeof x === 'number') ? (v as number[]) : fallback;
}
export function strField(n: VrmlNode, name: string): string | undefined {
  const v = fieldsOf(n)[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0] as string;
  return undefined;
}
export function boolField(n: VrmlNode, name: string): boolean | undefined {
  const v = n.fields[name]; return typeof v === 'boolean' ? v : undefined;
}
export function nodeField(n: VrmlNode, name: string): VrmlNode | VrmlUse | null {
  const v = fieldsOf(n)[name];
  if (v && typeof v === 'object' && !Array.isArray(v) && ('type' in v || 'use' in v)) return v as VrmlNode | VrmlUse;
  return null;
}
export function nodesField(n: VrmlNode, name: string): (VrmlNode | VrmlUse)[] {
  const v = fieldsOf(n)[name];
  if (Array.isArray(v)) return (v as unknown[]).filter((x): x is VrmlNode | VrmlUse => !!x && typeof x === 'object' && ('type' in x || 'use' in x));
  if (v && typeof v === 'object' && ('type' in v || 'use' in v)) return [v as VrmlNode | VrmlUse];
  return [];
}
/** Walk every node in the scene (not PROTO bodies), depth-first. */
export function walkNodes(nodes: (VrmlNode | VrmlUse | null)[], fn: (n: VrmlNode, parent: VrmlNode | null) => void, parent: VrmlNode | null = null): void {
  for (const n of nodes) {
    if (!n || typeof n !== 'object' || !('fields' in n) || !n.fields) continue;   // USE / IS refs: skip
    fn(n, parent);
    for (const v of Object.values(n.fields)) {
      if (Array.isArray(v)) walkNodes(v.filter((x): x is VrmlNode | VrmlUse | null => x === null || typeof x === 'object'), fn, n);
      else if (v && typeof v === 'object' && 'type' in v) walkNodes([v as VrmlNode], fn, n);
    }
  }
}
