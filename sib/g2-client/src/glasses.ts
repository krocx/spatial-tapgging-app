// glasses.ts - the only file that talks to the Even Hub SDK.
//
// One full-screen text container (576 x 288, isEventCapture) carries the
// page; firmware scrolls it on swipe when it overflows. Updates go through
// textContainerUpgrade (flicker-free); the page is rebuilt only when the
// contextual menu changes (a validation step adds Pass / Fail). Input is
// reduced to four verbs the runner understands: next, back, repeat, menu.
// Outside the Even app (a desktop browser) the bridge never arrives and the
// phone mirror alone drives the run.
// Proprietary & Confidential · Applied Materials.

import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

export type Verb = 'next' | 'back' | 'repeat';
export const MENU = { PASS: 1, FAIL: 2, FIRST: 3, END: 4 } as const;
export type MenuId = (typeof MENU)[keyof typeof MENU];

export interface GlassesStatus { connected: boolean; battery?: number; wearing?: boolean; model?: string }

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>;

const MAIN = { containerID: 1, containerName: 'main' };

export class Glasses {
  private bridge: Bridge | null = null;
  private menuWithCheck = false;
  private lastText = '';
  private created = false;
  /** For the phone's status line: what the bridge last said and sent. */
  debug = { page: '', event: '' };
  onDebug: () => void = () => {};
  onVerb: (v: Verb) => void = () => {};
  onMenu: (id: MenuId) => void = () => {};
  onStatus: (s: GlassesStatus) => void = () => {};

  /** Resolve the bridge if the Even app injects it within `timeoutMs`; otherwise run phone-only. */
  async connect(timeoutMs = 4000): Promise<boolean> {
    const bridge = await Promise.race([waitForEvenAppBridge(), new Promise<null>(r => setTimeout(() => r(null), timeoutMs))]);
    if (!bridge) { this.onStatus({ connected: false }); return false; }
    this.bridge = bridge;
    bridge.onEvenHubEvent(ev => {
      try { const o = ev as Record<string, unknown>; this.debug.event = Object.keys(o).filter(k => o[k] !== undefined).map(k => `${k}:${JSON.stringify(o[k]).slice(0, 60)}`).join(' ') || 'empty'; } catch { this.debug.event = 'event'; }
      this.onDebug();
      const t = ev.textEvent;
      if (t) {
        switch (t.eventType) {
          case OsEventTypeList.CLICK_EVENT: case undefined: this.onVerb('next'); break;
          case OsEventTypeList.DOUBLE_CLICK_EVENT: this.onVerb('back'); break;
          // Swipes scroll the page in firmware; nothing to do here.
        }
      }
      const sys = ev.sysEvent?.eventType;
      if (sys === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) this.onVerb('repeat');
      const item = ev.menuItemClickEvent?.itemID;
      if (item !== undefined) this.onMenu(item as MenuId);
    });
    try {
      const info = await bridge.getDeviceInfo();
      this.onStatus({ connected: true, battery: (info as { battery?: number })?.battery, wearing: (info as { wearing?: boolean })?.wearing, model: (info as { model?: string })?.model });
      bridge.onDeviceStatusChanged?.((st: unknown) => this.onStatus({ connected: true, battery: (st as { battery?: number })?.battery, wearing: (st as { wearing?: boolean })?.wearing }));
    } catch { this.onStatus({ connected: true }); }
    return true;
  }

  get connected(): boolean { return !!this.bridge; }

  private menu(withCheck: boolean) {
    const items = [...(withCheck ? [{ itemName: 'Pass', itemID: MENU.PASS }, { itemName: 'Fail', itemID: MENU.FAIL }] : []), { itemName: 'First step', itemID: MENU.FIRST }, { itemName: 'End guide', itemID: MENU.END }];
    // The SDK wants its own classes here (they carry toJson for the bridge payload).
    return new MenuContainerProperty({ menuItems: items.map(i => new MenuItemProperty(i)) });
  }

  /** First page: creates the container. Later pages: in-place upgrade, or a rebuild when the menu changes. */
  async show(text: string, withCheck = false): Promise<void> {
    if (!this.bridge) return;
    const content = text.slice(0, 1000);
    if (!this.created) {
      const main = new TextContainerProperty({ xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0, borderColor: 5, paddingLength: 4, ...MAIN, content, isEventCapture: 1 });
      let r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [main], menuObject: this.menu(withCheck) }));
      if (r !== 0) {
        // An older Even app may refuse the menu (SDK 0.0.14 feature): try the bare page.
        console.error('[g2] createStartUpPageContainer with menu', r);
        r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [main] }));
      }
      this.debug.page = r === 0 ? 'page created' : `page failed (${r})`; this.onDebug();
      if (r !== 0) { console.error('[g2] createStartUpPageContainer', r); return; }
      this.created = true;
    } else if (withCheck !== this.menuWithCheck) {
      const main = new TextContainerProperty({ xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0, borderColor: 5, paddingLength: 4, ...MAIN, content, isEventCapture: 1 });
      await this.bridge.rebuildPageContainer({ containerTotalNum: 1, textObject: [main], menuObject: this.menu(withCheck) });
    } else {
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ ...MAIN, content }));
    }
    this.lastText = content; this.menuWithCheck = withCheck;
  }

  /** The system exit dialog (mode 1) - required on the root page. */
  async close(): Promise<void> { try { await this.bridge?.shutDownPageContainer(1); } catch { /* not on hardware */ } }
}
