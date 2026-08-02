import { db } from "./database";
import { nodeService } from "./nodeService";
import { generateId, now, type Command, type CommandResult } from "./types";

class CommandBus {
  async dispatch(command: Command): Promise<CommandResult> {
    try {
      switch (command.type) {
        case "CREATE_NODE": return this.createNode(command.payload);
        case "UPDATE_NODE": return this.updateNode(command.payload);
        case "DELETE_NODE": return this.deleteNode(command.payload);
        default:
          return { success: false, eventId: 0, error: `Unknown command: ${command.type}` };
      }
    } catch (err: any) {
      return { success: false, eventId: 0, error: err.message };
    }
  }

  private async createNode(payload: any): Promise<CommandResult> {
    const node = await nodeService.create(
      payload.type,
      payload.properties || {},
      payload.content,
      payload.parentId,
      payload.rootId
    );
    await db.execute(
      "INSERT INTO events (aggregate_id, event_type, payload, recorded_at) VALUES (?, ?, ?, ?)",
      [node.id, "node.created", JSON.stringify({ node }), now()]
    );
    const result = await db.query("SELECT last_insert_rowid() as id");
    return { success: true, eventId: (result[0] as any)?.id || 0 };
  }

  private async updateNode(payload: any): Promise<CommandResult> {
    await nodeService.update(payload.id, payload.changes);
    await db.execute(
      "INSERT INTO events (aggregate_id, event_type, payload, recorded_at) VALUES (?, ?, ?, ?)",
      [payload.id, "node.updated", JSON.stringify(payload.changes), now()]
    );
    const result = await db.query("SELECT last_insert_rowid() as id");
    return { success: true, eventId: (result[0] as any)?.id || 0 };
  }

  private async deleteNode(payload: any): Promise<CommandResult> {
    await nodeService.delete(payload.id);
    await db.execute(
      "INSERT INTO events (aggregate_id, event_type, payload, recorded_at) VALUES (?, ?, ?, ?)",
      [payload.id, "node.deleted", JSON.stringify({ id: payload.id }), now()]
    );
    const result = await db.query("SELECT last_insert_rowid() as id");
    return { success: true, eventId: (result[0] as any)?.id || 0 };
  }
}

export const commandBus = new CommandBus();
