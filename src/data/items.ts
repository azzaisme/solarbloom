// E23.6.1 (#390): one registry of everything the backpack and the store hold: E21's materials and the crafting
// table's components. Other sub-epics add their item kinds here (and to ItemId in core/types).

import type { ComponentId, ItemId, MaterialId } from '../core/types';
import { COMPONENTS, COMPONENT_IDS } from './crafting';
import { MATERIALS, MATERIAL_IDS } from './salvage';

export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  colour: string;
  kind: 'material' | 'component';
}

export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  ...(Object.fromEntries(MATERIAL_IDS.map((m) => [m, { id: m, name: MATERIALS[m].name, icon: MATERIALS[m].icon, colour: MATERIALS[m].colour, kind: 'material' }])) as Record<MaterialId, ItemDef>),
  ...(Object.fromEntries(COMPONENT_IDS.map((c) => [c, { id: c, name: COMPONENTS[c].name, icon: COMPONENTS[c].icon, colour: COMPONENTS[c].colour, kind: 'component' }])) as Record<ComponentId, ItemDef>),
};

export const ITEM_IDS = Object.keys(ITEM_DEFS) as ItemId[];

export function itemDef(id: ItemId): ItemDef {
  return ITEM_DEFS[id];
}

export const isMaterial = (id: string): id is MaterialId => (MATERIAL_IDS as string[]).includes(id);
export const isComponent = (id: string): id is ComponentId => (COMPONENT_IDS as string[]).includes(id);
