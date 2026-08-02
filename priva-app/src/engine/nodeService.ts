import { db } from "./database";
import { generateId, now, parseProperties, serializeProperties, type Node, type NodeType, type NodeProperties } from "./types";
import { generateKeyBetween } from "fractional-indexing";

class NodeService {
  async create(type: NodeType, props: NodeProperties = {}, content?: string, parentId?: string, rootId?: string): Promise<Node> {
    const siblings = await db.all<Node>(
      "SELECT sort_key FROM nodes WHERE parent_id IS ? AND deleted_at IS NULL ORDER BY sort_key DESC LIMIT 1",
      [parentId || null]
    );
    const lastKey = siblings[0]?.sort_key || "";
    const sortKey = generateKeyBetween(lastKey || null, null);
    let resolvedRootId = rootId;
    if (!resolvedRootId && parentId) {
      const parent = await this.get(parentId);
      resolvedRootId = parent?.root_id || parent?.id;
    }

    const id = generateId();
    const ts = now();

    await db.execute(
      "INSERT INTO nodes (id, type, parent_id, root_id, sort_key, properties, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, type, parentId || null, resolvedRootId || null, sortKey, serializeProperties(props), content || null, ts, ts]
    );

    const created = await this.get(id);
    if (!created) throw new Error(`Node ${id} was not created`);
    return created;
  }

  async get(id: string): Promise<Node | undefined> {
    return db.get<Node>("SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL", [id]);
  }

  async update(id: string, changes: Partial<{ properties: NodeProperties; content: string; icon: string; type: NodeType }>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    if (changes.properties !== undefined) {
      sets.push("properties = ?");
      params.push(serializeProperties(changes.properties));
    }
    if (changes.content !== undefined) {
      sets.push("content = ?");
      params.push(changes.content);
    }
    if (changes.icon !== undefined) {
      sets.push("icon = ?");
      params.push(changes.icon);
    }
    if (changes.type !== undefined) {
      sets.push("type = ?");
      params.push(changes.type);
    }

    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    params.push(now());
    params.push(id);

    await db.execute(`UPDATE nodes SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  async delete(id: string): Promise<void> {
    await db.execute("UPDATE nodes SET deleted_at = ? WHERE id = ?", [now(), id]);
  }

  async restore(id: string): Promise<void> {
    await db.execute("UPDATE nodes SET deleted_at = NULL WHERE id = ?", [id]);
  }

  async getChildren(parentId: string | null = null): Promise<Node[]> {
    return db.all<Node>(
      "SELECT * FROM nodes WHERE parent_id IS ? AND deleted_at IS NULL ORDER BY sort_key",
      [parentId]
    );
  }

  async getRootPages(): Promise<Node[]> {
    return db.all<Node>(
      "SELECT * FROM nodes WHERE type IN ('note', 'page') AND parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_key"
    );
  }

  async search(query: string): Promise<Node[]> {
    if (!query.trim()) return [];
    return db.all<Node>(
      `SELECT * FROM nodes WHERE deleted_at IS NULL AND (
        properties LIKE ? OR content LIKE ? OR icon LIKE ?
      ) ORDER BY updated_at DESC LIMIT 50`,
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );
  }

  async getRecent(limit = 20): Promise<Node[]> {
    return db.all<Node>(
      "SELECT * FROM nodes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?",
      [limit]
    );
  }
}

export const nodeService = new NodeService();
