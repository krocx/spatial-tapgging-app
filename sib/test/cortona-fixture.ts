// cortona-fixture.ts — builds a synthetic Cortona3D published bundle whose
// structure mirrors the two office reconnaissance reports (PROTO schema,
// command interface, ROUTE wiring, interactivity.xml, rwi). Content is
// invented. Used by tests and by `npm run cortona:fixture` for manual runs.
import zlib from 'zlib';

export interface FixtureOptions {
  unknownProto?: boolean;   // add an unrecognised PROTO instance (strict-mode test)
  withSvg?: boolean;
  parts?: number;           // number of leaf parts (default 4)
}

export function buildVrml(o: FixtureOptions = {}): string {
  const parts = o.parts ?? 4;
  const protos = `#VRML V2.0 utf8
#	Created by RapidGenerator 9.9 (Import_MicroStation 9.9)
PROTO ObjectVM [ exposedField SFInt32 whichChoice 0 exposedField SFNode appearance NULL exposedField SFNode geometry NULL
  exposedField MFNode children [] exposedField SFVec3f translation 0 0 0 exposedField SFRotation rotation 0 0 1 0
  exposedField SFVec3f center 0 0 0 exposedField SFVec3f scale 1 1 1 exposedField SFRotation scaleOrientation 0 0 1 0
  exposedField SFNode parent NULL exposedField MFNode extraGeom [] field SFString name "" eventIn MFNode addChildren eventIn MFNode removeChildren field SFInt32 flags 0 ]
{ Transform { translation IS translation rotation IS rotation center IS center scale IS scale children IS children } }
PROTO Procedure [ field SFString title "" field SFString comment "" exposedField SFString id "" exposedField MFNode steps [] ] { Group {} }
PROTO Step [ field SFString title "" field SFString comment "" exposedField SFString id "" exposedField SFBool simulate TRUE exposedField MFNode substeps [] ] { Group {} }
PROTO SubStep [ exposedField MFNode commands [] field SFString title "" field SFString comment "" exposedField SFString id "" exposedField SFTime duration 0 ] { Group {} }
${['Set_translation', 'SFVec3f', 'MFVec3f'].join(' ') && ''}
PROTO Set_translation [ field SFString title "" exposedField MFFloat key [] exposedField MFVec3f keyValue [] field MFFloat Parameters [] exposedField MFFloat period [] eventIn SFFloat time_fraction exposedField SFInt32 objectID 0 exposedField SFInt32 attributeID 0 exposedField SFString objectName "" exposedField SFString attributeName "" eventOut SFVec3f value_changed ] { Group {} }
PROTO Set_rotation [ field SFString title "" exposedField MFFloat key [] exposedField MFRotation keyValue [] field MFFloat Parameters [] exposedField MFFloat period [] eventIn SFFloat time_fraction exposedField SFInt32 objectID 0 exposedField SFInt32 attributeID 0 exposedField SFString objectName "" exposedField SFString attributeName "" eventOut SFRotation value_changed ] { Group {} }
PROTO Set_transparency [ field SFString title "" exposedField MFFloat key [] exposedField MFFloat keyValue [] field MFFloat Parameters [] exposedField MFFloat period [] eventIn SFFloat time_fraction exposedField SFInt32 objectID 0 exposedField SFInt32 attributeID 0 exposedField SFString objectName "" exposedField SFString attributeName "" eventOut SFFloat value_changed ] { Group {} }
PROTO SwitchOFF [ field SFString title "" exposedField MFFloat key [] exposedField MFInt32 keyValue [] field MFFloat Parameters [] exposedField MFFloat period [] eventIn SFFloat time_fraction exposedField SFInt32 objectID 0 exposedField SFInt32 attributeID 0 exposedField SFString objectName "" exposedField SFString attributeName "" eventOut SFInt32 value_changed ] { Group {} }
PROTO Set_diffuseColor [ field SFString title "" exposedField MFFloat key [] exposedField MFColor keyValue [] field MFFloat Parameters [] exposedField MFFloat period [] eventIn SFFloat time_fraction exposedField SFInt32 objectID 0 exposedField SFInt32 attributeID 0 exposedField SFString objectName "" exposedField SFString attributeName "" eventOut SFColor value_changed ] { Group {} }
PROTO Set_Viewpoint [ field SFString title "" exposedField SFVec3f center 0 0 0 exposedField SFVec3f position 0 0 10 exposedField SFRotation orientation 0 0 1 0 exposedField SFFloat fieldOfView 0.785 exposedField SFBool orthographic FALSE field SFBool interruption FALSE field MFFloat zoom_limits [] exposedField MFFloat period [] exposedField SFNode Object NULL exposedField MFFloat key [] exposedField MFFloat keyValue [] field MFFloat Parameters [] eventIn SFFloat time_fraction exposedField SFInt32 objectID 0 exposedField SFInt32 attributeID 0 exposedField SFString objectName "" exposedField SFString attributeName "" ] { Group {} }
PROTO CalloutM6 [ exposedField SFVec3f translation 0 0 0 exposedField SFRotation rotation 0 0 1 0 field SFString string "" field SFFloat width 0.1 exposedField SFInt32 whichChoice 0 ] { Group {} }
PROTO PanelHtml9 [ exposedField SFVec3f translation 0 0 0 field MFString htmlbody [] field MFString url [] exposedField SFInt32 whichChoice 0 ] { Group {} }
PROTO protoSimulationPlayer [ field SFInt32 version_num 2 field SFString OP "" field MFNode AllSubSteps [] ] { Group {} }
EXTERNPROTO IndexedFaceSetWithEdges [ exposedField SFNode coord exposedField MFInt32 coordIndex field SFFloat creaseAngle field SFBool solid ] "urn:inet:parallelgraphics.com:cortona:IndexedFaceSetWithEdges"
${o.unknownProto ? 'PROTO MysteryWidget [ field SFString foo "" ] { Group {} }\n' : ''}
NavigationInfo { avatarSize [ 0.25, 1.6, 0.75 ] type [ "EXAMINE" ] }
DEF BaseViewpoint1 Viewpoint { position 0.6 0.2 1.59 orientation 0 1 0 0 fieldOfView 0.785 description "start" }
`;
  const box = (x: number) => `Shape { appearance Appearance { material Material { diffuseColor 0.7 0.72 0.75 } }
  geometry IndexedFaceSet { ccw TRUE creaseAngle 0.5 coord Coordinate { point [ ${x} 0 0, ${x + 0.05} 0 0, ${x + 0.05} 0.05 0, ${x} 0.05 0, ${x} 0 0.05, ${x + 0.05} 0 0.05, ${x + 0.05} 0.05 0.05, ${x} 0.05 0.05 ] }
    coordIndex [ 0 1 2 3 -1, 4 5 6 7 -1, 0 1 5 4 -1, 2 3 7 6 -1, 1 2 6 5 -1, 0 3 7 4 -1 ] } }`;
  let scene = `DEF ASSEMBLY_ROOT ObjectVM { name "Assembly" translation 0 0 0 children [
  DEF BASE_PLATE ObjectVM { name "Base plate" translation 0 0 0 children [ ${box(0)} ] }
`;
  for (let i = 1; i <= parts; i++) {
    scene += `  DEF PN_0190-1000${i}_1 ObjectVM { name "Part ${i}" translation ${(0.1 * i).toFixed(3)} 0.06 0 children [ ${box(0)} ] }\n`;
  }
  scene += `  DEF CALLOUT_A CalloutM6 { translation 0.1 0.12 0 string "Torque to spec" whichChoice -1 }
  DEF PANEL_A PanelHtml9 { translation 0.3 0.12 0 htmlbody [ "<html><body><p>Check &amp; verify</p><p>seal seating</p></body></html>" ] whichChoice -1 }
${o.unknownProto ? '  DEF MYSTERY MysteryWidget { foo "x" }\n' : ''}] }
`;
  // procedure: 2 steps, 3 substeps
  const cmds: string[] = [];
  const routes: string[] = [];
  const sub = (id: string, title: string, dur: number, body: string) => `      DEF SS_${id} SubStep { id "${id}" title "${title}" duration ${dur} commands [\n${body}\n      ] }`;
  const cmd = (def: string, type: string, extra: string, target: string, field: string) => {
    routes.push(`ROUTE ${def}.value_changed TO ${target}.${field}`);
    return `        DEF ${def} ${type} { ${extra} }`;
  };
  const s1 = [
    cmd('C1', 'SwitchOFF', 'key [ 0 1 ] keyValue [ -1 -1 ] period [ 0 1 ] objectID -106464992 attributeName "whichChoice"', 'PN_0190-10001_1', 'whichChoice'),
    cmd('C2', 'Set_transparency', 'key [ 0 1 ] keyValue [ 0 0.7 ] period [ 0 1 ] objectID -2001 attributeName "transparency"', 'PN_0190-10002_1', 'transparency'),
    cmd('C3', 'Set_Viewpoint', 'position 0.5 0.3 1.2 orientation 0 1 0 0.3 fieldOfView 0.7', '', ''),
  ];
  routes.pop(); // C3 has no route
  const s2 = [
    cmd('C4', 'Set_translation', 'key [ 0 0.5 1 ] keyValue [ 0.1 0.30 0, 0.1 0.18 0, 0.1 0.06 0 ] period [ 0 2 ] objectID -106464992 attributeName "translation"', 'PN_0190-10001_1', 'translation'),
    cmd('C5', 'SwitchOFF', 'key [ 0 ] keyValue [ 0 ] period [ 0 0.1 ] objectID -3001 attributeName "whichChoice"', 'CALLOUT_A', 'whichChoice'),
    cmd('C6', 'SwitchOFF', 'key [ 0 ] keyValue [ 0 ] objectID -106464992 attributeName "whichChoice"', 'PN_0190-10001_1', 'whichChoice'),
  ];
  const s3 = [
    cmd('C7', 'Set_rotation', 'key [ 0 1 ] keyValue [ 0 0 1 0, 0 0 1 1.5708 ] period [ 0 1 ] objectID -2001 attributeName "rotation"', 'PN_0190-10002_1', 'rotation'),
    cmd('C8', 'Set_diffuseColor', 'key [ 0 1 ] keyValue [ 0.7 0.72 0.75, 1 0.2 0.1 ] period [ 0 0.5 ] objectID -2001 attributeName "diffuseColor"', 'PN_0190-10002_1', 'diffuseColor'),
    cmd('C9', 'SwitchOFF', 'key [ 0 ] keyValue [ 0 ] objectID -4001 attributeName "whichChoice"', 'PANEL_A', 'whichChoice'),
  ];
  const s0 = [
    cmd('C0', 'SwitchOFF', 'key [ 0 ] keyValue [ -1 ] objectID -2001 attributeName "whichChoice"', 'PN_0190-10002_1', 'whichChoice'),
  ];
  const proc = `DEF PROC Procedure { id "proc-1" title "Sample assembly" steps [
    DEF ST0 Step { id "st-0" title "0" simulate FALSE substeps [
${sub('ss-0', 'initial state', 0, s0.join('\n'))}
    ] }
    DEF ST1 Step { id "st-1" title "Prepare" substeps [
${sub('ss-1', 'Remove cover', 2, s1.join('\n'))}
    ] }
    DEF ST2 Step { id "st-2" title "Install ring" substeps [
${sub('ss-2', 'Lower ring into place', 4, s2.join('\n'))}
${sub('ss-3', 'Rotate and lock', 3, s3.join('\n'))}
    ] }
  ] }
DEF PLAYER protoSimulationPlayer { version_num 2 AllSubSteps [ USE SS_ss-0 USE SS_ss-1 USE SS_ss-2 USE SS_ss-3 ] }
`;
  cmds.length;
  return protos + scene + proc + routes.join('\n') + '\n';
}

