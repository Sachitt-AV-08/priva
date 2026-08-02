import { useCallback } from "react";
import { useStore } from "../store";
import { getWorld } from "./registry";
import type { WorldContext } from "./types";
import { nodeService } from "../engine/nodeService";
import { commandBus } from "../engine/commandBus";

export function useWorldContext(): WorldContext {
  const { addTab, setActiveTab, tabs, setCurrentNode, setCurrentChildren, setRootPages } = useStore();

  const openDocument = useCallback(async (id: string) => {
    const existing = tabs.find((t) => t.nodeId === id);
    if (existing) { setActiveTab(existing.id); return; }
    const node = await nodeService.get(id);
    if (!node) return;
    const props = JSON.parse(node.properties || "{}");
    addTab({ nodeId: node.id, toolId: null, title: props.title || "Untitled", icon: node.icon || "📝", viewId: null });
    setCurrentNode(node);
    const children = await nodeService.getChildren(node.id);
    setCurrentChildren(children);
  }, [tabs, addTab, setActiveTab, setCurrentNode, setCurrentChildren]);

  const openCollection = useCallback(async (id: string) => {
    const existing = tabs.find((t) => t.nodeId === id);
    if (existing) { setActiveTab(existing.id); return; }
    const node = await nodeService.get(id);
    if (!node) return;
    const props = JSON.parse(node.properties || "{}");
    addTab({ nodeId: node.id, toolId: null, title: props.title || "Untitled Collection", icon: "📊", viewId: null });
    setCurrentNode(node);
    const children = await nodeService.getChildren(node.id);
    setCurrentChildren(children);
  }, [tabs, addTab, setActiveTab, setCurrentNode, setCurrentChildren]);

  const openWorld = useCallback((worldId: string) => {
    const world = getWorld(worldId);
    if (!world) return;
    const existing = tabs.find((t) => t.toolId === worldId);
    if (existing) { setActiveTab(existing.id); return; }
    addTab({ nodeId: null, toolId: worldId, title: world.label, icon: world.icon, viewId: null });
  }, [tabs, addTab, setActiveTab]);

  const goHome = useCallback(() => {
    const home = tabs.find((t) => !t.nodeId && !t.toolId);
    if (home) { setActiveTab(home.id); return; }
    // Close all workspace tabs, go to welcome
    useStore.getState().setActiveTab(null as any);
  }, [tabs, setActiveTab]);

  return { openDocument, openCollection, openWorld, goHome };
}
