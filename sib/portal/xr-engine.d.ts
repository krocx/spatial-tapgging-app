// Types for xr-engine.js so the Designer (TypeScript) shares the one engine.
import type { GuideStepNode } from '@spatial/shared';

export const DEFAULT_SPEED: number;
export const GHOST_OPACITY: number;
export interface EnginePose { show?: 'solid' | 'ghost' | 'hidden'; opacity?: number; color?: number[]; position?: number[] | null; rotation?: number[] | null }
export type EngineState = Map<string, EnginePose>;
export interface ScheduleEntry { index: number; delta: GuideStepNode; startSec: number; durationSec: number; motion: boolean; flash: boolean; hideAfterMotion: boolean; depth: number }
export function hasMotion(d: GuideStepNode): boolean;
export function applyDelta(state: EngineState, d: GuideStepNode): EngineState;
export function stateBefore(initialNodes: GuideStepNode[] | undefined, steps: { nodes?: GuideStepNode[] }[], k: number): EngineState;
export function stateAfter(initialNodes: GuideStepNode[] | undefined, steps: { nodes?: GuideStepNode[] }[], k: number): EngineState;
export function scheduleStep(nodes: GuideStepNode[] | undefined, speed?: number, depthOf?: (node: string) => number): ScheduleEntry[];
export function scheduleLength(schedule: ScheduleEntry[]): number;
export function stateDuring(base: EngineState, schedule: ScheduleEntry[], t: number): EngineState;
export function stepParts(step: { nodes?: GuideStepNode[] } | undefined): string[];
export function originForSurface(hit: number[], bounds: { min: number[]; max: number[] }, scale?: number, rotate?: (v: number[]) => number[]): number[];
export function attentionFor(a: { hitsTarget: boolean; hitsAssembly: boolean; placed: boolean; panelOpen: boolean }): string;