export function buildInteractivity(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<SimulationInteractivity xmlns="http://services.parallelgraphics.com/vm/mmr/vm-interactivity-xml/all">
  <SimulationInformation><ExporterVersionNumber>2512.0.0.496 (64-bit)</ExporterVersionNumber><SpecID>RAPID_WORK_INSTRUCTIONS</SpecID><SpecVersion>5.1</SpecVersion>
    <Options><Value name="GLTF" type="0">No</Value><Value name="X3D" type="0">No</Value><Value name="UpRight" type="0">No</Value><Value name="SingleHTMLBundle" type="0">Yes</Value></Options>
  </SimulationInformation>
  <Procedure id="proc-1"><Description>Sample assembly</Description>
    <Item id="st-1"><Description>Prepare</Description>
      <Item id="wi-1"><Action id="ss-1"></Action><Description>Remove cover</Description><Text><![CDATA[<p>Lift the cover straight up and set aside.</p>]]></Text></Item></Item>
    <Item id="st-2"><Description>Install ring</Description>
      <Item id="wi-2"><Action id="ss-2"></Action><Action id="ss-3"></Action><Description>Lower the ring and lock it</Description>
        <Text><![CDATA[<p>Align the ring notch with the base key.</p><p>Rotate 90&#176; clockwise until it clicks.</p>]]></Text><Comment><![CDATA[<p>Two-person lift.</p>]]></Comment></Item></Item>
  </Procedure>
  <Simulation id="sim-1"><Step id="st-0"><Description>0</Description><Substep id="ss-0"/></Step><Step id="st-1"><Description>Prepare</Description><Substep id="ss-1"/></Step><Step id="st-2"><Description>Install ring</Description><Substep id="ss-2"/><Substep id="ss-3"/></Step></Simulation>
  <DocItems>
    <DocItem id="di-1" objectID="-106464992"><metadata><value decl-id="d1" name="Part number" type="1">0190-10001</value><value decl-id="d2" name="Description" type="1">RING, UPPER</value><value decl-id="d3" name="Quantity" type="0">1</value></metadata></DocItem>
    <DocItem id="di-2" objectID="-2001"><metadata><value decl-id="d1" name="Part number" type="1">0190-10002</value><value decl-id="d2" name="Description" type="1">SEAL</value></metadata></DocItem>
  </DocItems>
</SimulationInteractivity>`;
}

export function buildRwi(): string {
  return `<?xml version="1.0"?><rwi lang="en"><jobCode/><title>12</title><bom><part id="p1"><pnr>0190-10001</pnr><desc>RING, UPPER</desc><qty>1</qty></part><part id="p2"><pnr>0190-10002</pnr><desc>SEAL</desc><qty>2</qty></part></bom>
<job id="j1"><title>12</title><task id="t1"><title>1</title></task><task id="t2"><title>2</title></task></job></rwi>`;
}

// ── minimal ZIP writer (stored) ────────────────────────────────────────────
function crc32(buf: Buffer): number {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
export function zipStored(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'); const crc = crc32(e.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, e.data); centrals.push(ch, name);
    offset += lh.length + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

export function buildBundleZip(o: FixtureOptions = {}): Buffer {
  const entries = [
    { name: 'Sample.wrl', data: zlib.gzipSync(Buffer.from(buildVrml(o), 'utf8')) },
    { name: 'Sample.interactivity.xml', data: Buffer.from(buildInteractivity(), 'utf8') },
    { name: 'Sample.xml', data: Buffer.from(buildRwi(), 'utf8') },
  ];
  if (o.withSvg) entries.push({ name: 'fig1.svg', data: Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>') });
  return zipStored(entries);
}

export function buildHtm(o: FixtureOptions = {}): Buffer {
  const zip = buildBundleZip(o).toString('base64');
  const html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>Sample</title>
<script>/* Cortona3D Solo 2.8.0 UMD bundle (stub) */ var Cortona3DSolo = {};</script>
<script id="helpContent" type="text/html">data:text/html;base64,PGI+aGVscDwvYj4=</script>
<script type="application/solo+zip" data-total-memory="">data:application/x-cortona3d;base64,${zip}</script>
<script>/* Cortona3D Solo Core Standalone Bundle 2.8.0 (stub) */</script>
<script>Cortona3DSolo.uniview = { options: {} };</script>
</head><body></body></html>`;
  return Buffer.from(html, 'utf8');
}
