import type { World } from "./types";

const registry = new Map<string, World>();

export function registerWorld(world: World): void {
  registry.set(world.id, world);
}

export function getWorld(id: string): World | undefined {
  return registry.get(id);
}

export function getAllWorlds(): World[] {
  return Array.from(registry.values());
}

export function getWorldsByCategory(category: World["category"]): World[] {
  return Array.from(registry.values()).filter((w) => w.category === category);
}

export function isWorld(id: string): boolean {
  return registry.has(id);
}
